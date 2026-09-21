import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/* A data set written in the Obsidian vault reaches the app by sync, not by an
   import: the plugin carries the file (with its own id and its
   `exam_metadata.folder`) to the Gist, and the app pulls it. Two things broke on
   that road, and both looked like "the folder I named never shows up":

   1. The folder hint was only read by processJSON, which a synced set never
      passes through - it always landed in "Uncategorized".
   2. The set names its own id, and a deleted id stayed in `deletedSourceIds`
      forever: import the file again and the next sync dropped it without a word.

   Plus the id rule the user asked for: a folder made from a hint takes a short
   slug + a hash of the name, keeps that id for good (renaming changes nothing),
   and a hint finds its folder by name first and by that id second. */

let AppState, initState, createUncategorizedFolderRecord, UNCATEGORIZED_FOLDER_ID, reviveSource, trackDeletedSource,
    clearLocalStudyData, clearSourcesData, touch;
let processJSON, sync, hint, tomb;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
    delete global.requestAnimationFrame;

    ({ AppState, initState, createUncategorizedFolderRecord, UNCATEGORIZED_FOLDER_ID, reviveSource,
        trackDeletedSource, clearLocalStudyData, clearSourcesData, touch } = await import('../src/core/state.js'));
    ({ processJSON } = await import('../src/features/sources/sources-service.js'));
    sync = await import('../src/core/github-sync.js');
    hint = await import('../src/features/sources/folder-hint.js');
    tomb = await import('../src/core/source-tombstones.js');
});

function freshDevice({ hints = true } = {}) {
    sync._resetSyncQueue();
    localStorage.clear();
    initState({ force: true });
    AppState.sources.length = 0;
    AppState.folders = [createUncategorizedFolderRecord()];
    AppState.deletedSourceIds = [];
    AppState.deletedSourceAt = {};
    AppState.revivedSourceAt = {};
    AppState.deletedFolderIds = [];
    AppState.deletedFolderAt = {};
    AppState.deletedQuickPresetIds = [];
    AppState.githubToken = null;
    AppState.githubGistId = null;
    AppState.lastResetTimestamp = 0;
    AppState.lastProgressResetTimestamp = 0;
    AppState.folderHintsEnabled = hints;
}

beforeEach(() => freshDevice());

const userFolders = () => AppState.folders.filter(f => f.id !== UNCATEGORIZED_FOLDER_ID);
const question = { id: 'q1', type: 'single_choice', content: { text: 'Q?' },
    options: [{ id: 1, text: 'A' }, { id: 2, text: 'B' }], answer: { correct_ids: [1] } };

/** A set as the Obsidian plugin puts it on the Gist: root id, envelope kept. */
function syncedSet({ id = 'itil4fnd_wayground_01', folder = 'ITIL 4 Foundation', ...rest } = {}) {
    const meta = { title: `Set ${id}`, id };
    if (folder != null) meta.folder = folder;
    return { id, name: `Set ${id}`, keepOrder: true, exam_metadata: meta, questions: [question], ...rest };
}

/** The same set as a file imported by hand. */
function file({ id = 'itil4fnd_wayground_01', folder = 'ITIL 4 Foundation' } = {}) {
    const meta = { title: `Set ${id}`, id };
    if (folder !== undefined) meta.folder = folder;
    return { exam_metadata: meta, questions: [question] };
}

function payload(extra = {}) {
    return {
        sources: [], folders: [createUncategorizedFolderRecord()], quickPresets: [],
        deletedSourceIds: [], deletedFolderIds: [], deletedQuickPresetIds: [],
        stats: {}, recentTests: [], studyActivity: {}, continuityConfig: {},
        lastResetTimestamp: 0, lastProgressResetTimestamp: 0, lastUpdated: 0,
        ...extra
    };
}

const clone = (x) => JSON.parse(JSON.stringify(x));

// ── The folder id ───────────────────────────────────────────────────────────

