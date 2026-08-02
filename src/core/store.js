/**
 * The one place a data change is announced, and the one place a UI refresh is
 * dispatched from.
 *
 * Before this, every mutation had to remember which renderers it invalidated:
 * `renderSourcesList()` was called from 31 sites, `updateHomeStats()` from 17,
 * and modules reached each other through `window.*` because the import graph is
 * cyclic. The cost of that was not just duplication - the charts were only
 * redrawn on three specific paths, so answering a question left the heatmap and
 * the trend lines showing yesterday's data until something else happened to
 * repaint them.
 *
 * Producers now say *what changed* (`emit(Slice.ACTIVITY)`) and never name a
 * renderer. Consumers say *what they depend on* and never watch for events.
 * ui-bindings.js is the single table that connects the two.
 *
 * Three properties make this cheap enough to call on every save:
 *
 *   - Coalescing. Emits inside one tick accumulate into a dirty set and are
 *     flushed once, on an animation frame. Fifty saves in a burst cost one
 *     repaint, not fifty.
 *   - Deduplication. A consumer listening to both `sources` and `folders` runs
 *     once per flush, not twice.
 *   - Visibility gating. A consumer bound to a hidden view is marked pending
 *     instead of run, and catches up the moment that view is shown. Redrawing
 *     the yearly heatmap while the user is on the test screen is pure waste.
 */

/**
 * Data domains. The split is by what changes together and what redraws
 * together: a change to the alert settings has nothing to do with the yearly
 * activity chart, so they must never share a slice.
 */
export const Slice = Object.freeze({
    /** Question sources, their questions, active/archived flags. */
    SOURCES: 'sources',
    /** Folder records: names, colours, order, membership. */
    FOLDERS: 'folders',
    /** Per-question stats and the global totals - success rates, FSRS state. */
    STATS: 'stats',
    /** Per-day study activity. Backs the heatmap and the trend charts. */
    ACTIVITY: 'studyActivity',
    /** Streaks, freeze tokens, focus pools, notification settings. */
    CONTINUITY: 'continuity',
    /** Finished test history. */
    RECENT_TESTS: 'recentTests',
    /** Quick preset definitions and their saved sessions. */
    PRESETS: 'quickPresets',
    /** The in-progress test: current index, answers, checked state. */
    ACTIVE_TEST: 'activeTest',
    /** GitHub connection and last-sync state. */
    SYNC: 'sync',
    /** TTS, timer, AI providers, custom prompt. */
    SETTINGS: 'settings',
    /** UI language and translation target. */
    LANGUAGE: 'language',
    /** Light/dark theme. */
    THEME: 'theme',
    /** Stats screen filter, sort and search. View state, not persisted data. */
    STATS_VIEW: 'statsView'
});

const KNOWN_SLICES = new Set(Object.values(Slice));

/** @type {Map<string, {name: string, slices: Set<string>, run: Function, views: Set<string>|null, pending: boolean}>} */
const subscribers = new Map();

/** Slices changed since the last flush. */
let dirty = new Set();

let flushScheduled = false;
let flushing = false;
let activeView = null;

/* A subscriber may itself write state (a renderer that repairs a stale record,
   say). That re-enters emit() during a flush; rather than recursing we let the
   current pass finish and schedule another. The cap stops a genuine
   emit/render feedback loop from freezing the tab. */
const MAX_CHAINED_FLUSHES = 5;
let chainedFlushes = 0;

/* A queued flush is a callback already handed to rAF or setTimeout - neither
   can be recalled. Bumping the generation makes any in-flight callback a no-op,
   which is what lets _reset() actually cancel queued work instead of leaving it
   to fire against the next set of subscribers. */
let generation = 0;

/**
 * Registers a UI consumer.
 *
 * @param {string} name        Stable id, used for diagnostics and to replace a
 *                             previous registration of the same consumer.
 * @param {string[]} slices    Data domains this consumer reads.
 * @param {Function} run       Idempotent redraw. Must tolerate being called
 *                             when its own DOM is absent.
 * @param {{views?: string[]}} [options]
 *        `views` limits the consumer to those views; while another view is
 *        active its updates are deferred, then applied on the way in. Omit for
 *        consumers that must stay current regardless (header counters, badges).
 * @returns {Function} Unsubscribe.
 */
