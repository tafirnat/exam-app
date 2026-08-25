/* "Sortiert" has to mean sortiert.
 *
 * Skipping the final shuffleArray was never enough: the FSRS selection hands
 * back overdue questions first (sorted by retrievability), then splits what is
 * left into three difficulty bands and shuffles *each band*. A sequential
 * session therefore has to bypass the selection entirely, not tidy up after it.
 *
 * The fixtures below are built so that the two answers CANNOT coincide - the
 * due, low-coefficient questions sit at the END of the pool. Seed them at the
 * front and both implementations return the same list, the mutant passes, and
 * the test proves nothing. This is the trap CLAUDE.md (27) records.
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="toast"></div></body></html>',
    { url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

const { AppState } = await import('../src/core/state.js');
const { prepareTest, activeSourcesKeepOrder } = await import('../src/features/test/test-engine.js');
const {
    buildRangeOptions, resolveQuestionCount, countActivePoolQuestions, ALL_QUESTIONS
} = await import('../src/features/test/test-range.js');

const SOURCE_ID = 'exam_seq_1700000000_ab';
const POOL_SIZE = 30;

/** Question n of the source, 1-based, as a composite id. */
const cid = (n) => `${SOURCE_ID}_q${n}`;

/**
 * A pool whose FSRS priority is deliberately at odds with its stored order.
 *
 * `overdueHalf: 'tail'` (the default) puts the due, hardest questions LAST, so
 * any implementation that consults priority returns the tail first and cannot
 * be mistaken for one that returns the first N.
 *
 * `overdueHalf: 'head'` is for the focus-pool case, where what has to differ is
 * the position of the *injected* questions relative to the slice.
 */
function seedLibrary({ keepOrder = true, overdueHalf = 'tail' } = {}) {
    const questions = [];
    for (let i = 1; i <= POOL_SIZE; i++) {
        questions.push({ id: `q${i}`, type: 'single_choice', content: { text: `Q${i}` } });
    }

    AppState.sources = [{
        id: SOURCE_ID, name: 'Sequential Source', active: true, archived: false,
        keepOrder, questions
    }];
    AppState.stats = {};
    AppState.continuityConfig = { focusPools: [] };
    AppState.studyActivity = {};
    AppState.quickPresets = [];
    AppState.presetSessions = {};
    AppState.questionStartIndex = 0;

    const longAgo = new Date(Date.now() - 400 * 86400000).toISOString();
    const justNow = new Date().toISOString();

    for (let i = 1; i <= POOL_SIZE; i++) {
        const inSecondHalf = i > POOL_SIZE / 2;
        const isOverdue = overdueHalf === 'tail' ? inSecondHalf : !inSecondHalf;
        AppState.stats[`${SOURCE_ID}_q${i}`] = isOverdue
            // Overdue and hardest: what the FSRS branch would reach for first.
            ? { correct: 0, wrong: 5, difficulty: 9, coeff: 4.5, stability: 1, lastReview: longAgo }
            // Fresh and easy: what the FSRS branch would leave for last.
            : { correct: 5, wrong: 0, difficulty: 2, coeff: 1.0, stability: 400, lastReview: justNow };
    }
}

beforeEach(() => seedLibrary());

test('a sequential session takes the first N in stored order', () => {
    const list = prepareTest(10);
    assert.deepEqual(list, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(cid));
});

test('the same setup shuffled does NOT return the first N in order', () => {
    /* The other half of the claim: without this, a selection that happened to be
       ordered anyway would satisfy the case above for the wrong reason. */
    seedLibrary({ keepOrder: false });
    const list = prepareTest(10);
    const firstTen = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(cid);
    assert.notDeepEqual(list, firstTen);
    // And it reaches for the overdue tail, which is the priority rule working.
    assert.ok(list.some(id => Number(id.split('_q')[1]) > POOL_SIZE / 2),
        'the shuffled branch must still honour FSRS priority');
});

