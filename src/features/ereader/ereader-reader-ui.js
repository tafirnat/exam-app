/**
 * e-Reader reading screen: one chapter at a time, previous / next, the reading
 * position, the table of contents and the font size.
 *
 * Only the open chapter is in the DOM. A book is a few hundred pages of
 * Markdown; parsing all of it on every open, font change or sync would be the
 * slow part of the app, and the reader only ever shows one chapter.
 *
 * The position is tracked on every scroll event (in memory) and written a few
 * seconds after scrolling stops, on chapter change, when the view is left and
 * when the tab is hidden. It is read from memory at those moments, never from
 * window.scrollY: by the time switchView() tells us the view changed, the page
 * has already been scrolled for the next one.
 */

import { t } from '../../core/i18n.js';
import { renderMarkdown, applySearchHighlight } from '../../core/markdown.js';
import { escapeHTML, showToast, showAlert } from '../../core/utils.js';
import { getBook, getProgress, setProgress, getPrefs, setPrefs, listBooks, updateBook } from './ereader-store.js';
import { buildChapters, chapterOfSection, weightedPercent } from './ereader-chapters.js';
import { searchBook } from './ereader-search.js';
import { applyEreaderChrome } from './ereader-shell.js';
import { detectGaps } from './ereader-parts.js';

export const FONT_STEPS = Object.freeze([0.875, 1, 1.125, 1.25, 1.375, 1.5]);
const SAVE_DELAY_MS = 5000;
const MOBILE_QUERY = '(max-width: 600px)';
/** A section counts as "being read" once its top has passed this line. */
const READING_LINE_PX = 96;
const MEMO_LIMIT = 24;

/** { book, chapters, chapterIndex, renderedAt, pendingRestore } */
let open = null;
let bookViewActive = false;
let lastPos = null;
let saveTimer = null;
const memo = new Map();
let deps = { switchView: null, closeMenu: null };
let bound = false;
let activeSearchTerm = '';
let isFullscreen = false;
let activePlaceholderId = null;

export function getOpenBook() {
    return open ? open.book : null;
}

function sectionSource(section) {
    const title = (section.title || '').trim();
    if (!title) return section.text || '';
    return `${'#'.repeat(Math.min(6, (section.level || 1) + 1))} ${title}\n\n${section.text || ''}`;
}

function chapterHtml(book, chapter, fontScale, searchTerm = '') {
    const key = `${book.id}:${chapter.index}:${book.updatedAt}:${fontScale}:${searchTerm}`;
    if (memo.has(key)) return memo.get(key);
    const byId = new Map(book.sections.map(s => [s.id, s]));
    const html = chapter.sectionIds
        .map(id => byId.get(id))
        .filter(Boolean)
        .map(s => {
            let body = renderMarkdown(sectionSource(s), { images: true });
            if (searchTerm) {
                body = applySearchHighlight(body, searchTerm);
            }
            return `<section class="ereader-section md-content" data-section-id="${escapeHTML(s.id)}">${body}</section>`;
        })
        .join('');
    memo.set(key, html);
    if (memo.size > MEMO_LIMIT) memo.delete(memo.keys().next().value);
    return html;
}

function setOpen(book, chapterIndex, pendingRestore = null) {
    const chapters = buildChapters(book.sections);
    open = {
        book,
        chapters,
        chapterIndex: Math.max(0, Math.min(chapterIndex, chapters.length - 1)),
        renderedAt: book.updatedAt,
        pendingRestore
    };
}

/**
 * Opens a book: the saved section's chapter, scrolled to the saved offset once
 * the view is shown. Returns false (and stays put) when the book is gone.
 */
export async function openBook(id, { switchView = deps.switchView } = {}) {
    await ensureDecorateReadingSections();
    const book = await getBook(id);
    if (!book) {
        showToast(t('ereader_book_missing'));
        return false;
    }
    const saved = getProgress(id);
    const chapters = buildChapters(book.sections);
    const chapter = saved && saved.sectionId ? chapterOfSection(chapters, saved.sectionId) : null;
    setOpen(book, chapter ? chapter.index : 0, chapter ? { offset: saved.offset || 0 } : null);
    lastPos = null;
    await setPrefs({ lastBookId: id });
    if (typeof switchView === 'function') switchView('ereaderBook');
    return true;
}

