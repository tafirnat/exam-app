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
/** Each speech request's URL parameters, and the audio element last played. */
const speechParams = [];
let lastAudio = null;
dom.window.HTMLMediaElement.prototype.play = function () {
    spoken.push(decodeURIComponent(new URL(this.src).searchParams.get('text')));
    speechParams.push(new URL(this.src).searchParams);
    lastAudio = this;
    return Promise.resolve();
};
dom.window.HTMLMediaElement.prototype.pause = function () { };

const translated = [];
/** Each translation request's language pair, as `sl>tl`. */
const pairs = [];
global.fetch = async (url) => {
    const params = new URL(url).searchParams;
    translated.push(decodeURIComponent(params.get('q')));
    pairs.push(`${params.get('sl')}>${params.get('tl')}`);
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
    // e-Reader prefs (the translate switch, the language pairs) live in localStorage.
    localStorage.clear();
    storage._setIdbBackendForTests(makeIdb());
    ereaderStore._resetEreaderStoreForTests();
    reader._resetEreaderReaderForTests();
    reader.bindEreaderReader({ switchView: () => {}, closeMenu: () => {} });
    document.getElementById('ereaderContent').replaceChildren();
    await ereaderStore.loadEreader();
    state.AppState.ttsEnabled = true;
    state.AppState.translationTarget = 'tr';
    spoken.length = 0;
    speechParams.length = 0;
    lastAudio = null;
    translated.length = 0;
    pairs.length = 0;
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
    await reader.setTranslateIconsShown(true);
    await reader.setTtsShown(true);

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
    await reader.setTtsShown(true);

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
    await reader.setTranslateIconsShown(true);

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

test('6. translate icons are OFF by default; the switch shows them and hiding drops open translations', async () => {
    const { book } = await imp.importEreaderJson(bookData());
    await reader.openBook(book.id, { switchView: () => {} });
    reader.enterBookView();
    await reader.setTtsShown(true);
    const content = document.getElementById('ereaderContent');

    assert.equal(content.querySelectorAll('.heading-translate-btn').length, 0, 'no translate icons until switched on');
    assert.equal(content.querySelectorAll('.heading-tts-btn').length, 1, 'TTS is not affected by the translate switch');

    await reader.setTranslateIconsShown(true);
    const transBtn = content.querySelector('.heading-translate-btn');
    assert.ok(transBtn, 'the switch puts the icons in');
    transBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    assert.ok(content.querySelector('.md-section-translation'));

    await reader.setTranslateIconsShown(false);
    assert.equal(content.querySelectorAll('.heading-translate-btn').length, 0);
    assert.equal(content.querySelector('.md-section-translation'), null, 'an open translation goes with its icon');
    assert.equal(ereaderStore.getPrefs().showTranslateIcons, false);
});

test('7. the settings popup opens a translation popup with the switch and this book\'s language pair', async () => {
    const { book } = await imp.importEreaderJson(bookData());
    await reader.openBook(book.id, { switchView: () => {} });
    reader.enterBookView();

    reader.openSettingsOverlay();
    document.getElementById('ereaderTranslateSettingsBtn').click();
    assert.ok(reader.isTranslateSettingsOpen());
    assert.equal(document.getElementById('ereaderTranslateShowToggle').checked, false);
    // No pick yet: the book's own language -> the app's translation target.
    assert.equal(document.getElementById('ereaderTranslateSourceSelect').value, 'de');
    assert.equal(document.getElementById('ereaderTranslateTargetSelect').value, 'tr');
    assert.equal(document.getElementById('ereaderTranslateSourceSelect').options[0].value, 'auto');
    reader.closeTranslateSettings();
    reader.closeSettingsOverlay();

    // Never a same-language default: the app's target equal to the book's language is skipped.
    state.AppState.translationTarget = 'de';
    reader.openTranslateSettings();
    assert.equal(document.getElementById('ereaderTranslateTargetSelect').value, 'en');
    reader.closeTranslateSettings();
});

test('8. the language pair is saved per book on this device only, used for requests, and is the next default', async () => {
    const { book } = await imp.importEreaderJson(bookData());
    await reader.openBook(book.id, { switchView: () => {} });
    reader.enterBookView();
    await reader.setTranslateIconsShown(true);
    await reader.setOpenBookTranslation({ source: 'auto', target: 'en' });

    document.querySelector('#ereaderContent .heading-translate-btn')
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    assert.deepEqual(pairs, ['auto>en']);

    const stored = await ereaderStore.getBook(book.id);
    assert.equal(JSON.stringify(stored).includes('"target"'), false, 'the pair is never written into the book');
    assert.deepEqual(ereaderStore.getBookTranslation(book.id), { source: 'auto', target: 'en' });

    // Another book starts from the reader's last pick, and keeps its own once changed.
    const other = bookData();
    other.ereader.book_key = 'test-f9-other';
    other.ereader.title = 'Other';
    const { book: book2 } = await imp.importEreaderJson(other);
    assert.deepEqual(ereaderStore.getBookTranslation(book2.id), { source: 'auto', target: 'en' });
    await ereaderStore.setBookTranslation(book2.id, { source: 'de', target: 'fr' });
    assert.deepEqual(ereaderStore.getBookTranslation(book.id), { source: 'auto', target: 'en' });

    await ereaderStore.deleteBook(book2.id);
    assert.equal(ereaderStore.getPrefs().translation.books[book2.id], undefined, 'a deleted book takes its pair along');
});

function twoSectionBook() {
    return bookData([
        { id: 's1', title: 'Erster Abschnitt', level: 1, text: 'Das ist ein deutscher Text.' },
        { id: 's2', title: 'Zweiter Abschnitt', level: 1, text: 'Noch ein Text.' }
    ]);
}

test('9. read-aloud icons follow the e-reader switch (OFF by default), not the app-wide TTS setting', async () => {
    const { book } = await imp.importEreaderJson(bookData());
    await reader.openBook(book.id, { switchView: () => {} });
    reader.enterBookView();
    const content = document.getElementById('ereaderContent');

    assert.equal(state.AppState.ttsEnabled, true);
    assert.equal(content.querySelectorAll('.heading-tts-btn').length, 0, 'off until switched on in the e-reader');

    reader.openSettingsOverlay();
    assert.equal(document.getElementById('ereaderTtsShowToggle').checked, false);
    await reader.setTtsShown(true);
    assert.equal(content.querySelectorAll('.heading-tts-btn').length, 1);
    assert.equal(document.getElementById('ereaderTtsShowToggle').checked, true);

    state.AppState.ttsEnabled = false;
    await reader.setTtsShown(true);
    assert.equal(content.querySelectorAll('.heading-tts-btn').length, 1, 'the app-wide setting does not hide them');
    reader.closeSettingsOverlay();
});

test('10. the TTS popup defaults to the book language; language (per book) and speed are used for speech', async () => {
    const { book } = await imp.importEreaderJson(bookData());
    await reader.openBook(book.id, { switchView: () => {} });
    reader.enterBookView();
    await reader.setTtsShown(true);

    reader.openSettingsOverlay();
    document.getElementById('ereaderTtsSettingsBtn').click();
    assert.ok(reader.isTtsSettingsOpen());
    assert.equal(document.getElementById('ereaderTtsLangSelect').value, 'de', 'the book language');
    assert.equal(document.getElementById('ereaderTtsSpeed').value, '0.5');
    assert.equal(document.getElementById('ereaderTtsAutoplayToggle').checked, false);
    reader.closeTtsSettings();
    reader.closeSettingsOverlay();

    await reader.setOpenBookTts({ lang: 'fr', speed: 0.6 });
    document.querySelector('#ereaderContent .heading-tts-btn')
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(speechParams.length, 1);
    assert.equal(speechParams[0].get('lang'), 'fr');
    assert.equal(speechParams[0].get('speed'), '0.6');
    assert.ok(speechParams[0].get('name').startsWith('fr-FR-'));

    const stored = await ereaderStore.getBook(book.id);
    assert.equal(JSON.stringify(stored).includes('"fr"'), false, 'the language is never written into the book');
    assert.equal(ereaderStore.getBookTtsLang(book.id), 'fr');
    await ereaderStore.deleteBook(book.id);
    assert.equal(ereaderStore.getPrefs().tts.books[book.id], undefined, 'a deleted book takes its language along');
});

test('11. the section being read is highlighted; autoplay then reads the next section', async () => {
    const { book } = await imp.importEreaderJson(twoSectionBook());
    await reader.openBook(book.id, { switchView: () => {} });
    reader.enterBookView();
    await reader.setTtsShown(true);
    const content = document.getElementById('ereaderContent');
    const heading = (id) => content.querySelector(`.ereader-section[data-section-id="${id}"] h1`);
    const click = (id) => content.querySelector(`.ereader-section[data-section-id="${id}"] .heading-tts-btn`)
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    click('s1');
    assert.ok(heading('s1').classList.contains('tts-reading'), 'the section being read is marked');

    // Without autoplay the end of a section is the end.
    lastAudio.onended();
    await new Promise(r => setTimeout(r, 10));
    assert.equal(spoken.length, 1);
    assert.equal(content.querySelectorAll('.tts-reading').length, 0, 'the mark goes when reading stops');

    await reader.setOpenBookTts({ autoplay: true });
    click('s1');
    lastAudio.onended();
    await new Promise(r => setTimeout(r, 10));
    assert.equal(spoken.length, 3);
    assert.ok(spoken[2].includes('Zweiter Abschnitt'));
    assert.ok(heading('s2').classList.contains('tts-reading'));
    assert.ok(!heading('s1').classList.contains('tts-reading'));
});

test('12. switching read-aloud off stops speech and removes the icons', async () => {
    const { book } = await imp.importEreaderJson(bookData());
    await reader.openBook(book.id, { switchView: () => {} });
    reader.enterBookView();
    await reader.setTtsShown(true);
    document.querySelector('#ereaderContent .heading-tts-btn')
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.ok(testUi.isTtsPlaying('ereader:s1:0'));
    await reader.setTtsShown(false);
    assert.equal(testUi.isTtsPlaying('ereader:s1:0'), false);
    assert.equal(document.querySelectorAll('#ereaderContent .heading-tts-btn').length, 0);
});
