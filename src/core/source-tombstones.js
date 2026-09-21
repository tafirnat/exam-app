/**
 * Source deletions that can be undone.
 *
 * `deletedSourceIds` is a plain list and merged as a union, so an id in it was
 * gone for good: nothing ever took one out. That was invisible while every
 * import minted a fresh id. It is not invisible for a data set that names its
 * own id (`exam_metadata.id`, every file the Obsidian plugin syncs): delete it
 * once and importing the same file again produced a set that the next sync
 * dropped without a word - on every device, whichever way it came back.
 *
 * So deleting and bringing back are both dated (id -> ms):
 *   - `deletedSourceAt`   when the set was deleted (by hand, or by a reset);
 *   - `revivedSourceAt`   when it was deliberately brought back - imported
 *                         again, or dragged out of the vault's Deleted/ folder.
 * The later of the two wins. An entry in the legacy list with no date counts as
 * deleted at time 0, so any deliberate revival outlives it - which is also what
 * keeps a device still running an older build (whose list carries the id back
 * on every push) from undoing a revival.
 *
 * The list stays the thing other readers look at (the Obsidian plugin, older
 * builds, every "is this source deleted" check in the merge); it is rebuilt from
 * the rule on every merge, so a revived id leaves it everywhere.
 */
import { mergeFolderDeletions } from './folder-tombstones.js';

/** id -> ms maps merge like dated folder deletions: latest per id, sorted. */
export const mergeDatedIds = mergeFolderDeletions;

/** Whether a source with this id counts as deleted. */
export function isSourceDeleted(id, deletedIds, deletedAt = {}, revivedAt = {}) {
    if (!id) return false;
    const at = Number(deletedAt?.[id]) || 0;
    const listed = Array.isArray(deletedIds) && deletedIds.includes(id);
    if (!listed && at <= 0) return false;
    return !((Number(revivedAt?.[id]) || 0) > at);
}

/**
 * The combined tombstone state of several sides (remote, local, memory...).
 * @param {{ lists?: string[][], deletedAt?: object[], revivedAt?: object[] }} sides
 * @returns {{ deletedSourceIds: string[], deletedSourceAt: object, revivedSourceAt: object }}
 */
export function resolveSourceTombstones({ lists = [], deletedAt = [], revivedAt = [] } = {}) {
    const deletedSourceAt = mergeDatedIds(...deletedAt);
    const revivedSourceAt = mergeDatedIds(...revivedAt);
    const listed = new Set();
    lists.forEach(list => (Array.isArray(list) ? list : []).forEach(id => { if (id) listed.add(id); }));
    Object.keys(deletedSourceAt).forEach(id => listed.add(id));
    const all = [...listed];
    const deletedSourceIds = all.filter(id => isSourceDeleted(id, all, deletedSourceAt, revivedSourceAt));
    return { deletedSourceIds, deletedSourceAt, revivedSourceAt };
}
