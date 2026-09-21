import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let AppState, initState;
let isLeech, isSuspended, setSuspended, toggleSuspended, countLeeches;
let LEECH_WRONG_THRESHOLD, LEECH_RECOVERY_STREAK;
let buildQuestionPool, updateStats, prepareFromCompositeIds, RETRY_MAX_RATING;
let mergeSyncData;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    const leech = await import('../src/core/leech.js');
    ({ isLeech, isSuspended, setSuspended, toggleSuspended, countLeeches,
       LEECH_WRONG_THRESHOLD, LEECH_RECOVERY_STREAK } = leech);

    const stateMod = await import('../src/core/state.js');
    AppState = stateMod.AppState;
    initState = stateMod.initState;
    initState();

    const engine = await import('../src/features/test/test-engine.js');
    ({ buildQuestionPool, updateStats, prepareFromCompositeIds, RETRY_MAX_RATING } = engine);

    mergeSyncData = (await import('../src/core/github-sync.js')).mergeSyncData;
});

const emptyPayload = (extra = {}) => ({
    sources: [], folders: [], stats: {}, recentTests: [], studyActivity: {},
    deletedSourceIds: [], deletedFolderIds: [], deletedQuickPresetIds: [], quickPresets: [],
    ...extra
});

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const sourceWith = (id, count) => ({
    id, name: id, active: true, archived: false,
    questions: Array.from({ length: count }, (_, i) => ({
        id: `q${i + 1}`, type: 'single_choice', text: `Q${i + 1}`,
        options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }],
        correctOptionIds: ['a']
    }))
});

beforeEach(() => {
    AppState.sources = [];
    AppState.stats = {};
    AppState.testTracking = null;
    AppState.currentTest = [];
});

// ── detection ───────────────────────────────────────────────────────────────

test('a question under the miss threshold is not stuck', () => {
    assert.equal(isLeech({ wrong: LEECH_WRONG_THRESHOLD - 1, streak: -3 }), false);
});

test('a question at the threshold that is still going wrong is stuck', () => {
    assert.equal(isLeech({ wrong: LEECH_WRONG_THRESHOLD, streak: -1 }), true);
});

test('a question that has recovered is not stuck any more', () => {
    // `wrong` only ever goes up, so the miss count alone can never clear
    // itself: a question the user has since fixed would stay flagged forever.
    // The current streak is what says the trouble is still live.
    assert.equal(isLeech({ wrong: 40, streak: LEECH_RECOVERY_STREAK }), false);
    assert.equal(isLeech({ wrong: 40, streak: LEECH_RECOVERY_STREAK - 1 }), true);
});

test('an already-suspended question is not reported as stuck', () => {
    // It has been dealt with; reporting it again would ask the user to decide
    // the same thing twice.
    assert.equal(isLeech({ wrong: 40, streak: -5, suspended: true }), false);
});

test('countLeeches counts only the stuck ones', () => {
    const stats = {
        a: { wrong: 9, streak: -2 },
        b: { wrong: 1, streak: -1 },
        c: { wrong: 12, streak: 4 },
        d: { wrong: 20, streak: 0 }
    };
    assert.equal(countLeeches(stats), 2);
});

// ── suspension ──────────────────────────────────────────────────────────────

test('suspending stamps, so the change can be merged', () => {
    const stat = {};
    setSuspended(stat, true, 1234);
    assert.equal(stat.suspended, true);
    assert.equal(stat.suspendedUpdatedAt, 1234);
});

test('un-suspending propagates - the direction that matters most', () => {
    // Without a stamp the other device writes `suspended: true` straight back
    // and the question never returns to rotation.
    const local = emptyPayload({ stats: { 's1_q1': { suspended: false, suspendedUpdatedAt: 2000 } } });
    const remote = emptyPayload({ stats: { 's1_q1': { suspended: true, suspendedUpdatedAt: 1000 } } });
    assert.equal(mergeSyncData(local, remote).stats['s1_q1'].suspended, false);
});

test('suspending propagates the other way too', () => {
    const local = emptyPayload({ stats: { 's1_q1': { suspended: false } } });
    const remote = emptyPayload({ stats: { 's1_q1': { suspended: true, suspendedUpdatedAt: 1000 } } });
    assert.equal(mergeSyncData(local, remote).stats['s1_q1'].suspended, true);
});

test('toggleSuspended flips and re-stamps', () => {
    const stat = {};
    toggleSuspended(stat, 10);
    assert.equal(isSuspended(stat), true);
    toggleSuspended(stat, 20);
    assert.equal(isSuspended(stat), false);
    assert.equal(stat.suspendedUpdatedAt, 20);
});

// ── the pool ────────────────────────────────────────────────────────────────

test('a suspended question is not drawn for a test', () => {
    AppState.sources = [sourceWith('s1', 3)];
    setSuspended(AppState.stats['s1_q2'] = {}, true);
    const pool = buildQuestionPool();
    assert.deepEqual(pool.map(q => q.id), ['q1', 'q3']);
});

