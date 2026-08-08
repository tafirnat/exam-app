import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let AppState,
    UNCATEGORIZED_FOLDER_ID,
    buildStreakRun,
    resolveStreakCount,
    MIN_STREAK_QUESTIONS,
    shuffleArraySeeded,
    calculateRetrievability;

const DAY = 24 * 60 * 60 * 1000;

/* Every question in one library is dated from a single instant.
 *
 * Reading the clock per question looked equivalent and was not: two questions
 * both seeded "20 days ago" land 1ms apart whenever the calls straddle a
 * millisecond boundary, and calculateRetrievability turns that into R values
 * differing by ~1e-10. Cases that seed equal `due` values to reach the *next*
 * sort key - difficulty, then id - then never reach it, because R already
 * separated the questions. It failed roughly one full-suite run in three and
 * never on its own, which is the worst way for a test to be wrong. */
function isoFrom(now, daysAgo) {
    return new Date(now - daysAgo * DAY).toISOString();
}

/**
 * Builds a library from a compact spec:
 *   src('A', 'f1', [ { id: 1, due: 20 }, { id: 2, fresh: true } ])
 * `due` is how many days ago the question was last reviewed; with stability 10
 * anything past 10 days is overdue, anything under it is upcoming.
 */
function src(id, folderId, questions, { active = true } = {}) {
    return {
        id,
        name: id,
        folderId,
        active,
        questions: questions.map(q => ({ id: q.id })),
        _spec: questions
    };
}

function seed(sources, folders = []) {
    const now = Date.now();
    AppState.folders = [
        { id: UNCATEGORIZED_FOLDER_ID, name: 'Kategorisiz', isSystem: true, order: 99 },
        ...folders
    ];
    AppState.sources = sources;
    AppState.stats = {};
    AppState.continuityConfig = { focusSources: [] };

    sources.forEach(s => {
        s._spec.forEach(q => {
            if (q.fresh) return; // no stat record at all -> never reviewed
            AppState.stats[`${s.id}_${q.id}`] = {
                stability: q.stability ?? 10,
                difficulty: q.difficulty ?? 5,
                learned: !!q.learned,
                lastReview: isoFrom(now, q.due)
            };
        });
    });
}

/** Source ids in the order the run presents them. */
function sourceOrder(ids) {
    return ids.map(k => k.split('_')[0]);
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

    const utilsMod = await import('../src/core/utils.js');
    shuffleArraySeeded = utilsMod.shuffleArraySeeded;

    calculateRetrievability = (await import('../src/features/test/test-engine.js')).calculateRetrievability;

    const runMod = await import('../src/features/stats/streak-run.js');
    buildStreakRun = runMod.buildStreakRun;
    resolveStreakCount = runMod.resolveStreakCount;
    MIN_STREAK_QUESTIONS = runMod.MIN_STREAK_QUESTIONS;
});

beforeEach(() => {
    AppState.sources = [];
    AppState.stats = {};
    AppState.studyActivity = {};
});

test('resolveStreakCount floors at 15 but respects a larger user preference', () => {
    assert.equal(resolveStreakCount(5), MIN_STREAK_QUESTIONS);
    assert.equal(resolveStreakCount(15), MIN_STREAK_QUESTIONS);
    assert.equal(resolveStreakCount(40), 40);
    assert.equal(resolveStreakCount(undefined), MIN_STREAK_QUESTIONS);
    assert.equal(resolveStreakCount('30'), 30);
    assert.equal(resolveStreakCount(NaN), MIN_STREAK_QUESTIONS);
});

test('mixed order puts the most overdue question first', () => {
    seed([
        src('A', 'f1', [{ id: 1, due: 12 }, { id: 2, due: 40 }]),
        src('B', 'f1', [{ id: 1, due: 25 }])
    ]);

    const ids = buildStreakRun({ order: 'mixed', count: 3 });
    // 40 days elapsed is the lowest retrievability, 12 the highest.
    assert.deepEqual(ids, ['A_2', 'B_1', 'A_1']);
});

