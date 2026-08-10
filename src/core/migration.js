
import { AppState, saveSources, saveStats, saveCurrentSource, saveFolders, saveStudyActivity, saveAiPrompts, touch } from './state.js';
import { persist, persistRemove, readString } from './storage.js';
import { DAILY_TARGET, COUNTER_KEYS, bucketsOf, recomputeDayTotals } from './daily-activity.js';
import { generateHybridExamId } from '../features/sources/sources-service.js';

// Folders store their colour, so replacing the picker's palette left existing
// folders on the retired colours - several of which wash out on the light
// surface, which is exactly what the new palette was solved to avoid. Each old
// colour maps to the nearest new one by hue, so a red folder stays red.
// Covers both retired sets: the original twelve, and the interim eight that
// briefly shipped in between. Anything already on the current palette, or on a
// colour that was never in either set, is left alone.
const RETIRED_FOLDER_COLORS = {
    '#ef4444': '#ff0053', '#f97316': '#f75a00', '#f59e0b': '#ca8400',
    '#84cc16': '#27ac00', '#10b981': '#00a97a', '#06b6d4': '#00a2b9',
    '#3b82f6': '#0667ff', '#6366f1': '#0667ff', '#8b5cf6': '#8a43ff',
    '#d946ef': '#d200fe', '#ec4899': '#ff00b7', '#f43f5e': '#ff0053',
    '#ff2b86': '#ff0053', '#da3200': '#f75a00', '#c28400': '#ca8400',
    '#00853c': '#27ac00', '#00a8a2': '#00a2b9', '#0097f8': '#0098fe',
    '#6d57ff': '#8a43ff', '#cf00d0': '#d200fe'
};

const FOLDER_PALETTE_FLAG = 'focus_app_folder_palette_v3';

/**
 * One-time remap of folder colours onto the current palette. Runs after the
 * first Gist pull as well, since folders sync and a second device can bring
 * retired colours back.
 */
export function migrateFolderColors({ force = false } = {}) {
    if (!force && readString(FOLDER_PALETTE_FLAG) === '1') return 0;

    let changed = 0;
    (AppState.folders || []).forEach(f => {
        const next = RETIRED_FOLDER_COLORS[(f.color || '').toLowerCase()];
        if (next && next !== f.color) {
            f.color = next;
            touch(f);
            changed++;
        }
    });

    if (changed > 0) saveFolders();
    persist(FOLDER_PALETTE_FLAG, '1');
    return changed;
}

/* A single day's counters used to be summed on every Gist merge, so one day's
   questionCount doubled per sync until it reached billions - which blew up the
   weekly trend axis and the streak logic with it. Nobody answers this many
   questions in a day, so anything past this line is merge damage rather than
   an unusually long study session. */
const CORRUPT_DAILY_COUNT = 500;

/* Was a literal here, with a comment admitting it mirrored getDailyRequirement().
   The rule now lives in core/daily-activity.js, which holds no feature imports
   either - so the copy was never buying anything. */
const DAILY_TARGET_CAP = DAILY_TARGET;

/**
 * Returns a repaired copy of one studyActivity day. Non-finite and negative
 * counters collapse to 0, and an inflated total is pulled back to the answer
 * breakdown when one was recorded - otherwise to the day's own target, which is
 * the only thing still knowable about it once the breakdown is gone.
 */
export function sanitizeActivityRecord(act) {
    if (!act || typeof act !== 'object') return act;

    const num = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
    const snapshot = (v) => (Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), CORRUPT_DAILY_COUNT) : null);
    /* A measurement time is only meaningful next to a measurement. Keeping one
       whose snapshot did not survive would let the merge rank a value that is
       no longer there ahead of a real one. */
    const stampFor = (value, at) => (value !== null && Number.isFinite(at) && at > 0 ? at : null);

    const correctCount = num(act.correctCount);
    const wrongCount = num(act.wrongCount);
    const unansweredCount = num(act.unansweredCount);
    const breakdown = correctCount + wrongCount + unansweredCount;
    const overdueSnapshot = snapshot(act.overdueSnapshot);

    let questionCount = num(act.questionCount);
    if (breakdown > 0) {
        // The breakdown is the only trustworthy total once it has been recorded.
        questionCount = Math.min(questionCount, breakdown);
    } else if (questionCount > CORRUPT_DAILY_COUNT) {
        // Days written before the answer breakdown existed - or stripped of it by
        // the old merge - leave nothing to reconstruct from. Restoring the day's
        // target keeps an earned streak earned without inventing a real figure.
        questionCount = overdueSnapshot > 0 ? Math.min(overdueSnapshot, DAILY_TARGET_CAP) : DAILY_TARGET_CAP;
    }

    const focusQuestionCount = Math.min(num(act.focusQuestionCount), questionCount);
    const focusOverdueSnapshot = snapshot(act.focusOverdueSnapshot);

    const repaired = {
        ...act,
        studied: !!act.studied,
        questionCount,
        correctCount,
        wrongCount,
        unansweredCount,
        frozen: !!act.frozen,
        overdueSnapshot,
        focusStudied: !!act.focusStudied,
        focusQuestionCount,
        focusFrozen: !!act.focusFrozen,
        focusOverdueSnapshot
    };

    /* The buckets are the day's real numbers - the fields above are their sum -
       so a repair that never reaches them repairs nothing that survives the next
       recompute. Each bucket is one device's own running count and is held to
       the rules the flat record was: no negatives, no fractions, and a total no
       larger than the breakdown explaining it. Days from before per-device
       counting carry their old figures in a single legacy bucket, so they come
       out of here exactly as they used to. */
    const buckets = bucketsOf(repaired);
    Object.keys(buckets).forEach(key => {
        buckets[key] = repairBucket(buckets[key]);
    });
    recomputeDayTotals(repaired);

    /* Absent rather than null when there is nothing to stamp. Writing the key
       anyway would touch every day already stored - a year of history rewritten
       on the first boot after the upgrade, reported as a repair it is not, and
       pushed to the Gist for no reason. Deleting rather than skipping matters
       too: the spread above would otherwise carry a stale time next to a
       snapshot that did not survive. */
    setOrDrop(repaired, 'overdueSnapshotAt', stampFor(overdueSnapshot, act.overdueSnapshotAt));
    setOrDrop(repaired, 'focusOverdueSnapshotAt', stampFor(focusOverdueSnapshot, act.focusOverdueSnapshotAt));

    return repaired;
}

