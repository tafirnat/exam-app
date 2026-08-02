import { AppState, saveSources, saveStats, saveRecentTests, saveFolders, saveQuickPresets, clearLocalStudyData, saveStudyActivity, saveContinuityConfig } from './state.js';
import { showToast, showAlert } from './utils.js';
import { t } from './i18n.js';
import { migrateFolderColors, sanitizeActivityRecord } from './migration.js';
import { persist, persistRemove, readJSON } from './storage.js';
import { emit, Slice, getActiveView } from './store.js';

/* The Gist holds three files, and a PATCH only touches the ones it names. The
   split is by how big a file is against how often it is written:

     exam_app_backup.json    progress - stats, activity, tombstones, settings.
                             Small, rewritten on nearly every save.
     exam_app_sources.json   the question library. Large, rewritten only when a
                             source actually changes.
     exam_app_archive.json   questions of archived sources that were offloaded
                             off the device. Large, rewritten only on archive
                             changes.

   Keeping the library out of the progress file is the point: answering one
   question schedules a sync, and before the split that meant re-uploading every
   question in the app - hundreds of kilobytes to megabytes - to record a single
   correct answer. */
const GIST_FILENAME = 'exam_app_backup.json';
const SOURCES_FILENAME = 'exam_app_sources.json';
const ARCHIVE_FILENAME = 'exam_app_archive.json';
const GIST_DESCRIPTION = 'Exam App - User Study & Resource Data Sync';
const GITHUB_API_BASE = 'https://api.github.com';

/** Which file a scheduled push has to rewrite. */
export const SyncScope = Object.freeze({
    /** exam_app_backup.json: stats, activity, folders, presets, settings. */
    PROGRESS: 'progress',
    /** exam_app_sources.json: the question library. */
    SOURCES: 'sources'
});

const ALL_SCOPES = Object.freeze([SyncScope.PROGRESS, SyncScope.SOURCES]);

/** Accepts a scope, a list of scopes, or nothing (meaning: everything). */
function normaliseScopes(scope) {
    if (!scope) return [...ALL_SCOPES];
    const list = (Array.isArray(scope) ? scope : [scope])
        .filter(s => ALL_SCOPES.includes(s));
    return list.length > 0 ? list : [...ALL_SCOPES];
}

// Environment variables from Vite (.env)
const GITHUB_CLIENT_ID = import.meta.env?.VITE_GITHUB_CLIENT_ID || '';
const WORKER_URL = import.meta.env?.VITE_WORKER_URL || '';

let syncTimer = null;
let isSyncing = false;
/** Scopes waiting for the debounced push to fire. */
let pendingScopes = new Set();

/* ── Sync health ────────────────────────────────────────────────────────────
   Every scheduled push runs with `silent: true`, and that is right: it fires on
   each answered question and must not interrupt. What was wrong is that the
   *failure* was silent too - it went to console.error and nowhere else - while
   `lastSyncTime`, the one number the UI ever showed, moves only on success. A
   user whose token expired kept seeing a plausible "last sync" line for weeks
   while the second copy of their library had quietly stopped being written.

   The push stays silent. The state it leaves behind does not. */

/** Why the last sync attempt failed. */
export const SyncFailure = Object.freeze({
    /** 401/403: the token is revoked, expired, or lost its gist scope.
     *  Nothing retries its way out of this - the user has to reconnect. */
    AUTH: 'auth',
    /** Offline, DNS, 5xx, rate limit. Transient; the next push may well work. */
    NETWORK: 'network'
});

/* How many consecutive network failures the badge tolerates before it says
   anything. This app is offline-first: a push that fails on a train is normal,
   and a badge that lights up for it teaches the user to ignore the badge. An
   auth failure gets no such grace - it never fixes itself. */
const NETWORK_FAILURE_BADGE_THRESHOLD = 3;

/** Reads a response header without assuming a full Headers object (tests mock). */
function readHeader(res, name) {
    try {
        return res && res.headers && typeof res.headers.get === 'function'
            ? res.headers.get(name)
            : null;
    } catch {
        return null;
    }
}

/**
 * Turns a failed response into an Error that still knows its status, so the
 * catch block can tell "your token is dead" from "the network blipped".
 */
function httpError(res) {
    const err = new Error(`HTTP error ${res.status}`);
    err.status = res.status;
    /* 403 is also how GitHub answers a rate-limited client. Reading that as a
       dead token would tell the user to reconnect a token that is perfectly
       fine - and the reconnect would not help, because the limit is the limit. */
    err.rateLimited = res.status === 429
        || (res.status === 403 && readHeader(res, 'x-ratelimit-remaining') === '0')
        || (res.status === 403 && !!readHeader(res, 'retry-after'));
    return err;
}

function classifyFailure(err) {
    const status = err && err.status;
    if ((status === 401 || status === 403) && !err.rateLimited) return SyncFailure.AUTH;
    return SyncFailure.NETWORK;
}

/** The Gist was reached and written/read. Clears the failure streak. */
function recordSyncSuccess() {
    AppState.lastSyncTime = Date.now();
    AppState.syncFailureCount = 0;
    AppState.syncFailureKind = null;
    persist('focus_app_last_sync', AppState.lastSyncTime.toString());
    persistRemove('focus_app_sync_failures');
    persistRemove('focus_app_sync_failure_kind');
    emit(Slice.SYNC);
}

/** Note: `lastSyncTime` deliberately does not move here - it means last *success*. */
function recordSyncFailure(err) {
    AppState.syncFailureCount = (AppState.syncFailureCount || 0) + 1;
    AppState.syncFailureKind = classifyFailure(err);
    persist('focus_app_sync_failures', AppState.syncFailureCount.toString());
    persist('focus_app_sync_failure_kind', AppState.syncFailureKind);
    emit(Slice.SYNC);
}

/**
 * The one place that answers "is the backup actually working?".
 *
 * @returns {{failureCount: number, kind: string|null, lastSuccessAt: number,
 *            unhealthy: boolean}}
 */
export function getSyncHealth() {
    const failureCount = AppState.syncFailureCount || 0;
    const kind = failureCount > 0
        ? (AppState.syncFailureKind || SyncFailure.NETWORK)
        : null;
    return {
        failureCount,
        kind,
        lastSuccessAt: AppState.lastSyncTime || 0,
        unhealthy: kind === SyncFailure.AUTH
            || failureCount >= NETWORK_FAILURE_BADGE_THRESHOLD
    };
}

/**
 * Prepares the complete JSON payload of local data for backup/sync.
 *
 * This is the *logical* payload - one object holding every domain - and it stays
 * that way because it is also what mergeSyncData() compares against a remote
 * payload. splitSyncPayload() decides how it is laid out across Gist files.
 */
export function getSyncPayload() {
    return {
        /* 4: sources moved into their own file. A reader that finds this field
           still expects the old single-file layout to be readable, and
           readRemotePayload() keeps it so. */
        version: 4,
        // Names the file the sources were split into, so a reader can tell a
        // split payload from an old one that genuinely had no sources.
        sourcesFile: SOURCES_FILENAME,
        lastUpdated: Date.now(),
        // Timestamp of the most recent destructive reset on this device.
        // mergeSyncData() uses it to detect when local's intentionally-empty
        // state is newer than a stale remote payload and must not be overwritten.
        lastResetTimestamp: AppState.lastResetTimestamp || 0,
        // Timestamp of the most recent deliberate progress clear on this device.
        // mergeSyncData() uses it to prevent remote stats / activity / continuity
        // data from overwriting a deliberate progress reset.
        lastProgressResetTimestamp: AppState.lastProgressResetTimestamp || 0,
        // Offloaded archive entries are stubs here on purpose: their questions
        // live in ARCHIVE_FILENAME only.
        sources: (AppState.sources || []).map(s => (
            s.archived && s.offloaded ? { ...s, questions: [] } : s
        )),
        folders: AppState.folders || [],
        quickPresets: AppState.quickPresets || [],
        deletedSourceIds: AppState.deletedSourceIds || [],
        deletedFolderIds: AppState.deletedFolderIds || [],
        deletedQuickPresetIds: AppState.deletedQuickPresetIds || [],
        stats: AppState.stats || {},
        /* No totalStats. It was carried here for years without a single
           reader or writer outside this file - nothing in features/ ever
           touched it, and the manual backup export never included it - while
           its merge rule (remote wins outright, not even a max) meant a
           device's own totals could never reach the Gist. A payload from an
           older build may still carry the field; it is ignored on the way in.
           The real per-question counts live in `stats`. */
        recentTests: AppState.recentTests || [],
        studyActivity: AppState.studyActivity || {},
        continuityConfig: AppState.continuityConfig || {},
        /* The unfinished test, so the other device offers "Devam Et" instead of
           "Yeniden Başlat". It stays small on purpose: currentTest is a list of
           `sourceId_questionId` keys, not question bodies, so the receiving
           device rebuilds the session from its own copy of the library. */
        activeSession: readJSON('focus_app_active_test', null),
        deviceId: AppState.deviceId || null,
        settings: {
            language: AppState.language,
            translationTarget: AppState.translationTarget,
            translationEnabled: AppState.translationEnabled,
            ttsEnabled: AppState.ttsEnabled,
            ttsAutoplay: AppState.ttsAutoplay,
            ttsSpeed: AppState.ttsSpeed,
            customAIPrompt: AppState.customAIPrompt,
            timerStopwatchEnabled: AppState.timerStopwatchEnabled,
            timerCountdownEnabled: AppState.timerCountdownEnabled,
            timerCountdownLimit: AppState.timerCountdownLimit,
            timerAutoCheckEnabled: AppState.timerAutoCheckEnabled
        }
    };
}

