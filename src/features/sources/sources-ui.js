import { AppState, saveSources, saveStats, saveFolders } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import { showConfirm, showAlert } from '../../core/utils.js';

export function toggleSource(id) {
    let activeCount = 0;
    AppState.sources.forEach(s => {
        if (s.id === id) {
            s.active = !s.active;
            if (s.active) {
                s.lastUsed = Date.now();
                // When a source is activated, we set it as the "focused" source 
                // but keep other active sources as well.
                import('../../core/state.js').then(m => m.saveCurrentSource(id));
            } else if (AppState.currentSourceKey === id) {
                // If the currently focused source is deactivated, find another active one or null
                const anotherActive = AppState.sources.find(s => s.active && s.id !== id);
                import('../../core/state.js').then(m => m.saveCurrentSource(anotherActive ? anotherActive.id : null));
            }
        }
        if (s.active) activeCount++;
    });

    saveSources();
    renderSourcesList();
    if (window.onSourcesUpdated) window.onSourcesUpdated();
}

export async function removeSource(id) {
    const source = AppState.sources.find(s => s.id === id);
    if (!source) return;
    if (!await showConfirm(t('confirm_remove_source', { name: '' }))) return;
    const oldName = source.name;
    
    // 1. Purge related stats
    Object.keys(AppState.stats).forEach(key => {
        if (key.startsWith(`${id}_`)) {
            delete AppState.stats[key];
        }
    });
    
    // 2. Purge related global history entries
    import('../../core/state.js').then(m => {
        AppState.recentTests = AppState.recentTests.filter(entry => entry.sourceId !== id);
        m.saveRecentTests();
    });

    // 3. Remove from sources and track deletion for sync
    AppState.sources = AppState.sources.filter(s => s.id !== id);
    import('../../core/state.js').then(m => {
        if (typeof m.trackDeletedSource === 'function') m.trackDeletedSource(id);
    }).catch(() => {});
    
    if (AppState.currentSourceKey === id) {
        import('../../core/state.js').then(m => m.saveCurrentSource(null));
    }

    saveStats();
    saveSources();
    renderSourcesList();
    if (window.onSourcesUpdated) window.onSourcesUpdated();
    showAlert(t('source_removed_msg', { name: oldName }), t('info_title'));
}

export async function resetSourceStats(id) {
    if (!await showConfirm(t('confirm_reset_source'))) return;
    const source = AppState.sources.find(s => s.id === id);
    if (!source) return;

    // 1. Purge all related stats (composite keys)
    Object.keys(AppState.stats).forEach(key => {
        if (key.startsWith(`${id}_`)) {
            delete AppState.stats[key];
        }
    });

    // 2. Clear per-source logs
    source.testResults = [];
    source.wrongData = [];

    saveStats();
    saveSources(); // To save the cleared logs in the source object
    renderSourcesList();
    if (window.onSourcesUpdated) window.onSourcesUpdated();
    showAlert(t('source_reset_msg', { name: source.name }), t('info_title'));
}

export function getCleanSourceData(source) {
    return {
        exam_metadata: source.metadata || { title: source.name },
        questions: (source.questions || []).map(q => {
            const cleanQ = {
                id: q.id,
                type: q.type,
                text: q.text || q.content?.text,
                options: q.options || q.content?.options,
                answer: q.answer || q.content?.answer
            };
            if (q.content?.media) cleanQ.media = q.content.media;
            return cleanQ;
        })
    };
}

