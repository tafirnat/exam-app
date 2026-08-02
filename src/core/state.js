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

/* Marks that the language-matched sample source has been added, and which
   language it was. Clearing it is what makes a factory reset hand the new
   library its starter content back. */
export const SAMPLE_LOADED_KEY = 'focus_app_sample_loaded';

/* The starter library is no longer embedded here. It lives in
   public/examples/sample-<lang>.json and is fetched on first run, so the
   reader gets it in their own language and the sample stays a plain file
   they can open, copy and learn the schema from. */

export const UNCATEGORIZED_FOLDER_ID = 'uncategorized-folder';

export function createUncategorizedFolderRecord() {
    return {
        id: UNCATEGORIZED_FOLDER_ID,
        name: 'Kategorisiz Kaynaklar',
        color: '#8a99ad',
        description: 'Kategorilenmemiş kaynaklar',
        order: 0,
        isSystem: true
    };
}

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
        if (!Array.isArray(folders)) folders = [];

        let hasUncategorized = false;
        folders = folders.map(f => {
            if (f.id === 'default-folder') {
                hasUncategorized = true;
                return { ...f, id: UNCATEGORIZED_FOLDER_ID, name: 'Kategorisiz Kaynaklar', color: '#8a99ad', isSystem: true };
            }
            if (f.id === UNCATEGORIZED_FOLDER_ID) {
                hasUncategorized = true;
                return { ...f, name: 'Kategorisiz Kaynaklar', color: '#8a99ad', isSystem: true };
            }
            return f;
        });

        if (!hasUncategorized) {
            folders.unshift(createUncategorizedFolderRecord());
        }

        try { localStorage.setItem('focus_app_folders', JSON.stringify(folders)); } catch(e){}
        return folders;
    })(),
    // Starts empty on a fresh install; main.js fetches the sample for the
    // detected language right after boot and renders it in.
    sources: (() => {
        const sources = safeJSONParse('focus_app_sources', null);
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
    quickPresets: safeJSONParse('focus_app_quick_presets', []),
    deletedQuickPresetIds: safeJSONParse('focus_app_deleted_quick_presets', []),
    githubGistUrl: localStorage.getItem('focus_app_github_gist_url') || null,
    presetSessions: safeJSONParse('focus_app_preset_sessions', {}),
    activePresetId: null,
    continuityConfig: safeJSONParse('focus_app_continuity_config', {
        // Genel Seri dondurma tokenleri
        freezeTokens: {
            total: 1,
            remaining: 1,
            tier1Earned: false,
            tier2Earned: false,
            initialized: true
        },
        // Odak Seri dondurma tokenleri
        focusFreezeTokens: {
            total: 1,
            remaining: 1,
            tier1Earned: false,
            tier2Earned: false,
            initialized: true
        },
        focusPools: [],
        focusSources: [],
        focusSourceNames: {},
        notificationSettings: {
            enabled: false,          // Genel Seri bildirimi
            focusEnabled: false,     // Odak Serisi bildirimi (ayrı opt-in)
            quietHoursStart: '22:00',
            quietHoursEnd: '08:00',
            dailyScheduleHour: 9,    // Genel bildirim saati (09:00)
            dailyScheduleMinute: 0,
            focusScheduleHour: 19,   // Odak bildirim saati (19:00)
            focusScheduleMinute: 0,
            lastNotifiedDate: null,      // Son Genel bildirim tarihi
            lastFocusNotifiedDate: null, // Son Odak bildirim tarihi
            ignoreStreakA: 0,            // Üst üste ignore sayacı (Genel)
            ignoreStreakB: 0,            // Üst üste ignore sayacı (Odak)
            pausedUntilA: null,          // Genel duraklatma tarihi
            pausedUntilB: null,          // Odak duraklatma tarihi
            optInDismissedAt: null,      // Opt-in "Hayır" tarihi
            optInFocusDismissedAt: null  // Odak opt-in "Hayır" tarihi
        }
    }),
    studyActivity: safeJSONParse('focus_app_study_activity', {})
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
    AppState.folders = [createUncategorizedFolderRecord()];
    AppState.sources = [];
    AppState.stats = {};
    AppState.totalStats = {};
    AppState.recentTests = [];
    AppState.deletedSourceIds = [];
    AppState.deletedFolderIds = [];
    AppState.quickPresets = [];
    AppState.deletedQuickPresetIds = [];
    AppState.currentSourceKey = null;
    AppState.presetSessions = {};
    AppState.continuityConfig = {
        // Genel Seri dondurma tokenleri
        freezeTokens: {
            total: 1,
            remaining: 1,
            tier1Earned: false,
            tier2Earned: false,
            initialized: true
        },
        // Odak Seri dondurma tokenleri
        focusFreezeTokens: {
            total: 1,
            remaining: 1,
            tier1Earned: false,
            tier2Earned: false,
            initialized: true
        },
        focusPools: [],
        focusSources: [],
        focusSourceNames: {},
        notificationSettings: {
            enabled: false,
            focusEnabled: false,
            quietHoursStart: '22:00',
            quietHoursEnd: '08:00',
            dailyScheduleHour: 9,
            dailyScheduleMinute: 0,
            focusScheduleHour: 19,
            focusScheduleMinute: 0,
            lastNotifiedDate: null,
            lastFocusNotifiedDate: null,
            ignoreStreakA: 0,
            ignoreStreakB: 0,
            pausedUntilA: null,
            pausedUntilB: null,
            optInDismissedAt: null,
            optInFocusDismissedAt: null
        }
    };
    AppState.studyActivity = {};
    localStorage.removeItem('focus_app_preset_sessions');
    localStorage.setItem('focus_app_folders', JSON.stringify(AppState.folders));
    localStorage.setItem('focus_app_sources', JSON.stringify(AppState.sources));
    localStorage.removeItem('focus_app_stats_local');
    localStorage.removeItem('focus_app_stats_global');
    localStorage.removeItem('focus_app_recent_tests');
    localStorage.removeItem('focus_app_deleted_sources');
    localStorage.removeItem('focus_app_deleted_folders');
    localStorage.removeItem('focus_app_quick_presets');
    localStorage.removeItem('focus_app_deleted_quick_presets');
    localStorage.removeItem('focus_app_current_source');
    localStorage.removeItem('focus_app_active_test');
    localStorage.removeItem('focus_app_continuity_config');
    localStorage.removeItem('focus_app_study_activity');
    // Clear sample loaded key so the starter sample JSON for active language is auto-loaded on reset
    localStorage.removeItem(SAMPLE_LOADED_KEY);

    clearActiveTest();
}

/**
 * Resets progress, statistics, FSRS stability, study activity, streaks, and tokens,
 * while keeping all sources, folders, and presets intact.
 */
export function clearProgressData() {
    AppState.stats = {};
    AppState.totalStats = {};
    AppState.recentTests = [];
    AppState.presetSessions = {};
    AppState.studyActivity = {};
    AppState.continuityConfig = {
        freezeTokens: {
            total: 1,
            remaining: 1,
            tier1Earned: false,
            tier2Earned: false,
            initialized: true
        },
        focusFreezeTokens: {
            total: 1,
            remaining: 1,
            tier1Earned: false,
            tier2Earned: false,
            initialized: true
        },
        focusPools: [],
        focusSources: AppState.continuityConfig?.focusSources || [],
        focusSourceNames: AppState.continuityConfig?.focusSourceNames || {},
        notificationSettings: AppState.continuityConfig?.notificationSettings || {
            enabled: false,
            focusEnabled: false,
            quietHoursStart: '22:00',
            quietHoursEnd: '08:00',
            dailyScheduleHour: 9,
            dailyScheduleMinute: 0,
            focusScheduleHour: 19,
            focusScheduleMinute: 0,
            lastNotifiedDate: null,
            lastFocusNotifiedDate: null,
            ignoreStreakA: 0,
            ignoreStreakB: 0,
            pausedUntilA: null,
            pausedUntilB: null,
            optInDismissedAt: null,
            optInFocusDismissedAt: null
        }
    };

    localStorage.removeItem('focus_app_stats_local');
    localStorage.removeItem('focus_app_stats_global');
    localStorage.removeItem('focus_app_recent_tests');
    localStorage.removeItem('focus_app_preset_sessions');
    localStorage.removeItem('focus_app_study_activity');
    localStorage.setItem('focus_app_continuity_config', JSON.stringify(AppState.continuityConfig));
    clearActiveTest();
}

/**
 * Deletes all imported question sources, folders, and quick presets,
 * while leaving global configuration intact.
 */
export function clearSourcesData() {
    AppState.folders = [createUncategorizedFolderRecord()];
    AppState.sources = [];
    AppState.quickPresets = [];
    AppState.currentSourceKey = null;
    AppState.presetSessions = {};
    
    localStorage.removeItem('focus_app_preset_sessions');
    localStorage.setItem('focus_app_folders', JSON.stringify(AppState.folders));
    localStorage.setItem('focus_app_sources', JSON.stringify(AppState.sources));
    localStorage.setItem('focus_app_quick_presets', JSON.stringify(AppState.quickPresets));
    localStorage.removeItem('focus_app_current_source');
    localStorage.removeItem(SAMPLE_LOADED_KEY);
    
    clearActiveTest();
}

export function savePresetSessions() {
    localStorage.setItem('focus_app_preset_sessions', JSON.stringify(AppState.presetSessions || {}));
}

export function savePresetSessionData(presetId, sessionData) {
    if (!presetId) return;
    if (!AppState.presetSessions) AppState.presetSessions = {};
    AppState.presetSessions[presetId] = sessionData;
    savePresetSessions();
}

export function clearPresetSessionData(presetId) {
    if (!presetId || !AppState.presetSessions) return;
    delete AppState.presetSessions[presetId];
    savePresetSessions();
}

export function findMatchingPresetId() {
    const activeSources = (AppState.sources || []).filter(s => s.active && !s.archived);
    const activeIds = activeSources.map(s => s.id).sort();
    if (activeIds.length === 0) return null;
    const preset = (AppState.quickPresets || []).find(p => {
        if (!p.sourceIds || p.sourceIds.length !== activeIds.length) return false;
        const pSorted = [...p.sourceIds].sort();
        return pSorted.every((id, idx) => id === activeIds[idx]);
    });
    return preset ? preset.id : null;
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

export function trackDeletedQuickPreset(id) {
    if (!id) return;
    if (!AppState.deletedQuickPresetIds.includes(id)) {
        AppState.deletedQuickPresetIds.push(id);
        localStorage.setItem('focus_app_deleted_quick_presets', JSON.stringify(AppState.deletedQuickPresetIds));
    }
}

export function saveQuickPresets() {
    localStorage.setItem('focus_app_quick_presets', JSON.stringify(AppState.quickPresets));
    import('./github-sync.js').then(m => m.scheduleSync(300)).catch(() => {});
}

export function saveContinuityConfig() {
    localStorage.setItem('focus_app_continuity_config', JSON.stringify(AppState.continuityConfig));
    import('./github-sync.js').then(m => m.scheduleSync(300)).catch(() => {});
}

export function saveStudyActivity() {
    localStorage.setItem('focus_app_study_activity', JSON.stringify(AppState.studyActivity));
    import('./github-sync.js').then(m => m.scheduleSync(300)).catch(() => {});
}

export function saveStats() {
    localStorage.setItem('focus_app_stats_local', JSON.stringify(AppState.stats));
    localStorage.setItem('focus_app_stats_global', JSON.stringify(AppState.totalStats));
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

        // A streak run is drawn from the whole library, so it belongs to no
        // preset. Filing it under whichever preset happens to match the active
        // sources would overwrite that preset's own saved session.
        if (activeData.testTracking?.mode === 'streak') return;

        const matchedPresetId = findMatchingPresetId();
        if (matchedPresetId) {
            if (activeData.currentTest && activeData.currentTest.length > 0) {
                savePresetSessionData(matchedPresetId, activeData);
            }
        }
    }, 300);
}

export function clearActiveTest() {
    localStorage.removeItem('focus_app_active_test');
}
