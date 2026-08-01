import { AppState, saveSources } from '../../core/state.js';
import { getCorrectAnswers, showAlert } from '../../core/utils.js';
import { t } from '../../core/i18n.js';
import { KNOWN_TYPES, LEGACY_TYPE_ALIASES, canonicalType, findContentGaps } from '../../core/question-rules.js';
import { showImportReport } from './import-report.js';

// Files written against legacy type names stay importable; normalizeQuestions
// rewrites them to their canonical spellings so only honest types reach storage.
const VALID_TYPES = new Set([...KNOWN_TYPES, ...Object.keys(LEGACY_TYPE_ALIASES)]);

export function getQuestionsFromData(data) {
    if (!data || typeof data !== 'object') return null;
    if (Array.isArray(data.questions)) return data.questions;
    if (Array.isArray(data.sources) && data.sources.length > 0 && Array.isArray(data.sources[0]?.questions)) {
        return data.sources[0].questions;
    }
    return null;
}

/* Structural validation only: a file that fails here cannot be read at all, so
   the import is refused outright. Whether the questions are *answerable* is a
   separate matter handled by findContentGaps() — see question-rules.js. A file
   can be perfectly formed and still hold a choice question with no correct
   option marked, and that must not cost the user the whole import. */
export function validateExamSchema(data) {
    const errors = [];

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { valid: false, errors: ['Dosya geçerli bir JSON nesnesi olmalıdır.'] };
    }

    const questions = getQuestionsFromData(data);

    if (!Array.isArray(questions)) {
        errors.push('"questions" alanı bir dizi olmalıdır.');
        return { valid: false, errors };
    }

    if (questions.length === 0) {
        errors.push('"questions" dizisi boş olamaz.');
        return { valid: false, errors };
    }

    const ids = new Set();
    questions.forEach((q, i) => {
        const prefix = `Soru[${i + 1}]`;

        if (q.id === undefined || q.id === null) {
            errors.push(`${prefix}: "id" alanı zorunludur.`);
        } else if (ids.has(String(q.id))) {
            errors.push(`${prefix}: Tekrarlanan id "${q.id}".`);
        } else {
            ids.add(String(q.id));
        }

        if (!q.type) {
            errors.push(`${prefix}: "type" alanı zorunludur.`);
        } else if (!VALID_TYPES.has(q.type)) {
            errors.push(`${prefix}: Geçersiz tür "${q.type}". Geçerli türler: ${[...VALID_TYPES].join(', ')}.`);
        }

        if (q.options !== undefined && !Array.isArray(q.options)) {
            errors.push(`${prefix}: "options" bir dizi olmalıdır.`);
        }

        if (q.answer !== undefined && (typeof q.answer !== 'object' || Array.isArray(q.answer))) {
            errors.push(`${prefix}: "answer" bir nesne olmalıdır.`);
        }
    });

    return { valid: errors.length === 0, errors };
}

export function normalizeQuestions(questions) {
    return questions.map(q => {
        // text / text_input / open_ended all described the same behaviour; store
        // the one name so nothing downstream has to know about the other three.
        if (q.type) q.type = canonicalType(q.type);
        delete q.format;

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

/**
 * Recursively strips dangerous object keys (__proto__, constructor, prototype)
 * to prevent Prototype Pollution attacks from untrusted JSON inputs.
 * @param {any} input
 * @returns {any}
 */
export function sanitizeImportedData(input) {
    if (input === null || typeof input !== 'object') {
        return input;
    }
    if (Array.isArray(input)) {
        return input.map(sanitizeImportedData);
    }
    const sanitized = {};
    for (const key of Object.keys(input)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            continue;
        }
        sanitized[key] = sanitizeImportedData(input[key]);
    }
    return sanitized;
}

export function processJSON(rawData, name, options = {}) {
    const data = sanitizeImportedData(rawData);
    const validation = validateExamSchema(data);
    if (!validation.valid) {
        const errorList = validation.errors.slice(0, 5).join('\n• ');
        const suffix = validation.errors.length > 5 ? `\n... ve ${validation.errors.length - 5} hata daha.` : '';
        showAlert(`Şema doğrulama hatası:\n• ${errorList}${suffix}`, t('invalid_format'));
        return null;
    }

    const rawQuestions = getQuestionsFromData(data) || [];
    const normalizedQuestions = normalizeQuestions(rawQuestions);
    let title = data.exam_metadata?.title || data.sources?.[0]?.name || data.exam?.title || name;

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

    if (!options.silent) {
        // The file parsed, but some questions may still be unanswerable. Let the
        // user decide what happens to those rather than quietly importing them.
        const gaps = findContentGaps(normalizedQuestions);
        if (gaps.length > 0) {
            showImportReport(source, gaps);
        } else {
            showAlert(t('import_success_msg', { name: title, count: normalizedQuestions.length }), t('success_title'));
        }
    }
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
