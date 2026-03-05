
import { AppState, saveSources } from '../../core/state.js';
import { showToast } from '../../core/utils.js';

export function normalizeQuestions(questions) {
    return questions.map(q => {
        // Handle different formats for correct IDs
        if (!q.correctOptionIds) {
            if (q.answer && q.answer.correct_ids) q.correctOptionIds = q.answer.correct_ids;
            else if (q.answer && q.answer.correctIds) q.correctOptionIds = q.answer.correctIds;
            else if (q.answer && q.answer.accepted_texts) q.correctOptionIds = q.answer.accepted_texts;
        }
        return q;
    });
}

export function processJSON(data, name) {
    if (!data.questions || !Array.isArray(data.questions)) {
        showToast('Ungültiges JSON Format');
        return null;
    }

    const normalizedQuestions = normalizeQuestions(data.questions);
    const title = data.exam_metadata?.title || data.exam?.title || name;
    // Generate a more robust ID if possible, but keep it simple
    const id = btoa(unescape(encodeURIComponent(title + normalizedQuestions.length))).substring(0, 12);

    // Check if source already exists
    const existingIdx = AppState.sources.findIndex(s => s.id === id);

    const sourceName = name || 'Unknown Source';
    const source = {
        id,
        name: title,
        questions: normalizedQuestions,
        active: AppState.sources.length === 0,
        lastUsed: Date.now(),
        importDate: new Date().toLocaleDateString(),
        origin: {
            display: sourceName,
            type: (typeof sourceName === 'string' && sourceName.startsWith('http')) ? 'url' : 'file'
        },
        metadata: data.exam_metadata || {}
    };

    if (existingIdx > -1) {
        // preserve some existing state if needed, but here we overwrite content
        source.active = AppState.sources[existingIdx].active;
        AppState.sources[existingIdx] = source;
    } else {
        AppState.sources.push(source);
    }

    saveSources();
    showToast(`${normalizedQuestions.length} Fragen geladen`);
    return source;
}

export async function loadFromUrl(url) {
    try {
        const fullUrl = new URL(url, window.location.href);
        const res = await fetch(fullUrl);
        if (!res.ok) throw new Error('Network response was not ok');
        const data = await res.json();
        return processJSON(data, fullUrl.hostname || 'local');
    } catch (e) {
        showToast('Laden fehlgeschlagen');
        console.error(e);
        return null;
    }
}

export function loadFromFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const source = processJSON(JSON.parse(e.target.result), file.name);
                resolve(source);
            } catch (err) {
                showToast('Ungültiges Dateiformat');
                reject(err);
            }
        };
        reader.readAsText(file);
    });
}
