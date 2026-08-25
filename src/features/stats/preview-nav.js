/**
 * Moving between questions in the preview, and keeping the preview honest.
 *
 * Two jobs that share one fact, which is why they share a file: what the user is
 * looking at is a *copy* of a question, taken when the list row was clicked.
 *
 *   - Navigation needs the list the copy came from, in the order it was shown.
 *     "The next question" means the next one in the filtered, searched, sorted
 *     list on screen - not the next one in the source file.
 *   - Freshness needs the copy reconciled with the stored question, because an
 *     edit replaces the object inside the source and leaves the copy pointing at
 *     the old one. That is why a saved edit used to be invisible until the user
 *     left the preview and came back.
 *
 * The list is handed in by whoever painted it, so this module never has to know
 * how the stats list filters or what a results screen is.
 */

import { AppState } from '../../core/state.js';

/** The questions currently navigable, in the order they were shown. */
let navList = [];

/** Identity of a question across a library that reuses ids between sources. */
function keyOf(entry) {
    return entry ? `${entry.sourceId}_${entry.id}` : null;
}

/**
 * Records the list a preview will be opened from.
 * @param {Array<Object>} items questions in display order
 */
export function setPreviewNavList(items) {
    navList = Array.isArray(items) ? [...items] : [];
}

export function getPreviewNavList() {
    return navList;
}

/** Index of the question on screen within that list, or -1. */
export function currentNavIndex() {
    const key = keyOf(AppState.previewQuestion);
    if (!key) return -1;
    return navList.findIndex(item => keyOf(item) === key);
}

/**
 * Where the user is, for the "12 / 87" label and for enabling the arrows.
 * @returns {{index: number, total: number, hasPrev: boolean, hasNext: boolean}}
 */
export function getPreviewNavPosition() {
    const index = currentNavIndex();
    const total = navList.length;
    return {
        index,
        total,
        hasPrev: index > 0,
        hasNext: index >= 0 && index < total - 1
    };
}

/** "12 / 87", or '' when the question is not part of a navigable list. */
export function navPositionLabel() {
    const { index, total } = getPreviewNavPosition();
    return index < 0 ? '' : `${index + 1} / ${total}`;
}

/**
 * Overlays the stored question onto a recorded entry.
 *
 * The spread order matters both ways. `stored` last, so an edit wins over the
 * stale copy; the entry's own extras named after it, because they exist only on
 * the copy: `userAnswer` / `isCorrect` / `isUnanswered` are what a results or
 * history row is *about*, and `sourceName` / `originalIndex` are decorations the
 * stats list added. Dropping either would turn a reviewed answer into a blank
 * question the moment anything repainted.
 *
 * A question that no longer exists (deleted source, deleted question) comes back
 * untouched: a history row is allowed to outlive what it describes.
 */
export function resolvePreviewQuestion(entry) {
    if (!entry) return entry;

    const source = (AppState.sources || []).find(s => s.id === entry.sourceId);
    const stored = source?.questions?.find(q => String(q.id) === String(entry.id));
    if (!stored) return entry;

    return {
        ...entry,
        ...stored,
        sourceId: entry.sourceId,
        sourceName: entry.sourceName,
        originalIndex: entry.originalIndex,
        userAnswer: entry.userAnswer,
        isCorrect: entry.isCorrect,
        isUnanswered: entry.isUnanswered
    };
}

/**
 * The question `delta` steps away in the shown order, already reconciled with
 * storage. Null at either end, or when the current question is not in the list.
 */
export function neighbourQuestion(delta) {
    const index = currentNavIndex();
    if (index < 0) return null;

    const target = index + delta;
    if (target < 0 || target >= navList.length) return null;

    /* Resolved on the way out rather than cached back into the list: the list
       holds what was *shown*, and reconciling on every step is what makes an
       edit made two questions ago visible when the arrows come back to it. */
    return resolvePreviewQuestion(navList[target]);
}

/**
 * Enables or disables a pair of arrows.
 *
 * Only the disabled state: the position goes in its own node beside the title.
 * Writing it into `title` looked tidier and lost - these buttons carry
 * data-i18n-title, so updateStaticTranslations() puts the tooltip back and the
 * two writes take turns. Measured in the browser, where the tooltip won.
 */
export function updateNavButtons(prevEl, nextEl) {
    const { hasPrev, hasNext } = getPreviewNavPosition();
    if (prevEl) prevEl.disabled = !hasPrev;
    if (nextEl) nextEl.disabled = !hasNext;
}
