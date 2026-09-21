/**
 * The folder hint: `exam_metadata.folder` in a data set names the folder the
 * set would like to live in, by NAME.
 *
 * By name, never by id, because the file is written before any folder exists -
 * by a person or an AI that cannot know what id this library will give it. The
 * older `folderId` field asks exactly that of the author, and a file carrying a
 * foreign id quietly lands in the default folder (reconcileSourceFolder clears
 * ids it cannot find).
 *
 * A hint is spent once per set. A file imported by hand spends it at import
 * (processJSON). A set that arrives by sync - written into the vault and carried
 * to the Gist by the Obsidian plugin - never passes through an import, so the
 * sync path spends it instead: applyPendingFolderHints() places every set that
 * has no folder yet and marks it (`folderHintSpent`). The mark is what keeps a
 * set the user later moves - even back to "Uncategorized" - where they put it.
 *
 * Folder ids are fixed once given; renaming a folder never changes its id. The
 * id of a folder created from a hint is DERIVED from the hint - a short slug for
 * the eye plus a hash of the whole normalised name - so two devices importing
 * sets with the same hint before they sync write the same record and the merge
 * collapses it. The hash is what keeps two long names that share a prefix from
 * landing on one id.
 *
 * Lookup order: by name first; then by derived id, which finds the folder a
 * hint once created even after it was renamed (a hash match on a different name
 * is too unlikely to be anything but that folder); only then a new folder. When
 * the derived id carries a legacy (undated) tombstone, the next free `_2`,
 * `_3`... is taken - deterministic too, since tombstones sync. A dated deletion
 * does not reserve the id: the folder created again is written after it and so
 * outlives it (core/folder-tombstones.js).
 */
import { AppState, saveFolders, saveSources, touch, UNCATEGORIZED_FOLDER_ID } from '../../core/state.js';

/* Twelve slots, each the most saturated colour on its hue that clears 3:1
   against both app surfaces - see showFolderManageModal for how they were
   chosen. Lives here so the picker and the hint draw from one list. */
export const FOLDER_COLORS = Object.freeze([
    '#ff0053', '#f75a00', '#ca8400', '#929b00', '#27ac00', '#00a97a',
    '#00a2b9', '#0098fe', '#0667ff', '#8a43ff', '#d200fe', '#ff00b7'
]);

const HINT_ID_PREFIX = 'folder_hint_';
const MAX_HINT_LENGTH = 80;
const HINT_SLUG_LENGTH = 30;

/**
 * The hint as written, trimmed, or null when there is none worth acting on.
 * `folder` may also be an object `{ name }` - accepted because an AI asked for
 * "a folder" reaches for that shape as readily as for a string.
 */
export function readFolderHint(data) {
    // `metadata` is where the Obsidian plugin puts the envelope of a file it
    // unwrapped, so a synced set can carry the hint there too.
    const raw = data?.exam_metadata?.folder ?? data?.metadata?.folder ?? data?.folder;
    const name = typeof raw === 'string' ? raw : (raw && typeof raw.name === 'string' ? raw.name : '');
    const trimmed = name.replace(/\s+/g, ' ').trim().slice(0, MAX_HINT_LENGTH);
    return trimmed || null;
}

/**
 * What two folder names have to agree on to count as the same folder: case,
 * accents, dotless i and punctuation do not matter. "ITIL 4 Foundation",
 * "itil-4 foundation" and "İTİL 4 FOUNDATION" are one folder.
 */
export function folderNameKey(name) {
    if (typeof name !== 'string') return '';
    return name
        .replace(/ß/g, 'ss')
        .replace(/[ıİI]/g, 'i')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
}

/** FNV-1a, 32 bit, as 8 hex digits: the name part of a derived folder id. */
function nameHash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

/** The id a folder created from this hint gets, before tombstones are considered. */
export function hintFolderBaseId(name) {
    const key = folderNameKey(name);
    const slug = key.replace(/ /g, '_').slice(0, HINT_SLUG_LENGTH).replace(/_+$/, '');
    return `${HINT_ID_PREFIX}${slug || 'folder'}_${nameHash(key)}`;
}

/* The id the first build of this feature derived (slug only, 60 chars). Folders
   it created keep that id for good, so the id lookup has to know it too. */
function legacyHintFolderId(name) {
    const key = folderNameKey(name).replace(/ /g, '_').slice(0, 60);
    return HINT_ID_PREFIX + (key || 'folder');
}

/**
 * The least-used palette colour among the live folders. Ties are broken by the
 * name rather than at random, so two devices creating the same folder pick the
 * same colour and the merge has nothing to flip between. Never the default grey:
 * that one means "no folder".
 */