function contentEl() {
    return document.getElementById('ereaderContent');
}

function sectionEls() {
    const content = contentEl();
    return content ? [...content.querySelectorAll('.ereader-section')] : [];
}

/** The chapter's scroll span on the page, for converting to and from offset. */
function chapterSpan() {
    const content = contentEl();
    if (!content) return { top: 0, span: 0 };
    const rect = content.getBoundingClientRect();
    const top = rect.top + window.scrollY - READING_LINE_PX;
    const span = Math.max(0, content.offsetHeight - window.innerHeight + READING_LINE_PX);
    return { top, span };
}

function currentSectionId() {
    const els = sectionEls();
    let current = els[0];
    for (const el of els) {
        if (el.getBoundingClientRect().top <= READING_LINE_PX) current = el;
        else break;
    }
    return current ? current.dataset.sectionId : null;
}

/**
 * knownSectionId: where a jump just landed (chapter start, a contents entry).
 * Only a scroll by the user is read back from the page geometry.
 */
function capturePosition(knownSectionId = null) {
    if (!open) return;
    const { top, span } = chapterSpan();
    const offset = span > 0 ? Math.max(0, Math.min(1, (window.scrollY - top) / span)) : 0;
    const sectionId = knownSectionId || currentSectionId() || open.chapters[open.chapterIndex]?.sectionIds[0] || null;
    const prevSection = lastPos && lastPos.sectionId;
    lastPos = {
        bookId: open.book.id,
        sectionId,
        offset: Math.round(offset * 1000) / 1000,
        percent: weightedPercent(open.chapters, open.chapterIndex, offset)
    };
    if (sectionId !== prevSection) markTocActive(sectionId);
}

/** Writes the position unless it is the one already stored. */
export async function flushPosition() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!lastPos) return;
    const { bookId, sectionId, offset, percent } = lastPos;
    const stored = getProgress(bookId);
    if (stored && stored.sectionId === sectionId && stored.offset === offset && stored.percent === percent) return;
    await setProgress(bookId, { sectionId, offset, percent });
}

function scrollToOffset(offset) {
    const { top, span } = chapterSpan();
    window.scrollTo({ top: Math.max(0, top + offset * span), behavior: 'instant' });
}

function scrollToSection(sectionId, delta = READING_LINE_PX - 8) {
    const el = sectionEls().find(s => s.dataset.sectionId === sectionId);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - delta;
    window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
}

function renderNav() {
    const pos = document.getElementById('ereaderChapterPos');
    const prev = document.getElementById('ereaderPrevBtn');
    const next = document.getElementById('ereaderNextBtn');
    const n = open ? open.chapters.length : 0;
    const i = open ? open.chapterIndex : 0;
    if (pos) pos.textContent = n > 0 ? `${i + 1} / ${n}` : '';
    if (prev) prev.disabled = !open || i <= 0;
    if (next) next.disabled = !open || i >= n - 1;
}

let decorateReadingSectionsRef = null;

async function ensureDecorateReadingSections() {
    if (!decorateReadingSectionsRef && typeof window !== 'undefined') {
        try {
            const mod = await import('../test/test-ui.js');
            decorateReadingSectionsRef = mod.decorateReadingSections;
        } catch (_) {}
    }
    return decorateReadingSectionsRef;
}

function decorateReaderSections() {
    if (!open) return;
    if (!decorateReadingSectionsRef) {
        ensureDecorateReadingSections().then(fn => {
            if (fn && open) decorateReaderSections();
        });
        return;
    }
    const content = contentEl();
    if (!content) return;
    content.querySelectorAll('.ereader-section').forEach(secEl => {
        const secId = secEl.dataset.sectionId;
        if (secId) {
            decorateReadingSectionsRef(secEl, {
                scope: 'ereader:' + secId,
                cacheKey: open.book.id,
                minSections: 1,
                onRefresh: decorateReaderSections
            });
        }
    });
}

/**
 * Draws the open chapter. Where it lands: a saved offset (opening), a section
 * kept at the same height on screen (font change, sync), a section at the top
 * (contents), or the chapter start.
 */
