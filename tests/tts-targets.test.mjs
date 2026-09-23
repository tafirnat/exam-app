/* Which TTS button shows that it is playing.

   A card can carry any number of `.tts-btn` at once — the question, a
   flashcard's back, and a preview draws its own — and every playback re-renders
   them from nothing. The only thing that tells a rebuilt button whether it is
   the one speaking is its target key, so a button built without one inherits
   the state of whichever other keyless button is drawn first.

   That is the defect this locks: pressing the flashcard back's button turned
   the QUESTION card's button into a pause icon, and the back's own button never
   showed any state at all. The cases below are written against an arbitrary
   number of targets on purpose — two is the count that happened to ship, not
   the rule. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { url: 'https://example.test/' });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.Audio = dom.window.Audio;
global.Node = dom.window.Node;

/** The spoken text of each playback, read back off the synthesize URL. */
const spoken = [];
dom.window.HTMLMediaElement.prototype.play = function () {
    spoken.push(decodeURIComponent(new URL(this.src).searchParams.get('text')));
    return Promise.resolve();
};
dom.window.HTMLMediaElement.prototype.pause = function () { };

// state.js reads localStorage as it loads, so the globals go up first.
const { createTtsButton, TtsTarget, getIsAudioPlaying, isTtsPlaying, stopAudio } =
    await import('../src/features/test/test-ui.js');
const { AppState } = await import('../src/core/state.js');

const host = document.getElementById('host');

/* What a render does: the buttons are thrown away and built again from the live
   TTS state. Every case redraws through here, because a button that keeps its
   state only by surviving the render proves nothing. */
function draw(targets) {
    host.innerHTML = '';
    for (const target of targets) host.appendChild(createTtsButton(target));
    return [...host.querySelectorAll('.tts-btn')];
}

const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const playingFlags = (btns) => btns.map(b => b.classList.contains('playing'));

/** A card drawn with four speakable things, all keyed apart. */
const FOUR = [
    { text: 'Die Frage.', targetKey: TtsTarget.QUESTION },
    { text: 'Die Rueckseite.', targetKey: TtsTarget.FLASHCARD_BACK },
    { text: 'Abschnitt eins.', targetKey: TtsTarget.section('test', 0) },
    { text: 'Abschnitt zwei.', targetKey: TtsTarget.section('test', 1) }
];

test.beforeEach(() => {
    stopAudio(true);
    AppState.ttsEnabled = true;
    AppState.ttsAutoplay = false;
    spoken.length = 0;
});

test('the button that was pressed is the button that shows it', async () => {
    /* Every index in turn, not just the pair that shipped: a fix that special-
       cases the flashcard back would pass a two-button case and fail here. */
    for (let i = 0; i < FOUR.length; i++) {
        stopAudio(true);
        click(draw(FOUR)[i]);
        const flags = playingFlags(draw(FOUR));
        assert.deepEqual(flags, FOUR.map((_, j) => j === i),
            `pressing button ${i} lit up ${flags.map((on, j) => on ? j : null).filter(j => j !== null)}`);
    }
});

test('exactly one button is ever playing', async () => {
    // Walking across the card: each press must take the state off the last one.
    for (let i = 0; i < FOUR.length; i++) {
        click(draw(FOUR)[i]);
        assert.equal(playingFlags(draw(FOUR)).filter(Boolean).length, 1);
    }
});

test('each button speaks its own text', async () => {
    click(draw(FOUR)[1]);
    assert.match(spoken.at(-1), /Rueckseite/);
    click(draw(FOUR)[3]);
    assert.match(spoken.at(-1), /Abschnitt zwei/);
});

test('the playing button offers to stop, and a second press does', async () => {
    const idle = draw(FOUR)[1];
    const idleIcon = idle.innerHTML;
    click(idle);

    const playing = draw(FOUR)[1];
    assert.notEqual(playing.innerHTML, idleIcon, 'the playing button kept the play icon');
    assert.notEqual(playing.title, '', 'the button carries no tooltip');

    const played = spoken.length;
    click(playing);
    assert.equal(spoken.length, played, 'a second press must stop, not replay');
    assert.deepEqual(playingFlags(draw(FOUR)), [false, false, false, false]);
});

