import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderInlineMarkdown, plainText, headingDelta, clampHeadingLevel } from '../src/core/markdown.js';

test('1. Escape first security requirement - XSS payload escaping', () => {
    const input = '<script>alert(1)</script><iframe src="javascript:alert(2)"></iframe>';
    const output = renderMarkdown(input);

    assert.equal(output.includes('<script>'), false);
    assert.equal(output.includes('<iframe'), false);
    assert.equal(output.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), true);
    assert.equal(output.includes('&lt;iframe src=&quot;javascript:alert(2)&quot;&gt;'), true);
});

test('Tag whitelist enforcement', () => {
    const markdown = `# Title\n\n- item 1\n- [ ] task 1\n\n> [!note] Callout\n> Body\n\n\`\`\`js\nconst x = 1;\n\`\`\`\n\n| H1 | H2 |\n|---|---|\n| C1 | C2 |\n\n[link](https://example.com)`;
    const html = renderMarkdown(markdown);
    
    // Collect all tag names emitted
    const tags = new Set([...html.matchAll(/<\/?([a-z1-6]+)[^>]*>/gi)].map(m => m[1].toLowerCase()));
    const allowedTags = new Set([
        'div', 'p', 'h2', 'h3', 'h4', 'h5', 'h6',
        'strong', 'em', 'del', 'mark', 'code', 'pre', 'a',
        'ul', 'ol', 'li', 'blockquote', 'table', 'thead',
        'tbody', 'tr', 'th', 'td', 'hr', 'br', 'span', 'input'
    ]);

    for (const tag of tags) {
        assert.equal(allowedTags.has(tag), true, `Unexpected HTML tag emitted: <${tag}>`);
    }
});

test('2. Inline Markdown formatting table 2.1', () => {
    assert.equal(renderInlineMarkdown('**bold**'), '<strong>bold</strong>');
    assert.equal(renderInlineMarkdown('__bold__'), '<strong>bold</strong>');
    assert.equal(renderInlineMarkdown('*italic*'), '<em>italic</em>');
    assert.equal(renderInlineMarkdown('_italic_'), '<em>italic</em>');
    assert.equal(renderInlineMarkdown('***bold italic***'), '<strong><em>bold italic</em></strong>');
    assert.equal(renderInlineMarkdown('~~strikethrough~~'), '<del>strikethrough</del>');
    assert.equal(renderInlineMarkdown('==highlight=='), '<mark>highlight</mark>');
    assert.equal(renderInlineMarkdown('`inline code`'), '<code>inline code</code>');
    assert.equal(renderInlineMarkdown('[Google](https://google.com)'), '<a href="https://google.com" target="_blank" rel="noopener noreferrer">Google</a>');
    assert.equal(renderInlineMarkdown('[[My Note]]'), '<span class="md-wikilink">My Note</span>');
    assert.equal(renderInlineMarkdown('[[My Note|Alias Title]]'), '<span class="md-wikilink">Alias Title</span>');
    assert.equal(renderInlineMarkdown('\\*escaped\\*'), '*escaped*');
});

test('Intra-word underscores preserve snake_case', () => {
    assert.equal(renderInlineMarkdown('user_profile_name'), 'user_profile_name');
});

test('3. Block Markdown formatting table 2.2', () => {
    const listMd = '- Apple\n- Banana';
    assert.equal(renderMarkdown(listMd), '<div class="md-content"><ul><li>Apple</li><li>Banana</li></ul></div>');

    const numListMd = '1. First\n2. Second';
    assert.equal(renderMarkdown(numListMd), '<div class="md-content"><ol><li>First</li><li>Second</li></ol></div>');

    const taskMd = '- [ ] Todo\n- [x] Done';
    const taskHtml = renderMarkdown(taskMd);
    assert.equal(taskHtml.includes('<li class="md-task"><input type="checkbox" disabled> Todo</li>'), true);
    assert.equal(taskHtml.includes('<li class="md-task"><input type="checkbox" disabled checked> Done</li>'), true);

    const quoteMd = '> Wise quote';
    assert.equal(renderMarkdown(quoteMd), '<div class="md-content"><blockquote><p>Wise quote</p></blockquote></div>');

    const hrMd = '---';
    assert.equal(renderMarkdown(hrMd), '<div class="md-content"><hr></div>');
});

test('Table rendering', () => {
    const tableMd = '| Col 1 | Col 2 |\n| :--- | :---: |\n| A | B |';
    const tableHtml = renderMarkdown(tableMd);
    assert.equal(tableHtml.includes('<table><thead><tr><th style="text-align: left">Col 1</th><th style="text-align: center">Col 2</th></tr></thead>'), true);
    assert.equal(tableHtml.includes('<tbody><tr><td style="text-align: left">A</td><td style="text-align: center">B</td></tr></tbody></table>'), true);
});