/**
 * Lays the logical payload out across the Gist files that store it.
 *
 * @returns {{[filename: string]: object}} file name -> the object written there.
 */
export function splitSyncPayload(payload = getSyncPayload()) {
    const { sources, ...progress } = payload;
    return {
        [GIST_FILENAME]: progress,
        [SOURCES_FILENAME]: {
            version: payload.version,
            lastUpdated: payload.lastUpdated,
            sources: sources || []
        }
    };
}

/**
 * Serialises the files a push with these scopes has to send.
 *
 * Written without indentation. `null, 2` roughly doubles a payload whose bulk is
 * short values on their own lines - question stats and per-day activity are
 * exactly that shape - and every byte of it is uploaded again on the next save.
 * Reading is unaffected: JSON.parse ignores whitespace, so files written by
 * older builds keep working.
 */
function serialiseFiles(scopes, payload = getSyncPayload()) {
    const split = splitSyncPayload(payload);
    const files = {};
    if (scopes.includes(SyncScope.PROGRESS)) {
        files[GIST_FILENAME] = { content: JSON.stringify(split[GIST_FILENAME]) };
    }
    if (scopes.includes(SyncScope.SOURCES)) {
        files[SOURCES_FILENAME] = { content: JSON.stringify(split[SOURCES_FILENAME]) };
    }
    return files;
}

/** GETs the Gist. Throws on transport failure so callers do not merge nothing. */
async function fetchGist() {
    const res = await fetch(`${GITHUB_API_BASE}/gists/${AppState.githubGistId}`, {
        headers: {
            'Authorization': `Bearer ${AppState.githubToken}`,
            'Accept': 'application/vnd.github+json'
        }
    });
    if (!res.ok) throw httpError(res);
    return res.json();
}

/**
 * Reads one file out of a Gist response.
 *
 * The API inlines at most 1MB; a larger file comes back flagged with its content
 * omitted and has to be read from raw_url. Every file in this Gist can cross
 * that line, so the fallback belongs here rather than at one call site.
 *
 * @returns {Promise<string|null>} null when the file does not exist.
 */
async function readGistFile(gist, filename) {
    const file = gist.files && gist.files[filename];
    if (!file) return null;

    let content = file.content;
    if (file.truncated || content === undefined || content === null) {
        if (!file.raw_url) throw new Error(`${filename} truncated without raw_url`);
        const rawRes = await fetch(file.raw_url);
        if (!rawRes.ok) throw httpError(rawRes);
        content = await rawRes.text();
    }
    return content;
}

/** Reads and parses one file. null when absent or empty. */
async function readGistJSON(gist, filename) {
    const content = await readGistFile(gist, filename);
    if (content === null || !content.trim()) return null;
    return JSON.parse(content);
}

/**
 * Reassembles the logical payload from the files it is spread across, so
 * everything downstream - above all mergeSyncData() - keeps seeing one object.
 *
 * @returns {Promise<object|null>} null when the Gist holds no backup file.
 */
export async function readRemotePayload(gist) {
    const progress = await readGistJSON(gist, GIST_FILENAME);
    if (!progress) return null;

    const payload = { ...progress };
    const inline = Array.isArray(progress.sources) ? progress.sources : [];
    const sourcesFile = await readGistJSON(gist, SOURCES_FILENAME);
    const split = sourcesFile && Array.isArray(sourcesFile.sources) ? sourcesFile.sources : null;

    if (!split) {
        // Old single-file layout, or a Gist this build has never pushed to.
        payload.sources = inline;
        return payload;
    }

    /* A device still running an older build writes the whole payload, sources
       included, into the backup file - and does so without touching the sources
       file. Whichever copy was written last is the live one. The next push from
       this build rewrites the backup file without a sources key, which clears
       the duplicate. */
    const inlineAt = progress.lastUpdated || 0;
    const splitAt = sourcesFile.lastUpdated || 0;
    payload.sources = (inline.length > 0 && inlineAt > splitAt) ? inline : split;
    // The freshness of the remote side as a whole, which the reset guards in
    // mergeSyncData() compare local timestamps against.
    payload.lastUpdated = Math.max(inlineAt, splitAt);
    return payload;
}

/**
 * Initializes the GitHub sync state on app startup and handles OAuth redirect callbacks.
 */
export async function initSync() {
    /* The token, gist id, gist url, user and last-sync time used to be read out
       of localStorage again right here. initState() already loads every one of
       them, so this was a second reader of the same five keys - and a second
       place to keep in step, with its own JSON.parse that would have thrown on a
       corrupted user record. Boot order guarantees initState() has run
       (main.js initApp, first statement); AppState is the only source now. */
    setupSyncDOMListeners();

    // Check if coming back from GitHub OAuth redirect (?code=...)
    const hasCallback = await handleOAuthCallback();

    updateSyncUI();

    // If logged in and no fresh OAuth callback happened, perform automatic sync
    if (!hasCallback && AppState.githubToken && AppState.githubGistId) {
        try {
            await syncFromGist({ silent: true });
        } catch (err) {
            console.warn('Initial GitHub sync failed:', err);
        }
    }
}

/**
 * Initiates the standard GitHub OAuth 2.0 Login redirect.
 */
