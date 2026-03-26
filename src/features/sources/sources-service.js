import { AppState, saveSources } from '../../core/state.js';
import { showToast, getCorrectAnswers, showAlert } from '../../core/utils.js';
import { t } from '../../core/i18n.js';

const VALID_TYPES = new Set(['single_choice', 'multiple_choice', 'true_false', 'text_input', 'text', 'open_ended', 'fill_in_the_blank']);
const TEXT_TYPES = new Set(['text_input', 'text', 'open_ended', 'fill_in_the_blank']);

export function validateExamSchema(data) {
    const errors = [];

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { valid: false, errors: ['Dosya geçerli bir JSON nesnesi olmalıdır.'] };
    }

    if (!Array.isArray(data.questions)) {
        errors.push('"questions" alanı bir dizi olmalıdır.');
        return { valid: false, errors };
    }

    if (data.questions.length === 0) {
        errors.push('"questions" dizisi boş olamaz.');
        return { valid: false, errors };
    }

    const ids = new Set();
    data.questions.forEach((q, i) => {
        const prefix = `Soru[${i + 1}]`;

        if (q.id === undefined || q.id === null) {
            errors.push(`${prefix}: "id" alanı zorunludur.`);
        } else if (ids.has(String(q.id))) {
            errors.push(`${prefix}: Tekrarlanan id "${q.id}".`);
        } else {
            ids.add(String(q.id));
        }

        const text = q.content?.text || q.text;
        if (!text || String(text).trim() === '') {
            errors.push(`${prefix}: Soru metni (content.text) zorunludur.`);
        }

        if (!q.type) {
            errors.push(`${prefix}: "type" alanı zorunludur.`);
        } else if (!VALID_TYPES.has(q.type)) {
            errors.push(`${prefix}: Geçersiz tür "${q.type}". Geçerli türler: ${[...VALID_TYPES].join(', ')}.`);
        }

        if (q.type && !TEXT_TYPES.has(q.type)) {
            if (!Array.isArray(q.options) || q.options.length < 2) {
                errors.push(`${prefix}: "${q.type}" türü için en az 2 seçenek gereklidir.`);
            }
        }

        if (!q.answer || typeof q.answer !== 'object') {
            errors.push(`${prefix}: "answer" nesnesi zorunludur.`);
        } else if (!TEXT_TYPES.has(q.type)) {
            const hasCorrectIds = Array.isArray(q.answer.correct_ids) && q.answer.correct_ids.length > 0;
            const hasCorrectId = q.answer.correct_id !== undefined;
            const hasCorrectOption = q.answer.correct_option !== undefined;
            if (!hasCorrectIds && !hasCorrectId && !hasCorrectOption) {
                errors.push(`${prefix}: answer.correct_ids (veya correct_id) belirtilmelidir.`);
            }
        } else {
            const hasTexts = Array.isArray(q.answer.accepted_texts) && q.answer.accepted_texts.length > 0;
            const hasText = q.answer.correct_answer !== undefined || q.answer.correct_text !== undefined;
            if (!hasTexts && !hasText) {
                errors.push(`${prefix}: Metin tipi sorular için answer.accepted_texts belirtilmelidir.`);
            }
        }
    });

    return { valid: errors.length === 0, errors };
}

export function normalizeQuestions(questions) {
    return questions.map(q => {
        // Ensure correctOptionIds is consistently populated
        const answers = getCorrectAnswers(q);
        if (answers.length > 0) {
            q.correctOptionIds = answers;
        }
        // Ensure difficulty is normalized to 1-5
        if (q.difficulty === undefined || isNaN(q.difficulty)) {
            q.difficulty = 2.5; // Default middle ground
        }
        return q;
    });
}

export function processJSON(data, name, options = {}) {
    const validation = validateExamSchema(data);
    if (!validation.valid) {
        const errorList = validation.errors.slice(0, 5).join('\n• ');
        const suffix = validation.errors.length > 5 ? `\n... ve ${validation.errors.length - 5} hata daha.` : '';
        showAlert(`Şema doğrulama hatası:\n• ${errorList}${suffix}`, t('invalid_format'));
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

    // Generate a robust unique ID (UUID)
    const id = crypto.randomUUID();

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

export function mergeSources(selectedIds) {
    if (!selectedIds || selectedIds.length < 2) return null;

    const sourcesToMerge = AppState.sources.filter(s => selectedIds.includes(s.id));
    // Sort by question count descending
    sourcesToMerge.sort((a, b) => (b.questions?.length || 0) - (a.questions?.length || 0));

    const prefix = Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
    const mergedQuestions = [];

    sourcesToMerge.forEach(source => {
        if (source.questions) {
            source.questions.forEach(q => {
                // Important: Clone question to avoid mutating original source
                const newQ = JSON.parse(JSON.stringify(q));
                newQ.id = `${prefix}m_${newQ.id}`;
                mergedQuestions.push(newQ);
            });
        }
    });

    const newId = crypto.randomUUID();
    const newSource = {
        id: newId,
        name: t('merged_source') + ' ' + new Date().toLocaleDateString(),
        questions: mergedQuestions,
        active: true,
        lastUsed: Date.now(),
        importDate: new Date().toLocaleDateString(),
        origin: {
            display: t('mixed_sources'),
            type: 'merged'
        },
        metadata: { title: t('merged_source') }
    };

    AppState.sources.push(newSource);
    saveSources();
    showAlert(t('import_success_msg', { name: newSource.name, count: mergedQuestions.length }), t('success_title'));
    return newSource;
}
