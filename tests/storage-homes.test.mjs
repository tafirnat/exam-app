import test, { before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every storage key has one home. After the move to IndexedDB some keys were
// written through the async API (IndexedDB) and read through the sync one
// (localStorage), or the other way round. Measured in Edge: a logout did not
// survive a reload, and a finished test kept its resume button. None of it was
// visible to the suite, because jsdom has no IndexedDB and storage.js then puts
// every key in localStorage - one store, so a split cannot even exist. These
// cases install a second store to make it possible again.

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

let storage;

class FakeStorage {
    constructor() { this.map = new Map(); }
    setItem(key, value) { this.map.set(String(key), String(value)); }
    getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
    removeItem(key) { this.map.delete(String(key)); }
    clear() { this.map.clear(); }
    key(i) { return [...this.map.keys()][i] ?? null; }
    get length() { return this.map.size; }
}

/** A stand-in IndexedDB keyval store. */
function makeIdb(seed = {}) {
    const map = new Map(Object.entries(seed));
    return {
        map,
        get: async key => (map.has(key) ? map.get(key) : undefined),
        set: async (key, value) => { map.set(key, value); return true; },
        del: async key => { map.delete(key); return true; }
    };
}

let idb;

before(async () => {
    global.localStorage = new FakeStorage();
    storage = await import('../src/core/storage.js');
});

beforeEach(() => {
    global.localStorage = new FakeStorage();
    idb = makeIdb();
    storage._setIdbBackendForTests(idb);
});

afterEach(() => {
    storage._setIdbBackendForTests(null);
});

// ── Routing: one home per key ───────────────────────────────────────────────

test('a localStorage key reads back the same whichever API wrote it', async () => {
    for (const key of ['focus_app_github_token', 'focus_app_active_test', 'focus_app_deleted_sources', 'focus_app_lang']) {
        await storage.persistAsync(key, 'via-async');
        assert.equal(storage.readString(key), 'via-async', `${key}: async write, sync read`);
        storage.persist(key, 'via-sync');
        assert.equal(await storage.readStringAsync(key), 'via-sync', `${key}: sync write, async read`);
        assert.equal(idb.map.has(key), false, `${key} must not get an IndexedDB copy`);
    }
});

test('a logout survives the next boot', async () => {
    // The shape a migrated install had: the token in both stores.
    localStorage.setItem('focus_app_github_token', 'ghp_old');
    idb.map.set('focus_app_github_token', 'ghp_old');

    storage.persistRemove('focus_app_github_token');   // logout (github-sync.js)

    assert.equal(await storage.readStringAsync('focus_app_github_token'), null);   // initState()
});

test('tombstones written by a pull reach the next boot', async () => {
    idb.map.set('focus_app_deleted_sources', '["old"]');   // the migration-time copy
    storage.persist('focus_app_deleted_sources', ['old', 'pulled']);   // github-sync.js pull

    assert.deepEqual(await storage.readJSONAsync('focus_app_deleted_sources', []), ['old', 'pulled']);   // initState()
});

test('a finished test is not offered for resuming', async () => {
    storage.persist('focus_app_active_test', { currentTest: ['a_1', 'a_2'], updatedAt: 1 });
    await storage.persistAsync('focus_app_active_test', { cleared: true, updatedAt: 2 });   // clearActiveTest()

    assert.equal(storage.readJSON('focus_app_active_test', null).cleared, true);   // renderResumeButton()
});

test('a reset removes the sample flag where the home screen looks for it', async () => {
    storage.persist('focus_app_sample_loaded', 'de');
    await storage.persistRemoveAsync('focus_app_sample_loaded');   // clearLocalStudyData()
    assert.equal(storage.readString('focus_app_sample_loaded'), null);   // main.js boot check
});

test('the bulk stays in IndexedDB', async () => {
    await storage.persistAsync('focus_app_sources', [{ id: 's1' }]);
    assert.equal(idb.map.get('focus_app_sources'), '[{"id":"s1"}]');
    assert.equal(localStorage.getItem('focus_app_sources'), null);
    assert.deepEqual(await storage.readJSONAsync('focus_app_sources', null), [{ id: 's1' }]);
});

test('migration leaves localStorage keys where they are', async () => {
    localStorage.setItem('focus_app_github_token', 'ghp_x');
    localStorage.setItem('focus_app_sources', '[]');
    await storage.migrateFromLocalStorage();
    assert.equal(idb.map.has('focus_app_sources'), true);
    assert.equal(idb.map.has('focus_app_github_token'), false);
});

// ── The one-off repair of installs that already split ───────────────────────

async function settle(local, stored) {
    Object.entries(local).forEach(([k, v]) => localStorage.setItem(k, v));
    Object.entries(stored).forEach(([k, v]) => idb.map.set(k, v));
    await storage.settleKeyHomes();
}

test('repair: a logout recorded only in localStorage wins over the old token', async () => {
    await settle({}, { focus_app_github_token: 'ghp_old', focus_app_github_user: '{"login":"x"}' });
    assert.equal(localStorage.getItem('focus_app_github_token'), null);
    assert.equal(localStorage.getItem('focus_app_github_user'), null);
});

test('repair: a newer login in localStorage wins', async () => {
    await settle({ focus_app_github_token: 'ghp_new' }, { focus_app_github_token: 'ghp_old' });
    assert.equal(localStorage.getItem('focus_app_github_token'), 'ghp_new');
});

test('repair: tombstone lists keep every deletion from both copies', async () => {
    await settle(
        { focus_app_deleted_sources: '["a","b"]' },
        { focus_app_deleted_sources: '["b","c"]' }
    );
    assert.deepEqual(JSON.parse(localStorage.getItem('focus_app_deleted_sources')).sort(), ['a', 'b', 'c']);
});

test('repair: dated tombstones keep the later date per id', async () => {
    await settle(
        { focus_app_deleted_source_at: '{"a":5,"b":1}' },
        { focus_app_deleted_source_at: '{"a":3,"b":9,"c":2}' }
    );
    assert.deepEqual(JSON.parse(localStorage.getItem('focus_app_deleted_source_at')), { a: 5, b: 9, c: 2 });
});

test('repair: a reset stamp keeps the later reset, whichever store has it', async () => {
    await settle({ focus_app_last_progress_reset: '900' }, { focus_app_last_progress_reset: '100' });
    assert.equal(localStorage.getItem('focus_app_last_progress_reset'), '900');
});

test('repair: the unfinished-test record keeps the newer write, in both directions', async () => {
    const live = JSON.stringify({ currentTest: ['a_1'], updatedAt: 10 });
    const cleared = JSON.stringify({ cleared: true, updatedAt: 20 });

    await settle({ focus_app_active_test: live }, { focus_app_active_test: cleared });
    assert.equal(JSON.parse(localStorage.getItem('focus_app_active_test')).cleared, true);

    global.localStorage = new FakeStorage();
    idb = makeIdb();
    storage._setIdbBackendForTests(idb);
    const newerLive = JSON.stringify({ currentTest: ['a_1'], updatedAt: 30 });
    await settle({ focus_app_active_test: newerLive }, { focus_app_active_test: cleared });
    assert.equal(JSON.parse(localStorage.getItem('focus_app_active_test')).updatedAt, 30);
});

test('repair: other keys take the IndexedDB value, which is what boot was reading', async () => {
    await settle({ focus_app_lang: 'tr' }, { focus_app_lang: 'de' });
    assert.equal(localStorage.getItem('focus_app_lang'), 'de');
});

test('repair: no localStorage key keeps an IndexedDB copy', async () => {
    const both = {};
    // The settled flag itself is left out: seeding it would mark the repair done.
    const keys = [...storage.LOCAL_KEYS].filter(key => key !== 'focus_app_key_homes_settled');
    keys.forEach(key => { both[key] = '"x"'; });
    await settle(both, both);
    keys.forEach(key => assert.equal(idb.map.has(key), false, key));
});

test('repair: runs once', async () => {
    await settle({ focus_app_lang: 'tr' }, { focus_app_lang: 'de' });
    idb.map.set('focus_app_lang', 'en');
    await storage.settleKeyHomes();
    assert.equal(localStorage.getItem('focus_app_lang'), 'de');
});

test('repair: without IndexedDB there is one store, and it is left alone', async () => {
    // With no IndexedDB every "IndexedDB" read falls through to localStorage, so
    // an unguarded repair would find each key "in both" and delete the only copy.
    storage._setIdbBackendForTests(null);
    localStorage.setItem('focus_app_github_token', 'ghp_keep');
    localStorage.setItem('focus_app_deleted_sources', '["a"]');
    await storage.settleKeyHomes();
    assert.equal(localStorage.getItem('focus_app_github_token'), 'ghp_keep');
    assert.equal(localStorage.getItem('focus_app_deleted_sources'), '["a"]');
});

// ── Every synchronous call site names a localStorage key ────────────────────

function walk(dir) {
    return readdirSync(dir).flatMap(name => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
    });
}

