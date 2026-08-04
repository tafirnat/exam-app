/**
 * Daily activity accounting across the three paths that write it.
 *
 * Today's counters are written from three places: the live per-answer commit
 * (commitOneAnswerToActivity), the mid-session flush (flushInProgressAnswers)
 * and test completion (recordTestFinished). All three walk the *same* ordered
 * `testTracking.results` array, so the only thing keeping an answer from being
 * counted twice is the checkpoint each one leaves behind.
 *
 * Two defects lived in that arithmetic and both showed up as a streak that
 * disagreed with itself:
 *
 *   - recordTestFinished subtracted only `_flushedCount`. Finishing a test
 *     without ever leaving the test view means no flush ran, so every answer
 *     the live path had already committed was added a second time - the global
 *     day count ran at 2x.
 *   - The live path counted the global track only. The focus track waited for
 *     a flush or a finish, so the two tracks were never derived from the same
 *     set of answers, and a session the browser ended (tab closed) contributed
 *     to the global streak but not the focus one.
 *
 * Together those made "Genel" and "Odak" tell different stories from identical
 * study, and once a device pushed the inflated number the max-merge in
 * mergeSyncData() locked it in for every other device.
 */

import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let AppState,
    commitOneAnswerToActivity,
    flushInProgressAnswers,
    recordTestFinished,
    initTodayActivity,
    getLocalDateStr;

const SOURCE = 'src-focus';
const OTHER_SOURCE = 'src-other';

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    const stateMod = await import('../src/core/state.js');
    AppState = stateMod.AppState;

    const engine = await import('../src/features/stats/continuity-engine.js');
    commitOneAnswerToActivity = engine.commitOneAnswerToActivity;
    flushInProgressAnswers = engine.flushInProgressAnswers;
    recordTestFinished = engine.recordTestFinished;
    initTodayActivity = engine.initTodayActivity;
    getLocalDateStr = engine.getLocalDateStr;
});

/**
 * A session of `n` answers, all from the focus source, all correct unless
 * listed in `wrongIndexes`.
 */
function startSession(n, { wrongIndexes = [], sourceId = SOURCE } = {}) {
    AppState.studyActivity = {};
    AppState.questionMap = {};
    AppState.testTracking = { results: [], mode: 'normal' };

    const questions = [];
    for (let i = 0; i < n; i++) {
        const id = `q${i}`;
        AppState.questionMap[`${sourceId}_${id}`] = { id, sourceId };
        questions.push({ id, sourceId });
    }
    return questions;
}

/** Mirrors what updateStats() records, then the live commit that follows it. */
function answer(questions, index, isCorrect) {
    const q = questions[index];
    AppState.testTracking.results.push({
        questionId: q.id,
        sourceId: q.sourceId,
        answeredAt: Date.now(),
        isCorrect,
        userAnswer: ['x']
    });
    commitOneAnswerToActivity(isCorrect);
}

/** The shape finishTest() hands to recordTestFinished(). */
function answeredQuestionsFor(questions) {
    return AppState.testTracking.results.map(r => ({
        id: r.questionId,
        sourceId: r.sourceId,
        userAnswer: r.userAnswer,
        isCorrect: r.isCorrect,
        isUnanswered: false,
        answeredAt: r.answeredAt
    }));
}

function today() {
    return AppState.studyActivity[getLocalDateStr()];
}

function finish() {
    const answered = answeredQuestionsFor();
    const correct = answered.filter(q => q.isCorrect).length;
    recordTestFinished(answered.length, correct, answered.length - correct, 0, answered);
}

beforeEach(() => {
    AppState.continuityConfig = {
        focusSources: [SOURCE],
        focusSourceTimestamps: { [SOURCE]: 0 },
        freezeTokens: { initialized: true, remaining: 0, tier1Earned: false, tier2Earned: false },
        focusFreezeTokens: { initialized: true, remaining: 0, tier1Earned: false, tier2Earned: false }
    };
    AppState.studyActivity = {};
    AppState.testTracking = null;
});

