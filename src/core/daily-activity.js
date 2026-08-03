/**
 * One day of study, and the arithmetic three modules have to agree on.
 *
 * The day record is written by the continuity engine, repaired by migration.js
 * and merged by github-sync.js. Those three cannot import each other - the
 * engine and the test engine are already mutually recursive, and migration.js
 * deliberately holds no feature imports - so the rules kept getting copied
 * instead, right down to a literal 15 in migration.js with a comment admitting
 * it mirrored getDailyRequirement(). This module is where they actually live.
 *
 * ── Why a day is counted per device ────────────────────────────────────────
 *
 * A day used to be a flat set of counters, merged with Math.max. That is
 * convergent but wrong: two devices are not two views of one total, they are
 * two parts of it. Answer five questions on the laptop and five on the phone
 * and the day is ten - Math.max called it five, and the five that lost were
 * simply gone. Summing the flat counters instead is worse: every sync would add
 * the same answers again, which is how a day once reached the millions.
 *
 * Each device therefore counts into its own bucket. A bucket only grows, and
 * only its own device writes it, so merging is max per bucket - lossless, and
 * idempotent no matter how often it runs. The day's totals are the sum across
 * buckets, derived rather than stored, so no reader had to change.
 */

/** The day's target when nothing narrower applies. */
export const DAILY_TARGET = 15;

/**
 * A day written before per-device counting. Both devices seed it from their own
 * flat counters, so max keeps the larger of the two - exactly what the old
 * merge did - while anything answered from here on lands in a real bucket and
 * adds. Old days therefore neither inflate nor lose anything.
 */
export const LEGACY_BUCKET = '_legacy';

/** The counters a bucket carries. Everything else about a day is a flag. */
export const COUNTER_KEYS = Object.freeze([
    'questionCount', 'correctCount', 'wrongCount', 'unansweredCount', 'focusQuestionCount'
]);

/**
 * How many questions the day asks for.
 *
 * - snapshot >= 15 -> 15
 * - 0 < snapshot < 15 -> the snapshot itself
 * - 0, null or undefined -> 15 ("nothing overdue" is not "nothing to do")
 */
export function getDailyRequirement(overdueSnapshot) {
    if (overdueSnapshot === null || overdueSnapshot === undefined) return DAILY_TARGET;
    if (overdueSnapshot >= DAILY_TARGET) return DAILY_TARGET;
    if (overdueSnapshot > 0) return overdueSnapshot;
    return DAILY_TARGET;
}

const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** True when a bucket says anything at all. */
function bucketHasCounts(bucket) {
    return COUNTER_KEYS.some(key => count(bucket && bucket[key]) > 0);
}

/**
 * The day's buckets, creating the legacy one on first sight of an old record.
 *
 * Mutates `activity`, because the caller is about to write into what it returns.
 */
export function bucketsOf(activity) {
    if (activity.byDevice && typeof activity.byDevice === 'object' && !Array.isArray(activity.byDevice)) {
        return activity.byDevice;
    }
    const legacy = {};
    COUNTER_KEYS.forEach(key => { legacy[key] = count(activity[key]); });
    activity.byDevice = bucketHasCounts(legacy) ? { [LEGACY_BUCKET]: legacy } : {};
    return activity.byDevice;
}

/**
 * Rewrites the day's totals from its buckets.
 *
 * The flags are raised, never lowered: `studied` is a fact about a day that was
 * earned, and a device that has not yet seen the other's bucket must not be
 * able to take it back. Raising it here is what lets a day split across two
 * devices - eight questions each against a fifteen-question bar - count at all;
 * neither device set it, because neither one reached the bar alone.
 */
export function recomputeDayTotals(activity) {
    const buckets = Object.values(activity.byDevice || {});
    COUNTER_KEYS.forEach(key => {
        activity[key] = buckets.reduce((sum, bucket) => sum + count(bucket && bucket[key]), 0);
    });

    if (activity.questionCount >= getDailyRequirement(activity.overdueSnapshot)) {
        activity.studied = true;
    }
    if (activity.focusQuestionCount >= getDailyRequirement(activity.focusOverdueSnapshot)) {
        activity.focusStudied = true;
    }
    return activity;
}

/**
 * Adds one device's answers to a day.
 *
 * @param {string} deviceKey which bucket to grow - the writing device's id.
 */
export function addToDay(activity, deviceKey, delta) {
    const buckets = bucketsOf(activity);
    const key = deviceKey || LEGACY_BUCKET;
    const bucket = buckets[key] || (buckets[key] = {});

    COUNTER_KEYS.forEach(name => {
        const amount = count(delta && delta[name]);
        if (amount > 0) bucket[name] = count(bucket[name]) + amount;
    });

    if (delta && delta.questionLog) {
        if (!bucket.questionLog) bucket.questionLog = {};
        for (const qId of Object.keys(delta.questionLog)) {
            const stats = delta.questionLog[qId];
            if (!bucket.questionLog[qId]) {
                bucket.questionLog[qId] = { correct: 0, wrong: 0, empty: 0, isFocus: false };
            }
            if (stats.correct) bucket.questionLog[qId].correct += stats.correct;
            if (stats.wrong) bucket.questionLog[qId].wrong += stats.wrong;
            if (stats.empty) bucket.questionLog[qId].empty += stats.empty;
            if (stats.isFocus) bucket.questionLog[qId].isFocus = true;
        }
    }

    return recomputeDayTotals(activity);
}

