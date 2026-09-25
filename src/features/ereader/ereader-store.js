/**
 * E-Reader data store: in-memory cache, async IndexedDB persistence,
 * and slice mutation announcements.
 */

import { persistAsync, persistRemoveAsync, readJSONAsync } from '../../core/storage.js';
import { emit, Slice } from '../../core/store.js';
import { AppState } from '../../core/state.js';

const INDEX_KEY = 'focus_app_ereader_index';
const BOOK_PREFIX = 'focus_app_ereader_book_';
const PROGRESS_KEY = 'focus_app_ereader_progress';
const TOMBSTONES_KEY = 'focus_app_ereader_tombstones';
const PREFS_KEY = 'focus_app_ereader_prefs';

let loaded = false;
let loadPromise = null;
let bookIndex = [];
const bookCache = new Map();
let progressMap = {};
let tombstonesMap = {};
let prefsData = { fontScale: 1, lastBookId: null };
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
        const [idx, prog, tombs, prefs] = await Promise.all([
            readJSONAsync(INDEX_KEY, []),
            readJSONAsync(PROGRESS_KEY, {}),
            readJSONAsync(TOMBSTONES_KEY, {}),
            readJSONAsync(PREFS_KEY, { fontScale: 1, lastBookId: null })
        ]);

        bookIndex = Array.isArray(idx) ? idx : [];
        progressMap = prog && typeof prog === 'object' && !Array.isArray(prog) ? prog : {};
        tombstonesMap = tombs && typeof tombs === 'object' && !Array.isArray(tombs) ? tombs : {};
        prefsData = prefs && typeof prefs === 'object' && !Array.isArray(prefs)
            ? { fontScale: prefs.fontScale ?? 1, lastBookId: prefs.lastBookId ?? null }
            : { fontScale: 1, lastBookId: null };

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

    await persistRemoveAsync(BOOK_PREFIX + id);
    await persistAsync(INDEX_KEY, bookIndex);
    await persistAsync(TOMBSTONES_KEY, tombstonesMap);

    emit(Slice.EREADER_LIBRARY);
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
    changeListener = null;
}
