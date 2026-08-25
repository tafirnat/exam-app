import { AppState, saveSources, saveStats } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import { showToast, escapeHTML, showDecision, stableStringify } from '../../core/utils.js';
// The question type is the single source of truth for this editor: it decides
// which tabs exist, which fields render, and what a valid question looks like.
// The rules themselves live in core so the importer applies exactly the same
// ones — see question-rules.js.
import { KNOWN_TYPES, getQuestionCategory, findQuestionIssues } from '../../core/question-rules.js';
import { parseCloze } from '../../core/cloze.js';
import { renderMarkdown, renderInlineMarkdown, plainText } from '../../core/markdown.js';

let currentEditingQuestion = null;
let activeGroup = 'general';
/* Why a save was refused, shown in the editor header. It has to live inside the
   modal: showToast() paints at z-index 1000, well under the editor overlay's
   10005, so a toast raised from here would never be seen. */
let editorError = null;

/* The question exactly as it was opened, serialized. Everything the user does
   is compared against this to decide whether leaving needs to ask a question. */
let pristineSnapshot = null;

// Tab order is fixed; only membership varies by category, so a tab never moves
// position between question types.
function getGroupsForCategory(category) {
    if (category === 'flashcard') return ['general', 'flashcard'];
    if (category === 'choice') return ['general', 'content', 'options', 'answer'];
    return ['general', 'content', 'answer'];
}

/**
 * Reusable selection wrapper for Markdown toolbar buttons.
 * @param {HTMLTextAreaElement} textarea
 * @param {string} prefix
 * @param {string} suffix
 */
export function wrapSelection(textarea, prefix, suffix = '') {
    if (!textarea) return;
    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const text = textarea.value || '';
    const selection = text.substring(start, end);
    const before = text.substring(0, start);
    const after = text.substring(end);

    const insertion = selection ? (prefix + selection + suffix) : (prefix + suffix);
    textarea.value = before + insertion + after;

    textarea.focus();
    if (selection) {
        textarea.setSelectionRange(start + prefix.length, start + prefix.length + selection.length);
    } else {
        const caretPos = start + prefix.length;
        textarea.setSelectionRange(caretPos, caretPos);
    }

    try {
        const EventClass = textarea.ownerDocument?.defaultView?.Event || globalThis.Event;
        textarea.dispatchEvent(new EventClass('input', { bubbles: true }));
    } catch (e) {
        // Safe fallback
    }
}

/**
 * Legacy wrapper for code selection insertion.
 * @param {HTMLTextAreaElement} textarea
 */
export function wrapCodeSelection(textarea) {
    wrapSelection(textarea, '`', '`');
}

/**
 * Generates compact Markdown editing toolbar HTML.
 * @param {string} targetId Textarea ID to control
 * @param {'full'|'inline'} mode Mode of toolbar buttons
 * @returns {string}
 */
function renderMarkdownToolbar(targetId, mode = 'full') {
    const isFull = mode === 'full';
    return `
        <div class="md-editor-toolbar" data-target="${targetId}">
            <button type="button" class="md-tb-btn" data-prefix="**" data-suffix="**" title="${t('md_bold_title')}"><b>B</b></button>
            <button type="button" class="md-tb-btn" data-prefix="*" data-suffix="*" title="${t('md_italic_title')}"><i>I</i></button>
            <button type="button" class="md-tb-btn" data-prefix="\`" data-suffix="\`" title="${t('md_code_title')}"><code>&lt;/&gt;</code></button>
            <button type="button" class="md-tb-btn" data-prefix="==" data-suffix="==" title="${t('md_highlight_title')}"><mark>H</mark></button>
            <button type="button" class="md-tb-btn" data-prefix="[" data-suffix="](https://)" title="${t('md_link_title')}">🔗</button>
            ${isFull ? `
            <button type="button" class="md-tb-btn" data-prefix="- " data-suffix="" title="${t('md_list_title')}">• List</button>
            <button type="button" class="md-tb-btn" data-prefix="## " data-suffix="" title="${t('md_heading_title')}">H2</button>
            <button type="button" class="md-tb-btn" data-prefix="> [!note]\n> " data-suffix="" title="${t('md_callout_title')}">📌 Callout</button>
            ` : ''}
        </div>
    `;
}

