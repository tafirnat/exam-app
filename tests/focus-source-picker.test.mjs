import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let AppState,
    UNCATEGORIZED_FOLDER_ID,
    renderSourcePicker,
    getFocusSources,
    getLiveFocusSources,
    getFocusSourceLabel,
    calculateFocusStreak,
    isFocusActivityRequirementMet,
    getLocalDateStr;

const SOURCE_A = { id: 'srcA', name: 'Almanca B1', active: true, folderId: 'f1', order: 0, questions: [{ id: 1 }, { id: 2 }] };
const SOURCE_B = { id: 'srcB', name: 'Matematik', active: true, folderId: 'f1', order: 1, questions: [{ id: 1 }] };
const SOURCE_C = { id: 'srcC', name: 'Tarih', active: false, order: 0, questions: [{ id: 1 }] };
const SOURCE_D = { id: 'srcD', name: 'Fizik', active: false, order: 1, questions: [{ id: 1 }] };

function seedLibrary() {
    AppState.folders = [
        { id: UNCATEGORIZED_FOLDER_ID, name: 'Kategorisiz Kaynaklar', isSystem: true, order: 1 },
        { id: 'f1', name: 'Dersler', color: '#3b82f6', order: 0 }
    ];
    AppState.sources = [
        { ...SOURCE_A },
        { ...SOURCE_B },
        { ...SOURCE_C },
        { ...SOURCE_D }
    ];
}

function makeContainer() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    const stateMod = await import('../src/core/state.js');
    AppState = stateMod.AppState;
    UNCATEGORIZED_FOLDER_ID = stateMod.UNCATEGORIZED_FOLDER_ID;

    const sourcesMod = await import('../src/features/sources/sources-ui.js');
    renderSourcePicker = sourcesMod.renderSourcePicker;

    const engineMod = await import('../src/features/stats/continuity-engine.js');
    getFocusSources = engineMod.getFocusSources;
    getLiveFocusSources = engineMod.getLiveFocusSources;
    getFocusSourceLabel = engineMod.getFocusSourceLabel;
    calculateFocusStreak = engineMod.calculateFocusStreak;
    isFocusActivityRequirementMet = engineMod.isFocusActivityRequirementMet;
    getLocalDateStr = engineMod.getLocalDateStr;
});

beforeEach(() => {
    document.body.innerHTML = '';
    seedLibrary();
    AppState.continuityConfig = { focusSources: [], focusSourceNames: {} };
    AppState.studyActivity = {};
});

test('picker renders folders and source rows but no management controls', () => {
    const container = makeContainer();
    renderSourcePicker(container, { selected: [], max: 3 });

    assert.equal(container.querySelectorAll('.folder-header').length, 2);
    assert.equal(container.querySelectorAll('.source-item').length, 4);

    // Everything the sources screen uses to mutate the library must be absent.
    assert.equal(container.querySelectorAll('.drag-handle').length, 0);
    assert.equal(container.querySelectorAll('.icon-btn').length, 0);
    assert.equal(container.querySelectorAll('button').length, 0);
    assert.equal(container.querySelectorAll('input').length, 0);
    assert.equal(container.querySelectorAll('.origin-tag').length, 0);
    assert.equal(container.querySelectorAll('[draggable="true"]').length, 0);
});

test('picker marks pre-selected sources as active', () => {
    const container = makeContainer();
    const handle = renderSourcePicker(container, { selected: ['srcB'], max: 3 });

    const active = container.querySelectorAll('.source-item.active');
    assert.equal(active.length, 1);
    assert.equal(active[0].dataset.sourceId, 'srcB');
    assert.deepEqual(handle.getSelected(), ['srcB']);
});

test('clicking a row toggles selection and reports it through onChange', () => {
    const container = makeContainer();
    const seen = [];
    const handle = renderSourcePicker(container, {
        selected: [],
        max: 3,
        onChange: (ids) => seen.push([...ids])
    });

    container.querySelector('[data-source-id="srcA"]').click();
    assert.deepEqual(handle.getSelected(), ['srcA']);

    container.querySelector('[data-source-id="srcA"]').click();
    assert.deepEqual(handle.getSelected(), []);

    assert.deepEqual(seen, [[], ['srcA'], []]);
});

