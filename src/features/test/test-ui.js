
import { AppState, saveStats } from '../../core/state.js';
import { readJSON } from '../../core/storage.js';
import { translateText, showToast, showConfirm, getCorrectAnswers, escapeHTML } from '../../core/utils.js';
import { t, targetLanguages } from '../../core/i18n.js';
import { evaluateAnswer, updateStats, updateFlashcardStats, finishTest, calculateRetrievability } from './test-engine.js';
import { resetTimerForNewQuestion, stopTimer } from './timer-module.js';
import { getQuestionCategory } from '../../core/question-rules.js';
import { parseCloze, clozeMarkup, matchesBlank } from '../../core/cloze.js';
import { renderMarkdown, renderInlineMarkdown, plainText } from '../../core/markdown.js';

// --- TTS State Machine ---
// States: 'IDLE' | 'SCHEDULED' | 'PLAYING'
const TTS = {
    state: 'IDLE',
    audio: null,
    timerId: null,
    lastQIndex: -1,
    /* Which reading section is being spoken, or null when the target is a whole
       card. Every state change re-renders the question, which rebuilds the
       heading buttons from nothing, so this is what tells the rebuilt ones
       which single button should look like it is playing. */
    sectionKey: null,

    get isPlaying() { return this.state === 'PLAYING'; },
    get wasInterrupted() { return this.state === 'SCHEDULED' || this.state === 'PLAYING'; },

    _cancelSchedule() {
        if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
    },

    stop(silent = false) {
        this._cancelSchedule();
        if (this.audio) {
            this.audio.onended = null;
            this.audio.pause();
            this.audio = null;
        }
        const wasActive = this.state !== 'IDLE';
        this.state = 'IDLE';
        this.sectionKey = null;
        if (!silent && wasActive) renderQuestion(true);
    },

    schedule(text, delay) {
        this._cancelSchedule();
        this.state = 'SCHEDULED';
        this.timerId = setTimeout(() => {
            this.timerId = null;
            if (AppState.ttsAutoplay && this.state === 'SCHEDULED') {
                this._play(text);
            } else {
                this.state = 'IDLE';
            }
        }, delay);
    },

    _play(text, sectionKey = null) {
        if (!text) { this.state = 'IDLE'; this.sectionKey = null; return; }
        const cleanText = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!cleanText) { this.state = 'IDLE'; this.sectionKey = null; return; }
        const lang = AppState.language === 'tr' ? 'tr' : (AppState.language === 'de' ? 'de' : 'en');
        const voicePrefix = lang === 'tr' ? 'tr-TR-Wavenet-' : (lang === 'de' ? 'de-DE-Wavenet-' : 'en-US-Wavenet-');
        const voice = AppState.currentTtsVoice || 'A';
        const speed = AppState.ttsSpeed || 0.5;
        const baseUrl = 'https://www.google.com/speech-api/v1/synthesize';
        const params = new URLSearchParams({ enc: 'mpeg', lang, speed, client: 'lr-language-tts', use_google_only_voices: '1', name: voicePrefix + voice, text: cleanText });
        const url = `${baseUrl}?${params.toString()}`;

        this.audio = new Audio(url);
        this.state = 'PLAYING';
        this.sectionKey = sectionKey;
        renderQuestion(true);

        this.audio.play().catch(err => {
            console.error('TTS Playback failed:', err);
            this.audio = null;
            this.state = 'IDLE';
            this.sectionKey = null;
            renderQuestion(true);
        });

        this.audio.onended = () => {
            this.audio = null;
            this.state = 'IDLE';
            this.sectionKey = null;
            renderQuestion(true);
        };
    },

    /* A second click on whatever is currently speaking stops it; a click on any
       other target replaces it. That is what keeps the card button and the
       per-section buttons from ever playing over each other. */
    toggle(text, sectionKey = null) {
        if (this.state === 'PLAYING' && this.sectionKey === sectionKey) {
            this.stop(false);
        } else {
            this.stop(true);
            this._play(text, sectionKey);
        }
    },

    onNewQuestion(qIndex, text) {
        const isNew = qIndex !== this.lastQIndex;
        if (!isNew) return false;

        const needsLongDelay = this.wasInterrupted;
        this.stop(true); // silent stop: we'll re-render after scheduling
        this.lastQIndex = qIndex;

        if (AppState.ttsAutoplay && text) {
            const delay = needsLongDelay ? 5000 : 1000;
            this.schedule(text, delay);
        }
        return true;
    }
};

/**
 * Whether the whole card is being spoken — false while a single reading section
 * is, since that is the heading button's state to show and the card button is
 * still an offer to read the whole text.
 */
export function getIsAudioPlaying() {
    return TTS.isPlaying && TTS.sectionKey === null;
}

export function stopAudio(silent = false) {
    TTS.stop(silent);
}

/* ---------------------------------------------------------------------------
   READING SECTIONS
   ---------------------------------------------------------------------------
   A reading passage runs long enough that speaking or translating the whole of
   it in one go is no use to anyone. Every heading in a reading card therefore
   carries its own pair of controls, and each acts on exactly the text from that
   heading down to the next heading of any level: the passage's own structure
   decides the chunks, so a reader can work through it a section at a time.

   Only the reading category gets them. Everywhere else the text is short enough
   that the card-level buttons are the whole story, and the spec is explicit
   that those keep their existing reach over the full text.
   --------------------------------------------------------------------------- */

const SECTION_ICON_SPEAK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
const SECTION_ICON_STOP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
const SECTION_ICON_TRANSLATE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 8l6 6"></path><path d="M4 14l6-6 2-3"></path><path d="M2 5h12"></path><path d="M7 2h1"></path><path d="M22 22l-5-10-5 10"></path><path d="M14 18h6"></path></svg>';

const isHeadingEl = (el) => /^H[1-6]$/.test(el.tagName);

/* BR counts: the renderer joins the lines of one paragraph with it, so it is a
   real break in the prose and not decoration. */
const BLOCK_TAGS = /^(P|DIV|UL|OL|LI|TABLE|THEAD|TBODY|TR|TH|TD|BLOCKQUOTE|PRE|HR|BR|H[1-6])$/;

/**
 * The readable text of one block, with a line break wherever the markup starts a
 * new block. The renderer joins its output with no whitespace at all, so a flat
 * textContent read would hand the speech API "Punkt einsPunkt zwei" as a single
 * unpronounceable word; inline markup, by contrast, must not break the sentence
 * it sits in.
 * @param {Node} node
 * @returns {string}
 */
function readBlockText(node) {
    const parts = [];
    let inline = '';

    for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            inline += child.textContent;
            continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        // Our own additions are not part of the passage.
        if (child.classList.contains('heading-tools') || child.classList.contains('md-section-translation')) continue;

        if (BLOCK_TAGS.test(child.tagName)) {
            if (inline.trim()) parts.push(inline.trim());
            inline = '';
            const nested = readBlockText(child);
            if (nested) parts.push(nested);
        } else {
            inline += child.textContent;
        }
    }

    if (inline.trim()) parts.push(inline.trim());
    return parts.join('\n');
}

const currentTranslationTarget = () => AppState.translationTarget || 'tr';

/* A translation the reader opened outlives the re-render that every TTS play
   and stop triggers, so a section they opened does not blink shut while the
   passage is being spoken. Held per scope, keyed by question: moving to another
   question drops the previous one's entries. */
const sectionTranslations = new Map(); // scope -> { cacheKey, entries: Map }

