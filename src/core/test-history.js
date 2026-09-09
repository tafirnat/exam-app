/**
 * Shared arithmetic for finished-test history entries.
 *
 * A history entry is what finishTest() writes: `{ id, sourceNames, sourceTitle,
 * startTime, endTime, questions, ...counts }`. The same shape is stored twice -
 * once whole in `AppState.recentTests` (the global log, capped at 10) and once
 * per source in `source.testResults` (capped at 5), sliced to that source's
 * questions. The two copies of one session share `startTime`, which is the only
 * field that identifies the session rather than the row.
 *
 * This lives in core/ because both the sync merge and the stats screen need the
 * same two answers - when did this session happen, and are these two rows the
 * same session - and a second copy of either would drift.
 */

/**
 * When a history entry happened, in ms.
 *
 * Entries carry `startTime`/`endTime` as ISO strings and `id` as a Date.now()
 * (the per-source copy adds a random fraction to keep ids distinct). They have
 * never carried a `timestamp` field; code that asked for one got 0 for every
 * entry ever written, which is how the sync floor came to drop the whole log.
 *
 * @param {object} entry
 * @returns {number} ms since epoch, or 0 when the entry dates itself no way at all.
 */
export function historyEntryTime(entry) {
    if (!entry) return 0;
    const fromIso = (v) => {
        if (!v) return 0;
        const ms = new Date(v).getTime();
        return Number.isFinite(ms) ? ms : 0;
    };
    const started = fromIso(entry.startTime) || fromIso(entry.endTime);
    if (started) return started;
    const id = Number(entry.id);
    return Number.isFinite(id) ? Math.floor(id) : 0;
}

/**
 * The key that says "these two rows are the same test session".
 *
 * `id` cannot do it: the per-source copy is written with `Date.now() + Math.random()`
 * precisely so it does not collide with the global one. `startTime` is copied
 * from the same `testTracking.startTime` into both, so it does.
 *
 * @param {object} entry
 * @returns {string}
 */
export function historySessionKey(entry) {
    if (!entry) return '';
    return String(entry.startTime || entry.endTime || entry.id || '');
}
