import test, { before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/' });

global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.Audio = dom.window.Audio;
global.Node = dom.window.Node;
dom.window.scrollTo = () => {};

const spoken = [];
dom.window.HTMLMediaElement.prototype.play = function () {
    spoken.push(decodeURIComponent(new URL(this.src).searchParams.get('text')));
    return Promise.resolve();
};
dom.window.HTMLMediaElement.prototype.pause = function () { };

const translated = [];
global.fetch = async (url) => {
    translated.push(decodeURIComponent(new URL(url).searchParams.get('q')));
    return { json: async () => [[['Türkçe çeviri', '', null]]] };
};

function makeIdb() {
    const map = new Map();
    return {
        map,
        get: async key => (map.has(key) ? map.get(key) : undefined),
        set: async (key, value) => { map.set(key, value); return true; },
        del: async key => { map.delete(key); return true; }
    };
}

let storage;
let ereaderStore;
let reader;
let imp;
let testUi;
let state;

before(async () => {
    storage = await import('../src/core/storage.js');
    ereaderStore = await import('../src/features/ereader/ereader-store.js');
    reader = await import('../src/features/ereader/ereader-reader-ui.js');
    imp = await import('../src/features/ereader/ereader-import.js');
    testUi = await import('../src/features/test/test-ui.js');
    state = await import('../src/core/state.js');
});

beforeEach(async () => {
    storage._setIdbBackendForTests(makeIdb());
    ereaderStore._resetEreaderStoreForTests();
    reader._resetEreaderReaderForTests();
    reader.bindEreaderReader({ switchView: () => {}, closeMenu: () => {} });
    document.getElementById('ereaderContent').replaceChildren();
    await ereaderStore.loadEreader();
    state.AppState.ttsEnabled = true;
    state.AppState.translationTarget = 'tr';
    spoken.length = 0;
    translated.length = 0;
});

afterEach(() => {
    storage._setIdbBackendForTests(null);
    testUi.stopAudio(true);
});

function bookData(sections = [
    { id: 's1', title: 'Erster Abschnitt', level: 1, text: 'Das ist ein deutscher Text.' },
    { id: 's2', title: '', level: 2, text: 'Ohne Überschrift.' }
]) {
    return {
        ereader: {
            schema: 1,
            book_key: 'test-f9-actions',
            title: 'F9 Actions Test Book',
            author: 'Test Author',
            language: 'de',
            source_type: 'pdf'
        },
        sections
    };
}

test('1. minSections option defaults to 2 (backward compatibility: 1 heading gets no controls)', () => {
    const container = document.createElement('div');
    container.innerHTML = '<div class="md-content"><h2>Alleinstehende Überschrift</h2><p>Text</p></div>';
    testUi.decorateReadingSections(container);
    assert.equal(container.querySelectorAll('.heading-tools').length, 0);
});

test('2. minSections = 1 adds controls even when there is only 1 heading', () => {
    const container = document.createElement('div');
    container.innerHTML = '<div class="md-content"><h2>Alleinstehende Überschrift</h2><p>Text</p></div>';
    testUi.decorateReadingSections(container, { scope: 'test-single', cacheKey: 'c1', minSections: 1 });
    assert.equal(container.querySelectorAll('.heading-tools').length, 1);
    assert.equal(container.querySelectorAll('.heading-tts-btn').length, 1);
    assert.equal(container.querySelectorAll('.heading-translate-btn').length, 1);
});

// ── R2-10: paragraph actions ─────────────────────────────────────────────

async function openBookData(data = bookData()) {
    const { book } = await imp.importEreaderJson(data);
    await reader.openBook(book.id, { switchView: () => {} });
    reader.enterBookView();
    return book;
}

const firstParagraph = () => document.querySelector('#ereaderContent .ereader-section[data-section-id="s1"] p.p-actionable');
const click = el => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const settle = () => new Promise(r => setTimeout(r, 30));

test('3. R2-10: every paragraph carries one group - listen, summary, vocab, translate; headings get none', async () => {
    await openBookData();
    const content = document.getElementById('ereaderContent');
    assert.equal(content.querySelectorAll('.heading-tools').length, 0, 'no heading-level tools in the reader');
    const groups = content.querySelectorAll('p.p-actionable > .p-actions-group');
    assert.equal(groups.length, 2, 'one group per paragraph');
    const buttons = [...groups[0].querySelectorAll('button')].map(b => b.className.split(' ')[0]);
    assert.deepEqual(buttons, ['p-tts-btn', 'p-summary-btn', 'p-vocab-btn', 'p-translate-btn']);
});

test('4. R2-10: listen reads the paragraph (not the action labels) in the book language', async () => {
    await openBookData();
    const lastSrc = [];
    const origPlay = dom.window.HTMLMediaElement.prototype.play;
    dom.window.HTMLMediaElement.prototype.play = function () { lastSrc.push(this.src); return origPlay.call(this); };
    try {
        click(firstParagraph().querySelector('.p-tts-btn'));
        assert.equal(spoken.length, 1);
        assert.equal(spoken[0], 'Das ist ein deutscher Text.');
        assert.equal(new URL(lastSrc[0]).searchParams.get('lang'), 'de', 'the book is German, whatever the interface language');
        assert.ok(firstParagraph().querySelector('.p-tts-btn').classList.contains('playing'));
        click(firstParagraph().querySelector('.p-tts-btn'));
        assert.equal(firstParagraph().querySelector('.p-tts-btn').classList.contains('playing'), false, 'a second press stops');
    } finally {
        dom.window.HTMLMediaElement.prototype.play = origPlay;
    }
});

test('5. R2-10: translate opens ONE box under the paragraph; the same button again hides it', async () => {
    await openBookData();
    const p = firstParagraph();
    click(p.querySelector('.p-translate-btn'));
    await settle();
    assert.deepEqual(translated, ['Das ist ein deutscher Text.']);
    const box = p.nextElementSibling;
    assert.ok(box.classList.contains('p-translation-box'), 'the box sits right under its paragraph');
    assert.equal(box.dataset.viewMode, 'translate');
    assert.equal(box.querySelector('.p-trans-text').textContent, 'Türkçe çeviri');
    assert.ok(box.querySelector('.p-trans-actions .copy-btn'), 'copy');
    assert.equal(box.querySelectorAll('.p-trans-actions button').length, 3, 'copy, retry, hide');
    assert.ok(p.querySelector('.p-actions-group').classList.contains('has-active'));

    click(p.querySelector('.p-translate-btn'));
    assert.equal(document.querySelectorAll('#ereaderContent .p-translation-box').length, 0);
});

test('6. R2-10: another action reuses the same box; without an AI connection it offers the prompt', async () => {
    await openBookData();
    const p = firstParagraph();
    click(p.querySelector('.p-translate-btn'));
    await settle();
    click(p.querySelector('.p-summary-btn'));
    await settle();
    const boxes = document.querySelectorAll('#ereaderContent .p-translation-box');
    assert.equal(boxes.length, 1, 'still one box');
    assert.equal(boxes[0].dataset.viewMode, 'summary');
    assert.ok(boxes[0].querySelector('.p-ai-needed'), 'no connection: explains and offers the prompt');
    assert.ok(p.querySelector('.p-summary-btn').classList.contains('active'));
    assert.equal(p.querySelector('.p-translate-btn').classList.contains('active'), false);
});

test('7. R2-10: with an AI connection the summary comes from it; retry asks again; hide closes', async () => {
    const aiClient = await import('../src/core/ai-client.js');
    aiClient.saveAiConnection({ baseUrl: 'http://localhost:11434', model: 'llama3' });
    const calls = [];
    const origFetch = global.fetch;
    global.fetch = async (url, opts) => {
        if (String(url).includes('/v1/chat/completions')) {
            calls.push(JSON.parse(opts.body));
            return { ok: true, json: async () => ({ choices: [{ message: { content: `Kern ${calls.length}` } }] }) };
        }
        return origFetch(url, opts);
    };
    try {
        await openBookData();
        const p = firstParagraph();
        click(p.querySelector('.p-summary-btn'));
        await settle();
        const box = p.nextElementSibling;
        assert.equal(box.querySelector('.p-trans-text').textContent.trim(), 'Kern 1');
        assert.equal(calls[0].model, 'llama3');
        assert.ok(calls[0].messages.at(-1).content.includes('Das ist ein deutscher Text.'));

        click(box.querySelector('.p-trans-actions button:nth-child(2)'));
        await settle();
        assert.equal(box.querySelector('.p-trans-text').textContent.trim(), 'Kern 2', 'retry fetches again');

        click(box.querySelector('.p-trans-actions button:nth-child(3)'));
        assert.equal(p.nextElementSibling?.classList.contains('p-translation-box') ?? false, false);
    } finally {
        global.fetch = origFetch;
        aiClient.clearAiConnection();
    }
});

test('A4: with the side menu open, a tap on the text only closes the menu', async () => {
    let closed = 0;
    reader.bindEreaderReader({ switchView: () => {}, closeMenu: () => { closed++; document.getElementById('actionMenu').classList.remove('active'); } });
    await openBookData();
    const p = firstParagraph();
    document.getElementById('actionMenu').classList.add('active');
    click(p.querySelector('.p-translate-btn'));
    await settle();
    assert.equal(closed, 1, 'the menu was closed');
    assert.equal(translated.length, 0, 'the action did not run');
    assert.equal(document.querySelectorAll('#ereaderContent .p-translation-box').length, 0);

    click(p.querySelector('.p-translate-btn'));
    await settle();
    assert.equal(translated.length, 1, 'with the menu closed the action runs');
});

test('A5: leaving the book stops the paragraph speech; a redraw keeps an open box', async () => {
    const tts = await import('../src/features/ereader/ereader-tts.js');
    await openBookData();
    click(firstParagraph().querySelector('.p-tts-btn'));
    assert.ok(tts.speakingKey(), 'speaking');
    click(firstParagraph().querySelector('.p-translate-btn'));
    await settle();

    await reader.changeFontScale(1);
    await settle();
    const p = firstParagraph();
    assert.equal(p.nextElementSibling?.dataset.viewMode, 'translate', 'the box is back after the redraw');
    assert.equal(translated.length, 1, 'from the kept result, not a new request');

    reader.leaveBookView();
    assert.equal(tts.speakingKey(), null, 'leaving the book stops speech');
});

test('A8: an edited paragraph does not show the result kept for its old text', async () => {
    const book = await openBookData();
    click(firstParagraph().querySelector('.p-translate-btn'));
    await settle();
    assert.equal(translated.length, 1);

    await ereaderStore.updateBook(book.id, b => { b.sections[0].text = 'Ganz neuer Text.'; }, { fromSync: true });
    await reader.refreshOpenBook();
    await settle();
    assert.deepEqual(translated, ['Das ist ein deutscher Text.', 'Ganz neuer Text.'], 'the new text was translated, not taken from the old result');
});
