/**
 * e-Reader GitHub Gist Sync
 *
 * Implements archive-file-pattern sync for e-Reader library, books, and progress.
 * Independent of the test centre sync.
 *
 * Files in Gist:
 * - exam_app_ereader_index.json (index, progress, tombstones)
 * - exam_app_ereader_<bookId>.json (full book record per book)
 */

import {
    loadEreader, listBooks, getBook, replaceBook, deleteBook,
    getProgress, setProgress, getTombstones, setEreaderChangeListener
} from './ereader-store.js';
import { validateEreaderFile, validateSyncedBook } from './ereader-schema.js';
import { isEreaderView } from './ereader-shell.js';

async function getSyncApi() {
    if (typeof window === 'undefined') {
        return {
            canUseRemoteArchive: () => false,
            fetchGist: async () => ({ files: {} }),
            readGistJSON: async () => null,
            patchGistFiles: async () => true
        };
    }
    return import('../../core/github-sync.js');
}

export const INDEX_FILENAME = 'exam_app_ereader_index.json';
export const PULL_INTERVAL_MS = 30000;
export const PUSH_DEBOUNCE_MS = 3000;

export function bookFilename(id) {
    return `exam_app_ereader_${id}.json`;
}

let lastPullTime = 0;
let pushTimer = null;
let initialized = false;
let currentViewGetter = () => null;

function bookContainsDataImage(book) {
    if (!book || !Array.isArray(book.sections)) return false;
    const mdImgRe = /!\[[^\]]*\]\(([^)\s]+)\)/g;
    const htmlImgRe = /<img\b[^>]*?\bsrc=["']?([^"'\s>]+)/gi;
    for (const s of book.sections) {
        if (typeof s.text !== 'string') continue;
        for (const m of s.text.matchAll(mdImgRe)) {
            if (/^data:image/i.test(m[1].trim())) return true;
        }
        for (const m of s.text.matchAll(htmlImgRe)) {
            if (/^data:image/i.test(m[1].trim())) return true;
        }
    }
    return false;
}

/**
 * Pure function to merge local and remote e-Reader indices.
 *
 * @param {object} local
 * @param {object} remote
 * @returns {{ schema: number, books: object[], progress: object, tombstones: Record<string, number> }}
 */
export function mergeEreaderIndex(local, remote) {
    const loc = local && typeof local === 'object' ? local : {};
    const rem = remote && typeof remote === 'object' ? remote : {};

    // 1. Tombstones: union, largest timestamp per id
    const mergedTombstones = { ...(loc.tombstones || {}) };
    for (const [id, stamp] of Object.entries(rem.tombstones || {})) {
        mergedTombstones[id] = Math.max(mergedTombstones[id] || 0, stamp || 0);
    }

    // 2. Book summaries: drop any with a tombstone; for remainder, highest updatedAt wins
    const locBooks = Array.isArray(loc.books) ? loc.books : [];
    const remBooks = Array.isArray(rem.books) ? rem.books : [];
    const booksById = new Map();

    for (const b of locBooks) {
        if (!b || !b.id || mergedTombstones[b.id]) continue;
        booksById.set(b.id, { ...b });
    }

    for (const b of remBooks) {
        if (!b || !b.id || mergedTombstones[b.id]) continue;
        const existing = booksById.get(b.id);
        if (!existing || (b.updatedAt || 0) > (existing.updatedAt || 0)) {
            booksById.set(b.id, { ...b });
        }
    }

    const mergedBooks = Array.from(booksById.values());

    // 3. Progress: highest 'at' wins; drop tombstoned books
    const mergedProgress = {};
    const locProg = loc.progress && typeof loc.progress === 'object' ? loc.progress : {};
    const remProg = rem.progress && typeof rem.progress === 'object' ? rem.progress : {};
    const allProgIds = new Set([...Object.keys(locProg), ...Object.keys(remProg)]);

    for (const id of allProgIds) {
        if (mergedTombstones[id]) continue;
        const pLoc = locProg[id];
        const pRem = remProg[id];
        if (pLoc && pRem) {
            mergedProgress[id] = (pRem.at || 0) > (pLoc.at || 0) ? { ...pRem } : { ...pLoc };
        } else if (pRem) {
            mergedProgress[id] = { ...pRem };
        } else if (pLoc) {
            mergedProgress[id] = { ...pLoc };
        }
    }

    return {
        schema: 1,
        books: mergedBooks,
        progress: mergedProgress,
        tombstones: mergedTombstones
    };
}

/**
 * Pulls latest e-Reader data from GitHub Gist.
 *
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<boolean>} true if pull succeeded, false otherwise
 */
