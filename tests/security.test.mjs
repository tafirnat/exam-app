import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let isSafeUrl, renderMarkdown, sanitizeImportedData;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    ({ isSafeUrl, renderMarkdown } = await import('../src/core/markdown.js'));
    ({ sanitizeImportedData } = await import('../src/features/sources/sources-service.js'));
});

test('isSafeUrl rejects malicious protocols and accepts safe ones', () => {
    // Malicious
    assert.strictEqual(isSafeUrl('javascript:alert(1)'), false);
    assert.strictEqual(isSafeUrl('JAVASCRIPT:alert(1)'), false);
    assert.strictEqual(isSafeUrl('vbscript:msgbox(1)'), false);
    assert.strictEqual(isSafeUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='), false);
    assert.strictEqual(isSafeUrl(''), false);
    assert.strictEqual(isSafeUrl(null), false);

    // Safe
    assert.strictEqual(isSafeUrl('https://example.com'), true);
    assert.strictEqual(isSafeUrl('http://example.com/test'), true);
    assert.strictEqual(isSafeUrl('mailto:user@example.com'), true);
    assert.strictEqual(isSafeUrl('file:///path/to/file'), true);
    assert.strictEqual(isSafeUrl('/relative/path'), true);
    assert.strictEqual(isSafeUrl('#section'), true);
});

test('renderMarkdown neutralizes javascript: links', () => {
    const maliciousMarkdown = '[Click Me](javascript:alert("xss"))';
    const html = renderMarkdown(maliciousMarkdown);
    assert.strictEqual(html.includes('href="javascript:'), false);
});

test('sanitizeImportedData strips prototype pollution keys', () => {
    const maliciousJSON = {
        exam_metadata: { title: 'Test Exam' },
        __proto__: { polluted: true },
        constructor: { name: 'Fake' },
        questions: [
            {
                id: 'q1',
                type: 'single_choice',
                text: 'Safe Question',
                prototype: 'bad'
            }
        ]
    };

    const sanitized = sanitizeImportedData(maliciousJSON);

    assert.strictEqual(Object.prototype.polluted, undefined);
    assert.strictEqual(sanitized.__proto__, Object.prototype);
    assert.strictEqual(sanitized.questions[0].prototype, undefined);
    assert.strictEqual(sanitized.exam_metadata.title, 'Test Exam');
    assert.strictEqual(sanitized.questions[0].id, 'q1');
});
