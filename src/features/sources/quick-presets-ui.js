import { AppState, saveSources, saveQuickPresets, trackDeletedQuickPreset, savePresetSessionData, clearPresetSessionData, findMatchingPresetId, clearActiveTest } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import { showConfirm, showToast } from '../../core/utils.js';
import { applySwatch, applyPresetBar, addCurrentAsPreset, generateAutoName } from './quick-presets.js';
import { buildQuestionPool } from '../test/test-engine.js';
import { renderSourcePicker } from './sources-ui.js';
import { persist } from '../../core/storage.js';

export function updateQuickSourcesDot() {
    const btn = document.getElementById('quickSourcesBtn');
    const nameLabel = document.getElementById('quickSourcesActiveName');
    if (!btn) return;

    const activeSources = (AppState.sources || []).filter(s => s.active && !s.archived);
    const activeIds = activeSources.map(s => s.id).sort();

    if (activeIds.length === 0) {
        btn.dataset.hasPreset = 'false';
        if (nameLabel) {
            nameLabel.textContent = '';
            nameLabel.style.display = 'none';
        }
        return;
    }

    const matchedPreset = (AppState.quickPresets || []).find(p => {
        if (!p.sourceIds || p.sourceIds.length !== activeIds.length) return false;
        const pSorted = [...p.sourceIds].sort();
        return pSorted.every((id, idx) => id === activeIds[idx]);
    });

    if (matchedPreset) {
        btn.dataset.hasPreset = 'true';
        if (nameLabel) {
            nameLabel.textContent = matchedPreset.name;
            nameLabel.title = matchedPreset.name;
            nameLabel.style.display = 'inline-block';
        }
    } else {
        btn.dataset.hasPreset = 'false';
        if (nameLabel) {
            nameLabel.textContent = '';
            nameLabel.style.display = 'none';
        }
    }
}

export function applyPreset(preset) {
    if (!preset || !preset.sourceIds) return;

    // 1. Freeze & save current workspace environment if active sources match a preset
    const currentPresetId = findMatchingPresetId();
    if (currentPresetId && AppState.currentTest && AppState.currentTest.length > 0) {
        savePresetSessionData(currentPresetId, {
            currentTest: AppState.currentTest,
            currentIndex: AppState.currentIndex,
            userAnswers: AppState.userAnswers,
            isAnswerChecked: AppState.isAnswerChecked,
            shuffledOptionsMap: AppState.shuffledOptionsMap,
            testTracking: AppState.testTracking
        });
    }

    // 2. Set new active sources
    const targetSet = new Set(preset.sourceIds);
    (AppState.sources || []).forEach(s => {
        if (s.archived) return;
        s.active = targetSet.has(s.id);
    });

    if (preset.sourceIds.length > 0) {
        AppState.currentSourceKey = preset.sourceIds[0];
        persist('focus_app_current_source', AppState.currentSourceKey);
    }

    saveSources();

    // 3. Restore or Reset session and land on Home view (#homeStatsCard)
    const savedSession = AppState.presetSessions ? AppState.presetSessions[preset.id] : null;
    if (savedSession && savedSession.currentTest && savedSession.currentTest.length > 0) {
        AppState.currentTest = savedSession.currentTest;
        AppState.currentIndex = savedSession.currentIndex || 0;
        AppState.userAnswers = savedSession.userAnswers || {};
        AppState.isAnswerChecked = savedSession.isAnswerChecked || {};
        AppState.shuffledOptionsMap = savedSession.shuffledOptionsMap || {};
        AppState.testTracking = savedSession.testTracking || null;
        persist('focus_app_active_test', savedSession);

        buildQuestionPool();
    } else {
        AppState.currentTest = [];
        AppState.currentIndex = 0;
        AppState.userAnswers = {};
        AppState.isAnswerChecked = {};
        AppState.shuffledOptionsMap = {};
        AppState.testTracking = null;
        clearActiveTest();
    }

    if (typeof window.switchView === 'function') window.switchView('home');
    if (typeof window.checkActiveTest === 'function') window.checkActiveTest();

    if (typeof window.updateHomeStats === 'function') window.updateHomeStats();
    if (typeof window.renderSourcesList === 'function') window.renderSourcesList();
    if (typeof window.onSourcesUpdated === 'function') window.onSourcesUpdated();

    updateQuickSourcesDot();
}

