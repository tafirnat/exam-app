import { AppState, saveStats, saveSources, saveRecentTests, saveAiIntegration, saveCustomAIPrompt } from './state.js';
import { showToast } from './utils.js';

// Google API Configuration
const CLIENT_ID = '710825958908-3gbt417f9luti73ahj9fah861q6dfrkf.apps.googleusercontent.com';
const API_KEY = 'AIzaSyBPN8xYxda-B5jprDRdRnmsXAghiOtgTOA';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

let tokenClient;
let gapiInited = false;
let gisInited = false;

export const DriveState = {
    isAuthenticated: false,
    isSyncing: false,
    userProfile: null
};

/**
 * Helper to wait for global scripts to load
 */
async function waitForScripts() {
    return new Promise((resolve) => {
        const check = () => {
            if (typeof gapi !== 'undefined' && typeof google !== 'undefined' && google.accounts) {
                resolve();
            } else {
                setTimeout(check, 100);
            }
        };
        check();
    });
}

/**
 * Initialize Google API and Identity Services
 */
export async function initDriveApi() {
    await waitForScripts();

    return new Promise((resolve) => {
        const checkInit = () => {
            if (gapiInited && gisInited) resolve(true);
        };

        // Load GAPI client + Drive discovery doc
        gapi.load('client', async () => {
            try {
                await gapi.client.init({
                    apiKey: API_KEY,
                    discoveryDocs: [DISCOVERY_DOC],
                });

                // FIX 1: Explicitly load the Drive v3 client library
                // This ensures gapi.client.drive is defined before any API calls
                await gapi.client.load('drive', 'v3');

                // FIX 2: Restore saved token from localStorage so user stays logged in across page refreshes
                const savedTokenStr = localStorage.getItem('focus_app_drive_token');
                if (savedTokenStr) {
                    try {
                        const savedToken = JSON.parse(savedTokenStr);
                        // Only restore if token looks valid (has access_token field)
                        if (savedToken && savedToken.access_token) {
                            gapi.client.setToken(savedToken);
                            DriveState.isAuthenticated = true;
                            console.log('Google Drive: restored session from localStorage');
                        }
                    } catch (e) {
                        console.warn('Google Drive: could not restore saved token', e);
                        localStorage.removeItem('focus_app_drive_token');
                    }
                }

                gapiInited = true;
                checkInit();
            } catch (err) {
                console.error('GAPI Init Error:', err);
                const errorDetail = err?.result?.error?.message || 'Google API connection blocked (403)';
                showToast(`API Hatası: ${errorDetail}`);
                resolve(false);
            }
        });

        // Load GIS token client
        // FIX 3: Use 'popup' ux_mode to avoid COOP/window.opener issues
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: '', // defined later in signIn()
        });
        gisInited = true;
        checkInit();
    });
}

/**
 * Sign in with Google
 */
export function signIn() {
    return new Promise((resolve, reject) => {
        tokenClient.callback = async (resp) => {
            if (resp.error !== undefined) {
                console.error('OAuth error:', resp);
                reject(resp);
                return;
            }
            DriveState.isAuthenticated = true;
            // Save token to localStorage for session restore across page refreshes
            localStorage.setItem('focus_app_drive_token', JSON.stringify(gapi.client.getToken()));
            showToast('✓ Google Drive bağlandı');
            resolve(resp);
        };

        if (gapi.client.getToken() === null) {
            tokenClient.requestAccessToken({ prompt: 'consent' });
        } else {
            tokenClient.requestAccessToken({ prompt: '' });
        }
    });
}

/**
 * Sign out
 */
export function signOut() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token);
        gapi.client.setToken('');
        DriveState.isAuthenticated = false;
        localStorage.removeItem('focus_app_drive_token');
        showToast('Oturum kapatıldı');
    }
}

/**
 * Guard helper: checks that the Drive API client is ready
 */
function isDriveReady() {
    if (!DriveState.isAuthenticated) {
        showToast('Önce Google hesabınıza giriş yapın');
        return false;
    }
    if (!gapi.client.drive) {
        showToast('Drive API henüz yüklenmedi, lütfen tekrar deneyin');
        console.error('gapi.client.drive is undefined');
        return false;
    }
    return true;
}

