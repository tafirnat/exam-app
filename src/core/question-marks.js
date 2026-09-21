/**
 * The star and the flag: one writer, one merge rule.
 *
 * Both used to be plain booleans that four different places set directly, and
 * the merge combined them with OR. OR cannot carry a deletion: unstar a
 * question on the phone and the laptop, which still holds `starred: true`,
 * writes it straight back on the next sync. The mark came back every time and
 * the button read as broken.
 *
 * The note solved the same problem with a stamp (see pickNote in
 * github-sync.js), so the marks use the same shape: every write records WHEN,
 * and the newest write wins - including a write to false. Records from before
 * stamps existed carry none, and between two of those the old forgiving rule
 * still decides, so nothing already on a device is lost by upgrading.
 *
 * Every write goes through setMark/toggleMark. Stamping at each call site by
 * hand is how one of them ends up forgetting: an unstamped unset is silently
 * un-mergeable and nothing throws. tests/question-marks.test.mjs scans for
 * direct assignments outside this module.
 */

/* The marks that carry a stamp.
   `suspended` (see leech.js) is one of them rather than a field of its own:
   it is the same shape - a boolean the user sets and unsets, that no answer
   touches - and it is the one where an un-mergeable unset does the most
   damage, since the question would stay out of rotation for good. */
export const MARK_KEYS = Object.freeze(['starred', 'flagged', 'suspended']);

/** The field holding the moment a mark was last written. */
export function markStampKey(mark) {
    return `${mark}UpdatedAt`;
}

/**
 * Writes a mark and stamps it.
 * @returns {boolean} the value now held.
 */
export function setMark(stat, mark, value, now = Date.now()) {
    if (!stat) return false;
    const next = !!value;
    stat[mark] = next;
    stat[markStampKey(mark)] = now;
    return next;
}

/** Flips a mark and stamps it. */
export function toggleMark(stat, mark, now = Date.now()) {
    return setMark(stat, mark, !(stat && stat[mark]), now);
}

/**
 * Chooses between two devices' copy of one mark.
 *
 * @returns {{value: boolean, updatedAt: number|undefined}}
 */
export function pickMark(lStat, rStat, mark) {
    const key = markStampKey(mark);
    const lAt = Number(lStat && lStat[key]) || 0;
    const rAt = Number(rStat && rStat[key]) || 0;

    if (lAt !== rAt) {
        const side = lAt > rAt ? lStat : rStat;
        return { value: !!(side && side[mark]), updatedAt: Math.max(lAt, rAt) };
    }

    if (lAt === 0) {
        /* Neither side has ever stamped this mark, so there is no deletion to
           carry - only the pre-stamp data. Keep the old forgiving rule so an
           upgrade does not drop a star that only one device has. */
        return { value: !!((lStat && lStat[mark]) || (rStat && rStat[mark])), updatedAt: undefined };
    }

    /* Stamped in the same millisecond on two devices. Either answer converges
       as long as both devices reach the same one; keeping the mark is the
       recoverable direction - the user can always unset it again. */
    return {
        value: !!((lStat && lStat[mark]) || (rStat && rStat[mark])),
        updatedAt: lAt
    };
}

/** True when a stat carries something the user typed or toggled themselves. */
export function hasUserAnnotation(stat) {
    if (!stat) return false;
    if (stat.note && String(stat.note).trim()) return true;
    return MARK_KEYS.some(mark => !!stat[mark]);
}
