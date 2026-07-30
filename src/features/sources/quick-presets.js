import { AppState, liveFolders, saveQuickPresets } from '../../core/state.js';
import { showAlert } from '../../core/utils.js';
import { t } from '../../core/i18n.js';

export const DEFAULT_FOLDER_COLOR = '#0098fe';

export function resolvePresetColor(preset) {
    if (!preset) return { type: 'solid', value: DEFAULT_FOLDER_COLOR };
    if (preset.color) return { type: 'solid', value: preset.color };

    const sources = (AppState.sources || []).filter(s => preset.sourceIds && preset.sourceIds.includes(s.id) && !s.archived);
    if (sources.length === 0) {
        return { type: 'solid', value: DEFAULT_FOLDER_COLOR };
    }

    const folderIds = [...new Set(sources.map(s => s.folderId || null))];

    // Tüm kaynaklar tek klasörde (veya tüm root) → klasör rengi
    if (folderIds.length === 1) {
        const fid = folderIds[0];
        if (fid === null) return { type: 'solid', value: DEFAULT_FOLDER_COLOR };
        const folder = liveFolders().find(f => f.id === fid);
        return { type: 'solid', value: folder?.color || DEFAULT_FOLDER_COLOR };
    }

    // Karışık — her klasörün kaynak sayısına göre orantılı conic-gradient
    const buckets = new Map();
    sources.forEach(s => {
        const fid = s.folderId || '__root__';
        buckets.set(fid, (buckets.get(fid) || 0) + 1);
    });
    const total = sources.length;
    let acc = 0;
    const stops = [];
    for (const [fid, count] of buckets) {
        const color = fid === '__root__'
            ? DEFAULT_FOLDER_COLOR
            : (liveFolders().find(f => f.id === fid)?.color || DEFAULT_FOLDER_COLOR);
        const deg = (count / total) * 360;
        stops.push(`${color} ${acc.toFixed(2)}deg ${(acc + deg).toFixed(2)}deg`);
        acc += deg;
    }
    return { type: 'conic', value: `conic-gradient(${stops.join(', ')})` };
}

export function resolvePresetLinearBar(preset) {
    if (!preset) return DEFAULT_FOLDER_COLOR;
    if (preset.color) return preset.color;

    const sources = (AppState.sources || []).filter(s => preset.sourceIds && preset.sourceIds.includes(s.id) && !s.archived);
    if (sources.length === 0) return DEFAULT_FOLDER_COLOR;

    const folderIds = [...new Set(sources.map(s => s.folderId || null))];

    if (folderIds.length === 1) {
        const fid = folderIds[0];
        if (fid === null) return DEFAULT_FOLDER_COLOR;
        const folder = liveFolders().find(f => f.id === fid);
        return folder?.color || DEFAULT_FOLDER_COLOR;
    }

    // Proportional question count per folder
    const buckets = new Map();
    let totalQuestions = 0;
    sources.forEach(s => {
        const fid = s.folderId || '__root__';
        const qCount = s.questions ? s.questions.length : 1;
        buckets.set(fid, (buckets.get(fid) || 0) + qCount);
        totalQuestions += qCount;
    });

    if (totalQuestions === 0) return DEFAULT_FOLDER_COLOR;

    let accPct = 0;
    const stops = [];
    for (const [fid, count] of buckets) {
        const color = fid === '__root__'
            ? DEFAULT_FOLDER_COLOR
            : (liveFolders().find(f => f.id === fid)?.color || DEFAULT_FOLDER_COLOR);
        const pct = (count / totalQuestions) * 100;
        stops.push(`${color} ${accPct.toFixed(2)}% ${(accPct + pct).toFixed(2)}%`);
        accPct += pct;
    }

    return `linear-gradient(to right, ${stops.join(', ')})`;
}

export function applySwatch(el, preset) {
    if (!el) return;
    const c = resolvePresetColor(preset);
    if (c.type === 'solid') {
        el.style.backgroundImage = 'none';
        el.style.background = c.value;
    } else {
        el.style.background = 'none';
        el.style.backgroundImage = c.value;
    }
}

export function applyPresetBar(el, preset) {
    if (!el) return;
    const bg = resolvePresetLinearBar(preset);
    el.style.background = bg;
}

export function generateAutoName() {
    const defaultPrefix = t('qs_default_name') || 'Birlestirme';
    const existing = (AppState.quickPresets || []).map(p => p.name);
    let n = 1;
    while (existing.includes(`${defaultPrefix}-${n}`)) n++;
    return `${defaultPrefix}-${n}`;
}

export function addCurrentAsPreset() {
    const activeIds = (AppState.sources || [])
        .filter(s => s.active && !s.archived)
        .map(s => s.id)
        .sort();
    if (activeIds.length === 0) {
        showAlert(t('qs_no_active'), t('warning_title'));
        return null;
    }

    const isDuplicate = (AppState.quickPresets || []).some(p => {
        if (!p.sourceIds || p.sourceIds.length !== activeIds.length) return false;
        const pSorted = [...p.sourceIds].sort();
        return pSorted.every((id, idx) => id === activeIds[idx]);
    });

    if (isDuplicate) {
        showAlert(t('qs_duplicate_warning') || 'Bu kaynak grubu zaten Hızlı Erişim\'de kayıtlı', t('warning_title'));
        return null;
    }

    const newPreset = {
        id: 'qp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        name: generateAutoName(),
        sourceIds: activeIds,
        color: null,
        order: AppState.quickPresets.length,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    AppState.quickPresets.push(newPreset);
    saveQuickPresets();
    return newPreset;
}
