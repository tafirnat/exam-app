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
        moveContainer.style.marginTop = '1rem';
        moveContainer.style.borderTop = '1px solid var(--border-color)';
        moveContainer.style.paddingTop = '1rem';
        
        const actionsBody = overlay.querySelector('.modal-body');
        if (actionsBody) actionsBody.appendChild(moveContainer);
    }
    
    if (AppState.folders && AppState.folders.length > 0) {
        let optionsHtml = `<option value="">-- ${t('move_to_folder')} --</option>`;
        optionsHtml += `<option value="root">${t('root_folder')}</option>`;
        AppState.folders.forEach(f => {
            optionsHtml += `<option value="${f.id}" ${source.folderId === f.id ? 'selected' : ''}>${f.name}</option>`;
        });
        
        moveContainer.innerHTML = `
            <select id="moveToFolderSelect" class="menu-select" style="width: 100%; padding: 0.5rem; border-radius: var(--radius-sm);">
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
let draggedItem = null;
let draggedType = null;
let dragSourceFolderId = null;

export function initFolderManagement() {
    const addBtn = document.getElementById('addFolderBtn');
    if(addBtn) addBtn.onclick = () => showFolderManageModal(null);
}

function handleDragStart(e, item, type, folderId) {
    draggedItem = item;
    draggedType = type;
    dragSourceFolderId = folderId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
    setTimeout(() => {
        if(e.target) e.target.classList.add('dragging');
    }, 0);
}

function handleDragEnd(e) {
    if(e.target) e.target.classList.remove('dragging');
    document.querySelectorAll('.drag-over, .drag-over-top, .drag-over-bottom').forEach(el => {
        el.classList.remove('drag-over', 'drag-over-top', 'drag-over-bottom');
    });
    draggedItem = null;
    draggedType = null;
    dragSourceFolderId = null;
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.target.closest('.source-item, .folder-header');
    if (target && !target.classList.contains('dragging')) {
        const rect = target.getBoundingClientRect();
        const y = e.clientY - rect.top;
        target.classList.remove('drag-over', 'drag-over-top', 'drag-over-bottom');
        
        if (draggedType === 'source' && target.classList.contains('folder-header')) {
            target.classList.add('drag-over');
        } else {
            if (y < rect.height / 2) target.classList.add('drag-over-top');
            else target.classList.add('drag-over-bottom');
        }
    }
}

function handleDragLeave(e) {
    const target = e.target.closest('.source-item, .folder-header');
    if (target) target.classList.remove('drag-over', 'drag-over-top', 'drag-over-bottom');
}

function handleDrop(e, targetItem, targetType, targetFolderId) {
    e.preventDefault();
    e.stopPropagation();
    
    const targetEl = e.target.closest('.source-item, .folder-header');
    if (targetEl) targetEl.classList.remove('drag-over', 'drag-over-top', 'drag-over-bottom');
    
    if (!draggedItem || draggedItem.id === targetItem.id) return;

    if (draggedType === 'folder' && targetType === 'folder') {
        const draggedIdx = AppState.folders.findIndex(f => f.id === draggedItem.id);
        const targetIdx = AppState.folders.findIndex(f => f.id === targetItem.id);
        if (draggedIdx > -1 && targetIdx > -1) {
            AppState.folders.splice(draggedIdx, 1);
            const rect = targetEl.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const insertIdx = y < rect.height / 2 ? targetIdx : targetIdx + 1;
            AppState.folders.splice(insertIdx, 0, draggedItem);
            AppState.folders.forEach((f, i) => f.order = i);
            import('../../core/state.js').then(m => m.saveFolders());
            renderSourcesList();
        }
    } else if (draggedType === 'source') {
        const sourceIdx = AppState.sources.findIndex(s => s.id === draggedItem.id);
        if (sourceIdx > -1) {
            if (targetType === 'folder' && targetEl.classList.contains('drag-over')) {
                AppState.sources[sourceIdx].folderId = targetItem.id;
                AppState.sources[sourceIdx].order = AppState.sources.filter(s => s.folderId === targetItem.id).length;
                saveSources();
                renderSourcesList();
                return;
            }

            AppState.sources[sourceIdx].folderId = targetFolderId;
            const folderItems = AppState.sources.filter(s => s.folderId === targetFolderId).sort((a, b) => (a.order || 0) - (b.order || 0));
            let itemsToReorder = folderItems.filter(s => s.id !== draggedItem.id);
            const rect = targetEl.getBoundingClientRect();
            const y = e.clientY - rect.top;
            let insertIdx = itemsToReorder.findIndex(s => s.id === targetItem.id);
            if (insertIdx === -1) insertIdx = itemsToReorder.length;
            if (y >= rect.height / 2) insertIdx++;
            itemsToReorder.splice(insertIdx, 0, AppState.sources[sourceIdx]);
            
            // Reassign orders
            itemsToReorder.forEach((s, i) => s.order = i);
            saveSources();
            renderSourcesList();
        }
    }
}

export function renderSourcesList() {
    const container = document.getElementById('sourcesList');
    if (!container) return;

    container.innerHTML = '';
    
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
        folderEl.style.marginBottom = '1rem';
        
        const header = document.createElement('div');
        header.className = 'folder-header';
        header.draggable = true;
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        header.style.padding = '0.5rem';
        header.style.backgroundColor = 'var(--surface-color)';
        header.style.border = '1px solid var(--border-color)';
        header.style.borderLeft = `4px solid ${folder.color || '#3b82f6'}`;
        header.style.borderRadius = 'var(--radius-md)';
        header.style.cursor = 'grab';
        header.style.marginBottom = '0.5rem';
        
        header.ondragstart = (e) => handleDragStart(e, folder, 'folder', null);
        header.ondragend = handleDragEnd;
        header.ondragover = handleDragOver;
        header.ondragleave = handleDragLeave;
        header.ondrop = (e) => handleDrop(e, folder, 'folder', null);

        const titleDiv = document.createElement('div');
        titleDiv.style.display = 'flex';
        titleDiv.style.alignItems = 'center';
        titleDiv.style.gap = '0.5rem';
        titleDiv.innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${folder.color || '#3b82f6'}" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            <div style="display: flex; flex-direction: column;">
                <span style="font-weight: 600; font-size: 0.95rem;">${folder.name}</span>
                ${folder.description ? `<span style="font-size: 0.7rem; color: var(--text-secondary);">${folder.description}</span>` : ''}
            </div>
        `;
        
        const editBtn = document.createElement('button');
        editBtn.className = 'icon-btn';
        editBtn.style.color = 'var(--text-secondary)';
        editBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
        editBtn.onclick = (e) => {
            e.stopPropagation();
            showFolderManageModal(folder);
        };
        
        const delBtn = document.createElement('button');
        delBtn.className = 'icon-btn';
        delBtn.style.color = 'var(--error-color)';
        delBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
        delBtn.onclick = (e) => {
            e.stopPropagation();
            showFolderDeleteModal(folder.id);
        };
        
        const actionsDiv = document.createElement('div');
        actionsDiv.style.display = 'flex';
        actionsDiv.style.gap = '0.25rem';
        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(delBtn);
        
        header.appendChild(titleDiv);
        header.appendChild(actionsDiv);
        folderEl.appendChild(header);

        // Sources inside folder
        const folderSources = AppState.sources.filter(s => s.folderId === folder.id).sort((a, b) => (a.order || 0) - (b.order || 0));
        
        const listDiv = document.createElement('div');
        listDiv.className = 'folder-list';
        listDiv.style.paddingLeft = '1rem';
        
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
    item.draggable = true;
    item.style.display = 'flex';
    item.style.alignItems = 'center';
    item.style.justifyContent = 'space-between';
    item.style.padding = '0.75rem';
    item.style.border = '1px solid var(--border-color)';
    item.style.borderRadius = 'var(--radius-md)';
    item.style.marginBottom = '0.5rem';
    item.style.backgroundColor = s.active ? 'var(--surface-hover)' : 'var(--surface-color)';
    item.style.gap = '0.5rem';
    
    // Drag handlers
    item.ondragstart = (e) => handleDragStart(e, s, 'source', folderId);
    item.ondragend = handleDragEnd;
    item.ondragover = handleDragOver;
    item.ondragleave = handleDragLeave;
    item.ondrop = (e) => handleDrop(e, s, 'source', folderId);

    const grip = document.createElement('div');
    grip.style.cursor = 'grab';
    grip.style.color = 'var(--text-secondary)';
    grip.style.display = 'flex';
    grip.style.alignItems = 'center';
    grip.style.marginRight = '0.25rem';
    grip.innerHTML = `<svg width="16" height="24" viewBox="0 0 16 24" fill="currentColor"><circle cx="6" cy="6" r="1.5"/><circle cx="10" cy="6" r="1.5"/><circle cx="6" cy="12" r="1.5"/><circle cx="10" cy="12" r="1.5"/><circle cx="6" cy="18" r="1.5"/><circle cx="10" cy="18" r="1.5"/></svg>`;

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
        <div style="font-weight:600; font-size:0.9rem; margin-bottom: 2px;">${qText}</div>
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

    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn';
    delBtn.style.color = 'var(--error-color)';
    delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
    delBtn.onclick = (e) => {
        e.stopPropagation();
        removeSource(s.id);
    };

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '0.5rem';
    actions.style.alignItems = 'center';
    
    actions.appendChild(actionsBtn);
    actions.appendChild(delBtn);

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

    const colors = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899'];
    colorPicker.innerHTML = '';
    colors.forEach(c => {
        const d = document.createElement('div');
        d.style.width = '24px';
        d.style.height = '24px';
        d.style.borderRadius = '50%';
        d.style.backgroundColor = c;
        d.style.cursor = 'pointer';
        d.style.border = (folder && folder.color === c) || (!folder && c === '#3b82f6') ? '2px solid white' : '2px solid transparent';
        d.onclick = () => {
            Array.from(colorPicker.children).forEach(el => el.style.border = '2px solid transparent');
            d.style.border = '2px solid white';
            colorInput.value = c;
        };
        colorPicker.appendChild(d);
    });

    title.textContent = folder ? t('edit_folder') : t('add_folder');
    nameInput.value = folder ? folder.name : '';
    descInput.value = folder && folder.description ? folder.description : '';
    colorInput.value = folder ? folder.color : '#3b82f6';

    const saveBtn = document.getElementById('folderManageSaveBtn');
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