/* A cloze question's answers live inside its sentence, so the Answer tab shows
   what the markers currently yield rather than a field to type them into —
   editing happens in Question Content, where the sentence is. */
function renderClozePreview() {
    const text = currentEditingQuestion.content?.text || currentEditingQuestion.text || '';
    const { blanks } = parseCloze(text);

    if (blanks.length === 0) {
        return `<div class="code-info-box">${t('cloze_syntax_info')}</div>`;
    }

    return `
        <div class="code-info-box">${t('cloze_syntax_info')}</div>
        <div class="editor-input-group">
            <label>${t('cloze_derived_label')}</label>
            <ol class="cloze-derived-list">
                ${blanks.map(b => `
                    <li>
                        <span class="cloze-derived-answer">${escapeHTML(b.answers[0] || '')}</span>
                        ${b.answers.length > 1 ? `
                            <span class="cloze-derived-alts">${escapeHTML(b.answers.slice(1).join(' · '))}</span>` : ''}
                    </li>`).join('')}
            </ol>
        </div>`;
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
        // true_false is a closed pair: coming from a type that allowed more,
        // drop the surplus rather than leaving a third choice on a yes/no.
        if (q.type === 'true_false') q.options = q.options.slice(0, 2);

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
    pristineSnapshot = null;
}

/** Whether the editor is on screen, for callers deciding what "leave" means. */
export function isQuestionEditorOpen() {
    const overlay = document.getElementById('questionEditorOverlay');
    return !!overlay && overlay.style.display !== 'none' && !!currentEditingQuestion;
}

/**
 * Whether the fields hold anything the stored question does not.
 *
 * Reads the inputs first: the working copy is only written back on tab
 * switches and saves, so asking without syncing would call a half-typed answer
 * clean and throw it away without a word.
 */
export function isEditorDirty() {
    if (!currentEditingQuestion || pristineSnapshot === null) return false;
    syncDataFromInputs();
    return stableStringify(currentEditingQuestion) !== pristineSnapshot;
}

/**
 * Asks what to do about unsaved work, and does it.
 *
 * @returns {Promise<'saved'|'discarded'|'cancel'>} 'cancel' means the caller
 *          must not go anywhere - the user chose to stay, or the save was
 *          refused and the reason is now on screen.
 */
