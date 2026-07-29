import { AppState, saveSources, saveStats } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import { showToast } from '../../core/utils.js';
// The question type is the single source of truth for this editor: it decides
// which tabs exist, which fields render, and what a valid question looks like.
// The rules themselves live in core so the importer applies exactly the same
// ones — see question-rules.js.
import { KNOWN_TYPES, getQuestionCategory, findQuestionIssues } from '../../core/question-rules.js';

let currentEditingQuestion = null;
let activeGroup = 'general';
/* Why a save was refused, shown in the editor header. It has to live inside the
   modal: showToast() paints at z-index 1000, well under the editor overlay's
   10005, so a toast raised from here would never be seen. */
let editorError = null;

// Tab order is fixed; only membership varies by category, so a tab never moves
// position between question types.
function getGroupsForCategory(category) {
    if (category === 'flashcard') return ['general', 'flashcard'];
    if (category === 'choice') return ['general', 'content', 'options', 'answer'];
    return ['general', 'content', 'answer'];
}

/* Bring the question's shape in line with its type. Called when the user
   changes the type — not on open, so merely viewing a question never discards
   anything. Fields belonging to other categories are dropped so a saved
   question can't carry contradictory leftovers (options on a reading card,
   accepted_texts on a multiple choice). */
function normalizeForType() {
    const q = currentEditingQuestion;
    const category = getQuestionCategory(q.type || '');
    if (!q.answer) q.answer = {};

    if (category !== 'choice') delete q.answer.correct_ids;
    if (category !== 'text') delete q.answer.accepted_texts;
    if (category !== 'text') delete q.answer.caseSensitive;
    if (category !== 'flashcard') delete q.answer.back;
    if (category !== 'choice') q.options = [];

    if (category === 'choice') {
        if (!Array.isArray(q.options)) q.options = [];
        // A choice question is meaningless below two options — seed them so the
        // Options tab opens ready to fill in rather than empty.
        while (q.options.length < 2) {
            const maxId = q.options.reduce((max, o) => Math.max(max, parseInt(o.id) || 0), 0);
            q.options.push({ id: maxId + 1, text: '', media: [] });
        }
        // Keep only marks that still point at a live option, and collapse to a
        // single answer when the type no longer allows several.
        const liveIds = q.options.map(o => String(o.id));
        let correct = (q.answer.correct_ids || []).map(String).filter(id => liveIds.includes(id));
        if (q.type !== 'multiple_choice') correct = correct.slice(0, 1);
        q.answer.correct_ids = correct.map(Number);
    }
}

/* What the type demands before the question can be saved. The rules come from
   question-rules.js — this only turns the first issue into a tab to land on and
   a message to show. */
function validateQuestion() {
    const [first] = findQuestionIssues(currentEditingQuestion);
    if (!first) return null;
    return { group: first.group, message: t(`validation_${first.code}`) };
}

