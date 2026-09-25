/**
 * E-Reader chapter structure and progress calculations.
 * Pure module - no DOM dependencies, no state mutations.
 */

/**
 * @typedef {Object} Chapter
 * @property {number} index
 * @property {string} title
 * @property {string[]} sectionIds
 * @property {number} textLength
 */

/**
 * Builds chapter groupings from flat sections.
 * The lowest level section (minLevel) starts a new chapter.
 * Any sections preceding the first minLevel section are grouped into chapter 0.
 *
 * @param {Array<{id: string, title?: string, level?: number, text?: string}>} sections
 * @returns {Chapter[]}
 */
export function buildChapters(sections) {
    if (!Array.isArray(sections) || sections.length === 0) return [];

    const minLevel = Math.min(...sections.map(s => (typeof s.level === 'number' ? s.level : 1)));
    const chapters = [];
    let currentChapter = null;

    for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        const textLen = typeof s.text === 'string' ? s.text.length : 0;
        const isMin = s.level === minLevel;

        if (isMin || currentChapter === null) {
            currentChapter = {
                index: chapters.length,
                title: typeof s.title === 'string' ? s.title : '',
                sectionIds: [s.id],
                textLength: textLen
            };
            chapters.push(currentChapter);
        } else {
            currentChapter.sectionIds.push(s.id);
            currentChapter.textLength += textLen;
        }
    }

    return chapters;
}

/**
 * Finds the chapter that contains the given section ID.
 *
 * @param {Chapter[]} chapters
 * @param {string} sectionId
 * @returns {Chapter|null}
 */
export function chapterOfSection(chapters, sectionId) {
    if (!Array.isArray(chapters) || !sectionId) return null;
    for (const ch of chapters) {
        if (ch.sectionIds && ch.sectionIds.includes(sectionId)) {
            return ch;
        }
    }
    return null;
}

/**
 * Calculates weighted reading progress percentage across chapters.
 * (prior text length + offset * current chapter text length) / total text length * 100,
 * rounded to one decimal place.
 *
 * @param {Chapter[]} chapters
 * @param {number} chapterIndex
 * @param {number} [offset=0] 0-1 intra-chapter scroll fraction
 * @returns {number} Percentage between 0 and 100 rounded to 1 decimal place
 */
export function weightedPercent(chapters, chapterIndex, offset = 0) {
    if (!Array.isArray(chapters) || chapters.length === 0) return 0;

    const totalLength = chapters.reduce((sum, ch) => sum + (ch.textLength || 0), 0);
    if (totalLength === 0) return 0;

    const safeOffset = typeof offset === 'number' && !isNaN(offset) ? Math.max(0, Math.min(1, offset)) : 0;
    let priorLength = 0;
    let currentLength = 0;

    for (const ch of chapters) {
        if (ch.index < chapterIndex) {
            priorLength += ch.textLength || 0;
        } else if (ch.index === chapterIndex) {
            currentLength = ch.textLength || 0;
            break;
        }
    }

    const raw = ((priorLength + safeOffset * currentLength) / totalLength) * 100;
    const rounded = Math.round(raw * 10) / 10;
    return Math.max(0, Math.min(100, rounded));
}