test('4. Obsidian behaviors - Soft breaks, Heading clamp, Comments, Frontmatter, Callouts, Embeds', () => {
    // Soft line break -> <br>
    const softBreakMd = 'Line 1\nLine 2';
    assert.equal(renderMarkdown(softBreakMd), '<div class="md-content"><p>Line 1<br>Line 2</p></div>');

    // Heading clamping: shallowest maps to h2
    const headingsMd = '# Level 1\n\n## Level 2\n\n### Level 3';
    const headingHtml = renderMarkdown(headingsMd);
    assert.equal(headingHtml.includes('<h2>Level 1</h2>'), true);
    assert.equal(headingHtml.includes('<h3>Level 2</h3>'), true);
    assert.equal(headingHtml.includes('<h4>Level 3</h4>'), true);

    // Deep heading clamping: min level 3 maps to h2
    const deepHeadingsMd = '### Shallow H3\n\n#### Deep H4';
    const deepHtml = renderMarkdown(deepHeadingsMd);
    assert.equal(deepHtml.includes('<h2>Shallow H3</h2>'), true);
    assert.equal(deepHtml.includes('<h3>Deep H4</h3>'), true);

    // Frontmatter & comments stripping
    const frontmatterMd = '---\ntitle: Note\n---\n\n%%secret comment%%\nVisible text';
    const cleanHtml = renderMarkdown(frontmatterMd);
    assert.equal(cleanHtml.includes('title: Note'), false);
    assert.equal(cleanHtml.includes('secret comment'), false);
    assert.equal(cleanHtml.includes('Visible text'), true);

    // Callout type normalization & alias resolution
    const calloutMd = '> [!tldr] Quick Summary\n> Body sentence';
    const calloutHtml = renderMarkdown(calloutMd);
    assert.equal(calloutHtml.includes('md-callout-abstract'), true);
    assert.equal(calloutHtml.includes('Quick Summary'), true);
    assert.equal(calloutHtml.includes('Body sentence'), true);

    // Embedded missing note
    const embedMd = 'Check ![[Embedded Architecture Note]]';
    assert.equal(renderInlineMarkdown(embedMd), 'Check <span class="md-embed-missing">[[Embedded Architecture Note]]</span>');
});

test('5. Fenced and inline code inviolability', () => {
    const codeBlock = '```js\nconst x = "**not bold** {{not_cloze}}";\n```';
    const codeHtml = renderMarkdown(codeBlock);
    assert.equal(codeHtml.includes('<strong>'), false);
    assert.equal(codeHtml.includes('class="language-js"'), true);
    assert.equal(codeHtml.includes('const x = &quot;**not bold** {{not_cloze}}&quot;;'), true);

    const inlineCode = 'Use `**not bold**` here';
    const inlineHtml = renderInlineMarkdown(inlineCode);
    assert.equal(inlineHtml, 'Use <code>**not bold**</code> here');
});

test('6. Link safety filtering', () => {
    const safeLink = '[Safe](https://example.com)';
    assert.equal(renderInlineMarkdown(safeLink).includes('<a href="https://example.com"'), true);

    const dangerousLink = '[Bad](javascript:alert(1))';
    assert.equal(renderInlineMarkdown(dangerousLink).includes('<a href='), false);
    assert.equal(renderInlineMarkdown(dangerousLink), '[Bad](javascript:alert(1))');
});

test('7. Out-of-scope syntax renders literally without error', () => {
    const outOfScope = '$E = mc^2$ and block $$a^2+b^2=c^2$$ with footnote[^1] and #tag';
    const html = renderInlineMarkdown(outOfScope);
    assert.equal(html.includes('$E = mc^2$'), true);
    assert.equal(html.includes('#tag'), true);
});

test('8. plainText extraction', () => {
    const md = '# Header\n\n**Bold** and *italic* and ==highlighted== with [Link](https://x.com) and [[Wiki Note|Alias]].';
    const text = plainText(md);
    assert.equal(text, 'Header\n\nBold and italic and highlighted with Link and Alias.');
});

test('9. Never throw on malformed input & fuzzing fragments', () => {
    const fragments = [
        '```js\nunclosed code fence',
        '> [!warning',
        '| col 1 | col 2\n| ---',
        '== lone highlight',
        '** unclosed bold',
        '[[ unclosed wikilink',
        null,
        undefined,
        123
    ];

    for (const frag of fragments) {
        assert.doesNotThrow(() => {
            renderMarkdown(frag);
            renderInlineMarkdown(frag);
            plainText(frag);
        });
    }
});

