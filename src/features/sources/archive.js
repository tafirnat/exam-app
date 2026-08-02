import {
    AppState, saveSources, saveFolders, saveStats,
    archivedSources, trackDeletedSource, trackDeletedFolder
} from '../../core/state.js';
import {
    canUseRemoteArchive, fetchArchiveFile, writeArchiveFile, getGistUrl, scheduleSync, SyncScope
} from '../../core/github-sync.js';
import { showToast, showAlert, showConfirm, escapeHTML } from '../../core/utils.js';
import { t } from '../../core/i18n.js';
import { normalizeQuestions } from './sources-service.js';
import { renderSourcesList, downloadSourceJSON, DEFAULT_FOLDER_COLOR } from './sources-ui.js';
import { syncQuickPresetsWithLiveSources } from './quick-presets.js';

/**
 * Archiving is a flag on the source, never a move into a second collection: every
 * lookup and every sync merge already keys on AppState.sources by id, so a flag
 * keeps exactly one record per source and makes resurrection impossible.
 *
 * Questions are offloaded to the Gist archive file only AFTER that write is
 * confirmed. Until then `offloaded` stays false and the questions remain on the
 * device, so a failed or offline archive can never lose data.
 */

function nowTs() { return Date.now(); }

function sourcesOfArchivedFolder(folderId) {
    return AppState.sources.filter(s => s.archived && s.archivedFrom?.folderId === folderId);
}

/**
 * Pushes questions of the given sources into the Gist archive file.
 * Returns true only when GitHub confirmed the write.
 */
async function offloadToRemote(sources) {
    if (!canUseRemoteArchive()) return false;
    const withQuestions = sources.filter(s => Array.isArray(s.questions) && s.questions.length > 0);
    if (withQuestions.length === 0) return false;

    try {
        const map = await fetchArchiveFile();
        withQuestions.forEach(s => {
            map[s.id] = {
                name: s.name,
                archivedAt: s.archivedAt,
                metadata: s.metadata || {},
                questions: s.questions
            };
        });
        await writeArchiveFile(map);
        return true;
    } catch (err) {
        console.warn('Archive offload failed, keeping questions on device:', err);
        return false;
    }
}

async function dropFromRemote(sourceIds) {
    if (!canUseRemoteArchive()) return false;
    try {
        const map = await fetchArchiveFile();
        let changed = false;
        sourceIds.forEach(id => {
            if (map[id]) { delete map[id]; changed = true; }
        });
        if (changed) await writeArchiveFile(map);
        return true;
    } catch (err) {
        console.warn('Archive cleanup failed:', err);
        return false;
    }
}

/**
 * Marks a source archived in memory. Does not persist or offload on its own so
 * bulk folder archiving can share a single remote write.
 */
function markArchived(source, folder) {
    source.archivedFrom = {
        folderId: source.folderId || null,
        name: folder?.name || null,
        color: folder?.color || null
    };
    source.questionCount = (source.questions || []).length;
    source.archived = true;
    source.archivedAt = nowTs();
    source.updatedAt = nowTs();
    source.active = false;
    source.offloaded = false;
    // Cleared so a missed filter anywhere can never make an archived source
    // count towards a folder again; the link lives in archivedFrom.
    source.folderId = null;
}

/**
 * An archived source is out of circulation, so the FSRS clock must not keep
 * running on its questions: a source parked for six months would otherwise come
 * back with every question massively overdue and bury the daily target.
 *
 * Restoring shifts every review date forward by exactly the time spent in the
 * archive. Shifting lastReview (rather than storing a remaining-days figure)
 * preserves the whole retrievability curve, not just the moment a question falls
 * due - and the streak run orders questions by R, so the curve is what matters.
 * A question that was already overdue on the way in comes back exactly as
 * overdue as it went, never worse.
 *
 * Questions cannot be reviewed while their source is archived, so one shift per
 * restore is correct even across repeated archive/restore cycles: a question
 * reviewed between two episodes only ever sees the second one.
 *
 * Returns how many stat records moved, so the caller knows whether to persist.
 */
