/**
 * e-Reader library management (R2-11), the way the test centre manages its
 * sources: folders, moving books between them, manual order by drag and
 * drop, multi-select inside a folder with bulk actions, an archive, and the
 * per-book actions (edit metadata, download, share, print, delete, archive,
 * reset).
 *
 * Drag and drop follows sources-ui.js: a drag starts only from the grip, a
 * book dropped on a book goes before/after it (and into its folder), a book
 * dropped on a folder header goes into that folder, a folder dropped on a
 * folder reorders the folders.
 */

import { t } from '../../core/i18n.js';
import { showToast, showConfirm } from '../../core/utils.js';
import {
    listBooks, getBook, getProgress, updateBook, deleteBook, resetBookProgress,
    listFolders, saveFolders, setLibraryEntries
} from './ereader-store.js';
import {
    UNCATEGORIZED, groupBooks, moveId, newFolderId, exportBookJson, bookFileName
} from './ereader-folders.js';

const GRIP = '<svg width="16" height="24" viewBox="0 0 16 24" fill="currentColor"><circle cx="6" cy="6" r="1.5"/><circle cx="10" cy="6" r="1.5"/><circle cx="6" cy="12" r="1.5"/><circle cx="10" cy="12" r="1.5"/><circle cx="6" cy="18" r="1.5"/><circle cx="10" cy="18" r="1.5"/></svg>';
const CHEVRON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
const FOLDER = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
const DOTS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';

/** View state of the library. */
const view = {
    archive: false,
    /** Folder key whose books are being selected, or null. */
    selectFolder: null,
    selected: new Set(),
    /** Folder being edited in the folder dialog (null = new folder). */
    editingFolder: null
};

const drag = { id: null, type: null, armed: null };

