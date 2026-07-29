/* The first migration shipped markdown.css with a light-only token set: code
   text was #0f172a in both themes, which is invisible on the dark --bg-color.
   Reviewing colour by eye is what let that through, so these tests check the
   two properties that make theme coverage mechanical instead.

   They read the CSS as text on purpose — no DOM, no build step — so they run
   under plain `node --test` alongside the rest of the suite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const markdownCss = readFileSync(new URL('../src/core/markdown.css', import.meta.url), 'utf8');
const styleCss = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

/** The body of a top-level CSS block, matched by brace depth. */
function ruleBody(css, selector) {
    const start = css.indexOf(`${selector} {`);
    assert.notEqual(start, -1, `expected a ${selector} block in style.css`);
    let depth = 0;
    let index = css.indexOf('{', start);
    const open = index;
    while (index < css.length) {
        if (css[index] === '{') depth++;
        else if (css[index] === '}' && --depth === 0) break;
        index++;
    }
    return css.slice(open, index);
}

const root = ruleBody(styleCss, ':root');
const dark = ruleBody(styleCss, '[data-theme="dark"]');
const defines = (body, property) => new RegExp(`^\\s*${property}\\s*:`, 'm').test(body);

/* --callout-border and --callout-bg are indirections: the per-type classes in
   markdown.css bind them locally, and the renderer always emits one of those
   classes, so they are never expected in the theme tables. */
const LOCALLY_BOUND = new Set(['--callout-border', '--callout-bg']);

/** Geometry, not colour — the same in both themes by design. */
const THEME_INDEPENDENT = /radius|space|size|width|font/;

