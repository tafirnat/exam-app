import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom, renderTypeOptions, openQuestionEditor;

before(async () => {
    dom = new JSDOM('<!doctype html><html><body><div id="toast"></div></body></html>', {
        url: 'http://localhost/'
    });

    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    ({ renderTypeOptions, openQuestionEditor } = await import('../src/features/stats/question-editor.js'));
});

test('renderTypeOptions does not include reading for new questions or non-reading types', async () => {
    const defaultOptions = renderTypeOptions();
    assert.ok(!defaultOptions.includes('value="reading"'), 'default options should not offer reading');

    const emptyOptions = renderTypeOptions('');
    assert.ok(!emptyOptions.includes('value="reading"'), 'empty type should not offer reading');

    const standardTypes = ['single_choice', 'multiple_choice', 'true_false', 'short_answer', 'fill_in_the_blank', 'flashcard'];
    for (const t of standardTypes) {
        const html = renderTypeOptions(t);
        assert.ok(!html.includes('value="reading"'), `type ${t} should not offer reading in dropdown`);
        assert.ok(html.includes(`value="${t}" selected`), `type ${t} should be selected`);
    }
});

test('renderTypeOptions preserves reading when current question is already a reading type', async () => {
    const readingOptions = renderTypeOptions('reading');
    assert.ok(readingOptions.includes('value="reading" selected'), 'existing reading question must keep reading in options');
});

test('editor DOM does not offer reading when editing a non-reading question', async () => {
    openQuestionEditor({
        id: 'q_choice_1',
        sourceId: 's1',
        type: 'single_choice',
        content: { text: 'Question text' },
        options: [{ id: 1, text: 'A' }, { id: 2, text: 'B' }],
        answer: { correct_ids: [1] }
    });

    const select = document.getElementById('edit-type');
    assert.ok(select, '#edit-type should exist');
    const optionValues = [...select.options].map(opt => opt.value);
    assert.ok(!optionValues.includes('reading'), '#edit-type options must not contain reading for a choice question');
    assert.equal(select.value, 'single_choice');
});

test('editor DOM keeps reading option when editing an existing reading question', async () => {
    openQuestionEditor({
        id: 'q_read_legacy',
        sourceId: 's1',
        type: 'reading',
        content: { text: 'Some reading prose' },
        answer: { explanation: 'Notes' }
    });

    const select = document.getElementById('edit-type');
    assert.ok(select, '#edit-type should exist');
    const optionValues = [...select.options].map(opt => opt.value);
    assert.ok(optionValues.includes('reading'), '#edit-type options must keep reading when editing existing reading item');
    assert.equal(select.value, 'reading');
});
