import { detectLanguage, detectTranslationTarget } from './i18n.js';
import { persist, persistIfChanged, persistRemove, readJSON, readString, readInt, readFloat } from './storage.js';
import { emit, Slice } from './store.js';

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

/**
 * The continuity record a device starts from: two independent freeze-token
 * tracks, the focus selection and the notification settings.
 *
 * One function rather than a literal per call site, because a fresh install, a
 * factory reset and a progress reset all have to produce exactly this shape and
 * three hand-maintained copies drift.
 */
export function createDefaultContinuityConfig() {
    return {
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
    };
}

/**
 * The whole of the app's state, in one object every module holds a reference to.
 * It is never reassigned - only mutated - which is what lets those references
 * stay valid for the life of the page.
 *
 * Declared here with defaults only: what a fresh install looks like. Nothing at
 * this level touches storage. Reading the user's data is initState()'s job and
 * happens once, from boot, at a point the caller chooses.
 */
export const AppState = {
    // ── Session-only. Never stored, never restored. ─────────────────────────
    rawQuestions: [],
    currentTest: [],
    currentIndex: 0,
    userAnswers: {},
    isAnswerChecked: {},
    shuffledOptionsMap: {},
    examTitle: 'Exam App',
    testTracking: null,
    previewQuestion: null,
    searchKeyword: '',
    lastStatsScrollPos: 0,
    activeStatsFilter: 'all',
    activeStatsSortField: 'original', // 'original', 'coeff', 'success', 'wrong'
    activeStatsSortDir: 'asc', // 'asc', 'desc'
    currentTtsVoice: null, // Randomly selected at test start
    navigationSourceView: null, // View to return to from Tag Mode
    activeTagFilter: null, // Currently active tag Filter for stats view
    questionMap: {}, // composite key (sourceId_questionId) → question object
    activePresetId: null,

    // ── Loaded from storage by initState(). ─────────────────────────────────
    // The values below are what a device that has never run the app holds, so
    // anything that reads AppState before boot sees an empty app rather than
    // undefined.
    stats: {},
    folders: [],
    // Empty on a fresh install; main.js fetches the sample for the detected
    // language right after boot and renders it in.
    sources: [],
    totalStats: {},
    currentSourceKey: null,
    language: 'en',
    translationTarget: 'de',
    translationEnabled: true,
    recentTests: [],
    customAIPrompt: '',
    aiProviders: DEFAULT_AI_PROVIDERS,
    ttsEnabled: false,
    ttsAutoplay: false,
    ttsSpeed: 0.5,
    timerStopwatchEnabled: false,
    timerCountdownEnabled: false,
    timerCountdownLimit: 59,
    timerAutoCheckEnabled: true, // Default to true
    githubToken: null,
    githubGistId: null,
    githubUser: null,
    lastGithubUser: null,
    lastSyncTime: 0,
    githubGistUrl: null,
    deletedSourceIds: [],
    deletedFolderIds: [],
    quickPresets: [],
    deletedQuickPresetIds: [],
    // Timestamp of the last destructive reset on this device (sources/full reset).
    lastResetTimestamp: 0,
    // Timestamp of the last progress reset on this device (progress/full reset).
    // Used by mergeSyncData() to prevent stale stats, study activity, streaks
    // and continuity data from a remote Gist overwriting a deliberate clear.
    lastProgressResetTimestamp: 0,
    presetSessions: {},
    continuityConfig: createDefaultContinuityConfig(),
    studyActivity: {}
};

/**
 * Reads the folder list and repairs it on the way in: the pre-rename
 * `default-folder` becomes the uncategorised system folder, and a library
 * missing that folder gets one.
 *
 * The repair is written back only when it actually changed something.
 * Unconditionally persisting here is what used to put a storage *write* into
 * module evaluation - importing this file was enough to touch the user's disk.
 */
function loadFolders() {
    let folders = readJSON('focus_app_folders', null);
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

    persistIfChanged('focus_app_folders', folders);
    return folders;
}

let stateInitialized = false;

/**
 * Loads the user's data into AppState. Call once, from boot, before anything
 * renders or syncs.
 *
 * This used to happen implicitly, in the property initialisers of the AppState
 * literal, which meant the mere act of importing this module read the whole of
 * localStorage and wrote a folder repair back to it. Two things came out of
 * that: the boot order was whatever the import graph happened to be, and every
 * test file had to stand up a jsdom localStorage *before* its first import or
 * watch the module blow up. Making the read an explicit call is also what makes
 * a future asynchronous storage backend possible - there was previously no
 * place to await.
 *
 * Idempotent: a second call is ignored unless `force` says otherwise, which is
 * for tests that change what is stored and want it read again.
 *
 * @returns {typeof AppState} the same object, now populated.
 */
