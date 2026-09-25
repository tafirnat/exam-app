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

/* ==========================================================================
   WHERE EACH KEY LIVES
   ---------------------------------------------------------------------------
   Two stores, and every key belongs to exactly one of them.

   IndexedDB holds the bulk - the library, stats, study activity - which is what
   outgrew localStorage's ~5 MB. localStorage holds the small values something
   has to read *synchronously*: session and sync state checked on every paint of
   the home screen, tombstones and reset stamps, language and theme needed
   during module evaluation. Keeping those in localStorage is the point, not a
   leftover: a synchronous read is only fast if it is also current.

   What broke after the move to IndexedDB was not either store but keys living
   in both. The async API wrote to IndexedDB and the sync API to localStorage,
   and several keys went through both - so a value written down one path was
   read back up the other. Measured in a real browser: logging out removed the
   token from localStorage, boot read it from IndexedDB, and the next reload was
   logged in again; finishing a test tombstoned the session in IndexedDB while
   the resume button read the live copy from localStorage and kept offering it.

   So the async API routes by this table: a key listed here is read and written
   in localStorage whichever API is used, everything else goes to IndexedDB. The
   sync API can only ever reach localStorage, so any key used through it must be
   listed - tests/storage-homes.test.mjs checks every call site.
   ========================================================================== */

export const LOCAL_KEYS = Object.freeze(new Set([
    // Unfinished test: read on every paint of the home screen and by the sync
    // payload.
    'focus_app_active_test',
    'focus_app_current_source',
    // GitHub connection and sync health, written by github-sync.js.
    'focus_app_github_token',
    'focus_app_github_gist_id',
    'focus_app_github_gist_url',
    'focus_app_github_user',
    'focus_app_last_github_user',
    'focus_app_last_sync',
    'focus_app_sync_failures',
    'focus_app_sync_failure_kind',
    // Tombstones and reset stamps: written by the pull, read at boot. Losing one
    // brings a deleted thing back.
    'focus_app_deleted_sources',
    'focus_app_deleted_source_at',
    'focus_app_revived_source_at',
    'focus_app_deleted_folders',
    'focus_app_deleted_folder_at',
    'focus_app_deleted_quick_presets',
    'focus_app_deleted_ai_prompts',
    'focus_app_last_reset',
    'focus_app_last_progress_reset',
    // Settings read before or outside initState().
    'focus_app_lang',
    'focus_app_target_lang',
    'focus_app_translation_enabled',
    'focus_theme',
    // One-off flags and small per-device caches.
    'focus_app_sample_loaded',
    'exam_app_onboarding_completed',
    'focus_app_folder_empty_since',
    'focus_app_quota_notice_date',
    'focus_app_folder_palette_v3',
    'focus_app_ai_prompts_seeded',
    'motivation_cache',
    'motivation_lang',
    // Pre-FSRS keys that migration.js reads and retires.
    'focusAppSavedJSON',
    'focusAppSources',
    'focusAppStats',
    // Marks the one-off split repair below as done.
    'focus_app_key_homes_settled'
]));

/** Legacy per-source keys migration.js reads by prefix. */
const LOCAL_KEY_PREFIXES = Object.freeze(['focusAppData_']);

/** True when this key's home is localStorage rather than IndexedDB. */
export function isLocalKey(key) {
    const k = String(key);
    return LOCAL_KEYS.has(k) || LOCAL_KEY_PREFIXES.some(prefix => k.startsWith(prefix));
}

/* Tests have no IndexedDB (jsdom does not provide one), and without it every
   key falls back to localStorage - one store, so a split cannot even be
   expressed. A test that needs two real stores installs a stand-in here. */
let idbBackendForTests = null;
export function _setIdbBackendForTests(backend) {
    idbBackendForTests = backend;
}

function hasIndexedDB() {
    return !!idbBackendForTests || typeof indexedDB !== 'undefined';
}

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
    if (idbBackendForTests) return idbBackendForTests.get(key);
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
    if (idbBackendForTests) return idbBackendForTests.set(key, value);
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
    if (idbBackendForTests) return idbBackendForTests.del(key);
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
    if (isLocalKey(key)) return persist(key, value);
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
    if (isLocalKey(key)) return persistIfChanged(key, value);
    const next = typeof value === 'string' ? value : JSON.stringify(value);
    const current = await readStringAsync(key, null);
    if (current === next) return { ok: true, changed: false };
    const ok = await persistAsync(key, next);
    return { ok, changed: true };
}

export async function persistRemoveAsync(key) {
    if (isLocalKey(key)) return persistRemove(key);
    try {
        await del(key);
        return true;
    } catch (err) {
        console.error(`[storage] Failed to remove "${key}":`, err);
        return false;
    }
}