function sectionTranslationEntries(scope, cacheKey) {
    const held = sectionTranslations.get(scope);
    if (held && held.cacheKey === cacheKey) return held.entries;
    const entries = new Map();
    sectionTranslations.set(scope, { cacheKey, entries });
    return entries;
}

/**
 * The heading-led sections of a rendered body, in document order.
 * @param {Element} rootEl The .md-content wrapper.
 * @returns {{heading: Element, next: Element|null, text: string, translationEl: Element|null}[]}
 */
function collectReadingSections(rootEl) {
    const blocks = Array.from(rootEl.children);
    const sections = [];

    blocks.forEach((block, start) => {
        if (!isHeadingEl(block)) return;
        let end = start + 1;
        while (end < blocks.length && !isHeadingEl(blocks[end])) end++;

        sections.push({
            heading: block,
            next: blocks[end] || null,
            text: blocks.slice(start, end)
                .filter(b => !b.classList.contains('md-section-translation'))
                .map(readBlockText)
                .filter(Boolean)
                .join('\n'),
            translationEl: null
        });
    });

    return sections;
}

/**
 * Gives every heading of a rendered reading passage its own speak and translate
 * control. Safe to call on every render: it reads the live TTS state and the
 * open-translation cache, so a rebuilt body comes back in the state it left.
 *
 * @param {Element} hostEl Element whose innerHTML was just set from renderMarkdown.
 * @param {Object} options
 * @param {string} options.scope Namespaces the buttons so the test view and the
 *        preview can never claim each other's playing state.
 * @param {string} options.cacheKey Identifies the question, so open translations
 *        are dropped when a different question is drawn.
 * @param {(() => void)|null} [options.onRefresh] Preview only: how to redraw
 *        when playback ends, since the preview is not what renderQuestion draws.
 */
export function decorateReadingSections(hostEl, { scope, cacheKey, onRefresh = null } = {}) {
    if (!hostEl) return;
    const rootEl = hostEl.querySelector('.md-content') || hostEl;
    /* Idempotent: callers normally hand over a body they have just rebuilt, but
       one that decorates the same DOM twice must not get two sets of icons. */
    rootEl.querySelectorAll('.heading-tools, .md-section-translation').forEach(el => el.remove());
    const sections = collectReadingSections(rootEl);
    if (sections.length === 0) return;

    const entries = sectionTranslationEntries(scope, cacheKey);

    sections.forEach((section, index) => {
        const sectionKey = `${scope}:${index}`;
        const tools = document.createElement('span');
        tools.className = 'heading-tools';

        // The speech control follows the Text-to-Speech setting, exactly as the
        // card-level button does: switching it off leaves no speech anywhere.
        if (AppState.ttsEnabled) {
            const speaking = TTS.isPlaying && TTS.sectionKey === sectionKey;
            const speakBtn = document.createElement('button');
            speakBtn.type = 'button';
            speakBtn.className = 'heading-tool-btn heading-tts-btn';
            if (speaking) speakBtn.classList.add('playing');
            speakBtn.title = t(speaking ? 'section_stop' : 'section_listen');
            speakBtn.setAttribute('aria-label', speakBtn.title);
            speakBtn.innerHTML = speaking ? SECTION_ICON_STOP : SECTION_ICON_SPEAK;
            speakBtn.onclick = (e) => {
                e.stopPropagation();
                handleTtsToggle(section.text, onRefresh, sectionKey);
            };
            tools.appendChild(speakBtn);
        }

        const transBtn = document.createElement('button');
        transBtn.type = 'button';
        transBtn.className = 'heading-tool-btn heading-translate-btn';
        transBtn.title = t('section_translate');
        transBtn.setAttribute('aria-label', transBtn.title);
        transBtn.innerHTML = SECTION_ICON_TRANSLATE;
        transBtn.onclick = (e) => {
            e.stopPropagation();
            toggleSectionTranslation(rootEl, section, entries, sectionKey, transBtn);
        };
        tools.appendChild(transBtn);

        section.heading.appendChild(tools);

        const held = entries.get(sectionKey);
        if (held && held.visible && held.lang === currentTranslationTarget()) {
            showSectionTranslation(rootEl, section, held, transBtn);
        }
    });
}

async function toggleSectionTranslation(rootEl, section, entries, sectionKey, btn) {
    const lang = currentTranslationTarget();
    const held = entries.get(sectionKey);

    // Already fetched for the language now selected: this is a show/hide only.
    if (held && held.lang === lang) {
        held.visible = !held.visible;
        if (held.visible) showSectionTranslation(rootEl, section, held, btn);
        else hideSectionTranslation(section, btn);
        return;
    }

    btn.classList.add('loading');
    try {
        const translated = await translateText(section.text, lang);
        if (!translated) return;
        const entry = { lang, text: translated, visible: true };
        entries.set(sectionKey, entry);
        /* A TTS state change may have rebuilt the body while the request was in
           flight, leaving these nodes detached. The cache entry is enough — the
           next decorate pass puts the translation back where it belongs. */
        if (!rootEl.isConnected) return;
        showSectionTranslation(rootEl, section, entry, btn);
    } finally {
        btn.classList.remove('loading');
    }
}

/** Places the translation at the end of its section, before the next heading. */
function showSectionTranslation(rootEl, section, entry, btn) {
    if (!section.translationEl) {
        const el = document.createElement('div');
        el.className = 'md-section-translation';
        if (section.next && section.next.parentNode === rootEl) rootEl.insertBefore(el, section.next);
        else rootEl.appendChild(el);
        section.translationEl = el;
    }
    section.translationEl.textContent = entry.text;
    btn.classList.add('active');
}

function hideSectionTranslation(section, btn) {
    if (section.translationEl) {
        section.translationEl.remove();
        section.translationEl = null;
    }
    btn.classList.remove('active');
}

