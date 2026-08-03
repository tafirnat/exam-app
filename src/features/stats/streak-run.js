import { AppState, UNCATEGORIZED_FOLDER_ID, clearActiveTest } from '../../core/state.js';
import { shuffleArraySeeded } from '../../core/utils.js';
import { buildQuestionPool, calculateRetrievability, prepareFromCompositeIds } from '../test/test-engine.js';
import { getLocalDateStr, getLiveFocusSources, getDailyOverdueSnapshot } from './continuity-engine.js';

/**
 * The streak run: the questions FSRS says are due today, handed over in one tap
 * and independent of which sources happen to be active. A source is only a label
 * on a question here - selection is driven by the schedule, not the library.
 *
 * Everything in this module is pure with respect to the DOM, so the ordering
 * rules can be tested directly.
 */

/* A streak day is never worth fewer than 15 questions, even when the daily
   requirement computes lower - the user asked for this floor explicitly. */
export const MIN_STREAK_QUESTIONS = 15;

/* Share of a session reserved for questions that have never been seen. Without
   a reserved slice a library with a healthy backlog would never surface
   anything new. */
export const NEW_QUESTION_RATIO = 0.2;

/* In grouped mode no single source may take more than this share of a session,
   otherwise one large source swallows the whole run and the folder layer - the
   entire reason for grouped mode - never becomes visible. */
export const SOURCE_SHARE_DIVISOR = 3;

/**
 * The floor and the user's own question-count preference, whichever is larger.
 */
export function resolveStreakCount(userCount) {
    const n = Math.floor(Number(userCount));
    return Number.isFinite(n) && n > MIN_STREAK_QUESTIONS ? n : MIN_STREAK_QUESTIONS;
}

/**
 * Most urgent first. Retrievability is the primary signal; the rest exists only
 * to break ties, because equal-R questions would otherwise fall back to library
 * order and make the run look arbitrary.
 */
