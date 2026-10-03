/**
 * e-Reader reading screen: a single continuous scroll across the whole book,
 * the reading position, the table of contents and the font size.
 *
 * A book is a few hundred pages of Markdown; keeping every chapter's DOM in
 * memory at once would be the slow part of the app, and the reader only ever
 * needs the chapters near the reading position. So every chapter gets a
 * wrapper element up front (the page's scroll height is right from the
 * start), but only a small window of chapters around the current one - the
 * one before, the current one, the one after - actually has its sections
 * inside it. As the page scrolls past a chapter boundary the window slides:
 * the chapter now two away is measured, emptied and replaced by a wrapper of
 * that same height (so nothing jumps), and the newly-adjacent one is filled
 * in. Because the entering chapter is always still below the fold and the
 * leaving one is replaced at its own measured height, the slide is invisible
 * to the reader - it never needs to compensate scrollY.
 *
 * The position is tracked on every scroll event (in memory) and written a few
 * seconds after scrolling stops, on a contents/search jump, when the view is
 * left and when the tab is hidden. It is read from memory at those moments,
 * never from window.scrollY: by the time switchView() tells us the view
 * changed, the page has already been scrolled for the next one.
 */

import { t, targetLanguages } from '../../core/i18n.js';
import { AppState } from '../../core/state.js';
import { renderMarkdown, applySearchHighlight } from '../../core/markdown.js';
import { escapeHTML, showToast, showAlert, showConfirm, showDecision } from '../../core/utils.js';
import {
    getBook, getProgress, setProgress, getPrefs, setPrefs, listBooks, updateBook,
    getBookmarks, bookmarkNumbers, addBookmark, updateBookmark, deleteBookmark,
    getBookTranslation, setBookTranslation,
    getTtsPrefs, setTtsPrefs, getBookTtsLang, setBookTtsLang
} from './ereader-store.js';
import { buildChapters, chapterOfSection, weightedPercent } from './ereader-chapters.js';
import { searchBook } from './ereader-search.js';
import { applyEreaderChrome } from './ereader-shell.js';
import { detectGaps } from './ereader-parts.js';
import {
    loadBookImages, peekBookImages, imageSrc, setBookImage, removeBookImage,
    countBookImages, exportBookImages
} from './ereader-images.js';
import { openShareOptions } from '../../core/share-options.js';

export const FONT_STEPS = Object.freeze([0.8, 0.9, 1, 1.15, 1.35, 1.5]);
/** The settings popup only ever offers three sizes - small, normal (default),
 *  large - cycled by a single icon button. Values are a subset of FONT_STEPS
 *  so a scale stored by either control is always a step the other recognizes. */
export const FONT_SIZE_TIERS = Object.freeze([0.8, 1, 1.35]);
const SAVE_DELAY_MS = 5000;
/** A section counts as "being read" once its top has passed this line. */
const READING_LINE_PX = 96;
const MEMO_LIMIT = 24;
/** Chapters kept mounted on each side of the current one. */
const MOUNT_RADIUS = 1;
/** Rough characters-per-pixel at 100% font size, for a placeholder's height
 *  before its chapter has ever been rendered. Corrected the moment it mounts. */
const CHARS_PER_PX = 2.6;
const MIN_CHAPTER_PX = 96;
/** The "back to top" button appears once the reader has scrolled this far. */
const SCROLL_TOP_SHOW_PX = 480;

/** { book, chapters, chapterIndex, mounted, heights, renderedAt, pendingRestore } */
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
/** Section ids collapsed in the open book's contents list (their children
 *  hidden). Reset whenever a different book is opened. */
let tocCollapsed = new Set();
/** Section ids whose heading is folded in the reading body itself (their own
 *  text and every deeper section hidden). Separate from the contents list's
 *  own collapse state; reset whenever a different book is opened. */
let bodyFolded = new Set();
/** Which of the open book's bookmarks the single-item carousel shows. */
let bookmarkIndex = 0;
/** Where a text selection sits and what it says, while the floating
 *  "bookmark this" action for it is showing. */
let selectionSectionId = null;
let selectionExcerpt = '';
/** Where in that section the selection starts ({ offset, quote }). */
let selectionAnchor = null;
/** The section a bookmark-in-progress will attach to once the modal is saved. */
let pendingBookmarkSectionId = null;
/** And the spot inside it, when it is known. */
let pendingBookmarkAnchor = null;
/** Set while the add/edit modal is editing an existing bookmark instead of
 *  creating a new one; null means "adding". */
let editingBookmarkId = null;
/** Which bookmark the note-detail modal is currently showing. */
let detailBookmarkId = null;

export function getOpenBook() {
    return open ? open.book : null;
}

function sectionSource(section) {
    const title = (section.title || '').trim();
    if (!title) return section.text || '';
    return `${'#'.repeat(Math.min(6, section.level || 1))} ${title}\n\n${section.text || ''}`;
}

