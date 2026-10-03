/**
 * e-Reader images: what the reader put in place of a book's image
 * placeholders - a file from their own device or an https:// URL.
 *
 * The book text itself never changes. It keeps `![alt](placeholder:fig-2-1)`
 * (the AI's description of the figure stays readable), and this store maps
 * each placeholder id to the image chosen for it. That keeps the pictures on
 * the reader's own device: they live in IndexedDB under one key per book and
 * are never part of the synced book record. A copy of the book that is
 * downloaded or shared can carry them along as a top-level `images` object
 * (see exportBookImages / importBookImages), which the importer puts back here.
 *
 * Entry shapes:
 *   { kind: 'url',  url: 'https://…', at }
 *   { kind: 'file', data: 'data:image/png;base64,…', name, at }
 */

import { persistAsync, persistRemoveAsync, readJSONAsync } from '../../core/storage.js';

const IMAGES_PREFIX = 'focus_app_ereader_images_';
/** Raster types only: an SVG data URL can carry script. */
const DATA_URL_RE = /^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,[A-Za-z0-9+/=\s]+$/i;
const HTTPS_RE = /^https:\/\/[^\s"'<>]+$/i;

/** bookId -> { [placeholderId]: entry } for every book read so far. */
const cache = new Map();
const pending = new Map();

function sanitizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const at = Number.isFinite(raw.at) ? raw.at : Date.now();
    if (typeof raw.url === 'string' && HTTPS_RE.test(raw.url.trim())) {
        return { kind: 'url', url: raw.url.trim(), at };
    }
    if (typeof raw.data === 'string' && DATA_URL_RE.test(raw.data)) {
        const name = typeof raw.name === 'string' ? raw.name.slice(0, 200) : '';
        return { kind: 'file', data: raw.data.replace(/\s+/g, ''), name, at };
    }
    return null;
}

function sanitizeMap(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [id, value] of Object.entries(raw)) {
        if (!id || id.length > 300) continue;
        const entry = sanitizeEntry(value);
        if (entry) out[id] = entry;
    }
    return out;
}

/** Reads (once) and returns the book's image map. */
export async function loadBookImages(bookId) {
    if (!bookId) return {};
    if (cache.has(bookId)) return cache.get(bookId);
    if (!pending.has(bookId)) {
        pending.set(bookId, (async () => {
            let map = {};
            try {
                map = sanitizeMap(await readJSONAsync(IMAGES_PREFIX + bookId, {}));
            } catch (_) { /* unreadable → no images */ }
            cache.set(bookId, map);
            pending.delete(bookId);
            return map;
        })());
    }
    return pending.get(bookId);
}

/** The book's image map if it has been read already, else null. */
export function peekBookImages(bookId) {
    return cache.has(bookId) ? cache.get(bookId) : null;
}

/** The src an <img> can use for an entry. */
export function imageSrc(entry) {
    if (!entry) return '';
    return entry.kind === 'file' ? entry.data : entry.url;
}

async function writeMap(bookId, map) {
    cache.set(bookId, map);
    if (Object.keys(map).length === 0) await persistRemoveAsync(IMAGES_PREFIX + bookId);
    else await persistAsync(IMAGES_PREFIX + bookId, map);
}

/**
 * @param {string} bookId
 * @param {string} placeholderId the id from the book text, e.g. `placeholder:fig-2-1`
 * @param {{url?: string, data?: string, name?: string}} value
 * @returns {Promise<object|null>} the stored entry, or null when the value is not a usable image
 */
export async function setBookImage(bookId, placeholderId, value) {
    if (!bookId || !placeholderId) return null;
    const entry = sanitizeEntry({ ...value, at: Date.now() });
    if (!entry) return null;
    const map = { ...(await loadBookImages(bookId)), [placeholderId]: entry };
    await writeMap(bookId, map);
    return { ...entry };
}

export async function removeBookImage(bookId, placeholderId) {
    const current = await loadBookImages(bookId);
    if (!current[placeholderId]) return;
    const map = { ...current };
    delete map[placeholderId];
    await writeMap(bookId, map);
}

/** Drops every image of a book (the book was deleted). */
export async function deleteBookImages(bookId) {
    if (!bookId) return;
    cache.delete(bookId);
    pending.delete(bookId);
    await persistRemoveAsync(IMAGES_PREFIX + bookId);
}

/** How many placeholders of the book have an image. */
export async function countBookImages(bookId) {
    return Object.keys(await loadBookImages(bookId)).length;
}

/**
 * The `images` object an exported book carries:
 * { [placeholderId]: { url } | { data, name } }.
 */
export async function exportBookImages(bookId) {
    const out = {};
    for (const [id, entry] of Object.entries(await loadBookImages(bookId))) {
        out[id] = entry.kind === 'file' ? { data: entry.data, name: entry.name || '' } : { url: entry.url };
    }
    return out;
}

/**
 * Takes an imported file's `images` object and stores what is valid of it,
 * leaving images the reader already set for other placeholders alone.
 *
 * @returns {Promise<number>} how many images were stored
 */
export async function importBookImages(bookId, raw) {
    const incoming = sanitizeMap(raw);
    const ids = Object.keys(incoming);
    if (!bookId || ids.length === 0) return 0;
    await writeMap(bookId, { ...(await loadBookImages(bookId)), ...incoming });
    return ids.length;
}

/** Test seam. */
export function _resetEreaderImagesForTests() {
    cache.clear();
    pending.clear();
}
