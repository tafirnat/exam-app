import { AppState, saveSources, saveStats, saveRecentTests, saveFolders, clearLocalStudyData } from './state.js';
import { showToast, showAlert } from './utils.js';
import { t } from './i18n.js';

const GIST_FILENAME = 'exam_app_backup.json';
// The archive lives in its own file inside the same Gist. A Gist PATCH only
// touches the files it names, so routine syncs of the backup file can never
// overwrite or drop the archive - and the (large) archived questions never
// travel with every single stats save.
const ARCHIVE_FILENAME = 'exam_app_archive.json';
const GIST_DESCRIPTION = 'Exam App - User Study & Resource Data Sync';
const GITHUB_API_BASE = 'https://api.github.com';

// Environment variables from Vite (.env)
const GITHUB_CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID || '';
const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';

let syncTimer = null;
let isSyncing = false;

/**
 * Prepares the complete JSON payload of local data for backup/sync.
 */
export function getSyncPayload() {
    return {
        version: 3,
        lastUpdated: Date.now(),
        // Offloaded archive entries are stubs here on purpose: their questions
        // live in ARCHIVE_FILENAME only.
        sources: (AppState.sources || []).map(s => (
            s.archived && s.offloaded ? { ...s, questions: [] } : s
        )),
        folders: AppState.folders || [],
        deletedSourceIds: AppState.deletedSourceIds || [],
        deletedFolderIds: AppState.deletedFolderIds || [],
        stats: AppState.stats || {},
        totalStats: AppState.totalStats || {},
        recentTests: AppState.recentTests || [],
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
        showAlert(t('github_sync_error') + ': Invalid OAuth state', t('error_title') || 'Error');
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
        showAlert(t('github_sync_error') + ': ' + err.message, t('error_title') || 'Error');
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
        showAlert(t('github_invalid_token'), t('error_title') || 'Error');
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
        showAlert(err.message || t('github_sync_error'), t('error_title') || 'Error');
        return false;
    } finally {
        setSyncingState(false);
    }
}

/**
 * Helper to fetch user details, setup Gist, and initialize sync.
 */
async function completeLoginWithToken(token) {
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

            // Apply merged folders
            if (Array.isArray(merged.folders)) {
                AppState.folders = merged.folders;
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
 * Intelligent merger for two AppState sync payloads (local vs remote).
 */
export function mergeSyncData(local, remote) {
    let hasLocalChanges = false;

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

    const revisionOf = (r) => r.updatedAt || r.lastUsed || 0;

    // 1. Merge Sources (by ID, respecting Tombstones)
    const sourcesMap = new Map();
    (remote.sources || []).forEach(s => {
        if (s && s.id && !mergedDeletedIds.includes(s.id)) {
            sourcesMap.set(s.id, s);
        }
    });

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

    // 1b. Merge Folders (by ID, respecting Folder Tombstones)
    const foldersMap = new Map();
    (remote.folders || []).forEach(f => {
        if (f && f.id && !mergedDeletedFolderIds.includes(f.id)) {
            foldersMap.set(f.id, f);
        }
    });

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

    // 2. Merge Stats (excluding stats for deleted sources)
    const mergedStats = { ...(remote.stats || {}) };
    const localStats = local.stats || {};

    Object.keys(localStats).forEach(qid => {
        const sourceId = qid.split('_')[0];
        if (mergedDeletedIds.includes(sourceId)) return;

        const lStat = localStats[qid];
        const rStat = mergedStats[qid];

        if (!rStat) {
            mergedStats[qid] = lStat;
            hasLocalChanges = true;
        } else {
            const mergedItem = {
                correct: Math.max(lStat.correct || 0, rStat.correct || 0),
                wrong: Math.max(lStat.wrong || 0, rStat.wrong || 0),
                difficulty: (lStat.correct + lStat.wrong) >= (rStat.correct + rStat.wrong) ? (lStat.difficulty ?? rStat.difficulty) : (rStat.difficulty ?? lStat.difficulty),
                note: lStat.note && lStat.note.trim() ? lStat.note : rStat.note,
                starred: !!(lStat.starred || rStat.starred),
                flagged: !!(lStat.flagged || rStat.flagged),
                learned: !!(lStat.learned || rStat.learned),
                streak: Math.max(lStat.streak || 0, rStat.streak || 0),
                stability: Math.max(lStat.stability || 0, rStat.stability || 0),
                lastReview: Math.max(lStat.lastReview || 0, rStat.lastReview || 0)
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

    // 3. Merge Recent Tests (excluding deleted sources)
    const testMap = new Map();
    [...(remote.recentTests || []), ...(local.recentTests || [])].forEach(t => {
        if (t && t.id && !mergedDeletedIds.includes(t.sourceId)) {
            testMap.set(t.id, t);
        }
    });
    const mergedRecentTests = Array.from(testMap.values())
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 10);

    return {
        sources: mergedSources,
        folders: mergedFolders,
        stats: mergedStats,
        totalStats: remote.totalStats || local.totalStats,
        recentTests: mergedRecentTests,
        deletedSourceIds: mergedDeletedIds,
        deletedFolderIds: mergedDeletedFolderIds,
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
                    content: JSON.stringify(archiveMap, null, 2)
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
