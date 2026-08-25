/**
 * The single table that says which data slice redraws which part of the screen.
 *
 * This is the only file that knows both halves. state.js announces slices and
 * never names a renderer; the feature modules export renderers and never watch
 * for changes. Adding a screen means adding one row here - not another
 * `if (typeof window.renderX === 'function') window.renderX()` at every mutation
 * site, which is how this codebase accumulated 31 calls to renderSourcesList()
 * and 17 to updateHomeStats().
 *
 * Rows are grouped by the screen they belong to, and the groups are
 * independent: a change to the alert settings touches only the settings row,
 * and the yearly activity chart is not in it.
 */

import { subscribe, runAll, setActiveView, Slice } from './store.js';
import { AppState } from './state.js';

import { renderSourcesList, renderHomeActiveSources } from '../features/sources/sources-ui.js';
import { renderContinuityBlock, renderGlobalCharts } from '../features/stats/continuity-ui.js';
import { renderStatsList, updateHomeStats, refreshProgressChartOverlay } from '../features/stats/stats-module.js';
import { renderResumeButton } from '../features/test/test-ui.js';
import { renderQuestionRangePicker } from '../features/test/test-range.js';
import { updateQuickSourcesDot } from '../features/sources/quick-presets-ui.js';
import { syncQuickPresetsWithLiveSources } from '../features/sources/quick-presets.js';
import { updateSyncUI } from './github-sync.js';

/** Views as switchView() names them. */
export const View = Object.freeze({
    HOME: 'home',
    SOURCES: 'sources',
    STATS: 'stats',
    TEST: 'test',
    RESULTS: 'results',
    STATS_PREVIEW: 'statsPreview'
});

/**
 * renderStatsList() takes the filter and the search term as arguments and
 * writes them back onto AppState, so calling it bare would silently reset the
 * user's filter to "all" on every stats change. A redraw has to re-assert the
 * state that is already active.
 */
function redrawStatsList() {
    renderStatsList(AppState.activeStatsFilter || 'all', AppState.searchKeyword || '');
}

/**
 * name          diagnostic id, and the key that makes a re-registration replace
 *               rather than duplicate
 * slices        what invalidates this consumer
 * run           idempotent redraw
 * views         where it is visible; omitted means "always keep current"
 */
const BINDINGS = [
    // ── Home ────────────────────────────────────────────────────────────────
    {
        name: 'home:summary',
        slices: [Slice.SOURCES, Slice.STATS, Slice.ACTIVE_TEST],
        run: updateHomeStats,
        views: [View.HOME]
    },
    {
        /* "Devam Et" / "Yeni Test". The unfinished-test record is synced, so
           this changes without anyone on this device touching it: the other
           device leaves a test open, or finishes one and leaves a cleared
           record behind. Until this row existed the button was only recomputed
           on navigation, so the home screen could offer to resume a test that
           had already been finished elsewhere - and a page refresh was the only
           way to find out. */
        name: 'home:resume',
        slices: [Slice.ACTIVE_TEST],
        run: renderResumeButton,
        views: [View.HOME]
    },
    {
        /* STATS is in here for the per-topic mastery on each row: it is derived
           from AppState.stats, so without this slice the percentages would sit
           at the value they had when the source list last changed - a session's
           work would not show until something else touched sources. The view
           gate keeps the cost off the answer path; store defers a hidden
           consumer and runs it once on the way back in. */
        name: 'home:activeSources',
        slices: [Slice.SOURCES, Slice.FOLDERS, Slice.STATS],
        run: renderHomeActiveSources,
        views: [View.HOME]
    },
    {
        /* Where a sequential session starts. Both halves of its visibility come
           from the library: whether every active source asks to be kept in order,
           and how many questions the pool holds. Switching a source on or off
           changes both, so the picker cannot be drawn once at boot. The session
           size is the other input, and that one is wired to the select itself. */
        name: 'home:questionRange',
        slices: [Slice.SOURCES, Slice.PRESETS],
        run: renderQuestionRangePicker,
        views: [View.HOME]
    },
    {
        /* The streak card and its freeze tokens. Reads activity for the day
           count and continuity for the tokens; both move independently. */
        name: 'home:continuity',
        slices: [Slice.ACTIVITY, Slice.CONTINUITY, Slice.SOURCES],
        run: renderContinuityBlock,
        views: [View.HOME]
    },
    {
        /* Heatmap, weekly/monthly trend and the difficulty donut. The most
           expensive redraw in the app and the reason the view gate exists:
           answering a question used to leave these showing yesterday's data
           because nothing on the answer path called them. */
        name: 'home:charts',
        slices: [Slice.ACTIVITY, Slice.STATS, Slice.SOURCES],
        run: renderGlobalCharts,
        views: [View.HOME]
    },

    {
        /* The panel behind the home progress bar: the same three figures the
           charts above show, for one source at a time. It was drawn on open and
           by nothing else, so it froze the moment it appeared - a sync pull or a
           test finished in another tab left it describing a state that no longer
           existed, under a header that still named the source.

           No view gate: the gate here is whether the overlay is up, which its
           renderer checks itself. Gating on HOME instead would defer the redraw
           behind an overlay the user is looking at. */
        name: 'home:progressChartPanel',
        slices: [Slice.ACTIVITY, Slice.STATS, Slice.SOURCES],
        run: refreshProgressChartOverlay
    },

    // ── Sources ─────────────────────────────────────────────────────────────
    {
        name: 'sources:list',
        slices: [Slice.SOURCES, Slice.FOLDERS, Slice.STATS],
        run: renderSourcesList,
        views: [View.SOURCES]
    },
    {
        /* A preset that points at a deleted source has to stop pointing at it
           before any preset UI is drawn, so this runs on the data, not a view. */
        name: 'presets:reconcile',
        slices: [Slice.SOURCES],
        run: syncQuickPresetsWithLiveSources
    },
    {
        /* A header badge - visible from every screen, so no view gate. */
        name: 'presets:dot',
        slices: [Slice.SOURCES, Slice.PRESETS],
        run: updateQuickSourcesDot
    },

    // ── Stats ───────────────────────────────────────────────────────────────
    {
        name: 'stats:list',
        slices: [Slice.STATS, Slice.SOURCES, Slice.RECENT_TESTS, Slice.STATS_VIEW, Slice.ACTIVITY],
        run: redrawStatsList,
        views: [View.STATS]
    },

    // ── Chrome (always current) ─────────────────────────────────────────────
    {
        /* Sync status lives in the menu, which opens over any view. */
        name: 'chrome:sync',
        slices: [Slice.SYNC],
        run: updateSyncUI
    }
];

let installed = false;

/**
 * Installs every binding. Idempotent: calling it twice replaces the
 * registrations rather than doubling them, because subscribe() keys on name.
 */
export function registerUIBindings() {
    for (const { name, slices, run, views } of BINDINGS) {
        subscribe(name, slices, run, views ? { views } : undefined);
    }
    installed = true;
}

/**
 * Paints everything once, after boot has loaded state and the DOM is ready.
 * Consumers whose view is not active are marked pending and catch up on the
 * first switchView() into them.
 */
export function paintAll() {
    if (!installed) registerUIBindings();
    runAll();
}

/** Told to the store by switchView() so the view gate reflects reality. */
export function notifyViewChanged(view) {
    setActiveView(view);
}
