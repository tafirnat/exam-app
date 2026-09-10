/* ==========================================================================
   TTS TEXT CLEANER & SPEECH NORMALIZER
   ---------------------------------------------------------------------------
   Converts raw question text, Markdown, HTML, and cloze syntax into natural,
   fluid, speech-ready text for Text-to-Speech (TTS) engines.
   ========================================================================== */

/**
 * Common HTML entities and their spoken replacements.
 */
const ENTITY_MAP = {
    '&nbsp;': ' ',
    '&quot;': '"',
    '&apos;': "'",
    '&#39;': "'",
    '&#039;': "'",
    '&lt;': '<',
    '&gt;': '>',
    '&ndash;': '-',
    '&mdash;': ', ',
    '&hellip;': '...',
    '&cent;': 'cent',
    '&pound;': 'pound',
    '&yen;': 'yen',
    '&euro;': 'euro',
    '&copy;': '',
    '&reg;': '',
    '&trade;': ''
};

/**
 * Decodes standard and numeric HTML entities into spoken-friendly text.
 * @param {string} text
 * @param {string} lang
 * @returns {string}
 */
export function decodeHtmlEntities(text, lang = 'tr') {
    if (!text || typeof text !== 'string') return '';

    // Handle ampersand specifically based on language
    const andWord = lang === 'de' ? 'und' : (lang === 'en' ? 'and' : 've');
    let decoded = text.replace(/&amp;/gi, ` ${andWord} `);

    // Named entities
    for (const [entity, replacement] of Object.entries(ENTITY_MAP)) {
        decoded = decoded.split(entity).join(replacement);
    }

    // Decimal numeric entities: &#123;
    decoded = decoded.replace(/&#(\d+);/g, (_, dec) => {
        try {
            return String.fromCharCode(parseInt(dec, 10));
        } catch {
            return '';
        }
    });

    // Hex numeric entities: &#x1f;
    decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
        try {
            return String.fromCharCode(parseInt(hex, 16));
        } catch {
            return '';
        }
    });

    return decoded;
}

/**
 * Resolves cloze / fill-in-the-blank markers in text for TTS playback.
 * - If revealAnswers is false (e.g. during an active test), replaces gaps with
 *   a natural pause ellipsis '...' so the question can be listened to without spoiling answers.
 * - If revealAnswers is true (e.g. review, feedback, flashcard back), substitutes
 *   the canonical answer so the full sentence is spoken naturally.
 *
 * Supports both Exam App format {{answer}} / {{ans1|ans2}} and Anki format {{c1::answer::hint}}.
 * @param {string} text
 * @param {boolean} revealAnswers
 * @returns {string}
 */
export function processClozeForSpeech(text, revealAnswers = false) {
    if (!text || typeof text !== 'string') return '';

    return text.replace(/\{\{([^{}]+)\}\}/g, (_, inner) => {
        if (!revealAnswers) {
            return ' \uE000 ';
        }

        // Parse answer candidate
        let content = inner.trim();

        // Anki cloze syntax: c1::answer::hint or c1::answer
        if (/^c\d+::/i.test(content)) {
            content = content.replace(/^c\d+::/i, '');
            // Drop hint if present
            const parts = content.split('::');
            content = parts[0] || '';
        }

        // Exam App alternatives: ans1|ans2
        if (content.includes('|')) {
            content = content.split('|')[0] || '';
        }

        return ` ${content.trim()} `;
    });
}

/**
 * Transforms Markdown and HTML formatting into clean, natural speech-ready text.
 *
 * @param {string} rawText The input text containing Markdown or HTML.
 * @param {Object} [options={}] Configuration options.
 * @param {string} [options.lang='tr'] Language code ('tr', 'en', 'de') for entity translations.
 * @param {boolean} [options.revealAnswers=false] Whether to speak cloze answers or pause for blanks.
 * @param {number} [options.maxChars=1500] Maximum character length to guard against TTS URL overflow.
 * @returns {string} Clean, normalized text suitable for TTS engines.
 */
