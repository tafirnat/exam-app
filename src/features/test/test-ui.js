
import { AppState, saveStats } from '../../core/state.js';
import { translateText, showToast } from '../../core/utils.js';
import { t } from '../../core/i18n.js';
import { evaluateAnswer, updateStats } from './test-engine.js';

export function renderQuestion() {
    if (!AppState.currentTest || AppState.currentTest.length === 0) {
        return;
    }
    const qIndex = AppState.currentIndex;
    const q = AppState.rawQuestions[AppState.currentTest[qIndex]];
    const stat = AppState.stats[q.id] || { coeff: 1.0, note: '' };
    const isChecked = AppState.isAnswerChecked[qIndex];

    document.getElementById('progressText').innerText = `${t('question_label')} ${qIndex + 1} / ${AppState.currentTest.length}`;
    document.getElementById('coeffBadge').innerText = `${t('coeff_label')} ${stat.coeff.toFixed(1)}`;
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
                                ${t('correct_answer_was')} ${(q.correctOptionIds || q.answer?.accepted_texts)?.[0] || ''}
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
                const isOptionCorrect = q.correctOptionIds.map(String).includes(String(opt.id));
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
    const checkBtn = document.getElementById('checkBtn');
    const checkText = document.getElementById('checkBtnText');
    const checkIcon = document.getElementById('checkIcon');

    if (checkText) checkText.innerText = isChecked ? t('checked') : t('check');
    if (checkIcon) checkIcon.style.display = isChecked ? 'inline' : 'none';

    checkBtn.disabled = isChecked;
    checkBtn.style.opacity = isChecked ? '0.5' : '1';
}

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
    const total = s.correct + s.wrong;
    const infoEl = document.getElementById('questionStatsInfo');
    if (infoEl) {
        const total = s.correct + s.wrong;
        const percent = total > 0 ? Math.round((s.correct / total) * 100) : 0;
        infoEl.innerHTML = `
            <span>${t('correct')}: <b>${s.correct}</b></span>
            <span>${t('wrong')}: <b>${s.wrong}</b></span>
            <span>${t('success_percent', { percent })}</span>
            <span>${t('coeff_label')} <b>${s.coeff.toFixed(1)}</b></span>
        `;
        infoEl.classList.add('visible');
    }
}
