import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Loading the user's data is an explicit step, not something that happens while
// the import graph is evaluated. What that buys: the boot order is written down
// rather than inherited from the import graph, importing this module no longer
// writes to the user's disk, and there is finally a place to await an
// asynchronous storage backend.
//
// The first case below is the one that matters most, and it has to run before
// anything sets up a DOM - which is why the import is at the top of this file
// rather than inside a hook.

const state = await import('../src/core/state.js');

/* Snapshotted here, at module scope: node:test runs `before` hooks ahead of the
   first case, so by then a DOM exists and the question "was there any storage
   when this module was imported" can no longer be asked. */
const atImportTime = {
    hadStorage: typeof globalThis.localStorage !== 'undefined',
    hadDocument: typeof globalThis.document !== 'undefined',
    sources: state.AppState.sources,
    stats: state.AppState.stats,
    folders: state.AppState.folders,
    initialized: state.isStateInitialized()
};

test('importing state.js needs no storage, no DOM and no window', () => {
    assert.equal(atImportTime.hadStorage, false,
        'this case is only meaningful while there is genuinely no storage');
    assert.equal(atImportTime.hadDocument, false);
    // It got this far, so the import itself did not throw - which it would have
    // when every one of these fields was read out of localStorage.
    assert.deepEqual(atImportTime.sources, []);
    assert.deepEqual(atImportTime.stats, {});
    assert.deepEqual(atImportTime.folders, []);
    assert.equal(atImportTime.initialized, false);
});

test('the defaults are a fresh install, not undefined holes', () => {
    // Anything that reads AppState before boot has to see an empty app; the
    // renderers are built to survive that, but not to survive undefined.
    assert.equal(state.AppState.language, 'en');
    assert.equal(state.AppState.ttsSpeed, 0.5);
    assert.equal(state.AppState.timerCountdownLimit, 59);
    assert.equal(state.AppState.timerAutoCheckEnabled, true);
    assert.equal(state.AppState.githubToken, null);
    assert.equal(state.AppState.lastResetTimestamp, 0);
    assert.ok(state.AppState.continuityConfig.freezeTokens);
    assert.deepEqual(state.AppState.deletedSourceIds, []);
});

before(() => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
});

test('importing state.js writes nothing; the folder repair waits for initState()', () => {
    // The repair used to land on disk as a side effect of the import, which is
    // how a module evaluation ended up touching the user's data.
    assert.equal(localStorage.length, 0);

    state.initState();

    const folders = JSON.parse(localStorage.getItem('focus_app_folders'));
    assert.equal(folders.length, 1);
    assert.equal(folders[0].id, 'uncategorized-folder');
});

test('initState() loads what is stored', () => {
    localStorage.setItem('focus_app_sources', JSON.stringify([
        { id: 's1', name: 'Kaynak', questions: [{ id: 'q1', text: 'soru' }] }
    ]));
    localStorage.setItem('focus_app_stats_local', JSON.stringify({ s1_q1: { correct: 2, wrong: 1 } }));
    localStorage.setItem('focus_app_lang', 'tr');
    localStorage.setItem('focus_app_tts_speed', '1.25');
    localStorage.setItem('focus_app_last_progress_reset', '4242');

    state.initState({ force: true });

    assert.equal(state.AppState.sources.length, 1);
    assert.equal(state.AppState.stats.s1_q1.correct, 2);
    assert.equal(state.AppState.language, 'tr');
    assert.equal(state.AppState.ttsSpeed, 1.25);
    assert.equal(state.AppState.lastProgressResetTimestamp, 4242);
    assert.equal(state.isStateInitialized(), true);
});

test('a second initState() is ignored, so a re-import cannot wipe live state', () => {
    state.initState({ force: true });
    state.AppState.sources[0].name = 'edited in memory';

    state.initState();       // no force

    assert.equal(state.AppState.sources[0].name, 'edited in memory');
});

test('force re-reads, which is what a test that changed storage wants', () => {
    localStorage.setItem('focus_app_lang', 'de');
    state.initState({ force: true });
    assert.equal(state.AppState.language, 'de');
});

test('AppState is mutated, never replaced', () => {
    // Every module holds its own reference to this object from import time, so
    // reassigning it would leave half the app writing to an orphan.
    const before = state.AppState;
    state.initState({ force: true });
    assert.equal(state.AppState, before);
});

test('a source without a questions array is dropped on load', () => {
    localStorage.setItem('focus_app_sources', JSON.stringify([
        { id: 'ok', questions: [] },
        { id: 'broken' },
        null
    ]));

    state.initState({ force: true });

    assert.deepEqual(state.AppState.sources.map(s => s.id), ['ok']);
});

test('the pre-rename default-folder is repaired into the system folder', () => {
    localStorage.setItem('focus_app_folders', JSON.stringify([
        { id: 'default-folder', name: 'eski ad', color: '#ff0000' }
    ]));

    state.initState({ force: true });

    const ids = state.AppState.folders.map(f => f.id);
    assert.deepEqual(ids, ['uncategorized-folder']);
    assert.equal(state.AppState.folders[0].color, '#8a99ad');
    assert.equal(state.AppState.folders[0].isSystem, true);
});

test('a folder list that needs no repair is not rewritten', () => {
    state.initState({ force: true });
    const stored = localStorage.getItem('focus_app_folders');

    let writes = 0;
    const realSet = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (...args) => { writes++; return realSet(...args); };
    try {
        state.initState({ force: true });
    } finally {
        localStorage.setItem = realSet;
    }

    assert.equal(writes, 0, 'booting must not write back what it just read');
    assert.equal(localStorage.getItem('focus_app_folders'), stored);
});

test('corrupt stored JSON falls back instead of breaking boot', () => {
    localStorage.setItem('focus_app_stats_local', '{not json');
    localStorage.setItem('focus_app_study_activity', '');

    state.initState({ force: true });

    assert.deepEqual(state.AppState.stats, {});
    assert.deepEqual(state.AppState.studyActivity, {});
});
