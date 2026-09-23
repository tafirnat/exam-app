import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/* `exam_metadata.folder` names the folder a data set would like to live in -
   by NAME, because the file is written before any folder id exists. It is
   spent at import and never read again, so a set the user moves stays moved.
   A folder made from a hint takes an id derived from the name, which is what
   keeps two devices that import before syncing from ending up with two
   folders of one name: they write the same record and the merge collapses it. */

let AppState, initState, SYNCED_SETTINGS, UNCATEGORIZED_FOLDER_ID, createUncategorizedFolderRecord, touch;
let processJSON, reconcileSourceFolder, mergeSyncData, getCleanSourceData;
let hint;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    ({ AppState, initState, SYNCED_SETTINGS, UNCATEGORIZED_FOLDER_ID, createUncategorizedFolderRecord, touch }
        = await import('../src/core/state.js'));
    ({ processJSON, reconcileSourceFolder } = await import('../src/features/sources/sources-service.js'));
    ({ mergeSyncData } = await import('../src/core/github-sync.js'));
    ({ getCleanSourceData } = await import('../src/features/sources/sources-ui.js'));
    hint = await import('../src/features/sources/folder-hint.js');
});

/** A fresh, empty library on "a device". */
async function freshDevice() {
    localStorage.clear();
    await initState({ force: true });
    AppState.sources.length = 0;
    AppState.folders = [createUncategorizedFolderRecord()];
    AppState.deletedSourceIds = [];
    AppState.deletedFolderIds = [];
    AppState.deletedQuickPresetIds = [];
}

beforeEach(async () => await freshDevice());

let seq = 0;
function dataSet({ title = `Set ${++seq}`, folder, folderId, id } = {}) {
    const meta = { title };
    if (folder !== undefined) meta.folder = folder;
    if (folderId !== undefined) meta.folderId = folderId;
    if (id !== undefined) meta.id = id;
    return {
        exam_metadata: meta,
        questions: [{ id: 'q1', type: 'single_choice', content: { text: 'Q?' },
            options: [{ id: 1, text: 'A' }, { id: 2, text: 'B' }], answer: { correct_ids: [1] } }]
    };
}

const importSet = (opts) => processJSON(dataSet(opts), 'file.json', { silent: true });
const userFolders = () => AppState.folders.filter(f => f.id !== UNCATEGORIZED_FOLDER_ID);

function snapshot() {
    return JSON.parse(JSON.stringify({ sources: AppState.sources, folders: AppState.folders }));
}

function payload({ sources, folders }, extra = {}) {
    return {
        sources, folders, quickPresets: [],
        deletedSourceIds: [], deletedFolderIds: [], deletedQuickPresetIds: [],
        stats: {}, recentTests: [], studyActivity: {}, continuityConfig: {},
        lastResetTimestamp: 0, lastProgressResetTimestamp: 0, lastUpdated: 0,
        ...extra
    };
}

// ── Placement ───────────────────────────────────────────────────────────────

test('a hint with no matching folder creates one and places the set in it', async () => {
    const source = importSet({ folder: 'ITIL 4 Foundation' });

    const folders = userFolders();
    assert.equal(folders.length, 1);
    assert.equal(folders[0].name, 'ITIL 4 Foundation');
    // Short slug for the eye, hash of the whole normalised name for uniqueness.
    assert.match(folders[0].id, /^folder_hint_itil_4_foundation_[0-9a-f]{8}$/);
    assert.equal(folders[0].id, hint.hintFolderBaseId('itil-4 FOUNDATION'));
    assert.equal(source.folderId, folders[0].id);
});

test('an existing folder with a similar name is reused, not duplicated', async () => {
    AppState.folders.push({ id: 'folder_123', name: 'İTİL 4 – Foundation', color: '#0667ff', order: 1 });

    const source = importSet({ folder: '  itil 4 foundation ' });

    assert.equal(userFolders().length, 1, 'no second folder');
    assert.equal(source.folderId, 'folder_123');
});

test('a set without a hint behaves exactly as before', async () => {
    const before = JSON.stringify(AppState.folders);
    const source = importSet({});
    assert.equal(JSON.stringify(AppState.folders), before, 'folders untouched');
    assert.equal(source.folderId, null);
});