test('the run ignores whether a source is active', () => {
    seed([
        src('A', 'f1', [{ id: 1, due: 12 }], { active: true }),
        src('B', 'f1', [{ id: 1, due: 40 }], { active: false })
    ]);

    const ids = buildStreakRun({ order: 'mixed', count: 5 });
    assert.ok(ids.includes('B_1'), 'inactive source must still be scheduled');
    assert.equal(ids[0], 'B_1', 'and it must keep its urgency ranking');
});

test('archived sources are excluded outright', () => {
    const sources = [
        src('A', 'f1', [{ id: 1, due: 12 }]),
        src('B', 'f1', [{ id: 1, due: 40 }])
    ];
    sources[1].archived = true;
    seed(sources);

    const ids = buildStreakRun({ order: 'mixed', count: 5 });
    assert.deepEqual(ids, ['A_1']);
});

/* `learned` used to drop a question from the run outright, which meant FSRS
   could push a question to a 40-day interval and then never ask it again - the
   widening interval is the whole mechanism, so the flag was cancelling the
   thing it was meant to reward. Due now wins; the flag only decides who fills
   a run that has no backlog left. */

test('a due question is scheduled even when it is marked learned', () => {
    seed([
        src('A', 'f1', [{ id: 1, due: 40, learned: true }, { id: 2, due: 12 }])
    ]);

    const ids = buildStreakRun({ order: 'mixed', count: 5 });
    assert.deepEqual(ids, ['A_1', 'A_2'], 'and it leads, being the more overdue of the two');
});

test('a learned question that is not due yet stays out of the filler', () => {
    // stability 10, reviewed 5 days ago -> R ~0.95, above the 0.9 due line.
    seed([
        src('A', 'f1', [{ id: 1, due: 5, learned: true }, { id: 2, due: 5 }])
    ]);

    const ids = buildStreakRun({ order: 'mixed', count: 5 });
    assert.deepEqual(ids, ['A_2'], 'a slot with nothing due belongs to unconsolidated material');
});

/* R is the primary sort key everywhere, and calculateRetrievability() used to
   read the clock itself on every call. Two questions with the same stability
   and the same lastReview therefore came out ~1e-10 apart whenever the loop
   crossed a millisecond, so the tie-breakers behind R - difficulty descending,
   then id - were only reached when the clock happened not to tick. The case
   below is the one that noticed, and it noticed by failing about one full-suite
   run in three while passing every time on its own. */

test('two identical questions measured in one pass get identical R', () => {
    const lastReview = new Date(Date.now() - 20 * DAY).toISOString();
    const at = Date.now();

    // The same instant for both, which is what every looping caller now passes.
    const first = calculateRetrievability(10, lastReview, at);
    const second = calculateRetrievability(10, lastReview, at);

    assert.equal(first, second);
});

test('a millisecond between two reads is enough to separate them', () => {
    // Why the parameter has to exist at all: this is the gap that used to open
    // up inside a single pass over the library.
    const lastReview = new Date(Date.now() - 20 * DAY).toISOString();
    const at = Date.now();

    assert.notEqual(
        calculateRetrievability(10, lastReview, at),
        calculateRetrievability(10, lastReview, at + 1));
});

test('the run measures the whole pass at one instant', () => {
    seed([
        src('A', 'f1', [
            { id: 1, due: 20, difficulty: 3 },
            { id: 2, due: 20, difficulty: 9 },
            { id: 3, due: 20, difficulty: 6 }
        ])
    ]);

    /* The clock made to tick on every read, which is the whole defect forced
       into the open. Waiting for a real millisecond boundary is not a test - it
       is a race that a fast machine wins, and this one did: reverting the fix
       left a repeat-200-times version of this case perfectly green.

       With one instant per pass all three questions keep the same R and the
       run falls through to the documented tie-breakers. Reading the clock per
       question instead makes each successive question look staler than the last,
       so the run comes back in evaluation order and difficulty never gets a say. */
    const realNow = Date.now;
    let tick = realNow();
    Date.now = () => ++tick;

    try {
        assert.deepEqual(buildStreakRun({ order: 'mixed', count: 3 }), ['A_2', 'A_3', 'A_1']);
    } finally {
        Date.now = realNow;
    }
});