function chapterHtml(book, chapter, searchTerm = '') {
    const key = `${book.id}:${chapter.index}:${book.updatedAt}:${searchTerm}`;
    if (memo.has(key)) return memo.get(key);
    const byId = new Map(book.sections.map(s => [s.id, s]));
    const html = chapter.sectionIds
        .map(id => byId.get(id))
        .filter(Boolean)
        .map(s => {
            let body = renderMarkdown(sectionSource(s), { images: true, keepHeadingLevels: true });
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
    if (!open || open.book.id !== book.id) {
        tocCollapsed = new Set();
        bodyFolded = new Set();
        bookmarkIndex = 0;
    }
    const chapters = buildChapters(book.sections);
    open = {
        book,
        chapters,
        chapterIndex: Math.max(0, Math.min(chapterIndex, chapters.length - 1)),
        mounted: new Set(),
        heights: new Map(),
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
    stopEreaderTts();
    const book = await getBook(id);
    if (!book) {
        showToast(t('ereader_book_missing'));
        return false;
    }
    /* Read before the first chapter mounts, so the reader's own pictures are
       drawn right away instead of popping in over their placeholders. */
    await loadBookImages(id);
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

function chapterWrapperEl(index) {
    const content = contentEl();
    return content ? content.querySelector(`.ereader-chapter[data-chapter-index="${index}"]`) : null;
}

function estimateChapterHeight(chapter) {
    return Math.max(MIN_CHAPTER_PX, Math.round((chapter.textLength || 0) / CHARS_PER_PX));
}

/** Height a chapter's wrapper should reserve while it has no content mounted. */
function placeholderHeight(index) {
    const fontScale = getPrefs().fontScale || 1;
    const base = open.heights.has(index) ? open.heights.get(index) : estimateChapterHeight(open.chapters[index]);
    return Math.round(base * fontScale);
}

/** Builds one empty wrapper per chapter. Resets which chapters are mounted. */
function renderBookShell() {
    const content = contentEl();
    if (!content || !open) return;
    const frag = document.createDocumentFragment();
    open.chapters.forEach((chapter, i) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'ereader-chapter';
        wrapper.dataset.chapterIndex = String(i);
        wrapper.style.minHeight = `${placeholderHeight(i)}px`;
        frag.appendChild(wrapper);
    });
    content.replaceChildren(frag);
    content.style.setProperty('--ereader-font-scale', String(getPrefs().fontScale || 1));
    open.mounted = new Set();
}

function mountChapterContent(index) {
    if (!open || open.mounted.has(index)) return;
    const wrapper = chapterWrapperEl(index);
    const chapter = open.chapters[index];
    if (!wrapper || !chapter) return;
    wrapper.innerHTML = chapterHtml(open.book, chapter, activeSearchTerm);
    wrapper.style.minHeight = '';
    open.mounted.add(index);
    decorateWrapperSections(wrapper);
    decorateImagePlaceholders(wrapper);
    decorateBookmarkMarkers(wrapper);
    decorateFoldHeadings(wrapper);
}

/** Per-section outline facts for the open book (level, level relative to
 *  the book's top level, whether a deeper section follows), cached until the
 *  book itself changes. */
function outlineInfo() {
    if (!open) return new Map();
    if (open.outline && open.outline.at === open.book.updatedAt) return open.outline.map;
    const sections = open.book.sections;
    const minLevel = Math.min(...sections.map(s => s.level || 1));
    const map = new Map();
    sections.forEach((s, i) => {
        const next = sections[i + 1];
        map.set(s.id, {
            level: s.level || 1,
            relLevel: (s.level || 1) - minLevel,
            hasChildren: !!next && (next.level || 1) > (s.level || 1),
            hasText: typeof s.text === 'string' && s.text.trim().length > 0,
            hasTitle: !!(s.title || '').trim()
        });
    });
    open.outline = { at: open.book.updatedAt, map };
    return map;
}

const FOLD_CHEVRON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

/** Turns the title heading of every h1-h3 section that has something under
 *  it into a fold toggle, then applies the current fold state. */
function decorateFoldHeadings(wrapper) {
    if (!open || !wrapper) return;
    const info = outlineInfo();
    wrapper.querySelectorAll('.ereader-section').forEach(secEl => {
        const meta = info.get(secEl.dataset.sectionId);
        if (!meta || !meta.hasTitle || meta.relLevel > TOC_TOGGLE_MAX_REL_LEVEL) return;
        if (!meta.hasChildren && !meta.hasText) return;
        /* renderMarkdown wraps its output in its own .md-content div; the
           section's title is that div's first child. */
        const first = secEl.querySelector(':scope > .md-content')?.firstElementChild;
        const heading = first && /^H[1-6]$/.test(first.tagName) ? first : null;
        if (!heading) return;
        heading.classList.add('ereader-fold-heading');
        heading.title = t('ereader_heading_fold');
        if (!heading.querySelector(':scope > .ereader-fold-chevron')) {
            const chevron = document.createElement('span');
            chevron.className = 'ereader-fold-chevron';
            chevron.setAttribute('aria-hidden', 'true');
            chevron.innerHTML = FOLD_CHEVRON_SVG;
            heading.insertBefore(chevron, heading.firstChild);
        }
    });
    applyBodyFolds(wrapper);
}

/** Hides the text of folded sections and every section nested under one. A
 *  chapter always starts at the book's top level, so each wrapper holds whole
 *  subtrees and its own sections are all the ancestors that matter. */
function applyBodyFolds(wrapper) {
    if (!open || !wrapper) return;
    const info = outlineInfo();
    const ancestors = []; // { level, folded }
    wrapper.querySelectorAll('.ereader-section').forEach(secEl => {
        const id = secEl.dataset.sectionId;
        const lvl = info.get(id)?.level || 1;
        while (ancestors.length && ancestors[ancestors.length - 1].level >= lvl) ancestors.pop();
        const hidden = ancestors.some(a => a.folded);
        const heading = secEl.querySelector('.ereader-fold-heading');
        const folded = !!heading && bodyFolded.has(id);
        secEl.classList.toggle('is-folded-away', hidden);
        secEl.classList.toggle('is-folded', folded);
        if (heading) heading.setAttribute('aria-expanded', String(!folded));
        ancestors.push({ level: lvl, folded });
    });
}

function toggleBodyFold(sectionId) {
    if (!open || !sectionId) return;
    if (bodyFolded.has(sectionId)) bodyFolded.delete(sectionId);
    else bodyFolded.add(sectionId);
    const chapter = chapterOfSection(open.chapters, sectionId);
    const wrapper = chapter ? chapterWrapperEl(chapter.index) : null;
    if (wrapper) applyBodyFolds(wrapper);
    if (bookViewActive) capturePosition(currentSectionId());
}

/** Unfolds a section and every heading above it, so a contents, search or
 *  bookmark jump never lands on something folded out of sight. */
function revealInBody(sectionId) {
    if (!open || bodyFolded.size === 0) return;
    const sections = open.book.sections;
    const idx = sections.findIndex(s => s.id === sectionId);
    if (idx < 0) return;
    bodyFolded.delete(sectionId);
    let level = sections[idx].level || 1;
    for (let i = idx - 1; i >= 0 && level > 1; i--) {
        const lvl = sections[i].level || 1;
        if (lvl < level) {
            bodyFolded.delete(sections[i].id);
            level = lvl;
        }
    }
    const chapter = chapterOfSection(open.chapters, sectionId);
    if (chapter && open.mounted.has(chapter.index)) applyBodyFolds(chapterWrapperEl(chapter.index));
}

/** Measures the chapter's current height (normalized to 100% font) before
 *  clearing it, so its placeholder holds the same space it just occupied. */
function unmountChapterContent(index) {
    if (!open || !open.mounted.has(index)) return;
    const wrapper = chapterWrapperEl(index);
    open.mounted.delete(index);
    if (!wrapper) return;
    const measured = wrapper.offsetHeight || wrapper.getBoundingClientRect().height || 0;
    const fontScale = getPrefs().fontScale || 1;
    if (measured > 0) open.heights.set(index, measured / fontScale);
    wrapper.innerHTML = '';
    wrapper.style.minHeight = `${placeholderHeight(index)}px`;
}

/** Mounts [center - radius, center + radius] and unmounts everything else. */
function syncMountWindow(centerIndex) {
    if (!open) return;
    const n = open.chapters.length;
    const lo = Math.max(0, centerIndex - MOUNT_RADIUS);
    const hi = Math.min(n - 1, centerIndex + MOUNT_RADIUS);
    for (const i of [...open.mounted]) {
        if (i < lo || i > hi) unmountChapterContent(i);
    }
    for (let i = lo; i <= hi; i++) mountChapterContent(i);
}

/** Forces a currently-mounted chapter to redraw (book content or search term changed). */
function remountChapter(index) {
    if (!open || !open.mounted.has(index)) return;
    open.mounted.delete(index);
    mountChapterContent(index);
}

function remountAllMounted() {
    if (!open) return;
    for (const i of [...open.mounted]) remountChapter(i);
}

function refreshUnmountedHeights() {
    if (!open) return;
    for (let i = 0; i < open.chapters.length; i++) {
        if (open.mounted.has(i)) continue;
        const el = chapterWrapperEl(i);
        if (el) el.style.minHeight = `${placeholderHeight(i)}px`;
    }
}

/** The chapter's scroll span on the page, for converting to and from offset. */
function chapterSpan(index) {
    const el = chapterWrapperEl(index);
    if (!el) return { top: 0, span: 0 };
    const rect = el.getBoundingClientRect();
    const top = rect.top + window.scrollY - READING_LINE_PX;
    const span = Math.max(0, el.offsetHeight - window.innerHeight + READING_LINE_PX);
    return { top, span };
}

/** Sub-pixel layout can leave a fully-scrolled element's bottom a fraction
 *  of a pixel past the viewport's own - close enough that it must still
 *  count as "nothing left to scroll to". */
const VIEWPORT_BOTTOM_EPSILON_PX = 2;

/** Whether an element's bottom edge has reached (or passed) the viewport's
 *  bottom - i.e. there is nothing left below it to scroll into view. */
function isFullyInView(el) {
    return !!el && el.getBoundingClientRect().bottom <= window.innerHeight + VIEWPORT_BOTTOM_EPSILON_PX;
}

function currentSectionId() {
    const els = sectionEls();
    let current = els[0];
    for (const el of els) {
        /* A folded-away section has no box; its zero rect would read as
           "above the reading line" wherever it really sits. */
        if (el.classList.contains('is-folded-away')) continue;
        if (el.getBoundingClientRect().top <= READING_LINE_PX) current = el;
        else break;
    }
    /* The book's very last section may be too short to ever cross the
       reading line; once it is fully in view there is nothing left below it
       to scroll to, so it counts as reached regardless of where its top sits. */
    const lastEl = els[els.length - 1];
    const bookLastId = open?.book?.sections?.[open.book.sections.length - 1]?.id;
    if (lastEl && lastEl.dataset.sectionId === bookLastId && isFullyInView(lastEl)) current = lastEl;
    return current ? current.dataset.sectionId : null;
}

/** Which chapter's wrapper is at the reading line right now. Works even for a
 *  chapter that isn't mounted (still an empty placeholder of the right height). */
function visibleChapterIndex() {
    if (!open) return 0;
    const content = contentEl();
    if (!content) return open.chapterIndex;
    const wrappers = [...content.querySelectorAll('.ereader-chapter')];
    let current = wrappers[0];
    for (const el of wrappers) {
        if (el.getBoundingClientRect().top <= READING_LINE_PX) current = el;
        else break;
    }
    /* Same last-chapter exception as currentSectionId(): a short final
       chapter may never cross the reading line even at the true bottom. */
    const lastWrapper = wrappers[wrappers.length - 1];
    if (lastWrapper && isFullyInView(lastWrapper)) current = lastWrapper;
    return current ? Number(current.dataset.chapterIndex) : 0;
}

/**
 * knownSectionId: where a jump just landed (chapter start, a contents entry).
 * Only a scroll by the user is read back from the page geometry.
 */
function capturePosition(knownSectionId = null) {
    if (!open) return;
    /* Once the last chapter is fully in view there is nothing left to scroll
       to below it, so the position is the end of the book - even if its
       height is short of what chapterSpan() would need to reach an offset of
       1 by geometry alone (e.g. a trailing margin past its wrapper). */
    const atBookEnd = open.chapterIndex === open.chapters.length - 1
        && isFullyInView(chapterWrapperEl(open.chapterIndex));
    const { top, span } = chapterSpan(open.chapterIndex);
    const offset = atBookEnd ? 1 : (span > 0 ? Math.max(0, Math.min(1, (window.scrollY - top) / span)) : 0);
    const sectionId = knownSectionId || currentSectionId() || open.chapters[open.chapterIndex]?.sectionIds[0] || null;
    const prevSection = lastPos && lastPos.sectionId;
    lastPos = {
        bookId: open.book.id,
        sectionId,
        offset: Math.round(offset * 1000) / 1000,
        percent: atBookEnd ? 100 : weightedPercent(open.chapters, open.chapterIndex, offset)
    };
    if (sectionId !== prevSection) markTocActive(sectionId);
    updateTocProgress();
}

/** The thin bar under the contents drawer - the same weighted percent as
 *  capturePosition(), painted as a fill width instead of written to storage. */
function updateTocProgress() {
    const fill = document.getElementById('ereaderTocProgressFill');
    if (!fill || !open) return;
    const percent = (lastPos && lastPos.bookId === open.book.id) ? lastPos.percent : (getProgress(open.book.id)?.percent || 0);
    fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
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

function scrollToOffset(index, offset) {
    const { top, span } = chapterSpan(index);
    window.scrollTo({ top: Math.max(0, top + offset * span), behavior: 'instant' });
}

function scrollToSection(sectionId, delta = READING_LINE_PX - 8) {
    revealInBody(sectionId);
    const el = sectionEls().find(s => s.dataset.sectionId === sectionId);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - delta;
    window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
}

let decorateReadingSectionsRef = null;
/* The shared test-ui module: its TTS engine is the one the e-reader speaks with. */
let testUiRef = null;

async function ensureDecorateReadingSections() {
    if (!decorateReadingSectionsRef && typeof window !== 'undefined') {
        try {
            const mod = await import('../test/test-ui.js');
            testUiRef = mod;
            decorateReadingSectionsRef = mod.decorateReadingSections;
        } catch (_) {}
    }
    return decorateReadingSectionsRef;
}

function decorateWrapperSections(wrapper) {
    if (!open || !wrapper) return;
    if (!decorateReadingSectionsRef) {
        ensureDecorateReadingSections().then(fn => {
            if (fn && open) decorateWrapperSections(wrapper);
        });
        return;
    }
    wrapper.querySelectorAll('.ereader-section').forEach(secEl => {
        const secId = secEl.dataset.sectionId;
        if (secId) {
            decorateReadingSectionsRef(secEl, {
                scope: 'ereader:' + secId,
                cacheKey: open.book.id,
                minSections: 1,
                showTranslate: translateIconsShown(),
                translation: bookTranslationPair(),
                showTts: getTtsPrefs().enabled,
                tts: {
                    lang: bookTtsLang(),
                    speed: getTtsPrefs().speed,
                    onEnded: (index) => ttsAutoplayNext(secId, index)
                },
                markPlaying: true,
                /* Every mounted chapter, not just this one: the section that
                   was speaking before may sit in another chapter. */
                onRefresh: () => redecorateMountedSections()
            });
        }
    });
}

/** Re-decorates every mounted chapter - after a translation setting changes. */
function redecorateMountedSections() {
    if (!open) return;
    for (const i of open.mounted) decorateWrapperSections(chapterWrapperEl(i));
    scheduleMarkerRelayout();
}

/* ── Translation ─────────────────────────────────────────────────────────────
   The translate icons in the book are off until the reader switches them on
   (one device-wide switch). The language pair is per book and device-only
   (ereader-store getBookTranslation): never written into the book, so a shared
   copy never carries the sender's choice. */

const TRANSLATE_AUTO = 'auto';

const isKnownLanguage = (code) => targetLanguages.some(l => l.code === code);

function translateIconsShown() {
    return getPrefs().showTranslateIcons === true;
}

/** The open book's pair: the reader's pick for it, else their last pick for
 *  any book, else the book's own language -> the app's translation target. */
function bookTranslationPair(book = open && open.book) {
    const saved = book ? getBookTranslation(book.id) : null;
    if (saved && saved.target) return saved;
    const own = String((book && book.language) || '').toLowerCase().split(/[-_]/)[0];
    const source = isKnownLanguage(own) ? own : TRANSLATE_AUTO;
    let target = AppState.translationTarget || 'tr';
    // A German book with the app set to German would default to de -> de.
    if (target === source) target = source === 'en' ? 'tr' : 'en';
    return { source, target };
}

function languageLabel(code) {
    if (code === TRANSLATE_AUTO) return t('ereader_translate_auto');
    const lang = targetLanguages.find(l => l.code === code);
    return lang ? lang.name : code;
}

/** The settings row: its switch, and this book's pair under the name. */
function updateTranslateUI() {
    const row = document.getElementById('ereaderTranslateRow');
    const book = getOpenBook();
    if (row) row.style.display = book ? '' : 'none';
    if (!book) return;
    const toggle = document.getElementById('ereaderTranslateShowToggle');
    if (toggle) toggle.checked = translateIconsShown();
    const pair = bookTranslationPair(book);
    const summary = document.getElementById('ereaderTranslateSummary');
    if (summary) summary.textContent = `${languageLabel(pair.source)} \u2192 ${languageLabel(pair.target)}`;
}

function fillLanguageSelect(select, { withAuto }) {
    const options = withAuto ? [{ code: TRANSLATE_AUTO, name: t('ereader_translate_auto') }, ...targetLanguages] : targetLanguages;
    select.replaceChildren(...options.map(l => {
        const opt = document.createElement('option');
        opt.value = l.code;
        opt.textContent = l.name;
        return opt;
    }));
}

export function openTranslateSettings() {
    const overlay = document.getElementById('ereaderTranslateOverlay');
    const book = getOpenBook();
    if (!overlay || !book) return;
    const pair = bookTranslationPair(book);
    const sourceSel = document.getElementById('ereaderTranslateSourceSelect');
    if (sourceSel) { fillLanguageSelect(sourceSel, { withAuto: true }); sourceSel.value = pair.source; }
    const targetSel = document.getElementById('ereaderTranslateTargetSelect');
    if (targetSel) { fillLanguageSelect(targetSel, { withAuto: false }); targetSel.value = pair.target; }
    overlay.classList.add('active');
}

export function closeTranslateSettings() {
    const overlay = document.getElementById('ereaderTranslateOverlay');
    if (overlay) overlay.classList.remove('active');
}

export function isTranslateSettingsOpen() {
    const overlay = document.getElementById('ereaderTranslateOverlay');
    return !!(overlay && overlay.classList.contains('active'));
}

/** The switch: shows or hides every translate icon (and open translation). */
export async function setTranslateIconsShown(shown) {
    await setPrefs({ showTranslateIcons: !!shown });
    redecorateMountedSections();
    updateTranslateUI();
}

/** Saves the open book's pair (it also becomes the default for other books). */
export async function setOpenBookTranslation(pair) {
    const book = getOpenBook();
    if (!book) return;
    const current = bookTranslationPair(book);
    await setBookTranslation(book.id, { ...current, ...pair });
    redecorateMountedSections();
    updateTranslateUI();
}

/* ── Read aloud (TTS) ────────────────────────────────────────────────────────
   Same row pattern as translation: the switch shows or hides the speak icons
   in the book, the name opens the options (speed, language, autoplay). Speech
   runs on the test centre's TTS engine. The language is per book and
   device-only; speed and autoplay are device-wide. Autoplay reads on section
   by section, highlighting the one being read and keeping it in view. */

/** The open book's read-aloud language: the reader's pick for it, else their
 *  last pick, else the book's own language, else the app's. */
function bookTtsLang(book = open && open.book) {
    const saved = book ? getBookTtsLang(book.id) : null;
    if (saved && isKnownLanguage(saved)) return saved;
    const own = String((book && book.language) || '').toLowerCase().split(/[-_]/)[0];
    if (isKnownLanguage(own)) return own;
    return isKnownLanguage(AppState.language) ? AppState.language : 'en';
}

const ttsSpeedLabel = (speed) => `x${(speed * 2).toFixed(1)}`;

function updateTtsUI() {
    const row = document.getElementById('ereaderTtsRow');
    const book = getOpenBook();
    if (row) row.style.display = book ? '' : 'none';
    if (!book) return;
    const prefs = getTtsPrefs();
    const toggle = document.getElementById('ereaderTtsShowToggle');
    if (toggle) toggle.checked = prefs.enabled;
    const summary = document.getElementById('ereaderTtsSummary');
    if (summary) {
        const parts = [languageLabel(bookTtsLang(book)), ttsSpeedLabel(prefs.speed)];
        if (prefs.autoplay) parts.push(t('tts_autoplay'));
        summary.textContent = parts.join(' · ');
    }
}

/** The speed slider's floating value, placed over the thumb; red at x1.0
 *  like the test centre's own slider. */
function updateTtsSpeedTooltip(speed) {
    const slider = document.getElementById('ereaderTtsSpeed');
    const tooltip = document.getElementById('ereaderTtsSpeedTooltip');
    if (!slider || !tooltip) return;
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    tooltip.textContent = ttsSpeedLabel(speed);
    tooltip.style.left = `${((speed - min) / (max - min)) * 100}%`;
    const isDefault = Math.abs(speed - 0.5) < 0.01;
    slider.classList.toggle('is-default', isDefault);
    tooltip.style.color = isDefault ? 'var(--error-color)' : 'var(--primary-color)';
    tooltip.style.borderColor = isDefault ? 'var(--error-color)' : 'var(--border-color)';
}

export function openTtsSettings() {
    const overlay = document.getElementById('ereaderTtsOverlay');
    const book = getOpenBook();
    if (!overlay || !book) return;
    const prefs = getTtsPrefs();
    const langSel = document.getElementById('ereaderTtsLangSelect');
    if (langSel) { fillLanguageSelect(langSel, { withAuto: false }); langSel.value = bookTtsLang(book); }
    const slider = document.getElementById('ereaderTtsSpeed');
    if (slider) slider.value = String(prefs.speed);
    const autoplay = document.getElementById('ereaderTtsAutoplayToggle');
    if (autoplay) autoplay.checked = prefs.autoplay;
    overlay.classList.add('active');
    updateTtsSpeedTooltip(prefs.speed);
}

export function closeTtsSettings() {
    const overlay = document.getElementById('ereaderTtsOverlay');
    if (overlay) overlay.classList.remove('active');
}

export function isTtsSettingsOpen() {
    const overlay = document.getElementById('ereaderTtsOverlay');
    return !!(overlay && overlay.classList.contains('active'));
}

/** Silences whatever the book is reading (closing the book, switch off). */
export function stopEreaderTts() {
    if (testUiRef) testUiRef.stopAudio(true);
}

/** The switch: shows or hides every speak icon in the book. */
export async function setTtsShown(shown) {
    if (!shown) stopEreaderTts();
    await setTtsPrefs({ enabled: !!shown });
    redecorateMountedSections();
    updateTtsUI();
}

/** Saves speed / autoplay (device-wide) or the open book's language. Takes
 *  effect from the next section read. */
export async function setOpenBookTts({ lang, speed, autoplay } = {}) {
    const book = getOpenBook();
    if (lang && book) await setBookTtsLang(book.id, lang);
    const patch = {};
    if (typeof speed === 'number') patch.speed = speed;
    if (typeof autoplay === 'boolean') patch.autoplay = autoplay;
    if (Object.keys(patch).length) await setTtsPrefs(patch);
    redecorateMountedSections();
    updateTtsUI();
}

const MAX_AUTOPLAY_SKIP = 50;

/**
 * A heading section was read to its end: with autoplay on, read the next one -
 * the next heading in the same book section, else the first heading of the
 * following book sections (mounting their chapter if needed). The new section
 * is scrolled to just under the reading line so it stays in view.
 */
function ttsAutoplayNext(secId, index) {
    if (!open || !bookViewActive) return;
    const prefs = getTtsPrefs();
    if (!prefs.enabled || !prefs.autoplay) return;
    /* The reader started something else in the meantime. */
    if (document.querySelector('#ereaderContent .heading-tts-btn.playing, #ereaderContent .callout-tts-btn.playing')) return;

    const findSecEl = (id) => sectionEls().find(s => s.dataset.sectionId === id);
    const speakAt = (secEl, i) => {
        const btn = secEl.querySelectorAll('.heading-tts-btn')[i];
        if (!btn) return false;
        const heading = btn.closest('h1, h2, h3, h4, h5, h6');
        btn.click();
        if (heading && heading.isConnected) {
            const y = heading.getBoundingClientRect().top + window.scrollY - READING_LINE_PX;
            window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
        }
        return true;
    };

    const current = findSecEl(secId);
    if (current && speakAt(current, index + 1)) return;

    const ids = open.book.sections.map(s => s.id);
    let k = ids.indexOf(secId) + 1;
    for (let tries = 0; k > 0 && k < ids.length && tries < MAX_AUTOPLAY_SKIP; k++, tries++) {
        const chapter = chapterOfSection(open.chapters, ids[k]);
        if (chapter && !open.mounted.has(chapter.index)) {
            open.chapterIndex = chapter.index;
            syncMountWindow(chapter.index);
        }
        const el = findSecEl(ids[k]);
        if (!el || el.classList.contains('is-folded-away')) continue;
        if (speakAt(el, 0)) return;
    }
}

const BOOKMARK_ICON_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>';

/* ── Image placeholders ──────────────────────────────────────────────────────
   The book text marks each figure of the source as `![alt](placeholder:id)`,
   the alt being the AI's description of it (caption | what it shows | page).
   renderMarkdown draws a plain card for it; here the card gets its parts
   (title, description, id, a "tap to add" hint) - or, when the reader has
   already chosen a picture for it (ereader-images.js), turns into that
   picture with a small edit button. */

const IMAGE_EDIT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>';

/** "Caption | what it shows | p. 34" → { title, details[] }. */
function splitImageAlt(alt) {
    const parts = String(alt || '').split(/\s+\|\s+/).map(p => p.trim()).filter(Boolean);
    return { title: parts[0] || '', details: parts.slice(1) };
}

/**
 * One image line of a section's text, as the e-Reader knows them:
 *   ![alt](placeholder:fig-2-1)                 - still waiting for a picture
 *   ![[file.png]]                               - an Obsidian embed, same
 *   ![alt](https://… "placeholder:fig-2-1")     - linked by the reader
 * → { alt, id, url } or null.
 */
function parseImageLine(trimmed) {
    let m = trimmed.match(/^!\[([^\]]*)\]\((placeholder:[^\s)]+)\)$/);
    if (m) return { alt: m[1], id: m[2], url: '' };
    m = trimmed.match(/^!\[([^\]]*)\]\((https:\/\/[^\s)]+)\s+"([^"]+)"\)$/);
    if (m) return { alt: m[1], id: m[3], url: m[2] };
    m = trimmed.match(/^!\[\[([^\]]+)\]\]$/);
    if (m) return { alt: m[1].trim(), id: m[1].trim(), url: '' };
    return null;
}

