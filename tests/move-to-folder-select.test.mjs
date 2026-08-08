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

let AppState, UNCATEGORIZED_FOLDER_ID, showSourceActions;

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

test('the uncategorised folder is not offered beside the root option', () => {
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
test('with no real folders the picker stays hidden', () => {
    const source = { id: 's1', name: 'Kaynak', folderId: null };
    AppState.sources = [source];

    showSourceActions(source);

    const container = global.document.getElementById('moveToFolderContainer');
    assert.equal(container.style.display, 'none');
});

/* The control already marked a real folder as selected; an uncategorised
   source fell through and left the prompt showing, so the same state was drawn
   two different ways depending on where the source happened to live. */
test('the option matching the source is the selected one', () => {
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
test('choosing the prompt moves nothing and leaves the dialog open', () => {
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
