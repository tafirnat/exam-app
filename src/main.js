import { AppState, initState, saveStats, saveSources, saveCurrentSource, saveCustomAIPrompt, saveAiProviders, DEFAULT_AI_PROVIDERS, saveActiveTest, clearActiveTest, clearLocalStudyData, clearProgressData, clearSourcesData, SAMPLE_LOADED_KEY, findMatchingPresetId } from './core/state.js';
import { initTheme, toggleTheme } from './core/theme.js';
import { updateStaticTranslations, t, targetLanguages, translations } from './core/i18n.js';
import { showToast, showConfirm, getCorrectAnswers, highlightText, escapeHTML } from './core/utils.js';
import { migrateOldData, migrateFolderColors, sanitizeStudyActivity } from './core/migration.js';
import { getQuestionCategory } from './core/question-rules.js';
import { persist } from './core/storage.js';
import * as store from './core/store.js';
import { emit, Slice } from './core/store.js';
import { registerUIBindings, paintAll, notifyViewChanged } from './core/ui-bindings.js';

/* Exposed like the other debugging handles this file already hangs on window.
   Without it there is no way to inspect the live store from DevTools or a CDP
   session: a dynamic import() gets Vite's version-stamped copy of the module,
   which is a different instance with an empty subscriber table. */
window.appStore = store;
import { processJSON, loadFromUrl, loadFromFile, normalizeQuestions, mergeSources } from './features/sources/sources-service.js';
import { renderSourcesList, showMergeModal, closeAllSourcesModals, showSourceOptionsModal, renderHomeActiveSources } from './features/sources/sources-ui.js';
import { renderContinuityBlock, renderGlobalCharts, showDailyMotivationToast } from './features/stats/continuity-ui.js';
import { initArchiveUI } from './features/sources/archive.js';
import { prepareTest, finishTest, prepareRetake, buildQuestionPool } from './features/test/test-engine.js';
import { flushInProgressAnswers } from './features/stats/continuity-engine.js';
import { renderQuestion, handleCheckAnswer, updateIndicators, handleTranslation, handleDifficultyRating, handleFlashcardRating, renderTestResults, handleTtsToggle, getIsAudioPlaying, stopAudio, decorateReadingSections } from './features/test/test-ui.js';
import { renderStatsList, updateHomeStats, setupStatsEventListeners } from './features/stats/stats-module.js';
import { openQuestionEditor, closeQuestionEditor } from './features/stats/question-editor.js';
import { initTimer, stopTimer } from './features/test/timer-module.js';
import { initSync, syncToGist } from './core/github-sync.js';
import { renderMarkdown, renderInlineMarkdown, plainText, applySearchHighlight } from './core/markdown.js';
import { setupQuickPresets, updateQuickSourcesDot } from './features/sources/quick-presets-ui.js';
import { syncQuickPresetsWithLiveSources } from './features/sources/quick-presets.js';
import { startOnboarding, stopOnboarding } from './features/onboarding/onboarding.js';
import {
    registerServiceWorker,
    scheduleNotifications,
    saveNotificationSettings,
    getNotificationStatus,
    disableNotifications,
    sendTestNotification,
    shouldShowOptIn,
    showOptInModal
} from './core/notification-manager.js';

// Expose functions globally for dynamic/inline invocation and window compatibility
window.showSourceOptionsModal = showSourceOptionsModal;
window.renderHomeActiveSources = renderHomeActiveSources;




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

window.startTestFromFilteredQuestions = async (questions, searchOrFilterName) => {
    if (!questions || questions.length === 0) return;

    const { prepareFromCompositeIds, buildQuestionPool } = await import('./features/test/test-engine.js');
    buildQuestionPool({ scope: 'all' });

    const compositeIds = questions.map(q => `${q.sourceId}_${q.id}`);
    let title = '';
    if (typeof searchOrFilterName === 'string' && searchOrFilterName.trim() !== '') {
        const raw = searchOrFilterName.trim();
        if (raw.startsWith('#')) {
            title = `"${raw}" (${questions.length} Soru)`;
        } else if (['all', 'starred', 'flagged', 'noted'].includes(raw)) {
            const filterTitles = {
                all: t('filter_all'),
                starred: t('filter_starred'),
                flagged: t('filter_flagged'),
                noted: t('filter_noted')
            };
            title = `${filterTitles[raw] || raw} (${questions.length} Soru)`;
        } else {
            title = `"${raw}" (${questions.length} Soru)`;
        }
    } else {
        title = `Arama Sonuçları (${questions.length} Soru)`;
    }

    if (prepareFromCompositeIds(compositeIds, { shuffle: true, sourceTitle: title, mode: 'custom_filter' })) {
        switchView('test');
        renderQuestion();
        showDailyMotivationToast();
        showToast(t('test_started_filtered', { count: questions.length }));
    } else {
        showToast(t('no_questions_available'));
    }
};

// --- Global access for module cross-communication ---
window.renderStatsList = renderStatsList;
window.updateHomeStats = updateHomeStats;
window.switchView = switchView; // Ensure it's available for modules
window.goHome = goHome;
window.copyAIPrompt = copyAIPrompt;
window.executeAiSearch = executeAiSearch;
window.copyQuestionText = copyQuestionText;
window.checkActiveTest = checkActiveTest;
window.renderQuestion = renderQuestion;
/* The hand-rolled predecessor of the store: 14 call sites reached this through
   `window` to fan one change out to five renderers. The fan-out is now the
   store's job, so this only announces the change. checkActiveTest() stays
   because it is control flow, not rendering - it can resume or discard a test
   session, which is not something a redraw should ever do on its own. */
window.onSourcesUpdated = () => {
    emit(Slice.SOURCES);
    checkActiveTest();
};


// --- Initialize ---
let isAppInitialized = false;