/** One device's counters for a day, held to the same rules as the flat record. */
function repairBucket(bucket) {
    const num = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
    const repaired = {};
    COUNTER_KEYS.forEach(key => { repaired[key] = num(bucket && bucket[key]); });

    const breakdown = repaired.correctCount + repaired.wrongCount + repaired.unansweredCount;
    if (breakdown > 0) {
        repaired.questionCount = Math.min(repaired.questionCount, breakdown);
    } else if (repaired.questionCount > CORRUPT_DAILY_COUNT) {
        // Nothing left to reconstruct from - see the flat path above.
        repaired.questionCount = DAILY_TARGET_CAP;
    }
    repaired.focusQuestionCount = Math.min(repaired.focusQuestionCount, repaired.questionCount);

    /* Carried over rather than rebuilt from COUNTER_KEYS alone. A bucket holds
       one more thing than its counters - which questions it was, so the trend
       bars can count a question the user answered four times once - and a
       repair that rebuilds the bucket from the counter list drops it. It did:
       this function runs over every day on every boot *and* over every record
       the Gist merge produces, so the log was erased seconds after it was
       written and always before another device could see it. The visible
       symptom was two devices drawing the same day differently - the one that
       had just answered counted unique questions, the one that had synced
       counted raw answers. */
    const log = repairQuestionLog(bucket && bucket.questionLog);
    if (log) repaired.questionLog = log;

    return repaired;
}

/**
 * One bucket's per-question log: `{ [questionKey]: {correct, wrong, empty, isFocus} }`.
 *
 * @returns {object|null} null when there is nothing worth keeping, so the caller
 *          can leave the key off entirely - an empty log is not the same as a
 *          bucket that never logged, and only the latter may fall back to the
 *          flat counters.
 */
function repairQuestionLog(log) {
    if (!log || typeof log !== 'object' || Array.isArray(log)) return null;

    const num = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
    const repaired = {};
    Object.keys(log).forEach(qKey => {
        const entry = log[qKey];
        if (!entry || typeof entry !== 'object') return;

        const correct = num(entry.correct);
        const wrong = num(entry.wrong);
        const empty = num(entry.empty);
        /* No answer, right, wrong or skipped, is no evidence the question was
           ever seen - and an entry like that still adds one to the unique-question
           bar. Dropping it keeps the bar a count of questions actually worked. */
        if (correct + wrong + empty === 0) return;

        repaired[qKey] = { correct, wrong, empty, isFocus: !!entry.isFocus };
    });

    return Object.keys(repaired).length > 0 ? repaired : null;
}

function setOrDrop(target, key, value) {
    if (value === null) delete target[key];
    else target[key] = value;
}

/**
 * Repairs every day already stored locally. Runs on every boot rather than
 * behind a one-time flag, because a device still on the additive build can push
 * inflated numbers back into the Gist at any point.
 */
export function sanitizeStudyActivity() {
    const activities = AppState.studyActivity;
    if (!activities || typeof activities !== 'object') return 0;

    let repaired = 0;
    Object.keys(activities).forEach(dateKey => {
        const before = activities[dateKey];
        const after = sanitizeActivityRecord(before);
        if (!after) return;
        if (JSON.stringify(before) !== JSON.stringify(after)) {
            activities[dateKey] = after;
            repaired++;
        }
    });

    if (repaired > 0) saveStudyActivity();
    return repaired;
}

