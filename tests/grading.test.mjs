/* evaluateAnswer is where a question's type finally decides whether the reader
   was right. It reads AppState rather than taking the question as an argument,
   so these drive it the way the test runner does. */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let AppState, evaluateAnswer;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    ({ AppState } = await import('../src/core/state.js'));
    ({ evaluateAnswer } = await import('../src/features/test/test-engine.js'));
});

/** Stage one question as the only item in the current test, then grade it. */
const grade = (question, answer) => {
    AppState.questionMap = { q1: { id: 'q1', sourceId: 's1', ...question } };
    AppState.currentTest = ['q1'];
    return evaluateAnswer(0, answer);
};

test('short_answer matches any accepted text, trimmed and case-insensitive', () => {
    const q = { type: 'short_answer', content: { text: 'Başkent?' }, answer: { accepted_texts: ['Ankara', 'ANK'] } };
    assert.equal(grade(q, ['Ankara']), true);
    assert.equal(grade(q, ['  ankara ']), true);
    assert.equal(grade(q, ['ANK']), true);
    assert.equal(grade(q, ['İzmir']), false);
    assert.equal(grade(q, ['']), false);
});

test('short_answer honours caseSensitive when the question asks for it', () => {
    const q = { type: 'short_answer', content: { text: 'q' }, answer: { accepted_texts: ['Ankara'], caseSensitive: true } };
    assert.equal(grade(q, ['Ankara']), true);
    assert.equal(grade(q, ['ankara']), false);
});

test('a legacy open_ended question grades exactly as short_answer', () => {
    const q = { type: 'open_ended', content: { text: 'q' }, answer: { accepted_texts: ['Jura'] } };
    assert.equal(grade(q, ['jura']), true, 'old files keep working after the rename');
    assert.equal(grade(q, ['Medizin']), false);
});

test('fill_in_the_blank grades each blank against its own marker', () => {
    const q = { type: 'fill_in_the_blank', content: { text: "Ankara {{Türkiye'nin}} başkentidir." } };
    assert.equal(grade(q, ["Türkiye'nin"]), true);
    assert.equal(grade(q, ["türkiye'nin"]), true, 'case-insensitive like short answers');
    assert.equal(grade(q, ['Almanya']), false);
    assert.equal(grade(q, []), false);
});

test('every blank must be right, not just the first', () => {
    const q = { type: 'fill_in_the_blank', content: { text: 'HTTP {{80}}, HTTPS {{443}}.' } };
    assert.equal(grade(q, ['80', '443']), true);
    assert.equal(grade(q, ['80', '8443']), false, 'a wrong second blank fails the question');
    assert.equal(grade(q, ['80']), false, 'an unanswered second blank fails too');
});

test('a blank accepts the alternatives its marker lists', () => {
    const q = { type: 'fill_in_the_blank', content: { text: 'DNS {{53|Port 53}} kullanır.' } };
    assert.equal(grade(q, ['53']), true);
    assert.equal(grade(q, ['Port 53']), true);
    assert.equal(grade(q, ['54']), false);
});

test('choice grading still needs the exact set, no more and no less', () => {
    const q = {
        type: 'multiple_choice', content: { text: 'q' },
        options: [{ id: 1 }, { id: 2 }, { id: 3 }], answer: { correct_ids: [1, 2] }
    };
    assert.equal(grade(q, ['1', '2']), true);
    assert.equal(grade(q, ['2', '1']), true, 'order does not matter');
    assert.equal(grade(q, ['1']), false, 'missing one is wrong');
    assert.equal(grade(q, ['1', '2', '3']), false, 'one too many is wrong');
});
