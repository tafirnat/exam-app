
import { AppState } from '../../core/state.js';
import { t } from '../../core/i18n.js';

export function renderStatsList(filter = 'all', searchKeyword = '') {
    AppState.searchKeyword = searchKeyword;
    const list = document.getElementById('statsList');
    if (!list) return;
    list.innerHTML = '';

    if (filter === 'recent' || filter === 'incorrect') {
        renderHistoricalTests(list, filter);
        return;
    }

    // Use the pool of questions from currently active sources
    const activeQuestions = [];
    const activeSources = AppState.sources.filter(s => s.active);
    activeSources.forEach(s => {
        s.questions.forEach(q => {
            activeQuestions.push({ ...q, sourceName: s.name });
        });
    });

    let filteredQuestions = activeQuestions;

    // Apply Tab Filter
    if (filter !== 'all') {
        filteredQuestions = filteredQuestions.filter(q => {
            const s = AppState.stats[q.id] || {};
            if (filter === 'starred') return s.starred;
            if (filter === 'flagged') return s.flagged;
            if (filter === 'noted') return s.note && s.note.trim() !== '';
            return true;
        });
    }

    // Apply Search Filter
    if (searchKeyword.trim() !== '') {
        const kw = searchKeyword.toLowerCase();
        filteredQuestions = filteredQuestions.filter(q => {
            const text = (q.content?.text || q.text || '').toLowerCase();

            // Extract text from options objects
            const optionsArr = q.content?.options || q.options || [];
            const optionsText = optionsArr.map(o => o.text || '').join(' ').toLowerCase();

            // Handle answers (can be string, number, or array)
            const ans = q.content?.answer || q.answer || '';
            const answerText = Array.isArray(ans) ? ans.join(' ').toLowerCase() : String(ans).toLowerCase();

            return text.includes(kw) || optionsText.includes(kw) || answerText.includes(kw);
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
            <div style="flex: 1; min-width: 0;">
                <div class="stats-item-text">${qText}</div>
                ${q.sourceName ? `<div class="stats-item-source">${q.sourceName}</div>` : ''}
            </div>
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
                ${filter === 'recent' ? `
                    <div class="history-test-stats-summary">
                        <div>${t('correct_count')}: <b>${test.correctCount || 0}</b></div>
                        <div>${t('wrong_count')}: <b>${test.wrongCount || 0}</b></div>
                        <div>${t('success_rate')}: <b>${test.successRate || 0}%</b></div>
                        <div>${t('avg_coeff_short')}: <b>${(test.avgCoeff || 1.0).toFixed(1)}</b></div>
                    </div>
                ` : ''}
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
        if (s.active) activeQuestions.push(...(s.questions || []));
    });

    const total = activeQuestions.length;
    const statTotalEl = document.getElementById('statTotal');
    if (statTotalEl) statTotalEl.innerText = total;

    let solved = 0;
    let totalCoeff = 0;
    activeQuestions.forEach(q => {
        if (!q) return;
        const qid = q.id;
        const s = AppState.stats[qid];
        if (s) {
            if (s.correct > 0 || s.wrong > 0) solved++;
            totalCoeff += s.coeff || 1.0;
        } else {
            totalCoeff += 1.0;
        }
    });

    const avgCoeff = total > 0 ? (totalCoeff / total).toFixed(1) : "0.0";
    const updateEl = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
    };
    const updateStyle = (id, prop, val) => {
        const el = document.getElementById(id);
        if (el) el.style[prop] = val;
    };

    const pct = total > 0 ? Math.round((solved / total) * 100) : 0;
    const pctText = `${pct}%`;
    const progressText = t('solved_count', { solved: solved, total: total });

    updateEl('homeStatTotal', total);
    updateEl('homeStatAvg', avgCoeff);

    // Home
    updateEl('homeProgressPercent', pctText);
    updateStyle('homeProgressBarFill', 'width', pctText);
    updateEl('homeProgressDetail', progressText);

    const startPanel = document.getElementById('startPanel');
    const statsCard = document.getElementById('homeStatsCard');
    const statsBtn = document.getElementById('homeStatsBtn');
    const onboarding = document.getElementById('homeOnboardingBar');

    const totalSources = AppState.sources.length;
    // console.log(`[DEBUG] updateHomeStats: total=${total}, totalSources=${totalSources}, hasActive=${hasActiveSource}`); // Original log removed

    if (onboarding) {
        const totalSources = AppState.sources.length;
        const hasActiveSource = AppState.sources.some(s => s.active);

        console.log(`[DEBUG] updateHomeStats: totalQuestions=${total}, totalSources=${totalSources}, hasActive=${hasActiveSource}`);

        if (totalSources === 0) {
            console.log('[DEBUG] No sources, showing guide');
            onboarding.innerText = t('no_sources_msg');
            onboarding.style.display = 'block';
            if (statsCard) statsCard.style.display = 'none';
            if (startPanel) startPanel.style.display = 'none';
        } else if (!hasActiveSource) {
            console.log('[DEBUG] Sources exist but none active, showing selection guide');
            onboarding.innerText = t('select_source_msg');
            onboarding.style.display = 'block';
            if (statsCard) statsCard.style.display = 'none';
            if (startPanel) startPanel.style.display = 'none';
        } else {
            console.log('[DEBUG] Source active, showing panels');
            onboarding.style.display = 'none';
            // Show panels
            if (statsCard) statsCard.style.display = 'block';
            if (startPanel) {
                startPanel.style.display = 'block';
                startPanel.style.opacity = '1';
                startPanel.style.pointerEvents = 'all';
            }
        }
    }

    if (statsBtn) statsBtn.disabled = !hasActiveSource;
}