export function closeQuestionEditor() {
    const overlay = document.getElementById('questionEditorOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
    currentEditingQuestion = null;
}

export function openQuestionEditor(question) {
    currentEditingQuestion = JSON.parse(JSON.stringify(question)); // Deep copy for editing
    
    // Sync difficulty from stats if available
    const statKey = `${question.sourceId}_${question.id}`;
    const s = AppState.stats[statKey];
    if (s && s.difficulty !== undefined) {
        currentEditingQuestion.difficulty = s.difficulty / 2; // Convert 1-10 to 1-5
    }

    activeGroup = 'general';
    editorError = null;
    renderEditorModal();
}

function renderEditorModal() {
    const category = getQuestionCategory(currentEditingQuestion.type || 'single_choice');

    // A tab the current type does not have cannot stay selected.
    const groups = getGroupsForCategory(category);
    if (!groups.includes(activeGroup)) activeGroup = 'general';

    let overlay = document.getElementById('questionEditorOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'questionEditorOverlay';
        overlay.className = 'editor-overlay';
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';

    const isChoice = category === 'choice';
    const isFlashcard = category === 'flashcard';
    // The tab strip's layout follows the tab count via .btn-row — never style
    // it here. choice 4 (2×2) · text/reading 3 (2 + 1 full width) · flashcard 2.
    const tabCount = groups.length;
    // Only the text category edits an answer next to the explanation; for
    // choice the answer lives in Options, and reading cards have none at all.
    const answerTabLabel = category === 'text' ? t('group_answer') : t('group_explanation');

    const optionsTab = isChoice ? `
                <button class="btn btn-secondary group-btn ${activeGroup === 'options' ? 'active' : ''}" data-group="options">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                    ${t('group_options')}
                </button>` : '';

    const optionsSection = isChoice ? `
                <div class="edit-section ${activeGroup === 'options' ? 'active' : ''}" id="section-options">
                    <div class="code-info-box">${t('code_usage_info')}</div>
                    <div id="editor-options-list">
                        ${renderOptionsList()}
                    </div>
                    <button class="btn btn-subtle btn-block add-opt-btn" id="add-option-btn">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        ${t('add_option')}
                    </button>
                </div>` : '';

    const flashcardSection = isFlashcard ? `
                <div class="edit-section ${activeGroup === 'flashcard' ? 'active' : ''}" id="section-flashcard">
                    <div class="editor-input-group">
                        <label>${t('flashcard_front')}</label>
                        <textarea class="editor-field code-font" id="edit-fc-front" style="min-height: 120px;">${currentEditingQuestion.content?.text || ''}</textarea>
                    </div>
                    <div class="editor-input-group">
                        <label>${t('flashcard_back')}</label>
                        <textarea class="editor-field code-font" id="edit-fc-back" style="min-height: 120px;">${currentEditingQuestion.answer?.back || ''}</textarea>
                    </div>
                </div>` : '';

    overlay.innerHTML = `
        <div class="editor-card">
            <div class="editor-header">
                <div class="editor-header-row">
                    <h3 class="editor-title">${t('edit_question_title')}</h3>
                    <div class="editor-id">ID: ${currentEditingQuestion.id}</div>
                </div>
                ${editorError ? `
                <div class="editor-error" role="alert">
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    <span>${editorError}</span>
                </div>` : ''}
            </div>

            <div class="btn-row editor-group-nav" data-count="${tabCount}">
                <button class="btn btn-secondary group-btn ${activeGroup === 'general' ? 'active' : ''}" data-group="general">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                    ${t('group_general')}
                </button>
                ${isFlashcard ? `
                <button class="btn btn-secondary group-btn ${activeGroup === 'flashcard' ? 'active' : ''}" data-group="flashcard">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>
                    ${t('group_flashcard')}
                </button>` : `
                <button class="btn btn-secondary group-btn ${activeGroup === 'content' ? 'active' : ''}" data-group="content">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                    ${t('group_content')}
                </button>
                ${optionsTab}
                <button class="btn btn-secondary group-btn ${activeGroup === 'answer' ? 'active' : ''}" data-group="answer">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                    ${answerTabLabel}
                </button>`}
            </div>

            <div class="editor-content-area">
                <div class="edit-section ${activeGroup === 'general' ? 'active' : ''}" id="section-general">
                    <div class="editor-input-group">
                        <label>${t('type_label')}</label>
                        <select class="editor-field" id="edit-type">
                            ${renderTypeOptions()}
                        </select>
                    </div>
                    <div class="editor-input-group">
                        <label>${t('difficulty_label')} (1-5)</label>
                        <input type="number" class="editor-field" id="edit-difficulty" min="1" max="5" step="0.1" value="${currentEditingQuestion.difficulty || 1.5}">
                    </div>
                    <div class="editor-input-group">
                        <label>${t('tags_label')}</label>
                        <div class="tag-manager" id="tag-manager">
                            <div class="tag-chips" id="tag-chips-container">
                                ${renderTagChips()}
                            </div>
                            <div class="tag-add-row">
                                <input type="text" id="new-tag-input" class="editor-field" placeholder="${t('tags_placeholder')}" style="flex:1; margin:0;">
                                <button type="button" id="add-tag-btn" class="btn btn-primary">+</button>
                            </div>
                            <div class="tag-suggestions" id="tag-suggestions-container">
                                ${renderTagSuggestions()}
                            </div>
                        </div>
                    </div>
                </div>

                ${isFlashcard ? '' : `
                <div class="edit-section ${activeGroup === 'content' ? 'active' : ''}" id="section-content">
                    <div class="code-info-box">${t('code_usage_info')}</div>
                    <div class="editor-input-group">
                        <div class="label-row">
                            <label>${t('text_label')}</label>
                            <button class="btn btn-primary-soft btn-xs wrap-code-btn" data-target="edit-text">${t('wrap_code_btn')}</button>
                        </div>
                        <textarea class="editor-field code-font" id="edit-text" style="min-height: 120px;">${currentEditingQuestion.content?.text || currentEditingQuestion.text || ''}</textarea>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div class="editor-input-group">
                            <label>${t('media_type_label')}</label>
                            <select class="editor-field" id="edit-media-type">
                                <option value="" ${(!currentEditingQuestion.content?.media?.[0]) ? 'selected' : ''}>${t('media_none')}</option>
                                <option value="image" ${currentEditingQuestion.content?.media?.[0]?.type === 'image' ? 'selected' : ''}>${t('media_image')}</option>
                                <option value="video" ${currentEditingQuestion.content?.media?.[0]?.type === 'video' ? 'selected' : ''}>${t('media_video')}</option>
                            </select>
                        </div>
                        <div class="editor-input-group">
                            <label>${t('media_pos_label')}</label>
                            <select class="editor-field" id="edit-media-pos">
                                <option value="above" ${currentEditingQuestion.content?.media?.[0]?.position === 'above' ? 'selected' : ''}>${t('media_above')}</option>
                                <option value="below" ${currentEditingQuestion.content?.media?.[0]?.position === 'below' ? 'selected' : ''}>${t('media_below')}</option>
                            </select>
                        </div>
                    </div>
                    <div class="editor-input-group">
                        <label>${t('media_url_label')}</label>
                        <input type="text" class="editor-field" id="edit-media-url" value="${currentEditingQuestion.content?.media?.[0]?.url || ''}">
                    </div>
                </div>
                ${optionsSection}
                <div class="edit-section ${activeGroup === 'answer' ? 'active' : ''}" id="section-answer">
                    ${renderAnswerSection()}
                </div>`}

                ${isFlashcard ? flashcardSection : ''}
            </div>

            <div class="editor-footer">
                <button class="btn btn-secondary btn-flex" id="editor-cancel-btn">${t('cancel')}</button>
                <button class="btn btn-primary btn-flex" id="editor-save-btn">${t('save_changes')}</button>
            </div>
        </div>
    `;

    setupEditorListeners();
}

function renderTypeOptions() {
    const current = currentEditingQuestion.type || '';
    // Keep an unrecognised type in the list so it stays selectable and round-trips
    // through a save untouched instead of being coerced to the first entry.
    const types = KNOWN_TYPES.includes(current) || !current
        ? KNOWN_TYPES
        : [...KNOWN_TYPES, current];

    return types.map(type =>
        `<option value="${type}" ${current === type ? 'selected' : ''}>${type}</option>`
    ).join('');
}

function renderOptionsList() {
    const options = currentEditingQuestion.options || [];
    const type = currentEditingQuestion.type || '';
    const isChoice = getQuestionCategory(type) === 'choice';
    // multiple_choice takes checkboxes so several answers can be marked;
    // single_choice and true_false take radios, which enforce exactly one.
    const isMultiple = type === 'multiple_choice';
    const correctIds = (currentEditingQuestion.answer?.correct_ids || []).map(String);

    return options.map((opt, idx) => {
        const isCorrect = correctIds.includes(String(opt.id));
        const inputType = isMultiple ? 'checkbox' : 'radio';

        const correctIndicator = isChoice ? `
            <label class="opt-correct-label ${isCorrect ? 'is-correct' : ''}" title="${t('mark_correct_title')}">
                <input type="${inputType}" name="correct-answer" class="answer-option-input" value="${opt.id}" ${isCorrect ? 'checked' : ''}>
                <span>${isCorrect ? t('option_is_correct') : t('option_not_correct')}</span>
            </label>` : '';

        return `
        <div class="option-edit-card ${isCorrect ? 'is-correct-card' : ''}" data-idx="${idx}">
            <div class="option-edit-header">
                <span class="option-id-badge">ID: ${opt.id}</span>
                ${correctIndicator}
                <button class="delete-opt-btn" data-idx="${idx}" title="${t('delete_option')}">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
            <div class="label-row" style="margin-bottom: 4px;">
                <label style="font-size: 0.7rem;">${t('text_label')}</label>
                <button class="btn btn-primary-soft btn-xs wrap-code-btn opt-code-btn" data-idx="${idx}">${t('wrap_code_btn')}</button>
            </div>
            <textarea class="editor-field code-font opt-text-field" style="min-height: 60px; margin-bottom: 0.75rem;">${opt.text || ''}</textarea>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                <div class="editor-input-group">
                    <label>${t('media_type_label')}</label>
                    <select class="editor-field opt-media-type" data-idx="${idx}">
                        <option value="" ${(!opt.media?.[0]) ? 'selected' : ''}>${t('media_none')}</option>
                        <option value="image" ${opt.media?.[0]?.type === 'image' ? 'selected' : ''}>${t('media_image')}</option>
                        <option value="video" ${opt.media?.[0]?.type === 'video' ? 'selected' : ''}>${t('media_video')}</option>
                    </select>
                </div>
                <div class="editor-input-group">
                    <label>${t('media_url_label')}</label>
                    <input type="text" class="editor-field opt-media-url" data-idx="${idx}" value="${opt.media?.[0]?.url || ''}">
                </div>
            </div>
        </div>
    `;
    }).join('');
}

function renderTagChips() {
    const tags = currentEditingQuestion?.tags || [];
    if (tags.length === 0) return `<span class="tag-empty">${t('no_tags_yet')}</span>`;
    return tags.map((tag, idx) => `
        <span class="tag-chip" data-idx="${idx}" title="${t('tag_edit_hint')}">
            <span class="tag-chip-text">${tag}</span>
            <button type="button" class="tag-chip-delete" data-idx="${idx}" title="${t('delete_tag')}">×</button>
        </span>
    `).join('');
}

function setupOptionCorrectListeners() {
    const overlay = document.getElementById('questionEditorOverlay');
    if (!overlay) return;
    overlay.querySelectorAll('.answer-option-input').forEach(input => {
        input.onchange = () => {
            // Tüm kartları sıfırla, seçili olanları vurgula
            overlay.querySelectorAll('.option-edit-card').forEach(card => {
                card.classList.remove('is-correct-card');
            });
            overlay.querySelectorAll('.opt-correct-label').forEach(lbl => {
                lbl.classList.remove('is-correct');
                lbl.querySelector('span').textContent = t('option_not_correct');
            });
            const checked = [...overlay.querySelectorAll('.answer-option-input:checked')];
            checked.forEach(el => {
                const card = el.closest('.option-edit-card');
                const label = el.closest('.opt-correct-label');
                if (card) card.classList.add('is-correct-card');
                if (label) {
                    label.classList.add('is-correct');
                    label.querySelector('span').textContent = t('option_is_correct');
                }
            });
        };
    });
}

function setupTagPillListeners() {
    const overlay = document.getElementById('questionEditorOverlay');
    if (!overlay) return;
    overlay.querySelectorAll('.tag-pill').forEach(pill => {
        pill.onclick = () => {
            const clickedTag = pill.dataset.tag;
            const tags = currentEditingQuestion.tags || [];
            const idx = tags.indexOf(clickedTag);
            if (idx > -1) {
                removeTag(idx);
            } else {
                addTag(clickedTag);
            }
        };
    });
}

function refreshTagChipsUI() {
    const container = document.getElementById('tag-chips-container');
    if (container) container.innerHTML = renderTagChips();
    const suggestionsContainer = document.getElementById('tag-suggestions-container');
    if (suggestionsContainer) suggestionsContainer.innerHTML = renderTagSuggestions();
    setupTagChipListeners();
    setupTagPillListeners();
}

function addTag(name) {
    const tag = name.trim();
    if (!tag) return;
    if (!currentEditingQuestion.tags) currentEditingQuestion.tags = [];
    if (!currentEditingQuestion.tags.includes(tag)) {
        currentEditingQuestion.tags.push(tag);
        refreshTagChipsUI();
    }
}

function removeTag(idx) {
    if (!currentEditingQuestion.tags) return;
    currentEditingQuestion.tags.splice(idx, 1);
    refreshTagChipsUI();
}

function renameTag(idx, newName) {
    const name = newName.trim();
    if (!name || !currentEditingQuestion.tags) return;
    if (!currentEditingQuestion.tags.includes(name) || currentEditingQuestion.tags[idx] === name) {
        currentEditingQuestion.tags[idx] = name;
        refreshTagChipsUI();
    }
}

function setupTagChipListeners() {
    const container = document.getElementById('tag-chips-container');
    if (!container) return;

    // Delete buttons
    container.querySelectorAll('.tag-chip-delete').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            removeTag(parseInt(btn.dataset.idx));
        };
    });

    // Double-click chip text to rename
    container.querySelectorAll('.tag-chip').forEach(chip => {
        chip.ondblclick = (e) => {
            if (e.target.classList.contains('tag-chip-delete')) return;
            const idx = parseInt(chip.dataset.idx);
            const currentTag = (currentEditingQuestion.tags || [])[idx] || '';
            const chipText = chip.querySelector('.tag-chip-text');
            if (!chipText) return;

            const input = document.createElement('input');
            input.type = 'text';
            input.value = currentTag;
            input.className = 'tag-chip-rename-input';
            input.style.cssText = 'border:none; background:transparent; font-size:inherit; color:inherit; width:auto; min-width:60px; max-width:140px; outline:none; padding:0;';

            chipText.replaceWith(input);
            input.focus();
            input.select();

            const confirm = () => {
                const newName = input.value.trim() || currentTag;
                renameTag(idx, newName);
            };
            input.onblur = confirm;
            input.onkeydown = (e) => {
                if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
                if (e.key === 'Escape') { input.value = currentTag; input.blur(); }
            };
        };
    });
}

