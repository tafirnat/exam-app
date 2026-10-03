/**
 * E-Reader data store: in-memory cache, async IndexedDB persistence,
 * and slice mutation announcements.
 */

import { persistAsync, persistRemoveAsync, readJSONAsync } from '../../core/storage.js';
import { emit, Slice } from '../../core/store.js';
import { AppState } from '../../core/state.js';
import { deleteBookImages } from './ereader-images.js';

const INDEX_KEY = 'focus_app_ereader_index';
const BOOK_PREFIX = 'focus_app_ereader_book_';
const PROGRESS_KEY = 'focus_app_ereader_progress';
const TOMBSTONES_KEY = 'focus_app_ereader_tombstones';
const PREFS_KEY = 'focus_app_ereader_prefs';
const BOOKMARKS_KEY = 'focus_app_ereader_bookmarks';

let loaded = false;
let loadPromise = null;
let bookIndex = [];
const bookCache = new Map();
let progressMap = {};
let tombstonesMap = {};
let prefsData = { fontScale: 1, lastBookId: null };
/** { [bookId]: Array<{ id, sectionId, title, note, createdAt }> } */
let bookmarksMap = {};
let changeListener = null;

function notifyChange(action, payload) {
    if (typeof changeListener === 'function') {
        try {
            changeListener(action, payload);
        } catch (err) {
            console.error('[ereader-store] Change listener failed:', err);
        }
    }
}

function createSummary(book) {
    const sectionCount = Array.isArray(book.sections) ? book.sections.length : 0;
    const textLength = Array.isArray(book.sections)
        ? book.sections.reduce((sum, s) => sum + (typeof s.text === 'string' ? s.text.length : 0), 0)
        : 0;

    return {
        id: book.id,
        bookKey: book.bookKey || '',
        title: book.title || '',
        author: book.author || '',
        language: book.language || 'und',
        sourceType: book.sourceType || 'other',
        parts: Array.isArray(book.parts) ? [...book.parts] : [],
        archived: book.archived === true,
        sectionCount,
        textLength,
        createdAt: book.createdAt || Date.now(),
        updatedAt: book.updatedAt || Date.now()
    };
}

/**
 * Loads index, progress, tombstones, and preferences from persistent storage.
 * Idempotent.
 *
 * @returns {Promise<void>}
 */
export async function loadEreader() {
    if (loaded) return;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        const [idx, prog, tombs, prefs, bookmarks] = await Promise.all([
            readJSONAsync(INDEX_KEY, []),
            readJSONAsync(PROGRESS_KEY, {}),
            readJSONAsync(TOMBSTONES_KEY, {}),
            readJSONAsync(PREFS_KEY, { fontScale: 1, lastBookId: null }),
            readJSONAsync(BOOKMARKS_KEY, {})
        ]);

        bookIndex = Array.isArray(idx) ? idx : [];
        progressMap = prog && typeof prog === 'object' && !Array.isArray(prog) ? prog : {};
        tombstonesMap = tombs && typeof tombs === 'object' && !Array.isArray(tombs) ? tombs : {};
        prefsData = prefs && typeof prefs === 'object' && !Array.isArray(prefs)
            ? { ...prefs, fontScale: prefs.fontScale ?? 1, lastBookId: prefs.lastBookId ?? null }
            : { fontScale: 1, lastBookId: null };
        bookmarksMap = bookmarks && typeof bookmarks === 'object' && !Array.isArray(bookmarks) ? bookmarks : {};

        loaded = true;
    })();

    try {
        await loadPromise;
    } finally {
        loadPromise = null;
    }
}

export function isEreaderLoaded() {
    return loaded;
}

/**
 * Lists summaries of all non-deleted books.
 *
 * @returns {Array<object>}
 */
export function listBooks() {
    return bookIndex.filter(b => !tombstonesMap[b.id]).map(b => ({ ...b }));
}

/**
 * Gets a full book record by ID.
 * Body is lazily loaded from storage and cached in memory.
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getBook(id) {
    if (!id || tombstonesMap[id]) return null;
    if (!loaded) await loadEreader();

    if (bookCache.has(id)) {
        return bookCache.get(id);
    }

    const book = await readJSONAsync(BOOK_PREFIX + id, null);
    if (book && typeof book === 'object') {
        bookCache.set(id, book);
        return book;
    }

    return null;
}

/**
 * Adds a new book. Generates an ID if not present, saves book record and index,
 * and emits EREADER_LIBRARY.
 *
 * @param {object} book
 * @param {{fromSync?: boolean}} [options]
 * @returns {Promise<object|null>}
 */
