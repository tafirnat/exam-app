/**
 * Paragraph actions in the e-Reader (R2-10), after the reference book page:
 * each paragraph carries one small group of actions -
 *
 *   listen     reads the paragraph aloud in the book's language
 *   summary    core idea and logic of the paragraph (AI)
 *   vocab      concepts and terms, explained at B1 level (AI)
 *   translate  the paragraph in the translation target language
 *
 * and every result opens in ONE box directly under its paragraph
 * (.p-translation-box, data-view-mode = translate | summary | vocab) with
 * Copy, Retry and Hide in its header. A second press on the active action
 * closes the box; another action reuses it.
 *
 * Summary and vocab need an AI. With a direct connection (core/ai-client.js)
 * the answer is shown in the box; without one the box offers the prompt for a
 * web AI page, as the rest of the app does.
 *
 * Results are kept per paragraph and language, and which boxes were open is
 * remembered, so a section that scrolls out of the DOM and back comes back
 * as it was left.
 */

import { t, targetLanguages } from '../../core/i18n.js';
import { AppState, DEFAULT_AI_PROVIDERS } from '../../core/state.js';
import { translateText, escapeHTML, showToast } from '../../core/utils.js';
import { renderMarkdown } from '../../core/markdown.js';
import { getAiConnection, aiComplete } from '../../core/ai-client.js';
import { toggleSpeech, speakingKey, onSpeechChange, stopSpeech } from './ereader-tts.js';

export const Mode = Object.freeze({ TRANSLATE: 'translate', SUMMARY: 'summary', VOCAB: 'vocab' });
const RESULT_LIMIT = 300;
const MIN_PARAGRAPH_CHARS = 2;

const SVG_ATTRS = 'viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = Object.freeze({
    tts: `<svg ${SVG_ATTRS}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`,
    stop: `<svg ${SVG_ATTRS}><rect x="6" y="5" width="4" height="14"></rect><rect x="14" y="5" width="4" height="14"></rect></svg>`,
    summary: `<svg ${SVG_ATTRS}><path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M12 2a7 7 0 0 0-7 7c0 2.5 1.5 4.5 3 6h8c1.5-1.5 3-3.5 3-6a7 7 0 0 0-7-7Z"></path></svg>`,
    vocab: `<svg ${SVG_ATTRS}><path d="M4 11V6a2 2 0 0 1 2-2h4a2 2 0 0 0 4 0h4a2 2 0 0 1 2 2v5a2 2 0 0 0 0 4v5a2 2 0 0 1-2 2h-4a2 2 0 0 0-4 0H6a2 2 0 0 1-2-2v-5a2 2 0 0 0 0-4Z"></path></svg>`,
    translate: `<svg ${SVG_ATTRS}><path d="m5 8 6 6"></path><path d="m4 14 6-6 2-3"></path><path d="M2 5h12"></path><path d="M7 2h1"></path><path d="m22 22-5-10-5 10"></path><path d="M14 18h6"></path></svg>`,
    copy: `<svg ${SVG_ATTRS}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
    retry: `<svg ${SVG_ATTRS}><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>`,
    close: `<svg ${SVG_ATTRS}><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
});

/** cacheKey -> result text. */
const results = new Map();
/** `${bookId}:${sectionId}:${index}` -> open mode. */
const openBoxes = new Map();
let speechBound = false;

// ── pure helpers ──────────────────────────────────────────────────────────

/** The display name of a language code, in the interface language. */
export function languageName(code) {
    const primary = String(code || '').toLowerCase().split(/[-_]/)[0];
    try {
        if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
            const name = new Intl.DisplayNames([AppState.language || 'en'], { type: 'language' }).of(primary);
            if (name && name !== primary) return name;
        }
    } catch (_) {}
    const known = targetLanguages.find(l => l.code === primary);
    return known ? known.name : primary.toUpperCase();
}

