
import { AppState, saveSources, saveStats, saveCurrentSource, saveFolders, saveStudyActivity, touch } from './state.js';
import { persist, persistRemove, readString } from './storage.js';

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

/* Mirrors getDailyRequirement()'s ceiling in continuity-engine.js. Kept as a
   literal so this module stays free of feature imports. */
const DAILY_TARGET_CAP = 15;

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

    return {
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
        focusOverdueSnapshot: snapshot(act.focusOverdueSnapshot)
    };
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