export async function addBook(book, { fromSync = false } = {}) {
    if (!book || typeof book !== 'object') throw new Error('addBook: invalid book object');
    if (!loaded) await loadEreader();

    if (!book.id) {
        book.id = typeof crypto !== 'undefined' && crypto.randomUUID
            ? 'book_' + crypto.randomUUID()
            : 'book_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    }

    if (tombstonesMap[book.id]) {
        return null;
    }

    const now = Date.now();
    book.createdAt = book.createdAt || now;
    book.updatedAt = now;

    bookCache.set(book.id, book);

    const summary = createSummary(book);
    const existingIdx = bookIndex.findIndex(b => b.id === book.id);
    if (existingIdx >= 0) {
        bookIndex[existingIdx] = summary;
    } else {
        bookIndex.push(summary);
    }

    await persistAsync(BOOK_PREFIX + book.id, book);
    await persistAsync(INDEX_KEY, bookIndex);

    emit(Slice.EREADER_LIBRARY);
    if (!fromSync) notifyChange('addBook', book.id);
    return book;
}

/**
 * Replaces a book while preserving its updatedAt timestamp (used for sync).
 *
 * @param {object} book
 * @param {{fromSync?: boolean}} [options]
 * @returns {Promise<object|null>}
 */
export async function replaceBook(book, { fromSync = false } = {}) {
    if (!book || !book.id) throw new Error('replaceBook: book must have an id');
    if (!loaded) await loadEreader();

    if (tombstonesMap[book.id]) {
        return null;
    }

    bookCache.set(book.id, book);

    const summary = createSummary(book);
    const existingIdx = bookIndex.findIndex(b => b.id === book.id);
    if (existingIdx >= 0) {
        bookIndex[existingIdx] = summary;
    } else {
        bookIndex.push(summary);
    }

    await persistAsync(BOOK_PREFIX + book.id, book);
    await persistAsync(INDEX_KEY, bookIndex);

    emit(Slice.EREADER_LIBRARY);
    if (!fromSync) notifyChange('replaceBook', book.id);
    return book;
}

/**
 * Mutates a book, updates updatedAt to Date.now(), and emits EREADER_LIBRARY.
 *
 * @param {string} id
 * @param {(book: object) => void} mutate
 * @param {{fromSync?: boolean}} [options]
 * @returns {Promise<object|null>}
 */
export async function updateBook(id, mutate, { fromSync = false } = {}) {
    if (!loaded) await loadEreader();
    const book = await getBook(id);
    if (!book) return null;

    mutate(book);
    book.updatedAt = Date.now();

    const summary = createSummary(book);
    const existingIdx = bookIndex.findIndex(b => b.id === id);
    if (existingIdx >= 0) {
        bookIndex[existingIdx] = summary;
    }

    await persistAsync(BOOK_PREFIX + id, book);
    await persistAsync(INDEX_KEY, bookIndex);

    emit(Slice.EREADER_LIBRARY);
    if (!fromSync) notifyChange('updateBook', id);
    return book;
}

/**
 * Removes a book from index, deletes its storage record, writes a tombstone,
 * and emits EREADER_LIBRARY.
 *
 * @param {string} id
 * @param {{fromSync?: boolean}} [options]
 * @returns {Promise<void>}
 */
export async function deleteBook(id, { fromSync = false, tombstoneAt = null } = {}) {
    if (!loaded) await loadEreader();

    bookIndex = bookIndex.filter(b => b.id !== id);
    bookCache.delete(id);
    tombstonesMap[id] = Math.max(tombstonesMap[id] || 0, (fromSync && typeof tombstoneAt === 'number') ? tombstoneAt : Date.now());

    const hadBookmarks = Array.isArray(bookmarksMap[id]) && bookmarksMap[id].length > 0;
    delete bookmarksMap[id];

    await persistRemoveAsync(BOOK_PREFIX + id);
    await persistAsync(INDEX_KEY, bookIndex);
    await persistAsync(TOMBSTONES_KEY, tombstonesMap);
    if (hadBookmarks) await persistAsync(BOOKMARKS_KEY, bookmarksMap);
    /* The pictures the reader added live on this device only, keyed by book. */
    await deleteBookImages(id);
    /* So is the language pair the reader picked for it. */
    let prefsChanged = false;
    const pairs = prefsData.translation && prefsData.translation.books;
    if (pairs && pairs[id]) {
        const { [id]: _gone, ...rest } = pairs;
        prefsData = { ...prefsData, translation: { ...prefsData.translation, books: rest } };
        prefsChanged = true;
    }
    /* And the language it is read aloud in. */
    const voices = prefsData.tts && prefsData.tts.books;
    if (voices && voices[id]) {
        const { [id]: _gone, ...rest } = voices;
        prefsData = { ...prefsData, tts: { ...prefsData.tts, books: rest } };
        prefsChanged = true;
    }
    if (prefsChanged) await persistAsync(PREFS_KEY, prefsData);

    emit(Slice.EREADER_LIBRARY);
    if (hadBookmarks) emit(Slice.EREADER_BOOKMARKS);
    if (!fromSync) notifyChange('deleteBook', id);
}

/**
 * Gets the current reading progress for a book, or all progress records if id is omitted.
 *
 * @param {string} [id]
 * @returns {object|null}
 */
export function getProgress(id) {
    if (!id) return { ...progressMap };
    return progressMap[id] ? { ...progressMap[id] } : null;
}

/**
 * Updates reading progress for a book and emits EREADER_PROGRESS.
 *
 * @param {string} id
 * @param {{sectionId?: string|null, offset?: number, percent?: number, at?: number, by?: string}} pos
 * @param {{fromSync?: boolean}} [options]
 * @returns {Promise<object>}
 */
export async function setProgress(id, { sectionId, offset, percent, at, by } = {}, { fromSync = false } = {}) {
    if (!loaded) await loadEreader();

    const entry = {
        sectionId: sectionId ?? null,
        offset: typeof offset === 'number' ? offset : 0,
        percent: typeof percent === 'number' ? percent : 0,
        at: (fromSync && typeof at === 'number') ? at : Date.now(),
        by: (fromSync && by) ? by : (AppState?.deviceId || 'unknown')
    };

    progressMap[id] = entry;
    await persistAsync(PROGRESS_KEY, progressMap);

    emit(Slice.EREADER_PROGRESS);
    if (!fromSync) notifyChange('setProgress', id);
    return entry;
}

/**
 * Gets user e-Reader preferences.
 *
 * @returns {object}
 */
export function getPrefs() {
    return { ...prefsData };
}

/**
 * Updates user e-Reader preferences and emits EREADER_LIBRARY: the library
 * marks the last opened book and the reader draws at the chosen font scale,
 * so a preference change is a change to what those screens show. Device-only,
 * so the sync listener is not told.
 *
 * @param {object} patch
 * @returns {Promise<object>}
 */
export async function setPrefs(patch) {
    if (!loaded) await loadEreader();

    prefsData = { ...prefsData, ...patch };
    await persistAsync(PREFS_KEY, prefsData);
    emit(Slice.EREADER_LIBRARY);
    return { ...prefsData };
}

/**
 * The language pair a book is translated with: the one picked for it, else the
 * reader's last pick for any book, else null (the caller supplies a default).
 * Lives in the device-only prefs - never in the book, never synced or shared,
 * since every reader of a shared book picks their own.
 *
 * @param {string} bookId
 * @returns {{source: string, target: string}|null}
 */
export function getBookTranslation(bookId) {
    const tr = prefsData.translation || {};
    const pair = (bookId && tr.books && tr.books[bookId]) || tr.last || null;
    return pair ? { ...pair } : null;
}

/**
 * Saves a book's language pair, which also becomes the default for books the
 * reader has not picked one for yet.
 *
 * @param {string} bookId
 * @param {{source?: string, target: string}} pair
 * @returns {Promise<object>}
 */
export async function setBookTranslation(bookId, pair) {
    const tr = prefsData.translation || {};
    const clean = { source: pair.source || 'auto', target: pair.target };
    return setPrefs({
        translation: { ...tr, last: clean, books: { ...(tr.books || {}), [bookId]: clean } }
    });
}

/** Read-aloud defaults: off, normal speed (x1.0), no autoplay. */
const TTS_DEFAULTS = Object.freeze({ enabled: false, speed: 0.5, autoplay: false });

/**
 * The device-wide read-aloud settings: the switch, speed and autoplay.
 *
 * @returns {{enabled: boolean, speed: number, autoplay: boolean}}
 */
export function getTtsPrefs() {
    const tts = prefsData.tts || {};
    return {
        enabled: typeof tts.enabled === 'boolean' ? tts.enabled : TTS_DEFAULTS.enabled,
        speed: typeof tts.speed === 'number' ? tts.speed : TTS_DEFAULTS.speed,
        autoplay: typeof tts.autoplay === 'boolean' ? tts.autoplay : TTS_DEFAULTS.autoplay
    };
}

/**
 * Updates the read-aloud settings (any of enabled, speed, autoplay).
 *
 * @param {{enabled?: boolean, speed?: number, autoplay?: boolean}} patch
 * @returns {Promise<object>}
 */
export async function setTtsPrefs(patch) {
    return setPrefs({ tts: { ...(prefsData.tts || {}), ...patch } });
}

/**
 * The language a book is read aloud in: the one picked for it, else the
 * reader's last pick for any book, else null (the caller supplies a default).
 * Device-only, like the translation pair.
 *
 * @param {string} bookId
 * @returns {string|null}
 */
export function getBookTtsLang(bookId) {
    const tts = prefsData.tts || {};
    return (bookId && tts.books && tts.books[bookId]) || tts.last || null;
}

/**
 * Saves a book's read-aloud language, which also becomes the default for
 * books the reader has not picked one for yet.
 *
 * @param {string} bookId
 * @param {string} lang
 * @returns {Promise<object>}
 */
export async function setBookTtsLang(bookId, lang) {
    const tts = prefsData.tts || {};
    return setPrefs({ tts: { ...tts, last: lang, books: { ...(tts.books || {}), [bookId]: lang } } });
}

/**
 * Lists a book's bookmarks, unsorted (reading-order numbering is a display
 * concern - it depends on the book's own section order, not stored here).
 *
 * @param {string} id
 * @returns {Array<{id: string, sectionId: string, title: string, note: string, createdAt: number}>}
 */
export function getBookmarks(id) {
    const list = bookmarksMap[id];
    return Array.isArray(list) ? list.map(b => ({ ...b })) : [];
}

/**
 * Adds a bookmark to a book and emits Slice.EREADER_BOOKMARKS.
 *
 * @param {string} id book id
 * @param {{sectionId: string, title?: string, note?: string, anchor?: {offset: number, quote: string}}} bookmark
 * @returns {Promise<object>} the saved bookmark, with its id and createdAt
 */
/**
 * Each bookmark's display number: the order it was added in, fixed for good -
 * a later bookmark placed higher up the page gets the next number rather than
 * renumbering the ones already there. Bookmarks saved before numbers existed
 * (no `seq`) are numbered by their creation time.
 *
 * @param {Array<{id: string, seq?: number, createdAt?: number}>} bookmarks
 * @returns {Map<string, number>} bookmark id -> number
 */
export function bookmarkNumbers(bookmarks) {
    const numbers = new Map();
    const legacy = (bookmarks || [])
        .filter(b => !Number.isInteger(b.seq))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    legacy.forEach((b, i) => numbers.set(b.id, i + 1));
    for (const b of bookmarks || []) {
        if (Number.isInteger(b.seq)) numbers.set(b.id, b.seq);
    }
    return numbers;
}

function nextBookmarkSeq(bookmarks) {
    let max = 0;
    for (const n of bookmarkNumbers(bookmarks).values()) max = Math.max(max, n);
    return max + 1;
}

/** A bookmark's spot inside its section: { offset, quote } (see the reader's
 *  resolveAnchor). Anything else is dropped - the section is enough. */
function cleanAnchor(anchor) {
    if (!anchor || typeof anchor !== 'object') return null;
    const offset = Number.isInteger(anchor.offset) && anchor.offset >= 0 ? anchor.offset : null;
    const quote = typeof anchor.quote === 'string' ? anchor.quote.slice(0, 80) : '';
    if (offset === null || !quote) return null;
    /* How many characters the selection spanned - the passage to highlight. */
    const length = Number.isInteger(anchor.length) && anchor.length > 0 ? Math.min(anchor.length, 2000) : 0;
    return length ? { offset, quote, length } : { offset, quote };
}

export async function addBookmark(id, { sectionId, title = '', note = '', anchor = null } = {}) {
    if (!loaded) await loadEreader();
    if (!sectionId) throw new Error('addBookmark: sectionId is required');

    const entry = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID
            ? 'bm_' + crypto.randomUUID()
            : 'bm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
        sectionId,
        title: title.trim(),
        note: note.trim(),
        seq: nextBookmarkSeq(bookmarksMap[id] || []),
        createdAt: Date.now()
    };
    const spot = cleanAnchor(anchor);
    if (spot) entry.anchor = spot;

    bookmarksMap[id] = [...(bookmarksMap[id] || []), entry];
    await persistAsync(BOOKMARKS_KEY, bookmarksMap);

    emit(Slice.EREADER_BOOKMARKS);
    return { ...entry };
}

