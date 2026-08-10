import test, { before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

/* The rotating source strip now feeds two cards: the Odak Seri card names the
   selected sources, the Genel Seri card names the library its target is
   measured over. What needs guarding is the pairing - each card's *set*, and
   the fact that one strip's rotation cannot stop the other's. */

let AppState, renderSourceTicker, getLibraryTickerItems, getFocusTickerItems;

before(async () => {
    const dom = new JSDOM('<!doctype html><html lang="tr"><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    AppState = (await import('../src/core/state.js')).AppState;

    const uiMod = await import('../src/features/stats/continuity-ui.js');
    renderSourceTicker = uiMod.renderSourceTicker;
    getLibraryTickerItems = uiMod.getLibraryTickerItems;
    getFocusTickerItems = uiMod.getFocusTickerItems;
});

beforeEach(() => {
    global.document.body.innerHTML = '';
    AppState.folders = [];
    AppState.sources = [];
    AppState.stats = {};
    AppState.continuityConfig = { focusSources: [], focusSourceNames: {} };
});

const strip = () => {
    const el = global.document.createElement('div');
    global.document.body.appendChild(el);
    return el;
};

const shownName = (el) => el.querySelector('.source-ticker-slide.slide-in')?.firstChild?.textContent;
const shownStats = (el) => el.querySelector('.source-ticker-slide.slide-in .source-ticker-stats')?.textContent;

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const markup = new JSDOM(html).window.document;

test('both continuity cards carry a strip container', () => {
    const globalStrip = markup.getElementById('continuitySourcesList');
    const focusStrip = markup.getElementById('focusContinuitySourcesList');

    assert.ok(globalStrip, '#continuitySourcesList is missing from index.html');
    assert.ok(focusStrip, '#focusContinuitySourcesList is missing from index.html');

    assert.equal(globalStrip.closest('.continuity-slide')?.id, 'continuityCard');
    assert.equal(focusStrip.closest('.continuity-slide')?.id, 'focusContinuityCard');

    /* Absolutely positioned lines overlap during the swap, so the row has to
       clip them and reserve its own height - without that the card grows and
       shrinks by a line every 2.5 seconds. */
    for (const el of [globalStrip, focusStrip]) {
        assert.match(el.getAttribute('style'), /overflow:\s*hidden/, `${el.id} must clip the outgoing line`);
        assert.match(el.getAttribute('style'), /min-height:/, `${el.id} must reserve a row`);
    }
});

/* The Genel Seri target is built with `buildQuestionPool({ scope: 'all' })`,
   i.e. the whole library. A strip that named only the active sources would put
   a smaller set under a streak measured on a larger one. */
test('the library strip names every non-archived source, active or not', () => {
    AppState.folders = [{ id: 'f1', name: 'Klasör', order: 0 }];
    AppState.sources = [
        { id: 'lib1', name: 'Aktif', folderId: 'f1', order: 0, active: true, questions: [{ id: 1 }] },
        { id: 'lib2', name: 'Pasif', folderId: 'f1', order: 1, active: false, questions: [{ id: 1 }] },
        { id: 'lib3', name: 'Arşivli', folderId: 'f1', order: 2, active: true, archived: true, questions: [{ id: 1 }] }
    ];

    const items = getLibraryTickerItems();

    assert.deepEqual(items.map(i => i.id), ['lib1', 'lib2'], 'passive sources stay, archived ones go');
    assert.deepEqual(items.map(i => i.label), ['Aktif', 'Pasif']);
    assert.ok(items.every(i => i.measurable), 'a live source is always measurable');
});

test('the focus strip labels a selection that left the library and stops measuring it', () => {
    AppState.sources = [{ id: 'keep', name: 'Duran', active: true, questions: [{ id: 1 }] }];
    AppState.continuityConfig = {
        focusSources: ['keep', 'gone'],
        focusSourceNames: { gone: 'Silinen' }
    };

    const items = getFocusTickerItems();

    assert.equal(items.length, 2, 'a missing source is labelled, not dropped');
    assert.deepEqual(items.map(i => i.measurable), [true, false]);
    assert.equal(items[0].label, 'Duran');
    assert.match(items[1].label, /^Silinen \(.+\)$/, 'the snapshot name carries a missing marker');
});

test('a strip line carries the source name over its own count, mastery and difficulty', () => {
    AppState.sources = [{ id: 'lib1', name: 'Anatomi', active: true, questions: [{ id: 1 }, { id: 2 }] }];
    /* stability 21 caps sFactor at 1 and a review of "now" puts r at 1, so one
       of two questions answered is 50%. difficulty 6 on both halves to 3.0. */
    AppState.stats = {
        'lib1_1': { stability: 21, lastReview: new Date().toISOString(), difficulty: 6 },
        'lib1_2': { difficulty: 6 }
    };

    const el = strip();
    renderSourceTicker(el, getLibraryTickerItems());

    assert.equal(shownName(el), 'Anatomi');

    const stats = shownStats(el);
    assert.match(stats, /^2\s/, 'the question count opens the line');
    assert.ok(stats.includes('%50'), `mastery is missing from "${stats}"`);
    assert.ok(stats.includes('3.0'), `average difficulty is missing from "${stats}"`);
});

test('an empty item list clears the strip', () => {
    AppState.sources = [{ id: 'lib1', name: 'Anatomi', active: true, questions: [{ id: 1 }] }];

    const el = strip();
    renderSourceTicker(el, getLibraryTickerItems());
    assert.equal(el.querySelectorAll('.source-ticker-slide').length, 1);

    renderSourceTicker(el, []);
    assert.equal(el.querySelectorAll('.source-ticker-slide').length, 0, 'no source means no leftover line');
});

/* The timer is kept per list element. One module-level handle would be enough
   for a single card, and would silently stop the first strip the moment the
   second one rendered - the two cards render on different triggers, so the
   Genel strip would freeze on whichever source it happened to be showing. */
test('two strips rotate independently', () => {
    mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    try {
        const items = [
            { id: 'a', label: 'Bir', measurable: false },
            { id: 'b', label: 'İki', measurable: false }
        ];

        const first = strip();
        const second = strip();
        renderSourceTicker(first, items);
        renderSourceTicker(second, items);

        assert.equal(shownName(first), 'Bir');
        assert.equal(shownName(second), 'Bir');

        mock.timers.tick(2500);

        assert.equal(shownName(first), 'İki', 'the first strip stopped when the second rendered');
        assert.equal(shownName(second), 'İki');

        mock.timers.tick(2500);

        assert.equal(shownName(first), 'Bir', 'the rotation wraps');
        assert.equal(shownName(second), 'Bir');
    } finally {
        mock.timers.reset();
    }
});

test('a single source does not rotate', () => {
    mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    try {
        const el = strip();
        renderSourceTicker(el, [{ id: 'a', label: 'Bir', measurable: false }]);

        mock.timers.tick(2500);

        /* A swap appends the incoming line before the outgoing one is removed
           400ms later, so a second node here means the strip animated a line
           into itself. */
        assert.equal(el.querySelectorAll('.source-ticker-slide').length, 1);
        assert.equal(shownName(el), 'Bir');
    } finally {
        mock.timers.reset();
    }
});

test('re-rendering a strip does not leave the old rotation running', () => {
    mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    try {
        const el = strip();
        renderSourceTicker(el, [
            { id: 'a', label: 'Bir', measurable: false },
            { id: 'b', label: 'İki', measurable: false }
        ]);
        renderSourceTicker(el, [
            { id: 'c', label: 'Üç', measurable: false },
            { id: 'd', label: 'Dört', measurable: false }
        ]);

        mock.timers.tick(2500);

        assert.equal(shownName(el), 'Dört', 'a stale timer would advance the strip twice');
        assert.equal(el.querySelectorAll('.source-ticker-slide').length, 2, 'one outgoing line, one incoming');
    } finally {
        mock.timers.reset();
    }
});
