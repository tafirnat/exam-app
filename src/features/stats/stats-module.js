import { AppState } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import { showConfirm } from '../../core/utils.js';
import { calculateRetrievability } from '../test/test-engine.js';

export function renderStatsList(filter = 'all', searchKeyword = '') {
    AppState.searchKeyword = searchKeyword;
    const list = document.getElementById('statsList');
    const sortBar = document.getElementById('statsSortBar');
    if (!list) return;
    list.innerHTML = '';

    if (sortBar) {
        sortBar.style.display = filter === 'all' ? 'flex' : 'none';
    }

    const filterBar = document.getElementById('statsFilterBar');
    if (filterBar) {
        filterBar.classList.toggle('has-border', filter === 'all');
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
        const sa = AppState.stats[a.id] || { correct: 0, wrong: 0, coeff: 1.5 };
        const sb = AppState.stats[b.id] || { correct: 0, wrong: 0, coeff: 1.5 };

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

    updateStatsFooter(filter, searchKeyword, filteredQuestions.length);
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
        const s = AppState.stats[q.id] || { correct: 0, wrong: 0, coeff: 1.5 };
        const total = s.correct + s.wrong;
        const percent = total > 0 ? Math.round((s.correct / total) * 100) : 0;
        const item = document.createElement('div');
        item.className = 'stats-list-item';
        const qText = q.content?.text || q.text || 'Untitled Question';

        const isLearned = !!s.learned;
        const streak = s.streak || 0;
        const streakIcon = streak > 0 ? '🔥' : (streak < 0 ? '❄️' : '');
        const streakAbs = Math.abs(streak);
        const r = calculateRetrievability(s.stability, s.lastReview);
        const rPercent = r > 0 ? Math.round(r * 100) : null;

        item.innerHTML = `
            <div style="flex: 1; min-width: 0;">
                <div class="stats-item-text">${isLearned ? `<span class="learned-badge" title="${t('learned_msg') || 'Gelernt'}">🎓</span> ` : ''}${qText}</div>
                <div style="display: flex; align-items: center; gap: 4px;">
                    ${q.sourceName ? `<div class="stats-item-source">${q.sourceName}</div>` : ''}
                    <div class="stats-item-ref">#${q.originalIndex}</div>
                    ${streakAbs > 1 ? `<span class="stats-item-streak" title="Streak: ${streak}" style="font-size: 0.72rem; line-height: 1;">${streakIcon}${streakAbs}</span>` : ''}
                    ${rPercent !== null ? `<span class="stats-item-retrievability ${r <= 0.9 ? 'overdue' : ''}" title="Retrievability: ${rPercent}%" style="font-size: 0.72rem; line-height: 1;">🧠 ${rPercent}%</span>` : ''}
                    ${s.starred ? `<span class="stats-indicator starred"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></span>` : ''}
                    ${s.flagged ? `<span class="stats-indicator flagged"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg></span>` : ''}
                    ${(s.note && s.note.trim() !== '') ? `<span class="stats-indicator noted"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></span>` : ''}
                </div>
            </div>
            <div class="stats-item-meta">
                <span>✓${s.correct} ✗${s.wrong} (${percent}%)</span>
                <span class="${isLearned ? 'learned-coeff' : ''}">${t('coeff_label')} ${s.coeff.toFixed(1)}</span>
            </div>
        `;
        item.onclick = () => {
            if (window.onPreviewQuestion) window.onPreviewQuestion(q, null, 'stats');
        };
        list.appendChild(item);
    });
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
            ? test.questions.filter(q => !q.isCorrect && !q.isUnanswered)
            : test.questions;

        if (questionsToShow.length === 0 && filter === 'incorrect') return;
        if (test.questions.length === 0) return;

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
                        <button class="history-retake-btn icon-btn icon-only" title="${t('retake_all')}" data-retake-mode="all">
                            <svg viewBox="0 0 284 248" fill="currentColor">
                                <g transform="translate(0.000000,248.000000) scale(0.100000,-0.100000)" stroke="none">
                                    <path d="M1228 2280 c-237 -50 -416 -144 -592 -310 -197 -187 -309 -394 -357 -659 -44 -243 -5 -494 113 -724 59 -114 131 -217 153 -217 32 0 25 32 -25 119 -109 189 -144 315 -143 526 0 252 57 427 200 620 178 240 424 380 729 416 232 27 492 -51 696 -209 l56 -44 54 44 c30 24 80 61 111 83 31 22 57 45 57 50 0 6 -26 31 -58 56 -164 132 -351 217 -559 254 -121 21 -324 19 -435 -5z"/>
                                    <path d="M2359 1917 c-19 -13 -133 -95 -254 -184 -121 -88 -350 -255 -510 -372 -159 -116 -307 -225 -327 -241 -108 -88 -45 -261 94 -260 59 1 22 -32 661 594 354 347 417 413 417 437 0 18 -7 32 -19 39 -25 13 -23 14 -62 -13z"/>
                                    <path d="M2361 1668 c-54 -51 -99 -99 -100 -106 -1 -7 8 -30 18 -51 51 -98 91 -275 91 -396 0 -103 -43 -318 -69 -347 -3 -4 -47 27 -96 68 -49 42 -91 72 -93 66 -2 -8 7 -81 54 -427 8 -60 19 -141 24 -178 4 -38 10 -70 12 -72 4 -4 556 320 571 334 4 4 -40 22 -99 39 -59 17 -109 33 -111 35 -2 2 8 34 22 72 55 146 69 227 69 410 0 187 -15 270 -74 423 -32 83 -95 208 -110 217 -5 3 -54 -36 -109 -87z"/>
                                </g>
                            </svg>
                        </button>
                    ` : ''}
                    
                    ${filter === 'incorrect' && (test.wrongCount > 0 || test.unansweredCount > 0) ? `
                        <button class="history-retake-btn icon-btn" title="${t('retake_incorrect')}" data-retake-mode="incorrect">
                            <svg viewBox="0 0 279 247" fill="currentColor">
                                <g transform="translate(0.000000,247.000000) scale(0.100000,-0.100000)" stroke="none">
                                    <path d="M1153 2249 c-333 -70 -619 -270 -797 -559 -25 -41 -46 -79 -46 -85 0 -8 37 -25 131 -60 10 -4 26 11 52 48 48 70 185 202 266 257 83 56 205 111 311 141 75 21 105 24 255 23 156 0 177 -2 260 -28 96 -29 217 -86 287 -134 68 -47 228 -219 289 -312 63 -95 90 -160 113 -273 18 -87 21 -277 6 -358 -15 -79 -51 -190 -59 -184 -5 2 -48 38 -97 79 -48 41 -89 74 -90 73 -1 -1 8 -67 18 -147 11 -80 32 -234 46 -343 15 -109 32 -198 37 -198 6 0 137 76 293 168 l283 168 -108 34 c-59 18 -110 35 -111 36 -2 2 10 43 26 92 51 150 65 234 65 393 0 382 -168 719 -473 949 -265 200 -642 286 -957 220z"/>
                                    <path d="M120 1530 c-19 -36 -2 -57 93 -111 51 -29 160 -92 242 -139 83 -48 258 -149 390 -225 132 -76 272 -157 312 -181 94 -56 129 -62 187 -34 59 28 91 89 81 152 -14 81 -38 94 -465 258 -212 81 -474 182 -582 224 -108 42 -208 76 -222 76 -15 0 -30 -8 -36 -20z"/>
                                    <path d="M205 1301 c-3 -9 -9 -62 -14 -117 -25 -264 47 -538 206 -777 50 -75 67 -87 90 -64 13 13 11 21 -21 71 -91 142 -140 278 -163 449 -16 123 -16 110 19 371 2 14 -12 28 -54 52 -51 29 -58 30 -63 15z"/>
                                </g>
                            </svg>
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

        deleteBtn.onclick = async (e) => {
            e.stopPropagation();
            if (await showConfirm(t('confirm_delete_history'))) {
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
                if (window.onPreviewQuestion) window.onPreviewQuestion(questionsToShow[idx], null, 'stats');
            };
        });

        list.appendChild(testEl);
    });

    // Update footer for historical tests
    const visibleCount = AppState.recentTests.filter(test => {
        if (!test || !Array.isArray(test.questions) || test.questions.length === 0) return false;
        if (filter === 'recent' && test.hiddenInRecent) return false;
        if (filter === 'incorrect') {
            if (test.hiddenInIncorrect) return false;
            const hasIncorrect = test.questions.some(q => !q.isCorrect && !q.isUnanswered);
            if (!hasIncorrect) return false;
        }
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

    let solved = 0;      // en az bir kez cevaplanmis (doğru veya yanlış)
    let learnedCount = 0;
    let totalCoeff = 0;
    activeQuestions.forEach(q => {
        if (!q) return;
        const qid = q.id;
        const s = AppState.stats[qid];
        if (s) {
            if ((s.correct || 0) + (s.wrong || 0) > 0) solved++;
            if (s.learned) learnedCount++;
            totalCoeff += s.coeff || 1.5;
        } else {
            totalCoeff += 1.5;
        }
    });

    // Segment calculations — learnedCount is a subset of solved
    const solvedOnlyCount = solved - learnedCount; // cevaplanmış ama öğrenilmemiş
    const notSolvedCount  = total - solved;

    const learnedPct    = total > 0 ? (learnedCount    / total * 100).toFixed(1) : 0;
    const solvedOnlyPct = total > 0 ? (solvedOnlyCount / total * 100).toFixed(1) : 0;
    const notSolvedPct  = total > 0 ? Math.max(0, 100 - parseFloat(learnedPct) - parseFloat(solvedOnlyPct)).toFixed(1) : 100;

    const avgCoeff = total > 0 ? (totalCoeff / total).toFixed(1) : "0.0";
    const updateEl = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
    };
    const updateStyle = (id, prop, val) => {
        const el = document.getElementById(id);
        if (el) el.style[prop] = val;
    };

    // Percentage text next to label shows solved% (solved = cevaplanmış)
    const pct = total > 0 ? Math.round((solved / total) * 100) : 0;
    const pctText = `${pct}%`;
    const progressText = t('solved_count', { solved: solved, total: total });
    const learnedLabelText = learnedCount > 0 ? ` • ${learnedCount} ${t('learned_label') || 'Öğrenildi'}` : '';

    updateEl('homeStatTotal', total);
    updateEl('homeStatAvg', avgCoeff);
    updateEl('homeProgressPercent', pctText);

    // Update 3 segments
    updateStyle('pbSegLearned',  'width', learnedPct + '%');
    updateStyle('pbSegSolved',   'width', solvedOnlyPct + '%');
    updateStyle('pbSegNotSolved','width', notSolvedPct + '%');

    // Update legend counts
    updateEl('legendLearnedCount',   learnedCount > 0    ? `(${learnedCount})`    : '');
    updateEl('legendSolvedCount',    solvedOnlyCount > 0 ? `(${solvedOnlyCount})` : '');
    updateEl('legendNotSolvedCount', notSolvedCount > 0  ? `(${notSolvedCount})`  : '');

    updateEl('homeProgressDetail', progressText + learnedLabelText);

    const startPanel = document.getElementById('startPanel');
    const statsCard = document.getElementById('homeStatsCard');
    const statsBtn = document.getElementById('homeStatsBtn');
    const onboarding = document.getElementById('homeOnboardingBar');

    const totalSources = AppState.sources.length;
    const hasActiveSource = AppState.sources.some(s => s.active);

    console.log(`[DEBUG] updateHomeStats: totalQuestions=${total}, totalSources=${totalSources}, hasActive=${hasActiveSource}`);

    if (onboarding) {
        if (totalSources === 0) {
            onboarding.innerText = t('no_sources_msg');
            onboarding.style.display = 'block';
        } else if (!hasActiveSource) {
            onboarding.innerText = t('select_source_msg');
            onboarding.style.display = 'block';
        } else {
            onboarding.style.display = 'none';
        }
    }

    const homeView = document.getElementById('homeView');
    if (totalSources === 0 || !hasActiveSource) {
        if (statsCard) statsCard.style.display = 'none';
        if (startPanel) startPanel.style.display = 'none';
        if (homeView) homeView.classList.add('empty-state');
    } else {
        if (statsCard) statsCard.style.display = 'block';
        if (startPanel) {
            startPanel.style.display = 'block';
            startPanel.style.opacity = '1';
            startPanel.style.pointerEvents = 'all';
        }
        if (homeView) homeView.classList.remove('empty-state');
    }

    if (statsBtn) statsBtn.disabled = !hasActiveSource;

    // Bind chart overlay once
    _bindChartOverlay();
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

/**
 * Calculates a premium HSL color based on question coefficient.
 * 5.0 (Very Hard) -> Red (0)
 * 1.0 (Neutral)   -> Green (120)
 * 0.1 (Minimum)   -> Blue/Cyan (210)
 */
function getCoeffColor(coeff) {
    let hue;
    if (coeff >= 1.5) {
        const ratio = Math.min(1, (coeff - 1.5) / 1.5);
        hue = 120 - (ratio * 120);
    } else {
        const ratio = Math.min(1, (1.5 - coeff) / 1.4);
        hue = 120 + (ratio * 90);
    }
    const saturation = 70 + (coeff >= 1.0 ? (coeff - 1.0) * 5 : 0);
    const lightness = 50;
    return `linear-gradient(90deg, hsl(${hue}, ${saturation}%, ${lightness}%), hsl(${hue}, ${saturation + 10}%, ${lightness - 10}%))`;
}

// --------------------------------------------------------------------------
// Chart Overlay
// --------------------------------------------------------------------------
let _chartOverlayBound = false;

function _bindChartOverlay() {
    if (_chartOverlayBound) return;
    _chartOverlayBound = true;

    const section = document.getElementById('homeProgressSection');
    const overlay = document.getElementById('progressChartOverlay');
    const closeBtn = document.getElementById('closeChartBtn');

    if (!section || !overlay) return;

    section.addEventListener('click', () => {
        overlay.style.display = 'flex';
        requestAnimationFrame(() => showProgressCharts());
    });

    closeBtn?.addEventListener('click', () => {
        overlay.style.display = 'none';
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.style.display = 'none';
    });
}

/**
 * Renders three Canvas charts inside the progress chart overlay.
 */
export function showProgressCharts() {
    const activeQuestions = [];
    AppState.sources.forEach(s => {
        if (s.active) activeQuestions.push(...(s.questions || []));
    });
    const total = activeQuestions.length;
    if (total === 0) return;

    // Compute segments
    let learnedCount = 0, solvedCount = 0;
    const coeffGroups = { easy: 0, medium: 0, hard: 0, veryHard: 0 };

    activeQuestions.forEach(q => {
        const s = AppState.stats[q.id];
        if (s) {
            const answered = (s.correct || 0) + (s.wrong || 0) > 0;
            if (s.learned) learnedCount++;
            else if (answered) solvedCount++;

            // Coeff groups: only for SOLVED questions as per user request
            if (answered) {
                const c = s.coeff || 1.5;
                if (c <= 1.0)      coeffGroups.easy++;
                else if (c <= 2.0) coeffGroups.medium++;
                else if (c <= 2.6) coeffGroups.hard++;
                else               coeffGroups.veryHard++;
            }
        }
    });
    const notSolvedCount = total - learnedCount - solvedCount;

    // ---- Chart 1: Stacked Horizontal Bar ----
    _drawStackedBar(
        document.getElementById('chartDistribution'),
        document.getElementById('chartDistLegend'),
        [
            { label: 'Öğrenildi', value: learnedCount, color: '#22c55e' },
            { label: 'Çözüldü',   value: solvedCount,  color: '#38bdf8' },
            { label: 'Çözülmedi', value: notSolvedCount, color: '#475569' },
        ],
        total
    );

    // ---- Chart 2: Donut / Pie — Difficulty ----
    _drawDonut(
        document.getElementById('chartDifficulty'),
        document.getElementById('chartDiffLegend'),
        [
            { label: 'Kolay (≤1.0)',     value: coeffGroups.easy,     color: '#22c55e' },
            { label: 'Orta (1.0–2.0)',   value: coeffGroups.medium,  color: '#f59e0b' },
            { label: 'Zor (2.0–2.6)',    value: coeffGroups.hard,    color: '#f97316' },
            { label: 'Çok Zor (>2.6)',   value: coeffGroups.veryHard, color: '#ef4444' },
        ],
        total
    );

    // ---- Chart 3: Weekly bar chart ----
    _drawWeeklyTrend(document.getElementById('chartWeekly'));
}

/** Draws a stacked horizontal bar chart with canvas */
function _drawStackedBar(canvas, legendEl, segments, total) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth || canvas.parentElement?.offsetWidth || 300;
    const H = 60;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const barH = 18;
    const barY = (H - barH) / 2 - 8;
    const radius = barH / 2;

    // Background pill
    _roundRect(ctx, 0, barY, W, barH, radius, '#1e293b');

    let x = 0;
    segments.forEach((seg, i) => {
        if (seg.value <= 0 || total === 0) return;
        const w = (seg.value / total) * W;
        const isFirst = (x === 0);
        const isLast  = (i === segments.length - 1) ||
                        segments.slice(i + 1).every(s => s.value === 0);

        const tl = isFirst ? radius : 0;
        const tr = isLast  ? radius : 0;
        _roundRectPartial(ctx, x, barY, w, barH, tl, tr, seg.color);
        x += w;
    });

    // Percent labels inside bar
    ctx.font = `bold ${Math.max(10, barH * 0.55)}px Inter, sans-serif`;
    ctx.textBaseline = 'middle';
    x = 0;
    segments.forEach(seg => {
        const w = total > 0 ? (seg.value / total) * W : 0;
        const pct = total > 0 ? Math.round(seg.value / total * 100) : 0;
        if (w > 28 && pct > 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.textAlign = 'center';
            ctx.fillText(`${pct}%`, x + w / 2, barY + barH / 2);
        }
        x += w;
    });

    // Count labels below bar
    const labelY = barY + barH + 14;
    ctx.font = `600 11px Inter, sans-serif`;
    ctx.textBaseline = 'alphabetic';
    x = 0;
    segments.forEach(seg => {
        const w = total > 0 ? (seg.value / total) * W : 0;
        if (w > 10) {
            ctx.fillStyle = seg.color;
            ctx.textAlign = 'center';
            ctx.fillText(seg.value, x + w / 2, labelY);
        }
        x += w;
    });

    // Legend
    if (legendEl) {
        legendEl.innerHTML = segments.map(s =>
            `<span><span class="cl-dot" style="background:${s.color}"></span>${s.label}: <b>${s.value}</b></span>`
        ).join('');
    }
}