export function thawStatsOnRestore(source) {
    const archivedAt = Number(source?.archivedAt);
    if (!Number.isFinite(archivedAt) || archivedAt <= 0) return 0;

    const now = nowTs();
    const delta = now - archivedAt;
    if (delta <= 0) return 0;

    let shifted = 0;
    (source.questions || []).forEach(q => {
        const stat = AppState.stats[`${source.id}_${q.id}`];
        if (!stat || !stat.lastReview) return;
        const reviewedAt = new Date(stat.lastReview).getTime();
        // A corrupt date must be left alone: NaN here would make
        // calculateRetrievability return NaN and drop the question out of FSRS.
        if (!Number.isFinite(reviewedAt) || reviewedAt <= 0) return;
        stat.lastReview = new Date(Math.min(now, reviewedAt + delta)).toISOString();
        shifted++;
    });
    return shifted;
}

export async function archiveSource(sourceId) {
    const source = AppState.sources.find(s => s.id === sourceId);
    if (!source || source.archived) return false;

    if (!await showConfirm(t('archive_source_confirm', { name: source.name }), t('archive_title'))) return false;

    const folder = AppState.folders.find(f => f.id === source.folderId) || null;
    markArchived(source, folder);

    if (await offloadToRemote([source])) {
        source.questions = [];
        source.offloaded = true;
    }

    if (AppState.currentSourceKey === sourceId) {
        const { saveCurrentSource } = await import('../../core/state.js');
        const other = AppState.sources.find(s => s.active && !s.archived);
        saveCurrentSource(other ? other.id : null);
    }

    saveSources();
    syncQuickPresetsWithLiveSources();
    renderSourcesList();
    if (window.onSourcesUpdated) window.onSourcesUpdated();
    showToast(source.offloaded ? t('archive_done_remote') : t('archive_done_local'));
    return true;
}

export async function archiveFolder(folderId) {
    const folder = AppState.folders.find(f => f.id === folderId);
    if (!folder || folder.archived || folder.isSystem || folder.id === 'uncategorized-folder') return false;

    const contents = AppState.sources.filter(s => s.folderId === folderId && !s.archived);
    if (!await showConfirm(
        t('archive_folder_confirm', { name: folder.name, count: contents.length }),
        t('archive_title')
    )) return false;

    contents.forEach(s => markArchived(s, folder));

    folder.archived = true;
    folder.archivedAt = nowTs();
    folder.updatedAt = nowTs();

    if (contents.length > 0 && await offloadToRemote(contents)) {
        contents.forEach(s => { s.questions = []; s.offloaded = true; });
    }

    const activeKeyArchived = contents.some(s => s.id === AppState.currentSourceKey);
    if (activeKeyArchived) {
        const { saveCurrentSource } = await import('../../core/state.js');
        const other = AppState.sources.find(s => s.active && !s.archived);
        saveCurrentSource(other ? other.id : null);
    }

    saveSources();
    saveFolders();
    syncQuickPresetsWithLiveSources();
    renderSourcesList();
    if (window.onSourcesUpdated) window.onSourcesUpdated();
    showToast(t('archive_done_folder', { count: contents.length }));
    return true;
}

/**
 * Pulls questions back for an offloaded source. Returns false without touching
 * the archive flag when the questions cannot be recovered.
 */
async function hydrate(source) {
    if (!source.offloaded) return true;

    if (!canUseRemoteArchive()) {
        showAlert(t('archive_needs_github'), t('archive_title'));
        return false;
    }

    try {
        const map = await fetchArchiveFile();
        const entry = map[source.id];
        if (!entry || !Array.isArray(entry.questions) || entry.questions.length === 0) {
            showAlert(t('archive_missing_remote'), t('archive_title'));
            return false;
        }
        source.questions = normalizeQuestions(entry.questions);
        source.offloaded = false;
        return true;
    } catch (err) {
        console.error('Archive hydrate failed:', err);
        showAlert(t('archive_fetch_error'), t('archive_title'));
        return false;
    }
}

/**
 * Resolves where a restored source belongs: its original folder if that folder
 * still exists (renames are irrelevant, the id is the link), otherwise root.
 */
function resolveTargetFolder(source) {
    const wantedId = source.archivedFrom?.folderId;
    if (!wantedId) return null;
    const folder = AppState.folders.find(f => f.id === wantedId);
    if (!folder) return null;
    if (folder.archived) {
        folder.archived = false;
        delete folder.archivedAt;
        folder.updatedAt = nowTs();
        saveFolders();
    }
    return folder;
}

