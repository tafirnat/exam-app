/**
 * e-Reader library organisation (R2-11): folders, manual order, archive.
 * Pure - no DOM, no storage.
 *
 * The organisation is NOT stored on the books: moving or reordering twenty
 * books would otherwise rewrite and re-upload twenty full books. It is a
 * small "library map" kept next to the reading progress and synced in the
 * index file:
 *
 *   { books:   { [bookId]: { folderId, order, archived, at } },
 *     folders: { [folderId]: { name, order, deleted, at } } }
 *
 * Every entry carries its own time, so two devices merge entry by entry
 * (mergeLibraryMaps); a deleted folder stays as a stamped tombstone so it
 * does not come back from the other device.
 */

export const UNCATEGORIZED = '__uncategorized__';

/**
 * Pure. Manually ordered books first, in their order; the rest after them,
 * most recently read / changed first (the library's old order).
 */
export function orderBooks(books, progressOf = () => null) {
    const recent = (b) => Math.max(progressOf(b.id)?.at || 0, 0);
    return [...books].sort((a, b) => {
        const ao = Number.isFinite(a.order);
        const bo = Number.isFinite(b.order);
        if (ao && bo && a.order !== b.order) return a.order - b.order;
        if (ao !== bo) return ao ? -1 : 1;
        const ra = recent(a);
        const rb = recent(b);
        if (ra !== rb) return rb - ra;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
}

export function emptyLibraryMap() {
    return { books: {}, folders: {} };
}

/** Pure. A map read from storage or the network, with anything malformed dropped. */
export function normalizeLibraryMap(map) {
    const out = emptyLibraryMap();
    const src = map && typeof map === 'object' ? map : {};
    for (const [id, e] of Object.entries(src.books && typeof src.books === 'object' ? src.books : {})) {
        if (!id || !e || typeof e !== 'object') continue;
        out.books[id] = {
            folderId: typeof e.folderId === 'string' && e.folderId ? e.folderId : null,
            order: Number.isFinite(e.order) ? e.order : null,
            archived: e.archived === true,
            at: Number.isFinite(e.at) ? e.at : 0
        };
    }
    for (const [id, f] of Object.entries(src.folders && typeof src.folders === 'object' ? src.folders : {})) {
        if (!id || !f || typeof f !== 'object') continue;
        out.folders[id] = {
            name: typeof f.name === 'string' ? f.name : '',
            order: Number.isFinite(f.order) ? f.order : 0,
            deleted: f.deleted === true,
            at: Number.isFinite(f.at) ? f.at : 0
        };
    }
    return out;
}

/** Pure. Entry by entry, the later `at` wins (a tie keeps `a`). */
export function mergeLibraryMaps(a, b, { tombstones = {} } = {}) {
    const x = normalizeLibraryMap(a);
    const y = normalizeLibraryMap(b);
    const out = emptyLibraryMap();
    for (const kind of ['books', 'folders']) {
        const ids = new Set([...Object.keys(x[kind]), ...Object.keys(y[kind])]);
        for (const id of ids) {
            if (kind === 'books' && tombstones[id]) continue;
            const ea = x[kind][id];
            const eb = y[kind][id];
            out[kind][id] = !ea ? { ...eb } : (!eb || ea.at >= eb.at ? { ...ea } : { ...eb });
        }
    }
    return out;
}

/** Pure. The live folders of a map, in their order: [{ id, name, order }]. */
export function foldersOf(map) {
    const m = normalizeLibraryMap(map);
    return Object.entries(m.folders)
        .filter(([, f]) => !f.deleted)
        .sort((p, q) => p[1].order - q[1].order || p[1].at - q[1].at)
        .map(([id, f]) => ({ id, name: f.name, order: f.order }));
}

/**
 * Pure. Groups the (non-archived, unless `archived`) books by folder:
 * [{ folder, books }]. With no folders at all there is one group without a
 * header (folder: null); otherwise uncategorized books come last under their
 * own group, shown only when it has books.
 */
export function groupBooks(books, folders, { progressOf = () => null, archived = false } = {}) {
    const visible = books.filter(b => (b.archived === true) === archived);
    if (archived || folders.length === 0) {
        return [{ folder: null, books: orderBooks(visible, progressOf) }];
    }
    const ids = new Set(folders.map(f => f.id));
    const groups = folders.map(folder => ({
        folder: { ...folder },
        books: orderBooks(visible.filter(b => b.folderId === folder.id), progressOf)
    }));
    /* A book whose folder was deleted (here or on another device) is loose. */
    const loose = visible.filter(b => !b.folderId || !ids.has(b.folderId));
    if (loose.length > 0) {
        groups.push({ folder: { id: UNCATEGORIZED, name: '', uncategorized: true }, books: orderBooks(loose, progressOf) });
    }
    return groups;
}

/**
 * Pure. `ids` with `draggedId` moved before / after `targetId` (appended when
 * the target is not in the list).
 */
export function moveId(ids, draggedId, targetId, mode = 'before') {
    const rest = ids.filter(id => id !== draggedId);
    const at = rest.indexOf(targetId);
    if (at < 0) return [...rest, draggedId];
    rest.splice(mode === 'after' ? at + 1 : at, 0, draggedId);
    return rest;
}

export function newFolderId() {
    return 'efolder_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Pure. A book as an importable e-Reader file (the format the AI prompt
 * produces), so a download can be imported again here or elsewhere.
 */
export function exportBookJson(book) {
    const parts = Array.isArray(book.parts) ? book.parts.filter(p => p && Number.isInteger(p.from) && Number.isInteger(p.to)) : [];
    const ereader = {
        schema: 1,
        book_key: book.bookKey || undefined,
        title: book.title || '',
        author: book.author || '',
        language: book.language || 'und',
        source_type: book.sourceType || 'other'
    };
    if (parts.length > 0 && parts[0].unit === 'page') {
        const from = Math.min(...parts.map(p => p.from));
        const to = Math.max(...parts.map(p => p.to));
        const total = Math.max(to, ...parts.map(p => (Number.isInteger(p.total) ? p.total : to)));
        ereader.part = { unit: 'page', from, to, total };
    }
    const sections = (book.sections || []).map(s => {
        const out = { id: s.id, title: s.title || '', level: s.level || 1, text: s.text || '' };
        if (Number.isInteger(s.pageStart)) out.page_start = s.pageStart;
        return out;
    });
    return { ereader, sections };
}

/** Pure. A file name for a book download. */
export function bookFileName(title) {
    const base = String(title || 'book')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 80);
    return `${base || 'book'}.ereader.json`;
}