/* Which bucket the day's answers land in is the load-bearing detail behind
   per-device counting: the merge sums across buckets and takes the larger
   figure within one. Writing into a shared bucket instead would put all three
   devices back under Math.max - five answers on the laptop and five on the
   phone reading as five - and every merge case would still pass, because the
   merge would be doing exactly what it was told. */

test("the day's answers land in this device's own bucket", () => {
    AppState.deviceId = 'dev-x';
    const questions = startSession(3);
    initTodayActivity();
    for (let i = 0; i < 3; i++) answer(questions, i, true);

    const buckets = today().byDevice;
    assert.deepEqual(Object.keys(buckets), ['dev-x']);
    assert.equal(buckets['dev-x'].questionCount, 3);
    assert.equal(today().questionCount, 3, 'and the day totals its buckets');
});

test('finishing a test writes to the same bucket the live path used', () => {
    AppState.deviceId = 'dev-x';
    const questions = startSession(4);
    initTodayActivity();
    for (let i = 0; i < 4; i++) answer(questions, i, true);
    finish();

    // A second bucket here would mean one device counted itself twice, which
    // the merge cannot undo - the sum across buckets would be eight.
    assert.deepEqual(Object.keys(today().byDevice), ['dev-x']);
    assert.equal(today().questionCount, 4);
});

test('another device answering the same day writes a bucket of its own', () => {
    AppState.deviceId = 'dev-x';
    let questions = startSession(2);
    initTodayActivity();
    for (let i = 0; i < 2; i++) answer(questions, i, true);

    /* The same browser profile is never two devices; this is what the other
       device's writes look like once its record has been merged in. Deliberately
       not startSession() - that clears the day, and the day is the thing under
       test here. */
    AppState.deviceId = 'dev-y';
    AppState.testTracking = { results: [], mode: 'normal' };
    questions = [0, 1, 2].map(i => {
        const id = `y${i}`;
        AppState.questionMap[`${SOURCE}_${id}`] = { id, sourceId: SOURCE };
        return { id, sourceId: SOURCE };
    });
    for (let i = 0; i < 3; i++) answer(questions, i, true);

    assert.deepEqual(Object.keys(today().byDevice).sort(), ['dev-x', 'dev-y']);
    assert.equal(today().questionCount, 5, 'the day is the sum of both');
});

test('finishing a test counts each answer exactly once', () => {
    const questions = startSession(6);
    initTodayActivity();
    for (let i = 0; i < 6; i++) answer(questions, i, i % 2 === 0);

    // The live path has written all six already.
    assert.equal(today().questionCount, 6, 'live commits should have written six');

    finish();

    assert.equal(today().questionCount, 6, 'finishing must not add the six a second time');
    assert.equal(today().correctCount, 3);
    assert.equal(today().wrongCount, 3);
});

test('flush then finish counts each answer exactly once', () => {
    const questions = startSession(5);
    initTodayActivity();
    for (let i = 0; i < 3; i++) answer(questions, i, true);

    flushInProgressAnswers();
    assert.equal(today().questionCount, 3, 'flush must not re-add live-committed answers');

    for (let i = 3; i < 5; i++) answer(questions, i, false);
    finish();

    assert.equal(today().questionCount, 5);
    assert.equal(today().correctCount, 3);
    assert.equal(today().wrongCount, 2);
});

test('repeated flushes are idempotent', () => {
    const questions = startSession(4);
    initTodayActivity();
    for (let i = 0; i < 4; i++) answer(questions, i, true);

    flushInProgressAnswers();
    flushInProgressAnswers();
    flushInProgressAnswers();

    assert.equal(today().questionCount, 4);
    assert.equal(today().correctCount, 4);
});

test('the focus track advances with every answer, not only at flush', () => {
    const questions = startSession(3);
    initTodayActivity();

    answer(questions, 0, true);
    assert.equal(today().focusQuestionCount, 1, 'focus must move with the first answer');

    answer(questions, 1, true);
    answer(questions, 2, false);
    assert.equal(today().focusQuestionCount, 3);
    assert.equal(today().questionCount, 3, 'global and focus must agree on the same answers');
});

