/**
 * e-Reader reading screen: the whole book in one continuous scroll, the
 * reading position, the table of contents, the font size and the "up" button.
 *
 * There are no chapter pages. Every section of the book has a light shell in
 * the DOM (an empty <section> holding its height); only the sections around
 * the viewport carry their rendered Markdown. Scrolling mounts the sections
 * that come near and empties the ones that have moved far away, remembering
 * their measured height, so a book of a few hundred pages keeps a small DOM
 * and never parses all of its Markdown at once. Sections never measured are
 * given an estimated height from their text length, learned from the ones
 * that were.
 *
 * Mounting changes heights above the reader, so every mount pass keeps the
 * section at the reading line where it was on screen (manual scroll
 * anchoring; the browser's own is switched off for the content, see CSS).
 *
 * The position is tracked on every scroll event (in memory) and written a few
 * seconds after scrolling stops, on a jump, when the view is left and when the
 * tab is hidden. It is read from memory at those moments, never from
 * window.scrollY: by the time switchView() tells us the view changed, the page
 * has already been scrolled for the next one.
 */

import { t } from '../../core/i18n.js';
import { renderMarkdown, applySearchHighlight } from '../../core/markdown.js';
import { escapeHTML, showToast, showAlert } from '../../core/utils.js';
import { getBook, getProgress, setProgress, getPrefs, setPrefs, listBooks, updateBook } from './ereader-store.js';
import { weightedPercent } from './ereader-chapters.js';
import { searchBook } from './ereader-search.js';
import { applyEreaderChrome } from './ereader-shell.js';
import { detectGaps } from './ereader-parts.js';

export const FONT_STEPS = Object.freeze([0.875, 1, 1.125, 1.25, 1.375, 1.5]);
const SAVE_DELAY_MS = 5000;
const MOBILE_QUERY = '(max-width: 600px)';
/** A section counts as "being read" once its top has passed this line. */
const READING_LINE_PX = 96;
/** Where a jump puts the heading it lands on (just under the header). */
const JUMP_DELTA_PX = READING_LINE_PX - 8;
const MEMO_LIMIT = 400;
/** Mount window, in viewport heights above and below the screen. */
const MOUNT_BEHIND = 1;
const MOUNT_AHEAD = 1.5;
/** A mounted section is emptied once it is this many viewports away. */
const UNMOUNT_BEYOND = 3;
const MIN_ESTIMATE_PX = 48;
/** Heading and margins of a section, over and above its text. */
const SECTION_CHROME_PX = 64;
const TOP_BTN_SHOW_PX = 400;
const LONG_PRESS_MS = 550;

/**
 * { book, sections, weights, indexOf, heights, mounted, els, pxPerChar,
 *   renderedAt, pendingRestore }
 */
let open = null;
let bookViewActive = false;
let lastPos = null;
let saveTimer = null;
let windowFrame = null;
let anchorSnap = null;
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

function textLength(section) {
    return typeof section.text === 'string' ? section.text.length : 0;
}

function sectionHtml(book, section, searchTerm = '') {
    const key = `${book.id}:${section.id}:${book.updatedAt}:${searchTerm}`;
    if (memo.has(key)) return memo.get(key);
    let html = renderMarkdown(sectionSource(section), { images: true });
    if (searchTerm) html = applySearchHighlight(html, searchTerm);
    memo.set(key, html);
    if (memo.size > MEMO_LIMIT) memo.delete(memo.keys().next().value);
    return html;
}

function setOpen(book, pendingRestore = null) {
    const sections = Array.isArray(book.sections) ? book.sections : [];
    open = {
        book,
        sections,
        /* weightedPercent() over sections: each one weighs its text length. */
        weights: sections.map((s, i) => ({ index: i, textLength: textLength(s) })),
        indexOf: new Map(sections.map((s, i) => [s.id, i])),
        heights: new Map(),
        mounted: new Set(),
        els: [],
        pxPerChar: 0,
        renderedAt: book.updatedAt,
        pendingRestore
    };
}

/**
 * Opens a book at its saved section and offset once the view is shown.
 * Returns false (and stays put) when the book is gone.
 */
