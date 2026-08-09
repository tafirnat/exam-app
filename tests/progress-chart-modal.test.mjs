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

let AppState, buildWorkloadBuckets, workloadSources, dueTimestamp, PAST_DAYS, FUTURE_DAYS, Kind,
    showProgressCharts, refreshProgressChartOverlay,
    resetModalDifficultyViewId, updateDifficultyUI,
    getLocalDateStr, shiftDateStr;

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/* Comments stripped first, or the prose above a rule gets read as one - this
   file explains its own encoding at length, right where the encoding lives. */
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

/** Every declaration that lands on a selector, in source order. */
const declarationsFor = (selector) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(m => m[1].split(',').some(s => s.trim() === selector))
    .map(m => m[2])
    .join(';');

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
    ({ buildWorkloadBuckets, workloadSources, dueTimestamp, PAST_DAYS, FUTURE_DAYS, Kind } =
        await import('../src/features/stats/workload-chart.js'));
    ({ showProgressCharts, refreshProgressChartOverlay } = await import('../src/features/stats/stats-module.js'));
});

const qs = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

const openPanel = () => { document.getElementById('progressChartOverlay').style.display = 'flex'; };
const bars = () => [...document.querySelectorAll('#modalWorkloadBars .workload-bar')]
    .map(b => b.querySelector('.workload-bar-count')?.textContent || '');

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

test('the panel carries the work/load chart and names all five bar kinds', () => {
    const section = markup.getElementById('modalWorkloadSection');
    assert.ok(section, '#modalWorkloadSection is missing from index.html');

    for (const id of ['modalWorkloadYAxis', 'modalWorkloadBars', 'modalWorkloadXAxis']) {
        assert.ok(section.querySelector(`#${id}`), `#${id} must live in the section`);
    }

    const legend = section.querySelector('#modalWorkloadLegend');
    assert.ok(legend, 'the chart needs a legend');
    for (const kind of ['is-done', 'is-overdue', 'is-unstarted', 'is-due-today', 'is-planned']) {
        assert.ok(legend.querySelector(`.workload-swatch.${kind}`), `${kind} needs a swatch`);
    }
    assert.equal(legend.querySelectorAll('[data-i18n]').length, 5, 'every kind needs a translated label');
});

/* The panel packs three readings of the same sources onto one screen and the
   work/load chart alone carries five bar kinds, so each heading offers the
   explanation behind an `i` - the same affordance the home screen's stat boxes
   use. Pinned because a button with no handler looks identical to one with. */
test('each chart heading offers its explanation, and every string is translated', async () => {
    const { translations, t } = await import('../src/core/i18n.js');

    const buttons = [
        ['modalOverviewInfoBtn', 'panel_overview_info_title', 'panel_overview_info_desc'],
        ['modalDifficultyInfoBtn', 'difficulty_info_title', 'difficulty_info_desc'],
        ['modalWorkloadInfoBtn', 'workload_info_title', 'workload_info_desc']
    ];

    for (const [id, titleKey, descKey] of buttons) {
        const btn = markup.getElementById(id);
        assert.ok(btn, `#${id} is missing from index.html`);
        assert.ok(btn.querySelector('.info-italic-icon'), `#${id} must look like the other info buttons`);

        for (const lang of ['tr', 'en', 'de']) {
            for (const key of [titleKey, descKey]) {
                assert.ok(translations[lang]?.[key], `${lang}.${key} is missing`);
            }
        }
    }

    /* Clicked for real rather than grepped for: the ids live in a table that
       survives its own binding call being deleted, so a scan for them stays
       green while every button on the panel does nothing. */
    openPanel();
    showProgressCharts();

    for (const [id, titleKey] of buttons) {
        document.getElementById('customModalOverlay').classList.remove('active');
        document.getElementById(id).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

        assert.ok(document.getElementById('customModalOverlay').classList.contains('active'),
            `#${id} opened nothing`);
        assert.equal(document.getElementById('modalTitle').innerText, t(titleKey),
            `#${id} explained the wrong chart`);
        assert.ok(document.getElementById('modalMessage').innerHTML.length > 80,
            `#${id} needs a real explanation, not a stub`);
    }
    document.getElementById('customModalOverlay').classList.remove('active');
});