export function loginWithOAuth() {
    if (!GITHUB_CLIENT_ID) {
        // Fallback: If CLIENT_ID is not configured in .env, prompt user to use PAT or configure env
        showToast(t('github_env_missing'));
        togglePatManualSection(true);
        return;
    }

    const state = crypto.randomUUID();
    sessionStorage.setItem('github_oauth_state', state);

    // Omit explicit redirect_uri so GitHub defaults to the registered callback URL in OAuth App settings
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(GITHUB_CLIENT_ID)}&scope=gist&state=${encodeURIComponent(state)}`;

    window.location.href = authUrl;
}

/**
 * Handles the OAuth redirect URL parameters (?code=XYZ).
 */
async function handleOAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');

    if (!code) return false;

    // Clean URL parameters immediately
    window.history.replaceState({}, document.title, window.location.pathname);

    // Verify CSRF state token
    const savedState = sessionStorage.getItem('github_oauth_state');
    sessionStorage.removeItem('github_oauth_state');

    if (!savedState || !state || state !== savedState) {
        showAlert(t('github_sync_error') + ': Invalid OAuth state', t('error_title'));
        return false;
    }

    setSyncingState(true);
    showToast(t('github_syncing'));

    try {
        if (!WORKER_URL) {
            throw new Error('Cloudflare Worker URL (VITE_WORKER_URL) is not configured in .env');
        }

        // Exchange code for token via Cloudflare Worker
        const res = await fetch(WORKER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code })
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        if (data.error || !data.access_token) {
            throw new Error(data.error_description || data.error || t('github_invalid_token'));
        }

        const token = data.access_token;

        // Verify token & complete login flow
        await completeLoginWithToken(token);
        return true;
    } catch (err) {
        console.error('OAuth callback failed:', err);
        showAlert(t('github_sync_error') + ': ' + err.message, t('error_title'));
        return false;
    } finally {
        setSyncingState(false);
    }
}

/**
 * Connects directly with a Personal Access Token (PAT) as a secondary/manual option.
 */
export async function loginWithToken(token) {
    if (!token || !token.trim()) {
        showAlert(t('github_invalid_token'), t('error_title'));
        return false;
    }

    const cleanToken = token.trim();
    setSyncingState(true);

    try {
        await completeLoginWithToken(cleanToken);
        closeLoginModal();
        return true;
    } catch (err) {
        console.error('GitHub token login error:', err);
        showAlert(err.message || t('github_sync_error'), t('error_title'));
        return false;
    } finally {
        setSyncingState(false);
    }
}

/**
 * Helper to fetch user details, setup Gist, and initialize sync.
 */
async function completeLoginWithToken(rawToken) {
    const token = (rawToken || '').replace(/[\x00-\x1F\x7F-\x9F\s]/g, '');
    if (!token) throw new Error(t('github_invalid_token'));

    // 1. Fetch user profile
    const userRes = await fetch(`${GITHUB_API_BASE}/user`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json'
        }
    });

    if (!userRes.ok) {
        throw new Error(t('github_invalid_token'));
    }

    const userData = await userRes.json();
    const userObj = {
        login: userData.login,
        name: userData.name || userData.login,
        avatar_url: userData.avatar_url
    };

    // Check if switching from a different previously logged-in GitHub account
    // initState() loads this key into lastGithubUser; re-reading it here only
    // gave two ways to be wrong about the same thing.
    const previousUser = AppState.lastGithubUser;
    let shouldReplaceLocalData = false;

    if (previousUser && previousUser.toLowerCase() !== userObj.login.toLowerCase()) {
        const choice = await showAccountSwitchModal(previousUser, userObj.login);
        if (choice === 'replace') {
            shouldReplaceLocalData = true;
        }
    }

    if (shouldReplaceLocalData) {
        clearLocalStudyData();
    }

    // 2. Find or create Gist
    const gistId = await findOrCreateGist(token);

    // 3. Save auth details to AppState & localStorage
    AppState.githubToken = token;
    AppState.githubGistId = gistId;
    AppState.githubUser = userObj;
    AppState.lastGithubUser = userObj.login;

    persist('focus_app_github_token', token);
    persist('focus_app_github_gist_id', gistId);
    persist('focus_app_github_user', userObj);
    persist('focus_app_last_github_user', userObj.login);
    emit(Slice.SYNC);

    // 4. Perform initial sync
    if (shouldReplaceLocalData) {
        await pullRemoteGistOnly();
    } else {
        await syncFromGist({ silent: false });
    }

    updateSyncUI();
    closeLoginModal();
    showToast(t('github_connected_as', { user: userObj.login }));
}

/**
 * Signs out from GitHub sync with optional local data wipe prompt.
 */
export async function logout() {
    const clearData = await showLogoutDataClearPrompt();
    if (clearData) {
        clearLocalStudyData();
        import('../features/test/test-engine.js').then(m => {
            if (typeof m.buildQuestionPool === 'function') m.buildQuestionPool();
        }).catch(() => {});
        // A merge can touch every domain at once; the store works out which
        // renderers that implicates and coalesces them into one repaint.
        emit(
            Slice.SOURCES, Slice.FOLDERS, Slice.STATS, Slice.ACTIVITY,
            Slice.CONTINUITY, Slice.RECENT_TESTS, Slice.PRESETS
        );
    }

    AppState.githubToken = null;
    AppState.githubGistId = null;
    AppState.githubGistUrl = null;
    AppState.githubUser = null;
    AppState.lastSyncTime = 0;
    // A health streak belongs to a connection. Leaving it behind would greet the
    // next login with a warning about a token that is no longer even in use.
    AppState.syncFailureCount = 0;
    AppState.syncFailureKind = null;

    persistRemove('focus_app_github_token');
    persistRemove('focus_app_github_gist_id');
    persistRemove('focus_app_github_gist_url');
    persistRemove('focus_app_github_user');
    persistRemove('focus_app_last_sync');
    persistRemove('focus_app_sync_failures');
    persistRemove('focus_app_sync_failure_kind');
    emit(Slice.SYNC);

    updateSyncUI();
    closeSyncDropdown();
    showToast(t('github_logout'));
}

/**
 * Fetches remote Gist data and overwrites local state cleanly without merging
 * previous account data back to Gist. Reads through AppState, which the caller
 * has already pointed at the new account.
 */
async function pullRemoteGistOnly() {
    try {
        const gist = await fetchGist();
        const remotePayload = await readRemotePayload(gist);

        if (remotePayload) {
            if (Array.isArray(remotePayload.sources)) {
                AppState.sources = remotePayload.sources;
                import('../features/sources/sources-service.js').then(m => {
                    if (typeof m.normalizeQuestions === 'function') {
                        AppState.sources.forEach(s => {
                            if (s.questions && Array.isArray(s.questions)) {
                                s.questions = m.normalizeQuestions(s.questions);
                            }
                        });
                    }
                }).catch(() => {});
                saveSources();
            }

            if (Array.isArray(remotePayload.folders)) {
                AppState.folders = remotePayload.folders;
                migrateFolderColors({ force: true });
                saveFolders();
            }

            if (Array.isArray(remotePayload.deletedSourceIds)) {
                AppState.deletedSourceIds = remotePayload.deletedSourceIds;
                persist('focus_app_deleted_sources', remotePayload.deletedSourceIds);
            }

            if (Array.isArray(remotePayload.deletedFolderIds)) {
                AppState.deletedFolderIds = remotePayload.deletedFolderIds;
                persist('focus_app_deleted_folders', remotePayload.deletedFolderIds);
            }

            if (remotePayload.stats && typeof remotePayload.stats === 'object') {
                AppState.stats = remotePayload.stats;
                saveStats();
            }

            if (Array.isArray(remotePayload.recentTests)) {
                AppState.recentTests = remotePayload.recentTests.slice(0, 10);
                saveRecentTests();
            }

            if (remotePayload.studyActivity && typeof remotePayload.studyActivity === 'object') {
                const cleaned = {};
                Object.keys(remotePayload.studyActivity).forEach(dateKey => {
                    cleaned[dateKey] = sanitizeActivityRecord(remotePayload.studyActivity[dateKey]);
                });
                AppState.studyActivity = cleaned;
                saveStudyActivity();
            }

            if (remotePayload.continuityConfig && typeof remotePayload.continuityConfig === 'object') {
                AppState.continuityConfig = remotePayload.continuityConfig;
                // Remote's stamps, adopted as they are - see syncFromGist().
                saveContinuityConfig({ stamp: false });
            }

            recordSyncSuccess();

            import('../features/test/test-engine.js').then(m => {
                if (typeof m.buildQuestionPool === 'function') m.buildQuestionPool();
            }).catch(() => {});

            // A merge can touch every domain at once; the store works out which
            // renderers that implicates and coalesces them into one repaint.
            emit(
                Slice.SOURCES, Slice.FOLDERS, Slice.STATS, Slice.ACTIVITY,
                Slice.CONTINUITY, Slice.RECENT_TESTS, Slice.PRESETS
            );
        }
    } catch (err) {
        console.error('pullRemoteGistOnly error:', err);
        recordSyncFailure(err);
        updateSyncUI();
    }
}

/**
 * Custom Modal prompt when switching GitHub accounts.
 */
function showAccountSwitchModal(oldUser, newUser) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('customModalOverlay');
        const titleEl = document.getElementById('modalTitle');
        const headerEl = document.getElementById('modalHeader');
        const messageEl = document.getElementById('modalMessage');
        const confirmBtn = document.getElementById('modalConfirmBtn');
        const cancelBtn = document.getElementById('modalCancelBtn');

        const title = t('github_account_switch_title');
        const message = t('github_account_switch_msg', { oldUser, newUser });

        if (!overlay || !messageEl || !confirmBtn || !cancelBtn) {
            const replace = window.confirm(`${title}\n\n${message}`);
            resolve(replace ? 'replace' : 'merge');
            return;
        }

        const origConfirmText = confirmBtn.innerText;
        const origCancelText = cancelBtn.innerText;

        messageEl.innerText = message;
        titleEl.innerText = title;
        headerEl.style.display = 'block';

        confirmBtn.innerText = t('github_switch_replace_btn');
        cancelBtn.innerText = t('github_switch_merge_btn');
        cancelBtn.style.display = 'inline-flex';

        overlay.classList.add('active');

        const handleReplace = () => {
            cleanup();
            resolve('replace');
        };

        const handleMerge = () => {
            cleanup();
            resolve('merge');
        };

        const cleanup = () => {
            confirmBtn.removeEventListener('click', handleReplace);
            cancelBtn.removeEventListener('click', handleMerge);
            confirmBtn.innerText = origConfirmText;
            cancelBtn.innerText = origCancelText;
            overlay.classList.remove('active');
        };

        confirmBtn.addEventListener('click', handleReplace);
        cancelBtn.addEventListener('click', handleMerge);
    });
}

/**
 * Custom Modal prompt on logout asking whether to clear local study data.
 */
function showLogoutDataClearPrompt() {
    return new Promise((resolve) => {
        const overlay = document.getElementById('customModalOverlay');
        const titleEl = document.getElementById('modalTitle');
        const headerEl = document.getElementById('modalHeader');
        const messageEl = document.getElementById('modalMessage');
        const confirmBtn = document.getElementById('modalConfirmBtn');
        const cancelBtn = document.getElementById('modalCancelBtn');

        if (!overlay || !messageEl || !confirmBtn || !cancelBtn) {
            resolve(window.confirm(t('github_logout_clear_prompt')));
            return;
        }

        const origConfirmText = confirmBtn.innerText;
        const origCancelText = cancelBtn.innerText;

        messageEl.innerText = t('github_logout_clear_prompt');
        titleEl.innerText = t('github_logout_clear_title');
        headerEl.style.display = 'block';

        confirmBtn.innerText = t('github_logout_clear');
        cancelBtn.innerText = t('github_logout_keep');
        cancelBtn.style.display = 'inline-flex';

        overlay.classList.add('active');

        const handleClear = () => {
            cleanup();
            resolve(true);
        };

        const handleKeep = () => {
            cleanup();
            resolve(false);
        };

        const cleanup = () => {
            confirmBtn.removeEventListener('click', handleClear);
            cancelBtn.removeEventListener('click', handleKeep);
            confirmBtn.innerText = origConfirmText;
            cancelBtn.innerText = origCancelText;
            overlay.classList.remove('active');
        };

        confirmBtn.addEventListener('click', handleClear);
        cancelBtn.addEventListener('click', handleKeep);
    });
}

/**
 * Searches user's Gists for `exam_app_backup.json`. Creates a new secret Gist if missing.
 */
async function findOrCreateGist(token) {
    const res = await fetch(`${GITHUB_API_BASE}/gists?per_page=100`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json'
        }
    });

    if (!res.ok) {
        throw new Error('Failed to fetch Gists from GitHub');
    }

    const gists = await res.json();
    const existing = gists.find(g => g.files && g.files[GIST_FILENAME]);

    if (existing) {
        rememberGistUrl(existing.html_url);
        return existing.id;
    }

    // Create a new secret Gist with initial payload
    const createRes = await fetch(`${GITHUB_API_BASE}/gists`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github+json'
        },
        body: JSON.stringify({
            description: GIST_DESCRIPTION,
            public: false,
            // Both files from the start, so a Gist created by this build is
            // never in the old single-file shape.
            files: serialiseFiles(ALL_SCOPES)
        })
    });

    if (!createRes.ok) {
        throw new Error('Failed to create Gist on GitHub. Make sure your token/OAuth scope has "Gist" permission.');
    }

    const newGist = await createRes.json();
    rememberGistUrl(newGist.html_url);
    return newGist.id;
}

/**
 * Stores the Gist's web URL so the archive screen can offer "open on GitHub".
 */
function rememberGistUrl(url) {
    if (!url) return;
    AppState.githubGistUrl = url;
    persist('focus_app_github_gist_url', url);
    emit(Slice.SYNC);
}

/**
 * The payload to write: local state with whatever is already on the remote
 * folded into it.
 *
 * A push used to serialise local state and PATCH it straight over the file.
 * That is only safe if this device has seen everything the remote holds, and it
 * has not: a pull happens at boot and on an explicit sync, while a push happens
 * on every answered question. A device left open all day therefore wrote its own
 * increasingly stale view over the other device's work, again and again. The
 * daily activity map is where that showed: the global counters survived because
 * whichever device wrote last usually had the larger numbers, but the focus
 * track - written only when a session is flushed or finished - was routinely
 * erased, so the two devices disagreed about Odak Seri indefinitely.
 *
 * Merging here rather than mutating AppState keeps the push a pure write: the
 * remote ends up holding the union, and the local side picks it up on its next
 * pull through the path that already knows how to apply a merge. Doing it the
 * other way round would have every push run the pull's apply-and-save cascade,
 * which re-enters scheduleSync().
 *
 * Throws when the remote cannot be read or parsed. That is deliberate: the
 * caller's catch records a sync failure, which is the same thing a failed write
 * would have done, and it means an unreadable remote blocks the write instead of
 * being overwritten by it.
 */
async function payloadMergedWithRemote() {
    const local = getSyncPayload();
    const remote = await readRemotePayload(await fetchGist());
    if (!remote) return local; // nothing up there yet

    const { hasLocalChanges, ...merged } = mergeSyncData(local, remote);
    /* mergeSyncData covers the shared domains only; version, timestamps and
       settings stay as this device reports them. */
    return { ...local, ...merged };
}

/**
 * Pushes local data to GitHub Gist, merged with what the remote already holds.
 *
 * @param {{silent?: boolean, scopes?: string|string[], skipRemoteMerge?: boolean}} [options]
 *        `scopes` limits the push to the files that actually changed; omitted
 *        means every file, which is what a merge or a reset needs.
 *        `skipRemoteMerge` is for the push that syncFromGist() makes right after
 *        it has applied a merge - re-reading the same Gist would only cost a
 *        request to reach the same answer.
 */
export async function syncToGist(options = {}) {
    if (!AppState.githubToken || !AppState.githubGistId) return false;

    const scopes = normaliseScopes(options.scopes);

    if (isSyncing) {
        /* A push that arrives mid-flight used to be dropped outright. With a
           scoped payload the dropped push may have been the only one carrying
           its file, so re-queue rather than lose it. */
        scopes.forEach(s => pendingScopes.add(s));
        armSyncTimer(1500);
        return false;
    }

    setSyncingState(true);
    try {
        const payload = options.skipRemoteMerge
            ? getSyncPayload()
            : await payloadMergedWithRemote();

        const res = await fetch(`${GITHUB_API_BASE}/gists/${AppState.githubGistId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${AppState.githubToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github+json'
            },
            body: JSON.stringify({
                description: GIST_DESCRIPTION,
                // Only the named files are touched; the ones left out keep the
                // content they already have.
                files: serialiseFiles(scopes, payload)
            })
        });

        if (!res.ok) {
            throw httpError(res);
        }

        recordSyncSuccess();
        updateSyncUI();

        if (!options.silent) {
            showToast(t('github_sync_success'));
        }
        return true;
    } catch (err) {
        console.error('syncToGist failed:', err);
        recordSyncFailure(err);
        updateSyncUI();
        if (!options.silent) {
            showToast(t('github_sync_error'));
        }
        return false;
    } finally {
        setSyncingState(false);
    }
}