/**
 * Updates a bookmark's title/note in place (its sectionId and createdAt are
 * untouched) and emits Slice.EREADER_BOOKMARKS.
 *
 * @param {string} id book id
 * @param {string} bookmarkId
 * @param {{title?: string, note?: string}} patch
 * @returns {Promise<object|null>} the updated bookmark, or null if not found
 */
export async function updateBookmark(id, bookmarkId, { title, note } = {}) {
    if (!loaded) await loadEreader();
    const list = bookmarksMap[id];
    if (!Array.isArray(list)) return null;

    let updated = null;
    const next = list.map(b => {
        if (b.id !== bookmarkId) return b;
        updated = {
            ...b,
            title: title !== undefined ? title.trim() : b.title,
            note: note !== undefined ? note.trim() : b.note
        };
        return updated;
    });
    if (!updated) return null;
    bookmarksMap[id] = next;

    await persistAsync(BOOKMARKS_KEY, bookmarksMap);
    emit(Slice.EREADER_BOOKMARKS);
    return { ...updated };
}

/**
 * Removes one bookmark from a book and emits Slice.EREADER_BOOKMARKS.
 *
 * @param {string} id book id
 * @param {string} bookmarkId
 * @returns {Promise<void>}
 */
export async function deleteBookmark(id, bookmarkId) {
    if (!loaded) await loadEreader();
    const list = bookmarksMap[id];
    if (!Array.isArray(list)) return;

    const next = list.filter(b => b.id !== bookmarkId);
    if (next.length === list.length) return;
    bookmarksMap[id] = next;

    await persistAsync(BOOKMARKS_KEY, bookmarksMap);
    emit(Slice.EREADER_BOOKMARKS);
}

