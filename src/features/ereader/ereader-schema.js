/**
 * E-Reader file schema validation and normalization.
 * Pure module - no DOM dependencies, no state mutations.
 */

/**
 * Normalizes text to a clean slug identifier.
 * Matches the character mapping from sources-service.js.
 *
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
    if (!text || typeof text !== 'string') return 'exam';
    const trDeMap = {
        'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'İ': 'i',
        'ö': 'o', 'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u',
        'ä': 'a', 'Ä': 'a', 'ß': 'ss'
    };
    let slug = text.split('').map(char => trDeMap[char] || char).join('');
    slug = slug
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return slug || 'exam';
}

const VALID_SOURCE_TYPES = new Set(['pdf', 'epub', 'obsidian', 'topic']);
const IMAGE_RE = /!\[([^\]]*)\]\((?:data:[^)]+|http:\/\/[^)]+)\)/g;

/**
 * Resolves a unique section ID.
 *
 * @param {string|unknown} rawId
 * @param {number} index
 * @param {Set<string>} usedIds
 * @param {Map<string, number>} idCounts
 * @param {string[]} warnings
 * @returns {string}
 */
function normalizeSectionId(rawId, index, usedIds, idCounts, warnings) {
    let base = typeof rawId === 'string' ? rawId.trim() : '';
    if (!base) {
        base = `s-${index + 1}`;
    }
    if (!usedIds.has(base)) {
        usedIds.add(base);
        idCounts.set(base, 1);
        return base;
    }
    warnings.push('ereader_warn_duplicate_section_id');
    let count = (idCounts.get(base) || 1) + 1;
    idCounts.set(base, count);
    let candidate = `${base}-${count}`;
    while (usedIds.has(candidate)) {
        count++;
        candidate = `${base}-${count}`;
        idCounts.set(base, count);
    }
    usedIds.add(candidate);
    return candidate;
}

/**
 * Validates and normalizes an imported e-Reader JSON document.
 *
 * @param {unknown} json
 * @returns {{ ok: boolean, errors: string[], warnings: string[], book: object | null }}
 */
export function validateEreaderFile(json) {
    const warnings = [];

    if (!json || typeof json !== 'object' || Array.isArray(json)) {
        return { ok: false, errors: ['ereader_err_invalid_json'], warnings: [], book: null };
    }

    const { ereader } = json;
    if (!ereader || typeof ereader !== 'object' || Array.isArray(ereader)) {
        return { ok: false, errors: ['ereader_err_missing_ereader'], warnings: [], book: null };
    }

    if (ereader.schema !== undefined && ereader.schema !== null && ereader.schema !== 1) {
        return { ok: false, errors: ['ereader_err_unsupported_schema'], warnings: [], book: null };
    }

    const title = typeof ereader.title === 'string' ? ereader.title.trim() : '';
    if (!title) {
        return { ok: false, errors: ['ereader_err_missing_title'], warnings: [], book: null };
    }

    const author = typeof ereader.author === 'string' ? ereader.author.trim() : '';

    let language = typeof ereader.language === 'string' ? ereader.language.trim() : '';
    if (!language) {
        warnings.push('ereader_warn_default_language');
        language = 'und';
    }

    let sourceType = typeof ereader.source_type === 'string' ? ereader.source_type.trim().toLowerCase() : '';
    if (!VALID_SOURCE_TYPES.has(sourceType)) {
        warnings.push('ereader_warn_unknown_source_type');
        sourceType = 'other';
    }

    let bookKey = typeof ereader.book_key === 'string' ? ereader.book_key.trim() : '';
    if (!bookKey) {
        bookKey = slugify(`${title} ${author} ${language}`);
    }

    if (!Array.isArray(json.sections) || json.sections.length === 0) {
        return { ok: false, errors: ['ereader_err_no_sections'], warnings, book: null };
    }

    const sections = [];
    const usedIds = new Set();
    const idCounts = new Map();
    let imageCounter = 1;

    for (let i = 0; i < json.sections.length; i++) {
        const s = json.sections[i];
        if (!s || typeof s !== 'object' || Array.isArray(s)) {
            return { ok: false, errors: ['ereader_err_invalid_section'], warnings, book: null };
        }

        if (typeof s.text !== 'string') {
            return { ok: false, errors: ['ereader_err_section_missing_text'], warnings, book: null };
        }

        const id = normalizeSectionId(s.id, i, usedIds, idCounts, warnings);
        const sectionTitle = typeof s.title === 'string' ? s.title : '';

        let level = s.level;
        if (!Number.isInteger(level) || level < 1 || level > 6) {
            warnings.push('ereader_warn_invalid_section_level');
            level = 1;
        }

        // Clean data: and http: image URLs to placeholder:img-<n>
        const cleanedText = s.text.replace(IMAGE_RE, (match, alt) => {
            warnings.push('ereader_warn_image_placeholder');
            const placeholder = `placeholder:img-${imageCounter++}`;
            return `![${alt}](${placeholder})`;
        });

        const normalizedSection = {
            id,
            title: sectionTitle,
            level,
            text: cleanedText
        };

        if (Number.isInteger(s.page_start)) {
            normalizedSection.pageStart = s.page_start;
        }

        sections.push(normalizedSection);
    }

    const N = sections.length;
    const now = Date.now();
    let parts;

    if (!ereader.part || typeof ereader.part !== 'object' || Array.isArray(ereader.part)) {
        parts = [{ unit: 'section', from: 1, to: N, total: N, importedAt: now }];
    } else {
        const rawPart = ereader.part;
        let unit;
        if (rawPart.unit === 'page') {
            unit = 'page';
        } else if (rawPart.unit === 'section') {
            unit = 'section';
        } else {
            warnings.push('ereader_warn_invalid_part_unit');
            unit = 'section';
        }
        const from = Number.isInteger(rawPart.from) ? rawPart.from : 1;
        /* Without a to, the part runs one unit per section from where it starts. */
        const to = Number.isInteger(rawPart.to) ? rawPart.to : from + N - 1;
        /* A reversed or non-positive range would turn gap detection, the
           overlap check and the next-part prompt into nonsense. */
        if (from < 1 || to < from) {
            return { ok: false, errors: ['ereader_err_invalid_part_range'], warnings, book: null };
        }
        const total = Number.isInteger(rawPart.total) ? Math.max(rawPart.total, to) : Math.max(to, N);
        parts = [{ unit, from, to, total, importedAt: now }];
    }

    const book = {
        bookKey,
        title,
        author,
        language,
        sourceType,
        parts,
        sections,
        createdAt: now,
        updatedAt: now
    };

    return { ok: true, errors: [], warnings, book };
}

/**
 * Validates a synced/stored e-Reader book object (the format stored in IndexedDB and pushed to Gist).
 *
 * @param {unknown} book
 * @returns {{ ok: boolean, error?: string, book?: object }}
 */
export function validateSyncedBook(book) {
    if (!book || typeof book !== 'object' || Array.isArray(book)) {
        return { ok: false, error: 'invalid_json' };
    }
    const title = typeof book.title === 'string' ? book.title.trim() : '';
    if (!title) {
        return { ok: false, error: 'missing_title' };
    }
    if (!Array.isArray(book.sections) || book.sections.length === 0) {
        return { ok: false, error: 'no_sections' };
    }
    for (let i = 0; i < book.sections.length; i++) {
        const s = book.sections[i];
        if (!s || typeof s !== 'object' || Array.isArray(s) || typeof s.text !== 'string') {
            return { ok: false, error: 'invalid_section' };
        }
    }
    return { ok: true, book };
}

