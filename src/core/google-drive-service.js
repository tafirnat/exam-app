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

        // Load GAPI
        gapi.load('client', async () => {
            try {
                await gapi.client.init({
                    apiKey: API_KEY,
                    discoveryDocs: [DISCOVERY_DOC],
                });
                gapiInited = true;
                checkInit();
            } catch (err) {
                console.error('GAPI Init Error:', err);
                const errorDetail = err?.result?.error?.message || 'Google API connection blocked (403)';
                showToast(`Kritik Hata: ${errorDetail}`);
                // Resolve with false to stop the initialization chain
                resolve(false);
            }
        });



        // Load GIS
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: '', // defined later
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
                reject(resp);
                return;
            }
            DriveState.isAuthenticated = true;
            localStorage.setItem('focus_app_drive_token', JSON.stringify(resp));
            showToast('Google Drive bağlandı');
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
        showToast('Oturum kapatıldı');
    }
}

/**
 * Backup all local state to Google Drive
 */
export async function backupToDrive() {
    if (!DriveState.isAuthenticated) return;

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
        const file = new Blob([fileContent], { type: 'application/json' });

        // Search for existing backup file
        const response = await gapi.client.drive.files.list({
            spaces: 'appDataFolder',
            fields: 'files(id, name)',
            pageSize: 1
        });

        const existingFile = response.result.files.find(f => f.name === 'backup.json');

        if (existingFile) {
            // Update existing
            await gapi.client.drive.files.update({
                fileId: existingFile.id,
                uploadType: 'media'
            }, file);
        } else {
            // Create new
            const metadata = {
                name: 'backup.json',
                parents: ['appDataFolder']
            };

            // Multipart upload for new files
            const form = new FormData();
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            form.append('file', file);

            await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                method: 'POST',
                headers: new Headers({ 'Authorization': 'Bearer ' + gapi.client.getToken().access_token }),
                body: form
            });
        }

        showToast('Yedekleme başarıyla tamamlandı');
    } catch (error) {
        console.error('Backup error:', error);
        showToast('Yedekleme hatası');
    } finally {
        DriveState.isSyncing = false;
    }
}

/**
 * Restore state from Google Drive
 */
export async function restoreFromDrive() {
    if (!DriveState.isAuthenticated) return;

    DriveState.isSyncing = true;
    try {
        const response = await gapi.client.drive.files.list({
            spaces: 'appDataFolder',
            fields: 'files(id, name)',
            pageSize: 1
        });

        const existingFile = response.result.files.find(f => f.name === 'backup.json');

        if (!existingFile) {
            showToast('Yedek bulunamadı');
            return;
        }

        const fileResponse = await gapi.client.drive.files.get({
            fileId: existingFile.id,
            alt: 'media'
        });

        const data = fileResponse.result;

        // Apply data to AppState
        if (data.stats) AppState.stats = data.stats;
        if (data.sources) AppState.sources = data.sources;
        if (data.recentTests) AppState.recentTests = data.recentTests;
        if (data.aiIntegration) AppState.aiIntegration = data.aiIntegration;
        if (data.customAIPrompt) AppState.customAIPrompt = data.customAIPrompt;

        // Save to local storage
        saveStats();
        saveSources();
        saveRecentTests();
        saveAiIntegration();
        saveCustomAIPrompt();

        showToast('Veriler buluttan geri yüklendi');
        return true;
    } catch (error) {
        console.error('Restore error:', error);
        showToast('Geri yükleme hatası');
    } finally {
        DriveState.isSyncing = false;
    }
}