export async function requestEditorExit() {
    if (!isQuestionEditorOpen()) return 'discarded';
    if (!isEditorDirty()) return 'discarded';

    const answer = await showDecision(
        t('unsaved_changes_message'),
        t('unsaved_changes_title'),
        { confirm: t('save_changes'), alt: t('discard_changes'), cancel: t('cancel') }
    );

    if (answer === 'cancel') return 'cancel';
    if (answer === 'alt') return 'discarded';

    /* A refused save is not a refused exit that the user can shrug off: the
       question is still invalid, so leaving would drop the work anyway. Keep
       them here with the reason showing. */
    return saveEditor() ? 'saved' : 'cancel';
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
    pristineSnapshot = null;
    renderEditorModal();

    /* The baseline is what saving *right now* would produce, which is why it is
       taken after the first render and through the same sync the save path uses.

       Snapshotting the incoming question instead looks equivalent and is not:
       the fields normalise what they load - a question with no difficulty comes
       back as 1.5, one with no media comes back with an empty media array - so
       every question would have been "changed" the moment it was opened, and
       closing one without touching it would have asked about saving.

       Key order is normalised too, because normalizeForType() deletes and
       re-adds fields on a type switch. */
    syncDataFromInputs();
    pristineSnapshot = stableStringify(currentEditingQuestion);
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
    const tabCount = groups.length;
    const answerTabLabel = ['text', 'cloze'].includes(category)
        ? t('group_answer')
        : t('group_explanation');

    const optionsTab = isChoice ? `
                <button class="btn btn-secondary group-btn ${activeGroup === 'options' ? 'active' : ''}" data-group="options">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                    ${t('group_options')}
                </button>` : '';

    const isFixedPair = currentEditingQuestion.type === 'true_false';
    const addOptionBtn = isFixedPair ? `
                    <div class="code-info-box">${t('true_false_fixed_info')}</div>` : `
                    <button class="btn btn-subtle btn-block add-opt-btn" id="add-option-btn">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        ${t('add_option')}
                    </button>`;

    const optionsSection = isChoice ? `
                <div class="edit-section ${activeGroup === 'options' ? 'active' : ''}" id="section-options">
                    <div id="editor-options-list">
                        ${renderOptionsList()}
                    </div>
                    ${addOptionBtn}
                </div>` : '';

    const flashcardSection = isFlashcard ? `
                <div class="edit-section ${activeGroup === 'flashcard' ? 'active' : ''}" id="section-flashcard">
                    <div class="editor-input-group">
                        <label>${t('flashcard_front')}</label>
                        ${renderMarkdownToolbar('edit-fc-front', 'full')}
                        <textarea class="editor-field code-font ta-md" id="edit-fc-front">${escapeHTML(currentEditingQuestion.content?.text || '')}</textarea>
                        <div class="editor-live-preview-container">
                            <div class="editor-live-preview-label">${t('md_live_preview')}</div>
                            <div class="editor-live-preview-box md-content" id="preview-edit-fc-front"></div>
                        </div>
                    </div>
                    <div class="editor-input-group">
                        <label>${t('flashcard_back')}</label>
                        ${renderMarkdownToolbar('edit-fc-back', 'full')}
                        <textarea class="editor-field code-font ta-md" id="edit-fc-back">${escapeHTML(currentEditingQuestion.answer?.back || '')}</textarea>
                        <div class="editor-live-preview-container">
                            <div class="editor-live-preview-label">${t('md_live_preview')}</div>
                            <div class="editor-live-preview-box md-content" id="preview-edit-fc-back"></div>
                        </div>
                    </div>
                </div>` : '';

    overlay.innerHTML = `
        <div class="editor-card">
            <!-- Only visible in focus mode. Tapping "outside" is the natural way
                 out on a mouse, but on a phone focus mode leaves very little
                 outside to tap, so the way back is spelled out. -->
            <button type="button" class="editor-focus-exit" title="${escapeHTML(t('focus_mode_exit'))}" aria-label="${escapeHTML(t('focus_mode_exit'))}">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="4 14 10 14 10 20"></polyline>
                    <polyline points="20 10 14 10 14 4"></polyline>
                    <line x1="14" y1="10" x2="21" y2="3"></line>
                    <line x1="3" y1="21" x2="10" y2="14"></line>
                </svg>
            </button>
            <div class="editor-header">
                <div class="editor-header-row">
                    <h3 class="editor-title">${t('edit_question_title')}</h3>
                    <div class="editor-id">
                        <span id="editorNavCounter" class="editor-nav-counter"></span>
                        ID: ${escapeHTML(String(currentEditingQuestion.id))}
                    </div>
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
                    <div class="editor-input-group">
                        <label>${t('text_label')}</label>
                        ${renderMarkdownToolbar('edit-text', 'full')}
                        <textarea class="editor-field code-font ta-lg" id="edit-text">${escapeHTML(currentEditingQuestion.content?.text || currentEditingQuestion.text || '')}</textarea>
                        <div class="editor-live-preview-container">
                            <div class="editor-live-preview-label">${t('md_live_preview')}</div>
                            <div class="editor-live-preview-box md-content" id="preview-edit-text"></div>
                        </div>
                    </div>
                    <div class="editor-field-row">
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
                        <input type="text" class="editor-field" id="edit-media-url" value="${escapeHTML(currentEditingQuestion.content?.media?.[0]?.url || '')}">
                    </div>
                </div>
                ${optionsSection}
                <div class="edit-section ${activeGroup === 'answer' ? 'active' : ''}" id="section-answer">
                    ${renderAnswerSection()}
                </div>`}

                ${isFlashcard ? flashcardSection : ''}
            </div>

            <div class="editor-footer">
                <button class="btn btn-secondary q-nav-btn" id="editor-nav-prev" title="${escapeHTML(t('prev_question'))}" disabled>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <div class="editor-footer-main">
                    <button class="btn btn-secondary btn-flex" id="editor-cancel-btn">${t('cancel')}</button>
                    <button class="btn btn-primary btn-flex" id="editor-save-btn">${t('save_changes')}</button>
                </div>
                <button class="btn btn-secondary q-nav-btn" id="editor-nav-next" title="${escapeHTML(t('next_question'))}" disabled>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
            </div>
        </div>
    `;

    setupEditorListeners();
}

function renderTypeOptions() {
    const current = currentEditingQuestion.type || '';
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
    const isMultiple = type === 'multiple_choice';
    const isFixedPair = type === 'true_false';
    const correctIds = (currentEditingQuestion.answer?.correct_ids || []).map(String);

    return options.map((opt, idx) => {
        const isCorrect = correctIds.includes(String(opt.id));
        const inputType = isMultiple ? 'checkbox' : 'radio';

        const correctIndicator = isChoice ? `
            <label class="opt-correct-label ${isCorrect ? 'is-correct' : ''}" title="${t('mark_correct_title')}">
                <input type="${inputType}" name="correct-answer" class="answer-option-input" value="${escapeHTML(String(opt.id ?? ''))}" ${isCorrect ? 'checked' : ''}>
                <span>${isCorrect ? t('option_is_correct') : t('option_not_correct')}</span>
            </label>` : '';

        const fieldId = `edit-opt-${opt.id}`;
        return `
        <div class="option-edit-card ${isCorrect ? 'is-correct-card' : ''}" data-idx="${idx}">
            <div class="option-edit-header">
                <span class="option-id-badge">ID: ${opt.id}</span>
                ${correctIndicator}
                ${isFixedPair ? '' : `
                <button class="delete-opt-btn" data-idx="${idx}" title="${t('delete_option')}">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>`}
            </div>
            <div style="margin-bottom: 0.5rem;">
                <label class="editor-sub-label">${t('text_label')}</label>
                ${renderMarkdownToolbar(fieldId, 'inline')}
                <textarea class="editor-field code-font opt-text-field ta-sm" id="${fieldId}" data-idx="${idx}">${escapeHTML(opt.text || '')}</textarea>
                <div class="editor-live-preview-container">
                    <div class="editor-live-preview-label">${t('md_live_preview')}</div>
                    <div class="editor-live-preview-box" id="preview-${fieldId}"></div>
                </div>
            </div>
            
            <div class="editor-field-row is-tight">
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
                    <input type="text" class="editor-field opt-media-url" data-idx="${idx}" value="${escapeHTML(opt.media?.[0]?.url || '')}">
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

    container.querySelectorAll('.tag-chip-delete').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            removeTag(parseInt(btn.dataset.idx));
        };
    });

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
            <label>${t('explanation_label')}</label>
            ${renderMarkdownToolbar('edit-explanation', 'full')}
            <textarea class="editor-field code-font ta-md" id="edit-explanation">${escapeHTML(q.answer?.explanation || '')}</textarea>
            <div class="editor-live-preview-container">
                <div class="editor-live-preview-label">${t('md_live_preview')}</div>
                <div class="editor-live-preview-box md-content" id="preview-edit-explanation"></div>
            </div>
        </div>`;

    if (category === 'cloze') {
        return `${renderClozePreview()}${explanationBlock}`;
    }

    if (category !== 'text') {
        return explanationBlock;
    }

    const acceptedTexts = (q.answer?.accepted_texts || []).join('\n');
    return `
        <div class="editor-input-group">
            <label>${t('accepted_texts_label')}</label>
            <textarea class="editor-field ta-md" id="edit-accepted-texts" placeholder="${t('accepted_texts_placeholder')}">${escapeHTML(acceptedTexts)}</textarea>
        </div>
        <div class="editor-inline-row">
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

    const activeTags = new Set(currentEditingQuestion.tags || []);
    const availableTags = [...allTags].filter(t => !activeTags.has(t));
    if (availableTags.length === 0) return '';

    return availableTags.map(tag => `
        <span class="tag-pill" data-tag="${tag}">+ ${tag}</span>
    `).join('');
}

