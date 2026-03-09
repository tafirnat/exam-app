import { AppState } from './state.js';

export function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.innerText = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
}

export function shuffleArray(arr) {
    const array = [...arr];
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

export async function translateText(text, targetLang = null) {
    const lang = targetLang || AppState.translationTarget || 'tr';
    try {
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(text)}`);
        const data = await res.json();
        return data[0].map(x => x[0]).join('');
    } catch (e) {
        console.error('Translation failed', e);
        return null;
    }
}

export function generateId(prefix = '') {
    return prefix + Math.random().toString(36).substr(2, 9);
}

/**
 * Robustly extracts correct answers from a question object, handling multiple formats.
 * @param {Object} q The question object.
 * @returns {Array<string|number>} List of correct answers or option IDs.
 */
export function getCorrectAnswers(q) {
    if (!q) return [];

    // Explicit list of correct IDs/Texts
    if (Array.isArray(q.correctOptionIds) && q.correctOptionIds.length > 0) {
        return q.correctOptionIds;
    }

    // Check 'answer' object patterns
    if (q.answer) {
        if (Array.isArray(q.answer.correct_ids)) return q.answer.correct_ids;
        if (Array.isArray(q.answer.correctIds)) return q.answer.correctIds;
        if (Array.isArray(q.answer.accepted_texts)) return q.answer.accepted_texts;
        if (typeof q.answer === 'string' && q.answer.trim()) return [q.answer];
    }

    // Check direct properties
    if (q.correct_answer) {
        return Array.isArray(q.correct_answer) ? q.correct_answer : [q.correct_answer];
    }
    if (q.correctAnswer) {
        return Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer];
    }

    return [];
}

/**
 * Highlights a keyword within a string by wrapping it in a span.
 * @param {string} text The source text.
 * @param {string} keyword The keyword to highlight.
 * @returns {string} The HTML string with highlights.
 */
export function highlightText(text, keyword) {
    if (!text || !keyword || keyword.trim() === '') return text;
    try {
        const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedKeyword})`, 'gi');
        return text.replace(regex, '<span class="search-highlight">$1</span>');
    } catch (e) {
        return text;
    }
}
/**
 * Shows a custom professional confirmation dialog.
 * @param {string} message The message to show.
 * @param {string} title Optional title.
 * @returns {Promise<boolean>} Resolves to true if confirmed, false otherwise.
 */
export function showConfirm(message, title = '') {
    return new Promise((resolve) => {
        const overlay = document.getElementById('customModalOverlay');
        const titleEl = document.getElementById('modalTitle');
        const headerEl = document.getElementById('modalHeader');
        const messageEl = document.getElementById('modalMessage');
        const confirmBtn = document.getElementById('modalConfirmBtn');
        const cancelBtn = document.getElementById('modalCancelBtn');

        if (!overlay || !messageEl || !confirmBtn || !cancelBtn) {
            // Fallback to native if DOM elements are missing
            resolve(window.confirm(message));
            return;
        }

        messageEl.innerText = message;
        if (title) {
            titleEl.innerText = title;
            headerEl.style.display = 'block';
        } else {
            headerEl.style.display = 'none';
        }

        cancelBtn.style.display = 'inline-flex';
        overlay.classList.add('active');

        const handleConfirm = () => {
            cleanup();
            resolve(true);
        };

        const handleCancel = () => {
            cleanup();
            resolve(false);
        };

        const cleanup = () => {
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            overlay.classList.remove('active');
        };

        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);
    });
}

/**
 * Shows a custom professional alert dialog.
 * @param {string} message The message to show.
 * @param {string} title Optional title.
 * @returns {Promise<void>} Resolves when the user clicks OK.
 */
export function showAlert(message, title = '') {
    return new Promise((resolve) => {
        const overlay = document.getElementById('customModalOverlay');
        const titleEl = document.getElementById('modalTitle');
        const headerEl = document.getElementById('modalHeader');
        const messageEl = document.getElementById('modalMessage');
        const confirmBtn = document.getElementById('modalConfirmBtn');
        const cancelBtn = document.getElementById('modalCancelBtn');

        if (!overlay || !messageEl || !confirmBtn || !cancelBtn) {
            window.alert(message);
            resolve();
            return;
        }

        messageEl.innerText = message;
        if (title) {
            titleEl.innerText = title;
            headerEl.style.display = 'block';
        } else {
            headerEl.style.display = 'none';
        }

        cancelBtn.style.display = 'none'; // Hide cancel button for alerts
        overlay.classList.add('active');

        const handleConfirm = () => {
            confirmBtn.removeEventListener('click', handleConfirm);
            overlay.classList.remove('active');
            resolve();
        };

        confirmBtn.addEventListener('click', handleConfirm);
    });
}
