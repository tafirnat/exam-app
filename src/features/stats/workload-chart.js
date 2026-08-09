/**
 * The progress panel's "Çalışma & Yük" chart: what these sources have already
 * had done to them, and what they are about to ask for - on one axis.
 *
 * ── Why this is not the home screen's trend chart ───────────────────────────
 *
 * The home card answers "how much have I studied", over the whole library, from
 * the day's plain counters. The panel behind the progress bar is about the
 * sources a test actually draws from, and for a while it answered the same
 * question with the same shape - two identical charts, one of them redundant.
 *
 * It also could not answer it honestly. Splitting a day by source needs the
 * per-question log, which only exists from the day that feature landed; every
 * older day has a total and no breakdown. A backward chart therefore has a hole
 * in it that nothing can fill, and filling it by guessing would put one source's
 * work on another's column.
 *
 * Looking forward has no such hole. Every question carries `lastReview` and
 * `stability`, and the engine's own due rule is R <= 0.9 where
 * R = 0.9^(elapsedDays / stability) - which is due exactly `stability` days
 * after the last review. That is complete, per source, from the first answer
 * ever given. So the past half is kept short (a week, which the log does cover)
 * and the rest of the chart is the load ahead.
 *
 * ── The four bar kinds ──────────────────────────────────────────────────────
 *
 *   filled          done          questions answered that day
 *   red, hollow     overdue       R <= 0.9 now
 *   grey, hollow    unstarted     never reviewed - the engine calls these
 *                                 overdue too, but a fresh 500-question source
 *                                 would bury the real backlog in one column
 *   yellow, hollow  due ahead     falls due on that day
 *
 * Every question with a stats record lands in exactly one of the last three, or
 * beyond the horizon. Today carries two bars - what is done and what is left -
 * which is the whole point of putting both halves on one axis.
 */

import { AppState, liveSources } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import { getLocalDateStr, shiftDateStr, getDayAnchor } from '../../core/daily-activity.js';
import { buildDailyTrendBuckets, makeSourceLogFilter } from './continuity-ui.js';

/** Days of history on the left of the divider. The log covers this much. */
export const PAST_DAYS = 6;
/** Days of forecast on the right. */
export const FUTURE_DAYS = 6;

/** Bar kinds, in the order they appear on the axis. */
export const Kind = Object.freeze({
    DONE: 'done',
    OVERDUE: 'overdue',
    UNSTARTED: 'unstarted',
    DUE: 'due'
});

const DAY_MS = 86400000;

/**
 * When a question next falls due.
 *
 * The engine reads R = 0.9^(elapsed / stability) and treats R <= 0.9 as due,
 * which is elapsed >= stability. Inverting it is therefore exact rather than a
 * fit - no forecast model, just the same rule read the other way round.
 *
 * @returns {number|null} epoch ms, or null when the question was never reviewed
 */
export function dueTimestamp(stat) {
    if (!stat) return null;
    const stability = Number(stat.stability);
    const last = stat.lastReview ? new Date(stat.lastReview).getTime() : NaN;
    if (!Number.isFinite(stability) || stability <= 0) return null;
    if (!Number.isFinite(last)) return null;
    return last + stability * DAY_MS;
}

/** The sources the panel is describing: one, or every source a test would use. */
export function workloadSources(sourceId) {
    const active = liveSources().filter(s => s.active);
    if (!sourceId || sourceId === 'all') return active;
    const one = liveSources().find(s => s.id === sourceId);
    return one ? [one] : active;
}

/**
 * Every bar the chart draws, left to right.
 *
 * @param {string|null} sourceId  a source id, or 'all'/null for the whole test
 * @param {number} [now]          injected in tests; one read for the whole pass,
 *                                so two questions seeded from the same instant
 *                                cannot fall either side of a millisecond
 */
