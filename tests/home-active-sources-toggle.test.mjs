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

/* The home readiness tile is the mean of these rows. A row that renders its
   own mastery is what lets the user check that mean against its terms, so the
   number has to be the same calculation - not an approximation of it. */
test('each active source row shows its own topic mastery', () => {
    AppState.sources = [
        { id: 's1', name: 'Studied', active: true, questions: [{ id: 1 }, { id: 2 }] },
        { id: 's2', name: 'Untouched', active: true, questions: [{ id: 1 }] }
    ];
    /* stability 21 caps sFactor at 1 and a review of "now" puts r at 1, so the
       question contributes a full point: one of two questions answered is 50%. */
    AppState.stats = {
        's1_1': { stability: 21, lastReview: new Date().toISOString() }
    };

    renderHomeActiveSources();

    const rows = global.document.querySelectorAll('#homeActiveSourcesList .active-source-row');
    assert.equal(rows.length, 2);

    const mastery = [...rows].map(r => r.querySelector('.active-source-mastery')?.textContent);
    assert.deepEqual(mastery, ['50%', '0%'], 'each row carries its own mastery');

    assert.match(
        rows[0].querySelector('.active-source-mastery').title,
        /50%/,
        'the value is reachable as a tooltip too'
    );
});

/* Mastery comes out of AppState.stats, but this consumer used to subscribe to
   sources and folders only. Without the stats slice the rows keep whatever
   value they had when the library last changed, so a whole session of work
   leaves them untouched - and nothing else on the home screen would say so.
   The row-rendering test above passes either way, which is why the wiring
   needs a case of its own. */
test('the home active-sources consumer redraws on stats changes', async () => {
    const bindings = readFileSync(new URL('../src/core/ui-bindings.js', import.meta.url), 'utf8');
    const entry = bindings.slice(bindings.indexOf("name: 'home:activeSources'"));
    const slices = entry.slice(entry.indexOf('slices:'), entry.indexOf(']', entry.indexOf('slices:')));

    assert.match(slices, /Slice\.STATS/, 'home:activeSources must follow the stats slice');
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
