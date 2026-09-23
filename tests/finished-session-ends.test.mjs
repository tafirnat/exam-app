import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

/**
 * A finished test is over, everywhere.
 *
 * The bug the user saw was a flashcard test that would not end: pressing "Test
 * beenden" did nothing at all - no error, no view change - and the rating bar
 * left on that screen kept working, except every click on Schwer applied FSRS
 * again, so a single card's history came apart while the day's total stayed
 * right. Both symptoms are one state: the test view showing a session whose
 * `testTracking` is null.
 *
 * That state was manufactured by the finish itself. finishTest() nulled the
 * tracking record but left `AppState.currentTest` populated, and "currentTest
 * has entries" is how every writer decides there is a session worth saving -
 * the debounced saveActiveTest(), the preset freeze in applyPreset(), and
 * savePresetSessionData() through it. Each wrote the dead session back as a
 * resumable one, checkActiveTest() promoted it on the next visit home, and the
 * user resumed a test that nothing could finish.
 *
 * Four locks, because the chain has four links and closing any one of them
 * alone still leaves a way in.
 */

let AppState, initState, finishTest, updateFlashcardStats, saveActiveTest, clearActiveTest;
let readJSON, finishTestFlow;

before(async () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    const stateMod = await import('../src/core/state.js');
    AppState = stateMod.AppState;
    initState = stateMod.initState;
    saveActiveTest = stateMod.saveActiveTest;
    clearActiveTest = stateMod.clearActiveTest;
    await initState();

    readJSON = (await import('../src/core/storage.js')).readJSON;

    const engine = await import('../src/features/test/test-engine.js');
    finishTest = engine.finishTest;
    updateFlashcardStats = engine.updateFlashcardStats;

    finishTestFlow = (await import('../src/features/test/test-ui.js')).finishTestFlow;
});

const CARD = { id: 'q1', sourceId: 'exam_a', type: 'flashcard', text: 'front', difficulty: 1.5 };

/** A one-card flashcard session, revealed and about to be rated. */
function seedSession() {
    AppState.sources = [{
        id: 'exam_a', name: 'Alpha', active: true, updatedAt: 1000,
        questions: [CARD], testResults: []
    }];
    AppState.stats = {};
    AppState.recentTests = [];
    AppState.questionMap = { 'exam_a_q1': CARD };
    AppState.currentTest = ['exam_a_q1'];
    AppState.currentIndex = 0;
    AppState.isAnswerChecked = { 0: true };
    AppState.userAnswers = {};
    AppState.testTracking = {
        startTime: new Date().toISOString(),
        sourceNames: ['Alpha'],
        sourceTitle: 'Alpha',
        results: [],
        _flushedCount: 0
    };
}

beforeEach(() => {
    seedSession();
});

/* Link 1: the session itself. Leaving the question ids behind is what let a
   filed test be written back to disk as a live one. */
test('finishing a test leaves no session behind for anything to save', async () => {
    await finishTest();

    assert.equal(AppState.testTracking, null);
    assert.deepEqual(AppState.currentTest, [],
        'currentTest having entries is how every writer decides a session is live');
    assert.deepEqual(AppState.isAnswerChecked, {});
    assert.deepEqual(AppState.userAnswers, {});
});

/* Link 2: the debounced write. saveActiveTest() fires on every answer and every
   navigation, so a finish inside its 300ms window used to be followed by a
   write that put the just-filed session back on disk - over the tombstone, and
   with the tracking record already gone. */
test('a write scheduled just before the finish cannot outlive the tombstone', async () => {
    updateFlashcardStats('exam_a', 'q1', 3);   // schedules saveActiveTest()
    await finishTest();

    assert.equal(readJSON('focus_app_active_test', null)?.cleared, true);

    await new Promise(resolve => setTimeout(resolve, 400));

    const record = readJSON('focus_app_active_test', null);
    assert.equal(record?.cleared, true,
        'the pending write must not resurrect the finished test');
    assert.ok(!record?.currentTest?.length,
        'a record with question ids in it is offered as resumable on the home screen');
});

/* Link 3: the rating itself. The pre-session snapshot lives on the tracking
   record, and it is the only reason rating the same card twice replaces the
   first rating instead of stacking on it. Measured before the fix: three clicks
   on Schwer moved difficulty 4.46 -> 7.35 and wrong 1 -> 3. */
test('rating the same card three times counts once, with or without a record', async () => {
    for (let i = 0; i < 3; i++) updateFlashcardStats('exam_a', 'q1', 2);
    const withRecord = { ...AppState.stats['exam_a_q1'] };

    seedSession();
    AppState.testTracking = null;
    for (let i = 0; i < 3; i++) updateFlashcardStats('exam_a', 'q1', 2);
    const withoutRecord = AppState.stats['exam_a_q1'];

    assert.equal(withoutRecord.wrong, withRecord.wrong);
    assert.equal(withoutRecord.streak, withRecord.streak);
    assert.equal(withoutRecord.difficulty, withRecord.difficulty);
    assert.equal(withoutRecord.stability, withRecord.stability);
    assert.equal(withRecord.wrong, 1, 'and one rating is one rating');
});

/* Link 4: the way out. finishTest() returns true only when it filed a history
   entry - false for an empty session, undefined both when it caught an error
   and when there was no tracking record at all. Only `false` used to be handled,
   so the undefined cases left the user on a screen with a dead finish button. */
test('the finish button always leaves the test view, even with nothing to file', async () => {
    AppState.testTracking = null;      // the session this screen belongs to is gone
    let landedOn = null;
    window.switchView = (view) => { landedOn = view; };

    await finishTestFlow();

    assert.equal(landedOn, 'home', 'a finish that files nothing still has to let go of the screen');
    assert.deepEqual(AppState.currentTest, [],
        'and drop the session, or the home screen offers the same dead test again');
    assert.equal(readJSON('focus_app_active_test', null)?.cleared, true);
    delete window.switchView;
});