/* ---------------------------------------------------------------------------
   Regression tests from the migration audit. Each covers a defect found in the
   first implementation, so they are named for the failure they prevent rather
   than for the spec section they belong to.
   --------------------------------------------------------------------------- */

test('audit: a line the table detector rejects is still rendered, not swallowed', () => {
    // The detector used to consume lines before deciding, then fall through to
    // paragraph with the cursor already advanced — deleting the line silently.
    const html = renderMarkdown('Intro paragraph\n\n| orphan pipe line\n\nAfter paragraph');
    assert.equal(html.includes('| orphan pipe line'), true);
    assert.equal(html.includes('Intro paragraph'), true);
    assert.equal(html.includes('After paragraph'), true);
});

test('audit: pipe rows without a delimiter row stay text, losing no row', () => {
    const html = renderMarkdown('| a | b |\n| c | d |');
    assert.equal(html.includes('<table>'), false);
    assert.equal(html.includes('| a | b |'), true);
    assert.equal(html.includes('| c | d |'), true);
});

test('audit: prose containing a pipe is not a table', () => {
    const html = renderMarkdown('Use the | character to separate cloze alternatives.');
    assert.equal(html.includes('<table>'), false);
    assert.equal(
        html,
        '<div class="md-content"><p>Use the | character to separate cloze alternatives.</p></div>'
    );
});

test('audit: lists nest by indentation', () => {
    assert.equal(
        renderMarkdown('- a\n  - a1\n  - a2\n- b'),
        '<div class="md-content"><ul><li>a<ul><li>a1</li><li>a2</li></ul></li><li>b</li></ul></div>'
    );
    assert.equal(
        renderMarkdown('- a\n  - b\n    - c'),
        '<div class="md-content"><ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li></ul></div>'
    );
    // A tab indent counts the same as spaces.
    assert.equal(
        renderMarkdown('- a\n\t- b'),
        '<div class="md-content"><ul><li>a<ul><li>b</li></ul></li></ul></div>'
    );
    // Each level takes its tag from its own first item.
    assert.equal(
        renderMarkdown('- a\n  1. one\n  2. two'),
        '<div class="md-content"><ul><li>a<ol><li>one</li><li>two</li></ol></li></ul></div>'
    );
});

test('audit: nested and bare task items', () => {
    const html = renderMarkdown('- [ ] parent\n  - [x] child');
    assert.equal(html.includes('<input type="checkbox" disabled> parent<ul>'), true);
    assert.equal(html.includes('<input type="checkbox" disabled checked> child'), true);
    // `- [x]` with no trailing text is still a completed task, not a literal.
    assert.equal(renderMarkdown('- [x]').includes('disabled checked>'), true);
});

test('audit: an indented continuation line joins its item instead of vanishing', () => {
    assert.equal(
        renderMarkdown('- first line\n  continued here\n- second'),
        '<div class="md-content"><ul><li>first line continued here</li><li>second</li></ul></div>'
    );
});

test('audit: a list or table directly under prose starts its own block', () => {
    assert.equal(
        renderMarkdown('Intro line\n- one\n- two'),
        '<div class="md-content"><p>Intro line</p><ul><li>one</li><li>two</li></ul></div>'
    );
    const table = renderMarkdown('Intro line\n| a | b |\n| --- | --- |\n| 1 | 2 |');
    assert.equal(table.includes('<p>Intro line</p><table>'), true);
});

test('audit: emphasis nests in both directions', () => {
    assert.equal(
        renderMarkdown('x **bold with *italic* inside** y'),
        '<div class="md-content"><p>x <strong>bold with <em>italic</em> inside</strong> y</p></div>'
    );
    assert.equal(
        renderMarkdown('x *italic with **bold** inside* y'),
        '<div class="md-content"><p>x <em>italic with <strong>bold</strong> inside</em> y</p></div>'
    );
    assert.equal(
        renderInlineMarkdown('==highlight with *italic*=='),
        '<mark>highlight with <em>italic</em></mark>'
    );
    assert.equal(
        renderInlineMarkdown('**bold with `code`**'),
        '<strong>bold with <code>code</code></strong>'
    );
});