test('there is no switch: a hint is followed on every import', async () => {
    // The setting is gone, and nothing left behind by an older build can
    // silence a hint - the file says where the set belongs.
    assert.equal('folderHintsEnabled' in AppState, false);
    assert.ok(!SYNCED_SETTINGS.includes('folderHintsEnabled'));
    localStorage.setItem('focus_app_folder_hints_enabled', 'false');
    await initState({ force: true });
    const source = importSet({ folder: 'Networks' });
    assert.equal(AppState.folders.find(f => f.id === source.folderId)?.name, 'Networks');
});

test('the add-source panel carries no folder-hint switch', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.equal(html.includes('folderHintsToggle'), false);
});

test('an explicit folderId that resolves wins over the hint', async () => {
    AppState.folders.push({ id: 'folder_mine', name: 'Mine', color: '#0667ff', order: 1 });
    const source = importSet({ folder: 'Something else', folderId: 'folder_mine' });
    assert.equal(source.folderId, 'folder_mine');
    assert.equal(userFolders().length, 1, 'the hint did not create a folder');
});

test('an archived folder of that name is not reused', async () => {
    AppState.folders.push({ id: 'folder_old', name: 'ITIL 4 Foundation', color: '#0667ff', order: 1, archived: true });
    const source = importSet({ folder: 'ITIL 4 Foundation' });
    assert.notEqual(source.folderId, 'folder_old');
    assert.equal(source.archived, undefined, 'the new set did not arrive archived');
    assert.equal(AppState.folders.find(f => f.id === source.folderId).archived, undefined);
});

test('the hint is spent at import: it is not kept on the source', async () => {
    const source = importSet({ folder: 'ITIL 4 Foundation' });
    assert.equal('folder' in source.metadata, false);
});

// ── Colour ──────────────────────────────────────────────────────────────────

test('the new folder takes the least-used palette colour, never the default', async () => {
    // Every colour used once except one.
    const free = hint.FOLDER_COLORS[7];
    hint.FOLDER_COLORS.filter(c => c !== free).forEach((color, i) => {
        AppState.folders.push({ id: `f${i}`, name: `F${i}`, color, order: i + 1 });
    });
    importSet({ folder: 'New Topic' });
    const created = AppState.folders.find(f => f.name === 'New Topic');
    assert.equal(created.color, free);
});

test('colour ties break by name, so two devices pick the same one', async () => {
    const a = hint.pickFolderColor('ITIL 4 Foundation', []);
    const b = hint.pickFolderColor('itil 4 foundation', []);
    assert.equal(a, b);
    assert.ok(hint.FOLDER_COLORS.includes(a));
    assert.notEqual(a, '#8a99ad');
});

// ── Sync ────────────────────────────────────────────────────────────────────

test('two devices importing the same hint before syncing end up with one folder', async () => {
    importSet({ title: 'Set A', folder: 'ITIL 4 Foundation' });
    const deviceA = snapshot();

    freshDevice();
    importSet({ title: 'Set B', folder: 'itil 4 foundation' });
    const deviceB = snapshot();

    for (const [local, remote] of [[deviceA, deviceB], [deviceB, deviceA]]) {
        const merged = mergeSyncData(payload(local), payload(remote));
        const itil = merged.folders.filter(f => hint.folderNameKey(f.name) === 'itil 4 foundation');
        assert.equal(itil.length, 1, 'one folder, whichever side merges');
        const sets = merged.sources.filter(s => s.name === 'Set A' || s.name === 'Set B');
        assert.equal(sets.length, 2);
        sets.forEach(s => assert.equal(s.folderId, itil[0].id));
    }
});

test('a set the user moved is not pulled back by later syncs', async () => {
    const source = importSet({ folder: 'ITIL 4 Foundation' });
    const synced = snapshot(); // what the other device / Gist holds

    await new Promise(r => setTimeout(r, 2));
    AppState.folders.push(touch({ id: 'folder_elsewhere', name: 'Elsewhere', color: '#0667ff', order: 5 }));
    source.folderId = 'folder_elsewhere';
    touch(source);

    const merged = mergeSyncData(payload(snapshot()), payload(synced));
    const after = merged.sources.find(s => s.id === source.id);
    assert.equal(after.folderId, 'folder_elsewhere');

    // The apply path reconciles every source; nothing there reaches for a hint.
    reconcileSourceFolder(after, { notify: false });
    AppState.folders = merged.folders;
    reconcileSourceFolder(after, { notify: false });
    assert.equal(after.folderId, 'folder_elsewhere');
});