test('a hint folder id is a short slug plus a hash of the whole name', () => {
    const id = hint.hintFolderBaseId('ITIL 4 Foundation');
    assert.match(id, /^folder_hint_itil_4_foundation_[0-9a-f]{8}$/);
    // Spelling that the name key ignores gives the same id on every device.
    assert.equal(hint.hintFolderBaseId('  itil-4   FOUNDATION '), id);
    assert.equal(hint.hintFolderBaseId('İTİL 4 Foundation'), id);
    // The slug part stays short however long the name.
    const long = hint.hintFolderBaseId('A'.repeat(200));
    assert.ok(long.length <= 'folder_hint_'.length + 30 + 9, long);
});

test('two long names that share their first 60 characters get different ids', () => {
    const prefix = 'Zertifikat IT Service Management Grundlagen und Praxis Teil ';
    const a = hint.hintFolderBaseId(`${prefix}Eins`);
    const b = hint.hintFolderBaseId(`${prefix}Zwei`);
    assert.notEqual(a, b);
});

test('a renamed hint folder keeps its id, and the original hint still finds it', () => {
    const first = processJSON(file({ id: 'a1' }), 'a.json', { silent: true });
    const folder = AppState.folders.find(f => f.id === first.folderId);
    const idBefore = folder.id;

    folder.name = 'ITIL';           // the user renames it
    touch(folder);

    const second = processJSON(file({ id: 'a2' }), 'b.json', { silent: true });
    assert.equal(folder.id, idBefore, 'renaming never changes the id');
    assert.equal(second.folderId, idBefore, 'found by the id its hint derives');
    assert.equal(userFolders().length, 1, 'no second folder');
});

test('a folder made by the first build of this feature is still found after a rename', () => {
    AppState.folders.push({ id: 'folder_hint_itil_4_foundation', name: 'ITIL', color: '#0667ff', order: 1 });
    const s = processJSON(file(), 'a.json', { silent: true });
    assert.equal(s.folderId, 'folder_hint_itil_4_foundation');
    assert.equal(userFolders().length, 1);
});

test('a name match wins over an id match', () => {
    // The hint's own folder was renamed away; a folder by that name exists too.
    AppState.folders.push({ id: hint.hintFolderBaseId('ITIL 4 Foundation'), name: 'Old ITIL', color: '#0667ff', order: 1 });
    AppState.folders.push({ id: 'folder_manual', name: 'itil 4 foundation', color: '#0667ff', order: 2 });
    const s = processJSON(file(), 'a.json', { silent: true });
    assert.equal(s.folderId, 'folder_manual');
});

test('an archived folder is not a match by id either', () => {
    const base = hint.hintFolderBaseId('ITIL 4 Foundation');
    AppState.folders.push({ id: base, name: 'ITIL', color: '#0667ff', order: 1, archived: true });
    const s = processJSON(file(), 'a.json', { silent: true });
    assert.equal(s.folderId, `${base}_2`);
    assert.equal(s.archived, undefined, 'the set did not arrive archived');
});

// ── A set that arrives by sync ──────────────────────────────────────────────

test('a synced set with a hint is placed in (a new) folder of that name', () => {
    AppState.sources.push(syncedSet());
    const placed = hint.applyPendingFolderHints();
    const s = AppState.sources[0];
    const folder = AppState.folders.find(f => f.id === s.folderId);
    assert.equal(placed, 1);
    assert.equal(folder.name, 'ITIL 4 Foundation');
    assert.equal(folder.id, hint.hintFolderBaseId('ITIL 4 Foundation'));
    assert.equal(s.folderHintSpent, 'itil 4 foundation');
    assert.ok(s.updatedAt > 0, 'stamped, so the placement travels');
});

test('a synced set goes into the existing folder of that name', () => {
    AppState.folders.push({ id: 'folder_mine', name: 'ITIL 4 – Foundation', color: '#0667ff', order: 1 });
    AppState.sources.push(syncedSet());
    hint.applyPendingFolderHints();
    assert.equal(AppState.sources[0].folderId, 'folder_mine');
    assert.equal(userFolders().length, 1);
});

test('a set the plugin unwrapped carries the hint in metadata, and that counts too', () => {
    const s = syncedSet();
    s.metadata = { ...s.exam_metadata };
    delete s.exam_metadata;
    AppState.sources.push(s);
    hint.applyPendingFolderHints();
    assert.equal(AppState.folders.find(f => f.id === s.folderId)?.name, 'ITIL 4 Foundation');
});

