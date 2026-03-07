
import { AppState, saveStats } from '../../core/state.js';
import { translateText, showToast, getCorrectAnswers } from '../../core/utils.js';
import { t } from '../../core/i18n.js';
import { evaluateAnswer, updateStats, finishTest } from './test-engine.js';

export function renderQuestion() {
    if (!AppState.currentTest || AppState.currentTest.length === 0) {
        return;
    }
    const qIndex = AppState.currentIndex;
    const q = AppState.rawQuestions[AppState.currentTest[qIndex]];
    const stat = AppState.stats[q.id] || { coeff: 1.0, note: '' };
    const isChecked = AppState.isAnswerChecked[qIndex];

    document.getElementById('progressText').innerText = `${t('question_label')} ${qIndex + 1} / ${AppState.currentTest.length}`;
    document.getElementById('progressText').innerText = `${t('question_label')} ${qIndex + 1} / ${AppState.currentTest.length}`;
    document.getElementById('questionText').innerText = q.content?.text || q.text || '';

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
                <input type="text" id="textAnswerInput" value="${val}" placeholder="Ihre Antwort..." ${isChecked ? 'disabled' : ''}>
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
                card.style.pointerEvents = 'none';
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
            content.innerText = opt.text;

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
    if (isLastQuestion) {
        summaryEl.style.display = 'block';
    } else {
        // Keep current state if it was manually toggled, or hide by default
        if (!summaryEl.dataset.manuallyToggled) {
            summaryEl.style.display = 'none';
        }
    }

    const unansweredIndices = [];
    AppState.currentTest.forEach((qId, idx) => {
        if (!AppState.isAnswerChecked[idx]) {
            unansweredIndices.push(idx);
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

    document.getElementById('finishTestBtn').onclick = () => {
        if (unansweredIndices.length > 0) {
            if (!confirm(t('confirm_finish_test_unanswered'))) {
                return;
            }
        }
        showToast(t('test_completed'));
        finishTest();
    };
}

window.goToQuestion = (idx) => {
    AppState.currentIndex = idx;
    renderQuestion();
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
        const translated = await translateText(srcEl.innerText);
        if (translated) {
            targetEl.innerText = translated;
            targetEl.style.display = 'block';
            btn.classList.add('active');
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
    const s = AppState.stats[qid] || { correct: 0, wrong: 0, coeff: 1.0 };
    const infoEl = document.getElementById('questionStatsInfo');
    if (infoEl) {
        const total = s.correct + s.wrong;
        const percent = total > 0 ? Math.round((s.correct / total) * 100) : 0;
        infoEl.innerHTML = `
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

    // Update stats with feedback
    updateStats(q.id, isCorrect, userAnswer, rating);
    saveStats();

    // Visual feedback: highlight selected button
    const hardBtn = document.getElementById('diffHardBtn');
    const easyBtn = document.getElementById('diffEasyBtn');
    if (hardBtn && easyBtn) {
        hardBtn.classList.toggle('active', rating === 'hard');
        easyBtn.classList.toggle('active', rating === 'easy');
    }

    // Refresh UI to show new coefficient
    const stat = AppState.stats[q.id];
    updateQuestionStatsInfo(q.id);

    showToast(`${t('difficulty_' + rating)} ${t('feedback_received')}.`);
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
            listEl.innerHTML = '<div style="opacity: 0.5; font-size: 0.8rem; text-align: center; width: 100%;">Keine Details verfügbar</div>';
        }
    }

    const dateEl = document.getElementById('resultsDate');
    if (dateEl && latestTest.endTime) {
        try {
            dateEl.textContent = new Date(latestTest.endTime).toLocaleString();
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
        detail: { question: q, stats: AppState.stats[q.id] || { coeff: 1.0, correct: 0, wrong: 0 }, source: 'results' }
    }));
};
