import test, { before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EREADER_DIR = fileURLToPath(new URL('../src/features/ereader/', import.meta.url));

class FakeStorage {
    constructor() { this.map = new Map(); }
    setItem(key, value) { this.map.set(String(key), String(value)); }
    getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
    removeItem(key) { this.map.delete(String(key)); }
    clear() { this.map.clear(); }
    key(i) { return [...this.map.keys()][i] ?? null; }
    get length() { return this.map.size; }
}

function makeIdb(seed = {}) {
    const map = new Map(Object.entries(seed));
    return {
        map,
        get: async key => (map.has(key) ? map.get(key) : undefined),
        set: async (key, value) => { map.set(key, value); return true; },
        del: async key => { map.delete(key); return true; }
    };
}

/**
 * Scans JavaScript code for isolation rule violations:
 * 1. Imports from state.js starting with save or clear
 * 2. Mutations to AppState properties (AppState.<field> =)
 * 3. Calls to synchronous storage functions (persist, readJSON, readString)
 *
 * @param {string} code
 * @returns {string[]} List of violation descriptions
 */
export function scanForIsolationViolations(code) {
    const violations = [];

    // 1. Check imports from state.js
    const stateImportRe = /import\s*\{([^}]+)\}\s*from\s*['"][^'"]*state(?:\.js)?['"]/g;
    let match;
    while ((match = stateImportRe.exec(code)) !== null) {
        const specifiers = match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim());
        for (const spec of specifiers) {
            if (/^(save|clear)[A-Z0-9_$]*/i.test(spec)) {
                violations.push(`Forbidden import from state.js: "${spec}"`);
            }
        }
    }

    // 2. Check mutations to AppState
    const appStateMutationRe = /\bAppState\.[a-zA-Z0-9_$]+\s*=[^=]/g;
    if (appStateMutationRe.test(code)) {
        violations.push('Forbidden mutation to AppState properties');
    }

    // 3. Check calls to synchronous storage methods
    // Must not call persist(), readJSON(), readString()
    const syncCallsRe = /\b(persist|readJSON|readString)\b\s*\(/g;
    let syncMatch;
    while ((syncMatch = syncCallsRe.exec(code)) !== null) {
        violations.push(`Forbidden synchronous storage call: "${syncMatch[1]}()"`);
    }

    return violations;
}

let storage;
let state;
let ereaderStore;
let idb;

before(async () => {
    global.localStorage = new FakeStorage();
    storage = await import('../src/core/storage.js');
    state = await import('../src/core/state.js');
    ereaderStore = await import('../src/features/ereader/ereader-store.js');
});

beforeEach(async () => {
    global.localStorage = new FakeStorage();
    idb = makeIdb();
    storage._setIdbBackendForTests(idb);
    ereaderStore._resetEreaderStoreForTests();
    await ereaderStore.loadEreader();
});

afterEach(() => {
    storage._setIdbBackendForTests(null);
});

// ── (a) Static scan ────────────────────────────────────────────────────────

test('1. static scan: no file in src/features/ereader/ violates isolation rules', () => {
    const files = readdirSync(EREADER_DIR).filter(f => f.endsWith('.js'));
    assert.ok(files.length >= 3, 'Must scan at least ereader-schema.js, ereader-chapters.js, ereader-store.js');

    for (const file of files) {
        const content = readFileSync(join(EREADER_DIR, file), 'utf8');
        const violations = scanForIsolationViolations(content);
        assert.deepEqual(violations, [], `Isolation violations found in ${file}: ${violations.join(', ')}`);
    }
});

test('2. static scanner test: scanner correctly detects synthetic violations', () => {
    const badImportCode = `import { saveSources, clearProgressData } from '../../core/state.js';`;
    const v1 = scanForIsolationViolations(badImportCode);
    assert.ok(v1.some(v => v.includes('saveSources')));
    assert.ok(v1.some(v => v.includes('clearProgressData')));

    const badMutationCode = `AppState.deviceId = 'custom';`;
    const v2 = scanForIsolationViolations(badMutationCode);
    assert.ok(v2.some(v => v.includes('mutation to AppState')));

    const badSyncStorageCode = `const data = readJSON('my_key', null);\npersist('my_key', 123);`;
    const v3 = scanForIsolationViolations(badSyncStorageCode);
    assert.ok(v3.some(v => v.includes('readJSON()')));
    assert.ok(v3.some(v => v.includes('persist()')));

    // Clean code with permitted async methods should have 0 violations
    const goodCode = `
        import { AppState } from '../../core/state.js';
        import { persistAsync, readJSONAsync } from '../../core/storage.js';
        const id = AppState.deviceId;
        await persistAsync('key', 1);
        const data = await readJSONAsync('key', null);
    `;
    const vGood = scanForIsolationViolations(goodCode);
    assert.deepEqual(vGood, []);
});

// ── (b) Behavioral isolation ───────────────────────────────────────────────

test('3. behavioral isolation: clearProgressData() and clearLocalStudyData() do not touch focus_app_ereader_* keys', async () => {
    // Add book and progress to ereader store
    const book = {
        title: 'Survivor Book',
        language: 'de',
        sourceType: 'pdf',
        sections: [{ id: 's-1', title: 'Intro', level: 1, text: 'Content survives reset' }]
    };
    const saved = await ereaderStore.addBook(book);
    await ereaderStore.setProgress(saved.id, { sectionId: 's-1', offset: 0.8, percent: 80 });

    // Verify written to storage
    const listBefore = ereaderStore.listBooks();
    assert.equal(listBefore.length, 1);
    assert.equal(listBefore[0].id, saved.id);
    assert.ok(idb.map.has('focus_app_ereader_index'));
    assert.ok(idb.map.has(`focus_app_ereader_book_${saved.id}`));
    assert.ok(idb.map.has('focus_app_ereader_progress'));

    // Execute test-center data resets
    state.clearProgressData();
    state.clearLocalStudyData();

    // Verify e-Reader storage keys are still completely present in storage!
    assert.ok(idb.map.has('focus_app_ereader_index'), 'focus_app_ereader_index must survive resets');
    assert.ok(idb.map.has(`focus_app_ereader_book_${saved.id}`), 'book record must survive resets');
    assert.ok(idb.map.has('focus_app_ereader_progress'), 'focus_app_ereader_progress must survive resets');

    // And reading through ereader store returns the book and progress intact
    const listAfter = ereaderStore.listBooks();
    assert.equal(listAfter.length, 1);
    assert.equal(listAfter[0].id, saved.id);

    const progressAfter = ereaderStore.getProgress(saved.id);
    assert.ok(progressAfter);
    assert.equal(progressAfter.percent, 80);
    assert.equal(progressAfter.sectionId, 's-1');
});
