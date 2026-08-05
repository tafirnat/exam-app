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

test('reconcileSourceFolder clears folderId if folder does not exist in system', async () => {
    const { reconcileSourceFolder } = await import('../src/features/sources/sources-service.js');
    const source = { id: 'test-src-1', name: 'Test Source', folderId: 'non-existent-folder-id' };

    reconcileSourceFolder(source, { notify: false });

    assert.equal(source.folderId, null);
});

test('reconcileSourceFolder archives source if folder is archived', async () => {
    const { reconcileSourceFolder } = await import('../src/features/sources/sources-service.js');

    // Add an archived folder to AppState
    AppState.folders.push({
        id: 'archived-folder-123',
        name: 'Arşivlenmiş Klasör',
        color: '#ff0000',
        archived: true
    });

    const source = {
        id: 'test-src-2',
        name: 'Test Source 2',
        folderId: 'archived-folder-123',
        questions: [{ id: 'q1', type: 'choice', text: 'Q1' }]
    };

    reconcileSourceFolder(source, { notify: false });

    assert.equal(source.folderId, null);
    assert.equal(source.archived, true);
    assert.equal(source.archivedFrom.folderId, 'archived-folder-123');
    assert.equal(source.archivedFrom.name, 'Arşivlenmiş Klasör');
});

test('processJSON clears missing folderId or archives source if folder is archived', async () => {
    const { processJSON } = await import('../src/features/sources/sources-service.js');

    const sampleJSON = {
        folderId: 'ghost-folder-id',
        questions: [{ id: 'q1', type: 'single_choice', text: 'Q1', options: [{ id: 'o1', text: 'Opt 1' }], answer: { optionId: 'o1' } }]
    };

    const importedSource = processJSON(sampleJSON, 'Imported Sample', { silent: true });
    assert.ok(importedSource);
    assert.equal(importedSource.folderId, null);
});