export async function openBook(id, { switchView = deps.switchView } = {}) {
    await ensureDecorateReadingSections();
    const book = await getBook(id);
    if (!book) {
        showToast(t('ereader_book_missing'));
        return false;
    }
    const saved = getProgress(id);
    const known = saved && saved.sectionId && book.sections.some(s => s.id === saved.sectionId);
    setOpen(book, known ? { sectionId: saved.sectionId, offset: saved.offset || 0 } : null);
    lastPos = null;
    await setPrefs({ lastBookId: id });
    if (typeof switchView === 'function') switchView('ereaderBook');
    return true;
}

function contentEl() {
    return document.getElementById('ereaderContent');
}

/** The section shells, in book order (mounted or not). */
function sectionEls() {
    if (open && open.els.length > 0 && open.els[0].isConnected) return open.els;
    const content = contentEl();
    return content ? [...content.querySelectorAll('.ereader-section')] : [];
}

function shellOf(sectionId) {
    if (!open) return null;
    const i = open.indexOf.get(sectionId);
    const els = sectionEls();
    return i === undefined ? null : (els[i] || null);
}

/** Index of the last shell whose top has passed `line` (binary search). */
function indexAtLine(line = READING_LINE_PX) {
    const els = sectionEls();
    if (els.length === 0) return -1;
    let lo = 0;
    let hi = els.length - 1;
    let found = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (els[mid].getBoundingClientRect().top <= line) {
            found = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return found;
}

function currentSectionId() {
    const i = indexAtLine();
    const el = i >= 0 ? sectionEls()[i] : null;
    return el ? el.dataset.sectionId : null;
}

// ── height estimates ──────────────────────────────────────────────────────

function defaultPxPerChar() {
    const content = contentEl();
    const width = (content && content.clientWidth) || 640;
    const fontPx = 17 * (getPrefs().fontScale || 1);
    const charsPerLine = Math.max(20, width / (fontPx * 0.5));
    return (fontPx * 1.75) / charsPerLine;
}

function estimateHeight(section) {
    const measured = open.heights.get(section.id);
    if (measured) return measured;
    const ratio = open.pxPerChar || defaultPxPerChar();
    return Math.max(MIN_ESTIMATE_PX, Math.round(textLength(section) * ratio + SECTION_CHROME_PX));
}

/** Learns px-per-character from the sections that have been measured. */
function learnRatio() {
    let px = 0;
    let chars = 0;
    for (const [id, h] of open.heights) {
        const s = open.sections[open.indexOf.get(id)];
        const len = s ? textLength(s) : 0;
        if (len >= 200) {
            px += Math.max(0, h - SECTION_CHROME_PX);
            chars += len;
        }
    }
    if (chars > 0) open.pxPerChar = px / chars;
}

// ── mounting ──────────────────────────────────────────────────────────────

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

function decorateSection(el) {
    if (!open || !el) return;
    if (!decorateReadingSectionsRef) {
        ensureDecorateReadingSections().then(fn => {
            if (fn && open) decorateMounted();
        });
        return;
    }
    const secId = el.dataset.sectionId;
    if (!secId) return;
    decorateReadingSectionsRef(el, {
        scope: 'ereader:' + secId,
        cacheKey: open.book.id,
        minSections: 1,
        onRefresh: decorateMounted
    });
}

function decorateMounted() {
    if (!open) return;
    for (const el of sectionEls()) {
        if (el.dataset.mounted === '1') decorateSection(el);
    }
}

function mountSection(el) {
    const section = open.sections[Number(el.dataset.index)];
    if (!section) return;
    el.innerHTML = sectionHtml(open.book, section, activeSearchTerm);
    el.style.height = '';
    el.dataset.mounted = '1';
    open.mounted.add(section.id);
    decorateSection(el);
}

function unmountSection(el) {
    const id = el.dataset.sectionId;
    const h = el.offsetHeight;
    if (h > 0) open.heights.set(id, h);
    el.style.height = `${h > 0 ? h : estimateHeight(open.sections[Number(el.dataset.index)])}px`;
    el.replaceChildren();
    el.dataset.mounted = '0';
    open.mounted.delete(id);
}

/**
 * One mount pass: mounts the sections inside the window around the screen,
 * empties the far ones, then puts the anchor section back where it was on
 * screen (or at pin.delta when the caller asks for a fixed spot).
 */
function updateWindow(pin = null) {
    if (!open) return;
    const els = sectionEls();
    if (els.length === 0) return;
    const vh = window.innerHeight || 800;

    const anchorEl = pin ? pin.el : els[Math.max(0, indexAtLine())];
    const anchorTop = anchorEl ? anchorEl.getBoundingClientRect().top : 0;

    const lo = -MOUNT_BEHIND * vh;
    const hi = vh * (1 + MOUNT_AHEAD);
    const farLo = -UNMOUNT_BEYOND * vh;
    const farHi = vh * (1 + UNMOUNT_BEYOND);

    const toMount = [];
    const start = Math.max(0, indexAtLine(lo));
    for (let i = start; i < els.length; i++) {
        const r = els[i].getBoundingClientRect();
        if (r.top > hi) break;
        if (r.bottom >= lo && els[i].dataset.mounted !== '1') toMount.push(els[i]);
    }
    if (anchorEl && anchorEl.dataset.mounted !== '1' && !toMount.includes(anchorEl)) toMount.push(anchorEl);

    const toUnmount = [];
    for (const id of open.mounted) {
        const el = shellOf(id);
        if (!el || el === anchorEl) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom < farLo || r.top > farHi) toUnmount.push(el);
    }

    if (toMount.length === 0 && toUnmount.length === 0 && !pin) return;

    for (const el of toUnmount) unmountSection(el);
    for (const el of toMount) mountSection(el);
    for (const el of toMount) {
        const h = el.offsetHeight;
        if (h > 0) open.heights.set(el.dataset.sectionId, h);
    }
    if (toMount.length > 0) learnRatio();

    if (anchorEl) {
        const target = pin ? pin.delta : anchorTop;
        const d = anchorEl.getBoundingClientRect().top - target;
        if (Math.abs(d) > 0.5) window.scrollTo({ top: Math.max(0, window.scrollY + d), behavior: 'instant' });
    }
    snapAnchor();
}