export function subscribe(name, slices, run, options = {}) {
    if (typeof run !== 'function') {
        throw new TypeError(`subscribe("${name}"): run must be a function`);
    }
    for (const slice of slices) {
        if (!KNOWN_SLICES.has(slice)) {
            throw new Error(`subscribe("${name}"): unknown slice "${slice}"`);
        }
    }

    subscribers.set(name, {
        name,
        slices: new Set(slices),
        run,
        views: options.views ? new Set(options.views) : null,
        pending: false
    });

    return () => { subscribers.delete(name); };
}

/**
 * Announces that one or more data domains changed. Cheap and safe to call from
 * any depth - the actual work happens once, on the next frame.
 */
export function emit(...slices) {
    let added = false;
    for (const slice of slices) {
        if (!KNOWN_SLICES.has(slice)) {
            console.warn(`[store] emit() ignored unknown slice "${slice}"`);
            continue;
        }
        dirty.add(slice);
        added = true;
    }
    if (added) scheduleFlush();
}

function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;

    const scheduledFor = generation;
    const callback = () => runFlush(scheduledFor);

    /* An animation frame is the right cadence for visual work, but it is
       throttled to nothing in a background tab - and a sync pull can land
       there. Fall back to a timer whenever the page is not visible. */
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (!hidden && typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(callback);
    } else {
        setTimeout(callback, 0);
    }
}

function runFlush(scheduledFor = generation) {
    if (scheduledFor !== generation) return;
    flushScheduled = false;
    if (flushing) return;

    const changed = dirty;
    dirty = new Set();
    if (changed.size === 0) {
        chainedFlushes = 0;
        return;
    }

    flushing = true;
    try {
        for (const sub of subscribers.values()) {
            if (!intersects(sub.slices, changed)) continue;

            if (!isVisible(sub)) {
                /* Deferred, not dropped: the consumer redraws from current
                   state, so one catch-up run on the way in is enough no matter
                   how many changes it missed. */
                sub.pending = true;
                continue;
            }
            runSubscriber(sub);
        }
    } finally {
        flushing = false;
    }

    /* A subscriber wrote state while we were flushing. */
    if (dirty.size > 0) {
        if (chainedFlushes >= MAX_CHAINED_FLUSHES) {
            console.error(
                '[store] emit/render feedback loop detected; dropping',
                [...dirty].join(', ')
            );
            dirty = new Set();
            chainedFlushes = 0;
            return;
        }
        chainedFlushes++;
        scheduleFlush();
    } else {
        chainedFlushes = 0;
    }
}

function runSubscriber(sub) {
    sub.pending = false;
    try {
        sub.run();
    } catch (err) {
        /* One broken renderer must not stop the rest of the screen from
           updating - that failure mode is what makes a stale UI look like lost
           data. */
        console.error(`[store] subscriber "${sub.name}" failed:`, err);
    }
}

function intersects(a, b) {
    for (const value of a) {
        if (b.has(value)) return true;
    }
    return false;
}

function isVisible(sub) {
    if (!sub.views) return true;
    return activeView !== null && sub.views.has(activeView);
}

/**
 * Tells the store which view is on screen. Consumers bound to it that fell
 * behind while it was hidden are brought up to date immediately, before the
 * frame paints, so the view is never shown stale.
 */
export function setActiveView(view) {
    activeView = view;

    for (const sub of subscribers.values()) {
        if (sub.pending && isVisible(sub)) runSubscriber(sub);
    }
}

export function getActiveView() {
    return activeView;
}

/**
 * Runs a consumer once, right now, regardless of dirty state. For the initial
 * paint after boot, where there is nothing to invalidate yet.
 */
export function runNow(name) {
    const sub = subscribers.get(name);
    if (sub) runSubscriber(sub);
}

/** Runs every registered consumer once. Used for the first paint. */
export function runAll() {
    for (const sub of subscribers.values()) {
        if (isVisible(sub)) runSubscriber(sub);
        else sub.pending = true;
    }
}

/**
 * Applies everything queued synchronously. Tests use it to avoid waiting on a
 * frame; production code should not need it.
 */
export function flushNow() {
    flushScheduled = false;
    runFlush();
}

/** Test seam: drops all subscribers and queued work. */
export function _reset() {
    subscribers.clear();
    dirty = new Set();
    flushScheduled = false;
    flushing = false;
    activeView = null;
    chainedFlushes = 0;
    generation++;
}

/** Test/diagnostic seam: what is registered and what it listens to. */
export function _inspect() {
    return {
        activeView,
        dirty: [...dirty],
        subscribers: [...subscribers.values()].map(s => ({
            name: s.name,
            slices: [...s.slices],
            views: s.views ? [...s.views] : null,
            pending: s.pending
        }))
    };
}
