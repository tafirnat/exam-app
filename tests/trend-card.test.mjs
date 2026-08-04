import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// The weekly trend card is a flip card: the weekly chart on the front, the
// monthly one on its back. Both faces are drawn by the same renderer, so what
// needs guarding is the markup they render into and the monthly bucketing -
// a face whose containers went missing renders nothing and fails silently.

let buildWeeklyTrendBuckets, buildMonthlyTrendBuckets, getLocalDateStr;

before(async () => {
    const dom = new JSDOM('<!doctype html><html lang="tr"><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    const uiMod = await import('../src/features/stats/continuity-ui.js');
    buildWeeklyTrendBuckets = uiMod.buildWeeklyTrendBuckets;
    buildMonthlyTrendBuckets = uiMod.buildMonthlyTrendBuckets;
    getLocalDateStr = (await import('../src/features/stats/continuity-engine.js')).getLocalDateStr;
});

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const markup = new JSDOM(html).window.document;

test('the trend card carries both faces and every chart container', () => {
    const card = markup.getElementById('homeWeeklyTrendCard');
    assert.ok(card, '#homeWeeklyTrendCard is missing from index.html');
    assert.ok(card.classList.contains('chart-flip-card'), 'the card must be a flip card');

    const front = card.querySelector('.chart-flip-front');
    const back = card.querySelector('.chart-flip-back');
    assert.ok(front && back, 'both faces must exist');

    for (const id of ['trendYAxis', 'trendBars', 'trendXAxis']) {
        assert.ok(front.querySelector(`#${id}`), `#${id} must live on the weekly face`);
    }
    for (const id of ['monthlyTrendYAxis', 'monthlyTrendBars', 'monthlyTrendXAxis']) {
        assert.ok(back.querySelector(`#${id}`), `#${id} must live on the monthly face`);
    }

    assert.equal(card.querySelectorAll('[data-trend-flip]').length, 2, 'each face needs its own flip button');
});

test('each face names its two line series in a legend', () => {
    const card = markup.getElementById('homeWeeklyTrendCard');

    for (const [face, legendId] of [['.chart-flip-front', 'trendLegend'], ['.chart-flip-back', 'monthlyTrendLegend']]) {
        const legend = card.querySelector(face).querySelector(`#${legendId}`);
        assert.ok(legend, `#${legendId} must live on the ${face} face`);

        // Identity must not rest on hue alone - each swatch carries the class
        // that gives it its stroke pattern, and every item is labelled.
        assert.ok(legend.querySelector('.trend-legend-swatch.is-normal'), 'the normal series needs a swatch');
        assert.ok(legend.querySelector('.trend-legend-swatch.is-focus'), 'the focus series needs a swatch');
        assert.equal(legend.querySelectorAll('[data-i18n]').length, 2, 'both series need a translated label');
    }
});

test('a weekly bucket splits one day into correct, wrong and unanswered', () => {
    const today = getLocalDateStr();
    const buckets = buildWeeklyTrendBuckets({
        [today]: { studied: true, questionCount: 10, correctCount: 6, wrongCount: 3, unansweredCount: 1 }
    });

    assert.equal(buckets.length, 7);
    const last = buckets[buckets.length - 1];
    assert.deepEqual(
        { correct: last.correct, wrong: last.wrong, empty: last.empty, total: last.total },
        { correct: 6, wrong: 3, empty: 1, total: 10 }
    );
});

test('a bucket carries the focus track alongside the day total', () => {
    const today = getLocalDateStr();
    const buckets = buildWeeklyTrendBuckets({
        [today]: { studied: true, questionCount: 20, correctCount: 12, wrongCount: 5, unansweredCount: 3, focusQuestionCount: 8 }
    });
    const last = buckets[buckets.length - 1];

    assert.equal(last.total, 20, 'the normal line reads the day total');
    assert.equal(last.volumeFocus, 8, 'the focus line reads the focus track only');
});

test('a focus count larger than the day total is clamped to the bar', () => {
    const today = getLocalDateStr();
    const buckets = buildWeeklyTrendBuckets({
        [today]: { studied: true, questionCount: 10, correctCount: 10, wrongCount: 0, unansweredCount: 0, focusQuestionCount: 40 }
    });
    const last = buckets[buckets.length - 1];

    assert.equal(last.volumeFocus, 10, 'the focus line must never float above its bar');
});

test('days without a focus track leave the focus line at zero', () => {
    const buckets = buildWeeklyTrendBuckets({
        [getLocalDateStr()]: { studied: true, questionCount: 12, correctCount: 12, wrongCount: 0, unansweredCount: 0 }
    });

    assert.equal(buckets.reduce((sum, b) => sum + b.volumeFocus, 0), 0);
});

test('legacy records without a breakdown still show their volume', () => {
    const today = getLocalDateStr();
    const buckets = buildWeeklyTrendBuckets({ [today]: { studied: true, questionCount: 8 } });
    const last = buckets[buckets.length - 1];

    assert.equal(last.total, 8);
    assert.equal(last.empty, 8, 'a bar with no breakdown must not render as a gap');
});

test('the monthly face sums every day of a month into one bar', () => {
    const now = new Date();
    const day = n => {
        const d = new Date(now.getFullYear(), now.getMonth(), n);
        return getLocalDateStr(d);
    };

    const buckets = buildMonthlyTrendBuckets({
        [day(1)]: { studied: true, questionCount: 5, correctCount: 4, wrongCount: 1, unansweredCount: 0, focusQuestionCount: 2 },
        [day(2)]: { studied: true, questionCount: 7, correctCount: 3, wrongCount: 2, unansweredCount: 2, focusQuestionCount: 6 }
    });

    assert.equal(buckets.length, 6, 'the monthly face covers six months');
    const current = buckets[buckets.length - 1];
    assert.deepEqual(
        { correct: current.correct, wrong: current.wrong, empty: current.empty, total: current.total, focus: current.volumeFocus },
        { correct: 7, wrong: 3, empty: 2, total: 12, focus: 8 }
    );
});

test('activity outside the six-month window is left out', () => {
    const old = new Date();
    old.setFullYear(old.getFullYear() - 1);

    const buckets = buildMonthlyTrendBuckets({
        [getLocalDateStr(old)]: { studied: true, questionCount: 99, correctCount: 99, wrongCount: 0, unansweredCount: 0 }
    });

    assert.equal(buckets.reduce((sum, b) => sum + b.total, 0), 0);
});

test('the monthly window keeps its months distinct across a year boundary', () => {
    const buckets = buildMonthlyTrendBuckets({});
    const labels = buckets.map(b => b.label);

    assert.equal(new Set(labels).size, 6, `expected six distinct month labels, got ${labels.join(', ')}`);
});

/* ── Per-question logs, and the day two devices share ────────────────────────
   A bar counts distinct questions, which needs the day's per-question log. Only
   some buckets carry one: days older than the feature have none, and so does a
   device still on an older build. Counting only the buckets that logged made
   the rest of the day disappear - one device drew a bar, the other drew nothing
   from the same record. */

const bucketWithLog = (log, counts = {}) => ({
    questionCount: 0, correctCount: 0, wrongCount: 0, unansweredCount: 0, ...counts, questionLog: log
});

test('a question answered twice in a day counts once', () => {
    const today = getLocalDateStr();
    const buckets = buildWeeklyTrendBuckets({
        [today]: {
            studied: true, questionCount: 3, correctCount: 2, wrongCount: 1,
            byDevice: {
                phone: bucketWithLog({
                    's1_1': { correct: 2, wrong: 1, empty: 0, isFocus: false }
                }, { questionCount: 3, correctCount: 2, wrongCount: 1 })
            }
        }
    });
    const last = buckets[buckets.length - 1];

    assert.equal(last.total, 1, 'three answers to one question are one question');
    assert.equal(last.volumeTotal, 3, 'the volume line still reads every answer');
});

test('a day worked on two devices counts both, logged or not', () => {
    const today = getLocalDateStr();
    const buckets = buildWeeklyTrendBuckets({
        [today]: {
            studied: true, questionCount: 9, correctCount: 7, wrongCount: 2,
            byDevice: {
                phone: bucketWithLog({
                    's1_1': { correct: 1, wrong: 0, empty: 0, isFocus: false },
                    's1_2': { correct: 1, wrong: 0, empty: 0, isFocus: false }
                }, { questionCount: 2, correctCount: 2 }),
                // Still on a build that writes no log - or one whose log a
                // repair dropped. Its seven questions are the ones that used to
                // vanish the moment the other bucket carried a log.
                laptop: { questionCount: 7, correctCount: 5, wrongCount: 2, unansweredCount: 0 }
            }
        }
    });
    const last = buckets[buckets.length - 1];

    assert.equal(last.total, 9, 'the unlogged device must still reach the bar');
    assert.equal(last.wrong, 2, 'and so must its breakdown');
});

test('the same question answered on both devices is still one question', () => {
    const today = getLocalDateStr();
    const buckets = buildWeeklyTrendBuckets({
        [today]: {
            studied: true, questionCount: 2, correctCount: 2,
            byDevice: {
                phone: bucketWithLog({ 's1_1': { correct: 1, wrong: 0, empty: 0, isFocus: false } },
                    { questionCount: 1, correctCount: 1 }),
                laptop: bucketWithLog({ 's1_1': { correct: 1, wrong: 0, empty: 0, isFocus: false } },
                    { questionCount: 1, correctCount: 1 })
            }
        }
    });

    assert.equal(buckets[buckets.length - 1].total, 1);
});

test('two sources numbering their first question 1 are two questions', () => {
    const today = getLocalDateStr();
    const buckets = buildWeeklyTrendBuckets({
        [today]: {
            studied: true, questionCount: 2, correctCount: 2,
            byDevice: {
                phone: bucketWithLog({
                    's1_1': { correct: 1, wrong: 0, empty: 0, isFocus: false },
                    's2_1': { correct: 1, wrong: 0, empty: 0, isFocus: false }
                }, { questionCount: 2, correctCount: 2 })
            }
        }
    });

    assert.equal(buckets[buckets.length - 1].total, 2, 'the log is keyed by source and question, not question alone');
});