function renderChapter({ restoreOffset = null, anchorSectionId = null, anchorDelta } = {}) {
    const content = contentEl();
    if (!content || !open) return;
    const fontScale = getPrefs().fontScale || 1;
    content.style.setProperty('--ereader-font-scale', String(fontScale));
    const chapter = open.chapters[open.chapterIndex];
    content.innerHTML = chapter ? chapterHtml(open.book, chapter, fontScale, activeSearchTerm) : '';
    decorateReaderSections();
    open.renderedAt = open.book.updatedAt;
    renderNav();
    updateFontUI();

    if (restoreOffset !== null) {
        scrollToOffset(restoreOffset);
        capturePosition();
    } else if (anchorSectionId) {
        scrollToSection(anchorSectionId, anchorDelta);
        capturePosition(anchorSectionId);
    } else {
        window.scrollTo({ top: 0, behavior: 'instant' });
        capturePosition(chapter ? chapter.sectionIds[0] : null);
    }
}

export async function goToChapter(index) {
    if (!open || index < 0 || index >= open.chapters.length || index === open.chapterIndex) return;
    open.chapterIndex = index;
    renderChapter();
    renderEreaderToc();
    await flushPosition();
}

export async function goToSection(sectionId) {
    if (!open) return;
    const chapter = chapterOfSection(open.chapters, sectionId);
    if (!chapter) return;
    if (chapter.index !== open.chapterIndex) {
        open.chapterIndex = chapter.index;
        renderChapter({ anchorSectionId: sectionId });
    } else {
        scrollToSection(sectionId);
        capturePosition(sectionId);
    }
    renderEreaderToc();
    if (typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches
        && typeof deps.closeMenu === 'function') {
        deps.closeMenu();
    }
    await flushPosition();
}

function updateFontUI() {
    const scale = getPrefs().fontScale || 1;
    const value = document.getElementById('ereaderFontValue');
    const dec = document.getElementById('ereaderFontDecBtn');
    const inc = document.getElementById('ereaderFontIncBtn');
    if (value) value.textContent = `${Math.round(scale * 100)}%`;
    if (dec) dec.disabled = scale <= FONT_STEPS[0];
    if (inc) inc.disabled = scale >= FONT_STEPS[FONT_STEPS.length - 1];
}

/** One step smaller (-1) or larger (+1); the section being read stays put. */
export async function changeFontScale(direction) {
    const current = getPrefs().fontScale || 1;
    let idx = FONT_STEPS.indexOf(current);
    if (idx < 0) idx = FONT_STEPS.findIndex(s => s >= current);
    if (idx < 0) idx = FONT_STEPS.length - 1;
    const nextIdx = Math.max(0, Math.min(FONT_STEPS.length - 1, idx + direction));
    if (FONT_STEPS[nextIdx] === current) return current;

    const anchorId = open && bookViewActive ? currentSectionId() : null;
    const anchorEl = anchorId ? sectionEls().find(s => s.dataset.sectionId === anchorId) : null;
    const anchorDelta = anchorEl ? anchorEl.getBoundingClientRect().top : undefined;

    await setPrefs({ fontScale: FONT_STEPS[nextIdx] });
    if (open && bookViewActive) renderChapter({ anchorSectionId: anchorId, anchorDelta });
    else updateFontUI();
    return FONT_STEPS[nextIdx];
}

function markTocActive(sectionId) {
    const list = document.getElementById('ereaderTocList');
    if (!list) return;
    for (const item of list.querySelectorAll('.ereader-toc-item')) {
        item.classList.toggle('active', item.dataset.sectionId === sectionId);
    }
}

function createGapItem(gap) {
    const item = document.createElement('div');
    item.className = 'menu-sub-item ereader-toc-gap';
    item.dataset.gapFrom = String(gap.from);
    item.dataset.gapTo = String(gap.to);
    item.style.opacity = '0.6';
    item.style.fontStyle = 'italic';
    item.style.cursor = 'default';
    item.textContent = t('ereader_gap_missing', { from: gap.from, to: gap.to });
    return item;
}