/** The line describing a placeholder id in the book, or null. */
function findImageLine(book, placeholderId) {
    if (!book || !placeholderId) return null;
    for (const s of book.sections || []) {
        const text = s.text || '';
        if (!text.includes(placeholderId)) continue;
        for (const line of text.split('\n')) {
            const info = parseImageLine(line.trim());
            if (info && info.id === placeholderId) return info;
        }
    }
    return null;
}

/** The alt text the book gives a placeholder id, '' when it is not found. */
function placeholderAlt(book, placeholderId) {
    return findImageLine(book, placeholderId)?.alt || '';
}

/** Rewrites every line of the placeholder in the book's sections in place:
 *  a URL turns it into a linked image, '' back into a bare placeholder. A
 *  linked URL is plain text in the book, so it syncs and is shared with it. */
function rewriteImageLines(book, placeholderId, url) {
    const safeId = !placeholderId.includes('"');
    for (const s of book.sections || []) {
        if (typeof s.text !== 'string' || !s.text.includes(placeholderId)) continue;
        s.text = s.text.split('\n').map(line => {
            const trimmed = line.trim();
            const info = parseImageLine(trimmed);
            if (!info || info.id !== placeholderId) return line;
            let next;
            if (url && safeId) next = `![${info.alt}](${url} "${placeholderId}")`;
            else if (placeholderId.startsWith('placeholder:')) next = `![${info.alt}](${placeholderId})`;
            else next = `![[${placeholderId}]]`;
            /* A function, so `$` in a URL is never read as a replacement pattern. */
            return line.replace(trimmed, () => next);
        }).join('\n');
    }
}

/** Saves a URL ('' = none) for the placeholder into the book text and takes
 *  the open book over to the saved version. */
async function writeImageUrl(placeholderId, url) {
    if (!open) return;
    const bookId = open.book.id;
    const line = findImageLine(open.book, placeholderId);
    if (!line || (line.url || '') === (url || '')) return;
    await updateBook(bookId, (book) => rewriteImageLines(book, placeholderId, url));
    const updated = await getBook(bookId);
    if (updated && open && open.book.id === bookId) {
        open.book = updated;
        /* Already drawn from here - the library refresh need not redraw it. */
        open.renderedAt = updated.updatedAt;
        memo.clear();
    }
}

function shortPlaceholderId(id) {
    return String(id || '').replace(/^placeholder:/, '');
}

function figureForImage(card, entry, interactive) {
    const id = card.dataset.placeholderId;
    const alt = card.dataset.alt ?? (card.querySelector('.md-placeholder-text')?.textContent || '');
    const { title } = splitImageAlt(alt);
    const figure = document.createElement('figure');
    figure.className = 'md-figure ereader-user-figure';
    figure.dataset.placeholderId = id;
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = imageSrc(entry);
    img.alt = title || shortPlaceholderId(id);
    figure.appendChild(img);
    if (title) {
        const cap = document.createElement('figcaption');
        cap.textContent = title;
        figure.appendChild(cap);
    }
    if (interactive) {
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'ereader-figure-edit-btn';
        edit.dataset.placeholderId = id;
        edit.title = t('ereader_image_change');
        edit.setAttribute('aria-label', edit.title);
        edit.innerHTML = IMAGE_EDIT_SVG;
        figure.appendChild(edit);
    }
    return figure;
}

function enrichPlaceholderCard(card) {
    if (card.dataset.enriched === '1') return;
    card.dataset.enriched = '1';
    const textEl = card.querySelector('.md-placeholder-text');
    const alt = textEl ? textEl.textContent : '';
    card.dataset.alt = alt;
    const { title, details } = splitImageAlt(alt);
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.title = t('ereader_image_add');

    const body = document.createElement('span');
    body.className = 'md-placeholder-body';
    const titleEl = document.createElement('span');
    titleEl.className = 'md-placeholder-text';
    titleEl.textContent = title || shortPlaceholderId(card.dataset.placeholderId);
    body.appendChild(titleEl);
    for (const d of details) {
        const det = document.createElement('span');
        det.className = 'md-placeholder-desc';
        det.textContent = d;
        body.appendChild(det);
    }
    const meta = document.createElement('span');
    meta.className = 'md-placeholder-meta';
    const chip = document.createElement('span');
    chip.className = 'md-placeholder-id';
    chip.textContent = shortPlaceholderId(card.dataset.placeholderId);
    const hint = document.createElement('span');
    hint.className = 'md-placeholder-hint';
    hint.textContent = t('ereader_image_add_hint');
    meta.append(chip, hint);
    body.appendChild(meta);
    if (textEl) textEl.replaceWith(body);
    else card.appendChild(body);
}

/** A picture the reader linked (its URL in the book text): the caption
 *  shortened to the figure's own title, plus the same edit button. */
function decorateLinkedFigure(figure, interactive) {
    if (figure.dataset.enriched === '1') return;
    figure.dataset.enriched = '1';
    figure.classList.add('ereader-user-figure');
    const cap = figure.querySelector(':scope > figcaption');
    if (cap) {
        const { title } = splitImageAlt(cap.textContent);
        if (title) cap.textContent = title;
    }
    if (!interactive) return;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'ereader-figure-edit-btn';
    edit.dataset.placeholderId = figure.dataset.placeholderId;
    edit.title = t('ereader_image_change');
    edit.setAttribute('aria-label', edit.title);
    edit.innerHTML = IMAGE_EDIT_SVG;
    figure.appendChild(edit);
}

