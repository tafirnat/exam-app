import { AppState, saveStats, saveSources, saveCurrentSource, saveCustomAIPrompt, saveAiIntegration, saveActiveTest, clearActiveTest } from './core/state.js';
import { initTheme, toggleTheme } from './core/theme.js';
import { updateStaticTranslations, t, targetLanguages, translations } from './core/i18n.js';
import { showToast, getCorrectAnswers, highlightText } from './core/utils.js';
import { migrateOldData } from './core/migration.js';
import { processJSON, loadFromUrl, loadFromFile, normalizeQuestions } from './features/sources/sources-service.js';
import { renderSourcesList } from './features/sources/sources-ui.js';
import { prepareTest, finishTest, prepareRetake } from './features/test/test-engine.js';
import { renderQuestion, handleCheckAnswer, updateIndicators, handleTranslation, handleDifficultyRating, renderTestResults } from './features/test/test-ui.js';
import { renderStatsList, updateHomeStats, setupStatsEventListeners } from './features/stats/stats-module.js';

let menuActive = false;

window.onRetake = (historyEntry, onlyIncorrect) => {
    if (prepareRetake(historyEntry, onlyIncorrect)) {
        switchView('test');
        renderQuestion();
        if (menuActive) toggleMenu();
    } else {
        showToast(t('no_questions_available'));
    }
};

// --- Initialize ---
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded start');
    checkActiveTest();
    try {
        console.log('Migrating old data...');
        migrateOldData();

        console.log('Initializing theme...');
        initTheme();

        console.log('Updating static translations...');
        updateStaticTranslations();

        console.log('Rendering sources list...');
        renderSourcesList();

        // Robust fix: Normalize all questions from existing sources on startup
        console.log('Normalizing existing sources...');
        AppState.sources.forEach(s => {
            if (s.questions) s.questions = normalizeQuestions(s.questions);
        });

        // Migration fix: Update stale 1.0 coefficients to 2.0 and init new fields
        console.log('Migrating stats records (streaks and learned status)...');
        let migrationCount = 0;
        Object.keys(AppState.stats).forEach(qid => {
            const s = AppState.stats[qid];
            if (!s) return;

            let changed = false;
            if (s.correct === 0 && s.wrong === 0 && s.coeff === 1.0) {
                s.coeff = 1.5;
                changed = true;
            }
            if (s.streak === undefined) {
                s.streak = 0;
                changed = true;
            }
            if (s.learned === undefined) {
                s.learned = false;
                changed = true;
            }
            if (changed) migrationCount++;
        });
        if (migrationCount > 0) {
            console.log(`Migrated ${migrationCount} stats records`);
            saveStats();
        }

        console.log('Rendering stats list...');
        renderStatsList();

        console.log('Updating home stats...');
        updateHomeStats();

        console.log('Setting up event listeners...');
        setupEventListeners();

        console.log('Updating translation UI...');
        updateTranslationUI();

        console.log('App initialized v1.2.3');

        // One-time auto-load logic for new users: Add default template but don't force select it
        const templateAdded = localStorage.getItem('focus_app_template_added');
        if (!templateAdded) {
            console.log('Adding default exam template...');
            loadFromUrl('./examples/standard-exam.json', { active: false }).then(source => {
                if (source) renderSourcesList();
            });
            localStorage.setItem('focus_app_template_added', 'true');
        }

        // Fix: If we have active sources but no questions loaded (e.g. after refresh), load them
        if (AppState.rawQuestions.length === 0) {
            const activeSources = AppState.sources.filter(s => s.active);
            activeSources.forEach(s => {
                if (!s.questions || s.questions.length === 0) {
                    if (s.origin?.type === 'url' && s.origin.display) {
                        loadFromUrl(s.origin.display);
                    }
                }
            });

            // If still no questions in AppState.rawQuestions, but we have active sources with questions
            // (they should be normalized/processed by now in the DOMContentLoaded logic above)
            const questions = [];
            AppState.sources.forEach(s => {
                if (s.active && s.questions) questions.push(...s.questions);
            });
            if (questions.length > 0) {
                AppState.rawQuestions = questions;
            }
        }
        checkActiveTest();
    } catch (err) {
        console.error('CRITICAL INITIALIZATION ERROR:', err);
        // Fallback to setup at least basic listeners if possible
        try { setupEventListeners(); } catch (e) { }
    }
});

// Callback for sources update
window.onSourcesUpdated = () => {
    updateHomeStats();
};

