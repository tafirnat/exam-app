import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

/* The panel behind the home progress bar (#progressChartOverlay).
 *
 * Its three charts all describe one thing - the sources a test draws from -
 * and for a long time each of them decided that for itself. Measured on a
 * library of two active sources and one merely available: the completion bar
 * said 20 questions, the donut above it said 30, and the trend said 7 answers a
 * day where the test's own sources accounted for 4. The trend was also a copy of
 * the home card's chart with a filter bolted on, so in its default state it drew
 * exactly the same picture as the card the panel was opened from.
 *
 * What is pinned here: the scope is one decision, settled before anything draws;
 * the work/load chart's forward half comes from each question's own due date
 * rather than from a day log that does not reach back far enough; and a data
 * change reaches an open panel.
 */

let AppState, buildWorkloadBuckets, workloadSources, dueTimestamp, PAST_DAYS, FUTURE_DAYS,
    showProgressCharts, refreshProgressChartOverlay,
    resetModalDifficultyViewId, updateDifficultyUI,
    getLocalDateStr, shiftDateStr;

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// One parse of index.html, used both as the markup under inspection and as the
// DOM the renderers draw into - a second JSDOM of a file this size costs more
// than the rest of this suite put together.
let markup;

const DAY_MS = 86400000;
const A = 'exam_matematik_lz9k2_a1b2';   // in the test (active)
const B = 'exam_fizik_lz9k3_c3d4';       // in the test (active)
const C = 'exam_tarih_lz9k4_e5f6';       // available, switched off