/**
 * Merges two devices' views of one day's buckets.
 *
 * Union of the keys, and the larger figure for each counter within a bucket. A
 * bucket belongs to the device named by its key and only ever grows, so the
 * larger figure is simply the more recent one - there is no case where taking
 * it loses an answer, and no case where taking it twice adds one.
 */
export function mergeDayBuckets(left, right) {
    const merged = {};
    const keys = new Set([
        ...Object.keys(left && typeof left === 'object' ? left : {}),
        ...Object.keys(right && typeof right === 'object' ? right : {})
    ]);

    keys.forEach(key => {
        const l = (left && left[key]) || {};
        const r = (right && right[key]) || {};
        const bucket = {};
        COUNTER_KEYS.forEach(name => {
            const value = Math.max(count(l[name]), count(r[name]));
            if (value > 0) bucket[name] = value;
        });

        const qLogL = l.questionLog || {};
        const qLogR = r.questionLog || {};
        const qKeys = new Set([...Object.keys(qLogL), ...Object.keys(qLogR)]);
        
        if (qKeys.size > 0) {
            bucket.questionLog = {};
            qKeys.forEach(qId => {
                const sl = qLogL[qId] || { correct: 0, wrong: 0, empty: 0, isFocus: false };
                const sr = qLogR[qId] || { correct: 0, wrong: 0, empty: 0, isFocus: false };
                bucket.questionLog[qId] = {
                    correct: Math.max(sl.correct || 0, sr.correct || 0),
                    wrong: Math.max(sl.wrong || 0, sr.wrong || 0),
                    empty: Math.max(sl.empty || 0, sr.empty || 0),
                    isFocus: sl.isFocus || sr.isFocus || false
                };
            });
        }

        if (bucketHasCounts(bucket) || bucket.questionLog) merged[key] = bucket;
    });

    return merged;
}

/**
 * The timezone the app's day begins and ends in.
 *
 * A day key used to be read off whatever timezone the device happened to be
 * set to, which quietly made "today" a per-device notion: the same instant is
 * the 3rd on a phone at UTC+3 and still the 2nd on a laptop at UTC+2, so the
 * two devices filed the same study session under different keys. Nothing in
 * the merge can repair that - the records are simply about different days - and
 * the visible symptom is a streak that reads differently on each device, plus a
 * day that can be "missed" on one of them and auto-frozen for a token.
 *
 * Anchoring the day to one zone makes the key a function of the instant alone,
 * which is what every other part of the sync already assumes.
 */
export const DAY_ZONE = 'Europe/Berlin';

let dayFormatter;
function getDayFormatter() {
    if (dayFormatter === undefined) {
        try {
            dayFormatter = new Intl.DateTimeFormat('en-CA', {
                timeZone: DAY_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
            });
        } catch {
            /* An environment without this zone in its timezone data. Falling
               back to device time loses the cross-device guarantee, but the
               alternative here is throwing during boot. */
            dayFormatter = null;
        }
    }
    return dayFormatter;
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * The calendar day `date` falls on, in the app's day zone - see DAY_ZONE.
 *
 * Every key in studyActivity is one of these, so anything that compares a
 * timestamp against those keys has to come through here. The progress-reset
 * guard in the sync merge did not: it turned the reset instant into a day with
 * toISOString(), which is UTC. East of Greenwich the two disagree for the first
 * hours of every day - at UTC+3 a reset performed at 01:00 reads as *yesterday*,
 * so the guard cleared the wrong day: the previous one went, and the pre-reset
 * activity from the day the user actually reset on survived on the remote and
 * came straight back.
 *
 * Named "local" from when it was, and kept because 22 call sites and the stored
 * keys they produce both read better as one word than as a rename would leave
 * them; "local" now means local to the app, not to the device.
 */
export function getLocalDateStr(date = new Date()) {
    const formatter = getDayFormatter();
    if (!formatter) return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

    const parts = formatter.formatToParts(date);
    const part = (type) => parts.find(p => p.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * Steps a YYYY-MM-DD key by whole calendar days.
 *
 * Walking the streak by mutating a Date and re-formatting it looks equivalent
 * and is not: the Date steps in *device* days while the format reads *app*
 * days, and on the two nights a year the zones' offsets move apart that walk
 * can repeat or skip a key. Doing the arithmetic on the key itself - in UTC,
 * which has no such nights - keeps a run of days a run of days.
 */
export function shiftDateStr(dateStr, days) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const shifted = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * A Date standing in for an app day, for the calendar drawing to walk.
 *
 * The heatmap and the trend bars pick a weekday column, a month label and a
 * first-of-month tick off a Date, then key the cell with getLocalDateStr(). Seed
 * that walk with `new Date()` and the two disagree for exactly as long as the
 * device's date differs from the day zone's - one hour a night at UTC+3 - and
 * the grid draws itself one day out of step with the data it is showing.
 *
 * Anchoring at midday means the Date's own year/month/day *are* the app day, so
 * the geometry and the key come from one calendar. Midday also survives adding
 * and subtracting days across a clock change, which midnight does not.
 */
export function getDayAnchor(dateStr = getLocalDateStr()) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
}