/** Draws a donut chart */
function _drawDonut(canvas, legendEl, segments, total) {
    if (!canvas) return;
    const size = Math.min(canvas.parentElement?.offsetWidth / 2 || 160, 180);
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width  = size + 'px';
    canvas.style.height = size + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2, cy = size / 2;
    const outerR = size / 2 - 4;
    const innerR = outerR * 0.60;
    let startAngle = -Math.PI / 2;

    const isDark = document.body.dataset.theme === 'dark';
    const bgColor = isDark ? '#0b1120' : '#f8fafc';
    const greyColor = isDark ? '#334155' : '#e2e8f0';

    // We want to show difficulty segments ONLY for solved questions, 
    // and the rest of the ring should be grey (unsolved).
    const solvedSegments = segments.filter(s => s.label !== 'Çözülmedi');
    const solvedTotal = solvedSegments.reduce((a, s) => a + s.value, 0);
    const unsolvedCount = total - solvedTotal;

    // Create a new segments array for the donut: [Solved Diff 1, Solved Diff 2, ..., Unsolved (Grey)]
    const finalSegments = [...solvedSegments];
    if (unsolvedCount > 0) {
        finalSegments.push({ label: 'Çözülmedi', value: unsolvedCount, color: greyColor });
    }

    if (total === 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
        ctx.arc(cx, cy, innerR, Math.PI * 2, 0, true);
        ctx.fillStyle = greyColor;
        ctx.fill();
    } else {
        finalSegments.forEach((seg, i) => {
            const sweep = (seg.value / total) * Math.PI * 2;
            if (sweep <= 0) return;
            const endAngle = startAngle + sweep;

            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, outerR, startAngle, endAngle);
            ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
            ctx.closePath();
            ctx.fillStyle = seg.color;
            ctx.fill();

            // Gap
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, outerR + 1, endAngle - 0.015, endAngle + 0.015);
            ctx.fillStyle = bgColor;
            ctx.fill();

            startAngle = endAngle;
        });
    }

    // Center text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(size * 0.14)}px Inter, sans-serif`;
    ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
    ctx.fillText(total, cx, cy - size * 0.04);
    ctx.font = `${Math.round(size * 0.09)}px Inter, sans-serif`;
    ctx.fillStyle = '#64748b';
    ctx.fillText('Soru', cx, cy + size * 0.1);

    // Legend
    if (legendEl) {
        legendEl.innerHTML = finalSegments
            .filter(s => s.value > 0)
            .map(s => {
                const pct = total > 0 ? Math.round(s.value / total * 100) : 0;
                return `<span><span class="cl-dot" style="background:${s.color}"></span>${s.label}: <b>${s.value}</b> (${pct}%)</span>`;
            }).join('');
    }
}