test('a deleted hint folder is not resurrected under its old id', async () => {
    const base = hint.hintFolderBaseId('ITIL 4 Foundation');
    AppState.deletedFolderIds = [base];
    const source = importSet({ folder: 'ITIL 4 Foundation' });
    assert.equal(source.folderId, `${base}_2`);
    // And that choice is still the same on a second device holding the same tombstones.
    assert.equal(hint.freeHintFolderId('itil 4 foundation', [], [base]), `${base}_2`);
});

test('a share carries no folder name unless asked, and then the current one', async () => {
    const source = importSet({ folder: 'ITIL 4 Foundation' });
    source.metadata.folder = 'Stale name'; // e.g. written by an older build

    assert.equal('folder' in getCleanSourceData(source).exam_metadata, false);
    assert.equal(getCleanSourceData(source, { includeFolder: true }).exam_metadata.folder, 'ITIL 4 Foundation');

    AppState.folders.push({ id: 'folder_x', name: 'Moved Here', color: '#0667ff', order: 9 });
    source.folderId = 'folder_x';
    assert.equal(getCleanSourceData(source, { includeFolder: true }).exam_metadata.folder, 'Moved Here');

    source.folderId = null;
    assert.equal('folder' in getCleanSourceData(source, { includeFolder: true }).exam_metadata, false,
        'the default folder is not a folder name');
});

test('a shared set with its folder lands in a same-named folder on the other side', async () => {
    const source = importSet({ folder: 'ITIL 4 Foundation' });
    const file = JSON.parse(JSON.stringify(getCleanSourceData(source, { includeFolder: true })));
    delete file.exam_metadata.id;

    freshDevice();
    const received = processJSON(file, 'shared.json', { silent: true });
    const folder = AppState.folders.find(f => f.id === received.folderId);
    assert.equal(folder.name, 'ITIL 4 Foundation');
});

// ── What the user is told ───────────────────────────────────────────────────
// A hint that was ignored looked exactly like a file without one. The success
// message now says which of the three things happened.

function importLoud(opts) {
    document.body.innerHTML = `<div id="customModalOverlay"><div id="modalHeader"><h3 id="modalTitle"></h3></div>
        <div id="modalMessage"></div><div id="modalFooter"><button id="modalCancelBtn"></button>
        <button id="modalConfirmBtn"></button></div></div><div id="toast"></div>`;
    processJSON(dataSet(opts), 'file.json');
    return document.getElementById('modalMessage').innerHTML;
}

test('the success message names the folder a hint created', async () => {
    const { t } = await import('../src/core/i18n.js');
    const msg = importLoud({ folder: 'ITIL 4 Foundation' });
    assert.ok(msg.includes(t('import_folder_created', { folder: 'ITIL 4 Foundation' })), msg);
});

test('the success message names the existing folder a hint reused', async () => {
    const { t } = await import('../src/core/i18n.js');
    AppState.folders.push({ id: 'folder_123', name: 'ITIL 4 Foundation', color: '#0667ff', order: 1 });
    const msg = importLoud({ folder: 'itil 4 foundation' });
    assert.ok(msg.includes(t('import_folder_used', { folder: 'ITIL 4 Foundation' })), msg);
});

test('a set without a hint gets no folder line', async () => {
    const { t } = await import('../src/core/i18n.js');
    const msg = importLoud({});
    assert.equal(msg, t('import_success_msg', { name: `Set ${seq}`, count: 1 }));
});

test('the folder name from the file is escaped in the message', async () => {
    const msg = importLoud({ folder: '<img src=x onerror=alert(1)>' });
    assert.ok(!msg.includes('<img'), msg);
    assert.ok(msg.includes('&lt;img'), msg);
});