/** Cards → pictures (or richer cards) for one rendered container. */
function fillImagePlaceholders(root, images, { interactive = true } = {}) {
    if (!root) return;
    root.querySelectorAll('.md-figure[data-placeholder-id]:not(.ereader-user-figure)').forEach(fig => decorateLinkedFigure(fig, interactive));
    root.querySelectorAll('.md-image-placeholder[data-placeholder-id]:not(.md-fallback)').forEach(card => {
        const entry = images ? images[card.dataset.placeholderId] : null;
        if (entry) card.replaceWith(figureForImage(card, entry, interactive));
        else enrichPlaceholderCard(card);
    });
}

function decorateImagePlaceholders(wrapper) {
    if (!open || !wrapper) return;
    const bookId = open.book.id;
    const images = peekBookImages(bookId);
    if (images) {
        fillImagePlaceholders(wrapper, images);
        return;
    }
    fillImagePlaceholders(wrapper, {});
    loadBookImages(bookId).then(() => {
        if (open && open.book.id === bookId && wrapper.isConnected) remountAllMounted();
    });
}

/* ── Bookmark anchors ────────────────────────────────────────────────────────
   A bookmark made from a text selection remembers where in its section the
   selection started: the character offset into the section's own reading
   text plus the first few characters found there (the quote). The ribbon is
   drawn right at that spot, inline, so it sits next to the words the reader
   picked rather than on the section's heading. The quote keeps the spot
   honest when the offset drifts (a synced edit of the text, a re-import): the
   nearest occurrence of the quote wins, and a bookmark whose quote is gone
   falls back to the section start. */

/** What is not the book's own text: our controls, translations, figures. */
const ANCHOR_SKIP = '.ereader-bookmark-marker, .heading-tools, .md-section-translation, .md-callout-translation, '
    + '.translation-text, .callout-tool-btn, .ereader-fold-chevron, .md-figure, .md-image-placeholder, .md-code-copy-btn';
const ANCHOR_QUOTE_LEN = 40;
/** Longest passage a bookmark highlights. */
const ANCHOR_MAX_LEN = 2000;
/* NodeFilter constants, spelled out: not every DOM (jsdom) exposes NodeFilter globally. */
const SHOW_TEXT = 4;
const FILTER_ACCEPT = 1;
const FILTER_REJECT = 2;

function anchorTextNodes(sectionEl) {
    const nodes = [];
    const walker = sectionEl.ownerDocument.createTreeWalker(sectionEl, SHOW_TEXT, {
        acceptNode: (n) => (n.parentElement && n.parentElement.closest(ANCHOR_SKIP) ? FILTER_REJECT : FILTER_ACCEPT)
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
}

/** Character offset of a DOM point within the section's reading text. */
function textOffsetAt(sectionEl, container, offset) {
    const point = sectionEl.ownerDocument.createRange();
    point.setStart(container, offset);
    point.collapse(true);
    let total = 0;
    for (const n of anchorTextNodes(sectionEl)) {
        if (n === container) return total + Math.min(offset, n.length);
        /* A text node cannot straddle an element boundary, so any node other
           than the container lies wholly before or wholly after the point. */
        if (point.comparePoint(n, n.length) <= 0) total += n.length;
        else break;
    }
    return total;
}

/** { offset, quote, length } for a selection (or a point, length 0) in the
 *  section, its start moved past leading whitespace. */
function anchorAt(sectionEl, container, offset, endContainer = null, endOffset = 0) {
    const full = anchorTextNodes(sectionEl).map(n => n.data).join('');
    let off = textOffsetAt(sectionEl, container, offset);
    while (off < full.length && /\s/.test(full[off])) off++;
    const quote = full.slice(off, off + ANCHOR_QUOTE_LEN).split('\n')[0];
    if (!quote) return null;
    let length = 0;
    if (endContainer) {
        let end = sectionEl.contains(endContainer) ? textOffsetAt(sectionEl, endContainer, endOffset) : full.length;
        while (end > off && /\s/.test(full[end - 1])) end--;
        length = Math.max(0, Math.min(ANCHOR_MAX_LEN, end - off));
    }
    return length > 0 ? { offset: off, quote, length } : { offset: off, quote };
}

/** node + offset for a character offset into the section's reading text. */
function locateOffset(nodes, off) {
    let total = 0;
    for (const n of nodes) {
        if (off < total + n.length) return { node: n, offset: off - total };
        total += n.length;
    }
    const last = nodes[nodes.length - 1];
    return last ? { node: last, offset: last.length } : null;
}

/** Where a stored anchor lands in the section now: { start, end } (end is
 *  null for an anchor without a length), or null when it is gone. */
function resolveAnchor(sectionEl, anchor) {
    if (!anchor || typeof anchor !== 'object') return null;
    const nodes = anchorTextNodes(sectionEl);
    const full = nodes.map(n => n.data).join('');
    let off = Number.isInteger(anchor.offset) ? anchor.offset : -1;
    const quote = typeof anchor.quote === 'string' ? anchor.quote : '';
    if (quote && !(off >= 0 && full.startsWith(quote, off))) {
        let best = -1;
        let bestDist = Infinity;
        for (let i = full.indexOf(quote); i !== -1; i = full.indexOf(quote, i + 1)) {
            const dist = Math.abs(i - off);
            if (dist < bestDist) {
                best = i;
                bestDist = dist;
            }
        }
        if (best < 0) return null;
        off = best;
    }
    if (off < 0 || off > full.length) return null;
    while (off < full.length && /\s/.test(full[off])) off++;
    const start = locateOffset(nodes, off);
    if (!start) return null;
    const len = Number.isInteger(anchor.length) ? anchor.length : 0;
    const end = len > 0 ? locateOffset(nodes, Math.min(full.length, off + len)) : null;
    return { start, end };
}

/* ── Bookmark ribbons in the margin ──────────────────────────────────────────
   A ribbon never sits inside the text: it hangs in the page margin, level
   with the line where its selection starts, on the side nearer to that
   start - or the only side with room on a narrow screen. Ribbons that meet
   on one line and side line up next to each other in text order. The
   selected words themselves get a soft highlight (CSS Custom Highlight API:
   no element is added to the text, so nothing about the lines changes). */

const MARKER_GAP_PX = 6;
const MARKER_STEP_GAP_PX = 3;
const BOOKMARK_HIGHLIGHT = 'ereader-bookmark';
/** bookmark id -> Range of its selected words, for the mounted sections. */
const highlightRanges = new Map();

function createBookmarkMarker(bm, number) {
    /* A button: tapping it opens the same note view as the bookmark
       carousel under the contents list. */
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'ereader-bookmark-marker is-margin';
    marker.innerHTML = BOOKMARK_ICON_SVG;
    marker.dataset.bookmarkId = bm.id;
    marker.dataset.number = String(number ?? '');
    marker.title = t('ereader_bookmark_marker_title', { title: bm.title || t('ereader_bookmark_untitled') });
    marker.setAttribute('aria-label', marker.title);
    return marker;
}

/** Repaints the highlight of every selected passage still on the page. */
function paintBookmarkHighlights() {
    if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
    const live = [];
    for (const [id, range] of highlightRanges) {
        if (range.startContainer.isConnected) live.push(range);
        else highlightRanges.delete(id);
    }
    if (live.length) CSS.highlights.set(BOOKMARK_HIGHLIGHT, new Highlight(...live));
    else CSS.highlights.delete(BOOKMARK_HIGHLIGHT);
}

function firstRect(range) {
    if (typeof range.getClientRects === 'function') {
        const rects = range.getClientRects();
        if (rects && rects.length) return rects[0];
    }
    return typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
}

/** Positions the section's ribbons (all of them already in it) from where
 *  their anchors are on screen right now. */
function layoutSectionMarkers(secEl) {
    const markers = [...secEl.querySelectorAll(':scope > .ereader-bookmark-marker.is-margin')];
    if (!markers.length) return;
    const secRect = secEl.getBoundingClientRect();
    const viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
    const room = { left: secRect.left, right: viewportW - secRect.right };
    const groups = new Map();
    for (const marker of markers) {
        const range = marker._anchorRange;
        const rect = range ? firstRect(range) : null;
        const height = marker.offsetHeight || 18;
        let top = 0;
        let side = 'left';
        /* An anchor inside folded-away text has no box: so neither does its ribbon. */
        const boxless = !!rect && !rect.width && !rect.height && !rect.top && !rect.left;
        marker.classList.toggle('is-boxless', boxless && secRect.height > 0);
        if (rect && (rect.height || rect.top)) {
            top = rect.top - secRect.top + (rect.height - height) / 2;
            const nearRight = rect.left - secRect.left > secRect.width / 2;
            side = nearRight ? 'right' : 'left';
        }
        const needed = (marker.offsetWidth || 26) + MARKER_GAP_PX;
        if (room[side] < needed && room[side === 'left' ? 'right' : 'left'] > room[side]) {
            side = side === 'left' ? 'right' : 'left';
        }
        const key = `${side}:${Math.round(top / 4)}`;
        if (!groups.has(key)) groups.set(key, { side, top, items: [] });
        groups.get(key).items.push(marker);
    }
    for (const { side, top, items } of groups.values()) {
        /* Text order: the anchors were placed in offset order. */
        items.sort((a, b) => (Number(a.dataset.order) || 0) - (Number(b.dataset.order) || 0));
        const width = items[0].offsetWidth || 26;
        let step = width + MARKER_STEP_GAP_PX;
        const avail = room[side] - MARKER_GAP_PX;
        if (avail > width && step * items.length > avail) {
            step = Math.max(8, (avail - width) / Math.max(1, items.length - 1));
        }
        items.forEach((marker, i) => {
            marker.dataset.side = side;
            marker.style.top = `${Math.round(top)}px`;
            /* Left of the text the row reads left to right ending at the
               text; right of it, it starts at the text. */
            const offset = side === 'left'
                ? MARKER_GAP_PX + (items.length - 1 - i) * step
                : MARKER_GAP_PX + i * step;
            marker.style.left = side === 'left' ? `${-offset - width}px` : `calc(100% + ${offset}px)`;
        });
    }
}

/** Draws every bookmark of the mounted sections: a ribbon in the margin,
 *  level with where it starts, and a highlight on the passage it marks - the
 *  reading content's own twin of the carousel below the contents list. */
function decorateBookmarkMarkers(wrapper) {
    if (!open || !wrapper) return;
    const all = getBookmarks(open.book.id);
    const numbers = bookmarkNumbers(all);
    const bySection = new Map();
    for (const b of all) {
        if (!bySection.has(b.sectionId)) bySection.set(b.sectionId, []);
        bySection.get(b.sectionId).push(b);
    }
    const content = contentEl();
    if (content) content.classList.toggle('has-bookmarks', all.length > 0);
    wrapper.querySelectorAll('.ereader-section').forEach(secEl => {
        secEl.querySelectorAll('.ereader-bookmark-marker').forEach(m => {
            highlightRanges.delete(m.dataset.bookmarkId);
            m.remove();
        });
        const list = bySection.get(secEl.dataset.sectionId) || [];
        if (!list.length) return;
        const placed = list.map(bm => {
            /* No anchor (made before anchors existed): the section's start. */
            const spot = resolveAnchor(secEl, bm.anchor || { offset: 0, quote: '' });
            return { bm, spot, at: Number.isInteger(bm.anchor?.offset) ? bm.anchor.offset : -1 };
        }).sort((a, b) => a.at - b.at);
        placed.forEach(({ bm, spot }, order) => {
            const marker = createBookmarkMarker(bm, numbers.get(bm.id));
            marker.dataset.order = String(order);
            if (spot) {
                const range = document.createRange();
                range.setStart(spot.start.node, spot.start.offset);
                if (spot.end) range.setEnd(spot.end.node, spot.end.offset);
                else range.collapse(true);
                marker._anchorRange = range;
                if (spot.end && !range.collapsed) highlightRanges.set(bm.id, range.cloneRange());
            }
            secEl.insertBefore(marker, secEl.firstChild);
        });
        layoutSectionMarkers(secEl);
    });
    paintBookmarkHighlights();
}

/** Re-measures every mounted ribbon - the text reflowed (font size, window
 *  width, a picture loaded, a translation opened). */
function relayoutBookmarkMarkers() {
    const content = contentEl();
    if (!open || !content) return;
    content.querySelectorAll('.ereader-section').forEach(secEl => layoutSectionMarkers(secEl));
}

let relayoutFrame = 0;
function scheduleMarkerRelayout() {
    if (relayoutFrame || typeof requestAnimationFrame !== 'function') return;
    relayoutFrame = requestAnimationFrame(() => {
        relayoutFrame = 0;
        relayoutBookmarkMarkers();
    });
}

/** Refreshes the ribbons on whichever chapters are currently mounted -
 *  called after a bookmark is added or removed, when a remount is overkill. */
function decorateMountedBookmarkMarkers() {
    if (!open) return;
    for (const i of open.mounted) {
        const wrapper = chapterWrapperEl(i);
        if (wrapper) decorateBookmarkMarkers(wrapper);
    }
}

/**
 * Mounts the window around open.chapterIndex and scrolls to where the caller
 * asked: a saved offset (opening), a section (contents/search), or the
 * chapter's own start (nothing else given).
 */
function positionInBook({ restoreOffset = null, anchorSectionId = null, anchorDelta } = {}) {
    if (!open) return;
    syncMountWindow(open.chapterIndex);
    updateFontUI();
    if (restoreOffset !== null) {
        scrollToOffset(open.chapterIndex, restoreOffset);
        capturePosition();
    } else if (anchorSectionId) {
        scrollToSection(anchorSectionId, anchorDelta);
        capturePosition(anchorSectionId);
    } else {
        scrollToOffset(open.chapterIndex, 0);
        capturePosition(open.chapters[open.chapterIndex]?.sectionIds[0] || null);
    }
    updateScrollTopButton();
}

function ensureAncestorsExpanded(sectionId) {
    if (!open || !open.book || !Array.isArray(open.book.sections)) return;
    const sections = open.book.sections;
    const targetIdx = sections.findIndex(s => s.id === sectionId);
    if (targetIdx <= 0) return;

    let targetLevel = sections[targetIdx].level || 1;
    for (let i = targetIdx - 1; i >= 0; i--) {
        const s = sections[i];
        const lvl = s.level || 1;
        if (lvl < targetLevel) {
            tocCollapsed.delete(s.id);
            targetLevel = lvl;
            if (targetLevel <= 1) break;
        }
    }
}

/**
 * Jumping to a contents entry is itself an action inside the TOC drawer, not
 * a reason to dismiss it - the drawer only closes when the reader taps the
 * book content behind it (see the click-outside handler in main.js).
 */
export async function goToSection(sectionId) {
    if (!open) return;
    const chapter = chapterOfSection(open.chapters, sectionId);
    if (!chapter) return;
    open.chapterIndex = chapter.index;
    syncMountWindow(chapter.index);
    scrollToSection(sectionId);
    capturePosition(sectionId);
    ensureAncestorsExpanded(sectionId);
    renderEreaderToc();
    await flushPosition();
}

/** Index into FONT_SIZE_TIERS closest to a stored scale (which may sit on a
 *  FONT_STEPS value the tiers don't cover, e.g. a scale saved before the
 *  three-tier control existed). */
function nearestTierIndex(scale) {
    let best = 0;
    let bestDiff = Infinity;
    FONT_SIZE_TIERS.forEach((tier, i) => {
        const diff = Math.abs(tier - scale);
        if (diff < bestDiff) {
            bestDiff = diff;
            best = i;
        }
    });
    return best;
}

const FONT_SIZE_TITLE_KEYS = ['ereader_font_size_small', 'ereader_font_size_normal', 'ereader_font_size_large'];
/** The preview line's font-size at 100% scale; scaled the same as the book's
 *  own content so it visibly grows/shrinks with the selection. The button's
 *  own "Aa" glyph stays fixed at every tier - only the dot and this preview
 *  move, so the row's height never shifts as the reader cycles through them. */
const FONT_SIZE_PREVIEW_BASE_REM = 0.95;

function updateFontUI() {
    const scale = getPrefs().fontScale || 1;
    const tierIdx = nearestTierIndex(scale);
    const btn = document.getElementById('ereaderFontSizeBtn');
    if (!btn) return;
    btn.querySelectorAll('.ereader-fontsize-dot').forEach((dot, i) => {
        dot.classList.toggle('active', i === tierIdx);
    });
    const label = t(FONT_SIZE_TITLE_KEYS[tierIdx]);
    btn.title = label;
    btn.setAttribute('aria-label', label);

    const preview = document.getElementById('ereaderFontSizePreview');
    if (preview) preview.style.fontSize = `${(FONT_SIZE_PREVIEW_BASE_REM * scale).toFixed(3)}rem`;
}

/** Sets fontScale and repaints: the section being read stays put. Font size
 *  is a single CSS variable on #ereaderContent, so every mounted chapter
 *  rescales on its own - only the scroll position needs correcting, and only
 *  the unmounted chapters' placeholder heights need updating. Shared by the
 *  FONT_STEPS stepper and the three-tier cycle button below. */
async function applyFontScale(newScale) {
    const current = getPrefs().fontScale || 1;
    if (newScale === current) return current;

    const anchorId = open && bookViewActive ? currentSectionId() : null;
    const anchorEl = anchorId ? sectionEls().find(s => s.dataset.sectionId === anchorId) : null;
    const anchorDelta = anchorEl ? anchorEl.getBoundingClientRect().top : undefined;

    await setPrefs({ fontScale: newScale });

    if (open && bookViewActive) {
        contentEl()?.style.setProperty('--ereader-font-scale', String(newScale));
        refreshUnmountedHeights();
        if (anchorId) scrollToSection(anchorId, anchorDelta);
        capturePosition(anchorId);
    }
    updateFontUI();
    return newScale;
}

/** One step smaller (-1) or larger (+1) along the fine-grained scale. */
export async function changeFontScale(direction) {
    const current = getPrefs().fontScale || 1;
    let idx = FONT_STEPS.indexOf(current);
    if (idx < 0) idx = FONT_STEPS.findIndex(s => s >= current);
    if (idx < 0) idx = FONT_STEPS.length - 1;
    const nextIdx = Math.max(0, Math.min(FONT_STEPS.length - 1, idx + direction));
    if (FONT_STEPS[nextIdx] === current) return current;
    return applyFontScale(FONT_STEPS[nextIdx]);
}

/** The settings popup's icon-only control: small -> normal -> large -> small. */
export async function cycleFontSizeTier() {
    const current = getPrefs().fontScale || 1;
    const idx = nearestTierIndex(current);
    const nextIdx = (idx + 1) % FONT_SIZE_TIERS.length;
    return applyFontScale(FONT_SIZE_TIERS[nextIdx]);
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

/** A collapse toggle only ever sits on the top three heading levels
 *  (h1/h2/h3 equivalent) of the book's own outline. */
const TOC_TOGGLE_MAX_REL_LEVEL = 2;

/** Builds one contents row: an optional collapse toggle (h1-h3 sections with
 *  children) or a same-width spacer, then the navigation button itself. */
function createTocRow(s, { relLevel, canToggle, collapsed, activeId }) {
    const row = document.createElement('div');
    row.className = 'ereader-toc-row';

    if (canToggle) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'ereader-toc-toggle' + (collapsed ? ' collapsed' : '');
        toggle.setAttribute('aria-label', t(collapsed ? 'ereader_toc_expand' : 'ereader_toc_collapse'));
        toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
        toggle.onclick = (e) => {
            e.stopPropagation();
            if (tocCollapsed.has(s.id)) tocCollapsed.delete(s.id);
            else tocCollapsed.add(s.id);
            renderEreaderToc();
        };
        row.appendChild(toggle);
    } else {
        row.appendChild(document.createElement('span')).className = 'ereader-toc-toggle-spacer';
    }

    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'menu-sub-item ereader-toc-item' + (s.id === activeId ? ' active' : '');
    item.dataset.sectionId = s.id;
    item.style.setProperty('--toc-depth', String(relLevel));
    item.textContent = (s.title || '').trim() || t('ereader_untitled_section');
    item.onclick = async () => {
        if (canToggle) {
            if (tocCollapsed.has(s.id)) {
                tocCollapsed.delete(s.id);
            } else if (s.id === activeId) {
                tocCollapsed.add(s.id);
            }
        }
        await goToSection(s.id);
    };
    row.appendChild(item);

    return row;
}

/** Paints #ereaderTocList for the open book: a nested outline where h1-h3
 *  equivalent entries with children can be collapsed to hide them. */
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

    /* A section "has children" when the very next one sits at a deeper
       level - in a depth-first outline, a child always comes right after
       its parent, so a single lookahead is enough. */
    const hasChildren = sections.map((s, i) => {
        const next = sections[i + 1];
        return !!next && (next.level || 1) > (s.level || 1);
    });

    const ancestors = []; // open ancestors on the current path: { level, collapsed }
    sections.forEach((s, i) => {
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

        const lvl = s.level || 1;
        while (ancestors.length && ancestors[ancestors.length - 1].level >= lvl) ancestors.pop();
        const hiddenByAncestor = ancestors.some(a => a.collapsed);
        const relLevel = lvl - minLevel;
        const canToggle = relLevel <= TOC_TOGGLE_MAX_REL_LEVEL && hasChildren[i];
        const collapsed = canToggle && tocCollapsed.has(s.id);
        ancestors.push({ level: lvl, collapsed });

        if (!hiddenByAncestor) {
            items.push(createTocRow(s, { relLevel, canToggle, collapsed, activeId }));
        }
    });

    while (pendingGaps.length > 0) {
        items.push(createGapItem(pendingGaps.shift()));
    }

    list.replaceChildren(...items);
}

/** Contents toolbar: expand every collapsed entry back open. */
export function tocExpandAll() {
    tocCollapsed.clear();
    renderEreaderToc();
}

/** Contents toolbar: collapse every entry with children, leaving only the
 *  top-level titles visible. */
export function tocCollapseToTop() {
    if (!open) return;
    const sections = open.book.sections;
    const toCollapse = [];
    for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        const next = sections[i + 1];
        if (next && (next.level || 1) > (s.level || 1)) {
            toCollapse.push(s.id);
        }
    }
    tocCollapsed = new Set(toCollapse);
    renderEreaderToc();
}

