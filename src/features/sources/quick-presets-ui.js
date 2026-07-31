import { AppState, saveSources, saveQuickPresets, trackDeletedQuickPreset, savePresetSessionData, clearPresetSessionData, findMatchingPresetId, clearActiveTest } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import { showConfirm } from '../../core/utils.js';
import { applySwatch, applyPresetBar, addCurrentAsPreset } from './quick-presets.js';
import { buildQuestionPool } from '../test/test-engine.js';

export function updateQuickSourcesDot() {
    const dot = document.getElementById('quickSourcesDot');
    const btn = document.getElementById('quickSourcesBtn');
    const nameLabel = document.getElementById('quickSourcesActiveName');
    if (!dot || !btn) return;

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
        applySwatch(dot, matchedPreset);
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
        localStorage.setItem('focus_app_current_source', AppState.currentSourceKey);
    }

    saveSources();

    // 3. Restore or Reset session
    const savedSession = AppState.presetSessions ? AppState.presetSessions[preset.id] : null;
    if (savedSession && savedSession.currentTest && savedSession.currentTest.length > 0) {
        AppState.currentTest = savedSession.currentTest;
        AppState.currentIndex = savedSession.currentIndex || 0;
        AppState.userAnswers = savedSession.userAnswers || {};
        AppState.isAnswerChecked = savedSession.isAnswerChecked || {};
        AppState.shuffledOptionsMap = savedSession.shuffledOptionsMap || {};
        AppState.testTracking = savedSession.testTracking || null;
        localStorage.setItem('focus_app_active_test', JSON.stringify(savedSession));

        buildQuestionPool();

        if (typeof window.switchView === 'function') window.switchView('test');
        if (typeof window.renderQuestion === 'function') window.renderQuestion();
    } else {
        AppState.currentTest = [];
        AppState.currentIndex = 0;
        AppState.userAnswers = {};
        AppState.isAnswerChecked = {};
        AppState.shuffledOptionsMap = {};
        AppState.testTracking = null;
        clearActiveTest();

        if (typeof window.switchView === 'function') window.switchView('home');
        if (typeof window.checkActiveTest === 'function') window.checkActiveTest();
    }

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
            addLabel.textContent = t('qs_add_current_multiple') || 'Kullanılan Kaynakları Ekle';
        } else {
            addLabel.textContent = t('qs_add_current_single') || 'Kullanılan Kaynağı Ekle';
        }
    }

    const activeIds = activeSources.map(s => s.id).sort();
    if (activeIds.length === 0) {
        addBtn.disabled = true;
        addBtn.title = t('qs_no_active') || 'Aktif kaynak yok';
    } else {
        const isDuplicate = (AppState.quickPresets || []).some(p => {
            if (!p.sourceIds || p.sourceIds.length !== activeIds.length) return false;
            const pSorted = [...p.sourceIds].sort();
            return pSorted.every((id, idx) => id === activeIds[idx]);
        });

        if (isDuplicate) {
            addBtn.disabled = true;
            addBtn.title = t('qs_duplicate_warning') || 'Bu kaynak kombinasyonu zaten Hızlı Erişim\'de kayıtlı';
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
        handle.setAttribute('aria-label', 'Sürükle Sırala');
        handle.setAttribute('title', 'Sürükle Sırala');
        handle.innerHTML = `<svg width="16" height="24" viewBox="0 0 16 24" fill="currentColor"><circle cx="6" cy="6" r="1.5"/><circle cx="10" cy="6" r="1.5"/><circle cx="6" cy="12" r="1.5"/><circle cx="10" cy="12" r="1.5"/><circle cx="6" cy="18" r="1.5"/><circle cx="10" cy="18" r="1.5"/></svg>`;

        const mainContent = document.createElement('div');
        mainContent.className = 'qpm-main-content';

        const nameWrapper = document.createElement('div');
        nameWrapper.className = 'qpm-name-wrapper';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'qpm-name-text';
        nameSpan.textContent = preset.name;
        nameSpan.setAttribute('title', 'Tıkla & Uygula / İki kere tıkla ve Düzenle');
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
            startInlineEdit();
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
                t('qs_delete_confirm') || 'Bu hızlı erişim ögesi kaldırılacak. Onaylıyor musunuz?',
                t('qs_delete_title') || 'Hızlı Erişimden Kaldır'
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