window.renderQuestionPreview = (q, stats = null, source = null) => {
    // Capture scroll position before switching
    AppState.lastStatsScrollPos = window.scrollY;

    AppState.previewQuestion = q;
    AppState.previewQuestionId = q.id;

    // Explicitly track the source (results vs stats)
    // If not provided, try to infer it (fallback for safety)
    if (source) {
        AppState.currentPreviewSource = source;
    } else {
        AppState.currentPreviewSource = q.userAnswer !== undefined && q.userAnswer !== null ? 'results' : 'stats';
    }

    switchView('statsPreview');

    // Update the header title based on source
    const isFromResults = AppState.currentPreviewSource === 'results';
    const titleEl = document.querySelector('#previewIndicatorsBar .preview-title');
    if (titleEl) {
        const titleKey = isFromResults ? 'result_preview' : 'stats_preview';
        titleEl.setAttribute('data-i18n', titleKey);
        titleEl.innerText = t(titleKey);
    }

    const kw = AppState.searchKeyword || '';
    const qTextEl = document.getElementById('previewQuestionText');
    qTextEl.innerHTML = highlightText(q.content?.text || q.text || '', kw);

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
            const transEl = document.getElementById('trans_previewQuestionText');
            transEl.parentNode.insertBefore(img, transEl.nextSibling);
        } else {
            // Default: above
            card.insertBefore(img, qTextEl);
        }
    }

    // Reset translation state for new question
    const qTransEl = document.getElementById('trans_previewQuestionText');
    if (qTransEl) {
        qTransEl.innerText = '';
        qTransEl.style.display = 'none';
    }
    const qTransBtn = document.getElementById('previewQuestionTranslateBtn');
    if (qTransBtn) {
        qTransBtn.onclick = () => handleTranslation(qTransBtn, 'previewQuestionText', 'trans_previewQuestionText');
        qTransBtn.classList.remove('active');
    }

    const container = document.getElementById('previewOptionsContainer');
    container.innerHTML = '';

    const isTextQuestion = ['text', 'text_input', 'open_ended', 'fill_in_the_blank'].includes(q.type);
    const hasUserAnswer = q.userAnswer !== undefined && q.userAnswer !== null;

    if (q.options && q.options.length > 0 && !isTextQuestion) {
        const userSelection = hasUserAnswer ? (Array.isArray(q.userAnswer) ? q.userAnswer.map(String) : [String(q.userAnswer)]) : [];
        const correctAnswers = getCorrectAnswers(q).map(String);

        q.options.forEach(opt => {
            const card = document.createElement('div');
            const optId = String(opt.id);
            const isCorrect = correctAnswers.includes(optId);
            const isSelected = userSelection.includes(optId);

            card.className = 'option-card';
            if (isCorrect) card.classList.add('correct');
            if (isSelected) {
                card.classList.add('selected');
                if (!isCorrect) card.classList.add('wrong');
            }

            const contentWrapper = document.createElement('div');
            contentWrapper.className = 'option-content-wrapper';
            contentWrapper.style.flex = '1';
            contentWrapper.style.display = 'flex';
            contentWrapper.style.flexDirection = 'column';

            const content = document.createElement('div');
            content.className = 'option-content';
            content.id = `previewOptText_${opt.id}`;
            content.innerHTML = highlightText(opt.text, kw);

            const trans = document.createElement('div');
            trans.className = 'translation-text';
            trans.id = `trans_previewOptText_${opt.id}`;
            trans.style.marginTop = '0.5rem';
            trans.style.paddingTop = '0.5rem';
            trans.style.borderTop = '1px dashed var(--border-color)';
            trans.style.display = 'none';

            contentWrapper.appendChild(content);
            contentWrapper.appendChild(trans);

            const tBtn = document.createElement('button');
            tBtn.className = 'corner-translate-btn';
            tBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 8l6 6"></path><path d="M4 14l6-6 2-3"></path><path d="M2 5h12"></path><path d="M7 2h1"></path><path d="M22 22l-5-10-5 10"></path><path d="M14 18h6"></path></svg>';
            tBtn.onclick = (e) => {
                e.stopPropagation();
                handleTranslation(tBtn, `previewOptText_${opt.id}`, `trans_previewOptText_${opt.id}`);
            };

            card.appendChild(contentWrapper);
            card.appendChild(tBtn);
            container.appendChild(card);
        });
    } else {
        const correctAnswers = getCorrectAnswers(q);
        const answerToShow = correctAnswers.length > 0 ? (isTextQuestion ? correctAnswers[0] : `${t('correct')}: ${correctAnswers[0]}`) : '';
        const userVal = hasUserAnswer ? (Array.isArray(q.userAnswer) ? q.userAnswer[0] : q.userAnswer) : '';

        if (answerToShow || userVal) {
            if (isTextQuestion) {
                // Render as text input wrapper matching test UI
                const wrapper = document.createElement('div');
                wrapper.className = 'text-input-wrapper';
                wrapper.style.width = '100%';

                const isCorrect = q.isCorrect;

                wrapper.innerHTML = `
                    <div style="margin-bottom: 0.5rem; font-size: 0.8rem; color: var(--text-secondary);">Ihre Antwort:</div>
                    <input type="text" id="previewUserTextAnswer" value="${userVal || 'Keine Antwort'}" class="${hasUserAnswer ? (isCorrect ? 'correct' : 'wrong') : ''}" disabled style="margin-bottom: 1rem;">
                    
                    <div style="margin-bottom: 0.5rem; font-size: 0.8rem; color: var(--text-secondary);">Richtige Antwort:</div>
                    <input type="text" id="previewTextAnswerInput" value="${answerToShow}" class="correct" disabled>
                    <div class="feedback-container" style="margin-top: 0.75rem; display: flex; align-items: start; gap: 0.5rem;">
                        <div style="flex: 1;">
                            <div id="previewCorrectAnswerText" class="correct-answer-feedback" style="color: var(--success-color); font-weight: 600; font-size: 0.9rem;">
                                ${highlightText(t('correct_answer_was') + ' ' + answerToShow, kw)}
                            </div>
                            <div id="trans_previewCorrectAnswerText" class="translation-text" style="display: none; margin-top: 0.25rem; font-size: 0.85rem; color: var(--text-secondary);"></div>
                        </div>
                        <button id="previewFeedbackTranslateBtn" class="corner-translate-btn" style="padding: 2px;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width: 14px; height: 14px;"><path d="M5 8l6 6"></path><path d="M4 14l6-6 2-3"></path><path d="M2 5h12"></path><path d="M7 2h1"></path><path d="M22 22l-5-10-5 10"></path><path d="M14 18h6"></path></svg>
                        </button>
                    </div>
                `;
                container.appendChild(wrapper);

                const fBtn = document.getElementById('previewFeedbackTranslateBtn');
                if (fBtn) {
                    fBtn.onclick = () => handleTranslation(fBtn, 'previewCorrectAnswerText', 'trans_previewCorrectAnswerText');
                }
            } else {
                // Fallback for non-text questions without options (rare but handled)
                const card = document.createElement('div');
                card.className = 'option-card correct';

                const contentWrapper = document.createElement('div');
                contentWrapper.className = 'option-content-wrapper';
                contentWrapper.style.flex = '1';
                contentWrapper.style.display = 'flex';
                contentWrapper.style.flexDirection = 'column';

                const content = document.createElement('div');
                content.className = 'option-content';
                content.id = `previewOptText_correct`;
                content.innerText = answerToShow;

                const trans = document.createElement('div');
                trans.className = 'translation-text';
                trans.id = `trans_previewOptText_correct`;
                trans.style.marginTop = '0.5rem';
                trans.style.paddingTop = '0.5rem';
                trans.style.borderTop = '1px dashed var(--border-color)';
                trans.style.display = 'none';

                contentWrapper.appendChild(content);
                contentWrapper.appendChild(trans);

                const tBtn = document.createElement('button');
                tBtn.className = 'corner-translate-btn';
                tBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 8l6 6"></path><path d="M4 14l6-6 2-3"></path><path d="M2 5h12"></path><path d="M7 2h1"></path><path d="M22 22l-5-10-5 10"></path><path d="M14 18h6"></path></svg>';
                tBtn.onclick = (e) => {
                    e.stopPropagation();
                    handleTranslation(tBtn, `previewOptText_correct`, `trans_previewOptText_correct`);
                };

                card.appendChild(contentWrapper);
                card.appendChild(tBtn);
                container.appendChild(card);
            }
        }
    }
    const s = stats || AppState.stats[q.id] || { correct: 0, wrong: 0, coeff: 1.5, note: '' };
    const total = s.correct + s.wrong;
    const percent = total > 0 ? Math.round((s.correct / total) * 100) : 0;
    document.getElementById('previewStatsInfo').innerHTML = `
        <span>${t('correct')}: <b>${s.correct}</b></span>
        <span>${t('wrong')}: <b>${s.wrong}</b></span>
        <span>${t('success_percent', { percent })}</span>
        <span>${t('coeff_label')} <b>${s.coeff.toFixed(1)}</b></span>
    `;
    document.getElementById('previewNoteInput').value = s.note || '';
    const previewNoteArea = document.getElementById('previewNoteArea');
    if (previewNoteArea) previewNoteArea.classList.remove('visible');
    updateIndicatorsPreview();

    // Update the back button to show the correct view
    const backBtnText = document.getElementById('previewBackBtnText');
    if (backBtnText) {
        const isFromResults = AppState.currentPreviewSource === 'results';
        const key = isFromResults ? 'back_to_results' : 'back_to_stats';
        backBtnText.setAttribute('data-i18n', key);
        backBtnText.innerText = t(key);
    }
    const backBtn = document.getElementById('previewBackBtn');
    if (backBtn) {
        const isFromResults = AppState.currentPreviewSource === 'results';
        backBtn.onclick = () => {
            if (isFromResults) {
                switchView('results');
            } else {
                switchView('stats');
                renderStatsList(document.querySelector('.filter-btn.active')?.dataset.filter || 'all', document.getElementById('statsSearchInput')?.value || '');
            }
        };
    }
};

