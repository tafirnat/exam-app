/* The question editor is driven entirely by the question type: the type <select>
   decides which tabs exist and which fields render. These run against a real DOM
   because that coupling only shows up once the modal is actually built. */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom, openQuestionEditor;

before(async () => {
    dom = new JSDOM('<!doctype html><html><body><div id="toast"></div></body></html>',
        { url: 'http://localhost/' });

    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    ({ openQuestionEditor } = await import('../src/features/stats/question-editor.js'));
});

const tabs = () => [...document.querySelectorAll('.editor-group-nav .group-btn')].map(b => b.dataset.group);
const navCount = () => document.querySelector('.editor-group-nav')?.getAttribute('data-count');
const typeEl = () => document.getElementById('edit-type');

/** Pick a type the way a user does, so the editor's own change handler runs. */
const setType = (value) => {
    const el = typeEl();
    el.value = value;
    el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
};

const openReading = () => openQuestionEditor({
    id: 'read_002', sourceId: 's1', type: 'reading',
    content: { text: 'prose' }, answer: { explanation: 'e' }
});

test('a reading card opens on its real type, with no Options tab', () => {
    openReading();
    assert.equal(typeEl().value, 'reading', 'the select must not fall back to the first option');
    assert.deepEqual(tabs(), ['general', 'content', 'answer']);
    assert.equal(navCount(), '3');
});

test('a reading card offers no accepted-answers field', () => {
    openReading();
    document.querySelector('[data-group="answer"]').click();
    assert.equal(document.getElementById('edit-accepted-texts'), null);
    assert.ok(document.getElementById('edit-explanation'));
});

test('choosing a choice type adds the Options tab and seeds two options', () => {
    openReading();
    setType('single_choice');
    assert.deepEqual(tabs(), ['general', 'content', 'options', 'answer']);
    assert.equal(navCount(), '4');
    assert.equal(document.querySelectorAll('.option-edit-card').length, 2);
});

test('choosing flashcard collapses to two tabs and swaps in the card fields', () => {
    openReading();
    setType('flashcard');
    assert.deepEqual(tabs(), ['general', 'flashcard']);
    assert.equal(navCount(), '2');
    assert.ok(document.getElementById('edit-fc-front'));
    assert.ok(document.getElementById('edit-fc-back'));
});

test('choosing a text type brings back the accepted-answers field', () => {
    openReading();
    setType('text_input');
    assert.deepEqual(tabs(), ['general', 'content', 'answer']);
    document.querySelector('[data-group="answer"]').click();
    assert.ok(document.getElementById('edit-accepted-texts'));
});

test('a tab that the new type does not have cannot stay selected', () => {
    openReading();
    setType('single_choice');
    document.querySelector('[data-group="options"]').click();
    assert.ok(document.getElementById('section-options').classList.contains('active'));

    setType('reading');
    assert.deepEqual(tabs(), ['general', 'content', 'answer']);
    assert.ok(document.getElementById('section-general').classList.contains('active'));
});

test('text typed before a type switch is not lost', () => {
    openReading();
    setType('flashcard');
    document.getElementById('edit-fc-front').value = 'FRONT TEXT';
    setType('reading');
    assert.equal(document.getElementById('edit-text').value, 'FRONT TEXT');
});

test('an unrecognised type is preserved rather than coerced', () => {
    openQuestionEditor({ id: 'x1', sourceId: 's1', type: 'weird_type', content: { text: 'hi' } });
    assert.equal(typeEl().value, 'weird_type');
});
