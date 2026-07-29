import { AppState, saveStats, saveSources, saveCurrentSource, saveCustomAIPrompt, saveAiProviders, DEFAULT_AI_PROVIDERS, saveActiveTest, clearActiveTest, clearLocalStudyData } from './core/state.js';
import { initTheme, toggleTheme } from './core/theme.js';
import { updateStaticTranslations, t, targetLanguages, translations } from './core/i18n.js';
import { showToast, showConfirm, getCorrectAnswers, highlightText } from './core/utils.js';
import { migrateOldData, migrateFolderColors } from './core/migration.js';
import { processJSON, loadFromUrl, loadFromFile, normalizeQuestions, mergeSources } from './features/sources/sources-service.js';
import { renderSourcesList, showMergeModal, closeAllSourcesModals } from './features/sources/sources-ui.js';
import { initArchiveUI } from './features/sources/archive.js';
import { prepareTest, finishTest, prepareRetake } from './features/test/test-engine.js';
import { renderQuestion, handleCheckAnswer, updateIndicators, handleTranslation, handleDifficultyRating, handleFlashcardRating, renderTestResults, handleTtsToggle, getIsAudioPlaying, stopAudio } from './features/test/test-ui.js';
import { renderStatsList, updateHomeStats, setupStatsEventListeners } from './features/stats/stats-module.js';
import { openQuestionEditor, closeQuestionEditor } from './features/stats/question-editor.js';
import { initTimer, stopTimer } from './features/test/timer-module.js';
import { initSync, syncToGist } from './core/github-sync.js';



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

// --- Global access for module cross-communication ---
window.renderStatsList = renderStatsList;
window.updateHomeStats = updateHomeStats;
window.switchView = switchView; // Ensure it's available for modules
window.goHome = goHome;
window.copyAIPrompt = copyAIPrompt;
window.executeAiSearch = executeAiSearch;
window.copyQuestionText = copyQuestionText;


