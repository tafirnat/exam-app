import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let AppState, resolvePresetColor, DEFAULT_FOLDER_COLOR, generateAutoName, t;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    const stateModule = await import('../src/core/state.js');
    AppState = stateModule.AppState;
    AppState.language = 'tr';

    const i18nModule = await import('../src/core/i18n.js');
    t = i18nModule.t;

    const quickPresetsModule = await import('../src/features/sources/quick-presets.js');
    resolvePresetColor = quickPresetsModule.resolvePresetColor;
    DEFAULT_FOLDER_COLOR = quickPresetsModule.DEFAULT_FOLDER_COLOR;
    generateAutoName = quickPresetsModule.generateAutoName;
});

test('generateAutoName resolves name collisions correctly', () => {
    const prefix = t('qs_default_name');
    AppState.quickPresets = [
        { name: `${prefix}-1` },
        { name: `${prefix}-2` }
    ];

    const newName = generateAutoName();
    assert.equal(newName, `${prefix}-3`);
});

test('resolvePresetColor uses custom preset.color override when defined', () => {
    const preset = {
        id: 'qp_1',
        name: 'Custom Preset',
        sourceIds: ['s1'],
        color: '#ff0053'
    };

    const res = resolvePresetColor(preset);
    assert.deepEqual(res, { type: 'solid', value: '#ff0053' });
});

test('resolvePresetColor resolves single folder color', () => {
    AppState.folders = [
        { id: 'f1', name: 'Folder 1', color: '#8a43ff' }
    ];
    AppState.sources = [
        { id: 's1', folderId: 'f1', active: true, archived: false },
        { id: 's2', folderId: 'f1', active: true, archived: false }
    ];

    const preset = {
        id: 'qp_2',
        name: 'Single Folder Combo',
        sourceIds: ['s1', 's2'],
        color: null
    };

    const res = resolvePresetColor(preset);
    assert.deepEqual(res, { type: 'solid', value: '#8a43ff' });
});

test('resolvePresetColor resolves root sources to DEFAULT_FOLDER_COLOR', () => {
    AppState.folders = [];
    AppState.sources = [
        { id: 's1', folderId: null, active: true, archived: false }
    ];

    const preset = {
        id: 'qp_3',
        name: 'Root Combo',
        sourceIds: ['s1'],
        color: null
    };

    const res = resolvePresetColor(preset);
    assert.deepEqual(res, { type: 'solid', value: DEFAULT_FOLDER_COLOR });
});

test('resolvePresetColor computes proportional conic-gradient for mixed folders', () => {
    AppState.folders = [
        { id: 'f1', name: 'Folder 1', color: '#ff0053' },
        { id: 'f2', name: 'Folder 2', color: '#00a97a' }
    ];
    AppState.sources = [
        { id: 's1', folderId: 'f1', active: true, archived: false },
        { id: 's2', folderId: 'f1', active: true, archived: false },
        { id: 's3', folderId: 'f2', active: true, archived: false },
        { id: 's4', folderId: 'f2', active: true, archived: false }
    ];

    const preset = {
        id: 'qp_4',
        name: 'Mixed Combo',
        sourceIds: ['s1', 's2', 's3', 's4'],
        color: null
    };

    const res = resolvePresetColor(preset);
    assert.equal(res.type, 'conic');
    assert.ok(res.value.startsWith('conic-gradient('));
    assert.ok(res.value.includes('#ff0053 0.00deg 180.00deg'));
    assert.ok(res.value.includes('#00a97a 180.00deg 360.00deg'));
});

test('resolvePresetColor gracefully handles missing or deleted sources', () => {
    AppState.folders = [
        { id: 'f1', name: 'Folder 1', color: '#ff0053' }
    ];
    AppState.sources = [
        { id: 's1', folderId: 'f1', active: true, archived: false }
    ];

    const preset = {
        id: 'qp_5',
        name: 'Partial Combo',
        sourceIds: ['s1', 'deleted_source_99'],
        color: null
    };

    const res = resolvePresetColor(preset);
    assert.deepEqual(res, { type: 'solid', value: '#ff0053' });
});

test('showSourceQuickPresetsModal renders presets and toggles source inclusion', async () => {
    document.body.innerHTML = `
        <div id="sourceQuickPresetsOverlay" class="modal-overlay">
            <h3 id="sourceQuickPresetsTitle"></h3>
            <p id="sourceQuickPresetsSub"></p>
            <div id="sourceQuickPresetsList"></div>
            <button id="sourceQuickPresetsCloseXBtn"></button>
            <button id="sourceQuickPresetsDoneBtn"></button>
            <button id="sourceQuickPresetsCreateNewBtn"></button>
        </div>
    `;

    const { showSourceQuickPresetsModal } = await import('../src/features/sources/quick-presets-ui.js');

    const testSource = { id: 'src_test_1', name: 'Test Source 1' };
    AppState.sources = [testSource];
    AppState.quickPresets = [
        { id: 'qp_1', name: 'Preset Alpha', sourceIds: [], order: 0 },
        { id: 'qp_2', name: 'Preset Beta', sourceIds: ['src_test_1'], order: 1 }
    ];

    showSourceQuickPresetsModal(testSource);

    const list = document.getElementById('sourceQuickPresetsList');
    assert.equal(list.children.length, 2);

    const rows = list.querySelectorAll('.sqp-preset-row');
    assert.equal(rows[0].classList.contains('active'), false);
    assert.equal(rows[1].classList.contains('active'), true);

    // Click first row to add source
    rows[0].click();
    assert.ok(AppState.quickPresets[0].sourceIds.includes('src_test_1'));

    // Click second row to remove source
    rows[1].click();
    assert.ok(!AppState.quickPresets[1].sourceIds.includes('src_test_1'));
});