/**
 * Bookmarks (F9): a single-item carousel pinned above the progress bar. The
 * numbering (1, 2, 3...) is never stored - it is the bookmark's rank by its
 * section's position in the book, recomputed on every render, so adding or
 * removing one always renumbers the rest without any bookkeeping of its own.
 */
function sortedBookmarks() {
    if (!open) return [];
    const order = new Map(open.book.sections.map((s, i) => [s.id, i]));
    return getBookmarks(open.book.id)
        .map(b => ({
            ...b,
            _pos: order.has(b.sectionId) ? order.get(b.sectionId) : Infinity,
            _at: Number.isInteger(b.anchor?.offset) ? b.anchor.offset : -1
        }))
        .sort((a, b) => a._pos - b._pos || a._at - b._at || a.createdAt - b.createdAt);
}

/** Paints the contents drawer's bookmark carousel and the mounted chapters'
 *  inline markers together, so any path that changes the open book's
 *  bookmarks - the modal, a delete, a synced edit from another device - only
 *  has to call this one function and both stay in step. Hides the carousel
 *  when the open book has none. */
export function renderEreaderBookmarks() {
    decorateMountedBookmarkMarkers();
    const carousel = document.getElementById('ereaderBookmarkCarousel');
    if (!carousel) return;
    const list = open ? sortedBookmarks() : [];
    if (list.length === 0) {
        carousel.style.display = 'none';
        bookmarkIndex = 0;
        return;
    }
    bookmarkIndex = Math.max(0, Math.min(bookmarkIndex, list.length - 1));
    const current = list[bookmarkIndex];
    const label = current.title || t('ereader_bookmark_untitled');

    carousel.style.display = 'flex';
    const numberEl = document.getElementById('ereaderBookmarkNumber');
    if (numberEl) numberEl.textContent = `(${bookmarkNumbers(getBookmarks(open.book.id)).get(current.id) ?? bookmarkIndex + 1})`;
    const titleEl = document.getElementById('ereaderBookmarkTitle');
    if (titleEl) titleEl.textContent = label;
    const currentBtn = document.getElementById('ereaderBookmarkCurrentBtn');
    if (currentBtn) currentBtn.title = t('ereader_bookmark_count', { current: bookmarkIndex + 1, total: list.length }) + ' – ' + label;

    const onlyOne = list.length <= 1;
    const prevBtn = document.getElementById('ereaderBookmarkPrevBtn');
    if (prevBtn) prevBtn.disabled = onlyOne;
    const nextBtn = document.getElementById('ereaderBookmarkNextBtn');
    if (nextBtn) nextBtn.disabled = onlyOne;
}

function stepBookmark(direction) {
    const list = sortedBookmarks();
    if (list.length === 0) return;
    bookmarkIndex = (bookmarkIndex + direction + list.length) % list.length;
    renderEreaderBookmarks();
}

/** The carousel's own entry is a contents jump, same as a TOC row - it does
 *  not dismiss the drawer either (see goToSection). */
async function goToCurrentBookmark() {
    const list = sortedBookmarks();
    const current = list[bookmarkIndex];
    if (current) await goToBookmark(current);
}

/** A section jump, then - when the ribbon sits further down inside the
 *  section - on to the ribbon itself, a little below the reading line so the
 *  line before it is still in view. */
