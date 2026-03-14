import { AppState, saveSources } from '../../core/state.js';
import { showToast, getCorrectAnswers, showAlert } from '../../core/utils.js';
import { t } from '../../core/i18n.js';

export function normalizeQuestions(questions) {
    return questions.map(q => {
        // Ensure correctOptionIds is consistently populated
        const answers = getCorrectAnswers(q);
        if (answers.length > 0) {
            q.correctOptionIds = answers;
        }
        return q;
    });
}

export function processJSON(data, name, options = {}) {
    if (!data.questions || !Array.isArray(data.questions)) {
        showAlert(t('json_error_no_questions'), t('invalid_format'));
        return null;
    }

    const normalizedQuestions = normalizeQuestions(data.questions);
    let title = data.exam_metadata?.title || data.exam?.title || name;

    // Smart Name Suffixing Logic
    let finalTitle = title;
    let counter = 2;
    while (AppState.sources.some(s => s.name === finalTitle)) {
        finalTitle = `${title} [New-${counter}]`;
        counter++;
    }
    title = finalTitle;

    // Generate a more robust ID based on final uniqueness
    const id = btoa(unescape(encodeURIComponent(title + normalizedQuestions.length + Date.now()))).substring(0, 12);

    const sourceName = name || 'Unknown Source';

    // Determine active state: options.active takes precedence, then default logic
    let isActive = AppState.sources.length === 0;
    if (options.active !== undefined) {
        isActive = options.active;
    }

    const source = {
        id,
        name: title,
        questions: normalizedQuestions,
        active: isActive,
        lastUsed: Date.now(),
        importDate: new Date().toLocaleDateString(),
        origin: {
            display: sourceName,
            type: (typeof sourceName === 'string' && sourceName.startsWith('http')) ? 'url' : 'file'
        },
        metadata: data.exam_metadata || {}
    };

    AppState.sources.push(source);

    saveSources();
    showAlert(t('import_success_msg', { name: title, count: normalizedQuestions.length }), t('success_title'));
    return source;
}

export async function loadFromUrl(url, options = {}) {
    try {
        const fullUrl = new URL(url, window.location.href);
        const res = await fetch(fullUrl);
        if (!res.ok) throw new Error('Network response was not ok');
        const data = await res.json();
        return processJSON(data, fullUrl.hostname || 'local', options);
    } catch (e) {
        showAlert(t('import_failed') + ': ' + e.message, t('invalid_format'));
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
                showAlert(t('json_error_invalid_json'), t('invalid_format'));
                reject(err);
            }
        };
        reader.readAsText(file);
    });
}