export async function downloadSourceJSON(source) {
    const cleanData = getCleanSourceData(source);
    const jsonStr = JSON.stringify(cleanData, null, 2);
    const fileName = `${source.name.replace(/\s+/g, '_')}_original.json`;
    const blob = new Blob([jsonStr], { type: 'application/json' });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export async function shareSourceJSON(source) {
    const cleanData = getCleanSourceData(source);
    const jsonStr = JSON.stringify(cleanData, null, 2);

    const overlay = document.getElementById('shareOptionsOverlay');
    const nameEl = document.getElementById('shareOptionsSourceName');
    const hintBox = document.getElementById('shareLargeDataHint');
    const hintText = document.getElementById('shareLargeDataHintText');

    const copyBtn = document.getElementById('shareCopyClipboardBtn');
    const textBtn = document.getElementById('shareAsTextBtn');
    const fileBtn = document.getElementById('shareAsFileBtn');
    const closeBtn = document.getElementById('shareOptionsCloseBtn');

    if (!overlay || !copyBtn || !textBtn || !fileBtn || !closeBtn) {
        // Basic fallback if modal elements are missing
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(jsonStr);
            showToast(t('copy_success'));
        }
        return;
    }

    if (nameEl) nameEl.textContent = source.name;

    // Karakter 500+ uyarısı
    if (jsonStr.length > 500) {
        if (hintBox && hintText) {
            hintText.textContent = t('share_large_data_hint', { count: jsonStr.length });
            hintBox.style.display = 'flex';
        }
    } else {
        if (hintBox) hintBox.style.display = 'none';
    }

    overlay.classList.add('active');

    const closeShareOptions = () => {
        overlay.classList.remove('active');
        copyBtn.onclick = null;
        textBtn.onclick = null;
        fileBtn.onclick = null;
        closeBtn.onclick = null;
        overlay.onclick = null;
    };

    // 1. Panoya Kopyala (Copy to Clipboard - Pure JSON string for easy pasting)
    copyBtn.onclick = async () => {
        closeShareOptions();
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(jsonStr);
                showToast(t('copy_success'));
            } else {
                const textArea = document.createElement('textarea');
                textArea.value = jsonStr;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                showToast(t('copy_success'));
            }
        } catch (err) {
            console.error('Clipboard copy failed:', err);
        }
    };

    // 2. Metin Olarak Paylaş (Share Text via Web Share API)
    textBtn.onclick = async () => {
        closeShareOptions();
        if (navigator.share) {
            try {
                await navigator.share({
                    title: source.name,
                    text: jsonStr
                });
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Share text failed:', err);
                }
            }
        } else {
            // Fallback to clipboard copy if Web Share API is unavailable
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(jsonStr);
                    showToast(t('copy_success'));
                }
            } catch (e) {
                downloadSourceJSON(source);
            }
        }
    };

    // 3. JSON Dosyası Olarak Paylaş (Share JSON File)
    fileBtn.onclick = async () => {
        closeShareOptions();
        const sanitizeFileName = (source.name || 'exam_source').replace(/\s+/g, '_');
        const fileName = `${sanitizeFileName}.json`;
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const file = new File([blob], fileName, { type: 'application/json' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({
                    title: source.name,
                    files: [file]
                });
                return;
            } catch (err) {
                if (err.name === 'AbortError') return;
                console.error('File share failed, falling back to download:', err);
            }
        }

        // Fallback for browsers that don't support file sharing
        downloadSourceJSON(source);
    };

    closeBtn.onclick = closeShareOptions;

    overlay.onclick = (e) => {
        if (e.target === overlay) closeShareOptions();
    };
}


export function showSourceActions(source) {
    const overlay = document.getElementById('sourceActionsOverlay');
    const nameEl = document.getElementById('sourceActionsName');
    const resetBtn = document.getElementById('modalResetBtn');
    const downloadBtn = document.getElementById('modalDownloadBtn');
    const shareBtn = document.getElementById('modalShareBtn');
    const editBtn = document.getElementById('modalEditMetadataBtn');
    const closeBtn = document.getElementById('sourceActionsCloseBtn');

    if (!overlay || !nameEl || !resetBtn || !downloadBtn || !shareBtn || !editBtn || !closeBtn) return;

    nameEl.textContent = source.name;
    overlay.classList.add('active');

    // Add Move to Folder logic dynamically
    let moveContainer = document.getElementById('moveToFolderContainer');
    if (!moveContainer) {
        moveContainer = document.createElement('div');
        moveContainer.id = 'moveToFolderContainer';
        moveContainer.style.marginBottom = '0.5rem';
        moveContainer.style.borderBottom = '1px solid var(--border-color)';
        moveContainer.style.paddingBottom = '1rem';
        
        const actionsBody = overlay.querySelector('.modal-body');
        if (actionsBody) actionsBody.prepend(moveContainer);
    }
    
    if (AppState.folders && AppState.folders.length > 0) {
        let optionsHtml = `<option value="">-- ${t('move_to_folder')} --</option>`;
        optionsHtml += `<option value="root">${t('root_folder')}</option>`;
        AppState.folders.forEach(f => {
            optionsHtml += `<option value="${f.id}" ${source.folderId === f.id ? 'selected' : ''}>${f.name}</option>`;
        });
        
        moveContainer.innerHTML = `
            <select id="moveToFolderSelect" class="menu-select" style="width: 100%; padding: 0.85rem; border-radius: var(--radius-md); font-size: 0.9rem;">
                ${optionsHtml}
            </select>
        `;
        moveContainer.style.display = 'block';
        
        const selectEl = document.getElementById('moveToFolderSelect');
        selectEl.onchange = (e) => {
            const val = e.target.value;
            if (val === 'root') {
                source.folderId = null;
            } else if (val) {
                source.folderId = val;
            }
            source.order = AppState.sources.filter(s => s.folderId === source.folderId).length;
            saveSources();
            renderSourcesList();
            overlay.classList.remove('active');
        };
    } else {
        moveContainer.style.display = 'none';
    }

    const closeActions = () => {
        overlay.classList.remove('active');
        resetBtn.onclick = null;
        downloadBtn.onclick = null;
        shareBtn.onclick = null;
        editBtn.onclick = null;
        closeBtn.onclick = null;
    };

    editBtn.onclick = () => {
        closeActions();
        showEditMetadata(source);
    };

    const deleteBtn = document.getElementById('modalDeleteBtn');
    if (deleteBtn) {
        deleteBtn.onclick = () => {
            closeActions();
            removeSource(source.id);
        };
    }

    resetBtn.onclick = async () => {
        closeActions();
        // The resetSourceStats function exists in scope
        await resetSourceStats(source.id);
    };

    downloadBtn.onclick = () => {
        closeActions();
        // The downloadSourceJSON exists
        downloadSourceJSON(source);
    };

    shareBtn.onclick = () => {
        closeActions();
        shareSourceJSON(source);
    };

    closeBtn.onclick = closeActions;
    overlay.onclick = (e) => {
        if (e.target === overlay) closeActions();
    };
}
export function showEditMetadata(source) {
    const overlay = document.getElementById('editMetadataOverlay');
    const titleInput = document.getElementById('editMetaTitle');
    const categoryInput = document.getElementById('editMetaCategory');
    const descInput = document.getElementById('editMetaDescription');
    const saveBtn = document.getElementById('editMetaSaveBtn');
    const cancelBtn = document.getElementById('editMetaCancelBtn');

    if (!overlay || !titleInput || !categoryInput || !descInput || !saveBtn || !cancelBtn) return;

    // Populate with current values
    const meta = source.metadata || {};
    titleInput.value = meta.title || source.name || '';
    categoryInput.value = meta.category || '';
    descInput.value = meta.description || '';

    overlay.classList.add('active');

    const closeEdit = () => {
        overlay.classList.remove('active');
        saveBtn.onclick = null;
        cancelBtn.onclick = null;
    };

    saveBtn.onclick = () => {
        const newTitle = titleInput.value.trim();
        const newCategory = categoryInput.value.trim();
        const newDesc = descInput.value.trim();

        // Validation
        const finalTitle = newTitle || meta.title || source.name || t('untitled_source');
        const finalCategory = newCategory || meta.category || 'General';
        const finalDesc = newDesc || meta.description || '';

        source.metadata = {
            ...(source.metadata || {}),
            title: finalTitle,
            category: finalCategory,
            description: finalDesc
        };
        source.name = finalTitle;

        saveSources();
        renderSourcesList();
        if (window.onSourcesUpdated) window.onSourcesUpdated();
        
        closeEdit();
    };

    cancelBtn.onclick = closeEdit;
    overlay.onclick = (e) => {
        if (e.target === overlay) closeEdit();
    };
}