/**
 * Pulls remote data from GitHub Gist and merges with local data.
 */
export async function syncFromGist(options = {}) {
    if (!AppState.githubToken || !AppState.githubGistId || isSyncing) return;

    /* Every pull counts against the foreground-pull interval, whoever asked for
       it. The boot pull and the sync button are pulls too, and a second read of
       the same Gist seconds later would answer the same thing. */
    lastPullAt = Date.now();

    setSyncingState(true);
    try {
        const gist = await fetchGist();
        const remotePayload = await readRemotePayload(gist);

        if (remotePayload) {
            const localPayload = getSyncPayload();

            const merged = mergeSyncData(localPayload, remotePayload);

            // Apply merged sources
            if (Array.isArray(merged.sources)) {
                AppState.sources = merged.sources;
                // Normalize questions in all sources to ensure correctOptionIds & difficulty exist
                import('../features/sources/sources-service.js').then(m => {
                    if (typeof m.normalizeQuestions === 'function') {
                        AppState.sources.forEach(s => {
                            if (s.questions && Array.isArray(s.questions)) {
                                s.questions = m.normalizeQuestions(s.questions);
                            }
                        });
                    }
                }).catch(() => {});
                saveSources();
            }

            // Apply merged folders. Remapped every time, not once: a device still
            // running the old palette can push retired colours back up at any point.
            if (Array.isArray(merged.folders)) {
                AppState.folders = merged.folders;
                migrateFolderColors({ force: true });
                saveFolders();
            }

            // Apply merged deleted source IDs (Tombstones)
            if (Array.isArray(merged.deletedSourceIds)) {
                AppState.deletedSourceIds = merged.deletedSourceIds;
                persist('focus_app_deleted_sources', merged.deletedSourceIds);
            }

            if (Array.isArray(merged.deletedFolderIds)) {
                AppState.deletedFolderIds = merged.deletedFolderIds;
                persist('focus_app_deleted_folders', merged.deletedFolderIds);
            }

            if (Array.isArray(merged.quickPresets)) {
                AppState.quickPresets = merged.quickPresets;
                saveQuickPresets();
            }

            if (Array.isArray(merged.deletedQuickPresetIds)) {
                AppState.deletedQuickPresetIds = merged.deletedQuickPresetIds;
                persist('focus_app_deleted_quick_presets', merged.deletedQuickPresetIds);
            }

            // Apply merged stats
            if (merged.stats && typeof merged.stats === 'object') {
                AppState.stats = merged.stats;
                saveStats();
            }

            // Apply merged recent tests
            if (Array.isArray(merged.recentTests)) {
                AppState.recentTests = merged.recentTests.slice(0, 10);
                saveRecentTests();
            }

            // Apply merged study activity
            if (merged.studyActivity && typeof merged.studyActivity === 'object') {
                AppState.studyActivity = merged.studyActivity;
                saveStudyActivity();
            }

            if (merged.continuityConfig && typeof merged.continuityConfig === 'object') {
                AppState.continuityConfig = merged.continuityConfig;
                /* The merge result already carries the stamps each key won
                   with. Stamping again here would date every pulled key to
                   now, so this device would out-rank the device the value
                   actually came from and push it straight back. */
                saveContinuityConfig({ stamp: false });
            }

            /* The unfinished test. Written straight to storage rather than into
               AppState because that is where checkActiveTest() and
               resumeActiveTest() read it from - the resume button needs no
               further wiring. pickActiveSession() has already refused to replace
               a session this device is in, so this cannot land under the user
               mid-test. */
            if (merged.activeSession && typeof merged.activeSession === 'object') {
                persist('focus_app_active_test', merged.activeSession);
                emit(Slice.ACTIVE_TEST);
            }

            // Persist the most recent reset timestamps observed during this merge.
            // This keeps all devices aware of the latest reset even if they were
            // offline when it happened.
            if (typeof merged.lastResetTimestamp === 'number'
                    && merged.lastResetTimestamp > (AppState.lastResetTimestamp || 0)) {
                AppState.lastResetTimestamp = merged.lastResetTimestamp;
                persist('focus_app_last_reset', merged.lastResetTimestamp.toString());
            }
            if (typeof merged.lastProgressResetTimestamp === 'number'
                    && merged.lastProgressResetTimestamp > (AppState.lastProgressResetTimestamp || 0)) {
                AppState.lastProgressResetTimestamp = merged.lastProgressResetTimestamp;
                persist('focus_app_last_progress_reset', merged.lastProgressResetTimestamp.toString());
            }

            // Push merged state back to Gist if local had newer changes
            const failuresBefore = AppState.syncFailureCount || 0;
            if (merged.hasLocalChanges) {
                await syncToGist({ silent: true, skipRemoteMerge: true });
            }

            /* The pull reached the Gist, so this round trip counts as healthy -
               unless the push nested in it failed. That push has already
               recorded its own failure, and letting the pull's success clear it
               would hide exactly the case this whole mechanism exists for. */
            if ((AppState.syncFailureCount || 0) <= failuresBefore) {
                recordSyncSuccess();
            }

            // Rebuild question pool and questionMap for Test Engine & UI
            import('../features/test/test-engine.js').then(m => {
                if (typeof m.buildQuestionPool === 'function') m.buildQuestionPool();
            }).catch(() => {});

            // A merge can touch every domain at once; the store works out which
            // renderers that implicates and coalesces them into one repaint.
            emit(
                Slice.SOURCES, Slice.FOLDERS, Slice.STATS, Slice.ACTIVITY,
                Slice.CONTINUITY, Slice.RECENT_TESTS, Slice.PRESETS
            );

            updateSyncUI();

            if (!options.silent) {
                showToast(t('github_sync_success'));
            }
        }
    } catch (err) {
        console.error('syncFromGist failed:', err);
        recordSyncFailure(err);
        updateSyncUI();
        if (!options.silent) {
            showToast(t('github_sync_error'));
        }
    } finally {
        setSyncingState(false);
    }
}

