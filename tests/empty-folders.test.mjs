import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

/* Empty folders remove themselves once they have stayed empty for the grace
   period, and the deletion is DATED so that a device which meanwhile put a
   source into the folder keeps it. Two halves, both needed:
   - the sweep: when a folder counts as empty, and when it has waited long
     enough - including across a closed app, which is what the stored
     "empty since" is for;
   - the merge: the deletion loses to a folder that is still in use or was
     written after it, and still wins against a stale copy. The legacy,
     undated list keeps winning outright. */

let AppState, initState, createUncategorizedFolderRecord, UNCATEGORIZED_FOLDER_ID, trackDeletedFolder;
let mergeSyncData, getSyncPayload;
let sweep, tomb, store, t, hint;

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 8, 21, 9, 0, 0);

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="toast"></div></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
    delete global.requestAnimationFrame;

    ({ AppState, initState, createUncategorizedFolderRecord, UNCATEGORIZED_FOLDER_ID, trackDeletedFolder }
        = await import('../src/core/state.js'));
    ({ mergeSyncData, getSyncPayload } = await import('../src/core/github-sync.js'));
    sweep = await import('../src/features/sources/empty-folders.js');
    tomb = await import('../src/core/folder-tombstones.js');
    store = await import('../src/core/store.js');
    ({ t } = await import('../src/core/i18n.js'));
    hint = await import('../src/features/sources/folder-hint.js');
});

function freshDevice() {
    localStorage.clear();
    await initState({ force: true });
    AppState.sources.length = 0;
    AppState.folders = [createUncategorizedFolderRecord()];
    AppState.deletedSourceIds = [];
    AppState.deletedFolderIds = [];
    AppState.deletedFolderAt = {};
    AppState.deletedQuickPresetIds = [];
    store._reset();
    document.querySelectorAll('.modal-overlay').forEach(n => n.remove());
}

beforeEach(() => freshDevice());

const folder = (id, extra = {}) => ({ id, name: `Folder ${id}`, color: '#0667ff', order: 1, updatedAt: T0 - 60 * MIN, ...extra });
const source = (id, extra = {}) => ({ id, name: `Source ${id}`, active: false, questions: [{ id: 'q1' }], updatedAt: T0 - 60 * MIN, ...extra });
const ids = () => AppState.folders.map(f => f.id).filter(id => id !== UNCATEGORIZED_FOLDER_ID);
const run = (now, extra = {}) => sweep.sweepEmptyFolders({ now, notify: false, force: true, ...extra });
const emptySince = () => JSON.parse(localStorage.getItem(sweep.EMPTY_SINCE_KEY) || '{}');

function payload({ sources = [], folders = [] }, extra = {}) {
    return {
        sources, folders, quickPresets: [],
        deletedSourceIds: [], deletedFolderIds: [], deletedFolderAt: {}, deletedQuickPresetIds: [],
        stats: {}, recentTests: [], studyActivity: {}, continuityConfig: {},
        lastResetTimestamp: 0, lastProgressResetTimestamp: 0, lastUpdated: 0,
        ...extra
    };
}

// ── The sweep ───────────────────────────────────────────────────────────────

test('a folder seen empty is not removed at once; the wait starts and is stored', async () => {
    AppState.folders.push(folder('f1'));
    assert.deepEqual(run(T0), []);
    assert.deepEqual(ids(), ['f1']);
    assert.deepEqual(emptySince(), { f1: T0 });
});

test('it goes once the grace period has passed, and not a moment before', async () => {
    AppState.folders.push(folder('f1'));
    run(T0);
    assert.deepEqual(run(T0 + sweep.EMPTY_FOLDER_GRACE_MS - 1), []);
    assert.deepEqual(ids(), ['f1']);
    assert.deepEqual(emptySince(), { f1: T0 }, 'a later sweep must not move the start of the wait');

    const removed = run(T0 + sweep.EMPTY_FOLDER_GRACE_MS);
    assert.deepEqual(removed.map(f => f.id), ['f1']);
    assert.deepEqual(ids(), []);
    assert.deepEqual(emptySince(), {});
});

test('a folder left empty before the app was closed goes at the first sweep after reopening', async () => {
    AppState.folders.push(folder('f1'));
    localStorage.setItem('focus_app_folders', JSON.stringify(AppState.folders));
    run(T0);
    // Three hours later, a new session: memory is gone, storage is not.
    await initState({ force: true });
    assert.deepEqual(ids(), ['f1']);
    run(T0 + 3 * 60 * MIN);
    assert.deepEqual(ids(), []);
});

