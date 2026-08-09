import { AppState, liveSources } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import { showConfirm, escapeHTML } from '../../core/utils.js';
import { readJSON } from '../../core/storage.js';
import { getLocalDateStr } from '../../core/daily-activity.js';
import { calculateExamReadiness, calculateGlobalStreak, calculateFocusStreak } from './continuity-engine.js';
import { calculateRetrievability } from '../test/test-engine.js';
import { plainText } from '../../core/markdown.js';
import { renderContinuityBlock, updateDifficultyUI, getCurrentModalDifficultyViewId, resetModalDifficultyViewId } from './continuity-ui.js';


export function renderStatsList(filter = 'all', searchKeyword = '') {
    AppState.searchKeyword = searchKeyword;
    AppState.activeStatsFilter = filter;

    const list = document.getElementById('statsList');
    const sortBar = document.getElementById('statsSortBar');
    if (!list) return;
    list.innerHTML = '';

    // Determine if we are in Tag Mode
    const isTagMode = filter.startsWith('tag:');
    const tagName = isTagMode ? filter.split('tag:')[1] : null;

    // Restore/Update Top Header Title based on context
    const topTitleEl = document.getElementById('headerTitle');
    
    if (topTitleEl) {
        if (isTagMode) {
            topTitleEl.removeAttribute('data-i18n');
            topTitleEl.innerText = `${t('tag_label') || 'Etiket'}: ${tagName}`;
        } else {
            topTitleEl.setAttribute('data-i18n', 'show_stats');
            topTitleEl.innerText = t('show_stats') || 'Soru Detayları';
        }
    }

    const filterTabs = document.getElementById('statsFilterBar');
    if (filterTabs) {
        filterTabs.style.display = isTagMode ? 'none' : 'flex';
        
        // Ensure specific filters are hidden/shown correctly if we ever show the bar in tag mode
        const recentFilter = filterTabs.querySelector('[data-filter="recent"]');
        const incorrectFilter = filterTabs.querySelector('[data-filter="incorrect"]');
        if (recentFilter) recentFilter.style.display = isTagMode ? 'none' : 'flex';
        if (incorrectFilter) incorrectFilter.style.display = isTagMode ? 'none' : 'flex';
    }

    if (sortBar) {
        sortBar.style.display = (isTagMode || filter === 'all' || filter === 'starred' || filter === 'flagged' || filter === 'noted') ? 'flex' : 'none';
    }

    const filterBar = document.getElementById('statsFilterBar');
    if (filterBar) {
        filterBar.classList.toggle('has-border', filter === 'all' || isTagMode);
    }

    if (filter === 'recent' || filter === 'incorrect') {
        renderHistoricalTests(list, filter);
        return;
    }

    // Use the pool of questions from selected sources
    const activeQuestions = [];
    const globalToggle = document.getElementById('statsGlobalToggle');
    const isGlobal = globalToggle ? globalToggle.checked : false;

    // Get sources sorted by last activity (most recent test)
    const sortedSources = liveSources().sort((a, b) => {
        const getLatest = (src) => {
            const results = src.testResults || [];
            if (results.length === 0) return 0;
            const lastTime = results[results.length - 1].startTime;
            if (!lastTime) return 0;
            const time = new Date(lastTime).getTime();
            return isNaN(time) ? 0 : time;
        };
        return getLatest(b) - getLatest(a);
    });

    let filterSources = [];
    if (isGlobal || isTagMode) {
        // In Tag Mode, we respect isGlobal for filtering, but start with sortedSources
        if (isGlobal) {
            filterSources = sortedSources;
        } else {
            const activeSources = sortedSources.filter(s => s.active);
            const currentSource = sortedSources.find(s => s.id === AppState.currentSourceKey);
            
            filterSources = activeSources;
            if (currentSource && currentSource.active) {
                filterSources = [currentSource];
            }
        }
    } else {
        const activeSources = sortedSources.filter(s => s.active);
        const currentSource = sortedSources.find(s => s.id === AppState.currentSourceKey);
        
        filterSources = activeSources;
        if (currentSource && currentSource.active) {
            filterSources = [currentSource];
        }
    }

    filterSources.forEach(s => {
        if (!s.questions) return;
        s.questions.forEach((q, originalIdx) => {
            activeQuestions.push({ ...q, sourceId: s.id, sourceName: s.name, originalIndex: originalIdx + 1 });
        });
    });

    let filteredQuestions = activeQuestions;

    // Apply Tab Filter
    if (isTagMode) {
        filteredQuestions = filteredQuestions.filter(q => {
            const tags = q.tags || [];
            return tags.includes(tagName);
        });
    } else if (filter !== 'all') {
        filteredQuestions = filteredQuestions.filter(q => {
            const statKey = `${q.sourceId}_${q.id}`;
            const s = AppState.stats[statKey] || {};
            if (filter === 'starred') return s.starred;
            if (filter === 'flagged') return s.flagged;
            if (filter === 'noted') return s.note && s.note.trim() !== '';
            return true;
        });
    }


    // Apply Search Filter
    if (searchKeyword.trim() !== '') {
        const rawKw = searchKeyword.trim();
        if (rawKw.startsWith('$')) {
            // Source scope search: "$Kaynak Adı" limits results to that source only.
            // Archived sources never enter the pool (filterSources comes from liveSources()).
            const srcKw = rawKw.slice(1).trim().toLowerCase();
            if (srcKw !== '') {
                filteredQuestions = filteredQuestions.filter(q => {
                    if (String(q.sourceId).toLowerCase() === srcKw) return true;
                    return String(q.sourceName || '').toLowerCase().includes(srcKw);
                });
            }
        } else if (rawKw.startsWith('#')) {
            const tagKw = rawKw.slice(1).trim().toLowerCase();
            filteredQuestions = filteredQuestions.filter(q => {
                const rawTags = q.tags || q.content?.tags || q.tag || [];
                const tags = Array.isArray(rawTags) ? rawTags : [rawTags];
                if (tagKw === '') {
                    return tags.length > 0 && tags.some(t => String(t).trim() !== '');
                }
                return tags.some(t => String(t).toLowerCase().includes(tagKw));
            });
        } else {
            const kw = rawKw.toLowerCase();
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
    }

    // Apply Sorting
    const field = AppState.activeStatsSortField || 'original';
    const dir = AppState.activeStatsSortDir === 'asc' ? 1 : -1;
    /* One instant for the whole screen - the sort below and the percentages
       it goes on to label. See the retrievability branch. */
    const measuredAt = Date.now();

    filteredQuestions.sort((a, b) => {
        const sa = AppState.stats[`${a.sourceId}_${a.id}`] || { correct: 0, wrong: 0, difficulty: 5.0 };
        const sb = AppState.stats[`${b.sourceId}_${b.id}`] || { correct: 0, wrong: 0, difficulty: 5.0 };

        let result = 0;
        if (field === 'original') {
            const idxA = activeQuestions.findIndex(q => q.id === a.id);
            const idxB = activeQuestions.findIndex(q => q.id === b.id);
            result = idxA - idxB;
        } else if (field === 'diff') {
            result = sa.difficulty - sb.difficulty;
        } else if (field === 'success') {
            const totalA = sa.correct + sa.wrong;
            const totalB = sb.correct + sb.wrong;
            const pctA = totalA > 0 ? (sa.correct / totalA) : 0;
            const pctB = totalB > 0 ? (sb.correct / totalB) : 0;
            result = pctA - pctB;
        } else if (field === 'wrong') {
            result = sa.wrong - sb.wrong;
        } else if (field === 'retrievability') {
            /* Both sides measured from the same instant. Reading the clock
               twice inside a comparator makes the comparator itself
               inconsistent - a > b and b > a can both come out true across a
               millisecond boundary, which is not an ordering at all. */
            const ra = calculateRetrievability(sa.stability, sa.lastReview, measuredAt) || 0;
            const rb = calculateRetrievability(sb.stability, sb.lastReview, measuredAt) || 0;
            result = ra - rb;
        }
        return result * dir;
    });

    updateSortUI();

    // Coordinate search visibility if global sync exists
    if (typeof window.syncStatsSearchUI === 'function') {
        window.syncStatsSearchUI();
    }

    updateStatsFooter(filter, searchKeyword, filteredQuestions.length, filteredQuestions);
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

    const isTagSearch = searchKeyword.trim().startsWith('#');

    filteredQuestions.forEach((q, i) => {
        const statKey = `${q.sourceId}_${q.id}`;
        const s = AppState.stats[statKey] || { correct: 0, wrong: 0, difficulty: 5.0 };
        const total = s.correct + s.wrong;
        const percent = total > 0 ? Math.round((s.correct / total) * 100) : 0;
        const item = document.createElement('div');
        item.className = 'stats-list-item';
        const rawQText = q.content?.text || q.text || t('untitled_question');
        const qText = escapeHTML(plainText(rawQText));
        const safeSourceName = q.sourceName ? escapeHTML(q.sourceName) : '';

        const isLearned = !!s.learned;
        const streak = s.streak || 0;
        const streakIcon = streak > 0 ? '🔥' : (streak < 0 ? '❄️' : '');
        const streakAbs = Math.abs(streak);
        const r = calculateRetrievability(s.stability, s.lastReview, measuredAt);
        const rPercent = r > 0 ? Math.round(r * 100) : null;

        const rawTags = q.tags || q.content?.tags || q.tag || [];
        const qTags = Array.isArray(rawTags) ? rawTags : (rawTags ? [rawTags] : []);

        const tagsHtml = qTags.length > 0 ? `
            <div class="stats-item-tags" style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 4px;">
                ${qTags.map(tName => `<span class="stats-tag-pill" data-tag="${escapeHTML(tName)}">#${escapeHTML(tName)}</span>`).join('')}
            </div>
        ` : '';

        item.innerHTML = `
            <div style="flex: 1; min-width: 0;">
                <div class="stats-item-text">${isLearned ? `<span class="learned-badge" title="${t('learned_label')}">🎓</span> ` : ''}${qText}</div>
                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 2px;">
                    ${(!isTagSearch && safeSourceName) ? `<div class="stats-item-source">${safeSourceName}</div>` : ''}
                    ${(!isTagSearch) ? `<div class="stats-item-ref">#${q.originalIndex}</div>` : ''}
                    ${streakAbs > 1 ? `<span class="stats-item-streak" title="Streak: ${streak}" style="font-size: 0.72rem; line-height: 1;">${streakIcon}${streakAbs}</span>` : ''}
                    ${rPercent !== null ? `<span class="stats-item-retrievability ${r <= 0.9 ? 'overdue' : ''}" title="Retrievability: ${rPercent}%" style="font-size: 0.72rem; line-height: 1;">🧠 ${rPercent}%</span>` : ''}
                    ${s.starred ? `<span class="stats-indicator starred"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></span>` : ''}
                    ${s.flagged ? `<span class="stats-indicator flagged"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg></span>` : ''}
                    ${(s.note && s.note.trim() !== '') ? `<span class="stats-indicator noted"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></span>` : ''}
                </div>
                ${tagsHtml}
            </div>
            <div class="stats-item-meta">
                <span>✓${s.correct} ✗${s.wrong} (${percent}%)</span>
                <span class="${isLearned ? 'learned-coeff' : ''}">${t('difficulty_label')} ${(s.difficulty / 2).toFixed(1)}</span>
            </div>
        `;
        item.onclick = () => {
            if (window.onPreviewQuestion) window.onPreviewQuestion(q, null, 'stats');
        };
        item.querySelectorAll('.stats-tag-pill').forEach(pill => {
            pill.onclick = (e) => {
                e.stopPropagation();
                const tag = pill.dataset.tag;
                if (typeof window.executeTagSearch === 'function') {
                    window.executeTagSearch(tag);
                } else {
                    const searchInput = document.getElementById('statsSearchInput');
                    if (searchInput) searchInput.value = '#' + tag;
                    if (typeof window.syncStatsSearchUI === 'function') window.syncStatsSearchUI(true);
                    renderStatsList('all', '#' + tag);
                }
            };
        });
        list.appendChild(item);
    });
}

function updateStatsFooter(filter, keyword, count, questions = []) {
    const footer = document.getElementById('statsFooter');
    if (!footer) return;

    const globalToggle = document.getElementById('statsGlobalToggle');
    const isGlobal = globalToggle ? globalToggle.checked : false;

    // --- Determine left-side scope label ---
    let scopeName = '';
    const rawKw = (keyword || '').trim();

    if (rawKw.startsWith('$')) {
        // Source scope: strip $ prefix to get clean source name
        scopeName = rawKw.slice(1).trim() || t('stats_scope_all_label');
    } else if (rawKw.startsWith('#')) {
        // Tag scope: strip # prefix to get clean tag name
        const tagName = rawKw.slice(1).trim();
        scopeName = tagName ? `#${tagName}` : t('stats_scope_tags');
    } else if (rawKw !== '') {
        // Free-text keyword search
        scopeName = t('stats_scope_search');
    } else if (filter && filter.startsWith('tag:')) {
        // Tag filter mode
        const tagName = filter.slice(4).trim();
        scopeName = tagName ? `#${tagName}` : t('stats_scope_tags');
    } else if (filter && filter !== 'all' && filter !== 'recent' && filter !== 'incorrect') {
        // Named filter (starred, flagged, noted etc.)
        scopeName = t(`filter_${filter}`) || filter;
    } else {
        // Default: show active vs all sources
        scopeName = isGlobal ? t('stats_scope_all_label') : t('stats_scope_active_label');
    }

    // --- Right-side count ---
    const countText = t('stats_count_short', { count });

    // --- Build HTML (left: scope, right: count) ---
    const isSearchActive = rawKw !== '';
    const isFilterActive = filter && filter !== 'all' && filter !== 'recent' && filter !== 'incorrect';
    const isTagMode = filter && filter.startsWith('tag:');
    const shouldShowButton = (isSearchActive || isFilterActive || isTagMode) && count > 0 && Array.isArray(questions) && questions.length > 0;

    const scopeRow = `
        <div class="stats-footer-row">
            <span class="stats-footer-scope">${escapeHTML(t('stats_scope_prefix'))} <strong class="stats-footer-scope-name">${escapeHTML(scopeName)}</strong></span>
            <span class="stats-footer-count">${escapeHTML(countText)}</span>
        </div>`;

    if (shouldShowButton) {
        footer.innerHTML = `
            <div class="stats-footer-content">
                ${scopeRow}
                <button class="start-filtered-test-btn" id="startFilteredTestBtn">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;">
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                    </svg>
                    <span>${t('start_test_from_results', { count })}</span>
                </button>
            </div>
        `;
        const btn = footer.querySelector('#startFilteredTestBtn');
        if (btn) {
            btn.onclick = (e) => {
                e.stopPropagation();
                if (typeof window.startTestFromFilteredQuestions === 'function') {
                    window.startTestFromFilteredQuestions(questions, keyword || filter);
                }
            };
        }
    } else {
        footer.innerHTML = `<div class="stats-footer-content">${scopeRow}</div>`;
    }
}


function renderHistoricalTests(list, filter) {
    let testsToShow = [];
    const globalToggle = document.getElementById('statsGlobalToggle');
    const isGlobal = globalToggle ? globalToggle.checked : false;
    const currentSource = AppState.sources.find(s => s.id === AppState.currentSourceKey);

    if (!isGlobal && currentSource && currentSource.active && AppState.sources.filter(s => s.active).length === 1) {
        // Use source-specific logs ONLY if specifically focusing on ONE active source AND not in global mode
        if (filter === 'recent') {
            testsToShow = currentSource.testResults || [];
        } else if (filter === 'incorrect') {
            testsToShow = currentSource.wrongData || [];
        }
    } else {
        // Use global logs if multiple sources are active, no focus, or in global mode
        testsToShow = AppState.recentTests || [];

        if (filter === 'incorrect') {
            // Further filter global tests to only show those with mistakes
            testsToShow = testsToShow.filter(t => t.questions.some(q => !q.isCorrect && !q.isUnanswered));
        }
    }

    if (testsToShow.length === 0) {
        list.innerHTML = `<div style="text-align:center; padding: 2rem; color: var(--text-secondary);">${t('no_recent_tests')}</div>`;
        return;
    }

    // Sort: "hataları her zaman eski tarihli test loglarına göre en üstte listelenmeli"
    // This implies sorting by (wrongCount > 0) DESC, then by Date DESC?
    // Or just prioritize any test with errors.
    const sortedTests = [...testsToShow].sort((a, b) => {
        const aHasWrong = (a.wrongCount || 0) > 0;
        const bHasWrong = (b.wrongCount || 0) > 0;
        
        if (aHasWrong !== bHasWrong) {
            return aHasWrong ? -1 : 1; // Prioritize tests with errors
        }
        
        // Secondary sort: Date descending (newest first)
        return new Date(b.startTime) - new Date(a.startTime);
    });

    sortedTests.forEach((test, testIdx) => {
        if (!test || !Array.isArray(test.questions)) return;

        // Independent deletion check
        if (filter === 'recent' && test.hiddenInRecent) return;
        if (filter === 'incorrect' && test.hiddenInIncorrect) return;

        const questionsToShow = filter === 'incorrect'
            ? test.questions.filter(q => !q.isCorrect && !q.isUnanswered)
            : test.questions;

        if (questionsToShow.length === 0 && filter === 'incorrect') return;
        if (test.questions.length === 0) return;

        const sourceTitle = test.sourceTitle || (test.sourceNames?.length > 1 ? test.sourceNames.join(' + ') : (test.sourceNames?.[0] || t('mixed_sources')));
        const isMixed = (test.sourceNames?.length > 1);
        const fullTitle = sourceTitle;

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
                        <span>${t('questions_count', { count: questionsToShow.length })}</span> • 
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
                            <div class="history-question-text">${escapeHTML(q.content?.text || q.text || '')}</div>
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

                if (currentSource) {
                    import('../../core/state.js').then(m => m.saveSources());
                } else {
                    import('../../core/state.js').then(m => m.saveRecentTests());
                }
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
    const visibleCount = testsToShow.filter(test => {
        if (!test || !Array.isArray(test.questions) || test.questions.length === 0) return false;
        if (filter === 'recent' && test.hiddenInRecent) return false;
        if (filter === 'incorrect') {
            if (test.hiddenInIncorrect) return false;
            // For incorrect tab, we already filtered tests with errors into wrongData if source-focused,
            // but for global view or fallback, we check again.
            const hasIncorrect = test.questions.some(q => !q.isCorrect && !q.isUnanswered);
            if (!hasIncorrect) return false;
        }
        return true;
    }).length;
    updateStatsFooter(filter, '', visibleCount);
}

export function updateHomeStats() {
    const activeQuestions = [];
    const activeSources = AppState.sources.filter(s => s.active);
    const filterSources = activeSources;

    filterSources.forEach(s => {
        if (s.questions) activeQuestions.push(...s.questions);
    });

    const total = activeQuestions.length;
    const statTotalEl = document.getElementById('statTotal');
    if (statTotalEl) statTotalEl.innerText = total;

    let solved = 0;      // en az bir kez cevaplanmis (doğru veya yanlış)
    let learnedCount = 0;
    let totalDifficulty = 0;
    filterSources.forEach(source => {
        if (!source.questions) return;
        source.questions.forEach(q => {
            if (!q) return;
            const statKey = `${source.id}_${q.id}`;
            const s = AppState.stats[statKey];
            if (s) {
                if ((s.correct || 0) + (s.wrong || 0) > 0) solved++;
                if (s.learned) learnedCount++;
                totalDifficulty += s.difficulty || 5.0;
            } else {
                totalDifficulty += 5.0;
            }
        });
    });

    // Segment calculations — learnedCount is a subset of solved
    const solvedOnlyCount = solved - learnedCount; // cevaplanmış ama öğrenilmemiş
    const notSolvedCount  = total - solved;

    const learnedPct    = total > 0 ? (learnedCount    / total * 100).toFixed(1) : 0;
    const solvedOnlyPct = total > 0 ? (solvedOnlyCount / total * 100).toFixed(1) : 0;
    const notSolvedPct  = total > 0 ? Math.max(0, 100 - parseFloat(learnedPct) - parseFloat(solvedOnlyPct)).toFixed(1) : 100;

    const avgDiff = total > 0 ? (totalDifficulty / total / 2).toFixed(1) : "-";
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
    const learnedLabelText = learnedCount > 0 ? ` • ${learnedCount} ${t('learned_label')}` : '';

    updateEl('homeStatTotal', total);
    updateEl('homeStatAvg', avgDiff);
    updateEl('homeExamReadiness', `${calculateExamReadiness()}%`);
    updateEl('homeProgressPercent', pctText);

    const totalBox = document.getElementById('homeStatTotalBox');
    if (totalBox && !totalBox.dataset.bound) {
        totalBox.dataset.bound = 'true';
        totalBox.addEventListener('click', () => {
            import('../../core/utils.js').then(({ showInfoAlert }) => {
                showInfoAlert(t('total_questions_info_desc') || "Bu metrik sistemde kayıtlı toplam soru sayısını ifade eder.", t('total_questions_info_title') || "Toplam Soru");
            });
        });
    }

    const readinessBox = document.getElementById('examReadinessStatBox');
    if (readinessBox && !readinessBox.dataset.bound) {
        readinessBox.dataset.bound = 'true';
        readinessBox.addEventListener('click', () => {
            import('../../core/utils.js').then(({ showInfoAlert }) => {
                showInfoAlert(t('exam_readiness_info_desc'), t('exam_readiness_info_title'));
            });
        });
    }

    const avgDiffBox = document.getElementById('avgDiffStatBox');
    if (avgDiffBox && !avgDiffBox.dataset.bound) {
        avgDiffBox.dataset.bound = 'true';
        avgDiffBox.addEventListener('click', () => {
            import('../../core/utils.js').then(({ showInfoAlert }) => {
                showInfoAlert(t('avg_diff_info_desc'), t('avg_diff_info_title'));
            });
        });
    }

    // Update 3 segments
    updateStyle('pbSegLearned',  'width', learnedPct + '%');
    updateStyle('pbSegSolved',   'width', solvedOnlyPct + '%');
    updateStyle('pbSegNotSolved','width', notSolvedPct + '%');

    // Update legend counts (always show even if 0)
    updateEl('legendLearnedCount',   learnedCount);
    updateEl('legendSolvedCount',    solvedOnlyCount);
    updateEl('legendNotSolvedCount', notSolvedCount);

    updateEl('homeProgressDetail', progressText);

    const startPanel = document.getElementById('startPanel');
    const statsCard = document.getElementById('homeStatsCard');
    const statsBtn = document.getElementById('homeStatsBtn');
    const onboarding = document.getElementById('homeOnboardingBar');

    const totalSources = liveSources().length;
    const hasActiveSource = liveSources().some(s => s.active);

    const sourcesBadge = document.getElementById('homeSourcesBadge');
    if (sourcesBadge) {
        sourcesBadge.innerText = `${activeSources.length}/${totalSources}`;
    }

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

    if (typeof window.renderHomeActiveSources === 'function') {
        window.renderHomeActiveSources();
    }

    const homeView = document.getElementById('homeView');
    const activeBody = document.getElementById('homeStatsActiveBody');
    const emptyState = document.getElementById('homeStatsEmptyState');

    if (statsCard) statsCard.style.display = 'block';

    if (totalSources === 0 || !hasActiveSource) {
        if (activeBody) activeBody.style.display = 'none';
        if (emptyState) emptyState.style.display = 'flex';
        if (startPanel) startPanel.style.display = 'none';
        if (homeView) homeView.classList.remove('empty-state');
    } else {
        if (activeBody) activeBody.style.display = 'block';
        if (emptyState) emptyState.style.display = 'none';
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

    renderContinuityBlock();
}

function updateSortUI() {
    const field = AppState.activeStatsSortField || 'original';
    const dir = AppState.activeStatsSortDir;

    // Check if search is active via CSS class on sort bar (more robust)
    const sortBar = document.getElementById('statsSortBar');
    const isSearchExpanded = sortBar && sortBar.classList.contains('search-expanded');
    
    // Also check if search input has focus or text to be doubly sure
    const searchInput = document.getElementById('statsSearchInput');
    const hasFocus = document.activeElement === searchInput;
    const hasText = searchInput && searchInput.value.trim().length > 0;
    const isSearching = isSearchExpanded || hasText || hasFocus;

    document.querySelectorAll('.sort-btn').forEach(btn => {
        const isMatch = btn.dataset.sort === field;
        // If search is active (expanded, has text, or focused), we hide the .active highlight 
        // and text to make buttons icon-only.
        btn.classList.toggle('active', isMatch && !isSearching);
        const dirEl = btn.querySelector('.sort-dir');
        if (dirEl) {
            dirEl.innerText = (isMatch && !isSearching) ? (dir === 'asc' ? ' ↑' : ' ↓') : '';
        }
    });
}

// Expose globally for coordination with search logic in main.js
window.refreshStatsSortUI = updateSortUI;

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
                // Retrievability usually more useful when showing overdue first (lowest R)
                if (sortField === 'retrievability') {
                    AppState.activeStatsSortDir = 'asc';
                }
            }
            renderStatsList(AppState.activeStatsFilter, AppState.searchKeyword);
        };
    });

    const globalToggle = document.getElementById('statsGlobalToggle');
    if (globalToggle) {
        globalToggle.onchange = () => {
            renderStatsList(AppState.activeStatsFilter, AppState.searchKeyword);
        };
    }
}