export function renderQuestion(isRefresh = false) {
    if (!AppState.currentTest || AppState.currentTest.length === 0) {
        return;
    }


    const qIndex = AppState.currentIndex;
    const isNewQuestion = qIndex !== TTS.lastQIndex;

    // Handle session start or navigation
    if (!isRefresh && isNewQuestion) {
        const questionText = AppState.questionMap?.[AppState.currentTest?.[qIndex]]?.content?.text || '';
        TTS.onNewQuestion(qIndex, questionText);

        const summaryEl = document.getElementById('testSummarySection');
        if (summaryEl) {
            summaryEl.dataset.autoShown = 'false';
            summaryEl.dataset.manuallyToggled = 'false';
        }
    }

    const bottomNav = document.getElementById('bottomNav');
    if (bottomNav) bottomNav.classList.remove('nav-hidden');

    const q = AppState.questionMap[AppState.currentTest[qIndex]];
    const statKey = `${q.sourceId}_${q.id}`;
    const stat = AppState.stats[statKey] || { difficulty: 5.0, note: '' };
    const isChecked = AppState.isAnswerChecked[qIndex];

    document.getElementById('progressText').innerText = `${t('question_label')} ${qIndex + 1} / ${AppState.currentTest.length}`;
    const qTextEl = document.getElementById('questionText');
    const rawQText = q.content?.text || q.text || '';
    if (getQuestionCategory(q.type) === 'cloze') {
        qTextEl.innerHTML = clozeMarkup(rawQText);
    } else {
        qTextEl.innerHTML = renderMarkdown(rawQText);
    }

    // Handle Media (Images)
    const card = qTextEl.closest('.question-card');
    // Remove existing media
    card.querySelectorAll('.question-media').forEach(m => m.remove());

    // Flashcard front: style question-card as the front face
    card.querySelectorAll('.flashcard-label').forEach(el => el.remove());
    card.classList.remove('flashcard-front');
    if (q.type === 'flashcard') {
        card.classList.add('flashcard-front');
        const frontLabel = document.createElement('span');
        frontLabel.className = 'flashcard-label';
        frontLabel.textContent = t('flashcard_front');
        card.insertBefore(frontLabel, card.firstChild);
    }

    const media = q.content?.media || [];
    const imageMedia = media.find(m => m.type === 'image');

    if (imageMedia) {
        const img = document.createElement('img');
        img.src = imageMedia.url;
        img.className = 'question-media';
        if (imageMedia.position === 'below') {
            img.classList.add('position-below');
            // Insert after translation text (to be above options)
            const transEl = document.getElementById('trans_questionText');
            transEl.parentNode.insertBefore(img, transEl.nextSibling);
        } else {
            // Default: above
            card.insertBefore(img, qTextEl);
        }
    }

    // Handle TTS
    // Remove existing TTS elements
    card.querySelectorAll('.tts-btn').forEach(c => c.remove());
    if (AppState.ttsEnabled) {
        const playing = getIsAudioPlaying();
        const tBtn = document.createElement('button');
        tBtn.className = 'tts-btn';
        if (playing) tBtn.classList.add('playing');
        tBtn.innerHTML = playing ?
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>' :
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
        tBtn.onclick = () => TTS.toggle(q.content?.text || q.text || '');
        card.appendChild(tBtn);
        // Autoplay is now handled by TTS.onNewQuestion() called above
    }

    // Long passages are worked through a section at a time, so each heading of a
    // reading card gets its own speak and translate control.
    if (getQuestionCategory(q.type) === 'reading') {
        decorateReadingSections(qTextEl, { scope: 'test', cacheKey: `${q.sourceId}_${q.id}` });
    }

    // Reset translation state for new question
    const qTransEl = document.getElementById('trans_questionText');
    if (qTransEl) {
        qTransEl.innerText = '';
        qTransEl.style.display = 'none';
    }

    // Wire question translation button
    const qTransBtn = document.getElementById('questionTranslateBtn');
    if (qTransBtn) {
        qTransBtn.onclick = () => handleTranslation(qTransBtn, 'questionText', 'trans_questionText');
        qTransBtn.classList.remove('active');
    }

    const container = document.getElementById('optionsContainer');
    container.innerHTML = '';

    const noteInputEl = document.getElementById('noteInput');
    const noteAreaEl = document.getElementById('noteArea');
    const noteLabelEl = document.getElementById('noteLabel');

    const transTextEl = document.getElementById('trans_noteInput');
    if (transTextEl) {
        transTextEl.innerText = '';
        transTextEl.style.display = 'none';
    }

    if (noteInputEl && noteAreaEl) {
        const hasExplanation = q.answer && q.answer.explanation && q.answer.explanation.trim() !== '';
        const userNote = AppState.stats[statKey]?.note;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = userNote || '';
        const userHasNote = userNote && tempDiv.textContent.trim() !== '';
        const noteEditBtn = document.getElementById('noteEditBtn');
        const noteTransBtn = document.getElementById('noteTranslateBtn');

        // Reset editable state on load, default to read-only
        noteInputEl.contentEditable = "false";
        if (noteEditBtn) {
            noteEditBtn.classList.remove('active');
            noteEditBtn.style.display = 'flex';
        }

        const hasContent = userHasNote || hasExplanation;
        if (noteTransBtn) {
            noteTransBtn.style.display = hasContent ? 'flex' : 'none';
        }

        if (userHasNote) {
            // Display user personal note or user-edited explanation (read-only by default)
            noteInputEl.value = userNote;
            if (noteLabelEl) {
                noteLabelEl.setAttribute('data-i18n', 'note_label');
                noteLabelEl.innerText = t('note_label') || 'Your Note:';
            }
            if (isChecked && hasExplanation) {
                noteAreaEl.classList.add('visible');
            } else {
                noteAreaEl.classList.remove('visible');
            }
        } else if (hasExplanation) {
            noteInputEl.innerHTML = renderMarkdown(q.answer.explanation || '');
            if (noteLabelEl) {
                noteLabelEl.removeAttribute('data-i18n');
                noteLabelEl.innerText = t('explanation_label') || 'Explanation:';
            }
            if (isChecked) {
                noteAreaEl.classList.add('visible');
            } else {
                noteAreaEl.classList.remove('visible');
            }
        } else {
            // Display empty note (read-only by default)
            noteInputEl.value = '';
            if (noteLabelEl) {
                noteLabelEl.setAttribute('data-i18n', 'note_label');
                noteLabelEl.innerText = t('note_label') || 'Your Note:';
            }
            noteAreaEl.classList.remove('visible');
        }
    }
    
    updateFooterTags(q.tags, 'questionFooterTags');
    updateIndicators();
    updateQuestionStatsInfo(q.sourceId, q.id);

    if (q.type === 'flashcard') {
        if (isChecked) {
            const rawBack = q.answer?.back || '';
            const backContentHtml = renderMarkdown(rawBack);

            container.innerHTML = `
                <div class="flashcard-face flashcard-back">
                    <span class="flashcard-label">${t('flashcard_back')}</span>
                    <div class="flashcard-text" id="flashcardBackText">${backContentHtml}</div>
                    <div class="translation-text" id="trans_flashcardBackText" style="display:none;"></div>
                </div>
            `;

            const backFace = container.querySelector('.flashcard-back');

            // TTS button for back face
            if (AppState.ttsEnabled) {
                const tBtn = document.createElement('button');
                tBtn.className = 'tts-btn';
                tBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
                tBtn.onclick = () => TTS.toggle(q.answer?.back || '');
                backFace.appendChild(tBtn);
            }

            // Translate button for back face
            const transBtn = document.createElement('button');
            transBtn.className = 'corner-translate-btn';
            transBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 8l6 6"></path><path d="M4 14l6-6 2-3"></path><path d="M2 5h12"></path><path d="M7 2h1"></path><path d="M22 22l-5-10-5 10"></path><path d="M14 18h6"></path></svg>';
            transBtn.onclick = () => handleTranslation(transBtn, 'flashcardBackText', 'trans_flashcardBackText');
            backFace.appendChild(transBtn);
        }
    } else if (getQuestionCategory(q.type) === 'cloze') {
        renderClozeAnswer(container, q, qIndex, isChecked);
    } else if (getQuestionCategory(q.type) === 'text') {
        const val = AppState.userAnswers[qIndex]?.[0] || '';
        const isCorrect = isChecked ? evaluateAnswer(qIndex, [val]) : false;

        container.innerHTML = `
            <div class="text-input-wrapper">
                <input type="text" id="textAnswerInput" value="${val}" placeholder="${t('answer_placeholder')}" ${isChecked ? 'disabled' : ''} oninput="window.syncTextInput(this.value)">
                ${isChecked ? `
                    <div class="feedback-container" style="margin-top: 0.75rem; display: flex; align-items: start; gap: 0.5rem;">
                        <div style="flex: 1;">
                            ${!isCorrect ? `
                                <div id="correctAnswerText" class="correct-answer-feedback" style="color: var(--success-color); font-weight: 600; font-size: 0.9rem;">
                                    ${t('correct_answer_was')} ${getCorrectAnswers(q)[0] || ''}
                                </div>
                                <div id="trans_correctAnswerText" class="translation-text" style="display: none; margin-top: 0.25rem; font-size: 0.85rem; color: var(--text-secondary);"></div>
                            ` : ''}
                        </div>
                        ${!isCorrect ? `
                        <button id="feedbackTranslateBtn" class="corner-translate-btn" style="padding: 2px;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width: 14px; height: 14px;"><path d="M5 8l6 6"></path><path d="M4 14l6-6 2-3"></path><path d="M2 5h12"></path><path d="M7 2h1"></path><path d="M22 22l-5-10-5 10"></path><path d="M14 18h6"></path></svg>
                        </button>` : ''}
                    </div>
                ` : ''}
            </div>
        `;

        const input = document.getElementById('textAnswerInput');
        if (isChecked) {
            input.classList.add(isCorrect ? 'correct' : 'wrong');
            const fBtn = document.getElementById('feedbackTranslateBtn');
            if (fBtn) {
                fBtn.onclick = () => handleTranslation(fBtn, 'correctAnswerText', 'trans_correctAnswerText');
            }
        } else {
            input.onkeydown = (e) => {
                if (e.key === 'Enter') window.handleCheckAnswer();
            };
        }
    } else {
        const options = AppState.shuffledOptionsMap[q.id] || q.options || [];

        options.forEach(opt => {
            const isSelected = (AppState.userAnswers[qIndex] || []).includes(String(opt.id));
            const card = document.createElement('div');
            card.className = `option-card ${isSelected ? 'selected' : ''}`;

            if (isChecked) {
                const isOptionCorrect = getCorrectAnswers(q).map(String).includes(String(opt.id));
                if (isOptionCorrect) {
                    if (isSelected) card.classList.add('correct');
                    else card.classList.add('missed-correct');
                } else if (isSelected) {
                    card.classList.add('wrong'); // Wrongly selected option
                }
                card.classList.add('checked-state');
                
                // Dim unselected incorrect choices to emphasize the correct/missed ones
                if (!isOptionCorrect && !isSelected) {
                    card.style.opacity = '0.5';
                }
            }

            const input = document.createElement('input');
            input.type = q.type === 'multiple_choice' ? 'checkbox' : 'radio';
            input.checked = isSelected;
            input.onchange = () => selectOption(String(opt.id), input.type);

            const contentWrapper = document.createElement('div');
            contentWrapper.className = 'option-content-wrapper';
            contentWrapper.style.flex = '1';
            contentWrapper.style.display = 'flex';
            contentWrapper.style.flexDirection = 'column';

            const content = document.createElement('div');
            content.className = 'option-content';
            content.id = `optText_${opt.id}`;
            content.innerHTML = renderInlineMarkdown(opt.text);

            const trans = document.createElement('div');
            trans.className = 'translation-text';
            trans.id = `trans_optText_${opt.id}`;
            trans.style.marginTop = '0.5rem';
            trans.style.paddingTop = '0.5rem';
            trans.style.borderTop = '1px dashed var(--border-color)';

            contentWrapper.appendChild(content);
            contentWrapper.appendChild(trans);

            const tBtn = document.createElement('button');
            tBtn.className = 'corner-translate-btn';
            tBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 8l6 6"></path><path d="M4 14l6-6 2-3"></path><path d="M2 5h12"></path><path d="M7 2h1"></path><path d="M22 22l-5-10-5 10"></path><path d="M14 18h6"></path></svg>';
            tBtn.onclick = (e) => {
                e.stopPropagation();
                handleTranslation(tBtn, `optText_${opt.id}`, `trans_optText_${opt.id}`);
            };

            card.onclick = () => { if (!isChecked) selectOption(String(opt.id), input.type); };
            card.appendChild(input);
            card.appendChild(contentWrapper);
            card.appendChild(tBtn);
            container.appendChild(card);
        });
    }

    // Navigation updates
    document.getElementById('prevBtn').disabled = qIndex === 0;

    const isLastQuestion = qIndex === AppState.currentTest.length - 1;
    const nextBtn = document.getElementById('nextBtn');
    nextBtn.disabled = isLastQuestion;
    nextBtn.style.opacity = isLastQuestion ? '0.3' : '1';

    const checkBtn = document.getElementById('checkBtn');
    const difficultyPill = document.getElementById('difficultyPill');
    const checkText = document.getElementById('checkBtnText');
    const checkIcon = document.getElementById('checkIcon');

    const flashcardRatingBar = document.getElementById('flashcardRatingBar');

    if (checkBtn && difficultyPill) {
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');

        if (q.type === 'flashcard') {
            // Flashcard: hide difficultyPill; show reveal btn or rating bar
            difficultyPill.style.display = 'none';
            if (flashcardRatingBar) flashcardRatingBar.style.display = 'none';

            if (isChecked) {
                // Back is revealed — show only rating buttons, hide nav
                checkBtn.style.display = 'none';
                if (flashcardRatingBar) flashcardRatingBar.style.display = 'flex';
                if (prevBtn) prevBtn.style.display = 'none';
                if (nextBtn) nextBtn.style.display = 'none';
            } else {
                // Show "Cevabı Göster" button, show nav
                checkBtn.style.display = 'flex';
                checkBtn.disabled = false;
                checkBtn.style.opacity = '1';
                if (checkText) checkText.innerText = t('flashcard_reveal');
                if (checkIcon) checkIcon.style.display = 'none';
                if (prevBtn) prevBtn.style.display = '';
                if (nextBtn) nextBtn.style.display = '';
            }
        } else if (isChecked) {
            if (prevBtn) prevBtn.style.display = '';
            if (nextBtn) nextBtn.style.display = '';
            checkBtn.style.display = 'none';
            difficultyPill.style.display = 'flex';
            if (flashcardRatingBar) flashcardRatingBar.style.display = 'none';

            // Show current feedback if already given
            const result = AppState.testTracking?.results.find(r =>
                String(r.questionId) === String(q.id) && String(r.sourceId || q.sourceId) === String(q.sourceId)
            );
            const hardBtn = document.getElementById('diffHardBtn');
            const easyBtn = document.getElementById('diffEasyBtn');
            if (hardBtn && easyBtn) {
                hardBtn.classList.toggle('active', result?.feedback === 'hard');
                easyBtn.classList.toggle('active', result?.feedback === 'easy');
            }
        } else {
            checkBtn.style.display = 'flex';
            difficultyPill.style.display = 'none';
            if (flashcardRatingBar) flashcardRatingBar.style.display = 'none';
            if (checkText) checkText.innerText = t('check');
            if (checkIcon) checkIcon.style.display = 'none';
            checkBtn.disabled = false;
            checkBtn.style.opacity = '1';
            if (prevBtn) prevBtn.style.display = '';
            if (nextBtn) nextBtn.style.display = '';

            // Reset buttons
            const hardBtn = document.getElementById('diffHardBtn');
            const easyBtn = document.getElementById('diffEasyBtn');
            if (hardBtn && easyBtn) {
                hardBtn.classList.remove('active');
                easyBtn.classList.remove('active');
            }
        }
    }

    // Always show the summary section (Finish Test and Unanswered list) at the bottom
    renderSummarySection();
}