export async function readJSONAsync(key, fallback) {
    if (isLocalKey(key)) return readJSON(key, fallback);
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
    if (isLocalKey(key)) return readString(key, fallback);
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
    if (!hasIndexedDB()) return;
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
            // A key whose home is localStorage stays there; a copy in IndexedDB
            // is exactly the second home settleKeyHomes() exists to remove.
            if (isLocalKey(key)) continue;
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

/* How a key that ended up with two different values - one per store - is
   settled into one. Each rule follows the key's own meaning, so the repair is
   the one the sync merge would have made. */
const LOCAL_COPY_WINS = new Set([
    // Written only by github-sync.js, which always used localStorage; the
    // IndexedDB copy is the one-off migration snapshot. localStorage wins even
    // when it has nothing - that absence is a logout.
    'focus_app_github_token',
    'focus_app_github_gist_id',
    'focus_app_github_gist_url',
    'focus_app_github_user',
    'focus_app_last_github_user',
    'focus_app_last_sync',
    'focus_app_sync_failures',
    'focus_app_sync_failure_kind'
]);
const UNION_LISTS = new Set([
    'focus_app_deleted_sources',
    'focus_app_deleted_folders',
    'focus_app_deleted_quick_presets',
    'focus_app_deleted_ai_prompts'
]);
const LATEST_PER_ID = new Set([
    'focus_app_deleted_source_at',
    'focus_app_revived_source_at',
    'focus_app_deleted_folder_at'
]);
const LARGEST_NUMBER = new Set(['focus_app_last_reset', 'focus_app_last_progress_reset']);
const NEWEST_RECORD = new Set(['focus_app_active_test']);

const isAbsent = value => value === null || value === undefined;

/**
 * The single value a localStorage key keeps when IndexedDB also holds one.
 * Raw stored strings in, raw string (or null for "remove") out.
 *
 * Everything not named above takes the IndexedDB value: those keys were written
 * there by state.js's save functions and read from there at boot, so it is the
 * value the app has actually been running on.
 */
export function resolveSplitValue(key, localRaw, idbRaw) {
    if (isAbsent(idbRaw)) return isAbsent(localRaw) ? null : localRaw;
    if (LOCAL_COPY_WINS.has(key)) return isAbsent(localRaw) ? null : localRaw;
    if (isAbsent(localRaw) || localRaw === idbRaw) return idbRaw;

    try {
        if (UNION_LISTS.has(key)) {
            const a = JSON.parse(localRaw);
            const b = JSON.parse(idbRaw);
            if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify([...new Set([...a, ...b])]);
        } else if (LATEST_PER_ID.has(key)) {
            const a = JSON.parse(localRaw) || {};
            const b = JSON.parse(idbRaw) || {};
            const merged = { ...a };
            Object.entries(b).forEach(([id, at]) => {
                if (!(Number(merged[id]) >= Number(at))) merged[id] = at;
            });
            return JSON.stringify(merged);
        } else if (LARGEST_NUMBER.has(key)) {
            const a = Number(localRaw) || 0;
            const b = Number(idbRaw) || 0;
            return String(Math.max(a, b));
        } else if (NEWEST_RECORD.has(key)) {
            const a = JSON.parse(localRaw);
            const b = JSON.parse(idbRaw);
            return (Number(a?.updatedAt) || 0) > (Number(b?.updatedAt) || 0) ? localRaw : idbRaw;
        }
    } catch (err) {
        console.warn(`[storage] Could not merge the two copies of "${key}", keeping the IndexedDB one.`, err);
    }
    return idbRaw;
}

/**
 * One-off repair for installs that ran the build where some keys lived in both
 * stores: settles each localStorage-homed key to one value and removes its
 * IndexedDB copy, so nothing can read the stale half again. Runs from
 * initState(), after migrateFromLocalStorage() and before anything is read.
 *
 * Without a real IndexedDB there is no second store - every "IndexedDB" read
 * falls through to localStorage - and "removing the IndexedDB copy" would
 * delete the only one. Hence the guard.
 */
export async function settleKeyHomes() {
    if (!hasIndexedDB()) return;
    if (readString('focus_app_key_homes_settled')) return;
    try {
        for (const key of LOCAL_KEYS) {
            const idbRaw = await get(key);
            if (isAbsent(idbRaw)) continue;
            const localRaw = readString(key, null);
            const winner = resolveSplitValue(key, localRaw, idbRaw);
            const kept = winner === null ? persistRemove(key) : (winner === localRaw || persist(key, winner));
            // Only drop the IndexedDB copy once localStorage holds the answer.
            if (kept) await del(key);
        }
        persist('focus_app_key_homes_settled', String(Date.now()));
    } catch (err) {
        console.error('[storage] Settling key homes failed:', err);
    }
}

// ============================================================================
// SYNCHRONOUS API - localStorage only
// For keys that must be read synchronously (see LOCAL_KEYS). Any key used
// here has to be listed there, or the async API would send it to IndexedDB.
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

const BYTES_PER_CHAR = 2;
export const ASSUMED_QUOTA_BYTES = 5 * 1024 * 1024;

export function measureStorageUsage() {
    let usedBytes = 0;
    let largestValueBytes = 0;

    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key === null) continue;
            const value = localStorage.getItem(key) || '';
            usedBytes += (key.length + value.length) * BYTES_PER_CHAR;
            const valueBytes = value.length * BYTES_PER_CHAR;
            if (valueBytes > largestValueBytes) largestValueBytes = valueBytes;
        }
    } catch (err) {
        console.warn('[storage] Could not measure usage:', err);
        return { usedBytes: 0, quotaBytes: ASSUMED_QUOTA_BYTES, ratio: 0, largestValueBytes: 0 };
    }

    return {
        usedBytes,
        quotaBytes: ASSUMED_QUOTA_BYTES,
        ratio: usedBytes / ASSUMED_QUOTA_BYTES,
        largestValueBytes
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