before(async () => {
    const dom = new JSDOM(html, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    /* jsdom has no 2d context. The completion bar is canvas, the two charts
       under it are not - stubbing this is what proves they are drawn by the
       same pass and survive the bar failing. */
    dom.window.HTMLCanvasElement.prototype.getContext = () => null;
    markup = dom.window.document;

    ({ AppState } = await import('../src/core/state.js'));
    ({ getLocalDateStr, shiftDateStr } = await import('../src/core/daily-activity.js'));
    ({ resetModalDifficultyViewId, updateDifficultyUI } = await import('../src/features/stats/continuity-ui.js'));
    ({ buildWorkloadBuckets, workloadSources, dueTimestamp, PAST_DAYS, FUTURE_DAYS } =
        await import('../src/features/stats/workload-chart.js'));
    ({ showProgressCharts, refreshProgressChartOverlay } = await import('../src/features/stats/stats-module.js'));
});

const qs = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

/** A stats record that comes due `inDays` from `now` (negative = overdue). */
const dueIn = (inDays, now) => ({
    correct: 1, wrong: 0, difficulty: 5,
    stability: 10,
    lastReview: now + (inDays - 10) * DAY_MS
});

beforeEach(() => {
    AppState.folders = [];
    AppState.stats = {};
    AppState.studyActivity = {};
    AppState.sources = [
        { id: A, name: 'Matematik', active: true, order: 0, questions: qs(10) },
        { id: B, name: 'Fizik', active: true, order: 1, questions: qs(10) },
        { id: C, name: 'Tarih', active: false, order: 2, questions: qs(10) }
    ];
    resetModalDifficultyViewId();
    document.getElementById('modalWorkloadBars').innerHTML = '';
    document.getElementById('progressChartOverlay').style.display = 'none';
});

// ── Markup ──────────────────────────────────────────────────────────────────

test('the panel carries the work/load chart and names all four bar kinds', () => {
    const section = markup.getElementById('modalWorkloadSection');
    assert.ok(section, '#modalWorkloadSection is missing from index.html');

    for (const id of ['modalWorkloadYAxis', 'modalWorkloadBars', 'modalWorkloadXAxis']) {
        assert.ok(section.querySelector(`#${id}`), `#${id} must live in the section`);
    }

    const legend = section.querySelector('#modalWorkloadLegend');
    assert.ok(legend, 'the chart needs a legend');
    for (const kind of ['is-done', 'is-overdue', 'is-unstarted', 'is-due']) {
        assert.ok(legend.querySelector(`.workload-swatch.${kind}`), `${kind} needs a swatch`);
    }
    assert.equal(legend.querySelectorAll('[data-i18n]').length, 4, 'every kind needs a translated label');
});

test('the panel no longer carries a second copy of the home trend card', () => {
    assert.equal(markup.getElementById('modalWeeklyTrendCard'), null);
    assert.equal(markup.getElementById('modalMonthlyTrendBars'), null);
});

// ── Scope ───────────────────────────────────────────────────────────────────

test('"all" means the sources a test draws from, not the whole library', () => {
    const ids = workloadSources('all').map(s => s.id);
    assert.deepEqual(ids, [A, B], 'a source that is switched off is not in the test');
});

test('a named source narrows to that source alone', () => {
    assert.deepEqual(workloadSources(B).map(s => s.id), [B]);
});

test('the modal donut counts the test\'s sources, the home donut the library', () => {
    updateDifficultyUI(false);
    updateDifficultyUI(true);

    assert.equal(document.getElementById('donutTotalCount').textContent, '30',
        'the home card describes everything you own');
    assert.equal(document.getElementById('modalDonutTotalCount').textContent, '20',
        'the panel describes what a test would ask');
});

// ── When a question comes due ───────────────────────────────────────────────

test('a question is due exactly its stability after the last review', () => {
    const now = Date.UTC(2026, 6, 1);
    assert.equal(dueTimestamp({ stability: 4, lastReview: now }), now + 4 * DAY_MS);
});

test('a question that was never reviewed has no due date', () => {
    assert.equal(dueTimestamp({ stability: 4 }), null);
    assert.equal(dueTimestamp({ lastReview: Date.now() }), null);
    assert.equal(dueTimestamp(undefined), null);
});

// ── The load ahead ──────────────────────────────────────────────────────────

const sum = (bars) => bars.reduce((n, b) => n + b.value, 0);

test('a question whose moment has passed is overdue, not scheduled', () => {
    const now = Date.now();
    AppState.stats[`${A}_1`] = dueIn(-3, now);

    const w = buildWorkloadBuckets('all', now);
    assert.equal(w.backlog[0].value, 1, 'overdue');
    assert.equal(sum(w.future), 0, 'and nowhere in the forecast');
});

test('a question nobody has touched is counted apart from the backlog', () => {
    const now = Date.now();
    AppState.stats[`${A}_1`] = dueIn(-3, now);
    // The other 19 have no stats record at all.

    const w = buildWorkloadBuckets('all', now);
    assert.equal(w.backlog[0].value, 1, 'overdue stays overdue');
    assert.equal(w.backlog[1].value, 19,
        'a fresh source must not bury the real backlog in the same column');
});

test('a question due in three days lands on the third column ahead', () => {
    const now = Date.now();
    AppState.stats[`${A}_1`] = dueIn(3, now);

    const w = buildWorkloadBuckets('all', now);
    assert.equal(w.future.length, FUTURE_DAYS);
    assert.equal(w.future[2].value, 1);
    assert.equal(sum(w.future), 1, 'and on no other');
});

test('a question still due later today is today\'s remainder, not backlog', () => {
    // Noon in the app's day zone, with the question due an hour later, so the
    // day cannot roll over between the two reads.
    const now = new Date(`${getLocalDateStr()}T12:00:00Z`).getTime();
    AppState.stats[`${A}_1`] = { stability: 1, lastReview: now + DAY_MS / 24 - DAY_MS };

    const w = buildWorkloadBuckets('all', now);
    assert.equal(w.today[1].value, 1, "today's remaining bar");
    assert.equal(w.backlog[0].value, 0, 'not overdue - the moment has not passed');
});

test('load beyond the horizon is simply not drawn', () => {
    const now = Date.now();
    AppState.stats[`${A}_1`] = dueIn(FUTURE_DAYS + 5, now);

    const w = buildWorkloadBuckets('all', now);
    assert.equal(sum(w.future) + w.backlog[0].value + w.backlog[1].value + w.today[1].value, 19,
        'only the 19 unseeded questions of the two active sources remain');
});

test('a source outside the test contributes nothing, however overdue', () => {
    const now = Date.now();
    for (let i = 1; i <= 10; i++) AppState.stats[`${C}_${i}`] = dueIn(-5, now);

    const w = buildWorkloadBuckets('all', now);
    assert.equal(w.backlog[0].value, 0, 'the switched-off source is not in the test');
    assert.equal(w.backlog[1].value, 20, 'and only the test\'s own untouched questions are counted');
});

// ── The week behind ─────────────────────────────────────────────────────────

const dayWithLog = (log, counts) => ({ ...counts, byDevice: { phone: { ...counts, questionLog: log } } });

test('the past half counts only the test\'s sources', () => {
    const yesterday = shiftDateStr(getLocalDateStr(), -1);
    AppState.studyActivity = {
        [yesterday]: dayWithLog({
            [`${A}_1`]: { correct: 1, wrong: 0, empty: 0, isFocus: false },
            [`${A}_2`]: { correct: 1, wrong: 0, empty: 0, isFocus: false },
            [`${C}_1`]: { correct: 1, wrong: 0, empty: 0, isFocus: false }
        }, { questionCount: 3, correctCount: 3 })
    };

    const w = buildWorkloadBuckets('all');
    assert.equal(w.past.length, PAST_DAYS);
    assert.equal(w.past[w.past.length - 1].value, 2, "the switched-off source's answer is out");
});

test('a day whose breakdown was never kept says so instead of reading as zero', () => {
    const yesterday = shiftDateStr(getLocalDateStr(), -1);
    // Written before the per-question log existed: a real total, no breakdown.
    AppState.studyActivity = { [yesterday]: { questionCount: 12, correctCount: 12 } };

    const bar = buildWorkloadBuckets('all').past[PAST_DAYS - 1];
    assert.equal(bar.value, 0, 'nothing can be attributed');
    assert.equal(bar.unattributed, 12, "but the day's own total is real and carried");
});

// ── The panel on screen ─────────────────────────────────────────────────────

const openPanel = () => { document.getElementById('progressChartOverlay').style.display = 'flex'; };
const bars = () => [...document.querySelectorAll('#modalWorkloadBars .workload-bar')]
    .map(b => b.querySelector('.workload-bar-count')?.textContent || '');

test('the first paint already agrees with the second', () => {
    // A single active source: the nav offers no "all" item, so opening the panel
    // used to draw two charts for "all" and only then rewrite the selection to
    // the source - the panel opened under one source's name showing another
    // source's numbers, and quietly corrected itself on the next redraw.
    AppState.sources = [
        { id: A, name: 'Matematik', active: true, order: 0, questions: qs(10) },
        { id: C, name: 'Tarih', active: false, order: 1, questions: qs(10) }
    ];
    const yesterday = shiftDateStr(getLocalDateStr(), -1);
    AppState.studyActivity = {
        [yesterday]: dayWithLog({
            [`${A}_1`]: { correct: 1, wrong: 0, empty: 0, isFocus: false },
            [`${C}_1`]: { correct: 1, wrong: 0, empty: 0, isFocus: false },
            [`${C}_2`]: { correct: 1, wrong: 0, empty: 0, isFocus: false }
        }, { questionCount: 3, correctCount: 3 })
    };
    resetModalDifficultyViewId();

    openPanel();
    showProgressCharts();
    const first = bars();

    showProgressCharts();
    assert.deepEqual(bars(), first, 'the panel must not change its mind on the second pass');
    assert.equal(first[PAST_DAYS - 1], '1', "and yesterday is the source's own single answer");
});

/* The invariant behind the "first paint" case above, stated directly: whatever
   the header names, the donut counts and the bars draw. The panel used to
   resolve the selection twice - once at the top of showProgressCharts and again
   inside updateDifficultyUI, which could move it - so the three could and did
   disagree. Locking the agreement rather than the mechanism is what survives
   the next refactor of how the selection is settled. */
test('the header, the donut and the bars all describe the same source', async () => {
    const yesterday = shiftDateStr(getLocalDateStr(), -1);
    AppState.sources = [
        { id: A, name: 'Matematik', active: true, order: 0, questions: qs(10) },
        { id: B, name: 'Fizik', active: true, order: 1, questions: qs(4) }
    ];
    AppState.studyActivity = {
        [yesterday]: dayWithLog({
            [`${A}_1`]: { correct: 1, wrong: 0, empty: 0, isFocus: false },
            [`${A}_2`]: { correct: 1, wrong: 0, empty: 0, isFocus: false },
            [`${A}_3`]: { correct: 1, wrong: 0, empty: 0, isFocus: false },
            [`${B}_1`]: { correct: 1, wrong: 0, empty: 0, isFocus: false }
        }, { questionCount: 4, correctCount: 4 })
    };
    resetModalDifficultyViewId();
    openPanel();
    showProgressCharts();

    // Walk the nav to Fizik the way the user does, rather than poking the
    // module's private id: the arrow is what has to end up consistent.
    while (document.getElementById('modalDiffCardSourceBadgeText').textContent.trim() !== 'Fizik') {
        await document.getElementById('modalDiffCardNextBtn').onclick();
    }

    assert.equal(document.getElementById('modalDonutTotalCount').textContent, '4',
        "the donut counts Fizik's questions");
    assert.equal(bars()[PAST_DAYS - 1], '1',
        "and the bars count Fizik's single answer, not the panel's whole scope");
    const legendTotal = [...document.getElementById('chartDistLegend').querySelectorAll('b')]
        .reduce((n, b) => n + Number(b.textContent), 0);
    assert.equal(legendTotal, 4, "and the completion bar totals Fizik's four questions");
});

/* The panel now redraws on the sources slice, so a source can leave the test
   while it is pinned to it - switched off here, or by a sync pull. It has to
   fall back to something the nav actually offers, in every chart at once. */
test('a pinned source that leaves the test does not linger in half the panel', async () => {
    AppState.sources = [
        { id: A, name: 'Matematik', active: true, order: 0, questions: qs(10) },
        { id: B, name: 'Fizik', active: true, order: 1, questions: qs(4) }
    ];
    resetModalDifficultyViewId();
    openPanel();
    showProgressCharts();
    while (document.getElementById('modalDiffCardSourceBadgeText').textContent.trim() !== 'Fizik') {
        await document.getElementById('modalDiffCardNextBtn').onclick();
    }

    AppState.sources.find(s => s.id === B).active = false;
    refreshProgressChartOverlay();

    const badge = document.getElementById('modalDiffCardSourceBadgeText').textContent.trim();
    assert.notEqual(badge, 'Fizik', 'a source outside the test cannot stay selected');

    const legendTotal = [...document.getElementById('chartDistLegend').querySelectorAll('b')]
        .reduce((n, b) => n + Number(b.textContent), 0);
    assert.equal(document.getElementById('modalDonutTotalCount').textContent, '10');
    assert.equal(legendTotal, 10, 'and every chart follows the same fallback');
});

test('an open panel picks up a change without being reopened', () => {
    openPanel();
    showProgressCharts();
    const before = bars();

    AppState.stats[`${A}_1`] = dueIn(-1, Date.now());
    refreshProgressChartOverlay();

    assert.notDeepEqual(bars(), before);
});

test('a closed panel is not redrawn', () => {
    document.getElementById('progressChartOverlay').style.display = 'none';
    refreshProgressChartOverlay();

    assert.equal(bars().length, 0, 'drawing a hidden panel is pure waste');
});

test('the completion bar failing does not take the other charts down with it', () => {
    // getContext is stubbed to null for the whole file, so this pass has already
    // lost the canvas chart. The DOM charts must still land.
    openPanel();
    showProgressCharts();

    assert.ok(bars().length > 0, 'the work/load chart still drew');
    assert.equal(document.getElementById('modalDonutTotalCount').textContent, '20');
});

test('the panel is registered with the store on activity, stats and sources', () => {
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