/** Paints #ereaderTocList for the open book. */
export function renderEreaderToc() {
    const list = document.getElementById('ereaderTocList');
    if (!list) return;
    if (!open) {
        list.replaceChildren();
        return;
    }
    const sections = open.book.sections;
    const minLevel = Math.min(...sections.map(s => s.level || 1));
    const activeId = (lastPos && lastPos.bookId === open.book.id && lastPos.sectionId)
        || open.chapters[open.chapterIndex]?.sectionIds[0];

    const gaps = detectGaps(open.book.parts || []);
    const pendingGaps = [...gaps];
    const items = [];
    /* Sections of a book that was never merged carry no partFrom; they belong
       to its only part, so a missing start (pages 1-49 of a book imported
       from page 50) is listed before them, not after the last one. */
    const partFroms = (open.book.parts || []).map(p => p.from).filter(Number.isInteger);
    const defaultFrom = partFroms.length > 0 ? Math.min(...partFroms) : undefined;

    for (const s of sections) {
        while (pendingGaps.length > 0) {
            const gap = pendingGaps[0];
            const sFrom = s.partFrom ?? s.pageStart ?? defaultFrom;
            if (sFrom !== undefined && sFrom > gap.to) {
                items.push(createGapItem(gap));
                pendingGaps.shift();
            } else {
                break;
            }
        }

        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'menu-sub-item ereader-toc-item' + (s.id === activeId ? ' active' : '');
        item.dataset.sectionId = s.id;
        item.style.setProperty('--toc-depth', String((s.level || 1) - minLevel));
        item.textContent = (s.title || '').trim() || t('ereader_untitled_section');
        item.onclick = () => goToSection(s.id);
        items.push(item);
    }

    while (pendingGaps.length > 0) {
        items.push(createGapItem(pendingGaps.shift()));
    }

    list.replaceChildren(...items);
}

/**
 * Binding for EREADER_LIBRARY: a synced edit of the open book redraws it at
 * the same section; a deleted book sends the reader back to the library.
 */
export async function refreshOpenBook() {
    if (!open) return;
    const id = open.book.id;
    const summary = listBooks().find(b => b.id === id);
    if (!summary) {
        open = null;
        lastPos = null;
        if (typeof deps.switchView === 'function') deps.switchView('ereaderLibrary', true);
        return;
    }
    if (summary.updatedAt === open.renderedAt) return;
    const book = await getBook(id);
    if (!book) return;
    const anchorId = bookViewActive ? currentSectionId() : null;
    const chapter = anchorId ? chapterOfSection(buildChapters(book.sections), anchorId) : null;
    setOpen(book, chapter ? chapter.index : open.chapterIndex);
    if (bookViewActive) renderChapter({ anchorSectionId: anchorId });
    renderEreaderToc();
}

function setHeaderTitle(title) {
    const header = document.getElementById('headerTitle');
    if (!header) return;
    header.removeAttribute('data-i18n');
    header.textContent = title;
}

/** The contents open by themselves when a book is opened. */
function openTocSection() {
    const header = document.querySelector('#ereaderTocMenuSection .menu-section-header');
    if (!header) return;
    document.querySelectorAll('#actionMenu .menu-section-header.active')
        .forEach(h => { if (h !== header) h.classList.remove('active'); });
    header.classList.add('active');
}

/**
 * Focused search (R2-01): the header button (or Ctrl/Cmd+K, Ctrl/Cmd+F, "/")
 * opens an overlay over the page with the input on top and the matches under
 * it. Up/Down move through the matches, Enter opens one, Esc or a click on the
 * backdrop closes it. Opening a match keeps its highlight in the text; closing
 * without choosing clears it.
 */
let activeResultIndex = -1;

function searchOverlay() {
    return document.getElementById('ereaderSearchOverlay');
}

export function openSearchBar() {
    const overlay = searchOverlay();
    const input = document.getElementById('ereaderSearchInput');
    if (!overlay || !input) return;
    overlay.style.display = 'flex';
    overlay.classList.add('open');
    document.body.classList.add('ereader-search-open');
    input.focus();
    if (input.value) input.select();
}

function hideSearchOverlay() {
    const overlay = searchOverlay();
    if (overlay) {
        overlay.style.display = 'none';
        overlay.classList.remove('open');
    }
    document.body.classList.remove('ereader-search-open');
}

export function closeSearchBar() {
    const input = document.getElementById('ereaderSearchInput');
    const results = document.getElementById('ereaderSearchResults');
    hideSearchOverlay();
    if (input) input.value = '';
    if (results) results.replaceChildren();
    activeResultIndex = -1;
    if (activeSearchTerm) {
        activeSearchTerm = '';
        if (open && bookViewActive) renderChapter({ anchorSectionId: currentSectionId(), anchorDelta: currentAnchorDelta() });
    }
}

