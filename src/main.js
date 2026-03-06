import { AppState, saveStats, saveSources, saveCurrentSource } from './core/state.js';
import { initTheme, toggleTheme } from './core/theme.js';
import { updateStaticTranslations, t, targetLanguages, translations } from './core/i18n.js';
import { showToast, getCorrectAnswers } from './core/utils.js';
import { migrateOldData } from './core/migration.js';
import { processJSON, loadFromUrl, loadFromFile, normalizeQuestions } from './features/sources/sources-service.js';
import { renderSourcesList } from './features/sources/sources-ui.js';
import { prepareTest, finishTest } from './features/test/test-engine.js';
import { renderQuestion, handleCheckAnswer, updateIndicators, handleTranslation } from './features/test/test-ui.js';
import { renderStatsList, updateHomeStats } from './features/stats/stats-module.js';

let menuActive = false;

// --- Initialize ---
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded start');
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

        console.log('Rendering stats list...');
        renderStatsList();

        console.log('Updating home stats...');
        updateHomeStats();

        console.log('Setting up event listeners...');
        setupEventListeners();

        console.log('App initialized v1.2.3');

        // One-time auto-load logic for new users
        const isInitialized = localStorage.getItem('focus_app_initialized');
        if (!isInitialized) {
            console.log('New user detected, performing initial setup...');
            if (AppState.sources.length === 0) {
                loadFromUrl('./examples/standard-exam.json').then(source => {
                    if (source) renderSourcesList();
                });
            }
            localStorage.setItem('focus_app_initialized', 'true');
        } else if (AppState.rawQuestions.length === 0) {
            // Respect existing sources if questions aren't loaded
            const sourceToLoad = AppState.sources.find(s => s.active) || AppState.sources[0];
            if (sourceToLoad && sourceToLoad.url) {
                loadFromUrl(sourceToLoad.url);
            }
        }
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

