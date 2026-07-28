
import { AppState, saveSources, saveStats, saveCurrentSource, saveFolders, touch } from './state.js';

// Folders store their colour, so replacing the picker's palette left existing
// folders on the retired colours - several of which wash out on the light
// surface, which is exactly what the new palette was solved to avoid. Each old
// colour maps to the nearest new one by hue, so a red folder stays red.
const RETIRED_FOLDER_COLORS = {
    '#ef4444': '#da3200', '#f97316': '#da3200', '#f59e0b': '#c28400',
    '#84cc16': '#00853c', '#10b981': '#00853c', '#06b6d4': '#00a8a2',
    '#3b82f6': '#0097f8', '#6366f1': '#6d57ff', '#8b5cf6': '#6d57ff',
    '#d946ef': '#cf00d0', '#ec4899': '#ff2b86', '#f43f5e': '#ff2b86'
};

const FOLDER_PALETTE_FLAG = 'focus_app_folder_palette_v2';

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