// --- Drag and Drop State ---
let collapsedFolders = new Set();

// Single source of truth for the active drag operation.
const dragState = {
    item: null,         // the dragged folder/source object
    type: null,         // 'folder' | 'source'
    fromFolderId: null, // folder the source was dragged out of (null = root)
    indicatorEl: null,  // element currently showing the drop indicator
    indicatorMode: null // 'before' | 'after' | 'inside'
};

// The row that is temporarily allowed to be dragged (armed by its grip handle).
let armedRow = null;

export function initFolderManagement() {
    const addBtn = document.getElementById('addFolderBtn');
    if(addBtn) addBtn.onclick = () => showFolderManageModal(null);
}

const ROOT_KEY = '__root__';
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
const folderKeyOf = (s) => s.folderId || ROOT_KEY;

// Sources/folders created before drag&drop existed have no `order` at all, which
// made partially ordered lists collapse to "everything at index 0". Rebuilding a
// dense 0..n-1 order per group before every render keeps drop math predictable.
function normalizeOrders() {
    const groups = new Map();
    AppState.sources.forEach(s => {
        // Normalize undefined -> null so group lookups never split root items.
        if (!s.folderId) s.folderId = null;
        const key = folderKeyOf(s);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(s);
    });
    groups.forEach(list => {
        list.sort(byOrder);
        list.forEach((s, i) => { s.order = i; });
    });

    const folders = [...(AppState.folders || [])].sort(byOrder);
    folders.forEach((f, i) => { f.order = i; });
}

// --- Drag handle (grip) arming -------------------------------------------------
// Rows are NOT draggable by default: a drag may only be initiated from the grip,
// so scrolling, clicking chips or selecting text never starts a move.
function armRow(row) {
    if (armedRow && armedRow !== row) armedRow.draggable = false;
    armedRow = row;
    row.draggable = true;
}

function disarmRow() {
    if (armedRow) armedRow.draggable = false;
    armedRow = null;
}

function createDragHandle(row) {
    const handle = document.createElement('div');
    handle.className = 'drag-handle';
    handle.setAttribute('aria-label', 'drag');
    handle.innerHTML = `<svg width="16" height="24" viewBox="0 0 16 24" fill="currentColor"><circle cx="6" cy="6" r="1.5"/><circle cx="10" cy="6" r="1.5"/><circle cx="6" cy="12" r="1.5"/><circle cx="10" cy="12" r="1.5"/><circle cx="6" cy="18" r="1.5"/><circle cx="10" cy="18" r="1.5"/></svg>`;
    handle.addEventListener('mousedown', (e) => { e.stopPropagation(); armRow(row); });
    handle.addEventListener('touchstart', () => armRow(row), { passive: true });
    return handle;
}

// --- Drop indicator ------------------------------------------------------------
function clearDropIndicator() {
    if (dragState.indicatorEl) {
        dragState.indicatorEl.classList.remove('drop-before', 'drop-after', 'drop-inside');
    }
    // Defensive sweep in case a render replaced the tracked element.
    document.querySelectorAll('.drop-before, .drop-after, .drop-inside')
        .forEach(el => el.classList.remove('drop-before', 'drop-after', 'drop-inside'));
    dragState.indicatorEl = null;
    dragState.indicatorMode = null;
}