export async function restoreSource(sourceId) {
    const source = AppState.sources.find(s => s.id === sourceId);
    if (!source || !source.archived) return false;

    if (!await hydrate(source)) return false;

    const folder = resolveTargetFolder(source);
    source.folderId = folder ? folder.id : null;
    source.order = AppState.sources.filter(s => !s.archived && (s.folderId || null) === (source.folderId || null)).length;
    const thawed = thawStatsOnRestore(source);
    source.archived = false;
    source.updatedAt = nowTs();
    delete source.archivedAt;
    delete source.archivedFrom;

    await dropFromRemote([sourceId]);

    saveSources();
    if (thawed) saveStats();
    renderSourcesList();
    if (window.onSourcesUpdated) window.onSourcesUpdated();
    showToast(folder
        ? t('archive_restored_folder', { name: source.name, folder: folder.name })
        : t('archive_restored_root', { name: source.name }));
    renderArchiveList();
    return true;
}

export async function restoreArchivedFolder(folderId) {
    const folder = AppState.folders.find(f => f.id === folderId);
    if (!folder) return false;

    const members = sourcesOfArchivedFolder(folderId);
    for (const s of members) {
        // hydrate() reports its own failure; a partially restored folder is fine,
        // the rest stays archived and can be retried.
        if (!await hydrate(s)) return false;
    }

    folder.archived = false;
    delete folder.archivedAt;
    folder.updatedAt = nowTs();

    // Thawing lives inside this loop, next to the archivedAt it consumes: a
    // separate pass would leave sources thawed but still archived if the restore
    // aborted midway, and the next attempt would shift them a second time.
    let thawed = 0;
    members.forEach((s, i) => {
        s.folderId = folderId;
        s.order = i;
        thawed += thawStatsOnRestore(s);
        s.archived = false;
        s.updatedAt = nowTs();
        delete s.archivedAt;
        delete s.archivedFrom;
    });

    await dropFromRemote(members.map(s => s.id));

    saveFolders();
    saveSources();
    if (thawed) saveStats();
    renderSourcesList();
    if (window.onSourcesUpdated) window.onSourcesUpdated();
    showToast(t('archive_restored_folder_bulk', { name: folder.name, count: members.length }));
    renderArchiveList();
    return true;
}

export async function deleteArchivedSource(sourceId) {
    const source = AppState.sources.find(s => s.id === sourceId);
    if (!source) return false;
    if (!await showConfirm(t('archive_delete_confirm', { name: source.name }), t('archive_title'))) return false;

    await dropFromRemote([sourceId]);

    Object.keys(AppState.stats).forEach(key => {
        if (key.startsWith(`${sourceId}_`)) delete AppState.stats[key];
    });
    AppState.sources = AppState.sources.filter(s => s.id !== sourceId);
    trackDeletedSource(sourceId);

    saveStats();
    saveSources();
    syncQuickPresetsWithLiveSources();
    if (window.onSourcesUpdated) window.onSourcesUpdated();
    showToast(t('archive_deleted', { name: source.name }));
    renderArchiveList();
    return true;
}

export async function deleteArchivedFolder(folderId) {
    const folder = AppState.folders.find(f => f.id === folderId);
    if (!folder) return false;
    const members = sourcesOfArchivedFolder(folderId);
    if (!await showConfirm(
        t('archive_delete_folder_confirm', { name: folder.name, count: members.length }),
        t('archive_title')
    )) return false;

    const ids = members.map(s => s.id);
    await dropFromRemote(ids);

    ids.forEach(id => {
        Object.keys(AppState.stats).forEach(key => {
            if (key.startsWith(`${id}_`)) delete AppState.stats[key];
        });
        trackDeletedSource(id);
    });
    AppState.sources = AppState.sources.filter(s => !ids.includes(s.id));
    AppState.folders = AppState.folders.filter(f => f.id !== folderId);
    trackDeletedFolder(folderId);

    saveStats();
    saveSources();
    saveFolders();
    syncQuickPresetsWithLiveSources();
    if (window.onSourcesUpdated) window.onSourcesUpdated();
    showToast(t('archive_deleted', { name: folder.name }));
    renderArchiveList();
    return true;
}

/**
 * Loads an archived source's questions without restoring it, for preview and
 * download. Leaves the archive state untouched.
 */
async function readArchivedQuestions(source) {
    if (!source.offloaded) return source.questions || [];
    if (!canUseRemoteArchive()) {
        showAlert(t('archive_needs_github'), t('archive_title'));
        return null;
    }
    try {
        const map = await fetchArchiveFile();
        const entry = map[source.id];
        if (!entry || !Array.isArray(entry.questions)) {
            showAlert(t('archive_missing_remote'), t('archive_title'));
            return null;
        }
        return entry.questions;
    } catch (err) {
        console.error('Archive read failed:', err);
        showAlert(t('archive_fetch_error'), t('archive_title'));
        return null;
    }
}

