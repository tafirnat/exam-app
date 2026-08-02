import { detectLanguage, detectTranslationTarget } from './i18n.js';
import { persist, persistRemove, readJSON, readString, readInt, readFloat } from './storage.js';

/**
 * Safely reads and parses a JSON item from localStorage.
 * Kept as the historical name; storage.js owns the implementation now.
 */
export const safeJSONParse = readJSON;

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

        persist('focus_app_folders', folders);
        return folders;
    })(),
    // Starts empty on a fresh install; main.js fetches the sample for the
    // detected language right after boot and renders it in.
    sources: (() => {
        const sources = safeJSONParse('focus_app_sources', null);
        return Array.isArray(sources) ? sources.filter(s => s && s.questions && Array.isArray(s.questions)) : [];
    })(),
    totalStats: safeJSONParse('focus_app_stats_global', {}),
    currentSourceKey: readString('focus_app_current_source') || null,
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
    customAIPrompt: readString('focus_app_custom_ai_prompt', '') || '',
    aiProviders: safeJSONParse('focus_app_ai_providers', DEFAULT_AI_PROVIDERS),
    ttsEnabled: safeJSONParse('focus_app_tts_enabled', false),
    ttsAutoplay: safeJSONParse('focus_app_tts_autoplay', false),
    ttsSpeed: readFloat('focus_app_tts_speed', 0.5),
    timerStopwatchEnabled: safeJSONParse('focus_app_timer_stopwatch', false),
    timerCountdownEnabled: safeJSONParse('focus_app_timer_countdown', false),
    timerCountdownLimit: readInt('focus_app_timer_limit', 59),
    timerAutoCheckEnabled: safeJSONParse('focus_app_timer_auto_check', true), // Default to true
    currentTtsVoice: null, // Randomly selected at test start
    navigationSourceView: null, // View to return to from Tag Mode
    activeTagFilter: null, // Currently active tag Filter for stats view
    questionMap: {}, // composite key (sourceId_questionId) → question object
    githubToken: readString('focus_app_github_token') || null,
    githubGistId: readString('focus_app_github_gist_id') || null,
    githubUser: safeJSONParse('focus_app_github_user', null),
    lastGithubUser: readString('focus_app_last_github_user') || null,
    lastSyncTime: readInt('focus_app_last_sync', 0),
    deletedSourceIds: safeJSONParse('focus_app_deleted_sources', []),
    deletedFolderIds: safeJSONParse('focus_app_deleted_folders', []),
    quickPresets: safeJSONParse('focus_app_quick_presets', []),
    deletedQuickPresetIds: safeJSONParse('focus_app_deleted_quick_presets', []),
    // Timestamp of the last destructive reset on this device (sources/full reset).
    lastResetTimestamp: readInt('focus_app_last_reset', 0),
    // Timestamp of the last progress reset on this device (progress/full reset).
    // Used by mergeSyncData() to prevent stale stats, study activity, streaks
    // and continuity data from a remote Gist overwriting a deliberate clear.
    lastProgressResetTimestamp: readInt('focus_app_last_progress_reset', 0),
    githubGistUrl: readString('focus_app_github_gist_url') || null,
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
    // ── Collect tombstones BEFORE clearing ──────────────────────────────────
    // Every ID that exists right now must be recorded as deleted so that the
    // sync merge cannot resurrect these items from a remote Gist or another
    // device that has not yet seen this reset.
    const priorSourceIds = (AppState.sources || []).map(s => s.id).filter(Boolean);
    const priorFolderIds = (AppState.folders || [])
        .filter(f => f && f.id && !f.isSystem && f.id !== UNCATEGORIZED_FOLDER_ID)
        .map(f => f.id);
    const priorPresetIds = (AppState.quickPresets || []).map(p => p.id).filter(Boolean);

    const allDeletedSourceIds = Array.from(new Set([
        ...(AppState.deletedSourceIds || []),
        ...priorSourceIds
    ]));
    const allDeletedFolderIds = Array.from(new Set([
        ...(AppState.deletedFolderIds || []),
        ...priorFolderIds
    ]));
    const allDeletedPresetIds = Array.from(new Set([
        ...(AppState.deletedQuickPresetIds || []),
        ...priorPresetIds
    ]));
    // ────────────────────────────────────────────────────────────────────────

    AppState.folders = [createUncategorizedFolderRecord()];
    AppState.sources = [];
    AppState.stats = {};
    AppState.totalStats = {};
    AppState.recentTests = [];
    AppState.deletedSourceIds = allDeletedSourceIds;
    AppState.deletedFolderIds = allDeletedFolderIds;
    AppState.quickPresets = [];
    AppState.deletedQuickPresetIds = allDeletedPresetIds;
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
    // Record the reset wall-clock time so mergeSyncData() can recognise that
    // an intentionally-empty local state must not be overwritten by remote data
    // that predates this reset.
    AppState.lastResetTimestamp = Date.now();
    // Full reset also clears all progress data — mark it so the progress-reset
    // guard in mergeSyncData() fires for stats / activity / continuity as well.
    AppState.lastProgressResetTimestamp = AppState.lastResetTimestamp;

    persistRemove('focus_app_preset_sessions');
    persist('focus_app_folders', AppState.folders);
    persist('focus_app_sources', AppState.sources);
    persistRemove('focus_app_stats_local');
    persistRemove('focus_app_stats_global');
    persistRemove('focus_app_recent_tests');
    // Persist tombstones (not remove!) so the next sync push carries them
    persist('focus_app_deleted_sources', allDeletedSourceIds);
    persist('focus_app_deleted_folders', allDeletedFolderIds);
    persist('focus_app_quick_presets', []);
    persist('focus_app_deleted_quick_presets', allDeletedPresetIds);
    persistRemove('focus_app_current_source');
    persistRemove('focus_app_active_test');
    persistRemove('focus_app_continuity_config');
    persistRemove('focus_app_study_activity');
    // Clear sample loaded key so the starter sample JSON for active language is auto-loaded on reset
    persistRemove(SAMPLE_LOADED_KEY);
    persist('focus_app_last_reset', AppState.lastResetTimestamp.toString());
    persist('focus_app_last_progress_reset', AppState.lastProgressResetTimestamp.toString());

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
    // Record the progress-reset wall-clock time so mergeSyncData() knows not to
    // pull back stats / activity / continuity data that predates this clear.
    AppState.lastProgressResetTimestamp = Date.now();

    persistRemove('focus_app_stats_local');
    persistRemove('focus_app_stats_global');
    persistRemove('focus_app_recent_tests');
    persistRemove('focus_app_preset_sessions');
    persistRemove('focus_app_study_activity');
    persist('focus_app_continuity_config', AppState.continuityConfig);
    persist('focus_app_last_progress_reset', AppState.lastProgressResetTimestamp.toString());
    clearActiveTest();
}