export function libraryView() {
    return { archive: view.archive, selectFolder: view.selectFolder, selected: new Set(view.selected) };
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function folderKey(folder) {
    return folder ? folder.id : UNCATEGORIZED;
}

// ── folders ───────────────────────────────────────────────────────────────

/* Folder, order and archive live in the store's library map, not on the
   books: none of these writes touches (or re-uploads) a book. */

function allFolders() {
    return listFolders();
}

async function persistFolders(list) {
    return saveFolders(list.map(({ id, name, collapsed }) => ({ id, name, collapsed })));
}

export async function createFolder(name) {
    const clean = String(name || '').trim();
    if (!clean) return null;
    const folder = { id: newFolderId(), name: clean, collapsed: false };
    await persistFolders([...allFolders(), folder]);
    return folder;
}

export async function renameFolder(id, name) {
    const clean = String(name || '').trim();
    if (!clean) return false;
    await persistFolders(allFolders().map(f => (f.id === id ? { ...f, name: clean } : f)));
    return true;
}

/** Deletes a folder; its books become uncategorized (they are not deleted). */
export async function deleteFolder(id) {
    const patches = {};
    for (const b of listBooks().filter(b => b.folderId === id)) patches[b.id] = { folderId: null, order: null };
    await setLibraryEntries(patches);
    await persistFolders(allFolders().filter(f => f.id !== id));
}

async function toggleCollapsed(id) {
    await persistFolders(allFolders().map(f => (f.id === id ? { ...f, collapsed: !f.collapsed } : f)));
}

/** Moves books into a folder (null / UNCATEGORIZED = no folder), after its ordered books. */
export async function moveBooksToFolder(ids, folderId) {
    const target = folderId && folderId !== UNCATEGORIZED ? folderId : null;
    const patches = {};
    for (const id of ids) patches[id] = { folderId: target, order: null };
    await setLibraryEntries(patches);
}

/** Writes a manual order for the books of one folder. */
async function writeOrder(orderedIds) {
    const patches = {};
    orderedIds.forEach((id, i) => { patches[id] = { order: i }; });
    await setLibraryEntries(patches);
}

// ── per-book operations ───────────────────────────────────────────────────

export async function setArchived(ids, archived) {
    const patches = {};
    for (const id of ids) patches[id] = { archived: !!archived };
    await setLibraryEntries(patches);
}

export async function resetProgressOf(ids) {
    for (const id of ids) await resetBookProgress(id);
}

export async function downloadBook(id) {
    const book = await getBook(id);
    if (!book) return false;
    const blob = new Blob([JSON.stringify(exportBookJson(book), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = bookFileName(book.title);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
}

/** Shares the book file where the browser can; otherwise downloads it. */
export async function shareBook(id) {
    const book = await getBook(id);
    if (!book) return false;
    const json = JSON.stringify(exportBookJson(book), null, 2);
    const name = bookFileName(book.title);
    try {
        if (typeof File === 'function' && navigator.canShare) {
            const file = new File([json], name, { type: 'application/json' });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: book.title });
                return true;
            }
        }
    } catch (err) {
        if (err && err.name === 'AbortError') return false;
    }
    await downloadBook(id);
    showToast(t('ereader_share_fallback'));
    return true;
}

// ── metadata dialog ───────────────────────────────────────────────────────

let metaBookId = null;

export async function openMetaDialog(id) {
    const book = await getBook(id);
    const overlay = document.getElementById('ereaderMetaOverlay');
    if (!book || !overlay) return;
    metaBookId = id;
    document.getElementById('ereaderMetaTitle').value = book.title || '';
    document.getElementById('ereaderMetaAuthor').value = book.author || '';
    document.getElementById('ereaderMetaLanguage').value = book.language && book.language !== 'und' ? book.language : '';
    overlay.classList.add('active');
    document.getElementById('ereaderMetaTitle').focus();
}

export function closeMetaDialog() {
    const overlay = document.getElementById('ereaderMetaOverlay');
    if (overlay) overlay.classList.remove('active');
    metaBookId = null;
}

async function saveMeta() {
    const id = metaBookId;
    const title = document.getElementById('ereaderMetaTitle').value.trim();
    if (!id || !title) {
        document.getElementById('ereaderMetaTitle').focus();
        return;
    }
    const author = document.getElementById('ereaderMetaAuthor').value.trim();
    const language = document.getElementById('ereaderMetaLanguage').value.trim() || 'und';
    await updateBook(id, book => {
        book.title = title;
        book.author = author;
        book.language = language;
    });
    closeMetaDialog();
    showToast(t('ereader_meta_saved'));
}

// ── folder dialog ─────────────────────────────────────────────────────────

export function openFolderDialog(folder = null) {
    const overlay = document.getElementById('ereaderFolderOverlay');
    if (!overlay) return;
    view.editingFolder = folder;
    document.getElementById('ereaderFolderTitle').textContent = folder ? t('ereader_folder_actions') : t('add_folder');
    const input = document.getElementById('ereaderFolderName');
    input.value = folder ? folder.name : '';
    document.getElementById('ereaderFolderExtra').style.display = folder ? '' : 'none';
    overlay.classList.add('active');
    input.focus();
}

export function closeFolderDialog() {
    const overlay = document.getElementById('ereaderFolderOverlay');
    if (overlay) overlay.classList.remove('active');
    view.editingFolder = null;
}

async function saveFolderDialog() {
    const name = document.getElementById('ereaderFolderName').value.trim();
    if (!name) {
        document.getElementById('ereaderFolderName').focus();
        return;
    }
    const folder = view.editingFolder;
    closeFolderDialog();
    if (folder) await renameFolder(folder.id, name);
    else await createFolder(name);
}

// ── selection ─────────────────────────────────────────────────────────────

export async function enterSelection(folderKeyValue) {
    view.selectFolder = folderKeyValue;
    view.selected = new Set();
    /* A closed folder would hide its own selection bar. */
    const folder = listFolders().find(f => f.id === folderKeyValue);
    if (folder && folder.collapsed) await toggleCollapsed(folder.id);
    rerender();
}

/** The library was left: a selection or the archive view does not outlive it. */
export function leaveLibraryView() {
    view.archive = false;
    view.selectFolder = null;
    view.selected = new Set();
}

export function exitSelection() {
    view.selectFolder = null;
    view.selected = new Set();
    rerender();
}

function toggleSelected(id) {
    if (view.selected.has(id)) view.selected.delete(id);
    else view.selected.add(id);
    rerender();
}

// ── list painting ─────────────────────────────────────────────────────────

let rerender = () => {};
let bookActionsHandler = () => {};

function createGrip(row) {
    const grip = el('div', 'drag-handle');
    grip.innerHTML = GRIP;
    grip.setAttribute('aria-label', t('ereader_drag'));
    grip.title = t('ereader_drag');
    const arm = (e) => {
        if (e) e.stopPropagation();
        if (drag.armed && drag.armed !== row) drag.armed.draggable = false;
        drag.armed = row;
        row.draggable = true;
    };
    grip.addEventListener('mousedown', arm);
    grip.addEventListener('touchstart', () => arm(), { passive: true });
    grip.addEventListener('click', (e) => e.stopPropagation());
    return grip;
}

function bindDragSource(row, id, type) {
    row.addEventListener('dragstart', (e) => {
        if (row !== drag.armed) {
            e.preventDefault();
            return;
        }
        drag.id = id;
        drag.type = type;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        document.body.classList.add('dnd-active');
        const dragged = type === 'folder' ? row.closest('.ereader-folder') || row : row;
        setTimeout(() => { if (drag.id) dragged.classList.add('dragging'); }, 0);
    });
    row.addEventListener('dragend', endDrag);
}

function endDrag() {
    document.querySelectorAll('#ereaderBookList .dragging').forEach(n => n.classList.remove('dragging'));
    clearIndicator();
    document.body.classList.remove('dnd-active');
    if (drag.armed) drag.armed.draggable = false;
    drag.armed = null;
    drag.id = null;
    drag.type = null;
}

function clearIndicator() {
    document.querySelectorAll('#ereaderBookList .drop-before, #ereaderBookList .drop-after, #ereaderBookList .drop-inside')
        .forEach(n => n.classList.remove('drop-before', 'drop-after', 'drop-inside'));
}

/** Pointer position -> one drop target, or null. */
function dropTarget(e) {
    if (!drag.id || !(e.target instanceof Element)) return null;
    const row = e.target.closest('.ereader-book-row, .ereader-folder-header');
    if (!row) return null;
    if (drag.type === 'folder') {
        const block = row.closest('.ereader-folder');
        const id = block && block.dataset.folderId;
        if (!id || id === drag.id || id === UNCATEGORIZED) return null;
        const r = block.getBoundingClientRect();
        return { el: block, mode: (e.clientY - r.top) >= r.height / 2 ? 'after' : 'before', folderId: id };
    }
    if (row.classList.contains('ereader-folder-header')) {
        return { el: row, mode: 'inside', folderId: row.dataset.folderId };
    }
    const bookId = row.dataset.bookId;
    if (!bookId || bookId === drag.id) return null;
    const r = row.getBoundingClientRect();
    return { el: row, mode: (e.clientY - r.top) >= r.height / 2 ? 'after' : 'before', bookId, folderId: row.dataset.folderId };
}

async function applyDrop(target) {
    if (drag.type === 'folder') {
        const ids = moveId(allFolders().map(f => f.id), drag.id, target.folderId, target.mode);
        const byId = new Map(allFolders().map(f => [f.id, f]));
        await persistFolders(ids.map(id => byId.get(id)).filter(Boolean));
        return;
    }
    const bookId = drag.id;
    const book = listBooks().find(b => b.id === bookId);
    if (!book) return;
    const destFolder = target.folderId && target.folderId !== UNCATEGORIZED ? target.folderId : null;
    if ((book.folderId || null) !== destFolder) await moveBooksToFolder([bookId], destFolder);
    if (target.mode === 'inside') return;
    const key = target.folderId || UNCATEGORIZED;
    const group = groupBooks(listBooks(), listFolders(), { progressOf: getProgress, archived: view.archive })
        .find(g => folderKey(g.folder) === key);
    const ids = group ? group.books.map(b => b.id) : [];
    await writeOrder(moveId(ids, bookId, target.bookId, target.mode));
}

export function bindListDnd(list) {
    if (!list || list.dataset.dndBound === '1') return;
    list.dataset.dndBound = '1';
    list.addEventListener('dragover', (e) => {
        if (!drag.id) return;
        const target = dropTarget(e);
        clearIndicator();
        if (!target) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        target.el.classList.add(`drop-${target.mode}`);
    });
    list.addEventListener('dragleave', (e) => {
        if (!list.contains(e.relatedTarget)) clearIndicator();
    });
    list.addEventListener('drop', async (e) => {
        if (!drag.id) return;
        const target = dropTarget(e);
        e.preventDefault();
        if (target) await applyDrop(target);
        endDrag();
    });
}

function createFolderHeader(folder, count) {
    const key = folderKey(folder);
    const header = el('div', 'ereader-folder-header');
    header.dataset.folderId = key;

    if (!folder.uncategorized) header.appendChild(createGrip(header));

    const toggle = el('button', 'ereader-folder-toggle');
    toggle.type = 'button';
    toggle.innerHTML = CHEVRON;
    toggle.setAttribute('aria-expanded', folder.collapsed ? 'false' : 'true');
    toggle.setAttribute('aria-label', folder.uncategorized ? t('ereader_uncategorized') : folder.name);

    const icon = el('span', 'ereader-folder-icon');
    icon.innerHTML = FOLDER;
    const name = el('span', 'ereader-folder-name truncate', folder.uncategorized ? t('ereader_uncategorized') : folder.name);
    const countEl = el('span', 'ereader-folder-count', String(count));
    header.append(toggle, icon, name, countEl);

    if (!folder.uncategorized) {
        header.addEventListener('click', (e) => {
            if (e.target.closest('.ereader-folder-menu')) return;
            toggleCollapsed(folder.id);
        });
        header.tabIndex = 0;
        header.setAttribute('role', 'button');
        header.setAttribute('aria-expanded', folder.collapsed ? 'false' : 'true');
        header.addEventListener('keydown', (e) => {
            if (e.target !== header || (e.key !== 'Enter' && e.key !== ' ')) return;
            e.preventDefault();
            toggleCollapsed(folder.id);
        });
    }

    const menu = el('button', 'icon-btn ereader-folder-menu');
    menu.type = 'button';
    menu.innerHTML = DOTS;
    menu.title = t('ereader_folder_actions');
    menu.setAttribute('aria-label', t('ereader_folder_actions'));
    menu.onclick = (e) => {
        e.stopPropagation();
        if (folder.uncategorized) enterSelection(UNCATEGORIZED);
        else openFolderDialog(folder);
    };
    if (folder.uncategorized) {
        menu.title = t('ereader_select_books');
        menu.setAttribute('aria-label', t('ereader_select_books'));
    }
    header.appendChild(menu);

    bindDragSource(header, folder.id, 'folder');
    return header;
}

function createBulkBar(groupKey, books) {
    const bar = el('div', 'ereader-bulk-bar');
    const count = el('span', 'ereader-bulk-count', t('ereader_bulk_selected', { count: view.selected.size }));
    const all = el('button', 'btn btn-subtle', t('ereader_select_all'));
    all.type = 'button';
    all.onclick = (e) => {
        e.stopPropagation();
        const every = books.every(b => view.selected.has(b.id));
        view.selected = every ? new Set() : new Set(books.map(b => b.id));
        rerender();
    };
    const actions = el('button', 'btn btn-primary', t('ereader_bulk_actions'));
    actions.type = 'button';
    actions.disabled = view.selected.size === 0;
    actions.onclick = (e) => {
        e.stopPropagation();
        if (view.selected.size > 0) bookActionsHandler({ bulk: true, ids: [...view.selected], folderKey: groupKey });
    };
    const cancel = el('button', 'btn btn-subtle', t('cancel'));
    cancel.type = 'button';
    cancel.onclick = (e) => {
        e.stopPropagation();
        exitSelection();
    };
    bar.append(count, all, actions, cancel);
    return bar;
}

/**
 * Builds the library list: folder blocks (or a flat list when there are no
 * folders), book rows made by createRow(book, extra).
 */
export function buildLibraryList(list, { createRow, onBookActions, rerender: redraw }) {
    rerender = redraw || rerender;
    bookActionsHandler = onBookActions || bookActionsHandler;
    bindListDnd(list);

    const books = listBooks();
    const groups = groupBooks(books, listFolders(), { progressOf: getProgress, archived: view.archive });
    const blocks = [];

    for (const group of groups) {
        const key = folderKey(group.folder);
        const selecting = view.selectFolder === key;
        const rows = group.books.map(book => {
            const row = createRow(book, { selecting, selected: view.selected.has(book.id) });
            row.dataset.folderId = key;
            if (!view.archive) {
                row.insertBefore(createGrip(row), row.firstChild);
                bindDragSource(row, book.id, 'book');
            }
            if (selecting) {
                row.classList.add('selecting');
                row.onclick = (e) => {
                    e.stopPropagation();
                    toggleSelected(book.id);
                };
            }
            return row;
        });

        if (!group.folder) {
            if (selecting) blocks.push(createBulkBar(key, group.books));
            blocks.push(...rows);
            continue;
        }

        const block = el('div', 'ereader-folder' + (group.folder.collapsed ? ' collapsed' : ''));
        block.dataset.folderId = key;
        block.appendChild(createFolderHeader(group.folder, group.books.length));
        const body = el('div', 'ereader-folder-body');
        if (selecting) body.appendChild(createBulkBar(key, group.books));
        if (rows.length === 0) body.appendChild(el('div', 'ereader-folder-empty', t('ereader_folder_empty')));
        body.append(...rows);
        block.appendChild(body);
        blocks.push(block);
    }

    list.replaceChildren(...blocks);
    return groups;
}

/** Library-card buttons and the two dialogs. */
export function bindLibraryManage({ onArchiveToggle } = {}) {
    const addFolder = document.getElementById('ereaderAddFolderBtn');
    if (addFolder) addFolder.onclick = () => openFolderDialog(null);

    const archiveBtn = document.getElementById('ereaderArchiveViewBtn');
    const back = document.getElementById('ereaderArchiveBackBtn');
    const setArchiveView = (on) => {
        view.archive = on;
        view.selectFolder = null;
        view.selected = new Set();
        if (typeof onArchiveToggle === 'function') onArchiveToggle(on);
        rerender();
    };
    if (archiveBtn) archiveBtn.onclick = () => setArchiveView(!view.archive);
    if (back) back.onclick = () => setArchiveView(false);

    const metaSave = document.getElementById('ereaderMetaSaveBtn');
    const metaCancel = document.getElementById('ereaderMetaCancelBtn');
    const metaOverlay = document.getElementById('ereaderMetaOverlay');
    if (metaSave) metaSave.onclick = saveMeta;
    if (metaCancel) metaCancel.onclick = closeMetaDialog;
    if (metaOverlay) metaOverlay.addEventListener('click', (e) => { if (e.target === metaOverlay) closeMetaDialog(); });
    for (const id of ['ereaderMetaTitle', 'ereaderMetaAuthor', 'ereaderMetaLanguage']) {
        const input = document.getElementById(id);
        if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveMeta(); });
    }

    const folderSave = document.getElementById('ereaderFolderSaveBtn');
    const folderCancel = document.getElementById('ereaderFolderCancelBtn');
    const folderOverlay = document.getElementById('ereaderFolderOverlay');
    const folderName = document.getElementById('ereaderFolderName');
    if (folderSave) folderSave.onclick = saveFolderDialog;
    if (folderCancel) folderCancel.onclick = closeFolderDialog;
    if (folderOverlay) folderOverlay.addEventListener('click', (e) => { if (e.target === folderOverlay) closeFolderDialog(); });
    if (folderName) folderName.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveFolderDialog(); });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeManageDialogs();
    });

    const selectBtn = document.getElementById('ereaderFolderSelectBtn');
    if (selectBtn) {
        selectBtn.onclick = () => {
            const folder = view.editingFolder;
            closeFolderDialog();
            if (folder) enterSelection(folder.id);
        };
    }
    const delBtn = document.getElementById('ereaderFolderDeleteBtn');
    if (delBtn) {
        delBtn.onclick = async () => {
            const folder = view.editingFolder;
            closeFolderDialog();
            if (!folder) return;
            if (await showConfirm(t('ereader_delete_folder_confirm', { name: folder.name }), t('ereader_delete_folder'))) {
                await deleteFolder(folder.id);
            }
        };
    }
}

/** Closes the dialogs this module owns; says whether it closed one. */
export function closeManageDialogs() {
    let closed = false;
    for (const [id, close] of [['ereaderMetaOverlay', closeMetaDialog], ['ereaderFolderOverlay', closeFolderDialog]]) {
        const o = document.getElementById(id);
        if (o && o.classList.contains('active')) {
            close();
            closed = true;
        }
    }
    return closed;
}

/** Test seam. */
export function _resetLibraryManageForTests() {
    view.archive = false;
    view.selectFolder = null;
    view.selected = new Set();
    view.editingFolder = null;
    metaBookId = null;
    endDrag();
    rerender = () => {};
    bookActionsHandler = () => {};
}

/** The folders a book can be moved to (local and sync-only ones). */
export function folderChoices() {
    return allFolders();
}

/** Deletes books (bulk); the caller confirms. */
export async function deleteBooks(ids) {
    for (const id of ids) await deleteBook(id);
}