test('a set without a hint stays in Uncategorized and nothing is created', () => {
    AppState.sources.push(syncedSet({ folder: null }));
    assert.equal(hint.applyPendingFolderHints(), 0);
    assert.equal(AppState.sources[0].folderId, undefined);
    assert.equal(userFolders().length, 0);
});

test('the hint is spent once: a set the user moves back to Uncategorized stays there', () => {
    AppState.sources.push(syncedSet());
    hint.applyPendingFolderHints();
    const s = AppState.sources[0];
    s.folderId = null;                   // moved by hand
    touch(s);
    hint.applyPendingFolderHints();
    assert.equal(s.folderId, null);
});

test('a set already in a folder is only marked, and a later move out of it sticks', () => {
    AppState.folders.push({ id: 'folder_elsewhere', name: 'Elsewhere', color: '#0667ff', order: 1 });
    AppState.sources.push(syncedSet({ folderId: 'folder_elsewhere' }));
    const s = AppState.sources[0];
    assert.equal(hint.applyPendingFolderHints(), 0);
    assert.equal(s.folderId, 'folder_elsewhere');
    assert.equal(userFolders().length, 1, 'no folder created for a set that has one');

    s.folderId = null;
    hint.applyPendingFolderHints();
    assert.equal(s.folderId, null);
});

test('a folderId that names no folder is no folder: the hint places the set', () => {
    AppState.sources.push(syncedSet({ folderId: 'folder_gone' }));
    hint.applyPendingFolderHints();
    assert.equal(AppState.folders.find(f => f.id === AppState.sources[0].folderId)?.name, 'ITIL 4 Foundation');
});

test('with the switch off nothing is placed or marked; switching on places it', () => {
    freshDevice({ hints: false });
    AppState.sources.push(syncedSet());
    assert.equal(hint.applyPendingFolderHints(), 0);
    assert.equal(AppState.sources[0].folderHintSpent, undefined);

    AppState.folderHintsEnabled = true;
    assert.equal(hint.applyPendingFolderHints(), 1);
});

test('archived sets are left alone', () => {
    AppState.sources.push(syncedSet({ archived: true }));
    assert.equal(hint.applyPendingFolderHints(), 0);
    assert.equal(userFolders().length, 0);
});

test('a hint edited in the file is followed again if the set has no folder', () => {
    AppState.sources.push(syncedSet());
    hint.applyPendingFolderHints();
    const s = AppState.sources[0];
    s.folderId = null;
    s.exam_metadata.folder = 'ITIL Practice';
    hint.applyPendingFolderHints();
    assert.equal(AppState.folders.find(f => f.id === s.folderId)?.name, 'ITIL Practice');
});

test('two devices placing the same synced set end up with one folder', () => {
    AppState.sources.push(syncedSet());
    hint.applyPendingFolderHints();
    const a = clone({ sources: AppState.sources, folders: AppState.folders });

    freshDevice();
    AppState.sources.push(syncedSet({ id: 'other' }));
    hint.applyPendingFolderHints();
    const b = clone({ sources: AppState.sources, folders: AppState.folders });

    const merged = sync.mergeSyncData(payload(a), payload(b));
    const itil = merged.folders.filter(f => f.name === 'ITIL 4 Foundation');
    assert.equal(itil.length, 1);
    merged.sources.forEach(s => assert.equal(s.folderId, itil[0].id));
});

// ── Deleted, then brought back ──────────────────────────────────────────────

test('the tombstone rule: the later of deletion and revival wins; undated counts as 0', () => {
    const { isSourceDeleted } = tomb;
    assert.equal(isSourceDeleted('x', ['x']), true);
    assert.equal(isSourceDeleted('x', ['x'], {}, { x: 5 }), false, 'a revival outlives an undated deletion');
    assert.equal(isSourceDeleted('x', ['x'], { x: 10 }, { x: 5 }), true, 'a newer deletion wins');
    assert.equal(isSourceDeleted('x', [], { x: 10 }, {}), true, 'a dated deletion counts off the list too');
    assert.equal(isSourceDeleted('x', ['y']), false);
});

