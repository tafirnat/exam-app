
import { AppState, saveStats } from '../../core/state.js';
import { translateText, showToast, showConfirm, getCorrectAnswers, escapeHTML } from '../../core/utils.js';
import { t, targetLanguages } from '../../core/i18n.js';
import { evaluateAnswer, updateStats, updateFlashcardStats, finishTest, calculateRetrievability } from './test-engine.js';
import { resetTimerForNewQuestion, stopTimer } from './timer-module.js';

// --- TTS State Machine ---
// States: 'IDLE' | 'SCHEDULED' | 'PLAYING'
const TTS = {
    state: 'IDLE',
    audio: null,
    timerId: null,
    lastQIndex: -1,

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

    _play(text) {
        if (!text) { this.state = 'IDLE'; return; }
        const lang = AppState.language === 'tr' ? 'tr' : (AppState.language === 'de' ? 'de' : 'en');
        const voicePrefix = lang === 'tr' ? 'tr-TR-Wavenet-' : (lang === 'de' ? 'de-DE-Wavenet-' : 'en-US-Wavenet-');
        const voice = AppState.currentTtsVoice || 'A';
        const speed = AppState.ttsSpeed || 0.5;
        const baseUrl = 'https://www.google.com/speech-api/v1/synthesize';
        const params = new URLSearchParams({ enc: 'mpeg', lang, speed, client: 'lr-language-tts', use_google_only_voices: '1', name: voicePrefix + voice, text });
        const url = `${baseUrl}?${params.toString()}`;

        this.audio = new Audio(url);
        this.state = 'PLAYING';
        renderQuestion(true);

        this.audio.play().catch(err => {
            console.error('TTS Playback failed:', err);
            this.audio = null;
            this.state = 'IDLE';
            renderQuestion(true);
        });

        this.audio.onended = () => {
            this.audio = null;
            this.state = 'IDLE';
            renderQuestion(true);
        };
    },

    toggle(text) {
        if (this.state === 'PLAYING') {
            this.stop(false);
        } else {
            this._cancelSchedule();
            this.state = 'IDLE';
            this._play(text);
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

export function getIsAudioPlaying() {
    return TTS.isPlaying;
}

export function stopAudio(silent = false) {
    TTS.stop(silent);
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

        // Reset countdown timer if applicable
        resetTimerForNewQuestion();

        const summaryEl = document.getElementById('testSummarySection');
        if (summaryEl) {
            summaryEl.dataset.autoShown = 'false';
            summaryEl.dataset.manuallyToggled = 'false';
        }
    }
    const q = AppState.questionMap[AppState.currentTest[qIndex]];
    const statKey = `${q.sourceId}_${q.id}`;
    const stat = AppState.stats[statKey] || { difficulty: 5.0, note: '' };
    const isChecked = AppState.isAnswerChecked[qIndex];

    const rawQText = q.content?.text || q.text || '';
    const isFormattedContent = q.type === 'reading' || q.type === 'topic_review' || q.format === 'html' || /<[a-z][\s\S]*>/i.test(rawQText);
    qTextEl.innerHTML = isFormattedContent ? rawQText : escapeHTML(rawQText);

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
        const playing = TTS.isPlaying;
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
            const isExpHtml = /<[a-z][\s\S]*>/i.test(q.answer.explanation || '');
            noteInputEl.innerHTML = isExpHtml ? q.answer.explanation : escapeHTML(q.answer.explanation);
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
            container.innerHTML = `
                <div class="flashcard-face flashcard-back">
                    <span class="flashcard-label">${t('flashcard_back')}</span>
                    <div class="flashcard-text" id="flashcardBackText">${escapeHTML(q.answer?.back || '')}</div>
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
    } else if (q.type === 'text' || q.type === 'text_input' || q.type === 'open_ended' || q.type === 'fill_in_the_blank') {
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
            content.innerHTML = escapeHTML(opt.text);

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
            const result = AppState.testTracking?.results.find(r => String(r.questionId) === String(q.id));
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
        <button class="btn" id="finishTestBtn" style="width: 100%; background-color: var(--error-color); color: white; display: flex; align-items: center; justify-content: center; gap: 0.5rem; border: none; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2); margin-top: 1rem;">
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
        // Auto-evaluate unchecked but answered questions
        let interactionCount = 0;
        AppState.currentTest.forEach((compositeId, idx) => {
            const userAnswer = AppState.userAnswers[idx];
            const hasAnswer = userAnswer && Array.isArray(userAnswer) && userAnswer.length > 0 && userAnswer.some(v => v !== null && v !== undefined && String(v).trim() !== '');

            if (hasAnswer || AppState.isAnswerChecked[idx]) {
                interactionCount++;
            }

            if (!AppState.isAnswerChecked[idx] && hasAnswer) {
                const q = AppState.questionMap[compositeId];
                const isCorrect = evaluateAnswer(idx, userAnswer);
                AppState.isAnswerChecked[idx] = true;
                updateStats(q.sourceId, q.id, isCorrect, userAnswer);
            }
        });
        if (window.updateHomeStats) window.updateHomeStats();

        // If absolutely nothing was answered, just go home silently
        if (interactionCount === 0) {
            // Custom event or direct call to view switch is tricky without export
            // But we can dispatch a custom 'exit-test' or just trigger home button
            const homeBtn = document.getElementById('resHomeBtn');
            if (homeBtn) homeBtn.click();
            return;
        }

        // Recalculate truly unanswered questions for confirmation
        const trulyUnanswered = [];
        AppState.currentTest.forEach((qId, idx) => {
            if (!AppState.isAnswerChecked[idx]) {
                trulyUnanswered.push(idx);
            }
        });

        if (trulyUnanswered.length > 0) {
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
            <div class="unanswered-item" onclick="window.goToQuestion(${idx})" title="${AppState.questionMap[AppState.currentTest[idx]]?.text?.substring(0, 50)}...">
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
    const q = AppState.questionMap[AppState.currentTest[qIndex]];
    let userAnswer = AppState.userAnswers[qIndex] || [];

    // Flashcard: just reveal the back face, don't evaluate
    if (q.type === 'flashcard') {
        AppState.isAnswerChecked[qIndex] = true;
        renderQuestion();
        return;
    }

    if (q.type === 'text' || q.type === 'text_input' || q.type === 'open_ended' || q.type === 'fill_in_the_blank') {
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

        infoEl.innerHTML = `
            ${rPercent !== null ? `<span class="stats-item-retrievability ${r <= 0.9 ? 'overdue' : ''}" title="Retrievability: ${rPercent}%" style="margin-right: 8px;">🧠 ${rPercent}%</span>` : ''}
            <span>${t('correct')}: <b>${s.correct}</b></span>
            <span>${t('wrong')}: <b>${s.wrong}</b></span>
            <span>${t('success_percent', { percent })}</span>
            <span>${t('difficulty_label')} <b>${(s.difficulty / 2).toFixed(1)}</b></span>
            <span id="scrollSummaryBtn" style="
                display: flex;
                align-items: center;
                justify-content: center;
                width: 28px;
                height: 28px;
                color: #ef4444;
                background: #ef444415;
                border: 1.5px solid #ef444440;
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.2s ease;
            ">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
            </span>
        `;
        infoEl.classList.add('visible');

        const scrollBtn = document.getElementById('scrollSummaryBtn');
        if (scrollBtn) {
            scrollBtn.onclick = () => {
                // Efficiency check: If totally empty, just exit to home
                let hasInteraction = false;
                AppState.currentTest.forEach((_, idx) => {
                    if (AppState.isAnswerChecked[idx]) hasInteraction = true;
                    const ua = AppState.userAnswers[idx];
                    if (ua && ua.length > 0 && ua.some(v => v !== null && v !== undefined && String(v).trim() !== '')) hasInteraction = true;
                });

                if (!hasInteraction) {
                    // Navigate home directly (triggering the finish button logic for consistency)
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
    const existingResult = AppState.testTracking?.results.find(r => String(r.questionId) === String(q.id));
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
export function handleTtsToggle(text, onRefresh = null) {
    if (onRefresh) {
        // Preview context: use a custom refresh callback via a one-shot wrapper
        if (TTS.isPlaying) {
            TTS.stop(true);
            onRefresh();
        } else {
            TTS._play(text);
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
        TTS.toggle(text);
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
            // Store return path
            const currentView = ['home', 'test', 'results', 'statsPreview'].find(v => {
                const el = document.getElementById(v + 'View');
                return el && el.style.display !== 'none';
            }) || 'home';
            
            import('../../core/state.js').then(m => {
                m.AppState.navigationSourceView = currentView;
                if (window.switchView) window.switchView('stats');
                if (window.renderStatsList) window.renderStatsList('tag:' + tag);
            });
        };
        container.appendChild(tagEl);
    });
}