export function isSearchBarOpen() {
    const overlay = searchOverlay();
    return !!(overlay && overlay.style.display !== 'none');
}

function currentAnchorDelta() {
    const id = currentSectionId();
    const el = id ? sectionEls().find(s => s.dataset.sectionId === id) : null;
    return el ? el.getBoundingClientRect().top : undefined;
}

function resultButtons() {
    const resultsEl = document.getElementById('ereaderSearchResults');
    return resultsEl ? [...resultsEl.querySelectorAll('.ereader-search-item')] : [];
}

function setActiveResult(index) {
    const items = resultButtons();
    if (items.length === 0) {
        activeResultIndex = -1;
        return;
    }
    activeResultIndex = (index + items.length) % items.length;
    items.forEach((el, i) => {
        const on = i === activeResultIndex;
        el.classList.toggle('active', on);
        el.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    });
}

async function openSearchMatch(m, term) {
    if (!open) return;
    activeSearchTerm = term;
    hideSearchOverlay();
    open.chapterIndex = m.chapterIndex;
    renderChapter({ anchorSectionId: m.sectionId });
    renderEreaderToc();
    const sec = sectionEls().find(s => s.dataset.sectionId === m.sectionId);
    if (sec) {
        const highlight = sec.querySelector('.search-highlight') || sec;
        const y = highlight.getBoundingClientRect().top + window.scrollY - (READING_LINE_PX - 8);
        window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
    }
    await flushPosition();
}

function onSearchInput() {
    const input = document.getElementById('ereaderSearchInput');
    const resultsEl = document.getElementById('ereaderSearchResults');
    if (!input || !resultsEl) return;
    const term = input.value.trim();
    activeResultIndex = -1;
    if (term.length < 2) {
        if (term.length === 1) {
            const hint = document.createElement('div');
            hint.className = 'ereader-search-no-results';
            hint.textContent = t('ereader_search_min_chars');
            resultsEl.replaceChildren(hint);
        } else {
            resultsEl.replaceChildren();
        }
        return;
    }
    const book = getOpenBook();
    if (!book) return;
    const matches = searchBook(book, term);
    if (matches.length === 0) {
        const noRes = document.createElement('div');
        noRes.className = 'ereader-search-no-results';
        noRes.textContent = t('ereader_search_no_results');
        resultsEl.replaceChildren(noRes);
        return;
    }

    const items = matches.map((m, i) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'ereader-search-item';
        item.setAttribute('role', 'option');
        const titleHtml = escapeHTML(m.title || t('ereader_untitled_section'));
        const snippetHtml = applySearchHighlight(escapeHTML(m.snippet), term);
        item.innerHTML = `<div class="ereader-search-title">${titleHtml}</div><div class="ereader-search-snippet">${snippetHtml}</div>`;
        item.onclick = () => openSearchMatch(m, term);
        item.onmouseenter = () => setActiveResult(i);
        return item;
    });
    resultsEl.replaceChildren(...items);
    setActiveResult(0);
}

function onSearchKeydown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (resultButtons().length === 0) return;
        e.preventDefault();
        setActiveResult(activeResultIndex + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter') {
        const items = resultButtons();
        const target = items[activeResultIndex] || items[0];
        if (target) {
            e.preventDefault();
            target.click();
        }
    }
}

/** Ctrl/Cmd+K, Ctrl/Cmd+F or "/" (outside a text field) in the book view. */
function isSearchShortcut(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K' || e.key === 'f' || e.key === 'F')) return true;
    if (e.key === '/' && !mod && !e.altKey) {
        const el = e.target;
        const tag = el && el.tagName ? el.tagName.toLowerCase() : '';
        return !(tag === 'input' || tag === 'textarea' || tag === 'select' || (el && el.isContentEditable));
    }
    return false;
}

/**
 * Fullscreen / Zen Mode (F5)
 */
export function enterFullscreen() {
    const header = document.querySelector('header');
    if (header) header.style.display = 'none';
    const exitBtn = document.getElementById('ereaderZenExitBtn');
    if (exitBtn) exitBtn.style.display = 'flex';
    isFullscreen = true;
    if (typeof document !== 'undefined' && document.documentElement && typeof document.documentElement.requestFullscreen === 'function') {
        document.documentElement.requestFullscreen().catch(() => {});
    }
}