const initApp = () => {
    if (isAppInitialized) return;
    isAppInitialized = true;
    console.log('initApp start');

    /* First, and before anything reads AppState: loading the user's data is an
       explicit step now, not something that happened while the import graph was
       being evaluated. Everything below - migrations, sync, the first paint -
       assumes it has already run. */
    initState();

    // Backwards compatibility helper to make contenteditable divs act like textareas
    const setupDivInput = (id) => {
        const el = document.getElementById(id);
        if (el) {
            Object.defineProperty(el, 'value', {
                get: function() { 
                    return el.contentEditable === "true" ? el.textContent : el.innerHTML; 
                },
                set: function(val) { 
                    if (el.contentEditable === "true") {
                        el.textContent = val || ''; 
                    } else {
                        el.innerHTML = val || ''; 
                    }
                },
                configurable: true
            });
            Object.defineProperty(el, 'placeholder', {
                get: function() { return el.getAttribute('placeholder') || ''; },
                set: function(val) { el.setAttribute('placeholder', val || ''); },
                configurable: true
            });
        }
    };
    setupDivInput('noteInput');
    setupDivInput('previewNoteInput');

    // Setup edit button click handlers for note input contenteditable toggle
    const setupEditBtn = (btnId, inputId) => {
        const btn = document.getElementById(btnId);
        const input = document.getElementById(inputId);
        if (btn && input) {
            btn.onclick = () => {
                const isEditable = input.contentEditable === "true";
                const transBtn = document.getElementById(inputId === 'noteInput' ? 'noteTranslateBtn' : 'previewNoteTranslateBtn');
                const transText = document.getElementById(inputId === 'noteInput' ? 'trans_noteInput' : 'trans_previewNoteInput');
                
                if (isEditable) {
                    input.contentEditable = "false";
                    btn.classList.remove('active');
                    
                    // Render edited text containing HTML tags back to HTML elements
                    input.innerHTML = input.textContent;

                    // Show translate button if there is content
                    const hasContent = input.innerText.trim() !== '' || input.innerHTML.trim() !== '';
                    if (transBtn) transBtn.style.display = hasContent ? 'flex' : 'none';
                } else {
                    // Show raw HTML source code in the editor for editing
                    input.textContent = input.innerHTML;
                    
                    input.contentEditable = "true";
                    btn.classList.add('active');
                    input.focus();
                    
                    // Hide translate button & clear current translation
                    if (transBtn) transBtn.style.display = 'none';
                    if (transText) {
                        transText.innerText = '';
                        transText.style.display = 'none';
                    }
                }
            };
        }
    };
    setupEditBtn('noteEditBtn', 'noteInput');
    setupEditBtn('previewNoteEditBtn', 'previewNoteInput');

    // Setup translate button click handlers
    const setupTranslateBtn = (btnId, inputId, targetId) => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.onclick = () => {
                handleTranslation(btn, inputId, targetId);
            };
        }
    };
    setupTranslateBtn('noteTranslateBtn', 'noteInput', 'trans_noteInput');
    setupTranslateBtn('previewNoteTranslateBtn', 'previewNoteInput', 'trans_previewNoteInput');

    // Auto-hiding scroll listener for bottom navigation bar
    let lastScrollY = window.scrollY || document.documentElement.scrollTop;
    let isTicking = false;

    window.addEventListener('scroll', () => {
        if (!isTicking) {
            window.requestAnimationFrame(() => {
                const bottomNav = document.getElementById('bottomNav');
                const testView = document.getElementById('testView');
                
                if (!bottomNav || !testView || testView.style.display === 'none') {
                    lastScrollY = window.scrollY || document.documentElement.scrollTop;
                    isTicking = false;
                    return;
                }

                const currentScrollY = window.scrollY || document.documentElement.scrollTop;
                const windowHeight = window.innerHeight;
                const bodyHeight = document.documentElement.scrollHeight;

                const isNearBottom = (windowHeight + currentScrollY) >= (bodyHeight - 60);

                if (isNearBottom || currentScrollY <= 40) {
                    bottomNav.classList.remove('nav-hidden');
                } else if (currentScrollY > lastScrollY && (currentScrollY - lastScrollY > 6)) {
                    bottomNav.classList.add('nav-hidden');
                } else if (currentScrollY < lastScrollY && (lastScrollY - currentScrollY > 6)) {
                    bottomNav.classList.remove('nav-hidden');
                }

                lastScrollY = currentScrollY;
                isTicking = false;
            });
            isTicking = true;
        }
    }, { passive: true });

    checkActiveTest();

    try {
        // Registered before anything that mutates state, so no early emit -
        // a migration repair, or the first Gist pull - is announced to an
        // empty subscriber table and lost.
        console.log('Registering UI bindings...');
        registerUIBindings();

        console.log('Migrating old data...');
        migrateOldData();
        migrateFolderColors();

        // Runs before anything reads studyActivity: the additive Gist merge left
        // inflated daily counters behind, and every streak, ring and chart on the
        // home screen is derived from them.
        const repairedDays = sanitizeStudyActivity();
        if (repairedDays > 0) {
            console.log(`Repaired ${repairedDays} inflated study activity records.`);
        }

        console.log('Initializing theme...');
        initTheme();

        console.log('Updating static translations...');
        updateStaticTranslations();

        console.log('Rendering sources list...');
        renderSourcesList();
        initArchiveUI();

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
            
            // Failsafe: Ensure s.coeff is a number (legacy compatibility)
            if (isNaN(s.coeff)) {
                s.coeff = 1.5;
                changed = true;
            }

            if (s.correct === 0 && s.wrong === 0 && s.coeff === 1.0) {
                s.coeff = 1.5;
                changed = true;
            }
            if (s.streak === undefined || isNaN(s.streak)) {
                s.streak = 0;
                changed = true;
            }
            if (s.learned === undefined) {
                s.learned = false;
                changed = true;
            }
            if (s.stability === undefined || isNaN(s.stability) || s.stability === null) {
                s.stability = 0;
                changed = true;
            }
            if (s.difficulty === undefined || isNaN(s.difficulty) || s.difficulty === 0 || s.difficulty === null) {
                // Migrate from legacy coeff if it exists, otherwise default to 5.0 (Center of 1-10)
                if (s.coeff !== undefined && !isNaN(s.coeff)) {
                    s.difficulty = Math.min(Math.max((s.coeff - 0.1) * (9 / 2.9) + 1, 1), 10);
                } else {
                    s.difficulty = 5.0;
                }
                changed = true;
            }
            if (s.lastReview === undefined) {
                s.lastReview = Date.now();
                changed = true;
            }

            if (changed) migrationCount++;
        });

        if (migrationCount > 0) {
            console.log(`Migrated ${migrationCount} stats records with new FSRS metrics.`);
            saveStats();
        }

        console.log('Initializing timer...');
        initTimer();

        console.log('Initializing sync...');
        initSync();

        // Register Service Worker and schedule notifications
        registerServiceWorker().then(() => {
            scheduleNotifications();
        });

        // Handle ?action= URL params from notification deep-links
        const urlParams = new URLSearchParams(window.location.search);
        const urlAction = urlParams.get('action');
        if (urlAction === 'streak') {
            setTimeout(() => switchView('home'), 300);
        } else if (urlAction === 'focus') {
            setTimeout(() => switchView('home'), 300);
        }

        // Listen for test-finished event to trigger opt-in prompt
        window.addEventListener('test-finished', (e) => {
            const detail = e.detail || {};
            const isGoodScore = (detail.successRate || 0) >= 60 || (detail.questionCount || 0) >= 5;
            if (isGoodScore && shouldShowOptIn()) {
                setTimeout(() => {
                    showOptInModal({ offerFocus: true });
                }, 1500);
            }
        });

        // Flush mid-session progress when the user hides the tab or closes the browser.
        // This ensures questions answered so far always count toward the daily streak
        // even if the user never taps "Testi Bitir".
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && AppState.testTracking?.results?.length > 0) {
                flushInProgressAnswers();
            }
        });
        window.addEventListener('pagehide', () => {
            if (AppState.testTracking?.results?.length > 0) {
                flushInProgressAnswers();
            }
        });

        // The initial view is set up by index.html, not by switchView(), so the
        // store would otherwise never learn which view is up and the gate would
        // have nothing to compare against.
        notifyViewChanged(history.state?.view || 'home');

        // First paint. From here on every save* emits and the store decides
        // what redraws - no mutation site needs to name a renderer.
        console.log('Painting initial UI...');
        paintAll();

        console.log('Setting up event listeners...');
        setupEventListeners();
        initMenuAccordion();

        console.log('Updating translation UI...');
        updateTranslationUI();

        console.log('Setting up Quick Presets...');
        setupQuickPresets();
        syncQuickPresetsWithLiveSources();


        console.log('App initialized v1.2.3');

        // A new library — or one just reset to factory state — gets the sample
        // source in the reader's own language. The flag is cleared by
        // clearLocalStudyData(), so a reset brings it back rather than leaving
        // someone staring at an empty app.
        if (!localStorage.getItem(SAMPLE_LOADED_KEY)) {
            const lang = ['tr', 'en', 'de'].includes(AppState.language) ? AppState.language : 'en';
            loadFromUrl(`./examples/sample-${lang}.json`, { active: true, silent: true }).then(source => {
                if (source) {
                    source.folderId = 'uncategorized-folder';
                    import('./core/state.js').then(m => m.saveSources());
                    renderSourcesList();
                }
            });
            persist(SAMPLE_LOADED_KEY, lang);
        }

        // Fix: If we have active sources but no questions loaded (e.g. after refresh), load them
        if (AppState.rawQuestions.length === 0) {
            const activeSources = AppState.sources.filter(s => s.active && !s.archived);
            activeSources.forEach(s => {
                if (!s.questions || s.questions.length === 0) {
                    if (s.origin?.type === 'url' && s.origin.display) {
                        loadFromUrl(s.origin.display);
                    }
                }
            });

            buildQuestionPool();
        }
        checkActiveTest();

        // Start onboarding tour if user hasn't seen it yet
        setTimeout(() => {
            startOnboarding(false);
        }, 600);

        // --- History API popstate listener ---
        window.onpopstate = (e) => {
            // Priority: Close any open modal first
            const modalClosed = closeAllModals();

            const state = e.state || {};
            const targetView = state.view || 'home';
            const searchQuery = state.searchQuery || '';
            const filter = state.filter || 'all';

            // Switch view without pushing new history state
            switchView(targetView, true);

            if (targetView === 'stats') {
                const searchInput = document.getElementById('statsSearchInput');
                if (searchInput) {
                    searchInput.value = searchQuery;
                }
                if (typeof window.syncStatsSearchUI === 'function') {
                    window.syncStatsSearchUI(!!searchQuery);
                }
                if (AppState.activeTagFilter && !filter.startsWith('tag:')) {
                    AppState.activeTagFilter = null;
                }
                renderStatsList(filter, searchQuery);
            }
        };

        // Initialize first state
        if (!history.state) {
            let hash = window.location.hash.replace('#', '');
            let initialView = 'home';
            let initialQuery = '';
            if (hash.includes('?')) {
                const parts = hash.split('?');
                initialView = parts[0];
                try {
                    const params = new URLSearchParams(parts[1]);
                    initialQuery = params.get('q') || '';
                } catch (err) { }
            } else {
                initialView = hash;
            }

            const validViews = ['home', 'test', 'stats', 'sources', 'statsPreview', 'results'];
            const startView = validViews.includes(initialView) ? initialView : 'home';
            const hashUrl = initialQuery ? `#${startView}?q=${encodeURIComponent(initialQuery)}` : `#${startView}`;
            
            history.replaceState({ view: startView, searchQuery: initialQuery, filter: 'all' }, '', hashUrl);
            
            if (startView !== 'home' || initialQuery) {
                switchView(startView, true);
                if (startView === 'stats' && initialQuery) {
                    const searchInput = document.getElementById('statsSearchInput');
                    if (searchInput) searchInput.value = initialQuery;
                    if (typeof window.syncStatsSearchUI === 'function') {
                        window.syncStatsSearchUI(true);
                    }
                    renderStatsList('all', initialQuery);
                }
            }
        }
    } catch (err) {
        console.error('CRITICAL INITIALIZATION ERROR:', err);
        // Fallback to setup at least basic listeners if possible
        try { setupEventListeners(); } catch (e) { }
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

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
    // Update the header title
    const titleEl = document.querySelector('#previewIndicatorsBar .preview-title');
    if (titleEl) {
        const titleKey = 'view_statsPreview';
        titleEl.setAttribute('data-i18n', titleKey);
        titleEl.innerText = t(titleKey);
    }

    const kw = AppState.searchKeyword || '';
    const qTextEl = document.getElementById('previewQuestionText');
    const rawQText = q.content?.text || q.text || '';
    qTextEl.innerHTML = applySearchHighlight(renderMarkdown(rawQText), kw);

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
    
    // Handle TTS in Preview
    const isPlaying = getIsAudioPlaying();
    card.querySelectorAll('.tts-btn').forEach(c => c.remove());
    if (AppState.ttsEnabled) {
        const tBtn = document.createElement('button');
        tBtn.className = 'tts-btn';
        if (isPlaying) tBtn.classList.add('playing');
        tBtn.innerHTML = isPlaying ? 
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>' : 
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
        
        tBtn.onclick = () => {
            const questionText = q.content?.text || q.text || '';
            handleTtsToggle(questionText, () => {
                // Refresh preview UI
                renderQuestionPreview(q, stats, AppState.currentPreviewSource);
            });
        };
        card.appendChild(tBtn);
    }

    // Same per-heading controls as the test view, refreshed through this render.
    if (getQuestionCategory(q.type) === 'reading') {
        decorateReadingSections(qTextEl, {
            scope: 'preview',
            cacheKey: `${q.sourceId}_${q.id}`,
            onRefresh: () => renderQuestionPreview(q, stats, AppState.currentPreviewSource)
        });
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

    const isTextQuestion = ['text', 'cloze'].includes(getQuestionCategory(q.type));
    const hasUserAnswer = q.userAnswer !== undefined && q.userAnswer !== null;

    if (q.type === 'flashcard') {
        const rawBack = q.answer?.back || '';
        const backContentHtml = renderMarkdown(rawBack);

        container.innerHTML = `
            <div class="flashcard-face flashcard-back" style="width: 100%;">
                <span class="flashcard-label">${t('flashcard_back')}</span>
                <div class="flashcard-text" id="previewFlashcardBackText">${backContentHtml}</div>
                <div class="translation-text" id="trans_previewFlashcardBackText" style="display:none;"></div>
            </div>
        `;

        const backFace = container.querySelector('.flashcard-back');
        const transBtn = document.createElement('button');
        transBtn.className = 'corner-translate-btn';
        transBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 8l6 6"></path><path d="M4 14l6-6 2-3"></path><path d="M2 5h12"></path><path d="M7 2h1"></path><path d="M22 22l-5-10-5 10"></path><path d="M14 18h6"></path></svg>';
        transBtn.onclick = () => handleTranslation(transBtn, 'previewFlashcardBackText', 'trans_previewFlashcardBackText');
        backFace.appendChild(transBtn);
    } else if (q.options && q.options.length > 0 && !isTextQuestion) {
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
            content.innerHTML = applySearchHighlight(renderInlineMarkdown(opt.text || ''), kw);

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
        const userVal = hasUserAnswer ? (Array.isArray(q.userAnswer) ? q.userAnswer[0] : q.userAnswer) : t('no_answer');

        if (answerToShow || userVal) {
            if (isTextQuestion) {
                // Render as text input wrapper matching test UI
                const wrapper = document.createElement('div');
                wrapper.className = 'text-input-wrapper';
                wrapper.style.width = '100%';

                const isCorrect = q.isCorrect;

                wrapper.innerHTML = `
                    <div style="margin-bottom: 0.5rem; font-size: 0.8rem; color: var(--text-secondary);">${t('your_answer')}:</div>
                    <input type="text" id="previewUserTextAnswer" value="${userVal}" class="${hasUserAnswer ? (isCorrect ? 'correct' : 'wrong') : ''}" disabled style="margin-bottom: 1rem;">
                    
                    <div style="margin-bottom: 0.5rem; font-size: 0.8rem; color: var(--text-secondary);">${t('correct_answer')}:</div>
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
    const statKey = `${q.sourceId}_${q.id}`;
    const baseDiff = (q.difficulty || 2.5) * 2;
    const s = stats || AppState.stats[statKey] || { correct: 0, wrong: 0, difficulty: baseDiff, note: '' };
    const total = s.correct + s.wrong;
    const percent = total > 0 ? Math.round((s.correct / total) * 100) : 0;
    document.getElementById('previewStatsInfo').innerHTML = `
        <div class="question-stats-left">
            <div class="stats-row">
                <span>${t('correct')}: <b>${s.correct}</b></span>
                <span>${t('wrong')}: <b>${s.wrong}</b></span>
            </div>
            <div class="stats-row">
                <span>${t('success_percent', { percent })}</span>
                <span>${t('difficulty_label')} <b>${(s.difficulty / 2).toFixed(1)}</b></span>
            </div>
        </div>
    `;
    const previewInputEl = document.getElementById('previewNoteInput');
    const previewNoteArea = document.getElementById('previewNoteArea');
    const previewLabelEl = document.getElementById('previewNoteLabel');
    const previewEditBtn = document.getElementById('previewNoteEditBtn');
    const previewTransBtn = document.getElementById('previewNoteTranslateBtn');
    const previewTransText = document.getElementById('trans_previewNoteInput');

    if (previewTransText) {
        previewTransText.innerText = '';
        previewTransText.style.display = 'none';
    }

    if (previewInputEl && previewNoteArea) {
        const hasExplanation = q.answer && q.answer.explanation && q.answer.explanation.trim() !== '';
        const userNote = s.note;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = userNote || '';
        const userHasNote = userNote && tempDiv.textContent.trim() !== '';

        // Reset editable state on load, default to read-only
        previewInputEl.contentEditable = "false";
        if (previewEditBtn) {
            previewEditBtn.classList.remove('active');
            previewEditBtn.style.display = 'flex';
        }

        const hasContent = userHasNote || hasExplanation;
        if (previewTransBtn) {
            previewTransBtn.style.display = hasContent ? 'flex' : 'none';
        }

        if (userHasNote) {
            previewInputEl.value = userNote;
            if (previewLabelEl) {
                previewLabelEl.setAttribute('data-i18n', 'note_label');
                previewLabelEl.innerText = t('note_label') || 'Your Note:';
            }
            previewNoteArea.classList.remove('visible');
        } else if (hasExplanation) {
            previewInputEl.innerHTML = renderMarkdown(q.answer.explanation || '');
            if (previewLabelEl) {
                previewLabelEl.removeAttribute('data-i18n');
                previewLabelEl.innerText = t('explanation_label') || 'Explanation:';
            }
            previewNoteArea.classList.remove('visible');
        } else {
            previewInputEl.value = '';
            if (previewLabelEl) {
                previewLabelEl.setAttribute('data-i18n', 'note_label');
                previewLabelEl.innerText = t('note_label') || 'Your Note:';
            }
            previewNoteArea.classList.remove('visible');
        }
    }

    // Display Tags
    import('./features/test/test-ui.js').then(testUi => {
        testUi.updateFooterTags(q.tags, 'previewFooterTags');
    });

    updateIndicatorsPreview();

    const backBtnText = document.getElementById('previewBackBtnText');
    if (backBtnText) {
        const key = 'back'; // Simple and universal
        backBtnText.setAttribute('data-i18n', key);
        backBtnText.innerText = t(key);
    }
    const backBtn = document.getElementById('previewBackBtn');
    if (backBtn) {
        backBtn.onclick = () => {
            window.history.back();
        };
    }
};

window.onPreviewQuestion = window.renderQuestionPreview;

function updateIndicatorsPreview() {
    const q = AppState.previewQuestion;
    if (!q) return;
    const statKey = `${q.sourceId}_${q.id}`;
    const s = AppState.stats[statKey] || {};
    document.getElementById('previewIndStar').classList.toggle('active-star', !!s.starred);
    document.getElementById('previewIndFlag').classList.toggle('active-flag', !!s.flagged);
    const hasExplanation = q.answer && q.answer.explanation && q.answer.explanation.trim() !== '';
    const hasNote = s.note && s.note.trim() !== '';
    document.getElementById('previewIndNote').classList.toggle('active-note', !!(hasExplanation || hasNote));
}

const RESET_VERIFICATION_WORDS = ['BERLIN', 'PARIS', 'LONDON', 'MADRID', 'ROME', 'VIENNA', 'AMSTERDAM', 'PRAGUE', 'ISTANBUL', 'WARSAW'];
let currentResetWord = 'BERLIN';
let currentResetMode = 'progress'; // 'progress' | 'sources' | 'full'
let currentResetStep = 1; // 1 | 2

function updateResetOptionCardStyles() {
    const cards = document.querySelectorAll('.reset-option-card');
    cards.forEach(card => {
        const mode = card.dataset.resetMode;
        const isSelected = mode === currentResetMode;
        card.classList.toggle('active', isSelected);
        const radio = card.querySelector('input[type="radio"]');
        if (radio) radio.checked = isSelected;

        if (isSelected) {
            if (mode === 'full') {
                card.style.border = '2px solid var(--danger-color, #ef4444)';
                card.style.background = 'rgba(239, 68, 68, 0.06)';
            } else {
                card.style.border = '2px solid var(--primary-color, #3b82f6)';
                card.style.background = 'rgba(59, 130, 246, 0.06)';
            }
        } else {
            card.style.border = '1px solid var(--border-color, #cbd5e1)';
            card.style.background = 'var(--bg-hover, rgba(0,0,0,0.02))';
        }
    });
}

function showResetStep(step) {
    currentResetStep = step;
    const step1El = document.getElementById('resetStep1');
    const step2El = document.getElementById('resetStep2');
    const nextBtn = document.getElementById('resetAppNextBtn');
    const confirmBtn = document.getElementById('resetAppConfirmBtn');

    if (!step1El || !step2El) return;

    if (step === 1) {
        step1El.style.display = 'block';
        step2El.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'inline-block';
        if (confirmBtn) confirmBtn.style.display = 'none';
        updateResetOptionCardStyles();
    } else {
        step1El.style.display = 'none';
        step2El.style.display = 'block';
        if (nextBtn) nextBtn.style.display = 'none';
        if (confirmBtn) {
            confirmBtn.style.display = 'inline-block';
            confirmBtn.disabled = true;
        }

        // Generate random verification word for step 2
        currentResetWord = RESET_VERIFICATION_WORDS[Math.floor(Math.random() * RESET_VERIFICATION_WORDS.length)];
        const wordDisplay = document.getElementById('resetAppWordDisplay');
        if (wordDisplay) wordDisplay.textContent = currentResetWord;

        const input = document.getElementById('resetAppConfirmInput');
        if (input) {
            input.value = '';
            input.classList.remove('valid');
        }

        // Update warning text based on mode
        const warningTextEl = document.getElementById('resetWarningText');
        if (warningTextEl) {
            if (currentResetMode === 'progress') {
                warningTextEl.textContent = t('reset_app_warning_progress');
            } else if (currentResetMode === 'sources') {
                warningTextEl.textContent = t('reset_app_warning_sources');
            } else {
                warningTextEl.textContent = t('reset_app_warning_full');
            }
        }
    }
}

function openResetAppModal() {
    if (typeof menuActive !== 'undefined' && menuActive) {
        toggleMenu(); // Close side menu if open
    }
    const modal = document.getElementById('resetAppModalOverlay');
    if (!modal) return;

    currentResetMode = 'progress';
    showResetStep(1);
    modal.style.display = 'flex';
}

function closeResetAppModal() {
    const modal = document.getElementById('resetAppModalOverlay');
    if (modal) modal.style.display = 'none';
}

function handleResetInputChange(e) {
    const typed = e.target.value.trim().toUpperCase();
    const input = e.target;
    const confirmBtn = document.getElementById('resetAppConfirmBtn');

    const isValid = typed === currentResetWord.toUpperCase();
    input.classList.toggle('valid', isValid);

    if (confirmBtn) confirmBtn.disabled = !isValid;
}

async function executeFactoryReset() {
    try {
        if (currentResetMode === 'progress') {
            clearProgressData();
        } else if (currentResetMode === 'sources') {
            clearSourcesData();
        } else {
            clearLocalStudyData();
        }

        // If GitHub sync is connected, push clean payload to GitHub Gist as well
        if (AppState.githubToken && AppState.githubGistId) {
            await syncToGist({ silent: true });
        }

        window.location.reload();
    } catch (err) {
        console.error('Failed to reset app:', err);
        showToast('Error resetting application');
    }
}

function setupEventListeners() {
    // Safe event listener binding helper
    const setClick = (id, handler) => {
        const el = document.getElementById(id);
        if (el) el.onclick = handler;
    };

    // Menu
    setClick('menuToggleBtn', toggleMenu);
    setClick('menuTheme', toggleTheme);
    setClick('menuStartOnboarding', () => {
        if (menuActive) toggleMenu();
        startOnboarding(true);
    });
    setClick('menuResetApp', openResetAppModal);
    setClick('resetAppCloseBtn', closeResetAppModal);
    setClick('resetAppCancelBtn', closeResetAppModal);
    setClick('resetAppNextBtn', () => showResetStep(2));
    setClick('resetAppConfirmBtn', executeFactoryReset);

    // Option cards selection click listeners
    document.querySelectorAll('.reset-option-card').forEach(card => {
        card.addEventListener('click', (e) => {
            const mode = card.dataset.resetMode;
            if (mode) {
                currentResetMode = mode;
                updateResetOptionCardStyles();
            }
        });
    });

    const resetInput = document.getElementById('resetAppConfirmInput');
    if (resetInput) {
        resetInput.oninput = handleResetInputChange;
    }

    setClick('menuStar', toggleStar);
    setClick('menuFlag', toggleFlag);
    setClick('menuNote', toggleNoteArea);
    setClick('menuTranslateAll', translateAll);
    setClick('menuCopyAI', () => copyAIPrompt(false));


    // Language selection
    // Language selection
    const btns = document.querySelectorAll('.lang-btn');
    btns.forEach(btn => {
        btn.onclick = () => {
            const lang = btn.getAttribute('data-lang');
            AppState.language = lang;
            persist('focus_app_lang', lang);
            updateLangUI(); // Immediate UI feedback

            try {
                updateStaticTranslations();
                renderSourcesList();
                renderQuestion();
                renderStatsList();
                updateHomeStats();
                // The heatmap draws its own weekday and month labels, so the
                // static pass alone leaves it in the previous language.
                renderGlobalCharts();
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
            persist('focus_app_target_lang', e.target.value);
        };
    }


    // Translation Toggle
    const transToggle = document.getElementById('translationToggle');
    if (transToggle) {
        transToggle.checked = AppState.translationEnabled;
        updateTranslationUI();

        transToggle.onchange = (e) => {
            AppState.translationEnabled = e.target.checked;
            persist('focus_app_translation_enabled', e.target.checked);
            updateTranslationUI();
        };
    }

    // TTS Toggle
    const ttsToggle = document.getElementById('ttsToggle');
    const ttsAutoplayToggle = document.getElementById('ttsAutoplayToggle');
    const ttsContainer = document.getElementById('ttsSettingsContainer');
    const ttsMenuSpeed = document.getElementById('ttsMenuSpeed');

    const updateTtsMenuUI = () => {
        if (!ttsToggle || !ttsContainer) return;
        ttsContainer.style.display = ttsToggle.checked ? 'block' : 'none';
        
        if (ttsAutoplayToggle) ttsAutoplayToggle.checked = AppState.ttsAutoplay;
        
        if (ttsMenuSpeed) {
            const val = AppState.ttsSpeed;
            ttsMenuSpeed.value = val;
            
            updateTtsTooltip(val);
        }
    };

    const updateTtsTooltip = (val) => {
        const tooltip = document.getElementById('ttsSliderTooltip');
        if (!tooltip || !ttsMenuSpeed) return;

        const displayVal = (val * 2.0).toFixed(1);
        tooltip.textContent = `x${displayVal}`;

        // Position tooltip
        const min = parseFloat(ttsMenuSpeed.min);
        const max = parseFloat(ttsMenuSpeed.max);
        const percent = ((val - min) / (max - min)) * 100;
        tooltip.style.left = `${percent}%`;

        // Highlight default (0.5 actual / x1.0 display)
        if (Math.abs(val - 0.5) < 0.01) {
            ttsMenuSpeed.classList.add('is-default');
            tooltip.style.color = 'var(--error-color)';
            tooltip.style.borderColor = 'var(--error-color)';
        } else {
            ttsMenuSpeed.classList.remove('is-default');
            tooltip.style.color = 'var(--primary-color)';
            tooltip.style.borderColor = 'var(--border-color)';
        }
    };

    if (ttsToggle) {
        ttsToggle.checked = AppState.ttsEnabled;
        updateTtsMenuUI();
        ttsToggle.onchange = (e) => {
            AppState.ttsEnabled = e.target.checked;
            updateTtsMenuUI();
            import('./core/state.js').then(m => m.saveTtsSettings());
            if (AppState.currentTest && AppState.currentTest.length > 0) renderQuestion();
        };
    }

    if (ttsAutoplayToggle) {
        ttsAutoplayToggle.onchange = (e) => {
            AppState.ttsAutoplay = e.target.checked;
            import('./core/state.js').then(m => m.saveTtsSettings());
        };
    }

    if (ttsMenuSpeed) {
        ttsMenuSpeed.oninput = (e) => {
            const val = parseFloat(e.target.value);
            AppState.ttsSpeed = val;
            updateTtsTooltip(val);
            import('./core/state.js').then(m => m.saveTtsSettings());
        };
    }

    // Timer Settings
    const stopwatchToggle = document.getElementById('timerStopwatchToggle');
    const countdownToggle = document.getElementById('timerCountdownToggle');
    const countdownLimitInput = document.getElementById('timerCountdownLimitInput');
    const countdownAutoCheckToggle = document.getElementById('timerCountdownAutoCheckToggle');

    const updateCountdownUI = () => {
        const isEnabled = AppState.timerCountdownEnabled;
        const subMenu = document.getElementById('countdownSubMenu');
        if (subMenu) {
            subMenu.style.display = isEnabled ? 'flex' : 'none';
        }
    };

    if (stopwatchToggle) {
        stopwatchToggle.checked = AppState.timerStopwatchEnabled;
        stopwatchToggle.onchange = (e) => {
            AppState.timerStopwatchEnabled = e.target.checked;
            if (e.target.checked && AppState.timerCountdownEnabled) {
                AppState.timerCountdownEnabled = false;
                if (countdownToggle) countdownToggle.checked = false;
                updateCountdownUI();
            }
            import('./core/state.js').then(m => m.saveTimerSettings());
        };
    }
    
    if (countdownToggle) {
        countdownToggle.checked = AppState.timerCountdownEnabled;
        updateCountdownUI();
        countdownToggle.onchange = (e) => {
            AppState.timerCountdownEnabled = e.target.checked;
            if (e.target.checked && AppState.timerStopwatchEnabled) {
                AppState.timerStopwatchEnabled = false;
                if (stopwatchToggle) stopwatchToggle.checked = false;
            }
            updateCountdownUI();
            import('./core/state.js').then(m => m.saveTimerSettings());
        };
    }
    
    if (countdownLimitInput) {
        countdownLimitInput.value = AppState.timerCountdownLimit;
        countdownLimitInput.oninput = (e) => {
            const val = parseInt(e.target.value, 10);
            if (!isNaN(val) && val > 0) {
                AppState.timerCountdownLimit = val;
                import('./core/state.js').then(m => m.saveTimerSettings());
            }
        };
        countdownLimitInput.onblur = (e) => {
            const val = parseInt(e.target.value, 10);
            if (isNaN(val) || val <= 0) {
                AppState.timerCountdownLimit = 59;
                e.target.value = 59;
                import('./core/state.js').then(m => m.saveTimerSettings());
            }
        };
    }

    if (countdownAutoCheckToggle) {
        countdownAutoCheckToggle.checked = AppState.timerAutoCheckEnabled ?? true;
        countdownAutoCheckToggle.onchange = (e) => {
            AppState.timerAutoCheckEnabled = e.target.checked;
            import('./core/state.js').then(m => m.saveTimerSettings());
        };
    }

    setupStatsEventListeners();

    // ---- Notification Settings ----
    (async function initNotificationSettings() {
        const status = getNotificationStatus();
        const s = AppState.continuityConfig?.notificationSettings || {};

        const generalToggle = document.getElementById('notifGeneralToggle');
        const focusToggle   = document.getElementById('notifFocusToggle');
        const generalTimeRow = document.getElementById('notifGeneralTimeRow');
        const focusTimeRow   = document.getElementById('notifFocusTimeRow');
        const generalTimeInput = document.getElementById('notifGeneralTime');
        const focusTimeInput   = document.getElementById('notifFocusTime');
        const quietStart = document.getElementById('notifQuietStart');
        const quietEnd   = document.getElementById('notifQuietEnd');
        const testBtn    = document.getElementById('notifTestBtn');
        const permStatus = document.getElementById('notifPermissionStatus');
        const focusHint  = document.getElementById('notifFocusHint');

        // Populate current values
        if (generalToggle) generalToggle.checked = !!s.enabled;
        if (focusToggle)   focusToggle.checked   = !!s.focusEnabled;
        if (generalTimeInput) {
            const h = String(s.dailyScheduleHour ?? 9).padStart(2,'0');
            const m = String(s.dailyScheduleMinute ?? 0).padStart(2,'0');
            generalTimeInput.value = `${h}:${m}`;
        }
        if (focusTimeInput) {
            const h = String(s.focusScheduleHour ?? 19).padStart(2,'0');
            const m = String(s.focusScheduleMinute ?? 0).padStart(2,'0');
            focusTimeInput.value = `${h}:${m}`;
        }
        if (quietStart) quietStart.value = s.quietHoursStart || '22:00';
        if (quietEnd)   quietEnd.value   = s.quietHoursEnd   || '08:00';

        // Focus toggle availability — check if any focus source is configured
        const hasFocusSources = (AppState.continuityConfig?.focusSources || []).length > 0;
        if (focusToggle) focusToggle.disabled = !hasFocusSources;
        if (focusHint)   focusHint.style.display = hasFocusSources ? 'none' : 'block';

        // Show/hide time rows based on toggle state
        const syncRows = () => {
            if (generalTimeRow) generalTimeRow.style.display = generalToggle?.checked ? 'flex' : 'none';
            if (focusTimeRow)   focusTimeRow.style.display   = focusToggle?.checked   ? 'flex' : 'none';
        };
        syncRows();

        // Show permission status if blocked
        if (permStatus && status.permission === 'denied') {
            permStatus.style.display = 'block';
            permStatus.textContent = t('notif_permission_denied');
        } else if (permStatus && !status.swAvailable) {
            permStatus.style.display = 'block';
            permStatus.textContent = t('notif_not_supported');
        }

        if (generalToggle) {
            generalToggle.onchange = async (e) => {
                if (e.target.checked) {
                    const { requestNotificationPermission } = await import('./core/notification-manager.js');
                    const result = await requestNotificationPermission('general');
                    if (result !== 'granted') {
                        e.target.checked = false;
                        if (permStatus) { permStatus.style.display = 'block'; permStatus.textContent = t('notif_permission_denied'); }
                        return;
                    }
                    if (permStatus) permStatus.style.display = 'none';
                } else {
                    disableNotifications('general');
                }
                syncRows();
                scheduleNotifications();
            };
        }

        if (focusToggle) {
            focusToggle.onchange = async (e) => {
                if (!hasFocusSources) { e.target.checked = false; return; }
                if (e.target.checked) {
                    const { requestNotificationPermission } = await import('./core/notification-manager.js');
                    const result = await requestNotificationPermission('focus');
                    if (result !== 'granted') {
                        e.target.checked = false;
                        if (permStatus) { permStatus.style.display = 'block'; permStatus.textContent = t('notif_permission_denied'); }
                        return;
                    }
                    if (permStatus) permStatus.style.display = 'none';
                } else {
                    disableNotifications('focus');
                }
                syncRows();
                scheduleNotifications();
            };
        }

        const handleTimeChange = () => {
            const [genH, genM] = (generalTimeInput?.value || '09:00').split(':').map(Number);
            const [focH, focM] = (focusTimeInput?.value   || '19:00').split(':').map(Number);
            saveNotificationSettings({
                dailyScheduleHour:  genH,  dailyScheduleMinute:  genM,
                focusScheduleHour:  focH,  focusScheduleMinute:  focM,
                quietHoursStart: quietStart?.value || '22:00',
                quietHoursEnd:   quietEnd?.value   || '08:00'
            });
        };

        if (generalTimeInput) generalTimeInput.onchange = handleTimeChange;
        if (focusTimeInput)   focusTimeInput.onchange   = handleTimeChange;
        if (quietStart)       quietStart.onchange       = handleTimeChange;
        if (quietEnd)         quietEnd.onchange         = handleTimeChange;

        if (testBtn) {
            testBtn.onclick = async () => {
                const channel = focusToggle?.checked ? 'focus' : 'general';
                const sent = await sendTestNotification(channel);
                if (sent) {
                    showToast(t('notif_test_sent'));
                } else {
                    if (permStatus) { permStatus.style.display = 'block'; permStatus.textContent = t('notif_permission_denied'); }
                }
            };
        }
    })();
    // ---- End Notification Settings ----

    document.getElementById('indStar').onclick = toggleStar;
    document.getElementById('indFlag').onclick = toggleFlag;
    document.getElementById('indNote').onclick = toggleNoteArea;
    document.getElementById('menuTranslateAllInline').onclick = translateAll;
    document.getElementById('menuCopyToggleInline').onclick = (e) => toggleAiCopyMenu(false, e);
    document.getElementById('aiCopyTextOption').onclick = (e) => {
        e.stopPropagation();
        closeAllAiCopyDropdowns();
        copyQuestionText();
    };
    document.getElementById('menuEditPrompt').onclick = openPromptEditor;
    document.getElementById('menuManageAIProviders').onclick = openAiManager;

    document.getElementById('previewIndStar').onclick = toggleStar;
    document.getElementById('previewIndFlag').onclick = toggleFlag;
    document.getElementById('previewIndNote').onclick = toggleNoteArea;
    document.getElementById('previewMenuTranslateAllInline').onclick = translateAll;
    document.getElementById('previewMenuCopyToggleInline').onclick = (e) => toggleAiCopyMenu(true, e);
    document.getElementById('previewAiCopyTextOption').onclick = (e) => {
        e.stopPropagation();
        closeAllAiCopyDropdowns();
        copyQuestionText();
    };

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.ai-copy-dropdown') && !e.target.closest('#menuCopyToggleInline') && !e.target.closest('#previewMenuCopyToggleInline')) {
            closeAllAiCopyDropdowns();
        }
    });

    document.getElementById('aiProvidersCloseBtn').onclick = closeAiManager;
    document.getElementById('addAiProviderBtn').onclick = addNewAiProvider;
    document.getElementById('aiProvidersOverlay').onclick = (e) => {
        if (e.target.id === 'aiProvidersOverlay') closeAiManager();
    };
    document.getElementById('statsPreviewEditBtn').onclick = () => {
        if (AppState.previewQuestion) {
            openQuestionEditor(AppState.previewQuestion);
        }
    };




    window.addEventListener('test-finished', () => {
        switchView('results');
        renderTestResults();
        updateHomeStats();
    });

    // The continuity cards prepare the run themselves and announce it here, so
    // they never have to reach into the view layer.
    window.addEventListener('streak-run-started', () => {
        switchView('test');
        renderQuestion();
    });

    // Sidebar Close Button & Overlay
    const closeBtn = document.getElementById('menuCloseBtn');
    if (closeBtn) closeBtn.onclick = toggleMenu;

    // Premium Theme Switch in Sidebar
    // Theme is toggled via clicking the menu item directly now.

    window.addEventListener('show-stats-preview', (e) => {
        const { question, stats, source } = e.detail;
        AppState.previewQuestionId = question.id;
        AppState.previewQuestion = question;
        // renderQuestionPreview switches the view itself; calling it here too
        // was the second of the duplicated history entries.
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
    window.handleFlashcardRating = handleFlashcardRating;
    const openStatsView = () => {
        // Entering via homeStatsBtn: deactivate global toggle so only active sources are searched
        const globalToggle = document.getElementById('statsGlobalToggle');
        if (globalToggle) globalToggle.checked = false;
        const lastFilter = AppState.activeStatsFilter || 'all';
        switchView('stats');
        renderStatsList(lastFilter.startsWith('tag:') ? 'all' : lastFilter);
    };

    const homeStatsBtn = document.getElementById('homeStatsBtn');
    if (homeStatsBtn) homeStatsBtn.onclick = openStatsView;

    const openSourcesView = () => {
        switchView('sources');
    };

    const homeSourcesBtn = document.getElementById('homeSourcesBtn');
    if (homeSourcesBtn) homeSourcesBtn.onclick = openSourcesView;

    // Results View
    document.getElementById('resHomeBtn').onclick = goHome;
    document.getElementById('resRetakeBtn').onclick = retakeSession;
    const scBackBtn = document.getElementById('statsBackBtn');
    if (scBackBtn) {
        scBackBtn.onclick = handleStatsBack;
    }

    const sourcesBackBtn = document.getElementById('sourcesBackBtn');
    if (sourcesBackBtn) {
        sourcesBackBtn.onclick = goHome;
    }

    // Sources
    const msBtn = document.getElementById('mergeSourcesBtn');
    if (msBtn) msBtn.onclick = showMergeModal;

    window.onMergeSourcesConfirm = (ids) => {
        const source = mergeSources(ids);
        if (source) renderSourcesList();
    };

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

    document.getElementById('loadClipboardBtn').onclick = async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (!text || text.trim() === '') {
                showToast(t('clipboard_empty'));
                return;
            }
            const data = JSON.parse(text);
            if (data.questions) {
                const source = processJSON(data, t('load_clipboard'));
                if (source) {
                    const panel = document.getElementById('addSourcePanel');
                    if (panel.style.display !== 'none') toggleAddSourcePanel();
                    renderSourcesList();
                }
            } else {
                showToast(t('invalid_format'));
            }
        } catch (err) {
            console.error(err);
            showToast(t('clipboard_error'));
        }
    };

    // Generic Data Export/Import
    const handleExport = () => {
        const data = {
            version: "1.6",
            sources: AppState.sources,
            folders: AppState.folders,
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
        showToast(t('export_success'));
    };

    const handleImport = async (file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.sources || data.stats) {
                    // Full backup import
                    if (await showConfirm(t('confirm_import_backup'))) {
                        if (data.sources) AppState.sources = data.sources;
                        if (data.folders) AppState.folders = data.folders;
                        if (data.stats) AppState.stats = data.stats;
                        if (data.studyActivity) AppState.studyActivity = data.studyActivity;
                        if (data.continuityConfig) AppState.continuityConfig = data.continuityConfig;
                        if (data.recentTests) AppState.recentTests = data.recentTests;
                        saveStats();
                        saveSources();
                        if (data.folders) {
                            const { saveFolders } = await import('./core/state.js');
                            saveFolders();
                        }
                        if (data.studyActivity) {
                            const { saveStudyActivity } = await import('./core/state.js');
                            saveStudyActivity();
                        }
                        if (data.continuityConfig) {
                            const { saveContinuityConfig } = await import('./core/state.js');
                            saveContinuityConfig();
                        }
                        import('./core/state.js').then(m => m.saveRecentTests());
                        location.reload(); // Simplest way to re-init everything safely
                    }
                } else if (data.questions || (Array.isArray(data.sources) && data.sources[0]?.questions)) {
                    // Single source import
                    await processJSON(data, file.name);
                    renderSourcesList();
                } else {
                    showToast(t('invalid_format'));
                }
            } catch (err) {
                console.error(err);
                showToast(t('import_failed'));
            }
        };
        reader.readAsText(file);
    };

    // Export Buttons
    const exportBtns = ['exportBtn', 'homeExportBtn', 'menuExportBtn'];
    exportBtns.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.onclick = handleExport;
    });

    // Import Buttons
    const importConfigs = [
        { btn: 'importBtn', input: 'importFileInput' },
        { btn: 'homeImportBtn', input: 'importFileInput' },
        { btn: 'menuImportBtn', input: 'importFileInput' } // Reuse same hidden input
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

    if (statsSearchInput) {
        // Unified function to sync search UI state
        window.syncStatsSearchUI = (forceExpand = false) => {
            const input = document.getElementById('statsSearchInput');
            if (!input || !statsSearchWrapper) return;

            const hasText = input.value.trim().length > 0;
            const hasFocus = document.activeElement === input;
            const shouldExpand = forceExpand || hasText || hasFocus;

            const sortBar = document.getElementById('statsSortBar');

            if (shouldExpand) {
                statsSearchWrapper.classList.add('expanded');
                statsSearchWrapper.classList.remove('icon-only');
                if (sortBar) sortBar.classList.add('search-expanded');
            } else {
                statsSearchWrapper.classList.remove('expanded');
                if (sortBar) sortBar.classList.remove('search-expanded');
                
                // Determine if it should be icon-only based on sort/filter state
                const sortField = AppState.activeStatsSortField || 'original';
                const isOriginalSort = sortField === 'original';
                const isAllFilter = (AppState.activeStatsFilter || 'all') === 'all';
                
                if (isAllFilter && isOriginalSort) {
                    statsSearchWrapper.classList.remove('icon-only');
                } else {
                    statsSearchWrapper.classList.add('icon-only');
                }
            }

            if (statsSearchClear) {
                statsSearchClear.style.display = input.value.length > 0 ? 'flex' : 'none';
            }

            // Explicitly refresh sort UI highlights if the function exists
            if (typeof window.refreshStatsSortUI === 'function') {
                window.refreshStatsSortUI();
            }
        };

        const syncSearchState = window.syncStatsSearchUI;

        statsSearchInput.oninput = () => {
            syncSearchState();
            const query = statsSearchInput.value;
            const activeFilter = AppState.activeTagFilter 
                ? ('tag:' + AppState.activeTagFilter) 
                : (document.querySelector('.filter-btn.active')?.dataset.filter || 'all');

            if (AppState.activeTagFilter) {
                renderStatsList('tag:' + AppState.activeTagFilter, query);
            } else {
                renderStatsList(activeFilter, query);
            }

            const curState = history.state || {};
            const hashUrl = query ? `#stats?q=${encodeURIComponent(query)}` : '#stats';

            if (query.trim().length > 0) {
                if (curState.view === 'stats' && curState.searchQuery) {
                    history.replaceState({ view: 'stats', searchQuery: query, filter: activeFilter }, '', hashUrl);
                } else {
                    history.pushState({ view: 'stats', searchQuery: query, filter: activeFilter }, '', hashUrl);
                }
            } else {
                if (curState.view === 'stats' && curState.searchQuery) {
                    history.replaceState({ view: 'stats', searchQuery: '', filter: activeFilter }, '', '#stats');
                }
            }
        };

        statsSearchInput.onfocus = () => {
            if (AppState.activeStatsFilter !== 'all') {
                const allBtn = document.querySelector('.filter-btn[data-filter="all"]');
                if (allBtn) {
                    allBtn.click();
                }
            } else {
                syncSearchState(true); // Force expand on focus
            }
        };

        if (statsSearchExpand) {
            statsSearchExpand.onclick = (e) => {
                e.stopPropagation();
                
                // 1. If not on 'all' filter, switch to it first
                let filterSwitched = false;
                if (AppState.activeStatsFilter !== 'all') {
                    const allBtn = document.querySelector('.filter-btn[data-filter="all"]');
                    if (allBtn) {
                        allBtn.click();
                        filterSwitched = true;
                    }
                }
                
                // 2. Expand UI immediately
                syncSearchState(true); 
                
                // 3. Focus input
                statsSearchInput.focus();
                
                // 4. Ensure final sync if no filter change happened
                if (!filterSwitched) {
                    syncSearchState(true);
                }
            };
        }

        if (statsSearchWrapper) {
            statsSearchWrapper.onclick = (e) => {
                if (statsSearchWrapper.classList.contains('icon-only')) {
                    if (statsSearchExpand) statsSearchExpand.click();
                } else if (e.target === statsSearchWrapper) {
                    if (statsSearchInput) statsSearchInput.focus();
                }
            };
        }

        statsSearchInput.onblur = () => {
            setTimeout(() => syncSearchState(), 150);
        };

        if (statsSearchClear) {
            statsSearchClear.onclick = (e) => {
                e.stopPropagation();
                statsSearchInput.value = '';
                if (AppState.activeTagFilter) {
                    renderStatsList('tag:' + AppState.activeTagFilter, '');
                } else {
                    const activeFilter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
                    renderStatsList(activeFilter, '');
                }
                statsSearchInput.focus();
                syncSearchState();
                history.replaceState({ view: 'stats', searchQuery: '', filter: AppState.activeStatsFilter || 'all' }, '', '#stats');
            };
        }
    }

    // Global Click Close (Updated for Sidebar)
    document.addEventListener('click', (e) => {
        if (menuActive && !e.target.closest('.side-menu') && !e.target.closest('#menuToggleBtn')) {
            toggleMenu();
        }
    });

    // Note Input with autosave
    let noteTimeout;
    document.getElementById('noteInput').oninput = (e) => {
        clearTimeout(noteTimeout);
        noteTimeout = setTimeout(() => {
            const q = AppState.questionMap[AppState.currentTest[AppState.currentIndex]];
            const statKey = `${q.sourceId}_${q.id}`;
            if (!AppState.stats[statKey]) AppState.stats[statKey] = { difficulty: 5.0, correct: 0, wrong: 0 };
            AppState.stats[statKey].note = e.target.value.trim();
            saveStats();
            updateIndicators();
        }, 500);
    };

    let previewNoteTimeout;
    document.getElementById('previewNoteInput').oninput = (e) => {
        clearTimeout(previewNoteTimeout);
        previewNoteTimeout = setTimeout(() => {
            const q = AppState.previewQuestion;
            if (!q) return;
            const statKey = `${q.sourceId}_${q.id}`;
            if (!AppState.stats[statKey]) AppState.stats[statKey] = { difficulty: 5.0, correct: 0, wrong: 0 };
            AppState.stats[statKey].note = e.target.value.trim();
            saveStats();
            updateIndicatorsPreview();
        }, 500);
    };


}


// This closes the setupEventListeners function, assuming the content started within it.

// --- View & Search History Management ---
function executeTagSearch(tag) {
    if (!tag) return;
    const searchQuery = '#' + tag;
    const searchInput = document.getElementById('statsSearchInput');
    if (searchInput) searchInput.value = searchQuery;

    const currentView = history.state?.view || 'home';

    if (currentView !== 'stats') {
        // First push base stats view state so Back goes to main stats view
        history.pushState({ view: 'stats', searchQuery: '', filter: 'all' }, '', '#stats');
    }

    // Push tag search state
    history.pushState({ view: 'stats', searchQuery, filter: 'all' }, '', `#stats?q=${encodeURIComponent(searchQuery)}`);

    // Switch view to stats without pushing another history state
    switchView('stats', true);

    if (typeof window.syncStatsSearchUI === 'function') {
        window.syncStatsSearchUI(true);
    }
    renderStatsList('all', searchQuery);
}
window.executeTagSearch = executeTagSearch;

function handleStatsBack() {
    const input = document.getElementById('statsSearchInput');
    const hasSearch = (input && input.value.trim().length > 0) || AppState.activeTagFilter;
    const curState = history.state || {};

    if (hasSearch || (curState.view === 'stats' && curState.searchQuery)) {
        if (curState.searchQuery) {
            window.history.back();
        } else {
            if (input) input.value = '';
            AppState.activeTagFilter = null;
            if (typeof window.syncStatsSearchUI === 'function') window.syncStatsSearchUI(false);
            renderStatsList('all', '');
            history.replaceState({ view: 'stats', searchQuery: '', filter: 'all' }, '', '#stats');
        }
    } else {
        if (window.history.length > 1 && curState.view === 'stats') {
            window.history.back();
        } else {
            goHome();
        }
    }
}
window.handleStatsBack = handleStatsBack;

// --- View Management ---
function switchView(view, isBack = false) {
    if (!view) return;

    /* Told before the view is painted, so a consumer that fell behind while
       its view was hidden catches up in the same frame the view appears. */
    notifyViewChanged(view);

    // If leaving the test view mid-session, commit answered questions to the streak
    if (view !== 'test' && view !== 'statsPreview') {
        if (AppState.testTracking && AppState.testTracking.results?.length > 0) {
            flushInProgressAnswers();
        }
        stopAudio(true, 'manual');
    }

    // History API integration
    if (!isBack) {
        if (history.state?.view !== view) {
            history.pushState({ view, searchQuery: '', filter: 'all' }, '', `#${view}`);
        }
    }

    if (view === 'test') {
        initTimer();
    } else {
        stopTimer();
    }

    document.getElementById('homeView').style.display = view === 'home' ? 'flex' : 'none';
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

    const sourcesViewEl = document.getElementById('sourcesView');
    if (sourcesViewEl) {
        sourcesViewEl.style.display = view === 'sources' ? 'block' : 'none';
    }

    document.getElementById('statsPreviewView').style.display = view === 'statsPreview' ? 'flex' : 'none';

    if (view === 'statsPreview') {
        document.getElementById('statsPreviewView').style.flexDirection = 'column';
        document.getElementById('statsPreviewView').style.flex = '1';
    }

    document.getElementById('resultsView').style.display = view === 'results' ? 'flex' : 'none';

    const bottomNav = document.getElementById('bottomNav');
    if (bottomNav) {
        bottomNav.style.display = view === 'test' ? 'flex' : 'none';
        if (view === 'test') bottomNav.classList.remove('nav-hidden');
    }

    // Hide header entirely if not on home/stats/sources
    const header = document.querySelector('header');
    if (header) {
        header.style.display = (view === 'home' || view === 'stats' || view === 'sources') ? 'flex' : 'none';
    }

    document.getElementById('menuToggleBtn').style.display = (view === 'home' || view === 'test' || view === 'sources') ? 'flex' : 'none';
    document.getElementById('headerBackBtn').style.display = (view === 'stats' || view === 'statsPreview' || view === 'sources') ? 'flex' : 'none';

    // In preview mode, the inline icons are visible, so we don't need them in the burger menu.
    // Also hide when in home to keep it clean, but mainly for test and statsPreview redundancy.
    const isTestOrPreview = view === 'test' || view === 'statsPreview';
    document.getElementById('testOnlyMenuItems').style.display = isTestOrPreview ? 'none' : (view === 'home' ? 'none' : 'block');

    if (view === 'home' || view === 'stats' || view === 'sources') {
        const qn = document.getElementById('quickNavContainer');
        if (qn) qn.classList.remove('visible');
        const qo = document.getElementById('quickNavOverlay');
        if (qo) qo.classList.remove('visible');
    }

    if (view === 'home') {
        document.getElementById('headerTitle').innerText = 'Exam App';
        updateHomeStats();
        checkActiveTest();
    } else if (view === 'sources') {
        const titleText = (typeof getI18nText === 'function' ? getI18nText('saved_sources') : '') || 'Kayıtlı Kaynaklar';
        document.getElementById('headerTitle').innerText = titleText;
        renderSourcesList();
    } else if (view === 'stats') {
        const titleText = (typeof getI18nText === 'function' ? getI18nText('show_stats') : '') || 'Soru Detayları';
        document.getElementById('headerTitle').innerText = titleText;
    }
}

function goBack() {
    window.history.back();
}

function toggleMenu() {
    menuActive = !menuActive;
    const menu = document.getElementById('actionMenu');

    if (menu) menu.classList.toggle('active', menuActive);

    if (menuActive) {
        updateLangUI();
        // Theme toggle state is now handled solely via click.
    }
}

function initMenuAccordion() {
    const headers = document.querySelectorAll('.menu-section-header:not(.no-accordion)');
    headers.forEach(header => {
        header.onclick = () => {
            const isActive = header.classList.contains('active');
            
            // Close all others
            headers.forEach(h => {
                h.classList.remove('active');
            });
            
            // Toggle current
            if (!isActive) {
                header.classList.add('active');
            }
        };
    });
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
        showDailyMotivationToast();
    } else {
        showToast(t('no_questions_available'));
    }
}

function checkActiveTest() {
    const matchedPresetId = findMatchingPresetId();
    let activeData = null;
    if (matchedPresetId && AppState.presetSessions && AppState.presetSessions[matchedPresetId]) {
        activeData = AppState.presetSessions[matchedPresetId];
        persist('focus_app_active_test', activeData);
    } else {
        activeData = JSON.parse(localStorage.getItem('focus_app_active_test') || 'null');
    }

    const resumeBtn = document.getElementById('resumeBtn');
    const startBtn = document.getElementById('startBtn');
    const startBtnContainer = document.getElementById('startBtnContainer');

    if (activeData && activeData.currentTest && activeData.currentTest.length > 0) {
        if (resumeBtn) {
            resumeBtn.style.display = 'block';
            resumeBtn.style.flex = '1';
        }
        if (startBtn) {
            startBtn.innerText = t('new_test');
            startBtn.setAttribute('data-i18n', 'new_test');
            startBtn.style.width = 'auto';
            startBtn.style.flex = '1';
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
            startBtn.style.flex = '';
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

    // A streak run is drawn from the whole library, so its ids may point at
    // sources that are not currently active. buildQuestionPool always maps every
    // live source, which is what makes those ids resolvable on the way back in.
    if (AppState.rawQuestions.length === 0 || activeData.testTracking?.mode === 'streak') {
        buildQuestionPool({ scope: activeData.testTracking?.mode === 'streak' ? 'all' : 'active' });
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
        : AppState.questionMap[AppState.currentTest[AppState.currentIndex]];
    if (!q) return;
    const statKey = `${q.sourceId}_${q.id}`;
    if (!AppState.stats[statKey]) AppState.stats[statKey] = { difficulty: 5.0, correct: 0, wrong: 0 };
    AppState.stats[statKey].starred = !AppState.stats[statKey].starred;
    saveStats();
    if (isPreview) {
        updateIndicatorsPreview();
        const kw = document.getElementById('statsSearchInput')?.value || '';
        renderStatsList(AppState.activeStatsFilter || 'all', kw);
    }
    else updateIndicators();

    if (menuActive) toggleMenu();
}

function toggleFlag() {
    const isPreview = document.getElementById('statsPreviewView').offsetParent !== null;
    const q = isPreview ? AppState.previewQuestion
        : AppState.questionMap[AppState.currentTest[AppState.currentIndex]];
    if (!q) return;
    const statKey = `${q.sourceId}_${q.id}`;
    if (!AppState.stats[statKey]) AppState.stats[statKey] = { difficulty: 5.0, correct: 0, wrong: 0 };
    AppState.stats[statKey].flagged = !AppState.stats[statKey].flagged;
    saveStats();
    if (isPreview) {
        updateIndicatorsPreview();
        const kw = document.getElementById('statsSearchInput')?.value || '';
        renderStatsList(AppState.activeStatsFilter || 'all', kw);
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

// AI Copy Dropdown & Execution Logic
function toggleAiCopyMenu(isPreview = false, event) {
    if (event) event.stopPropagation();
    const dropdownId = isPreview ? 'previewAiCopyDropdown' : 'aiCopyDropdown';
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;

    const isActive = dropdown.classList.contains('active');
    closeAllAiCopyDropdowns();

    if (!isActive) {
        renderAiCopyList(isPreview);
        dropdown.classList.add('active');
    }
}

function closeAllAiCopyDropdowns() {
    document.querySelectorAll('.ai-copy-dropdown').forEach(d => d.classList.remove('active'));
}

function renderAiCopyList(isPreview = false) {
    const containerId = isPreview ? 'previewAiCopyList' : 'aiCopyList';
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    const providers = AppState.aiProviders || DEFAULT_AI_PROVIDERS;

    providers.forEach(p => {
        const item = document.createElement('div');
        item.className = 'ai-copy-item';

        let domain = p.domain;
        if (!domain) {
            try {
                domain = (new URL(p.url.replace('{PROMPT}', 'test'))).hostname;
            } catch (e) {
                domain = 'google.com';
            }
        }
        const iconUrl = `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;

        item.innerHTML = `
            <img class="ai-icon-img" src="${escapeHTML(iconUrl)}" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block';" alt="${escapeHTML(p.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="display:none;" class="ai-icon-fallback">
                <path d="M12 2l3 6 6 3-6 3-3 6-3-6-6-3 6-3z"></path>
            </svg>
            <span>${escapeHTML(p.name)}</span>
        `;

        item.onclick = (e) => {
            e.stopPropagation();
            closeAllAiCopyDropdowns();
            executeAiSearch(p.id, isPreview);
        };

        container.appendChild(item);
    });
}

function getFormattedPrompt(isPreview = false) {
    let q;
    if (isPreview) {
        q = AppState.previewQuestion;
    } else {
        const qIndex = AppState.currentIndex;
        const compositeId = AppState.currentTest[qIndex];
        q = AppState.questionMap[compositeId];
    }
    if (!q) return '';

    let promptLang = AppState.language || 'tr';
    if (!['tr', 'en', 'de'].includes(promptLang)) {
        promptLang = 'en';
    }

    const defaultTextAnswer = {
        tr: 'Metin yanıtı',
        en: 'Text response',
        de: 'Textantwort'
    }[promptLang] || 'Text response';

    const optionsText = q.options?.map(o => o.text).join(', ') || defaultTextAnswer;
    const questionText = q.content?.text || q.text || '';

    const template = AppState.customAIPrompt || translations[promptLang]?.ai_prompt_template || translations['en']?.ai_prompt_template;
    return template
        .replace('{question}', questionText)
        .replace('{options}', optionsText);
}

function executeAiSearch(providerId, isPreview = false) {
    const prompt = getFormattedPrompt(isPreview);
    if (!prompt) return;

    const provider = (AppState.aiProviders || DEFAULT_AI_PROVIDERS).find(p => p.id === providerId);
    if (!provider) return;

    const btnId = isPreview ? 'previewMenuCopyToggleInline' : 'menuCopyToggleInline';
    const btn = document.getElementById(btnId);
    if (btn) {
        btn.classList.add('copy-flash');
        setTimeout(() => btn.classList.remove('copy-flash'), 500);
    }

    if (provider.url.includes('{PROMPT}')) {
        const targetUrl = provider.url.replace('{PROMPT}', encodeURIComponent(prompt));
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
    } else {
        navigator.clipboard.writeText(prompt).then(() => {
            showToast(t('prompt_copied_toast') || 'Soru promptu panoya alındı. AI sayfasına yapıştırabilirsiniz.');
            window.open(provider.url, '_blank', 'noopener,noreferrer');
        }).catch(err => console.error('Clipboard error:', err));
    }
}

function copyAIPrompt(isPreview = false) {
    const prompt = getFormattedPrompt(isPreview);
    if (!prompt) return;

    navigator.clipboard.writeText(prompt).then(() => {
        showToast(t('prompt_copied_toast') || 'Soru promptu panoya alındı.');
        const btnId = isPreview ? 'previewMenuCopyToggleInline' : 'menuCopyToggleInline';
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.classList.add('copy-flash');
            setTimeout(() => btn.classList.remove('copy-flash'), 500);
        }
    }).catch(err => console.error('Clipboard error:', err));
}

function copyQuestionText() {
    const isPreview = document.getElementById('statsPreviewView').offsetParent !== null;
    let q;
    if (isPreview) {
        q = AppState.previewQuestion;
    } else {
        const qIndex = AppState.currentIndex;
        const compositeId = AppState.currentTest[qIndex];
        q = AppState.questionMap[compositeId];
    }

    const text = q?.content?.text || q?.text || '';
    if (!text) return;

    navigator.clipboard.writeText(text).then(() => {
        showToast(t('copy_success') || 'Soru metni kopyalandı.');
    });

    const btnId = isPreview ? 'previewMenuCopyToggleInline' : 'menuCopyToggleInline';
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
    const isEnabled = AppState.translationEnabled;
    document.body.classList.toggle('translation-disabled', !isEnabled);
    
    // Toggle target select visibility in menu
    const transSelect = document.getElementById('translationTargetSelect');
    if (transSelect) {
        transSelect.style.display = isEnabled ? 'block' : 'none';
    }
}

// AI Prompt Editor Logic
function openPromptEditor() {
    const overlay = document.getElementById('promptEditorOverlay');
    const input = document.getElementById('customPromptInput');

    let promptLang = AppState.language || 'tr';
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

async function resetCustomPrompt() {
    if (await showConfirm(t('confirm_reset') || 'Varsayılan prompta dönmek istediğinize emin misiniz?')) {
        let promptLang = AppState.language || 'tr';
        if (!['tr', 'en', 'de'].includes(promptLang)) promptLang = 'en';
        const defaultPrompt = translations[promptLang]?.ai_prompt_template || translations['en']?.ai_prompt_template;

        document.getElementById('customPromptInput').value = defaultPrompt;
        AppState.customAIPrompt = '';
        saveCustomAIPrompt();
        showToast(t('reset_success') || 'Sıfırlandı');
    }
}

// AI Provider Manager Functions
function openAiManager() {
    const overlay = document.getElementById('aiProvidersOverlay');
    if (!overlay) return;
    renderAiManagerList();
    overlay.classList.add('active');
    if (menuActive) toggleMenu();
}

function closeAiManager() {
    const overlay = document.getElementById('aiProvidersOverlay');
    if (overlay) overlay.classList.remove('active');
}

function renderAiManagerList() {
    const container = document.getElementById('aiProvidersList');
    if (!container) return;
    container.innerHTML = '';

    const providers = AppState.aiProviders || DEFAULT_AI_PROVIDERS;

    providers.forEach(p => {
        const item = document.createElement('div');
        item.className = 'ai-manage-item';

        item.innerHTML = `
            <div class="ai-manage-item-info">
                <span class="ai-manage-item-name">${escapeHTML(p.name)}</span>
                <span class="ai-manage-item-url">${escapeHTML(p.url)}</span>
            </div>
            <button class="icon-btn delete-ai-btn" style="color: #ef4444;" title="${t('delete') || 'Sil'}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        `;

        item.querySelector('.delete-ai-btn').onclick = () => {
            deleteAiProvider(p.id);
        };

        container.appendChild(item);
    });
}

function addNewAiProvider() {
    const nameInput = document.getElementById('newAiNameInput');
    const urlInput = document.getElementById('newAiUrlInput');

    const name = nameInput.value.trim();
    let url = urlInput.value.trim();

    if (!name || !url) {
        showToast('Lütfen servis adı ve URL girin.');
        return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }

    let domain = '';
    try {
        domain = new URL(url.replace('{PROMPT}', 'test')).hostname;
    } catch (e) {
        domain = 'ai.com';
    }

    const newProvider = {
        id: 'custom_' + Date.now(),
        name: name,
        url: url,
        domain: domain
    };

    AppState.aiProviders.push(newProvider);
    saveAiProviders();

    nameInput.value = '';
    urlInput.value = '';

    renderAiManagerList();
    showToast(t('save_success') || 'Kaydedildi');
}

function deleteAiProvider(id) {
    if (AppState.aiProviders.length <= 1) {
        showToast('En az bir AI servisi olmalıdır.');
        return;
    }
    AppState.aiProviders = AppState.aiProviders.filter(p => p.id !== id);
    saveAiProviders();
    renderAiManagerList();
    showToast(t('reset_success') || 'Silindi');
}

function closeAllModals() {
    let closedAny = false;

    // 0. AI Copy Dropdowns
    closeAllAiCopyDropdowns();

    // 1. Question Editor
    const qe = document.getElementById('questionEditorOverlay');
    if (qe && qe.style.display !== 'none') {
        closeQuestionEditor();
        closedAny = true;
    }

    // 2. Prompt Editor
    const pe = document.getElementById('promptEditorOverlay');
    if (pe && pe.classList.contains('active')) {
        closePromptEditor();
        closedAny = true;
    }

    // 2.5 AI Providers Overlay
    const aio = document.getElementById('aiProvidersOverlay');
    if (aio && aio.classList.contains('active')) {
        closeAiManager();
        closedAny = true;
    }

    // 3. Sources UI Modals
    closeAllSourcesModals();

    // 4. Progress Chart (Overlay)
    const pc = document.getElementById('progressChartOverlay');
    if (pc && pc.classList.contains('active')) {
        pc.classList.remove('active');
        closedAny = true;
    }

    // 5. Custom Modal (Utils)
    const cm = document.getElementById('customModalOverlay');
    if (cm && cm.classList.contains('active')) {
        cm.classList.remove('active');
        closedAny = true;
    }

    // 6. Onboarding Tour
    const ob = document.querySelector('.onboarding-backdrop');
    if (ob) {
        stopOnboarding(true);
        closedAny = true;
    }

    return closedAny;
}

