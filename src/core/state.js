import { detectLanguage, detectTranslationTarget } from './i18n.js';
import { persistAsync, persistIfChangedAsync, persistRemoveAsync, readJSONAsync, readStringAsync, readIntAsync, readFloatAsync, migrateFromLocalStorage } from './storage.js';
import { emit, Slice } from './store.js';
import { mergeFolderDeletions, sanitizeFolderDeletions } from './folder-tombstones.js';
import { mergeDatedIds } from './source-tombstones.js';

/**
 * Safely reads and parses a JSON item from localStorage/IndexedDB.
 * Kept as the historical name; storage.js owns the implementation now.
 */
export const safeJSONParse = readJSONAsync;

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
        name: 'Uncategorized',
        color: '#8a99ad',
        description: 'Uncategorized sources',
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
        /* `spentOn` and `grants` are the state; `remaining` is a view of the two
           - see core/freeze-tokens.js. Spelled out here rather than left to be
           filled in later so a reset writes a record of the current shape: an
           absent `spentOn` is read as a pre-ledger record and gets one
           synthesised from `remaining`, which is a different thing to mean. */
        // Genel Seri dondurma tokenleri
        freezeTokens: {
            total: 1,
            remaining: 1,
            tier1Earned: false,
            tier2Earned: false,
            initialized: true,
            spentOn: [],
            grants: []
        },
        // Odak Seri dondurma tokenleri
        focusFreezeTokens: {
            total: 1,
            remaining: 1,
            tier1Earned: false,
            tier2Earned: false,
            initialized: true,
            spentOn: [],
            grants: []
        },
        focusPools: [],
        focusSources: [],
        focusSourceNames: {},
        focusSourceTimestamps: {},
        displaySettings: {
            showFocusSlide: true,
            showNuggetSlide: true,
            showMotivationSlide: true
        },
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
    /* Where a sequential session starts in the pool. Session-only on purpose:
       it is mirrored by a visible picker, and a remembered offset would have a
       fresh tab draw questions the user never chose. See test-range.js. */
    questionStartIndex: 0,

    // ── Loaded from storage by initState(). ─────────────────────────────────
    // The values below are what a device that has never run the app holds, so
    // anything that reads AppState before boot sees an empty app rather than
    // undefined.
    stats: {},
    folders: [],
    // Empty on a fresh install; main.js fetches the sample for the detected
    // language right after boot and renders it in.
    sources: [],
    currentSourceKey: null,
    language: 'en',
    translationTarget: 'de',
    translationEnabled: true,
    recentTests: [],
    customAIPrompt: '',
    /* The prompt library and its tombstones - see core/ai-prompts.js. Records
       with ids rather than one blob, because two devices each adding a prompt
       have to end up with two prompts. */
    aiPrompts: [],
    deletedAiPromptIds: [],
    /* Which prompt the AI menu opens on. A synced setting: picking "Explain the
       topic" on the phone should still be the choice on the laptop. */
    activePromptId: 'default',
    /* A prompt typed for the question at hand. Deliberately absent from the
       sync payload - it belongs to this moment on this device, and the user
       promotes it to the library explicitly if they want it to travel. */
    adhocPrompt: '',
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
    // Consecutive failed sync attempts, and what kind the last one was (see
    // SyncFailure in github-sync.js). Persisted, because the failure this is
    // meant to surface - an expired token - outlives the session that hit it.
    syncFailureCount: 0,
    syncFailureKind: null,
    // Per-key stamps for SYNCED_SETTINGS - see saveSyncedSettings().
    settingsRevisions: {},
    githubGistUrl: null,
    deletedSourceIds: [],
    // Dated source deletions and deliberate revivals (id -> ms); the later one
    // wins - see core/source-tombstones.js.
    deletedSourceAt: {},
    revivedSourceAt: {},
    // Legacy, undated folder tombstones: they win outright, see folder-tombstones.js.
    deletedFolderIds: [],
    // Dated folder deletions (id -> ms). A folder can outlive one of these.
    deletedFolderAt: {},
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
async function loadFoldersAsync() {
    let folders = await readJSONAsync('focus_app_folders', null);
    if (!Array.isArray(folders)) folders = [];

    let hasUncategorized = false;
    folders = folders.map(f => {
        if (f.id === 'default-folder') {
            hasUncategorized = true;
            return { ...f, id: UNCATEGORIZED_FOLDER_ID, name: 'Uncategorized', color: '#8a99ad', isSystem: true };
        }
        if (f.id === UNCATEGORIZED_FOLDER_ID) {
            hasUncategorized = true;
            return { ...f, name: 'Uncategorized', color: '#8a99ad', isSystem: true };
        }
        return f;
    });

    if (!hasUncategorized) {
        folders.unshift(createUncategorizedFolderRecord());
    }

    await persistIfChangedAsync('focus_app_folders', folders);
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
export async function initState({ force = false } = {}) {
    if (stateInitialized && !force) return AppState;

    await migrateFromLocalStorage();

    const sources = await readJSONAsync('focus_app_sources', null);

    Object.assign(AppState, {
        stats: await readJSONAsync('focus_app_stats_local', {}),
        folders: await loadFoldersAsync(),
        sources: Array.isArray(sources)
            ? sources.filter(s => s && s.questions && Array.isArray(s.questions))
            : [],
        currentSourceKey: await readStringAsync('focus_app_current_source') || null,
        language: detectLanguage(),
        translationTarget: detectTranslationTarget(),
        translationEnabled: await readJSONAsync('focus_app_translation_enabled', true),
        recentTests: (await readJSONAsync('focus_app_recent_tests', [])).slice(0, 10),
        customAIPrompt: await readStringAsync('focus_app_custom_ai_prompt', '') || '',
        aiPrompts: await readJSONAsync('focus_app_ai_prompts', []),
        deletedAiPromptIds: await readJSONAsync('focus_app_deleted_ai_prompts', []),
        activePromptId: await readStringAsync('focus_app_active_prompt_id', 'default') || 'default',
        adhocPrompt: await readStringAsync('focus_app_adhoc_prompt', '') || '',
        aiProviders: await readJSONAsync('focus_app_ai_providers', DEFAULT_AI_PROVIDERS),
        ttsEnabled: await readJSONAsync('focus_app_tts_enabled', false),
        ttsAutoplay: await readJSONAsync('focus_app_tts_autoplay', false),
        ttsSpeed: await readFloatAsync('focus_app_tts_speed', 0.5),
        timerStopwatchEnabled: await readJSONAsync('focus_app_timer_stopwatch', false),
        timerCountdownEnabled: await readJSONAsync('focus_app_timer_countdown', false),
        timerCountdownLimit: await readIntAsync('focus_app_timer_limit', 59),
        timerAutoCheckEnabled: await readJSONAsync('focus_app_timer_auto_check', true),
        githubToken: await readStringAsync('focus_app_github_token') || null,
        githubGistId: await readStringAsync('focus_app_github_gist_id') || null,
        githubUser: await readJSONAsync('focus_app_github_user', null),
        lastGithubUser: await readStringAsync('focus_app_last_github_user') || null,
        lastSyncTime: await readIntAsync('focus_app_last_sync', 0),
        syncFailureCount: await readIntAsync('focus_app_sync_failures', 0),
        syncFailureKind: await readStringAsync('focus_app_sync_failure_kind') || null,
        githubGistUrl: await readStringAsync('focus_app_github_gist_url') || null,
        deletedSourceIds: await readJSONAsync('focus_app_deleted_sources', []),
        deletedSourceAt: sanitizeFolderDeletions(await readJSONAsync('focus_app_deleted_source_at', {})),
        revivedSourceAt: sanitizeFolderDeletions(await readJSONAsync('focus_app_revived_source_at', {})),
        deletedFolderIds: await readJSONAsync('focus_app_deleted_folders', []),
        deletedFolderAt: sanitizeFolderDeletions(await readJSONAsync('focus_app_deleted_folder_at', {})),
        quickPresets: await readJSONAsync('focus_app_quick_presets', []),
        deletedQuickPresetIds: await readJSONAsync('focus_app_deleted_quick_presets', []),
        lastResetTimestamp: await readIntAsync('focus_app_last_reset', 0),
        lastProgressResetTimestamp: await readIntAsync('focus_app_last_progress_reset', 0),
        presetSessions: await readJSONAsync('focus_app_preset_sessions', {}),
        continuityConfig: await readJSONAsync('focus_app_continuity_config', createDefaultContinuityConfig()),
        studyActivity: await readJSONAsync('focus_app_study_activity', {}),
        settingsRevisions: await readJSONAsync('focus_app_settings_revisions', {}),
        deviceId: await loadDeviceIdAsync()
    });

    /* Same baseline rule as the continuity config: the settings as loaded are
       what this device already had, not eleven fresh edits. Without it the first
       save after an upgrade would claim every key at once. */
    rebaseSettingsRevisions();

    /* The config as loaded is the baseline, not an edit. Without this the first
       save after an upgrade would find an empty base, stamp every key as
       freshly changed, and hand this device's whole config authority over the
       other devices' - the migration would be decided by whoever saved first. */
    rebaseContinuityRevisions(AppState.continuityConfig);

    // Sanitize source folder references: invalid folder IDs cleared to null, archived folder sources moved to archive
    AppState.sources.forEach(s => {
        if (!s || !s.folderId || s.folderId === UNCATEGORIZED_FOLDER_ID) {
            if (s) s.folderId = null;
            return;
        }
        const folder = AppState.folders.find(f => f.id === s.folderId);
        if (!folder) {
            s.folderId = null;
        } else if (folder.archived && !s.archived) {
            s.archivedFrom = { folderId: folder.id, name: folder.name, color: folder.color };
            s.archived = true;
            s.active = false;
            s.folderId = null;
        }
    });

    stateInitialized = true;
    return AppState;
}

/**
 * A stable id for this browser profile.
 *
 * The unfinished-test record is the one piece of synced state where "who wrote
 * this" matters as much as "when": the device actually sitting in a test must
 * keep its own session even if the other device's copy carries a later
 * timestamp. Nothing else reads this, and it never leaves the Gist.
 */
async function loadDeviceIdAsync() {
    const existing = await readStringAsync('focus_app_device_id');
    if (existing) return existing;

    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await persistAsync('focus_app_device_id', id);
    return id;
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
    AppState.recentTests = [];
    AppState.deletedSourceIds = allDeletedSourceIds;
    AppState.deletedFolderIds = allDeletedFolderIds;
    AppState.quickPresets = [];
    AppState.deletedQuickPresetIds = allDeletedPresetIds;
    AppState.currentSourceKey = null;
    AppState.presetSessions = {};
    /* `aiPrompts` is deliberately NOT cleared here or in the other two resets.
       It has quickPresets' shape and sits next to it in the payload, so it is
       the obvious thing to sweep in alongside - but a prompt is a tool the user
       wrote, not a record of their progress, and it survives a reset for the
       same reason the language and the TTS settings do. */
    /* Factory values, but the revision map is carried over: a key this reset
       genuinely changed is re-stamped by saveContinuityConfig() below and
       outranks every other device, while a key that already held its default
       keeps the stamp describing the value it still has. Dropping the map would
       leave those reading as never-stamped, and the merge's content tie-break
       then hands them back to a device that missed the reset. */
    AppState.continuityConfig = {
        ...createDefaultContinuityConfig(),
        revisions: AppState.continuityConfig?.revisions || {}
    };
    AppState.studyActivity = {};
    // Record the reset wall-clock time so mergeSyncData() can recognise that
    // an intentionally-empty local state must not be overwritten by remote data
    // that predates this reset.
    AppState.lastResetTimestamp = Date.now();
    // Full reset also clears all progress data — mark it so the progress-reset
    // guard in mergeSyncData() fires for stats / activity / continuity as well.
    AppState.lastProgressResetTimestamp = AppState.lastResetTimestamp;

    persistRemoveAsync('focus_app_preset_sessions');
    persistAsync('focus_app_folders', AppState.folders);
    persistAsync('focus_app_sources', AppState.sources);
    persistRemoveAsync('focus_app_stats_local');
    persistRemoveAsync('focus_app_stats_global');
    persistRemoveAsync('focus_app_recent_tests');
    // Persist tombstones (not remove!) so the next sync push carries them
    persistAsync('focus_app_deleted_sources', allDeletedSourceIds);
    stampSourceDeletions(priorSourceIds, AppState.lastResetTimestamp);
    persistAsync('focus_app_deleted_folders', allDeletedFolderIds);
    persistAsync('focus_app_quick_presets', []);
    persistAsync('focus_app_deleted_quick_presets', allDeletedPresetIds);
    persistRemoveAsync('focus_app_current_source');
    persistRemoveAsync('focus_app_active_test');
    persistRemoveAsync('focus_app_continuity_config');
    /* Factory config, stamped - see clearProgressData() for why the stamps are
       what defends a reset once the merge's timestamp guard has expired. This
       reset needs them more than that one does: createDefaultContinuityConfig()
       carries no revisions at all, so every key would read as never-stamped, and
       the merge's content tie-break gives a non-empty value the win - a device
       that missed the reset hands its focus selection straight back. */
    saveContinuityConfig();
    persistRemoveAsync('focus_app_study_activity');
    // Clear sample loaded key so the starter sample JSON for active language is auto-loaded on reset
    persistRemoveAsync(SAMPLE_LOADED_KEY);
    persistAsync('focus_app_last_reset', AppState.lastResetTimestamp.toString());
    persistAsync('focus_app_last_progress_reset', AppState.lastProgressResetTimestamp.toString());

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
        focusSourceTimestamps: AppState.continuityConfig?.focusSourceTimestamps || {},
        displaySettings: AppState.continuityConfig?.displaySettings || createDefaultContinuityConfig().displaySettings,
        notificationSettings: AppState.continuityConfig?.notificationSettings
            || createDefaultContinuityConfig().notificationSettings,
        /* Carried with the values above, which are the whole point of keeping
           them: a selection the reset preserves has to keep the stamp that says
           when it was made, or it reads as never-stamped and the merge lets
           another device's older selection win it back. */
        revisions: AppState.continuityConfig?.revisions || {}
    };
    // Record the progress-reset wall-clock time so mergeSyncData() knows not to
    // pull back stats / activity / continuity data that predates this clear.
    AppState.lastProgressResetTimestamp = Date.now();

    persistRemoveAsync('focus_app_stats_local');
    persistRemoveAsync('focus_app_stats_global');
    persistRemoveAsync('focus_app_recent_tests');
    persistRemoveAsync('focus_app_preset_sessions');
    persistRemoveAsync('focus_app_study_activity');
    /* Stamped like any other edit, because that is what it is. The
       lastProgressResetTimestamp guard in the sync merge only holds until this
       device has pushed - it has to, or it never expires and the config stops
       syncing for good - so after that the per-key stamps are the only thing
       standing between the reset and a device that missed it handing the spent
       tokens back. The diff in stampContinuityRevisions() marks exactly the
       keys the reset rewrote: the token records change and get the reset's
       instant, while the focus selection and the notification settings are
       carried over untouched above and keep whatever stamps they already had. */
    saveContinuityConfig();
    persistAsync('focus_app_last_progress_reset', AppState.lastProgressResetTimestamp.toString());

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

    persistRemoveAsync('focus_app_preset_sessions');
    persistAsync('focus_app_folders', AppState.folders);
    persistAsync('focus_app_sources', AppState.sources);
    persistAsync('focus_app_quick_presets', []);
    // Persist tombstones so the next sync push carries them
    persistAsync('focus_app_deleted_sources', allDeletedSourceIds);
    stampSourceDeletions(priorSourceIds, AppState.lastResetTimestamp);
    persistAsync('focus_app_deleted_folders', allDeletedFolderIds);
    persistAsync('focus_app_deleted_quick_presets', allDeletedPresetIds);
    persistRemoveAsync('focus_app_current_source');
    persistRemoveAsync(SAMPLE_LOADED_KEY);
    persistAsync('focus_app_last_reset', AppState.lastResetTimestamp.toString());

    // Stats and activity survive a sources-only reset, so they are not emitted.
    emit(Slice.SOURCES, Slice.FOLDERS, Slice.PRESETS);

    clearActiveTest();
}

