
import { AppState } from '../../core/state.js';
import { t } from '../../core/i18n.js';

export function renderStatsList(filter = 'all') {
    const list = document.getElementById('statsList');
    if (!list) return;
    list.innerHTML = '';

    if (filter === 'recent' || filter === 'incorrect') {
        renderHistoricalTests(list, filter);
        return;
    }

    // Use the pool of questions from currently active sources
    const activeQuestions = [];
    AppState.sources.forEach(s => {
        if (s.active) activeQuestions.push(...s.questions);
    });

    let filteredQuestions = activeQuestions;
    if (filter !== 'all') {
        filteredQuestions = activeQuestions.filter(q => {
            const s = AppState.stats[q.id] || {};
            if (filter === 'starred') return s.starred;
            if (filter === 'flagged') return s.flagged;
            if (filter === 'noted') return s.note && s.note.trim() !== '';
            return true;
        });
    }

    filteredQuestions.forEach((q, i) => {
        const s = AppState.stats[q.id] || { correct: 0, wrong: 0, coeff: 1.0 };
        const total = s.correct + s.wrong;
        const percent = total > 0 ? Math.round((s.correct / total) * 100) : 0;
        const item = document.createElement('div');
        item.className = 'stats-list-item';
        const qText = q.content?.text || q.text || 'Untitled Question';
        item.innerHTML = `
            <div class="stats-item-num">#${i + 1}</div>
            <div class="stats-item-text">${qText}</div>
            <div class="stats-item-meta">
                <span>✓${s.correct} ✗${s.wrong} (${percent}%)</span>
                <span>${t('coeff_label')} ${s.coeff.toFixed(1)}</span>
            </div>
        `;
        item.onclick = () => {
            if (window.onPreviewQuestion) window.onPreviewQuestion(q);
        };
        list.appendChild(item);
    });
}

function renderHistoricalTests(list, filter) {
    if (!AppState.recentTests || AppState.recentTests.length === 0) {
        list.innerHTML = `<div style="text-align:center; padding: 2rem; color: var(--text-secondary);">${t('no_recent_tests')}</div>`;
        return;
    }

    AppState.recentTests.forEach((test, testIdx) => {
        if (!test || !Array.isArray(test.questions)) return;

        // Independent deletion check
        if (filter === 'recent' && test.hiddenInRecent) return;
        if (filter === 'incorrect' && test.hiddenInIncorrect) return;

        const questionsToShow = filter === 'incorrect'
            ? test.questions.filter(q => !q.isCorrect)
            : test.questions;

        if (questionsToShow.length === 0) return;

        const sourceNames = test.sourceNames || [test.sourceTitle || "Mixed Sources"];
        const isMixed = sourceNames.length > 1;
        const fullTitle = isMixed ? `Mix Test: ${sourceNames.join(', ')}` : sourceNames[0];

        const testEl = document.createElement('div');
        testEl.className = 'history-test-item';

        const startTime = new Date(test.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const endTime = new Date(test.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        testEl.innerHTML = `
            <div class="history-test-header">
                <div class="history-test-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
                <div class="history-test-info">
                    <div class="history-test-title">${fullTitle}</div>
                    <div class="history-test-meta">
                        <span>${test.questionCount} Questions</span> • 
                        <span>${startTime} - ${endTime}</span>
                    </div>
                </div>
                <div class="history-test-actions">
                    <button class="history-delete-btn icon-btn" title="Delete from this list" style="color: var(--error-color);">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </div>
            <div class="history-test-details" style="display: none;">
                ${questionsToShow.map((q, idx) => `
                    <div class="history-question-item ${q.isCorrect ? 'correct' : 'wrong'}">
                        <div class="history-question-text">#${idx + 1} ${q.content?.text || q.text}</div>
                        <div class="history-question-status">${q.isCorrect ? '✓' : '✗'}</div>
                    </div>
                `).join('')}
            </div>
        `;

        const header = testEl.querySelector('.history-test-header');
        const details = testEl.querySelector('.history-test-details');
        const deleteBtn = testEl.querySelector('.history-delete-btn');

        header.onclick = () => {
            const isVisible = details.style.display !== 'none';
            details.style.display = isVisible ? 'none' : 'block';
            testEl.classList.toggle('expanded', !isVisible);
        };

        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm(t('confirm_delete_history'))) {
                if (filter === 'recent') test.hiddenInRecent = true;
                if (filter === 'incorrect') test.hiddenInIncorrect = true;

                import('../../core/state.js').then(m => m.saveRecentTests());
                renderStatsList(filter); // Refresh
            }
        };

        // Add click handlers for questions in history
        testEl.querySelectorAll('.history-question-item').forEach((qDiv, idx) => {
            qDiv.onclick = (e) => {
                e.stopPropagation();
                if (window.onPreviewQuestion) window.onPreviewQuestion(questionsToShow[idx]);
            };
        });

        list.appendChild(testEl);
    });
}

export function updateHomeStats() {
    const activeQuestions = [];
    AppState.sources.forEach(s => {
        if (s.active) activeQuestions.push(...s.questions);
    });

    const total = activeQuestions.length;
    const statTotalEl = document.getElementById('statTotal');
    if (statTotalEl) statTotalEl.innerText = total;

    let solved = 0;
    let totalCoeff = 0;
    activeQuestions.forEach(q => {
        if (!q) return;
        const s = AppState.stats[q.id];
        if (s) {
            if (s.correct > 0 || s.wrong > 0) solved++;
            totalCoeff += s.coeff || 1.0;
        } else {
            totalCoeff += 1.0;
        }
    });

    const avgCoeff = total > 0 ? (totalCoeff / total).toFixed(1) : "0.0";
    const statAvgEl = document.getElementById('statAvg');
    if (statAvgEl) statAvgEl.innerText = avgCoeff;

    const pct = total > 0 ? Math.round((solved / total) * 100) : 0;
    const homePctEl = document.getElementById('homeProgressPercent');
    if (homePctEl) homePctEl.innerText = `${pct}%`;
    const homeBarEl = document.getElementById('homeProgressBarFill');
    if (homeBarEl) homeBarEl.style.width = `${pct}%`;
    const homeDetailEl = document.getElementById('homeProgressDetail');
    if (homeDetailEl) homeDetailEl.innerText = t('solved_count', { solved: solved, total: total });

    const startPanel = document.getElementById('startPanel');
    const statsBtn = document.getElementById('homeStatsBtn');

    if (total > 0) {
        if (startPanel) {
            startPanel.style.opacity = '1';
            startPanel.style.pointerEvents = 'all';
        }
        if (statsBtn) statsBtn.disabled = false;
    } else {
        if (startPanel) {
            startPanel.style.opacity = '0.5';
            startPanel.style.pointerEvents = 'none';
        }
        if (statsBtn) statsBtn.disabled = true;
    }
}