/**
 * Deletes all imported question sources, folders, and quick presets,
 * while leaving global configuration intact.
 */
export function clearSourcesData() {
    // ── Collect tombstones BEFORE clearing ──────────────────────────────────
    // Mirror the same logic used in clearLocalStudyData(): every existing ID
    // becomes a tombstone so that a future sync cannot bring these items back
    // from a Gist that still has the old copy.
    const priorSourceIds = (AppState.sources || []).map(s => s.id).filter(Boolean);
    const priorFolderIds = (AppState.folders || [])
        .filter(f => f && f.id && !f.isSystem && f.id !== UNCATEGORIZED_FOLDER_ID)
        .map(f => f.id);
    const priorPresetIds = (AppState.quickPresets || []).map(p => p.id).filter(Boolean);

    const allDeletedSourceIds = Array.from(new Set([
        ...(AppState.deletedSourceIds || []),
        ...priorSourceIds
    ]));
    const allDeletedFolderIds = Array.from(new Set([
        ...(AppState.deletedFolderIds || []),
        ...priorFolderIds
    ]));
    const allDeletedPresetIds = Array.from(new Set([
        ...(AppState.deletedQuickPresetIds || []),
        ...priorPresetIds
    ]));
    // ────────────────────────────────────────────────────────────────────────

    AppState.folders = [createUncategorizedFolderRecord()];
    AppState.sources = [];
    AppState.quickPresets = [];
    AppState.deletedSourceIds = allDeletedSourceIds;
    AppState.deletedFolderIds = allDeletedFolderIds;
    AppState.deletedQuickPresetIds = allDeletedPresetIds;
    AppState.currentSourceKey = null;
    AppState.presetSessions = {};
    AppState.lastResetTimestamp = Date.now();

    persistRemove('focus_app_preset_sessions');
    persist('focus_app_folders', AppState.folders);
    persist('focus_app_sources', AppState.sources);
    persist('focus_app_quick_presets', []);
    // Persist tombstones so the next sync push carries them
    persist('focus_app_deleted_sources', allDeletedSourceIds);
    persist('focus_app_deleted_folders', allDeletedFolderIds);
    persist('focus_app_deleted_quick_presets', allDeletedPresetIds);
    persistRemove('focus_app_current_source');
    persistRemove(SAMPLE_LOADED_KEY);
    persist('focus_app_last_reset', AppState.lastResetTimestamp.toString());

    clearActiveTest();
}

