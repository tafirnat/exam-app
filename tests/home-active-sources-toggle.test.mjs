import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let AppState, renderHomeActiveSources;

before(async () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    const stateMod = await import('../src/core/state.js');
    AppState = stateMod.AppState;

    const sourcesUiMod = await import('../src/features/sources/sources-ui.js');
    renderHomeActiveSources = sourcesUiMod.renderHomeActiveSources;
});

test('homeActiveSourcesHeader exists in DOM with toggle attributes', () => {
    const header = global.document.getElementById('homeActiveSourcesHeader');
    const countSpan = global.document.getElementById('homeActiveSourcesCount');
    const chevron = global.document.getElementById('homeActiveSourcesChevron');
    const list = global.document.getElementById('homeActiveSourcesList');

    assert.ok(header, 'homeActiveSourcesHeader should exist');
    assert.ok(countSpan, 'homeActiveSourcesCount should exist');
    assert.ok(chevron, 'homeActiveSourcesChevron should exist');
    assert.ok(list, 'homeActiveSourcesList should exist');
});

test('renderHomeActiveSources displays active source count and defaults to closed', () => {
    AppState.sources = [
        { id: 's1', name: 'Source 1', active: true, questions: [1, 2] },
        { id: 's2', name: 'Source 2', active: true, questions: [1] },
        { id: 's3', name: 'Source 3', active: false, questions: [1] }
    ];

    renderHomeActiveSources();

    const section = global.document.getElementById('homeActiveSourcesSection');
    const list = global.document.getElementById('homeActiveSourcesList');
    const countSpan = global.document.getElementById('homeActiveSourcesCount');

    assert.equal(section.style.display, 'block');
    assert.equal(list.style.display, 'none', 'Should default to closed (display: none)');
    assert.match(countSpan.textContent, /\(.*\:\s*2\)/, 'Count span should show 2 active sources');
});

test('clicking homeActiveSourcesHeader toggles list open and closed', () => {
    AppState.sources = [
        { id: 's1', name: 'Source 1', active: true, questions: [1] }
    ];

    renderHomeActiveSources();

    const header = global.document.getElementById('homeActiveSourcesHeader');
    const list = global.document.getElementById('homeActiveSourcesList');
    const chevron = global.document.getElementById('homeActiveSourcesChevron');

    // Default closed
    assert.equal(list.style.display, 'none');

    // Click to open
    header.click();
    assert.equal(list.style.display, 'flex', 'List should open on click');
    assert.equal(header.getAttribute('aria-expanded'), 'true');
    assert.equal(chevron.style.transform, 'rotate(180deg)');

    // Click to close
    header.click();
    assert.equal(list.style.display, 'none', 'List should close on second click');
    assert.equal(header.getAttribute('aria-expanded'), 'false');
    assert.equal(chevron.style.transform, 'rotate(0deg)');
});