function updateAddCurrentButtonState() {
    const addLabel = document.getElementById('qsAddCurrentLabel');
    const addBtn = document.getElementById('qsAddCurrentBtn');
    if (!addBtn) return;

    const activeSources = (AppState.sources || []).filter(s => s.active && !s.archived);
    const activeCount = activeSources.length;

    if (addLabel) {
        if (activeCount > 1) {
            addLabel.textContent = t('qs_add_current_multiple') || 'Add Active Sources';
        } else {
            addLabel.textContent = t('qs_add_current_single') || 'Add Active Source';
        }
    }

    const activeIds = activeSources.map(s => s.id).sort();
    if (activeIds.length === 0) {
        addBtn.disabled = true;
        addBtn.title = t('qs_no_active') || 'No active sources';
    } else {
        const isDuplicate = (AppState.quickPresets || []).some(p => {
            if (!p.sourceIds || p.sourceIds.length !== activeIds.length) return false;
            const pSorted = [...p.sourceIds].sort();
            return pSorted.every((id, idx) => id === activeIds[idx]);
        });

        if (isDuplicate) {
            addBtn.disabled = true;
            addBtn.title = t('qs_duplicate_warning') || 'This source preset is already saved in Quick Access';
        } else {
            addBtn.disabled = false;
            addBtn.removeAttribute('title');
        }
    }
}

export function showQuickPresetsManageModal() {
    const overlay = document.getElementById('quickPresetsManageOverlay');
    if (!overlay) return;

    updateAddCurrentButtonState();
    renderManageList();
    overlay.classList.add('active');
}

export function closeQuickPresetsManageModal() {
    const overlay = document.getElementById('quickPresetsManageOverlay');
    if (overlay) overlay.classList.remove('active');
}

function renderManageList() {
    const container = document.getElementById('qpmPresetsList');
    if (!container) return;

    updateAddCurrentButtonState();
    container.innerHTML = '';
    const presets = AppState.quickPresets || [];

    if (presets.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'quick-sources-empty';
        emptyDiv.textContent = t('qs_empty');
        container.appendChild(emptyDiv);
        return;
    }

    const sorted = [...presets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    sorted.forEach((preset, index) => {
        const row = document.createElement('div');
        row.className = 'qpm-row';
        row.dataset.presetId = preset.id;
        row.draggable = true;

        const handle = document.createElement('div');
        handle.className = 'drag-handle';
        handle.setAttribute('aria-label', t('qs_drag_reorder'));
        handle.setAttribute('title', t('qs_drag_reorder'));
        handle.innerHTML = `<svg width="16" height="24" viewBox="0 0 16 24" fill="currentColor"><circle cx="6" cy="6" r="1.5"/><circle cx="10" cy="6" r="1.5"/><circle cx="6" cy="12" r="1.5"/><circle cx="10" cy="12" r="1.5"/><circle cx="6" cy="18" r="1.5"/><circle cx="10" cy="18" r="1.5"/></svg>`;

        const mainContent = document.createElement('div');
        mainContent.className = 'qpm-main-content';

        const nameWrapper = document.createElement('div');
        nameWrapper.className = 'qpm-name-wrapper';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'qpm-name-text';
        nameSpan.textContent = preset.name;
        nameSpan.setAttribute('title', t('qs_name_hint'));
        nameSpan.contentEditable = 'false';
        nameSpan.spellcheck = false;

        // Count questions in non-archived sources included in preset
        const presetSources = (AppState.sources || []).filter(s => preset.sourceIds.includes(s.id) && !s.archived);
        const questionCount = presetSources.reduce((acc, s) => acc + (s.questions ? s.questions.length : 0), 0);

        const countSpan = document.createElement('span');
        countSpan.className = 'qs-count';
        countSpan.textContent = questionCount;

        const barSpan = document.createElement('div');
        barSpan.className = 'qpm-proportional-bar';
        applyPresetBar(barSpan, preset);

        // Helper to trigger inline editing
        const startInlineEdit = () => {
            nameSpan.contentEditable = 'true';
            nameSpan.classList.add('editing');
            nameSpan.focus();
            try {
                const range = document.createRange();
                range.selectNodeContents(nameSpan);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            } catch (err) {
                // Ignore selection fallback
            }
        };

        const finishInlineEdit = (saveChanges) => {
            if (!nameSpan.classList.contains('editing')) return;
            nameSpan.classList.remove('editing');
            nameSpan.contentEditable = 'false';

            if (saveChanges) {
                const newName = nameSpan.textContent.trim();
                if (newName && newName !== preset.name) {
                    preset.name = newName;
                    preset.updatedAt = Date.now();
                    saveQuickPresets();
                } else {
                    nameSpan.textContent = preset.name;
                }
            } else {
                nameSpan.textContent = preset.name;
            }
        };

        nameSpan.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            startInlineEdit();
        });

        nameSpan.addEventListener('click', (e) => {
            if (nameSpan.classList.contains('editing')) {
                e.stopPropagation();
                return;
            }
            applyPreset(preset);
            closeQuickPresetsManageModal();
        });

        nameSpan.addEventListener('keydown', (e) => {
            if (!nameSpan.classList.contains('editing')) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                nameSpan.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finishInlineEdit(false);
            }
        });

        nameSpan.addEventListener('blur', () => {
            finishInlineEdit(true);
        });

        nameWrapper.appendChild(nameSpan);
        nameWrapper.appendChild(countSpan);
        mainContent.appendChild(nameWrapper);
        mainContent.appendChild(barSpan);

        const actions = document.createElement('div');
        actions.className = 'qpm-actions';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'icon-btn qpm-edit-btn';
        editBtn.setAttribute('title', t('qs_edit_preset'));
        editBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
        `;
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            /* Renaming is still here - it is the one thing this button always
               did - but it is no longer all it can do. A quick group IS its
               sources, and until now the only way to change them was to switch
               the right sources on somewhere else and re-save the group, which
               meant leaving this screen to edit what this screen is about. */
            openPresetEditModal(preset, () => renderManageList());
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'icon-btn qpm-delete-btn';
        deleteBtn.setAttribute('title', t('qs_delete_preset'));
        deleteBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
        `;
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const confirmed = await showConfirm(
                t('qs_delete_confirm') || 'This quick access item will be removed. Are you sure?',
                t('qs_delete_title') || 'Remove from Quick Access'
            );
            if (confirmed) {
                deletePreset(preset.id);
                renderManageList();
            }
        });

        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);

        row.appendChild(handle);
        row.appendChild(mainContent);
        row.appendChild(actions);

        // Drag and drop events
        row.addEventListener('dragstart', (e) => {
            row.classList.add('dragging');
            e.dataTransfer.setData('text/plain', index.toString());
        });

        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
        });

        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            const draggingRow = container.querySelector('.dragging');
            if (draggingRow && draggingRow !== row) {
                const rect = row.getBoundingClientRect();
                const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
                container.insertBefore(draggingRow, next ? row.nextSibling : row);
            }
        });

        row.addEventListener('drop', (e) => {
            e.preventDefault();
            const rows = [...container.querySelectorAll('.qpm-row')];
            rows.forEach((r, idx) => {
                const pid = r.dataset.presetId;
                const p = (AppState.quickPresets || []).find(item => item.id === pid);
                if (p) {
                    p.order = idx;
                    p.updatedAt = Date.now();
                }
            });
            saveQuickPresets();
        });

        container.appendChild(row);
    });
}

