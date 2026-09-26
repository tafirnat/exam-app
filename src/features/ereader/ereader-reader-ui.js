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

/**
 * R2-09: three text sizes. Normal is the app's own body size (1rem); the
 * reading area is font-size: calc(1rem * scale).
 */
export const FONT_STEPS = Object.freeze([0.875, 1, 1.1875]);
const FONT_STEP_NAMES = Object.freeze(['small', 'normal', 'large']);
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
    const fontPx = 16 * currentFontScale();
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
    content.style.setProperty('--ereader-font-scale', String(currentFontScale()));
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

/** The save button: writes the position now and says so. */
export async function saveReadingPosition() {
    if (!open) return false;
    capturePosition();
    await flushPosition();
    const btn = document.getElementById('ereaderSavePosBtn');
    if (btn) {
        btn.classList.add('saved');
        setTimeout(() => btn.classList.remove('saved'), 1200);
    }
    showToast(t('ereader_position_saved'));
    return true;
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

/** A stored scale from the old six-step scale lands on the nearest step. */
export function normalizeFontScale(scale) {
    const value = typeof scale === 'number' && Number.isFinite(scale) ? scale : 1;
    let best = 1;
    for (const step of FONT_STEPS) {
        if (Math.abs(step - value) < Math.abs(best - value)) best = step;
    }
    return best;
}

function currentFontScale() {
    return normalizeFontScale(getPrefs().fontScale || 1);
}

function updateFontUI() {
    const btn = document.getElementById('ereaderFontCycleBtn');
    if (!btn) return;
    const idx = FONT_STEPS.indexOf(currentFontScale());
    const name = FONT_STEP_NAMES[idx] || 'normal';
    btn.dataset.size = name;
    const label = `${t('ereader_font_size')}: ${t('ereader_font_' + name)}`;
    btn.title = label;
    btn.setAttribute('aria-label', label);
}

/** Aa+: small -> normal -> large -> small. Returns the new scale. */
export async function cycleFontSize() {
    const idx = FONT_STEPS.indexOf(currentFontScale());
    return setFontScale(FONT_STEPS[(idx + 1) % FONT_STEPS.length]);
}

/** One step smaller (-1) or larger (+1), stopping at both ends. */
export async function changeFontScale(direction) {
    const idx = FONT_STEPS.indexOf(currentFontScale());
    const nextIdx = Math.max(0, Math.min(FONT_STEPS.length - 1, idx + direction));
    return setFontScale(FONT_STEPS[nextIdx]);
}

/** Applies a size to the reading area only; the section being read stays put. */
async function setFontScale(scale) {
    const current = currentFontScale();
    if (scale === current && getPrefs().fontScale === current) return current;

    const anchorId = open && bookViewActive ? currentSectionId() : null;
    const anchorEl = anchorId ? shellOf(anchorId) : null;
    const anchorDelta = anchorEl ? anchorEl.getBoundingClientRect().top : undefined;

    await setPrefs({ fontScale: scale });
    if (open && bookViewActive) {
        open.heights.clear();
        open.pxPerChar = 0;
        renderBook({ anchorSectionId: anchorId, anchorDelta });
    } else {
        updateFontUI();
    }
    return scale;
}

// ── contents (R2-03) ─────────────────────────────────────────────────────

/** Heading depths listed in the contents: h1, h2, h3 of the book. */
const TOC_MAX_DEPTH = 2;
/** Section id -> the contents entry that stands for it (itself or an ancestor). */
let tocOwner = new Map();
/** Entries whose children are shown. Kept across redraws of the same book. */
let tocExpanded = new Set();
let tocBookId = null;

const TOC_CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>';

function tocList() {
    return document.getElementById('ereaderTocList');
}

function tocNodeOf(sectionId) {
    const list = tocList();
    if (!list || !sectionId) return null;
    const item = [...list.querySelectorAll('.ereader-toc-item')].find(i => i.dataset.sectionId === sectionId);
    return item ? item.closest('.ereader-toc-node') : null;
}

function setTocExpanded(node, expanded) {
    if (!node || !node.querySelector(':scope > .ereader-toc-children')) return;
    node.classList.toggle('expanded', expanded);
    const id = node.dataset.nodeId;
    if (expanded) tocExpanded.add(id);
    else tocExpanded.delete(id);
    const toggle = node.querySelector(':scope > .ereader-toc-row > .ereader-toc-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

/** Opens the chain of entries down to the one standing for sectionId. */
function expandTocPathTo(sectionId) {
    let node = tocNodeOf(tocOwner.get(sectionId) || sectionId);
    node = node && node.parentElement ? node.parentElement.closest('.ereader-toc-node') : null;
    while (node) {
        setTocExpanded(node, true);
        node = node.parentElement ? node.parentElement.closest('.ereader-toc-node') : null;
    }
}

/**
 * Marks the entry being read. When it sits inside a closed entry, that
 * visible ancestor carries a soft marker instead, so the list does not jump
 * open while the reader scrolls.
 */
function markTocActive(sectionId) {
    const list = tocList();
    if (!list) return;
    const ownerId = tocOwner.get(sectionId) || sectionId;
    for (const item of list.querySelectorAll('.ereader-toc-item')) {
        item.classList.toggle('active', item.dataset.sectionId === ownerId);
        item.classList.remove('has-active');
    }
    let node = tocNodeOf(ownerId);
    node = node && node.parentElement ? node.parentElement.closest('.ereader-toc-node') : null;
    while (node) {
        if (!node.classList.contains('expanded')) {
            const item = node.querySelector(':scope > .ereader-toc-row > .ereader-toc-item');
            if (item) item.classList.add('has-active');
        }
        node = node.parentElement ? node.parentElement.closest('.ereader-toc-node') : null;
    }
}

/** Opening the menu shows the entry being read, opened and in view. */
export function revealActiveInToc() {
    if (!open) return;
    const id = (lastPos && lastPos.bookId === open.book.id && lastPos.sectionId) || null;
    if (!id) return;
    expandTocPathTo(id);
    markTocActive(id);
    const item = tocList()?.querySelector('.ereader-toc-item.active');
    if (item && typeof item.scrollIntoView === 'function') item.scrollIntoView({ block: 'nearest' });
}

function createGapItem(gap) {
    const item = document.createElement('div');
    item.className = 'ereader-toc-gap';
    item.dataset.gapFrom = String(gap.from);
    item.dataset.gapTo = String(gap.to);
    item.textContent = t('ereader_gap_missing', { from: gap.from, to: gap.to });
    return item;
}

/** A title click: open its children (if any) and scroll to it; the menu stays. */
function onTocItemClick(node, sectionId) {
    if (node.querySelector(':scope > .ereader-toc-children')) {
        const depth = Number(node.dataset.depth);
        if (depth === 0) {
            /* One chapter open at a time keeps the list short. */
            for (const other of tocList().querySelectorAll('.ereader-toc-node[data-depth="0"].expanded')) {
                if (other !== node) setTocExpanded(other, false);
            }
        }
        setTocExpanded(node, true);
    }
    goToSection(sectionId);
}

/** Paints #ereaderTocList for the open book: h1 > h2 > h3, h1 only at first. */
export function renderEreaderToc() {
    const list = tocList();
    if (!list) return;
    tocOwner = new Map();
    if (!open) {
        list.replaceChildren();
        return;
    }
    if (tocBookId !== open.book.id) {
        tocBookId = open.book.id;
        tocExpanded = new Set();
    }
    const sections = open.book.sections;
    const minLevel = Math.min(...sections.map(s => s.level || 1));
    const activeId = (lastPos && lastPos.bookId === open.book.id && lastPos.sectionId)
        || (open.sections[0] && open.sections[0].id);

    const pendingGaps = [...detectGaps(open.book.parts || [])];
    /* Sections of a book that was never merged carry no partFrom; they belong
       to its only part, so a missing start (pages 1-49 of a book imported
       from page 50) is listed before them, not after the last one. */
    const partFroms = (open.book.parts || []).map(p => p.from).filter(Number.isInteger);
    const defaultFrom = partFroms.length > 0 ? Math.min(...partFroms) : undefined;

    const root = document.createDocumentFragment();
    /** [{ depth, id, node, children }] - the open entries above the current one. */
    const stack = [];
    /* A children box (and the open / close chevron) only where there are children. */
    const containerFor = (parent) => {
        if (!parent) return root;
        if (!parent.children.parentNode) {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'ereader-toc-toggle';
            toggle.setAttribute('aria-expanded', 'false');
            toggle.setAttribute('aria-label', t('ereader_toc_toggle'));
            toggle.innerHTML = TOC_CHEVRON;
            const node = parent.node;
            toggle.onclick = (e) => {
                e.stopPropagation();
                setTocExpanded(node, !node.classList.contains('expanded'));
            };
            node.querySelector('.ereader-toc-row').appendChild(toggle);
            node.appendChild(parent.children);
        }
        return parent.children;
    };

    for (const s of sections) {
        const depth = Math.max(0, (s.level || 1) - minLevel);
        while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop();
        const parent = stack.length > 0 ? stack[stack.length - 1] : null;

        while (pendingGaps.length > 0) {
            const gap = pendingGaps[0];
            const sFrom = s.partFrom ?? s.pageStart ?? defaultFrom;
            if (sFrom !== undefined && sFrom > gap.to) {
                containerFor(parent).appendChild(createGapItem(gap));
                pendingGaps.shift();
            } else {
                break;
            }
        }

        if (depth > TOC_MAX_DEPTH) {
            /* Deeper than h3: not listed, its nearest listed ancestor stands for it. */
            tocOwner.set(s.id, parent ? parent.id : s.id);
            continue;
        }
        tocOwner.set(s.id, s.id);

        const node = document.createElement('div');
        node.className = 'ereader-toc-node';
        node.dataset.depth = String(depth);
        node.dataset.nodeId = s.id;

        const row = document.createElement('div');
        row.className = 'ereader-toc-row';
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'ereader-toc-item';
        item.dataset.sectionId = s.id;
        item.style.setProperty('--toc-depth', String(depth));
        item.textContent = (s.title || '').trim() || t('ereader_untitled_section');
        item.onclick = () => onTocItemClick(node, s.id);
        row.appendChild(item);
        node.appendChild(row);

        containerFor(parent).appendChild(node);
        const children = document.createElement('div');
        children.className = 'ereader-toc-children';
        stack.push({ depth, id: s.id, node, children });
    }

    while (pendingGaps.length > 0) {
        root.appendChild(createGapItem(pendingGaps.shift()));
    }

    list.replaceChildren(root);

    for (const id of tocExpanded) setTocExpanded(tocNodeOf(id), true);
    expandTocPathTo(activeId);
    markTocActive(activeId);
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

    /* Opening the menu over a book always shows the contents (R2-08: settings
       must be chosen), with the entry being read opened and in view. */
    const menuToggle = document.getElementById('menuToggleBtn');
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            if (!bookViewActive) return;
            openTocSection();
            setTimeout(revealActiveInToc, 0);
        });
    }

    const fontBtn = document.getElementById('ereaderFontCycleBtn');
    if (fontBtn) fontBtn.onclick = () => cycleFontSize();
    updateFontUI();

    const saveBtn = document.getElementById('ereaderSavePosBtn');
    if (saveBtn) saveBtn.onclick = () => saveReadingPosition();

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
    tocOwner = new Map();
    tocExpanded = new Set();
    tocBookId = null;
    isFullscreen = false;
    hideSearchOverlay();
    closeImageUrlModal();
}
