import { AppState, saveSources, saveStats } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import { escapeHTML, showToast } from '../../core/utils.js';
import { renderSourcesList } from './sources-ui.js';

/* Shown after an import that parsed cleanly but produced questions nobody can
   answer — a choice with no correct option marked, a flashcard with a blank
   back. The same rules the question editor enforces on save (question-rules.js)
   are applied here, so a file cannot smuggle in something the editor would have
   refused.

   The user picks what happens to those questions:
     flag   — keep them and switch on the flag indicator (#previewIndFlag), so
              they can be found and repaired later
     remove — drop them, keeping the library free of unusable content

   Both choices are shown above the full list of affected questions: the
   decision depends on what is actually broken, so the evidence sits on the same
   screen rather than behind a second dialog. */

const OVERLAY_ID = 'importReportOverlay';

function closeReport() {
    document.getElementById(OVERLAY_ID)?.remove();
}

function statKeyFor(sourceId, questionId) {
    return `${sourceId}_${questionId}`;
}

function flagGaps(source, gaps) {
    gaps.forEach(gap => {
        const key = statKeyFor(source.id, gap.id);
        if (!AppState.stats[key]) {
            AppState.stats[key] = { difficulty: 5.0, correct: 0, wrong: 0 };
        }
        AppState.stats[key].flagged = true;
    });
    saveStats();
    showToast(t('import_gaps_flagged', { count: gaps.length }));
}

function removeGaps(source, gaps) {
    const doomed = new Set(gaps.map(g => String(g.id)));
    source.questions = source.questions.filter(q => !doomed.has(String(q.id)));

    // Removing every question would leave an empty source behind; drop it too
    // rather than leaving a shell in the library.
    if (source.questions.length === 0) {
        const idx = AppState.sources.findIndex(s => s.id === source.id);
        if (idx > -1) AppState.sources.splice(idx, 1);
        saveSources();
        showToast(t('import_gaps_source_emptied'));
        return;
    }

    saveSources();
    showToast(t('import_gaps_removed', { count: gaps.length }));
}

function refreshUI() {
    renderSourcesList();
    if (window.renderStatsList) window.renderStatsList(AppState.activeStatsFilter || 'all');
    if (window.updateHomeStats) window.updateHomeStats();
    if (window.onSourcesUpdated) window.onSourcesUpdated();
}

function renderGapList(gaps) {
    return gaps.map(gap => {
        const issues = gap.issues
            .map(issue => `<span class="gap-issue">${escapeHTML(t(`validation_${issue.code}`))}</span>`)
            .join('');
        const label = gap.label || `<${t('import_gaps_no_text')}>`;

        return `
            <li class="gap-item">
                <div class="gap-item-head">
                    <span class="gap-item-id">#${gap.index + 1} · ${escapeHTML(String(gap.id ?? '?'))}</span>
                    <span class="gap-item-type">${escapeHTML(gap.type)}</span>
                </div>
                <div class="gap-item-text">${escapeHTML(label)}</div>
                <div class="gap-item-issues">${issues}</div>
            </li>`;
    }).join('');
}

/**
 * @param {object} source The freshly imported source, already in AppState.
 * @param {object[]} gaps Output of findContentGaps() for that source.
 */
export function showImportReport(source, gaps) {
    closeReport();

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'editor-overlay';
    overlay.innerHTML = `
        <div class="editor-card import-report-card">
            <div class="editor-header">
                <h3 class="editor-title">${escapeHTML(t('import_gaps_title'))}</h3>
                <div class="import-report-count">${gaps.length} / ${source.questions.length}</div>
            </div>

            <p class="import-report-summary">
                ${escapeHTML(t('import_gaps_summary', { name: source.name, count: gaps.length }))}
            </p>

            <div class="btn-row import-report-actions" data-count="3">
                <button class="btn btn-primary" id="importGapsFlagBtn">${escapeHTML(t('import_gaps_flag_btn'))}</button>
                <button class="btn btn-danger" id="importGapsRemoveBtn">${escapeHTML(t('import_gaps_remove_btn'))}</button>
                <button class="btn btn-secondary" id="importGapsCancelBtn">${escapeHTML(t('import_gaps_cancel_btn'))}</button>
            </div>

            <p class="import-report-hint">${escapeHTML(t('import_gaps_hint'))}</p>

            <ul class="gap-list">${renderGapList(gaps)}</ul>
        </div>`;

    document.body.appendChild(overlay);

    const finish = (action) => {
        action();
        closeReport();
        refreshUI();
    };

    const handleCancel = () => {
        closeReport();
        refreshUI();
    };

    document.getElementById('importGapsFlagBtn').onclick = () => finish(() => flagGaps(source, gaps));
    document.getElementById('importGapsRemoveBtn').onclick = () => finish(() => removeGaps(source, gaps));
    document.getElementById('importGapsCancelBtn').onclick = handleCancel;
}