/**
 * Opens #stats showing only the questions of one source.
 * Turns on the "all sources" toggle (so the source is in the pool even when it is
 * not active) and runs the existing search with the "$name" source-scope prefix.
 * Archived sources are still excluded - the pool always comes from liveSources().
 */
export function inspectSourceQuestions(sourceId) {
    const source = liveSources().find(s => s.id === sourceId);
    if (!source) return;

    const globalToggle = document.getElementById('statsGlobalToggle');
    if (globalToggle) globalToggle.checked = true;

    const query = `$${source.name}`;
    AppState.activeTagFilter = null;
    AppState.activeStatsFilter = 'all';
    document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === 'all');
    });

    const searchInput = document.getElementById('statsSearchInput');
    if (searchInput) searchInput.value = query;

    if (typeof window.switchView === 'function') window.switchView('stats');
    if (typeof window.syncStatsSearchUI === 'function') window.syncStatsSearchUI(true);

    renderStatsList('all', query);

    try {
        history.replaceState(
            { view: 'stats', searchQuery: query, filter: 'all' },
            '',
            `#stats?q=${encodeURIComponent(query)}`
        );
    } catch (err) { }
}

window.inspectSourceQuestions = inspectSourceQuestions;

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
        resetModalDifficultyViewId();
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
    const activeSources = AppState.sources.filter(s => s.active);
    let filterSources = activeSources;

    const currentId = getCurrentModalDifficultyViewId();
    if (currentId && currentId !== 'all') {
        const selected = activeSources.find(s => s.id === currentId);
        if (selected) {
            filterSources = [selected];
        }
    }

    filterSources.forEach(s => {
        if (s.questions) activeQuestions.push(...s.questions);
    });
    const total = activeQuestions.length;
    if (total === 0) return;

    // Compute segments
    let learnedCount = 0, solvedCount = 0;
    const coeffGroups = { easy: 0, medium: 0, hard: 0, veryHard: 0 };

    filterSources.forEach(source => {
        if (!source.questions) return;
        source.questions.forEach(q => {
            const statKey = `${source.id}_${q.id}`;
            const s = AppState.stats[statKey];
            if (s) {
                const answered = (s.correct || 0) + (s.wrong || 0) > 0;
                if (s.learned) learnedCount++;
                else if (answered) solvedCount++;

                // Difficulty groups: only for SOLVED questions as per user request
                if (answered) {
                    const d = s.difficulty || 5; 
                    if (d <= 4.0)      coeffGroups.easy++;     // Display <= 2.0
                    else if (d <= 6.0) coeffGroups.medium++;   // Display 2.0 - 3.0 
                    else if (d <= 8.0) coeffGroups.hard++;     // Display 3.0 - 4.0
                    else               coeffGroups.veryHard++; // Display > 4.0
                }
            }
        });
    });
    const notSolvedCount = total - learnedCount - solvedCount;

    // ---- Chart 1: Stacked Horizontal Bar ----
    _drawStackedBar(
        document.getElementById('chartDistribution'),
        document.getElementById('chartDistLegend'),
        [
            { label: t('stat_learned'), value: learnedCount, color: '#22c55e' },
            { label: t('stat_solved'),  value: solvedCount,  color: '#38bdf8' },
            { label: t('stat_not_solved'), value: notSolvedCount, color: '#475569' },
        ],
        total
    );

    // ---- Chart 2: Donut / Pie – Difficulty (Using SSOT Component) ----
    updateDifficultyUI(true);

    // ---- Chart 3: Weekly bar chart ----
    _drawWeeklyTrend(document.getElementById('chartWeekly'), filterSources);
}