// --- Initialize ---
const initApp = () => {
    console.log('initApp start');
    
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

                const isNearBottom = (windowHeight + currentScrollY) >= (bodyHeight - 140);

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
        console.log('Migrating old data...');
        migrateOldData();
        migrateFolderColors();

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

        console.log('Rendering stats list...');
        renderStatsList();

        console.log('Updating home stats...');
        updateHomeStats();

        console.log('Setting up event listeners...');
        setupEventListeners();
        initMenuAccordion();

        console.log('Updating translation UI...');
        updateTranslationUI();

        initSync();





        console.log('App initialized v1.2.3');

        // One-time auto-load logic for new users: Add default template but don't force select it
        const templateAdded = localStorage.getItem('focus_app_template_added');
        if (!templateAdded) {
            console.log('Adding default exam template...');
            loadFromUrl('./examples/standard-exam.json', { active: false, silent: true }).then(source => {
                if (source) renderSourcesList();
            });
            localStorage.setItem('focus_app_template_added', 'true');
        }

        // One-time: Add IHK FISI flashcard demo for all users (new + existing)
        const flashcardDemoAdded = localStorage.getItem('focus_app_flashcard_demo_added');
        if (!flashcardDemoAdded) {
            console.log('Adding IHK FISI flashcard demo...');
            loadFromUrl('./examples/ihk-fisi-flashcards.json', { active: false, silent: true }).then(source => {
                if (source) renderSourcesList();
            });
            localStorage.setItem('focus_app_flashcard_demo_added', 'true');
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

            const questions = [];
            const questionMap = {};
            AppState.sources.forEach(s => {
                if (s.active && !s.archived && s.questions) {
                    s.questions.forEach(q => {
                        const entry = { ...q, sourceId: s.id };
                        questions.push(entry);
                        questionMap[`${s.id}_${q.id}`] = entry;
                    });
                }
            });
            if (questions.length > 0) {
                AppState.rawQuestions = questions;
                AppState.questionMap = questionMap;
            }
        }
        checkActiveTest();

        // --- History API popstate listener ---
        window.onpopstate = (e) => {
            // Priority: Close any open modal first
            const modalClosed = closeAllModals();
            
            // If a modal was closed, we might want to stay on the same page?
            // However, the browser already moved the history. 
            // To prevent double navigation, we check if it was just a modal close.
            
            if (e.state && e.state.view) {
                switchView(e.state.view, true);
            } else {
                switchView('home', true);
            }
        };

        // Initialize first state
        if (!history.state) {
            history.replaceState({ view: 'home' }, '', '#home');
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
    // Update the header title
    const titleEl = document.querySelector('#previewIndicatorsBar .preview-title');
    if (titleEl) {
        const titleKey = 'view_statsPreview';
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
        <span>${t('correct')}: <b>${s.correct}</b></span>
        <span>${t('wrong')}: <b>${s.wrong}</b></span>
        <span>${t('success_percent', { percent })}</span>
        <span>${t('difficulty_label')} <b>${(s.difficulty / 2).toFixed(1)}</b></span>
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
            previewInputEl.innerHTML = q.answer.explanation;
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

function openResetAppModal() {
    if (typeof menuActive !== 'undefined' && menuActive) {
        toggleMenu(); // Close side menu if open
    }
    const modal = document.getElementById('resetAppModalOverlay');
    const input = document.getElementById('resetAppConfirmInput');
    const display = document.getElementById('resetAppWordDisplay');
    const confirmBtn = document.getElementById('resetAppConfirmBtn');

    if (!modal) return;

    // Pick random verification word
    currentResetWord = RESET_VERIFICATION_WORDS[Math.floor(Math.random() * RESET_VERIFICATION_WORDS.length)];
    if (display) display.textContent = currentResetWord;

    if (input) {
        input.value = '';
        input.classList.remove('valid');
    }
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = '0.5';
        confirmBtn.style.cursor = 'not-allowed';
    }

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

    if (confirmBtn) {
        confirmBtn.disabled = !isValid;
        confirmBtn.style.opacity = isValid ? '1' : '0.5';
        confirmBtn.style.cursor = isValid ? 'pointer' : 'not-allowed';
    }
}

async function executeFactoryReset() {
    try {
        clearLocalStudyData();

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
    setClick('menuExit', confirmExit);
    setClick('menuResetApp', openResetAppModal);
    setClick('resetAppCloseBtn', closeResetAppModal);
    setClick('resetAppCancelBtn', closeResetAppModal);
    setClick('resetAppConfirmBtn', executeFactoryReset);

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

    // Sidebar Close Button & Overlay
    const closeBtn = document.getElementById('menuCloseBtn');
    if (closeBtn) closeBtn.onclick = toggleMenu;
    
    const overlay = document.getElementById('menuOverlay');
    if (overlay) overlay.onclick = toggleMenu;

    // Premium Theme Switch in Sidebar
    // Theme is toggled via clicking the menu item directly now.

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
    window.handleFlashcardRating = handleFlashcardRating;
    document.getElementById('homeStatsBtn').onclick = () => {
        const lastFilter = AppState.activeStatsFilter || 'all';
        switchView('stats');
        renderStatsList(lastFilter.startsWith('tag:') ? 'all' : lastFilter);
    };

    // Results View
    document.getElementById('resHomeBtn').onclick = goHome;
    document.getElementById('resRetakeBtn').onclick = retakeSession;
    const scBackBtn = document.getElementById('statsBackBtn');
    if (scBackBtn) {
        scBackBtn.onclick = goHome;
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
                if (data.questions) {
                    // Single source import
                    await processJSON(data, file.name);
                    renderSourcesList();
                } else if (data.sources || data.stats) {
                    // Full backup import
                    if (await showConfirm(t('confirm_import_backup'))) {
                        if (data.sources) AppState.sources = data.sources;
                        if (data.folders) AppState.folders = data.folders;
                        if (data.stats) AppState.stats = data.stats;
                        if (data.recentTests) AppState.recentTests = data.recentTests;
                        saveStats();
                        saveSources();
                        if (data.folders) {
                            const { saveFolders } = await import('./core/state.js');
                            saveFolders();
                        }
                        import('./core/state.js').then(m => m.saveRecentTests());
                        location.reload(); // Simplest way to re-init everything safely
                    }
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
            if (AppState.activeTagFilter) {
                renderTagView(AppState.activeTagFilter, 'all', statsSearchInput.value);
            } else {
                const activeFilter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
                renderStatsList(activeFilter, statsSearchInput.value);
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
                    renderTagView(AppState.activeTagFilter, 'all', '');
                } else {
                    const activeFilter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
                    renderStatsList(activeFilter, '');
                }
                statsSearchInput.focus();
                syncSearchState();
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

// --- View Management ---
function switchView(view, isBack = false) {
    if (!view) return;

    // Stop audio when leaving test environment
    if (view !== 'test' && view !== 'statsPreview') {
        stopAudio(true, 'manual');
    }

    // History API integration
    if (!isBack) {
        history.pushState({ view }, '', `#${view}`);

        // Update AppState view history (avoid consecutive duplicates)
        if (AppState.viewHistory[0]?.view !== view) {
            AppState.viewHistory.unshift({
                view,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                label: t(`view_${view}`)
            });
            if (AppState.viewHistory.length > 10) AppState.viewHistory.pop();
            renderHistoryList();
        }
    }

    if (view === 'test') {
        initTimer();
    } else {
        stopTimer();
    }

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

    const bottomNav = document.getElementById('bottomNav');
    if (bottomNav) {
        bottomNav.style.display = view === 'test' ? 'flex' : 'none';
        if (view === 'test') bottomNav.classList.remove('nav-hidden');
    }

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
    window.history.back();
}

function renderHistoryList() {
    const list = document.getElementById('historyList');
    if (!list) return;

    list.innerHTML = '';

    // We only show the last 5-10 visits (excluding the current one usually if we want "recently visited")
    // For this implementation, we show all in viewHistory
    AppState.viewHistory.forEach((item, index) => {
        // Skip current view if it's the first one? No, let's show all, but maybe highlight the current.
        const el = document.createElement('button');
        el.className = 'history-item';
        if (index === 0) el.classList.add('active');

        el.innerHTML = `
            <div class="history-item-info">
                <span class="history-item-label">${item.label}</span>
                <span class="history-item-time">${item.time}</span>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="9 18 15 12 9 6"></polyline></svg>
        `;
        el.onclick = () => {
            switchView(item.view);
            if (menuActive) toggleMenu();
        };
        list.appendChild(el);
    });
}

function toggleMenu() {
    menuActive = !menuActive;
    const menu = document.getElementById('actionMenu');
    const overlay = document.getElementById('menuOverlay');
    
    if (menu) menu.classList.toggle('active', menuActive);
    if (overlay) overlay.classList.toggle('active', menuActive);
    
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
        if (resumeBtn) {
            resumeBtn.style.display = 'block';
            resumeBtn.style.flex = '1';
        }
        if (startBtn) {
            startBtn.innerText = t('new_test');
            startBtn.setAttribute('data-i18n', 'new_test');
            startBtn.style.width = 'auto';
            startBtn.style.flex = '1';
            startBtn.style.backgroundColor = 'var(--primary-color)';
            startBtn.style.color = '#ffffff';
            startBtn.style.border = 'none';
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

    // Ensure questionMap is populated (rawQuestions built in DOMContentLoaded)
    if (AppState.rawQuestions.length === 0) {
        const questions = [];
        const questionMap = {};
        AppState.sources.forEach(s => {
            if (s.active && !s.archived && s.questions) {
                s.questions.forEach(q => {
                    const entry = { ...q, sourceId: s.id };
                    questions.push(entry);
                    questionMap[`${s.id}_${q.id}`] = entry;
                });
            }
        });
        AppState.rawQuestions = questions;
        AppState.questionMap = questionMap;
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

async function confirmExit() {
    if (await showConfirm(t('confirm_exit'))) {
        switchView('home');
    }
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
            <img class="ai-icon-img" src="${iconUrl}" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block';" alt="${p.name}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="display:none;" class="ai-icon-fallback">
                <path d="M12 2l3 6 6 3-6 3-3 6-3-6-6-3 6-3z"></path>
            </svg>
            <span>${p.name}</span>
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
                <span class="ai-manage-item-name">${p.name}</span>
                <span class="ai-manage-item-url">${p.url}</span>
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

    return closedAny;
}