export async function downloadArchivedSource(sourceId) {
    const source = AppState.sources.find(s => s.id === sourceId);
    if (!source) return;
    const questions = await readArchivedQuestions(source);
    if (!questions) return;
    await downloadSourceJSON({ ...source, questions });
}

export async function previewArchivedSource(sourceId) {
    const source = AppState.sources.find(s => s.id === sourceId);
    if (!source) return;

    const overlay = document.getElementById('archivePreviewOverlay');
    const titleEl = document.getElementById('archivePreviewName');
    const bodyEl = document.getElementById('archivePreviewBody');
    const closeBtn = document.getElementById('archivePreviewCloseBtn');
    const backBtn = document.getElementById('archivePreviewBackBtn');
    if (!overlay || !bodyEl) return;

    if (titleEl) titleEl.textContent = source.name;
    bodyEl.innerHTML = `<div style="padding:1rem; text-align:center; color:var(--text-secondary); font-size:0.85rem;">${t('archive_loading')}</div>`;
    overlay.classList.add('active');

    const questions = await readArchivedQuestions(source);
    if (!questions) {
        overlay.classList.remove('active');
        return;
    }

    bodyEl.innerHTML = questions.map((q, i) => {
        const text = q.content?.text || q.text || '';
        return `
            <div style="padding:0.6rem 0.75rem; border:1px solid var(--border-color); border-radius:var(--radius-md); margin-bottom:0.5rem;">
                <div style="font-size:0.7rem; color:var(--text-secondary); margin-bottom:2px;">#${i + 1} · ${q.type || '-'}</div>
                <div style="font-size:0.85rem;">${escapeHTML(String(text))}</div>
            </div>
        `;
    }).join('') || `<div style="padding:1rem; text-align:center; color:var(--text-secondary);">${t('archive_empty')}</div>`;

    const close = () => {
        overlay.classList.remove('active');
        if (closeBtn) closeBtn.onclick = null;
        if (backBtn) backBtn.onclick = null;
        overlay.onclick = null;
    };
    if (closeBtn) closeBtn.onclick = close;
    if (backBtn) backBtn.onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
}

// --- Archive screen ------------------------------------------------------------

function archiveRow({ title, subtitle, badge, actions }) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.gap = '0.5rem';
    row.style.padding = '0.75rem';
    row.style.border = '1px solid var(--border-color)';
    row.style.borderRadius = 'var(--radius-md)';
    row.style.marginBottom = '0.5rem';
    row.style.backgroundColor = 'var(--surface-color)';

    const info = document.createElement('div');
    info.style.minWidth = '0';
    info.style.flex = '1';
    info.innerHTML = `
        <div class="truncate" style="font-weight:600; font-size:0.9rem;">${escapeHTML(title)}</div>
        <div style="font-size:0.72rem; color:var(--text-secondary); margin-top:2px; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span>${escapeHTML(subtitle)}</span>
            ${badge ? `<span style="padding:1px 6px; border-radius:999px; background:var(--surface-hover); border:1px solid var(--border-color);">${escapeHTML(badge)}</span>` : ''}
        </div>
    `;

    const actionsWrap = document.createElement('div');
    actionsWrap.style.display = 'flex';
    actionsWrap.style.gap = '0.25rem';
    actionsWrap.style.flexShrink = '0';
    actions.forEach(a => actionsWrap.appendChild(a));

    row.appendChild(info);
    row.appendChild(actionsWrap);
    return row;
}

function iconButton(title, svg, onClick, danger = false) {
    const btn = document.createElement('button');
    btn.className = 'icon-btn';
    btn.title = title;
    btn.innerHTML = svg;
    if (danger) btn.style.color = 'var(--error-color, #ef4444)';
    btn.onclick = (e) => { e.stopPropagation(); onClick(); };
    return btn;
}

const ICONS = {
    restore: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><polyline points="3 3 3 8 8 8"></polyline></svg>',
    preview: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
    download: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
    trash: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>'
};