function renderAnswerSection() {
    const q = currentEditingQuestion;
    const category = getQuestionCategory(q.type || '');

    const explanationBlock = `
        <div class="editor-input-group">
            <div class="label-row">
                <label>${t('explanation_label')}</label>
                <button class="btn btn-primary-soft btn-xs wrap-code-btn" data-target="edit-explanation">${t('wrap_code_btn')}</button>
            </div>
            <textarea class="editor-field code-font" id="edit-explanation" style="min-height: 120px;">${q.answer?.explanation || ''}</textarea>
        </div>`;

    // Choice: the correct answer is marked in the Options tab.
    // Reading/topic: prose card, there is nothing to answer.
    if (category !== 'text') {
        return explanationBlock;
    }

    // Text-based: accepted answers + case sensitivity + explanation
    const acceptedTexts = (q.answer?.accepted_texts || []).join('\n');
    return `
        <div class="editor-input-group">
            <label>${t('accepted_texts_label')}</label>
            <textarea class="editor-field" id="edit-accepted-texts" style="min-height: 90px;" placeholder="${t('accepted_texts_placeholder')}">${acceptedTexts}</textarea>
        </div>
        <div style="display: flex; align-items: center; gap: 0.75rem; padding: 0.25rem 0 0.5rem;">
            <input type="checkbox" id="edit-case-sensitive" ${q.answer?.caseSensitive ? 'checked' : ''} style="width: 18px; height: 18px; flex-shrink: 0;">
            <label for="edit-case-sensitive" style="font-size: 0.85rem; font-weight: 600; cursor: pointer;">${t('case_sensitive_label')}</label>
        </div>
        ${explanationBlock}`;
}

