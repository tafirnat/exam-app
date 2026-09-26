import test, { before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { searchBook } from '../src/features/ereader/ereader-search.js';

let storage, store, ereaderStore, reader, shell, imp;

function makeIdb() {
    const map = new Map();
    return {
        map,
        get: async key => (map.has(key) ? map.get(key) : undefined),
        set: async (key, value) => { map.set(key, value); return true; },
        del: async key => { map.delete(key); return true; }
    };
}

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

function turkishBookJson() {
    return {
        ereader: {
            schema: 1,
            book_key: 'turkish-test',
            title: 'Türkçe Kitap',
            author: 'Yazar',
            language: 'tr',
            source_type: 'other'
        },
        sections: [
            { id: 's1', title: 'Giriş', level: 1, text: 'Bu kitap istanbul şehrinin tarihi üzerine yazılmıştır.' },
            { id: 's2', title: 'İkinci Bölüm', level: 1, text: 'Isparta ve çevresindeki göller anlatılmaktadır.' },
            { id: 's3', title: 'Üçüncü Bölüm', level: 1, text: 'Burada çok uzun bir metin var. '.repeat(10) + 'Önemli kelime: hedefkelime burada yer alıyor. ' + 'Devam metni burada. '.repeat(10) },
            { id: 's4', title: 'Dördüncü Bölüm', level: 1, text: 'hedefkelime tekrar geçiyor ama sınır için.' },
            { id: 's5', title: 'Beşinci Bölüm', level: 1, text: 'hedefkelime bir kez daha.' }
        ]
    };
}

const views = [];
const switchView = (v, isBack) => { views.push([v, !!isBack]); };

before(async () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
    dom.window.scrollTo = () => {};

    storage = await import('../src/core/storage.js');
    store = await import('../src/core/store.js');
    ereaderStore = await import('../src/features/ereader/ereader-store.js');
    reader = await import('../src/features/ereader/ereader-reader-ui.js');
    shell = await import('../src/features/ereader/ereader-shell.js');
    imp = await import('../src/features/ereader/ereader-import.js');
});

beforeEach(async () => {
    storage._setIdbBackendForTests(makeIdb());
    ereaderStore._resetEreaderStoreForTests();
    reader._resetEreaderReaderForTests();
    store._reset();
    views.length = 0;
    reader.bindEreaderReader({ switchView, closeMenu: () => {} });
    document.getElementById('ereaderContent').replaceChildren();
    document.getElementById('ereaderTocList').replaceChildren();
    await ereaderStore.loadEreader();
});

afterEach(() => {
    storage._setIdbBackendForTests(null);
});

// ── Search Unit Tests ──────────────────────────────────────────────────────

test('1. Turkish case folding: İstanbul matches istanbul and vice versa', () => {
    const book = turkishBookJson();
    // Search with uppercase dotted İ
    const resUpper = searchBook(book, 'İstanbul');
    assert.equal(resUpper.length, 1);
    assert.equal(resUpper[0].sectionId, 's1');

    // Search with lowercase i
    const resLower = searchBook(book, 'istanbul');
    assert.equal(resLower.length, 1);
    assert.equal(resLower[0].sectionId, 's1');

    // Search with dotless ı / uppercase I
    const resDotless = searchBook(book, 'ısparta');
    assert.equal(resDotless.length, 1);
    assert.equal(resDotless[0].sectionId, 's2');

    const resUpperI = searchBook(book, 'Isparta');
    assert.equal(resUpperI.length, 1);
    assert.equal(resUpperI[0].sectionId, 's2');
});

test('2. Query under 2 characters or whitespace returns empty array', () => {
    const book = turkishBookJson();
    assert.deepEqual(searchBook(book, ''), []);
    assert.deepEqual(searchBook(book, 'a'), []);
    assert.deepEqual(searchBook(book, '  '), []);
    assert.deepEqual(searchBook(book, ' İ '), []); // trimmed length 1
});

test('3. Limit caps the number of results returned', () => {
    const book = turkishBookJson();
    const resLimit2 = searchBook(book, 'hedefkelime', { limit: 2 });
    assert.equal(resLimit2.length, 2);

    const resAll = searchBook(book, 'hedefkelime', { limit: 50 });
    assert.equal(resAll.length, 3);
});

test('4. Snippet is trimmed and wrapped with ellipsis when truncated', () => {
    const book = turkishBookJson();
    const res = searchBook(book, 'hedefkelime');
    assert.ok(res.length > 0);
    const item = res[0];
    assert.ok(item.snippet.includes('hedefkelime'));
    assert.ok(item.snippet.startsWith('...'), 'Snippet preceded by text must start with ellipsis');
    assert.ok(item.snippet.endsWith('...'), 'Snippet followed by text must end with ellipsis');
});