export function initState({ force = false } = {}) {
    if (stateInitialized && !force) return AppState;

    const sources = readJSON('focus_app_sources', null);

    Object.assign(AppState, {
        stats: readJSON('focus_app_stats_local', {}),
        folders: loadFolders(),
        sources: Array.isArray(sources)
            ? sources.filter(s => s && s.questions && Array.isArray(s.questions))
            : [],
        totalStats: readJSON('focus_app_stats_global', {}),
        currentSourceKey: readString('focus_app_current_source') || null,
        language: detectLanguage(),
        translationTarget: detectTranslationTarget(),
        translationEnabled: readJSON('focus_app_translation_enabled', true),
        recentTests: readJSON('focus_app_recent_tests', []).slice(0, 10),
        customAIPrompt: readString('focus_app_custom_ai_prompt', '') || '',
        aiProviders: readJSON('focus_app_ai_providers', DEFAULT_AI_PROVIDERS),
        ttsEnabled: readJSON('focus_app_tts_enabled', false),
        ttsAutoplay: readJSON('focus_app_tts_autoplay', false),
        ttsSpeed: readFloat('focus_app_tts_speed', 0.5),
        timerStopwatchEnabled: readJSON('focus_app_timer_stopwatch', false),
        timerCountdownEnabled: readJSON('focus_app_timer_countdown', false),
        timerCountdownLimit: readInt('focus_app_timer_limit', 59),
        timerAutoCheckEnabled: readJSON('focus_app_timer_auto_check', true),
        githubToken: readString('focus_app_github_token') || null,
        githubGistId: readString('focus_app_github_gist_id') || null,
        githubUser: readJSON('focus_app_github_user', null),
        lastGithubUser: readString('focus_app_last_github_user') || null,
        lastSyncTime: readInt('focus_app_last_sync', 0),
        githubGistUrl: readString('focus_app_github_gist_url') || null,
        deletedSourceIds: readJSON('focus_app_deleted_sources', []),
        deletedFolderIds: readJSON('focus_app_deleted_folders', []),
        quickPresets: readJSON('focus_app_quick_presets', []),
        deletedQuickPresetIds: readJSON('focus_app_deleted_quick_presets', []),
        lastResetTimestamp: readInt('focus_app_last_reset', 0),
        lastProgressResetTimestamp: readInt('focus_app_last_progress_reset', 0),
        presetSessions: readJSON('focus_app_preset_sessions', {}),
        continuityConfig: readJSON('focus_app_continuity_config', createDefaultContinuityConfig()),
        studyActivity: readJSON('focus_app_study_activity', {})
    });

    stateInitialized = true;
    return AppState;
}

/** Whether the stored data has been loaded yet. */
export function isStateInitialized() {
    return stateInitialized;
}

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
    AppState.continuityConfig = createDefaultContinuityConfig();
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

    // A factory reset invalidates everything the UI shows.
    emit(
        Slice.SOURCES, Slice.FOLDERS, Slice.STATS, Slice.ACTIVITY,
        Slice.CONTINUITY, Slice.RECENT_TESTS, Slice.PRESETS
    );

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
    /* A progress reset clears the streak, not the setup: the chosen focus
       sources and the notification preferences are configuration the user made
       deliberately and did not ask to lose. */
    AppState.continuityConfig = {
        ...createDefaultContinuityConfig(),
        focusSources: AppState.continuityConfig?.focusSources || [],
        focusSourceNames: AppState.continuityConfig?.focusSourceNames || {},
        notificationSettings: AppState.continuityConfig?.notificationSettings
            || createDefaultContinuityConfig().notificationSettings
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

    // Sources and folders survive a progress reset, so they are not emitted.
    emit(Slice.STATS, Slice.ACTIVITY, Slice.CONTINUITY, Slice.RECENT_TESTS, Slice.PRESETS);

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

    // Stats and activity survive a sources-only reset, so they are not emitted.
    emit(Slice.SOURCES, Slice.FOLDERS, Slice.PRESETS);

    clearActiveTest();
}

export function savePresetSessions() {
    const ok = persist('focus_app_preset_sessions', AppState.presetSessions || {});
    emit(Slice.PRESETS);
    return ok;
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
        emit(Slice.SOURCES);
    }
}

export function trackDeletedFolder(id) {
    if (!id) return;
    if (!AppState.deletedFolderIds.includes(id)) {
        AppState.deletedFolderIds.push(id);
        persist('focus_app_deleted_folders', AppState.deletedFolderIds);
        emit(Slice.FOLDERS);
    }
}

export function trackDeletedQuickPreset(id) {
    if (!id) return;
    if (!AppState.deletedQuickPresetIds.includes(id)) {
        AppState.deletedQuickPresetIds.push(id);
        persist('focus_app_deleted_quick_presets', AppState.deletedQuickPresetIds);
        emit(Slice.PRESETS);
    }
}