function byUrgency(a, b) {
    if (a.r !== b.r) return a.r - b.r;
    if (a.difficulty !== b.difficulty) return b.difficulty - a.difficulty;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Splits the pool into the three buckets the run draws from, in priority order:
 *
 * - `due`      already past the review threshold (0 < R <= 0.9)
 * - `fresh`    never reviewed, so R is 0 and no sort can rank them
 * - `upcoming` scheduled but not yet due; filler only, nearest first
 */
function bucketCandidates(pool, seed) {
    const due = [];
    const fresh = [];
    const upcoming = [];

    /* One instant for the whole pass. Reading the clock per question puts two
       questions with identical stability and lastReview ~1e-10 apart, and R is
       the primary sort key - the difficulty and id tie-breakers behind it were
       only reached when the clock happened not to tick between them. */
    const measuredAt = Date.now();

    pool.forEach(q => {
        const key = `${q.sourceId}_${q.id}`;
        const stat = AppState.stats[key];
        // Matches the manual test flow: a question marked learned is out of
        // rotation until an incorrect answer puts it back.
        if (stat?.learned) return;

        const r = calculateRetrievability(stat?.stability, stat?.lastReview, measuredAt);
        const item = {
            key,
            sourceId: q.sourceId,
            r,
            difficulty: Number.isFinite(stat?.difficulty) ? stat.difficulty : 5
        };

        if (r <= 0) fresh.push(item);
        else if (r <= 0.9) due.push(item);
        else upcoming.push(item);
    });

    due.sort(byUrgency);
    upcoming.sort(byUrgency);

    return { due, fresh: shuffleArraySeeded(fresh, seed), upcoming };
}

/**
 * Caps how many questions a single source may contribute, walking the list in
 * urgency order and parking the overflow. Overflow is returned rather than
 * dropped: if the capped picks cannot fill the session, the caller lifts the cap
 * instead of handing back a short run.
 */
function capPerSource(items, cap) {
    const taken = [];
    const overflow = [];
    const used = new Map();

    items.forEach(item => {
        const n = used.get(item.sourceId) || 0;
        if (n < cap) {
            used.set(item.sourceId, n + 1);
            taken.push(item);
        } else {
            overflow.push(item);
        }
    });

    return { taken, overflow };
}

/**
 * Chooses WHICH questions the session contains. Ordering happens afterwards, so
 * both modes see the same set and differ only in presentation.
 */
function selectItems({ due, fresh, upcoming }, target, order) {
    const freshQuota = Math.min(fresh.length, Math.round(target * NEW_QUESTION_RATIO));

    let duePool = due;
    let dueOverflow = [];
    if (order === 'grouped') {
        const cap = Math.max(1, Math.ceil(target / SOURCE_SHARE_DIVISOR));
        ({ taken: duePool, overflow: dueOverflow } = capPerSource(due, cap));
    }

    const selected = [];

    // 1. Due questions, leaving room for the reserved new-question slice.
    const dueTake = Math.min(duePool.length, Math.max(0, target - freshQuota));
    selected.push(...duePool.slice(0, dueTake));

    // 2. The reserved slice itself.
    selected.push(...fresh.slice(0, Math.min(freshQuota, target - selected.length)));

    // 3. Whatever is still missing, in descending priority: due questions the
    //    per-source cap held back, then the rest of the due list, then more new
    //    questions, then upcoming ones as filler.
    const fillers = [
        dueOverflow,
        duePool.slice(dueTake),
        fresh.slice(freshQuota),
        upcoming
    ];
    for (const list of fillers) {
        if (selected.length >= target) break;
        selected.push(...list.slice(0, target - selected.length));
    }

    return selected;
}

/**
 * Folder -> source -> question. Folders and sources are ranked by their most
 * urgent member, so the run still opens on the single most pressing question;
 * from there it stays inside that question's source, then its folder, before
 * moving on. Related material is studied together instead of scattered.
 */
function groupByFolder(selected) {
    const folderOf = new Map();
    (AppState.sources || []).forEach(s => {
        folderOf.set(s.id, s.folderId || UNCATEGORIZED_FOLDER_ID);
    });

    // Position in the urgency-ordered selection is the rank each level inherits.
    const rank = new Map();
    selected.forEach((item, idx) => {
        if (!rank.has(item.key)) rank.set(item.key, idx);
    });

    const sources = new Map();
    selected.forEach(item => {
        if (!sources.has(item.sourceId)) sources.set(item.sourceId, []);
        sources.get(item.sourceId).push(item);
    });

    const folders = new Map();
    sources.forEach((items, sourceId) => {
        const folderId = folderOf.get(sourceId) || UNCATEGORIZED_FOLDER_ID;
        if (!folders.has(folderId)) folders.set(folderId, []);
        folders.get(folderId).push({ sourceId, items });
    });

    const bestRank = (items) => Math.min(...items.map(i => rank.get(i.key)));

    const ordered = [];
    [...folders.entries()]
        .map(([folderId, entries]) => ({
            folderId,
            entries: entries.sort((a, b) => bestRank(a.items) - bestRank(b.items))
        }))
        .sort((a, b) => {
            const aBest = Math.min(...a.entries.map(e => bestRank(e.items)));
            const bBest = Math.min(...b.entries.map(e => bestRank(e.items)));
            return aBest - bBest;
        })
        .forEach(folder => {
            folder.entries.forEach(entry => {
                ordered.push(...entry.items);
            });
        });

    return ordered;
}

/**
 * Builds the day's run and returns composite ids, ready for the test engine.
 *
 * @param {'global'|'focus'} scope   Which streak the run serves.
 * @param {'mixed'|'grouped'} order  Presentation order.
 * @param {number} count             Session size; floored at MIN_STREAK_QUESTIONS.
 * @param {string} seed              Shuffle seed for new questions; the date by default.
 */
export function buildStreakRun(options = {}) {
    const {
        scope = 'global',
        order = 'mixed',
        count = MIN_STREAK_QUESTIONS,
        seed = getLocalDateStr()
    } = options;

    // Always the wide pool: the whole point is that the run ignores which
    // sources are currently switched on.
    let pool = buildQuestionPool({ scope: 'all' });

    if (scope === 'focus') {
        const focus = new Set(getLiveFocusSources());
        if (focus.size === 0) return [];
        pool = pool.filter(q => focus.has(q.sourceId));
    }

    if (pool.length === 0) return [];

    const target = Math.max(1, Math.floor(count));
    const buckets = bucketCandidates(pool, seed);
    const selected = selectItems(buckets, target, order);

    const ordered = order === 'grouped' ? groupByFolder(selected) : selected;
    return ordered.map(item => item.key);
}

/**
 * The one-tap session itself: FSRS decides which questions, the user decides
 * only how they are laid out.
 *
 * Unlike prepareTest this never shuffles, never injects focus pools and never
 * touches the preset sessions - the order IS the feature, and a run drawn from
 * the whole library belongs to no source group.
 */
export function prepareStreakRun(options = {}) {
    const { scope = 'global', order = 'mixed', count } = options;

    const compositeIds = buildStreakRun({
        scope,
        order,
        count: resolveStreakCount(count)
    });
    if (compositeIds.length === 0) return null;

    clearActiveTest();

    // Today's target has to be pinned before the run reduces the backlog,
    // otherwise finishing it would move the bar the user is running at.
    getDailyOverdueSnapshot(AppState.rawQuestions);

    return prepareFromCompositeIds(compositeIds, { shuffle: false, mode: 'streak' });
}
