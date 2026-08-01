import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// A modal that ends up nested inside another modal inherits that ancestor's
// `display: none` and can never be shown, no matter what the JS does — the
// symptom is a button that silently "does nothing". An unclosed <div> higher up
// the file is enough to cause it, so the structure is asserted here rather than
// trusted.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const document = new JSDOM(html).window.document;

const OVERLAY_SELECTOR = '.modal-overlay, .modal';

test('every modal overlay is a direct child of <body>', () => {
    const misplaced = [...document.querySelectorAll(OVERLAY_SELECTOR)]
        .filter(el => el.parentElement !== document.body)
        .map(el => `#${el.id || el.className} inside #${el.parentElement.closest(OVERLAY_SELECTOR)?.id || el.parentElement.tagName}`);

    assert.deepEqual(misplaced, [], `modal(s) nested inside another element: ${misplaced.join(', ')}`);
});

test('no modal overlay contains another modal overlay', () => {
    const nested = [...document.querySelectorAll(OVERLAY_SELECTOR)]
        .filter(el => el.querySelector(OVERLAY_SELECTOR))
        .map(el => el.id || el.className);

    assert.deepEqual(nested, [], `modal(s) wrapping other modals: ${nested.join(', ')}`);
});

test('continuity popups the carousel icons open are reachable', () => {
    for (const id of ['infoPopupOverlay', 'focusSourceModal']) {
        const el = document.getElementById(id);
        assert.ok(el, `#${id} is missing from index.html`);
        assert.equal(el.parentElement, document.body, `#${id} must sit directly on <body> to be displayable`);
    }
});
