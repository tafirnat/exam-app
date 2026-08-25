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

function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function mulberry32(a) {
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Deterministic sibling of shuffleArray: the same seed always yields the same
 * order.
 *
 * Never-reviewed questions all share retrievability 0 and the default
 * difficulty, so sorting cannot separate them - left alone they would come out
 * in library order and the same handful would lead every session forever. The
 * streak run seeds this with the date, so a session interrupted and reopened
 * rebuilds an identical list while tomorrow brings different questions up.
 */
export function shuffleArraySeeded(arr, seed) {
    const array = [...arr];
    const rand = mulberry32(hashSeed(String(seed)));
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

export async function translateText(text, targetLang = null) {
    const lang = targetLang || AppState.translationTarget || 'de';
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
    if (q.answer && typeof q.answer === 'object') {
        if (Array.isArray(q.answer.correct_ids) && q.answer.correct_ids.length > 0) return q.answer.correct_ids;
        if (Array.isArray(q.answer.correct_option_ids) && q.answer.correct_option_ids.length > 0) return q.answer.correct_option_ids;
        if (Array.isArray(q.answer.correctIds) && q.answer.correctIds.length > 0) return q.answer.correctIds;
        if (Array.isArray(q.answer.accepted_texts) && q.answer.accepted_texts.length > 0) return q.answer.accepted_texts;
        if (q.answer.correct_id !== undefined) return [q.answer.correct_id];
        if (q.answer.correct_option_id !== undefined) return [q.answer.correct_option_id];
        if (q.answer.correct_option !== undefined) return [q.answer.correct_option];
        if (q.answer.correct_answer !== undefined) return Array.isArray(q.answer.correct_answer) ? q.answer.correct_answer : [q.answer.correct_answer];
        if (q.answer.correct_text !== undefined) return Array.isArray(q.answer.correct_text) ? q.answer.correct_text : [q.answer.correct_text];
    } else if (typeof q.answer === 'string' && q.answer.trim()) {
        return [q.answer];
    }

    // Check direct properties
    if (q.correct_answer !== undefined) {
        return Array.isArray(q.correct_answer) ? q.correct_answer : [q.correct_answer];
    }
    if (q.correctAnswer !== undefined) {
        return Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer];
    }

    return [];
}

/**
 * Escapes special HTML characters to prevent XSS vulnerabilities.
 * @param {string} str The string to escape.
 * @returns {string} The escaped string.
 */
export function escapeHTML(str) {
    if (!str || typeof str !== 'string') return str || '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Highlights a keyword within a string by wrapping it in a span, with HTML escaping for XSS safety.
 * @param {string} text The source text.
 * @param {string} keyword The keyword to highlight.
 * @returns {string} The HTML string with highlights.
 */
export function highlightText(text, keyword) {
    if (!text || typeof text !== 'string') return '';
    const safeText = escapeHTML(text);
    if (!keyword || typeof keyword !== 'string' || keyword.trim() === '') return safeText;
    try {
        const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedKeyword})`, 'gi');
        return safeText.replace(regex, '<span class="search-highlight">$1</span>');
    } catch (e) {
        return safeText;
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

        const footerEl = document.getElementById('modalFooter');
        if (footerEl) footerEl.style.display = 'flex';
        const closeIconBtn = document.getElementById('modalCloseIconBtn');
        if (closeIconBtn) closeIconBtn.style.display = 'none';

        cancelBtn.style.display = 'inline-flex';
        // The third button belongs to showDecision alone; this card is shared.
        const altBtn = document.getElementById('modalAltBtn');
        if (altBtn) altBtn.style.display = 'none';
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
 * A dialog with three ways out, for questions that are not yes/no.
 *
 * "You have unsaved changes" is the case it exists for: confirming (save) and
 * cancelling (stay here) leave no way to say "throw them away and go", and
 * folding that into Cancel makes the destructive answer the one you reach by
 * backing out. Each intent gets its own button.
 *
 * Shares the card with showConfirm/showAlert, so the extra button is hidden
 * again on the way out - and those two hide it on the way in, because a dialog
 * that inherits a stray third button from the previous one is worse than no
 * third button at all.
 *
 * @param {string} message
 * @param {string} title
 * @param {{confirm: string, alt: string, cancel: string}} labels
 * @returns {Promise<'confirm'|'alt'|'cancel'>}
 */
export function showDecision(message, title = '', labels = {}) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('customModalOverlay');
        const titleEl = document.getElementById('modalTitle');
        const headerEl = document.getElementById('modalHeader');
        const messageEl = document.getElementById('modalMessage');
        const confirmBtn = document.getElementById('modalConfirmBtn');
        const cancelBtn = document.getElementById('modalCancelBtn');
        const altBtn = document.getElementById('modalAltBtn');

        /* No native equivalent of a three-way prompt, so a missing card falls
           back to the safe answer: stay where you are and change nothing. */
        if (!overlay || !messageEl || !confirmBtn || !cancelBtn || !altBtn) {
            resolve('cancel');
            return;
        }

        messageEl.innerText = message;
        if (title) {
            titleEl.innerText = title;
            headerEl.style.display = 'block';
        } else {
            headerEl.style.display = 'none';
        }

        const footerEl = document.getElementById('modalFooter');
        if (footerEl) footerEl.style.display = 'flex';
        const closeIconBtn = document.getElementById('modalCloseIconBtn');
        if (closeIconBtn) closeIconBtn.style.display = 'none';

        /* Labels are set here rather than through data-i18n: this card is shared,
           and a translated label left behind would relabel the next dialog. */
        const previousConfirm = confirmBtn.innerText;
        const previousCancel = cancelBtn.innerText;
        if (labels.confirm) confirmBtn.innerText = labels.confirm;
        if (labels.cancel) cancelBtn.innerText = labels.cancel;
        altBtn.innerText = labels.alt || '';

        cancelBtn.style.display = 'inline-flex';
        altBtn.style.display = 'inline-flex';
        overlay.classList.add('active');

        const finish = (answer) => {
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            altBtn.removeEventListener('click', onAlt);
            altBtn.style.display = 'none';
            confirmBtn.innerText = previousConfirm;
            cancelBtn.innerText = previousCancel;
            overlay.classList.remove('active');
            resolve(answer);
        };

        const onConfirm = () => finish('confirm');
        const onCancel = () => finish('cancel');
        const onAlt = () => finish('alt');

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        altBtn.addEventListener('click', onAlt);
    });
}

/**
 * JSON with object keys in a fixed order, for comparing two shapes of the same
 * data.
 *
 * Plain JSON.stringify preserves insertion order, so deleting a field and
 * putting it back - which is exactly what the editor's normalizeForType() does
 * on a type change - produces a different string for identical data. A dirty
 * check built on that reports changes the user never made.
 */
export function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

    const keys = Object.keys(value).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
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

        messageEl.innerHTML = message;
        if (title) {
            titleEl.innerText = title;
            headerEl.style.display = 'block';
        } else {
            headerEl.style.display = 'none';
        }

        const footerEl = document.getElementById('modalFooter');
        if (footerEl) footerEl.style.display = 'flex';
        const closeIconBtn = document.getElementById('modalCloseIconBtn');
        if (closeIconBtn) closeIconBtn.style.display = 'none';

        cancelBtn.style.display = 'none'; // Hide cancel button for alerts
        const altBtn = document.getElementById('modalAltBtn');
        if (altBtn) altBtn.style.display = 'none';
        overlay.classList.add('active');

        const handleConfirm = () => {
            confirmBtn.removeEventListener('click', handleConfirm);
            overlay.classList.remove('active');
            resolve();
        };

        confirmBtn.addEventListener('click', handleConfirm);
    });
}

/**
 * Shows an informational modal that can be closed by clicking outside or the close icon.
 * @param {string} message The message to show.
 * @param {string} title Optional title.
 * @returns {Promise<void>} Resolves when the modal is closed.
 */
export function showInfoAlert(message, title = '') {
    return new Promise((resolve) => {
        const overlay = document.getElementById('customModalOverlay');
        const titleEl = document.getElementById('modalTitle');
        const headerEl = document.getElementById('modalHeader');
        const messageEl = document.getElementById('modalMessage');
        const footerEl = document.getElementById('modalFooter');
        const closeIconBtn = document.getElementById('modalCloseIconBtn');

        if (!overlay || !messageEl) {
            window.alert(message);
            resolve();
            return;
        }

        messageEl.innerHTML = message;
        if (title) {
            titleEl.innerText = title;
            headerEl.style.display = 'flex';
            headerEl.style.justifyContent = 'space-between';
            headerEl.style.alignItems = 'center';
        } else {
            headerEl.style.display = 'none';
        }

        if (footerEl) footerEl.style.display = 'none';
        if (closeIconBtn) closeIconBtn.style.display = 'block';

        overlay.classList.add('active');

        const cleanup = () => {
            if (closeIconBtn) closeIconBtn.removeEventListener('click', handleClose);
            overlay.removeEventListener('click', handleOutsideClick);
            overlay.classList.remove('active');
            
            // Restore default styles for other alerts
            if (footerEl) footerEl.style.display = 'flex';
            if (closeIconBtn) closeIconBtn.style.display = 'none';
            if (headerEl.style.display === 'flex') headerEl.style.display = 'block';
            
            resolve();
        };

        const handleClose = () => {
            cleanup();
        };

        const handleOutsideClick = (e) => {
            if (e.target === overlay) {
                cleanup();
            }
        };

        if (closeIconBtn) closeIconBtn.addEventListener('click', handleClose);
        overlay.addEventListener('click', handleOutsideClick);
    });
}