export function buildWorkloadBuckets(sourceId = 'all', now = Date.now()) {
    const sources = workloadSources(sourceId);
    const isAll = !sourceId || sourceId === 'all';

    // ── Past: distinct questions answered, attributed to these sources ───────
    const logFilter = makeSourceLogFilter(sources.map(s => s.id));
    const days = buildDailyTrendBuckets(AppState.studyActivity || {}, PAST_DAYS + 1, { logFilter });
    const todayBucket = days[days.length - 1];

    const past = days.slice(0, PAST_DAYS).map(d => ({
        kind: Kind.DONE,
        label: d.label,
        fullDateLabel: d.fullDateLabel,
        value: d.total,
        unattributed: d.unattributed
    }));

    // ── Ahead: every question's own due date ─────────────────────────────────
    const todayKey = getLocalDateStr(new Date(now));
    const futureKeys = [];
    for (let i = 1; i <= FUTURE_DAYS; i++) futureKeys.push(shiftDateStr(todayKey, i));

    const dueByKey = Object.fromEntries(futureKeys.map(k => [k, 0]));
    let overdue = 0, unstarted = 0, dueToday = 0;

    sources.forEach(source => {
        (source.questions || []).forEach(q => {
            const stat = AppState.stats[`${source.id}_${q.id}`];
            const due = dueTimestamp(stat);
            if (due === null) { unstarted++; return; }
            if (due <= now) { overdue++; return; }

            const key = getLocalDateStr(new Date(due));
            if (key === todayKey) dueToday++;
            else if (key in dueByKey) dueByKey[key]++;
            // Anything further out is off the horizon and simply not drawn.
        });
    });

    const dayLabel = (key) => getDayAnchor(key).toLocaleDateString(
        (document.documentElement.lang || 'en').startsWith('tr') ? 'tr-TR' : (document.documentElement.lang || 'en'),
        { weekday: 'long', day: 'numeric', month: 'short' }
    );

    const backlog = [
        { kind: Kind.OVERDUE, label: t('workload_overdue_short'), fullDateLabel: t('workload_overdue'), value: overdue },
        { kind: Kind.UNSTARTED, label: t('workload_unstarted_short'), fullDateLabel: t('workload_unstarted'), value: unstarted }
    ];

    const today = [
        {
            kind: Kind.DONE, isToday: true,
            label: t('workload_today'), fullDateLabel: dayLabel(todayKey),
            value: todayBucket.total, unattributed: todayBucket.unattributed
        },
        {
            kind: Kind.DUE, isToday: true,
            label: '', fullDateLabel: dayLabel(todayKey),
            value: dueToday
        }
    ];

    const future = futureKeys.map((key, i) => ({
        kind: Kind.DUE,
        label: `+${i + 1}`,
        fullDateLabel: dayLabel(key),
        value: dueByKey[key]
    }));

    return { past, backlog, today, future, isAll, sourceCount: sources.length };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const KIND_CLASS = {
    [Kind.DONE]: 'is-done',
    [Kind.OVERDUE]: 'is-overdue',
    [Kind.UNSTARTED]: 'is-unstarted',
    [Kind.DUE]: 'is-due'
};

/** Rounds the axis top up to a friendly tick, never below 10. */
function axisTop(values) {
    const max = values.reduce((m, v) => Math.max(m, v), 0);
    if (max <= 10) return 10;
    const step = Math.pow(10, Math.floor(Math.log10(max)) - 1) * 5;
    return Math.ceil(max / step) * step;
}

/**
 * Draws the chart into the three containers the panel provides.
 *
 * Slots are laid out in one flex row so the past, the backlog and the forecast
 * share a single y-axis. They are deliberately not given separate scales: the
 * backlog dwarfing a day's work is the fact the chart exists to show, and
 * hiding it behind a second axis would be a picture of a smaller problem.
 */
export function renderWorkloadChart(data, yAxisId, barsId, xAxisId) {
    const yAxisEl = document.getElementById(yAxisId);
    const barsEl = document.getElementById(barsId);
    const xAxisEl = document.getElementById(xAxisId);
    if (!yAxisEl || !barsEl || !xAxisEl) return;

    yAxisEl.innerHTML = '';
    barsEl.innerHTML = '';
    xAxisEl.innerHTML = '';

    const slots = [
        ...data.past.map(b => ({ bars: [b], group: 'past' })),
        ...data.backlog.map(b => ({ bars: [b], group: 'backlog' })),
        { bars: data.today, group: 'today' },
        ...data.future.map(b => ({ bars: [b], group: 'future' }))
    ];

    const top = axisTop(slots.flatMap(s => s.bars.map(b => b.value)));
    const labelWidth = Math.max(20, String(top).length * 8);
    const gutter = labelWidth + 5;
    barsEl.style.paddingLeft = `${gutter}px`;
    xAxisEl.style.paddingLeft = `${gutter}px`;

    for (let i = 0; i <= 5; i++) {
        const line = document.createElement('div');
        line.className = 'workload-axis-line';
        line.innerHTML =
            `<span style="width:${labelWidth}px">${Math.round((top / 5) * i)}</span><div class="workload-axis-rule"></div>`;
        yAxisEl.appendChild(line);
    }

    const tooltip = getTooltip();
    barsEl.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

    slots.forEach((slot, i) => {
        const xLbl = document.createElement('div');
        xLbl.className = `workload-x-label is-${slot.group}`;
        xLbl.textContent = slot.bars.find(b => b.label)?.label || '';
        xAxisEl.appendChild(xLbl);

        const wrap = document.createElement('div');
        // Marked here rather than with :first-of-type, which matches on the tag
        // and would have picked the first div of the whole strip - the dividers
        // simply never drew.
        const opensGroup = i > 0 && slots[i - 1].group !== slot.group;
        wrap.className = `workload-slot is-${slot.group}${opensGroup ? ' opens-group' : ''}`;

        slot.bars.forEach(bar => wrap.appendChild(renderBar(bar, top, tooltip)));
        barsEl.appendChild(wrap);
    });
}

function renderBar(bar, top, tooltip) {
    const column = document.createElement('div');
    column.className = `workload-bar ${KIND_CLASS[bar.kind]}`;

    // A day whose breakdown was never kept is not a zero; it gets a hatched stub
    // that says "unknown" and a tooltip that still reports the day's real total.
    const unknown = !bar.value && bar.unattributed > 0;
    if (unknown) column.classList.add('is-unknown');

    /* A zero draws nothing at all. An outline of zero height is still an
       outline - two borders meeting - and it read as a thin bar on a day that
       asks for nothing. */
    if (bar.value > 0 || unknown) {
        const fill = document.createElement('div');
        fill.className = 'workload-bar-fill';
        fill.style.height = unknown ? '6px' : `${Math.min(100, (bar.value / top) * 100)}%`;
        column.appendChild(fill);

        if (bar.value > 0) {
            const label = document.createElement('span');
            label.className = 'workload-bar-count';
            label.textContent = bar.value;
            fill.appendChild(label);
        }
    }

    column.addEventListener('mouseenter', () => showTooltip(tooltip, column, bar, unknown));
    column.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    return column;
}

const KIND_TEXT = {
    [Kind.DONE]: 'workload_done',
    [Kind.OVERDUE]: 'workload_overdue',
    [Kind.UNSTARTED]: 'workload_unstarted',
    [Kind.DUE]: 'workload_due'
};

function showTooltip(tooltip, anchor, bar, unknown) {
    const rows = unknown
        ? `<div class="trend-tooltip-row"><span class="trend-tooltip-label">${t('workload_no_breakdown')}</span></div>
           <div class="trend-tooltip-row"><span class="trend-tooltip-label">${t('workload_day_total')}</span><b>${bar.unattributed}</b></div>`
        : `<div class="trend-tooltip-row">
               <span class="trend-tooltip-label"><span class="trend-tooltip-dot workload-dot ${KIND_CLASS[bar.kind]}"></span>${t(KIND_TEXT[bar.kind])}</span>
               <b>${bar.value}</b>
           </div>`;

    tooltip.innerHTML = `
        <div class="trend-tooltip-header">
            <div style="font-weight:700; font-size:0.75rem; margin-bottom:4px; text-align:center;">${bar.fullDateLabel}</div>
        </div>
        <div class="trend-tooltip-body">${rows}</div>`;
    tooltip.style.display = 'block';

    const rect = anchor.getBoundingClientRect();
    let top = rect.top - tooltip.offsetHeight - 10 + window.scrollY;
    if (top < window.scrollY + 5) top = rect.bottom + 10 + window.scrollY;
    let left = rect.left + rect.width / 2 - tooltip.offsetWidth / 2 + window.scrollX;
    left = Math.max(8, Math.min(left, window.innerWidth - tooltip.offsetWidth - 8));

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
    tooltip.style.transform = 'none';
}

/* Shared with the home trend chart, and on <body> so it is never clipped by a
   flipped card or trapped under the panel's own stacking context. */
function getTooltip() {
    let el = document.getElementById('globalTrendChartTooltip');
    if (!el) {
        el = document.createElement('div');
        el.id = 'globalTrendChartTooltip';
        el.className = 'trend-chart-tooltip';
        document.body.appendChild(el);
    }
    return el;
}