test('5. Search matches in title as well as body text', () => {
    const book = turkishBookJson();
    const res = searchBook(book, 'İkinci');
    assert.equal(res.length, 1);
    assert.equal(res.sectionId, undefined);
    assert.equal(res[0].sectionId, 's2');
    assert.equal(res[0].title, 'İkinci Bölüm');
});

// ── Fullscreen / Zen Mode Tests ────────────────────────────────────────────

test('6. Fullscreen enter hides header and shows zen exit button; exit restores header', async () => {
    const { book } = await imp.importEreaderJson(turkishBookJson());
    await reader.openBook(book.id, { switchView });
    reader.enterBookView();

    const header = document.querySelector('header');
    const exitBtn = document.getElementById('ereaderZenExitBtn');
    assert.ok(header);
    assert.ok(exitBtn);

    // Initial state
    shell.applyEreaderChrome('ereaderBook', { goHome: () => {} });
    assert.equal(header.style.display, 'flex');
    assert.equal(exitBtn.style.display, 'none');

    // Enter fullscreen
    reader.enterFullscreen();
    assert.equal(header.style.display, 'none');
    assert.equal(exitBtn.style.display, 'flex');
    assert.equal(reader.isZenFullscreen(), true);

    // Exit fullscreen
    reader.exitFullscreen();
    assert.equal(exitBtn.style.display, 'none');
    assert.equal(header.style.display, 'flex');
    assert.equal(reader.isZenFullscreen(), false);
});

test('7. Escape key exits fullscreen or closes search bar', async () => {
    const { book } = await imp.importEreaderJson(turkishBookJson());
    await reader.openBook(book.id, { switchView });
    reader.enterBookView();

    // Test Search bar Esc
    reader.openSearchBar();
    assert.equal(reader.isSearchBarOpen(), true);
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(reader.isSearchBarOpen(), false);

    // Test Zen Fullscreen Esc
    reader.enterFullscreen();
    assert.equal(reader.isZenFullscreen(), true);
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(reader.isZenFullscreen(), false);
    assert.equal(document.querySelector('header').style.display, 'flex');
});

test('8. A language that is not a valid locale does not break search', async () => {
    const { searchLocale } = await import('../src/features/ereader/ereader-search.js');
    assert.equal(searchLocale('en_US'), 'en-US');
    assert.equal(searchLocale('tr'), 'tr');
    assert.equal(searchLocale('Türkçe'), 'und');
    assert.equal(searchLocale(''), 'und');
    assert.equal(searchLocale(undefined), 'und');

    for (const language of ['en_US', 'Türkçe', 'english language']) {
        const book = {
            language,
            sections: [{ id: 's1', title: 'Hello', level: 1, text: 'hello world' }]
        };
        const results = searchBook(book, 'hello');
        assert.equal(results.length, 1, `search must work for language "${language}"`);
    }
});

test('R2-01: search is a focused overlay outside the book view, opened by Ctrl+K and closed by the backdrop', async () => {
    const overlay = document.getElementById('ereaderSearchOverlay');
    assert.ok(overlay, 'the search overlay exists');
    assert.equal(document.getElementById('ereaderBookView').contains(overlay), false, 'not an inline bar inside the book');
    assert.ok(overlay.querySelector('.ereader-search-footer.ereader-desktop-only'), 'shortcut hints are desktop-only');

    const { book } = await imp.importEreaderJson(turkishBookJson());
    await reader.openBook(book.id, { switchView });
    reader.enterBookView();

    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    assert.equal(reader.isSearchBarOpen(), true, 'Ctrl+K opens the search');

    overlay.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(reader.isSearchBarOpen(), false, 'a click on the backdrop closes it');
});

test('R2-01: arrow keys move through the matches and Enter opens the selected one', async () => {
    const { book } = await imp.importEreaderJson(turkishBookJson());
    await reader.openBook(book.id, { switchView });
    reader.enterBookView();
    reader.openSearchBar();

    const input = document.getElementById('ereaderSearchInput');
    input.value = 'hedefkelime';
    input.dispatchEvent(new window.Event('input'));
    const items = () => [...document.querySelectorAll('#ereaderSearchResults .ereader-search-item')];
    assert.equal(items().length, 3);
    assert.ok(items()[0].classList.contains('active'), 'the first match is preselected');

    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.ok(items()[1].classList.contains('active'));
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    assert.ok(items()[2].classList.contains('active'), 'Up from the first wraps to the last');

    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    assert.equal(reader.isSearchBarOpen(), false, 'opening a match closes the overlay');
    assert.ok(document.querySelector('#ereaderContent [data-section-id="s5"]'), 'the chosen match is shown');
    assert.ok(document.querySelector('#ereaderContent .search-highlight'), 'its highlight stays in the text');
});