function renderTagSuggestions() {
    if (!currentEditingQuestion || !currentEditingQuestion.sourceId) return '';
    const source = AppState.sources.find(s => s.id === currentEditingQuestion.sourceId);
    if (!source || !source.questions) return '';

    const allTags = new Set();
    source.questions.forEach(q => {
        if (q.tags && Array.isArray(q.tags)) {
            q.tags.forEach(tag => allTags.add(tag));
        }
    });

    if (allTags.size === 0) return '';

    const currentTags = (document.getElementById('edit-tags')?.value || (currentEditingQuestion.tags || []).join(', '))
        .split(/[,;]/).map(t => t.trim()).filter(t => t !== '');

    return Array.from(allTags).sort().map(tag => {
        const isActive = currentTags.includes(tag);
        return `
            <span class="tag-pill ${isActive ? 'active' : ''}" data-tag="${tag}">${tag}</span>
        `;
    }).join('');
}

function setupEditorListeners() {
    const overlay = document.getElementById('questionEditorOverlay');
    
    // The message reports why the last save was refused, so any move the user
    // makes in response retires it; the next save re-raises it if still true.
    const dismissError = () => { editorError = null; };

    // Group navigation
    overlay.querySelectorAll('.group-btn').forEach(btn => {
        btn.onclick = () => {
            syncDataFromInputs(); // Sync before switching
            activeGroup = btn.dataset.group;
            dismissError();
            renderEditorModal();
        };
    });

    // Changing the type reshapes the question immediately: the tab strip, the
    // sections and the answer controls all follow from it, so redraw at once
    // instead of waiting for the next tab click.
    const typeSelect = document.getElementById('edit-type');
    if (typeSelect) {
        typeSelect.onchange = () => {
            syncDataFromInputs();
            normalizeForType();
            dismissError();
            renderEditorModal();
        };
    }

    // New tag input: Enter key or + button
    const newTagInput = document.getElementById('new-tag-input');
    const addTagBtn = document.getElementById('add-tag-btn');
    if (newTagInput) {
        newTagInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addTag(newTagInput.value);
                newTagInput.value = '';
            }
        };
    }
    if (addTagBtn) {
        addTagBtn.onclick = () => {
            addTag(newTagInput?.value || '');
            if (newTagInput) newTagInput.value = '';
        };
    }

    // Initial chip setup
    setupTagChipListeners();

    // Tag suggestion pills: clicking toggles tag on/off
    setupTagPillListeners();

    // Correct answer radio/checkbox visual sync
    setupOptionCorrectListeners();

    // Wrap Code buttons
    overlay.querySelectorAll('.wrap-code-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            const targetId = btn.dataset.target;
            const idx = btn.dataset.idx;
            
            let textarea;
            if (targetId) {
                textarea = document.getElementById(targetId);
            } else if (idx !== undefined) {
                textarea = document.querySelectorAll('.opt-text-field')[idx];
            }
            
            if (textarea) {
                wrapCodeSelection(textarea);
                syncDataFromInputs();
            }
        };
    });

    // Add option
    const addBtn = document.getElementById('add-option-btn');
    if (addBtn) {
        addBtn.onclick = () => {
            syncDataFromInputs();
            if (!currentEditingQuestion.options) currentEditingQuestion.options = [];
            
            // Calculate next ID
            const maxId = currentEditingQuestion.options.reduce((max, o) => Math.max(max, parseInt(o.id) || 0), 0);
            currentEditingQuestion.options.push({
                id: maxId + 1,
                text: '',
                media: []
            });
            dismissError();
            renderEditorModal();
        };
    }

    // Delete option
    overlay.querySelectorAll('.delete-opt-btn').forEach(btn => {
        btn.onclick = () => {
            syncDataFromInputs();
            const idx = parseInt(btn.dataset.idx);
            currentEditingQuestion.options.splice(idx, 1);
            dismissError();
            renderEditorModal();
        };
    });

    // Cancel
    document.getElementById('editor-cancel-btn').onclick = closeQuestionEditor;

    // Save
    document.getElementById('editor-save-btn').onclick = () => {
        syncDataFromInputs();
        // Refuse to persist a question that contradicts its own type, and land
        // the user on the tab that needs fixing with the reason in the header —
        // previously this failed silently, since a toast cannot show above the
        // editor overlay.
        const problem = validateQuestion();
        if (problem) {
            activeGroup = problem.group;
            editorError = problem.message;
            renderEditorModal();
            return;
        }
        applyChangesToState();
    };

    // Overlay click to close
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            closeQuestionEditor();
        }
    };
}