function deletePreset(id) {
    if (!id) return;
    AppState.quickPresets = (AppState.quickPresets || []).filter(p => p.id !== id);
    trackDeletedQuickPreset(id);
    clearPresetSessionData(id);
    saveQuickPresets();
    updateQuickSourcesDot();
}

export function setupQuickPresets() {
    const btn = document.getElementById('quickSourcesBtn');
    const addBtn = document.getElementById('qsAddCurrentBtn');

    // Clicking quickSourcesBtn directly opens the modal popup overlay
    if (btn) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            showQuickPresetsManageModal();
        });
    }

    // Add current selection inside manage modal
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const newPreset = addCurrentAsPreset();
            if (newPreset) {
                renderManageList();
                updateQuickSourcesDot();
            }
        });
    }

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const manageOverlay = document.getElementById('quickPresetsManageOverlay');
            if (manageOverlay && manageOverlay.classList.contains('active')) {
                closeQuickPresetsManageModal();
                if (btn) btn.focus();
            }
        }
    });

    // Manage modal listeners
    const qpmClose = document.getElementById('qpmCloseBtn');
    const qpmDone = document.getElementById('qpmDoneBtn');

    if (qpmClose) qpmClose.addEventListener('click', closeQuickPresetsManageModal);
    if (qpmDone) qpmDone.addEventListener('click', closeQuickPresetsManageModal);

    // Initial dot status
    updateQuickSourcesDot();
}

/** Same set of sources, in any order. */
function sameSourceSet(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    const sa = [...a].sort();
    const sb = [...b].sort();
    return sa.every((id, i) => id === sb[i]);
}

/** A group name no other group carries yet: the base, then "base (2)"... */
export function uniquePresetName(base) {
    const root = (typeof base === 'string' ? base.trim() : '') || generateAutoName();
    const taken = new Set((AppState.quickPresets || []).map(p => p.name));
    if (!taken.has(root)) return root;
    let n = 2;
    while (taken.has(`${root} (${n})`)) n++;
    return `${root} (${n})`;
}