window.onPreviewQuestion = window.renderQuestionPreview;

function updateIndicatorsPreview() {
    const qid = AppState.previewQuestionId;
    if (!qid) return;
    const s = AppState.stats[qid] || {};
    document.getElementById('previewIndStar').classList.toggle('active-star', !!s.starred);
    document.getElementById('previewIndFlag').classList.toggle('active-flag', !!s.flagged);
    document.getElementById('previewIndNote').classList.toggle('active-note', !!(s.note && s.note.trim() !== ''));
}

function setupEventListeners() {
    // Menu
    document.getElementById('menuToggleBtn').onclick = toggleMenu;
    document.getElementById('menuTheme').onclick = toggleTheme;
    document.getElementById('menuExit').onclick = confirmExit;
    document.getElementById('menuStar').onclick = toggleStar;
    document.getElementById('menuFlag').onclick = toggleFlag;
    document.getElementById('menuNote').onclick = toggleNoteArea;
    document.getElementById('menuTranslateAll').onclick = translateAll;
    document.getElementById('menuCopyAI').onclick = copyAIPrompt;

    // Language selection
    // Language selection
    const btns = document.querySelectorAll('.lang-btn');
    btns.forEach(btn => {
        btn.onclick = () => {
            const lang = btn.getAttribute('data-lang');
            AppState.language = lang;
            localStorage.setItem('focus_app_lang', lang);
            updateLangUI(); // Immediate UI feedback

            try {
                updateStaticTranslations();
                renderQuestion();
                renderStatsList();
                updateHomeStats();
            } catch (err) {
                console.error('UI update partially failed:', err);
            }
        };
    });
    updateLangUI();

    // Translation target selection
    const transSelect = document.getElementById('translationTargetSelect');
    if (transSelect) {
        targetLanguages.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l.code;
            opt.innerText = l.name;
            transSelect.appendChild(opt);
        });
        transSelect.value = AppState.translationTarget;
        transSelect.onchange = (e) => {
            AppState.translationTarget = e.target.value;
            localStorage.setItem('focus_app_target_lang', e.target.value);
        };
    }

    // AI Integration selection
    const aiSelect = document.getElementById('aiIntegrationSelect');
    if (aiSelect) {
        aiSelect.value = AppState.aiIntegration;
        aiSelect.onchange = (e) => {
            AppState.aiIntegration = e.target.value;
            saveAiIntegration();
        };
    }

    // Translation Toggle
    const transToggle = document.getElementById('translationToggle');
    if (transToggle) {
        transToggle.checked = AppState.translationEnabled;
        updateTranslationUI();

        transToggle.onchange = (e) => {
            AppState.translationEnabled = e.target.checked;
            localStorage.setItem('focus_app_translation_enabled', e.target.checked);
            updateTranslationUI();
        };
    }

    setupStatsEventListeners();

    document.getElementById('indStar').onclick = toggleStar;
    document.getElementById('indFlag').onclick = toggleFlag;
    document.getElementById('indNote').onclick = toggleNoteArea;
    document.getElementById('menuTranslateAllInline').onclick = translateAll;
    document.getElementById('menuCopyAIInline').onclick = copyAIPrompt;
    document.getElementById('menuCopyTextInline').onclick = copyQuestionText;
    document.getElementById('menuEditPrompt').onclick = openPromptEditor;

    document.getElementById('previewIndStar').onclick = toggleStar;
    document.getElementById('previewIndFlag').onclick = toggleFlag;
    document.getElementById('previewIndNote').onclick = toggleNoteArea;
    document.getElementById('previewMenuTranslateAllInline').onclick = translateAll;
    document.getElementById('previewMenuCopyAIInline').onclick = copyAIPrompt;
    document.getElementById('previewMenuCopyTextInline').onclick = copyQuestionText;

    window.addEventListener('test-finished', () => {
        switchView('results');
        renderTestResults();
        updateHomeStats();
    });

    window.addEventListener('show-stats-preview', (e) => {
        const { question, stats, source } = e.detail;
        AppState.previewQuestionId = question.id;
        AppState.previewQuestion = question;
        switchView('statsPreview');
        renderQuestionPreview(question, stats, source);
    });

    // Navigation
    document.getElementById('headerBackBtn').onclick = goBack;
    document.getElementById('startBtn').onclick = startTest;
    document.getElementById('resumeBtn').onclick = resumeActiveTest;
    document.getElementById('prevBtn').onclick = prevQuestion;
    document.getElementById('nextBtn').onclick = nextQuestion;
    document.getElementById('checkBtn').onclick = handleCheckAnswer;
    document.getElementById('diffHardBtn').onclick = () => handleDifficultyRating('hard');
    document.getElementById('diffEasyBtn').onclick = () => handleDifficultyRating('easy');
    document.getElementById('homeStatsBtn').onclick = () => {
        switchView('stats');
        renderStatsList(AppState.activeStatsFilter || 'all');
    };

    // Results View
    document.getElementById('resHomeBtn').onclick = goHome;
    document.getElementById('resRetakeBtn').onclick = retakeSession;
    const scBackBtn = document.getElementById('statsBackBtn');
    if (scBackBtn) {
        scBackBtn.onclick = goBack;
    }

    // Sources
    document.getElementById('toggleAddSourceBtn').onclick = toggleAddSourcePanel;
    document.getElementById('loadUrlBtn').onclick = async () => {
        const url = document.getElementById('urlInput').value.trim();
        const source = await loadFromUrl(url);
        if (source) {
            document.getElementById('urlInput').value = '';
            toggleAddSourcePanel();
            renderSourcesList();
        }
    };
    document.getElementById('fileInput').onchange = async (e) => {
        const source = await loadFromFile(e.target.files[0]);
        if (source) {
            e.target.value = '';
            const panel = document.getElementById('addSourcePanel');
            if (panel.style.display !== 'none') toggleAddSourcePanel();
            renderSourcesList();
        }
    };

    // Generic Data Export/Import
    const handleExport = () => {
        const data = {
            version: "1.5",
            sources: AppState.sources,
            stats: AppState.stats,
            recentTests: AppState.recentTests,
            settings: {
                language: AppState.language,
                translationTarget: AppState.translationTarget,
                theme: localStorage.getItem('focus_app_theme') || 'light'
            }
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `exam-app-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        showToast(t('export_success') || 'Export erfolgreich');
    };

    const handleImport = async (file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.questions) {
                    // Single source import
                    await processJSON(data, file.name);
                } else if (data.sources || data.stats) {
                    // Full backup import
                    if (confirm(t('confirm_import_backup') || 'Möchten Sie dieses Backup laden? Bestehende Daten werden überschrieben.')) {
                        if (data.sources) AppState.sources = data.sources;
                        if (data.stats) AppState.stats = data.stats;
                        if (data.recentTests) AppState.recentTests = data.recentTests;
                        saveStats();
                        saveSources();
                        import('./core/state.js').then(m => m.saveRecentTests());
                        location.reload(); // Simplest way to re-init everything safely
                    }
                } else {
                    showToast(t('invalid_format') || 'Ungültiges Format');
                }
            } catch (err) {
                console.error(err);
                showToast(t('import_failed') || 'Import fehlgeschlagen');
            }
        };
        reader.readAsText(file);
    };

    // Export Buttons
    const exportBtns = ['exportBtn', 'homeExportBtn'];
    exportBtns.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.onclick = handleExport;
    });

    // Import Buttons
    const importConfigs = [
        { btn: 'importBtn', input: 'importFileInput' },
        { btn: 'homeImportBtn', input: 'importFileInput' } // Reuse same hidden input
    ];

    importConfigs.forEach(cfg => {
        const btn = document.getElementById(cfg.btn);
        const input = document.getElementById(cfg.input);
        if (btn && input) {
            btn.onclick = () => input.click();
        }
    });

    const mainImportInput = document.getElementById('importFileInput');
    if (mainImportInput) {
        mainImportInput.onchange = (e) => handleImport(e.target.files[0]);
    }

    // AI Prompt Editor Listeners
    document.getElementById('promptCancelBtn').onclick = closePromptEditor;
    document.getElementById('promptSaveBtn').onclick = saveCustomPrompt;
    document.getElementById('promptResetBtn').onclick = resetCustomPrompt;
    document.getElementById('promptEditorOverlay').onclick = (e) => {
        if (e.target.id === 'promptEditorOverlay') closePromptEditor();
    };

    // Stats Filters & Search
    const getStatsSearchKeyword = () => document.getElementById('statsSearchInput')?.value || '';

    const statsSearchInput = document.getElementById('statsSearchInput');
    const statsSearchExpand = document.getElementById('statsSearchExpand');
    const statsSearchClear = document.getElementById('statsSearchClear');
    const statsSearchWrapper = document.getElementById('statsSearchWrapper');

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            AppState.activeStatsFilter = btn.dataset.filter;

            if (btn.dataset.filter !== 'all') {
                if (statsSearchInput) statsSearchInput.value = '';
                if (statsSearchClear) statsSearchClear.style.display = 'none';
                if (statsSearchWrapper) {
                    statsSearchWrapper.classList.remove('expanded');
                    statsSearchWrapper.classList.add('icon-only');
                }
            } else {
                if (statsSearchWrapper) statsSearchWrapper.classList.remove('icon-only');
            }

            renderStatsList(btn.dataset.filter, btn.dataset.filter === 'all' ? getStatsSearchKeyword() : '');
        };
    });
    const statsCardHeader = document.querySelector('#statsView .stats-card-header');

    if (statsSearchInput) {
        // Unified function to sync search UI state
        const syncSearchState = () => {
            const input = document.getElementById('statsSearchInput');
            const wrapper = document.getElementById('statsSearchWrapper');
            if (!input || !wrapper) return;

            const hasText = input.value.trim().length > 0;
            const hasFocus = document.activeElement === input;
            const shouldExpand = hasText || hasFocus;

            const sortBar = document.getElementById('statsSortBar');

            if (shouldExpand) {
                wrapper.classList.add('expanded');
                if (sortBar) sortBar.classList.add('search-expanded');
            } else {
                wrapper.classList.remove('expanded');
                if (sortBar) sortBar.classList.remove('search-expanded');
            }

            // Ensure logic matches selected filter
            if (AppState.activeStatsFilter === 'all') {
                wrapper.classList.remove('icon-only');
            } else {
                wrapper.classList.add('icon-only');
            }

            if (statsSearchClear) {
                statsSearchClear.style.display = input.value.length > 0 ? 'flex' : 'none';
            }
        };

        statsSearchInput.oninput = () => {
            syncSearchState();
            const activeFilter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
            renderStatsList(activeFilter, statsSearchInput.value);
        };

        statsSearchInput.onfocus = () => {
            if (AppState.activeStatsFilter !== 'all') {
                const allBtn = document.querySelector('.filter-btn[data-filter="all"]');
                if (allBtn) allBtn.click();
            }
            syncSearchState();
        };

        if (statsSearchExpand) {
            statsSearchExpand.onclick = (e) => {
                e.stopPropagation();
                // If not on 'all' filter, switch to it first
                if (AppState.activeStatsFilter !== 'all') {
                    const allBtn = document.querySelector('.filter-btn[data-filter="all"]');
                    if (allBtn) {
                        allBtn.click();
                    }
                }
                setTimeout(() => {
                    statsSearchInput.focus();
                    syncSearchState();
                }, 10);
            };
        }

        statsSearchInput.onblur = () => {
            // Small delay to let click handlers (like clear) execute first
            setTimeout(syncSearchState, 10);
        };

        if (statsSearchClear) {
            statsSearchClear.onclick = () => {
                statsSearchInput.value = '';
                const activeFilter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
                renderStatsList(activeFilter, '');

                if (window.innerWidth <= 850) {
                    // On mobile, collapse everything
                    const wrapper = document.getElementById('statsSearchWrapper');
                    const header = document.querySelector('#statsView .stats-card-header');
                    const sortBar = document.getElementById('statsSortBar');
                    wrapper?.classList.remove('expanded');
                    header?.classList.remove('search-active');
                    sortBar?.classList.remove('search-expanded');
                    if (statsSearchClear) statsSearchClear.style.display = 'none';
                } else {
                    statsSearchInput.focus();
                    syncSearchState();
                }
            };
        }
    }

    // Global Click Close
    document.addEventListener('click', (e) => {
        if (menuActive && !e.target.closest('.dropdown-menu') && !e.target.closest('#menuToggleBtn')) {
            toggleMenu();
        }
    });

    // Note Input with autosave
    let noteTimeout;
    document.getElementById('noteInput').oninput = (e) => {
        clearTimeout(noteTimeout);
        noteTimeout = setTimeout(() => {
            const q = AppState.rawQuestions[AppState.currentTest[AppState.currentIndex]];
            if (!AppState.stats[q.id]) AppState.stats[q.id] = { coeff: 1.5, correct: 0, wrong: 0 };
            AppState.stats[q.id].note = e.target.value.trim();
            saveStats();
            updateIndicators();
        }, 500);
    };

    let previewNoteTimeout;
    document.getElementById('previewNoteInput').oninput = (e) => {
        clearTimeout(previewNoteTimeout);
        previewNoteTimeout = setTimeout(() => {
            const qid = AppState.previewQuestionId;
            if (!qid) return;
            if (!AppState.stats[qid]) AppState.stats[qid] = { coeff: 1.5, correct: 0, wrong: 0 };
            AppState.stats[qid].note = e.target.value.trim();
            saveStats();
            updateIndicatorsPreview();
        }, 500);
    };
} // This closes the setupEventListeners function, assuming the content started within it.

// --- View Management ---
function switchView(view) {
    document.getElementById('homeView').style.display = view === 'home' ? 'block' : 'none';
    document.getElementById('testView').style.display = view === 'test' ? 'flex' : 'none';
    if (view === 'stats') {
        document.getElementById('statsView').style.display = 'block';
        // Restore scroll position after a short delay to ensure rendering
        setTimeout(() => {
            window.scrollTo({ top: AppState.lastStatsScrollPos, behavior: 'instant' });
        }, 50);
    } else {
        document.getElementById('statsView').style.display = 'none';
    }
    document.getElementById('statsPreviewView').style.display = view === 'statsPreview' ? 'flex' : 'none';
    if (view === 'statsPreview') {
        document.getElementById('statsPreviewView').style.flexDirection = 'column';
        document.getElementById('statsPreviewView').style.flex = '1';
    }

    document.getElementById('resultsView').style.display = view === 'results' ? 'flex' : 'none';

    document.getElementById('bottomNav').style.display = view === 'test' ? 'flex' : 'none';

    // Hide header entirely if not on home
    const header = document.querySelector('header');
    if (header) {
        header.style.display = view === 'home' ? 'flex' : 'none';
    }

    document.getElementById('menuToggleBtn').style.display = (view === 'home' || view === 'test') ? 'flex' : 'none';
    document.getElementById('headerBackBtn').style.display = (view === 'stats' || view === 'statsPreview') ? 'flex' : 'none';

    // In preview mode, the inline icons are visible, so we don't need them in the burger menu.
    // Also hide when in home to keep it clean, but mainly for test and statsPreview redundancy.
    const isTestOrPreview = view === 'test' || view === 'statsPreview';
    document.getElementById('testOnlyMenuItems').style.display = isTestOrPreview ? 'none' : (view === 'home' ? 'none' : 'block');

    if (view === 'home' || view === 'stats') {
        const qn = document.getElementById('quickNavContainer');
        if (qn) qn.classList.remove('visible');
        const qo = document.getElementById('quickNavOverlay');
        if (qo) qo.classList.remove('visible');
    }

    if (view === 'home') {
        document.getElementById('headerTitle').innerText = 'Exam App';
        updateHomeStats();
        checkActiveTest();
    }
}

function goBack() {
    const isPreview = document.getElementById('statsPreviewView').offsetParent !== null;
    if (isPreview) {
        if (AppState.currentPreviewSource === 'results') switchView('results');
        else switchView('stats');
    }
    else switchView('home');
}

function toggleMenu() {
    menuActive = !menuActive;
    const menu = document.getElementById('actionMenu');
    menu.classList.toggle('active', menuActive);
    if (menuActive) {
        updateLangUI();
    }
}

function updateLangUI() {
    document.querySelectorAll('.lang-btn').forEach(btn => {
        const isMatch = btn.dataset.lang === AppState.language;
        btn.classList.toggle('lang-active', isMatch);
    });
}

function startTest() {
    clearActiveTest();
    const count = parseInt(document.getElementById('questionCount').value);
    if (prepareTest(count)) {
        switchView('test');
        renderQuestion();
    } else {
        showToast(t('no_questions_available'));
    }
}

function checkActiveTest() {
    const activeData = JSON.parse(localStorage.getItem('focus_app_active_test') || 'null');
    const resumeBtn = document.getElementById('resumeBtn');
    const startBtn = document.getElementById('startBtn');
    const startBtnContainer = document.getElementById('startBtnContainer');

    if (activeData && activeData.currentTest && activeData.currentTest.length > 0) {
        if (resumeBtn) resumeBtn.style.display = 'block';
        if (startBtn) {
            startBtn.innerText = t('new_test');
            startBtn.setAttribute('data-i18n', 'new_test');
            // Remove full width and primary style to make it "secondary"
            startBtn.style.width = 'auto';
            startBtn.style.backgroundColor = 'var(--surface-hover)';
            startBtn.style.color = 'var(--text-primary)';
            startBtn.style.border = '1px solid var(--border-color)';
        }
        if (startBtnContainer) {
            startBtnContainer.style.flexDirection = 'row';
            startBtnContainer.style.gap = '0.75rem';
        }
    } else {
        if (resumeBtn) resumeBtn.style.display = 'none';
        if (startBtn) {
            startBtn.innerText = t('start_test');
            startBtn.setAttribute('data-i18n', 'start_test');
            startBtn.style.width = '100%';
            startBtn.style.backgroundColor = 'var(--primary-color)';
            startBtn.style.color = '#ffffff';
            startBtn.style.border = 'none';
        }
        if (startBtnContainer) {
            startBtnContainer.style.flexDirection = 'column';
        }
    }
}

function resumeActiveTest() {
    const activeData = JSON.parse(localStorage.getItem('focus_app_active_test') || 'null');
    if (!activeData) return;

    // Restore AppState
    AppState.currentTest = activeData.currentTest;
    AppState.currentIndex = activeData.currentIndex;
    AppState.userAnswers = activeData.userAnswers;
    AppState.isAnswerChecked = activeData.isAnswerChecked;
    AppState.shuffledOptionsMap = activeData.shuffledOptionsMap;
    AppState.testTracking = activeData.testTracking;

    // Ensure rawQuestions are loaded (already done in DOMContentLoaded)
    if (AppState.rawQuestions.length === 0) {
        const questions = [];
        AppState.sources.forEach(s => {
            if (s.active && s.questions) questions.push(...s.questions);
        });
        AppState.rawQuestions = questions;
    }

    switchView('test');
    renderQuestion();
}

function prevQuestion() {
    if (AppState.currentIndex > 0) {
        AppState.currentIndex--;
        saveActiveTest();
        renderQuestion();
    }
}

function nextQuestion() {
    if (AppState.currentIndex < AppState.currentTest.length - 1) {
        AppState.currentIndex++;
        saveActiveTest();
        renderQuestion();
    } else {
        showToast(t('test_completed'));
        finishTest();
    }
}

function toggleStar() {
    const isPreview = document.getElementById('statsPreviewView').offsetParent !== null;
    const q = isPreview ? AppState.previewQuestion
        : AppState.rawQuestions[AppState.currentTest[AppState.currentIndex]];
    if (!q) return;
    const qid = String(q.id);
    if (!AppState.stats[qid]) AppState.stats[qid] = { coeff: 1.5, correct: 0, wrong: 0 };
    AppState.stats[qid].starred = !AppState.stats[qid].starred;
    saveStats();
    if (isPreview) {
        updateIndicatorsPreview();
        const kw = document.getElementById('statsSearchInput')?.value || '';
        renderStatsList(document.querySelector('.filter-btn.active')?.dataset.filter || 'all', kw);
    }
    else updateIndicators();

    if (menuActive) toggleMenu();
}

function toggleFlag() {
    const isPreview = document.getElementById('statsPreviewView').offsetParent !== null;
    const q = isPreview ? AppState.previewQuestion
        : AppState.rawQuestions[AppState.currentTest[AppState.currentIndex]];
    if (!q) return;
    const qid = String(q.id);
    if (!AppState.stats[qid]) AppState.stats[qid] = { coeff: 1.5, correct: 0, wrong: 0 };
    AppState.stats[qid].flagged = !AppState.stats[qid].flagged;
    saveStats();
    if (isPreview) {
        updateIndicatorsPreview();
        const kw = document.getElementById('statsSearchInput')?.value || '';
        renderStatsList(document.querySelector('.filter-btn.active')?.dataset.filter || 'all', kw);
    }
    else updateIndicators();

    if (menuActive) toggleMenu();
}

function toggleNoteArea() {
    const isPreview = document.getElementById('statsPreviewView').offsetParent !== null;
    const a = document.getElementById(isPreview ? 'previewNoteArea' : 'noteArea');
    if (a) a.classList.toggle('visible');
    // Note: Auto-focus removed to prevent distracting blinking
    if (menuActive) toggleMenu();
}

function toggleAddSourcePanel() {
    const p = document.getElementById('addSourcePanel');
    const btn = document.getElementById('toggleAddSourceBtn');
    const isVisible = p.style.display !== 'none';
    p.style.display = isVisible ? 'none' : 'block';
    btn.style.transform = isVisible ? '' : 'rotate(45deg)';
    btn.style.transition = 'transform 0.2s';
}

function confirmExit() {
    if (confirm(t('confirm_exit'))) switchView('home');
    toggleMenu();
}

async function translateAll() {
    const isPreview = document.getElementById('statsPreviewView').offsetParent !== null;
    if (isPreview) {
        const previewView = document.getElementById('statsPreviewView');
        const btns = previewView.querySelectorAll('.corner-translate-btn');
        for (const btn of btns) {
            if (!btn.classList.contains('active')) btn.click();
        }
    } else {
        const testView = document.getElementById('testView');
        const btns = testView.querySelectorAll('.corner-translate-btn');
        for (const btn of btns) {
            if (!btn.classList.contains('active')) btn.click();
        }
    }
    if (menuActive) toggleMenu();
}

function copyAIPrompt() {
    const isPreview = document.getElementById('statsPreviewView').offsetParent !== null;
    let q;
    if (isPreview) {
        q = AppState.previewQuestion;
    } else {
        q = AppState.rawQuestions[AppState.currentTest[AppState.currentIndex]];
    }

    if (!q) {
        console.error("copyAIPrompt: No question found", { isPreview, previewId: AppState.previewQuestionId });
        return;
    }

    const optionsText = q.options?.map(o => o.text).join(', ') || 'Textantwort';
    const questionText = q.content?.text || q.text || '';

    let promptLang = AppState.translationTarget;
    if (!['tr', 'en', 'de'].includes(promptLang)) {
        promptLang = 'en';
    }

    const template = AppState.customAIPrompt || translations[promptLang]?.ai_prompt_template || translations['en'].ai_prompt_template;
    const prompt = template
        .replace('{question}', questionText)
        .replace('{options}', optionsText);

    // Always copy to clipboard as a fallback
    navigator.clipboard.writeText(prompt).then(() => {
        if (AppState.aiIntegration === 'clipboard') {
            showToast(t('copy_ai_success'));

            // Add copy-flash animation
            const btnId = isPreview ? 'previewMenuCopyAIInline' : 'menuCopyAIInline';
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.classList.add('copy-flash');
                setTimeout(() => btn.classList.remove('copy-flash'), 500);
            }
        }
    }).catch(err => console.error('Clipboard error:', err));

    // AI Integration Logic
    if (AppState.aiIntegration !== 'clipboard') {
        const aiUrls = {
            gemini: 'https://gemini.google.com/app?prompt=',
            chatgpt: 'https://chatgpt.com/?q=',
            perplexity: 'https://www.perplexity.ai/search?q=',
            copilot: 'https://copilot.microsoft.com/?q=',
            deepseek: 'https://chat.deepseek.com/?q='
        };
        const baseUrl = aiUrls[AppState.aiIntegration];
        if (baseUrl) {
            window.open(baseUrl + encodeURIComponent(prompt), '_blank');
            if (menuActive) toggleMenu();
        }
    }
}

function copyQuestionText() {
    const isPreview = document.getElementById('statsPreviewView').offsetParent !== null;
    let q;
    if (isPreview) {
        q = AppState.previewQuestion;
    } else {
        const qIndex = AppState.currentIndex;
        const qId = AppState.currentTest[qIndex];
        q = AppState.rawQuestions[qId];
    }

    const text = q?.content?.text || q?.text || '';
    if (!text) return;

    navigator.clipboard.writeText(text).then(() => {
        showToast(t('copy_success') || 'Soru metni kopyalandı.');
    });

    const btnId = isPreview ? 'previewMenuCopyTextInline' : 'menuCopyTextInline';
    const btn = document.getElementById(btnId);
    if (btn) {
        btn.classList.add('copy-flash');
        setTimeout(() => btn.classList.remove('copy-flash'), 500);
    }
}

function goHome() {
    switchView('home');
    updateHomeStats();
}

async function retakeSession() {
    const latestTest = AppState.recentTests[0];
    if (!latestTest) return;

    const { prepareRetake } = await import('./features/test/test-engine.js');
    const qIds = prepareRetake(latestTest);

    if (qIds) {
        switchView('test');
        renderQuestion();
    }
}

function updateTranslationUI() {
    if (AppState.translationEnabled) {
        document.body.classList.remove('translation-disabled');
    } else {
        document.body.classList.add('translation-disabled');
    }
}

// AI Prompt Editor Logic
function openPromptEditor() {
    const overlay = document.getElementById('promptEditorOverlay');
    const input = document.getElementById('customPromptInput');

    let promptLang = AppState.translationTarget || 'en';
    if (!['tr', 'en', 'de'].includes(promptLang)) promptLang = 'en';

    const defaultPrompt = translations[promptLang]?.ai_prompt_template || translations['en']?.ai_prompt_template;

    input.value = AppState.customAIPrompt || defaultPrompt;
    overlay.classList.add('active');
    if (menuActive) toggleMenu();
}

function closePromptEditor() {
    const overlay = document.getElementById('promptEditorOverlay');
    overlay.classList.remove('active');
}

function saveCustomPrompt() {
    const input = document.getElementById('customPromptInput');
    AppState.customAIPrompt = input.value.trim();
    saveCustomAIPrompt();
    showToast(t('save_success') || 'Kaydedildi');
    closePromptEditor();
}

function resetCustomPrompt() {
    if (confirm(t('confirm_reset') || 'Varsayılan prompta dönmek istediğinize emin misiniz?')) {
        let promptLang = AppState.translationTarget || 'en';
        if (!['tr', 'en', 'de'].includes(promptLang)) promptLang = 'en';
        const defaultPrompt = translations[promptLang]?.ai_prompt_template || translations['en']?.ai_prompt_template;

        document.getElementById('customPromptInput').value = defaultPrompt;
        AppState.customAIPrompt = '';
        saveCustomAIPrompt();
        showToast(t('reset_success') || 'Sıfırlandı');
    }
}