function dismissError() {
    if (editorError) {
        editorError = null;
        const errEl = document.querySelector('.editor-header .editor-error');
        if (errEl) errEl.remove();
    }
}

function setupEditorListeners() {
    const overlay = document.getElementById('questionEditorOverlay');
    if (!overlay) return;

    // Tab buttons
    overlay.querySelectorAll('.editor-group-nav .group-btn').forEach(btn => {
        btn.onclick = () => {
            syncDataFromInputs();
            activeGroup = btn.dataset.group;
            dismissError();
            renderEditorModal();
        };
    });

    // Type change: normalise stored data, then rebuild
    const typeSelect = document.getElementById('edit-type');
    if (typeSelect) {
        typeSelect.onchange = () => {
            syncDataFromInputs();
            currentEditingQuestion.type = typeSelect.value;
            normalizeForType();
            dismissError();
            renderEditorModal();
        };
    }

    // New Tag input
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

    setupTagChipListeners();
    setupTagPillListeners();
    setupOptionCorrectListeners();

    // Markdown Toolbar Button Wiring
    overlay.querySelectorAll('.md-tb-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            const toolbar = btn.closest('.md-editor-toolbar');
            const targetId = toolbar?.dataset.target;
            let textarea;
            if (targetId) {
                textarea = document.getElementById(targetId);
            }
            if (textarea) {
                wrapSelection(textarea, btn.dataset.prefix || '', btn.dataset.suffix || '');
                syncDataFromInputs();
            }
        };
    });

    // Live Preview Wiring
    const setupLivePreview = (textareaId, previewId, isInline = false) => {
        const ta = document.getElementById(textareaId);
        const prev = document.getElementById(previewId);
        if (ta && prev) {
            let timeoutId;
            const update = () => {
                prev.innerHTML = isInline ? renderInlineMarkdown(ta.value) : renderMarkdown(ta.value);
            };
            const debouncedUpdate = () => {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(update, 300);
            };
            ta.addEventListener('input', debouncedUpdate);
            update();
        }
    };

    setupLivePreview('edit-text', 'preview-edit-text', false);
    setupLivePreview('edit-fc-front', 'preview-edit-fc-front', false);
    setupLivePreview('edit-fc-back', 'preview-edit-fc-back', false);
    setupLivePreview('edit-explanation', 'preview-edit-explanation', false);

    overlay.querySelectorAll('.opt-text-field').forEach(ta => {
        if (ta.id) {
            setupLivePreview(ta.id, `preview-${ta.id}`, true);
        }
    });

    // Add option
    const addBtn = document.getElementById('add-option-btn');
    if (addBtn) {
        addBtn.onclick = () => {
            syncDataFromInputs();
            if (!currentEditingQuestion.options) currentEditingQuestion.options = [];
            
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

    /* Both ways out ask about unsaved work first. Clicking the backdrop is the
       easiest thing in this modal to do by accident, so it gets the same gate as
       the button rather than a quieter one. */
    document.getElementById('editor-cancel-btn').onclick = () => tryCloseEditor();

    // Save
    document.getElementById('editor-save-btn').onclick = () => {
        if (saveEditor()) closeQuestionEditor();
    };

    // Overlay click to close
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            tryCloseEditor();
        }
    };

    // Prev/next question, same component as the preview bar's arrows.
    const navPrev = document.getElementById('editor-nav-prev');
    const navNext = document.getElementById('editor-nav-next');
    if (navPrev) navPrev.onclick = () => window.navigateAdjacentQuestion?.(-1);
    if (navNext) navNext.onclick = () => window.navigateAdjacentQuestion?.(1);

    /* The footer is rebuilt on every render, so the arrows come back disabled
       and unlabelled unless the position is re-applied here. */
    if (typeof window.refreshQuestionNavUI === 'function') window.refreshQuestionNavUI();

    setupFocusMode(overlay);
}