function setDropIndicator(el, mode) {
    if (dragState.indicatorEl === el && dragState.indicatorMode === mode) return;
    clearDropIndicator();
    el.classList.add(`drop-${mode}`);
    dragState.indicatorEl = el;
    dragState.indicatorMode = mode;
}

// Resolves the pointer position to exactly one drop position, or null when the
// pointer is over something that is not a valid target (headers, stats, gaps...).
function resolveDropTarget(e) {
    const container = document.getElementById('sourcesList');
    if (!container || !dragState.type || !dragState.item) return null;
    if (!(e.target instanceof Element)) return null;

    const row = e.target.closest('.source-item, .folder-header');
    if (!row || !container.contains(row) || row.classList.contains('dragging')) return null;

    const isHeader = row.classList.contains('folder-header');

    if (dragState.type === 'folder') {
        // Folders are always reordered relative to a whole folder block, no matter
        // whether the pointer is over its header or over one of its sources.
        const block = row.closest('.folder-container');
        if (!block || block.classList.contains('dragging')) return null;
        const folderId = block.dataset.folderId;
        if (!folderId || folderId === dragState.item.id) return null;
        const rect = block.getBoundingClientRect();
        const after = (e.clientY - rect.top) >= rect.height / 2;
        return { el: block, mode: after ? 'after' : 'before', kind: 'folder', folderId };
    }

    const rect = row.getBoundingClientRect();
    const after = (e.clientY - rect.top) >= rect.height / 2;

    if (isHeader) {
        // A source dropped on a header moves into that folder.
        const folderId = row.dataset.folderId;
        if (!folderId) return null;
        return { el: row, mode: 'inside', kind: 'folder', folderId };
    }

    const sourceId = row.dataset.sourceId;
    if (!sourceId || sourceId === dragState.item.id) return null;
    return {
        el: row,
        mode: after ? 'after' : 'before',
        kind: 'source',
        sourceId,
        folderId: row.dataset.folderId || null
    };
}

function handleDragStart(e, item, type, folderId, row) {
    // Only grip-initiated drags are allowed.
    if (row !== armedRow) {
        e.preventDefault();
        return;
    }
    dragState.item = item;
    dragState.type = type;
    dragState.fromFolderId = folderId || null;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
    document.body.classList.add('dnd-active');
    const dragged = type === 'folder' ? row.closest('.folder-container') || row : row;
    setTimeout(() => { if (dragState.item) dragged.classList.add('dragging'); }, 0);
}

function handleDragEnd() {
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    clearDropIndicator();
    document.body.classList.remove('dnd-active');
    disarmRow();
    dragState.item = null;
    dragState.type = null;
    dragState.fromFolderId = null;
}

