import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderInlineMarkdown, plainText } from '../src/core/markdown.js';

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