/* ── Foreground pull ────────────────────────────────────────────────────────
   A push fires on every answered question. A pull fired at boot and on the sync
   button, and nowhere else - so three devices left open each kept their own view
   of the day for as long as they stayed open. The Gist held the union the whole
   time and none of them read it back, and because the streak, the ring and the
   token count are all derived from local studyActivity, one body of work showed
   up as three different numbers.

   Coming back to the app is the moment worth spending a request on: it is when
   the user is about to look at those numbers, and it is when the other device
   has most likely just finished writing. */

/** Shortest gap between two pulls. Long enough that alt-tabbing in and out of
 *  the browser costs nothing, short enough to feel immediate on the switch that
 *  actually matters - picking the phone up after working on the laptop. */
const PULL_MIN_INTERVAL_MS = 30 * 1000;

/** When the last pull of any kind started. */
let lastPullAt = 0;

/**
 * Pulls when the app returns to the foreground, at most once per
 * PULL_MIN_INTERVAL_MS.
 *
 * Silent, because it is not something the user asked for: a toast on every
 * alt-tab would be noise, and a failure still lands in the health counter that
 * the badge reads.
 *
 * Held back while a test session is live. A pull replaces AppState.stats and
 * rebuilds the question pool, and doing that under someone who is mid-question
 * is worse than showing them a stale streak for another minute. Nothing is lost
 * by waiting: leaving the session flushes it, and pickActiveSession() would have
 * protected the session record itself either way.
 */
function pullOnForeground() {
    if (!AppState.githubToken || !AppState.githubGistId) return;
    if (isSyncing) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    /* The same two views switchView() declines to flush on, and for the same
       reason: on both of them the session is still live and the user is coming
       back to it. Naming only 'test' here would let a pull land the moment they
       glanced at the stats preview mid-test. */
    if (LIVE_SESSION_VIEWS.has(getActiveView())) return;
    if (Date.now() - lastPullAt < PULL_MIN_INTERVAL_MS) return;

    syncFromGist({ silent: true });
}

/** Views the user reaches without ending the test they are in. */
const LIVE_SESSION_VIEWS = new Set(['test', 'statsPreview']);

/**
 * How recently an unfinished test has to have been written for this device to
 * count as still sitting in it. saveActiveTest() fires on every answer and every
 * navigation, so a session being worked on is never quiet for this long.
 */
const LIVE_SESSION_MS = 5 * 60 * 1000;

/**
 * Chooses between two devices' unfinished tests.
 *
 * Newest wins, with one exception that matters more than the timestamps: a
 * session this device is *currently in* is never replaced. Without that, a pull
 * landing mid-test - the boot sync of a second tab, an explicit sync tap - could
 * swap the questions under the user at the moment they answer one.
 *
 * A finished test leaves a cleared record rather than no record, so "I finished
 * mine" is a dated fact the same rule can weigh against the other device's copy.
 * That is what stops a completed test from being resurrected by a stale peer.
 *
 * @returns {{session: object|null, localWins: boolean}}
 */
function pickActiveSession(local, remote, now = Date.now()) {
    const lSession = local.activeSession || null;
    const rSession = remote.activeSession || null;

    if (!lSession && !rSession) return { session: null, localWins: false };
    if (!rSession) return { session: lSession, localWins: true };
    if (!lSession) return { session: rSession, localWins: false };

    const isLive = lSession.deviceId
        && lSession.deviceId === local.deviceId
        && Array.isArray(lSession.currentTest) && lSession.currentTest.length > 0
        && now - (lSession.updatedAt || 0) < LIVE_SESSION_MS;
    if (isLive) return { session: lSession, localWins: true };

    /* Records from builds before this carry no timestamp. Treating them as
       oldest keeps a dated record authoritative, which is the safer direction:
       the undated one is at best the same session seen earlier. */
    const localWins = (lSession.updatedAt || 0) > (rSession.updatedAt || 0);
    return { session: localWins ? lSession : rSession, localWins };
}

/* ── Continuity config ──────────────────────────────────────────────────────
   This used to merge as one blob under "remote wins whenever it has anything",
   and that rule could not carry a change off the device that made it. The push
   path merges before it writes, so it folded remote's blob back over the very
   change it was pushing; the next pull then reverted the change locally too.
   Picking a focus source, earning a freeze token, spending one - each of them
   died where it happened, and the three devices kept recomputing streaks from
   three configs that never converged.

   Now every top-level key is its own record with its own stamp and the newest
   stamp wins. The keys are read off the objects rather than listed here on
   purpose: a field added later merges correctly without anyone having to
   remember to register it. */

/** Stamp for one key. Missing means a record written before stamps existed. */
function revisionOfKey(config, key) {
    const rev = config && config.revisions && config.revisions[key];
    return rev && Number.isFinite(rev.at) ? rev : { at: 0, by: null };
}

function isEmptyValue(value) {
    if (value === null || value === undefined) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
}

/**
 * Merges two configs key by key, newest stamp winning.
 *
 * @returns {{config: object, localWins: boolean}} `localWins` is true when at
 *          least one key was taken from local *and* differs from what the remote
 *          holds - which is what tells the pull it has something to push back.
 */
function mergeContinuityConfig(localConfig, remoteConfig) {
    const local = localConfig && typeof localConfig === 'object' ? localConfig : {};
    const remote = remoteConfig && typeof remoteConfig === 'object' ? remoteConfig : {};

    const keys = new Set([...Object.keys(local), ...Object.keys(remote)].filter(k => k !== 'revisions'));
    const config = {};
    const revisions = {};
    let localWins = false;

    keys.forEach(key => {
        const lRev = revisionOfKey(local, key);
        const rRev = revisionOfKey(remote, key);

        let takeLocal;
        if (lRev.at !== rRev.at) {
            takeLocal = lRev.at > rRev.at;
        } else if (lRev.at === 0) {
            /* Neither side has ever stamped this key: both are pre-upgrade
               records, or one side simply has no opinion. Content decides.
               A real value beats an empty one; between two empty ones, a key
               that exists beats one that does not, so `[]` is never replaced by
               `undefined` and the config keeps its shape. A genuine tie goes to
               the remote, which is what this merge did for every key before
               stamps existed. The first stamped write settles it for good. */
            const localEmpty = isEmptyValue(local[key]);
            const remoteEmpty = isEmptyValue(remote[key]);
            takeLocal = localEmpty !== remoteEmpty
                ? !localEmpty
                : local[key] !== undefined && remote[key] === undefined;
        } else {
            /* Same instant on two devices. Any rule works as long as both
               devices reach the same one, so order on the writer's id: a
               coin-flip that lands the same way everywhere. */
            takeLocal = String(lRev.by || '') > String(rRev.by || '');
        }

        config[key] = takeLocal ? local[key] : remote[key];
        const winning = takeLocal ? lRev : rRev;
        if (winning.at > 0) revisions[key] = winning;

        if (takeLocal && JSON.stringify(local[key] ?? null) !== JSON.stringify(remote[key] ?? null)) {
            localWins = true;
        }
    });

    config.revisions = revisions;
    return { config, localWins };
}

/**
 * Daily snapshots are taken once per day and then frozen, so `null` means "not
 * measured yet" while `0` is a real answer. A real number always beats null.
 */
function pickSnapshot(a, b) {
    const aNum = Number.isFinite(a) ? a : null;
    const bNum = Number.isFinite(b) ? b : null;
    if (aNum === null) return bNum;
    if (bNum === null) return aNum;
    return Math.max(aNum, bNum);
}

