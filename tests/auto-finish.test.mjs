import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

/**
 * A test with nothing left to answer ends itself.
 *
 * The history entry is written by finishTest() and by nothing else, so a
 * session the user answered in full and then walked away from left no test
 * behind at all: the per-question marks were saved on every answer, so the
 * question list showed ticks and crosses while "Son Cevaplananlar" and "Yanlış
 * Yapılanlar" both said there were no tests. Measured in Edge - six questions
 * answered, testResults 0 and recentTests 0.
 */

let AppState, testIsComplete, scheduleAutoFinishIfComplete, cancelAutoFinish, AUTO_FINISH_DELAY_MS;

before(async () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    AppState = (await import('../src/core/state.js')).AppState;
    const ui = await import('../src/features/test/test-ui.js');
    testIsComplete = ui.testIsComplete;
    scheduleAutoFinishIfComplete = ui.scheduleAutoFinishIfComplete;
    cancelAutoFinish = ui.cancelAutoFinish;
    AUTO_FINISH_DELAY_MS = ui.AUTO_FINISH_DELAY_MS;
});

beforeEach(() => {
    AppState.currentTest = ['s_1', 's_2', 's_3'];
    AppState.isAnswerChecked = [];
    AppState.currentIndex = 0;
    cancelAutoFinish();
});

test('a test with an unanswered question is not complete', () => {
    AppState.isAnswerChecked = [true, true];
    assert.equal(testIsComplete(), false);
});

test('a test is complete only when every question has been answered', () => {
    AppState.isAnswerChecked = [true, true, true];
    assert.equal(testIsComplete(), true);
});

/* A skipped question in the middle is not "the end" - the user left it on
   purpose and can still come back to it, so the finish button stays theirs. */
test('a gap in the middle keeps the test running', () => {
    AppState.isAnswerChecked = [true, undefined, true];
    assert.equal(testIsComplete(), false);
});

test('an empty or missing test is never complete', () => {
    AppState.currentTest = [];
    assert.equal(testIsComplete(), false);
    AppState.currentTest = null;
    assert.equal(testIsComplete(), false);
});

test('the finish is only scheduled once the test is complete', () => {
    AppState.isAnswerChecked = [true, true];
    assert.equal(scheduleAutoFinishIfComplete(), false);
    AppState.isAnswerChecked = [true, true, true];
    assert.equal(scheduleAutoFinishIfComplete(), true);
    cancelAutoFinish();
});

/* The delay is not decoration: Schwer/Einfach only exists on the question,
   after checking it, and it feeds FSRS. Finishing at zero would quietly take
   the last question's rating away. */
test('the finish is deferred, not immediate', () => {
    assert.ok(AUTO_FINISH_DELAY_MS >= 1000,
        'the user has to be able to see the last answer and rate it');
});

/* --- the wiring ----------------------------------------------------------- */

test('an answer asks whether the test is over, and a reveal does not', () => {
    const src = readFileSync(new URL('../src/features/test/test-ui.js', import.meta.url), 'utf8');

    const check = src.slice(src.indexOf('export const handleCheckAnswer'));
    assert.ok(check.slice(0, check.indexOf('export async function handleTranslation'))
        .includes('scheduleAutoFinishIfComplete()'),
        'committing an answer has to ask');

    const flash = src.slice(src.indexOf('export function handleFlashcardRating'));
    assert.ok(flash.slice(0, flash.indexOf('export function renderTestResults'))
        .includes('scheduleAutoFinishIfComplete()'),
        'a flashcard is answered by its rating, so the rating has to ask');

    /* The reveal sets isAnswerChecked too. Asking there would end the test with
       the last card unrated. */
    const checkBody = check.slice(0, check.indexOf('export async function handleTranslation'));
    const reveal = checkBody.slice(checkBody.indexOf("if (q.type === 'flashcard') {"));
    assert.ok(!reveal.slice(0, reveal.indexOf('const answerCategory'))
        .includes('scheduleAutoFinishIfComplete'),
        'revealing a flashcard is not answering it');
});

test('everything that means "not done yet" cancels the pending finish', () => {
    const ui = readFileSync(new URL('../src/features/test/test-ui.js', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

    const rating = ui.slice(ui.indexOf('export function handleDifficultyRating'));
    assert.ok(rating.slice(0, rating.indexOf('export function handleFlashcardRating')).includes('cancelAutoFinish()'),
        'rating the question just answered means the user is still on it');

    const goTo = ui.slice(ui.indexOf('window.goToQuestion = '));
    assert.ok(goTo.slice(0, goTo.indexOf('window.toggleQuickNav = ')).includes('cancelAutoFinish()'),
        'jumping to another question means the user is still working');

    const prev = main.slice(main.indexOf('function prevQuestion()'));
    assert.ok(prev.slice(0, prev.indexOf('function nextQuestion()')).includes('cancelAutoFinish()'),
        'going back means the user is still working');

    /* A timer that outlives the screen would end a test the user already walked
       away from - and that test is meant to stay resumable. */
    const leave = main.slice(main.indexOf("if (view !== 'test' && view !== 'statsPreview') {"));
    assert.ok(leave.slice(0, leave.indexOf('// History API integration')).includes('cancelAutoFinish()'),
        'leaving the test screen has to drop the pending finish');
});

/* nextQuestion() has always finished the test on the last question. The button
   was disabled there, so the branch was unreachable: answering the last
   question left a screen with no way forward at all. */
test('the last question is not a dead end', () => {
    const src = readFileSync(new URL('../src/features/test/test-ui.js', import.meta.url), 'utf8');
    const nav = src.slice(src.indexOf('// Navigation updates'));
    const block = nav.slice(0, nav.indexOf('const checkBtn'));
    assert.ok(!/nextBtn\.disabled = isLastQuestion/.test(block),
        'the finish branch behind this button has to be reachable');
    assert.ok(block.includes("'finish_test'"),
        'and the button has to say what it does on the last question');

    const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    const next = main.slice(main.indexOf('function nextQuestion()'));
    assert.ok(next.slice(0, next.indexOf('function toggleStar()')).includes('finishBtn'),
        'next on the last question is the finish');
});

/* One sequence, two callers: the button and the auto-finish. A second copy is
   how a way of ending a test ends up skipping the write that files it. */
test('the finish sequence has one body', () => {
    const src = readFileSync(new URL('../src/features/test/test-ui.js', import.meta.url), 'utf8');
    assert.ok(src.includes('export async function finishTestFlow()'));
    assert.ok(src.includes("document.getElementById('finishTestBtn').onclick = () => finishTestFlow();"),
        'the button runs the shared sequence rather than its own copy');
    assert.equal((src.match(/await finishTest\(\)/g) || []).length, 1,
        'exactly one place calls finishTest()');
});