/** English name, for the prompt itself (models follow English instructions best). */
function englishLanguageName(code) {
    const primary = String(code || '').toLowerCase().split(/[-_]/)[0];
    try {
        const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(primary);
        if (name) return name;
    } catch (_) {}
    return primary;
}

/** Pure. The AI prompt for a summary or a vocabulary list. */
export function buildPrompt(mode, text, { targetLang = 'en' } = {}) {
    const lang = englishLanguageName(targetLang);
    const body = `Paragraph:\n"""\n${String(text).trim()}\n"""`;
    if (mode === Mode.SUMMARY) {
        return `Explain the core idea and the underlying logic of the following paragraph in ${lang}. `
            + 'Use 2-4 short, plain sentences. No preamble, no heading.\n\n' + body;
    }
    if (mode === Mode.VOCAB) {
        return 'List the key concepts and technical terms of the following paragraph for a learner at CEFR B1 level. '
            + `For each one give the term exactly as written in the paragraph, then a short, simple explanation in ${lang}. `
            + 'Answer as a Markdown list, one item per line: "- **term** - explanation". At most 8 items. No preamble.\n\n' + body;
    }
    throw new Error(`no prompt for mode ${mode}`);
}

/** The paragraph's own text, without the action group inside it. */
export function paragraphText(p) {
    const clone = p.cloneNode(true);
    clone.querySelectorAll('.p-actions-group').forEach(el => el.remove());
    return clone.textContent.replace(/\s+/g, ' ').trim();
}

/** Pure. A short hash of a paragraph's text, so an edited paragraph never shows the old result. */
export function textHash(text) {
    let h = 5381;
    const str = String(text || '');
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}

function remember(key, text) {
    results.set(key, text);
    if (results.size > RESULT_LIMIT) results.delete(results.keys().next().value);
}

// ── DOM ───────────────────────────────────────────────────────────────────

function makeButton(cls, icon, title) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = cls;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML = icon;
    return btn;
}

function boxOf(p) {
    const next = p.nextElementSibling;
    return next && next.classList.contains('p-translation-box') ? next : null;
}

function modeTitle(mode) {
    if (mode === Mode.TRANSLATE) return t('p_action_translate', { lang: languageName(AppState.translationTarget) });
    if (mode === Mode.SUMMARY) return t('p_action_summary');
    return t('p_action_vocab');
}

function setActive(p, mode) {
    const group = p.querySelector('.p-actions-group');
    if (!group) return;
    group.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    group.classList.toggle('has-active', !!mode);
}

function closeBox(p, key) {
    const box = boxOf(p);
    if (box) box.remove();
    openBoxes.delete(key);
    setActive(p, null);
}

function smallButton(icon, title, label = '') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'p-trans-btn-sm';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML = icon + (label ? `<span>${escapeHTML(label)}</span>` : '');
    return btn;
}

function ensureBox(p, ctx) {
    let box = boxOf(p);
    if (box) return box;
    box = document.createElement('div');
    box.className = 'p-translation-box';
    box.dataset.forIndex = p.dataset.pIndex;

    const header = document.createElement('div');
    header.className = 'p-trans-header';
    const label = document.createElement('span');
    label.className = 'p-trans-label';
    const actions = document.createElement('div');
    actions.className = 'p-trans-actions';

    const copyBtn = smallButton(ICONS.copy, t('p_copy'), t('p_copy_short'));
    copyBtn.classList.add('copy-btn');
    copyBtn.onclick = async (e) => {
        e.stopPropagation();
        const text = box.querySelector('.p-trans-text')?.innerText?.trim();
        if (!text || !navigator.clipboard) return;
        try {
            await navigator.clipboard.writeText(text);
            showToast(t('p_copied'));
        } catch (_) {}
    };
    const retryBtn = smallButton(ICONS.retry, t('p_retry'));
    retryBtn.onclick = (e) => {
        e.stopPropagation();
        openBox(p, box.dataset.viewMode, ctx, { force: true });
    };
    const hideBtn = smallButton(ICONS.close, t('p_hide'));
    hideBtn.onclick = (e) => {
        e.stopPropagation();
        closeBox(p, ctx.key);
    };
    actions.append(copyBtn, retryBtn, hideBtn);
    header.append(label, actions);

    const body = document.createElement('div');
    body.className = 'p-trans-text';
    box.append(header, body);
    p.after(box);
    return box;
}