test('a suspended question stays in the map, so the stats screen keeps it', () => {
    // Suspension takes a question out of rotation and out of nothing else -
    // every figure it has is untouched and the user can still open it.
    AppState.sources = [sourceWith('s1', 3)];
    setSuspended(AppState.stats['s1_q2'] = { correct: 4, wrong: 11 }, true);
    buildQuestionPool();
    assert.ok(AppState.questionMap['s1_q2'], 'the question vanished from the app entirely');
    assert.equal(AppState.stats['s1_q2'].correct, 4, 'suspension must not touch a single statistic');
    assert.equal(AppState.stats['s1_q2'].wrong, 11);
});

test('un-suspending brings the question straight back', () => {
    AppState.sources = [sourceWith('s1', 2)];
    const stat = AppState.stats['s1_q1'] = {};
    setSuspended(stat, true);
    assert.equal(buildQuestionPool().length, 1);
    setSuspended(stat, false);
    assert.equal(buildQuestionPool().length, 2);
});

// ── the retry round ─────────────────────────────────────────────────────────

test('a right answer in a retry round is rated a recovery, not a success', () => {
    AppState.sources = [sourceWith('s1', 1)];
    buildQuestionPool();

    // First: get it wrong, the ordinary way.
    AppState.testTracking = { results: [] };
    updateStats('s1', 'q1', false, ['b']);
    const afterMiss = { ...AppState.stats['s1_q1'] };

    // Now the same question, right, inside a retry round.
    AppState.stats['s1_q1'] = { ...afterMiss, lastReview: null, stability: 0 };
    AppState.testTracking = { results: [], retryRound: true };
    updateStats('s1', 'q1', true, ['a']);
    const retryStability = AppState.stats['s1_q1'].stability;

    // And the same question, right, in an ordinary session.
    AppState.stats['s1_q1'] = { ...afterMiss, lastReview: null, stability: 0 };
    AppState.testTracking = { results: [] };
    updateStats('s1', 'q1', true, ['a']);
    const plainStability = AppState.stats['s1_q1'].stability;

    assert.ok(
        retryStability < plainStability,
        'a question recovered on the second look must not be scheduled as far out as one answered right first time'
    );
});

test('Easy cannot lift a retry answer back to a full success', () => {
    AppState.sources = [sourceWith('s1', 1)];
    buildQuestionPool();
    AppState.testTracking = { results: [], retryRound: true };
    updateStats('s1', 'q1', true, ['a'], 'easy');
    const easyStability = AppState.stats['s1_q1'].stability;

    AppState.stats['s1_q1'] = undefined;
    delete AppState.stats['s1_q1'];
    AppState.testTracking = { results: [], retryRound: true };
    updateStats('s1', 'q1', true, ['a']);
    assert.equal(
        AppState.stats['s1_q1'].stability, easyStability,
        'the cap is a ceiling: Easy in a retry round is still a recovery'
    );
});

test('the cap does not touch a wrong answer', () => {
    // A miss is rated 1 either way; capping at 2 must not soften it.
    AppState.sources = [sourceWith('s1', 1)];
    buildQuestionPool();
    AppState.testTracking = { results: [], retryRound: true };
    updateStats('s1', 'q1', false, ['b']);
    const retryStability = AppState.stats['s1_q1'].stability;

    delete AppState.stats['s1_q1'];
    AppState.testTracking = { results: [] };
    updateStats('s1', 'q1', false, ['b']);
    assert.equal(AppState.stats['s1_q1'].stability, retryStability);
});

test('an ordinary session is not a retry round', () => {
    AppState.sources = [sourceWith('s1', 2)];
    buildQuestionPool();
    prepareFromCompositeIds(['s1_q1', 's1_q2'], {});
    assert.ok(!AppState.testTracking.retryRound);
});

test('a session asked for as a retry round says so', () => {
    AppState.sources = [sourceWith('s1', 2)];
    buildQuestionPool();
    prepareFromCompositeIds(['s1_q1'], { retryRound: true });
    assert.equal(AppState.testTracking.retryRound, true);
});

test('RETRY_MAX_RATING is Hard - FSRS already has a word for this', () => {
    assert.equal(RETRY_MAX_RATING, 2);
});

// ── the screen ──────────────────────────────────────────────────────────────

test('the Stuck filter exists in the bar and is translated in all three', async () => {
    const html = read('../index.html');
    assert.ok(/data-filter="leech"/.test(html), 'no Stuck button in statsFilterBar');
    const { translations } = await import('../src/core/i18n.js');
    ['tr', 'en', 'de'].forEach(lang => {
        ['filter_leech', 'leech_info_title', 'leech_info_body', 'leech_empty',
         'suspend_question', 'unsuspend_question', 'retry_round_start'].forEach(key => {
            assert.ok(translations[lang][key], `${lang}.${key} is missing`);
        });
    });
});

test('the Stuck filter keeps suspended questions on screen', () => {
    // Suspending from this screen must not make the row vanish, or the user
    // cannot undo what they just did.
    const src = read('../src/features/stats/stats-module.js');
    assert.ok(
        /filter === 'leech' && !isLeech\(s\) && !isSuspended\(s\)/.test(src),
        'the filter drops suspended rows, so un-suspending is unreachable'
    );
});

test('the retry button is offered only when something was missed', () => {
    const src = read('../src/features/test/test-ui.js');
    assert.ok(/missed > 0 \? '' : 'none'/.test(src), 'the retry button is shown with nothing to retry');
});