function stripComments(code) {
    return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const SYNC_CALL = /\b(persist|persistIfChanged|persistRemove|readJSON|readString|readInt|readFloat)\(\s*([^,)]+?)\s*[,)]/g;

/**
 * Keys the synchronous API is called with that are not localStorage keys.
 * `constants` maps constant names to the key they hold.
 */
function findStrayKeys(code, constants, where) {
    const stray = [];
    for (const [, fn, rawArg] of stripComments(code).matchAll(SYNC_CALL)) {
        const arg = rawArg.trim();
        let key = null;
        let m;
        if ((m = arg.match(/^['"`]([^'"`]+)['"`]$/))) key = m[1];
        else if ((m = arg.match(/^['"`]([^'"`]+)['"`]\s*\+/))) key = `${m[1]}probe`;
        else if ((m = arg.match(/^(?:\w+\.)?([A-Z][A-Z0-9_]*)$/)) && constants[m[1]]) key = constants[m[1]];
        if (key === null) stray.push(`${where}: ${fn}(${arg}) - key not resolvable, name it in a constant or literal`);
        else if (!storage.isLocalKey(key)) stray.push(`${where}: ${fn}('${key}') - not in LOCAL_KEYS`);
    }
    return stray;
}

function collectConstants(files) {
    const constants = {};
    files.forEach(f => {
        for (const [, name, value] of readFileSync(f, 'utf8').matchAll(/\b(?:const|let)\s+([A-Z][A-Z0-9_]*)\s*=\s*['"]([^'"]+)['"]/g)) {
            constants[name] = value;
        }
    });
    return constants;
}

test('every key the synchronous API is called with lives in localStorage', () => {
    const files = walk(SRC).filter(f => !f.endsWith(join('core', 'storage.js')));
    const constants = collectConstants(files);
    const stray = files.flatMap(f => findStrayKeys(readFileSync(f, 'utf8'), constants, relative(SRC, f)));
    assert.deepEqual(stray, []);
});

test('the call-site scan actually catches a stray key', () => {
    const code = `
        // readJSON('focus_app_in_a_comment') is documentation, not a call
        const LISTED = 'focus_app_lang';
        readString(LISTED);
        readJSON('focus_app_sources', []);
        persist(somethingDynamic, 1);
    `;
    const stray = findStrayKeys(code, { LISTED: 'focus_app_lang' }, 'probe');
    assert.equal(stray.length, 2);
    assert.match(stray[0], /focus_app_sources/);
    assert.match(stray[1], /somethingDynamic/);
});