async function goToBookmark(bm) {
    await goToSection(bm.sectionId);
    const marker = [...(contentEl()?.querySelectorAll('.ereader-bookmark-marker') || [])]
        .find(m => m.dataset.bookmarkId === bm.id);
    if (!marker) return;
    const y = marker.getBoundingClientRect().top + window.scrollY - (READING_LINE_PX + 24);
    window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
}

async function deleteBookmarkEntry(current) {
    if (!open || !current) return;
    const list = sortedBookmarks();
    const label = current.title || t('ereader_bookmark_untitled');
    if (!(await showConfirm(t('ereader_bookmark_delete_confirm', { title: label })))) return false;

    await deleteBookmark(open.book.id, current.id);
    showToast(t('ereader_bookmark_deleted'));
    if (bookmarkIndex >= list.length - 1) bookmarkIndex = Math.max(0, list.length - 2);
    renderEreaderBookmarks();
    return true;
}

function openBookmarkModal(sectionId, prefillTitle = '', prefillNote = '', editId = null, anchor = null) {
    if (!open || !sectionId) return;
    const overlay = document.getElementById('ereaderBookmarkOverlay');
    const titleEl = document.getElementById('ereaderBookmarkModalTitle');
    const titleInput = document.getElementById('ereaderBookmarkTitleInput');
    const noteInput = document.getElementById('ereaderBookmarkNoteInput');
    if (!overlay || !titleInput || !noteInput) return;

    pendingBookmarkSectionId = sectionId;
    pendingBookmarkAnchor = anchor;
    editingBookmarkId = editId;
    if (titleEl) titleEl.textContent = t(editId ? 'ereader_bookmark_edit_modal_title' : 'ereader_bookmark_modal_title');
    titleInput.value = prefillTitle;
    noteInput.value = prefillNote;
    overlay.classList.add('active');
    titleInput.focus();
}

function closeBookmarkModal() {
    const overlay = document.getElementById('ereaderBookmarkOverlay');
    if (overlay) overlay.classList.remove('active');
    pendingBookmarkSectionId = null;
    pendingBookmarkAnchor = null;
    editingBookmarkId = null;
}

function isBookmarkModalOpen() {
    const overlay = document.getElementById('ereaderBookmarkOverlay');
    return !!(overlay && overlay.classList.contains('active'));
}

async function saveBookmarkFromModal() {
    const sectionId = pendingBookmarkSectionId;
    if (!open || !sectionId) {
        closeBookmarkModal();
        return;
    }
    const titleInput = document.getElementById('ereaderBookmarkTitleInput');
    const noteInput = document.getElementById('ereaderBookmarkNoteInput');
    const title = (titleInput?.value || '').trim();
    const note = (noteInput?.value || '').trim();
    const editId = editingBookmarkId;
    const anchor = pendingBookmarkAnchor;
    closeBookmarkModal();

    if (editId) {
        await updateBookmark(open.book.id, editId, { title, note });
        showToast(t('ereader_bookmark_updated'));
    } else {
        await addBookmark(open.book.id, { sectionId, title, note, ...(anchor ? { anchor } : {}) });
        showToast(t('ereader_bookmark_saved'));
    }
    renderEreaderBookmarks();
}

/**
 * Note-detail modal (F-toolbar's details button on the carousel): a bookmark
 * carries a title and a note, both easily longer than the carousel's own
 * single-line label - this is where the reader actually reads them, then
 * edits (hands off to the add/edit modal above, prefilled) or deletes.
 */
/** Opens the note view for the carousel's current bookmark, or - from an
 *  inline marker in the book - for the given one, moving the carousel onto
 *  it so both stay in step. */
function openBookmarkDetailModal(bookmarkId = null) {
    const list = sortedBookmarks();
    if (bookmarkId) {
        const idx = list.findIndex(b => b.id === bookmarkId);
        if (idx < 0) return;
        if (idx !== bookmarkIndex) {
            bookmarkIndex = idx;
            renderEreaderBookmarks();
        }
    }
    const current = list[bookmarkIndex];
    if (!current) return;
    const overlay = document.getElementById('ereaderBookmarkDetailOverlay');
    const titleEl = document.getElementById('ereaderBookmarkDetailTitle');
    const noteEl = document.getElementById('ereaderBookmarkDetailNote');
    if (!overlay || !titleEl || !noteEl) return;

    detailBookmarkId = current.id;
    titleEl.textContent = current.title || t('ereader_bookmark_untitled');
    const hasNote = !!current.note;
    noteEl.textContent = hasNote ? current.note : t('ereader_bookmark_detail_no_note');
    noteEl.classList.toggle('ereader-bookmark-detail-empty', !hasNote);
    overlay.classList.add('active');
}

function closeBookmarkDetailModal() {
    const overlay = document.getElementById('ereaderBookmarkDetailOverlay');
    if (overlay) overlay.classList.remove('active');
    detailBookmarkId = null;
}

function isBookmarkDetailModalOpen() {
    const overlay = document.getElementById('ereaderBookmarkDetailOverlay');
    return !!(overlay && overlay.classList.contains('active'));
}

function editBookmarkFromDetail() {
    if (!open || !detailBookmarkId) return;
    const current = sortedBookmarks().find(b => b.id === detailBookmarkId);
    if (!current) return;
    closeBookmarkDetailModal();
    openBookmarkModal(current.sectionId, current.title, current.note, current.id);
}

async function deleteBookmarkFromDetail() {
    if (!open || !detailBookmarkId) return;
    const current = sortedBookmarks().find(b => b.id === detailBookmarkId);
    if (!current) return;
    if (await deleteBookmarkEntry(current)) closeBookmarkDetailModal();
}

/** Header bookmark button: bookmarks wherever the reader is right now. */
function bookmarkCurrentPosition() {
    if (!open || !bookViewActive) return;
    const sectionId = currentSectionId() || open.chapters[open.chapterIndex]?.sectionIds[0];
    if (!sectionId) return;
    const section = open.book.sections.find(s => s.id === sectionId);
    openBookmarkModal(sectionId, (section?.title || '').trim(), '', null, readingLineAnchor(sectionId));
}

/** The first block of the section that reaches below the reading line -
 *  where the reader's eyes are - as an anchor; null at the section's top. */
function readingLineAnchor(sectionId) {
    const secEl = sectionEls().find(s => s.dataset.sectionId === sectionId);
    if (!secEl) return null;
    const blocks = secEl.querySelectorAll('p, li, blockquote, pre, td, h1, h2, h3, h4, h5, h6');
    for (const el of blocks) {
        if (el.closest(ANCHOR_SKIP)) continue;
        if (el.getBoundingClientRect().bottom <= READING_LINE_PX) continue;
        if (el.getBoundingClientRect().height === 0) continue;
        return anchorAt(secEl, el, 0);
    }
    return null;
}

/**
 * Text-selection bookmarking (F9): a small floating action near the
 * selection, the same familiar shape readers already know from Kindle,
 * Google Docs and the like - select, then tap the action that appears.
 */
function hideSelectionPopover() {
    const btn = document.getElementById('ereaderSelectionBookmarkBtn');
    if (btn) btn.style.display = 'none';
    selectionSectionId = null;
    selectionExcerpt = '';
    selectionAnchor = null;
}

/** Exported so a selectionchange event (real use) and a test (synthetic
 *  Range, no such event in jsdom) can both drive it the same way. */
export function updateSelectionPopover() {
    if (!bookViewActive || typeof window === 'undefined' || typeof window.getSelection !== 'function') return;
    const btn = document.getElementById('ereaderSelectionBookmarkBtn');
    const content = contentEl();
    if (!btn || !content) return;

    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed && sel.rangeCount > 0 ? sel.toString().trim() : '';
    if (!text) {
        hideSelectionPopover();
        return;
    }

    const range = sel.getRangeAt(0);
    const anchorEl = range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const endEl = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;

    const isTranslationEl = (el) => Boolean(el && (
        el.closest('.md-section-translation') ||
        el.closest('.md-callout-translation') ||
        el.closest('.translation-text')
    ));
    if (isTranslationEl(anchorEl) || isTranslationEl(startEl) || isTranslationEl(endEl)) {
        hideSelectionPopover();
        return;
    }

    const sectionEl = anchorEl ? anchorEl.closest('.ereader-section') : null;
    if (!sectionEl || !content.contains(sectionEl)) {
        hideSelectionPopover();
        return;
    }

    selectionSectionId = sectionEl.dataset.sectionId;
    selectionExcerpt = text.length > 120 ? text.slice(0, 119) + '…' : text;
    try {
        selectionAnchor = sectionEl.contains(range.startContainer)
            ? anchorAt(sectionEl, range.startContainer, range.startOffset, range.endContainer, range.endOffset)
            : null;
    } catch (_) {
        selectionAnchor = null;
    }

    const rect = typeof range.getBoundingClientRect === 'function'
        ? range.getBoundingClientRect()
        : { left: 0, width: 0, top: 0 };
    btn.style.left = `${rect.left + rect.width / 2}px`;
    btn.style.top = `${Math.max(8, rect.top - 8)}px`;
    btn.style.display = 'flex';
}