export function exitFullscreen(view = 'ereaderBook') {
    if (!isFullscreen) return;
    isFullscreen = false;
    const exitBtn = document.getElementById('ereaderZenExitBtn');
    if (exitBtn) exitBtn.style.display = 'none';
    if (typeof document !== 'undefined' && document.fullscreenElement && typeof document.exitFullscreen === 'function') {
        document.exitFullscreen().catch(() => {});
    }
    applyEreaderChrome(view, { goHome: () => deps.switchView && deps.switchView('home') });
}

export function isZenFullscreen() {
    return isFullscreen;
}

/**
 * Print / PDF (F5)
 */
export function printOpenBook() {
    const book = getOpenBook();
    if (!book) return;
    if (typeof deps.closeMenu === 'function') deps.closeMenu();
    const host = document.getElementById('ereaderPrintHost');
    if (!host) return;

    const sectionsHtml = book.sections
        .map(s => `<section class="ereader-section md-content" data-section-id="${escapeHTML(s.id)}">${renderMarkdown(sectionSource(s), { images: true })}</section>`)
        .join('');

    host.innerHTML = `<div class="ereader-print-book"><h1>${escapeHTML(book.title)}</h1>${book.author ? `<p class="ereader-print-author">${escapeHTML(book.author)}</p>` : ''}${sectionsHtml}</div>`;
    host.style.display = 'block';

    const cleanup = () => {
        host.innerHTML = '';
        host.style.display = 'none';
        if (typeof window !== 'undefined') window.removeEventListener('afterprint', cleanup);
    };
    if (typeof window !== 'undefined') {
        window.addEventListener('afterprint', cleanup);
        if (typeof window.print === 'function') {
            window.print();
        }
    }
}

/**
 * Called by applyEreaderChrome() when the book view is shown. False means
 * there is no open book (a Back into the view), and the caller goes to the
 * library.
 */
export function enterBookView() {
    if (!open) return false;
    bookViewActive = true;
    setHeaderTitle(open.book.title);
    const restore = open.pendingRestore;
    open.pendingRestore = null;
    renderChapter(restore ? { restoreOffset: restore.offset } : {});
    renderEreaderToc();
    openTocSection();
    return true;
}

/** Called by applyEreaderChrome() for every other view. */
export function leaveBookView() {
    if (!bookViewActive) return;
    bookViewActive = false;
    if (isFullscreen) {
        exitFullscreen('ereaderLibrary');
    }
    closeSearchBar();
    flushPosition();
}

function onScroll() {
    if (!bookViewActive || !open) return;
    capturePosition();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushPosition, SAVE_DELAY_MS);
}

export function openImageUrlModal(placeholderId) {
    const overlay = document.getElementById('ereaderImageUrlOverlay');
    const input = document.getElementById('ereaderImageUrlInput');
    if (!overlay || !input) return;
    activePlaceholderId = placeholderId;
    input.value = '';
    overlay.classList.add('active');
    input.focus();
}

export function closeImageUrlModal() {
    const overlay = document.getElementById('ereaderImageUrlOverlay');
    if (overlay) overlay.classList.remove('active');
    activePlaceholderId = null;
}

