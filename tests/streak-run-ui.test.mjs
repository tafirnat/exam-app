import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let AppState,
    UNCATEGORIZED_FOLDER_ID,
    describeStreakRun,
    getStreakOrder,
    STREAK_ORDERS,
    getLocalDateStr;

const DAY = 24 * 60 * 60 * 1000;

function overdueSource(id, questionCount) {
    return {
        id,
        name: id,
        folderId: null,
        active: true,
        questions: Array.from({ length: questionCount }, (_, i) => ({ id: i + 1 }))
    };
}

function seedOverdue(source) {
    source.questions.forEach(q => {
        AppState.stats[`${source.id}_${q.id}`] = {
            stability: 10,
            difficulty: 5,
            lastReview: new Date(Date.now() - 40 * DAY).toISOString()
        };
    });
}

/** Today's activity record, written straight in so the bar is under test control. */
function setToday(activity) {
    AppState.studyActivity = { [getLocalDateStr()]: activity };
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

    const engineMod = await import('../src/features/stats/continuity-engine.js');
    getLocalDateStr = engineMod.getLocalDateStr;

    const uiMod = await import('../src/features/stats/continuity-ui.js');
    describeStreakRun = uiMod.describeStreakRun;
    getStreakOrder = uiMod.getStreakOrder;
    STREAK_ORDERS = uiMod.STREAK_ORDERS;
});

beforeEach(() => {
    AppState.sources = [];
    AppState.stats = {};
    AppState.studyActivity = {};
    AppState.folders = [{ id: UNCATEGORIZED_FOLDER_ID, name: 'Kategorisiz', isSystem: true }];
    AppState.continuityConfig = { focusSources: [] };
});

test('no remembered mode yet, so the first tap has to ask', () => {
    assert.equal(getStreakOrder(), null);
});

test('a remembered mode is honoured, an unknown one is ignored', () => {
    AppState.continuityConfig.streakRunOrder = 'grouped';
    assert.equal(getStreakOrder(), 'grouped');

    AppState.continuityConfig.streakRunOrder = 'nonsense';
    assert.equal(getStreakOrder(), null);
});

test('both documented modes are accepted', () => {
    STREAK_ORDERS.forEach(order => {
        AppState.continuityConfig.streakRunOrder = order;
        assert.equal(getStreakOrder(), order);
    });
});

test('an empty library disables the button instead of promising a run', () => {
    const state = describeStreakRun('global');

    assert.equal(state.available, 0);
    assert.equal(state.enabled, false);
    assert.match(state.label, /Tekrar bekleyen soru yok/);
});

test('while the day is unmet the button offers to rescue the streak', () => {
    const source = overdueSource('A', 30);
    AppState.sources = [source];
    seedOverdue(source);
    setToday({ studied: false, questionCount: 0, overdueSnapshot: 20 });

    const state = describeStreakRun('global');

    assert.equal(state.enabled, true);
    assert.equal(state.available, 15);
    assert.equal(state.label, 'Seriyi Koru (15)');
});

test('once the day is secured the button keeps working but stops claiming a rescue', () => {
    const source = overdueSource('A', 30);
    AppState.sources = [source];
    seedOverdue(source);
    setToday({ studied: true, questionCount: 20, overdueSnapshot: 15 });

    const state = describeStreakRun('global');

    assert.equal(state.enabled, true);
    assert.equal(state.label, 'FSRS ile Çalış (15)');
});

test('the count reflects the real run, not the nominal target', () => {
    const source = overdueSource('A', 4);
    AppState.sources = [source];
    seedOverdue(source);
    setToday({ studied: false, questionCount: 0, overdueSnapshot: 20 });

    const state = describeStreakRun('global');

    // Only four questions exist; the button must not advertise fifteen.
    assert.equal(state.available, 4);
    assert.equal(state.label, 'Seriyi Koru (4)');
});

test('an inactive source still counts towards the global run', () => {
    const source = overdueSource('A', 20);
    source.active = false;
    AppState.sources = [source];
    seedOverdue(source);
    setToday({ studied: false, questionCount: 0, overdueSnapshot: 20 });

    assert.equal(describeStreakRun('global').enabled, true);
});

test('the focus button is disabled until focus sources are selected', () => {
    const source = overdueSource('A', 20);
    AppState.sources = [source];
    seedOverdue(source);
    setToday({ studied: false, questionCount: 0, focusOverdueSnapshot: 15 });

    assert.equal(describeStreakRun('focus').enabled, false);

    AppState.continuityConfig.focusSources = ['A'];
    assert.equal(describeStreakRun('focus').enabled, true);
});

test('the focus button reads the focus track, not the global one', () => {
    const source = overdueSource('A', 30);
    AppState.sources = [source];
    seedOverdue(source);
    AppState.continuityConfig.focusSources = ['A'];

    // Global day is met, focus day is not - the focus button must say so.
    setToday({
        studied: true,
        questionCount: 40,
        overdueSnapshot: 15,
        focusStudied: false,
        focusQuestionCount: 0,
        focusOverdueSnapshot: 15
    });

    assert.equal(describeStreakRun('focus').label, 'Seriyi Koru (15)');
    assert.equal(describeStreakRun('global').label, 'FSRS ile Çalış (15)');
});