/* Each save* returns whether the value actually reached disk. A false means the
   change lives in memory only and will be gone on reload - the Gist push is
   still scheduled either way, because when local storage is full the remote
   copy is the user's only way of getting the data back.

   Each also announces its slice, which is the entire contract these functions
   have with the UI. No save* names a renderer; ui-bindings.js decides what a
   given slice redraws.

   The scheduled Gist push names the file it changed. Only saveSources() touches
   the question library; everything else here writes the small progress file, and
   saying so is what keeps answering one question from re-uploading every
   question in the app. */

export function saveQuickPresets() {
    const { ok, changed } = persistIfChanged('focus_app_quick_presets', AppState.quickPresets);
    if (!changed) return ok;
    emit(Slice.PRESETS);
    import('./github-sync.js').then(m => m.scheduleSync(300, m.SyncScope.PROGRESS)).catch(() => {});
    return ok;
}

export function saveContinuityConfig() {
    const { ok, changed } = persistIfChanged('focus_app_continuity_config', AppState.continuityConfig);
    if (!changed) return ok;
    emit(Slice.CONTINUITY);
    import('./github-sync.js').then(m => m.scheduleSync(300, m.SyncScope.PROGRESS)).catch(() => {});
    return ok;
}

export function saveStudyActivity() {
    const { ok, changed } = persistIfChanged('focus_app_study_activity', AppState.studyActivity);
    if (!changed) return ok;
    emit(Slice.ACTIVITY);
    import('./github-sync.js').then(m => m.scheduleSync(300, m.SyncScope.PROGRESS)).catch(() => {});
    return ok;
}

export function saveStats() {
    const local = persistIfChanged('focus_app_stats_local', AppState.stats);
    const global = persistIfChanged('focus_app_stats_global', AppState.totalStats);
    if (!local.changed && !global.changed) return local.ok && global.ok;
    emit(Slice.STATS);
    import('./github-sync.js').then(m => m.scheduleSync(1500, m.SyncScope.PROGRESS)).catch(() => {});
    return local.ok && global.ok;
}

export function saveCustomAIPrompt() {
    const ok = persist('focus_app_custom_ai_prompt', AppState.customAIPrompt);
    emit(Slice.SETTINGS);
    return ok;
}


export function saveAiProviders() {
    const ok = persist('focus_app_ai_providers', AppState.aiProviders);
    emit(Slice.SETTINGS);
    return ok;
}

export function saveTtsSettings() {
    const ok = [
        persist('focus_app_tts_enabled', AppState.ttsEnabled),
        persist('focus_app_tts_autoplay', AppState.ttsAutoplay),
        persist('focus_app_tts_speed', AppState.ttsSpeed.toString())
    ].every(Boolean);
    emit(Slice.SETTINGS);
    return ok;
}

export function saveTimerSettings() {
    const ok = [
        persist('focus_app_timer_stopwatch', AppState.timerStopwatchEnabled),
        persist('focus_app_timer_countdown', AppState.timerCountdownEnabled),
        persist('focus_app_timer_limit', AppState.timerCountdownLimit.toString()),
        persist('focus_app_timer_auto_check', AppState.timerAutoCheckEnabled)
    ].every(Boolean);
    emit(Slice.SETTINGS);
    return ok;
}

export function saveSources() {
    const { ok, changed } = persistIfChanged('focus_app_sources', AppState.sources);
    if (!changed) return ok;
    emit(Slice.SOURCES);
    /* The only save in this file that rewrites the question library on the
       remote side. */
    import('./github-sync.js').then(m => m.scheduleSync(300, m.SyncScope.SOURCES)).catch(() => {});
    return ok;
}

export function saveFolders() {
    const { ok, changed } = persistIfChanged('focus_app_folders', AppState.folders);
    if (!changed) return ok;
    emit(Slice.FOLDERS);
    import('./github-sync.js').then(m => m.scheduleSync(300, m.SyncScope.PROGRESS)).catch(() => {});
    return ok;
}

export function saveCurrentSource(key) {
    AppState.currentSourceKey = key;
    const ok = persist('focus_app_current_source', key || '');
    emit(Slice.SOURCES);
    return ok;
}

export function saveRecentTests() {
    const { ok, changed } = persistIfChanged('focus_app_recent_tests', AppState.recentTests);
    if (!changed) return ok;
    emit(Slice.RECENT_TESTS);
    import('./github-sync.js').then(m => m.scheduleSync(300, m.SyncScope.PROGRESS)).catch(() => {});
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
        emit(Slice.ACTIVE_TEST);

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
    emit(Slice.ACTIVE_TEST);
}