function scheduleWindow() {
    if (windowFrame !== null) return;
    const raf = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (fn) => setTimeout(fn, 16);
    windowFrame = raf(() => {
        windowFrame = null;
        updateWindow();
    });
}

/** Remembers where the reading-line section is, for image loads to keep it. */
function snapAnchor() {
    const i = indexAtLine();
    const el = i >= 0 ? sectionEls()[i] : null;
    anchorSnap = el ? { el, top: el.getBoundingClientRect().top } : null;
}

/** An image finishing above the reader must not push the text away. */
function onContentLoad(e) {
    if (!open || !e.target || e.target.tagName !== 'IMG' || !anchorSnap || !anchorSnap.el.isConnected) return;
    const d = anchorSnap.el.getBoundingClientRect().top - anchorSnap.top;
    if (Math.abs(d) > 0.5) window.scrollTo({ top: Math.max(0, window.scrollY + d), behavior: 'instant' });
    const id = e.target.closest('.ereader-section')?.dataset.sectionId;
    const el = id ? shellOf(id) : null;
    if (el && el.offsetHeight > 0) open.heights.set(id, el.offsetHeight);
    snapAnchor();
}

/**
 * Puts a section at `delta` px from the top of the screen, `fraction` of the
 * way into it at the reading line when given (a saved position).
 */
function placeSection(sectionId, { delta = JUMP_DELTA_PX, fraction = 0 } = {}) {
    const el = shellOf(sectionId);
    if (!el) return false;
    const y = el.getBoundingClientRect().top + window.scrollY - delta;
    window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
    updateWindow({ el, delta: el.getBoundingClientRect().top });
    updateWindow({ el, delta });
    if (fraction > 0) {
        const r = el.getBoundingClientRect();
        const target = window.scrollY + r.top + fraction * r.height - READING_LINE_PX;
        window.scrollTo({ top: Math.max(0, target), behavior: 'instant' });
        updateWindow();
    }
    return true;
}

