/**
 * e-Reader import: file / URL / pasted text → schema → store.
 *
 * No DOM and no messages here. Every entry point returns a result the UI turns
 * into a toast or an alert, so the same rules (validation, the duplicate guard)
 * apply whichever way the JSON arrived.
 *
 * Result: { status: 'added' | 'duplicate' | 'invalid', book, errors, warnings }
 * errors / warnings are i18n keys; the caller translates them.
 */

import { validateEreaderFile } from './ereader-schema.js';
import { listBooks, addBook } from './ereader-store.js';

function invalid(errorKey, warnings = []) {
    return { status: 'invalid', book: null, errors: [errorKey], warnings };
}

/**
 * The same file imported twice is the same book: same bookKey and the same
 * part range. A different range of the same book is a different part, and
 * until part merging (F7) it is kept as its own book.
 */
export function findDuplicate(book, books = listBooks()) {
    const part = Array.isArray(book.parts) ? book.parts[0] : null;
    if (!part) return null;
    return books.find(b => b.bookKey === book.bookKey
        && Array.isArray(b.parts)
        && b.parts.some(p => p.from === part.from && p.to === part.to)) || null;
}

/**
 * @param {unknown} json parsed JSON
 * @returns {Promise<{status: string, book: object|null, errors: string[], warnings: string[]}>}
 */
export async function importEreaderJson(json) {
    const result = validateEreaderFile(json);
    if (!result.ok) {
        return { status: 'invalid', book: null, errors: result.errors, warnings: result.warnings };
    }
    if (findDuplicate(result.book)) {
        return { status: 'duplicate', book: result.book, errors: [], warnings: [] };
    }
    const saved = await addBook(result.book);
    if (!saved) return invalid('ereader_err_invalid_json', result.warnings);
    return { status: 'added', book: saved, errors: [], warnings: result.warnings };
}

export async function importFromText(text) {
    let json;
    try {
        json = JSON.parse(String(text));
    } catch {
        return invalid('ereader_err_invalid_json');
    }
    return importEreaderJson(json);
}

/**
 * Each file stands alone: one broken file does not stop the others.
 *
 * @param {Iterable<File>} files
 * @returns {Promise<Array<{name: string} & object>>}
 */
export async function importFromFiles(files) {
    const results = [];
    for (const file of Array.from(files || [])) {
        let text;
        try {
            text = await file.text();
        } catch {
            results.push({ name: file.name, ...invalid('ereader_err_read_failed') });
            continue;
        }
        results.push({ name: file.name, ...(await importFromText(text)) });
    }
    return results;
}

/**
 * The page's CSP decides which hosts can be fetched (connect-src); a blocked
 * host fails here like any other network error.
 */
export async function importFromUrl(url) {
    let text;
    try {
        const res = await fetch(url);
        if (!res.ok) return invalid('ereader_err_fetch_failed');
        text = await res.text();
    } catch {
        return invalid('ereader_err_fetch_failed');
    }
    return importFromText(text);
}
