import { setMark } from './question-marks.js';

/**
 * Questions that are stuck.
 *
 * FSRS has no exit. A question answered wrong often enough has its stability
 * driven down towards the 0.1-day floor applyFSRS() clamps it to, which means
 * `calculateRetrievability` reports it as overdue again within hours - forever.
 * It sits at the top of the overdue pool, takes one of the day's slots every
 * single day, and is never learned. Anki calls this a leech and suspends it at
 * eight lapses; this app had no notion of it at all, so `stat.wrong` was
 * incremented on every miss and then never read by anything.
 *
 * The threshold is fixed and not a setting. A number the user can move is a
 * number the user has to have an opinion about, and there is no way to form
 * one: the honest answer to "how many misses is too many" is "enough that
 * seeing it again tomorrow is not working", which is what 8 encodes.
 *
 * A stuck question is not removed from anything by being detected. Detection
 * only puts it in front of the user, who decides: rewrite it (usually the
 * question is at fault - ambiguous, two right answers, a typo in the key) or
 * suspend it. Suspending keeps every statistic and only takes the question out
 * of the pool tests are drawn from, so nothing is lost and it can come back.
 */

/** Misses at which a question is considered stuck. Anki's default, and the
 *  same reasoning: past this, repetition alone has stopped working. */
export const LEECH_WRONG_THRESHOLD = 8;

/** A run of correct answers that says the question is no longer stuck. */
export const LEECH_RECOVERY_STREAK = 3;

/**
 * Is this question stuck?
 *
 * Two conditions, and both are needed. The miss count alone would keep
 * flagging a question the user has since fixed and now answers correctly every
 * time - the counter only goes up, so it can never clear itself. The current
 * streak says whether the trouble is still live.
 */
export function isLeech(stat) {
    if (!stat) return false;
    if (stat.suspended) return false; // already dealt with
    const wrong = stat.wrong || 0;
    if (wrong < LEECH_WRONG_THRESHOLD) return false;
    return (stat.streak || 0) < LEECH_RECOVERY_STREAK;
}

/** Is this question held out of the pool tests are drawn from? */
export function isSuspended(stat) {
    return !!(stat && stat.suspended);
}

/**
 * Suspends or un-suspends.
 *
 * `suspended` is one of MARK_KEYS, so it is stamped and merged exactly as the
 * star and the flag are. That matters more here than anywhere else: without a
 * stamp, un-suspending on one device is written straight back by the other and
 * the question stays out of rotation for good.
 */
export function setSuspended(stat, value, now = Date.now()) {
    return setMark(stat, 'suspended', value, now);
}

/** Flips the suspension. */
export function toggleSuspended(stat, now = Date.now()) {
    return setSuspended(stat, !isSuspended(stat), now);
}

/** How many of these stats are stuck. Used for the filter's count badge. */
export function countLeeches(stats, keys) {
    if (!stats) return 0;
    const list = keys || Object.keys(stats);
    return list.reduce((n, key) => n + (isLeech(stats[key]) ? 1 : 0), 0);
}
