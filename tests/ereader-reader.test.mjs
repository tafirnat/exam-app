import test, { before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let storage, store, ereaderStore, reader, shell, imp, t;

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

/** Three chapters: level-1 sections start one, level-2 sections belong to it. */
function bookJson(sections) {
    return {
        ereader: { schema: 1, book_key: 'reader-test', title: 'Reader Test', author: 'A', language: 'en', source_type: 'pdf' },
        sections: sections || [
            { id: 's1', title: 'Chapter One', level: 1, text: 'Alpha text.' },
            { id: 's2', title: 'One point one', level: 2, text: 'Beta text.' },
            { id: 's3', title: 'Chapter Two', level: 1, text: 'Gamma text.' },
            { id: 's4', title: 'Two point one', level: 2, text: 'Delta text.' },
            { id: 's5', title: 'Chapter Three', level: 1, text: 'Epsilon text.' }
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
    delete global.requestAnimationFrame;

    storage = await import('../src/core/storage.js');
    store = await import('../src/core/store.js');
    ereaderStore = await import('../src/features/ereader/ereader-store.js');
    reader = await import('../src/features/ereader/ereader-reader-ui.js');
    shell = await import('../src/features/ereader/ereader-shell.js');
    imp = await import('../src/features/ereader/ereader-import.js');
    ({ t } = await import('../src/core/i18n.js'));
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

async function addAndOpen(json = bookJson()) {
    const { book } = await imp.importEreaderJson(json);
    await reader.openBook(book.id, { switchView });
    assert.ok(reader.enterBookView(), 'the view must accept an open book');
    return book;
}

const shownSectionIds = () => [...document.querySelectorAll('#ereaderContent .ereader-section')].map(s => s.dataset.sectionId);
const nav = () => ({
    prev: document.getElementById('ereaderPrevBtn').disabled,
    next: document.getElementById('ereaderNextBtn').disabled,
    pos: document.getElementById('ereaderChapterPos').textContent
});

// ── drawing ────────────────────────────────────────────────────────────────

test('only the open chapter is in the DOM', async () => {
    await addAndOpen();
    assert.deepEqual(shownSectionIds(), ['s1', 's2']);
    assert.ok(!document.getElementById('ereaderContent').textContent.includes('Gamma'));
});

test('a section title becomes a heading one level below its own; no title, no heading', async () => {
    await addAndOpen(bookJson([
        { id: 'a', title: 'Top', level: 1, text: 'x' },
        { id: 'b', title: '', level: 2, text: 'untitled body' }
    ]));
    const [a, b] = document.querySelectorAll('#ereaderContent .ereader-section');
    assert.equal(a.querySelector('h2')?.textContent, 'Top');
    assert.equal(b.querySelector('h1, h2, h3, h4, h5, h6'), null);
    assert.ok(b.textContent.includes('untitled body'));
});

test('markup in the book text is shown, never run', async () => {
    await addAndOpen(bookJson([
        { id: 'x"><img src=x onerror=alert(1)>', title: '<script>window.__ran=1</script>', level: 1, text: '<script>window.__ran=1</script> <img src=x onerror="window.__ran=1">' }
    ]));
    const content = document.getElementById('ereaderContent');
    assert.equal(content.querySelector('script'), null);
    assert.equal(content.querySelector('img'), null);
    assert.equal(window.__ran, undefined);
    assert.equal(content.querySelectorAll('.ereader-section').length, 1, 'a hostile id must not break out of its attribute');
});

test('the header shows the book title while it is open', async () => {
    await addAndOpen();
    const header = document.getElementById('headerTitle');
    assert.equal(header.textContent, 'Reader Test');
    assert.equal(header.hasAttribute('data-i18n'), false, 'a language change must not overwrite the book title');
});

// ── previous / next ────────────────────────────────────────────────────────

test('previous is disabled on the first chapter, next on the last', async () => {
    await addAndOpen();
    assert.deepEqual(nav(), { prev: true, next: false, pos: '1 / 3' });
    await reader.goToChapter(1);
    assert.deepEqual(nav(), { prev: false, next: false, pos: '2 / 3' });
    assert.deepEqual(shownSectionIds(), ['s3', 's4']);
    await reader.goToChapter(2);
    assert.deepEqual(nav(), { prev: false, next: true, pos: '3 / 3' });
    await reader.goToChapter(3);
    assert.deepEqual(shownSectionIds(), ['s5'], 'past the end stays on the last chapter');
});

test('changing chapter writes the position, weighted by text length', async () => {
    const book = await addAndOpen();
    await reader.goToChapter(1);
    const p = ereaderStore.getProgress(book.id);
    assert.equal(p.sectionId, 's3');
    assert.ok(p.percent > 30 && p.percent < 70, `percent ${p.percent} must reflect the chapters before`);
});

// ── position ───────────────────────────────────────────────────────────────

test('a book opens at the chapter of its saved section', async () => {
    const { book } = await imp.importEreaderJson(bookJson());
    await ereaderStore.setProgress(book.id, { sectionId: 's4', offset: 0.5, percent: 50 });
    await reader.openBook(book.id, { switchView });
    reader.enterBookView();
    assert.deepEqual(shownSectionIds(), ['s3', 's4']);
    assert.equal(nav().pos, '2 / 3');
});

test('opening a book records it as the last opened and switches to the book view', async () => {
    const { book } = await imp.importEreaderJson(bookJson());
    await reader.openBook(book.id, { switchView });
    assert.equal(ereaderStore.getPrefs().lastBookId, book.id);
    assert.deepEqual(views.at(-1), ['ereaderBook', false]);
});

test('a missing book is not opened', async () => {
    assert.equal(await reader.openBook('book_nope', { switchView }), false);
    assert.equal(views.length, 0);
});

test('the book view with no open book sends the reader to the library', async () => {
    shell.bindEreaderShell({ switchView, closeMenu: () => {} });
    assert.equal(reader.enterBookView(), false);
    shell.applyEreaderChrome('ereaderBook', { goHome: () => {} });
    await tick();
    assert.deepEqual(views.at(-1), ['ereaderLibrary', true]);
});

// ── contents ───────────────────────────────────────────────────────────────

test('the contents list every section, indented by level, the open one marked', async () => {
    await addAndOpen();
    reader.renderEreaderToc();
    const items = [...document.querySelectorAll('#ereaderTocList .ereader-toc-item')];
    assert.deepEqual(items.map(i => i.dataset.sectionId), ['s1', 's2', 's3', 's4', 's5']);
    assert.deepEqual(items.map(i => i.style.getPropertyValue('--toc-depth')), ['0', '1', '0', '1', '0']);
    assert.deepEqual(items.filter(i => i.classList.contains('active')).map(i => i.dataset.sectionId), ['s1']);
});

test('a contents entry in another chapter opens that chapter and marks it', async () => {
    const book = await addAndOpen();
    reader.renderEreaderToc();
    document.querySelector('#ereaderTocList [data-section-id="s5"]').click();
    await tick(5);
    assert.deepEqual(shownSectionIds(), ['s5']);
    assert.equal(document.querySelector('#ereaderTocList .ereader-toc-item.active')?.dataset.sectionId, 's5');
    assert.equal(ereaderStore.getProgress(book.id).sectionId, 's5');
});

test('opening a book opens the contents section of the menu', async () => {
    document.querySelector('#ereaderTocMenuSection .menu-section-header').classList.remove('active');
    await addAndOpen();
    assert.ok(document.querySelector('#ereaderTocMenuSection .menu-section-header').classList.contains('active'));
});

// ── font size ──────────────────────────────────────────────────────────────

test('font size steps through the scale and stops at both ends', async () => {
    await addAndOpen();
    const dec = document.getElementById('ereaderFontDecBtn');
    const inc = document.getElementById('ereaderFontIncBtn');
    const value = document.getElementById('ereaderFontValue');
    assert.equal(value.textContent, '100%');

    assert.equal(await reader.changeFontScale(-1), 0.875);
    assert.equal(dec.disabled, true);
    assert.equal(await reader.changeFontScale(-1), 0.875, 'no step below the smallest');

    for (let i = 0; i < 10; i++) await reader.changeFontScale(1);
    assert.equal(ereaderStore.getPrefs().fontScale, 1.5);
    assert.equal(inc.disabled, true);
    assert.equal(value.textContent, '150%');
    assert.equal(document.getElementById('ereaderContent').style.getPropertyValue('--ereader-font-scale'), '1.5');
});

test('a font change keeps the same chapter open', async () => {
    await addAndOpen();
    await reader.goToChapter(1);
    await reader.changeFontScale(1);
    assert.deepEqual(shownSectionIds(), ['s3', 's4']);
});

// ── the open book changes underneath ───────────────────────────────────────

test('an edit to the open book is redrawn at the same chapter', async () => {
    const book = await addAndOpen();
    await reader.goToChapter(1);
    await tick(2);
    await ereaderStore.updateBook(book.id, b => { b.sections.find(s => s.id === 's3').text = 'Rewritten gamma.'; }, { fromSync: true });
    await reader.refreshOpenBook();
    assert.deepEqual(shownSectionIds(), ['s3', 's4']);
    assert.ok(document.getElementById('ereaderContent').textContent.includes('Rewritten gamma.'));
});

test('a deleted open book sends the reader back to the library', async () => {
    const book = await addAndOpen();
    await ereaderStore.deleteBook(book.id, { fromSync: true });
    await reader.refreshOpenBook();
    assert.deepEqual(views.at(-1), ['ereaderLibrary', true]);
    assert.equal(reader.getOpenBook(), null);
});

// ── fixes 1, 3, 4 ─────────────────────────────────────────────────────────

test('1. changeFontScale calculates anchorDelta = anchorEl.getBoundingClientRect().top without negation', async () => {
    await addAndOpen();
    const sectionEls = document.querySelectorAll('#ereaderContent .ereader-section');
    sectionEls[0].getBoundingClientRect = () => ({ top: 120, bottom: 220, height: 100 });

    const scrollCalls = [];
    global.window.scrollTo = (opts) => { scrollCalls.push(opts); };

    await reader.changeFontScale(1);

    assert.ok(scrollCalls.length > 0);
    const lastScroll = scrollCalls[scrollCalls.length - 1];
    assert.equal(lastScroll.top, 0, 'anchor delta must correctly preserve the top offset without negative inversion');
});

test('3. saving image URL for wiki-embed targets only image syntax, preserving matching normal text', async () => {
    const customBook = {
        ereader: { schema: 1, book_key: 'img-test', title: 'Image Test', author: 'A', language: 'en', source_type: 'obsidian' },
        sections: [
            {
                id: 's1',
                title: 'Chapter 1',
                level: 1,
                text: 'See the diagram below:\n\n![[my-diagram]]\n\nNote: (my-diagram) is essential for understanding.'
            }
        ]
    };
    const book = await addAndOpen(customBook);

    reader.openImageUrlModal('my-diagram');

    const input = document.getElementById('ereaderImageUrlInput');
    const saveBtn = document.getElementById('ereaderImageUrlSaveBtn');
    input.value = 'https://example.com/images/diag.png';
    await saveBtn.onclick();

    const updated = await ereaderStore.getBook(book.id);
    const text = updated.sections[0].text;
    assert.ok(text.includes('![my-diagram](https://example.com/images/diag.png)'), 'Image markdown should be updated with new URL');
    assert.ok(text.includes('Note: (my-diagram) is essential for understanding.'), 'Normal text with parentheses should remain unchanged');
});

test('4. saving image URL preserves reader anchor and does not jump reader to chapter start', async () => {
    const customBook = {
        ereader: { schema: 1, book_key: 'anchor-test', title: 'Anchor Test', author: 'A', language: 'en', source_type: 'obsidian' },
        sections: [
            { id: 's1', title: 'Chapter 1', level: 1, text: 'Top text.' },
            { id: 's2', title: 'Section 2', level: 2, text: '![[diagram-anchor]]\n\nSecond section text.' }
        ]
    };
    const book = await addAndOpen(customBook);

    const s2El = document.querySelector('[data-section-id="s2"]');
    const s1El = document.querySelector('[data-section-id="s1"]');
    s1El.getBoundingClientRect = () => ({ top: -200, bottom: -100, height: 100 });
    s2El.getBoundingClientRect = () => ({ top: 50, bottom: 250, height: 200 });

    const scrollCalls = [];
    global.window.scrollTo = (opts) => { scrollCalls.push(opts); };

    reader.openImageUrlModal('diagram-anchor');
    const input = document.getElementById('ereaderImageUrlInput');
    const saveBtn = document.getElementById('ereaderImageUrlSaveBtn');
    input.value = 'https://example.com/img.png';
    await saveBtn.onclick();

    const updated = await ereaderStore.getBook(book.id);
    assert.ok(updated.sections[1].text.includes('https://example.com/img.png'));
    assert.ok(scrollCalls.length > 0);
    assert.equal(reader.getOpenBook().id, book.id);
    await reader.flushPosition();
    const currentProgress = ereaderStore.getProgress(book.id);
    assert.equal(currentProgress?.sectionId, 's2', 'Preserved sectionId should be s2');
});

test('5. saving image URL containing dollar signs ($) does not corrupt URL', async () => {
    const customBook = {
        ereader: { schema: 1, book_key: 'dollar-test', title: 'Dollar Test', author: 'A', language: 'en', source_type: 'obsidian' },
        sections: [
            {
                id: 's1',
                title: 'Chapter 1',
                level: 1,
                text: 'See the diagram below:\n\n![Diagram](diag-dollar)\n\n![Placeholder](placeholder:diag-ph)'
            }
        ]
    };
    const book = await addAndOpen(customBook);

    reader.openImageUrlModal('diag-dollar');
    const input = document.getElementById('ereaderImageUrlInput');
    const saveBtn = document.getElementById('ereaderImageUrlSaveBtn');
    input.value = 'https://example.com/images/diag.png?tag=$foo&param=$1&other=$&';
    await saveBtn.onclick();

    let updated = await ereaderStore.getBook(book.id);
    assert.ok(updated.sections[0].text.includes('![Diagram](https://example.com/images/diag.png?tag=$foo&param=$1&other=$&)'), 'Dollar signs must be preserved literally');

    reader.openImageUrlModal('placeholder:diag-ph');
    input.value = 'https://example.com/images/ph.png?price=$50&code=$2';
    await saveBtn.onclick();

    updated = await ereaderStore.getBook(book.id);
    assert.ok(updated.sections[0].text.includes('![Placeholder](https://example.com/images/ph.png?price=$50&code=$2)'), 'Dollar signs in placeholder: must be preserved literally');
});

test('6. saving image URL with parentheses encodes them and keeps image renderable', async () => {
    const customBook = {
        ereader: { schema: 1, book_key: 'paren-test', title: 'Parentheses Test', author: 'A', language: 'en', source_type: 'obsidian' },
        sections: [
            {
                id: 's1',
                title: 'Chapter 1',
                level: 1,
                text: 'See the figure below:\n\n![Fig](placeholder:img-1)'
            }
        ]
    };
    const book = await addAndOpen(customBook);

    reader.openImageUrlModal('placeholder:img-1');
    const input = document.getElementById('ereaderImageUrlInput');
    const saveBtn = document.getElementById('ereaderImageUrlSaveBtn');
    input.value = 'https://upload.wikimedia.org/Foo_(bar).png';
    await saveBtn.onclick();

    const updated = await ereaderStore.getBook(book.id);
    const text = updated.sections[0].text;
    assert.ok(text.includes('![Fig](https://upload.wikimedia.org/Foo_%28bar%29.png)'));
    assert.equal(text.includes('placeholder:img-1'), false);
});


test('7. the missing start of a book imported from a later page is listed before its first section', async () => {
    const json = bookJson();
    json.ereader.part = { unit: 'page', from: 50, to: 80, total: 100 };
    await addAndOpen(json);
    reader.renderEreaderToc();

    const entries = [...document.querySelectorAll('#ereaderTocList > *')];
    const first = entries[0];
    assert.ok(first.classList.contains('ereader-toc-gap'), 'the gap comes first, before s1');
    assert.equal(first.dataset.gapFrom, '1');
    assert.equal(first.dataset.gapTo, '49');
    assert.equal(entries.filter(e => e.classList.contains('ereader-toc-gap')).length, 1);
});