const referenced = [...new Set(
    [...markdownCss.matchAll(/var\((--[a-z0-9-]+)/g)].map(match => match[1])
)].sort();

test('markdown.css references at least the tokens it needs', () => {
    assert.ok(referenced.length > 20, `expected a real token surface, got ${referenced.length}`);
});

test('every colour token markdown.css uses is defined in BOTH themes', () => {
    const missing = [];
    for (const property of referenced) {
        if (LOCALLY_BOUND.has(property) || THEME_INDEPENDENT.test(property)) continue;
        if (!defines(root, property)) missing.push(`${property} (missing from :root)`);
        if (!defines(dark, property)) missing.push(`${property} (missing from [data-theme="dark"])`);
    }
    assert.deepEqual(missing, [], `Tokens without a value in both themes:\n  ${missing.join('\n  ')}`);
});

test('theme-independent tokens still resolve somewhere', () => {
    for (const property of referenced) {
        if (LOCALLY_BOUND.has(property) || !THEME_INDEPENDENT.test(property)) continue;
        assert.equal(defines(root, property), true, `${property} is used but never defined`);
    }
});

test('no colour is hard-coded in the content pipeline', () => {
    // P4: colour is semantic. A hex here would only be right in one theme —
    // including as a var() fallback, which is how the light-only values got in.
    const hexes = markdownCss.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    assert.deepEqual(hexes, [], `hex literals in markdown.css: ${hexes.join(', ')}`);
    const rgbFallbacks = markdownCss.match(/var\(--[a-z0-9-]+,\s*(rgb|hsl)/g) || [];
    assert.deepEqual(rgbFallbacks, [], `colour fallbacks in markdown.css: ${rgbFallbacks.join(', ')}`);
});

test('markdown.css never styles app chrome', () => {
    // An unscoped element selector here would restyle the whole application,
    // which is exactly what the retired global code/pre block in style.css did.
    const withoutComments = markdownCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const offenders = [];
    for (const [, selectorList] of withoutComments.matchAll(/(?:^|\})\s*([^{}@]+?)\s*\{/g)) {
        for (const selector of selectorList.split(',')) {
            const trimmed = selector.trim();
            if (!trimmed) continue;
            if (!trimmed.includes('.md-content')) offenders.push(trimmed);
        }
    }
    assert.deepEqual(offenders, [], `selectors not scoped to .md-content:\n  ${offenders.join('\n  ')}`);
});

test('the global code/pre rules stay retired', () => {
    // They were written for hand-authored HTML and styled the entire app.
    assert.equal(/^code\s*\{/m.test(styleCss), false, 'global `code` selector is back');
    assert.equal(/^pre\s*\{/m.test(styleCss), false, 'global `pre` selector is back');
    assert.equal(/^pre code\s*\{/m.test(styleCss), false, 'global `pre code` selector is back');
});

/* ---------------------------------------------------------------------------
   Contrast. "Legible in both themes" is the requirement, and eyeballing it is
   what shipped near-black code text on a near-black background. These compute
   the actual WCAG ratio for each foreground/surface pair the renderer produces,
   in both themes, including the alpha compositing over the page background.
   --------------------------------------------------------------------------- */

function parseColour(value) {
    const text = String(value).trim();
    const hex = text.match(/^#([0-9a-f]{6})$/i);
    if (hex) {
        return [0, 2, 4].map(offset => parseInt(hex[1].slice(offset, offset + 2), 16)).concat(1);
    }
    const rgb = text.match(/^rgba?\(([^)]+)\)$/i);
    if (rgb) {
        const parts = rgb[1].split(',').map(part => parseFloat(part));
        return [parts[0], parts[1], parts[2], parts[3] ?? 1];
    }
    return null;
}

/** Flatten a possibly translucent colour onto an opaque backdrop. */
const composite = (colour, backdrop) =>
    colour.slice(0, 3).map((channel, index) => channel * colour[3] + backdrop[index] * (1 - colour[3]));

function relativeLuminance([r, g, b]) {
    const [rl, gl, bl] = [r, g, b].map(channel => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrastRatio(foreground, background) {
    const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)]
        .sort((a, b) => b - a);
    return (lighter + 0.05) / (darker + 0.05);
}

const CALLOUT_TYPES = [
    'note', 'abstract', 'info', 'todo', 'tip', 'success',
    'question', 'warning', 'failure', 'danger', 'bug', 'example', 'quote'
];

for (const theme of ['light', 'dark']) {
    const table = theme === 'dark' ? dark : root;
    const token = (property) => {
        const scoped = table.match(new RegExp(`^\\s*${property}\\s*:\\s*([^;]+);`, 'm'));
        const base = root.match(new RegExp(`^\\s*${property}\\s*:\\s*([^;]+);`, 'm'));
        return (scoped ?? base)?.[1]?.trim();
    };

    test(`${theme} theme: rendered text clears WCAG AA on its own surface`, () => {
        const page = parseColour(token('--bg-color'));
        assert.ok(page, `--bg-color must parse in ${theme}`);

        const pairs = [
            ['code', '--code-text', '--code-bg'],
            ['highlight', '--highlight-text', '--highlight-bg'],
            ...CALLOUT_TYPES.map(type => [
                `callout ${type} title`, `--callout-${type}-border`, `--callout-${type}-bg`
            ])
        ];

        const failures = [];
        for (const [label, foregroundToken, surfaceToken] of pairs) {
            const foreground = parseColour(token(foregroundToken));
            const surfaceTint = parseColour(token(surfaceToken));
            assert.ok(foreground, `${foregroundToken} must parse in ${theme}`);
            assert.ok(surfaceTint, `${surfaceToken} must parse in ${theme}`);

            const surface = composite(surfaceTint, page.slice(0, 3));
            const ratio = contrastRatio(composite(foreground, surface), surface);
            if (ratio < 4.5) failures.push(`${label}: ${ratio.toFixed(2)}:1`);
        }
        assert.deepEqual(failures, [], `below 4.5:1 in ${theme}:\n  ${failures.join('\n  ')}`);
    });
}

test('pre and table scroll inside the card, not the page', () => {
    for (const selector of ['.md-content pre', '.md-content table']) {
        const body = ruleBody(markdownCss, selector);
        assert.match(body, /overflow-x:\s*auto/, `${selector} must scroll within itself`);
    }
});
