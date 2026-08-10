/* ==========================================================================
   AI PROMPTS
   ---------------------------------------------------------------------------
   The prompt library: what the user can send a question to an external AI as.

   There used to be exactly one prompt (`AppState.customAIPrompt`), which made
   the external-AI button answer exactly one question — "explain the correct
   solution". Verifying a question, having a topic taught, or having an
   open-ended answer graded each need a different instruction, and rewriting the
   single template before each one is not a workflow anyone keeps up.

   Three things live here, and they are separate on purpose:

   - The *library*: user records with ids, merged across devices by id. The
     shape is quickPresets', because the merge problem is quickPresets' — two
     devices each adding a prompt must end up with two prompts, which is exactly
     what a single last-writer-wins value cannot do (see CLAUDE.md (24)).
   - The *standard prompt*, which is NOT in the library. It is a virtual record
     backed by `customAIPrompt`, and that buys two things a stored record could
     not: it cannot be deleted because there is nothing to delete, and when it
     has not been overridden it keeps resolving through the translations, so
     switching the app language moves the prompt with it. A copy in the library
     would freeze in whatever language it was seeded in.
   - The *ad-hoc prompt*, written for one question and never synced.

   Formatting is the other half. A prompt naming {answer} is useless if the
   answer never reaches it, so the variable set covers what the three workflows
   actually need, and a variable with nothing behind it takes its whole line
   with it — a short_answer question has no options, and "Options:" followed by
   nothing is worse than silence.
   ========================================================================== */

import { AppState } from './state.js';
import { translations, t } from './i18n.js';
import { getQuestionCategory, readCorrectIds, readAcceptedTexts } from './question-rules.js';
import { clozeAnswers } from './cloze.js';

/** The standard prompt. Never stored in the library - see the header. */
export const DEFAULT_PROMPT_ID = 'default';

/** The one-off prompt typed for a single question. Never synced. */
export const ADHOC_PROMPT_ID = 'adhoc';

/**
 * The placeholders a prompt body may use.
 *
 * Only these names are substituted. Anything else in braces is the user's own
 * text and is left exactly as written - a prompt is allowed to contain JSON.
 */
export const PROMPT_VARIABLES = Object.freeze([
    'question', 'options', 'answer', 'correct', 'source'
]);

/* The seeded starter prompts. Their ids are fixed so the same three records are
   produced on every device: seeding runs locally on each one, and ids generated
   per device would merge into three copies of each prompt. */
export const SEED_PROMPT_IDS = Object.freeze(['seed-verify', 'seed-explain', 'seed-evaluate']);

/** Which language's built-in strings to use. Falls back rather than showing keys. */
function promptLanguage() {
    const lang = AppState.language || 'en';
    return ['tr', 'en', 'de'].includes(lang) ? lang : 'en';
}

/** The built-in standard template, in the user's language. */
export function builtinPromptBody() {
    const lang = promptLanguage();
    return translations[lang]?.ai_prompt_template
        || translations.en?.ai_prompt_template
        || '';
}

/**
 * The standard prompt's body: the user's override if they wrote one, otherwise
 * the built-in template for the current language.
 */
export function defaultPromptBody() {
    return AppState.customAIPrompt || builtinPromptBody();
}

