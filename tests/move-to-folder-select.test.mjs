import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

/* The "move to folder" picker offers destinations for one source. The
   uncategorised folder is not one of them: it is the bucket the sources list
   draws for everything holding `folderId === null`, and null is what initState
   normalises an uncategorised source to. So the picker has exactly one way to
   say "nowhere" - the synthetic `root` option - and the system folder must not
   appear beside it under the same name. */

let AppState, UNCATEGORIZED_FOLDER_ID, showSourceActions, enterSelectionMode, exitSelectionMode, getSelectionModeFolderId, selectedSourceIds, renderSourcesList;

before(async () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    const stateMod = await import('../src/core/state.js');
    AppState = stateMod.AppState;
    UNCATEGORIZED_FOLDER_ID = stateMod.UNCATEGORIZED_FOLDER_ID;

    const uiMod = await import('../src/features/sources/sources-ui.js');
    showSourceActions = uiMod.showSourceActions;
    enterSelectionMode = uiMod.enterSelectionMode;
    exitSelectionMode = uiMod.exitSelectionMode;
    getSelectionModeFolderId = uiMod.getSelectionModeFolderId;
    selectedSourceIds = uiMod.selectedSourceIds;
    renderSourcesList = uiMod.renderSourcesList;
});

const systemFolder = () => ({ id: UNCATEGORIZED_FOLDER_ID, name: 'Uncategorized', isSystem: true, order: 0 });

beforeEach(() => {
    AppState.folders = [systemFolder()];
    AppState.sources = [];
});

const optionsOf = () => {
    const select = global.document.getElementById('moveToFolderSelect');
    return select ? [...select.options].map(o => ({ value: o.value, text: o.textContent.trim(), selected: o.selected })) : null;
};

test('the uncategorised folder is not offered beside the root option', async () => {
    AppState.folders = [systemFolder(), { id: 'f1', name: 'Matematik', order: 1 }];
    const source = { id: 's1', name: 'Kaynak', folderId: null };
    AppState.sources = [source];

    showSourceActions(source);

    const values = optionsOf().map(o => o.value);
    assert.deepEqual(values, ['', 'root', 'f1']);
    assert.equal(
        values.filter(v => v === UNCATEGORIZED_FOLDER_ID).length,
        0,
        'the system folder must not be a destination of its own'
    );
});

/* Every real folder was archived or never created, so the only entry left is
   the bucket. A picker whose one destination is where the source already sits
   has nothing to offer, and the old length check ran on the unfiltered list -
   which is how the duplicate reached the screen in the first place. */
test('with no real folders the picker stays hidden', async () => {
    const source = { id: 's1', name: 'Kaynak', folderId: null };
    AppState.sources = [source];

    showSourceActions(source);

    const container = global.document.getElementById('moveToFolderContainer');
    assert.equal(container.style.display, 'none');
});

/* The control already marked a real folder as selected; an uncategorised
   source fell through and left the prompt showing, so the same state was drawn
   two different ways depending on where the source happened to live. */
test('the option matching the source is the selected one', async () => {
    AppState.folders = [systemFolder(), { id: 'f1', name: 'Matematik', order: 1 }];

    const homeless = { id: 's1', name: 'A', folderId: null };
    AppState.sources = [homeless];
    showSourceActions(homeless);
    assert.equal(optionsOf().find(o => o.selected).value, 'root');

    const filed = { id: 's2', name: 'B', folderId: 'f1' };
    AppState.sources = [filed];
    showSourceActions(filed);
    assert.equal(optionsOf().find(o => o.selected).value, 'f1');
});

/* Picking the prompt used to fall through to the bookkeeping: it renumbered
   the source and closed the dialog while moving nothing. */
test('choosing the prompt moves nothing and leaves the dialog open', async () => {
    AppState.folders = [systemFolder(), { id: 'f1', name: 'Matematik', order: 1 }];
    const source = { id: 's1', name: 'Kaynak', folderId: 'f1', order: 7 };
    AppState.sources = [source];

    showSourceActions(source);

    const select = global.document.getElementById('moveToFolderSelect');
    select.value = '';
    select.dispatchEvent(new global.window.Event('change'));

    assert.equal(source.folderId, 'f1', 'the source stays where it was');
    assert.equal(source.order, 7, 'and keeps its place in that folder');
    assert.ok(
        global.document.getElementById('sourceActionsOverlay').classList.contains('active'),
        'the dialog is still open'
    );
});

test('modalEditMetadataBtn is visible for single source and hidden for bulk sources', async () => {
    AppState.folders = [systemFolder(), { id: 'f1', name: 'Matematik', order: 1 }];
    const source1 = { id: 's1', name: 'Kaynak 1', folderId: 'f1' };
    const source2 = { id: 's2', name: 'Kaynak 2', folderId: 'f1' };
    AppState.sources = [source1, source2];

    const editBtn = global.document.getElementById('modalEditMetadataBtn');

    // Single source
    showSourceActions(source1);
    assert.equal(editBtn.style.display, '', 'edit metadata button must be visible for single source');

    // Bulk sources
    showSourceActions({ id: 'bulk', isBulk: true, targetIds: ['s1', 's2'] });
    assert.equal(editBtn.style.display, 'none', 'edit metadata button must be hidden for bulk sources');

    // Reopen single source
    showSourceActions(source2);
    assert.equal(editBtn.style.display, '', 'edit metadata button must be visible again for single source');
});

