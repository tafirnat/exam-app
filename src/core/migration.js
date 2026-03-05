
import { AppState, saveSources, saveStats, saveCurrentSource } from './state.js';

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
        const oldStats = localStorage.getItem('focusAppStats');
        if (oldStats) {
            localStorage.setItem('focus_app_stats_local', oldStats);
            AppState.stats = JSON.parse(oldStats);
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
