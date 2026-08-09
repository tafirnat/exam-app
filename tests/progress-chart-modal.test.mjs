import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

/* The panel behind the home progress bar (#progressChartOverlay).
 *
 * It used to run a private copy of the trend arithmetic, and the copy had gone
 * stale in two ways that no test could see:
 *
 *   - it read `act.questionLog`, a field that has lived inside
 *     act.byDevice[device] since a day became per-device counting, so the
 *     source-filtered chart drew "no data" for sources with months of work
 *     behind them;
 *   - it split the log key on '_' to find the source id, and an id looks like
 *     `exam_<slug>_<ts>_<rand>`, so that split returns "exam" for every source
 *     in the library and matches none of them;
 *   - it built its day keys from the device clock while studyActivity is
 *     written in the app's day zone.
 *
 * And nothing redrew it: the panel was painted on open and by nothing else, so
 * it froze the moment it appeared.
 *
 * The bar arithmetic itself is covered by trend-card.test.mjs. What is pinned
 * here is the source filter, the day range, and the fact that a data change
 * reaches an open panel. */

let AppState, buildDailyTrendBuckets, makeSourceLogFilter,
    showProgressCharts, refreshProgressChartOverlay, resetModalDifficultyViewId,
    getLocalDateStr, shiftDateStr;

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// One parse of index.html, used both as the markup under inspection and as the
// DOM the renderers draw into - a second JSDOM of a file this size costs more
// than the rest of this suite put together.
let markup;

