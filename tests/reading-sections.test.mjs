/* Per-heading speak/translate controls on a reading passage. The property that
   matters and cannot be eyeballed is the section boundary: a heading's controls
   must reach its own text and stop at the next heading of any level.

   The second one is spacing. The renderer joins its blocks with no whitespace
   at all, so reading a section with one textContent pass hands the speech API
   "Punkt einsPunkt zwei" as a single unpronounceable word — a defect you only
   hear, never see, which is why it is asserted here. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { url: 'https://example.test/' });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.Audio = dom.window.Audio;
global.Node = dom.window.Node;

/** The synthesize URL of each playback, so the spoken text can be read back. */
const spoken = [];
dom.window.HTMLMediaElement.prototype.play = function () {
    spoken.push(decodeURIComponent(new URL(this.src).searchParams.get('text')));
    return Promise.resolve();
};
dom.window.HTMLMediaElement.prototype.pause = function () { };

const translated = [];
global.fetch = async (url) => {
    translated.push(decodeURIComponent(new URL(url).searchParams.get('q')));
    return { json: async () => [[['çeviri', '', null]]] };
};

// state.js reads localStorage as it loads, so the globals go up first.
const { renderMarkdown } = await import('../src/core/markdown.js');
const { decorateReadingSections, getIsAudioPlaying, stopAudio } = await import('../src/features/test/test-ui.js');
const { AppState } = await import('../src/core/state.js');

const PASSAGE = `# Gesundheit

Der Arzt sagt etwas.

Noch ein Absatz.

## Termin

Ich habe einen Termin.

- Punkt eins
- Punkt zwei

### Absage

Leider muss ich absagen.`;

const host = document.getElementById('host');

/* The open-translation cache lives for as long as the module does and is keyed
   by question, so each test draws its own question rather than inheriting what
   the previous one left open. */
let drawn = { markdown: PASSAGE, cacheKey: 'q0' };
let questionCount = 0;

function render() {
    host.innerHTML = renderMarkdown(drawn.markdown);
    decorateReadingSections(host, { scope: 'test', cacheKey: drawn.cacheKey });
    return host;
}

/** Arriving at a new question: playback stopped, no translation carried over. */
function draw(markdown = PASSAGE) {
    stopAudio(true);
    AppState.ttsEnabled = true;
    AppState.translationTarget = 'tr';
    drawn = { markdown, cacheKey: `q${++questionCount}` };
    return render();
}

/** What every TTS state change does: same question, body built from scratch. */
const redraw = () => render();

const speakButtons = () => [...host.querySelectorAll('.heading-tts-btn')];
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

test('every heading gets a speak and a translate control, and nothing else does', () => {
    draw();
    const headings = [...host.querySelectorAll('h1, h2, h3, h4, h5, h6')];
    assert.equal(headings.length, 3);
    for (const heading of headings) {
        const tools = heading.querySelector('.heading-tools');
        assert.ok(tools, `${heading.tagName} has no controls`);
        assert.equal(tools.querySelectorAll('.heading-tts-btn').length, 1);
        assert.equal(tools.querySelectorAll('.heading-translate-btn').length, 1);
    }
    // The icons carry no text, so they must not enter the heading's own words.
    assert.equal(headings[0].textContent, 'Gesundheit');
});

test('a passage without headings gets no controls at all', () => {
    draw('Nur ein Absatz ohne Titel.');
    assert.equal(host.querySelectorAll('.heading-tools').length, 0);
});

test('decorating the same body twice does not double the controls', () => {
    draw();
    decorateReadingSections(host, { scope: 'test', cacheKey: drawn.cacheKey });
    assert.equal(host.querySelectorAll('.heading-tools').length, 3);
    assert.equal(host.querySelectorAll('.heading-tool-btn').length, 6);
});

test('a section starts at its own heading and stops at the next one', () => {
    draw();
    click(speakButtons()[0]);
    assert.equal(spoken.at(-1), 'Gesundheit Der Arzt sagt etwas. Noch ein Absatz.');
});

