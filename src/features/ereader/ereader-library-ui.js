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
    isEreaderLoaded, listBooks, getProgress, getPrefs, setPrefs,
    deleteBook, resetAllProgress, deleteAllBooks
} from './ereader-store.js';
import { importFromFiles, importFromText, importFromUrl } from './ereader-import.js';
import { EREADER_AI_PROMPT } from './ereader-prompt.js';

const ACTIONS_ICON = `
        <svg viewBox="0 0 24 24" width="20" height="20" class="source-actions-icon">
            <rect x="4" y="4" width="7" height="7" rx="1.5" class="sq sq-tl"></rect>
            <circle cx="16.5" cy="7.5" r="3.5" class="status-dot-svg" stroke-width="2" fill="none"></circle>
            <rect x="4" y="13" width="7" height="7" rx="1.5" class="sq sq-bl"></rect>
            <rect x="13" y="13" width="7" height="7" rx="1.5" class="sq sq-br"></rect>
        </svg>`;

const URL_DEBOUNCE_MS = 800;

let actionsBookId = null;
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

function createBookRow(book, lastBookId, openBook) {
    const row = el('div', 'ereader-book-row' + (book.id === lastBookId ? ' is-last' : ''));
    row.dataset.bookId = book.id;

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
    row.appendChild(info);
    row.appendChild(actionsBtn);
    return row;
}

let openBookHandler = () => {};

/** Paints #ereaderBookList, #ereaderLibraryCount and #ereaderLibraryEmpty. */
export function renderEreaderLibrary() {
    const list = document.getElementById('ereaderBookList');
    const count = document.getElementById('ereaderLibraryCount');
    const empty = document.getElementById('ereaderLibraryEmpty');
    if (!list || !count || !empty) return;

    /* Before the index has been read there is no answer yet, and "no books"
       would be a lie that flashes for a frame on every visit. */
    if (!isEreaderLoaded()) {
        empty.style.display = 'none';
        list.replaceChildren();
        count.textContent = '';
        return;
    }

    const books = sortBooks(listBooks());
    count.textContent = books.length === 1
        ? t('ereader_book_count_one')
        : t('ereader_book_count', { count: books.length });

    if (books.length === 0) {
        empty.style.display = 'block';
        list.replaceChildren();
        /* An empty library has one thing to do, so the panel opens itself
           rather than hiding behind the + in the header. */
        const panel = document.getElementById('ereaderAddPanel');
        if (panel) panel.style.display = 'block';
        return;
    }

    empty.style.display = 'none';
    const lastBookId = getPrefs().lastBookId;
    list.replaceChildren(...books.map(b => createBookRow(b, lastBookId, openBookHandler)));
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
    const duplicates = results.filter(r => r.status === 'duplicate');
    const failed = results.filter(r => r.status === 'invalid');

    if (added.length === 1) showToast(t('ereader_book_added', { title: added[0].book.title }));
    else if (added.length > 1) showToast(t('ereader_books_added', { count: added.length }));
    if (duplicates.length > 0) showToast(t('ereader_already_added'));

    const blocks = [];
    for (const r of failed) {
        blocks.push((r.name ? `${r.name}\n` : '') + describeKeys(r.errors));
    }
    for (const r of added) {
        if (r.warnings.length > 0) blocks.push(`${r.book.title}\n${describeKeys(r.warnings)}`);
    }
    if (blocks.length > 0) {
        const title = failed.length > 0 ? t('ereader_import_failed') : t('ereader_import_warnings');
        showAlert(blocks.join('\n\n'), title);
    }

    if (added.length > 0) setPanelOpen(false);
    return { added: added.length, duplicates: duplicates.length, failed: failed.length };
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

function openBookActions(book) {
    const overlay = document.getElementById('ereaderBookActionsOverlay');
    if (!overlay) return;
    actionsBookId = book.id;
    const name = document.getElementById('ereaderBookActionsName');
    if (name) name.textContent = book.title || '';
    overlay.classList.add('active');
}

function closeBookActions() {
    const overlay = document.getElementById('ereaderBookActionsOverlay');
    if (overlay) overlay.classList.remove('active');
    actionsBookId = null;
}

/** For main.js closeAllModals(): closes what is open, says whether it did. */
export function closeEreaderModals() {
    const overlay = document.getElementById('ereaderBookActionsOverlay');
    if (overlay && overlay.classList.contains('active')) {
        closeBookActions();
        return true;
    }
    return false;
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

    openBookHandler = async (id) => {
        await setPrefs({ lastBookId: id });
        if (typeof switchView === 'function') switchView('ereaderBook');
    };

    const toggleBtn = document.getElementById('ereaderToggleAddBtn');
    if (toggleBtn) toggleBtn.onclick = toggleAddPanel;

    bindDropZone(
        document.getElementById('ereaderFileDropZone'),
        document.getElementById('ereaderFileInput'),
        async (files) => reportImportResults(await importFromFiles(files))
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
                    result = await importFromText(value);
                } else if (!/^https?:\/\//i.test(value)) {
                    showAlert(t('ereader_invalid_url'), t('warning_title'));
                    return;
                } else {
                    result = await importFromUrl(value);
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
            reportImportResults([await importFromText(text)]);
        };
    }

    const promptBtn = document.getElementById('ereaderCopyPromptBtn');
    if (promptBtn) promptBtn.onclick = copyEreaderPrompt;

    const deleteBtn = document.getElementById('ereaderDeleteBookBtn');
    if (deleteBtn) {
        deleteBtn.onclick = async () => {
            const id = actionsBookId;
            closeBookActions();
            if (id) await deleteBookWithConfirm(id);
        };
    }
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
    openBookHandler = () => {};
}