test('equal retrievability breaks on difficulty, then id - never on library order', () => {
    seed([
        src('A', 'f1', [
            { id: 1, due: 20, difficulty: 3 },
            { id: 2, due: 20, difficulty: 9 },
            { id: 3, due: 20, difficulty: 6 }
        ])
    ]);

    const ids = buildStreakRun({ order: 'mixed', count: 3 });
    // Same R across all three, so the harder question leads.
    assert.deepEqual(ids, ['A_2', 'A_3', 'A_1']);
});

test('new questions get a reserved share even when the backlog is large', () => {
    const overdue = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, due: 30 }));
    const fresh = Array.from({ length: 20 }, (_, i) => ({ id: 100 + i, fresh: true }));
    seed([src('A', 'f1', [...overdue, ...fresh])]);

    const ids = buildStreakRun({ order: 'mixed', count: 15 });
    const freshCount = ids.filter(k => Number(k.split('_')[1]) >= 100).length;

    assert.equal(ids.length, 15);
    // 20% of 15 = 3 slots held back for questions never seen before.
    assert.equal(freshCount, 3);
});

test('the new-question slice is stable within a day and moves on the next', () => {
    const fresh = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, fresh: true }));
    seed([src('A', 'f1', fresh)]);

    const monday = buildStreakRun({ order: 'mixed', count: 15, seed: '2026-08-01' });
    const mondayAgain = buildStreakRun({ order: 'mixed', count: 15, seed: '2026-08-01' });
    const tuesday = buildStreakRun({ order: 'mixed', count: 15, seed: '2026-08-02' });

    // Reopening an interrupted session must rebuild the identical list.
    assert.deepEqual(monday, mondayAgain);
    assert.notDeepEqual(monday, tuesday);
});

test('a fresh-only library still fills the session instead of returning nothing', () => {
    const fresh = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, fresh: true }));
    seed([src('A', 'f1', fresh)]);

    assert.equal(buildStreakRun({ order: 'mixed', count: 15 }).length, 15);
});

test('upcoming questions are filler only, nearest due first', () => {
    seed([
        src('A', 'f1', [
            { id: 1, due: 40 },          // overdue
            { id: 2, due: 1 },           // far from due
            { id: 3, due: 8 }            // approaching
        ])
    ]);

    const ids = buildStreakRun({ order: 'mixed', count: 3 });
    assert.deepEqual(ids, ['A_1', 'A_3', 'A_2']);
});

test('a short pool returns what exists rather than padding', () => {
    seed([src('A', 'f1', [{ id: 1, due: 20 }])]);
    assert.equal(buildStreakRun({ order: 'mixed', count: 15 }).length, 1);
});

test('an empty library returns an empty run', () => {
    seed([]);
    assert.deepEqual(buildStreakRun({ order: 'mixed', count: 15 }), []);
});

test('grouped order keeps a source together and follows its folder', () => {
    seed([
        // Most urgent question lives in B, so B's folder leads.
        src('A', 'f1', [{ id: 1, due: 14 }, { id: 2, due: 13 }]),
        src('B', 'f2', [{ id: 1, due: 40 }]),
        src('C', 'f2', [{ id: 1, due: 20 }, { id: 2, due: 12 }])
    ], [
        { id: 'f1', name: 'Dersler', order: 0 },
        { id: 'f2', name: 'Sinav', order: 1 }
    ]);

    const ids = buildStreakRun({ order: 'grouped', count: 10 });
    const order = sourceOrder(ids);

    // f2 first (it holds the most urgent question), B before C inside it,
    // and no source is interleaved with another.
    assert.deepEqual(order, ['B', 'C', 'C', 'A', 'A']);
});