export function pickFolderColor(name, folders = AppState.folders) {
    const counts = new Map(FOLDER_COLORS.map(c => [c, 0]));
    (folders || []).forEach(f => {
        if (!f || f.archived || f.isSystem || f.id === UNCATEGORIZED_FOLDER_ID) return;
        const c = String(f.color || '').toLowerCase();
        if (counts.has(c)) counts.set(c, counts.get(c) + 1);
    });
    const min = Math.min(...counts.values());
    const leastUsed = FOLDER_COLORS.filter(c => counts.get(c) === min);
    return leastUsed[hashString(folderNameKey(name)) % leastUsed.length];
}

/** A folder a set can be placed in: live, not archived, not the default. */
function isPlaceable(f) {
    return !!f && !f.archived && !f.isSystem && f.id !== UNCATEGORIZED_FOLDER_ID;
}

/**
 * The live folder a hint points at, if the library already has one.
 * By name first. Failing that, by the id this hint derives: a folder a hint
 * created and the user then renamed still carries it.
 * Archived folders do not count: placing a new set there would archive it on
 * arrival (reconcileSourceFolder), which is not what "put it in this folder"
 * means. The system folder does not count either.
 */
export function findFolderForHint(name, folders = AppState.folders) {
    const key = folderNameKey(name);
    if (!key) return null;
    const list = (folders || []).filter(isPlaceable);
    const baseId = hintFolderBaseId(name);
    const matches = list.filter(f => folderNameKey(f.name) === key);
    if (matches.length > 0) {
        // Several already (e.g. made by hand before): the derived one first, since
        // that is where the other device's hint lands too; then the list order.
        return matches.find(f => f.id === baseId)
            || [...matches].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
    }
    const legacyId = legacyHintFolderId(name);
    return list.find(f => f.id === baseId) || list.find(f => f.id === legacyId) || null;
}

/**
 * The id a new folder for this hint takes: the derived one, or the first
 * `_n` after it that is neither tombstoned nor held by another folder.
 */
export function freeHintFolderId(name, folders = AppState.folders, deletedIds = AppState.deletedFolderIds) {
    const base = hintFolderBaseId(name);
    const taken = new Set([
        ...(deletedIds || []),
        ...(folders || []).map(f => f && f.id).filter(Boolean)
    ]);
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) {
        const id = `${base}_${n}`;
        if (!taken.has(id)) return id;
    }
}

/**
 * Resolves a hint to a folder id, creating the folder when the library has none
 * by that name. Returns null when there is no hint.
 * @returns {{ folderId: string, created: boolean } | null}
 */
export function applyFolderHint(name) {
    const hint = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
    if (!hint) return null;

    const existing = findFolderForHint(hint);
    if (existing) return { folderId: existing.id, created: false };

    if (!Array.isArray(AppState.folders)) AppState.folders = [];
    const folder = touch({
        id: freeHintFolderId(hint),
        name: hint,
        description: '',
        color: pickFolderColor(hint),
        order: AppState.folders.length
    });
    AppState.folders.push(folder);
    saveFolders();
    return { folderId: folder.id, created: true };
}

/**
 * Spends the hint of every set that arrived without passing through an import -
 * by sync, above all from the Obsidian plugin, which carries the file's
 * `exam_metadata.folder` to the Gist untouched.
 *
 * Once per set: the normalised hint is written to `folderHintSpent` and a set
 * carrying the same hint is never placed again, so a set the user moves - also
 * back to "Uncategorized" - stays moved. A set that already sits in a folder is
 * only marked, for the same reason. A hint that is edited in the file is a new
 * instruction and is followed once more, if the set has no folder by then.
 *
 * The marked set is stamped (touch): the mark has to travel with it, or the next
 * pull brings back the unmarked copy and this runs again on every device.
 *
 * Archived sets are left alone. There is no switch: a file that names its folder
 * is followed, whichever way it arrived.
 * @returns {number} how many sets were placed in a folder
 */
export function applyPendingFolderHints(sources = AppState.sources) {
    if (!Array.isArray(sources)) return 0;
    let placed = 0;
    let changed = false;
    sources.forEach(source => {
        if (!source || source.archived) return;
        const name = readFolderHint(source);
        const key = name ? folderNameKey(name) : '';
        if (!key || source.folderHintSpent === key) return;
        // A folderId naming no folder is no folder: reconcileSourceFolder would
        // clear it, and marking the set here would leave it unplaced for good.
        const inFolder = !!source.folderId && source.folderId !== UNCATEGORIZED_FOLDER_ID
            && (AppState.folders || []).some(f => f && f.id === source.folderId);
        if (!inFolder) {
            const result = applyFolderHint(name);
            if (!result) return;
            source.folderId = result.folderId;
            placed++;
        }
        source.folderHintSpent = key;
        touch(source);
        changed = true;
    });
    if (changed) saveSources();
    return placed;
}
