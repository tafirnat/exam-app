/**
 * e-Reader library organisation (R2-11): folders, manual order, archive.
 * Pure - no DOM, no storage.
 *
 * A book carries folderId (+ folderName, so a device that does not have the
 * folder yet can still show it by name), order and archived. The folder list
 * itself is device-local.
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

/**
 * Pure. The folders to show: the local ones in their order, then any folder a
 * book names that this device does not know yet.
 */
export function knownFolders(folders, books) {
    const list = folders.map(f => ({ ...f }));
    const ids = new Set(list.map(f => f.id));
    for (const b of books) {
        if (b.folderId && !ids.has(b.folderId)) {
            ids.add(b.folderId);
            list.push({ id: b.folderId, name: b.folderName || b.folderId, order: list.length, collapsed: false, remote: true });
        }
    }
    return list;
}

/**
 * Pure. Groups the (non-archived, unless `archived`) books by folder:
 * [{ folder, books }]. With no folders at all there is one group without a
 * header (folder: null); otherwise uncategorized books come last under their
 * own group, shown only when it has books.
 */
export function groupBooks(books, folders, { progressOf = () => null, archived = false } = {}) {
    const visible = books.filter(b => (b.archived === true) === archived);
    const all = knownFolders(folders, books);
    if (archived || all.length === 0) {
        return [{ folder: null, books: orderBooks(visible, progressOf) }];
    }
    const ids = new Set(all.map(f => f.id));
    const groups = all.map(folder => ({
        folder,
        books: orderBooks(visible.filter(b => b.folderId === folder.id), progressOf)
    }));
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