export function cleanTextForSpeech(rawText, options = {}) {
    if (!rawText || typeof rawText !== 'string') return '';

    const {
        lang = 'tr',
        revealAnswers = false,
        maxChars = 1500
    } = options;

    let text = rawText;

    // 1. Strip YAML frontmatter
    text = text.replace(/^---[\s\S]*?---\n?/m, '');

    // 2. Strip HTML comments & invisible tags (script, style)
    text = text.replace(/<!--[\s\S]*?-->/g, ' ');
    text = text.replace(/<(script|style|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ');

    // 3. Cloze handling (must precede general bracket stripping)
    text = processClozeForSpeech(text, revealAnswers);

    // 4. Strip images (both Markdown ![alt](url) and Obsidian ![[image.png]])
    text = text.replace(/!\[\[[^\]]+\]\]/g, ' ');
    text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, ' ');

    // 5. Links and Wikilinks: keep display text, discard URLs/targets
    // Obsidian wikilinks: [[Target|Alias]] -> Alias, [[Target]] -> Target
    text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias || target);
    // Standard markdown links: [Display Text](url) -> Display Text
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    // Standalone URLs (e.g. http://... or https://...) -> remove or simplify
    text = text.replace(/https?:\/\/[^\s<>'")]+/gi, ' ');

    // 6. Block-level HTML elements: ensure sentence pause before stripping
    // e.g. <p>Paragraph</p><h1>Heading</h1> -> Paragraph. Heading.
    text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>\s*/gi, '. ');
    text = text.replace(/<(br|hr)\s*\/?>/gi, '. ');

    // 7. Strip all remaining HTML tags
    text = text.replace(/<[^>]*>/g, ' ');

    // 8. Decode HTML entities
    text = decodeHtmlEntities(text, lang);

    // 9. Markdown Headings: ensure trailing punctuation for natural pause
    // e.g. "## Kardiyoloji\n" -> "Kardiyoloji.\n"
    text = text.replace(/^#{1,6}\s+(.+)$/gm, (_, heading) => {
        const h = heading.trim();
        if (!h) return '';
        const lastChar = h.slice(-1);
        return /[.?!:;,]/.test(lastChar) ? h : `${h}.`;
    });

    // 10. Markdown Blockquotes & Obsidian Callouts
    // e.g. "> [!NOTE] Önemli bilgi" -> "Önemli bilgi."
    text = text.replace(/^>\s*\[![a-zA-Z0-9_-]+\](?:-)?\s*(.+)$/gm, (_, title) => {
        const t = title.trim();
        if (!t) return '';
        const lastChar = t.slice(-1);
        return /[.?!:;,]/.test(lastChar) ? t : `${t}.`;
    });
    text = text.replace(/^>\s*\[![a-zA-Z0-9_-]+\](?:-)?\s*/gm, '');
    text = text.replace(/^>\s*/gm, '');

    // 11. Markdown Tables: remove separator rows, format data rows with commas
    // Remove |---|---| separator rows
    text = text.replace(/^\|[\s\-:|]+\|$/gm, '');
    // Replace table row pipes: | A | B | -> A, B.
    text = text.replace(/^\|(.+)\|$/gm, (_, row) => {
        const cells = row.split('|').map(c => c.trim()).filter(Boolean);
        return cells.length ? `${cells.join(', ')}.` : '';
    });

    // 12. Markdown Lists: remove bullets/numbers and ensure comma pause between items, dot at end
    text = text.replace(/(?:^\s*([*+-]|\d+\.)\s+(?:\[[ xX]\]\s+)?(.+)$(?:\n|$))+/gm, (block) => {
        const lines = block.trim().split('\n').map(l => {
            return l.replace(/^\s*([*+-]|\d+\.)\s+(\[[ xX]\]\s+)?/, '').trim();
        }).filter(Boolean);

        return lines.map((line, idx) => {
            const isLast = idx === lines.length - 1;
            const lastChar = line.slice(-1);
            if (/[.?!:;,]/.test(lastChar)) return line;
            return isLast ? `${line}.` : `${line},`;
        }).join('\n') + '\n';
    });

    // 13. Horizontal rules
    text = text.replace(/^(?:[-*_]\s*){3,}$/gm, ' ');

    // 14. Code blocks and inline code
    // Fenced code blocks: remove language tags and markers
    text = text.replace(/```[a-zA-Z0-9_-]*\n?/g, ' ');
    text = text.replace(/```/g, ' ');
    // Inline code backticks: keep inner content
    text = text.replace(/`([^`]+)`/g, '$1');
    text = text.replace(/`/g, '');

    // 15. Inline Markdown formatting (bold, italic, strikethrough, highlight)
    text = text.replace(/~~(?=\S)([\s\S]*?)(?<=\S)~~/g, '$1');
    text = text.replace(/==(?=\S)([\s\S]*?)(?<=\S)==/g, '$1');
    text = text.replace(/\*\*\*(?=\S)([\s\S]*?)(?<=\S)\*\*\*/g, '$1');
    text = text.replace(/\*\*(?=\S)([\s\S]*?)(?<=\S)\*\*/g, '$1');
    text = text.replace(/\*(?=\S)([\s\S]*?)(?<=\S)\*/g, '$1');
    text = text.replace(/(?<=^|\W)__(?=\S)([\s\S]*?)(?<=\S)__(?=\W|$)/g, '$1');
    text = text.replace(/(?<=^|\W)_(?=\S)([\s\S]*?)(?<=\S)_(?=\W|$)/g, '$1');

    // 16. LaTeX / Math formulas: clean markers
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, '$1');
    text = text.replace(/\$([^$\n]+)\$/g, '$1');

    // 17. Escaped characters: \* -> *
    text = text.replace(/\\([*_~=`\[\]\\#+-])/g, '$1');

    // 18. Cleanup orphan symbols that sound unnatural when spoken in isolation
    // (e.g. standalone pipes, hashes, tildes, slashes)
    text = text.replace(/(^|\s)[|#~\\/]+(?=\s|$)/g, ' ');

    // 19. Punctuation & Whitespace Normalization
    // Normalize newlines to spaces
    text = text.replace(/\n+/g, ' ');
    // Remove space before punctuation: "word ." -> "word."
    text = text.replace(/\s+([.,!?:;])/g, '$1');
    // Remove space before apostrophes: "word 'dir" -> "word'dir"
    text = text.replace(/\s+(['’])/g, '$1');

    // Protect existing ellipses
    text = text.replace(/\.{3,}/g, '\uE000');

    // Deduplicate conflicting punctuation: "., " -> ". ", "?." -> "?"
    text = text.replace(/[,;:]\s*([.?!])/g, '$1');
    text = text.replace(/([.?!])\s*([.?!])/g, '$1');
    // Remove double dots that aren't ellipses: ".." -> "."
    text = text.replace(/(?<!\.)\.\.(?!\.)/g, '.');

    // Restore ellipses with natural pauses
    text = text.replace(/\uE000/g, ' ... ');

    // Ensure space after punctuation if missing: "word.next" -> "word. next"
    text = text.replace(/([.,!?:;])(?=[a-zA-Z\u00C0-\u017F])/g, '$1 ');

    // Clean up excessive spaces around apostrophes and punctuation
    text = text.replace(/\s+(['’])/g, '$1');
    text = text.replace(/\s+([.,!?:;])/g, '$1');

    // Collapse whitespace
    text = text.replace(/\s+/g, ' ').trim();

    // 20. Safeguard max length for TTS URL synthesis limits
    if (maxChars > 0 && text.length > maxChars) {
        // Cut at nearest sentence boundary before maxChars if possible
        const slice = text.slice(0, maxChars);
        const lastSentenceBreak = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
        if (lastSentenceBreak > maxChars * 0.6) {
            text = slice.slice(0, lastSentenceBreak + 1);
        } else {
            text = slice.trim();
        }
    }

    return text;
}