function renderSummarySection() {
    let summaryEl = document.getElementById('testSummarySection');
    if (!summaryEl) {
        summaryEl = document.createElement('div');
        summaryEl.id = 'testSummarySection';
        summaryEl.className = 'test-summary-section fade-in';
    }
    document.getElementById('testView').appendChild(summaryEl);

    // Visibility logic: hidden by default
    let isVisible = false;
    
    // Auto-show if it was just checked on the last question
    if (summaryEl.dataset.autoShown === 'true') {
        isVisible = true;
    }
    
    // Respect manual toggles (within the same question session)
    if (summaryEl.dataset.manuallyToggled === 'true') {
        isVisible = summaryEl.style.display !== 'none';
    }
    
    summaryEl.style.display = isVisible ? 'block' : 'none';

    // Apply dynamic bottom rule based on summary visibility
    const testView = document.getElementById('testView');
    if (testView) {
        testView.style.bottom = !isVisible ? '1rem' : '0';
    }

    // Quick Navigation & Overlay setup
    let quickNavEl = document.getElementById('quickNavContainer');
    if (!quickNavEl) {
        quickNavEl = document.createElement('div');
        quickNavEl.id = 'quickNavContainer';
        quickNavEl.className = 'quick-nav-container';
        document.body.appendChild(quickNavEl);
    }

    let overlayEl = document.getElementById('quickNavOverlay');
    if (!overlayEl) {
        overlayEl = document.createElement('div');
        overlayEl.id = 'quickNavOverlay';
        overlayEl.className = 'quick-nav-overlay';
        document.body.appendChild(overlayEl);
        overlayEl.onclick = () => window.toggleQuickNav(false);
    }

    // Set up click trigger on progress text
    const progressText = document.getElementById('progressText');
    if (progressText) {
        progressText.style.cursor = 'pointer';
        progressText.onclick = () => window.toggleQuickNav(true);
    }

    const unansweredIndices = [];
    AppState.currentTest.forEach((qId, idx) => {
        if (!AppState.isAnswerChecked[idx]) {
            const userAnswer = AppState.userAnswers[idx];
            const hasAnswer = userAnswer && Array.isArray(userAnswer) && userAnswer.length > 0 && userAnswer.some(v => v !== null && v !== undefined && String(v).trim() !== '');
            if (!hasAnswer) {
                unansweredIndices.push(idx);
            }
        }
    });

    let unansweredHtml = '';
    if (unansweredIndices.length > 0) {
        unansweredHtml = `
            <div style="margin-bottom: 1.5rem;">
                <h3 style="font-size: 1rem; margin-bottom: 0.75rem; color: var(--text-secondary);">${t('unanswered_questions')}</h3>
                <div class="unanswered-list">
                    ${unansweredIndices.map(idx => {
                        const rawTitle = AppState.questionMap[AppState.currentTest[idx]]?.text || '';
                        const safeTitle = escapeHTML(rawTitle.substring(0, 50));
                        return `
                            <div class="unanswered-item" data-question-idx="${idx}" title="${safeTitle}...">
                                <span class="unanswered-item-num">#${idx + 1}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    summaryEl.innerHTML = `
        ${unansweredHtml}
        <button class="btn btn-danger btn-block" id="finishTestBtn" style="margin-top: 1rem;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 20px; height: 20px;"><polyline points="20 6 9 17 4 12"></polyline></svg>
            ${t('finish_test')}
        </button>
    `;

    const unansweredContainer = summaryEl.querySelector('.unanswered-list');
    if (unansweredContainer) {
        unansweredContainer.onclick = (e) => {
            const item = e.target.closest('.unanswered-item');
            if (item && item.dataset.questionIdx !== undefined) {
                window.goToQuestion(parseInt(item.dataset.questionIdx, 10));
            }
        };
    }

    // Render Quick Nav content
    if (AppState.currentTest.length > 1) {
        quickNavEl.innerHTML = `
            <div class="quick-nav-number" id="quickNavNumberDisplay">
                ${t('go_to_question', { number: AppState.currentIndex + 1 })}
            </div>
            <input type="range" class="quick-nav-slider" id="quickNavSlider" 
                   min="0" max="${AppState.currentTest.length - 1}" 
                   value="${AppState.currentIndex}" step="1">
        `;

        const slider = document.getElementById('quickNavSlider');
        const display = document.getElementById('quickNavNumberDisplay');

        slider.oninput = (e) => {
            const val = parseInt(e.target.value);
            display.innerText = t('go_to_question', { number: val + 1 });
        };

        // Auto-navigate on release
        slider.onchange = (e) => {
            const val = parseInt(e.target.value);
            window.goToQuestion(val);
        };
    }

    document.getElementById('finishTestBtn').onclick = async () => {
        // Count questions whose answers were explicitly evaluated/checked
        let checkedCount = 0;
        AppState.currentTest.forEach((compositeId, idx) => {
            if (AppState.isAnswerChecked[idx]) {
                checkedCount++;
            }
        });
        if (window.updateHomeStats) window.updateHomeStats();

        // If no questions were evaluated/checked at all, go home silently without saving a test result
        if (checkedCount === 0) {
            const homeBtn = document.getElementById('resHomeBtn');
            if (homeBtn) homeBtn.click();
            return;
        }

        // Calculate truly unchecked questions for confirmation
        const trulyUnansweredCount = AppState.currentTest.length - checkedCount;

        if (trulyUnansweredCount > 0) {
            if (!await showConfirm(t('confirm_finish_test_unanswered'))) {
                return;
            }
        }
        showToast(t('test_completed'));
        try {
            console.log("Finishing test...");
            await finishTest();
            console.log("Test finished successfully.");
        } catch (err) {
            console.error("Error finishing test:", err);
            showToast(t('error_occurred'));
        }
    };
}

/* One input per blank, numbered to match the gaps shown in the sentence above.
   Answers are stored positionally, so userAnswers[qIndex][n] belongs to blank n
   and the grader can check each one against its own marker. */
function renderClozeAnswer(container, q, qIndex, isChecked) {
    const text = q.content?.text || q.text || '';
    const { blanks } = parseCloze(text);
    const given = AppState.userAnswers[qIndex] || [];
    const caseSensitive = q.answer?.caseSensitive || q.caseSensitive || false;

    container.innerHTML = `
        <div class="cloze-answer-list">
            ${blanks.map(blank => {
                const value = given[blank.index] ?? '';
                const ok = isChecked && matchesBlank(blank, value, caseSensitive);
                const state = isChecked ? (ok ? 'correct' : 'wrong') : '';
                return `
                <div class="cloze-answer-row">
                    <span class="cloze-gap">${blank.index + 1}</span>
                    <input type="text" class="cloze-input ${state}" data-blank="${blank.index}"
                        value="${escapeHTML(String(value))}" placeholder="${t('answer_placeholder')}"
                        ${isChecked ? 'disabled' : ''}
                        oninput="window.syncClozeInput(${blank.index}, this.value)">
                    ${isChecked && !ok ? `
                        <span class="cloze-expected">${escapeHTML(blank.answers[0] || '')}</span>` : ''}
                </div>`;
            }).join('')}
        </div>`;

    if (!isChecked) {
        container.querySelectorAll('.cloze-input').forEach(input => {
            input.onkeydown = (e) => {
                if (e.key === 'Enter') window.handleCheckAnswer();
            };
        });
        container.querySelector('.cloze-input')?.focus();
    }
}

window.syncClozeInput = (blankIndex, val) => {
    const current = AppState.userAnswers[AppState.currentIndex];
    // Keep it a dense array: a hole would read as "unanswered" for later blanks.
    const answers = Array.isArray(current) ? [...current] : [];
    const q = AppState.questionMap[AppState.currentTest[AppState.currentIndex]];
    const total = parseCloze(q?.content?.text || q?.text || '').blanks.length;
    while (answers.length < total) answers.push('');

    answers[blankIndex] = val;
    AppState.userAnswers[AppState.currentIndex] = answers;
};

window.syncTextInput = (val) => {
    AppState.userAnswers[AppState.currentIndex] = [val];
    // We don't call renderQuestion here to avoid losing focus/cursor pos,
    // but we should update the unanswered list if it's visible.
    // However, the summary section is usually at the bottom, so full re-render is overkill.
    // Let's at least update the unanswered list if needed.
    const unansweredIndices = [];
    AppState.currentTest.forEach((qId, idx) => {
        if (!AppState.isAnswerChecked[idx]) {
            const userAnswer = AppState.userAnswers[idx];
            const hasAnswer = userAnswer && Array.isArray(userAnswer) && userAnswer.length > 0 && userAnswer.some(v => v !== null && v !== undefined && String(v).trim() !== '');
            if (!hasAnswer) unansweredIndices.push(idx);
        }
    });
    // Tiny optimization: just update the unanswered list if it exists
    const unansweredList = document.querySelector('.unanswered-list');
    if (unansweredList) {
        unansweredList.innerHTML = unansweredIndices.map(idx => `
            <div class="unanswered-item" onclick="window.goToQuestion(${idx})" title="${escapeHTML((AppState.questionMap[AppState.currentTest[idx]]?.text || '').substring(0, 50))}...">
                <span class="unanswered-item-num">#${idx + 1}</span>
            </div>
        `).join('');
        // Also update the heading if needed, but let's keep it simple
    }
};

window.goToQuestion = (idx) => {
    AppState.currentIndex = idx;
    window.toggleQuickNav(false);
    renderQuestion();
};

window.toggleQuickNav = (show) => {
    const nav = document.getElementById('quickNavContainer');
    const overlay = document.getElementById('quickNavOverlay');
    if (nav && overlay) {
        if (show === undefined) show = !nav.classList.contains('visible');
        nav.classList.toggle('visible', show);
        overlay.classList.toggle('visible', show);

        if (show) {
            // Update slider value to current index when opening
            const slider = document.getElementById('quickNavSlider');
            const display = document.getElementById('quickNavNumberDisplay');
            if (slider && display) {
                slider.value = AppState.currentIndex;
                display.innerText = t('go_to_question', { number: AppState.currentIndex + 1 });
            }
        }
    }
};

export function selectOption(id, type) {
    const qIndex = AppState.currentIndex;
    if (AppState.isAnswerChecked[qIndex]) return;

    let selected = AppState.userAnswers[qIndex] || [];
    if (type === 'radio') {
        selected = [id];
    } else {
        const i = selected.indexOf(id);
        if (i > -1) selected.splice(i, 1);
        else selected.push(id);
    }
    AppState.userAnswers[qIndex] = selected;
    if (AppState.timerCountdownEnabled) {
        stopTimer();
    }
    renderQuestion();
}

export const handleCheckAnswer = (forceCheck = false) => {
    window.handleCheckAnswer = handleCheckAnswer;
    const qIndex = AppState.currentIndex;
    if (AppState.isAnswerChecked[qIndex]) return;

    const q = AppState.questionMap[AppState.currentTest[qIndex]];
    let userAnswer = AppState.userAnswers[qIndex] || [];

    // Flashcard: just reveal the back face, don't evaluate
    if (q.type === 'flashcard') {
        AppState.isAnswerChecked[qIndex] = true;
        renderQuestion();
        return;
    }

    const answerCategory = getQuestionCategory(q.type);

    if (answerCategory === 'cloze') {
        const inputs = [...document.querySelectorAll('.cloze-input')];
        if (inputs.length) {
            userAnswer = inputs.map(i => i.value.trim());
            // Checking with every blank still empty is almost always a misclick.
            if (userAnswer.every(v => v === '') && !forceCheck) return;
            AppState.userAnswers[qIndex] = userAnswer;
        }
    } else if (answerCategory === 'text') {
        const input = document.getElementById('textAnswerInput');
        if (input) {
            const val = input.value.trim();
            if (!val && !forceCheck) return;
            userAnswer = [val];
            AppState.userAnswers[qIndex] = userAnswer;
        }
    } else {
        if (!userAnswer.length && !forceCheck) return;
    }

    const isCorrect = evaluateAnswer(qIndex, userAnswer);
    AppState.isAnswerChecked[qIndex] = true;
    updateStats(q.sourceId, q.id, isCorrect, userAnswer);
    if (window.updateHomeStats) window.updateHomeStats();

    // Auto-show summary if this is the last question
    const isLastQuestion = qIndex === AppState.currentTest.length - 1;
    if (isLastQuestion) {
        const summaryEl = document.getElementById('testSummarySection');
        if (summaryEl) summaryEl.dataset.autoShown = 'true';
    }

    if (AppState.timerCountdownEnabled) {
        stopTimer();
    }
    renderQuestion();
};

export async function handleTranslation(btn, sid, tid) {
    const srcEl = document.getElementById(sid);
    const targetEl = document.getElementById(tid);
    if (!targetEl.innerText) {
        btn.classList.add('loading');
        try {
            const translated = await translateText(srcEl.innerText);
            if (translated) {
                targetEl.innerText = translated;
                targetEl.style.display = 'block';
                btn.classList.add('active');
            }
        } finally {
            btn.classList.remove('loading');
        }
    } else {
        const isVisible = targetEl.style.display !== 'none';
        targetEl.style.display = isVisible ? 'none' : 'block';
        btn.classList.toggle('active', !isVisible);
    }
}

export function updateIndicators() {
    const qIndex = AppState.currentIndex;
    const q = AppState.questionMap[AppState.currentTest[qIndex]];
    if (!q) return;
    const statKey = `${q.sourceId}_${q.id}`;
    const s = AppState.stats[statKey] || {};
    document.getElementById('indStar').classList.toggle('active-star', !!s.starred);
    document.getElementById('indFlag').classList.toggle('active-flag', !!s.flagged);
    const hasExplanation = q.answer && q.answer.explanation && q.answer.explanation.trim() !== '';
    const hasNote = s.note && s.note.trim() !== '';
    document.getElementById('indNote').classList.toggle('active-note', !!(hasExplanation || hasNote));
}

export function updateQuestionStatsInfo(sourceId, qid) {
    const statKey = `${sourceId}_${qid}`;
    const s = AppState.stats[statKey] || { correct: 0, wrong: 0, difficulty: 5.0, stability: 0, lastReview: null };
    const infoEl = document.getElementById('questionStatsInfo');
    if (infoEl) {
        const total = s.correct + s.wrong;
        const percent = total > 0 ? Math.round((s.correct / total) * 100) : 0;

        const r = calculateRetrievability(s.stability, s.lastReview);
        const rPercent = r > 0 ? Math.round(r * 100) : null;

        // Check if any question has been answered/checked in the active test session
        let hasInteraction = false;
        if (AppState.currentTest && Array.isArray(AppState.currentTest)) {
            AppState.currentTest.forEach((_, idx) => {
                if (AppState.isAnswerChecked[idx]) hasInteraction = true;
                const ua = AppState.userAnswers[idx];
                if (ua && ua.length > 0 && ua.some(v => v !== null && v !== undefined && String(v).trim() !== '')) hasInteraction = true;
            });
        }

        infoEl.innerHTML = `
            <div class="question-stats-left">
                ${rPercent !== null ? `<span class="stats-item-retrievability ${r <= 0.9 ? 'overdue' : ''}" title="Retrievability: ${rPercent}%">🧠 ${rPercent}%</span>` : ''}
                <span>${t('correct')}: <b>${s.correct}</b></span>
                <span>${t('wrong')}: <b>${s.wrong}</b></span>
                <span>${t('success_percent', { percent })}</span>
                <span>${t('difficulty_label')} <b>${(s.difficulty / 2).toFixed(1)}</b></span>
            </div>
            <div class="test-bottom-actions">
                <button type="button" class="test-action-btn edit-btn" id="testEditQuestionBtn" title="${t('edit') || 'Düzenle'}">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                    <span>${t('edit') || 'Düzenle'}</span>
                </button>
                <button type="button" class="test-action-btn home-btn" id="testHomeBtn" title="${t('go_home') || 'Ana Sayfa'}">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                        <polyline points="9 22 9 12 15 12 15 22"></polyline>
                    </svg>
                    <span>${t('go_home') || 'Ana Sayfa'}</span>
                </button>
                <button type="button" class="test-action-btn exit-btn" id="scrollSummaryBtn" title="${t('exit') || 'Testi Bitir'}" style="display: ${hasInteraction ? 'inline-flex' : 'none'};">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                        <polyline points="16 17 21 12 16 7"></polyline>
                        <line x1="21" y1="12" x2="9" y2="12"></line>
                    </svg>
                    <span>${t('exit') || 'Bitir'}</span>
                </button>
            </div>
        `;
        infoEl.classList.add('visible');

        const homeBtn = document.getElementById('testHomeBtn');
        if (homeBtn) {
            homeBtn.onclick = (e) => {
                e.stopPropagation();
                if (window.goHome) {
                    window.goHome();
                } else if (window.switchView) {
                    window.switchView('home');
                }
            };
        }

        const editBtn = document.getElementById('testEditQuestionBtn');
        if (editBtn) {
            editBtn.onclick = (e) => {
                e.stopPropagation();
                if (window.openQuestionEditor) {
                    const qIndex = AppState.currentIndex;
                    const q = AppState.questionMap[AppState.currentTest[qIndex]];
                    if (q) window.openQuestionEditor(q);
                }
            };
        }

        const scrollBtn = document.getElementById('scrollSummaryBtn');
        if (scrollBtn) {
            scrollBtn.onclick = (e) => {
                e.stopPropagation();
                if (!hasInteraction) {
                    const finishBtn = document.getElementById('finishTestBtn');
                    if (finishBtn) finishBtn.click();
                    return;
                }

                const summarySection = document.getElementById('testSummarySection');
                if (summarySection) {
                    const isHidden = summarySection.style.display === 'none';
                    summarySection.style.display = isHidden ? 'block' : 'none';
                    summarySection.dataset.manuallyToggled = 'true';

                    const testView = document.getElementById('testView');
                    if (testView) {
                        testView.style.bottom = isHidden ? '0' : '1rem';
                    }

                    if (isHidden) {
                        summarySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }
            };
        }
    }
}

export function handleDifficultyRating(rating) {
    const qIndex = AppState.currentIndex;
    const q = AppState.questionMap[AppState.currentTest[qIndex]];
    if (!q) return;

    const hardBtn = document.getElementById('diffHardBtn');
    const easyBtn = document.getElementById('diffEasyBtn');

    // Use the button's current active state as the single source of truth for toggle.
    // This avoids any ambiguity between null / undefined in existingResult.feedback.
    const clickedBtn = rating === 'hard' ? hardBtn : easyBtn;
    const isCurrentlyActive = clickedBtn?.classList.contains('active');
    const targetRating = isCurrentlyActive ? undefined : rating; // undefined = "no special feedback"

    // Special case: switching from hard → easy stars the question
    const existingResult = AppState.testTracking?.results.find(r =>
        String(r.questionId) === String(q.id) && String(r.sourceId || q.sourceId) === String(q.sourceId)
    );
    if (!isCurrentlyActive && rating === 'easy' && existingResult?.feedback === 'hard') {
        const statKey = `${q.sourceId}_${q.id}`;
        if (!AppState.stats[statKey]) AppState.stats[statKey] = { difficulty: 5.0, correct: 0, wrong: 0 };
        AppState.stats[statKey].starred = true;
        updateIndicators();
    }

    // Use the isCorrect already stored in existingResult to stay consistent with check time.
    // Fall back to re-evaluation only if no tracking entry exists yet.
    const isCorrect = existingResult ? existingResult.isCorrect : evaluateAnswer(qIndex, AppState.userAnswers[qIndex] || []);
    const userAnswer = AppState.userAnswers[qIndex] || [];

    updateStats(q.sourceId, q.id, isCorrect, userAnswer, targetRating);
    saveStats();

    // Reflect toggle state visually
    if (hardBtn && easyBtn) {
        hardBtn.classList.toggle('active', targetRating === 'hard');
        easyBtn.classList.toggle('active', targetRating === 'easy');
    }

    updateQuestionStatsInfo(q.sourceId, q.id);
    if (window.updateHomeStats) window.updateHomeStats();

    if (targetRating === undefined) {
        showToast(t('feedback_removed'));
    } else {
        showToast(`${t('difficulty_' + rating)} ${t('feedback_received')}.`);
    }
}
export function handleFlashcardRating(ratingKey) {
    const ratingMap = { again: 1, hard: 2, normal: 3, easy: 4 };
    const rating = ratingMap[ratingKey];
    if (!rating) return;

    const qIndex = AppState.currentIndex;
    const q = AppState.questionMap[AppState.currentTest[qIndex]];
    if (!q) return;

    updateFlashcardStats(q.sourceId, q.id, rating);
    if (window.updateHomeStats) window.updateHomeStats();

    // Auto-advance to next question
    const isLastQuestion = qIndex === AppState.currentTest.length - 1;
    if (isLastQuestion) {
        const summaryEl = document.getElementById('testSummarySection');
        if (summaryEl) summaryEl.dataset.autoShown = 'true';
        renderQuestion();
    } else {
        AppState.currentIndex++;
        renderQuestion();
    }
}

export function renderTestResults() {
    let latestTest = AppState.recentTests && AppState.recentTests.length > 0 ? AppState.recentTests[0] : null;

    if (!latestTest) {
        console.warn("renderTestResults: No recent tests found.");
        // Try to show something instead of just a blank screen if we are in results view
        if (document.getElementById('resultsView').style.display !== 'none') {
            document.getElementById('resCorrectCount').textContent = '-';
            document.getElementById('resWrongCount').textContent = '-';
            document.getElementById('resUnansweredCount').textContent = '-';
            document.getElementById('resSuccessRate').textContent = '-%';
        }
        return;
    }

    // Update individual stat values with safety defaults
    const correct = latestTest.correctCount ?? 0;
    const wrong = latestTest.wrongCount ?? 0;
    const unanswered = latestTest.unansweredCount ?? 0;
    // Success Rate Calculation (Correct / Total Questions)
    const totalQuestions = correct + wrong + unanswered;
    const rate = totalQuestions > 0 ? Math.round((correct / totalQuestions) * 100) : 0;

    document.getElementById('resCorrectCount').textContent = correct;
    document.getElementById('resWrongCount').textContent = wrong;
    document.getElementById('resUnansweredCount').textContent = unanswered;
    document.getElementById('resSuccessRate').textContent = `${rate}%`;

    // Display Duration if available
    const durationBox = document.getElementById('resDurationBox');
    const durationText = document.getElementById('resDurationText');
    if (durationBox && durationText) {
        const secs = latestTest.elapsedSeconds || 0;
        if (secs > 0) {
            const m = Math.floor(secs / 60).toString().padStart(2, '0');
            const s = Math.floor(secs % 60).toString().padStart(2, '0');
            durationText.textContent = `${m}:${s}`;
            durationBox.style.display = 'flex';
        } else {
            durationBox.style.display = 'none';
        }
    }

    // Gauge Update (3-Segment Donut)
    const gauge = document.querySelector('.success-rate-gauge');
    if (gauge) {
        const total = correct + wrong + unanswered;
        if (total > 0) {
            const correctDeg = (correct / total) * 360;
            const wrongDeg = (wrong / total) * 360;
            const unansweredDeg = (unanswered / total) * 360;

            // Colors
            const colorCorrect = 'var(--success-color)';
            const colorWrong = 'var(--error-color)';
            const colorUnanswered = 'rgba(148, 163, 184, 0.3)'; // Grey as requested

            gauge.style.background = `conic-gradient(
                ${colorCorrect} 0deg ${correctDeg}deg, 
                ${colorWrong} ${correctDeg}deg ${correctDeg + wrongDeg}deg, 
                ${colorUnanswered} ${correctDeg + wrongDeg}deg 360deg
            )`;
        } else {
            gauge.style.background = 'var(--border-color)';
        }
    }
    
    // Update rate text inside gauge if it exists
    const gaugeRateText = document.getElementById('resSuccessRateGaugeText');
    if (gaugeRateText) gaugeRateText.textContent = `${rate}%`;

    // Question List
    const listEl = document.getElementById('resQuestionList');
    if (listEl) {
        listEl.innerHTML = '';
        if (latestTest.questions && Array.isArray(latestTest.questions) && latestTest.questions.length > 0) {
            latestTest.questions.forEach((q, idx) => {
                if (!q) return;
                const item = document.createElement('div');
                item.className = 'result-item';
                if (q.isCorrect) {
                    item.classList.add('correct');
                } else if (q.isUnanswered) {
                    item.classList.add('unanswered');
                } else {
                    item.classList.add('wrong');
                }

                item.innerHTML = `${idx + 1}`; // Just the number as per mockup
                item.onclick = () => window.showQuestionResult(latestTest.id, q.id);
                listEl.appendChild(item);
            });
        } else {
            listEl.innerHTML = `<div style="opacity: 0.5; font-size: 0.8rem; text-align: center; width: 100%;">${t('no_details_available')}</div>`;
        }
    }

    const dateEl = document.getElementById('resultsDate');
    if (dateEl && latestTest.endTime) {
        try {
            const date = new Date(latestTest.endTime);
            dateEl.textContent = date.toLocaleString();
        } catch (e) {}
    }
}

window.showQuestionResult = (testId, questionId) => {
    const test = AppState.recentTests.find(t => t.id === testId);
    if (!test) return;
    const q = test.questions.find(item => String(item.id) === String(questionId));
    if (!q) return;

    // Use stats preview logic from main.js (needs to be available)
    window.dispatchEvent(new CustomEvent('show-stats-preview', {
        detail: { 
            question: q, 
            stats: AppState.stats[`${q.sourceId}_${q.id}`] || { difficulty: 5.0, correct: 0, wrong: 0 }, 
            source: 'results' 
        }
    }));
};

// handleTtsToggle: preview bağlamı için onRefresh callback desteğiyle TTS toggle
export function handleTtsToggle(text, onRefresh = null, sectionKey = null) {
    if (onRefresh) {
        // Preview context: use a custom refresh callback via a one-shot wrapper
        if (TTS.isPlaying && TTS.sectionKey === sectionKey) {
            TTS.stop(true);
            onRefresh();
        } else {
            TTS.stop(true);
            TTS._play(text, sectionKey);
            if (TTS.audio) {
                const origOnEnded = TTS.audio.onended;
                TTS.audio.onended = () => {
                    if (origOnEnded) origOnEnded();
                    onRefresh();
                };
            }
            onRefresh();
        }
    } else {
        TTS.toggle(text, sectionKey);
    }
}

export function updateFooterTags(tags, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    if (!tags || !Array.isArray(tags) || tags.length === 0) return;

    // Add Tag Icon once
    const iconSpan = document.createElement('span');
    iconSpan.className = 'tag-icon';
    iconSpan.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>';
    container.appendChild(iconSpan);

    tags.forEach(tag => {
        const tagEl = document.createElement('span');
        tagEl.className = 'footer-tag-item';
        tagEl.innerText = tag;
        tagEl.style.cursor = 'pointer'; // Ensure pointer cursor for accessibility
        tagEl.onclick = (e) => {
            e.stopPropagation();
            if (typeof window.executeTagSearch === 'function') {
                window.executeTagSearch(tag);
            } else {
                if (window.switchView) window.switchView('stats');
                const searchInput = document.getElementById('statsSearchInput');
                if (searchInput) searchInput.value = '#' + tag;
                if (typeof window.syncStatsSearchUI === 'function') window.syncStatsSearchUI(true);
                if (typeof window.renderStatsList === 'function') window.renderStatsList('all', '#' + tag);
            }
        };
        container.appendChild(tagEl);
    });
}

/**
 * Draws the home screen's "Devam Et" / "Yeni Test" pair from whatever the
 * unfinished-test record currently says.
 *
 * Pure read and DOM, which is what lets it be a store consumer. It used to be
 * the tail of main.js's checkActiveTest(), together with the write that
 * promotes a matching preset's saved session - and that write stamps the record
 * with this device's id and the current time. Bound to Slice.ACTIVE_TEST in
 * that shape, a session arriving from another device would have been re-stamped
 * as this one's the moment it landed, which is exactly what pickActiveSession()
 * reads to decide who is sitting in the test.
 *
 * Before this was a consumer, the button only recomputed on navigation. The
 * record has been synced since the active session joined the payload, so the
 * home screen could sit on a stale answer in both directions: no resume button
 * for a test still open on the other device, or - worse - a resume button for
 * one that device had already finished, since finishing leaves a cleared record
 * rather than none.
 */
export function renderResumeButton() {
    const activeData = readJSON('focus_app_active_test', null);
    const resumable = !!(activeData && Array.isArray(activeData.currentTest) && activeData.currentTest.length > 0);

    const resumeBtn = document.getElementById('resumeBtn');
    const startBtn = document.getElementById('startBtn');
    const startBtnContainer = document.getElementById('startBtnContainer');

    if (resumeBtn) {
        resumeBtn.style.display = resumable ? 'block' : 'none';
        resumeBtn.style.flex = resumable ? '1' : '';
    }
    if (startBtn) {
        startBtn.innerText = t(resumable ? 'new_test' : 'start_test');
        startBtn.setAttribute('data-i18n', resumable ? 'new_test' : 'start_test');
        startBtn.style.width = resumable ? 'auto' : '100%';
        startBtn.style.flex = resumable ? '1' : '';
    }
    if (startBtnContainer) {
        startBtnContainer.style.flexDirection = resumable ? 'row' : 'column';
        startBtnContainer.style.gap = resumable ? '0.75rem' : '';
    }
}
