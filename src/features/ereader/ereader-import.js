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
import { listBooks, getBook, addBook, replaceBook } from './ereader-store.js';
import { canMergeParts, doPartsOverlap, mergeBookParts, checkDensity } from './ereader-parts.js';

function invalid(errorKey, warnings = []) {
    return { status: 'invalid', book: null, errors: [errorKey], warnings };
}

/**
 * The same file imported twice is the same book: same bookKey and the same
 * part range. A different range of the same book is a different part, and
 * can be merged into the existing book.
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
 * @param {{ confirmMerge?: (title: string) => Promise<boolean> }} options
 * @returns {Promise<{status: string, book: object|null, errors: string[], warnings: string[]}>}
 */
export async function importEreaderJson(json, { confirmMerge } = {}) {
    const result = validateEreaderFile(json);
    if (!result.ok) {
        return { status: 'invalid', book: null, errors: result.errors, warnings: result.warnings };
    }
    if (findDuplicate(result.book)) {
        return { status: 'duplicate', book: result.book, errors: [], warnings: [] };
    }

    // Check if there is an existing book with the same bookKey that can be merged
    const books = listBooks();
    const matching = books.find(b => b.bookKey === result.book.bookKey);
    if (matching) {
        const mergeCheck = canMergeParts(matching, result.book);
        const overlaps = doPartsOverlap(matching.parts || [], result.book.parts || []);
        if (mergeCheck.ok && !overlaps) {
            let shouldMerge = false;
            if (typeof confirmMerge === 'function') {
                shouldMerge = await confirmMerge(matching.title);
            }
            if (shouldMerge) {
                const fullTarget = await getBook(matching.id);
                if (fullTarget) {
                    const density = checkDensity(result.book, fullTarget);
                    const warnings = [...result.warnings];
                    if (density.lowDensity && density.warning) {
                        warnings.push(density.warning);
                    }
                    const merged = mergeBookParts(fullTarget, result.book);
                    await replaceBook(merged);
                    return { status: 'merged', book: merged, errors: [], warnings };
                }
            }
        }
    }

    const saved = await addBook(result.book);
    if (!saved) return invalid('ereader_err_invalid_json', result.warnings);
    return { status: 'added', book: saved, errors: [], warnings: result.warnings };
}

export async function importFromText(text, options = {}) {
    let json;
    try {
        json = JSON.parse(String(text));
    } catch {
        return invalid('ereader_err_invalid_json');
    }
    return importEreaderJson(json, options);
}

/**
 * Each file stands alone: one broken file does not stop the others.
 *
 * @param {Iterable<File>} files
 * @param {object} [options]
 * @returns {Promise<Array<{name: string} & object>>}
 */
export async function importFromFiles(files, options = {}) {
    const results = [];
    for (const file of Array.from(files || [])) {
        let text;
        try {
            text = await file.text();
        } catch {
            results.push({ name: file.name, ...invalid('ereader_err_read_failed') });
            continue;
        }
        results.push({ name: file.name, ...(await importFromText(text, options)) });
    }
    return results;
}

/**
 * The page's CSP decides which hosts can be fetched (connect-src); a blocked
 * host fails here like any other network error.
 */
export async function importFromUrl(url, options = {}) {
    let text;
    try {
        const res = await fetch(url);
        if (!res.ok) return invalid('ereader_err_fetch_failed');
        text = await res.text();
    } catch {
        return invalid('ereader_err_fetch_failed');
    }
    return importFromText(text, options);
}
