/**
 * e-Reader speech: reads a paragraph aloud in the BOOK's language (the test
 * centre's player speaks in the interface language, which is wrong for a
 * German book read with a Turkish interface).
 *
 * The speech endpoint takes the text in its URL, so a long paragraph is split
 * at sentence ends into short pieces played one after another.
 */

import { cleanTextForSpeech } from '../../core/tts-cleaner.js';
import { AppState } from '../../core/state.js';

/** Primary language -> the voice locale the endpoint knows. */
const VOICE_LOCALES = Object.freeze({
    tr: 'tr-TR', de: 'de-DE', en: 'en-US', fr: 'fr-FR', es: 'es-ES', it: 'it-IT',
    nl: 'nl-NL', pt: 'pt-PT', ru: 'ru-RU', pl: 'pl-PL', ar: 'ar-XA', zh: 'cmn-CN',
    ja: 'ja-JP', ko: 'ko-KR', sv: 'sv-SE', da: 'da-DK', nb: 'nb-NO', fi: 'fi-FI'
});
const PIECE_MAX = 180;

let audio = null;
let queue = [];
let currentKey = null;
const listeners = new Set();

/** Pure. The two-letter language a book's language tag speaks ("en_US" -> "en"). */
export function speechLang(language) {
    const primary = String(language || '').trim().toLowerCase().split(/[-_]/)[0];
    return /^[a-z]{2,3}$/.test(primary) && primary !== 'und' ? primary : 'en';
}

/**
 * Pure. Pieces of at most `max` characters, cut at sentence ends where
 * possible, then at spaces; never inside a word unless one word is longer.
 */
export function splitForSpeech(text, max = PIECE_MAX) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    const sentences = clean.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) || [clean];
    const pieces = [];
    let current = '';
    const push = () => {
        if (current.trim()) pieces.push(current.trim());
        current = '';
    };
    for (const sentence of sentences) {
        if ((current + sentence).length <= max) {
            current += sentence;
            continue;
        }
        push();
        if (sentence.length <= max) {
            current = sentence;
            continue;
        }
        for (const word of sentence.split(' ')) {
            if ((current + ' ' + word).trim().length > max) push();
            if (word.length > max) {
                for (let i = 0; i < word.length; i += max) pieces.push(word.slice(i, i + max));
            } else {
                current = current ? `${current} ${word}` : word;
            }
        }
    }
    push();
    return pieces;
}

function notify() {
    for (const fn of listeners) {
        try { fn(currentKey); } catch (_) {}
    }
}

function pieceUrl(text, lang) {
    const params = new URLSearchParams({
        enc: 'mpeg',
        lang,
        speed: String(AppState.ttsSpeed || 0.5),
        client: 'lr-language-tts',
        use_google_only_voices: '1',
        text
    });
    const locale = VOICE_LOCALES[lang];
    if (locale) params.set('name', `${locale}-Wavenet-${AppState.currentTtsVoice || 'A'}`);
    return `https://www.google.com/speech-api/v1/synthesize?${params.toString()}`;
}

function playNext(lang) {
    const piece = queue.shift();
    if (!piece) {
        finish();
        return;
    }
    audio = new Audio(pieceUrl(piece, lang));
    audio.onended = () => playNext(lang);
    const started = audio.play();
    if (started && typeof started.catch === 'function') {
        started.catch((err) => {
            console.error('[ereader-tts] playback failed:', err);
            finish();
        });
    }
}

function finish() {
    if (audio) {
        audio.onended = null;
        try { audio.pause(); } catch (_) {}
        audio = null;
    }
    queue = [];
    const had = currentKey !== null;
    currentKey = null;
    if (had) notify();
}

/** Speaks `text` in `language`; the same key again stops it. */
export function toggleSpeech(text, language, key) {
    if (currentKey === key) {
        finish();
        return false;
    }
    finish();
    const lang = speechLang(language);
    queue = splitForSpeech(cleanTextForSpeech(text, { lang, maxChars: 100000 }));
    if (queue.length === 0) return false;
    currentKey = key;
    notify();
    playNext(lang);
    return true;
}

export function stopSpeech() {
    finish();
}

export function speakingKey() {
    return currentKey;
}

/** fn(key|null) after every start and stop. Returns an unsubscribe. */
export function onSpeechChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
