/**
 * What the stats screen carries with it: the filter and the search scope, and
 * how much of either survives a click or a trip through history.
 *
 * These three rules used to be spelled out inside main.js's event wiring, where
 * nothing could reach them. They are the rules that decide *which questions the
 * filter bar is filtering*, so they get their own module and their own test.
 */

import { AppState } from '../../core/state.js';

/** The two tabs that list tests instead of questions. */
const HISTORY_TABS = ['recent', 'incorrect'];

/**
 * True for a "$Alpha" / "$Alpha & Beta" search - a scope, not a question.
 *
 * It answers the same thing the "Tüm Kaynaklar" toggle answers - which sources -
 * so the pool honours it directly and the footer names it as the scope.
 */
export function isSourceScope(keyword) {
    const kw = (keyword || '').trim();
    return kw.startsWith('$') && kw.slice(1).trim() !== '';
}

/**
 * The search term a filter button leaves running.
 *
 * A source scope survives, so pressing Yıldızlı while looking at one source
 * means "starred in this source". It used to be dropped with everything else:
 * the list jumped to the whole active library while the heading still named the
 * source. Free text and "#tag" are questions about the questions, not a scope,
 * and those still clear - as does anything at all on the two history tabs,
 * which the search box has never reached.
 */
export function keptSearchOnFilterClick(filter, keyword) {
    if (filter === 'all') return keyword || '';
    if (HISTORY_TABS.includes(filter)) return '';
    return isSourceScope(keyword) ? keyword : '';
}

/**
 * The history entry for a view, with the stats screen described by what is
 * actually running rather than by a default.
 *
 * AppState owns the filter and the search; a history entry is a picture of them,
 * the same rule the highlighted button follows. Writing `filter: 'all'` into
 * every entry made the picture a lie, and popstate believes the picture: opening
 * a question from "Yanlış Yapılanlar" and coming back landed on "Tümü" showing
 * every question of every active source, with the tab silently dropped.
 */
export function statsHistoryState(view) {
    if (view !== 'stats') return { view, searchQuery: '', filter: 'all' };
    return {
        view,
        searchQuery: AppState.searchKeyword || '',
        filter: AppState.activeTagFilter
            ? 'tag:' + AppState.activeTagFilter
            : (AppState.activeStatsFilter || 'all')
    };
}

/**
 * Re-points the current stats entry at the filter and search now on screen.
 *
 * The entry is written once on the way in, but the user goes on changing the
 * filter inside it. Without this a Back from the question preview restores the
 * filter that was running when the screen was opened, not the one they left.
 */
export function stampStatsHistory() {
    if (typeof history === 'undefined') return;
    if (history.state?.view !== 'stats') return;
    const next = statsHistoryState('stats');
    const cur = history.state;
    if (cur.filter === next.filter && cur.searchQuery === next.searchQuery) return;
    const hashUrl = next.searchQuery ? `#stats?q=${encodeURIComponent(next.searchQuery)}` : '#stats';
    try {
        history.replaceState(next, '', hashUrl);
    } catch (err) { }
}