export function migrateOldData() {
    /* Legacy migration from v1.5 and earlier. Read as a string, not parsed by
       readJSON: the raw text is re-persisted verbatim below, and the parse has
       to stay inside the try - a corrupt legacy record aborts the migration and
       leaves the old keys in place, so the data survives for another attempt
       rather than being cleaned up on the way out. */
    const oldJSON = readString('focusAppSavedJSON');
    if (!oldJSON) return;

    try {
        const data = JSON.parse(oldJSON);
        const title = (data.exam_metadata && data.exam_metadata.title) || 'Focus App';
        const count = data.questions ? data.questions.length : 0;

        const sourceId = btoa(title + count).substring(0, 12);
        const key = sourceId;

        // Add to sources
        const source = {
            id: key,
            name: title,
            questions: data.questions,
            questionCount: count,
            lastUsed: Date.now(),
            active: true
        };

        if (!AppState.sources.find(s => s.id === key)) {
            AppState.sources.push(source);
            saveSources();
        }

        // Save question data
        persist('focusAppData_' + key, oldJSON);

        // Migrate stats
        const oldStatsStr = readString('focusAppStats');
        if (oldStatsStr) {
            const oldStats = JSON.parse(oldStatsStr);
            const migratedStats = {};
            Object.keys(oldStats).forEach(qid => {
                const key = `${sourceId}_${qid}`;
                migratedStats[key] = oldStats[qid];
            });
            AppState.stats = migratedStats;
            saveStats();
        }

        saveCurrentSource(key);

        // Clean up old keys
        persistRemove('focusAppSavedJSON');
        persistRemove('focusAppStats');
        persistRemove('focusAppSources'); // Remove old source list format if any

        console.log('Legacy data migrated successfully');
    } catch (e) {
        console.error('Migration failed', e);
    }
}

/**
 * Ensures every source in AppState.sources has an immutable ID in source.id and source.metadata.id.
 * If source.id or source.metadata.id already exists, it is preserved strictly.
 * If missing, a hybrid ID is generated ONCE and persisted.
 */
export function migrateExamIds() {
    if (!Array.isArray(AppState.sources)) return 0;
    let changed = 0;

    AppState.sources.forEach(source => {
        if (!source || typeof source !== 'object') return;

        // Determine existing ID from source.id or source.metadata.id
        let currentId = source.id || source.metadata?.id || null;

        if (!currentId) {
            currentId = generateHybridExamId(source.name || 'exam');
            changed++;
        }

        if (source.id !== currentId) {
            source.id = currentId;
            changed++;
        }

        if (!source.metadata || typeof source.metadata !== 'object') {
            source.metadata = {};
            changed++;
        }

        if (source.metadata.id !== currentId) {
            source.metadata.id = currentId;
            changed++;
        }
    });

    if (changed > 0) {
        saveSources();
    }
    return changed;
}

const AI_PROMPTS_SEED_FLAG = 'focus_app_ai_prompts_seeded';

/**
 * Puts the three starter prompts in the library, once per device.
 *
 * They cover the three workflows the library exists for - verify the question,
 * teach me the topic, grade my open answer - and the point of shipping them is
 * that the second and third need variables ({source}, {answer}) that nobody
 * discovers from an empty list.
 *
 * Three things make the "once" real:
 *
 * - The ids are fixed. Seeding runs on each device independently, and ids
 *   generated per device would merge into three copies of every prompt.
 * - A tombstoned id is not re-created. Deleting a starter prompt has to stick,
 *   including on a device that pulls the deletion before it has ever seeded.
 * - The local flag stops the whole pass. Without it, deleting all three on the
 *   only device would hand them straight back on the next boot.
 *
 * Seeded for existing installs too, not just new ones: the library is new to
 * everyone, and a user who already has their data would otherwise be the one
 * person who never sees what it is for.
 */
export function seedAiPrompts(t) {
    if (readString(AI_PROMPTS_SEED_FLAG) === '1') return 0;

    const seeds = [
        { id: 'seed-verify', title: t('seed_verify_title'), body: t('seed_verify_body') },
        { id: 'seed-explain', title: t('seed_explain_title'), body: t('seed_explain_body') },
        { id: 'seed-evaluate', title: t('seed_evaluate_title'), body: t('seed_evaluate_body') }
    ];

    if (!Array.isArray(AppState.aiPrompts)) AppState.aiPrompts = [];
    const known = new Set(AppState.aiPrompts.map(p => p && p.id));
    const buried = new Set(AppState.deletedAiPromptIds || []);

    /* One timestamp for the batch, stepped per record. `createdAt` is the list's
       sort key, so three prompts written in the same millisecond would order by
       whatever the map happened to yield. */
    const now = Date.now();
    let added = 0;

    seeds.forEach((seed, i) => {
        if (known.has(seed.id) || buried.has(seed.id)) return;
        AppState.aiPrompts.push({
            id: seed.id,
            title: seed.title,
            body: seed.body,
            createdAt: now + i,
            updatedAt: now + i
        });
        added++;
    });

    persist(AI_PROMPTS_SEED_FLAG, '1');
    if (added > 0) saveAiPrompts();
    return added;
}

