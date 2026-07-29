/* ==========================================================================
   QUESTION RULES
   ---------------------------------------------------------------------------
   What a question of each type must contain, defined once. Both the question
   editor (which blocks a save and jumps to the offending tab) and the importer
   (which reports gaps and offers to flag or drop them) read their rules from
   here, so the two can never drift apart.

   A JSON file can be structurally perfect and still describe a question nobody
   can answer — a single_choice with no correct option marked, a flashcard with
   a blank back. Those are content gaps, not schema errors, and they are what
   findQuestionIssues reports.

   Issue codes double as i18n key suffixes: `validation_<code>`.
   ========================================================================== */

export const CHOICE_TYPES = ['single_choice', 'multiple_choice', 'true_false'];
export const TEXT_TYPES = ['text_input', 'text', 'open_ended', 'fill_in_the_blank'];
export const READING_TYPES = ['reading', 'topic_review'];
export const FLASHCARD_TYPES = ['flashcard'];

export const KNOWN_TYPES = [...CHOICE_TYPES, ...TEXT_TYPES, ...FLASHCARD_TYPES, ...READING_TYPES];

export function getQuestionCategory(type) {
    if (CHOICE_TYPES.includes(type)) return 'choice';
    if (FLASHCARD_TYPES.includes(type)) return 'flashcard';
    // Reading/topic cards are prose only — no options and no answer to check.
    if (READING_TYPES.includes(type)) return 'reading';
    return 'text';
}

const filled = (value) => String(value ?? '').trim() !== '';

function getText(q) {
    return q?.content?.text ?? q?.text;
}

function hasContent(q) {
    return filled(getText(q)) || filled(q?.content?.media?.[0]?.url);
}

/* Imported files spell the correct answer half a dozen different ways; the
   editor only ever writes answer.correct_ids. Read all of them so a hand-built
   file is not reported as broken just for using an older key. */
function readCorrectIds(q) {
    const a = q?.answer;
    const lists = [q?.correctOptionIds, a?.correct_ids, a?.correct_option_ids, a?.correctIds];
    for (const list of lists) {
        if (Array.isArray(list) && list.length > 0) return list.map(String);
    }
    const singles = [a?.correct_id, a?.correct_option_id, a?.correct_option];
    for (const single of singles) {
        if (single !== undefined && single !== null) return [String(single)];
    }
    return [];
}

function readAcceptedTexts(q) {
    const a = q?.answer;
    if (Array.isArray(a?.accepted_texts) && a.accepted_texts.length > 0) return a.accepted_texts;
    const single = a?.correct_answer ?? a?.correct_text;
    if (single === undefined || single === null) return [];
    return Array.isArray(single) ? single : [single];
}

/**
 * Everything about this question that contradicts its own type.
 * @returns {{code: string, group: string}[]} empty when the question is sound.
 *          `group` names the editor tab that fixes the issue.
 */
export function findQuestionIssues(q) {
    const issues = [];
    const category = getQuestionCategory(q?.type || '');

    if (category === 'flashcard') {
        if (!filled(getText(q))) issues.push({ code: 'front_required', group: 'flashcard' });
        if (!filled(q?.answer?.back)) issues.push({ code: 'back_required', group: 'flashcard' });
        return issues;
    }

    // Media-only content is legitimate, so either one satisfies the requirement.
    if (!hasContent(q)) issues.push({ code: 'text_required', group: 'content' });

    if (category === 'choice') {
        const options = Array.isArray(q?.options) ? q.options : [];
        if (options.length < 2) {
            issues.push({ code: 'min_options', group: 'options' });
        } else if (options.some(o => !filled(o?.text) && !filled(o?.media?.[0]?.url))) {
            issues.push({ code: 'empty_option', group: 'options' });
        }

        // A mark pointing at an option that does not exist is no mark at all.
        const liveIds = options.map(o => String(o?.id));
        const correct = readCorrectIds(q).filter(id => liveIds.includes(id));

        if (q?.type === 'multiple_choice') {
            if (correct.length < 2) issues.push({ code: 'multi_correct', group: 'options' });
        } else if (correct.length !== 1) {
            issues.push({ code: 'single_correct', group: 'options' });
        }
    }

    if (category === 'text' && readAcceptedTexts(q).length === 0) {
        issues.push({ code: 'accepted_required', group: 'answer' });
    }

    return issues;
}

/**
 * The questions in a list that carry at least one content gap.
 * @returns {{index: number, id: *, label: string, type: string, issues: object[]}[]}
 */
export function findContentGaps(questions) {
    if (!Array.isArray(questions)) return [];

    return questions.reduce((gaps, q, index) => {
        const issues = findQuestionIssues(q);
        if (issues.length === 0) return gaps;

        // Strip markup so a reading card's HTML body does not leak into the list.
        const raw = String(getText(q) ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        gaps.push({
            index,
            id: q?.id,
            type: q?.type || '?',
            label: raw.length > 90 ? raw.slice(0, 90) + '…' : raw,
            issues
        });
        return gaps;
    }, []);
}