export function savePresetSessions() {
    persist('focus_app_preset_sessions', AppState.presetSessions || {});
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
        persist('focus_app_deleted_sources', AppState.deletedSourceIds);
    }
}

export function trackDeletedFolder(id) {
    if (!id) return;
    if (!AppState.deletedFolderIds.includes(id)) {
        AppState.deletedFolderIds.push(id);
        persist('focus_app_deleted_folders', AppState.deletedFolderIds);
    }
}

export function trackDeletedQuickPreset(id) {
    if (!id) return;
    if (!AppState.deletedQuickPresetIds.includes(id)) {
        AppState.deletedQuickPresetIds.push(id);
        persist('focus_app_deleted_quick_presets', AppState.deletedQuickPresetIds);
    }
}

/* Each save* returns whether the value actually reached disk. A false means the
   change lives in memory only and will be gone on reload - the Gist push is
   still scheduled either way, because when local storage is full the remote
   copy is the user's only way of getting the data back. */

export function saveQuickPresets() {
    const ok = persist('focus_app_quick_presets', AppState.quickPresets);
    import('./github-sync.js').then(m => m.scheduleSync(300)).catch(() => {});
    return ok;
}

export function saveContinuityConfig() {
    const ok = persist('focus_app_continuity_config', AppState.continuityConfig);
    import('./github-sync.js').then(m => m.scheduleSync(300)).catch(() => {});
    return ok;
}

export function saveStudyActivity() {
    const ok = persist('focus_app_study_activity', AppState.studyActivity);
    import('./github-sync.js').then(m => m.scheduleSync(300)).catch(() => {});
    return ok;
}

export function saveStats() {
    const localOk = persist('focus_app_stats_local', AppState.stats);
    const globalOk = persist('focus_app_stats_global', AppState.totalStats);
    import('./github-sync.js').then(m => m.scheduleSync(1500)).catch(() => {});
    return localOk && globalOk;
}

export function saveCustomAIPrompt() {
    return persist('focus_app_custom_ai_prompt', AppState.customAIPrompt);
}


export function saveAiProviders() {
    return persist('focus_app_ai_providers', AppState.aiProviders);
}

export function saveTtsSettings() {
    return [
        persist('focus_app_tts_enabled', AppState.ttsEnabled),
        persist('focus_app_tts_autoplay', AppState.ttsAutoplay),
        persist('focus_app_tts_speed', AppState.ttsSpeed.toString())
    ].every(Boolean);
}

export function saveTimerSettings() {
    return [
        persist('focus_app_timer_stopwatch', AppState.timerStopwatchEnabled),
        persist('focus_app_timer_countdown', AppState.timerCountdownEnabled),
        persist('focus_app_timer_limit', AppState.timerCountdownLimit.toString()),
        persist('focus_app_timer_auto_check', AppState.timerAutoCheckEnabled)
    ].every(Boolean);
}

export function saveSources() {
    const ok = persist('focus_app_sources', AppState.sources);
    import('./github-sync.js').then(m => m.scheduleSync(300)).catch(() => {});
    return ok;
}

export function saveFolders() {
    const ok = persist('focus_app_folders', AppState.folders);
    import('./github-sync.js').then(m => m.scheduleSync(300)).catch(() => {});
    return ok;
}

export function saveCurrentSource(key) {
    AppState.currentSourceKey = key;
    return persist('focus_app_current_source', key || '');
}

export function saveRecentTests() {
    const ok = persist('focus_app_recent_tests', AppState.recentTests);
    import('./github-sync.js').then(m => m.scheduleSync(300)).catch(() => {});
    return ok;
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
        persist('focus_app_active_test', activeData);

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
    persistRemove('focus_app_active_test');
}