/**
 * Backup all local state to Google Drive (appDataFolder)
 */
export async function backupToDrive() {
    // FIX 4: Guard against undefined gapi.client.drive
    if (!isDriveReady()) return;

    DriveState.isSyncing = true;
    try {
        const backupData = {
            stats: AppState.stats,
            sources: AppState.sources,
            recentTests: AppState.recentTests,
            aiIntegration: AppState.aiIntegration,
            customAIPrompt: AppState.customAIPrompt,
            timestamp: Date.now()
        };

        const fileContent = JSON.stringify(backupData);

        // Search for existing backup file
        const listResponse = await gapi.client.drive.files.list({
            spaces: 'appDataFolder',
            fields: 'files(id, name)',
            pageSize: 10
        });

        const files = listResponse.result.files || [];
        const existingFile = files.find(f => f.name === 'backup.json');
        const accessToken = gapi.client.getToken().access_token;

        if (existingFile) {
            // Update existing file via fetch (PATCH multipart)
            const metadata = { name: 'backup.json' };
            const form = new FormData();
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            form.append('file', new Blob([fileContent], { type: 'application/json' }));

            const updateResp = await fetch(
                `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=multipart`,
                {
                    method: 'PATCH',
                    headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
                    body: form
                }
            );
            if (!updateResp.ok) throw new Error(`Update failed: ${updateResp.status}`);
        } else {
            // Create new file in appDataFolder
            const metadata = {
                name: 'backup.json',
                parents: ['appDataFolder']
            };
            const form = new FormData();
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            form.append('file', new Blob([fileContent], { type: 'application/json' }));

            const createResp = await fetch(
                'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
                {
                    method: 'POST',
                    headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
                    body: form
                }
            );
            if (!createResp.ok) throw new Error(`Create failed: ${createResp.status}`);
        }

        showToast('✓ Yedekleme başarıyla tamamlandı');
    } catch (error) {
        console.error('Backup error:', error);
        showToast('Yedekleme hatası: ' + (error.message || 'Bilinmeyen hata'));
    } finally {
        DriveState.isSyncing = false;
    }
}

/**
 * Restore state from Google Drive (appDataFolder)
 */
export async function restoreFromDrive() {
    // FIX 5: Guard against undefined gapi.client.drive
    if (!isDriveReady()) return false;

    DriveState.isSyncing = true;
    try {
        const listResponse = await gapi.client.drive.files.list({
            spaces: 'appDataFolder',
            fields: 'files(id, name)',
            pageSize: 10
        });

        const files = listResponse.result.files || [];
        const existingFile = files.find(f => f.name === 'backup.json');

        if (!existingFile) {
            showToast('Yedek bulunamadı');
            return false;
        }

        // Download file content via fetch for reliable JSON parsing
        const accessToken = gapi.client.getToken().access_token;
        const downloadResp = await fetch(
            `https://www.googleapis.com/drive/v3/files/${existingFile.id}?alt=media`,
            {
                headers: new Headers({ 'Authorization': 'Bearer ' + accessToken })
            }
        );

        if (!downloadResp.ok) throw new Error(`Download failed: ${downloadResp.status}`);
        const data = await downloadResp.json();

        // Apply data to AppState
        if (data.stats) AppState.stats = data.stats;
        if (data.sources) AppState.sources = data.sources;
        if (data.recentTests) AppState.recentTests = data.recentTests;
        if (data.aiIntegration) AppState.aiIntegration = data.aiIntegration;
        if (data.customAIPrompt) AppState.customAIPrompt = data.customAIPrompt;

        // Persist to localStorage
        saveStats();
        saveSources();
        saveRecentTests();
        saveAiIntegration();
        saveCustomAIPrompt();

        showToast('✓ Veriler buluttan geri yüklendi');
        return true;
    } catch (error) {
        console.error('Restore error:', error);
        showToast('Geri yükleme hatası: ' + (error.message || 'Bilinmeyen hata'));
        return false;
    } finally {
        DriveState.isSyncing = false;
    }
}
