import test, { before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let storage, store, ereaderStore, ereaderImages, reader, shell, imp, t;

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
    ereaderImages = await import('../src/features/ereader/ereader-images.js');
    reader = await import('../src/features/ereader/ereader-reader-ui.js');
    shell = await import('../src/features/ereader/ereader-shell.js');
    imp = await import('../src/features/ereader/ereader-import.js');
    ({ t } = await import('../src/core/i18n.js'));
});

beforeEach(async () => {
    /* e-Reader prefs (font scale) live in localStorage, which outlives a
       test the way the per-test IndexedDB stand-in does not. */
    localStorage.clear();
    storage._setIdbBackendForTests(makeIdb());
    ereaderStore._resetEreaderStoreForTests();
    ereaderImages._resetEreaderImagesForTests();
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

/** Four one-section chapters, so a mount-window radius of 1 always leaves
 *  at least one chapter out - unlike the default three-chapter fixture,
 *  where a radius of 1 already spans the whole book. */
function fourChapterBook() {
    return bookJson([
        { id: 's1', title: 'Chapter One', level: 1, text: 'Alpha text.' },
        { id: 's2', title: 'Chapter Two', level: 1, text: 'Beta text.' },
        { id: 's3', title: 'Chapter Three', level: 1, text: 'Gamma text.' },
        { id: 's4', title: 'Chapter Four', level: 1, text: 'Delta text.' }
    ]);
}

const setChapterTops = (tops) => {
    [...document.querySelectorAll('#ereaderContent .ereader-chapter')].forEach((w, i) => {
        w.getBoundingClientRect = () => ({ top: tops[i], height: 100 });
    });
};

/** jsdom never lays anything out - every unmocked getBoundingClientRect() is
 *  all zeros, which trivially satisfies currentSectionId()'s "top <= reading
 *  line" check for every section and its "book's last section is fully in
 *  view" bottom-of-book check for whichever section renders last. Tests that
 *  read currentSectionId() (anything touching the header bookmark button)
 *  need real-looking positions to get a meaningful answer. */
const setSectionTops = (bySectionId) => {
    document.querySelectorAll('#ereaderContent .ereader-section').forEach(el => {
        const top = bySectionId[el.dataset.sectionId];
        if (top === undefined) return;
        el.getBoundingClientRect = () => ({ top, bottom: top + 50, height: 50 });
    });
};

// ── drawing ────────────────────────────────────────────────────────────────

test('every chapter gets a wrapper, but only the ones near the reading position hold sections', async () => {
    await addAndOpen();
    assert.equal(document.querySelectorAll('#ereaderContent .ereader-chapter').length, 3, 'a wrapper exists for every chapter up front');
    assert.deepEqual(shownSectionIds(), ['s1', 's2', 's3', 's4'], 'chapter 0 (current) and chapter 1 (one ahead) are mounted');
    assert.ok(!document.getElementById('ereaderContent').textContent.includes('Epsilon'), 'chapter 2 is two chapters away and stays a placeholder');
});

test('scrolling slides the mount window: the far chapter is dropped, the next one is mounted', async () => {
    await addAndOpen(fourChapterBook());
    assert.deepEqual(shownSectionIds(), ['s1', 's2']);

    setChapterTops([-10, -10, 500, 500]);
    window.dispatchEvent(new window.Event('scroll'));
    assert.deepEqual(shownSectionIds(), ['s1', 's2', 's3'], 'crossing into chapter two mounts chapter three ahead of it');

    setChapterTops([-500, -500, -10, 500]);
    window.dispatchEvent(new window.Event('scroll'));
    assert.deepEqual(shownSectionIds(), ['s2', 's3', 's4'], 'chapter one is now two chapters behind and is unmounted');
});

test('a section title becomes a heading of its own level; no title, no heading', async () => {
    await addAndOpen(bookJson([
        { id: 'a', title: 'Top', level: 1, text: 'x' },
        { id: 'b', title: '', level: 2, text: 'untitled body' }
    ]));
    const [a, b] = document.querySelectorAll('#ereaderContent .ereader-section');
    assert.equal(a.querySelector('h1')?.textContent, 'Top');
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

// ── scroll to top ──────────────────────────────────────────────────────────

test('the back-to-top button appears once the page has scrolled and returns it to zero', async () => {
    await addAndOpen();
    const btn = document.getElementById('ereaderScrollTopBtn');
    assert.equal(btn.style.display, 'none');

    Object.defineProperty(window, 'scrollY', { value: 900, configurable: true });
    window.dispatchEvent(new window.Event('scroll'));
    assert.equal(btn.style.display, 'flex');
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });

    const scrollCalls = [];
    global.window.scrollTo = (opts) => { scrollCalls.push(opts); };
    btn.onclick();
    assert.deepEqual(scrollCalls.at(-1), { top: 0, behavior: 'smooth' });
});

// ── contents navigation ────────────────────────────────────────────────────

test('going to a section writes the position, weighted by text length', async () => {
    const book = await addAndOpen();
    await reader.goToSection('s3');
    const p = ereaderStore.getProgress(book.id);
    assert.equal(p.sectionId, 's3');
    assert.ok(p.percent > 30 && p.percent < 70, `percent ${p.percent} must reflect the chapters before`);
});

// ── position ───────────────────────────────────────────────────────────────

test('a book opens with the mount window centered on its saved section', async () => {
    const { book } = await imp.importEreaderJson(fourChapterBook());
    await ereaderStore.setProgress(book.id, { sectionId: 's3', offset: 0.5, percent: 50 });
    await reader.openBook(book.id, { switchView });
    reader.enterBookView();
    assert.deepEqual(shownSectionIds(), ['s2', 's3', 's4'], 'chapter one (two behind s3) stays out of the DOM');
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

test('the entry point resumes the last-read book directly, skipping the library', async () => {
    const { book } = await imp.importEreaderJson(bookJson());
    await ereaderStore.setPrefs({ lastBookId: book.id });
    shell.bindEreaderShell({ switchView, closeMenu: () => {} });

    await document.getElementById('headerEreaderBtn').onclick();
    assert.deepEqual(views.at(-1), ['ereaderBook', false]);
    assert.equal(reader.getOpenBook()?.id, book.id);
});

test('the entry point falls back to the library when the last book is gone', async () => {
    await ereaderStore.setPrefs({ lastBookId: 'book_nope' });
    shell.bindEreaderShell({ switchView, closeMenu: () => {} });

    await document.getElementById('headerEreaderBtn').onclick();
    assert.deepEqual(views.at(-1), ['ereaderLibrary', false]);
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

test('a contents entry with children can be collapsed to hide them, and re-expanded', async () => {
    await addAndOpen();
    reader.renderEreaderToc();

    const idsShown = () => [...document.querySelectorAll('#ereaderTocList .ereader-toc-item')].map(i => i.dataset.sectionId);
    assert.deepEqual(idsShown(), ['s1', 's2', 's3', 's4', 's5']);

    const s1Toggle = document.querySelector('#ereaderTocList [data-section-id="s1"]').closest('.ereader-toc-row').querySelector('.ereader-toc-toggle');
    assert.ok(s1Toggle, 'a heading with a child gets a collapse toggle');
    assert.equal(document.querySelector('#ereaderTocList [data-section-id="s2"]').closest('.ereader-toc-row').querySelector('.ereader-toc-toggle'), null, 'a childless heading gets no toggle');

    s1Toggle.onclick(new window.Event('click'));
    assert.deepEqual(idsShown(), ['s1', 's3', 's4', 's5'], 's2 is hidden once its parent collapses');

    document.querySelector('#ereaderTocList [data-section-id="s1"]').closest('.ereader-toc-row').querySelector('.ereader-toc-toggle').onclick(new window.Event('click'));
    assert.deepEqual(idsShown(), ['s1', 's2', 's3', 's4', 's5'], 're-clicking the toggle expands it again');
});

test('the contents toolbar can collapse every chapter to its title, or expand them all back', async () => {
    await addAndOpen();
    reader.renderEreaderToc();
    const idsShown = () => [...document.querySelectorAll('#ereaderTocList .ereader-toc-item')].map(i => i.dataset.sectionId);

    reader.tocCollapseToTop();
    assert.deepEqual(idsShown(), ['s1', 's3', 's5'], 'only the chapter titles remain');

    reader.tocExpandAll();
    assert.deepEqual(idsShown(), ['s1', 's2', 's3', 's4', 's5']);
});

test('a contents entry in another chapter opens that chapter and marks it', async () => {
    const book = await addAndOpen();
    reader.renderEreaderToc();
    document.querySelector('#ereaderTocList [data-section-id="s5"]').click();
    await tick(5);
    assert.deepEqual(shownSectionIds(), ['s3', 's4', 's5'], 'chapter one, one behind s5, stays mounted');
    assert.equal(document.querySelector('#ereaderTocList .ereader-toc-item.active')?.dataset.sectionId, 's5');
    assert.equal(ereaderStore.getProgress(book.id).sectionId, 's5');
});

test('clicking a collapsed heading title expands it to reveal children, and re-clicking active collapses it', async () => {
    await addAndOpen();
    reader.renderEreaderToc();
    reader.tocCollapseToTop();
    const idsShown = () => [...document.querySelectorAll('#ereaderTocList .ereader-toc-item')].map(i => i.dataset.sectionId);
    assert.deepEqual(idsShown(), ['s1', 's3', 's5'], 'starts with chapters collapsed');

    // Clicking s1 heading button expands it and reveals s2
    document.querySelector('#ereaderTocList [data-section-id="s1"]').click();
    await tick(5);
    assert.deepEqual(idsShown(), ['s1', 's2', 's3', 's5'], 's2 is now visible');

    // Clicking s1 heading button again while active collapses it
    document.querySelector('#ereaderTocList [data-section-id="s1"]').click();
    await tick(5);
    assert.deepEqual(idsShown(), ['s1', 's3', 's5'], 's2 is hidden again');
});

test('opening a book opens the contents section of the menu', async () => {
    document.querySelector('#ereaderTocMenuSection .menu-section-header').classList.remove('active');
    await addAndOpen();
    assert.ok(document.querySelector('#ereaderTocMenuSection .menu-section-header').classList.contains('active'));
});

// ── font size ──────────────────────────────────────────────────────────────

test('font size steps through the fine-grained scale and stops at both ends', async () => {
    await addAndOpen();
    assert.equal(await reader.changeFontScale(-1), 0.9);
    assert.equal(await reader.changeFontScale(-1), 0.8);
    assert.equal(await reader.changeFontScale(-1), 0.8, 'no step below the smallest');

    for (let i = 0; i < 10; i++) await reader.changeFontScale(1);
    assert.equal(ereaderStore.getPrefs().fontScale, 1.5);
    assert.equal(document.getElementById('ereaderContent').style.getPropertyValue('--ereader-font-scale'), '1.5');
});

test('the settings popup cycles small -> normal -> large -> small and marks the active dot', async () => {
    await addAndOpen();
    const btn = document.getElementById('ereaderFontSizeBtn');
    const activeTier = () => [...btn.querySelectorAll('.ereader-fontsize-dot')].findIndex(d => d.classList.contains('active'));

    assert.equal(ereaderStore.getPrefs().fontScale, 1, 'starts at the normal tier');
    assert.equal(activeTier(), 1);

    assert.equal(await reader.cycleFontSizeTier(), 1.35);
    assert.equal(activeTier(), 2);

    assert.equal(await reader.cycleFontSizeTier(), 0.8);
    assert.equal(activeTier(), 0);

    assert.equal(await reader.cycleFontSizeTier(), 1);
    assert.equal(activeTier(), 1);
});

test('a font change keeps the same chapters mounted', async () => {
    await addAndOpen(fourChapterBook());
    await reader.goToSection('s3');
    assert.deepEqual(shownSectionIds(), ['s2', 's3', 's4']);
    await reader.changeFontScale(1);
    assert.deepEqual(shownSectionIds(), ['s2', 's3', 's4'], 'font scale is a CSS variable - it never touches the mount window');
});

// ── the open book changes underneath ───────────────────────────────────────

test('an edit to the open book is redrawn at the same chapter', async () => {
    const book = await addAndOpen();
    await reader.goToSection('s3');
    await tick(2);
    await ereaderStore.updateBook(book.id, b => { b.sections.find(s => s.id === 's3').text = 'Rewritten gamma.'; }, { fromSync: true });
    await reader.refreshOpenBook();
    assert.ok(shownSectionIds().includes('s3'));
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

test('3. saving an image URL writes it into the book text, keeping the placeholder id as its title', async () => {
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
    await tick();

    const updated = await ereaderStore.getBook(book.id);
    const text = updated.sections[0].text;
    assert.ok(text.includes('![my-diagram](https://example.com/images/diag.png "my-diagram")'), 'a link is book text, so it syncs and is shared');
    assert.ok(text.includes('Note: (my-diagram) is essential for understanding.'), 'normal text with parentheses stays unchanged');
    assert.deepEqual(await ereaderImages.loadBookImages(book.id), {}, 'nothing kept on the device for a link');

    const figure = document.querySelector('[data-section-id="s1"] .ereader-user-figure');
    assert.ok(figure, 'the placeholder turns into the picture');
    assert.equal(figure.querySelector('img').getAttribute('src'), 'https://example.com/images/diag.png');
    assert.ok(figure.querySelector('.ereader-figure-edit-btn'), 'with a button to change it');
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
    await tick();

    const updated = await ereaderStore.getBook(book.id);
    assert.ok(updated.sections[1].text.includes('https://example.com/img.png'));
    assert.ok(scrollCalls.length > 0);
    assert.equal(reader.getOpenBook().id, book.id);
    await reader.flushPosition();
    const currentProgress = ereaderStore.getProgress(book.id);
    assert.equal(currentProgress?.sectionId, 's2', 'Preserved sectionId should be s2');
});

// ── contents drawer progress bar ────────────────────────────────────────────

test('a short final chapter that never crosses the reading line still reaches 100% once fully visible', async () => {
    const book = await addAndOpen(fourChapterBook());
    const wrappers = [...document.querySelectorAll('#ereaderContent .ereader-chapter')];
    wrappers.forEach((w, i) => {
        /* Chapters 0-2 are scrolled well past; chapter 3 (the last) is short
           enough that its bottom is already inside the viewport even though
           its top never reached the reading line - there is nothing left
           below it to scroll to. */
        const top = i < 3 ? -500 : 200;
        const height = i === 3 ? 50 : 100;
        w.getBoundingClientRect = () => ({ top, height, bottom: top + height });
    });

    window.dispatchEvent(new window.Event('scroll'));
    const fill = document.getElementById('ereaderTocProgressFill');
    assert.equal(parseFloat(fill.style.width), 100, 'the last chapter is fully visible, so progress must read 100%');

    await reader.flushPosition();
    const progress = ereaderStore.getProgress(book.id);
    assert.equal(progress?.sectionId, 's4');
    assert.equal(progress?.percent, 100);
});

test('the contents drawer progress fill tracks the reading position', async () => {
    const book = await addAndOpen(fourChapterBook());
    const fill = document.getElementById('ereaderTocProgressFill');

    await reader.goToSection('s1');
    const atStart = parseFloat(fill.style.width);

    await reader.goToSection('s4');
    const atEnd = parseFloat(fill.style.width);

    assert.ok(atEnd > atStart, 'progress must advance as later sections are read');
    assert.equal(ereaderStore.getProgress(book.id).sectionId, 's4');
});

// ── settings popup ──────────────────────────────────────────────────────────

test('the settings popup opens and closes, and closes on Escape', async () => {
    await addAndOpen();
    const overlay = document.getElementById('ereaderSettingsOverlay');

    reader.openSettingsOverlay();
    assert.ok(overlay.classList.contains('active'));
    assert.equal(reader.isSettingsOverlayOpen(), true);

    reader.closeSettingsOverlay();
    assert.equal(overlay.classList.contains('active'), false);

    reader.openSettingsOverlay();
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(overlay.classList.contains('active'), false, 'Escape must close the open settings popup');
});

test('leaving the book view closes the settings popup', async () => {
    await addAndOpen();
    reader.openSettingsOverlay();
    reader.leaveBookView();
    assert.equal(document.getElementById('ereaderSettingsOverlay').classList.contains('active'), false);
});

// ── bookmarks ────────────────────────────────────────────────────────────

const answerConfirm = async (accept) => {
    await tick();
    const overlay = document.getElementById('customModalOverlay');
    assert.ok(overlay.classList.contains('active'), 'the confirm dialog must be open');
    document.getElementById(accept ? 'modalConfirmBtn' : 'modalCancelBtn').click();
};

test('the header bookmark button opens the modal prefilled with the current section title', async () => {
    await addAndOpen();
    await reader.goToSection('s3');
    setSectionTops({ s1: -500, s2: -300, s3: 50, s4: 400, s5: 1000 });

    document.getElementById('ereaderBookmarkBtn').click();
    const overlay = document.getElementById('ereaderBookmarkOverlay');
    assert.ok(overlay.classList.contains('active'));
    assert.equal(document.getElementById('ereaderBookmarkTitleInput').value, 'Chapter Two');
    assert.equal(document.getElementById('ereaderBookmarkNoteInput').value, '');
});

test('saving the bookmark modal adds a bookmark and shows it in the carousel', async () => {
    const book = await addAndOpen();
    await reader.goToSection('s1');
    setSectionTops({ s1: 50, s2: 400, s3: 700, s4: 1000, s5: 1300 });
    document.getElementById('ereaderBookmarkBtn').click();

    document.getElementById('ereaderBookmarkTitleInput').value = 'My mark';
    document.getElementById('ereaderBookmarkNoteInput').value = 'Come back here';
    document.getElementById('ereaderBookmarkSaveBtn').click();
    await tick();

    assert.equal(document.getElementById('ereaderBookmarkOverlay').classList.contains('active'), false);
    assert.equal(document.getElementById('ereaderBookmarkCarousel').style.display, 'flex');
    assert.equal(document.getElementById('ereaderBookmarkNumber').textContent, '(1)');
    assert.equal(document.getElementById('ereaderBookmarkTitle').textContent, 'My mark');

    const stored = ereaderStore.getBookmarks(book.id);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].sectionId, 's1');
    assert.equal(stored[0].note, 'Come back here');
});

test('bookmarks are listed by position but keep the number of the order they were added in', async () => {
    const book = await addAndOpen();
    // s3 (chapter two) bookmarked first, s1 (chapter one) bookmarked second:
    // the carousel still walks the book top-down, but a bookmark added later
    // higher up takes the next number instead of renumbering the others.
    await ereaderStore.addBookmark(book.id, { sectionId: 's3', title: 'Later chapter' });
    await ereaderStore.addBookmark(book.id, { sectionId: 's1', title: 'Earlier chapter' });
    reader.renderEreaderBookmarks();

    assert.equal(document.getElementById('ereaderBookmarkNumber').textContent, '(2)');
    assert.equal(document.getElementById('ereaderBookmarkTitle').textContent, 'Earlier chapter');
    assert.equal(document.querySelector('[data-section-id="s1"] > .ereader-bookmark-marker').dataset.number, '2');

    document.getElementById('ereaderBookmarkNextBtn').click();
    assert.equal(document.getElementById('ereaderBookmarkNumber').textContent, '(1)');
    assert.equal(document.getElementById('ereaderBookmarkTitle').textContent, 'Later chapter');

    // Wraps back around, and with only two, the nav is never disabled.
    document.getElementById('ereaderBookmarkNextBtn').click();
    assert.equal(document.getElementById('ereaderBookmarkNumber').textContent, '(2)');
    assert.equal(document.getElementById('ereaderBookmarkPrevBtn').disabled, false);
});

test('clicking the carousel entry jumps to that bookmark; deleting one renumbers the rest', async () => {
    const book = await addAndOpen();
    await ereaderStore.addBookmark(book.id, { sectionId: 's1', title: 'First' });
    await ereaderStore.addBookmark(book.id, { sectionId: 's3', title: 'Second' });
    reader.renderEreaderBookmarks();

    document.getElementById('ereaderBookmarkNextBtn').click();
    assert.equal(document.getElementById('ereaderBookmarkTitle').textContent, 'Second');
    document.getElementById('ereaderBookmarkCurrentBtn').click();
    await tick(5);
    assert.equal(document.querySelector('#ereaderTocList .ereader-toc-item.active')?.dataset.sectionId, 's3');

    // A single remaining bookmark disables the (now pointless) nav arrows.
    // Deleting now goes through the note-detail modal, not a direct button.
    document.getElementById('ereaderBookmarkDetailsBtn').click();
    assert.ok(document.getElementById('ereaderBookmarkDetailOverlay').classList.contains('active'));
    document.getElementById('ereaderBookmarkDetailDeleteBtn').click();
    await answerConfirm(true);
    await tick();

    assert.equal(document.getElementById('ereaderBookmarkDetailOverlay').classList.contains('active'), false);
    assert.equal(document.getElementById('ereaderBookmarkNumber').textContent, '(1)');
    assert.equal(document.getElementById('ereaderBookmarkTitle').textContent, 'First');
    assert.equal(document.getElementById('ereaderBookmarkPrevBtn').disabled, true);
    assert.equal(ereaderStore.getBookmarks(book.id).length, 1);
});

test('deleting the last bookmark hides the carousel', async () => {
    const book = await addAndOpen();
    const bm = await ereaderStore.addBookmark(book.id, { sectionId: 's1', title: 'Only one' });
    reader.renderEreaderBookmarks();
    assert.equal(document.getElementById('ereaderBookmarkCarousel').style.display, 'flex');

    document.getElementById('ereaderBookmarkDetailsBtn').click();
    document.getElementById('ereaderBookmarkDetailDeleteBtn').click();
    await answerConfirm(true);
    await tick();

    assert.equal(document.getElementById('ereaderBookmarkCarousel').style.display, 'none');
    assert.equal(ereaderStore.getBookmarks(book.id).length, 0);
    void bm;
});

test('the note-detail modal shows the bookmark\'s title and note, or a placeholder when there is none', async () => {
    const book = await addAndOpen();
    await ereaderStore.addBookmark(book.id, { sectionId: 's1', title: 'With a note', note: 'Remember this bit' });
    reader.renderEreaderBookmarks();

    document.getElementById('ereaderBookmarkDetailsBtn').click();
    assert.equal(document.getElementById('ereaderBookmarkDetailTitle').textContent, 'With a note');
    assert.equal(document.getElementById('ereaderBookmarkDetailNote').textContent, 'Remember this bit');
    assert.equal(document.getElementById('ereaderBookmarkDetailNote').classList.contains('ereader-bookmark-detail-empty'), false);
    document.getElementById('ereaderBookmarkDetailCloseBtn').click();
    assert.equal(document.getElementById('ereaderBookmarkDetailOverlay').classList.contains('active'), false);

    await ereaderStore.addBookmark(book.id, { sectionId: 's2', title: 'No note' });
    reader.renderEreaderBookmarks();
    document.getElementById('ereaderBookmarkNextBtn').click();
    document.getElementById('ereaderBookmarkDetailsBtn').click();
    assert.notEqual(document.getElementById('ereaderBookmarkDetailNote').textContent, '');
    assert.ok(document.getElementById('ereaderBookmarkDetailNote').classList.contains('ereader-bookmark-detail-empty'));
    void book;
});

test('editing from the detail modal prefills the add/edit modal and updates the bookmark in place', async () => {
    const book = await addAndOpen();
    const bm = await ereaderStore.addBookmark(book.id, { sectionId: 's1', title: 'Original', note: 'Old note' });
    reader.renderEreaderBookmarks();

    document.getElementById('ereaderBookmarkDetailsBtn').click();
    document.getElementById('ereaderBookmarkDetailEditBtn').click();

    assert.equal(document.getElementById('ereaderBookmarkDetailOverlay').classList.contains('active'), false);
    assert.ok(document.getElementById('ereaderBookmarkOverlay').classList.contains('active'));
    assert.equal(document.getElementById('ereaderBookmarkTitleInput').value, 'Original');
    assert.equal(document.getElementById('ereaderBookmarkNoteInput').value, 'Old note');

    document.getElementById('ereaderBookmarkTitleInput').value = 'Renamed';
    document.getElementById('ereaderBookmarkNoteInput').value = 'New note';
    document.getElementById('ereaderBookmarkSaveBtn').click();
    await tick();

    const stored = ereaderStore.getBookmarks(book.id);
    assert.equal(stored.length, 1, 'editing must not create a second bookmark');
    assert.equal(stored[0].id, bm.id);
    assert.equal(stored[0].title, 'Renamed');
    assert.equal(stored[0].note, 'New note');
    assert.equal(document.getElementById('ereaderBookmarkTitle').textContent, 'Renamed');
});

test('a bookmarked section is marked inline while it is mounted', async () => {
    const book = await addAndOpen();
    assert.equal(document.querySelector('[data-section-id="s1"] .ereader-bookmark-marker'), null);

    await ereaderStore.addBookmark(book.id, { sectionId: 's1', title: 'Marked' });
    reader.renderEreaderBookmarks();

    assert.ok(document.querySelector('[data-section-id="s1"] > .ereader-bookmark-marker'));
});

test('Escape closes the bookmark modal', async () => {
    await addAndOpen();
    document.getElementById('ereaderBookmarkBtn').click();
    assert.ok(document.getElementById('ereaderBookmarkOverlay').classList.contains('active'));

    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(document.getElementById('ereaderBookmarkOverlay').classList.contains('active'), false);
});

test('selecting text shows the floating bookmark action, which opens the modal prefilled with the excerpt', async () => {
    await addAndOpen();
    const textNode = document.querySelector('#ereaderContent .ereader-section p')?.firstChild;
    assert.ok(textNode, 'a section must render a paragraph with text to select');

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(5, textNode.length));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    reader.updateSelectionPopover();
    const popover = document.getElementById('ereaderSelectionBookmarkBtn');
    assert.equal(popover.style.display, 'flex');

    popover.click();
    assert.ok(document.getElementById('ereaderBookmarkOverlay').classList.contains('active'));
    assert.ok(document.getElementById('ereaderBookmarkTitleInput').value.length > 0);
    assert.equal(popover.style.display, 'none', 'the popover hides once its action is taken');
});

test('an empty or collapsed selection hides the floating bookmark action', async () => {
    await addAndOpen();
    window.getSelection().removeAllRanges();
    reader.updateSelectionPopover();
    assert.equal(document.getElementById('ereaderSelectionBookmarkBtn').style.display, 'none');
});

test('selecting text inside a translation element does not show the bookmark action', async () => {
    await addAndOpen();
    const sectionEl = document.querySelector('.ereader-section');
    assert.ok(sectionEl);

    const transEl = document.createElement('div');
    transEl.className = 'md-section-translation';
    transEl.textContent = 'Dies ist ein übersetzter Text zum Testen.';
    sectionEl.appendChild(transEl);

    const textNode = transEl.firstChild;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    reader.updateSelectionPopover();
    assert.equal(document.getElementById('ereaderSelectionBookmarkBtn').style.display, 'none');
    transEl.remove();
});


test('5. saving image URL containing dollar signs ($) keeps the URL literally', async () => {
    const customBook = {
        ereader: { schema: 1, book_key: 'dollar-test', title: 'Dollar Test', author: 'A', language: 'en', source_type: 'obsidian' },
        sections: [
            { id: 's1', title: 'Chapter 1', level: 1, text: 'See the diagram below:\n\n![Placeholder](placeholder:diag-ph)' }
        ]
    };
    const book = await addAndOpen(customBook);

    reader.openImageUrlModal('placeholder:diag-ph');
    const input = document.getElementById('ereaderImageUrlInput');
    input.value = 'https://example.com/images/ph.png?price=$50&code=$2&other=$&';
    await document.getElementById('ereaderImageUrlSaveBtn').onclick();

    const updated = await ereaderStore.getBook(book.id);
    assert.ok(updated.sections[0].text.includes('![Placeholder](https://example.com/images/ph.png?price=$50&code=$2&other=$& "placeholder:diag-ph")'),
        'dollar signs must be preserved literally');
});

test('6. saving image URL with parentheses encodes them', async () => {
    const customBook = {
        ereader: { schema: 1, book_key: 'paren-test', title: 'Parentheses Test', author: 'A', language: 'en', source_type: 'obsidian' },
        sections: [
            { id: 's1', title: 'Chapter 1', level: 1, text: 'See the figure below:\n\n![Fig](placeholder:img-1)' }
        ]
    };
    const book = await addAndOpen(customBook);

    reader.openImageUrlModal('placeholder:img-1');
    document.getElementById('ereaderImageUrlInput').value = 'https://upload.wikimedia.org/Foo_(bar).png';
    await document.getElementById('ereaderImageUrlSaveBtn').onclick();

    const updated = await ereaderStore.getBook(book.id);
    assert.ok(updated.sections[0].text.includes('![Fig](https://upload.wikimedia.org/Foo_%28bar%29.png "placeholder:img-1")'));
    const figure = document.querySelector('#ereaderContent [data-section-id="s1"] .md-figure');
    assert.equal(figure.dataset.placeholderId, 'placeholder:img-1', 'the linked picture still knows its placeholder');
    assert.ok(figure.querySelector('.ereader-figure-edit-btn'), 'and can be changed');
});

test('an image placeholder shows the AI description in parts: caption, details, id and a hint', async () => {
    await addAndOpen({
        ereader: { schema: 1, book_key: 'ph-card', title: 'Card', author: 'A', language: 'en', source_type: 'pdf' },
        sections: [{
            id: 's1', title: 'Chapter 1', level: 1,
            text: 'Text.\n\n![Figure 2.1 The value system | Diagram: five linked boxes | p. 34](placeholder:fig-2-1)'
        }]
    });
    const card = document.querySelector('[data-section-id="s1"] .md-image-placeholder');
    assert.ok(card);
    assert.equal(card.querySelector('.md-placeholder-text').textContent, 'Figure 2.1 The value system');
    assert.deepEqual([...card.querySelectorAll('.md-placeholder-desc')].map(e => e.textContent), ['Diagram: five linked boxes', 'p. 34']);
    assert.equal(card.querySelector('.md-placeholder-id').textContent, 'fig-2-1');
    assert.equal(card.getAttribute('role'), 'button');

    card.click();
    const overlay = document.getElementById('ereaderImageUrlOverlay');
    assert.ok(overlay.classList.contains('active'), 'tapping the card opens the image modal');
    assert.equal(document.getElementById('ereaderImageModalAlt').textContent, 'Figure 2.1 The value system');
    assert.equal(document.getElementById('ereaderImageModalId').textContent, 'fig-2-1');
    assert.equal(document.getElementById('ereaderImageRemoveBtn').style.display, 'none', 'nothing to remove yet');
    reader.closeImageUrlModal();
});

test('an image chosen for a placeholder can be removed again from the modal', async () => {
    const book = await addAndOpen({
        ereader: { schema: 1, book_key: 'ph-remove', title: 'Remove', author: 'A', language: 'en', source_type: 'pdf' },
        sections: [{ id: 's1', title: 'Chapter 1', level: 1, text: '![Fig | Photo | p. 2](placeholder:fig-1-1)' }]
    });
    reader.openImageUrlModal('placeholder:fig-1-1');
    document.getElementById('ereaderImageUrlInput').value = 'https://example.com/a.png';
    await reader.saveImageUrlFromModal();
    reader.openImageUrlModal('placeholder:fig-1-1');
    assert.notEqual(document.getElementById('ereaderImageRemoveBtn').style.display, 'none');
    assert.equal(document.getElementById('ereaderImageUrlInput').value, 'https://example.com/a.png');

    await reader.removeImageFromModal();
    assert.equal((await ereaderStore.getBook(book.id)).sections[0].text, '![Fig | Photo | p. 2](placeholder:fig-1-1)');
    assert.deepEqual(await ereaderImages.loadBookImages(book.id), {});
    assert.ok(document.querySelector('[data-section-id="s1"] .md-image-placeholder'), 'the placeholder is back');
});

test('a book exported with its images carries them as an `images` object, and a re-import restores them', async () => {
    const book = await addAndOpen({
        ereader: { schema: 1, book_key: 'ph-export', title: 'Export', author: 'A', language: 'en', source_type: 'pdf' },
        sections: [{ id: 's1', title: 'Chapter 1', level: 1, text: '![Fig | Photo | p. 2](placeholder:fig-1-1)' }]
    });
    const data = 'data:image/png;base64,iVBORw0KGgo=';
    await ereaderImages.setBookImage(book.id, 'placeholder:fig-1-1', { data, name: 'fig.png' });

    const without = await reader.bookExportJson(book, { includeImages: false });
    assert.equal(without.images, undefined);
    const withImages = await reader.bookExportJson(book, { includeImages: true });
    assert.deepEqual(withImages.images, { 'placeholder:fig-1-1': { data, name: 'fig.png' } });
    assert.equal(withImages.sections[0].text, '![Fig | Photo | p. 2](placeholder:fig-1-1)', 'the text keeps its placeholder');

    await ereaderStore.deleteBook(book.id);
    assert.deepEqual(await ereaderImages.loadBookImages(book.id), {}, 'a deleted book takes its images along');

    const result = await imp.importEreaderJson(withImages);
    assert.equal(result.status, 'added');
    const restored = await ereaderImages.loadBookImages(result.book.id);
    assert.equal(restored['placeholder:fig-1-1'].data, data);
});

test('the image store refuses what is not a picture: http, javascript and svg data', async () => {
    assert.equal(await ereaderImages.setBookImage('b1', 'placeholder:x', { url: 'http://example.com/a.png' }), null);
    assert.equal(await ereaderImages.setBookImage('b1', 'placeholder:x', { url: 'javascript:alert(1)' }), null);
    assert.equal(await ereaderImages.setBookImage('b1', 'placeholder:x', { data: 'data:image/svg+xml;base64,PHN2Zz4=' }), null);
    assert.equal(await ereaderImages.importBookImages('b1', { 'placeholder:x': { data: 'data:text/html;base64,AAAA' } }), 0);
});

test('the settings popup keeps only quick actions (download, share, print), its share opening the share-options dialog', async () => {
    await addAndOpen();
    reader.openSettingsOverlay();
    const settings = document.getElementById('ereaderSettingsOverlay');
    for (const id of ['ereaderSettingsDownloadBtn', 'ereaderShareBookBtn', 'ereaderPrintBtn']) {
        assert.ok(settings.querySelector(`#${id}`), `${id} must be a quick action in settings`);
    }
    /* Editing, deleting, archiving and the reset belong to the library's book menu. */
    const bookMenu = document.getElementById('ereaderBookActionsOverlay');
    for (const id of ['ereaderEditMetaBtn', 'ereaderDeleteBookBtn', 'ereaderArchiveBookBtn', 'menuEreaderReset']) {
        assert.ok(bookMenu.querySelector(`#${id}`), `${id} must be in the book menu`);
    }
    for (const id of ['ereaderSettingsEditMetaBtn', 'ereaderSettingsDeleteBtn', 'ereaderSettingsArchiveBtn', 'menuEreaderReset']) {
        assert.equal(settings.querySelector(`#${id}`), null, `${id} must not be in settings`);
    }

    await document.getElementById('ereaderShareBookBtn').onclick();
    await tick();
    const shareOverlay = document.getElementById('shareOptionsOverlay');
    assert.ok(shareOverlay.classList.contains('active'), 'share is a real share dialog, not a download');
    assert.equal(document.getElementById('shareOptionsSourceName').textContent, 'Reader Test');
    assert.equal(document.getElementById('shareIncludeFolderRow').style.display, 'none', 'no images, no switch');
    assert.equal(reader.isSettingsOverlayOpen(), false);
    document.getElementById('shareOptionsCloseBtn').click();
    assert.equal(shareOverlay.classList.contains('active'), false);
});

test('a book with images of its own offers a switch for them in the share dialog', async () => {
    const book = await addAndOpen({
        ereader: { schema: 1, book_key: 'ph-share', title: 'Share', author: 'A', language: 'en', source_type: 'pdf' },
        sections: [{ id: 's1', title: 'Chapter 1', level: 1, text: '![Fig](placeholder:fig-1-1)' }]
    });
    await ereaderImages.setBookImage(book.id, 'placeholder:fig-1-1', { data: 'data:image/png;base64,iVBORw0KGgo=' });
    await reader.shareBook(book);
    assert.equal(document.getElementById('shareIncludeFolderRow').style.display, 'flex');
    assert.equal(document.getElementById('shareIncludeFolderCheck').checked, true);
    assert.match(document.getElementById('shareIncludeFolderLabel').textContent, /1/);
    document.getElementById('shareOptionsCloseBtn').click();
});

test('a bookmark made from a selection hangs in the margin, anchored to where the selection starts, and marks the passage', async () => {
    const book = await addAndOpen(bookJson([
        { id: 's1', title: 'Chapter One', level: 1, text: 'First paragraph here.\n\nSecond paragraph with the chosen words inside.' },
        { id: 's2', title: 'Chapter Two', level: 1, text: 'Other.' }
    ]));
    const secEl = document.querySelector('#ereaderContent .ereader-section[data-section-id="s1"]');
    const p2 = [...secEl.querySelectorAll('p')].find(p => p.textContent.includes('chosen'));
    const textNode = p2.firstChild;
    const start = textNode.data.indexOf('chosen');
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + 'chosen words'.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    reader.updateSelectionPopover();
    document.getElementById('ereaderSelectionBookmarkBtn').onclick();
    await document.getElementById('ereaderBookmarkSaveBtn').onclick();

    const [bm] = ereaderStore.getBookmarks(book.id);
    assert.equal(bm.anchor.quote.startsWith('chosen words'), true);

    assert.equal(bm.anchor.length, 'chosen words'.length, 'the selected passage is remembered');
    const marker = secEl.querySelector('.ereader-bookmark-marker');
    assert.ok(marker.classList.contains('is-margin'));
    assert.equal(marker.parentElement, secEl, 'outside the text - nothing is inserted into the paragraph');
    assert.equal(p2.querySelector('.ereader-bookmark-marker'), null);
    assert.equal(p2.childNodes.length, 1, 'the paragraph text is not split');
    assert.equal(marker._anchorRange.toString(), 'chosen words', 'anchored to (and highlighting) the selected words');

    /* Redrawing keeps exactly one ribbon in place (no duplicates). */
    reader.renderEreaderBookmarks();
    assert.equal(secEl.querySelectorAll('.ereader-bookmark-marker').length, 1);
    assert.equal(secEl.querySelector('.ereader-bookmark-marker')._anchorRange.toString(), 'chosen words');
});

test('several bookmarks in one section are all drawn', async () => {
    const book = await addAndOpen(bookJson([
        { id: 's1', title: 'Chapter One', level: 1, text: 'Alpha beta gamma delta.' }
    ]));
    await ereaderStore.addBookmark(book.id, { sectionId: 's1', title: 'A', anchor: { offset: 0, quote: 'beta' } });
    await ereaderStore.addBookmark(book.id, { sectionId: 's1', title: 'B', anchor: { offset: 0, quote: 'delta' } });
    reader.renderEreaderBookmarks();
    const markers = [...document.querySelectorAll('#ereaderContent [data-section-id="s1"] .ereader-bookmark-marker.is-margin')]
        .sort((a, b) => Number(a.dataset.order) - Number(b.dataset.order));
    assert.equal(markers.length, 2);
    const startText = (m) => m._anchorRange.startContainer.data.slice(m._anchorRange.startOffset);
    assert.ok(startText(markers[0]).startsWith('beta'), 'in text order');
    assert.ok(startText(markers[1]).startsWith('delta'));
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

// ── heading folds, header search, marker → note ───────────────────────────

test('clicking an h1 heading in the body folds its text and every deeper section, and unfolds again', async () => {
    await addAndOpen(bookJson([
        { id: 'a', title: 'Top', level: 1, text: 'top text' },
        { id: 'b', title: 'Sub', level: 2, text: 'sub text' },
        { id: 'c', title: 'Deep', level: 3, text: 'deep text' },
        { id: 'd', title: 'Next', level: 1, text: 'next text' }
    ]));
    const sec = id => document.querySelector(`#ereaderContent [data-section-id="${id}"]`);
    const heading = sec('a').querySelector('h1');
    assert.ok(heading.classList.contains('ereader-fold-heading'));
    assert.ok(sec('b').querySelector('h2.ereader-fold-heading'), 'h2 folds too');
    assert.ok(sec('c').querySelector('h3.ereader-fold-heading'), 'h3 folds too');

    heading.click();
    assert.ok(sec('a').classList.contains('is-folded'));
    assert.ok(sec('b').classList.contains('is-folded-away'));
    assert.ok(sec('c').classList.contains('is-folded-away'));
    assert.equal(sec('d').classList.contains('is-folded-away'), false, 'a sibling h1 is untouched');

    heading.click();
    assert.equal(sec('a').classList.contains('is-folded'), false);
    assert.equal(sec('b').classList.contains('is-folded-away'), false);
});

test('a contents jump into a folded section unfolds the way to it', async () => {
    await addAndOpen();
    const sec = id => document.querySelector(`#ereaderContent [data-section-id="${id}"]`);
    sec('s1').querySelector('h1').click();
    assert.ok(sec('s2').classList.contains('is-folded-away'));
    await reader.goToSection('s2');
    assert.equal(sec('s1').classList.contains('is-folded'), false);
    assert.equal(sec('s2').classList.contains('is-folded-away'), false);
});

test('the search field opens in the header, its button turns into a close X, and the clear button keeps it open', async () => {
    await addAndOpen();
    const header = document.querySelector('header');
    const bar = document.getElementById('ereaderSearchBar');
    assert.ok(header.contains(bar), 'the search bar lives in the header');

    document.getElementById('ereaderSearchBtn').click();
    assert.ok(reader.isSearchBarOpen());
    assert.ok(header.classList.contains('ereader-searching'));

    const input = document.getElementById('ereaderSearchInput');
    input.value = 'Alpha';
    input.dispatchEvent(new window.Event('input'));
    assert.ok(document.querySelectorAll('#ereaderSearchResults .ereader-search-item').length > 0);
    assert.equal(document.getElementById('ereaderSearchClearBtn').style.display, 'flex');

    document.getElementById('ereaderSearchClearBtn').click();
    assert.equal(input.value, '');
    assert.ok(reader.isSearchBarOpen(), 'clearing starts a new search, it does not close');

    document.getElementById('ereaderSearchBtn').click();
    assert.equal(reader.isSearchBarOpen(), false);
    assert.equal(header.classList.contains('ereader-searching'), false);
});

test('tapping an inline bookmark marker opens that bookmark\'s note', async () => {
    const book = await addAndOpen();
    await ereaderStore.addBookmark(book.id, { sectionId: 's1', title: 'One', note: 'first note' });
    await ereaderStore.addBookmark(book.id, { sectionId: 's2', title: 'Two', note: 'second note' });
    reader.renderEreaderBookmarks();

    document.querySelector('[data-section-id="s2"] > .ereader-bookmark-marker').click();
    assert.ok(document.getElementById('ereaderBookmarkDetailOverlay').classList.contains('active'));
    assert.equal(document.getElementById('ereaderBookmarkDetailNote').textContent, 'second note');
    assert.equal(document.getElementById('ereaderBookmarkTitle').textContent, 'Two', 'the carousel follows');
});