test('bulk sources select their common folder in moveToFolderSelect', async () => {
    AppState.folders = [systemFolder(), { id: 'f1', name: 'Matematik', order: 1 }, { id: 'f2', name: 'Fizik', order: 2 }];
    const s1 = { id: 's1', name: 'A', folderId: 'f1' };
    const s2 = { id: 's2', name: 'B', folderId: 'f1' };
    AppState.sources = [s1, s2];

    showSourceActions({ id: 'bulk', isBulk: true, targetIds: ['s1', 's2'], folderId: 'f1' });
    assert.equal(optionsOf().find(o => o.selected).value, 'f1', 'bulk in f1 should have f1 selected');

    // Bulk uncategorized
    const u1 = { id: 'u1', name: 'U1', folderId: null };
    const u2 = { id: 'u2', name: 'U2', folderId: null };
    AppState.sources = [u1, u2];

    showSourceActions({ id: 'bulk', isBulk: true, targetIds: ['u1', 'u2'], folderId: UNCATEGORIZED_FOLDER_ID });
    assert.equal(optionsOf().find(o => o.selected).value, 'root', 'bulk uncategorized should have root selected');
});

test('modalInspectQuestionsBtn for bulk sources does not exit selection mode', async () => {
    AppState.folders = [systemFolder(), { id: 'f1', name: 'Matematik', order: 1 }];
    const s1 = { id: 's1', name: 'A', folderId: 'f1' };
    const s2 = { id: 's2', name: 'B', folderId: 'f1' };
    AppState.sources = [s1, s2];

    enterSelectionMode('f1');
    selectedSourceIds.add('s1');
    selectedSourceIds.add('s2');

    showSourceActions({ id: 'bulk', isBulk: true, targetIds: ['s1', 's2'], folderId: 'f1' });

    const inspectBtn = global.document.getElementById('modalInspectQuestionsBtn');
    assert.ok(inspectBtn, 'inspect button exists');
    await inspectBtn.onclick();

    assert.equal(getSelectionModeFolderId(), 'f1', 'selection mode folder id is preserved');
    assert.equal(selectedSourceIds.size, 2, 'selected sources are preserved');
    assert.ok(selectedSourceIds.has('s1'));
    assert.ok(selectedSourceIds.has('s2'));
    exitSelectionMode();
});

test('folder select trigger is framed in a square checkbox and toggles selection mode', async () => {
    AppState.folders = [systemFolder(), { id: 'f1', name: 'Matematik', order: 1, color: '#a855f7' }];
    const s1 = { id: 's1', name: 'A', folderId: 'f1' };
    AppState.sources = [s1];

    exitSelectionMode();
    renderSourcesList();

    const trigger = global.document.querySelector('[data-folder-id="f1"] .folder-select-trigger');
    assert.ok(trigger, 'folder select trigger exists');
    assert.ok(!trigger.classList.contains('active'), 'initially not active');
    assert.ok(trigger.querySelector('svg path'), 'contains folder path SVG inside square');

    // Click trigger to enter selection mode
    trigger.click();
    assert.equal(getSelectionModeFolderId(), 'f1', 'entered selection mode for folder');
    const activeTrigger = global.document.querySelector('[data-folder-id="f1"] .folder-select-trigger');
    assert.ok(activeTrigger.classList.contains('active'), 'trigger is now active (checked)');
    assert.ok(activeTrigger.querySelector('svg polyline'), 'contains checkmark polyline SVG inside square');

    // Click trigger again to exit selection mode
    activeTrigger.click();
    assert.equal(getSelectionModeFolderId(), null, 'exited selection mode');
    const resetTrigger = global.document.querySelector('[data-folder-id="f1"] .folder-select-trigger');
    assert.ok(!resetTrigger.classList.contains('active'), 'trigger is unselected again');
});

test('source items in selection mode show high contrast checkboxes on active sources', async () => {
    AppState.folders = [systemFolder(), { id: 'f1', name: 'Matematik', order: 1 }];
    const s1 = { id: 's1', name: 'Active Source', folderId: 'f1', active: true };
    const s2 = { id: 's2', name: 'Inactive Source', folderId: 'f1', active: false };
    AppState.sources = [s1, s2];

    enterSelectionMode('f1');
    renderSourcesList();

    const item1 = global.document.querySelector('[data-source-id="s1"]');
    const item2 = global.document.querySelector('[data-source-id="s2"]');
    assert.ok(item1 && item2, 'source items rendered');

    const cb1 = item1.querySelector('.source-select-checkbox');
    const cb2 = item2.querySelector('.source-select-checkbox');
    assert.ok(cb1 && cb2, 'checkboxes rendered');

    assert.ok(cb1.classList.contains('on-active-source'), 'active source checkbox marked for high contrast');
    assert.ok(!cb1.classList.contains('checked'), 'initially unchecked');

    // Click to select
    cb1.click();
    assert.ok(selectedSourceIds.has('s1'), 's1 is now selected');
    const updatedItem1 = global.document.querySelector('[data-source-id="s1"]');
    assert.ok(updatedItem1.classList.contains('selected'), 'selected class added to item');

    exitSelectionMode();
});