test('the starting offset moves the window without reordering it', () => {
    const list = prepareTest(10, { startIndex: 10 });
    assert.deepEqual(list, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map(cid));
});

test('a final block shorter than the session size is not padded from elsewhere', () => {
    const list = prepareTest(10, { startIndex: 25 });
    assert.deepEqual(list, [26, 27, 28, 29, 30].map(cid));
});

test('focus pool injections land in stored order, not appended to the end', () => {
    /* applyFocusPools pushes onto the END of the selection, so the re-sort is
       the only thing keeping a sequential session ascending.

       The fixture has to make the two answers differ, and that takes both
       halves: the overdue questions sit at the HEAD of the pool (injection
       reaches for lowest recall first) while the slice starts at 21. Leave the
       overdue ones in the tail, or start the slice at 0, and everything the pool
       can inject already sorts after the slice - the mutant then produces an
       identical list and passes. Measured: it did. */
    seedLibrary({ overdueHalf: 'head' });
    AppState.continuityConfig = {
        focusPools: [{ targetType: 'source', targetId: SOURCE_ID, count: 8 }]
    };

    const list = prepareTest(5, { startIndex: 20 });
    const positions = list.map(id => Number(id.split('_q')[1]));

    assert.ok(positions.some(p => p <= 5),
        'the pool must actually inject something from before the slice');
    assert.deepEqual([...positions].sort((a, b) => a - b), positions,
        'a sequential session must be ascending in pool position');
});

test('"all questions" takes the whole pool and is not clipped to the largest preset', () => {
    const list = prepareTest(resolveQuestionCount(ALL_QUESTIONS));
    assert.equal(list.length, POOL_SIZE);
    assert.deepEqual(list, Array.from({ length: POOL_SIZE }, (_, i) => cid(i + 1)));
});

test('the session record names the length actually drawn, never Infinity', () => {
    prepareTest(resolveQuestionCount(ALL_QUESTIONS));
    assert.equal(AppState.testTracking.questionCount, POOL_SIZE);
    assert.ok(Number.isFinite(AppState.testTracking.questionCount));
});

test('one shuffled source among ordered ones decides for the whole session', () => {
    // Interleaving an ordered pool with a random one produces neither.
    AppState.sources.push({
        id: 'exam_other_1700000001_cd', name: 'Other', active: true, archived: false,
        keepOrder: false, questions: [{ id: 'x1', type: 'single_choice', content: { text: 'X' } }]
    });
    assert.equal(activeSourcesKeepOrder(), false);
});

test('an archived or switched-off source does not veto sequential mode', () => {
    AppState.sources.push({
        id: 'exam_archived_1700000002_ef', name: 'Archived', active: true, archived: true,
        keepOrder: false, questions: []
    });
    assert.equal(activeSourcesKeepOrder(), true);
});

test('the range picker offers one block per session-sized slice of the pool', () => {
    assert.deepEqual(buildRangeOptions(30, 10).map(b => b.label), ['1–10', '11–20', '21–30']);
    // A ragged tail is named honestly rather than rounded up.
    assert.deepEqual(buildRangeOptions(25, 10).map(b => b.label), ['1–10', '11–20', '21–25']);
    assert.deepEqual(buildRangeOptions(25, 10).map(b => b.start), [0, 10, 20]);
});

test('there is nothing to choose when the pool fits in one session', () => {
    assert.deepEqual(buildRangeOptions(10, 10), []);
    assert.deepEqual(buildRangeOptions(4, 10), []);
    // "All questions" is Infinity, which is never smaller than the pool.
    assert.deepEqual(buildRangeOptions(500, Infinity), []);
});

test('the pool is counted without rebuilding the test pool', () => {
    AppState.rawQuestions = [];
    AppState.questionMap = {};
    assert.equal(countActivePoolQuestions(), POOL_SIZE);
    assert.deepEqual(AppState.rawQuestions, [], 'counting must not write AppState');
    assert.deepEqual(AppState.questionMap, {}, 'counting must not write AppState');
});
