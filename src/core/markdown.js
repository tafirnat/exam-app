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
function isSafeUrl(url) {
    if (!url) return false;
    const trimmed = url.trim().toLowerCase();
    return trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('mailto:');
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
    return text.replace(/%%[\s\S]*?%%/g, '');
}

/**
 * Parses inline Markdown syntax after escaping raw HTML characters.
 * @param {string} escapedText HTML-escaped string
 * @returns {string} Rendered HTML string for inline markup
 */
function parseInlineMarkup(escapedText) {
    if (!escapedText) return '';

    // 1. Tokenize inline code `code` first so formatting inside code is ignored
    const codeTokens = [];
    let text = escapedText.replace(/`([^`]+)`/g, (match, codeContent) => {
        const token = `__MD_CODE_TOKEN_${codeTokens.length}__`;
        codeTokens.push(`<code>${codeContent}</code>`);
        return token;
    });

    // 2. Tokenize escapes: \* \_ \= \~ \` \[ \] \\ so escaped characters won't trigger markup
    const escapeTokens = [];
    text = text.replace(/\\([*_~=`\[\]\\])/g, (match, char) => {
        const token = `__MD_ESC_TOKEN_${escapeTokens.length}__`;
        escapeTokens.push(char);
        return token;
    });

    // 3. Embedded missing note markers ![[Embed]] (tokenized to protect inner [[ ]])
    const embedTokens = [];
    text = text.replace(/!\[\[([^\]]+)\]\]/g, (match, embedTarget) => {
        const token = `__MD_EMBED_TOKEN_${embedTokens.length}__`;
        embedTokens.push(`<span class="md-embed-missing">[[${embedTarget}]]</span>`);
        return token;
    });

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

    // 6. Strikethrough ~~text~~
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // 7. Highlight ==text==
    text = text.replace(/==([^=]+)==/g, '<mark>$1</mark>');

    // 8. Bold + Italic ***text***
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');

    // 9. Bold **text** or __text__
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(?<=^|\W)__([^_]+)__(?=\W|$)/g, '<strong>$1</strong>');

    // 10. Italic *text* or _text_ (strictly requiring non-word boundaries for _ to avoid snake_case)
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/(?<=^|\W)_([^_]+)_(?=\W|$)/g, '<em>$1</em>');

    // Restore embed tokens
    text = text.replace(/__MD_EMBED_TOKEN_(\d+)__/g, (match, index) => {
        return embedTokens[Number(index)] || '';
    });

    // Restore escape tokens
    text = text.replace(/__MD_ESC_TOKEN_(\d+)__/g, (match, index) => {
        return escapeTokens[Number(index)] || '';
    });

    // Restore inline code tokens
    text = text.replace(/__MD_CODE_TOKEN_(\d+)__/g, (match, index) => {
        return codeTokens[Number(index)] || '';
    });

    return text;
}

/**
 * Calculates heading clamp shift so the shallowest heading maps to h2 and max h6.
 * @param {Array<{level: number}>} blocks
 * @returns {number} Delta shift
 */
function calculateHeadingDelta(blocks) {
    let minLevel = 7;
    for (const b of blocks) {
        if (b.type === 'heading' && b.level < minLevel) {
            minLevel = b.level;
        }
    }
    if (minLevel > 6) return 0; // No headings found
    return 2 - minLevel;
}

/**
 * Renders inline Markdown content only (no block wrappers like <p>).
 * Used for choice option texts and labels.
 * @param {string} rawText
 * @returns {string}
 */
export function renderInlineMarkdown(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    const cleaned = stripComments(rawText);
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
            const bodyLines = [];
            i++;
            while (i < lines.length) {
                if (lines[i].startsWith('>')) {
                    bodyLines.push(lines[i].replace(/^>\s?/, ''));
                    i++;
                } else if (lines[i].trim() === '' && i + 1 < lines.length && lines[i + 1].startsWith('>')) {
                    bodyLines.push('');
                    i++;
                } else {
                    break;
                }
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

        // 4. Headings: # through ######
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
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

        // 6. Pipe Table: line contains | and next line contains delimiter row (e.g. |---|)
        if (line.trim().startsWith('|') || (line.includes('|') && i + 1 < lines.length && /^\|?\s*:?---/.test(lines[i + 1].trim()))) {
            const tableLines = [];
            while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
                tableLines.push(lines[i].trim());
                i++;
            }
            if (tableLines.length >= 2) {
                blocks.push({
                    type: 'table',
                    lines: tableLines
                });
                continue;
            }
            // If invalid table, fall through to paragraph
        }

        // 7. Unordered / Task / Ordered List
        if (/^\s*([*-]|\d+\.)\s+/.test(line)) {
            const listLines = [];
            while (i < lines.length && (/^\s*([*-]|\d+\.)\s+/.test(lines[i]) || (lines[i].startsWith('  ') && listLines.length > 0))) {
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

        // 9. Paragraph block (accumulates lines until blank or block start)
        const paraLines = [];
        while (i < lines.length) {
            const l = lines[i];
            if (!l.trim()) break;
            if (l.trim().startsWith('```') || l.startsWith('>') || /^(#{1,6})\s+/.test(l) || /^(---|\*\*\*)\s*$/.test(l.trim())) {
                break;
            }
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
    const headingDelta = calculateHeadingDelta(blocks);

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
                const clampedLevel = Math.min(6, Math.max(2, block.level + headingDelta));
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
    const full = renderMarkdown(bodyText);
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
 * Renders list lines into HTML <ul> or <ol>, handling task checkboxes.
 * @param {string[]} lines
 * @returns {string}
 */
function renderListBlock(lines) {
    const isOrdered = /^\s*\d+\.\s+/.test(lines[0]);
    const tag = isOrdered ? 'ol' : 'ul';
    const items = [];

    for (const line of lines) {
        const match = line.match(/^\s*(?:[*-]|\d+\.)\s+(.*)$/);
        if (!match) continue;

        let itemText = match[1];
        let isTask = false;
        let isChecked = false;

        const taskMatch = itemText.match(/^\[([ xX])\]\s+(.*)$/);
        if (taskMatch) {
            isTask = true;
            isChecked = taskMatch[1].toLowerCase() === 'x';
            itemText = taskMatch[2];
        }

        const inlineHtml = parseInlineMarkup(escapeHTML(itemText));

        if (isTask) {
            const checkedAttr = isChecked ? ' checked' : '';
            items.push(`<li class="md-task"><input type="checkbox" disabled${checkedAttr}> ${inlineHtml}</li>`);
        } else {
            items.push(`<li>${inlineHtml}</li>`);
        }
    }

    return `<${tag}>${items.join('')}</${tag}>`;
}

/**
 * Strips all Markdown syntax formatting to extract clean plain text.
 * Used for search matching, previews, and sorting.
 * @param {string} rawText
 * @returns {string}
 */
export function plainText(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';

    let text = stripFrontmatter(rawText);
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

    // Inline formatting: bold, italic, strikethrough, highlight
    text = text.replace(/~~([^~]+)~~/g, '$1');
    text = text.replace(/==([^=]+)==/g, '$1');
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
    text = text.replace(/\*([^*]+)\*/g, '$1');
    text = text.replace(/(?<=^|\W)__([^_]+)__(?=\W|$)/g, '$1');
    text = text.replace(/(?<=^|\W)_([^_]+)_(?=\W|$)/g, '$1');

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