function bindContainerDnd(container) {
    if (container.dataset.dndBound === '1') return;
    container.dataset.dndBound = '1';

    container.addEventListener('dragover', (e) => {
        if (!dragState.item) return;
        const target = resolveDropTarget(e);
        if (!target) {
            clearDropIndicator();
            return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropIndicator(target.el, target.mode);
    });

    container.addEventListener('dragleave', (e) => {
        if (!container.contains(e.relatedTarget)) clearDropIndicator();
    });

    container.addEventListener('drop', (e) => {
        if (!dragState.item) return;
        const target = resolveDropTarget(e);
        e.preventDefault();
        e.stopPropagation();
        if (target) applyDrop(target);
        handleDragEnd();
    });
}

function applyDrop(target) {
    if (dragState.type === 'folder') {
        reorderFolder(dragState.item.id, target.folderId, target.mode);
        return;
    }
    if (target.mode === 'inside') {
        moveSourceToFolder(dragState.item.id, target.folderId);
        return;
    }
    reorderSource(dragState.item.id, target.sourceId, target.folderId, target.mode);
}

function reorderFolder(draggedId, targetFolderId, mode) {
    if (!draggedId || draggedId === targetFolderId) return;
    const folders = [...(AppState.folders || [])].sort(byOrder);
    const dragged = folders.find(f => f.id === draggedId);
    if (!dragged) return;

    const rest = folders.filter(f => f.id !== draggedId);
    let insertIdx = rest.findIndex(f => f.id === targetFolderId);
    if (insertIdx === -1) insertIdx = rest.length;
    else if (mode === 'after') insertIdx++;

    rest.splice(insertIdx, 0, dragged);
    rest.forEach((f, i) => { f.order = i; });
    AppState.folders = rest;

    saveFolders();
    renderSourcesList();
}

function reorderSource(draggedId, targetSourceId, targetFolderId, mode) {
    const dragged = AppState.sources.find(s => s.id === draggedId);
    if (!dragged || draggedId === targetSourceId) return;

    const destFolderId = targetFolderId || null;
    dragged.folderId = destFolderId;

    const group = AppState.sources
        .filter(s => (s.folderId || null) === destFolderId)
        .sort(byOrder);
    const rest = group.filter(s => s.id !== draggedId);

    let insertIdx = rest.findIndex(s => s.id === targetSourceId);
    if (insertIdx === -1) insertIdx = rest.length;
    else if (mode === 'after') insertIdx++;

    rest.splice(insertIdx, 0, dragged);
    rest.forEach((s, i) => { s.order = i; });

    saveSources();
    renderSourcesList();
}

function moveSourceToFolder(draggedId, folderId) {
    const dragged = AppState.sources.find(s => s.id === draggedId);
    if (!dragged) return;
    const destFolderId = folderId || null;
    if ((dragged.folderId || null) === destFolderId) return;

    dragged.folderId = destFolderId;
    dragged.order = AppState.sources.filter(s => (s.folderId || null) === destFolderId && s.id !== draggedId).length;

    saveSources();
    renderSourcesList();
}

export function renderSourcesList() {
    const container = document.getElementById('sourcesList');
    if (!container) return;

    container.innerHTML = '';
    bindContainerDnd(container);
    normalizeOrders();

    // Check if init is needed
    if(!document.folderManagementInitialized) {
        initFolderManagement();
        document.folderManagementInitialized = true;
    }

    const countEl = document.getElementById('sourcesCount');
    if (countEl) {
        const n = AppState.sources.length;
        countEl.textContent = n > 0 ? t('questions_count', { count: n }) : '';
    }

    // Group sources
    const unassigned = AppState.sources.filter(s => !s.folderId).sort((a, b) => (a.order || 0) - (b.order || 0));
    
    // Sort folders by order
    const sortedFolders = [...(AppState.folders || [])].sort((a, b) => (a.order || 0) - (b.order || 0));

    // Render unassigned (root) items first, or at the end
    // Let's render folders first, then unassigned
    
    sortedFolders.forEach(folder => {
        const folderEl = document.createElement('div');
        folderEl.className = 'folder-container';
        folderEl.dataset.folderId = folder.id;
        folderEl.style.marginBottom = '1rem';

        const header = document.createElement('div');
        header.className = 'folder-header';
        header.dataset.folderId = folder.id;
        header.draggable = false;
        header.style.position = 'relative';
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        header.style.padding = '0.5rem';
        header.style.backgroundColor = 'var(--surface-color)';
        header.style.border = '1px solid var(--border-color)';
        header.style.borderLeft = `4px solid ${folder.color || '#3b82f6'}`;
        header.style.borderRadius = 'var(--radius-md)';
        header.style.cursor = 'pointer';
        header.style.marginBottom = '0.5rem';
        
        header.onclick = (e) => {
            if (e.target.closest('.icon-btn') || e.target.closest('.drag-handle')) return;
            if (collapsedFolders.has(folder.id)) {
                collapsedFolders.delete(folder.id);
            } else {
                collapsedFolders.add(folder.id);
            }
            renderSourcesList();
        };

        header.addEventListener('mousedown', (e) => {
            if (!e.target.closest('.drag-handle')) disarmRow();
        });
        header.ondragstart = (e) => handleDragStart(e, folder, 'folder', null, header);
        header.ondragend = handleDragEnd;

        const titleDiv = document.createElement('div');
        titleDiv.style.display = 'flex';
        titleDiv.style.alignItems = 'center';
        titleDiv.style.gap = '0.5rem';
        titleDiv.style.minWidth = '0';
        
        const folderSourcesCount = AppState.sources.filter(s => s.folderId === folder.id).length;
        // Lit as soon as at least one source inside is active, so a collapsed
        // folder still shows whether it holds a selection.
        const folderHasActive = AppState.sources.some(s => s.folderId === folder.id && s.active);

        const isCollapsed = collapsedFolders.has(folder.id);
        const toggleIcon = isCollapsed 
            ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.6;"><polyline points="9 18 15 12 9 6"></polyline></svg>`
            : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.6;"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

        titleDiv.innerHTML = `
            ${toggleIcon}
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${folder.color || '#3b82f6'}" stroke-width="2" style="margin-left: 0.2rem;">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            <div style="display: flex; flex-direction: column; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 0.4rem; min-width: 0;">
                    <span class="truncate" style="font-weight: 600; font-size: 0.95rem;">${folder.name}</span>
                    <span class="source-led ${folderHasActive ? 'on' : ''}" aria-hidden="true"></span>
                </div>
                ${folder.description ? `<span class="truncate" style="font-size: 0.7rem; color: var(--text-secondary);">${folder.description}</span>` : ''}
            </div>
        `;
        // Same grip element/markup as a source item, always the first child.
        titleDiv.prepend(createDragHandle(header));

        const countDiv = document.createElement('div');
        countDiv.style.fontSize = '3.5rem';
        countDiv.style.fontWeight = '900';
        countDiv.style.fontFamily = '"Black Ops One", Impact, sans-serif';
        countDiv.style.color = '#ffffff';
        countDiv.style.opacity = '0.08';
        countDiv.style.position = 'absolute';
        countDiv.style.right = '40px';
        countDiv.style.top = '50%';
        countDiv.style.transform = 'translateY(-50%) skewX(-5deg)';
        countDiv.style.userSelect = 'none';
        countDiv.style.lineHeight = '1';
        countDiv.style.pointerEvents = 'none';
        countDiv.textContent = folderSourcesCount;

        const editBtn = document.createElement('button');
        editBtn.className = 'icon-btn';
        editBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><rect x="4" y="4" width="7" height="7" rx="1.5" fill="${folder.color}" opacity="1"></rect><rect x="13" y="4" width="7" height="7" rx="1.5" fill="${folder.color}" opacity="0.7"></rect><rect x="4" y="13" width="7" height="7" rx="1.5" fill="${folder.color}" opacity="0.4"></rect><rect x="13" y="13" width="7" height="7" rx="1.5" fill="${folder.color}" opacity="0.2"></rect></svg>`;
        editBtn.onclick = (e) => {
            e.stopPropagation();
            showFolderManageModal(folder);
        };
        
        const actionsDiv = document.createElement('div');
        actionsDiv.style.display = 'flex';
        actionsDiv.style.alignItems = 'center';
        actionsDiv.appendChild(countDiv);
        actionsDiv.appendChild(editBtn);
        
        header.appendChild(titleDiv);
        header.appendChild(actionsDiv);
        folderEl.appendChild(header);

        // Sources inside folder
        const folderSources = AppState.sources.filter(s => s.folderId === folder.id).sort((a, b) => (a.order || 0) - (b.order || 0));
        
        const listDiv = document.createElement('div');
        listDiv.className = 'folder-list';
        listDiv.style.paddingLeft = '1rem';
        if (collapsedFolders.has(folder.id)) {
            listDiv.style.display = 'none';
        }
        
        folderSources.forEach(s => {
            listDiv.appendChild(createSourceItemDOM(s, folder.id));
        });
        
        folderEl.appendChild(listDiv);
        container.appendChild(folderEl);
    });

    // Unassigned sources
    if (unassigned.length > 0) {
        const rootDiv = document.createElement('div');
        rootDiv.className = 'folder-list';
        const label = document.createElement('div');
        label.style.fontSize = '0.8rem';
        label.style.color = 'var(--text-secondary)';
        label.style.marginBottom = '0.5rem';
        label.textContent = t('root_folder');
        rootDiv.appendChild(label);
        
        unassigned.forEach(s => {
            rootDiv.appendChild(createSourceItemDOM(s, null));
        });
        container.appendChild(rootDiv);
    }
}

function createSourceItemDOM(s, folderId) {
    const item = document.createElement('div');
    item.className = `source-item ${s.active ? 'active' : ''}`;
    item.dataset.sourceId = s.id;
    item.dataset.folderId = folderId || '';
    item.draggable = false;
    item.style.position = 'relative';
    item.style.display = 'flex';
    item.style.alignItems = 'center';
    item.style.justifyContent = 'space-between';
    item.style.padding = '0.75rem';
    item.style.border = '1px solid var(--border-color)';
    item.style.borderRadius = 'var(--radius-md)';
    item.style.marginBottom = '0.5rem';
    item.style.backgroundColor = s.active ? 'var(--surface-hover)' : 'var(--surface-color)';
    item.style.gap = '0.5rem';
    item.style.userSelect = 'none';
    item.style.webkitUserSelect = 'none';
    item.style.webkitTouchCallout = 'none';
    
    // Drag handlers (drag is only armed from the grip, see createDragHandle)
    item.addEventListener('mousedown', (e) => {
        if (!e.target.closest('.drag-handle')) disarmRow();
    });
    item.ondragstart = (e) => handleDragStart(e, s, 'source', folderId, item);
    item.ondragend = handleDragEnd;

    const grip = createDragHandle(item);

    const info = document.createElement('div');
    info.style.flex = '1';
    info.style.cursor = 'pointer';
    info.style.minWidth = '0';
    info.onclick = () => toggleSource(s.id);

    const isUrl = s.origin?.type === 'url';
    const displayPath = s.origin?.display || 'local';
    const originIcon = isUrl
        ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>'
        : '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>';

    const originContent = isUrl
        ? `<a href="${displayPath}" target="_blank" onclick="event.stopPropagation()" class="hide-mobile" style="color:inherit; text-decoration:none; display:flex; align-items:center; gap:4px;">${originIcon}<span class="truncate">${displayPath}</span></a>`
        : `<div class="hide-mobile" style="display:flex; align-items:center; gap:4px;">${originIcon}<span class="truncate">${displayPath}</span></div>`;

    const qText = s.name || t('untitled_source');
    const questions = s.questions || [];
    const totalQ = questions.length;

    let totalCorrect = 0, totalWrong = 0, totalCoeffSum = 0, answeredAny = 0;
    questions.forEach(q => {
        const st = AppState.stats[`${s.id}_${q.id}`];
        if (st && (st.correct > 0 || st.wrong > 0)) {
            totalCorrect += st.correct || 0;
            totalWrong += st.wrong || 0;
            totalCoeffSum += (st.coeff !== undefined ? st.coeff : 1.5);
            answeredAny++;
        }
    });
    const successRate = (totalCorrect + totalWrong) > 0
        ? Math.round((totalCorrect / (totalCorrect + totalWrong)) * 100)
        : null;
    const avgCoeff = answeredAny > 0
        ? (totalCoeffSum / answeredAny).toFixed(1)
        : null;

    const rateChip = successRate !== null ? `<span style="font-size:0.68rem; padding:1px 6px; border-radius:999px; background:var(--surface-hover); color:var(--text-secondary); border:1px solid var(--border-color);">✓ ${successRate}%</span>` : '';
    const coeffChip = avgCoeff !== null ? `<span style="font-size:0.68rem; padding:1px 6px; border-radius:999px; background:var(--surface-hover); color:var(--text-secondary); border:1px solid var(--border-color);">Ø ${avgCoeff}</span>` : '';

    info.innerHTML = `
        <div style="font-weight:600; font-size:0.9rem; margin-bottom: 2px; display:flex; align-items:center; gap:0.4rem; min-width:0;">
            <span class="truncate">${qText}</span>
            <span class="source-led ${s.active ? 'on' : ''}" aria-hidden="true"></span>
        </div>
        <div style="font-size:0.75rem; color:var(--text-secondary); margin-bottom: 4px; display: flex; align-items: center; gap: 6px; flex-wrap:wrap;">
            <span>${t('questions_count', { count: totalQ })}</span>
            ${s.importDate ? `<span style="opacity:0.6;">• ${s.importDate}</span>` : ''}
            ${rateChip}${coeffChip}
        </div>
        <div class="origin-tag" style="font-size:0.7rem; color:var(--primary-color); opacity:0.8; margin-top:4px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            ${originContent}
        </div>
    `;

    const actionsBtn = document.createElement('button');
    actionsBtn.className = 'icon-btn';
    actionsBtn.style.color = 'var(--primary-color)';
    actionsBtn.title = t('source_actions_title');
    actionsBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20">
            <rect x="4" y="4" width="7" height="7" rx="1.5" fill="currentColor"></rect>
            <circle cx="16.5" cy="7.5" r="3.5" class="status-dot-svg ${s.active ? 'active' : ''}" 
                stroke="currentColor" stroke-width="2" fill="none"></circle>
            <rect x="4" y="13" width="7" height="7" rx="1.5" fill="currentColor"></rect>
            <rect x="13" y="13" width="7" height="7" rx="1.5" fill="currentColor"></rect>
        </svg>
    `;
    actionsBtn.onclick = (e) => {
        e.stopPropagation();
        showSourceActions(s);
    };

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '0.5rem';
    actions.style.alignItems = 'center';
    
    actions.appendChild(actionsBtn);

    item.appendChild(grip);
    item.appendChild(info);
    item.appendChild(actions);
    
    return item;
}

export function showFolderManageModal(folder = null) {
    const overlay = document.getElementById('folderManageOverlay');
    const title = document.getElementById('folderModalTitle');
    const nameInput = document.getElementById('folderNameInput');
    const descInput = document.getElementById('folderDescInput');
    const colorInput = document.getElementById('folderColorInput');
    const colorPicker = document.getElementById('folderColorPicker');
    
    if(!overlay) return;

    const colors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899', '#f43f5e'];
    colorPicker.innerHTML = '';
    colors.forEach(c => {
        const d = document.createElement('div');
        d.style.width = '24px';
        d.style.height = '24px';
        d.style.borderRadius = '50%';
        d.style.backgroundColor = c;
        d.style.cursor = 'pointer';
        d.style.flexShrink = '0';
        d.style.border = (folder && folder.color === c) || (!folder && c === '#3b82f6') ? '2px solid var(--text-primary)' : '2px solid transparent';
        d.onclick = () => {
            colorInput.value = c;
            Array.from(colorPicker.children).forEach(child => child.style.border = '2px solid transparent');
            d.style.border = '2px solid var(--text-primary)';
        };
        colorPicker.appendChild(d);
    });

    title.textContent = folder ? t('edit_folder') : t('add_folder');
    nameInput.value = folder ? folder.name : '';
    descInput.value = folder && folder.description ? folder.description : '';
    colorInput.value = folder ? folder.color : '#3b82f6';

    const saveBtn = document.getElementById('folderManageSaveBtn');
    
    const deleteBtn = document.getElementById('folderManageDeleteBtn');
    if (deleteBtn) {
        if (folder) {
            deleteBtn.style.display = 'flex';
            deleteBtn.onclick = () => {
                overlay.classList.remove('active');
                showFolderDeleteModal(folder.id);
            };
        } else {
            deleteBtn.style.display = 'none';
        }
    }

    saveBtn.onclick = () => {
        const name = nameInput.value.trim();
        if(!name) return;
        
        if(folder) {
            folder.name = name;
            folder.description = descInput.value.trim();
            folder.color = colorInput.value;
        } else {
            AppState.folders.push({
                id: 'folder_' + Date.now(),
                name: name,
                description: descInput.value.trim(),
                color: colorInput.value,
                order: AppState.folders.length
            });
        }
        import('../../core/state.js').then(m => m.saveFolders());
        renderSourcesList();
        overlay.classList.remove('active');
    };

    document.getElementById('folderManageCancelBtn').onclick = () => overlay.classList.remove('active');
    document.getElementById('folderManageCloseBtn').onclick = () => overlay.classList.remove('active');
    
    overlay.classList.add('active');
}

export function showFolderDeleteModal(folderId) {
    const overlay = document.getElementById('folderDeleteOverlay');
    if(!overlay) return;
    
    const moveRootBtn = document.getElementById('folderDeleteMoveRootBtn');
    const delItemsBtn = document.getElementById('folderDeleteDeleteItemsBtn');
    
    const close = () => overlay.classList.remove('active');
    
    moveRootBtn.onclick = () => {
        AppState.sources.forEach(s => {
            if(s.folderId === folderId) s.folderId = null;
        });
        AppState.folders = AppState.folders.filter(f => f.id !== folderId);
        saveSources();
        import('../../core/state.js').then(m => m.saveFolders());
        renderSourcesList();
        close();
    };
    
    delItemsBtn.onclick = () => {
        const idsToDelete = AppState.sources.filter(s => s.folderId === folderId).map(s => s.id);
        AppState.sources = AppState.sources.filter(s => s.folderId !== folderId);
        
        idsToDelete.forEach(id => {
            Object.keys(AppState.stats).forEach(key => {
                if(key.startsWith(id + '_')) delete AppState.stats[key];
            });
            import('../../core/state.js').then(m => {
                if (typeof m.trackDeletedSource === 'function') m.trackDeletedSource(id);
            }).catch(() => {});
        });
        
        AppState.folders = AppState.folders.filter(f => f.id !== folderId);
        saveStats();
        saveSources();
        import('../../core/state.js').then(m => m.saveFolders());
        renderSourcesList();
        close();
    };
    
    document.getElementById('folderDeleteCancelBtn').onclick = close;
    document.getElementById('folderDeleteCloseBtn').onclick = close;
    overlay.classList.add('active');
}


export function showMergeModal() {
    const overlay = document.getElementById('mergeSourcesOverlay');
    const list = document.getElementById('mergeSourcesList');
    const confirmBtn = document.getElementById('mergeSourcesConfirmBtn');
    const cancelBtn = document.getElementById('mergeSourcesCancelBtn');

    if (!overlay || !list || !confirmBtn || !cancelBtn) return;

    list.innerHTML = '';
    const selectedIds = new Set();

    AppState.sources.forEach(s => {
        const item = document.createElement('label');
        item.className = 'merge-source-item';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '0.75rem';
        item.style.padding = '0.75rem';
        item.style.border = '1px solid var(--border-color)';
        item.style.borderRadius = 'var(--radius-md)';
        item.style.cursor = 'pointer';
        item.style.transition = 'all 0.2s ease';

        item.innerHTML = `
            <input type="checkbox" value="${s.id}" style="width: 18px; height: 18px; cursor: pointer;">
            <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 0.9rem;">${s.name}</div>
                <div style="font-size: 0.75rem; color: var(--text-secondary);">${t('questions_count', { count: s.questions?.length || 0 })}</div>
            </div>
        `;

        const cb = item.querySelector('input');
        cb.onchange = () => {
            if (cb.checked) {
                selectedIds.add(s.id);
                item.style.backgroundColor = 'var(--surface-hover)';
                item.style.borderColor = 'var(--primary-color)';
            } else {
                selectedIds.delete(s.id);
                item.style.backgroundColor = 'transparent';
                item.style.borderColor = 'var(--border-color)';
            }
            confirmBtn.disabled = selectedIds.size < 2;
        };

        list.appendChild(item);
    });

    overlay.classList.add('active');
    confirmBtn.disabled = true;

    const closeActions = () => {
        overlay.classList.remove('active');
        confirmBtn.onclick = null;
        cancelBtn.onclick = null;
    };

    confirmBtn.onclick = async () => {
        if (window.onMergeSourcesConfirm) {
            await window.onMergeSourcesConfirm(Array.from(selectedIds));
        }
        closeActions();
    };

    cancelBtn.onclick = closeActions;
    overlay.onclick = (e) => {
        if (e.target === overlay) closeActions();
    };
}

export function closeAllSourcesModals() {
    const overlays = ['sourceActionsOverlay', 'editMetadataOverlay', 'mergeSourcesOverlay'];
    overlays.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    });
}


// Global safety net: a drag that ends outside the list (cancelled, dropped on the
// page background, ESC) must never leave a highlight or an armed row behind.
document.addEventListener('dragover', (e) => {
    if (!dragState.item) return;
    const list = document.getElementById('sourcesList');
    if (!list || !(e.target instanceof Element) || !list.contains(e.target)) clearDropIndicator();
});
document.addEventListener('dragend', handleDragEnd);
document.addEventListener('drop', () => { if (dragState.item) handleDragEnd(); });
document.addEventListener('mouseup', disarmRow);
