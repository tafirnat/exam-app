import { AppState, saveStats, saveSources, saveCurrentSource } from './core/state.js';
import { initTheme, toggleTheme } from './core/theme.js';
import { updateStaticTranslations, t, targetLanguages, translations } from './core/i18n.js';
import { showToast } from './core/utils.js';
import { migrateOldData } from './core/migration.js';
import { processJSON, loadFromUrl, loadFromFile } from './features/sources/sources-service.js';
import { renderSourcesList } from './features/sources/sources-ui.js';
import { prepareTest } from './features/test/test-engine.js';
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

        console.log('Rendering stats list...');
        renderStatsList();

        console.log('Updating home stats...');
        updateHomeStats();

        console.log('Setting up event listeners...');
        setupEventListeners();

        console.log('App initialized v1.2.1-debug');
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
    switchView('statsPreview');
    document.getElementById('previewQuestionText').innerText = q.content.text;
    const container = document.getElementById('previewOptionsContainer');
    container.innerHTML = '';
    if (q.options && q.options.length > 0) {
        q.options.forEach(opt => {
            const card = document.createElement('div');
            const isCorrect = q.correctOptionIds && q.correctOptionIds.map(String).includes(String(opt.id));
            card.className = `option-card ${isCorrect ? 'correct' : ''}`;
            card.innerText = opt.text;
            container.appendChild(card);
        });
    } else {
        const correctAnswers = q.correctOptionIds || q.answer?.accepted_texts || [];
        if (correctAnswers.length > 0) {
            const card = document.createElement('div');
            card.className = 'option-card correct';
            card.innerText = `${t('correct')}: ${correctAnswers[0]}`;
            container.appendChild(card);
        }
    }
    const s = AppState.stats[q.id] || { correct: 0, wrong: 0, coeff: 1.0 };
    document.getElementById('previewStatsInfo').innerHTML = `Richtig: ${s.correct} | Falsch: ${s.wrong} | Gesamt: ${s.correct + s.wrong} | Koe: ${s.coeff.toFixed(1)}`;
};

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

    // Indicators Bar
    document.getElementById('indStar').onclick = toggleStar;
    document.getElementById('indFlag').onclick = toggleFlag;
    document.getElementById('indNote').onclick = toggleNoteArea;

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
    document.getElementById('previewBackBtn').onclick = () => switchView('stats');

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

    // Duplicate import buttons handlers
    const importBtn = document.getElementById('importBtn');
    const importFileInput = document.getElementById('importFileInput');
    if (importBtn && importFileInput) {
        importBtn.onclick = () => importFileInput.click();
        importFileInput.onchange = async (e) => {
            const source = await loadFromFile(e.target.files[0]);
            if (source) {
                e.target.value = '';
                renderSourcesList();
            }
        };
    }

    // Stats Filters
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderStatsList(btn.dataset.filter);
        };
    });

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
}

// --- View Management ---
function switchView(view) {
    document.getElementById('homeView').style.display = view === 'home' ? 'block' : 'none';
    document.getElementById('testView').style.display = view === 'test' ? 'flex' : 'none';
    document.getElementById('statsView').style.display = view === 'stats' ? 'block' : 'none';
    document.getElementById('statsPreviewView').style.display = view === 'statsPreview' ? 'block' : 'none';
    document.getElementById('bottomNav').style.display = view === 'test' ? 'flex' : 'none';

    document.getElementById('menuToggleBtn').style.display = (view === 'home' || view === 'test') ? 'flex' : 'none';
    document.getElementById('headerBackBtn').style.display = (view === 'stats' || view === 'statsPreview') ? 'flex' : 'none';
    document.getElementById('testOnlyMenuItems').style.display = view === 'test' ? 'block' : 'none';

    if (view === 'home') {
        document.getElementById('headerTitle').innerText = 'Focus App';
        updateHomeStats();
    }
}

function goBack() {
    if (document.getElementById('statsPreviewView').style.display === 'block') switchView('stats');
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
        switchView('home');
    }
}

function toggleStar() {
    const q = AppState.rawQuestions[AppState.currentTest[AppState.currentIndex]];
    if (!AppState.stats[q.id]) AppState.stats[q.id] = { coeff: 1.0, correct: 0, wrong: 0 };
    AppState.stats[q.id].starred = !AppState.stats[q.id].starred;
    saveStats();
    updateIndicators();
    toggleMenu();
}

function toggleFlag() {
    const q = AppState.rawQuestions[AppState.currentTest[AppState.currentIndex]];
    if (!AppState.stats[q.id]) AppState.stats[q.id] = { coeff: 1.0, correct: 0, wrong: 0 };
    AppState.stats[q.id].flagged = !AppState.stats[q.id].flagged;
    saveStats();
    updateIndicators();
    toggleMenu();
}

function toggleNoteArea() {
    const a = document.getElementById('noteArea');
    a.classList.toggle('visible');
    if (a.classList.contains('visible')) document.getElementById('noteInput').focus();
    toggleMenu();
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
    const btns = document.querySelectorAll('.corner-translate-btn');
    for (const btn of btns) {
        if (!btn.classList.contains('active')) btn.click();
    }
    toggleMenu();
}

function copyAIPrompt() {
    const q = AppState.rawQuestions[AppState.currentTest[AppState.currentIndex]];
    const optionsText = q.options?.map(o => o.text).join(', ') || 'Textantwort';

    // Determine prompt language based on translation target
    // Default to 'en' if the target language is not one of the main 3 for which we have templates
    let promptLang = AppState.translationTarget;
    if (!['tr', 'en', 'de'].includes(promptLang)) {
        promptLang = 'en';
    }

    const template = translations[promptLang]?.ai_prompt_template || translations['en'].ai_prompt_template;
    const prompt = template
        .replace('{question}', q.content.text)
        .replace('{options}', optionsText);

    navigator.clipboard.writeText(prompt).then(() => {
        showToast(t('copy_ai_success'));
        toggleMenu();
    });
}
