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

/* Browsers disagree on how a full-quota write reports itself. Chrome and Safari
   raise QuotaExceededError/22, Firefox NS_ERROR_DOM_QUOTA_REACHED/1014, and
   Safari in private mode throws on the very first write regardless of size. */
function isQuotaError(err) {
    if (!err) return false;
    return (
        err.name === 'QuotaExceededError' ||
        err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        err.code === 22 ||
        err.code === 1014
    );
}

/* Once the quota is full every subsequent write fails too. Alerting on each one
   would bury the user in dialogs, so only the first gets a dialog. */
let quotaAlertShown = false;

function reportQuotaFull(key) {
    console.error(`[storage] Quota exceeded writing "${key}" - the change was not saved.`);
    if (quotaAlertShown) return;
    quotaAlertShown = true;

    /* Dynamic so this module stays import-cycle free, and so a failure to load
       the UI layer can never mask the original storage failure. */
    Promise.all([import('./utils.js'), import('./i18n.js')])
        .then(([utils, i18n]) => {
            utils.showAlert(i18n.t('storage_full_message'), i18n.t('storage_full_title'));
        })
        .catch(() => {
            /* Last resort: the app's own dialog is unavailable, but the user
               still has to learn that their data is not being saved. */
            if (typeof alert === 'function') {
                alert('Storage is full. Recent changes could not be saved.');
            }
        });
}

/**
 * Writes a value, serialising non-strings as JSON.
 * @returns {boolean} true if the value reached localStorage.
 */
export function persist(key, value) {
    try {
        localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        return true;
    } catch (err) {
        if (isQuotaError(err)) {
            reportQuotaFull(key);
        } else {
            /* Private-browsing modes and disabled-storage settings land here.
               Nothing to do but keep the app running on in-memory state. */
            console.error(`[storage] Failed to write "${key}":`, err);
        }
        return false;
    }
}

/**
 * Writes only when the value actually differs from what is stored.
 *
 * Several renderers memoise a daily value into state and persist it as a side
 * effect of drawing - getDailyOverdueSnapshot() is one. With an unconditional
 * save that turns into a loop the moment saving also notifies the UI: render →
 * save → emit → render. Comparing first breaks the cycle at its source instead
 * of asking every such call site to remember not to write.
 *
 * The saved write and the skipped sync are the secondary benefit; the primary
 * one is that `changed` is honest.
 *
 * @returns {{ok: boolean, changed: boolean}}
 */
export function persistIfChanged(key, value) {
    const next = typeof value === 'string' ? value : JSON.stringify(value);
    if (readString(key, null) === next) return { ok: true, changed: false };
    return { ok: persist(key, next), changed: true };
}

/**
 * Removes a key. Never throws - a removal that fails leaves a stale value, which
 * every caller already tolerates better than an exception mid-reset.
 */
export function persistRemove(key) {
    try {
        localStorage.removeItem(key);
        return true;
    } catch (err) {
        console.error(`[storage] Failed to remove "${key}":`, err);
        return false;
    }
}

/**
 * Reads and parses a JSON value, falling back if the key is missing or the
 * stored text is corrupt.
 */
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

/** Reads a raw string value. */
export function readString(key, fallback = null) {
    try {
        const item = localStorage.getItem(key);
        return item === null || item === undefined ? fallback : item;
    } catch (err) {
        console.warn(`[storage] Failed to read "${key}":`, err);
        return fallback;
    }
}

/** Reads an integer, falling back when the key is missing or unparseable. */
export function readInt(key, fallback) {
    const parsed = parseInt(readString(key, ''), 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

/** Reads a float, falling back when the key is missing or unparseable. */
export function readFloat(key, fallback) {
    const parsed = parseFloat(readString(key, ''));
    return Number.isNaN(parsed) ? fallback : parsed;
}

/* Test seam: lets a suite assert the first-failure-only dialog behaviour
   without leaking state between cases. */
export function _resetQuotaWarning() {
    quotaAlertShown = false;
}