test('the deletion is dated, not added to the legacy list, and reaches the payload', async () => {
    AppState.folders.push(folder('f1'));
    run(T0);
    const now = T0 + sweep.EMPTY_FOLDER_GRACE_MS;
    run(now);
    assert.deepEqual(AppState.deletedFolderIds, []);
    assert.deepEqual(AppState.deletedFolderAt, { f1: now });
    assert.deepEqual(JSON.parse(localStorage.getItem('focus_app_deleted_folder_at')), { f1: now });
    assert.deepEqual(getSyncPayload().deletedFolderAt, { f1: now });
    assert.deepEqual(JSON.parse(localStorage.getItem('focus_app_folders')).map(f => f.id), [UNCATEGORIZED_FOLDER_ID]);
});

test('a folder that fills again forgets its wait; emptied again, it starts over', async () => {
    AppState.folders.push(folder('f1'));
    run(T0);
    AppState.sources.push(source('s1', { folderId: 'f1' }));
    run(T0 + 5 * MIN);
    assert.deepEqual(emptySince(), {});

    AppState.sources.length = 0;
    run(T0 + 8 * MIN);
    run(T0 + 12 * MIN); // 12 min after the first emptying, 4 after the second
    assert.deepEqual(ids(), ['f1']);
    run(T0 + 18 * MIN);
    assert.deepEqual(ids(), []);
});

test('an archived member keeps its folder: the restore needs somewhere to go', async () => {
    AppState.folders.push(folder('f1'));
    AppState.sources.push(source('s1', { folderId: null, archived: true, archivedFrom: { folderId: 'f1', name: 'Folder f1' } }));
    run(T0);
    run(T0 + 60 * MIN);
    assert.deepEqual(ids(), ['f1']);
});

test('the system folder and archived folders are never swept', async () => {
    AppState.folders.push(folder('fa', { archived: true }));
    run(T0);
    run(T0 + 60 * MIN);
    assert.deepEqual(AppState.folders.map(f => f.id), [UNCATEGORIZED_FOLDER_ID, 'fa']);
});

test('editing an empty folder restarts the wait from the edit', async () => {
    AppState.folders.push(folder('f1'));
    run(T0);
    AppState.folders[1].updatedAt = T0 + 8 * MIN; // renamed
    run(T0 + 12 * MIN);
    assert.deepEqual(ids(), ['f1']);
    run(T0 + 18 * MIN);
    assert.deepEqual(ids(), []);
});

test('nothing is removed while a dialog is open', async () => {
    AppState.folders.push(folder('f1'));
    run(T0);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    document.body.appendChild(overlay);
    assert.deepEqual(sweep.sweepEmptyFolders({ now: T0 + 60 * MIN, notify: false }), []);
    assert.deepEqual(ids(), ['f1']);
    overlay.classList.remove('active');
    sweep.sweepEmptyFolders({ now: T0 + 60 * MIN, notify: false });
    assert.deepEqual(ids(), []);
});

test('the removal is announced by name', async () => {
    AppState.folders.push(folder('f1', { name: 'Networks' }));
    run(T0);
    run(T0 + 60 * MIN, { notify: true });
    assert.equal(document.getElementById('toast').innerText ?? document.getElementById('toast').textContent,
        t('empty_folder_removed', { name: 'Networks' }));
});

test('a library change runs the sweep: boot registers it on SOURCES', async () => {
    AppState.folders.push(folder('f1'));
    AppState.sources.push(source('s1', { folderId: 'f1' }));
    sweep.initEmptyFolderSweep();
    assert.deepEqual(emptySince(), {});
    AppState.sources.length = 0;
    store.emit(store.Slice.SOURCES);
    store.flushNow();
    assert.ok(emptySince().f1 > 0, 'emptying the folder must start its wait without waiting for the minute tick');
});

test('boot starts the sweep', async () => {
    const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    assert.match(main, /\n\s*initEmptyFolderSweep\(\);/);
});

// ── The merge ───────────────────────────────────────────────────────────────

test('a folder another device put a source into survives the deletion, even if the move came first', async () => {
    const deletedAt = T0;
    // This device swept f1 away; the other moved s1 into it before hearing of that.
    const local = payload({ folders: [createUncategorizedFolderRecord()] }, { deletedFolderAt: { f1: deletedAt } });
    const remote = payload({
        folders: [createUncategorizedFolderRecord(), folder('f1')],
        sources: [source('s1', { folderId: 'f1', updatedAt: deletedAt - 5 * MIN })]
    });
    const merged = mergeSyncData(local, remote);
    assert.ok(merged.folders.some(f => f.id === 'f1'));
    assert.equal(merged.sources.find(s => s.id === 's1').folderId, 'f1');
    assert.deepEqual(merged.deletedFolderAt, { f1: deletedAt }, 'the deletion stays on record; it just does not apply');
});