/**
 * Live palette for the canvas charts.
 * Canvas can't use CSS custom properties, so we read them off :root once per
 * draw. data-theme lives on <html>, not <body> — reading document.body here is
 * what silently pinned every chart to the light palette.
 */
function _chartPalette() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    const isDark = document.documentElement.dataset.theme === 'dark';
    return {
        isDark,
        surface: v('--surface-color', '#ffffff'),   // the panel the charts sit on
        text:    v('--text-primary', '#0f172a'),
        muted:   v('--text-secondary', '#64748b'),
        border:  v('--border-color', '#e2e8f0'),
        track:   v('--surface-hover', '#e2e8f0'),   // unfilled / unsolved fill
        grid:    isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
        hairline: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)',
    };
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

    // Background pill (the unfilled track)
    _roundRect(ctx, 0, barY, W, barH, radius, _chartPalette().track);

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

/** Draws last 7-day correct answer trend as a column chart */
function _drawWeeklyTrend(canvas, sources = []) {
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
            label: d.toLocaleDateString(AppState.language === 'tr' ? 'tr-TR' : AppState.language, { weekday: 'short' }),
            dateStr: d.toISOString().slice(0, 10),
            correct: 0,
            wrong: 0,
            total: 0,
        });
    }

    // Pull from reliable recentTests or source-specific logs based on selected sources
    const testsToScan = [];
    if (sources && sources.length > 0) {
        sources.forEach(s => {
            if (s.testResults) {
                testsToScan.push(...s.testResults);
            }
        });
    } else {
        // Fallback to global recentTests if no sources provided (though filterSources is always passed now)
        testsToScan.push(...(AppState.recentTests || []));
    }

    testsToScan.forEach(test => {
        if (!test?.startTime) return;
        const dayStr = test.startTime.slice(0, 10);
        const bucket = days.find(d => d.dateStr === dayStr);
        if (bucket) {
            bucket.correct += test.correctCount || 0;
            bucket.wrong   += test.wrongCount   || 0;
            bucket.total   += (test.correctCount || 0) + (test.wrongCount || 0) + (test.unansweredCount || 0);
        }
    });

    const pal = _chartPalette();
    const isDark = pal.isDark;
    const gridColor = pal.grid;
    const textColor = pal.muted;
    const skippedColor = isDark ? '#64748b' : '#cbd5e1';

    // Calculate nice intervals for Y-axis based on total (incl. unanswered)
    const maxDayTotal = Math.max(...days.map(d => d.total), 1);
    const roughStep = maxDayTotal / 5;
    const niceSteps = [1, 2, 5, 10, 20, 25, 50, 100, 250, 500];
    const step = niceSteps.find(s => s >= roughStep) || niceSteps[niceSteps.length - 1];
    const lineCount = Math.ceil(maxDayTotal / step);
    const chartMax = step * lineCount;

    const padL = 32, padR = 10, padTop = 20, padBot = 28;
    const chartW = W - padL - padR;
    const chartH = H - padTop - padBot;
    const gap    = chartW / 7;
    const barW   = Math.floor(gap * 0.65);

    // Grid lines & Y-Axis Labels
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = textColor;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= lineCount; i++) {
        const val = i * step;
        const y = padTop + chartH * (1 - (val / chartMax));
        
        // Grid line
        ctx.beginPath(); 
        ctx.moveTo(padL, y); 
        ctx.lineTo(W - padR, y); 
        ctx.stroke();

        // Label
        ctx.fillText(val, padL - 8, y);
    }

    days.forEach((day, i) => {
        const unanswered = Math.max(0, day.total - day.correct - day.wrong);
        const dayTotal = day.correct + day.wrong + unanswered;
        const x = padL + i * gap + (gap - barW) / 2;
        const baseY = padTop + chartH;

        // Reset color for labels
        ctx.fillStyle = textColor;
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(day.label, x + barW / 2, baseY + 14);

        if (dayTotal === 0) {
            // Empty state placeholder
            _roundRect(ctx, x, baseY - 2, barW, 2, 1, pal.border);
            return;
        }

        // Pixel heights for each segment
        const totalHeight_px    = (dayTotal      / chartMax) * chartH;
        const wrongHeight_px    = (day.wrong      / dayTotal) * totalHeight_px;
        const skippedHeight_px  = (unanswered     / dayTotal) * totalHeight_px;
        const correctHeight_px  = (day.correct    / dayTotal) * totalHeight_px;

        // Draw from bottom to top: Wrong (red) → Skipped (grey) → Correct (green)
        let drawY = baseY;

        // Wrong (Bottom - Red)
        if (day.wrong > 0) {
            drawY -= wrongHeight_px;
            const isOnlySegment = unanswered === 0 && day.correct === 0;
            _roundRectBottom(ctx, x, drawY, barW, wrongHeight_px, 3, '#ef4444');
            if (isOnlySegment) _roundRectTop(ctx, x, drawY, barW, wrongHeight_px, 3, '#ef4444');
        }

        // Skipped (Middle - Grey)
        if (unanswered > 0) {
            drawY -= skippedHeight_px;
            const isBottom = day.wrong === 0;
            const isTop    = day.correct === 0;
            if (isBottom && isTop) {
                // Only segment — round all corners
                _roundRect(ctx, x, drawY, barW, skippedHeight_px, 3, skippedColor);
            } else if (isBottom) {
                _roundRectBottom(ctx, x, drawY, barW, skippedHeight_px, 3, skippedColor);
            } else if (isTop) {
                _roundRectTop(ctx, x, drawY, barW, skippedHeight_px, 3, skippedColor);
            } else {
                // Sandwiched — no rounding
                ctx.fillStyle = skippedColor;
                ctx.fillRect(x, drawY, barW, skippedHeight_px);
            }
        }

        // Correct (Top - Green)
        if (day.correct > 0) {
            drawY -= correctHeight_px;
            _roundRectTop(ctx, x, drawY, barW, correctHeight_px, 3, '#22c55e');
            if (day.wrong === 0 && unanswered === 0) {
                _roundRectBottom(ctx, x, drawY, barW, correctHeight_px, 3, '#22c55e');
            }
        }

        // Count above bar
        ctx.fillStyle = pal.text;
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.textBaseline = 'bottom';
        ctx.fillText(dayTotal, x + barW / 2, baseY - totalHeight_px - 4);
    });

    // --- Click handler: show day detail popup ---
    // Store layout params on canvas so the click handler can reuse them
    canvas._weeklyLayout = { padL, gap, barW, days, W, H, padTop, chartH };

    if (!canvas._weeklyClickBound) {
        canvas._weeklyClickBound = true;
        canvas.style.cursor = 'pointer';
        canvas.addEventListener('click', (e) => {
            const rect   = canvas.getBoundingClientRect();
            const scaleX = canvas.offsetWidth / rect.width;
            const clickX = (e.clientX - rect.left) * scaleX;

            const { padL, gap, barW, days } = canvas._weeklyLayout;
            const dayIndex = days.findIndex((_, i) => {
                const barX = padL + i * gap + (gap - barW) / 2;
                return clickX >= barX - 4 && clickX <= barX + barW + 4;
            });
            // Stop propagation so the document-level close listener
            // from a previously opened popup doesn't close this new one.
            e.stopPropagation();
            if (dayIndex === -1) { _removeDayPopup(); return; }
            _showDayPopup(canvas, dayIndex, canvas._weeklyLayout, e);
        });
    }
}