before(async () => {
    const dom = new JSDOM(html, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
    markup = dom.window.document;

    /* jsdom has no 2d context. The completion bar is canvas, the two charts
       under it are not - stubbing this is what proves they are drawn by the
       same pass and survive the bar failing. */
    dom.window.HTMLCanvasElement.prototype.getContext = () => null;

    ({ AppState } = await import('../src/core/state.js'));
    ({ getLocalDateStr, shiftDateStr } = await import('../src/core/daily-activity.js'));

    const uiMod = await import('../src/features/stats/continuity-ui.js');
    buildDailyTrendBuckets = uiMod.buildDailyTrendBuckets;
    makeSourceLogFilter = uiMod.makeSourceLogFilter;
    resetModalDifficultyViewId = uiMod.resetModalDifficultyViewId;

    const statsMod = await import('../src/features/stats/stats-module.js');
    showProgressCharts = statsMod.showProgressCharts;
    refreshProgressChartOverlay = statsMod.refreshProgressChartOverlay;
});

// ── Markup ──────────────────────────────────────────────────────────────────

test('the panel carries both trend faces and every chart container', () => {
    const card = markup.getElementById('modalWeeklyTrendCard');
    assert.ok(card, '#modalWeeklyTrendCard is missing from index.html');

    const front = card.querySelector('.chart-flip-front');
    const back = card.querySelector('.chart-flip-back');
    assert.ok(front && back, 'both faces must exist');

    for (const id of ['modalWeeklyTrendYAxis', 'modalWeeklyTrendBars', 'modalWeeklyTrendXAxis']) {
        assert.ok(front.querySelector(`#${id}`), `#${id} must live on the weekly face`);
    }
    for (const id of ['modalMonthlyTrendYAxis', 'modalMonthlyTrendBars', 'modalMonthlyTrendXAxis']) {
        assert.ok(back.querySelector(`#${id}`), `#${id} must live on the monthly face`);
    }

    assert.equal(card.querySelectorAll('[data-modal-trend-flip]').length, 2, 'each face needs its own flip button');
});

test('each face names its two line series in a legend', () => {
    const card = markup.getElementById('modalWeeklyTrendCard');

    for (const [face, legendId] of [
        ['.chart-flip-front', 'modalWeeklyTrendLegend'],
        ['.chart-flip-back', 'modalMonthlyTrendLegend']
    ]) {
        const legend = card.querySelector(face).querySelector(`#${legendId}`);
        assert.ok(legend, `#${legendId} must live on the ${face} face`);
        assert.ok(legend.querySelector('.trend-legend-swatch.is-normal'), 'the normal series needs a swatch');
        assert.ok(legend.querySelector('.trend-legend-swatch.is-focus'), 'the focus series needs a swatch');
        assert.equal(legend.querySelectorAll('[data-i18n]').length, 2, 'both series need a translated label');
    }
});

// ── Which source a log row belongs to ───────────────────────────────────────

const EXAM_A = 'exam_matematik_lz9k2_a1b2';
const EXAM_B = 'exam_fizik_lz9k3_c3d4';

test('a source id with underscores in it still matches its own rows', () => {
    const filter = makeSourceLogFilter([EXAM_A], [EXAM_A, EXAM_B]);

    assert.equal(filter(`${EXAM_A}_17`), true, 'the key belongs to this source');
    assert.equal(filter(`${EXAM_B}_17`), false, "and not to the library's other source");
});

test('an id that prefixes another cannot claim its rows', () => {
    // 'exam_bio' is a genuine prefix of 'exam_bio_ek', so a first-match walk
    // would hand the second source's questions to the first.
    const filter = makeSourceLogFilter(['exam_bio'], ['exam_bio', 'exam_bio_ek']);

    assert.equal(filter('exam_bio_4'), true);
    assert.equal(filter('exam_bio_ek_4'), false, 'the longer id owns this key');
});

test('no filter means count everything', () => {
    assert.equal(makeSourceLogFilter(null), null);
});

// ── Filtered bars ───────────────────────────────────────────────────────────

const dayWithLog = (log, counts) => ({
    ...counts,
    byDevice: { phone: { ...counts, questionLog: log } }
});

test('a filtered bar counts only the questions of its own source', () => {
    const today = getLocalDateStr();
    const activities = {
        [today]: dayWithLog({
            [`${EXAM_A}_1`]: { correct: 1, wrong: 0, empty: 0, isFocus: false },
            [`${EXAM_A}_2`]: { correct: 0, wrong: 1, empty: 0, isFocus: false },
            [`${EXAM_B}_1`]: { correct: 1, wrong: 0, empty: 0, isFocus: false }
        }, { questionCount: 3, correctCount: 2, wrongCount: 1 })
    };

    const logFilter = makeSourceLogFilter([EXAM_A], [EXAM_A, EXAM_B]);
    const last = buildDailyTrendBuckets(activities, 7, { logFilter }).at(-1);

    assert.equal(last.total, 2, "the other source's question must not reach this bar");
    assert.equal(last.correct, 1);
    assert.equal(last.wrong, 1);
});

test('a filtered bar reads its volume and its tooltip off the same log', () => {
    const today = getLocalDateStr();
    const activities = {
        [today]: dayWithLog({
            [`${EXAM_A}_1`]: { correct: 2, wrong: 1, empty: 0, isFocus: true },
            [`${EXAM_B}_1`]: { correct: 9, wrong: 9, empty: 9, isFocus: false }
        }, { questionCount: 30, correctCount: 11, wrongCount: 10, unansweredCount: 9, focusQuestionCount: 30 })
    };

    const logFilter = makeSourceLogFilter([EXAM_A], [EXAM_A, EXAM_B]);
    const last = buildDailyTrendBuckets(activities, 7, { logFilter }).at(-1);

    assert.equal(last.total, 1, 'three answers to one question are one question');
    assert.equal(last.volumeTotal, 3, "the line must not borrow the day's total");
    assert.equal(last.volumeFocus, 3, 'the focus line follows the log rows flagged as focus');
    assert.deepEqual(
        { correct: last.effortCorrect, wrong: last.effortWrong, empty: last.effortEmpty },
        { correct: 2, wrong: 1, empty: 0 },
        "the tooltip figures must exclude the other source's answers"
    );
});

test('a day nobody can attribute is left out of a filtered bar, not guessed at', () => {
    const today = getLocalDateStr();
    // Written before the per-question log existed: a total, and nothing saying
    // which source earned it. Borrowing it would draw another source's work.
    const activities = { [today]: { questionCount: 12, correctCount: 12 } };

    const logFilter = makeSourceLogFilter([EXAM_A], [EXAM_A]);
    const last = buildDailyTrendBuckets(activities, 7, { logFilter }).at(-1);

    assert.equal(last.total, 0);
    assert.equal(last.volumeTotal, 0);
});

test('the unfiltered bar still reads the whole day', () => {
    const today = getLocalDateStr();
    const activities = {
        [today]: dayWithLog({
            [`${EXAM_A}_1`]: { correct: 1, wrong: 0, empty: 0, isFocus: false },
            [`${EXAM_B}_1`]: { correct: 1, wrong: 0, empty: 0, isFocus: false }
        }, { questionCount: 2, correctCount: 2 })
    };

    const last = buildDailyTrendBuckets(activities, 7, { logFilter: null }).at(-1);
    assert.equal(last.total, 2);
});

// ── The day range ───────────────────────────────────────────────────────────

test('the long face spans thirty days and keys them in the app day zone', () => {
    const today = getLocalDateStr();
    const activities = {
        [today]: { questionCount: 4, correctCount: 4 },
        [shiftDateStr(today, -29)]: { questionCount: 7, correctCount: 7 },
        [shiftDateStr(today, -30)]: { questionCount: 99, correctCount: 99 }
    };

    const buckets = buildDailyTrendBuckets(activities, 30);

    assert.equal(buckets.length, 30);
    assert.equal(buckets.at(-1).total, 4, 'today is the last column');
    assert.equal(buckets[0].total, 7, 'and the thirtieth day back is the first');
    assert.equal(buckets.reduce((sum, b) => sum + b.total, 0), 11, 'the day before the window is out');
});

test('a thirty-day face labels its columns by day of the month', () => {
    const buckets = buildDailyTrendBuckets({}, 30);
    assert.ok(buckets.every(b => /^\d{2}$/.test(b.label)), `expected day numbers, got ${buckets.map(b => b.label).join(',')}`);
});

// ── The panel redraws while it is open ──────────────────────────────────────

const openPanel = () => { document.getElementById('progressChartOverlay').style.display = 'flex'; };
const closePanel = () => { document.getElementById('progressChartOverlay').style.display = 'none'; };
// The strip also holds the line overlay, so the columns are counted by class.
const bars = () => [...document.getElementById('modalWeeklyTrendBars').querySelectorAll('.trend-bar-wrapper')];
const barHeights = () => bars().map(w => w.querySelector('.trend-bar-inner')?.style.height || '');

beforeEach(() => {
    AppState.folders = [];
    AppState.stats = {};
    AppState.studyActivity = {};
    AppState.sources = [{
        id: EXAM_A, name: 'Matematik', active: true, order: 0,
        questions: [{ id: 1 }, { id: 2 }, { id: 3 }]
    }];
    resetModalDifficultyViewId();
    document.getElementById('modalWeeklyTrendBars').innerHTML = '';
    closePanel();
});

test('an open panel picks up a day that was not there when it opened', () => {
    openPanel();
    showProgressCharts();
    const before = barHeights();

    AppState.studyActivity = {
        [getLocalDateStr()]: dayWithLog(
            { [`${EXAM_A}_1`]: { correct: 1, wrong: 0, empty: 0, isFocus: false } },
            { questionCount: 1, correctCount: 1 }
        )
    };
    refreshProgressChartOverlay();
    const after = barHeights();

    assert.equal(bars().length, 7, 'a week of columns');
    assert.notDeepEqual(after, before, "today's bar must grow without the panel being reopened");
    assert.notEqual(after.at(-1), '', "and it is today's column that grew");
});

test('a closed panel is not redrawn', () => {
    closePanel();
    refreshProgressChartOverlay();

    assert.equal(bars().length, 0, 'drawing a hidden panel is pure waste');
});

test('the completion bar failing does not take the trend down with it', () => {
    // getContext is stubbed to null for the whole file, so this pass has
    // already lost the canvas chart. The DOM charts must still land.
    openPanel();
    AppState.studyActivity = {
        [getLocalDateStr()]: dayWithLog(
            { [`${EXAM_A}_1`]: { correct: 1, wrong: 0, empty: 0, isFocus: false } },
            { questionCount: 1, correctCount: 1 }
        )
    };

    showProgressCharts();

    assert.equal(bars().length, 7);
    assert.equal(document.getElementById('modalDonutTotalCount').textContent, '3', 'the donut counts the source');
});

test('the panel is registered with the store on activity, stats and sources', async () => {
    const src = readFileSync(new URL('../src/core/ui-bindings.js', import.meta.url), 'utf8');
    const row = src.slice(src.indexOf("name: 'home:progressChartPanel'"));

    assert.ok(row.length, 'ui-bindings.js must carry a row for the progress chart panel');
    const slices = row.slice(0, row.indexOf('run:'));
    for (const slice of ['Slice.ACTIVITY', 'Slice.STATS', 'Slice.SOURCES']) {
        assert.ok(slices.includes(slice), `${slice} must invalidate the panel`);
    }
    assert.ok(
        row.slice(0, row.indexOf('}')).includes('refreshProgressChartOverlay'),
        'the row must run the renderer that self-gates on the overlay being open'
    );
});
