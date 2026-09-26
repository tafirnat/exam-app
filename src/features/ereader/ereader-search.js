import { plainText } from '../../core/markdown.js';
import { buildChapters, chapterOfSection } from './ereader-chapters.js';

/**
 * The book's language as a locale toLocaleLowerCase() accepts. The language
 * comes from an AI-written file ("en_US", "Türkçe"), and an invalid tag makes
 * toLocaleLowerCase throw, so anything that is not one falls back to 'und'.
 *
 * @param {unknown} language
 * @returns {string}
 */
export function searchLocale(language) {
    if (typeof language !== 'string' || !language.trim()) return 'und';
    try {
        return Intl.getCanonicalLocales(language.trim().replace(/_/g, '-'))[0] || 'und';
    } catch {
        return 'und';
    }
}

/**
 * Searches a book for a term across all sections.
 *
 * Pure function: runs in Node without DOM globals.
 * Matches on section title and plain text.
 * Requires at least 2 characters.
 * Case conversion uses the book's language locale (Turkish İ/ı handled correctly).
 *
 * @param {object} book Validated e-Reader book object
 * @param {string} term Search term
 * @param {object} [options]
 * @param {number} [options.limit=50] Maximum number of results to return
 * @returns {Array<{ sectionId: string, chapterIndex: number, title: string, snippet: string }>}
 */
export function searchBook(book, term, { limit = 50 } = {}) {
    if (!book || !Array.isArray(book.sections) || !term || typeof term !== 'string') {
        return [];
    }

    const query = term.trim();
    if (query.length < 2) {
        return [];
    }

    const lang = searchLocale(book.language || book.ereader?.language);
    const normQuery = query.toLocaleLowerCase(lang);
    const chapters = buildChapters(book.sections);
    const results = [];

    for (const section of book.sections) {
        if (!section || !section.id) continue;
        const rawTitle = section.title || '';
        const rawText = section.text || '';
        const text = plainText(rawText);

        const normTitle = rawTitle.toLocaleLowerCase(lang);
        const normText = text.toLocaleLowerCase(lang);

        const matchInTitle = normTitle.includes(normQuery);
        const textMatchIdx = normText.indexOf(normQuery);
        const matchInText = textMatchIdx !== -1;

        if (matchInTitle || matchInText) {
            const chapter = chapterOfSection(chapters, section.id);
            const chapterIndex = chapter ? chapter.index : 0;

            let snippet = '';
            if (matchInText) {
                const start = Math.max(0, textMatchIdx - 40);
                const end = Math.min(text.length, textMatchIdx + query.length + 60);
                let rawSnippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
                if (start > 0) rawSnippet = '...' + rawSnippet;
                if (end < text.length) rawSnippet = rawSnippet + '...';
                snippet = rawSnippet;
            } else {
                const rawSnippet = text.slice(0, 100).replace(/\s+/g, ' ').trim();
                snippet = text.length > 100 ? rawSnippet + '...' : rawSnippet;
            }

            results.push({
                sectionId: section.id,
                chapterIndex,
                title: rawTitle.trim(),
                snippet
            });

            if (results.length >= limit) break;
        }
    }

    return results;
}
