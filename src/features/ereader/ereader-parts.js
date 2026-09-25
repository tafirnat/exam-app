/**
 * e-Reader multipart book merging, gap detection, and prompt generation.
 * Pure module - DOM-free, state-free.
 */

import { EREADER_AI_PROMPT } from './ereader-prompt.js';

/**
 * Checks whether two books or parts can be merged.
 * Must share bookKey, language, and part unit.
 *
 * @param {object} bookA
 * @param {object} bookB
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canMergeParts(bookA, bookB) {
    if (!bookA || !bookB) {
        return { ok: false, reason: 'ereader_warn_diff_lang_or_unit' };
    }
    if (!bookA.bookKey || !bookB.bookKey || bookA.bookKey !== bookB.bookKey) {
        return { ok: false, reason: 'ereader_warn_diff_lang_or_unit' };
    }
    if ((bookA.language || '') !== (bookB.language || '')) {
        return { ok: false, reason: 'ereader_warn_diff_lang_or_unit' };
    }
    const unitA = (bookA.parts && bookA.parts[0]?.unit) || 'section';
    const unitB = (bookB.parts && bookB.parts[0]?.unit) || 'section';
    if (unitA !== unitB) {
        return { ok: false, reason: 'ereader_warn_diff_lang_or_unit' };
    }
    return { ok: true };
}

/**
 * Checks whether any part ranges between two parts arrays overlap.
 *
 * @param {Array<{from: number, to: number}>} partsA
 * @param {Array<{from: number, to: number}>} partsB
 * @returns {boolean}
 */
