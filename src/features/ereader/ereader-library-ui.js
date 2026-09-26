/**
 * e-Reader library: the book list, the add panel, the book actions modal and
 * the e-Reader reset.
 *
 * renderEreaderLibrary() is the only painter and it is idempotent; the store
 * announces EREADER_LIBRARY / EREADER_PROGRESS and ui-bindings.js calls it.
 * Nothing here calls it after a write.
 *
 * Book data reaches the DOM through textContent only - titles and authors come
 * from files the user downloaded from an AI and are never parsed as markup.
 */

import { t } from '../../core/i18n.js';
import { showToast, showAlert, showConfirm, showDecision } from '../../core/utils.js';
import {
    isEreaderLoaded, listBooks, getBook, getProgress, getPrefs,
    deleteBook, replaceBook, resetAllProgress, deleteAllBooks
} from './ereader-store.js';
import { importFromFiles, importFromText, importFromUrl } from './ereader-import.js';
import { EREADER_AI_PROMPT } from './ereader-prompt.js';
import { openBook, printBook } from './ereader-reader-ui.js';
import {
    buildLibraryList, bindLibraryManage, closeManageDialogs, libraryView, exitSelection,
    setArchived, resetProgressOf, downloadBook, shareBook, openMetaDialog, moveBooksToFolder,
    folderChoices, deleteBooks, _resetLibraryManageForTests
} from './ereader-library-manage.js';
import { UNCATEGORIZED } from './ereader-folders.js';
import {
    canMergeParts, doPartsOverlap, checkDensity, mergeBookParts,
    hasMissingRanges, generateNextPartPrompt
} from './ereader-parts.js';

const ACTIONS_ICON = `
        <svg viewBox="0 0 24 24" width="20" height="20" class="source-actions-icon">
            <rect x="4" y="4" width="7" height="7" rx="1.5" class="sq sq-tl"></rect>
            <circle cx="16.5" cy="7.5" r="3.5" class="status-dot-svg" stroke-width="2" fill="none"></circle>
            <rect x="4" y="13" width="7" height="7" rx="1.5" class="sq sq-bl"></rect>
            <rect x="13" y="13" width="7" height="7" rx="1.5" class="sq sq-br"></rect>
        </svg>`;

const URL_DEBOUNCE_MS = 800;

let actionsBookId = null;
/** What the actions dialog is about: { ids, bulk, archived }. */
let actionsTarget = null;
let bound = false;

/**
 * Most recently read first, then most recently changed. A book that was never
 * opened has no progress record and sorts by its own updatedAt.
 */
