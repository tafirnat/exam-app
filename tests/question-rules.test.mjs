import test from 'node:test';
import assert from 'node:assert/strict';
import {
    findQuestionIssues, findContentGaps, canonicalType, getQuestionCategory
} from '../src/core/question-rules.js';

const codes = q => findQuestionIssues(q).map(i => i.code);

const choice = (over = {}) => ({
    type: 'single_choice',
    content: { text: 'q' },
    options: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }],
    answer: { correct_ids: [1] },
    ...over
});

test('a sound question of each type reports nothing', () => {
    assert.deepEqual(codes(choice()), []);
    assert.deepEqual(codes(choice({ type: 'multiple_choice', answer: { correct_ids: [1, 2] } })), []);
    assert.deepEqual(codes(choice({ type: 'true_false' })), []);
    assert.deepEqual(codes({ type: 'text_input', content: { text: 'q' }, answer: { accepted_texts: ['a'] } }), []);
    assert.deepEqual(codes({ type: 'reading', content: { text: 'prose' } }), []);
    assert.deepEqual(codes({ type: 'flashcard', content: { text: 'f' }, answer: { back: 'b' } }), []);
});

test('a choice question needs at least two options', () => {
    assert.deepEqual(codes(choice({ options: [{ id: 1, text: 'a' }] })), ['min_options']);
    assert.deepEqual(codes(choice({ options: [], answer: {} })), ['min_options', 'single_correct']);
});

test('every option needs text or media', () => {
    assert.deepEqual(codes(choice({ options: [{ id: 1, text: 'a' }, { id: 2, text: '  ' }] })), ['empty_option']);
    assert.deepEqual(codes(choice({
        options: [{ id: 1, text: 'a' }, { id: 2, text: '', media: [{ url: 'u' }] }]
    })), []);
});

test('single_choice and true_false need exactly one correct option', () => {
    assert.deepEqual(codes(choice({ answer: {} })), ['single_correct']);
    assert.deepEqual(codes(choice({ answer: { correct_ids: [1, 2] } })), ['single_correct']);
    assert.deepEqual(codes(choice({ type: 'true_false', answer: { correct_ids: [2] } })), []);
});

test('true_false is a closed pair — not two-or-more', () => {
    const tf = (options) => codes(choice({ type: 'true_false', options, answer: { correct_ids: [1] } }));

    assert.deepEqual(tf([{ id: 1, text: 'T' }, { id: 2, text: 'F' }]), [], 'exactly two is the only valid shape');
    assert.deepEqual(tf([{ id: 1, text: 'T' }, { id: 2, text: 'F' }, { id: 3, text: 'Maybe' }]),
        ['true_false_options'], 'a third option is rejected, unlike single_choice');
    assert.deepEqual(tf([{ id: 1, text: 'T' }]), ['true_false_options']);

    // The extra option is only an error for true_false.
    assert.deepEqual(codes(choice({ options: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }] })), []);
});

test('multiple_choice needs at least two correct options', () => {
    assert.deepEqual(codes(choice({ type: 'multiple_choice' })), ['multi_correct']);
    assert.deepEqual(codes(choice({ type: 'multiple_choice', answer: { correct_ids: [1, 2] } })), []);
});

test('a mark pointing at a missing option does not count', () => {
    assert.deepEqual(codes(choice({ answer: { correct_ids: [99] } })), ['single_correct']);
});

test('short_answer questions need an accepted answer', () => {
    assert.deepEqual(codes({ type: 'short_answer', content: { text: 'q' }, answer: {} }), ['accepted_required']);
    assert.deepEqual(codes({ type: 'short_answer', content: { text: 'q' }, answer: { accepted_texts: ['a'] } }), []);
});