function bookmarkFromSelection() {
    if (!selectionSectionId) return;
    const sectionId = selectionSectionId;
    const excerpt = selectionExcerpt;
    const anchor = selectionAnchor;
    hideSelectionPopover();
    window.getSelection()?.removeAllRanges();
    openBookmarkModal(sectionId, excerpt, '', null, anchor);
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
    if (bookViewActive) {
        setHeaderTitle(book.title);
        renderBookShell();
        positionInBook({ anchorSectionId: anchorId });
    }
    renderEreaderToc();
    renderEreaderBookmarks();
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
 * Search Bar (F5)
 */
/** The header search button doubles as the field's close button (its icon
 *  flips to an X through header.ereader-searching). */
function setSearchChrome(isOpen) {
    const header = document.querySelector('header');
    if (header) header.classList.toggle('ereader-searching', isOpen);
    const btn = document.getElementById('ereaderSearchBtn');
    if (btn) {
        const label = t(isOpen ? 'ereader_search_close' : 'ereader_search');
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.setAttribute('aria-expanded', String(isOpen));
    }
}

function updateSearchClearBtn() {
    const input = document.getElementById('ereaderSearchInput');
    const clearBtn = document.getElementById('ereaderSearchClearBtn');
    if (clearBtn) clearBtn.style.display = input && input.value ? 'flex' : 'none';
}

function setSearchResultsHidden(hidden) {
    const results = document.getElementById('ereaderSearchResults');
    if (results) results.classList.toggle('is-hidden', hidden);
}

export function openSearchBar() {
    const bar = document.getElementById('ereaderSearchBar');
    const input = document.getElementById('ereaderSearchInput');
    if (!bar || !input) return;
    bar.style.display = 'block';
    setSearchChrome(true);
    setSearchResultsHidden(false);
    updateSearchClearBtn();
    input.focus();
}

/** Empties the field for a new search but keeps it open. */
export function clearSearch() {
    const input = document.getElementById('ereaderSearchInput');
    if (!input) return;
    input.value = '';
    onSearchInput();
    input.focus();
}

export function closeSearchBar() {
    const bar = document.getElementById('ereaderSearchBar');
    const input = document.getElementById('ereaderSearchInput');
    const results = document.getElementById('ereaderSearchResults');
    if (bar) bar.style.display = 'none';
    setSearchChrome(false);
    if (input) input.value = '';
    updateSearchClearBtn();
    if (results) {
        results.replaceChildren();
        results.classList.remove('is-hidden');
    }
    if (activeSearchTerm) {
        activeSearchTerm = '';
        if (open && bookViewActive) remountAllMounted();
    }
}

export function isSearchBarOpen() {
    const bar = document.getElementById('ereaderSearchBar');
    return !!(bar && bar.style.display !== 'none');
}

function onSearchInput() {
    const input = document.getElementById('ereaderSearchInput');
    const resultsEl = document.getElementById('ereaderSearchResults');
    if (!input || !resultsEl) return;
    updateSearchClearBtn();
    resultsEl.classList.remove('is-hidden');
    const term = input.value.trim();
    if (term.length < 2) {
        resultsEl.replaceChildren();
        if (activeSearchTerm) {
            activeSearchTerm = '';
            if (open && bookViewActive) remountAllMounted();
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

    const items = matches.map(m => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'ereader-search-item';
        const titleHtml = escapeHTML(m.title || t('ereader_untitled_section'));
        const snippetHtml = applySearchHighlight(escapeHTML(m.snippet), term);
        item.innerHTML = `<div class="ereader-search-title">${titleHtml}</div><div class="ereader-search-snippet">${snippetHtml}</div>`;
        item.onclick = async () => {
            activeSearchTerm = term;
            /* The list drops down over the page; step out of the way of the
               match just jumped to. Focusing the field brings it back. */
            setSearchResultsHidden(true);
            revealInBody(m.sectionId);
            open.chapterIndex = m.chapterIndex;
            syncMountWindow(m.chapterIndex);
            remountChapter(m.chapterIndex);
            renderEreaderToc();
            const sec = sectionEls().find(s => s.dataset.sectionId === m.sectionId);
            if (sec) {
                const highlight = sec.querySelector('.search-highlight') || sec;
                const y = highlight.getBoundingClientRect().top + window.scrollY - (READING_LINE_PX - 8);
                window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
            }
            capturePosition(m.sectionId);
            await flushPosition();
        };
        return item;
    });
    resultsEl.replaceChildren(...items);
}

/**
 * Settings popup (gear icon)
 */
export function openSettingsOverlay() {
    const overlay = document.getElementById('ereaderSettingsOverlay');
    if (!overlay) return;
    updateFontUI();
    updateTranslateUI();
    updateTtsUI();
    syncSettingsBookActions();
    overlay.classList.add('active');
}

/** The settings popup's quick actions (download, share, print) act on the
 *  open book; without one there is nothing for them to do. */
function syncSettingsBookActions() {
    const group = document.getElementById('ereaderSettingsBookActions');
    if (group) group.style.display = getOpenBook() ? '' : 'none';
}

export function closeSettingsOverlay() {
    const overlay = document.getElementById('ereaderSettingsOverlay');
    if (overlay) overlay.classList.remove('active');
}

export function isSettingsOverlayOpen() {
    const overlay = document.getElementById('ereaderSettingsOverlay');
    return !!(overlay && overlay.classList.contains('active'));
}

/** The open book, shaped back into an e-Reader JSON document (the format
 *  importEreaderJson/validateEreaderFile accepts) so a shared or downloaded
 *  copy can be re-imported as-is. With includeImages, the pictures the reader
 *  put in place of the placeholders ride along as a top-level `images` object,
 *  which the importer puts back on the receiving device. */
export async function bookExportJson(book, { includeImages = false } = {}) {
    const part = Array.isArray(book.parts) ? book.parts[0] : null;
    const json = {
        ereader: {
            schema: 1,
            title: book.title,
            author: book.author || '',
            language: book.language || '',
            source_type: book.sourceType || 'other',
            book_key: book.bookKey,
            ...(part ? { part: { unit: part.unit, from: part.from, to: part.to, total: part.total } } : {})
        },
        sections: (book.sections || []).map(s => ({
            id: s.id,
            title: s.title || '',
            level: s.level || 1,
            text: s.text || '',
            ...(Number.isInteger(s.pageStart) ? { page_start: s.pageStart } : {})
        }))
    };
    if (includeImages) {
        const images = await exportBookImages(book.id);
        if (Object.keys(images).length > 0) json.images = images;
    }
    return json;
}

function bookFileName(book) {
    return `${(book.title || 'book').trim().replace(/\s+/g, '_')}.json`;
}

/**
 * Whether a copy of the book (download, print) should carry the reader's own
 * pictures. Asked only when the book has some: true / false, or null when
 * the reader cancelled.
 */
export async function askIncludeImages(book) {
    const count = await countBookImages(book.id);
    if (count === 0) return false;
    const choice = await showDecision(
        t('ereader_images_include_message', { count }),
        t('ereader_images_include_title'),
        { confirm: t('ereader_images_include_yes'), alt: t('ereader_images_include_no'), cancel: t('cancel') }
    );
    if (choice === 'confirm') return true;
    if (choice === 'alt') return false;
    return null;
}

function saveJsonFile(fileName, jsonStr) {
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/** Saves a full book record as its importable .json file, asking first
 *  whether its pictures go along when it has any. */
export async function downloadBook(book, { includeImages } = {}) {
    if (!book) return;
    const include = includeImages === undefined ? await askIncludeImages(book) : includeImages;
    if (include === null) return;
    saveJsonFile(bookFileName(book), JSON.stringify(await bookExportJson(book, { includeImages: include }), null, 2));
}

export async function shareOpenBook() {
    const book = getOpenBook();
    if (!book) return;
    closeSettingsOverlay();
    await shareBook(book);
}

/** The same "how to share" dialog as the test centre's sources: clipboard,
 *  text, .json file, browser. A book with pictures of its own gets a switch
 *  for whether they go along. */
export async function shareBook(book) {
    if (!book) return;
    const count = await countBookImages(book.id);
    await openShareOptions({
        name: book.title || '',
        fileName: bookFileName(book),
        getJson: async ({ toggle }) => JSON.stringify(await bookExportJson(book, { includeImages: count > 0 && toggle }), null, 2),
        onDownload: ({ toggle }) => downloadBook(book, { includeImages: count > 0 && toggle }),
        toggle: count > 0 ? { label: t('ereader_share_include_images', { count }), checked: true } : null
    });
}

/**
 * Fullscreen / Zen Mode (F5)
 */
export function enterFullscreen() {
    closeSearchBar();
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
export async function printOpenBook() {
    const book = getOpenBook();
    if (!book) return;
    closeSettingsOverlay();
    const includeImages = await askIncludeImages(book);
    if (includeImages === null) return;
    if (typeof deps.closeMenu === 'function') deps.closeMenu();
    const host = document.getElementById('ereaderPrintHost');
    if (!host) return;

    const sectionsHtml = book.sections
        .map(s => `<section class="ereader-section md-content" data-section-id="${escapeHTML(s.id)}">${renderMarkdown(sectionSource(s), { images: true, keepHeadingLevels: true })}</section>`)
        .join('');

    host.innerHTML = `<div class="ereader-print-book"><h1>${escapeHTML(book.title)}</h1>${book.author ? `<p class="ereader-print-author">${escapeHTML(book.author)}</p>` : ''}${sectionsHtml}</div>`;
    fillImagePlaceholders(host, includeImages ? (peekBookImages(book.id) || {}) : {}, { interactive: false });
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
    renderBookShell();
    const restore = open.pendingRestore;
    open.pendingRestore = null;
    positionInBook(restore ? { restoreOffset: restore.offset } : {});
    renderEreaderToc();
    renderEreaderBookmarks();
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
    closeSettingsOverlay();
    closeTtsSettings();
    closeBookmarkModal();
    hideSelectionPopover();
    stopEreaderTts();
    flushPosition();
}

function updateScrollTopButton() {
    const btn = document.getElementById('ereaderScrollTopBtn');
    if (!btn) return;
    btn.style.display = (bookViewActive && window.scrollY > SCROLL_TOP_SHOW_PX) ? 'flex' : 'none';
}

function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function onScroll() {
    if (!bookViewActive || !open) return;
    hideSelectionPopover();
    const idx = visibleChapterIndex();
    if (idx !== open.chapterIndex) {
        open.chapterIndex = idx;
        syncMountWindow(idx);
    }
    capturePosition();
    updateScrollTopButton();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushPosition, SAVE_DELAY_MS);
}

/**
 * The image modal: for one placeholder, shows what the book says about the
 * figure (so the right one of several is easy to find in the source), and
 * takes a picture from the device or an https:// URL - or removes the one
 * set before.
 */
export function openImageUrlModal(placeholderId) {
    const overlay = document.getElementById('ereaderImageUrlOverlay');
    const input = document.getElementById('ereaderImageUrlInput');
    if (!overlay || !input) return;
    activePlaceholderId = placeholderId;
    input.value = '';

    const { title, details } = splitImageAlt(open ? placeholderAlt(open.book, placeholderId) : '');
    const altEl = document.getElementById('ereaderImageModalAlt');
    if (altEl) altEl.textContent = title || '';
    const descEl = document.getElementById('ereaderImageModalDesc');
    if (descEl) {
        descEl.textContent = details.join(' · ');
        descEl.style.display = details.length ? '' : 'none';
    }
    const idEl = document.getElementById('ereaderImageModalId');
    if (idEl) idEl.textContent = shortPlaceholderId(placeholderId);

    const fileEntry = open ? (peekBookImages(open.book.id) || {})[placeholderId] : null;
    const linkedUrl = open ? (findImageLine(open.book, placeholderId)?.url || '') : '';
    const entry = fileEntry || (linkedUrl ? { kind: 'url', url: linkedUrl } : null);
    const preview = document.getElementById('ereaderImagePreview');
    const previewImg = document.getElementById('ereaderImagePreviewImg');
    if (preview && previewImg) {
        preview.style.display = entry ? '' : 'none';
        if (entry) previewImg.src = imageSrc(entry);
        else previewImg.removeAttribute('src');
    }
    if (entry && entry.kind === 'url') input.value = entry.url;
    const removeBtn = document.getElementById('ereaderImageRemoveBtn');
    if (removeBtn) removeBtn.style.display = entry ? '' : 'none';

    overlay.classList.add('active');
    if (!entry) input.focus();
}

export function closeImageUrlModal() {
    const overlay = document.getElementById('ereaderImageUrlOverlay');
    if (overlay) overlay.classList.remove('active');
    activePlaceholderId = null;
    const fileInput = document.getElementById('ereaderImageFileInput');
    if (fileInput) fileInput.value = '';
}

/** Biggest edge a picture from the device is stored at; larger ones are
 *  scaled down so a book's pictures stay a few MB, not a few hundred. */
const IMAGE_MAX_EDGE = 2000;
const IMAGE_MAX_BYTES = 15 * 1024 * 1024;

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || ''));
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(file);
    });
}

/** A data: URL for the picture, scaled down when it is large. Falls back to
 *  the file as it is wherever the canvas route is not available. */
async function imageFileToDataUrl(file) {
    const original = await readFileAsDataUrl(file);
    if (typeof document === 'undefined' || typeof Image === 'undefined') return original;
    try {
        const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = reject;
            el.src = original;
        });
        const edge = Math.max(img.naturalWidth, img.naturalHeight);
        if (!edge || (edge <= IMAGE_MAX_EDGE && file.size <= 1.5 * 1024 * 1024)) return original;
        const scale = Math.min(1, IMAGE_MAX_EDGE / edge);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return original;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const scaled = canvas.toDataURL('image/webp', 0.86);
        return scaled.startsWith('data:image/webp') && scaled.length < original.length ? scaled : original;
    } catch (_) {
        return original;
    }
}

/** Redraws the mounted chapters after a picture changed, keeping the reader
 *  on the section they were reading. */
function redrawAfterImageChange(anchorId, anchorDelta) {
    if (!open) return;
    remountAllMounted();
    if (anchorId) scrollToSection(anchorId, anchorDelta);
    capturePosition(anchorId);
}

function readingAnchorNow() {
    const anchorId = bookViewActive ? currentSectionId() : null;
    const anchorEl = anchorId ? sectionEls().find(s => s.dataset.sectionId === anchorId) : null;
    return { anchorId, anchorDelta: anchorEl ? anchorEl.getBoundingClientRect().top : undefined };
}