export function doPartsOverlap(partsA, partsB) {
    if (!Array.isArray(partsA) || !Array.isArray(partsB)) return false;
    for (const a of partsA) {
        for (const b of partsB) {
            if (Number.isInteger(a.from) && Number.isInteger(a.to) &&
                Number.isInteger(b.from) && Number.isInteger(b.to)) {
                if (Math.max(a.from, b.from) <= Math.min(a.to, b.to)) {
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * Detects missing ranges (gaps) between sorted parts.
 *
 * @param {Array<{from: number, to: number, unit?: string}>} parts
 * @returns {Array<{from: number, to: number, unit: string}>}
 */
export function detectGaps(parts) {
    if (!Array.isArray(parts) || parts.length === 0) return [];
    const sorted = [...parts].sort((a, b) => a.from - b.from);
    const gaps = [];
    if (sorted[0].from > 1) {
        gaps.push({
            from: 1,
            to: sorted[0].from - 1,
            unit: sorted[0].unit || 'page'
        });
    }
    let maxTo = sorted[0].to;
    for (let i = 1; i < sorted.length; i++) {
        const next = sorted[i];
        if (next.from > maxTo + 1) {
            gaps.push({
                from: maxTo + 1,
                to: next.from - 1,
                unit: next.unit || sorted[0].unit || 'page'
            });
        }
        if (next.to > maxTo) {
            maxTo = next.to;
        }
    }
    return gaps;
}

/**
 * Checks whether a new part has character density significantly below (< 50%)
 * the median density of the existing parts.
 *
 * @param {object} newPartBook
 * @param {object} existingBook
 * @returns {{ lowDensity: boolean, warning?: string, densityNew?: number, median?: number }}
 */
export function checkDensity(newPartBook, existingBook) {
    if (!newPartBook || !existingBook) return { lowDensity: false };
    const newPart = newPartBook.parts?.[0];
    if (!newPart || !Array.isArray(newPartBook.sections)) return { lowDensity: false };

    const newUnits = Math.max(1, (newPart.to - newPart.from + 1));
    const newChars = newPartBook.sections.reduce((sum, s) => sum + (s.text ? s.text.length : 0), 0);
    const densityNew = newChars / newUnits;

    const existingParts = existingBook.parts || [];
    if (existingParts.length === 0) return { lowDensity: false };

    // Calculate densities for existing book parts
    const densities = [];
    if (existingParts.length === 1) {
        const p = existingParts[0];
        const units = Math.max(1, (p.to - p.from + 1));
        const chars = (existingBook.sections || []).reduce((sum, s) => sum + (s.text ? s.text.length : 0), 0);
        densities.push(chars / units);
    } else {
        // Group sections by partFrom if present, or partition proportionally
        for (const p of existingParts) {
            const units = Math.max(1, (p.to - p.from + 1));
            const partSections = (existingBook.sections || []).filter(s =>
                s.partFrom !== undefined ? s.partFrom === p.from : true
            );
            const chars = partSections.reduce((sum, s) => sum + (s.text ? s.text.length : 0), 0);
            densities.push(chars / units);
        }
    }

    densities.sort((a, b) => a - b);
    const median = densities[Math.floor(densities.length / 2)];

    if (median > 0 && densityNew < 0.5 * median) {
        return {
            lowDensity: true,
            warning: 'ereader_warn_low_density',
            densityNew,
            median
        };
    }

    return { lowDensity: false, densityNew, median };
}

/**
 * Normalizes title for section matching.
 *
 * @param {string} title
 * @returns {string}
 */
function normalizeTitle(title) {
    return (title || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Merges a new part book into a target book.
 * - Validates compatibility (language, unit, bookKey).
 * - Orders sections by part.from (not import order).
 * - Deduplicates colliding sections (page_start + normalized title).
 * - Rewrites colliding section IDs.
 * - Updates book.parts and book.updatedAt.
 *
 * @param {object} targetBook
 * @param {object} newPartBook
 * @returns {object} merged book record
 */
export function mergeBookParts(targetBook, newPartBook) {
    const check = canMergeParts(targetBook, newPartBook);
    if (!check.ok) {
        throw new Error(check.reason || 'ereader_warn_diff_lang_or_unit');
    }

    // Ensure all sections are tagged with partFrom and distinguish incoming sections
    const targetSections = (targetBook.sections || []).map(s => ({
        ...s,
        partFrom: s.partFrom !== undefined ? s.partFrom : (targetBook.parts?.[0]?.from ?? 1),
        _isIncoming: false
    }));

    const newSections = (newPartBook.sections || []).map(s => ({
        ...s,
        partFrom: s.partFrom !== undefined ? s.partFrom : (newPartBook.parts?.[0]?.from ?? 1),
        _isIncoming: true
    }));

    // Combine parts
    const combinedParts = [...(targetBook.parts || []), ...(newPartBook.parts || [])];
    combinedParts.sort((a, b) => a.from - b.from);

    // Combine sections sorted by partFrom ascending
    const allSections = [...targetSections, ...newSections];
    allSections.sort((a, b) => (a.partFrom || 0) - (b.partFrom || 0));

    // Deduplicate colliding sections: page_start + normalized title + content
    const seenSectionKeys = new Set();
    const deduplicatedSections = [];

    for (const section of allSections) {
        const normTitle = normalizeTitle(section.title);
        const normText = (section.text || '').trim();
        let key = null;
        if (section.pageStart !== undefined && section.pageStart !== null) {
            key = `${section.pageStart}:${normTitle}:${normText}`;
        } else {
            key = `content:${normTitle}:${normText}`;
        }

        if (seenSectionKeys.has(key)) {
            continue; // duplicate section; drop
        }
        seenSectionKeys.add(key);
        deduplicatedSections.push({ ...section });
    }

    // Renumber placeholder:img-<n> in new/incoming sections to prevent collision with targetBook
    let maxImg = 0;
    const imgRe = /placeholder:img-(\d+)/g;
    for (const s of targetSections) {
        if (typeof s.text === 'string') {
            for (const m of s.text.matchAll(imgRe)) {
                const n = parseInt(m[1], 10);
                if (n > maxImg) maxImg = n;
            }
        }
    }

    if (maxImg > 0) {
        const placeholderMap = new Map();
        for (const s of deduplicatedSections) {
            if (s._isIncoming && typeof s.text === 'string') {
                s.text = s.text.replace(/placeholder:img-(\d+)/g, (fullMatch) => {
                    if (!placeholderMap.has(fullMatch)) {
                        maxImg++;
                        placeholderMap.set(fullMatch, `placeholder:img-${maxImg}`);
                    }
                    return placeholderMap.get(fullMatch);
                });
            }
            delete s._isIncoming;
        }
    } else {
        for (const s of deduplicatedSections) {
            delete s._isIncoming;
        }
    }

    // Rewrite colliding section IDs
    const usedIds = new Set();
    const idCounts = new Map();

    for (const section of deduplicatedSections) {
        let baseId = section.id || 's-1';
        if (!usedIds.has(baseId)) {
            usedIds.add(baseId);
            idCounts.set(baseId, 1);
        } else {
            let count = (idCounts.get(baseId) || 1) + 1;
            idCounts.set(baseId, count);
            let candidate = `${baseId}-${count}`;
            while (usedIds.has(candidate)) {
                count++;
                candidate = `${baseId}-${count}`;
                idCounts.set(baseId, count);
            }
            section.id = candidate;
            usedIds.add(candidate);
        }
    }

    return {
        ...targetBook,
        parts: combinedParts,
        sections: deduplicatedSections,
        updatedAt: Date.now()
    };
}

/**
 * Returns true if the book has missing ranges (internal gaps or tail missing).
 *
 * @param {object} book
 * @returns {boolean}
 */
export function hasMissingRanges(book) {
    if (!book || !Array.isArray(book.parts) || book.parts.length === 0) return false;
    if (detectGaps(book.parts).length > 0) return true;
    const minFrom = Math.min(...book.parts.map(p => p.from || 1));
    if (minFrom > 1) return true;
    const maxTo = Math.max(...book.parts.map(p => p.to || 0));
    const total = Math.max(...book.parts.map(p => p.total || p.to || 0));
    return maxTo < total;
}

/**
 * Gets the starting unit number for the next missing part.
 *
 * @param {object} book
 * @returns {number}
 */
export function getNextFrom(book) {
    if (!book || !Array.isArray(book.parts) || book.parts.length === 0) return 1;
    const gaps = detectGaps(book.parts);
    if (gaps.length > 0) {
        return gaps[0].from;
    }
    const minFrom = Math.min(...book.parts.map(p => p.from || 1));
    if (minFrom > 1) return 1;
    const maxTo = Math.max(...book.parts.map(p => p.to || 0));
    return maxTo + 1;
}

/**
 * Generates the AI transcription prompt for the next part of a book.
 *
 * @param {object} book
 * @returns {string}
 */
export function generateNextPartPrompt(book) {
    if (!book) return EREADER_AI_PROMPT;
    const unit = (book.parts && book.parts[0]?.unit) || 'page';
    const nextFrom = getNextFrom(book);
    const total = Math.max(...(book.parts || []).map(p => p.total || p.to || 0));

    let prompt = EREADER_AI_PROMPT;

    // Substitute schema sample values
    prompt = prompt.replace(/"book_key":\s*"[^"]*"/, () => `"book_key": ${JSON.stringify(book.bookKey || '')}`);
    prompt = prompt.replace(/"title":\s*"[^"]*"/, () => `"title": ${JSON.stringify(book.title || '')}`);
    if (book.author) {
        prompt = prompt.replace(/"author":\s*"[^"]*"/, () => `"author": ${JSON.stringify(book.author)}`);
    }
    prompt = prompt.replace(/"language":\s*"[^"]*"/, () => `"language": ${JSON.stringify(book.language || 'und')}`);
    prompt = prompt.replace(/"unit":\s*"[^"]*"/, () => `"unit": ${JSON.stringify(unit)}`);
    prompt = prompt.replace(/"from":\s*\d+/, () => `"from": ${nextFrom}`);
    if (total > 0) {
        prompt = prompt.replace(/"total":\s*\d+/, () => `"total": ${total}`);
    }

    const header = [
        `> **Target Book**: ${book.title} (Key: \`${book.bookKey}\`)`,
        `> **Next Range**: ${unit} ${nextFrom} of ${total || '?'} (Language: \`${book.language}\`)`,
        '',
        '---',
        ''
    ].join('\n');

    return `${header}\n${prompt}`;
}