/* ── Focus mode ──────────────────────────────────────────────────────────────
   Editing one field at a time. Everything else in the section, the tab strip and
   the header step aside so the field and its live preview get the screen - which
   on a phone with the keyboard up is the difference between three visible lines
   and a workable page.

   The unit of focus is the block a field belongs to, not the field itself: a
   textarea's Markdown toolbar and its preview have to stay with it. Option
   textareas live in `.option-edit-card` rather than `.editor-input-group`, so
   both count as units.

   Nothing here has to be undone on exit-by-render: the class lives on
   `.editor-card`, which every render rebuilds. That is also why a refused save
   can never leave the header - where the reason is printed - hidden. */

const FOCUS_UNIT_SELECTOR = '.editor-input-group, .option-edit-card';

function focusUnitOf(el) {
    return el && typeof el.closest === 'function' ? el.closest(FOCUS_UNIT_SELECTOR) : null;
}

function clearFocusMarks(card) {
    card.querySelectorAll('.editor-focus-unit, .editor-focus-path')
        .forEach(el => el.classList.remove('editor-focus-unit', 'editor-focus-path'));
}

function enterFocusMode(unit) {
    const card = document.querySelector('#questionEditorOverlay .editor-card');
    if (!card || !unit) return;

    clearFocusMarks(card);
    unit.classList.add('editor-focus-unit');

    /* The wrappers between the block and its section - the two-up media grid,
       the options list. Siblings are hidden by class; without marking the chain
       the rule would hide the focused block's own ancestors and take it with
       them. */
    let node = unit.parentElement;
    while (node && node !== card && !node.classList.contains('edit-section')) {
        node.classList.add('editor-focus-path');
        node = node.parentElement;
    }

    card.classList.add('is-focus-mode');
}

