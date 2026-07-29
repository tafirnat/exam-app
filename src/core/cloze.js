/* ==========================================================================
   CLOZE
   ---------------------------------------------------------------------------
   Fill-in-the-blank questions carry their answers inside the sentence rather
   than in a separate accepted_texts list:

       "Ankara {{Türkiye'nin}} başkentidir."
       "HTTP {{80|Port 80}} portunu, HTTPS {{443}} portunu kullanır."

   A marker may list alternatives separated by |. The first one is the
   canonical answer shown in feedback; the rest are only accepted on input,
   which is what keeps exact matching from punishing "Port 80" vs "80".

   Parsing lives here, alone, because three places need to agree on it: the
   test runner renders the blanks, the grader checks them, and the editor and
   importer validate that a fill_in_the_blank question actually has any.
   ========================================================================== */

const MARKER = /\{\{([^{}]*)\}\}/g;

/**
 * Split a cloze sentence into its literal text and its blanks.
 * @returns {{segments: {type: 'text'|'blank', value?: string, index?: number,
 *            answers?: string[]}[], blanks: {index: number, answers: string[]}[]}}
 *          `blanks` is index-aligned with the user's answer array.
 */
export function parseCloze(text) {
    const source = String(text ?? '');
    const segments = [];
    const blanks = [];
    let cursor = 0;

    for (const match of source.matchAll(MARKER)) {
        if (match.index > cursor) {
            segments.push({ type: 'text', value: source.slice(cursor, match.index) });
        }

        const answers = match[1].split('|').map(a => a.trim()).filter(a => a !== '');
        const blank = { index: blanks.length, answers };
        blanks.push(blank);
        segments.push({ type: 'blank', ...blank });

        cursor = match.index + match[0].length;
    }

    if (cursor < source.length) {
        segments.push({ type: 'text', value: source.slice(cursor) });
    }

    return { segments, blanks };
}

/** True when the text carries at least one usable blank. */
export function hasBlanks(text) {
    return parseCloze(text).blanks.some(b => b.answers.length > 0);
}

/** Markers written but left empty — `{{}}` or `{{ | }}` — which can never be answered. */
export function countEmptyBlanks(text) {
    return parseCloze(text).blanks.filter(b => b.answers.length === 0).length;
}

/** The sentence as the reader sees it once solved, markers replaced by answers. */
export function fillCloze(text, values) {
    return parseCloze(text).segments.map(seg =>
        seg.type === 'text' ? seg.value : (values?.[seg.index] ?? seg.answers[0] ?? '')
    ).join('');
}

/** The canonical answer of every blank, in order. */
export function clozeAnswers(text) {
    return parseCloze(text).blanks.map(b => b.answers[0] ?? '');
}

/**
 * The sentence as HTML with each marker turned into a numbered gap.
 * @param {(s: string) => string} escape applied to the literal text only, so
 *        the caller decides whether the sentence may carry its own markup.
 */
export function clozeMarkup(text, escape = (s) => s) {
    return parseCloze(text).segments.map(seg =>
        seg.type === 'text'
            ? escape(seg.value)
            : `<span class="cloze-gap" data-blank="${seg.index}">${seg.index + 1}</span>`
    ).join('');
}

/**
 * Whether one blank's input is acceptable. Mirrors the text-answer comparison:
 * trimmed, and case-insensitive unless the question opts in.
 */
export function matchesBlank(blank, value, caseSensitive = false) {
    const normalise = (s) => {
        const trimmed = String(s ?? '').trim();
        return caseSensitive ? trimmed : trimmed.toLowerCase();
    };
    const given = normalise(value);
    if (given === '') return false;
    return blank.answers.some(answer => normalise(answer) === given);
}

/** Grade a whole cloze question: every blank must be answered correctly. */
export function gradeCloze(text, values, caseSensitive = false) {
    const { blanks } = parseCloze(text);
    if (blanks.length === 0) return false;
    return blanks.every(blank => matchesBlank(blank, values?.[blank.index], caseSensitive));
}