function wrapCodeSelection(textarea) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selection = text.substring(start, end);
    const before = text.substring(0, start);
    const after = text.substring(end);

    textarea.value = before + '<code>' + selection + '</code>' + after;
    
    // Restore selection
    textarea.focus();
    textarea.setSelectionRange(start + 6, start + 6 + selection.length);
}

function syncDataFromInputs() {
    if (!currentEditingQuestion) return;

    // The fields on screen were rendered for the type the question currently
    // holds, so read them against that — the <select> may already show a newer
    // type the DOM has not been rebuilt for yet. The new type is adopted last.
    const renderedCategory = getQuestionCategory(currentEditingQuestion.type || '');

    // General
    const type = document.getElementById('edit-type');
    const diff = document.getElementById('edit-difficulty');
    if (diff) currentEditingQuestion.difficulty = parseFloat(diff.value) || 1.5;
    // Tags are managed directly in currentEditingQuestion.tags via chip UI — no sync needed here

    // Content
    const text = document.getElementById('edit-text');
    const mType = document.getElementById('edit-media-type');
    const mUrl = document.getElementById('edit-media-url');
    const mPos = document.getElementById('edit-media-pos');
    
    if (text) {
        if (!currentEditingQuestion.content) currentEditingQuestion.content = {};
        currentEditingQuestion.content.text = text.value;
        currentEditingQuestion.text = text.value; // Sync both for compatibility
    }

    if (mType) {
        if (!currentEditingQuestion.content) currentEditingQuestion.content = {};
        if (mType.value) {
            currentEditingQuestion.content.media = [{
                type: mType.value,
                url: mUrl?.value || '',
                position: mPos?.value || 'above'
            }];
        } else {
            currentEditingQuestion.content.media = [];
        }
    }

    // Options
    const optFields = document.querySelectorAll('.opt-text-field');
    const optMediaTypes = document.querySelectorAll('.opt-media-type');
    const optMediaUrls = document.querySelectorAll('.opt-media-url');

    optFields.forEach((field, idx) => {
        if (currentEditingQuestion.options?.[idx]) {
            currentEditingQuestion.options[idx].text = field.value;
            
            const mType = optMediaTypes[idx]?.value;
            const mUrl = optMediaUrls[idx]?.value;
            
            if (mType) {
                currentEditingQuestion.options[idx].media = [{
                    type: mType,
                    url: mUrl || '',
                    position: 'above' // Options media is usually above text in this app's logic
                }];
            } else {
                currentEditingQuestion.options[idx].media = [];
            }
        }
    });

    if (renderedCategory === 'flashcard') {
        const front = document.getElementById('edit-fc-front');
        const back = document.getElementById('edit-fc-back');
        if (front) { currentEditingQuestion.content = { text: front.value }; }
        if (back) {
            if (!currentEditingQuestion.answer) currentEditingQuestion.answer = {};
            currentEditingQuestion.answer.back = back.value;
        }
        if (type) currentEditingQuestion.type = type.value;
        return;
    }

    // Answer
    if (!currentEditingQuestion.answer) currentEditingQuestion.answer = {};

    const expl = document.getElementById('edit-explanation');
    if (expl) currentEditingQuestion.answer.explanation = expl.value;

    if (renderedCategory === 'choice') {
        // Doğru cevap(lar) radio/checkbox seçiminden okunur
        const checked = [...document.querySelectorAll('.answer-option-input:checked')];
        currentEditingQuestion.answer.correct_ids = checked.map(el => parseInt(el.value));
    } else {
        // Metin cevabı: her satır ayrı bir kabul edilen cevap
        const acceptedTexts = document.getElementById('edit-accepted-texts');
        const caseSensitive = document.getElementById('edit-case-sensitive');
        if (acceptedTexts) {
            currentEditingQuestion.answer.accepted_texts = acceptedTexts.value
                .split('\n').map(s => s.trim()).filter(s => s !== '');
        }
        if (caseSensitive) currentEditingQuestion.answer.caseSensitive = caseSensitive.checked;
    }

    if (type) currentEditingQuestion.type = type.value;
}