/**
 * Resets reading progress for all books, writing stamped empty progress records
 * so remote sync does not revive stale positions. Emits EREADER_PROGRESS.
 *
 * @returns {Promise<void>}
 */
export async function resetAllProgress() {
    if (!loaded) await loadEreader();

    const now = Date.now();
    const by = AppState?.deviceId || 'unknown';
    const allBookIds = new Set([...bookIndex.map(b => b.id), ...Object.keys(progressMap)]);

    for (const id of allBookIds) {
        progressMap[id] = {
            sectionId: null,
            offset: 0,
            percent: 0,
            at: now,
            by
        };
    }

    await persistAsync(PROGRESS_KEY, progressMap);
    emit(Slice.EREADER_PROGRESS);
    notifyChange('resetAllProgress');
}

/**
 * Deletes all books by calling deleteBook on each one.
 *
 * @returns {Promise<void>}
 */
export async function deleteAllBooks() {
    if (!loaded) await loadEreader();

    const ids = bookIndex.map(b => b.id);
    for (const id of ids) {
        await deleteBook(id);
    }
}

/**
 * Returns a copy of the current tombstones map.
 *
 * @returns {Record<string, number>}
 */
export function getTombstones() {
    return { ...tombstonesMap };
}

/**
 * Registers a change listener for sync integration (F6).
 * Called on every mutation where fromSync is not true.
 *
 * @param {(action: string, payload?: unknown) => void} fn
 */
export function setEreaderChangeListener(fn) {
    changeListener = fn;
}

/**
 * Test seam: resets all in-memory store state.
 */
export function _resetEreaderStoreForTests() {
    loaded = false;
    loadPromise = null;
    bookIndex = [];
    bookCache.clear();
    progressMap = {};
    tombstonesMap = {};
    prefsData = { fontScale: 1, lastBookId: null };
    bookmarksMap = {};
    changeListener = null;
}
