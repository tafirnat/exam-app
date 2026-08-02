import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// localStorage throws once the origin's quota is full. Before storage.js every
// write was a bare setItem, so that exception tore through whatever call chain
// it landed in - an import, a folder rename, the save after answering a
// question - and the user only found out on the next reload, when the work was
// gone. persist() has to swallow that, report it once, and tell the caller.

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

let storage;

/* jsdom's localStorage is a Proxy: assigning `.setItem` on it is trapped as a
   write of a key called "setItem" rather than overriding the method, so a
   quota failure cannot be simulated on it. This plain stand-in makes the
   throwing behaviour controllable, which is the whole point of these cases. */
class FakeStorage {
    constructor() { this.map = new Map(); this.failWith = null; }
    setItem(key, value) {
        if (this.failWith) throw this.failWith;
        this.map.set(String(key), String(value));
    }
    getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
    removeItem(key) { this.map.delete(String(key)); }
    clear() { this.map.clear(); }
}

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = new FakeStorage();
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    storage = await import('../src/core/storage.js');

    /* reportQuotaFull() reaches the UI through a dynamic import. Loading those
       modules here means that import resolves from cache, so the assertions
       below measure the once-per-session logic rather than i18n.js load time. */
    await Promise.all([import('../src/core/utils.js'), import('../src/core/i18n.js')]);
});

beforeEach(() => {
    global.localStorage = new FakeStorage();
    storage._resetQuotaWarning();
});

/* Mimics how Chrome and Safari report a full quota. */
function failWithQuotaError() {
    const err = new Error('QuotaExceededError');
    err.name = 'QuotaExceededError';
    err.code = 22;
    global.localStorage.failWith = err;
}

test('persist stores objects as JSON and strings verbatim', () => {
    assert.equal(storage.persist('obj', { a: 1 }), true);
    assert.equal(global.localStorage.getItem('obj'), '{"a":1}');

    assert.equal(storage.persist('str', 'plain'), true);
    assert.equal(global.localStorage.getItem('str'), 'plain');
});

test('persist returns false instead of throwing when the quota is full', () => {
    failWithQuotaError();

    let returned;
    assert.doesNotThrow(() => { returned = storage.persist('focus_app_sources', [{ id: 'x' }]); });
    assert.equal(returned, false, 'a failed write must be reported to the caller');
});

test('a full quota is reported to the user only once per session', async () => {
    /* index.html is not loaded here, so utils.showAlert() takes its
       no-modal-available branch and calls window.alert. */
    const alerts = [];
    global.window.alert = msg => alerts.push(msg);
    failWithQuotaError();

    storage.persist('a', '1');
    storage.persist('b', '2');
    storage.persist('c', '3');

    /* The warning path is a dynamic import, so let its promise chain settle. */
    await new Promise(resolve => setTimeout(resolve, 100));

    assert.equal(alerts.length, 1, `three failed writes must produce exactly one dialog, got ${alerts.length}`);
});

test('persistRemove never throws', () => {
    storage.persist('gone', 'value');
    assert.doesNotThrow(() => storage.persistRemove('gone'));
    assert.equal(global.localStorage.getItem('gone'), null);
});

test('readJSON falls back on a missing key and on corrupt text', () => {
    assert.deepEqual(storage.readJSON('absent', { d: true }), { d: true });

    global.localStorage.setItem('broken', '{not json');
    assert.deepEqual(storage.readJSON('broken', []), []);
});

test('readInt and readFloat fall back rather than yielding NaN', () => {
    assert.equal(storage.readInt('absent', 59), 59);
    assert.equal(storage.readFloat('absent', 0.5), 0.5);

    global.localStorage.setItem('junk', 'abc');
    assert.equal(storage.readInt('junk', 7), 7);
    assert.equal(storage.readFloat('junk', 1.5), 1.5);

    global.localStorage.setItem('num', '42');
    assert.equal(storage.readInt('num', 0), 42);
});

test('readString distinguishes a missing key from a stored empty string', () => {
    assert.equal(storage.readString('absent', null), null);
    global.localStorage.setItem('empty', '');
    assert.equal(storage.readString('empty', null), '');
});

function jsFiles(dir) {
    return readdirSync(dir).flatMap(entry => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return jsFiles(full);
        return entry.endsWith('.js') ? [full] : [];
    });
}

/** Every module except the gate itself. */
function modulesUnderTheRule() {
    return jsFiles(SRC).filter(file => !file.endsWith(join('core', 'storage.js')));
}

/**
 * Lines of real code that touch localStorage, with prose left out.
 *
 * Comment lines are skipped so that explaining the rule does not break it - the
 * files below are full of sentences containing the word. The pattern demands an
 * identifier immediately after the dot, so a sentence ending in "...from
 * localStorage." is prose, while `localStorage.getItem` is not.
 */
function rawAccesses(code) {
    const hits = [];
    code.split('\n').forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
        const m = trimmed.match(/localStorage(\.[A-Za-z_$][\w$]*|\s*\[)/);
        if (m) hits.push(`${i + 1}: ${trimmed.slice(0, 90)}`);
    });
    return hits;
}

test('storage.js is the only module that writes to localStorage directly', () => {
    const offenders = [];

    for (const file of modulesUnderTheRule()) {
        const code = readFileSync(file, 'utf8');
        for (const call of ['localStorage.setItem', 'localStorage.removeItem']) {
            if (code.includes(call)) offenders.push(`${file.slice(SRC.length)}: ${call}`);
        }
    }

    assert.deepEqual(
        offenders,
        [],
        `raw localStorage writes bypass the quota handling:\n  ${offenders.join('\n  ')}`
    );
});

/* The gate covered writes only for a long time, and reads drifted: eighteen bare
   getItem calls accumulated, each with its own idea of what to do about a
   missing or corrupt value - or, twice on the home screen, no idea at all, so a
   damaged record threw before anything was drawn. Reading through the same door
   makes "the stored value is nonsense" one behaviour instead of eighteen. */
test('storage.js is the only module that reads localStorage directly', () => {
    const offenders = [];

    for (const file of modulesUnderTheRule()) {
        const hits = rawAccesses(readFileSync(file, 'utf8'));
        hits.forEach(hit => offenders.push(`${file.slice(SRC.length)}:${hit}`));
    }

    assert.deepEqual(
        offenders,
        [],
        'read through readJSON / readString / readInt / readFloat instead - a raw '
        + `read decides on its own what a corrupt value means:\n  ${offenders.join('\n  ')}`
    );
});

test('the scan can tell code from the prose that describes it', () => {
    // Guards the guard: a rule this cheap to satisfy is worth nothing if it
    // fires on its own documentation, because the next person deletes it.
    assert.deepEqual(rawAccesses(' * Safely reads and parses a JSON item from localStorage.'), []);
    assert.deepEqual(rawAccesses('// never call localStorage.getItem here'), []);
    assert.equal(rawAccesses('const raw = localStorage.getItem("k");').length, 1);
    assert.equal(rawAccesses('localStorage["k"] = 1;').length, 1);
});