function applyChangesToState() {
    const qId = currentEditingQuestion.id;
    const sourceId = currentEditingQuestion.sourceId;

    // Find the source in AppState
    const source = AppState.sources.find(s => s.id === sourceId);
    if (!source) {
        showToast("Source not found!");
        return;
    }

    // Find the question in the source
    const idx = source.questions.findIndex(q => q.id === qId);
    if (idx === -1) {
        showToast("Question not found in source!");
        return;
    }

    // Update the question
    // Important: We keep sourceId and other internal fields that might not be in the editor
    // Update the question
    // Important: We keep sourceId and other internal fields that might not be in the editor
    const updatedQuestion = {
        ...source.questions[idx],
        ...currentEditingQuestion
    };
    
    source.questions[idx] = updatedQuestion;

    // Sync back to stats for algorithm consistency
    const statKey = `${sourceId}_${qId}`;
    if (!AppState.stats[statKey]) {
        AppState.stats[statKey] = { correct: 0, wrong: 0, difficulty: 5.0 };
    }
    
    // Convert 1-5 scale from UI/Metadata to 1-10 internal scale
    const uiDiff = parseFloat(currentEditingQuestion.difficulty) || 2.5;
    AppState.stats[statKey].difficulty = uiDiff * 2;
    // Also sync legacy coefficient for backward compatibility if needed by any older logic
    AppState.stats[statKey].coeff = (uiDiff - 1) * (2.9 / 4) + 1.3;

    // Save and refresh
    saveSources();
    saveStats();
    
    showToast(t('save_success'));
    
    document.getElementById('questionEditorOverlay').style.display = 'none';

    // Refresh UI
    if (window.renderQuestionPreview) {
        window.renderQuestionPreview(updatedQuestion, null, AppState.currentPreviewSource);
    }
    
    if (window.renderStatsList) {
        window.renderStatsList(AppState.activeStatsFilter);
    }

    if (window.updateHomeStats) {
        window.updateHomeStats();
    }
}