export function sortBooks(books, progressOf = getProgress) {
    return [...books].sort((a, b) => {
        const pa = progressOf(a.id)?.at || 0;
        const pb = progressOf(b.id)?.at || 0;
        if (pa !== pb) return pb - pa;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function createBookRow(book, lastBookId, openBook, { selecting = false, selected = false } = {}) {
    const row = el('div', 'ereader-book-row' + (book.id === lastBookId ? ' is-last' : '') + (selected ? ' selected' : ''));
    row.dataset.bookId = book.id;
    if (selecting) {
        const check = el('span', 'ereader-select-check' + (selected ? ' checked' : ''));
        check.setAttribute('role', 'checkbox');
        check.setAttribute('aria-checked', selected ? 'true' : 'false');
        row.appendChild(check);
    }

    const info = el('div', 'ereader-book-info');
    info.appendChild(el('div', 'ereader-book-title truncate', book.title || t('untitled_source')));

    const meta = el('div', 'ereader-book-meta');
    const byline = [book.author, (book.language || '').toUpperCase()].filter(Boolean).join(' · ');
    if (byline) meta.appendChild(el('span', 'truncate', byline));
    if (book.sourceType === 'topic') meta.appendChild(el('span', 'ereader-chip', t('ereader_badge_generated')));
    info.appendChild(meta);

    const percent = Math.max(0, Math.min(100, Math.round(getProgress(book.id)?.percent || 0)));
    const progressRow = el('div', 'ereader-progress-row');
    const track = el('div', 'ereader-progress-track');
    const fill = el('div', 'ereader-progress-fill');
    fill.style.width = `${percent}%`;
    track.appendChild(fill);
    progressRow.appendChild(track);
    progressRow.appendChild(el('span', 'ereader-progress-value', `${percent}%`));
    info.appendChild(progressRow);

    const actionsBtn = el('button', 'icon-btn ereader-book-actions-btn');
    actionsBtn.type = 'button';
    actionsBtn.title = t('ereader_book_actions');
    actionsBtn.setAttribute('aria-label', t('ereader_book_actions'));
    actionsBtn.innerHTML = ACTIONS_ICON;
    actionsBtn.onclick = (e) => {
        e.stopPropagation();
        openBookActions(book);
    };

    row.onclick = () => openBook(book.id);
    /* A row is the book's button: reachable with Tab, opened with Enter/Space
       (in selection mode the same keys select it - row.onclick is swapped). */
    row.tabIndex = 0;
    row.setAttribute('role', selecting ? 'checkbox' : 'button');
    if (selecting) row.setAttribute('aria-checked', selected ? 'true' : 'false');
    row.setAttribute('aria-label', book.title || t('untitled_source'));
    row.addEventListener('keydown', (e) => {
        if (e.target !== row || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        row.click();
    });
    row.appendChild(info);
    if (!selecting) row.appendChild(actionsBtn);
    return row;
}

let openBookHandler = () => {};

/** Paints #ereaderBookList, #ereaderLibraryCount and #ereaderLibraryEmpty. */
export function renderEreaderLibrary() {
    const list = document.getElementById('ereaderBookList');
    const count = document.getElementById('ereaderLibraryCount');
    const empty = document.getElementById('ereaderLibraryEmpty');
    const mergeBtn = document.getElementById('ereaderMergePartsBtn');
    if (!list || !count || !empty) return;

    /* Before the index has been read there is no answer yet, and "no books"
       would be a lie that flashes for a frame on every visit. */
    if (!isEreaderLoaded()) {
        empty.style.display = 'none';
        list.replaceChildren();
        count.textContent = '';
        if (mergeBtn) mergeBtn.style.display = 'none';
        return;
    }

    const all = listBooks();
    const state = libraryView();
    const archivedCount = all.filter(b => b.archived === true).length;
    const books = all.filter(b => (b.archived === true) === state.archive);
    count.textContent = books.length === 1
        ? t('ereader_book_count_one')
        : t('ereader_book_count', { count: books.length });

    const badge = document.getElementById('ereaderArchiveBadge');
    if (badge) badge.textContent = archivedCount > 0 ? String(archivedCount) : '';
    const archiveBtn = document.getElementById('ereaderArchiveViewBtn');
    if (archiveBtn) {
        archiveBtn.classList.toggle('active', state.archive);
        archiveBtn.style.display = archivedCount > 0 || state.archive ? '' : 'none';
    }
    const banner = document.getElementById('ereaderArchiveBanner');
    if (banner) {
        banner.style.display = state.archive ? 'flex' : 'none';
        const text = document.getElementById('ereaderArchiveBannerText');
        if (text) text.textContent = t('ereader_archive_banner', { count: archivedCount });
    }

    // Show merge button only when there are 2+ books sharing the same bookKey
    if (mergeBtn) {
        const keyCounts = new Map();
        for (const b of all) {
            if (b.bookKey) keyCounts.set(b.bookKey, (keyCounts.get(b.bookKey) || 0) + 1);
        }
        const hasCandidates = [...keyCounts.values()].some(c => c >= 2);
        mergeBtn.style.display = hasCandidates && !state.archive ? 'flex' : 'none';
    }

    if (all.length === 0) {
        empty.style.display = 'block';
        list.replaceChildren();
        /* An empty library has one thing to do, so the panel opens itself
           rather than hiding behind the + in the header. */
        const panel = document.getElementById('ereaderAddPanel');
        if (panel) panel.style.display = 'block';
        return;
    }

    empty.style.display = 'none';
    if (state.archive && books.length === 0) {
        const note = el('div', 'ereader-folder-empty', t('ereader_archive_empty'));
        list.replaceChildren(note);
        return;
    }
    const lastBookId = getPrefs().lastBookId;
    buildLibraryList(list, {
        createRow: (book, extra) => createBookRow(book, lastBookId, openBookHandler, extra),
        onBookActions: (target) => openBookActions(target),
        rerender: renderEreaderLibrary
    });
}

function setPanelOpen(open) {
    const panel = document.getElementById('ereaderAddPanel');
    if (panel) panel.style.display = open ? 'block' : 'none';
}

function toggleAddPanel() {
    const panel = document.getElementById('ereaderAddPanel');
    if (!panel) return;
    setPanelOpen(panel.style.display === 'none');
}

/** Repeated warnings (one per image, say) are listed once with a count. */
function describeKeys(keys) {
    const counts = new Map();
    for (const key of keys) counts.set(key, (counts.get(key) || 0) + 1);
    return [...counts].map(([key, n]) => `• ${t(key)}${n > 1 ? ` (×${n})` : ''}`).join('\n');
}

/**
 * One report for one import action, however many files it carried: toasts for
 * what went in, a single alert for what went wrong or needs a word.
 *
 * @param {Array<{name?: string, status: string, book: object|null, errors: string[], warnings: string[]}>} results
 */
export function reportImportResults(results) {
    const added = results.filter(r => r.status === 'added');
    const merged = results.filter(r => r.status === 'merged');
    const duplicates = results.filter(r => r.status === 'duplicate');
    const failed = results.filter(r => r.status === 'invalid');

    if (added.length === 1) showToast(t('ereader_book_added', { title: added[0].book.title }));
    else if (added.length > 1) showToast(t('ereader_books_added', { count: added.length }));
    for (const m of merged) showToast(t('ereader_part_merged', { title: m.book.title }));
    if (duplicates.length > 0) showToast(t('ereader_already_added'));

    const blocks = [];
    for (const r of failed) {
        blocks.push((r.name ? `${r.name}\n` : '') + describeKeys(r.errors));
    }
    for (const r of added.concat(merged)) {
        if (r.warnings.length > 0) blocks.push(`${r.book.title}\n${describeKeys(r.warnings)}`);
    }
    if (blocks.length > 0) {
        const title = failed.length > 0 ? t('ereader_import_failed') : t('ereader_import_warnings');
        showAlert(blocks.join('\n\n'), title);
    }

    if (added.length > 0 || merged.length > 0) setPanelOpen(false);
    const out = { added: added.length, duplicates: duplicates.length, failed: failed.length };
    if (merged.length > 0) out.merged = merged.length;
    return out;
}

/**
 * Drop zone behaviour, the same as the sources panel's but for this panel's
 * own elements; the binding in main.js is left alone.
 */
export function bindDropZone(zoneEl, inputEl, onFiles) {
    if (!zoneEl || !inputEl) return;
    inputEl.onchange = async () => {
        const files = Array.from(inputEl.files || []);
        inputEl.value = '';
        if (files.length > 0) await onFiles(files);
    };
    zoneEl.addEventListener('dragover', (e) => {
        if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            zoneEl.classList.add('drag-over');
        }
    });
    zoneEl.addEventListener('dragleave', (e) => {
        if (!zoneEl.contains(e.relatedTarget)) zoneEl.classList.remove('drag-over');
    });
    zoneEl.addEventListener('drop', async (e) => {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            e.preventDefault();
            zoneEl.classList.remove('drag-over');
            await onFiles(Array.from(e.dataTransfer.files));
        }
    });
}

function fillMoveSelect(ids) {
    const row = document.getElementById('ereaderMoveFolderRow');
    const select = document.getElementById('ereaderMoveFolderSelect');
    if (!row || !select) return;
    const folders = folderChoices();
    if (folders.length === 0) {
        row.style.display = 'none';
        return;
    }
    row.style.display = '';
    const books = listBooks().filter(b => ids.includes(b.id));
    const current = books.length > 0 && books.every(b => (b.folderId || null) === (books[0].folderId || null))
        ? (books[0].folderId || UNCATEGORIZED)
        : '';
    const options = [el('option', '', t('move_to_folder'))];
    options[0].value = '';
    const none = el('option', '', t('ereader_uncategorized'));
    none.value = UNCATEGORIZED;
    options.push(none);
    for (const f of folders) {
        const o = el('option', '', f.name);
        o.value = f.id;
        options.push(o);
    }
    select.replaceChildren(...options);
    select.value = current && current !== '' ? current : '';
    select.onchange = async () => {
        const value = select.value;
        if (!value) return;
        const wasBulk = actionsTarget && actionsTarget.bulk;
        closeBookActions();
        await moveBooksToFolder(ids, value);
        if (wasBulk) exitSelection();
    };
}

/**
 * The actions dialog for one book, or for the books selected in a folder
 * ({ bulk: true, ids }). The same buttons as a test source's; the ones that
 * only make sense for one book are hidden for a selection.
 */
function openBookActions(target) {
    const overlay = document.getElementById('ereaderBookActionsOverlay');
    if (!overlay) return;
    const bulk = !!(target && target.bulk);
    const ids = bulk ? [...target.ids] : [target.id];
    const summaries = listBooks().filter(b => ids.includes(b.id));
    if (summaries.length === 0) return;
    const book = bulk ? null : summaries[0];
    const archived = summaries.every(b => b.archived === true);
    actionsTarget = { ids, bulk, archived };
    actionsBookId = bulk ? null : book.id;

    const name = document.getElementById('ereaderBookActionsName');
    if (name) name.textContent = bulk ? t('ereader_bulk_selected', { count: ids.length }) : (book.title || '');

    fillMoveSelect(ids);

    const show = (id, on) => {
        const node = document.getElementById(id);
        if (node) node.style.display = on ? '' : 'none';
    };
    show('ereaderEditMetaBtn', !bulk);
    show('ereaderShareBookBtn', !bulk);
    show('ereaderPrintBookBtn', !bulk);

    const archiveLabel = document.getElementById('ereaderArchiveBookLabel');
    if (archiveLabel) {
        archiveLabel.textContent = archived ? t('ereader_unarchive') : t('archive_action');
        archiveLabel.removeAttribute('data-i18n');
    }

    // Check if next part prompt button should be visible
    const nextPromptBtn = document.getElementById('ereaderCopyNextPromptBtn');
    if (nextPromptBtn) {
        const canCopyNext = !bulk && hasMissingRanges(book);
        nextPromptBtn.style.display = canCopyNext ? 'flex' : 'none';
        nextPromptBtn.onclick = async () => {
            const promptText = generateNextPartPrompt(book);
            try {
                await navigator.clipboard.writeText(promptText);
                showToast(t('ereader_prompt_copied'));
            } catch {
                showToast(t('ereader_prompt_copy_failed'));
            }
            closeBookActions();
        };
    }

    overlay.classList.add('active');
}

function closeBookActions() {
    const overlay = document.getElementById('ereaderBookActionsOverlay');
    if (overlay) overlay.classList.remove('active');
    actionsBookId = null;
    actionsTarget = null;
}

/** Runs an action on the dialog's books after closing it. */
function actionHandler(run) {
    return async () => {
        const target = actionsTarget;
        closeBookActions();
        if (!target) return;
        await run(target);
    };
}

function bindBookActionButtons() {
    const on = (id, fn) => {
        const node = document.getElementById(id);
        if (node) node.onclick = actionHandler(fn);
    };
    on('ereaderEditMetaBtn', ({ ids }) => openMetaDialog(ids[0]));
    on('ereaderDownloadBookBtn', async ({ ids }) => {
        for (const id of ids) await downloadBook(id);
    });
    on('ereaderShareBookBtn', ({ ids }) => shareBook(ids[0]));
    on('ereaderPrintBookBtn', async ({ ids }) => printBook(await getBook(ids[0])));
    on('ereaderArchiveBookBtn', async ({ ids, bulk, archived }) => {
        await setArchived(ids, !archived);
        showToast(t(archived ? 'ereader_books_unarchived' : 'ereader_books_archived', { count: ids.length }));
        if (bulk) exitSelection();
    });
    on('ereaderResetBookBtn', async ({ ids, bulk }) => {
        const message = bulk
            ? t('ereader_reset_books_confirm', { count: ids.length })
            : t('ereader_reset_book_confirm', { title: listBooks().find(b => b.id === ids[0])?.title || '' });
        if (!(await showConfirm(message, t('reset')))) return;
        await resetProgressOf(ids);
        showToast(t('ereader_progress_reset_done'));
        if (bulk) exitSelection();
    });
    on('ereaderDeleteBookBtn', async ({ ids, bulk }) => {
        if (!bulk) {
            await deleteBookWithConfirm(ids[0]);
            return;
        }
        if (!(await showConfirm(t('ereader_delete_books_confirm', { count: ids.length }), t('delete')))) return;
        await deleteBooks(ids);
        showToast(t('ereader_books_deleted', { count: ids.length }));
        exitSelection();
    });
}

export function openMergeOverlay() {
    const overlay = document.getElementById('ereaderMergeOverlay');
    const list = document.getElementById('ereaderMergeList');
    const confirmBtn = document.getElementById('ereaderMergeConfirmBtn');
    const cancelBtn = document.getElementById('ereaderMergeCancelBtn');
    if (!overlay || !list || !confirmBtn || !cancelBtn) return;

    list.replaceChildren();
    const selectedIds = new Set();

    const books = listBooks();
    const keyCounts = new Map();
    for (const b of books) {
        if (b.bookKey) keyCounts.set(b.bookKey, (keyCounts.get(b.bookKey) || 0) + 1);
    }
    const candidates = books.filter(b => b.bookKey && (keyCounts.get(b.bookKey) || 0) >= 2);

    candidates.forEach(b => {
        const item = document.createElement('label');
        item.className = 'ereader-merge-item';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '0.75rem';
        item.style.padding = '0.75rem';
        item.style.border = '1px solid var(--border-color)';
        item.style.borderRadius = 'var(--radius-md)';
        item.style.cursor = 'pointer';
        item.style.transition = 'all 0.2s ease';

        const p = b.parts?.[0];
        const rangeText = p ? `${p.unit || 'part'} ${p.from}–${p.to} / ${p.total}` : '';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = b.id;
        cb.style.width = '18px';
        cb.style.height = '18px';
        cb.style.cursor = 'pointer';

        const info = el('div');
        info.style.flex = '1';
        const titleEl = el('div', '', b.title || '');
        titleEl.style.fontWeight = '600';
        titleEl.style.fontSize = '0.9rem';
        const metaEl = el('div', '', rangeText ? `${rangeText} · ${b.bookKey}` : (b.bookKey || ''));
        metaEl.style.fontSize = '0.75rem';
        metaEl.style.color = 'var(--text-secondary)';
        info.appendChild(titleEl);
        info.appendChild(metaEl);

        item.appendChild(cb);
        item.appendChild(info);

        cb.onchange = () => {
            if (cb.checked) {
                selectedIds.add(b.id);
                item.style.backgroundColor = 'var(--surface-hover)';
                item.style.borderColor = 'var(--primary-color)';
            } else {
                selectedIds.delete(b.id);
                item.style.backgroundColor = 'transparent';
                item.style.borderColor = 'var(--border-color)';
            }
            confirmBtn.disabled = selectedIds.size < 2;
        };

        list.appendChild(item);
    });

    overlay.classList.add('active');
    confirmBtn.disabled = true;

    confirmBtn.onclick = async () => {
        const ids = Array.from(selectedIds);
        if (ids.length < 2) return;
        const selectedBooks = [];
        for (const id of ids) {
            const full = await getBook(id);
            if (full) selectedBooks.push(full);
        }
        if (selectedBooks.length < 2) return;

        // Verify compatibility
        const first = selectedBooks[0];
        for (let i = 1; i < selectedBooks.length; i++) {
            const check = canMergeParts(first, selectedBooks[i]);
            if (!check.ok) {
                showAlert(t(check.reason || 'ereader_warn_diff_lang_or_unit'), t('warning_title'));
                return;
            }
        }

        // Check for overlapping parts between any selected books
        for (let i = 0; i < selectedBooks.length; i++) {
            for (let j = i + 1; j < selectedBooks.length; j++) {
                if (doPartsOverlap(selectedBooks[i].parts || [], selectedBooks[j].parts || [])) {
                    showAlert(t('ereader_warn_parts_overlap'), t('warning_title'));
                    return;
                }
            }
        }

        // Sort by part.from ascending
        selectedBooks.sort((a, b) => {
            const fromA = a.parts?.[0]?.from ?? 0;
            const fromB = b.parts?.[0]?.from ?? 0;
            return fromA - fromB;
        });

        // Check density across parts
        for (let i = 1; i < selectedBooks.length; i++) {
            const density = checkDensity(selectedBooks[i], selectedBooks[0]);
            if (density.lowDensity) {
                const proceed = await showConfirm(t('ereader_warn_low_density'), t('warning_title'));
                if (!proceed) return;
                break;
            }
        }

        // Merge all into target
        let target = selectedBooks[0];
        for (let i = 1; i < selectedBooks.length; i++) {
            target = mergeBookParts(target, selectedBooks[i]);
        }

        await replaceBook(target);

        // Delete the non-target books (creating tombstones)
        for (let i = 1; i < selectedBooks.length; i++) {
            await deleteBook(selectedBooks[i].id);
        }

        closeMergeOverlay();
        showToast(t('ereader_merged_success'));
        renderEreaderLibrary();
    };

    cancelBtn.onclick = closeMergeOverlay;
    overlay.onclick = (e) => {
        if (e.target === overlay) closeMergeOverlay();
    };
}

export function closeMergeOverlay() {
    const overlay = document.getElementById('ereaderMergeOverlay');
    if (overlay) overlay.classList.remove('active');
}

/** For main.js closeAllModals(): closes what is open, says whether it did. */
export function closeEreaderModals() {
    let closed = false;
    const actionsOverlay = document.getElementById('ereaderBookActionsOverlay');
    if (actionsOverlay && actionsOverlay.classList.contains('active')) {
        closeBookActions();
        closed = true;
    }
    if (closeManageDialogs()) closed = true;
    const mergeOverlay = document.getElementById('ereaderMergeOverlay');
    if (mergeOverlay && mergeOverlay.classList.contains('active')) {
        closeMergeOverlay();
        closed = true;
    }
    const imgOverlay = document.getElementById('ereaderImageUrlOverlay');
    if (imgOverlay && imgOverlay.classList.contains('active')) {
        imgOverlay.classList.remove('active');
        closed = true;
    }
    return closed;
}

export async function deleteBookWithConfirm(id) {
    const book = listBooks().find(b => b.id === id);
    if (!book) return false;
    const ok = await showConfirm(t('ereader_delete_confirm', { title: book.title }), t('ereader_delete_book'));
    if (!ok) return false;
    await deleteBook(id);
    showToast(t('ereader_book_deleted', { title: book.title }));
    return true;
}

/**
 * Two ways to reset, each confirmed a second time. The test centre's reset
 * modal (resetAppModalOverlay, .reset-option-card) is not reused: main.js
 * wires every .reset-option-card to its own handler.
 */
export async function runEreaderReset() {
    const choice = await showDecision(t('ereader_reset_message'), t('ereader_reset_title'), {
        confirm: t('ereader_reset_progress'),
        alt: t('ereader_reset_all'),
        cancel: t('cancel')
    });
    if (choice === 'confirm') {
        if (!(await showConfirm(t('ereader_reset_progress_confirm'), t('ereader_reset_progress')))) return 'cancel';
        await resetAllProgress();
        showToast(t('ereader_reset_progress_done'));
        return 'progress';
    }
    if (choice === 'alt') {
        if (!(await showConfirm(t('ereader_reset_all_confirm'), t('ereader_reset_all')))) return 'cancel';
        await deleteAllBooks();
        showToast(t('ereader_reset_all_done'));
        return 'all';
    }
    return 'cancel';
}

export async function copyEreaderPrompt() {
    try {
        await navigator.clipboard.writeText(EREADER_AI_PROMPT);
        showToast(t('ereader_prompt_copied'));
        return true;
    } catch {
        showToast(t('ereader_prompt_copy_failed'));
        return false;
    }
}

/**
 * One-time wiring. The view's DOM is static, so listeners are bound once; the
 * list itself is rebuilt on every paint and carries its own handlers.
 */
export function bindEreaderLibrary({ switchView, closeMenu } = {}) {
    if (bound) return;
    bound = true;

    openBookHandler = (id) => openBook(id, { switchView });

    const toggleBtn = document.getElementById('ereaderToggleAddBtn');
    if (toggleBtn) toggleBtn.onclick = toggleAddPanel;

    const mergePartsBtn = document.getElementById('ereaderMergePartsBtn');
    if (mergePartsBtn) mergePartsBtn.onclick = openMergeOverlay;

    const confirmMerge = async (title) => await showConfirm(t('ereader_part_match', { title }));
    const confirmDensity = async (warningKey) => await showConfirm(t(warningKey || 'ereader_warn_low_density'), t('warning_title'));

    bindDropZone(
        document.getElementById('ereaderFileDropZone'),
        document.getElementById('ereaderFileInput'),
        async (files) => reportImportResults(await importFromFiles(files, { confirmMerge, confirmDensity }))
    );

    const urlInput = document.getElementById('ereaderUrlInput');
    if (urlInput) {
        let timer;
        urlInput.addEventListener('input', () => {
            clearTimeout(timer);
            const value = urlInput.value.trim();
            if (!value) return;
            timer = setTimeout(async () => {
                let result;
                if (value.startsWith('{')) {
                    result = await importFromText(value, { confirmMerge, confirmDensity });
                } else if (!/^https?:\/\//i.test(value)) {
                    showAlert(t('ereader_invalid_url'), t('warning_title'));
                    return;
                } else {
                    result = await importFromUrl(value, { confirmMerge, confirmDensity });
                }
                if (result.status !== 'invalid') urlInput.value = '';
                reportImportResults([result]);
            }, URL_DEBOUNCE_MS);
        });
    }

    const clipboardBtn = document.getElementById('ereaderLoadClipboardBtn');
    if (clipboardBtn) {
        clipboardBtn.onclick = async () => {
            let text;
            try {
                text = await navigator.clipboard.readText();
            } catch {
                showToast(t('clipboard_error'));
                return;
            }
            if (!text || !text.trim()) {
                showToast(t('clipboard_empty'));
                return;
            }
            reportImportResults([await importFromText(text, { confirmMerge, confirmDensity })]);
        };
    }

    const promptBtn = document.getElementById('ereaderCopyPromptBtn');
    if (promptBtn) promptBtn.onclick = copyEreaderPrompt;

    bindBookActionButtons();
    bindLibraryManage();

    const closeBtn = document.getElementById('ereaderBookActionsCloseBtn');
    if (closeBtn) closeBtn.onclick = closeBookActions;
    const overlay = document.getElementById('ereaderBookActionsOverlay');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeBookActions();
        });
    }

    const resetBtn = document.getElementById('menuEreaderReset');
    if (resetBtn) {
        resetBtn.onclick = () => {
            if (typeof closeMenu === 'function') closeMenu();
            runEreaderReset();
        };
    }
}

/** Test seam. */
export function _resetEreaderLibraryUIForTests() {
    bound = false;
    actionsBookId = null;
    actionsTarget = null;
    _resetLibraryManageForTests();
    openBookHandler = () => {};
    closeBookActions();
    closeMergeOverlay();
}