test('a section stops at the next heading of any level, not just its own', () => {
    // h3 Termin is followed by a deeper h4, which still ends the section.
    draw();
    click(speakButtons()[1]);
    assert.ok(!spoken.at(-1).includes('Absage'), `leaked into the next section: ${spoken.at(-1)}`);
});

test('the last section runs to the end of the passage', () => {
    draw();
    click(speakButtons().at(-1));
    assert.equal(spoken.at(-1), 'Absage Leider muss ich absagen.');
});

test('blocks are kept apart and inline markup is not', () => {
    draw(`## Titel

Ein **fetter** Satz mit *kursiv* und \`code\` darin.
Zweite Zeile desselben Absatzes.

- eins
    - verschachtelt
- zwei`);
    click(speakButtons()[0]);
    const text = spoken.at(-1);
    assert.ok(text.includes('Ein fetter Satz mit kursiv und code darin.'), `inline markup broke the sentence: ${text}`);
    assert.ok(text.includes('darin. Zweite Zeile'), `a line break inside a paragraph was lost: ${text}`);
    assert.ok(text.includes('eins verschachtelt zwei'), `list items were glued together: ${text}`);
});

test('only one control at a time looks like it is playing', () => {
    draw();
    click(speakButtons()[1]);
    // Playback re-renders the body, so this is what the next render must restore.
    redraw();
    const playing = speakButtons().filter(b => b.classList.contains('playing'));
    assert.equal(playing.length, 1);
    assert.equal(playing[0], speakButtons()[1]);
});

test('the card-level button does not claim a section playback', () => {
    // It still offers to read the whole text, so it must not show as playing.
    draw();
    click(speakButtons()[0]);
    assert.equal(getIsAudioPlaying(), false);
    stopAudio(true);
    assert.equal(getIsAudioPlaying(), false);
});

test('clicking the speaking section again stops it', () => {
    draw();
    click(speakButtons()[0]);
    const played = spoken.length;
    redraw();
    click(speakButtons()[0]);
    assert.equal(spoken.length, played, 'a second click must stop, not replay');
    redraw();
    assert.equal(speakButtons().filter(b => b.classList.contains('playing')).length, 0);
});

test('the speak control follows the Text-to-Speech setting', () => {
    draw();
    AppState.ttsEnabled = false;
    redraw();
    assert.equal(host.querySelectorAll('.heading-tts-btn').length, 0);
    // Translation is a separate setting, so it stays.
    assert.equal(host.querySelectorAll('.heading-translate-btn').length, 3);
});

test('a section is translated whole and lands before the next heading', async () => {
    draw();
    translated.length = 0;
    click(host.querySelector('.heading-translate-btn'));
    await new Promise(resolve => setTimeout(resolve, 20));

    assert.equal(translated.at(-1), 'Gesundheit\nDer Arzt sagt etwas.\nNoch ein Absatz.');
    const block = host.querySelector('.md-section-translation');
    assert.ok(block, 'no translation was inserted');
    assert.equal(block.nextElementSibling.tagName, 'H3', 'translation must sit inside its own section');
});

test('an open translation survives a re-render without asking again', async () => {
    draw();
    translated.length = 0;
    click(host.querySelector('.heading-translate-btn'));
    await new Promise(resolve => setTimeout(resolve, 20));

    redraw();
    assert.ok(host.querySelector('.md-section-translation'), 'a re-render dropped the open translation');
    assert.equal(translated.length, 1, 'the cached translation was fetched twice');
});

test('hiding a translation removes it, and a different question starts clean', async () => {
    draw();
    click(host.querySelector('.heading-translate-btn'));
    await new Promise(resolve => setTimeout(resolve, 20));
    click(host.querySelector('.heading-translate-btn'));
    assert.equal(host.querySelector('.md-section-translation'), null);

    click(host.querySelector('.heading-translate-btn'));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(host.querySelector('.md-section-translation'), 'a third click shows it again');

    draw(); // another question
    assert.equal(host.querySelector('.md-section-translation'), null);
});
