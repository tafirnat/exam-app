import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/* prepareTest is the manual study path - the one most sessions go through -
   and it had no coverage at all, which is how the rule below went unexamined.

   FSRS earns a question a widening interval; `learned` used to remove it from
   selection entirely, so past `stability > 30` the schedule it had just earned
   was never honoured and the question left circulation for good. The flag now
   only ranks questions that are NOT due: due material is served whatever the
   flag says, and consolidated material stays out of the filler so a session
   with no backlog reaches for new and weak questions instead. */

const DAY = 86400e3;

let AppState, prepareTest, getCurrentOverdueCount, applyFocusPools;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    ({ AppState } = await import('../src/core/state.js'));
    ({ prepareTest } = await import('../src/features/test/test-engine.js'));
    ({ getCurrentOverdueCount, applyFocusPools } = await import('../src/features/stats/continuity-engine.js'));
});

/** `due` is days since the last review; with stability 10 anything past 10 days
    is overdue and anything under it is not. `fresh` leaves no stat at all. */
function seed(questions) {
    const now = Date.now();
    AppState.sources = [{
        id: 'S', name: 'Konu', active: true, questions: questions.map(q => ({ id: q.id }))
    }];
    AppState.stats = {};
    AppState.studyActivity = {};
    AppState.continuityConfig = { focusSources: [], focusPools: [] };
    questions.forEach(q => {
        if (q.fresh) return;
        AppState.stats[`S_${q.id}`] = {
            stability: q.stability ?? 10,
            difficulty: q.difficulty ?? 5,
            coeff: (q.difficulty ?? 5) / 2,
            learned: !!q.learned,
            lastReview: new Date(now - q.due * DAY).toISOString()
        };
    });
}

beforeEach(() => {
    AppState.quickPresets = [];
});

/* The library carries enough not-due material to fill a session, so the last
   resort - "nothing else exists, hand over whatever is left" - cannot fire. A
   learned question reaching the session therefore proves the overdue pool took
   it, which is the rule. Without that ballast the fallback rescues the question
   on its own and the case passes with the rule reverted. */
test('a due question is selected even when it is marked learned', () => {
    seed([
        { id: 1, due: 40, learned: true },
        { id: 2, due: 2 },
        { id: 3, due: 2 },
        { id: 4, due: 2 }
    ]);

    assert.deepEqual(prepareTest(1), ['S_1'], 'the most overdue question opens the session');
});

/* The consolidated question is the only thing left once the backlog is gone.
   Serving it anyway would re-drill what already holds while `fresh` waits. */
test('a learned question that is not due yet is left for last', () => {
    seed([
        { id: 1, due: 2, learned: true },
        { id: 2, fresh: true }
    ]);

    const picked = prepareTest(1);

    assert.deepEqual(picked, ['S_2'], 'the unseen question is the better use of the slot');
});

/* With nothing else to offer, the final fallback still hands it over rather
   than returning a short test - a study session that refuses to start is worse
   than one that repeats a well-known question. */
test('with nothing else available the learned question is still served', () => {
    seed([{ id: 1, due: 2, learned: true }]);

    assert.deepEqual(prepareTest(5), ['S_1']);
});

/* Focus pools inject their own quota on top of the ordinary selection, on the
   same rule - otherwise a user who pinned a topic would find its due questions
   silently withheld the moment they consolidated, which is the failure this
   whole change is about, reappearing through a second door. */

const item = (id, { overdue = false, learned = false, r = 0.5 } = {}) => ({
    q: { sourceId: 'S', id },
    isOverdue: overdue,
    learned,
    retrievability: r
});

test('a focus pool injects a due question that is marked learned', () => {
    AppState.sources = [{ id: 'S', active: true, questions: [] }];
    AppState.continuityConfig = { focusPools: [{ targetId: 'S', count: 1 }] };

    const result = applyFocusPools([], [item(1, { overdue: true, learned: true })]);

    assert.equal(result.length, 1, 'due material is the point of pinning a topic');
});

test('a focus pool passes over a learned question that is not due', () => {
    AppState.sources = [{ id: 'S', active: true, questions: [] }];
    AppState.continuityConfig = { focusPools: [{ targetId: 'S', count: 2 }] };

    const result = applyFocusPools([], [
        item(1, { learned: true, r: 0.95 }),
        item(2, { learned: false, r: 0.96 })
    ]);

    assert.deepEqual(result.map(i => i.q.id), [2], 'the quota goes to unconsolidated material');
});

/* The day's bar is measured from the same overdue set the pools serve. While
   the count skipped learned questions and selection did too they agreed; if
   only one of them changed, the bar would either ask for work the app would
   not hand over, or hide work it was about to. */
test('the overdue count admits the same questions selection does', () => {
    seed([
        { id: 1, due: 40, learned: true },
        { id: 2, due: 12 },
        { id: 3, due: 2, learned: true },
        { id: 4, fresh: true }
    ]);

    const picked = prepareTest(10);
    const overdue = getCurrentOverdueCount(AppState.rawQuestions);

    assert.equal(overdue, 2, 'both questions past the 0.9 line count, learned or not');
    assert.ok(picked.includes('S_1') && picked.includes('S_2'), 'and both are served');
});
