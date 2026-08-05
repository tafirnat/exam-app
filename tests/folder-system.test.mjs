import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let AppState, UNCATEGORIZED_FOLDER_ID, createUncategorizedFolderRecord, archiveFolder;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    const stateModule = await import('../src/core/state.js');
    AppState = stateModule.AppState;
    UNCATEGORIZED_FOLDER_ID = stateModule.UNCATEGORIZED_FOLDER_ID;
    createUncategorizedFolderRecord = stateModule.createUncategorizedFolderRecord;
    /* Importing no longer loads the user's data - boot does, explicitly. These
       cases are about what that load produces, so they have to ask for it. */
    stateModule.initState();

    const archiveModule = await import('../src/features/sources/archive.js');
    archiveFolder = archiveModule.archiveFolder;
});

test('UNCATEGORIZED_FOLDER_ID is set to uncategorized-folder', () => {
    assert.equal(UNCATEGORIZED_FOLDER_ID, 'uncategorized-folder');
});

test('createUncategorizedFolderRecord returns system folder with gray color #8a99ad', () => {
    const folder = createUncategorizedFolderRecord();
    assert.equal(folder.id, 'uncategorized-folder');
    assert.equal(folder.color, '#8a99ad');
    assert.equal(folder.isSystem, true);
    assert.equal(folder.name, 'Uncategorized');
});

test('AppState initializes with uncategorized-folder present', () => {
    const systemFolder = AppState.folders.find(f => f.id === UNCATEGORIZED_FOLDER_ID);
    assert.ok(systemFolder);
    assert.equal(systemFolder.color, '#8a99ad');
    assert.equal(systemFolder.isSystem, true);
});

test('archiveFolder refuses to archive uncategorized-folder', async () => {
    const result = await archiveFolder('uncategorized-folder');
    assert.equal(result, false);
    const systemFolder = AppState.folders.find(f => f.id === 'uncategorized-folder');
    assert.equal(systemFolder.archived, undefined);
});