test('the question card does not claim another target playback', async () => {
    // getIsAudioPlaying() is the question button's own state, nothing wider.
    click(draw(FOUR)[1]);
    assert.equal(getIsAudioPlaying(), false);
    assert.equal(isTtsPlaying(TtsTarget.FLASHCARD_BACK), true);

    click(draw(FOUR)[0]);
    assert.equal(getIsAudioPlaying(), true);
    assert.equal(isTtsPlaying(TtsTarget.FLASHCARD_BACK), false);
});

test('every card-level target has a key of its own', async () => {
    const keys = [TtsTarget.QUESTION, TtsTarget.FLASHCARD_BACK, TtsTarget.PREVIEW];
    assert.equal(new Set(keys).size, keys.length, 'two card targets share a key');
    // A keyless target is the defect itself: it cannot be told from any other.
    for (const key of keys) assert.ok(key, 'a card target has no key');
    // Sections stay namespaced by view, so preview and test cannot collide.
    assert.notEqual(TtsTarget.section('test', 0), TtsTarget.section('preview', 0));
});

/* ---------------------------------------------------------------------------
   THE WRITING SIDE

   The cases above hand createTtsButton its keys, so they hold however badly the
   real call sites are wired: reverting the flashcard back to the QUESTION key —
   the shipped defect, verbatim — broke none of them. What the rule needs is the
   other half, that no two buttons on screen are asked to carry the same key and
   that no playback is started without one.
   --------------------------------------------------------------------------- */

/** Source with its comments gone, so the scan cannot match its own prose. */
function readCode(path) {
    return fs.readFileSync(new URL(path, import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter(line => !/^\s*(\/\/|\*)/.test(line))
        .join('\n');
}

const SOURCES = ['../src/features/test/test-ui.js', '../src/main.js'];

test('no two TTS buttons are built under the same key', async () => {
    const named = [];
    for (const path of SOURCES) {
        // The lookbehind skips the factory's own signature, which destructures
        // targetKey rather than naming one.
        for (const call of readCode(path).match(/(?<!function )createTtsButton\(\{[\s\S]*?\}\)/g) || []) {
            const key = call.match(/targetKey:\s*([^,\n}]+)/);
            assert.ok(key, `a createTtsButton call in ${path} names no targetKey:\n${call}`);
            named.push(key[1].trim());
        }
    }
    // Every card-level button in the app, so the count guards against a caller
    // quietly dropping out of the factory and hand-rolling a keyless button.
    assert.equal(named.length, 3, `expected 3 card-level TTS buttons, found ${named.length}`);
    assert.equal(new Set(named).size, named.length, `two buttons share a key: ${named.join(', ')}`);
});

test('no playback is started without a target', async () => {
    /* A null key is not "the default" — it is what stop() writes to mean that
       nothing is playing, so starting under it makes the question's button the
       accidental owner of someone else's audio. */
    for (const path of SOURCES) {
        const offenders = readCode(path).match(/\b(_play|toggle)\([^;]*?,\s*null\s*[,)]/g) || [];
        assert.deepEqual(offenders, [], `${path} starts a playback with no target: ${offenders.join(' | ')}`);
    }
});

test('a card-level button is never hand-rolled past the factory', async () => {
    // One builder means one answer to "which button is playing"; a second copy
    // is how the two that shipped came to disagree in the first place.
    for (const path of SOURCES) {
        const offenders = readCode(path).match(/className\s*=\s*'tts-btn'/g) || [];
        const allowed = path.endsWith('test-ui.js') ? 1 : 0; // the factory itself
        assert.equal(offenders.length, allowed, `${path} builds a .tts-btn outside createTtsButton`);
    }
});