function presetQuestionCount(preset) {
    return (AppState.sources || [])
        .filter(s => (preset.sourceIds || []).includes(s.id) && !s.archived)
        .reduce((acc, s) => acc + (s.questions ? s.questions.length : 0), 0);
}

/**
 * Quick access seen from ONE source (the source actions dialog): every group,
 * with this source's membership as the toggle, plus a way to start a new group
 * from it. Three things this dialog used to be missing:
 * - there was no way to CREATE a group here, only to join existing ones - a
 *   library with no groups yet showed an empty list and a dead end;
 * - taking the last source out left a group with no sources, which starts a
 *   test with no questions and only disappeared at the next sync prune. It now
 *   asks and removes the group - the same outcome the edit modal enforces by
 *   refusing to save an empty group;
 * - a row carried only a name. It now shows what the manage list shows (bar,
 *   question count) and has the same pencil into the full group editor.
 */
export function showSourceQuickPresetsModal(source) {
    if (!source) return;
    const overlay = document.getElementById('sourceQuickPresetsOverlay');
    const subTitle = document.getElementById('sourceQuickPresetsSub');
    const listContainer = document.getElementById('sourceQuickPresetsList');
    const closeXBtn = document.getElementById('sourceQuickPresetsCloseXBtn');
    const newBtn = document.getElementById('sqpNewPresetBtn');

    if (!overlay || !listContainer) return;

    if (subTitle) {
        subTitle.textContent = source.name || t('untitled_source');
    }

    const closeSelf = () => {
        overlay.classList.remove('active');
        if (closeXBtn) closeXBtn.onclick = null;
        if (newBtn) newBtn.onclick = null;
        overlay.onclick = null;
    };

    const afterChange = () => {
        updateQuickSourcesDot();
        if (typeof window.updateHomeStats === 'function') window.updateHomeStats();
        renderList();
    };

    const toggleMembership = async (preset) => {
        const ids = preset.sourceIds || [];
        if (ids.includes(source.id)) {
            if (ids.length === 1) {
                const confirmed = await showConfirm(
                    t('qs_remove_last_confirm', { name: preset.name }),
                    t('qs_delete_title')
                );
                if (!confirmed) return;
                deletePreset(preset.id);
                afterChange();
                return;
            }
            preset.sourceIds = ids.filter(id => id !== source.id);
        } else {
            /* The editor refuses a second group with the same set of sources;
               joining one here must not be the way around that. */
            const next = [...ids, source.id];
            if ((AppState.quickPresets || []).some(p => p.id !== preset.id && sameSourceSet(p.sourceIds, next))) {
                showToast(t('qs_duplicate_warning'));
                return;
            }
            preset.sourceIds = next;
        }
        preset.updatedAt = Date.now();
        saveQuickPresets();
        afterChange();
    };

    const renderList = () => {
        listContainer.innerHTML = '';
        const presets = [...(AppState.quickPresets || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        if (presets.length === 0) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'quick-sources-empty';
            emptyDiv.style.padding = '1.5rem 1rem';
            emptyDiv.style.textAlign = 'center';
            emptyDiv.style.color = 'var(--text-secondary)';
            emptyDiv.style.fontSize = '0.9rem';
            emptyDiv.textContent = t('qs_empty');
            listContainer.appendChild(emptyDiv);
            return;
        }

        presets.forEach(preset => {
            const isIncluded = (preset.sourceIds || []).includes(source.id);

            const row = document.createElement('div');
            row.className = `sqp-preset-row ${isIncluded ? 'active' : ''}`;
            row.dataset.presetId = preset.id;
            row.title = isIncluded ? t('qs_toggle_remove') : t('qs_toggle_add');

            const infoDiv = document.createElement('div');
            infoDiv.className = 'sqp-preset-info';

            const barSpan = document.createElement('div');
            barSpan.className = 'qpm-proportional-bar sqp-preset-bar';
            applyPresetBar(barSpan, preset);

            const nameSpan = document.createElement('span');
            nameSpan.className = 'sqp-preset-name';
            nameSpan.textContent = preset.name;

            const countSpan = document.createElement('span');
            countSpan.className = 'qs-count';
            countSpan.textContent = presetQuestionCount(preset);

            infoDiv.appendChild(barSpan);
            infoDiv.appendChild(nameSpan);
            infoDiv.appendChild(countSpan);

            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'icon-btn qpm-edit-btn sqp-edit-btn';
            editBtn.setAttribute('title', t('qs_edit_preset'));
            editBtn.setAttribute('aria-label', t('qs_edit_preset'));
            editBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            `;
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openPresetEditModal(preset, afterChange);
            });

            const checkDiv = document.createElement('div');
            checkDiv.className = 'sqp-check-icon';
            checkDiv.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

            row.appendChild(infoDiv);
            row.appendChild(editBtn);
            row.appendChild(checkDiv);

            row.onclick = () => toggleMembership(preset);

            listContainer.appendChild(row);
        });
    };

    renderList();
    overlay.classList.add('active');

    if (newBtn) {
        /* The new group opens in the full editor, pre-filled with this source
           and its name, so the user can add more sources or rename it first.
           It is a draft until Save: cancelling creates nothing. */
        newBtn.onclick = () => {
            const draft = {
                id: 'qp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                name: uniquePresetName(source.name),
                sourceIds: [source.id],
                color: null,
                order: (AppState.quickPresets || []).length,
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            openPresetEditModal(draft, afterChange, { isNew: true });
        };
    }

    if (closeXBtn) closeXBtn.onclick = closeSelf;
    overlay.onclick = (e) => {
        if (e.target === overlay) closeSelf();
    };
}



/* ── Editing one quick group ────────────────────────────────────────────────
   Name and sources in one place. The source list is renderSourcePicker(), the
   same component the focus-source popup uses, rather than a second list that
   would drift from it - folders, counts, selected state and the folded-by-
   default behaviour all come for free.

   `max: Infinity` because a quick group has no ceiling: it is the user's own
   study set, not the focus streak's three. The picker's limit toast simply
   never fires. */
let presetEditPicker = null;

export function openPresetEditModal(preset, onSaved, { isNew = false } = {}) {
    const overlay = document.getElementById('presetEditOverlay');
    const nameInput = document.getElementById('presetEditNameInput');
    const listEl = document.getElementById('presetEditSourceList');
    const countEl = document.getElementById('presetEditCount');
    if (!overlay || !nameInput || !listEl) return;

    nameInput.value = preset.name || '';

    const paintCount = (n) => {
        if (countEl) countEl.textContent = t('qs_group_selected_count', { count: n });
    };

    presetEditPicker = renderSourcePicker(listEl, {
        selected: [...(preset.sourceIds || [])],
        max: Infinity,
        /* Open, unlike the focus picker. That one opens onto the whole library
           with nothing chosen yet, so folding it lets the user pick a folder
           first. This one is about ONE group's membership: folding it hides
           the very sources the user came here to look at. */
        startCollapsed: false,
        onChange: (ids) => paintCount(ids.length)
    });
    paintCount((preset.sourceIds || []).length);

    const close = () => {
        overlay.classList.remove('active');
        presetEditPicker = null;
    };

    document.getElementById('presetEditCloseBtn').onclick = close;
    document.getElementById('presetEditCancelBtn').onclick = close;

    document.getElementById('presetEditSaveBtn').onclick = () => {
        const newName = nameInput.value.trim();
        if (!newName) {
            showToast(t('qs_group_name_required'));
            nameInput.focus();
            return;
        }
        const ids = presetEditPicker ? presetEditPicker.getSelected() : [];
        /* A group with no sources starts a test with no questions, so it is
           refused here rather than left to fail later with nothing to explain
           it. Deleting the group is the other button on the row. */
        if (ids.length === 0) {
            showToast(t('qs_group_needs_source'));
            return;
        }

        /* The same set saved twice is two rows that do the same thing -
           addCurrentAsPreset refuses it, and so does this. */
        const duplicate = (AppState.quickPresets || []).some(p => p.id !== preset.id && sameSourceSet(p.sourceIds, ids));
        if (duplicate) {
            showToast(t('qs_duplicate_warning'));
            return;
        }

        preset.name = newName;
        preset.sourceIds = ids;
        /* The stamp is what carries this edit to the other devices: quick
           presets merge by id on updatedAt, so an unstamped change is one the
           merge cannot see and the next pull writes over. */
        preset.updatedAt = Date.now();
        /* A new group is a draft until here, so a cancelled one leaves nothing. */
        if (isNew && !(AppState.quickPresets || []).some(p => p.id === preset.id)) {
            if (!Array.isArray(AppState.quickPresets)) AppState.quickPresets = [];
            AppState.quickPresets.push(preset);
        }
        saveQuickPresets();
        showToast(t(isNew ? 'qs_group_created' : 'qs_group_saved'));
        close();
        if (typeof onSaved === 'function') onSaved();
    };

    overlay.classList.add('active');
    nameInput.focus();
}