function exitFocusMode() {
    const card = document.querySelector('#questionEditorOverlay .editor-card');
    if (!card) return;
    card.classList.remove('is-focus-mode');
    clearFocusMarks(card);
}

/* The overlay element outlives every render - only its innerHTML is replaced -
   so these listeners are attached to it exactly once. Re-attaching per render
   piles up a copy for each paint, and every stale copy closes over the detached
   card it was born with, which is a stack of handlers making decisions about a
   card that is no longer on screen. */
let focusModeBound = false;

function setupFocusMode(overlay) {
    const exitBtn = overlay.querySelector('.editor-focus-exit');
    if (exitBtn) {
        exitBtn.onclick = () => {
            /* Blur first: leaving the field focused would have the next focusin
               put the mode straight back. On a phone this also drops the
               keyboard, which is most of the point of pressing it. */
            const active = document.activeElement;
            if (active && typeof active.blur === 'function') active.blur();
            exitFocusMode();
        };
    }

    if (focusModeBound) return;
    focusModeBound = true;

    /* Resolved per event, never captured: the card these handlers act on is
       whichever one is on screen when the event fires. */
    const liveCard = () => document.querySelector('#questionEditorOverlay .editor-card');

    overlay.addEventListener('focusin', (e) => {
        const card = liveCard();
        if (!card) return;
        const unit = focusUnitOf(e.target);

        if (e.target.tagName === 'TEXTAREA' && unit) {
            enterFocusMode(unit);
            return;
        }

        /* Focus left for something outside the unit being worked on - another
           field, the footer, the tab strip. Anything still inside the unit (the
           Markdown toolbar, a checkbox in the same block) leaves the mode alone. */
        const active = card.querySelector('.editor-focus-unit');
        if (active && !active.contains(e.target)) exitFocusMode();
    });

    /* focusin alone is not enough: clicking the empty part of the content area
       moves focus nowhere and fires nothing, so the mode would stick with no way
       out but a keystroke. pointerdown covers the whole surface.

       The footer is exempt - its buttons are the way out of the editor and the
       way to the next question, and collapsing the layout underneath a press
       that is already committed only moves things around. */
    overlay.addEventListener('pointerdown', (e) => {
        const card = liveCard();
        if (!card || !card.classList.contains('is-focus-mode')) return;
        if (e.target.closest('.editor-focus-unit')) return;
        if (e.target.closest('.editor-footer')) return;
        exitFocusMode();
    });
}