/**
 * Draws the book's shells and lands: at a saved position (opening), a section
 * kept at the same height on screen (font change, sync), or the book start.
 */
function renderBook({ restore = null, anchorSectionId = null, anchorDelta } = {}) {
    const content = contentEl();
    if (!content || !open) return;
    const fontScale = getPrefs().fontScale || 1;
    content.style.setProperty('--ereader-font-scale', String(fontScale));
    open.mounted.clear();
    content.innerHTML = open.sections
        .map((s, i) => `<section class="ereader-section md-content" data-section-id="${escapeHTML(s.id)}" data-index="${i}" data-mounted="0" style="height:${estimateHeight(s)}px"></section>`)
        .join('');
    open.els = [...content.querySelectorAll('.ereader-section')];
    open.renderedAt = open.book.updatedAt;
    updateFontUI();

    if (restore && restore.sectionId && placeSection(restore.sectionId, { delta: READING_LINE_PX, fraction: restore.offset || 0 })) {
        capturePosition(restore.sectionId, restore.offset || 0);
    } else if (anchorSectionId && placeSection(anchorSectionId, { delta: anchorDelta ?? JUMP_DELTA_PX })) {
        capturePosition(anchorSectionId);
    } else {
        window.scrollTo({ top: 0, behavior: 'instant' });
        updateWindow();
        capturePosition(open.sections[0] ? open.sections[0].id : null);
    }
    updateTopButton();
}

/** Re-renders the mounted sections in place (a search highlight came or went). */
function refreshMounted() {
    if (!open) return;
    const anchorId = currentSectionId();
    const anchorEl = anchorId ? shellOf(anchorId) : null;
    const delta = anchorEl ? anchorEl.getBoundingClientRect().top : 0;
    for (const el of sectionEls()) {
        if (el.dataset.mounted === '1') mountSection(el);
    }
    if (anchorEl) updateWindow({ el: anchorEl, delta });
}

// ── position ──────────────────────────────────────────────────────────────

/**
 * knownSectionId: where a jump just landed (a contents entry, a match).
 * Only a scroll by the user is read back from the page geometry.
 */