/**
 * `lastReview` is an ISO date string. Math.max() on two strings returns NaN,
 * which wiped the review date of every question that existed on both sides -
 * and a NaN date makes calculateRetrievability() return NaN, so FSRS stopped
 * seeing anything as due. Compare as timestamps, keep the original value.
 */
function pickLastReview(a, b) {
    const aTime = a ? new Date(a).getTime() : 0;
    const bTime = b ? new Date(b).getTime() : 0;
    const aValid = Number.isFinite(aTime) && aTime > 0;
    const bValid = Number.isFinite(bTime) && bTime > 0;
    if (!aValid) return bValid ? b : undefined;
    if (!bValid) return a;
    return aTime >= bTime ? a : b;
}

/**
 * Intelligent merger for two AppState sync payloads (local vs remote).
 */
export function mergeSyncData(local, remote) {
    let hasLocalChanges = false;

    // ── Reset-timestamp guard ──────────────────────────────────────────────────
    // A destructive reset on one device must not be undone by stale data that
    // arrives from the Gist or another device later. The tombstone lists that
    // clearLocalStudyData / clearSourcesData now populate are the primary
    // defence; lastResetTimestamp provides an additional signal:
    //   - If local reset happened AFTER the remote payload was last written,
    //     flag hasLocalChanges so the clean local state gets pushed immediately.
    //   - The source / folder / preset merge sections below also consult this
    //     flag to skip importing remote items that predate the local reset.
    const localResetAt      = local.lastResetTimestamp  || 0;
    const remoteResetAt     = remote.lastResetTimestamp || 0;
    const remoteLastUpdated = remote.lastUpdated || 0;

    // True when local performed a reset more recently than the remote payload
    // was written — local's intentionally-clean state is the authority.
    const localResetIsNewer = localResetAt > 0 && localResetAt > remoteLastUpdated;
    // ────────────────────────────────────────────────────────────────────────

    // 0. Combine Tombstone Deletion Trackers
    const mergedDeletedIds = Array.from(new Set([
        ...(remote.deletedSourceIds || []),
        ...(local.deletedSourceIds || []),
        ...(AppState.deletedSourceIds || [])
    ]));

    // 0b. Combine Folder Tombstones
    const mergedDeletedFolderIds = Array.from(new Set([
        ...(remote.deletedFolderIds || []),
        ...(local.deletedFolderIds || []),
        ...(AppState.deletedFolderIds || [])
    ]));

    // 0c. Combine Quick Preset Tombstones
    const mergedDeletedQuickPresetIds = Array.from(new Set([
        ...(remote.deletedQuickPresetIds || []),
        ...(local.deletedQuickPresetIds || []),
        ...(AppState.deletedQuickPresetIds || [])
    ]));

    // If the merged tombstone sets are larger than what local already knew about,
    // local needs to push the updated state back to the Gist.
    if (
        mergedDeletedIds.length          > (local.deletedSourceIds       || []).length ||
        mergedDeletedFolderIds.length    > (local.deletedFolderIds        || []).length ||
        mergedDeletedQuickPresetIds.length > (local.deletedQuickPresetIds || []).length
    ) {
        hasLocalChanges = true;
    }

    // If local reset is newer than the remote payload, flag a push immediately
    // so the clean state is not silently replaced on the next sync cycle.
    if (localResetIsNewer) {
        hasLocalChanges = true;
    }

    const revisionOf = (r) => r.updatedAt || r.lastUsed || 0;

    // 1. Merge Sources (by ID, respecting Tombstones and Reset Guard)
    const sourcesMap = new Map();

    // Remote sources are skipped entirely when local has a newer reset,
    // because those remote items were part of what the reset cleared.
    if (!localResetIsNewer) {
        (remote.sources || []).forEach(s => {
            if (s && s.id && !mergedDeletedIds.includes(s.id)) {
                sourcesMap.set(s.id, s);
            }
        });
    }

    (local.sources || []).forEach(s => {
        if (!s || !s.id || mergedDeletedIds.includes(s.id)) return;
        if (!sourcesMap.has(s.id)) {
            sourcesMap.set(s.id, s);
            hasLocalChanges = true;
        } else {
            const existing = sourcesMap.get(s.id);
            const localHasQuestions = Array.isArray(s.questions) && s.questions.length > 0;
            const existingHasQuestions = Array.isArray(existing.questions) && existing.questions.length > 0;

            // An offloaded archive entry is a stub without questions by design, so
            // the "keep whichever side still has questions" rule below would happily
            // resurrect the pre-archive copy. Whenever either side is archived, the
            // newer revision wins outright.
            if (s.archived || existing.archived) {
                const localRev = revisionOf(s);
                const remoteRev = revisionOf(existing);
                if (localRev > remoteRev) {
                    sourcesMap.set(s.id, s);
                    hasLocalChanges = true;
                } else if (localRev === remoteRev && !!s.archived === !!existing.archived
                    && localHasQuestions && !existingHasQuestions) {
                    // Same revision and same archive state: prefer the copy that
                    // still holds the questions locally.
                    sourcesMap.set(s.id, s);
                    hasLocalChanges = true;
                }
                return;
            }

            if (!existingHasQuestions && localHasQuestions) {
                sourcesMap.set(s.id, s);
                hasLocalChanges = true;
            } else if (existingHasQuestions && !localHasQuestions) {
                // Keep existing remote source which has questions
            } else if (revisionOf(s) > revisionOf(existing)) {
                sourcesMap.set(s.id, s);
                hasLocalChanges = true;
            }
        }
    });

    const mergedSources = Array.from(sourcesMap.values());

    // 1b. Merge Folders (by ID, respecting Folder Tombstones and Reset Guard)
    const foldersMap = new Map();
    if (!localResetIsNewer) {
        (remote.folders || []).forEach(f => {
            if (f && f.id && !mergedDeletedFolderIds.includes(f.id)) {
                foldersMap.set(f.id, f);
            }
        });
    }

    (local.folders || []).forEach(f => {
        if (!f || !f.id || mergedDeletedFolderIds.includes(f.id)) return;
        const existing = foldersMap.get(f.id);
        if (!existing) {
            foldersMap.set(f.id, f);
            hasLocalChanges = true;
        } else if ((f.updatedAt || 0) > (existing.updatedAt || 0)) {
            foldersMap.set(f.id, f);
            hasLocalChanges = true;
        }
    });

    const mergedFolders = Array.from(foldersMap.values());

    // ── Progress-reset guard ──────────────────────────────────────────────
    // Mirrors the source-reset guard above but covers stats, study activity,
    // recent tests, total stats and continuity config.
    // Strategy: use the MOST RECENT progress reset (from either side) as an
    // authoritative "floor". Any stat/activity entry that predates that floor
    // is dropped. Entries earned AFTER the floor (detectable via lastReview /
    // timestamp / date key) are kept, so data from a second device that kept
    // working AFTER the reset is not silently discarded.
    const localProgressResetAt  = local.lastProgressResetTimestamp  || 0;
    const remoteProgressResetAt = remote.lastProgressResetTimestamp || 0;
    // The authoritative floor: max of both sides.
    const latestProgressResetAt = Math.max(localProgressResetAt, remoteProgressResetAt);
    // When local has a newer progress reset than remote knows about, push immediately.
    if (localProgressResetAt > remoteProgressResetAt) {
        hasLocalChanges = true;
    }
    // ────────────────────────────────────────────────────────────────────────

    // 2. Merge Stats (excluding stats for deleted sources, respecting progress-reset floor)
    // When there has been a reset on either side, only include a stat entry if
    // its lastReview timestamp is on or after the reset floor (meaning it was
    // actively earned AFTER the reset). Entries with no lastReview are kept only
    // if they carry user annotations (starred / flagged / note) and even then
    // their progress counters are zeroed so they do not inflate charts.
    const passesProgressFloor = (stat) => {
        if (!latestProgressResetAt) return true; // no reset ever happened
        const reviewTime = stat && stat.lastReview
            ? new Date(stat.lastReview).getTime()
            : 0;
        return Number.isFinite(reviewTime) && reviewTime >= latestProgressResetAt;
    };

    const mergedStats = {};
    // Start from remote stats, filtered by the progress floor
    Object.entries(remote.stats || {}).forEach(([qid, rStat]) => {
        if (!rStat) return;
        const sourceId = qid.split('_')[0];
        if (mergedDeletedIds.includes(sourceId)) return;
        if (passesProgressFloor(rStat)) {
            mergedStats[qid] = rStat;
        }
    });

    // Merge local stats (also filtered by progress floor)
    const localStats = local.stats || {};
    Object.keys(localStats).forEach(qid => {
        const sourceId = qid.split('_')[0];
        if (mergedDeletedIds.includes(sourceId)) return;

        const lStat = localStats[qid];
        if (!passesProgressFloor(lStat)) return; // predates the reset floor

        const rStat = mergedStats[qid];

        if (!rStat) {
            mergedStats[qid] = lStat;
            hasLocalChanges = true;
        } else {
            const localIsNewer = ((lStat.correct || 0) + (lStat.wrong || 0)) >= ((rStat.correct || 0) + (rStat.wrong || 0));
            const difficulty = localIsNewer ? (lStat.difficulty ?? rStat.difficulty) : (rStat.difficulty ?? lStat.difficulty);
            const mergedItem = {
                correct: Math.max(lStat.correct || 0, rStat.correct || 0),
                wrong: Math.max(lStat.wrong || 0, rStat.wrong || 0),
                difficulty,
                // Kept in step with difficulty: the stats list sorts on coeff, and
                // dropping it here made every synced question read as average.
                coeff: Number.isFinite(difficulty) ? difficulty / 2 : (localIsNewer ? lStat.coeff : rStat.coeff),
                note: lStat.note && lStat.note.trim() ? lStat.note : rStat.note,
                starred: !!(lStat.starred || rStat.starred),
                flagged: !!(lStat.flagged || rStat.flagged),
                learned: !!(lStat.learned || rStat.learned),
                streak: Math.max(lStat.streak || 0, rStat.streak || 0),
                stability: Math.max(lStat.stability || 0, rStat.stability || 0),
                lastReview: pickLastReview(lStat.lastReview, rStat.lastReview)
            };
            mergedStats[qid] = mergedItem;
        }
    });

    // Remove any orphaned stats for deleted sources
    Object.keys(mergedStats).forEach(qid => {
        const sourceId = qid.split('_')[0];
        if (mergedDeletedIds.includes(sourceId)) {
            delete mergedStats[qid];
        }
    });

    // 3. Merge Recent Tests (excluding deleted sources, respecting progress-reset floor)
    const testMap = new Map();
    [...(remote.recentTests || []), ...(local.recentTests || [])].forEach(t => {
        if (!t || !t.id || mergedDeletedIds.includes(t.sourceId)) return;
        if (latestProgressResetAt && (t.timestamp || 0) < latestProgressResetAt) return;
        testMap.set(t.id, t);
    });
    const mergedRecentTests = Array.from(testMap.values())
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 10);

    // 4. Merge Quick Presets (by ID, respecting Quick Preset Tombstones and Reset Guard)
    const quickPresetsMap = new Map();
    if (!localResetIsNewer) {
        (remote.quickPresets || []).forEach(p => {
            if (p && p.id && !mergedDeletedQuickPresetIds.includes(p.id)) {
                quickPresetsMap.set(p.id, p);
            }
        });
    }

    (local.quickPresets || []).forEach(p => {
        if (!p || !p.id || mergedDeletedQuickPresetIds.includes(p.id)) return;
        const existing = quickPresetsMap.get(p.id);
        if (!existing) {
            quickPresetsMap.set(p.id, p);
            hasLocalChanges = true;
        } else if ((p.updatedAt || 0) > (existing.updatedAt || 0)) {
            quickPresetsMap.set(p.id, p);
            hasLocalChanges = true;
        }
    });

    const mergedQuickPresets = Array.from(quickPresetsMap.values());

    // 5. Merge Study Activity (Union by date key, respecting progress-reset floor)
    // Convert the reset floor timestamp to a date string for date-key comparison.
    const resetDateStr = latestProgressResetAt
        ? new Date(latestProgressResetAt).toISOString().slice(0, 10)
        : null;
    const mergedStudyActivity = {};
    // Start from remote activity filtered by the progress floor.
    // NOTE: dateKey === resetDateStr (same day as reset) is also excluded from remote
    // because the reset happened DURING that day — any pre-reset activity stored on
    // remote (e.g. 7 questions) must not survive the reset. The local side (which
    // was intentionally cleared) is the authority for the reset day itself.
    Object.keys(remote.studyActivity || {}).forEach(dateKey => {
        if (resetDateStr && dateKey <= resetDateStr) return; // predates or equals reset floor
        mergedStudyActivity[dateKey] = sanitizeActivityRecord((remote.studyActivity || {})[dateKey]);
    });
    const localStudyActivity = local.studyActivity || {};
    Object.keys(localStudyActivity).forEach(dateKey => {
        if (resetDateStr && dateKey < resetDateStr) return; // predates reset floor
        // On the reset day itself (dateKey === resetDateStr): local (cleared) wins
        // unconditionally — do not take Math.max with a stale remote value.
        const lAct = localStudyActivity[dateKey];
        const rAct = mergedStudyActivity[dateKey]; // will be undefined for reset-day entries
        if (!rAct) {
            mergedStudyActivity[dateKey] = sanitizeActivityRecord(lAct);
            hasLocalChanges = true;
        } else {
            // Both sides count the same day, so the counters are two views of one
            // total - never two totals to add up. Summing them doubled today's
            // count on every single sync, which compounds into millions within a
            // few page loads and drags the streak, the ring and the weekly chart
            // along with it. The higher view wins instead.

            /* Local holding the higher view is a local change, and saying so is
               what makes the pull push it back. Without this the merge kept the
               right numbers on this device and left the remote - and therefore
               every other device - on the lower ones. */
            if ((lAct.questionCount || 0) > (rAct.questionCount || 0)
                || (lAct.focusQuestionCount || 0) > (rAct.focusQuestionCount || 0)
                || (lAct.studied && !rAct.studied)
                || (lAct.focusStudied && !rAct.focusStudied)
                || (lAct.frozen && !rAct.frozen)
                || (lAct.focusFrozen && !rAct.focusFrozen)) {
                hasLocalChanges = true;
            }

            mergedStudyActivity[dateKey] = sanitizeActivityRecord({
                studied: lAct.studied || rAct.studied,
                questionCount: Math.max(lAct.questionCount || 0, rAct.questionCount || 0),
                correctCount: Math.max(lAct.correctCount || 0, rAct.correctCount || 0),
                wrongCount: Math.max(lAct.wrongCount || 0, rAct.wrongCount || 0),
                unansweredCount: Math.max(lAct.unansweredCount || 0, rAct.unansweredCount || 0),
                frozen: lAct.frozen || rAct.frozen,
                overdueSnapshot: pickSnapshot(lAct.overdueSnapshot, rAct.overdueSnapshot),
                // The focus track lived only on whichever device wrote it last
                // until now: dropping these keys reset the custom focus streak
                // to zero after every sync.
                focusStudied: lAct.focusStudied || rAct.focusStudied,
                focusQuestionCount: Math.max(lAct.focusQuestionCount || 0, rAct.focusQuestionCount || 0),
                focusFrozen: lAct.focusFrozen || rAct.focusFrozen,
                focusOverdueSnapshot: pickSnapshot(lAct.focusOverdueSnapshot, rAct.focusOverdueSnapshot)
            });
        }
    });

    // 6. Merge Continuity Config
    // A deliberate progress reset still takes the whole config: the resetting
    // device's factory state is the point of the reset, and letting individual
    // keys survive it by revision would be undoing it one field at a time.
    let mergedContinuityConfig;
    if (localProgressResetAt >= remoteProgressResetAt && localProgressResetAt > 0) {
        // Local reset is at least as recent — local factory config wins
        mergedContinuityConfig = local.continuityConfig;
        hasLocalChanges = true;
    } else if (remoteProgressResetAt > localProgressResetAt) {
        // Remote had a more recent reset — remote factory config wins
        mergedContinuityConfig = remote.continuityConfig;
    } else {
        // No reset on either side: key by key, newest stamp wins.
        const picked = mergeContinuityConfig(local.continuityConfig, remote.continuityConfig);
        mergedContinuityConfig = picked.config;
        if (picked.localWins) hasLocalChanges = true;
    }

    const activeSession = pickActiveSession(local, remote);
    if (activeSession.localWins) hasLocalChanges = true;

    return {
        sources: mergedSources,
        folders: mergedFolders,
        quickPresets: mergedQuickPresets,
        activeSession: activeSession.session,
        stats: mergedStats,
        recentTests: mergedRecentTests,
        studyActivity: mergedStudyActivity,
        continuityConfig: mergedContinuityConfig,
        deletedSourceIds: mergedDeletedIds,
        deletedFolderIds: mergedDeletedFolderIds,
        deletedQuickPresetIds: mergedDeletedQuickPresetIds,
        // Propagate the most recent reset timestamps so all devices stay in sync
        lastResetTimestamp: Math.max(localResetAt, remoteResetAt),
        lastProgressResetTimestamp: Math.max(localProgressResetAt, remoteProgressResetAt),
        hasLocalChanges
    };
}