/** Draws last 7-day correct answer trend as a column chart */
function _drawWeeklyTrend(canvas) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth || canvas.parentElement?.offsetWidth || 300;
    const H = 140; // Slightly taller for counts
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    // Build day buckets (last 7 days)
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push({
            label: d.toLocaleDateString('tr-TR', { weekday: 'short' }),
            dateStr: d.toISOString().slice(0, 10),
            correct: 0,
            wrong: 0,
            total: 0,
        });
    }

    // Pull from recentTests
    (AppState.recentTests || []).forEach(test => {
        if (!test?.startTime) return;
        const dayStr = test.startTime.slice(0, 10);
        const bucket = days.find(d => d.dateStr === dayStr);
        if (bucket) {
            bucket.correct += test.correctCount || 0;
            bucket.wrong   += test.wrongCount   || 0;
            bucket.total   += (test.correctCount || 0) + (test.wrongCount || 0) + (test.unansweredCount || 0);
        }
    });

    // maxTotal defines the chart scale
    const maxDayTotal = Math.max(...days.map(d => d.correct + d.wrong), 1);
    const isDark = document.body.dataset.theme === 'dark';
    const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    const padL = 20, padR = 10, padTop = 20, padBot = 28;
    const chartW = W - padL - padR;
    const chartH = H - padTop - padBot;
    const gap    = chartW / 7;
    const barW   = Math.floor(gap * 0.65);

    // Grid lines
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    [0, 0.5, 1.0].forEach(f => {
        const y = padTop + chartH * (1 - f);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    });

    days.forEach((day, i) => {
        const solvedCount = day.correct + day.wrong;
        if (solvedCount === 0) {
            // Empty state placeholder
            const x = padL + i * gap + (gap - barW) / 2;
            _roundRect(ctx, x, padTop + chartH - 2, barW, 2, 1, isDark ? '#1e293b' : '#f1f5f9');
            
            // Day label
            ctx.fillStyle = textColor;
            ctx.font = `10px Inter, sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(day.label, x + barW / 2, padTop + chartH + 14);
            return;
        }

        const x = padL + i * gap + (gap - barW) / 2;
        
        // Stacked Bar Calculation
        const totalHeight_px = (solvedCount / maxDayTotal) * chartH;
        const wrongHeight_px = (day.wrong / solvedCount) * totalHeight_px;
        const correctHeight_px = totalHeight_px - wrongHeight_px;

        const baseY = padTop + chartH;

        // Draw Wrong (Bottom - Red)
        if (day.wrong > 0) {
            const tr = day.correct === 0 ? 3 : 0;
            _roundRectPartial(ctx, x, baseY - wrongHeight_px, barW, wrongHeight_px, 0, 0, '#ef4444');
            // Bottom corners always rounded
            _roundRectPartial(ctx, x, baseY - wrongHeight_px, barW, wrongHeight_px, 0, 0, '#ef4444');
            // Manual fix: round bottom
            _roundRectBottom(ctx, x, baseY - wrongHeight_px, barW, wrongHeight_px, 3, '#ef4444');
        }

        // Draw Correct (Top - Green)
        if (day.correct > 0) {
            const y = baseY - totalHeight_px;
            const h = correctHeight_px;
            const br = day.wrong === 0 ? 3 : 0;
            _roundRectTop(ctx, x, y, barW, h, 3, '#22c55e');
            if (day.wrong > 0) {
                // If there's wrong below, this is just a top part
                // _roundRectTop already handles top rounding
            } else {
                // If no wrong, round bottom too
                _roundRectBottom(ctx, x, y, barW, h, 3, '#22c55e');
            }
        }

        // Labels
        ctx.textAlign = 'center';
        
        // Total count on top
        ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
        ctx.font = `bold 11px Inter, sans-serif`;
        ctx.fillText(solvedCount, x + barW / 2, baseY - totalHeight_px - 5);

        // Day label below
        ctx.fillStyle = textColor;
        ctx.font = `10px Inter, sans-serif`;
        ctx.fillText(day.label, x + barW / 2, baseY + 14);
    });
}

/** Helper: Round TOP ONLY */
function _roundRectTop(ctx, x, y, w, h, r, color) {
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.fillStyle = color;
    ctx.fill();
}

/** Helper: Round BOTTOM ONLY */
function _roundRectBottom(ctx, x, y, w, h, r, color) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y);
    ctx.fillStyle = color;
    ctx.fill();
}

/** Helper: filled rounded rect */
function _roundRect(ctx, x, y, w, h, r, color) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
}

/** Helper: fills a rect with radius only on specified corners */
function _roundRectPartial(ctx, x, y, w, h, rTL, rTR, color) {
    const rBL = 0, rBR = 0;
    ctx.beginPath();
    ctx.moveTo(x + rTL, y);
    ctx.lineTo(x + w - rTR, y);
    ctx.quadraticCurveTo(x + w, y,     x + w,     y + rTR);
    ctx.lineTo(x + w, y + h - rBR);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rBR, y + h);
    ctx.lineTo(x + rBL, y + h);
    ctx.quadraticCurveTo(x, y + h,     x,           y + h - rBL);
    ctx.lineTo(x, y + rTL);
    ctx.quadraticCurveTo(x, y,         x + rTL,     y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
}