function capturePosition(knownSectionId = null, knownFraction = 0) {
    if (!open) return;
    let index = knownSectionId ? open.indexOf.get(knownSectionId) : undefined;
    let fraction = index === undefined ? 0 : Math.max(0, Math.min(1, knownFraction || 0));
    if (index === undefined) {
        index = Math.max(0, indexAtLine());
        const el = sectionEls()[index];
        if (el) {
            const r = el.getBoundingClientRect();
            fraction = r.height > 0 ? Math.max(0, Math.min(1, (READING_LINE_PX - r.top) / r.height)) : 0;
        }
    }
    const section = open.sections[index];
    if (!section) return;
    const prevSection = lastPos && lastPos.sectionId;
    lastPos = {
        bookId: open.book.id,
        sectionId: section.id,
        offset: Math.round(fraction * 1000) / 1000,
        percent: weightedPercent(open.weights, index, fraction)
    };
    if (section.id !== prevSection) markTocActive(section.id);
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

export async function goToSection(sectionId) {
    if (!open || !placeSection(sectionId)) return;
    capturePosition(sectionId);
    await flushPosition();
}

// ── up button ─────────────────────────────────────────────────────────────

/**
 * The heading the up button goes to: the one of the section being read when
 * the reader is inside it, else the previous titled section's.
 */
export function upTargetSectionId() {
    if (!open) return null;
    const els = sectionEls();
    let i = indexAtLine();
    if (i < 0) return null;
    const top = els[i].getBoundingClientRect().top;
    if (top >= JUMP_DELTA_PX - 4) i -= 1;
    while (i >= 0 && !(open.sections[i].title || '').trim()) i -= 1;
    return i >= 0 ? open.sections[i].id : null;
}

/** Up: nearest heading above; toStart (Ctrl/Cmd+click, long press): book start. */
export async function goUp({ toStart = false } = {}) {
    if (!open) return;
    const target = toStart ? null : upTargetSectionId();
    if (target) {
        await goToSection(target);
    } else {
        window.scrollTo({ top: 0, behavior: 'instant' });
        updateWindow();
        capturePosition(open.sections[0] ? open.sections[0].id : null);
        await flushPosition();
    }
    updateTopButton();
}

function updateTopButton() {
    const btn = document.getElementById('ereaderTopBtn');
    if (!btn) return;
    btn.classList.toggle('visible', !!open && bookViewActive && window.scrollY > TOP_BTN_SHOW_PX);
}

function bindTopButton(btn) {
    let pressTimer = null;
    let longPressed = false;
    btn.addEventListener('click', (e) => {
        if (longPressed) {
            longPressed = false;
            return;
        }
        goUp({ toStart: e.ctrlKey || e.metaKey });
    });
    btn.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse') return;
        longPressed = false;
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
            longPressed = true;
            goUp({ toStart: true });
        }, LONG_PRESS_MS);
    });
    const cancel = () => clearTimeout(pressTimer);
    btn.addEventListener('pointerup', cancel);
    btn.addEventListener('pointerleave', cancel);
    btn.addEventListener('pointercancel', cancel);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ── font size ─────────────────────────────────────────────────────────────

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
    const anchorEl = anchorId ? shellOf(anchorId) : null;
    const anchorDelta = anchorEl ? anchorEl.getBoundingClientRect().top : undefined;

    await setPrefs({ fontScale: FONT_STEPS[nextIdx] });
    if (open && bookViewActive) {
        open.heights.clear();
        open.pxPerChar = 0;
        renderBook({ anchorSectionId: anchorId, anchorDelta });
    } else {
        updateFontUI();
    }
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
        || (open.sections[0] && open.sections[0].id);

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
    const anchorEl = anchorId ? shellOf(anchorId) : null;
    const anchorDelta = anchorEl ? anchorEl.getBoundingClientRect().top : undefined;
    setOpen(book);
    if (bookViewActive) {
        const keep = anchorId && book.sections.some(s => s.id === anchorId) ? anchorId : null;
        renderBook({ anchorSectionId: keep, anchorDelta });
    }
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
        if (open && bookViewActive) refreshMounted();
    }
}

export function isSearchBarOpen() {
    const overlay = searchOverlay();
    return !!(overlay && overlay.style.display !== 'none');
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
    const termChanged = activeSearchTerm !== term;
    activeSearchTerm = term;
    hideSearchOverlay();
    if (termChanged) {
        for (const el of sectionEls()) {
            if (el.dataset.mounted === '1') mountSection(el);
        }
    }
    if (!placeSection(m.sectionId)) return;
    const sec = shellOf(m.sectionId);
    const highlight = sec && sec.querySelector('.search-highlight');
    if (highlight) {
        const y = highlight.getBoundingClientRect().top + window.scrollY - JUMP_DELTA_PX;
        window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
        updateWindow();
    }
    capturePosition(m.sectionId);
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
    renderBook({ restore });
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
    updateTopButton();
    flushPosition();
}

function onScroll() {
    if (!bookViewActive || !open) return;
    scheduleWindow();
    capturePosition();
    updateTopButton();
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

    const topBtn = document.getElementById('ereaderTopBtn');
    if (topBtn) bindTopButton(topBtn);

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
        content.addEventListener('load', onContentLoad, true);
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
            const anchorEl = anchorId ? shellOf(anchorId) : null;
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
                const heights = open.heights;
                setOpen(updated);
                open.heights = heights;
                memo.clear();
                renderBook({ anchorSectionId: anchorId, anchorDelta });
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
        let lastWidth = window.innerWidth;
        window.addEventListener('resize', () => {
            if (!open || !bookViewActive) return;
            if (window.innerWidth !== lastWidth) {
                lastWidth = window.innerWidth;
                open.heights.clear();
                open.pxPerChar = 0;
            }
            scheduleWindow();
        });
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
    windowFrame = null;
    anchorSnap = null;
    memo.clear();
    deps = { switchView: null, closeMenu: null };
    activeSearchTerm = '';
    activeResultIndex = -1;
    isFullscreen = false;
    hideSearchOverlay();
    closeImageUrlModal();
}
