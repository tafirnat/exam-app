import test from 'node:test';
import assert from 'node:assert/strict';
import { findQuestionIssues, findContentGaps } from '../src/core/question-rules.js';

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

test('multiple_choice needs at least two correct options', () => {
    assert.deepEqual(codes(choice({ type: 'multiple_choice' })), ['multi_correct']);
    assert.deepEqual(codes(choice({ type: 'multiple_choice', answer: { correct_ids: [1, 2] } })), []);
});

test('a mark pointing at a missing option does not count', () => {
    assert.deepEqual(codes(choice({ answer: { correct_ids: [99] } })), ['single_correct']);
});

test('text questions need an accepted answer', () => {
    assert.deepEqual(codes({ type: 'text_input', content: { text: 'q' }, answer: {} }), ['accepted_required']);
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
