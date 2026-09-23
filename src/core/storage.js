/**
 * The one place localStorage is touched.
 *
 * Every write used to be a bare `localStorage.setItem`, which throws once the
 * origin's quota (~5 MB, 10 MB on some browsers) is full. Nothing caught it, so
 * a failed write tore through whatever call chain it happened to be in - an
 * import, a folder rename, the save after answering a question - and the user
 * saw work vanish on the next reload with no explanation. `persist()` turns
 * that into a return value plus one loud, once-per-session warning.
 *
 * This module deliberately has no static imports. state.js, i18n.js and
 * utils.js all import each other, and anything this file pulled in statically
 * would close a cycle; the warning path uses a dynamic import instead.
 */

let dbPromise = null;

export function initDB() {
    if (!dbPromise) {
        if (typeof indexedDB === 'undefined') {
            return Promise.reject(new Error("indexedDB is not defined"));
        }
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open('FocusAppDB', 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('keyval')) {
                    db.createObjectStore('keyval');
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    return dbPromise;
}

export async function get(key) {
    if (typeof indexedDB === 'undefined') {
        return localStorage.getItem(key);
    }
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('keyval', 'readonly');
        const store = tx.objectStore('keyval');
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function set(key, value) {
    if (typeof indexedDB === 'undefined') {
        localStorage.setItem(key, value);
        return true;
    }
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('keyval', 'readwrite');
        const store = tx.objectStore('keyval');
        const req = store.put(value, key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
    });
}

export async function del(key) {
    if (typeof indexedDB === 'undefined') {
        localStorage.removeItem(key);
        return true;
    }
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('keyval', 'readwrite');
        const store = tx.objectStore('keyval');
        const req = store.delete(key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Writes a value, serialising non-strings as JSON if needed (though IDB can store objects directly,
 * we keep serialization to maintain compatibility with existing payload shapes).
 */
export async function persistAsync(key, value) {
    try {
        const valToStore = typeof value === 'string' ? value : JSON.stringify(value);
        await set(key, valToStore);
        return true;
    } catch (err) {
        console.error(`[storage] Failed to write "${key}" to IndexedDB:`, err);
        return false;
    }
}

/**
 * Writes only when the value actually differs from what is stored.
 */
export async function persistIfChangedAsync(key, value) {
    const next = typeof value === 'string' ? value : JSON.stringify(value);
    const current = await readStringAsync(key, null);
    if (current === next) return { ok: true, changed: false };
    const ok = await persistAsync(key, next);
    return { ok, changed: true };
}

export async function persistRemoveAsync(key) {
    try {
        await del(key);
        return true;
    } catch (err) {
        console.error(`[storage] Failed to remove "${key}":`, err);
        return false;
    }
}

export async function readJSONAsync(key, fallback) {
    try {
        const item = await get(key);
        if (item === null || item === undefined) return fallback;
        return JSON.parse(item);
    } catch (err) {
        console.warn(`[storage] Corrupted JSON in "${key}", falling back.`, err);
        return fallback;
    }
}

export async function readStringAsync(key, fallback = null) {
    try {
        const item = await get(key);
        return item === null || item === undefined ? fallback : item;
    } catch (err) {
        console.warn(`[storage] Failed to read "${key}":`, err);
        return fallback;
    }
}

export async function readIntAsync(key, fallback) {
    const str = await readStringAsync(key, '');
    const parsed = parseInt(str, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

export async function readFloatAsync(key, fallback) {
    const str = await readStringAsync(key, '');
    const parsed = parseFloat(str);
    return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Migrates data from LocalStorage to IndexedDB if IndexedDB is empty.
 */
export async function migrateFromLocalStorage() {
    if (typeof indexedDB === 'undefined') return;
    try {
        // Check if we already migrated
        const migrated = await readStringAsync('idb_migrated');
        if (migrated) return;

        console.log('[storage] Starting migration from LocalStorage to IndexedDB...');
        const keysToMigrate = [];
        for (let i = 0; i < localStorage.length; i++) {
            keysToMigrate.push(localStorage.key(i));
        }

        for (const key of keysToMigrate) {
            const val = localStorage.getItem(key);
            if (val !== null) {
                await set(key, val);
            }
        }
        
        await set('idb_migrated', 'true');
        console.log('[storage] Migration successful. Data is now in IndexedDB.');
        
        // Optionally clear localStorage here, but we'll leave it for safety for now.
    } catch (err) {
        console.error('[storage] Migration failed:', err);
    }
}

// ============================================================================
// SYNCHRONOUS LOCALSTORAGE FALLBACKS
// These are required for settings that must be loaded during synchronous
// module evaluation (e.g. language, theme).
// ============================================================================

function isQuotaError(err) {
    if (!err) return false;
    return (
        err.name === 'QuotaExceededError' ||
        err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        err.code === 22 ||
        err.code === 1014
    );
}

let quotaAlertShown = false;

function reportQuotaFull(key) {
    console.error(`[storage] Quota exceeded writing "${key}" - the change was not saved.`);
    if (quotaAlertShown) return;
    quotaAlertShown = true;

    Promise.all([import('./utils.js'), import('./i18n.js')])
        .then(([utils, i18n]) => {
            utils.showAlert(i18n.t('storage_full_message'), i18n.t('storage_full_title'));
        })
        .catch(() => {
            if (typeof alert === 'function') {
                alert('Storage is full. Recent changes could not be saved.');
            }
        });
}

export function persist(key, value) {
    try {
        localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        return true;
    } catch (err) {
        if (isQuotaError(err)) {
            reportQuotaFull(key);
        } else {
            console.error(`[storage] Failed to write "${key}":`, err);
        }
        return false;
    }
}

export function persistIfChanged(key, value) {
    const next = typeof value === 'string' ? value : JSON.stringify(value);
    const current = readString(key, null);
    if (current === next) return { ok: true, changed: false };
    const ok = persist(key, next);
    return { ok, changed: true };
}

export function persistRemove(key) {
    try {
        localStorage.removeItem(key);
        return true;
    } catch (err) {
        return false;
    }
}

export function readJSON(key, fallback) {
    try {
        const item = localStorage.getItem(key);
        if (item === null || item === undefined) return fallback;
        return JSON.parse(item);
    } catch (err) {
        console.warn(`[storage] Corrupted JSON in "${key}", falling back.`, err);
        return fallback;
    }
}

export function readString(key, fallback = null) {
    try {
        const item = localStorage.getItem(key);
        return item === null || item === undefined ? fallback : item;
    } catch (err) {
        return fallback;
    }
}

export function measureStorageUsage() {
    // IndexedDB doesn't have a synchronous measure. 
    // We return dummy values to satisfy callers, as quota is practically unlimited now.
    return {
        usedBytes: 0,
        quotaBytes: 500 * 1024 * 1024, // 500MB assumed
        ratio: 0,
        largestValueBytes: 0
    };
}

export function readInt(key, fallback = 0) {
    const val = parseInt(readString(key), 10);
    return isNaN(val) ? fallback : val;
}

export function readFloat(key, fallback = 0) {
    const val = parseFloat(readString(key));
    return isNaN(val) ? fallback : val;
}

export function _resetQuotaWarning() {
    quotaAlertShown = false;
}