/** Cancel / backdrop: ask about unsaved work, then close unless told not to. */
async function tryCloseEditor() {
    const outcome = await requestEditorExit();
    if (outcome === 'cancel') return;
    closeQuestionEditor();
}

/**
 * Validates and writes, without deciding what happens to the modal afterwards.
 *
 * Split from closing because "save and move to the next question" needs the
 * write without the teardown - applyChangesToState() used to close the editor
 * itself, which made that sequence impossible to express.
 *
 * @returns {boolean} false when the question was refused; the reason is on screen.
 */
export function saveEditor() {
    syncDataFromInputs();
    const problem = validateQuestion();
    if (problem) {
        activeGroup = problem.group;
        editorError = problem.message;
        renderEditorModal();
        return false;
    }
    return applyChangesToState();
}

function syncDataFromInputs() {
    if (!currentEditingQuestion) return;

    const renderedCategory = getQuestionCategory(currentEditingQuestion.type || '');

    const type = document.getElementById('edit-type');
    const diff = document.getElementById('edit-difficulty');
    if (diff) currentEditingQuestion.difficulty = parseFloat(diff.value) || 1.5;

    const text = document.getElementById('edit-text');
    const mType = document.getElementById('edit-media-type');
    const mUrl = document.getElementById('edit-media-url');
    const mPos = document.getElementById('edit-media-pos');

    if (text) {
        if (!currentEditingQuestion.content) currentEditingQuestion.content = {};
        currentEditingQuestion.content.text = text.value;
        currentEditingQuestion.text = text.value;
    }

    if (mType && mUrl && mPos) {
        const url = mUrl.value.trim();
        const type = mType.value;
        const position = mPos.value;

        if (!currentEditingQuestion.content) currentEditingQuestion.content = {};
        if (url && type) {
            currentEditingQuestion.content.media = [{ type, url, position }];
        } else {
            currentEditingQuestion.content.media = [];
        }
    }

    if (renderedCategory === 'flashcard') {
        const fcFront = document.getElementById('edit-fc-front');
        const fcBack = document.getElementById('edit-fc-back');
        if (fcFront) {
            if (!currentEditingQuestion.content) currentEditingQuestion.content = {};
            currentEditingQuestion.content.text = fcFront.value;
            currentEditingQuestion.text = fcFront.value;
        }
        if (fcBack) {
            if (!currentEditingQuestion.answer) currentEditingQuestion.answer = {};
            currentEditingQuestion.answer.back = fcBack.value;
        }
    }

    if (renderedCategory === 'choice') {
        const optionCards = document.querySelectorAll('.option-edit-card');
        const options = [];
        optionCards.forEach((card, idx) => {
            const optTextField = card.querySelector('.opt-text-field');
            const optMediaType = card.querySelector('.opt-media-type');
            const optMediaUrl = card.querySelector('.opt-media-url');
            const optBadge = card.querySelector('.option-id-badge');

            const id = (optBadge && optBadge.textContent.replace('ID:', '').trim()) || (idx + 1);
            const textVal = optTextField ? optTextField.value : '';
            const mTypeVal = optMediaType ? optMediaType.value : '';
            const mUrlVal = optMediaUrl ? optMediaUrl.value.trim() : '';

            const media = (mUrlVal && mTypeVal) ? [{ type: mTypeVal, url: mUrlVal }] : [];
            options.push({ id: parseInt(id) || (idx + 1), text: textVal, media });
        });
        currentEditingQuestion.options = options;

        const checkedInputs = [...document.querySelectorAll('.answer-option-input:checked')];
        const correctIds = checkedInputs.map(el => parseInt(el.value) || 0).filter(Boolean);
        if (!currentEditingQuestion.answer) currentEditingQuestion.answer = {};
        currentEditingQuestion.answer.correct_ids = correctIds;
    }

    if (renderedCategory === 'text') {
        const accTextsEl = document.getElementById('edit-accepted-texts');
        const caseEl = document.getElementById('edit-case-sensitive');
        if (accTextsEl) {
            const texts = accTextsEl.value.split('\n').map(t => t.trim()).filter(Boolean);
            if (!currentEditingQuestion.answer) currentEditingQuestion.answer = {};
            currentEditingQuestion.answer.accepted_texts = texts;
        }
        if (caseEl) {
            if (!currentEditingQuestion.answer) currentEditingQuestion.answer = {};
            currentEditingQuestion.answer.caseSensitive = caseEl.checked;
        }
    }

    const expEl = document.getElementById('edit-explanation');
    if (expEl) {
        if (!currentEditingQuestion.answer) currentEditingQuestion.answer = {};
        currentEditingQuestion.answer.explanation = expEl.value;
    }
}

