import { AppState, saveSources } from '../../core/state.js';
import { t } from '../../core/i18n.js';

export function toggleSource(id) {
    AppState.sources.forEach(s => {
        if (s.id === id) {
            s.active = !s.active;
            if (s.active) s.lastUsed = Date.now();
        }
    });
    saveSources();
    renderSourcesList();
}

export function removeSource(id) {
    if (!confirm(t('confirm_remove_source', { name: '' }))) return;
    AppState.sources = AppState.sources.filter(s => s.id !== id);
    saveSources();
    renderSourcesList();
}

export function viewSourceJSON(source) {
    const data = {
        exam_metadata: source.metadata || { title: source.name },
        questions: source.questions
    };
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
}

export function renderSourcesList() {
    const container = document.getElementById('sourcesList');
    if (!container) return;

    container.innerHTML = '';

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
            ? `<a href="${displayPath}" target="_blank" onclick="event.stopPropagation()" style="color:inherit; text-decoration:none; display:flex; align-items:center; gap:4px;">${originIcon}<span class="truncate">${displayPath}</span></a>`
            : `<div style="display:flex; align-items:center; gap:4px;">${originIcon}<span class="truncate">${displayPath}</span></div>`;

        const qText = s.name || 'Untitled Source';
        info.innerHTML = `
            <div style="font-weight:600; font-size:0.9rem; margin-bottom: 2px;">${qText}</div>
            <div style="font-size:0.75rem; color:var(--text-secondary); margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
                <span>${(s.questions || []).length} ${t('total')}</span>
                ${s.importDate ? `<span style="opacity:0.6;">• ${s.importDate}</span>` : ''}
            </div>
            <div class="origin-tag" style="font-size:0.7rem; color:var(--primary-color); opacity:0.8;">
                ${originContent}
            </div>
        `;

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '0.5rem';
        actions.style.alignItems = 'center';

        const viewBtn = document.createElement('button');
        viewBtn.className = 'icon-btn';
        viewBtn.style.color = 'var(--text-secondary)';
        viewBtn.style.fontSize = '1rem';
        viewBtn.style.fontWeight = '700';
        viewBtn.style.padding = '4px 10px';
        viewBtn.style.borderTop = '1px solid var(--border-color)';
        viewBtn.style.borderBottom = '1px solid var(--border-color)';
        viewBtn.style.borderLeft = 'none';
        viewBtn.style.borderRight = 'none';
        viewBtn.style.borderRadius = '6px';
        viewBtn.style.background = 'transparent';
        viewBtn.title = 'JSON View';

        viewBtn.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span class="status-dot ${s.active ? 'active' : ''}"></span>
                <span>JSON</span>
            </div>
        `;
        viewBtn.onclick = (e) => {
            e.stopPropagation();
            viewSourceJSON(s);
        };

        const delBtn = document.createElement('button');
        delBtn.className = 'icon-btn';
        delBtn.style.color = 'var(--error-color)';
        delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            removeSource(s.id);
        };

        item.appendChild(info);
        actions.appendChild(viewBtn);
        actions.appendChild(delBtn);
        item.appendChild(actions);
        container.appendChild(item);
    });

    // Trigger callback if needed for UI updates elsewhere
    if (window.onSourcesUpdated) window.onSourcesUpdated();
}