window.onPreviewQuestion = (q) => {
    AppState.previewQuestion = q;
    AppState.previewQuestionId = q.id;
    switchView('statsPreview');
    document.getElementById('previewQuestionText').innerText = q.content?.text || q.text || '';
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

    if (q.options && q.options.length > 0 && !isTextQuestion) {
        q.options.forEach(opt => {
            const card = document.createElement('div');
            const isCorrect = getCorrectAnswers(q).map(String).includes(String(opt.id));
            card.className = `option-card ${isCorrect ? 'correct' : ''}`;

            const contentWrapper = document.createElement('div');
            contentWrapper.className = 'option-content-wrapper';
            contentWrapper.style.flex = '1';
            contentWrapper.style.display = 'flex';
            contentWrapper.style.flexDirection = 'column';

            const content = document.createElement('div');
            content.className = 'option-content';
            content.id = `previewOptText_${opt.id}`;
            content.innerText = opt.text;

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

        if (answerToShow) {
            if (isTextQuestion) {
                // Render as text input wrapper matching test UI
                const wrapper = document.createElement('div');
                wrapper.className = 'text-input-wrapper';
                wrapper.style.width = '100%';

                wrapper.innerHTML = `
                    <input type="text" id="previewTextAnswerInput" value="${answerToShow}" class="correct" disabled>
                    <div class="feedback-container" style="margin-top: 0.75rem; display: flex; align-items: start; gap: 0.5rem;">
                        <div style="flex: 1;">
                            <div id="previewCorrectAnswerText" class="correct-answer-feedback" style="color: var(--success-color); font-weight: 600; font-size: 0.9rem;">
                                ${t('correct_answer_was')} ${answerToShow}
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
    const s = AppState.stats[q.id] || { correct: 0, wrong: 0, coeff: 1.0, note: '' };
    document.getElementById('previewStatsInfo').innerHTML = `Richtig: ${s.correct} | Falsch: ${s.wrong} | Gesamt: ${s.correct + s.wrong} | Koe: ${s.coeff.toFixed(1)}`;
    document.getElementById('previewNoteInput').value = s.note || '';
    const previewNoteArea = document.getElementById('previewNoteArea');
    if (previewNoteArea) previewNoteArea.classList.remove('visible');
    updateIndicatorsPreview();
};

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

    document.getElementById('indStar').onclick = toggleStar;
    document.getElementById('indFlag').onclick = toggleFlag;
    document.getElementById('indNote').onclick = toggleNoteArea;
    document.getElementById('menuTranslateAllInline').onclick = translateAll;
    document.getElementById('menuCopyAIInline').onclick = copyAIPrompt;

    document.getElementById('previewIndStar').onclick = toggleStar;
    document.getElementById('previewIndFlag').onclick = toggleFlag;
    document.getElementById('previewIndNote').onclick = toggleNoteArea;
    document.getElementById('previewMenuTranslateAllInline').onclick = translateAll;
    document.getElementById('previewMenuCopyAIInline').onclick = copyAIPrompt;
    document.getElementById('menuExitInline').onclick = confirmExit;

    window.addEventListener('test-finished', () => {
        switchView('home');
        updateHomeStats();
    });

    // Navigation
    document.getElementById('headerBackBtn').onclick = goBack;
    document.getElementById('startBtn').onclick = startTest;
    document.getElementById('prevBtn').onclick = prevQuestion;
    document.getElementById('nextBtn').onclick = nextQuestion;
    document.getElementById('checkBtn').onclick = handleCheckAnswer;
    document.getElementById('homeStatsBtn').onclick = () => {
        switchView('stats');
        renderStatsList();
    };
    document.getElementById('previewBackBtn').onclick = () => {
        switchView('stats');
        renderStatsList(document.querySelector('.filter-btn.active')?.dataset.filter || 'all');
    };

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

    // Stats Filters & Search
    const getStatsSearchKeyword = () => document.getElementById('statsSearchInput')?.value || '';

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderStatsList(btn.dataset.filter, getStatsSearchKeyword());
        };
    });

    const statsSearchInput = document.getElementById('statsSearchInput');
    if (statsSearchInput) {
        statsSearchInput.onkeyup = () => {
            const activeFilter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
            renderStatsList(activeFilter, statsSearchInput.value);
        };
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
            if (!AppState.stats[q.id]) AppState.stats[q.id] = { coeff: 1.0, correct: 0, wrong: 0 };
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
            if (!AppState.stats[qid]) AppState.stats[qid] = { coeff: 1.0, correct: 0, wrong: 0 };
            AppState.stats[qid].note = e.target.value.trim();
            saveStats();
            updateIndicatorsPreview();
        }, 500);
    };
}

// --- View Management ---
function switchView(view) {
    document.getElementById('homeView').style.display = view === 'home' ? 'block' : 'none';
    document.getElementById('testView').style.display = view === 'test' ? 'flex' : 'none';
    document.getElementById('statsView').style.display = view === 'stats' ? 'block' : 'none';
    document.getElementById('statsPreviewView').style.display = view === 'statsPreview' ? 'flex' : 'none';
    if (view === 'statsPreview') {
        document.getElementById('statsPreviewView').style.flexDirection = 'column';
        document.getElementById('statsPreviewView').style.flex = '1';
    }
    document.getElementById('bottomNav').style.display = view === 'test' ? 'flex' : 'none';

    document.getElementById('menuToggleBtn').style.display = (view === 'home' || view === 'test') ? 'flex' : 'none';
    document.getElementById('headerBackBtn').style.display = (view === 'stats' || view === 'statsPreview') ? 'flex' : 'none';

    // In preview mode, the inline icons are visible, so we don't need them in the burger menu.
    // Also hide when in home to keep it clean, but mainly for test and statsPreview redundancy.
    const isTestOrPreview = view === 'test' || view === 'statsPreview';
    document.getElementById('testOnlyMenuItems').style.display = isTestOrPreview ? 'none' : (view === 'home' ? 'none' : 'block');

    if (view === 'home' || view === 'stats') {
        finishTest();
    }

    if (view === 'home') {
        document.getElementById('headerTitle').innerText = 'Exam App [v2.3:01:52]';
        updateHomeStats();
    }
}

function goBack() {
    const isPreview = document.getElementById('statsPreviewView').offsetParent !== null;
    if (isPreview) switchView('stats');
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
    const count = parseInt(document.getElementById('questionCount').value);
    if (prepareTest(count)) {
        switchView('test');
        renderQuestion();
    } else {
        showToast(t('no_questions_available'));
    }
}

function prevQuestion() {
    if (AppState.currentIndex > 0) {
        AppState.currentIndex--;
        renderQuestion();
    }
}

function nextQuestion() {
    if (AppState.currentIndex < AppState.currentTest.length - 1) {
        AppState.currentIndex++;
        renderQuestion();
    } else {
        showToast(t('test_completed'));
        finishTest();
        switchView('home');
    }
}

function toggleStar() {
    const isPreview = document.getElementById('statsPreviewView').offsetParent !== null;
    const q = isPreview ? AppState.previewQuestion
        : AppState.rawQuestions[AppState.currentTest[AppState.currentIndex]];
    if (!q) return;
    const qid = String(q.id);
    if (!AppState.stats[qid]) AppState.stats[qid] = { coeff: 1.0, correct: 0, wrong: 0 };
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
    if (!AppState.stats[qid]) AppState.stats[qid] = { coeff: 1.0, correct: 0, wrong: 0 };
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

    // Determine prompt language based on translation target
    let promptLang = AppState.translationTarget;
    if (!['tr', 'en', 'de'].includes(promptLang)) {
        promptLang = 'en';
    }

    const template = translations[promptLang]?.ai_prompt_template || translations['en'].ai_prompt_template;
    const prompt = template
        .replace('{question}', questionText)
        .replace('{options}', optionsText);

    navigator.clipboard.writeText(prompt).then(() => {
        showToast(t('copy_ai_success'));

        // Add copy-flash animation
        const btnId = isPreview ? 'previewMenuCopyAIInline' : 'menuCopyAIInline';
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.classList.add('copy-flash');
            setTimeout(() => btn.classList.remove('copy-flash'), 500);
        }

        if (menuActive) toggleMenu();
    });
}
