/**
 * Dated folder deletions.
 *
 * `deletedFolderIds` is a plain list and merges as a union, so a deletion there
 * wins against everything, forever. That was tolerable while a folder was only
 * ever deleted by hand. It stops being tolerable once empty folders are removed
 * automatically (features/sources/empty-folders.js): a device can only judge
 * "empty" from what it has seen, and another device may have put a source into
 * that folder a minute before - the union would then delete a folder in use and
 * drop its source into "Uncategorized" on every device.
 *
 * So new deletions carry the time they were made (`deletedFolderAt`, id -> ms)
 * and a folder outlives its deletion when either
 *   - the folder itself was written after it (renamed, recoloured, or created
 *     again under the same id - a folder hint derives its id from the name), or
 *   - any source in the merged library still belongs to it.
 *
 * The second rule does not compare times, and that is deliberate. Sources merge
 * first, newest copy winning, so a reference that survives the source merge is
 * already the latest word on where that source lives. Asking it to be newer than
 * the deletion as well would lose exactly the case this exists for: the source
 * was moved in *before* the deletion, by a device the deleting one had not yet
 * heard from.
 *
 * The legacy list is left as it is and still wins outright: those deletions
 * carry no time, and reading them as time 0 would let any old copy of a folder
 * bring it back.
 */

/** Whether a source belongs to the folder, archived members included. */
export function sourceBelongsToFolder(source, folderId) {
    if (!source || !folderId) return false;
    return source.folderId === folderId || source.archivedFrom?.folderId === folderId;
}

/**
 * Whether `folder` survives a dated deletion.
 * @param {object} folder
 * @param {number} deletedAt  ms; 0 / missing means "no dated deletion"
 * @param {object[]} sources  the merged library
 */
export function folderOutlivesDeletion(folder, deletedAt, sources = []) {
    if (!folder || !folder.id) return false;
    const at = Number(deletedAt) || 0;
    if (at <= 0) return true;
    if ((Number(folder.updatedAt) || 0) > at) return true;
    return (sources || []).some(s => sourceBelongsToFolder(s, folder.id));
}

/** Keeps only well-formed entries: string id -> positive finite ms. */
export function sanitizeFolderDeletions(map) {
    const out = {};
    if (!map || typeof map !== 'object' || Array.isArray(map)) return out;
    for (const [id, at] of Object.entries(map)) {
        const n = Number(at);
        if (id && Number.isFinite(n) && n > 0) out[id] = n;
    }
    return out;
}

/**
 * Union of the maps, keeping the latest deletion per id: a folder deleted,
 * brought back and deleted again is judged by the second deletion. Keys are
 * sorted so two devices holding the same deletions serialise them identically -
 * a pure ordering difference would otherwise read as a change and push.
 */
export function mergeFolderDeletions(...maps) {
    const merged = {};
    maps.forEach(m => {
        for (const [id, at] of Object.entries(sanitizeFolderDeletions(m))) {
            if (!(id in merged) || at > merged[id]) merged[id] = at;
        }
    });
    const sorted = {};
    Object.keys(merged).sort().forEach(id => { sorted[id] = merged[id]; });
    return sorted;
}
