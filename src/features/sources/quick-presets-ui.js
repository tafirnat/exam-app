import { AppState, saveSources, saveQuickPresets, trackDeletedQuickPreset, liveFolders } from '../../core/state.js';
import { escapeHTML, showAlert } from '../../core/utils.js';
import { t } from '../../core/i18n.js';
import { applySwatch, addCurrentAsPreset, resolvePresetColor } from './quick-presets.js';

const PALETTE_COLORS = [
    '#ff0053', '#f75a00', '#ca8400', '#929b00', '#27ac00', '#00a97a',
    '#00a2b9', '#0098fe', '#0667ff', '#8a43ff', '#d200fe', '#ff00b7'
];

let activeEditingPreset = null;

export function updateQuickSourcesDot() {
    const dot = document.getElementById('quickSourcesDot');
    const btn = document.getElementById('quickSourcesBtn');
    if (!dot || !btn) return;

    const activeSources = (AppState.sources || []).filter(s => s.active && !s.archived);
    const activeIds = activeSources.map(s => s.id).sort();

    if (activeIds.length === 0) {
        btn.dataset.hasPreset = 'false';
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
    } else {
        btn.dataset.hasPreset = 'false';
    }
}

export function renderQuickSourcesMenu() {
    const listEl = document.getElementById('quickSourcesPresetList');
    if (!listEl) return;

    listEl.innerHTML = '';

    const presets = AppState.quickPresets || [];

    if (presets.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'quick-sources-empty';
        emptyDiv.setAttribute('data-i18n', 'qs_empty');
        emptyDiv.textContent = t('qs_empty');
        listEl.appendChild(emptyDiv);
    } else {
        // Sort by order or createdAt
        const sorted = [...presets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        sorted.forEach(preset => {
            const itemBtn = document.createElement('button');
            itemBtn.className = 'dropdown-item quick-sources-item';
            itemBtn.setAttribute('role', 'menuitem');
            itemBtn.setAttribute('data-preset-id', preset.id);

            const swatchSpan = document.createElement('span');
            swatchSpan.className = 'qs-swatch';
            applySwatch(swatchSpan, preset);

            const nameSpan = document.createElement('span');
            nameSpan.className = 'qs-name';
            nameSpan.textContent = preset.name;

            // Count questions in non-archived sources included in preset
            const presetSources = (AppState.sources || []).filter(s => preset.sourceIds.includes(s.id) && !s.archived);
            const questionCount = presetSources.reduce((acc, s) => acc + (s.questions ? s.questions.length : 0), 0);

            const countSpan = document.createElement('span');
            countSpan.className = 'qs-count';
            countSpan.textContent = questionCount;

            const editBtn = document.createElement('button');
            editBtn.className = 'icon-btn qs-edit';
            editBtn.setAttribute('data-edit-id', preset.id);
            editBtn.setAttribute('aria-label', t('qs_edit_preset'));
            editBtn.setAttribute('title', t('qs_edit_preset'));
            editBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            `;

            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeQuickSourcesMenu();
                showQuickPresetEditModal(preset);
            });

            itemBtn.appendChild(swatchSpan);
            itemBtn.appendChild(nameSpan);
            itemBtn.appendChild(countSpan);
            itemBtn.appendChild(editBtn);

            itemBtn.addEventListener('click', () => {
                applyPreset(preset);
                closeQuickSourcesMenu();
            });

            listEl.appendChild(itemBtn);
        });
    }

    updateQuickSourcesDot();
}

export function applyPreset(preset) {
    if (!preset || !preset.sourceIds) return;
    const targetSet = new Set(preset.sourceIds);

    let changed = false;
    (AppState.sources || []).forEach(s => {
        if (s.archived) return;
        const shouldBeActive = targetSet.has(s.id);
        if (s.active !== shouldBeActive) {
            s.active = shouldBeActive;
            changed = true;
        }
    });

    if (preset.sourceIds.length > 0) {
        AppState.currentSourceKey = preset.sourceIds[0];
        localStorage.setItem('focus_app_current_source', AppState.currentSourceKey);
    }

    saveSources();

    if (typeof window.updateHomeStats === 'function') window.updateHomeStats();
    if (typeof window.renderSourcesList === 'function') window.renderSourcesList();
    if (typeof window.onSourcesUpdated === 'function') window.onSourcesUpdated();

    updateQuickSourcesDot();
}

export function openQuickSourcesMenu() {
    const menu = document.getElementById('quickSourcesMenu');
    const btn = document.getElementById('quickSourcesBtn');
    if (!menu || !btn) return;

    renderQuickSourcesMenu();
    menu.removeAttribute('hidden');
    menu.classList.add('active');
    btn.setAttribute('aria-expanded', 'true');

    // Focus first menu item
    const firstItem = menu.querySelector('[role="menuitem"]');
    if (firstItem) firstItem.focus();
}

export function closeQuickSourcesMenu() {
    const menu = document.getElementById('quickSourcesMenu');
    const btn = document.getElementById('quickSourcesBtn');
    if (!menu || !btn) return;

    menu.setAttribute('hidden', '');
    menu.classList.remove('active');
    btn.setAttribute('aria-expanded', 'false');
}

export function toggleQuickSourcesMenu() {
    const menu = document.getElementById('quickSourcesMenu');
    if (menu && menu.hasAttribute('hidden')) {
        openQuickSourcesMenu();
    } else {
        closeQuickSourcesMenu();
    }
}

export function showQuickPresetEditModal(preset) {
    activeEditingPreset = preset;
    const overlay = document.getElementById('quickPresetEditOverlay');
    const nameInput = document.getElementById('qpeNameInput');
    const colorPicker = document.getElementById('qpeColorPicker');
    const colorInput = document.getElementById('qpeColorInput');
    const autoMixContainer = document.getElementById('qpeAutoMixContainer');
    const singleInfo = document.getElementById('qpeSingleInfo');
    const modeAuto = document.getElementById('qpeModeAuto');
    const modeCustom = document.getElementById('qpeModeCustom');

    if (!overlay || !nameInput || !colorPicker || !colorInput) return;

    const sources = (AppState.sources || []).filter(s => preset.sourceIds.includes(s.id));
    const folderIds = [...new Set(sources.map(s => s.folderId || null))];
    const isSingle = preset.sourceIds.length === 1;
    const isMixed = folderIds.length > 1;

    // Set Name
    if (isSingle && sources.length > 0) {
        nameInput.value = sources[0].name;
        nameInput.disabled = true;
    } else {
        nameInput.value = preset.name || '';
        nameInput.disabled = false;
    }

    // Configure Color Mode Controls
    let selectedColor = preset.color || null;

    const renderPalette = (enabled, currentColor) => {
        colorPicker.innerHTML = '';
        colorPicker.style.opacity = enabled ? '1' : '0.4';
        colorPicker.style.pointerEvents = enabled ? 'auto' : 'none';

        PALETTE_COLORS.forEach(hex => {
            const swatch = document.createElement('button');
            swatch.type = 'button';
            swatch.className = 'color-swatch-btn' + (currentColor === hex ? ' selected' : '');
            swatch.style.backgroundColor = hex;
            swatch.dataset.color = hex;

            if (enabled) {
                swatch.addEventListener('click', () => {
                    colorInput.value = hex;
                    selectedColor = hex;
                    colorPicker.querySelectorAll('.color-swatch-btn').forEach(b => b.classList.remove('selected'));
                    swatch.classList.add('selected');
                });
            }

            colorPicker.appendChild(swatch);
        });
    };

    if (isSingle) {
        if (autoMixContainer) autoMixContainer.style.display = 'none';
        if (singleInfo) singleInfo.style.display = 'block';
        colorInput.value = '';
        renderPalette(false, null);
    } else if (isMixed) {
        if (singleInfo) singleInfo.style.display = 'none';
        if (autoMixContainer) autoMixContainer.style.display = 'flex';

        if (!preset.color) {
            if (modeAuto) modeAuto.checked = true;
            colorInput.value = '';
            renderPalette(false, null);
        } else {
            if (modeCustom) modeCustom.checked = true;
            colorInput.value = preset.color;
            renderPalette(true, preset.color);
        }

        const handleModeChange = () => {
            if (modeAuto && modeAuto.checked) {
                selectedColor = null;
                colorInput.value = '';
                renderPalette(false, null);
            } else {
                selectedColor = colorInput.value || PALETTE_COLORS[0];
                colorInput.value = selectedColor;
                renderPalette(true, selectedColor);
            }
        };

        if (modeAuto) modeAuto.onchange = handleModeChange;
        if (modeCustom) modeCustom.onchange = handleModeChange;
    } else {
        // Multi-source, single folder
        if (autoMixContainer) autoMixContainer.style.display = 'none';
        if (singleInfo) singleInfo.style.display = 'none';
        colorInput.value = preset.color || '';
        renderPalette(true, preset.color);
    }

    overlay.classList.add('active');
}

export function closeQuickPresetEditModal() {
    const overlay = document.getElementById('quickPresetEditOverlay');
    if (overlay) overlay.classList.remove('active');
    activeEditingPreset = null;
}

export function showQuickPresetsManageModal() {
    const overlay = document.getElementById('quickPresetsManageOverlay');
    if (!overlay) return;
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
        handle.className = 'qpm-drag-handle';
        handle.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="8" y1="6" x2="16" y2="6"></line>
                <line x1="8" y1="12" x2="16" y2="12"></line>
                <line x1="8" y1="18" x2="16" y2="18"></line>
            </svg>
        `;

        const swatch = document.createElement('span');
        swatch.className = 'qs-swatch';
        applySwatch(swatch, preset);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'qpm-name';
        nameSpan.textContent = preset.name;

        const actions = document.createElement('div');
        actions.className = 'qpm-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'icon-btn';
        editBtn.setAttribute('title', t('qs_edit_preset'));
        editBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
        `;
        editBtn.addEventListener('click', () => {
            closeQuickPresetsManageModal();
            showQuickPresetEditModal(preset);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'icon-btn btn-danger';
        deleteBtn.setAttribute('title', t('qs_delete_preset'));
        deleteBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
        `;
        deleteBtn.addEventListener('click', () => {
            deletePreset(preset.id);
            renderManageList();
            renderQuickSourcesMenu();
        });

        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);

        row.appendChild(handle);
        row.appendChild(swatch);
        row.appendChild(nameSpan);
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
            renderQuickSourcesMenu();
        });

        container.appendChild(row);
    });
}

