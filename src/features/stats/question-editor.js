import { AppState, saveSources, saveStats } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import { showToast } from '../../core/utils.js';

let currentEditingQuestion = null;
let activeGroup = 'general';

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
    renderEditorModal();
}

function renderEditorModal() {
    let overlay = document.getElementById('questionEditorOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'questionEditorOverlay';
        overlay.className = 'editor-overlay';
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';

    overlay.innerHTML = `
        <div class="editor-card">
            <div class="editor-header">
                <h3 class="editor-title">${t('edit_question_title')}</h3>
                <div style="font-size: 0.75rem; color: var(--text-secondary);">ID: ${currentEditingQuestion.id}</div>
            </div>

            <div class="editor-group-nav">
                <button class="group-btn ${activeGroup === 'general' ? 'active' : ''}" data-group="general">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                    ${t('group_general')}
                </button>
                <button class="group-btn ${activeGroup === 'content' ? 'active' : ''}" data-group="content">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                    ${t('group_content')}
                </button>
                <button class="group-btn ${activeGroup === 'options' ? 'active' : ''}" data-group="options">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                    ${t('group_options')}
                </button>
                <button class="group-btn ${activeGroup === 'answer' ? 'active' : ''}" data-group="answer">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                    ${t('group_answer')}
                </button>
            </div>

            <div class="editor-content-area">
                <div class="edit-section ${activeGroup === 'general' ? 'active' : ''}" id="section-general">
                    <div class="editor-input-group">
                        <label>${t('type_label')}</label>
                        <select class="editor-field" id="edit-type">
                            <option value="single_choice" ${currentEditingQuestion.type === 'single_choice' ? 'selected' : ''}>single_choice</option>
                            <option value="multiple_choice" ${currentEditingQuestion.type === 'multiple_choice' ? 'selected' : ''}>multiple_choice</option>
                            <option value="true_false" ${currentEditingQuestion.type === 'true_false' ? 'selected' : ''}>true_false</option>
                            <option value="text_input" ${currentEditingQuestion.type === 'text_input' ? 'selected' : ''}>text_input</option>
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
                                <input type="text" id="new-tag-input" class="editor-field" placeholder="${t('tags_placeholder') || 'Yeni tag...'}" style="flex:1; margin:0;">
                                <button type="button" id="add-tag-btn" class="btn btn-primary" style="padding:0.4rem 0.75rem; min-width:unset;">+</button>
                            </div>
                            <div class="tag-suggestions" id="tag-suggestions-container">
                                ${renderTagSuggestions()}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="edit-section ${activeGroup === 'content' ? 'active' : ''}" id="section-content">
                    <div class="code-info-box">${t('code_usage_info')}</div>
                    <div class="editor-input-group">
                        <div class="label-row">
                            <label>${t('text_label')}</label>
                            <button class="wrap-code-btn" data-target="edit-text">${t('wrap_code_btn')}</button>
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

                <div class="edit-section ${activeGroup === 'options' ? 'active' : ''}" id="section-options">
                    <div class="code-info-box">${t('code_usage_info')}</div>
                    <div id="editor-options-list">
                        ${renderOptionsList()}
                    </div>
                    <button class="add-opt-btn" id="add-option-btn">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        ${t('add_option')}
                    </button>
                </div>

                <div class="edit-section ${activeGroup === 'answer' ? 'active' : ''}" id="section-answer">
                    <div class="editor-input-group">
                        <div class="label-row">
                            <label>${t('explanation_label')}</label>
                            <button class="wrap-code-btn" data-target="edit-explanation">${t('wrap_code_btn')}</button>
                        </div>
                        <textarea class="editor-field code-font" id="edit-explanation" style="min-height: 100px;">${currentEditingQuestion.answer?.explanation || ''}</textarea>
                    </div>
                    <div class="editor-input-group">
                        <label>${t('correct_ids_label')}</label>
                        <input type="text" class="editor-field" id="edit-correct-ids" value="${(currentEditingQuestion.answer?.correct_ids || []).join(', ')}">
                    </div>
                    <div class="editor-input-group">
                        <label>${t('accepted_texts_label')}</label>
                        <input type="text" class="editor-field" id="edit-accepted-texts" value="${(currentEditingQuestion.answer?.accepted_texts || []).join(', ')}">
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.75rem; padding-top: 0.5rem;">
                        <input type="checkbox" id="edit-case-sensitive" ${currentEditingQuestion.answer?.caseSensitive ? 'checked' : ''} style="width: 18px; height: 18px;">
                        <label for="edit-case-sensitive" style="font-size: 0.85rem; font-weight: 600;">${t('case_sensitive_label')}</label>
                    </div>
                </div>
            </div>

            <div class="editor-footer">
                <button class="btn btn-secondary" id="editor-cancel-btn">${t('cancel')}</button>
                <button class="btn btn-primary" id="editor-save-btn">${t('save_changes')}</button>
            </div>
        </div>
    `;

    setupEditorListeners();
}

function renderOptionsList() {
    const options = currentEditingQuestion.options || [];
    return options.map((opt, idx) => `
        <div class="option-edit-card" data-idx="${idx}">
            <div class="option-edit-header">
                <span class="option-id-badge">ID: ${opt.id}</span>
                <button class="delete-opt-btn" data-idx="${idx}" title="${t('delete_option')}">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
            <div class="label-row" style="margin-bottom: 4px;">
                <label style="font-size: 0.7rem;">${t('text_label')}</label>
                <button class="wrap-code-btn opt-code-btn" data-idx="${idx}">${t('wrap_code_btn')}</button>
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
    `).join('');
}

function renderTagChips() {
    const tags = currentEditingQuestion?.tags || [];
    if (tags.length === 0) return '<span style="font-size:0.78rem; color:var(--text-secondary); padding:2px 4px;">Henüz tag yok</span>';
    return tags.map((tag, idx) => `
        <span class="tag-chip" data-idx="${idx}" title="Çift tıklayarak düzenle">
            <span class="tag-chip-text">${tag}</span>
            <button type="button" class="tag-chip-delete" data-idx="${idx}" title="Sil">×</button>
        </span>
    `).join('');
}

function setupTagPillListeners() {
    const overlay = document.getElementById('question-editor-overlay');
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
    
    // Group navigation
    overlay.querySelectorAll('.group-btn').forEach(btn => {
        btn.onclick = () => {
            syncDataFromInputs(); // Sync before switching
            activeGroup = btn.dataset.group;
            renderEditorModal();
        };
    });

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
            renderEditorModal();
        };
    }

    // Delete option
    overlay.querySelectorAll('.delete-opt-btn').forEach(btn => {
        btn.onclick = () => {
            syncDataFromInputs();
            const idx = parseInt(btn.dataset.idx);
            currentEditingQuestion.options.splice(idx, 1);
            renderEditorModal();
        };
    });

    // Cancel
    document.getElementById('editor-cancel-btn').onclick = closeQuestionEditor;

    // Save
    document.getElementById('editor-save-btn').onclick = () => {
        syncDataFromInputs();
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

    // General
    const type = document.getElementById('edit-type');
    const diff = document.getElementById('edit-difficulty');
    if (type) currentEditingQuestion.type = type.value;
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
        if (currentEditingQuestion.options[idx]) {
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

    // Answer
    const expl = document.getElementById('edit-explanation');
    const correctIds = document.getElementById('edit-correct-ids');
    const acceptedTexts = document.getElementById('edit-accepted-texts');
    const caseSensitive = document.getElementById('edit-case-sensitive');

    if (expl) {
        if (!currentEditingQuestion.answer) currentEditingQuestion.answer = {};
        currentEditingQuestion.answer.explanation = expl.value;
    }
    if (correctIds) {
        if (!currentEditingQuestion.answer) currentEditingQuestion.answer = {};
        currentEditingQuestion.answer.correct_ids = correctIds.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    }
    if (acceptedTexts) {
        if (!currentEditingQuestion.answer) currentEditingQuestion.answer = {};
        currentEditingQuestion.answer.accepted_texts = acceptedTexts.value.split(',').map(s => s.trim()).filter(s => s !== '');
    }
    if (caseSensitive) {
        if (!currentEditingQuestion.answer) currentEditingQuestion.answer = {};
        currentEditingQuestion.answer.caseSensitive = caseSensitive.checked;
    }
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