test('the retired text spellings still resolve to short_answer', () => {
    for (const legacy of ['text', 'text_input', 'open_ended']) {
        assert.equal(canonicalType(legacy), 'short_answer', `${legacy} maps to the surviving name`);
        assert.equal(getQuestionCategory(legacy), 'text', `${legacy} is still gradeable`);
        assert.deepEqual(
            codes({ type: legacy, content: { text: 'q' }, answer: { accepted_texts: ['a'] } }), [],
            `a file written with ${legacy} is not reported as broken`
        );
    }
    assert.equal(canonicalType('short_answer'), 'short_answer', 'and the canonical name is left alone');
    assert.equal(canonicalType('flashcard'), 'flashcard');
});

test('fill_in_the_blank is graded from its markers, not accepted_texts', () => {
    const cloze = (text) => codes({ type: 'fill_in_the_blank', content: { text } });

    assert.deepEqual(cloze("Ankara {{Türkiye'nin}} başkentidir."), []);
    assert.deepEqual(cloze('HTTP {{80}} ve HTTPS {{443}}.'), [], 'several blanks are fine');
    assert.deepEqual(cloze('Ankara başkenttir.'), ['cloze_required'], 'a sentence with no gap is not a question');
    assert.deepEqual(cloze('Ankara {{}} başkentidir.'), ['cloze_empty_blank'], 'an empty marker is caught');

    // accepted_texts is irrelevant here — the sentence is the answer key.
    assert.deepEqual(
        codes({ type: 'fill_in_the_blank', content: { text: 'no gap' }, answer: { accepted_texts: ['x'] } }),
        ['cloze_required']
    );
});

test('a cloze issue points at Question Content, where the sentence is edited', () => {
    const [issue] = findQuestionIssues({ type: 'fill_in_the_blank', content: { text: 'no gap' } });
    assert.equal(issue.group, 'content');
});

test('a flashcard needs both sides', () => {
    assert.deepEqual(codes({ type: 'flashcard', content: { text: 'f' }, answer: {} }), ['back_required']);
    assert.deepEqual(codes({ type: 'flashcard' }), ['front_required', 'back_required']);
});

test('question text is required, but media alone satisfies it', () => {
    assert.deepEqual(codes({ type: 'reading', content: { text: '' } }), ['text_required']);
    assert.deepEqual(codes({ type: 'reading', content: { text: '', media: [{ url: 'u' }] } }), []);
    assert.deepEqual(codes({ type: 'reading', text: 'top level prose' }), []);
});

test('legacy answer spellings from imported files are honoured', () => {
    assert.deepEqual(codes(choice({ answer: { correct_id: 1 } })), []);
    assert.deepEqual(codes(choice({ type: 'multiple_choice', answer: { correct_option_ids: [1, 2] } })), []);
    assert.deepEqual(codes(choice({ answer: {}, correctOptionIds: [2] })), []);
    assert.deepEqual(codes({ type: 'text_input', content: { text: 'q' }, answer: { correct_answer: 'x' } }), []);
});

test('findContentGaps lists only broken questions, with usable labels', () => {
    const gaps = findContentGaps([
        { id: 'ok1', type: 'reading', content: { text: 'fine' } },
        { id: 'bad1', type: 'flashcard', content: { text: '<b>front</b> here' }, answer: {} }
    ]);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].index, 1);
    assert.equal(gaps[0].id, 'bad1');
    assert.equal(gaps[0].label, 'front here', 'markup is stripped from the preview label');
    assert.deepEqual(gaps[0].issues.map(i => i.code), ['back_required']);
});

test('findContentGaps tolerates junk input', () => {
    assert.deepEqual(findContentGaps(null), []);
    assert.deepEqual(findContentGaps(undefined), []);
});

test('each issue names the editor tab that fixes it', () => {
    const groupOf = (q, code) => findQuestionIssues(q).find(i => i.code === code)?.group;
    assert.equal(groupOf(choice({ options: [] }), 'min_options'), 'options');
    assert.equal(groupOf({ type: 'text_input', content: { text: 'q' } }, 'accepted_required'), 'answer');
    assert.equal(groupOf({ type: 'reading' }, 'text_required'), 'content');
    assert.equal(groupOf({ type: 'flashcard', content: { text: 'f' } }, 'back_required'), 'flashcard');
});