test('picker refuses a fourth selection', () => {
    const container = makeContainer();
    const handle = renderSourcePicker(container, { selected: [], max: 3 });

    ['srcA', 'srcB', 'srcC', 'srcD'].forEach(id => {
        container.querySelector(`[data-source-id="${id}"]`).click();
    });

    assert.equal(handle.getSelected().length, 3);
    assert.deepEqual(handle.getSelected(), ['srcA', 'srcB', 'srcC']);
});

test('archived sources are hidden and never occupy a selection slot', () => {
    AppState.sources.find(s => s.id === 'srcA').archived = true;

    const container = makeContainer();
    const handle = renderSourcePicker(container, { selected: ['srcA', 'srcB'], max: 3 });

    assert.equal(container.querySelector('[data-source-id="srcA"]'), null);
    assert.deepEqual(handle.getSelected(), ['srcB']);

    // All three remaining live sources still fit.
    ['srcC', 'srcD'].forEach(id => container.querySelector(`[data-source-id="${id}"]`).click());
    assert.equal(handle.getSelected().length, 3);
});

test('empty folders are skipped and an empty library shows a hint', () => {
    AppState.sources = [];
    const container = makeContainer();
    renderSourcePicker(container, { selected: [], max: 3 });

    assert.equal(container.querySelectorAll('.folder-header').length, 0);
    assert.match(container.textContent, /Henüz ekli kaynak yok/);
});

test('getLiveFocusSources drops archived and deleted ids from the selection', () => {
    AppState.continuityConfig.focusSources = ['srcA', 'srcB', 'ghost'];
    AppState.sources.find(s => s.id === 'srcB').archived = true;

    assert.deepEqual(getFocusSources(), ['srcA', 'srcB', 'ghost']);
    assert.deepEqual(getLiveFocusSources(), ['srcA']);
});

test('a deleted source keeps its label through the saved name snapshot', () => {
    AppState.continuityConfig.focusSources = ['srcA'];
    AppState.continuityConfig.focusSourceNames = { srcA: 'Almanca B1' };
    AppState.sources = AppState.sources.filter(s => s.id !== 'srcA');

    assert.equal(getFocusSourceLabel('srcA'), 'Almanca B1');
});

test('focus streak survives archiving, deleting and re-picking sources', () => {
    const dayKey = (offset) => {
        const d = new Date();
        d.setDate(d.getDate() - offset);
        return getLocalDateStr(d);
    };

    AppState.continuityConfig.focusSources = ['srcA'];
    for (let i = 1; i <= 4; i++) {
        AppState.studyActivity[dayKey(i)] = {
            studied: true, questionCount: 15, frozen: false, overdueSnapshot: 15,
            focusStudied: true, focusQuestionCount: 15, focusFrozen: false, focusOverdueSnapshot: 15
        };
    }
    AppState.studyActivity[dayKey(0)] = {
        studied: true, questionCount: 15, frozen: false, overdueSnapshot: 15,
        focusStudied: true, focusQuestionCount: 15, focusFrozen: false, focusOverdueSnapshot: 15
    };

    const before = calculateFocusStreak();
    assert.equal(before, 5);

    // Archive it, delete it, then point the series at a different source.
    AppState.sources.find(s => s.id === 'srcA').archived = true;
    assert.equal(calculateFocusStreak(), before);

    AppState.sources = AppState.sources.filter(s => s.id !== 'srcA');
    assert.equal(calculateFocusStreak(), before);

    AppState.continuityConfig.focusSources = ['srcB'];
    assert.equal(calculateFocusStreak(), before);

    // The earned days themselves are untouched.
    assert.equal(isFocusActivityRequirementMet(AppState.studyActivity[dayKey(3)]), true);
});
