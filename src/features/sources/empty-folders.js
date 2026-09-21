/**
 * Empty folders remove themselves - after a grace period, not the moment they
 * empty. Emptying a folder is usually the middle of something (moving sources
 * around, deleting one to import a newer copy, creating a folder to fill it
 * next), so a folder is only removed once it has stayed empty for
 * EMPTY_FOLDER_GRACE_MS.
 *
 * No timer carries that wait. "Empty since" is written to storage the first time
 * the sweep sees the folder empty, and the sweep simply asks whether that moment
 * is old enough. So the same rule covers a folder that empties while the app is
 * open (a later sweep removes it) and one the user left empty before closing
 * the app for three hours (the sweep at boot removes it at once) - a setTimeout
 * would die with the tab and need a second code path at boot.
 *
 * The stamp is this device's own observation and is not synced. What syncs is
 * the deletion, dated, so a device that meanwhile put a source into the folder
 * keeps it - see core/folder-tombstones.js.
 *
 * "Empty" counts archived members: an archived source keeps its folder in
 * `archivedFrom`, and removing the folder would leave the restore with nowhere
 * to go. The system folder and archived folders are never swept.
 */
import { AppState, saveFolders, trackDeletedFolder, UNCATEGORIZED_FOLDER_ID } from '../../core/state.js';
import { persistIfChanged, readJSON } from '../../core/storage.js';
import { sourceBelongsToFolder } from '../../core/folder-tombstones.js';
import { subscribe, Slice } from '../../core/store.js';
import { showToast } from '../../core/utils.js';
import { t } from '../../core/i18n.js';

export const EMPTY_FOLDER_GRACE_MS = 10 * 60 * 1000;
export const EMPTY_SINCE_KEY = 'focus_app_folder_empty_since';
const SWEEP_INTERVAL_MS = 60 * 1000;

function isSweepable(folder) {
    return !!folder && !!folder.id && !folder.isSystem && !folder.archived
        && folder.id !== UNCATEGORIZED_FOLDER_ID;
}

export function isFolderEmpty(folderId, sources = AppState.sources) {
    return !(sources || []).some(s => sourceBelongsToFolder(s, folderId));
}

/**
 * A dialog is open: the user may be holding one of these folders (editing it,
 * picking it as a move target), and removing it underneath would turn their
 * next click into a write to a folder that no longer exists. Waiting costs
 * nothing - the sweep runs again on the next change or the next minute.
 */
function userIsInADialog() {
    if (typeof document === 'undefined') return false;
    return !!document.querySelector('.modal-overlay.active');
}

/**
 * Removes the folders that have been empty for the grace period, and keeps the
 * "empty since" record in step with what it sees.
 * @param {{ now?: number, notify?: boolean, force?: boolean }} [options]
 *        `force` ignores an open dialog (tests, and nothing else).
 * @returns {object[]} the removed folders
 */
export function sweepEmptyFolders({ now = Date.now(), notify = true, force = false } = {}) {
    if (!Array.isArray(AppState.folders)) return [];
    if (!force && userIsInADialog()) return [];

    const prev = readJSON(EMPTY_SINCE_KEY, {});
    const since = {};
    const removed = [];

    AppState.folders.forEach(folder => {
        if (!isSweepable(folder) || !isFolderEmpty(folder.id)) return;
        const seen = Number(prev?.[folder.id]);
        const emptySince = Number.isFinite(seen) && seen > 0 ? seen : now;
        // A folder written since (renamed, recoloured, just created) is being
        // organised right now: the wait starts again from that edit.
        const quietSince = Math.max(emptySince, Number(folder.updatedAt) || 0);
        if (now - quietSince >= EMPTY_FOLDER_GRACE_MS) {
            removed.push(folder);
        } else {
            since[folder.id] = emptySince;
        }
    });

    // Folders that filled up again or no longer exist simply drop out of the record.
    persistIfChanged(EMPTY_SINCE_KEY, since);
    if (removed.length === 0) return removed;

    const ids = new Set(removed.map(f => f.id));
    AppState.folders = AppState.folders.filter(f => !ids.has(f.id));
    removed.forEach(f => trackDeletedFolder(f.id, now));
    saveFolders();

    if (notify) {
        showToast(removed.length === 1
            ? t('empty_folder_removed', { name: removed[0].name })
            : t('empty_folders_removed', { count: removed.length }));
    }
    return removed;
}

let intervalId = null;

/**
 * Called once from boot, after initState(). Sweeps now - that is where a folder
 * left empty in an earlier session goes - then whenever the library changes,
 * and once a minute so a folder emptied while nothing else happens still goes.
 */
export function initEmptyFolderSweep() {
    sweepEmptyFolders();
    subscribe('folders:emptySweep', [Slice.SOURCES, Slice.FOLDERS], () => sweepEmptyFolders());
    if (intervalId === null && typeof setInterval === 'function') {
        intervalId = setInterval(() => sweepEmptyFolders(), SWEEP_INTERVAL_MS);
        // Node (tests) only: the tick must not keep the process alive.
        intervalId?.unref?.();
    }
}