test('a stale copy of a deleted, unused folder does not come back, and the Gist is told', async () => {
    const local = payload({ folders: [createUncategorizedFolderRecord()] }, { deletedFolderAt: { f1: T0 } });
    const remote = payload({ folders: [createUncategorizedFolderRecord(), folder('f1')] });
    const merged = mergeSyncData(local, remote);
    assert.equal(merged.folders.some(f => f.id === 'f1'), false);
    assert.equal(merged.hasLocalChanges, true);
});

test('a Gist that knows the deletion but still lists the folder (an older build wrote it back) is corrected', async () => {
    const local = payload({ folders: [createUncategorizedFolderRecord()] }, { deletedFolderAt: { f1: T0 } });
    const remote = payload({ folders: [createUncategorizedFolderRecord(), folder('f1')] }, { deletedFolderAt: { f1: T0 } });
    const merged = mergeSyncData(local, remote);
    assert.equal(merged.folders.some(f => f.id === 'f1'), false);
    assert.equal(merged.hasLocalChanges, true);
});

test('the deletion arriving from the other device removes the folder here', async () => {
    const local = payload({ folders: [createUncategorizedFolderRecord(), folder('f1')] });
    const remote = payload({ folders: [createUncategorizedFolderRecord()] }, { deletedFolderAt: { f1: T0 } });
    const merged = mergeSyncData(local, remote);
    assert.equal(merged.folders.some(f => f.id === 'f1'), false);
});

test('a source moved OUT after the deletion does not hold the folder: the newest copy decides', async () => {
    const local = payload({
        folders: [createUncategorizedFolderRecord()],
        sources: [source('s1', { folderId: null, updatedAt: T0 - MIN })]
    }, { deletedFolderAt: { f1: T0 } });
    const remote = payload({
        folders: [createUncategorizedFolderRecord(), folder('f1')],
        sources: [source('s1', { folderId: 'f1', updatedAt: T0 - 30 * MIN })]
    });
    const merged = mergeSyncData(local, remote);
    assert.equal(merged.folders.some(f => f.id === 'f1'), false);
});

test('a folder written after its deletion survives it', async () => {
    const local = payload({ folders: [createUncategorizedFolderRecord()] }, { deletedFolderAt: { f1: T0 } });
    const remote = payload({ folders: [createUncategorizedFolderRecord(), folder('f1', { updatedAt: T0 + MIN })] });
    assert.ok(mergeSyncData(local, remote).folders.some(f => f.id === 'f1'));
});

test('a legacy undated deletion still wins outright', async () => {
    const local = payload({ folders: [createUncategorizedFolderRecord()] }, { deletedFolderIds: ['f1'] });
    const remote = payload({
        folders: [createUncategorizedFolderRecord(), folder('f1', { updatedAt: T0 + MIN })],
        sources: [source('s1', { folderId: 'f1' })]
    });
    assert.equal(mergeSyncData(local, remote).folders.some(f => f.id === 'f1'), false);
});

test('deletions merge as the latest per folder, in a stable order', async () => {
    assert.deepEqual(
        tomb.mergeFolderDeletions({ b: 5, a: 1 }, { a: 3, c: 2 }, { b: 4, bad: 'x', z: -1 }),
        { a: 3, b: 5, c: 2 }
    );
    assert.equal(JSON.stringify(tomb.mergeFolderDeletions({ b: 1, a: 1 })),
        JSON.stringify(tomb.mergeFolderDeletions({ a: 1, b: 1 })));
});

test('deleting by hand writes a dated deletion too', async () => {
    trackDeletedFolder('f9', T0);
    trackDeletedFolder('f9', T0 - MIN); // an older deletion does not move it back
    assert.deepEqual(AppState.deletedFolderAt, { f9: T0 });
    assert.deepEqual(AppState.deletedFolderIds, []);
});

test('a hint folder removed while empty comes back under the same id and outlives the deletion', async () => {
    // Real clock here: applyFolderHint stamps the new folder with Date.now().
    const deletedAt = Date.now() - MIN;
    trackDeletedFolder(hint.hintFolderBaseId('Networks'), deletedAt);
    const { folderId } = hint.applyFolderHint('Networks');
    assert.equal(folderId, hint.hintFolderBaseId('Networks'));

    const local = payload({ folders: JSON.parse(JSON.stringify(AppState.folders)) }, { deletedFolderAt: { ...AppState.deletedFolderAt } });
    const remote = payload({ folders: [createUncategorizedFolderRecord()] }, { deletedFolderAt: { [folderId]: deletedAt } });
    assert.ok(mergeSyncData(local, remote).folders.some(f => f.id === folderId));
});