test('importing a deleted set again brings it back, and the next sync keeps it', () => {
    trackDeletedSource('itil4fnd_wayground_01');
    const remote = payload({ deletedSourceIds: ['itil4fnd_wayground_01'] }); // the Gist still says deleted

    const s = processJSON(file(), 'itil.json', { silent: true });
    assert.ok(!AppState.deletedSourceIds.includes(s.id));
    assert.ok(AppState.revivedSourceAt[s.id] > AppState.deletedSourceAt[s.id]);

    const merged = sync.mergeSyncData(sync.getSyncPayload(), remote);
    assert.ok(merged.sources.some(x => x.id === s.id), 'the set survives the merge');
    assert.ok(!merged.deletedSourceIds.includes(s.id), 'and leaves the list the Gist and the plugin read');
    assert.ok(merged.hasLocalChanges, 'the Gist still lists it: push');
    assert.equal(AppState.folders.find(f => f.id === s.folderId)?.name, 'ITIL 4 Foundation');
});

test('another device that still holds the tombstone takes the set back', () => {
    // Device A re-imports.
    trackDeletedSource('itil4fnd_wayground_01', 1000);
    processJSON(file(), 'itil.json', { silent: true });
    const fromA = clone(sync.mergeSyncData(sync.getSyncPayload(), payload()));

    // Device B deleted it long ago and has not heard since.
    freshDevice();
    trackDeletedSource('itil4fnd_wayground_01', 1000);
    const merged = sync.mergeSyncData(sync.getSyncPayload(), payload(fromA));
    assert.ok(merged.sources.some(x => x.id === 'itil4fnd_wayground_01'));
    assert.ok(!merged.deletedSourceIds.includes('itil4fnd_wayground_01'));
});

test('an older build re-adding the id to the undated list does not undo the revival', () => {
    processJSON(file(), 'itil.json', { silent: true });
    reviveSource('itil4fnd_wayground_01'); // no-op: not deleted
    trackDeletedSource('itil4fnd_wayground_01', 1000);
    reviveSource('itil4fnd_wayground_01', 2000);

    // What an old build pushes: the id back in the list, no dates at all.
    const oldBuild = payload({ deletedSourceIds: ['itil4fnd_wayground_01'] });
    const merged = sync.mergeSyncData(sync.getSyncPayload(), oldBuild);
    assert.ok(merged.sources.some(x => x.id === 'itil4fnd_wayground_01'));
});

test('deleting it again after the revival wins on every device', () => {
    trackDeletedSource('itil4fnd_wayground_01', 1000);
    reviveSource('itil4fnd_wayground_01', 2000);
    const revivedHere = clone(sync.getSyncPayload());

    freshDevice();
    trackDeletedSource('itil4fnd_wayground_01', 3000); // deleted later on another device
    const merged = sync.mergeSyncData(sync.getSyncPayload(), payload({
        deletedSourceIds: revivedHere.deletedSourceIds,
        deletedSourceAt: revivedHere.deletedSourceAt,
        revivedSourceAt: revivedHere.revivedSourceAt,
        sources: [syncedSet()]
    }));
    assert.ok(merged.deletedSourceIds.includes('itil4fnd_wayground_01'));
    assert.ok(!merged.sources.some(x => x.id === 'itil4fnd_wayground_01'));
});

test('a reset after the revival deletes the set again', () => {
    processJSON(file(), 'itil.json', { silent: true });
    AppState.revivedSourceAt = { itil4fnd_wayground_01: Date.now() - 1000 };
    clearLocalStudyData();
    assert.ok(tomb.isSourceDeleted('itil4fnd_wayground_01', AppState.deletedSourceIds,
        AppState.deletedSourceAt, AppState.revivedSourceAt), 'the reset is dated after the revival');
});

test('a remote that still lists a revived id is told, even when nothing else differs', () => {
    AppState.sources.push(syncedSet());
    trackDeletedSource('itil4fnd_wayground_01', 1000);
    reviveSource('itil4fnd_wayground_01', 2000);
    const same = clone(sync.getSyncPayload());
    assert.equal(sync.mergeSyncData(sync.getSyncPayload(), same).hasLocalChanges, false, 'baseline: in step');

    // The Gist as an older build (or the plugin) leaves it: id listed, no dates.
    const stale = { ...clone(same), deletedSourceIds: ['itil4fnd_wayground_01'] };
    delete stale.deletedSourceAt;
    delete stale.revivedSourceAt;
    assert.equal(sync.mergeSyncData(sync.getSyncPayload(), stale).hasLocalChanges, true);
});

