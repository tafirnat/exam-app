
import { AppState, saveStats } from '../../core/state.js';
import { translateText, showToast, showConfirm, getCorrectAnswers } from '../../core/utils.js';
import { t, targetLanguages } from '../../core/i18n.js';
import { evaluateAnswer, updateStats, finishTest, calculateRetrievability } from './test-engine.js';
import { resetTimerForNewQuestion } from './timer-module.js';

let currentAudio = null;
let isAudioPlaying = false;
let autoplayTimeoutId = null;
let lastTtsStopReason = 'none'; // 'none', 'finished', 'navigation', 'manual'
let lastRenderedIndex = -1;

export function getIsAudioPlaying() {
    return isAudioPlaying;
}

export function stopAudio(silent = false, reason = 'manual') {
    if (currentAudio) {
        currentAudio.onended = null;
        currentAudio.pause();
        currentAudio = null;
    }
    isAudioPlaying = false;
    if (reason !== 'none') lastTtsStopReason = reason;
    if (!silent) renderQuestion();
}

export function renderQuestion(isRefresh = false) {
    if (!AppState.currentTest || AppState.currentTest.length === 0) {
        return;
    }

    const qIndex = AppState.currentIndex;
    const isNewQuestion = qIndex !== lastRenderedIndex;

    // Handle session start or navigation
    if (!isRefresh && isNewQuestion) {
        const wasInBrowsingMode = lastTtsStopReason === 'navigation' || !!autoplayTimeoutId;

        // If navigating while audio is playing, stop it and mark as interrupted
        if (isAudioPlaying) {
            stopAudio(true, 'navigation');
        } else if (wasInBrowsingMode) {
            // If we skip while already waiting (browsing), keep the navigation reason
            // so the 5s delay resets for the new question.
            lastTtsStopReason = 'navigation';
        } else {
            // If starting fresh or from a finished state, reset/keep logic
            if (lastTtsStopReason !== 'finished') {
                lastTtsStopReason = 'none';
            }
        }
        
        lastRenderedIndex = qIndex;

        // Clear any pending autoplay from previous navigation
        if (autoplayTimeoutId) {
            clearTimeout(autoplayTimeoutId);
            autoplayTimeoutId = null;
        }

        // Reset countdown timer if applicable
        resetTimerForNewQuestion();
    }
    const q = AppState.rawQuestions[AppState.currentTest[qIndex]];
    const stat = AppState.stats[q.id] || { coeff: 1.5, note: '' };
    const isChecked = AppState.isAnswerChecked[qIndex];

    document.getElementById('progressText').innerText = `${t('question_label')} ${qIndex + 1} / ${AppState.currentTest.length}`;
    document.getElementById('progressText').innerText = `${t('question_label')} ${qIndex + 1} / ${AppState.currentTest.length}`;
    const qTextEl = document.getElementById('questionText');
    qTextEl.innerHTML = q.content?.text || q.text || '';

    // Handle Media (Images)
    const card = qTextEl.closest('.question-card');
    // Remove existing media
    card.querySelectorAll('.question-media').forEach(m => m.remove());

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
        
        const tBtn = document.createElement('button');
        tBtn.className = 'tts-btn';
        if (isAudioPlaying) tBtn.classList.add('playing');
        tBtn.innerHTML = isAudioPlaying ? 
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>' : 
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
        
        tBtn.onclick = () => handleTtsToggle(q.content?.text || q.text || '');

        card.appendChild(tBtn);

        // Autoplay Logic - Only trigger on new navigation, never on UI refresh
        if (!isRefresh && isNewQuestion && AppState.ttsAutoplay && !isAudioPlaying) {
            // User browsing delay: If we interrupted a previous playback, wait 5s
            // Normal flow: wait 1s (1000ms)
            const delay = lastTtsStopReason === 'navigation' ? 5000 : 1000;

            autoplayTimeoutId = setTimeout(() => {
                autoplayTimeoutId = null;
                if (AppState.ttsAutoplay && !isAudioPlaying) {
                    handleTtsToggle(q.content?.text || q.text || '');
                }
            }, delay);
        }
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

    document.getElementById('noteInput').value = stat.note || '';
    document.getElementById('noteArea').classList.remove('visible');
    updateIndicators();
    updateQuestionStatsInfo(q.id);

    if (q.type === 'text' || q.type === 'text_input' || q.type === 'open_ended' || q.type === 'fill_in_the_blank') {
        const val = AppState.userAnswers[qIndex]?.[0] || '';
        const isCorrect = isChecked ? evaluateAnswer(qIndex, [val]) : false;

        container.innerHTML = `
            <div class="text-input-wrapper">
                <input type="text" id="textAnswerInput" value="${val}" placeholder="${t('answer_placeholder')}" ${isChecked ? 'disabled' : ''} oninput="window.syncTextInput(this.value)">
                ${isChecked && !isCorrect ? `
                    <div class="feedback-container" style="margin-top: 0.75rem; display: flex; align-items: start; gap: 0.5rem;">
                        <div style="flex: 1;">
                            <div id="correctAnswerText" class="correct-answer-feedback" style="color: var(--success-color); font-weight: 600; font-size: 0.9rem;">
                                ${t('correct_answer_was')} ${getCorrectAnswers(q)[0] || ''}
                            </div>
                            <div id="trans_correctAnswerText" class="translation-text" style="display: none; margin-top: 0.25rem; font-size: 0.85rem; color: var(--text-secondary);"></div>
                        </div>
                        <button id="feedbackTranslateBtn" class="corner-translate-btn" style="padding: 2px;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width: 14px; height: 14px;"><path d="M5 8l6 6"></path><path d="M4 14l6-6 2-3"></path><path d="M2 5h12"></path><path d="M7 2h1"></path><path d="M22 22l-5-10-5 10"></path><path d="M14 18h6"></path></svg>
                        </button>
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
                if (e.key === 'Enter') handleCheckAnswer();
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
            content.innerHTML = opt.text;

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

    if (checkBtn && difficultyPill) {
        if (isChecked) {
            checkBtn.style.display = 'none';
            difficultyPill.style.display = 'flex';

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
            if (checkText) checkText.innerText = t('check');
            if (checkIcon) checkIcon.style.display = 'none';
            checkBtn.disabled = false;
            checkBtn.style.opacity = '1';

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

    // Default visibility: hidden on non-last questions
    const isLastQuestion = AppState.currentIndex === AppState.currentTest.length - 1;
    let isVisible = isLastQuestion;
    if (!isLastQuestion) {
        // Keep current state if it was manually toggled, or hide by default
        if (summaryEl.dataset.manuallyToggled === 'true') {
            isVisible = summaryEl.style.display !== 'none';
        }
    }
    summaryEl.style.display = isVisible ? 'block' : 'none';

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
                    ${unansweredIndices.map(idx => `
                            <div class="unanswered-item" onclick="window.goToQuestion(${idx})" title="${AppState.rawQuestions[AppState.currentTest[idx]].text?.substring(0, 50)}...">
                                <span class="unanswered-item-num">#${idx + 1}</span>
                            </div>
                        `).join('')}
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
        AppState.currentTest.forEach((qId, idx) => {
            const userAnswer = AppState.userAnswers[idx];
            const hasAnswer = userAnswer && Array.isArray(userAnswer) && userAnswer.length > 0 && userAnswer.some(v => v !== null && v !== undefined && String(v).trim() !== '');

            if (hasAnswer || AppState.isAnswerChecked[idx]) {
                interactionCount++;
            }

            if (!AppState.isAnswerChecked[idx] && hasAnswer) {
                const q = AppState.rawQuestions[qId];
                const isCorrect = evaluateAnswer(idx, userAnswer);
                AppState.isAnswerChecked[idx] = true;
                updateStats(q.id, isCorrect, userAnswer);
            }
        });
        saveStats();

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
        finishTest();
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
            <div class="unanswered-item" onclick="window.goToQuestion(${idx})" title="${AppState.rawQuestions[AppState.currentTest[idx]].text?.substring(0, 50)}...">
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
    renderQuestion();
}

export function handleCheckAnswer() {
    const qIndex = AppState.currentIndex;
    const q = AppState.rawQuestions[AppState.currentTest[qIndex]];
    let userAnswer = AppState.userAnswers[qIndex] || [];

    if (q.type === 'text' || q.type === 'text_input' || q.type === 'open_ended' || q.type === 'fill_in_the_blank') {
        const input = document.getElementById('textAnswerInput');
        const val = input.value.trim();
        if (!val) return;
        userAnswer = [val];
        AppState.userAnswers[qIndex] = userAnswer;
    } else {
        if (!userAnswer.length) return;
    }

    const isCorrect = evaluateAnswer(qIndex, userAnswer);
    AppState.isAnswerChecked[qIndex] = true;
    updateStats(q.id, isCorrect, userAnswer);
    saveStats();
    renderQuestion();
}

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
    const q = AppState.rawQuestions[AppState.currentTest[qIndex]];
    const s = AppState.stats[q.id] || {};
    document.getElementById('indStar').classList.toggle('active-star', !!s.starred);
    document.getElementById('indFlag').classList.toggle('active-flag', !!s.flagged);
    document.getElementById('indNote').classList.toggle('active-note', !!(s.note && s.note.trim() !== ''));
}

export function updateQuestionStatsInfo(qid) {
    const s = AppState.stats[qid] || { correct: 0, wrong: 0, coeff: 1.5, stability: 0, lastReview: null };
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
            <span>${t('coeff_label')} <b>${s.coeff.toFixed(1)}</b></span>
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
    const qId = AppState.currentTest[qIndex];
    const q = AppState.rawQuestions[qId];
    const userAnswer = AppState.userAnswers[qIndex];
    const isCorrect = evaluateAnswer(qIndex, userAnswer);
    const existingResult = AppState.testTracking?.results.find(r => String(r.questionId) === String(q.id));

    let targetRating = rating;
    let isTogglingOff = false;

    if (existingResult && existingResult.feedback === rating) {
        targetRating = null; // Toggle off
        isTogglingOff = true;
    } else if (existingResult && existingResult.feedback === 'hard' && rating === 'easy') {
        // Special requirement: Switching from Hard to Easy stars the question
        if (!AppState.stats[q.id]) AppState.stats[q.id] = { coeff: 1.5, correct: 0, wrong: 0 };
        AppState.stats[q.id].starred = true;
        updateIndicators();
    }

    // Update stats with feedback
    updateStats(q.id, isCorrect, userAnswer, targetRating);
    saveStats();

    // Visual feedback: highlight selected button
    const hardBtn = document.getElementById('diffHardBtn');
    const easyBtn = document.getElementById('diffEasyBtn');
    if (hardBtn && easyBtn) {
        hardBtn.classList.toggle('active', targetRating === 'hard');
        easyBtn.classList.toggle('active', targetRating === 'easy');
    }

    // Refresh UI to show new coefficient
    updateQuestionStatsInfo(q.id);

    if (isTogglingOff) {
        showToast(t('feedback_removed'));
    } else {
        showToast(`${t('difficulty_' + rating)} ${t('feedback_received')}.`);
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
    const rate = latestTest.successRate ?? 0;

    document.getElementById('resCorrectCount').textContent = correct;
    document.getElementById('resWrongCount').textContent = wrong;
    document.getElementById('resUnansweredCount').textContent = unanswered;
    document.getElementById('resSuccessRate').textContent = `${rate}%`;

    const gauge = document.querySelector('.success-rate-gauge');
    if (gauge) {
        gauge.style.background = `conic-gradient(var(--primary-color) ${rate * 3.6}deg, var(--border-color) 0deg)`;
    }

    // Question List
    const listEl = document.getElementById('resQuestionList');
    if (listEl) {
        listEl.innerHTML = '';
        if (latestTest.questions && Array.isArray(latestTest.questions) && latestTest.questions.length > 0) {
            latestTest.questions.forEach((q, idx) => {
                if (!q) return;
                const item = document.createElement('div');
                item.className = 'result-item';
                if (q.isCorrect) item.classList.add('correct');
                else if (q.isUnanswered) item.classList.add('unanswered');
                else item.classList.add('wrong');

                item.innerHTML = `#${idx + 1}`;
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
            dateEl.textContent = new Date(latestTest.endTime).toLocaleString(AppState.language);
        } catch (e) {
            dateEl.textContent = '';
        }
    }
}

window.showQuestionResult = (testId, questionId) => {
    const test = AppState.recentTests.find(t => t.id === testId);
    if (!test) return;
    const q = test.questions.find(item => String(item.id) === String(questionId));
    if (!q) return;

    // Use stats preview logic from main.js (needs to be available)
    window.dispatchEvent(new CustomEvent('show-stats-preview', {
        detail: { question: q, stats: AppState.stats[q.id] || { coeff: 1.5, correct: 0, wrong: 0 }, source: 'results' }
    }));
};

export function handleTtsToggle(text, onRefresh = null) {
    const refresh = onRefresh || (() => renderQuestion(true));

    if (isAudioPlaying && currentAudio) {
        stopAudio(onRefresh !== null, 'manual');
        return;
    }

    if (!text) return;

    // Reset stop reason when starting manually or via autoplay
    lastTtsStopReason = 'none';

    const lang = AppState.language === 'tr' ? 'tr' : (AppState.language === 'de' ? 'de' : 'en');
    const voicePrefix = lang === 'tr' ? 'tr-TR-Wavenet-' : (lang === 'de' ? 'de-DE-Wavenet-' : 'en-US-Wavenet-');
    const voice = AppState.currentTtsVoice || "A";
    const speed = AppState.ttsSpeed || 0.5;

    const baseUrl = "https://www.google.com/speech-api/v1/synthesize";
    const params = new URLSearchParams({
        enc: 'mpeg',
        lang: lang,
        speed: speed,
        client: 'lr-language-tts',
        use_google_only_voices: '1',
        name: voicePrefix + voice,
        text: text
    });

    const url = `${baseUrl}?${params.toString()}`;

    currentAudio = new Audio(url);
    isAudioPlaying = true;
    refresh();

    if (currentAudio) {
        currentAudio.play().catch(err => {
            console.error("TTS Playback failed:", err);
            isAudioPlaying = false;
            refresh();
        });

        currentAudio.onended = () => {
            isAudioPlaying = false;
            currentAudio = null;
            lastTtsStopReason = 'finished';
            refresh();
        };
    }
}
