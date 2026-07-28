import { detectLanguage, detectTranslationTarget } from './i18n.js';

/**
 * Safely reads and parses a JSON item from localStorage.
 * Returns fallback value if item is missing or corrupted.
 */
export function safeJSONParse(key, fallback) {
    try {
        const item = localStorage.getItem(key);
        if (item === null || item === undefined) return fallback;
        return JSON.parse(item);
    } catch (e) {
        console.warn(`[AppState] Corrupted JSON in localStorage key "${key}", falling back.`, e);
        return fallback;
    }
}

export const DEFAULT_AI_PROVIDERS = [
    { id: 'google', name: 'Google AI (Search)', url: 'https://www.google.com/search?q={PROMPT}&udm=50', domain: 'google.com' },
    { id: 'chatgpt', name: 'ChatGPT (GPT-4o)', url: 'https://chatgpt.com/?prompt={PROMPT}&model=gpt-4o&hints=search', domain: 'chatgpt.com' },
    { id: 'perplexity', name: 'Perplexity AI', url: 'https://www.perplexity.ai/search?focus=internet&copilot=true&q={PROMPT}', domain: 'perplexity.ai' },
    { id: 'claude', name: 'Claude (Anthropic)', url: 'https://claude.ai/new?q={PROMPT}', domain: 'claude.ai' },
    { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/?q={PROMPT}', domain: 'deepseek.com' }
];

export const AppState = {
    rawQuestions: [],
    currentTest: [],
    currentIndex: 0,
    userAnswers: {},
    isAnswerChecked: {},
    shuffledOptionsMap: {},
    stats: safeJSONParse('focus_app_stats_local', {}),
    folders: (() => {
        let folders = safeJSONParse('focus_app_folders', null);
        if (folders === null) {
            // Create a default folder for sample templates
            folders = [
                { id: 'default-folder', name: 'Sample Folder', color: '#3b82f6', description: 'Varsayılan örnek klasör', order: 0 }
            ];
            try { localStorage.setItem('focus_app_folders', JSON.stringify(folders)); } catch(e){}
        }
        return Array.isArray(folders) ? folders : [];
    })(),
    sources: (() => {
        const sources = safeJSONParse('focus_app_sources', []);
        // Cleanup: remove any sources without questions (leftovers from previous broken logic)
        return Array.isArray(sources) ? sources.filter(s => s && s.questions && Array.isArray(s.questions)) : [];
    })(),
    totalStats: safeJSONParse('focus_app_stats_global', {}),
    currentSourceKey: localStorage.getItem('focus_app_current_source') || null,
    examTitle: 'Exam App',
    language: detectLanguage(),
    translationTarget: detectTranslationTarget(),
    translationEnabled: safeJSONParse('focus_app_translation_enabled', true),
    recentTests: safeJSONParse('focus_app_recent_tests', []).slice(0, 10),
    testTracking: null,
    previewQuestion: null,
    searchKeyword: '',
    lastStatsScrollPos: 0,
    activeStatsFilter: 'all',
    activeStatsSortField: 'original', // 'original', 'coeff', 'success', 'wrong'
    activeStatsSortDir: 'asc', // 'asc', 'desc'
    customAIPrompt: localStorage.getItem('focus_app_custom_ai_prompt') || '',
    aiProviders: safeJSONParse('focus_app_ai_providers', DEFAULT_AI_PROVIDERS),
    ttsEnabled: safeJSONParse('focus_app_tts_enabled', false),
    ttsAutoplay: safeJSONParse('focus_app_tts_autoplay', false),
    ttsSpeed: parseFloat(localStorage.getItem('focus_app_tts_speed') ?? '0.5'),
    timerStopwatchEnabled: safeJSONParse('focus_app_timer_stopwatch', false),
    timerCountdownEnabled: safeJSONParse('focus_app_timer_countdown', false),
    timerCountdownLimit: parseInt(localStorage.getItem('focus_app_timer_limit') || '59', 10),
    timerAutoCheckEnabled: safeJSONParse('focus_app_timer_auto_check', true), // Default to true
    currentTtsVoice: null, // Randomly selected at test start
    viewHistory: [], // Stack to track last 10 visited screens
    navigationSourceView: null, // View to return to from Tag Mode
    activeTagFilter: null, // Currently active tag Filter for stats view
    questionMap: {}, // composite key (sourceId_questionId) → question object
    githubToken: localStorage.getItem('focus_app_github_token') || null,
    githubGistId: localStorage.getItem('focus_app_github_gist_id') || null,
    githubUser: safeJSONParse('focus_app_github_user', null),
    lastGithubUser: localStorage.getItem('focus_app_last_github_user') || null,
    lastSyncTime: parseInt(localStorage.getItem('focus_app_last_sync') || '0', 10),
    deletedSourceIds: safeJSONParse('focus_app_deleted_sources', []),
    deletedFolderIds: safeJSONParse('focus_app_deleted_folders', []),
    githubGistUrl: localStorage.getItem('focus_app_github_gist_url') || null
};

/**
 * Sources the user still works with: everything except the archive.
 * Archived sources stay in AppState.sources (so sync keeps merging them by id),
 * so every list, counter and question pool has to filter them out explicitly.
 */
export function liveSources() {
    return AppState.sources.filter(s => !s.archived);
}

export function archivedSources() {
    return AppState.sources.filter(s => s.archived);
}

export function liveFolders() {
    return (AppState.folders || []).filter(f => !f.archived);
}

/**
 * Stamps a record as locally modified. `updatedAt` is the primary tiebreaker in
 * mergeSyncData - without it an archived stub would lose against the remote copy
 * that still carries questions.
 */
export function touch(record) {
    if (record) record.updatedAt = Date.now();
    return record;
}

export function clearLocalStudyData() {
    AppState.sources = [];
    AppState.folders = [];
    AppState.stats = {};
    AppState.totalStats = {};
    AppState.recentTests = [];
    AppState.deletedSourceIds = [];
    AppState.deletedFolderIds = [];
    AppState.currentSourceKey = null;

    localStorage.removeItem('focus_app_sources');
    localStorage.removeItem('focus_app_folders');
    localStorage.removeItem('focus_app_stats_local');
    localStorage.removeItem('focus_app_stats_global');
    localStorage.removeItem('focus_app_recent_tests');
    localStorage.removeItem('focus_app_deleted_sources');
    localStorage.removeItem('focus_app_deleted_folders');
    localStorage.removeItem('focus_app_current_source');
    localStorage.removeItem('focus_app_active_test');

    clearActiveTest();
}

export function trackDeletedSource(id) {
    if (!id) return;
    if (!AppState.deletedSourceIds.includes(id)) {
        AppState.deletedSourceIds.push(id);
        localStorage.setItem('focus_app_deleted_sources', JSON.stringify(AppState.deletedSourceIds));
    }
}

export function trackDeletedFolder(id) {
    if (!id) return;
    if (!AppState.deletedFolderIds.includes(id)) {
        AppState.deletedFolderIds.push(id);
        localStorage.setItem('focus_app_deleted_folders', JSON.stringify(AppState.deletedFolderIds));
    }
}

export function saveStats() {
    localStorage.setItem('focus_app_stats_local', JSON.stringify(AppState.stats));
    import('./github-sync.js').then(m => m.scheduleSync(1500)).catch(() => {});
}

export function saveCustomAIPrompt() {
    localStorage.setItem('focus_app_custom_ai_prompt', AppState.customAIPrompt);
}


export function saveAiProviders() {
    localStorage.setItem('focus_app_ai_providers', JSON.stringify(AppState.aiProviders));
}

export function saveTtsSettings() {
    localStorage.setItem('focus_app_tts_enabled', JSON.stringify(AppState.ttsEnabled));
    localStorage.setItem('focus_app_tts_autoplay', JSON.stringify(AppState.ttsAutoplay));
    localStorage.setItem('focus_app_tts_speed', AppState.ttsSpeed.toString());
}

export function saveTimerSettings() {
    localStorage.setItem('focus_app_timer_stopwatch', JSON.stringify(AppState.timerStopwatchEnabled));
    localStorage.setItem('focus_app_timer_countdown', JSON.stringify(AppState.timerCountdownEnabled));
    localStorage.setItem('focus_app_timer_limit', AppState.timerCountdownLimit.toString());
    localStorage.setItem('focus_app_timer_auto_check', JSON.stringify(AppState.timerAutoCheckEnabled));
}

export function saveSources() {
    localStorage.setItem('focus_app_sources', JSON.stringify(AppState.sources));
    import('./github-sync.js').then(m => m.scheduleSync(300)).catch(() => {});
}

export function saveFolders() {
    localStorage.setItem('focus_app_folders', JSON.stringify(AppState.folders));
    import('./github-sync.js').then(m => m.scheduleSync(300)).catch(() => {});
}

export function saveCurrentSource(key) {
    AppState.currentSourceKey = key;
    localStorage.setItem('focus_app_current_source', key || '');
}

export function saveRecentTests() {
    localStorage.setItem('focus_app_recent_tests', JSON.stringify(AppState.recentTests));
    import('./github-sync.js').then(m => m.scheduleSync(300)).catch(() => {});
}

let _saveActiveTestTimer = null;
export function saveActiveTest() {
    clearTimeout(_saveActiveTestTimer);
    _saveActiveTestTimer = setTimeout(() => {
        const activeData = {
            currentTest: AppState.currentTest,
            currentIndex: AppState.currentIndex,
            userAnswers: AppState.userAnswers,
            isAnswerChecked: AppState.isAnswerChecked,
            shuffledOptionsMap: AppState.shuffledOptionsMap,
            testTracking: AppState.testTracking,
        };
        localStorage.setItem('focus_app_active_test', JSON.stringify(activeData));
    }, 300);
}

export function clearActiveTest() {
    localStorage.removeItem('focus_app_active_test');
}