export function savePresetSessions() {
    persistAsync('focus_app_preset_sessions', AppState.presetSessions || {});
    emit(Slice.PRESETS);
    return true;
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

/* Dates deletions, so a later deliberate revival can outlive them and a revival
   older than them cannot - see core/source-tombstones.js. */
function stampSourceDeletions(ids, at = Date.now()) {
    const stamps = {};
    (ids || []).forEach(id => { if (id) stamps[id] = at; });
    if (Object.keys(stamps).length === 0) return;
    AppState.deletedSourceAt = mergeDatedIds(AppState.deletedSourceAt, stamps);
    persistAsync('focus_app_deleted_source_at', AppState.deletedSourceAt);
}

export function trackDeletedSource(id, at = Date.now()) {
    if (!id) return;
    if (!AppState.deletedSourceIds.includes(id)) {
        AppState.deletedSourceIds.push(id);
        persistAsync('focus_app_deleted_sources', AppState.deletedSourceIds);
    }
    stampSourceDeletions([id], at);
    emit(Slice.SOURCES);
}

/**
 * Brings a deleted source id back: a deliberate act (the same file imported
 * again), dated so it outlives every earlier deletion on every device.
 * @returns {boolean} whether the id was deleted
 */
export function reviveSource(id, at = Date.now()) {
    if (!id) return false;
    const listed = (AppState.deletedSourceIds || []).includes(id);
    const deletedAt = Number(AppState.deletedSourceAt?.[id]) || 0;
    if (!listed && deletedAt <= 0) return false;
    const when = Math.max(at, deletedAt + 1);
    AppState.deletedSourceIds = (AppState.deletedSourceIds || []).filter(x => x !== id);
    AppState.revivedSourceAt = mergeDatedIds(AppState.revivedSourceAt, { [id]: when });
    persistAsync('focus_app_deleted_sources', AppState.deletedSourceIds);
    persistAsync('focus_app_revived_source_at', AppState.revivedSourceAt);
    return true;
}

/**
 * Records a folder deletion with the time it was made. Dated, not added to the
 * legacy `deletedFolderIds`: a dated deletion can be outlived by a folder that
 * another device is still using - see core/folder-tombstones.js.
 */
export function trackDeletedFolder(id, at = Date.now()) {
    if (!id) return;
    const prev = Number(AppState.deletedFolderAt?.[id]) || 0;
    if (at <= prev) return;
    AppState.deletedFolderAt = mergeFolderDeletions(AppState.deletedFolderAt, { [id]: at });
    persistAsync('focus_app_deleted_folder_at', AppState.deletedFolderAt);
    emit(Slice.FOLDERS);
}

export function trackDeletedQuickPreset(id) {
    if (!id) return;
    if (!AppState.deletedQuickPresetIds.includes(id)) {
        AppState.deletedQuickPresetIds.push(id);
        persistAsync('focus_app_deleted_quick_presets', AppState.deletedQuickPresetIds);
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
    persistIfChangedAsync('focus_app_quick_presets', AppState.quickPresets).then(({ changed }) => {
        if (!changed) return;
        emit(Slice.PRESETS);
        import('./github-sync.js').then(m => m.scheduleSync(300, m.SyncScope.PROGRESS)).catch(() => {});
    });
    return true;
}

/* ── Continuity config revisions ────────────────────────────────────────────
   The config used to sync as one blob under a "remote wins" rule, which meant a
   device could not get its own change up: the push merged remote's blob back
   over the change it was pushing, and the next pull then reverted the change
   locally. Picking a focus source, earning a token, spending one - all of it
   died on the device that did it, and the three devices settled on three
   different answers because each kept recomputing from its own copy.

   Every top-level key of the config is now its own record with its own stamp,
   and the newest stamp wins. Deriving the groups from the keys themselves
   rather than a hand-kept list is deliberate: a field added later gets merged
   correctly without anyone remembering to register it. */

/** The config as it stood at the last stamp, per key, serialised for comparison. */
let continuityRevisionBase = new Map();

/** Everything about the config except the stamps themselves. */
function continuityGroups(config) {
    return Object.keys(config || {}).filter(key => key !== 'revisions');
}

/**
 * Stamps the keys whose value actually changed since the last save.
 *
 * Diffing rather than asking the caller which key it touched: a caller that
 * forgets - or a new one that never knew - would write a change no other device
 * could see, and nothing would fail loudly enough to notice.
 */
function stampContinuityRevisions(config) {
    if (!config.revisions || typeof config.revisions !== 'object') config.revisions = {};
    const now = Date.now();

    continuityGroups(config).forEach(key => {
        const serialised = JSON.stringify(config[key] ?? null);
        if (continuityRevisionBase.get(key) === serialised) return;
        config.revisions[key] = { at: now, by: AppState.deviceId || null };
    });
}

/** Re-reads the comparison base, so the next save diffs against what is there now. */
function rebaseContinuityRevisions(config) {
    continuityRevisionBase = new Map(
        continuityGroups(config).map(key => [key, JSON.stringify(config[key] ?? null)])
    );
}

/**
 * @param {{stamp?: boolean}} [options] `stamp: false` is for the sync apply
 *        path, which is writing a merge result: those values already carry the
 *        stamps they won with, and re-stamping them as local edits would make
 *        every pull look like a change this device had just made.
 */
export function saveContinuityConfig({ stamp = true } = {}) {
    if (!AppState.continuityConfig) AppState.continuityConfig = {};
    if (stamp) stampContinuityRevisions(AppState.continuityConfig);
    rebaseContinuityRevisions(AppState.continuityConfig);

    persistIfChangedAsync('focus_app_continuity_config', AppState.continuityConfig).then(({ changed }) => {
        if (!changed) return;
        emit(Slice.CONTINUITY);
        import('./github-sync.js').then(m => m.scheduleSync(300, m.SyncScope.PROGRESS)).catch(() => {});
    });
    return true;
}

export function saveStudyActivity() {
    persistIfChangedAsync('focus_app_study_activity', AppState.studyActivity).then(({ changed }) => {
        if (!changed) return;
        emit(Slice.ACTIVITY);
        import('./github-sync.js').then(m => m.scheduleSync(300, m.SyncScope.PROGRESS)).catch(() => {});
    });
    return true;
}

export function saveStats() {
    persistIfChangedAsync('focus_app_stats_local', AppState.stats).then(({ changed }) => {
        if (!changed) return;
        emit(Slice.STATS);
        import('./github-sync.js').then(m => m.scheduleSync(1500, m.SyncScope.PROGRESS)).catch(() => {});
    });
    return true;
}

/* ── Synced settings ────────────────────────────────────────────────────────
   These twelve follow the user across devices. They stay ordinary AppState
   fields under their own storage keys - every reader and every settings screen
   is untouched - and what is added is a stamp per key.

   The stamp is not optional. A value with nothing to rank it by leaves the merge
   only two rules, and both are broken: "remote wins" kills the change on the
   device that made it at the next pull, and "local wins" means it never reaches
   anyone. That is the same trap continuityConfig was in before (14), so this
   uses the same shape and the same merge.

   Diffing rather than asking each caller which key it touched, for the reason
   spelled out at stampContinuityRevisions(): a caller that forgets writes a
   change no other device can see, and nothing fails loudly enough to notice. */
export const SYNCED_SETTINGS = Object.freeze([
    'language', 'translationTarget', 'translationEnabled',
    'ttsEnabled', 'ttsAutoplay', 'ttsSpeed', 'customAIPrompt', 'activePromptId',
    'timerStopwatchEnabled', 'timerCountdownEnabled',
    'timerCountdownLimit', 'timerAutoCheckEnabled'
]);

/** Where each synced setting already lives in storage. */
const SETTINGS_STORAGE_KEYS = Object.freeze({
    language: 'focus_app_lang',
    translationTarget: 'focus_app_target_lang',
    translationEnabled: 'focus_app_translation_enabled',
    ttsEnabled: 'focus_app_tts_enabled',
    ttsAutoplay: 'focus_app_tts_autoplay',
    ttsSpeed: 'focus_app_tts_speed',
    customAIPrompt: 'focus_app_custom_ai_prompt',
    activePromptId: 'focus_app_active_prompt_id',
    timerStopwatchEnabled: 'focus_app_timer_stopwatch',
    timerCountdownEnabled: 'focus_app_timer_countdown',
    timerCountdownLimit: 'focus_app_timer_limit',
    timerAutoCheckEnabled: 'focus_app_timer_auto_check'
});

/** The synced settings as they stand, for the sync payload. */
export function getSettingsSnapshot() {
    const values = {};
    SYNCED_SETTINGS.forEach(key => { values[key] = AppState[key]; });
    return values;
}

/** The settings as they stood at the last stamp, serialised for comparison. */
let settingsRevisionBase = new Map();

function rebaseSettingsRevisions() {
    settingsRevisionBase = new Map(
        SYNCED_SETTINGS.map(key => [key, JSON.stringify(AppState[key] ?? null)])
    );
}

/**
 * Stamps whichever synced settings actually changed, and schedules the push.
 *
 * Called after the existing save paths have written the values themselves, so
 * it never has to know how any single setting is stored.
 */
export function saveSyncedSettings() {
    if (!AppState.settingsRevisions || typeof AppState.settingsRevisions !== 'object') {
        AppState.settingsRevisions = {};
    }
    const now = Date.now();
    let stamped = false;

    SYNCED_SETTINGS.forEach(key => {
        const serialised = JSON.stringify(AppState[key] ?? null);
        if (settingsRevisionBase.get(key) === serialised) return;
        AppState.settingsRevisions[key] = { at: now, by: AppState.deviceId || null };
        stamped = true;
    });
    rebaseSettingsRevisions();
    if (!stamped) return true;

    persistIfChangedAsync('focus_app_settings_revisions', AppState.settingsRevisions).then(() => { import('./github-sync.js').then(m => m.scheduleSync(300, m.SyncScope.PROGRESS)).catch(() => {}); });
    return true;
}

/**
 * Applies a merged settings record - the pull's side of the same mechanism.
 *
 * Writes each value to the key its own reader already uses, so a value that
 * arrives here is indistinguishable from one set on this device. The stamps are
 * adopted as given rather than re-dated, for the reason saveContinuityConfig's
 * `stamp: false` exists: re-stamping would make this device out-rank the one the
 * value came from and push it straight back.
 *
 * @returns {boolean} whether anything changed, so the caller can decide to redraw.
 */
export function applySyncedSettings(values, revisions) {
    if (!values || typeof values !== 'object') return false;
    let changed = false;

    SYNCED_SETTINGS.forEach(key => {
        if (!(key in values)) return;
        /* Only a key somebody has actually set. Every device carries all twelve
           whether or not their values mean anything, so applying unstamped ones
           would let the first device to push after the upgrade decide the
           language and the timer for the other two - a setting nobody touched
           changing by itself is the one behaviour this must not have. Once a key
           is deliberately changed it is stamped, and from then on it travels. */
        const rev = revisions && revisions[key];
        if (!rev || !Number.isFinite(rev.at) || rev.at <= 0) return;

        const next = values[key];
        if (next === undefined || next === null) return;
        if (JSON.stringify(AppState[key] ?? null) === JSON.stringify(next)) return;
        AppState[key] = next;
        persistAsync(SETTINGS_STORAGE_KEYS[key], next);
        changed = true;
    });

    if (revisions && typeof revisions === 'object') {
        AppState.settingsRevisions = revisions;
        persistIfChangedAsync('focus_app_settings_revisions', revisions);
    }
    rebaseSettingsRevisions();

    if (changed) emit(Slice.SETTINGS);
    return changed;
}

export function saveCustomAIPrompt() {
    persistAsync('focus_app_custom_ai_prompt', AppState.customAIPrompt);
    saveSyncedSettings();
    emit(Slice.SETTINGS);
    return true;
}

/* ── The prompt library ─────────────────────────────────────────────────────
   Records with ids, tombstoned on delete, merged by id. Not a synced *setting*:
   settings rank two values of one key by stamp, which is right for "the
   language is German" and wrong for a list - two devices each adding a prompt
   would keep one of the two lists and silently drop the other. */

export function saveAiPrompts() {
    persistIfChangedAsync('focus_app_ai_prompts', AppState.aiPrompts).then(({ changed }) => {
        if (!changed) return;
        emit(Slice.SETTINGS);
        import('./github-sync.js').then(m => m.scheduleSync(300, m.SyncScope.PROGRESS)).catch(() => {});
    });
    return true;
}

export function trackDeletedAiPrompt(id) {
    if (!id) return;
    if (!AppState.deletedAiPromptIds.includes(id)) {
        AppState.deletedAiPromptIds.push(id);
        persistAsync('focus_app_deleted_ai_prompts', AppState.deletedAiPromptIds);
        emit(Slice.SETTINGS);
    }
}

/** The menu's current selection. Synced, so it goes through the stamping path. */
export function saveActivePromptId() {
    persistAsync('focus_app_active_prompt_id', AppState.activePromptId || 'default');
    saveSyncedSettings();
    emit(Slice.SETTINGS);
    return true;
}

/**
 * The one-off prompt.
 *
 * Persisted so a reload mid-test does not lose it, but deliberately never
 * scheduled for sync and never added to the payload: it describes the question
 * on the screen of this device, and a copy arriving on another device would be
 * a prompt the user there never wrote and cannot account for.
 */
export function saveAdhocPrompt() {
    persistAsync('focus_app_adhoc_prompt', AppState.adhocPrompt || '');
    emit(Slice.SETTINGS);
    return true;
}


export function saveAiProviders() {
    // Not synced: the provider list is a device's own set of external tools.
    persistAsync('focus_app_ai_providers', AppState.aiProviders);
    emit(Slice.SETTINGS);
    return true;
}

export function saveTtsSettings() {
    [
        persistAsync('focus_app_tts_enabled', AppState.ttsEnabled),
        persistAsync('focus_app_tts_autoplay', AppState.ttsAutoplay),
        persistAsync('focus_app_tts_speed', AppState.ttsSpeed.toString())
    ].every(Boolean);
    saveSyncedSettings();
    emit(Slice.SETTINGS);
    return true;
}

export function saveTimerSettings() {
    [
        persistAsync('focus_app_timer_stopwatch', AppState.timerStopwatchEnabled),
        persistAsync('focus_app_timer_countdown', AppState.timerCountdownEnabled),
        persistAsync('focus_app_timer_limit', AppState.timerCountdownLimit.toString()),
        persistAsync('focus_app_timer_auto_check', AppState.timerAutoCheckEnabled)
    ].every(Boolean);
    saveSyncedSettings();
    emit(Slice.SETTINGS);
    return true;
}

/**
 * The language / translation settings, which the settings screen writes itself.
 * Same stamping, one call rather than three.
 */
export function saveLanguageSettings() {
    saveSyncedSettings();
    emit(Slice.SETTINGS);
}

export function saveSources() {
    persistIfChangedAsync('focus_app_sources', AppState.sources).then(({ changed }) => {
        if (!changed) return;
        emit(Slice.SOURCES);
        /* The only save in this file that rewrites the question library on the
           remote side. */
        import('./github-sync.js').then(m => m.scheduleSync(300, m.SyncScope.SOURCES)).catch(() => {});
    });
    return true;
}

export function saveFolders() {
    persistIfChangedAsync('focus_app_folders', AppState.folders).then(({ changed }) => {
        if (!changed) return;
        emit(Slice.FOLDERS);
        import('./github-sync.js').then(m => m.scheduleSync(300, m.SyncScope.PROGRESS)).catch(() => {});
    });
    return true;
}

export function saveCurrentSource(key) {
    AppState.currentSourceKey = key;
    persistAsync('focus_app_current_source', key || '');
    emit(Slice.SOURCES);
    return true;
}

export function saveRecentTests() {
    persistIfChangedAsync('focus_app_recent_tests', AppState.recentTests).then(({ changed }) => {
        if (!changed) return;
        emit(Slice.RECENT_TESTS);
        import('./github-sync.js').then(m => m.scheduleSync(300, m.SyncScope.PROGRESS)).catch(() => {});
    });
    return true;
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
            /* Who wrote this and when. The sync merge needs both to decide
               between two devices' unfinished tests - see pickActiveSession(). */
            deviceId: AppState.deviceId || null,
            updatedAt: Date.now()
        };
        persistAsync('focus_app_active_test', activeData);
        emit(Slice.ACTIVE_TEST);
        import('./github-sync.js').then(m => m.scheduleSync(3000, m.SyncScope.PROGRESS)).catch(() => {});

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

/**
 * Ends the unfinished-test record.
 *
 * A tombstone rather than a delete. The record is synced now, and "this device
 * has no session" and "this device has not written one yet" are indistinguishable
 * once the key is simply gone - so finishing a test here would let the other
 * device's stale copy come back on the next merge and offer to resume a test
 * that is already in the history. A cleared record carries a timestamp, which
 * the same newest-wins rule settles.
 *
 * Readers already treat it correctly: both checkActiveTest() and
 * resumeActiveTest() key off currentTest having entries, and this has none.
 */
export function clearActiveTest() {
    /* The debounced write above is the one thing that can outlive the test it
       belongs to. saveActiveTest() fires on every answer and every navigation,
       so a finish that lands inside that 300ms window used to be followed by a
       write that put the just-filed session back on disk as a resumable one -
       overwriting this tombstone, with testTracking already nulled by
       finishTest()'s finally. Measured: tombstone written, 300ms later a record
       with ten question ids and no tracking record. What the user sees is a
       finished test offering to resume, and a session that cannot be finished
       again because finishTest() returns early without a tracking record. */
    clearTimeout(_saveActiveTestTimer);
    _saveActiveTestTimer = null;

    persistAsync('focus_app_active_test', {
        cleared: true,
        deviceId: AppState.deviceId || null,
        updatedAt: Date.now()
    });
    emit(Slice.ACTIVE_TEST);
    import('./github-sync.js').then(m => m.scheduleSync(300, m.SyncScope.PROGRESS)).catch(() => {});
}
