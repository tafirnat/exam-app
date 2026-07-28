import { AppState, saveSources, saveStats } from '../../core/state.js';
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

    // Attempt Web Share API (Level 1 - Text)
    if (navigator.share) {
        try {
            await navigator.share({
                title: source.name,
                text: jsonStr
            });
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Share failed:', err);
            }
        }
    } else {
        // Fallback for browsers that don't support sharing at all (like some desktops)
        // In this case, downloading is the best alternative
        downloadSourceJSON(source);
    }
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
        await resetSourceStats(source.id);
    };

    downloadBtn.onclick = () => {
        closeActions();
        downloadSourceJSON(source);
    };

    shareBtn.onclick = () => {
        closeActions();
        shareSourceJSON(source);
    };

    closeBtn.onclick = closeActions;
    
    // Also close on overlay click
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

export function renderSourcesList() {
    const container = document.getElementById('sourcesList');
    if (!container) return;

    container.innerHTML = '';

    // Update source count badge
    const countEl = document.getElementById('sourcesCount');
    if (countEl) {
        const n = AppState.sources.length;
        countEl.textContent = n > 0 ? t('questions_count', { count: n }) : '';
    }

    // Sort by last used
    const sortedSources = [...AppState.sources].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));

    sortedSources.forEach(s => {
        if (!s) return;
        const item = document.createElement('div');
        item.className = `source-item ${s.active ? 'active' : ''}`;

        // Let's use CSS for styling instead of inline as much as possible, but keeping current pattern
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.justifyContent = 'space-between';
        item.style.padding = '0.75rem';
        item.style.border = '1px solid var(--border-color)';
        item.style.borderRadius = 'var(--radius-md)';
        item.style.marginBottom = '0.5rem';
        item.style.backgroundColor = s.active ? 'var(--surface-hover)' : 'var(--surface-color)';
        item.style.gap = '0.5rem';

        const info = document.createElement('div');
        info.style.flex = '1';
        info.style.cursor = 'pointer';
        info.style.minWidth = '0'; // For text truncation
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

        // Simpler: success rate = correct / (correct + wrong) across all answered questions
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

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '0.5rem';
        actions.style.alignItems = 'center';

        const delBtn = document.createElement('button');
        delBtn.className = 'icon-btn';
        delBtn.style.color = 'var(--error-color)';
        delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            removeSource(e.target.closest('.source-item').dataset.id || s.id); // Guard against missing ID if needed
        };

        item.appendChild(info);
        actions.appendChild(actionsBtn);
        actions.appendChild(delBtn);
        item.appendChild(actions);
        container.appendChild(item);
    });

    // Trigger callback if needed for UI updates elsewhere
    if (window.onSourcesUpdated) window.onSourcesUpdated();
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
