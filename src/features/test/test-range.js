/**
 * Where a sequential session starts in the pool.
 *
 * A sequential test takes the *first* N questions - that is the whole point of
 * the mode, and it is what makes two runs of the same setup comparable. But a
 * rule that only ever says "the first N" can never reach question 41 of a
 * hundred, so the offset is exposed as a visible control rather than hidden
 * behind a cursor the user cannot see or reset.
 *
 * The picker only exists while the mode is on and the pool is bigger than the
 * session: with 40 questions asked of 40 there is nothing to choose.
 */

import { AppState } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import { activeSourcesKeepOrder } from './test-engine.js';

/** The count select's "all questions" value. Not a number, so it cannot collide. */
export const ALL_QUESTIONS = 'all';

/** Above this a session is long enough to be worth confirming before it starts. */
export const LONG_SESSION_THRESHOLD = 150;

export function isSequentialMode() {
    return activeSourcesKeepOrder();
}

/**
 * How many questions a test would draw from, without touching AppState.
 *
 * buildQuestionPool() answers the same question but *writes* rawQuestions and
 * questionMap on its way through, so calling it to paint a dropdown would have
 * the home screen quietly rebuild the test pool.
 */
export function countActivePoolQuestions() {
    return (AppState.sources || [])
        .filter(s => s.active && !s.archived && Array.isArray(s.questions))
        .reduce((total, s) => total + s.questions.length, 0);
}

/** The requested size as a number; ALL_QUESTIONS means "no limit". */
export function resolveQuestionCount(rawValue) {
    if (rawValue === ALL_QUESTIONS) return Infinity;
    const parsed = parseInt(rawValue, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

/** The value of the count select right now, already resolved. */
function selectedCount() {
    const el = document.getElementById('questionCount');
    return resolveQuestionCount(el ? el.value : '10');
}

/**
 * The blocks the pool divides into at the current session size.
 * @returns {Array<{start: number, label: string}>}
 */
export function buildRangeOptions(total, count) {
    if (!Number.isFinite(count) || count <= 0 || total <= count) return [];
    const blocks = [];
    for (let start = 0; start < total; start += count) {
        const end = Math.min(start + count, total);
        blocks.push({ start, label: `${start + 1}–${end}` });
    }
    return blocks;
}

/** Clamps the stored offset onto a block that still exists. */
function normalizeStart(blocks) {
    const current = AppState.questionStartIndex || 0;
    if (blocks.some(b => b.start === current)) return current;
    return 0;
}

/**
 * Shows, hides and fills the range picker. Idempotent - it is a store consumer,
 * so it runs again on every source change.
 */
export function renderQuestionRangePicker() {
    const group = document.getElementById('questionStartGroup');
    const select = document.getElementById('questionStartRange');
    if (!group || !select) return;

    const blocks = isSequentialMode()
        ? buildRangeOptions(countActivePoolQuestions(), selectedCount())
        : [];

    if (blocks.length === 0) {
        group.style.display = 'none';
        /* Reset rather than remember. A hidden control the user cannot see is
           not allowed to keep deciding which questions a test draws. */
        AppState.questionStartIndex = 0;
        return;
    }

    const start = normalizeStart(blocks);
    AppState.questionStartIndex = start;

    group.style.display = 'block';
    select.innerHTML = blocks
        .map(b => `<option value="${b.start}"${b.start === start ? ' selected' : ''}>${b.label}</option>`)
        .join('');
}

/** Called by the select's own change handler. */
export function setQuestionStartIndex(value) {
    const parsed = parseInt(value, 10);
    AppState.questionStartIndex = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Steps the picker to the next block after a sequential session finishes, so
 * walking a source front to back needs no interaction - and wraps to the start
 * once the pool runs out.
 *
 * Deliberately visible: the picker repaints, and the caller says so out loud.
 * A silent cursor would leave the user unable to explain why the same setup
 * produced different questions.
 *
 * @returns {{label: string}|null} the block moved to, or null if nothing moved.
 */
export function advanceQuestionRange() {
    if (!isSequentialMode()) return null;

    const blocks = buildRangeOptions(countActivePoolQuestions(), selectedCount());
    if (blocks.length === 0) return null;

    const idx = blocks.findIndex(b => b.start === (AppState.questionStartIndex || 0));
    const next = blocks[(idx + 1) % blocks.length];

    AppState.questionStartIndex = next.start;
    renderQuestionRangePicker();
    return next;
}

/** The toast wording for a picker that moved on its own. */
export function rangeAdvancedMessage(block) {
    return t('range_advanced', { range: block.label });
}
