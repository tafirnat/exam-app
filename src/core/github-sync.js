import { AppState, saveSources, saveStats, saveRecentTests, saveFolders, saveQuickPresets, clearLocalStudyData, saveStudyActivity, saveContinuityConfig } from './state.js';
import { showToast, showAlert } from './utils.js';
import { t } from './i18n.js';
import { migrateFolderColors, sanitizeActivityRecord } from './migration.js';

const GIST_FILENAME = 'exam_app_backup.json';
// The archive lives in its own file inside the same Gist. A Gist PATCH only
// touches the files it names, so routine syncs of the backup file can never
// overwrite or drop the archive - and the (large) archived questions never
// travel with every single stats save.
const ARCHIVE_FILENAME = 'exam_app_archive.json';
const GIST_DESCRIPTION = 'Exam App - User Study & Resource Data Sync';
const GITHUB_API_BASE = 'https://api.github.com';

// Environment variables from Vite (.env)
const GITHUB_CLIENT_ID = import.meta.env?.VITE_GITHUB_CLIENT_ID || '';
const WORKER_URL = import.meta.env?.VITE_WORKER_URL || '';

let syncTimer = null;
let isSyncing = false;

/**
 * Prepares the complete JSON payload of local data for backup/sync.
 */
export function getSyncPayload() {
    return {
        version: 3,
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
        totalStats: AppState.totalStats || {},
        recentTests: AppState.recentTests || [],
        studyActivity: AppState.studyActivity || {},
        continuityConfig: AppState.continuityConfig || {},
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
 * Initializes the GitHub sync state on app startup and handles OAuth redirect callbacks.
 */
export async function initSync() {
    AppState.githubToken = localStorage.getItem('focus_app_github_token') || null;
    AppState.githubGistId = localStorage.getItem('focus_app_github_gist_id') || null;
    AppState.githubGistUrl = localStorage.getItem('focus_app_github_gist_url') || null;
    AppState.githubUser = JSON.parse(localStorage.getItem('focus_app_github_user') || 'null');
    AppState.lastSyncTime = parseInt(localStorage.getItem('focus_app_last_sync') || '0', 10);

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
    const previousUser = AppState.lastGithubUser || localStorage.getItem('focus_app_last_github_user');
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

    localStorage.setItem('focus_app_github_token', token);
    localStorage.setItem('focus_app_github_gist_id', gistId);
    localStorage.setItem('focus_app_github_user', JSON.stringify(userObj));
    localStorage.setItem('focus_app_last_github_user', userObj.login);

    // 4. Perform initial sync
    if (shouldReplaceLocalData) {
        await pullRemoteGistOnly(token, gistId);
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
        if (typeof window.renderSourcesList === 'function') window.renderSourcesList();
        if (typeof window.renderStatsList === 'function') window.renderStatsList();
        if (typeof window.updateHomeStats === 'function') window.updateHomeStats();
    }

    AppState.githubToken = null;
    AppState.githubGistId = null;
    AppState.githubGistUrl = null;
    AppState.githubUser = null;
    AppState.lastSyncTime = 0;

    localStorage.removeItem('focus_app_github_token');
    localStorage.removeItem('focus_app_github_gist_id');
    localStorage.removeItem('focus_app_github_gist_url');
    localStorage.removeItem('focus_app_github_user');
    localStorage.removeItem('focus_app_last_sync');

    updateSyncUI();
    closeSyncDropdown();
    showToast(t('github_logout'));
}

/**
 * Fetches remote Gist data and overwrites local state cleanly without merging previous account data back to Gist.
 */
async function pullRemoteGistOnly(token, gistId) {
    try {
        const res = await fetch(`${GITHUB_API_BASE}/gists/${gistId}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json'
            }
        });

        if (!res.ok) return;

        const gist = await res.json();
        const file = gist.files && gist.files[GIST_FILENAME];

        if (file && file.content) {
            const remotePayload = JSON.parse(file.content);

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
                localStorage.setItem('focus_app_deleted_sources', JSON.stringify(remotePayload.deletedSourceIds));
            }

            if (Array.isArray(remotePayload.deletedFolderIds)) {
                AppState.deletedFolderIds = remotePayload.deletedFolderIds;
                localStorage.setItem('focus_app_deleted_folders', JSON.stringify(remotePayload.deletedFolderIds));
            }

            if (remotePayload.stats && typeof remotePayload.stats === 'object') {
                AppState.stats = remotePayload.stats;
                saveStats();
            }

            if (remotePayload.totalStats && typeof remotePayload.totalStats === 'object') {
                AppState.totalStats = remotePayload.totalStats;
                localStorage.setItem('focus_app_stats_global', JSON.stringify(AppState.totalStats));
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
                saveContinuityConfig();
            }

            AppState.lastSyncTime = Date.now();
            localStorage.setItem('focus_app_last_sync', AppState.lastSyncTime.toString());

            import('../features/test/test-engine.js').then(m => {
                if (typeof m.buildQuestionPool === 'function') m.buildQuestionPool();
            }).catch(() => {});

            if (typeof window.renderSourcesList === 'function') window.renderSourcesList();
            if (typeof window.renderStatsList === 'function') window.renderStatsList();
            if (typeof window.updateHomeStats === 'function') window.updateHomeStats();
        }
    } catch (err) {
        console.error('pullRemoteGistOnly error:', err);
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
            files: {
                [GIST_FILENAME]: {
                    content: JSON.stringify(getSyncPayload(), null, 2)
                }
            }
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
    localStorage.setItem('focus_app_github_gist_url', url);
}

/**
 * Pushes local data to GitHub Gist.
 */
export async function syncToGist(options = {}) {
    if (!AppState.githubToken || !AppState.githubGistId || isSyncing) return;

    setSyncingState(true);
    try {
        const payload = getSyncPayload();
        const res = await fetch(`${GITHUB_API_BASE}/gists/${AppState.githubGistId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${AppState.githubToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github+json'
            },
            body: JSON.stringify({
                description: GIST_DESCRIPTION,
                files: {
                    [GIST_FILENAME]: {
                        content: JSON.stringify(payload, null, 2)
                    }
                }
            })
        });

        if (!res.ok) {
            throw new Error(`HTTP error ${res.status}`);
        }

        AppState.lastSyncTime = Date.now();
        localStorage.setItem('focus_app_last_sync', AppState.lastSyncTime.toString());
        updateSyncUI();

        if (!options.silent) {
            showToast(t('github_sync_success'));
        }
    } catch (err) {
        console.error('syncToGist failed:', err);
        if (!options.silent) {
            showToast(t('github_sync_error'));
        }
    } finally {
        setSyncingState(false);
    }
}

/**
 * Pulls remote data from GitHub Gist and merges with local data.
 */
export async function syncFromGist(options = {}) {
    if (!AppState.githubToken || !AppState.githubGistId || isSyncing) return;

    setSyncingState(true);
    try {
        const res = await fetch(`${GITHUB_API_BASE}/gists/${AppState.githubGistId}`, {
            headers: {
                'Authorization': `Bearer ${AppState.githubToken}`,
                'Accept': 'application/vnd.github+json'
            }
        });

        if (!res.ok) {
            throw new Error(`HTTP error ${res.status}`);
        }

        const gist = await res.json();
        const file = gist.files && gist.files[GIST_FILENAME];

        if (file && file.content) {
            const remotePayload = JSON.parse(file.content);
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
                localStorage.setItem('focus_app_deleted_sources', JSON.stringify(merged.deletedSourceIds));
            }

            if (Array.isArray(merged.deletedFolderIds)) {
                AppState.deletedFolderIds = merged.deletedFolderIds;
                localStorage.setItem('focus_app_deleted_folders', JSON.stringify(merged.deletedFolderIds));
            }

            if (Array.isArray(merged.quickPresets)) {
                AppState.quickPresets = merged.quickPresets;
                saveQuickPresets();
            }

            if (Array.isArray(merged.deletedQuickPresetIds)) {
                AppState.deletedQuickPresetIds = merged.deletedQuickPresetIds;
                localStorage.setItem('focus_app_deleted_quick_presets', JSON.stringify(merged.deletedQuickPresetIds));
            }

            // Apply merged stats
            if (merged.stats && typeof merged.stats === 'object') {
                AppState.stats = merged.stats;
                saveStats();
            }

            if (merged.totalStats && typeof merged.totalStats === 'object') {
                AppState.totalStats = merged.totalStats;
                localStorage.setItem('focus_app_stats_global', JSON.stringify(AppState.totalStats));
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
                saveContinuityConfig();
            }

            // Persist the most recent reset timestamps observed during this merge.
            // This keeps all devices aware of the latest reset even if they were
            // offline when it happened.
            if (typeof merged.lastResetTimestamp === 'number'
                    && merged.lastResetTimestamp > (AppState.lastResetTimestamp || 0)) {
                AppState.lastResetTimestamp = merged.lastResetTimestamp;
                localStorage.setItem('focus_app_last_reset', merged.lastResetTimestamp.toString());
            }
            if (typeof merged.lastProgressResetTimestamp === 'number'
                    && merged.lastProgressResetTimestamp > (AppState.lastProgressResetTimestamp || 0)) {
                AppState.lastProgressResetTimestamp = merged.lastProgressResetTimestamp;
                localStorage.setItem('focus_app_last_progress_reset', merged.lastProgressResetTimestamp.toString());
            }

            // Push merged state back to Gist if local had newer changes
            if (merged.hasLocalChanges) {
                await syncToGist({ silent: true });
            }

            AppState.lastSyncTime = Date.now();
            localStorage.setItem('focus_app_last_sync', AppState.lastSyncTime.toString());

            // Rebuild question pool and questionMap for Test Engine & UI
            import('../features/test/test-engine.js').then(m => {
                if (typeof m.buildQuestionPool === 'function') m.buildQuestionPool();
            }).catch(() => {});

            // Re-render UI components if available globally
            if (typeof window.renderSourcesList === 'function') window.renderSourcesList();
            if (typeof window.renderStatsList === 'function') window.renderStatsList();
            if (typeof window.updateHomeStats === 'function') window.updateHomeStats();

            updateSyncUI();

            if (!options.silent) {
                showToast(t('github_sync_success'));
            }
        }
    } catch (err) {
        console.error('syncFromGist failed:', err);
        if (!options.silent) {
            showToast(t('github_sync_error'));
        }
    } finally {
        setSyncingState(false);
    }
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
    // Prefer the version from the side that has a NEWER progress reset, because
    // that device's config is the freshly-initialised factory state. Fall back to
    // the remote as the authoritative base when no reset has occurred on either side.
    let mergedContinuityConfig;
    if (localProgressResetAt >= remoteProgressResetAt && localProgressResetAt > 0) {
        // Local reset is at least as recent — local factory config wins
        mergedContinuityConfig = local.continuityConfig;
    } else if (remoteProgressResetAt > localProgressResetAt) {
        // Remote had a more recent reset — remote factory config wins
        mergedContinuityConfig = remote.continuityConfig;
    } else {
        // No reset on either side: prefer remote as base, fall back to local
        mergedContinuityConfig = (remote.continuityConfig && Object.keys(remote.continuityConfig).length > 0)
            ? remote.continuityConfig
            : local.continuityConfig;
    }

    // Total stats: prefer whichever side had the most recent progress reset
    // (their cleared state is the authority); otherwise take the larger values.
    let mergedTotalStats;
    if (localProgressResetAt >= remoteProgressResetAt && localProgressResetAt > 0) {
        mergedTotalStats = local.totalStats || {};
    } else if (remoteProgressResetAt > localProgressResetAt) {
        mergedTotalStats = remote.totalStats || {};
    } else {
        mergedTotalStats = remote.totalStats || local.totalStats;
    }

    return {
        sources: mergedSources,
        folders: mergedFolders,
        quickPresets: mergedQuickPresets,
        stats: mergedStats,
        totalStats: mergedTotalStats,
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

    const res = await fetch(`${GITHUB_API_BASE}/gists/${AppState.githubGistId}`, {
        headers: {
            'Authorization': `Bearer ${AppState.githubToken}`,
            'Accept': 'application/vnd.github+json'
        }
    });
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);

    const gist = await res.json();
    const file = gist.files && gist.files[ARCHIVE_FILENAME];
    if (!file) return {};

    // The API inlines at most 1MB; larger files come back flagged and must be
    // read from raw_url or the archive would silently lose its tail.
    let content = file.content;
    if (file.truncated || content === undefined || content === null) {
        if (!file.raw_url) throw new Error('Archive file truncated without raw_url');
        const rawRes = await fetch(file.raw_url);
        if (!rawRes.ok) throw new Error(`HTTP error ${rawRes.status}`);
        content = await rawRes.text();
    }

    if (!content.trim()) return {};
    const parsed = JSON.parse(content);
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

    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return true;
}

/**
 * Debounced background sync trigger (default 1.5s delay, customizable).
 */
export function scheduleSync(delayMs = 1500) {
    if (!AppState.githubToken || !AppState.githubGistId) return;

    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        syncToGist({ silent: true });
    }, delayMs);
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

/**
 * Updates UI labels for the GitHub sync button.
 */
export function updateSyncUI() {
    const labelEl = document.getElementById('githubSyncLabel');
    const btn = document.getElementById('githubSyncBtn');
    if (!btn || !labelEl) return;

    if (AppState.githubToken && AppState.githubUser) {
        labelEl.innerText = AppState.githubUser.login;
        btn.classList.add('logged-in');
        btn.setAttribute('title', t('github_connected_as', { user: AppState.githubUser.login }));
    } else {
        labelEl.innerText = t('github_login');
        btn.classList.remove('logged-in');
        btn.setAttribute('title', t('github_sync'));
    }
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

    if (userEl && AppState.githubUser) {
        userEl.innerText = AppState.githubUser.name || AppState.githubUser.login;
    }

    if (timeEl) {
        if (AppState.lastSyncTime > 0) {
            const dateStr = new Date(AppState.lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            timeEl.innerText = t('github_last_sync', { time: dateStr });
        } else {
            timeEl.innerText = t('github_last_sync', { time: '-' });
        }
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

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('githubSyncDropdown');
        if (dropdown && dropdown.classList.contains('active') && !dropdown.contains(e.target) && e.target !== btn) {
            closeSyncDropdown();
        }
    });
}