test('grouped order caps a single source at a third of the session', () => {
    // A holds the most urgent questions and enough of them to swallow the run;
    // B and C are less urgent but deep enough to take the slots the cap frees.
    const deck = (dueDays) => Array.from({ length: 30 }, (_, i) => ({ id: i + 1, due: dueDays }));
    seed([
        src('A', 'f1', deck(40)),
        src('B', 'f2', deck(30)),
        src('C', 'f3', deck(28))
    ], [
        { id: 'f1', name: 'F1', order: 0 },
        { id: 'f2', name: 'F2', order: 1 },
        { id: 'f3', name: 'F3', order: 2 }
    ]);

    const ids = buildStreakRun({ order: 'grouped', count: 15 });
    const counts = {};
    sourceOrder(ids).forEach(s => { counts[s] = (counts[s] || 0) + 1; });

    assert.equal(ids.length, 15);
    // ceil(15/3) = 5 from A, so B and C actually make it into the session.
    assert.equal(counts.A, 5);
    assert.ok(counts.B > 0 && counts.C > 0);
});

test('the cap lifts when no other source can fill the session', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, due: 40 }));
    seed([src('A', 'f1', many)]);

    const ids = buildStreakRun({ order: 'grouped', count: 15 });
    // A is all there is - a short run would be worse than exceeding the cap.
    assert.equal(ids.length, 15);
});

test('sources without a folder are grouped under Uncategorized, not dropped', () => {
    seed([
        src('A', null, [{ id: 1, due: 40 }]),
        src('B', 'f1', [{ id: 1, due: 20 }])
    ], [{ id: 'f1', name: 'Dersler', order: 0 }]);

    const ids = buildStreakRun({ order: 'grouped', count: 10 });
    assert.deepEqual(sourceOrder(ids), ['A', 'B']);
});

test('both orders select the same questions and differ only in sequence', () => {
    seed([
        src('A', 'f1', [{ id: 1, due: 14 }, { id: 2, due: 40 }]),
        src('B', 'f2', [{ id: 1, due: 25 }, { id: 2, due: 12 }])
    ], [
        { id: 'f1', name: 'F1', order: 0 },
        { id: 'f2', name: 'F2', order: 1 }
    ]);

    const mixed = buildStreakRun({ order: 'mixed', count: 4 });
    const grouped = buildStreakRun({ order: 'grouped', count: 4 });

    assert.deepEqual([...mixed].sort(), [...grouped].sort());
    assert.notDeepEqual(mixed, grouped);
});

test('focus scope draws only from the selected focus sources', () => {
    seed([
        src('A', 'f1', [{ id: 1, due: 40 }]),
        src('B', 'f1', [{ id: 1, due: 20 }])
    ]);
    AppState.continuityConfig = { focusSources: ['B'] };

    const ids = buildStreakRun({ scope: 'focus', order: 'mixed', count: 10 });
    assert.deepEqual(ids, ['B_1']);
});

test('focus scope with no selection returns an empty run', () => {
    seed([src('A', 'f1', [{ id: 1, due: 40 }])]);
    AppState.continuityConfig = { focusSources: [] };

    assert.deepEqual(buildStreakRun({ scope: 'focus', count: 10 }), []);
});

test('shuffleArraySeeded is deterministic and preserves membership', () => {
    const input = Array.from({ length: 25 }, (_, i) => i);

    assert.deepEqual(shuffleArraySeeded(input, 'x'), shuffleArraySeeded(input, 'x'));
    assert.notDeepEqual(shuffleArraySeeded(input, 'x'), shuffleArraySeeded(input, 'y'));
    assert.deepEqual([...shuffleArraySeeded(input, 'x')].sort((a, b) => a - b), input);
    assert.deepEqual(input, Array.from({ length: 25 }, (_, i) => i), 'must not mutate its input');
});