// --- Archive file (separate Gist file, written only when the archive changes) ---

/**
 * True when archived questions can be offloaded to / restored from GitHub.
 */
export function canUseRemoteArchive() {
    return !!(AppState.githubToken && AppState.githubGistId);
}

export function getGistUrl() {
    if (AppState.githubGistUrl) return AppState.githubGistUrl;
    return AppState.githubGistId ? `https://gist.github.com/${AppState.githubGistId}` : null;
}

/**
 * Reads exam_app_archive.json. Returns a map of sourceId -> { name, questions }.
 * Missing file resolves to an empty map; any transport error throws so callers
 * can abort before they drop local questions.
 */
export async function fetchArchiveFile() {
    if (!canUseRemoteArchive()) throw new Error('GitHub archive unavailable');

    const gist = await fetchGist();
    const parsed = await readGistJSON(gist, ARCHIVE_FILENAME);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
}

/**
 * Writes the archive map back. Only ARCHIVE_FILENAME is named in the PATCH, so
 * the main backup file is left untouched.
 */
export async function writeArchiveFile(archiveMap) {
    if (!canUseRemoteArchive()) throw new Error('GitHub archive unavailable');

    const res = await fetch(`${GITHUB_API_BASE}/gists/${AppState.githubGistId}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${AppState.githubToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github+json'
        },
        body: JSON.stringify({
            files: {
                [ARCHIVE_FILENAME]: {
                    // Written without indentation: the archive is the one file that
                    // grows without bound and gets re-uploaded whole on every change,
                    // and pretty printing costs 20-50% on real question data.
                    // Reading stays compatible - JSON.parse ignores whitespace, so
                    // files written by older builds keep working unchanged.
                    content: JSON.stringify(archiveMap)
                }
            }
        })
    });

    if (!res.ok) throw httpError(res);
    return true;
}

/** (Re)starts the debounce window for whatever scopes are queued. */
function armSyncTimer(delayMs) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        const scopes = [...pendingScopes];
        pendingScopes.clear();
        syncToGist({ silent: true, scopes });
    }, delayMs);
}

/**
 * Debounced background sync trigger (default 1.5s delay, customizable).
 *
 * @param {number} [delayMs]
 * @param {string|string[]} [scope] Which file the caller changed - see
 *        SyncScope. Omitting it pushes everything, which is correct but costs
 *        the whole question library on a save that never touched it, so the
 *        frequent callers in state.js name their scope. Scopes queued inside one
 *        debounce window are pushed together.
 */
export function scheduleSync(delayMs = 1500, scope) {
    if (!AppState.githubToken || !AppState.githubGistId) return;

    normaliseScopes(scope).forEach(s => pendingScopes.add(s));
    armSyncTimer(delayMs);
}

/** Test seam: drops the debounced push, whatever scopes it was carrying, and the
 *  foreground-pull interval - a case that wants a pull should not have to wait
 *  out the previous case's. */
export function _resetSyncQueue() {
    clearTimeout(syncTimer);
    syncTimer = null;
    pendingScopes = new Set();
    isSyncing = false;
    lastPullAt = 0;
}

/**
 * Sets syncing loading indicator state.
 */
function setSyncingState(syncing) {
    isSyncing = syncing;
    const btn = document.getElementById('githubSyncBtn');
    if (btn) {
        btn.classList.toggle('syncing', syncing);
    }
}

/** One line describing an unhealthy sync, for the badge tooltip and dropdown. */
function syncHealthSummary(health) {
    return health.kind === SyncFailure.AUTH
        ? t('github_sync_auth_expired')
        : t('github_sync_failing', { count: health.failureCount });
}

/**
 * "14:32" for a sync that happened today, date and time for anything older.
 *
 * A bare clock time is what made a stale backup look current: "Son eşitleme:
 * 14:32" reads as this afternoon whether it was today or five weeks ago.
 */
function formatSyncTime(timestamp) {
    if (!timestamp) return null;
    const then = new Date(timestamp);
    const time = then.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return then.toDateString() === new Date().toDateString()
        ? time
        : `${then.toLocaleDateString()} ${time}`;
}

/**
 * Updates UI labels for the GitHub sync button.
 *
 * This is the whole render path for Slice.SYNC (see ui-bindings.js), so the
 * dropdown is refreshed from here too rather than only when it is opened.
 */
export function updateSyncUI() {
    const labelEl = document.getElementById('githubSyncLabel');
    const btn = document.getElementById('githubSyncBtn');
    if (!btn || !labelEl) return;

    const health = getSyncHealth();

    if (AppState.githubToken && AppState.githubUser) {
        labelEl.innerText = AppState.githubUser.login;
        btn.classList.add('logged-in');
        btn.classList.toggle('sync-unhealthy', health.unhealthy);
        btn.setAttribute('title', health.unhealthy
            ? syncHealthSummary(health)
            : t('github_connected_as', { user: AppState.githubUser.login }));
    } else {
        labelEl.innerText = t('github_login');
        btn.classList.remove('logged-in');
        btn.classList.remove('sync-unhealthy');
        btn.setAttribute('title', t('github_sync'));
    }

    updateSyncDropdownInfo();
}

// --- DOM & Modal Handlers ---

export function showLoginModal() {
    const modal = document.getElementById('githubLoginOverlay');
    if (modal) {
        modal.classList.add('active');
    }
}

export function closeLoginModal() {
    const modal = document.getElementById('githubLoginOverlay');
    if (modal) modal.classList.remove('active');
}

export function toggleSyncDropdown() {
    const dropdown = document.getElementById('githubSyncDropdown');
    if (!dropdown) return;

    if (dropdown.classList.contains('active')) {
        closeSyncDropdown();
    } else {
        updateSyncDropdownInfo();
        dropdown.classList.add('active');
    }
}

export function closeSyncDropdown() {
    const dropdown = document.getElementById('githubSyncDropdown');
    if (dropdown) dropdown.classList.remove('active');
}

export function togglePatManualSection(show) {
    const section = document.getElementById('githubPatSection');
    if (section) {
        const isVisible = show !== undefined ? show : section.style.display === 'none';
        section.style.display = isVisible ? 'block' : 'none';
    }
}

function updateSyncDropdownInfo() {
    const userEl = document.getElementById('githubDropdownUser');
    const timeEl = document.getElementById('githubDropdownLastSync');
    const healthEl = document.getElementById('githubDropdownHealth');
    const health = getSyncHealth();

    if (userEl && AppState.githubUser) {
        userEl.innerText = AppState.githubUser.name || AppState.githubUser.login;
    }

    if (timeEl) {
        // Always the last *successful* sync - the failure line below is what
        // says whether anything has happened since.
        const when = formatSyncTime(health.lastSuccessAt);
        timeEl.innerText = when ? t('github_last_sync', { time: when }) : t('github_never_synced');
    }

    if (healthEl) {
        const failing = health.failureCount > 0;
        healthEl.innerText = failing ? syncHealthSummary(health) : '';
        healthEl.style.display = failing ? 'block' : 'none';
        healthEl.classList.toggle('critical', health.kind === SyncFailure.AUTH);

        /* A warning with nowhere to go is noise. An expired token has exactly
           one fix, so the line itself is the way to it. Assigning onclick (not
           addEventListener) keeps re-renders from stacking handlers. */
        const needsReconnect = health.kind === SyncFailure.AUTH;
        healthEl.classList.toggle('actionable', needsReconnect);
        healthEl.onclick = needsReconnect
            ? () => { closeSyncDropdown(); showLoginModal(); }
            : null;
    }
}

function setupSyncDOMListeners() {
    const btn = document.getElementById('githubSyncBtn');
    if (btn) {
        btn.onclick = (e) => {
            e.stopPropagation();
            if (AppState.githubToken) {
                toggleSyncDropdown();
            } else {
                showLoginModal();
            }
        };
    }

    const closeBtn = document.getElementById('githubLoginCloseBtn');
    if (closeBtn) closeBtn.onclick = closeLoginModal;

    // Main OAuth Login button
    const oauthLoginBtn = document.getElementById('githubOAuthLoginBtn');
    if (oauthLoginBtn) {
        oauthLoginBtn.onclick = () => {
            loginWithOAuth();
        };
    }

    // Toggle PAT manual input fallback
    const togglePatBtn = document.getElementById('githubTogglePatBtn');
    if (togglePatBtn) {
        togglePatBtn.onclick = () => {
            togglePatManualSection();
        };
    }

    // Connect via PAT manual fallback
    const connectPatBtn = document.getElementById('githubConnectPatBtn');
    if (connectPatBtn) {
        connectPatBtn.onclick = () => {
            const input = document.getElementById('githubTokenInput');
            if (input) loginWithToken(input.value);
        };
    }

    const syncNowBtn = document.getElementById('githubDropdownSyncNow');
    if (syncNowBtn) {
        syncNowBtn.onclick = () => {
            closeSyncDropdown();
            syncFromGist({ silent: false });
        };
    }

    const logoutBtn = document.getElementById('githubDropdownLogout');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            logout();
        };
    }

    /* Three events for one question - "is the app in front of the user again?" -
       because no single one of them answers it everywhere. visibilitychange
       covers a switched tab and a backgrounded mobile browser; window focus
       covers another application being brought to the front on a desktop, where
       the tab never stops counting as visible; pageshow covers a bfcache restore,
       which is how iOS returns to a page it froze days ago. The interval guard
       inside makes the overlap between them free. */
    document.addEventListener('visibilitychange', pullOnForeground);
    window.addEventListener('focus', pullOnForeground);
    window.addEventListener('pageshow', pullOnForeground);

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('githubSyncDropdown');
        if (dropdown && dropdown.classList.contains('active') && !dropdown.contains(e.target) && e.target !== btn) {
            closeSyncDropdown();
        }
    });
}