test('the new bar kinds and the renamed ones are translated everywhere', async () => {
    const { translations } = await import('../src/core/i18n.js');
    const keys = ['workload_done', 'workload_overdue', 'workload_unstarted',
        'workload_due_today', 'workload_planned',
        'workload_overdue_short', 'workload_unstarted_short', 'workload_today'];

    for (const lang of ['tr', 'en', 'de']) {
        for (const key of keys) {
            assert.ok(translations[lang]?.[key], `${lang}.${key} is missing`);
        }
    }
    // The single "coming due" kind was split in two; leaving the old key around
    // would let a stale data-i18n keep resolving and hide the split.
    for (const lang of ['tr', 'en', 'de']) {
        assert.equal(translations[lang].workload_due, undefined, `${lang} still carries the merged key`);
    }
});

test('the inspect button sits with the source it names', () => {
    const inspect = markup.getElementById('modalDiffCardInspectBtn');
    const info = markup.getElementById('modalOverviewInfoBtn');
    assert.ok(inspect && info);
    assert.equal(inspect.parentElement, info.parentElement, 'the two share a row under the badge');
    assert.ok(!/flex-end/.test(inspect.parentElement.getAttribute('style') || ''),
        'the row reads left to right, under the source name rather than off to the right');
});

test('the panel no longer carries a second copy of the home trend card', () => {
    assert.equal(markup.getElementById('modalWeeklyTrendCard'), null);
    assert.equal(markup.getElementById('modalMonthlyTrendBars'), null);
});

/* Fill is the one thing three paragraphs of info text describe in words, in
   three languages, so it cannot drift quietly: solid is a moment that has gone
   by - the answers you gave, and the review date that lapsed without you - and
   an outline is work still ahead. jsdom has no layout, so this is read off the
   stylesheet rather than off a rendered bar. */
test('fill marks time: what is behind you is solid, what is still ahead is an outline', () => {
    for (const kind of ['is-done', 'is-overdue']) {
        const decls = declarationsFor(`.workload-bar.${kind} .workload-bar-fill`);
        assert.match(decls, /background:\s*(?!transparent)\S/,
            `${kind} stands for a moment that has passed, so it is drawn solid`);
        assert.doesNotMatch(decls, /border:\s*\d/,
            `${kind} is solid; an outline on top of it is a second signal saying the opposite`);
    }

    for (const kind of ['is-unstarted', 'is-due-today', 'is-planned']) {
        const decls = declarationsFor(`.workload-bar.${kind} .workload-bar-fill`);
        assert.match(decls, /background:\s*transparent/,
            `${kind} is still ahead of you, so it stays hollow`);
        assert.match(decls, /border:\s*\d+px\s+(solid|dashed|dotted)/,
            `${kind} is only visible at all through its outline`);
    }
});

/* Today draws two bars where every other slot draws one. Left at one column's
   width they come out half as wide as the days around them, and since the
   x-axis is its own flex row, widening the slot alone slides every label out
   from under the column it names. */
test("today's pair is as wide as any other day, and the axis tracks it", () => {
    const flexOf = (sel) => (declarationsFor(sel).match(/(?:^|[;\s])flex:\s*([\d.]+)/) || [])[1];
    const data = buildWorkloadBuckets('all', Date.now());

    assert.equal(Number(flexOf('.workload-slot.is-today')), data.today.length,
        'the slot needs one column of room per bar it holds');
    for (const group of ['is-today', 'is-backlog']) {
        assert.equal(flexOf(`.workload-x-label.${group}`), flexOf(`.workload-slot.${group}`),
            `the ${group} label has to be exactly as wide as its slot`);
    }
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

    /* The days ahead are a plan, not a debt, and they are drawn differently
       for exactly that reason - reading the whole right-hand side as overdue
       is the misreading this split exists to prevent. */
    assert.ok(w.future.every(b => b.kind === Kind.PLANNED), 'the forecast is planned work');
    assert.equal(w.today[1].kind, Kind.DUE_TODAY, "what is left of today is not merely planned");
    assert.notEqual(Kind.PLANNED, Kind.DUE_TODAY);
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
