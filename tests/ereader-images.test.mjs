import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { renderMarkdown } from '../src/core/markdown.js';

const MODULE_URL = new URL('../src/core/markdown.js', import.meta.url).href;
const DEADLINE_MS = 5000;

const WORKER_SOURCE = `
    import { parentPort, workerData } from 'node:worker_threads';
    import { renderMarkdown } from ${JSON.stringify(MODULE_URL)};
    const out = [];
    for (const text of workerData) {
        renderMarkdown(text, { images: true });
        renderMarkdown(text);
        out.push(text);
    }
    parentPort.postMessage(out.length);
`;

/** Resolves with count or rejects if worker times out. */
function parseAllWithImages(texts) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(
            new URL(`data:text/javascript,${encodeURIComponent(WORKER_SOURCE)}`),
            { workerData: texts }
        );
        const timer = setTimeout(() => {
            worker.terminate();
            reject(new Error(`parser did not terminate within ${DEADLINE_MS}ms`));
        }, DEADLINE_MS);

        worker.on('message', (n) => { clearTimeout(timer); worker.terminate(); resolve(n); });
        worker.on('error', (err) => { clearTimeout(timer); worker.terminate(); reject(err); });
    });
}

test('1. renderMarkdown with options.images: true renders standalone https images as <figure>', () => {
    const input = '![Architecture Diagram](https://example.com/arch.png)';
    const html = renderMarkdown(input, { images: true });

    assert.ok(html.includes('<figure class="md-figure">'), 'Must emit md-figure');
    assert.ok(html.includes('<img loading="lazy" src="https://example.com/arch.png" alt="Architecture Diagram"'), 'Must emit img tag with lazy loading and src');
    assert.ok(html.includes('<figcaption>Architecture Diagram</figcaption>'), 'Must emit figcaption with alt text');
});

test('2. renderMarkdown with options.images: true renders image without alt without figcaption', () => {
    const input = '![](https://example.com/no-alt.jpg)';
    const html = renderMarkdown(input, { images: true });

    assert.ok(html.includes('<figure class="md-figure">'));
    assert.ok(html.includes('<img loading="lazy" src="https://example.com/no-alt.jpg" alt=""'));
    assert.ok(!html.includes('<figcaption>'), 'Should not emit figcaption if alt is empty');
});

test('3. renderMarkdown with options.images: true renders placeholder:id and ![[file]] as placeholder boxes', () => {
    const inputPlaceholder = '![Process Flow](placeholder:flow-chart)';
    const htmlPlaceholder = renderMarkdown(inputPlaceholder, { images: true });

    assert.ok(htmlPlaceholder.includes('<div class="md-image-placeholder" data-placeholder-id="placeholder:flow-chart">'));
    assert.ok(htmlPlaceholder.includes('<span class="md-placeholder-text">Process Flow</span>'));
    assert.ok(htmlPlaceholder.includes('<svg viewBox="0 0 24 24"'), 'Must contain placeholder SVG icon');

    const inputWiki = '![[database-schema.png]]';
    const htmlWiki = renderMarkdown(inputWiki, { images: true });

    assert.ok(htmlWiki.includes('<div class="md-image-placeholder" data-placeholder-id="database-schema.png">'));
    assert.ok(htmlWiki.includes('<span class="md-placeholder-text">database-schema.png</span>'));
});

test('4. renderMarkdown without options.images leaves output unchanged (no figure element)', () => {
    const input = '![Architecture](https://example.com/arch.png)';
    const defaultHtml = renderMarkdown(input);
    const explicitFalseHtml = renderMarkdown(input, { images: false });

    assert.equal(defaultHtml, explicitFalseHtml);
    assert.ok(!defaultHtml.includes('<figure class="md-figure">'), 'Default parser must not emit figure');
});

test('5. Image onerror fallback placeholder is present in the rendered figure', () => {
    const input = '![Broken Image](https://example.com/404.png)';
    const html = renderMarkdown(input, { images: true });

    assert.ok(html.includes('onerror="this.style.display=\'none\'; if (this.nextElementSibling) this.nextElementSibling.style.display=\'flex\';"'));
    assert.ok(html.includes('<div class="md-image-placeholder md-fallback" style="display: none;" data-placeholder-id="https://example.com/404.png">'));
});

test('6. Parser termination: malformed image inputs terminate safely within deadline', async () => {
    const malformedCases = [
        '![',
        '![]',
        '![(',
        '![](https://',
        '![](https://example.com',
        '![unclosed alt(https://example.com)',
        '![alt](https://example.com/broken link with spaces.png)',
        '![alt](http://insecure.com)', // not https, should not trigger image_https block
        '![[',
        '![[]]',
        '![[unclosed wiki',
        '![alt](placeholder:)',
        '![alt](placeholder:img-1\nnext line)',
        'prose before ![alt](https://example.com/inline.png) prose after', // inline, not standalone
        '![alt](https://example.com/1.png)\n![alt](https://example.com/2.png)\n![alt](https://example.com/3.png)'
    ];

    const count = await parseAllWithImages(malformedCases);
    assert.equal(count, malformedCases.length);
});
