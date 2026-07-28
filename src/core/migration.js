
import { AppState, saveSources, saveStats, saveCurrentSource, saveFolders, touch } from './state.js';

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
    if (!force && localStorage.getItem(FOLDER_PALETTE_FLAG) === '1') return 0;

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
    localStorage.setItem(FOLDER_PALETTE_FLAG, '1');
    return changed;
}

export function migrateOldData() {
    // Legacy migration from v1.5 and earlier
    const oldJSON = localStorage.getItem('focusAppSavedJSON');
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
        localStorage.setItem('focusAppData_' + key, oldJSON);

        // Migrate stats
        const oldStatsStr = localStorage.getItem('focusAppStats');
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
        localStorage.removeItem('focusAppSavedJSON');
        localStorage.removeItem('focusAppStats');
        localStorage.removeItem('focusAppSources'); // Remove old source list format if any

        console.log('Legacy data migrated successfully');
    } catch (e) {
        console.error('Migration failed', e);
    }
}