test('a sources reset after the revival deletes the set again', () => {
    processJSON(file(), 'itil.json', { silent: true });
    AppState.revivedSourceAt = { itil4fnd_wayground_01: Date.now() - 1000 };
    clearSourcesData();
    assert.ok(tomb.isSourceDeleted('itil4fnd_wayground_01', AppState.deletedSourceIds,
        AppState.deletedSourceAt, AppState.revivedSourceAt));
});

test('the payload carries both dates', () => {
    trackDeletedSource('x', 1000);
    reviveSource('x', 2000);
    const p = sync.getSyncPayload();
    assert.deepEqual(p.deletedSourceAt, { x: 1000 });
    assert.deepEqual(p.revivedSourceAt, { x: 2000 });
});

// ── End to end, through the real pull ───────────────────────────────────────

/** A Gist that answers GETs with `remote` and records PATCHes. */
function fakeGist(remote) {
    const patches = [];
    global.fetch = async (url, init = {}) => {
        if (init.method === 'PATCH') {
            patches.push(JSON.parse(init.body));
            return { ok: true, status: 200, json: async () => ({}) };
        }
        const { sources, ...backup } = remote;
        return {
            ok: true, status: 200,
            json: async () => ({ files: {
                'exam_app_backup.json': { content: JSON.stringify({ ...backup, sourcesFile: 'exam_app_sources.json' }) },
                'exam_app_sources.json': { content: JSON.stringify({ lastUpdated: remote.lastUpdated || 1, sources }) }
            } })
        };
    };
    return patches;
}

async function until(check, ms = 2000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (check()) return true;
        await new Promise(r => setTimeout(r, 10));
    }
    return false;
}

function connect() {
    AppState.githubToken = 'test-token';
    AppState.githubGistId = 'test-gist';
}

test('pull: a set synced from the vault lands in the folder its file names', async () => {
    fakeGist(payload({ sources: [syncedSet()], lastUpdated: 5 }));
    connect();
    await sync.syncFromGist({ silent: true });

    const placed = await until(() => AppState.sources[0]?.folderId);
    assert.ok(placed, 'the pull placed the set');
    const folder = AppState.folders.find(f => f.id === AppState.sources[0].folderId);
    assert.equal(folder.name, 'ITIL 4 Foundation');
    sync._resetSyncQueue();
});

test('pull: a set imported again survives a Gist that still lists it as deleted', async () => {
    trackDeletedSource('itil4fnd_wayground_01', 1000);
    processJSON(file(), 'itil.json', { silent: true });
    sync._resetSyncQueue();

    const patches = fakeGist(payload({ deletedSourceIds: ['itil4fnd_wayground_01'], lastUpdated: 5 }));
    connect();
    await sync.syncFromGist({ silent: true });

    assert.ok(AppState.sources.some(s => s.id === 'itil4fnd_wayground_01'), 'still in the library');
    assert.ok(!AppState.deletedSourceIds.includes('itil4fnd_wayground_01'));
    const wrote = await until(() => patches.some(p => p.files?.['exam_app_backup.json']));
    assert.ok(wrote, 'the cleared tombstone is pushed');
    const backup = JSON.parse(patches.find(p => p.files?.['exam_app_backup.json']).files['exam_app_backup.json'].content);
    assert.ok(!backup.deletedSourceIds.includes('itil4fnd_wayground_01'));
    assert.ok(backup.revivedSourceAt.itil4fnd_wayground_01 > 0);
    sync._resetSyncQueue();
});

test('replace-local pull: a synced set is placed too', async () => {
    fakeGist(payload({ sources: [syncedSet()], lastUpdated: 5 }));
    connect();
    await sync._pullRemoteGistOnly();

    const placed = await until(() => AppState.sources[0]?.folderId);
    assert.ok(placed, 'the pull placed the set');
    assert.equal(AppState.folders.find(f => f.id === AppState.sources[0].folderId)?.name, 'ITIL 4 Foundation');
    sync._resetSyncQueue();
});