/* What a question carries only while it is being *looked at*, never what it is.
   `userAnswer` / `isCorrect` / `isUnanswered` describe one review; `sourceName`
   and `originalIndex` are labels the stats list added for its rows. */
const TRANSIENT_QUESTION_FIELDS = ['userAnswer', 'isCorrect', 'isUnanswered', 'sourceName', 'originalIndex'];

/**
 * A storable copy of the question being edited.
 *
 * The editor is opened with whatever the preview is showing, and from the
 * results screen that object carries the answer the user gave. Writing it back
 * put a stale review inside the library question itself - measured: editing a
 * question from a finished test stored `userAnswer: ["B"]` on it, and the sync
 * then carried that to every other device.
 */
function stripTransientFields(question) {
    const copy = JSON.parse(JSON.stringify(question));
    TRANSIENT_QUESTION_FIELDS.forEach(field => delete copy[field]);
    return copy;
}

function applyChangesToState() {
    if (!currentEditingQuestion) return false;

    const source = AppState.sources.find(s => s.id === currentEditingQuestion.sourceId);
    if (!source || !source.questions) return false;

    const qIdx = source.questions.findIndex(q => q.id === currentEditingQuestion.id);
    if (qIdx !== -1) {
        /* Dates the edit, on the question and on the pool that holds it.

           The pool's stamp is what mergeSyncData() picks between two copies by;
           without it the edited copy and the remote's older one scored equal, the
           remote won, and - because the push merges before it writes - the edit
           never left this device at all.

           The question's own stamp is finer-grained, and it is what lets two
           devices that edited *different* questions in the same pool both keep
           their work instead of one copy of the pool overwriting the other. */
        const now = Date.now();
        currentEditingQuestion.updatedAt = now;
        /* A copy, not the working object. Storing the working object aliases the
           library to the editor's scratch space: the next keystroke synced from
           an input would land in the source with nothing to persist it, so the
           library and the disk would disagree until something else saved. */
        source.questions[qIdx] = stripTransientFields(currentEditingQuestion);
        source.updatedAt = now;
        saveSources();

        const statKey = `${currentEditingQuestion.sourceId}_${currentEditingQuestion.id}`;
        if (!AppState.stats[statKey]) {
            AppState.stats[statKey] = { correct: 0, wrong: 0, difficulty: 2.5 };
        }
        AppState.stats[statKey].difficulty = currentEditingQuestion.difficulty * 2;
        saveStats();

        /* What is on disk is now what is on screen, so the editor is clean again
           - without this, saving and then moving on would ask about changes that
           had already been written. */
        pristineSnapshot = stableStringify(currentEditingQuestion);

        showToast(t('changes_saved'));

        if (window.onQuestionEdited) {
            window.onQuestionEdited(currentEditingQuestion);
        }
        return true;
    }
    return false;
}