export async function saveImageUrlFromModal() {
    const imgInput = document.getElementById('ereaderImageUrlInput');
    if (!imgInput) return;
    const url = imgInput.value.trim().replace(/[()]/g, c => (c === '(' ? '%28' : '%29'));
    if (!/^https:\/\/[^\s"'<>]+$/i.test(url)) {
        showAlert(t('ereader_invalid_image_url'), t('warning_title'));
        return;
    }
    const placeholderId = activePlaceholderId;
    const { anchorId, anchorDelta } = readingAnchorNow();
    closeImageUrlModal();
    if (!open || !placeholderId) return;
    /* A link is text: into the book it goes (synced, shared with it), and a
       picture from the device that stood in for it until now gives way. */
    await removeBookImage(open.book.id, placeholderId);
    await writeImageUrl(placeholderId, url);
    showToast(t('ereader_image_saved'));
    redrawAfterImageChange(anchorId, anchorDelta);
}

export async function saveImageFileFromModal(file) {
    if (!file) return;
    if (!/^image\//i.test(file.type || '') || /svg/i.test(file.type || '')) {
        showAlert(t('ereader_image_invalid_file'), t('warning_title'));
        return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
        showAlert(t('ereader_image_too_large'), t('warning_title'));
        return;
    }
    const placeholderId = activePlaceholderId;
    const { anchorId, anchorDelta } = readingAnchorNow();
    if (!open || !placeholderId) {
        closeImageUrlModal();
        return;
    }
    const bookId = open.book.id;
    let data;
    try {
        data = await imageFileToDataUrl(file);
    } catch (_) {
        data = '';
    }
    closeImageUrlModal();
    const saved = data ? await setBookImage(bookId, placeholderId, { data, name: file.name || '' }) : null;
    if (!saved) {
        showAlert(t('ereader_image_invalid_file'), t('warning_title'));
        return;
    }
    /* A device picture stays on the device; a link it replaces leaves the text. */
    await writeImageUrl(placeholderId, '');
    showToast(t('ereader_image_saved'));
    redrawAfterImageChange(anchorId, anchorDelta);
}

export async function removeImageFromModal() {
    const placeholderId = activePlaceholderId;
    const { anchorId, anchorDelta } = readingAnchorNow();
    closeImageUrlModal();
    if (!open || !placeholderId) return;
    await removeBookImage(open.book.id, placeholderId);
    await writeImageUrl(placeholderId, '');
    showToast(t('ereader_image_removed'));
    redrawAfterImageChange(anchorId, anchorDelta);
}

/** One-time wiring of the static controls and page-level listeners. */
export function bindEreaderReader({ switchView, closeMenu } = {}) {
    deps = { switchView, closeMenu };
    if (bound) return;
    bound = true;

    updateFontUI();

    const fontSizeBtn = document.getElementById('ereaderFontSizeBtn');
    if (fontSizeBtn) fontSizeBtn.onclick = () => cycleFontSizeTier();

    const settingsBtn = document.getElementById('ereaderSettingsBtn');
    if (settingsBtn) settingsBtn.onclick = () => openSettingsOverlay();

    const settingsCloseBtn = document.getElementById('ereaderSettingsCloseBtn');
    if (settingsCloseBtn) settingsCloseBtn.onclick = () => closeSettingsOverlay();

    const settingsOverlay = document.getElementById('ereaderSettingsOverlay');
    if (settingsOverlay) {
        settingsOverlay.addEventListener('click', (e) => {
            if (e.target === settingsOverlay) closeSettingsOverlay();
        });
    }

    const shareBtn = document.getElementById('ereaderShareBookBtn');
    if (shareBtn) shareBtn.onclick = () => shareOpenBook();

    const translateBtn = document.getElementById('ereaderTranslateSettingsBtn');
    if (translateBtn) translateBtn.onclick = () => openTranslateSettings();
    const translateCloseBtn = document.getElementById('ereaderTranslateCloseBtn');
    if (translateCloseBtn) translateCloseBtn.onclick = () => closeTranslateSettings();
    const translateOverlay = document.getElementById('ereaderTranslateOverlay');
    if (translateOverlay) {
        translateOverlay.addEventListener('click', (e) => {
            if (e.target === translateOverlay) closeTranslateSettings();
        });
    }
    const translateToggle = document.getElementById('ereaderTranslateShowToggle');
    if (translateToggle) translateToggle.onchange = (e) => setTranslateIconsShown(e.target.checked);
    const translateSourceSel = document.getElementById('ereaderTranslateSourceSelect');
    if (translateSourceSel) translateSourceSel.onchange = (e) => setOpenBookTranslation({ source: e.target.value });
    const translateTargetSel = document.getElementById('ereaderTranslateTargetSelect');
    if (translateTargetSel) translateTargetSel.onchange = (e) => setOpenBookTranslation({ target: e.target.value });

    const ttsBtn = document.getElementById('ereaderTtsSettingsBtn');
    if (ttsBtn) ttsBtn.onclick = () => openTtsSettings();
    const ttsCloseBtn = document.getElementById('ereaderTtsCloseBtn');
    if (ttsCloseBtn) ttsCloseBtn.onclick = () => closeTtsSettings();
    const ttsOverlay = document.getElementById('ereaderTtsOverlay');
    if (ttsOverlay) {
        ttsOverlay.addEventListener('click', (e) => {
            if (e.target === ttsOverlay) closeTtsSettings();
        });
    }
    const ttsToggle = document.getElementById('ereaderTtsShowToggle');
    if (ttsToggle) ttsToggle.onchange = (e) => setTtsShown(e.target.checked);
    const ttsLangSel = document.getElementById('ereaderTtsLangSelect');
    if (ttsLangSel) ttsLangSel.onchange = (e) => setOpenBookTts({ lang: e.target.value });
    const ttsSpeed = document.getElementById('ereaderTtsSpeed');
    if (ttsSpeed) {
        ttsSpeed.oninput = (e) => updateTtsSpeedTooltip(parseFloat(e.target.value));
        ttsSpeed.onchange = (e) => setOpenBookTts({ speed: parseFloat(e.target.value) });
    }
    const ttsAutoplay = document.getElementById('ereaderTtsAutoplayToggle');
    if (ttsAutoplay) ttsAutoplay.onchange = (e) => setOpenBookTts({ autoplay: e.target.checked });

    const tocExpandBtn = document.getElementById('ereaderTocExpandAllBtn');
    if (tocExpandBtn) tocExpandBtn.onclick = () => tocExpandAll();

    const tocCollapseBtn = document.getElementById('ereaderTocCollapseAllBtn');
    if (tocCollapseBtn) tocCollapseBtn.onclick = () => tocCollapseToTop();

    const bookmarkBtn = document.getElementById('ereaderBookmarkBtn');
    if (bookmarkBtn) bookmarkBtn.onclick = () => bookmarkCurrentPosition();

    const bookmarkPrevBtn = document.getElementById('ereaderBookmarkPrevBtn');
    if (bookmarkPrevBtn) bookmarkPrevBtn.onclick = () => stepBookmark(-1);

    const bookmarkNextBtn = document.getElementById('ereaderBookmarkNextBtn');
    if (bookmarkNextBtn) bookmarkNextBtn.onclick = () => stepBookmark(1);

    const bookmarkCurrentBtn = document.getElementById('ereaderBookmarkCurrentBtn');
    if (bookmarkCurrentBtn) bookmarkCurrentBtn.onclick = () => goToCurrentBookmark();

    const bookmarkDetailsBtn = document.getElementById('ereaderBookmarkDetailsBtn');
    if (bookmarkDetailsBtn) bookmarkDetailsBtn.onclick = () => openBookmarkDetailModal();

    const bookmarkCancelBtn = document.getElementById('ereaderBookmarkCancelBtn');
    if (bookmarkCancelBtn) bookmarkCancelBtn.onclick = () => closeBookmarkModal();

    const bookmarkSaveBtn = document.getElementById('ereaderBookmarkSaveBtn');
    if (bookmarkSaveBtn) bookmarkSaveBtn.onclick = () => saveBookmarkFromModal();

    const bookmarkOverlay = document.getElementById('ereaderBookmarkOverlay');
    if (bookmarkOverlay) {
        bookmarkOverlay.addEventListener('click', (e) => {
            if (e.target === bookmarkOverlay) closeBookmarkModal();
        });
    }

    const bookmarkDetailEditBtn = document.getElementById('ereaderBookmarkDetailEditBtn');
    if (bookmarkDetailEditBtn) bookmarkDetailEditBtn.onclick = () => editBookmarkFromDetail();

    const bookmarkDetailDeleteBtn = document.getElementById('ereaderBookmarkDetailDeleteBtn');
    if (bookmarkDetailDeleteBtn) bookmarkDetailDeleteBtn.onclick = () => deleteBookmarkFromDetail();

    const bookmarkDetailCloseBtn = document.getElementById('ereaderBookmarkDetailCloseBtn');
    if (bookmarkDetailCloseBtn) bookmarkDetailCloseBtn.onclick = () => closeBookmarkDetailModal();

    const bookmarkDetailOverlay = document.getElementById('ereaderBookmarkDetailOverlay');
    if (bookmarkDetailOverlay) {
        bookmarkDetailOverlay.addEventListener('click', (e) => {
            if (e.target === bookmarkDetailOverlay) closeBookmarkDetailModal();
        });
    }

    const selectionBtn = document.getElementById('ereaderSelectionBookmarkBtn');
    if (selectionBtn) selectionBtn.onclick = () => bookmarkFromSelection();

    if (typeof document !== 'undefined') {
        document.addEventListener('selectionchange', () => updateSelectionPopover());
    }

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
        searchInput.addEventListener('focus', () => setSearchResultsHidden(false));
    }

    const searchClearBtn = document.getElementById('ereaderSearchClearBtn');
    if (searchClearBtn) searchClearBtn.onclick = () => clearSearch();

    /* A tap anywhere outside the field folds the result list away (the term
       and its highlights stay) so it never sits over the page being read. */
    if (typeof document !== 'undefined') {
        document.addEventListener('click', (e) => {
            if (!isSearchBarOpen()) return;
            if (e.target.closest && e.target.closest('#ereaderSearchBar, #ereaderSearchBtn')) return;
            setSearchResultsHidden(true);
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

    const scrollTopBtn = document.getElementById('ereaderScrollTopBtn');
    if (scrollTopBtn) {
        scrollTopBtn.onclick = () => scrollToTop();
    }

    const content = document.getElementById('ereaderContent');
    if (content) {
        content.addEventListener('click', (e) => {
            const marker = e.target.closest('.ereader-bookmark-marker');
            if (marker && marker.dataset.bookmarkId) {
                openBookmarkDetailModal(marker.dataset.bookmarkId);
                return;
            }
            const foldHeading = e.target.closest('.ereader-fold-heading');
            if (foldHeading && !e.target.closest('a, button')) {
                /* Selecting a heading's text (to bookmark or copy it) ends in a
                   click too - only a plain tap folds. */
                const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
                if (!sel || sel.isCollapsed) {
                    toggleBodyFold(foldHeading.closest('.ereader-section')?.dataset.sectionId);
                }
                return;
            }
            const editImage = e.target.closest('.ereader-figure-edit-btn');
            if (editImage && editImage.dataset.placeholderId) {
                openImageUrlModal(editImage.dataset.placeholderId);
                return;
            }
            const placeholder = e.target.closest('.md-image-placeholder');
            if (placeholder && placeholder.dataset.placeholderId) {
                openImageUrlModal(placeholder.dataset.placeholderId);
            }
        });
        content.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const placeholder = e.target.closest && e.target.closest('.md-image-placeholder[data-placeholder-id]');
            if (!placeholder) return;
            e.preventDefault();
            openImageUrlModal(placeholder.dataset.placeholderId);
        });
    }

    const imgSaveBtn = document.getElementById('ereaderImageUrlSaveBtn');
    const imgCancelBtn = document.getElementById('ereaderImageUrlCancelBtn');
    const imgInput = document.getElementById('ereaderImageUrlInput');
    const imgOverlay = document.getElementById('ereaderImageUrlOverlay');

    if (imgSaveBtn) imgSaveBtn.onclick = () => saveImageUrlFromModal();
    if (imgInput) {
        imgInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveImageUrlFromModal();
        });
    }
    const imgUploadBtn = document.getElementById('ereaderImageUploadBtn');
    const imgFileInput = document.getElementById('ereaderImageFileInput');
    if (imgUploadBtn && imgFileInput) imgUploadBtn.onclick = () => imgFileInput.click();
    if (imgFileInput) {
        imgFileInput.addEventListener('change', () => {
            const file = imgFileInput.files && imgFileInput.files[0];
            if (file) saveImageFileFromModal(file);
        });
    }
    const imgRemoveBtn = document.getElementById('ereaderImageRemoveBtn');
    if (imgRemoveBtn) imgRemoveBtn.onclick = () => removeImageFromModal();

    if (imgCancelBtn) imgCancelBtn.onclick = closeImageUrlModal;
    if (imgOverlay) {
        imgOverlay.addEventListener('click', (e) => {
            if (e.target === imgOverlay) closeImageUrlModal();
        });
    }

    /* The ribbons are measured against the text; when it reflows they follow. */
    const contentForMarkers = document.getElementById('ereaderContent');
    if (contentForMarkers && typeof ResizeObserver === 'function') {
        new ResizeObserver(() => scheduleMarkerRelayout()).observe(contentForMarkers);
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('resize', () => scheduleMarkerRelayout(), { passive: true });
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (isTranslateSettingsOpen()) {
                    closeTranslateSettings();
                } else if (isTtsSettingsOpen()) {
                    closeTtsSettings();
                } else if (isSettingsOverlayOpen()) {
                    closeSettingsOverlay();
                } else if (isBookmarkModalOpen()) {
                    closeBookmarkModal();
                } else if (isBookmarkDetailModalOpen()) {
                    closeBookmarkDetailModal();
                } else if (isSearchBarOpen()) {
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
    isFullscreen = false;
    tocCollapsed = new Set();
    bodyFolded = new Set();
    bookmarkIndex = 0;
    closeImageUrlModal();
    closeSettingsOverlay();
    closeTranslateSettings();
    closeTtsSettings();
    closeBookmarkModal();
    hideSelectionPopover();
}
