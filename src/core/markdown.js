/* ==========================================================================
   MARKDOWN PARSER & RENDERER
   ---------------------------------------------------------------------------
   Provides a dependency-free, escape-first Markdown parser tailored for
   Obsidian syntax compatibility.

   Key Responsibilities:
   1. renderMarkdown(text): Block-level HTML generation wrapped in .md-content.
   2. renderInlineMarkdown(text): Inline-only HTML generation for option texts.
   3. plainText(text): Formatting-stripped plain text for previews & search.
   4. applySearchHighlight(html, keyword): Wraps keyword matches safely in rendered HTML.

   Security & Invariants:
   - Raw HTML characters (&, <, >) are escaped FIRST before any element creation.
   - Content strings never execute inline HTML or script injection.
   - Code blocks and inline code contents are protected from formatting parsing.
   - Supported tags are restricted to a closed whitelist.
   - Zero DOM or browser global dependencies (runs under plain node --test).
   ========================================================================== */

/**
 * Escapes special HTML characters to prevent XSS vulnerabilities.
 * @param {string} str The string to escape.
 * @returns {string} The escaped string.
 */
export function escapeHTML(str) {
    if (!str || typeof str !== 'string') return str || '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/* Every protection pass below (inline code, escapes, embeds, cloze gaps) parks
   content in a placeholder and substitutes it back afterwards. If an author
   could type a placeholder themselves, their text would be deleted or, worse,
   swapped for someone else's — so the placeholders are delimited by NUL, and
   NUL is stripped out of every input before parsing begins. That makes them
   unforgeable rather than merely unlikely. */
export const SENTINEL = '\u0000';

/**
 * Removes control characters that would otherwise let author text forge a
 * parser placeholder. Tab and newline are structural and kept.
 * @param {string} text
 * @returns {string}
 */
export function normalizeInput(text) {
    return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/**
 * Index ranges covered by fenced code blocks and inline code spans.
 *
 * Exported because cloze.js needs the identical notion of "inside code" — a
 * `{{marker}}` shown as an example in a code block is documentation, not a
 * blank, and the grader and the renderer have to agree on that.
 * @param {string} text
 * @returns {Array<[number, number]>}
 */
export function codeSpans(text) {
    const source = String(text ?? '');
    const spans = [];
    for (const match of source.matchAll(/```[\s\S]*?```/g)) {
        spans.push([match.index, match.index + match[0].length]);
    }
    for (const match of source.matchAll(/`[^`\n]+`/g)) {
        spans.push([match.index, match.index + match[0].length]);
    }
    return spans;
}

// Callout type normalization mapping
const CALLOUT_ALIASES = {
    note: 'note',
    abstract: 'abstract', summary: 'abstract', tldr: 'abstract',
    info: 'info',
    todo: 'todo',
    tip: 'tip', hint: 'tip', important: 'tip',
    success: 'success', check: 'success', done: 'success',
    question: 'question', help: 'question', faq: 'question',
    warning: 'warning', caution: 'warning', attention: 'warning',
    failure: 'failure', fail: 'failure', missing: 'failure',
    danger: 'danger', error: 'danger',
    bug: 'bug',
    example: 'example',
    quote: 'quote', cite: 'quote'
};

/**
 * Normalizes callout alias string to standard type name.
 * @param {string} rawType
 * @returns {string}
 */
function normalizeCalloutType(rawType) {
    if (!rawType) return 'note';
    const cleaned = rawType.trim().toLowerCase();
    return CALLOUT_ALIASES[cleaned] || 'note';
}

/**
 * Validates link protocol safety.
 * Only http:, https:, and mailto: are permitted for <a> tags.
 * @param {string} url
 * @returns {boolean}
 */
export function isSafeUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim().toLowerCase();
    if (trimmed.startsWith('javascript:') || trimmed.startsWith('vbscript:') || trimmed.startsWith('data:')) {
        return false;
    }
    return trimmed.startsWith('http://') ||
           trimmed.startsWith('https://') ||
           trimmed.startsWith('mailto:') ||
           trimmed.startsWith('file://') ||
           trimmed.startsWith('/') ||
           trimmed.startsWith('#');
}

/**
 * Strips YAML frontmatter from document header if present.
 * @param {string} text
 * @returns {string}
 */
function stripFrontmatter(text) {
    if (!text || typeof text !== 'string') return '';
    if (!text.startsWith('---')) return text;
    const lines = text.split('\n');
    if (lines[0].trim() !== '---') return text;
    
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '---') {
            return lines.slice(i + 1).join('\n');
        }
    }
    return text;
}

/**
 * Strips %% comment %% blocks from text.
 * @param {string} text
 * @returns {string}
 */
function stripComments(text) {
    if (!text || typeof text !== 'string') return '';
    const spans = codeSpans(text);
    if (spans.length === 0) return text.replace(/%%[\s\S]*?%%/g, '');
    // A %% pair inside code is sample text, not an author comment: code content
    // is emitted verbatim, so stripping there would delete part of the snippet.
    const insideCode = (index) => spans.some(([start, end]) => index >= start && index < end);
    return text.replace(/%%[\s\S]*?%%/g, (match, offset) => (insideCode(offset) ? match : ''));
}

/**
 * Parses inline Markdown syntax after escaping raw HTML characters.
 * @param {string} escapedText HTML-escaped string
 * @returns {string} Rendered HTML string for inline markup
 */
function parseInlineMarkup(escapedText) {
    if (!escapedText) return '';

    const parked = [];
    const park = (html) => `${SENTINEL}${parked.push(html) - 1}${SENTINEL}`;

    // 1. Inline code, scanned rather than matched, because a backslash-escaped
    //    backtick is not a delimiter — `\`` has to stay literal text. A regex
    //    over the whole string cannot see that distinction. Backslash pairs
    //    inside the span are left alone: Obsidian does not process escapes
    //    inside code.
    let text = '';
    for (let i = 0; i < escapedText.length; i++) {
        const char = escapedText[i];
        if (char === '\\' && i + 1 < escapedText.length) {
            text += char + escapedText[i + 1];
            i++;
            continue;
        }
        if (char === '`') {
            let scan = i + 1;
            let content = '';
            let closed = false;
            while (scan < escapedText.length) {
                if (escapedText[scan] === '\\' && scan + 1 < escapedText.length) {
                    content += escapedText[scan] + escapedText[scan + 1];
                    scan += 2;
                    continue;
                }
                if (escapedText[scan] === '`') {
                    closed = true;
                    break;
                }
                content += escapedText[scan];
                scan++;
            }
            if (closed && content.length > 0) {
                text += park(`<code>${content}</code>`);
                i = scan;
                continue;
            }
        }
        text += char;
    }

    // 2. Escapes: \* \_ \= \~ \` \[ \] \\ — parked so the character cannot go on
    //    to act as a delimiter.
    text = text.replace(/\\([*_~=`\[\]\\])/g, (match, char) => park(char));

    // 3. Embeds ![[target]] — parked before wikilinks so the inner [[ ]] survives.
    text = text.replace(/!\[\[([^\]]+)\]\]/g, (match, target) =>
        park(`<span class="md-embed-missing">[[${target}]]</span>`));

    // 4. Internal wikilinks [[Note]] or [[Note|Alias]]
    text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, target, alias) => {
        const displayText = alias ? alias.trim() : target.trim();
        return `<span class="md-wikilink">${displayText}</span>`;
    });

    // 5. External links [label](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
        const cleanUrl = url.trim();
        if (isSafeUrl(cleanUrl)) {
            return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        }
        return match;
    });

    /* Emphasis runs outermost-first, and each pattern is lazy with a
       (?=\S) / (?<=\S) pair on the delimiters. Two things fall out of that:
       nesting works in both directions (`**bold with *italic* inside**` no
       longer needs the inner run to be absent), and an arithmetic `2 * 3 * 4`
       stays literal because a delimiter followed by a space is not an opener —
       which is Obsidian's rule too. */
    text = text.replace(/~~(?=\S)([\s\S]*?)(?<=\S)~~/g, '<del>$1</del>');
    text = text.replace(/==(?=\S)([\s\S]*?)(?<=\S)==/g, '<mark>$1</mark>');
    text = text.replace(/\*\*\*(?=\S)([\s\S]*?)(?<=\S)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*(?=\S)([\s\S]*?)(?<=\S)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(?=\S)([\s\S]*?)(?<=\S)\*/g, '<em>$1</em>');
    // Underscore emphasis additionally requires a non-word boundary on both
    // ends, so an intra-word run like snake_case_name is not emphasis. A
    // standalone __init__ still bolds — that is Obsidian's behaviour too, and
    // an author who means the identifier writes it as `__init__`.
    text = text.replace(/(?<=^|\W)__(?=\S)([\s\S]*?)(?<=\S)__(?=\W|$)/g, '<strong>$1</strong>');
    text = text.replace(/(?<=^|\W)_(?=\S)([\s\S]*?)(?<=\S)_(?=\W|$)/g, '<em>$1</em>');

    // Unpark innermost-last: a parked <code> may sit inside emphasis we just
    // emitted, so this has to run after all delimiter passes.
    return text.replace(
        new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g'),
        (match, index) => parked[Number(index)] ?? ''
    );
}

/** A list item: `- `, `* ` or `1. `, at any indent. */
const LIST_ITEM = /^[ \t]*(?:[*-]|\d+\.)[ \t]+/;

/**
 * True for a table's alignment row — every cell is dashes with optional colons.
 * Requiring this is what keeps an ordinary sentence containing a pipe from
 * being mistaken for a table.
 * @param {string|undefined} line
 * @returns {boolean}
 */
function isTableDelimiterRow(line) {
    if (typeof line !== 'string') return false;
    let inner = line.trim();
    if (!inner.includes('-')) return false;
    if (inner.startsWith('|')) inner = inner.slice(1);
    if (inner.endsWith('|')) inner = inner.slice(0, -1);
    const cells = inner.split('|');
    return cells.length > 0 && cells.every(cell => /^\s*:?-+:?\s*$/.test(cell));
}

/**
 * True when a line opens a new block, and so ends the paragraph above it.
 * Lists and tables belong in this set: Obsidian starts a list on `- item`
 * directly under a line of prose, it does not fold it into the paragraph.
 * @param {string} line
 * @param {string|undefined} nextLine Needed to recognise a table header
 * @returns {boolean}
 */
function startsBlock(line, nextLine) {
    const trimmed = line.trim();
    return trimmed.startsWith('```')
        || line.startsWith('>')
        || /^(#{1,6})\s+/.test(line)
        || /^(---|\*\*\*)\s*$/.test(trimmed)
        || LIST_ITEM.test(line)
        || (line.includes('|') && isTableDelimiterRow(nextLine));
}

/**
 * The shift that moves a document's shallowest heading onto h2, so a note's
 * own `#` cannot compete with the question card's title while its internal
 * hierarchy is preserved.
 *
 * Exported and taking plain levels rather than blocks so the clamp is testable
 * on its own, without going through the parser.
 * @param {number[]} levels Heading levels as authored, in document order
 * @returns {number} Delta to add to every level before capping at 6
 */
export function headingDelta(levels) {
    let minLevel = 7;
    for (const level of levels) {
        if (typeof level === 'number' && level >= 1 && level < minLevel) minLevel = level;
    }
    if (minLevel > 6) return 0; // No headings found
    return 2 - minLevel;
}

/** Applies {@link headingDelta} to one level and caps the result at h6. */
export function clampHeadingLevel(level, delta) {
    return Math.min(6, Math.max(2, level + delta));
}

/**
 * Renders inline Markdown content only (no block wrappers like <p>).
 * Used for choice option texts and labels.
 * @param {string} rawText
 * @returns {string}
 */
export function renderInlineMarkdown(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    const cleaned = stripComments(normalizeInput(rawText));
    const escaped = escapeHTML(cleaned);
    return parseInlineMarkup(escaped);
}

/**
 * Parses block structures and emits full block-level HTML inside .md-content wrapper.
 * @param {string} rawText
 * @returns {string}
 */
export function renderMarkdown(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    return renderNormalized(normalizeInput(rawText));
}

/**
 * renderMarkdown for a caller that has already normalized its input and is
 * deliberately carrying {@link SENTINEL} placeholders through the parse —
 * currently only cloze.js, which swaps its markers for placeholders before
 * rendering and substitutes the numbered gaps back afterwards.
 *
 * Normalizing in the public entry point rather than here is what keeps
 * placeholders unforgeable: author text always loses its control characters on
 * the way in, so only an internal caller that injected placeholders after that
 * point can have them.
 * @param {string} text Already-normalized Markdown
 * @returns {string}
 */
export function renderNormalizedMarkdown(text) {
    if (!text || typeof text !== 'string') return '';
    return renderNormalized(text);
}

/**
 * The block parser proper. Assumes normalized input.
 * @param {string} rawText
 * @returns {string}
 */
function renderNormalized(rawText) {
    let text = stripFrontmatter(rawText);
    text = stripComments(text);
    if (!text.trim()) return '';

    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const blocks = [];

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];

        // 1. Fenced Code Block: ```lang
        if (line.trim().startsWith('```')) {
            const lang = line.trim().slice(3).trim();
            const codeLines = [];
            i++;
            while (i < lines.length && !lines[i].trim().startsWith('```')) {
                codeLines.push(lines[i]);
                i++;
            }
            if (i < lines.length && lines[i].trim().startsWith('```')) {
                i++; // consume closing fence
            }
            blocks.push({
                type: 'code_block',
                lang,
                code: codeLines.join('\n')
            });
            continue;
        }

        // 2. Callout Block: > [!type] Title or > [!type]- Title
        const calloutMatch = line.match(/^>\s*\[!([a-zA-Z0-9_-]+)\](?:-)?\s*(.*)$/);
        if (calloutMatch) {
            const rawType = calloutMatch[1];
            const titleText = calloutMatch[2].trim();
            /* A blank line ends the callout, as in Obsidian. Continuing across
               one — which the first version did whenever the next line also
               began with `>` — merged two adjacent callouts into one and left
               the second one's `[!type] Title` sitting in the first one's body
               as literal text. To break a paragraph *inside* a callout, the
               empty line carries its own `>`, which the branch below already
               handles. */
            const bodyLines = [];
            i++;
            while (i < lines.length && lines[i].startsWith('>')) {
                bodyLines.push(lines[i].replace(/^>\s?/, ''));
                i++;
            }
            blocks.push({
                type: 'callout',
                calloutType: normalizeCalloutType(rawType),
                title: titleText,
                body: bodyLines.join('\n')
            });
            continue;
        }

        // 3. Regular Blockquote: > Text
        if (line.startsWith('>')) {
            const quoteLines = [];
            while (i < lines.length && lines[i].startsWith('>')) {
                quoteLines.push(lines[i].replace(/^>\s?/, ''));
                i++;
            }
            blocks.push({
                type: 'blockquote',
                body: quoteLines.join('\n')
            });
            continue;
        }

        /* 4. Headings: # through ######
           `(.*)`, not `(.+)`: a heading whose text has not been typed yet is
           still a heading, and startsBlock() has always said so. `##   ` already
           rendered as an empty one — only `## `, with exactly one space, could
           not backtrack its way to a match. That inconsistency is what the
           toolbar's H2 button walked into. */
        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
            blocks.push({
                type: 'heading',
                level: headingMatch[1].length,
                text: headingMatch[2].trim()
            });
            i++;
            continue;
        }

        // 5. Thematic Break: --- or *** alone on line
        if (/^(---|\*\*\*)\s*$/.test(line.trim())) {
            blocks.push({ type: 'hr' });
            i++;
            continue;
        }

        /* 6. Pipe Table. A delimiter row directly under the header is what makes
           a table a table, so it is required before any line is consumed. The
           previous shape committed to a table on a leading `|` alone, advanced
           the cursor, and then fell through when the row count came up short —
           which deleted the line it had already eaten. Nothing is consumed here
           unless the whole block is accepted. */
        if (line.includes('|') && isTableDelimiterRow(lines[i + 1])) {
            const tableLines = [line.trim(), lines[i + 1].trim()];
            let scan = i + 2;
            while (scan < lines.length && lines[scan].includes('|') && lines[scan].trim() !== '') {
                tableLines.push(lines[scan].trim());
                scan++;
            }
            i = scan;
            blocks.push({ type: 'table', lines: tableLines });
            continue;
        }

        // 7. Unordered / Task / Ordered List. Indented continuation lines are
        //    pulled in too so renderListBlock can rebuild the nesting.
        if (LIST_ITEM.test(line)) {
            const listLines = [];
            while (i < lines.length && (LIST_ITEM.test(lines[i]) || (/^[ \t]/.test(lines[i]) && lines[i].trim() !== '' && listLines.length > 0))) {
                listLines.push(lines[i]);
                i++;
            }
            blocks.push({
                type: 'list',
                lines: listLines
            });
            continue;
        }

        // 8. Blank line
        if (!line.trim()) {
            i++;
            continue;
        }

        /* 9. Paragraph block (accumulates lines until blank or block start)

           The first line is taken unconditionally, and that is what guarantees
           the outer loop advances. Asking startsBlock() about it is asking a
           question the eight branches above already answered - none of them
           claimed it - so a `true` here is the two predicates disagreeing, and
           the loop would break with nothing consumed, leave `i` where it was,
           and spin forever with the tab frozen.

           It was reachable: branch 4 needs text after the hashes (`(.+)`) while
           startsBlock only needs the hashes and a space, so a line of exactly
           `## ` fell through every branch and was then called a block start.
           That is precisely what the H2 toolbar button inserts when nothing is
           selected. The regex is aligned below too, but the guard is what keeps
           the next divergence a rendering quirk instead of a hung tab. */
        const paraLines = [];
        while (i < lines.length) {
            const l = lines[i];
            if (!l.trim()) break;
            if (paraLines.length > 0 && startsBlock(l, lines[i + 1])) break;
            paraLines.push(l);
            i++;
        }
        if (paraLines.length > 0) {
            blocks.push({
                type: 'paragraph',
                lines: paraLines
            });
        }
    }

    // Heading level clamping delta
    const delta = headingDelta(blocks.filter(b => b.type === 'heading').map(b => b.level));

    // Build block HTML
    const htmlParts = [];

    for (const block of blocks) {
        switch (block.type) {
            case 'code_block': {
                const escapedCode = escapeHTML(block.code);
                const classAttr = block.lang ? ` class="language-${escapeHTML(block.lang)}"` : '';
                htmlParts.push(`<pre><code${classAttr}>${escapedCode}</code></pre>`);
                break;
            }

            case 'callout': {
                const typeClass = `md-callout-${block.calloutType}`;
                const titleHtml = parseInlineMarkup(escapeHTML(block.title));
                const bodyHtml = block.body ? renderMarkdownBody(block.body) : '';
                htmlParts.push(
                    `<div class="md-callout ${typeClass}">` +
                    `<div class="md-callout-title">${titleHtml}</div>` +
                    (bodyHtml ? `<div class="md-callout-body">${bodyHtml}</div>` : '') +
                    `</div>`
                );
                break;
            }

            case 'blockquote': {
                const bodyHtml = renderMarkdownBody(block.body);
                htmlParts.push(`<blockquote>${bodyHtml}</blockquote>`);
                break;
            }

            case 'heading': {
                const clampedLevel = clampHeadingLevel(block.level, delta);
                const textHtml = parseInlineMarkup(escapeHTML(block.text));
                htmlParts.push(`<h${clampedLevel}>${textHtml}</h${clampedLevel}>`);
                break;
            }

            case 'hr': {
                htmlParts.push('<hr>');
                break;
            }

            case 'table': {
                const tableHtml = renderTableBlock(block.lines);
                htmlParts.push(tableHtml);
                break;
            }

            case 'list': {
                const listHtml = renderListBlock(block.lines);
                htmlParts.push(listHtml);
                break;
            }

            case 'paragraph': {
                const inlineLines = block.lines.map(l => parseInlineMarkup(escapeHTML(l)));
                htmlParts.push(`<p>${inlineLines.join('<br>')}</p>`);
                break;
            }

            default:
                break;
        }
    }

    return `<div class="md-content">${htmlParts.join('')}</div>`;
}

/**
 * Inner helper to render body content of callouts and blockquotes (without root wrapper).
 * @param {string} bodyText
 * @returns {string}
 */
function renderMarkdownBody(bodyText) {
    // renderNormalized, not renderMarkdown: the outer call already normalized,
    // and re-normalizing here would strip placeholders a caller like cloze.js
    // legitimately placed inside a callout or blockquote body.
    const full = renderNormalized(bodyText);
    // Strip leading <div class="md-content"> and trailing </div>
    return full.replace(/^<div class="md-content">/, '').replace(/<\/div>$/, '');
}

/**
 * Renders a Markdown pipe table to HTML.
 * @param {string[]} lines
 * @returns {string}
 */
function renderTableBlock(lines) {
    if (lines.length < 2) return '';

    const parseRow = (line) => {
        let trimmed = line.trim();
        if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
        if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
        return trimmed.split('|').map(c => c.trim());
    };

    const headerCells = parseRow(lines[0]);
    const alignCells = parseRow(lines[1]);

    const alignments = alignCells.map(cell => {
        const left = cell.startsWith(':');
        const right = cell.endsWith(':');
        if (left && right) return 'center';
        if (right) return 'right';
        if (left) return 'left';
        return '';
    });

    const theadRows = headerCells.map((cell, idx) => {
        const align = alignments[idx] ? ` style="text-align: ${alignments[idx]}"` : '';
        const content = parseInlineMarkup(escapeHTML(cell));
        return `<th${align}>${content}</th>`;
    }).join('');

    const tbodyRows = [];
    for (let i = 2; i < lines.length; i++) {
        const cells = parseRow(lines[i]);
        const rowHtml = headerCells.map((_, idx) => {
            const cellText = cells[idx] !== undefined ? cells[idx] : '';
            const align = alignments[idx] ? ` style="text-align: ${alignments[idx]}"` : '';
            const content = parseInlineMarkup(escapeHTML(cellText));
            return `<td${align}>${content}</td>`;
        }).join('');
        tbodyRows.push(`<tr>${rowHtml}</tr>`);
    }

    return `<table><thead><tr>${theadRows}</tr></thead><tbody>${tbodyRows.join('')}</tbody></table>`;
}

/**
 * Rebuilds the nesting a list block's indentation describes.
 *
 * Indentation, not marker type, decides depth — a deeper item becomes a child
 * of the last item at the level above it. An unindented continuation line is
 * lazy wrapping and joins the item it follows, which is what stops a wrapped
 * bullet from turning into a phantom empty item.
 * @param {string[]} lines
 * @returns {Array<{text: string, ordered: boolean, children: Array}>}
 */
function buildListTree(lines) {
    const roots = [];
    const stack = [{ indent: -1, items: roots }];

    for (const line of lines) {
        const match = line.match(/^([ \t]*)(?:([*-])|(\d+)\.)[ \t]+([\s\S]*)$/);
        if (!match) {
            const current = stack[stack.length - 1].items;
            const last = current[current.length - 1];
            if (last) last.text += ` ${line.trim()}`;
            continue;
        }

        // Tabs count as four columns so tab- and space-indented notes nest alike.
        const indent = match[1].replace(/\t/g, '    ').length;
        const item = { text: match[4], ordered: match[3] !== undefined, children: [] };

        while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
        const top = stack[stack.length - 1];

        if (indent > top.indent && top.items.length > 0) {
            const parent = top.items[top.items.length - 1];
            stack.push({ indent, items: parent.children });
            parent.children.push(item);
        } else {
            if (top.indent === -1) top.indent = indent;
            top.items.push(item);
        }
    }

    return roots;
}

/**
 * Renders a list tree into nested <ul>/<ol>, handling task checkboxes.
 * The list's own marker type comes from its first item.
 * @param {Array<{text: string, ordered: boolean, children: Array}>} items
 * @returns {string}
 */
function renderListItems(items) {
    if (items.length === 0) return '';
    const tag = items[0].ordered ? 'ol' : 'ul';

    const html = items.map(item => {
        let itemText = item.text;
        // The trailing text is optional: `- [x]` on its own is a valid done task.
        const taskMatch = itemText.match(/^\[([ xX])\](?:[ \t]+([\s\S]*))?$/);
        const children = renderListItems(item.children);

        if (taskMatch) {
            const checkedAttr = taskMatch[1].toLowerCase() === 'x' ? ' checked' : '';
            const inlineHtml = parseInlineMarkup(escapeHTML(taskMatch[2] || ''));
            return `<li class="md-task"><input type="checkbox" disabled${checkedAttr}> ${inlineHtml}${children}</li>`;
        }
        return `<li>${parseInlineMarkup(escapeHTML(itemText))}${children}</li>`;
    }).join('');

    return `<${tag}>${html}</${tag}>`;
}

/**
 * Renders list lines into HTML <ul> or <ol>, handling nesting and task checkboxes.
 * @param {string[]} lines
 * @returns {string}
 */
function renderListBlock(lines) {
    return renderListItems(buildListTree(lines));
}

/**
 * Strips all Markdown syntax formatting to extract clean plain text.
 * Used for search matching, previews, and sorting.
 * @param {string} rawText
 * @returns {string}
 */
export function plainText(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';

    let text = stripFrontmatter(normalizeInput(rawText));
    text = stripComments(text);

    // Code blocks & inline code: keep content, drop markers
    text = text.replace(/```[a-zA-Z0-9_-]*\n?/g, '');
    text = text.replace(/`/g, '');

    // Callout headers
    text = text.replace(/^>\s*\[![a-zA-Z0-9_-]+\](?:-)?\s*/gm, '');
    text = text.replace(/^>\s?/gm, '');

    // Headings
    text = text.replace(/^#{1,6}\s+/gm, '');

    // Links & Wikilinks & Embeds
    text = text.replace(/!\[\[([^\]]+)\]\]/g, '$1');
    text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, target, alias) => alias || target);
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // Inline formatting: bold, italic, strikethrough, highlight. Same delimiter
    // rules as parseInlineMarkup, so a stripped string and a rendered one agree
    // on what was ever markup — search matches the text the reader sees.
    text = text.replace(/~~(?=\S)([\s\S]*?)(?<=\S)~~/g, '$1');
    text = text.replace(/==(?=\S)([\s\S]*?)(?<=\S)==/g, '$1');
    text = text.replace(/\*\*\*(?=\S)([\s\S]*?)(?<=\S)\*\*\*/g, '$1');
    text = text.replace(/\*\*(?=\S)([\s\S]*?)(?<=\S)\*\*/g, '$1');
    text = text.replace(/\*(?=\S)([\s\S]*?)(?<=\S)\*/g, '$1');
    text = text.replace(/(?<=^|\W)__(?=\S)([\s\S]*?)(?<=\S)__(?=\W|$)/g, '$1');
    text = text.replace(/(?<=^|\W)_(?=\S)([\s\S]*?)(?<=\S)_(?=\W|$)/g, '$1');

    // Task list markers
    text = text.replace(/^\s*([*-]|\d+\.)\s+\[[ xX]\]\s+/gm, '');
    text = text.replace(/^\s*([*-]|\d+\.)\s+/gm, '');

    // HTML tags if any left
    text = text.replace(/<[^>]*>/g, '');

    // Escape tokens
    text = text.replace(/\\([*_~=`\[\]\\])/g, '$1');

    return text.trim();
}

/**
 * Wraps search keyword matches in <span class="search-highlight"> without breaking HTML tags or attributes.
 * @param {string} htmlString Rendered HTML output
 * @param {string} keyword Search query keyword
 * @returns {string} HTML string with search highlights
 */
export function applySearchHighlight(htmlString, keyword) {
    if (!htmlString || !keyword || typeof keyword !== 'string' || !keyword.trim()) return htmlString || '';
    try {
        const escapedKeyword = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedKeyword})(?![^<]*>)`, 'gi');
        return htmlString.replace(regex, '<span class="search-highlight">$1</span>');
    } catch (e) {
        return htmlString;
    }
}