test('audit: a delimiter followed by a space does not open emphasis', () => {
    // Arithmetic must survive; Obsidian applies the same rule.
    assert.equal(
        renderMarkdown('2 * 3 and 4 * 5'),
        '<div class="md-content"><p>2 * 3 and 4 * 5</p></div>'
    );
    assert.equal(
        renderMarkdown('a _ b _ c'),
        '<div class="md-content"><p>a _ b _ c</p></div>'
    );
    assert.equal(plainText('2 * 3 and **bold**'), '2 * 3 and bold');
});

test('audit: %% inside code is content, not a comment', () => {
    const fenced = renderMarkdown('```js\nlet a = 1; %%keep me%%\n```');
    assert.equal(fenced.includes('%%keep me%%'), true);
    const inline = renderMarkdown('run `x %%keep%% y` now');
    assert.equal(inline.includes('%%keep%%'), true);
    // Outside code it is still stripped.
    assert.equal(renderMarkdown('visible %%hidden%% tail').includes('hidden'), false);
});

test('audit: escaped backtick does not open a code span', () => {
    assert.equal(
        renderMarkdown('literal \\`not code\\` here'),
        '<div class="md-content"><p>literal `not code` here</p></div>'
    );
    // Escapes are not processed inside code, so the backslash shows.
    assert.equal(renderInlineMarkdown('`a\\*b`'), '<code>a\\*b</code>');
});

test('audit: every escape in the spec table yields its literal character', () => {
    const cases = [
        ['a \\*x\\* b', 'a *x* b'],
        ['a \\_x\\_ b', 'a _x_ b'],
        ['a \\=\\=x\\=\\= b', 'a ==x== b'],
        ['a \\~\\~x\\~\\~ b', 'a ~~x~~ b'],
        ['a \\[x\\](y) b', 'a [x](y) b'],
        ['C:\\\\temp', 'C:\\temp']
    ];
    for (const [input, expected] of cases) {
        assert.equal(renderInlineMarkdown(input), expected);
    }
});

test('audit: author text cannot forge a parser placeholder', () => {
    // Control characters are stripped on the way in, so the NUL-delimited
    // placeholders used internally are unforgeable — an author who writes one
    // must not have their text deleted or substituted.
    for (const forged of ['text \u00000\u0000 more', 'text \u0000cloze0\u0000 more']) {
        const html = renderMarkdown(forged);
        assert.equal(html.includes('text'), true, forged);
        assert.equal(html.includes('more'), true, forged);
        assert.equal(html.includes('cloze-gap'), false, forged);
        assert.equal(html.includes('\u0000'), false, forged);
    }
    // The pre-fix placeholder shape was plain text and must survive as text.
    assert.equal(renderMarkdown('text __MD_CODE_TOKEN_0__ more').includes('MD_CODE_TOKEN_0'), true);
});

test('audit: heading clamp is a pure function, testable on its own', () => {
    assert.equal(headingDelta([3, 4, 2]), 0, 'shallowest is already h2');
    assert.equal(headingDelta([3, 4]), -1, 'h3 shifts up to h2');
    assert.equal(headingDelta([1]), 1, 'h1 shifts down to h2');
    assert.equal(headingDelta([]), 0, 'no headings, no shift');

    assert.equal(clampHeadingLevel(1, 1), 2);
    assert.equal(clampHeadingLevel(6, 1), 6, 'capped at h6');
    assert.equal(clampHeadingLevel(1, -1), 2, 'never shallower than h2');
});

test('audit: adjacent callouts stay separate', () => {
    // Continuing a callout across a blank line merged two of them and left the
    // second one's [!type] Title as literal text in the first one's body.
    const html = renderMarkdown('> [!tip] First\n> body one\n\n> [!warning] Second\n> body two');
    assert.equal(html.includes('md-callout-tip'), true);
    assert.equal(html.includes('md-callout-warning'), true);
    assert.equal(html.includes('[!warning]'), false, 'the second marker must not leak as text');
    assert.match(html, /First<\/div><div class="md-callout-body"><p>body one<\/p><\/div><\/div><div class="md-callout md-callout-warning"/);
});

test('audit: a callout paragraph break uses > on the empty line', () => {
    // This is Obsidian's way to keep one callout with two paragraphs, and it is
    // what makes the blank-line rule above safe.
    const html = renderMarkdown('> [!tip] Title\n> para one\n>\n> para two');
    assert.equal((html.match(/md-callout /g) || []).length, 1, 'still one callout');
    assert.match(html, /<p>para one<\/p><p>para two<\/p>/);
});

test('audit: a callout is ended by a blank line, not by the next block', () => {
    const html = renderMarkdown('> [!note] Note\n> body\n\nPlain paragraph.');
    assert.match(html, /<\/div><\/div><p>Plain paragraph\.<\/p>/);
});
