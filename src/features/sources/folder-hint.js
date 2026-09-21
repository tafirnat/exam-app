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
 * A hint is consumed once, at import. Nothing downstream reads it: it is not
 * kept on the source, and no sync path looks at it, so a set the user later
 * moves stays where they put it. What travels afterwards is the folder the set
 * is actually in, and only when the person sharing it asks for that.
 *
 * Two devices importing sets with the same hint before they sync must not end
 * up with two folders of one name. Folders merge by id, so the id of a folder
 * created from a hint is DERIVED from the name: both devices write the same
 * record and the merge collapses it. When that id is tombstoned (the user
 * deleted the folder once), the next free `_2`, `_3`... is taken - also
 * deterministic, since tombstones sync too.
 */
import { AppState, saveFolders, touch, UNCATEGORIZED_FOLDER_ID } from '../../core/state.js';

/* Twelve slots, each the most saturated colour on its hue that clears 3:1
   against both app surfaces - see showFolderManageModal for how they were
   chosen. Lives here so the picker and the hint draw from one list. */
export const FOLDER_COLORS = Object.freeze([
    '#ff0053', '#f75a00', '#ca8400', '#929b00', '#27ac00', '#00a97a',
    '#00a2b9', '#0098fe', '#0667ff', '#8a43ff', '#d200fe', '#ff00b7'
]);

const HINT_ID_PREFIX = 'folder_hint_';
const MAX_HINT_LENGTH = 80;

/**
 * The hint as written, trimmed, or null when there is none worth acting on.
 * `folder` may also be an object `{ name }` - accepted because an AI asked for
 * "a folder" reaches for that shape as readily as for a string.
 */
export function readFolderHint(data) {
    const raw = data?.exam_metadata?.folder ?? data?.folder;
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

/** The id a folder created from this hint gets, before tombstones are considered. */
export function hintFolderBaseId(name) {
    const key = folderNameKey(name).replace(/ /g, '_').slice(0, 60);
    return HINT_ID_PREFIX + (key || 'folder');
}

function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
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

/**
 * The live folder a hint points at, if the library already has one.
 * Archived folders do not count: placing a new set there would archive it on
 * arrival (reconcileSourceFolder), which is not what "put it in this folder"
 * means. The system folder does not count either.
 */
export function findFolderForHint(name, folders = AppState.folders) {
    const key = folderNameKey(name);
    if (!key) return null;
    const matches = (folders || []).filter(f =>
        f && !f.archived && !f.isSystem && f.id !== UNCATEGORIZED_FOLDER_ID &&
        folderNameKey(f.name) === key
    );
    if (matches.length === 0) return null;
    // Several already (e.g. made by hand before): the derived one first, since
    // that is where the other device's hint lands too; then the list order.
    const baseId = hintFolderBaseId(name);
    return matches.find(f => f.id === baseId)
        || [...matches].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
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