export function renderArchiveList() {
    const container = document.getElementById('archiveList');
    const emptyEl = document.getElementById('archiveEmpty');
    const linkEl = document.getElementById('archiveGistLink');
    const hintEl = document.getElementById('archiveLocalHint');
    if (!container) return;

    container.innerHTML = '';

    const items = archivedSources();
    const archivedFolders = (AppState.folders || []).filter(f => f.archived);

    if (emptyEl) emptyEl.style.display = (items.length === 0 && archivedFolders.length === 0) ? 'block' : 'none';

    const gistUrl = getGistUrl();
    if (linkEl) {
        if (gistUrl && items.some(s => s.offloaded)) {
            linkEl.href = gistUrl;
            linkEl.style.display = 'inline-flex';
        } else {
            linkEl.style.display = 'none';
        }
    }
    if (hintEl) {
        hintEl.style.display = (!canUseRemoteArchive() && items.length > 0) ? 'block' : 'none';
    }

    const dateOf = (ts) => ts ? new Date(ts).toLocaleDateString() : '-';

    // Folders archived as a whole, with their contents nested underneath.
    archivedFolders.forEach(folder => {
        const members = sourcesOfArchivedFolder(folder.id);

        const block = document.createElement('div');
        block.style.marginBottom = '1rem';

        const header = archiveRow({
            title: folder.name,
            subtitle: `${t('questions_count', { count: members.length })} · ${dateOf(folder.archivedAt)}`,
            badge: t('archive_folder_badge'),
            actions: [
                iconButton(t('archive_restore'), ICONS.restore, () => restoreArchivedFolder(folder.id)),
                iconButton(t('delete'), ICONS.trash, () => deleteArchivedFolder(folder.id), true)
            ]
        });
        header.style.borderLeft = `4px solid ${folder.color || DEFAULT_FOLDER_COLOR}`;
        block.appendChild(header);

        const nested = document.createElement('div');
        nested.style.paddingLeft = '1rem';
        members.forEach(s => nested.appendChild(buildSourceRow(s, dateOf)));
        block.appendChild(nested);

        container.appendChild(block);
    });

    // Individually archived sources (their folder, if any, still exists or is gone).
    const loose = items.filter(s => {
        const fid = s.archivedFrom?.folderId;
        return !fid || !archivedFolders.some(f => f.id === fid);
    });
    loose.forEach(s => container.appendChild(buildSourceRow(s, dateOf)));
}

function buildSourceRow(source, dateOf) {
    const originFolderId = source.archivedFrom?.folderId;
    const folderStillThere = originFolderId && AppState.folders.some(f => f.id === originFolderId);
    const originName = source.archivedFrom?.name;

    let badge;
    if (!originFolderId) badge = t('root_folder');
    else if (folderStillThere) badge = AppState.folders.find(f => f.id === originFolderId).name;
    else badge = t('archive_folder_gone', { name: originName || '?' });

    const count = source.offloaded ? (source.questionCount || 0) : (source.questions?.length || 0);
    const location = source.offloaded ? t('archive_on_github') : t('archive_on_device');

    return archiveRow({
        title: source.name,
        subtitle: `${t('questions_count', { count })} · ${dateOf(source.archivedAt)} · ${location}`,
        badge,
        actions: [
            iconButton(t('archive_restore'), ICONS.restore, () => restoreSource(source.id)),
            iconButton(t('archive_preview'), ICONS.preview, () => previewArchivedSource(source.id)),
            iconButton(t('download'), ICONS.download, () => downloadArchivedSource(source.id)),
            iconButton(t('delete'), ICONS.trash, () => deleteArchivedSource(source.id), true)
        ]
    });
}

export function showArchiveModal() {
    const overlay = document.getElementById('archiveOverlay');
    if (!overlay) return;

    renderArchiveList();
    overlay.classList.add('active');

    const closeBtn = document.getElementById('archiveCloseBtn');
    const doneBtn = document.getElementById('archiveDoneBtn');
    const close = () => {
        overlay.classList.remove('active');
        if (closeBtn) closeBtn.onclick = null;
        if (doneBtn) doneBtn.onclick = null;
        overlay.onclick = null;
        /* Archiving rewrites source records and can delete them outright, which
           moves both the library and the tombstone list - so both files. */
        scheduleSync(300, [SyncScope.SOURCES, SyncScope.PROGRESS]);
    };
    if (closeBtn) closeBtn.onclick = close;
    if (doneBtn) doneBtn.onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
}

export function initArchiveUI() {
    const btn = document.getElementById('archiveBtn');
    if (btn) btn.onclick = () => showArchiveModal();
}