/** Builds and shows a positioned popup for a clicked day bar. */
function _showDayPopup(canvas, dayIndex, layout, mouseEvent) {
    _removeDayPopup();

    const { padL, gap, barW, days } = layout;
    const day = days[dayIndex];
    const unanswered = Math.max(0, day.total - day.correct - day.wrong);

    // --- Unique question count for this day ---
    const uniqueIds = new Set();
    (AppState.recentTests || []).forEach(test => {
        if (!test?.startTime) return;
        if (test.startTime.slice(0, 10) !== day.dateStr) return;
        (test.questions || []).forEach(q => {
            const id = q.id || q.content?.id;
            if (id) uniqueIds.add(id);
        });
    });
    const uniqueCount = uniqueIds.size;
    const totalAnswers = day.correct + day.wrong + unanswered;

    const pal = _chartPalette();
    const isDark = pal.isDark;

    // --- Popup element ---
    const popup = document.createElement('div');
    popup.id = 'weeklyDayPopup';

    // Format date nicely
    const dateObj = new Date(day.dateStr + 'T12:00:00');
    const dateLabel = dateObj.toLocaleDateString(
        AppState.language === 'tr' ? 'tr-TR' : AppState.language,
        { weekday: 'long', day: 'numeric', month: 'short' }
    );

    popup.innerHTML = `
        <div style="font-weight:700; font-size:0.85rem; margin-bottom:8px; padding-bottom:7px;
                    border-bottom:1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'};">
            ${dateLabel}
        </div>
        <div style="display:flex; flex-direction:column; gap:5px; font-size:0.82rem;">
            <div style="display:flex; justify-content:space-between; gap:16px;">
                <span style="color:${isDark ? '#94a3b8' : '#64748b'};">${t('stat_total_answers')}</span>
                <b>${totalAnswers}</b>
            </div>
            <div style="display:flex; justify-content:space-between; gap:16px;">
                <span style="display:flex; align-items:center; gap:5px;">
                    <span style="width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block;"></span>
                    ${t('correct')}
                </span>
                <b style="color:#22c55e;">${day.correct}</b>
            </div>
            <div style="display:flex; justify-content:space-between; gap:16px;">
                <span style="display:flex; align-items:center; gap:5px;">
                    <span style="width:8px;height:8px;border-radius:50%;background:#ef4444;display:inline-block;"></span>
                    ${t('wrong')}
                </span>
                <b style="color:#ef4444;">${day.wrong}</b>
            </div>
            <div style="display:flex; justify-content:space-between; gap:16px;">
                <span style="display:flex; align-items:center; gap:5px;">
                    <span style="width:8px;height:8px;border-radius:50%;background:${isDark ? '#64748b' : '#cbd5e1'};display:inline-block;"></span>
                    ${t('unanswered_count')}
                </span>
                <b style="color:${isDark ? '#94a3b8' : '#64748b'};">${unanswered}</b>
            </div>
            ${uniqueCount > 0 ? `
            <div style="margin-top:4px; padding-top:6px; border-top:1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'};
                        display:flex; justify-content:space-between; gap:16px; color:${isDark ? '#94a3b8' : '#64748b'}; font-size:0.78rem;">
                <span>${t('stat_unique_questions')}</span>
                <b>${uniqueCount}</b>
            </div>` : ''}
        </div>
    `;

    Object.assign(popup.style, {
        position: 'absolute',
        background: isDark ? '#2d3f55' : '#f0f4f8',
        color: isDark ? '#f1f5f9' : '#0f172a',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)'}`,
        borderRadius: '10px',
        padding: '12px 14px',
        boxShadow: isDark
            ? '0 8px 28px rgba(0,0,0,0.5)'
            : '0 8px 24px rgba(0,0,0,0.15)',
        zIndex: '9999',
        minWidth: '170px',
        pointerEvents: 'auto',
        fontFamily: 'Inter, sans-serif',
        fontSize: '0.85rem',
        transition: 'opacity 0.15s',
        opacity: '0',
    });

    // Position: above the clicked bar, anchored to viewport
    document.body.appendChild(popup);

    const canvasRect = canvas.getBoundingClientRect();
    const barCenterX = canvasRect.left + (padL + dayIndex * gap + gap / 2) * (canvasRect.width / canvas.offsetWidth);
    const popupTop   = canvasRect.top + window.scrollY - popup.offsetHeight - 10;
    let   popupLeft  = barCenterX - popup.offsetWidth / 2;

    // Keep inside viewport
    popupLeft = Math.max(8, Math.min(popupLeft, window.innerWidth - popup.offsetWidth - 8));

    popup.style.top  = `${popupTop}px`;
    popup.style.left = `${popupLeft}px`;

    requestAnimationFrame(() => { popup.style.opacity = '1'; });

    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', _removeDayPopup, { once: true });
    }, 0);
}

function _removeDayPopup() {
    const existing = document.getElementById('weeklyDayPopup');
    if (existing) existing.remove();
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