function showLoading(body) {
    body.classList.add('loading');
    body.innerHTML = `<span class="p-trans-loading"><i></i><i></i><i></i></span>`;
}

function showError(body, message) {
    body.classList.remove('loading');
    body.innerHTML = `<span class="p-trans-error">${escapeHTML(message)}</span>`;
}

function showResult(body, mode, text) {
    body.classList.remove('loading');
    if (mode === Mode.TRANSLATE) {
        body.textContent = text;
    } else {
        body.innerHTML = renderMarkdown(text);
    }
}

/** No AI connection: hand the prompt to a web AI page, as the test menu does. */
function showNeedsAi(body, prompt) {
    body.classList.remove('loading');
    const providers = AppState.aiProviders || DEFAULT_AI_PROVIDERS;
    const provider = providers[0];
    body.innerHTML = '';
    const msg = document.createElement('p');
    msg.className = 'p-ai-needed';
    msg.textContent = t('p_ai_needed');
    const row = document.createElement('div');
    row.className = 'p-ai-needed-actions';

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'p-ai-btn';
    copy.textContent = t('p_copy_prompt');
    copy.onclick = async (e) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(prompt);
            showToast(t('p_prompt_copied'));
        } catch (_) {}
    };
    row.appendChild(copy);

    if (provider) {
        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'p-ai-btn';
        openBtn.textContent = t('p_open_in', { name: provider.name });
        openBtn.onclick = async (e) => {
            e.stopPropagation();
            if (provider.url.includes('{PROMPT}')) {
                window.open(provider.url.replace('{PROMPT}', encodeURIComponent(prompt)), '_blank', 'noopener,noreferrer');
            } else {
                try { await navigator.clipboard.writeText(prompt); } catch (_) {}
                window.open(provider.url, '_blank', 'noopener,noreferrer');
            }
        };
        row.appendChild(openBtn);
    }

    const connect = document.createElement('button');
    connect.type = 'button';
    connect.className = 'p-ai-btn';
    connect.textContent = t('ai_connect_title');
    connect.onclick = (e) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('open-ai-connect'));
    };
    row.appendChild(connect);
    body.append(msg, row);
}

/**
 * Opens (or refreshes) the box under `p` in `mode` and fills it. force: fetch
 * again instead of using a kept result.
 */
export async function openBox(p, mode, ctx, { force = false } = {}) {
    const box = ensureBox(p, ctx);
    box.dataset.viewMode = mode;
    box.querySelector('.p-trans-label').textContent = modeTitle(mode);
    const body = box.querySelector('.p-trans-text');
    openBoxes.set(ctx.key, mode);
    setActive(p, mode);

    const text = paragraphText(p);
    const lang = AppState.translationTarget || 'en';
    const cacheKey = `${ctx.key}:${textHash(text)}:${mode}:${lang}`;
    if (force) results.delete(cacheKey);
    if (results.has(cacheKey)) {
        showResult(body, mode, results.get(cacheKey));
        return;
    }

    const stillHere = () => box.isConnected && box.dataset.viewMode === mode;

    if (mode === Mode.TRANSLATE) {
        showLoading(body);
        const translated = await translateText(text, lang);
        if (!stillHere()) return;
        if (!translated) {
            showError(body, t('p_error'));
            return;
        }
        remember(cacheKey, translated);
        showResult(body, mode, translated);
        return;
    }

    const prompt = buildPrompt(mode, text, { targetLang: lang });
    if (!getAiConnection()) {
        showNeedsAi(body, prompt);
        return;
    }
    showLoading(body);
    try {
        const reply = await aiComplete(prompt);
        if (!stillHere()) return;
        remember(cacheKey, reply);
        showResult(body, mode, reply);
    } catch (err) {
        console.warn('[ereader] AI request failed:', err);
        if (stillHere()) showError(body, t('p_ai_error'));
    }
}

