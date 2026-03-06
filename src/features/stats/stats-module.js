
import { AppState } from '../../core/state.js';
import { t } from '../../core/i18n.js';

export function renderStatsList(filter = 'all', searchKeyword = '') {
    AppState.searchKeyword = searchKeyword;
    const list = document.getElementById('statsList');
    const sortBar = document.getElementById('statsSortBar');
    if (!list) return;
    list.innerHTML = '';

    if (sortBar) {
        sortBar.style.display = filter === 'all' ? 'flex' : 'none';
    }

    if (filter === 'recent' || filter === 'incorrect') {
        renderHistoricalTests(list, filter);
        return;
    }

    // Use the pool of questions from currently active sources
    const activeQuestions = [];
    const activeSources = AppState.sources.filter(s => s.active);
    activeSources.forEach(s => {
        s.questions.forEach((q, originalIdx) => {
            activeQuestions.push({ ...q, sourceName: s.name, originalIndex: originalIdx + 1 });
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

    // Apply Sorting
    const field = AppState.activeStatsSortField || 'original';
    const dir = AppState.activeStatsSortDir === 'asc' ? 1 : -1;

    filteredQuestions.sort((a, b) => {
        const sa = AppState.stats[a.id] || { correct: 0, wrong: 0, coeff: 1.0 };
        const sb = AppState.stats[b.id] || { correct: 0, wrong: 0, coeff: 1.0 };

        let result = 0;
        if (field === 'original') {
            const idxA = activeQuestions.findIndex(q => q.id === a.id);
            const idxB = activeQuestions.findIndex(q => q.id === b.id);
            result = idxA - idxB;
        } else if (field === 'coeff') {
            result = sa.coeff - sb.coeff;
        } else if (field === 'success') {
            const totalA = sa.correct + sa.wrong;
            const totalB = sb.correct + sb.wrong;
            const pctA = totalA > 0 ? (sa.correct / totalA) : 0;
            const pctB = totalB > 0 ? (sb.correct / totalB) : 0;
            result = pctA - pctB;
        } else if (field === 'wrong') {
            result = sa.wrong - sb.wrong;
        }
        return result * dir;
    });

    updateSortUI();

    if (filteredQuestions.length === 0) {
        list.innerHTML = `<div style="text-align:center; padding: 3rem 1rem; color: var(--text-secondary);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 48px; height: 48px; margin-bottom: 1rem; opacity: 0.5;">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <div>${t('no_questions_available')}</div>
        </div>`;
        return;
    }

    filteredQuestions.forEach((q, i) => {
        const s = AppState.stats[q.id] || { correct: 0, wrong: 0, coeff: 1.0 };
        const total = s.correct + s.wrong;
        const percent = total > 0 ? Math.round((s.correct / total) * 100) : 0;
        const item = document.createElement('div');
        item.className = 'stats-list-item';
        const qText = q.content?.text || q.text || 'Untitled Question';

        item.innerHTML = `
            <div style="flex: 1; min-width: 0;">
                <div class="stats-item-text">${qText}</div>
                <div style="display: flex; align-items: center; gap: 4px;">
                    ${q.sourceName ? `<div class="stats-item-source">${q.sourceName}</div>` : ''}
                    <div class="stats-item-ref">#${q.originalIndex}</div>
                    ${s.starred ? `<span class="stats-indicator starred"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></span>` : ''}
                    ${s.flagged ? `<span class="stats-indicator flagged"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg></span>` : ''}
                    ${(s.note && s.note.trim() !== '') ? `<span class="stats-indicator noted"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></span>` : ''}
                </div>
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

    updateStatsFooter(filter, searchKeyword, filteredQuestions.length);
}

function updateStatsFooter(filter, keyword, count) {
    const footer = document.getElementById('statsFooter');
    if (!footer) return;

    if (keyword && keyword.trim() !== '') {
        footer.innerText = t('stats_count_search', { keyword, count });
    } else if (filter === 'all') {
        footer.innerText = t('stats_count_all', { count });
    } else {
        footer.innerText = t('stats_count_filtered', { count });
    }
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
                        <span>${questionsToShow.length} Questions</span> • 
                        <span>${startTime} - ${endTime}</span>
                    </div>
                </div>
                <div class="history-test-actions">
                    ${filter === 'recent' ? `
                        <button class="history-retake-btn icon-btn" title="${t('retake_all')}" data-retake-mode="all">
                            <div class="retake-pie-icon all">
                                <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="23 4 23 10 17 10"></polyline>
                                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                                </svg>
                            </div>
                        </button>
                    ` : ''}
                    
                    ${filter === 'incorrect' && (test.wrongCount > 0 || test.unansweredCount > 0) ? `
                        <button class="history-retake-btn icon-btn" title="${t('retake_incorrect')}" data-retake-mode="incorrect">
                            <div class="retake-pie-icon focused">
                                <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="23 4 23 10 17 10"></polyline>
                                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                                </svg>
                            </div>
                        </button>
                    ` : ''}
                    
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
                        <div>${t('unanswered_count')}: <b>${test.unansweredCount || 0}</b></div>
                        <div>${t('success_rate')}: <b>${test.successRate || 0}%</b></div>
                    </div>
                ` : ''}
                ${questionsToShow.map((q, idx) => {
            let statusIcon = q.isCorrect ? '✓' : (q.isUnanswered ? '○' : '✗');
            let statusClass = q.isCorrect ? 'correct' : (q.isUnanswered ? 'unanswered' : 'wrong');
            return `
                        <div class="history-question-item ${statusClass}">
                            <div class="history-question-text">${q.content?.text || q.text}</div>
                            <div class="history-question-status">${statusIcon}</div>
                        </div>
                    `;
        }).join('')}
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

        // Add retake handlers
        testEl.querySelectorAll('.history-retake-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const mode = btn.dataset.retakeMode;
                if (window.onRetake) window.onRetake(test, mode === 'incorrect');
            };
        });

        // Add click handlers for questions in history
        testEl.querySelectorAll('.history-question-item').forEach((qDiv, idx) => {
            qDiv.onclick = (e) => {
                e.stopPropagation();
                if (window.onPreviewQuestion) window.onPreviewQuestion(questionsToShow[idx]);
            };
        });

        list.appendChild(testEl);
    });

    // Update footer for historical tests
    const visibleCount = AppState.recentTests.filter(test => {
        if (filter === 'recent' && test.hiddenInRecent) return false;
        if (filter === 'incorrect' && test.hiddenInIncorrect) return false;
        return true;
    }).length;
    updateStatsFooter(filter, '', visibleCount);
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
    const hasActiveSource = AppState.sources.some(s => s.active);

    console.log(`[DEBUG] updateHomeStats: totalQuestions=${total}, totalSources=${totalSources}, hasActive=${hasActiveSource}`);

    // Update onboarding if exists
    if (onboarding) {
        if (totalSources === 0) {
            console.log('[DEBUG] No sources, showing guide');
            onboarding.innerText = t('no_sources_msg');
            onboarding.style.display = 'block';
        } else if (!hasActiveSource) {
            console.log('[DEBUG] Sources exist but none active, showing selection guide');
            onboarding.innerText = t('select_source_msg');
            onboarding.style.display = 'block';
        } else {
            console.log('[DEBUG] Source active, hiding guide');
            onboarding.style.display = 'none';
        }
    }

    // ALWAYS update panel visibility regardless of onboarding element
    if (totalSources === 0 || !hasActiveSource) {
        if (statsCard) statsCard.style.display = 'none';
        if (startPanel) startPanel.style.display = 'none';
    } else {
        if (statsCard) statsCard.style.display = 'block';
        if (startPanel) {
            startPanel.style.display = 'block';
            startPanel.style.opacity = '1';
            startPanel.style.pointerEvents = 'all';
        }
    }

    if (statsBtn) statsBtn.disabled = !hasActiveSource;
}

function updateSortUI() {
    const field = AppState.activeStatsSortField || 'original';
    const dir = AppState.activeStatsSortDir;

    document.querySelectorAll('.sort-btn').forEach(btn => {
        const isMatch = btn.dataset.sort === field;
        btn.classList.toggle('active', isMatch);
        const dirEl = btn.querySelector('.sort-dir');
        if (dirEl) {
            dirEl.innerText = isMatch ? (dir === 'asc' ? ' ↑' : ' ↓') : '';
        }
    });
}

export function setupStatsEventListeners() {
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.onclick = () => {
            const sortField = btn.dataset.sort;
            if (AppState.activeStatsSortField === sortField) {
                // Toggle direction
                AppState.activeStatsSortDir = AppState.activeStatsSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                AppState.activeStatsSortField = sortField;
                AppState.activeStatsSortDir = 'asc';
                // Default to descending for wrong answers and coefficient as it's more useful
                if (sortField === 'wrong' || sortField === 'coeff') {
                    AppState.activeStatsSortDir = 'desc';
                }
            }
            renderStatsList(AppState.activeStatsFilter, AppState.searchKeyword);
        };
    });
}