export async function pullEreader({ force = false } = {}) {
    const { canUseRemoteArchive, fetchGist, readGistJSON } = await getSyncApi();
    if (!canUseRemoteArchive()) return false;

    const now = Date.now();
    if (!force && (now - lastPullTime < PULL_INTERVAL_MS)) {
        return false;
    }
    lastPullTime = now;

    try {
        const gist = await fetchGist();
        const remoteIndex = await readGistJSON(gist, INDEX_FILENAME);
        if (!remoteIndex || typeof remoteIndex !== 'object') {
            return false;
        }

        await loadEreader();
        const localBooks = listBooks();
        const localProgress = getProgress() || {};
        const localTombstones = getTombstones() || {};

        const localIndex = {
            schema: 1,
            books: localBooks,
            progress: localProgress,
            tombstones: localTombstones
        };

        const merged = mergeEreaderIndex(localIndex, remoteIndex);

        // Delete local books that are tombstoned
        for (const localBook of localBooks) {
            if (merged.tombstones[localBook.id]) {
                await deleteBook(localBook.id, {
                    fromSync: true,
                    tombstoneAt: merged.tombstones[localBook.id]
                });
            }
        }

        // Add or update books from remote that are newer or absent locally
        for (const summary of merged.books) {
            const localBook = localBooks.find(b => b.id === summary.id);
            if (!localBook || (summary.updatedAt || 0) > (localBook.updatedAt || 0)) {
                const fname = bookFilename(summary.id);
                const remoteBookJson = await readGistJSON(gist, fname);
                if (remoteBookJson && typeof remoteBookJson === 'object') {
                    let valid = false;
                    let bookData = null;
                    if (remoteBookJson.ereader) {
                        const validation = validateEreaderFile(remoteBookJson);
                        if (validation.ok && validation.book) {
                            valid = true;
                            bookData = validation.book;
                        }
                    } else {
                        const validation = validateSyncedBook(remoteBookJson);
                        if (validation.ok && validation.book) {
                            valid = true;
                            bookData = validation.book;
                        }
                    }

                    if (!valid || !bookData) {
                        console.warn('Skipping invalid synced book:', summary.id);
                        continue;
                    }

                    const bookToStore = { ...bookData, id: summary.id, updatedAt: summary.updatedAt };
                    await replaceBook(bookToStore, { fromSync: true });
                }
            }
        }

        // Apply progress updates
        for (const [id, prog] of Object.entries(merged.progress)) {
            const currentProg = localProgress[id];
            if (!currentProg || (prog.at || 0) > (currentProg.at || 0)) {
                await setProgress(id, prog, { fromSync: true });
            }
        }

        return true;
    } catch (err) {
        console.warn('e-Reader pull failed:', err);
        return false;
    }
}

/**
 * Pushes changed e-Reader books and index to GitHub Gist.
 * No blind push: fetches remote index first, merges, then PATCHes.
 *
 * @returns {Promise<boolean>}
 */
export async function pushEreader() {
    clearTimeout(pushTimer);
    pushTimer = null;

    const { canUseRemoteArchive, fetchGist, readGistJSON, patchGistFiles } = await getSyncApi();
    if (!canUseRemoteArchive()) return false;

    try {
        await loadEreader();
        const localBooks = listBooks();
        const localProgress = getProgress() || {};
        const localTombstones = getTombstones() || {};

        const gist = await fetchGist();
        const remoteIndex = await readGistJSON(gist, INDEX_FILENAME);

        const localIndex = {
            schema: 1,
            books: localBooks,
            progress: localProgress,
            tombstones: localTombstones
        };

        const merged = mergeEreaderIndex(localIndex, remoteIndex);

        const filesToPatch = {};

        const skippedBookIds = new Set();
        // Books to push: local updatedAt > remote summary updatedAt (or absent remotely)
        for (const book of localBooks) {
            const remoteSummary = remoteIndex?.books?.find(b => b.id === book.id);
            if (!remoteSummary || (book.updatedAt || 0) > (remoteSummary.updatedAt || 0)) {
                const fullBook = await getBook(book.id);
                if (fullBook) {
                    // K4 Guard: check actual image URLs for data:image
                    if (bookContainsDataImage(fullBook)) {
                        console.error('K4 guard: e-Reader book contains data:image, skipping push:', book.id);
                        skippedBookIds.add(book.id);
                        continue;
                    }
                    filesToPatch[bookFilename(book.id)] = { content: JSON.stringify(fullBook) };
                }
            }
        }

        // Leave skipped book's index entry in its remote state
        for (const skippedId of skippedBookIds) {
            const remoteSummary = remoteIndex?.books?.find(b => b.id === skippedId);
            const idx = merged.books.findIndex(b => b.id === skippedId);
            if (remoteSummary) {
                if (idx !== -1) {
                    merged.books[idx] = { ...remoteSummary };
                } else {
                    merged.books.push({ ...remoteSummary });
                }
            } else if (idx !== -1) {
                merged.books.splice(idx, 1);
            }
        }

        filesToPatch[INDEX_FILENAME] = { content: JSON.stringify(merged) };

        // Tombstones: delete remote file if still in gist
        if (gist?.files) {
            for (const tombId of Object.keys(merged.tombstones)) {
                const fname = bookFilename(tombId);
                if (gist.files[fname]) {
                    filesToPatch[fname] = null;
                }
            }
        }

        await patchGistFiles(filesToPatch);
        return true;
    } catch (err) {
        console.warn('e-Reader push failed:', err);
        return false;
    }
}

/**
 * Schedules a debounced push (3s delay).
 */
export function scheduleEreaderPush(delayMs = PUSH_DEBOUNCE_MS) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
        pushEreader();
    }, delayMs);
}

/**
 * Initializes e-Reader sync hooks and event listeners.
 *
 * @param {{ getCurrentView?: () => string }} [options]
 */
export function initEreaderSync({ getCurrentView = () => null } = {}) {
    if (initialized) return;
    initialized = true;
    currentViewGetter = getCurrentView;

    setEreaderChangeListener(() => {
        scheduleEreaderPush();
    });

    const pullIfActive = () => {
        const view = currentViewGetter();
        if (isEreaderView(view)) {
            pullEreader().catch(err => console.warn('e-Reader background pull failed:', err));
        }
    };

    if (typeof window !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') pullIfActive();
        });
        window.addEventListener('focus', pullIfActive);
        window.addEventListener('pageshow', pullIfActive);
    }
}

/** Test seam. */
export function _resetEreaderSyncForTests() {
    lastPullTime = 0;
    clearTimeout(pushTimer);
    pushTimer = null;
    initialized = false;
    currentViewGetter = () => null;
}