/** The user's saved prompts, oldest first, with malformed records dropped. */
export function libraryPrompts() {
    return (AppState.aiPrompts || [])
        .filter(p => p && p.id)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

/**
 * Everything selectable, in menu order: the standard prompt, the library, and
 * the ad-hoc prompt when one is live.
 */
export function listPrompts() {
    const list = [{
        id: DEFAULT_PROMPT_ID,
        title: t('prompt_standard'),
        body: defaultPromptBody(),
        builtin: true
    }];

    libraryPrompts().forEach(p => {
        list.push({ id: p.id, title: p.title || t('prompt_untitled'), body: p.body || '' });
    });

    const adhoc = AppState.adhocPrompt;
    if (adhoc && String(adhoc).trim()) {
        list.push({ id: ADHOC_PROMPT_ID, title: t('prompt_adhoc'), body: adhoc, adhoc: true });
    }

    return list;
}

/**
 * The prompt to send with, resolved from `AppState.activePromptId`.
 *
 * Falls back to the standard prompt rather than failing: the selection syncs,
 * so it can name a prompt another device has since deleted, and the user should
 * get their question sent rather than an error about a record they never saw.
 */
export function resolveActivePrompt() {
    const id = AppState.activePromptId || DEFAULT_PROMPT_ID;
    return listPrompts().find(p => p.id === id) || listPrompts()[0];
}

/**
 * Fills a template, dropping the lines whose variables came up empty.
 *
 * A line goes only when *every* variable on it is empty. One filled variable
 * keeps the line, because dropping it would throw away content the user can see
 * is there - "Question: {question} / Answer: {answer}" on one line must not lose
 * the question just because the question is unanswered.
 */
export function fillTemplate(body, vars = {}) {
    const pattern = new RegExp(`\\{(${PROMPT_VARIABLES.join('|')})\\}`, 'g');
    const value = (name) => String(vars[name] ?? '').trim();

    return String(body || '')
        .split('\n')
        .filter(line => {
            const names = [...line.matchAll(pattern)].map(m => m[1]);
            if (names.length === 0) return true;
            return names.some(name => value(name) !== '');
        })
        .map(line => line.replace(pattern, (_, name) => value(name)))
        .join('\n')
        .trim();
}

/**
 * Puts a variable name into a prompt body, where the caret is.
 *
 * The arithmetic lives here rather than in the click handler so it can be
 * tested: the handler's own job is reading the caret off a textarea and writing
 * the result back, which is the part that needs a browser.
 *
 * @param {string} value the body as it stands
 * @param {string} name a variable name, without braces
 * @param {number} start caret position, or the start of a selection it replaces
 * @param {number} [end] end of that selection; same as `start` for a plain caret
 * @returns {{value: string, caret: number}} the new body and where to leave the caret
 */
export function insertVariableAt(value, name, start, end = start) {
    const token = `{${name}}`;
    const text = String(value ?? '');
    const from = Math.max(0, Math.min(start ?? text.length, text.length));
    const to = Math.max(from, Math.min(end ?? from, text.length));

    const before = text.slice(0, from);
    const after = text.slice(to);
    /* A separator only where one is missing. Clicking twice must not produce
       "{question}{options}", and a name dropped straight after a word would
       read as part of it. */
    const lead = before && !/\s$/.test(before) ? ' ' : '';

    return { value: before + lead + token + after, caret: (before + lead + token).length };
}

/** An option's text, by id. */
function optionText(q, id) {
    const opt = (q?.options || []).find(o => String(o.id) === String(id));
    return opt ? (opt.text ?? '') : '';
}

/**
 * The variable values for one question.
 *
 * `userAnswer` is the raw AppState.userAnswers entry: option ids for a choice
 * question, typed strings for text and cloze. Everything that has no value -
 * an unanswered question, a short_answer's non-existent options - comes back as
 * an empty string, which is what makes fillTemplate drop its line.
 */
export function buildPromptVars(q, { userAnswer = null, sourceName = '' } = {}) {
    if (!q) return null;

    const category = getQuestionCategory(q.type || '');
    const questionText = q.content?.text || q.text || '';
    const answers = Array.isArray(userAnswer) ? userAnswer : (userAnswer ? [userAnswer] : []);

    let options = '';
    let correct = '';
    let answer = '';

    if (category === 'choice') {
        options = (q.options || []).map(o => o.text).filter(Boolean).join(', ');
        correct = readCorrectIds(q).map(id => optionText(q, id)).filter(Boolean).join(', ');
        answer = answers.map(id => optionText(q, id)).filter(Boolean).join(', ');
    } else if (category === 'cloze') {
        correct = clozeAnswers(questionText).filter(Boolean).join(', ');
        answer = answers.map(a => String(a ?? '').trim()).filter(Boolean).join(', ');
    } else if (category === 'flashcard') {
        correct = q.answer?.back || '';
        answer = answers.map(a => String(a ?? '').trim()).filter(Boolean).join(', ');
    } else {
        /* text - the open-ended case the evaluate workflow exists for. There are
           no options at all here, so {options} resolves empty and its line goes;
           the old formatter printed a "Text response" placeholder in its place,
           which told the AI nothing and read as a real option list. */
        correct = readAcceptedTexts(q).map(a => String(a ?? '').trim()).filter(Boolean).join(', ');
        answer = answers.map(a => String(a ?? '').trim()).filter(Boolean).join('\n');
    }

    return { question: questionText, options, correct, answer, source: sourceName || '' };
}