/** One-time wiring of the static controls and page-level listeners. */
export function bindEreaderReader({ switchView, closeMenu } = {}) {
    deps = { switchView, closeMenu };
    if (bound) return;
    bound = true;

    const prev = document.getElementById('ereaderPrevBtn');
    const next = document.getElementById('ereaderNextBtn');
    if (prev) prev.onclick = () => open && goToChapter(open.chapterIndex - 1);
    if (next) next.onclick = () => open && goToChapter(open.chapterIndex + 1);

    const dec = document.getElementById('ereaderFontDecBtn');
    const inc = document.getElementById('ereaderFontIncBtn');
    if (dec) dec.onclick = () => changeFontScale(-1);
    if (inc) inc.onclick = () => changeFontScale(1);
    updateFontUI();

    const searchBtn = document.getElementById('ereaderSearchBtn');
    if (searchBtn) {
        searchBtn.onclick = () => {
            if (isSearchBarOpen()) closeSearchBar();
            else openSearchBar();
        };
    }

    const searchInput = document.getElementById('ereaderSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', onSearchInput);
        searchInput.addEventListener('keydown', onSearchKeydown);
    }

    const searchOverlayEl = searchOverlay();
    if (searchOverlayEl) {
        searchOverlayEl.addEventListener('click', (e) => {
            if (e.target === searchOverlayEl) closeSearchBar();
        });
    }

    const fsBtn = document.getElementById('ereaderFullscreenBtn');
    if (fsBtn) {
        fsBtn.onclick = () => enterFullscreen();
    }

    const exitBtn = document.getElementById('ereaderZenExitBtn');
    if (exitBtn) {
        exitBtn.onclick = () => exitFullscreen();
    }

    const printBtn = document.getElementById('ereaderPrintBtn');
    if (printBtn) {
        printBtn.onclick = () => printOpenBook();
    }

    const content = document.getElementById('ereaderContent');
    if (content) {
        content.addEventListener('click', (e) => {
            const placeholder = e.target.closest('.md-image-placeholder');
            if (placeholder && placeholder.dataset.placeholderId) {
                openImageUrlModal(placeholder.dataset.placeholderId);
            }
        });
    }

    const imgSaveBtn = document.getElementById('ereaderImageUrlSaveBtn');
    const imgCancelBtn = document.getElementById('ereaderImageUrlCancelBtn');
    const imgInput = document.getElementById('ereaderImageUrlInput');
    const imgOverlay = document.getElementById('ereaderImageUrlOverlay');

    if (imgSaveBtn && imgInput) {
        imgSaveBtn.onclick = async () => {
            const url = imgInput.value.trim().replace(/[()]/g, c => (c === '(' ? '%28' : '%29'));
            if (!/^https:\/\/[^\s]+$/i.test(url)) {
                showAlert(t('ereader_invalid_image_url'), t('warning_title'));
                return;
            }
            const placeholderId = activePlaceholderId;
            const anchorId = bookViewActive ? currentSectionId() : null;
            const anchorEl = anchorId ? sectionEls().find(s => s.dataset.sectionId === anchorId) : null;
            const anchorDelta = anchorEl ? anchorEl.getBoundingClientRect().top : undefined;

            closeImageUrlModal();
            if (!open || !placeholderId) return;

            await updateBook(open.book.id, (book) => {
                const escId = placeholderId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const mdImageRe = new RegExp(`(!\\[[^\\]]*\\])\\(${escId}\\)`, 'g');
                for (const s of book.sections) {
                    if (typeof s.text === 'string') {
                        if (placeholderId.startsWith('placeholder:')) {
                            s.text = s.text.replace(mdImageRe, (m, p1) => `${p1}(${url})`);
                        } else {
                            s.text = s.text.replaceAll(`![[${placeholderId}]]`, `![${placeholderId}](${url})`);
                            s.text = s.text.replace(mdImageRe, (m, p1) => `${p1}(${url})`);
                        }
                    }
                }
            });

            const updated = await getBook(open.book.id);
            if (updated) {
                open.book = updated;
                memo.clear();
                renderChapter({ anchorSectionId: anchorId, anchorDelta });
            }
        };
    }

    if (imgCancelBtn) imgCancelBtn.onclick = closeImageUrlModal;
    if (imgOverlay) {
        imgOverlay.addEventListener('click', (e) => {
            if (e.target === imgOverlay) closeImageUrlModal();
        });
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('keydown', (e) => {
            if (bookViewActive && !isSearchBarOpen() && isSearchShortcut(e)) {
                e.preventDefault();
                openSearchBar();
                return;
            }
            if (e.key === 'Escape') {
                if (isSearchBarOpen()) {
                    closeSearchBar();
                } else if (isFullscreen) {
                    exitFullscreen();
                } else if (imgOverlay && imgOverlay.classList.contains('active')) {
                    closeImageUrlModal();
                }
            }
        });
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement && isFullscreen) {
                exitFullscreen();
            }
        });
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushPosition();
    });
}

/** Test seam. */
export function _resetEreaderReaderForTests() {
    open = null;
    bookViewActive = false;
    lastPos = null;
    clearTimeout(saveTimer);
    saveTimer = null;
    memo.clear();
    deps = { switchView: null, closeMenu: null };
    activeSearchTerm = '';
    activeResultIndex = -1;
    isFullscreen = false;
    hideSearchOverlay();
    closeImageUrlModal();
}