function refreshSpeechButtons(key) {
    document.querySelectorAll('#ereaderContent .p-tts-btn').forEach(btn => {
        const on = !!key && btn.dataset.speechKey === key;
        btn.classList.toggle('playing', on);
        btn.innerHTML = on ? ICONS.stop : ICONS.tts;
    });
}

/**
 * Adds the action group to every paragraph of a mounted section and puts back
 * the boxes that were open when it was last mounted.
 */
export function decorateParagraphs(sectionEl, { book, sectionId }) {
    if (!sectionEl || !book) return;
    if (!speechBound) {
        speechBound = true;
        onSpeechChange(refreshSpeechButtons);
    }
    sectionEl.querySelectorAll('.p-actions-group, .p-translation-box').forEach(el => el.remove());

    const paragraphs = [...sectionEl.querySelectorAll('p')]
        .filter(p => !p.closest('.p-translation-box, figure, .md-callout-title, .md-image-placeholder'))
        .filter(p => paragraphText(p).length >= MIN_PARAGRAPH_CHARS);

    const bookLangName = languageName(book.language);
    paragraphs.forEach((p, index) => {
        p.classList.add('p-actionable');
        p.dataset.pIndex = String(index);
        const ctx = { key: `${book.id}:${sectionId}:${index}` };

        const group = document.createElement('span');
        group.className = 'p-actions-group';

        const speechKey = ctx.key;
        const tts = makeButton('p-tts-btn', speakingKey() === speechKey ? ICONS.stop : ICONS.tts, t('p_action_listen', { lang: bookLangName }));
        tts.dataset.speechKey = speechKey;
        if (speakingKey() === speechKey) tts.classList.add('playing');
        tts.onclick = (e) => {
            e.stopPropagation();
            toggleSpeech(paragraphText(p), book.language, speechKey);
        };

        const summary = makeButton('p-summary-btn', ICONS.summary, t('p_action_summary'));
        summary.dataset.mode = Mode.SUMMARY;
        const vocab = makeButton('p-vocab-btn', ICONS.vocab, t('p_action_vocab'));
        vocab.dataset.mode = Mode.VOCAB;
        const translate = makeButton('p-translate-btn', ICONS.translate, t('p_action_translate', { lang: languageName(AppState.translationTarget) }));
        translate.dataset.mode = Mode.TRANSLATE;

        for (const btn of [summary, vocab, translate]) {
            btn.onclick = (e) => {
                e.stopPropagation();
                const box = boxOf(p);
                if (box && box.dataset.viewMode === btn.dataset.mode) closeBox(p, ctx.key);
                else openBox(p, btn.dataset.mode, ctx);
            };
        }

        group.append(tts, summary, vocab, translate);
        p.appendChild(group);

        const wasOpen = openBoxes.get(ctx.key);
        if (wasOpen) openBox(p, wasOpen, ctx);
    });
}

/**
 * Touch screens have no hover: a tap on a paragraph shows its actions (and
 * hides the previous paragraph's). Returns true when the tap was used.
 */
export function onParagraphTap(e) {
    if (e.target.closest('.p-actions-group, .p-translation-box, a, button')) return false;
    const p = e.target.closest('p.p-actionable');
    const root = document.getElementById('ereaderContent');
    if (!root) return false;
    root.querySelectorAll('p.p-actions-visible').forEach(el => { if (el !== p) el.classList.remove('p-actions-visible'); });
    if (!p) return false;
    p.classList.toggle('p-actions-visible');
    return true;
}

/** A book is closed / the view is left. Kept results stay for the session. */
export function leaveParagraphActions() {
    stopSpeech();
}

/** Test seam. */
export function _resetParagraphActionsForTests() {
    results.clear();
    openBoxes.clear();
    stopSpeech();
}
