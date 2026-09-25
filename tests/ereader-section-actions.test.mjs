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

test('3. e-Reader reader decorates section headings with TTS and translate controls', async () => {
    const { book } = await imp.importEreaderJson(bookData());
    await reader.openBook(book.id, { switchView: () => {} });
    reader.enterBookView();

    const content = document.getElementById('ereaderContent');
    const s1El = content.querySelector('.ereader-section[data-section-id="s1"]');
    assert.ok(s1El, 'section s1 must exist in DOM');

    const tools = s1El.querySelectorAll('.heading-tools');
    assert.equal(tools.length, 1, 's1 heading must be decorated with heading-tools');

    const ttsBtn = s1El.querySelector('.heading-tts-btn');
    const transBtn = s1El.querySelector('.heading-translate-btn');
    assert.ok(ttsBtn, 'TTS button must be present');
    assert.ok(transBtn, 'Translate button must be present');

    // Section without heading has no controls
    const s2El = content.querySelector('.ereader-section[data-section-id="s2"]');
    assert.ok(s2El, 'section s2 must exist in DOM');
    assert.equal(s2El.querySelectorAll('.heading-tools').length, 0, 'section without heading gets no controls');
});

test('4. clicking section TTS button triggers speech synthesis', async () => {
    const { book } = await imp.importEreaderJson(bookData());
    await reader.openBook(book.id, { switchView: () => {} });
    reader.enterBookView();

    const ttsBtn = document.querySelector('#ereaderContent .heading-tts-btn');
    assert.ok(ttsBtn);
    ttsBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    assert.equal(spoken.length, 1);
    assert.ok(spoken[0].includes('Erster Abschnitt'));
});

test('5. clicking section translate button translates section text', async () => {
    const { book } = await imp.importEreaderJson(bookData());
    await reader.openBook(book.id, { switchView: () => {} });
    reader.enterBookView();

    const transBtn = document.querySelector('#ereaderContent .heading-translate-btn');
    assert.ok(transBtn);
    transBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    // Wait microtask for async translation
    await new Promise(r => setTimeout(r, 50));

    assert.equal(translated.length, 1);
    assert.ok(translated[0].includes('Erster Abschnitt'));

    const transEl = document.querySelector('#ereaderContent .md-section-translation');
    assert.ok(transEl, 'translation element should be inserted');
    assert.equal(transEl.textContent, 'Türkçe çeviri');
});