test('a session the browser ends still has both tracks in step', () => {
    const questions = startSession(4);
    initTodayActivity();
    for (let i = 0; i < 4; i++) answer(questions, i, true);

    // pagehide / visibilitychange - the only handler that runs.
    flushInProgressAnswers();

    assert.equal(today().questionCount, 4);
    assert.equal(today().focusQuestionCount, 4, 'focus must not be left behind by a closed tab');
});

test('answers outside the focus sources count globally but not for focus', () => {
    const questions = startSession(2, { sourceId: OTHER_SOURCE });
    initTodayActivity();
    answer(questions, 0, true);
    answer(questions, 1, true);

    assert.equal(today().questionCount, 2);
    assert.equal(today().focusQuestionCount, 0, 'a non-focus source must not feed the focus track');

    finish();
    assert.equal(today().questionCount, 2);
    assert.equal(today().focusQuestionCount, 0);
});

test('focus counting ignores answers that predate the source being selected', () => {
    const questions = startSession(2);
    initTodayActivity();
    // The source joined the focus set after these answers were given.
    AppState.continuityConfig.focusSourceTimestamps = { [SOURCE]: Date.now() + 60_000 };

    answer(questions, 0, true);
    answer(questions, 1, true);

    assert.equal(today().questionCount, 2);
    assert.equal(today().focusQuestionCount, 0);
});

test('both tracks stay in step across live, flush and finish combined', () => {
    const questions = startSession(7);
    initTodayActivity();

    answer(questions, 0, true);
    answer(questions, 1, true);
    flushInProgressAnswers();
    answer(questions, 2, false);
    flushInProgressAnswers();
    answer(questions, 3, true);
    answer(questions, 4, true);
    answer(questions, 5, false);
    answer(questions, 6, true);
    finish();

    assert.equal(today().questionCount, 7);
    assert.equal(today().focusQuestionCount, 7, 'focus must equal global when every answer is a focus answer');
    assert.equal(today().correctCount, 5);
    assert.equal(today().wrongCount, 2);
});

/* ── What the day logged, question by question ───────────────────────────────
   The trend bars count distinct questions, not answers, which needs the day to
   record *which* questions were worked. The rest of the app names a question by
   `sourceId_id` because `id` is only unique inside its source; the log was
   keyed by the bare id, so two sources that both number their first question 1
   were one question to the chart - and which of the two got answered decided
   what the bar looked like on each device. */

function logOf(activity) {
    const buckets = Object.values(activity.byDevice || {});
    return Object.assign({}, ...buckets.map(b => b.questionLog || {}));
}

test('the day names a logged question by its source and its id', () => {
    AppState.studyActivity = {};
    AppState.questionMap = {};
    AppState.testTracking = { results: [], mode: 'normal' };

    // Two different questions that happen to share an id, as sources do.
    const questions = [{ id: 'q1', sourceId: SOURCE }, { id: 'q1', sourceId: OTHER_SOURCE }];
    questions.forEach(q => { AppState.questionMap[`${q.sourceId}_${q.id}`] = q; });

    answer(questions, 0, true);
    answer(questions, 1, false);

    assert.deepEqual(Object.keys(logOf(today())).sort(), [`${SOURCE}_q1`, `${OTHER_SOURCE}_q1`].sort());
});

test('a question answered twice in one day is logged once', () => {
    const questions = startSession(1);

    answer(questions, 0, false);
    answer(questions, 0, true);

    const log = logOf(today());
    assert.deepEqual(Object.keys(log), [`${SOURCE}_q0`]);
    assert.deepEqual(log[`${SOURCE}_q0`], { correct: 1, wrong: 1, empty: 0, isFocus: true });
    assert.equal(today().questionCount, 2, 'the counters still count every answer');
});