function deletePreset(id) {
    if (!id) return;
    AppState.quickPresets = (AppState.quickPresets || []).filter(p => p.id !== id);
    trackDeletedQuickPreset(id);
    saveQuickPresets();
    renderQuickSourcesMenu();
    updateQuickSourcesDot();
}

export function setupQuickPresets() {
    const btn = document.getElementById('quickSourcesBtn');
    const menu = document.getElementById('quickSourcesMenu');
    const addBtn = document.getElementById('qsAddCurrentBtn');
    const manageBtn = document.getElementById('qsManageBtn');

    // Button Toggle
    if (btn) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleQuickSourcesMenu();
        });
    }

    // Add current selection
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            closeQuickSourcesMenu();
            addCurrentAsPreset();
            renderQuickSourcesMenu();
        });
    }

    // Manage presets modal
    if (manageBtn) {
        manageBtn.addEventListener('click', () => {
            closeQuickSourcesMenu();
            showQuickPresetsManageModal();
        });
    }

    // Close on outside click
    document.addEventListener('click', (e) => {
        if (menu && !menu.hasAttribute('hidden')) {
            if (!menu.contains(e.target) && !btn.contains(e.target)) {
                closeQuickSourcesMenu();
            }
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (menu && !menu.hasAttribute('hidden')) {
                closeQuickSourcesMenu();
                if (btn) btn.focus();
            }
        }
    });

    // Edit modal listeners
    const qpeClose = document.getElementById('qpeCloseBtn');
    const qpeCancel = document.getElementById('qpeCancelBtn');
    const qpeSave = document.getElementById('qpeSaveBtn');
    const qpeDelete = document.getElementById('qpeDeleteBtn');

    if (qpeClose) qpeClose.addEventListener('click', closeQuickPresetEditModal);
    if (qpeCancel) qpeCancel.addEventListener('click', closeQuickPresetEditModal);

    if (qpeSave) {
        qpeSave.addEventListener('click', () => {
            if (!activeEditingPreset) return;
            const nameInput = document.getElementById('qpeNameInput');
            const colorInput = document.getElementById('qpeColorInput');
            const modeAuto = document.getElementById('qpeModeAuto');

            const isSingle = activeEditingPreset.sourceIds.length === 1;

            if (!isSingle && nameInput && nameInput.value.trim()) {
                activeEditingPreset.name = nameInput.value.trim();
            }

            if (isSingle) {
                activeEditingPreset.color = null;
            } else if (modeAuto && modeAuto.checked) {
                activeEditingPreset.color = null;
            } else if (colorInput) {
                activeEditingPreset.color = colorInput.value || null;
            }

            activeEditingPreset.updatedAt = Date.now();
            saveQuickPresets();
            closeQuickPresetEditModal();
            renderQuickSourcesMenu();
            updateQuickSourcesDot();
        });
    }

    if (qpeDelete) {
        qpeDelete.addEventListener('click', () => {
            if (!activeEditingPreset) return;
            const id = activeEditingPreset.id;
            closeQuickPresetEditModal();
            deletePreset(id);
        });
    }

    // Manage modal listeners
    const qpmClose = document.getElementById('qpmCloseBtn');
    const qpmDone = document.getElementById('qpmDoneBtn');

    if (qpmClose) qpmClose.addEventListener('click', closeQuickPresetsManageModal);
    if (qpmDone) qpmDone.addEventListener('click', closeQuickPresetsManageModal);

    // Initial render & dot status
    updateQuickSourcesDot();
}
