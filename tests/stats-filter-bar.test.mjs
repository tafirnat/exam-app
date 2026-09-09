import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let AppState, renderStatsList;

before(async () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    const stateMod = await import('../src/core/state.js');
    AppState = stateMod.AppState;

    const statsMod = await import('../src/features/stats/stats-module.js');
    renderStatsList = statsMod.renderStatsList;
});

const q = (id, text) => ({ id, text, content: { text } });

function seedTwoActiveSources() {
    AppState.sources = [
        { id: 'src-a', name: 'Alpha', active: true, questions: [q(1, 'a1'), q(2, 'a2')] },
        { id: 'src-b', name: 'Beta', active: true, questions: [q(1, 'b1')] },
        { id: 'src-c', name: 'Gamma', active: false, questions: [q(1, 'c1')] }
    ];
    AppState.stats = {
        'src-a_1': { correct: 0, wrong: 0, difficulty: 5, starred: true },
        'src-b_1': { correct: 0, wrong: 0, difficulty: 5, starred: true, flagged: true, note: 'hm' },
        'src-c_1': { correct: 0, wrong: 0, difficulty: 5, starred: true }
    };
    AppState.recentTests = [];
    AppState.activeTagFilter = null;
    AppState.activeStatsSortField = 'original';
    AppState.activeStatsSortDir = 'asc';
    /* The source switched on last. It used to shrink the whole screen down to
       itself, so the seed keeps it pointed at one of the two active ones. */
    AppState.currentSourceKey = 'src-a';
    document.getElementById('statsGlobalToggle').checked = false;
    document.getElementById('statsSearchInput').value = '';
}

beforeEach(seedTwoActiveSources);

const rowCount = () => document.querySelectorAll('#statsList .stats-list-item').length;
const rowTexts = () => [...document.querySelectorAll('#statsList .stats-item-text')].map(e => e.textContent.trim());

/* The header toggle is the only control that widens the pool. Without this the
   list collapses to AppState.currentSourceKey - and toggleSource() writes that
   key on every activation, so the collapse is the normal case, not an edge. */
test('the pool is every active source, not the one switched on last', () => {
    renderStatsList('all', '');
    assert.deepEqual(rowTexts().sort(), ['a1', 'a2', 'b1']);
});

test('a named filter reaches across every active source too', () => {
    renderStatsList('starred', '');
    assert.deepEqual(rowTexts().sort(), ['a1', 'b1']);
});

test('the toggle is what widens the pool to the whole live library', () => {
    document.getElementById('statsGlobalToggle').checked = true;
    renderStatsList('starred', '');
    assert.deepEqual(rowTexts().sort(), ['a1', 'b1', 'c1']);
});

test('flagged and noted read their own stat keys', () => {
    renderStatsList('flagged', '');
    assert.deepEqual(rowTexts(), ['b1']);
    renderStatsList('noted', '');
    assert.deepEqual(rowTexts(), ['b1']);
    AppState.stats['src-b_1'].note = '   ';
    renderStatsList('noted', '');
    assert.equal(rowCount(), 0);
});

/* Every way into the list that is not a click - the home button restoring the
   last filter, Back, a tag search, a store redraw - has to move the highlight
   with it. main.js reads the running filter back off AppState to re-apply it on
   the next keystroke, so a bar that disagrees with the list gets believed. */
test('the highlighted button is the filter that ran', () => {
    renderStatsList('flagged', '');
    assert.deepEqual(
        [...document.querySelectorAll('#statsFilterBar .filter-btn.active')].map(b => b.dataset.filter),
        ['flagged']
    );

    renderStatsList('all', '');
    assert.deepEqual(
        [...document.querySelectorAll('#statsFilterBar .filter-btn.active')].map(b => b.dataset.filter),
        ['all']
    );
});

test('the footer counts what the list is showing', () => {
    renderStatsList('starred', '');
    assert.match(document.getElementById('statsFooter').textContent, /2/);
});

/* --- history tabs --------------------------------------------------------- */

function seedHistory() {
    AppState.recentTests = [{
        id: 1,
        startTime: Date.now() - 1000,
        endTime: Date.now(),
        sourceNames: ['Alpha', 'Beta'],
        wrongCount: 1,
        correctCount: 1,
        unansweredCount: 0,
        successRate: 50,
        questions: [
            { ...q(1, 'a1'), sourceId: 'src-a', isCorrect: true },
            { ...q(1, 'b1'), sourceId: 'src-b', isCorrect: false }
        ]
    }];
}

const historyCount = () => document.querySelectorAll('#statsList .history-test-item').length;

/* Two active sources means the test that spanned them, and the global log is
   the only place a multi-source test is written down. The tab used to reach for
   one source's own log whenever currentSourceKey named an active source. */
test('recent falls to the global log while more than one source is active', () => {
    seedHistory();
    renderStatsList('recent', '');
    assert.equal(historyCount(), 1);
});

const sourceEntry = (overrides = {}) => ({
    id: 2,
    startTime: Date.now(),
    endTime: Date.now(),
    sourceNames: ['Alpha'],
    wrongCount: 0,
    correctCount: 1,
    questions: [{ ...q(1, 'a1'), sourceId: 'src-a', isCorrect: true }],
    ...overrides
});

const historyTitles = () =>
    [...document.querySelectorAll('#statsList .history-test-title')].map(e => e.textContent);

/* Both logs are read, always. The tab used to read the source's own log ONLY
   when the scope was exactly one source, and the global log in every other
   case - so a source's own log was invisible the moment a second source was
   active or the toggle was on, and an empty global log meant an empty screen
   with every per-source log sitting unread. The global log is the fragile half
   (capped at 10 for the whole library, and it was being emptied by the sync
   floor), so "the other one is empty" is the normal case, not an edge. */
test('a source own log shows even while several sources are active', () => {
    AppState.recentTests = [];
    AppState.sources[0].testResults = [sourceEntry()];
    renderStatsList('recent', '');
    assert.deepEqual(historyTitles(), ['Alpha']);
});

test('the global log shows even when no source kept its own copy', () => {
    seedHistory();
    AppState.sources.forEach(s => { s.testResults = []; });
    renderStatsList('recent', '');
    assert.deepEqual(historyTitles(), ['Alpha + Beta']);
});

/* One session is written down twice - whole in recentTests and sliced into
   each source it touched - and the two copies do not share an id, because the
   per-source copy is written with Date.now() + Math.random() on purpose. Keyed
   by id they draw two rows for one test; keyed by startTime they draw one, and
   the row kept is the complete session rather than one source's slice. */
test('the two copies of one session draw a single row', () => {
    seedHistory();
    const started = AppState.recentTests[0].startTime;
    AppState.sources[0].testResults = [sourceEntry({ id: 99, startTime: started })];
    renderStatsList('recent', '');
    assert.deepEqual(historyTitles(), ['Alpha + Beta']);
});

/* Scope is the same question the question list answers, so the tab moves with
   the selection instead of showing the whole log whatever is switched on. */
test('a session from no active source stays out', () => {
    /* Seeded into the GLOBAL log on purpose. Its per-source copy is already out
       of reach - the collector only walks the sources in scope - so a case that
       seeds only that one passes with the scope check deleted, and the mutant
       that deletes it survives. Measured: it did. */
    const gamma = sourceEntry({
        sourceNames: ['Gamma'],
        questions: [{ ...q(1, 'c1'), sourceId: 'src-c', isCorrect: true }]
    });
    AppState.recentTests = [gamma];
    AppState.sources[2].testResults = [gamma];
    renderStatsList('recent', '');
    assert.deepEqual(historyTitles(), []);
    document.getElementById('statsGlobalToggle').checked = true;
    renderStatsList('recent', '');
    assert.deepEqual(historyTitles(), ['Gamma']);
});

/* The footer lives outside #statsList, so an early return leaves the previous
   filter's scope and count sitting under an empty screen. */
test('an empty history tab still rewrites the footer', () => {
    renderStatsList('starred', '');
    const before = document.getElementById('statsFooter').textContent;
    AppState.recentTests = [];
    renderStatsList('recent', '');
    assert.notEqual(document.getElementById('statsFooter').textContent, before);
});

/* Hiding a row has to save the list it was mutated in. The check used to be
   "does currentSourceKey name a source at all", which is true in the global
   case too, so the flag was written onto a recentTests entry and saveSources()
   was called - the row came straight back on the next redraw. */
/* Hiding a row has to hide the session, not the object that happened to be
   drawn. Both logs hold a copy, so flagging only the rendered one left the
   other free to draw the row again on the next redraw and the delete looked
   like it had done nothing. */
test('hiding a session hides every copy of it', async () => {
    seedHistory();
    const started = AppState.recentTests[0].startTime;
    AppState.sources[0].testResults = [sourceEntry({ id: 99, startTime: started })];
    renderStatsList('recent', '');

    const del = document.querySelector('#statsList .history-delete-btn');
    const done = del.onclick({ stopPropagation() {} });
    // showConfirm is the shared modal card, so the confirmation is a click.
    document.getElementById('modalConfirmBtn').click();
    await done;

    assert.equal(AppState.recentTests[0].hiddenInRecent, true);
    assert.equal(AppState.sources[0].testResults[0].hiddenInRecent, true,
        'the per-source copy would redraw the row on the next paint');
    assert.deepEqual(historyTitles(), []);
});

/* The footer says "N soru", so it counts questions. It used to pass the number
   of test cards, which reads as a question count and is wrong by however many
   questions each test holds. */
test('the history footer counts questions, not test cards', () => {
    seedHistory();
    renderStatsList('recent', '');
    assert.match(document.getElementById('statsFooter').textContent, /\b2\b/);
});

/* "Yanlis Yapilanlar" left the test logs behind and reads the per-question
   counters now, so its footer counts questions out of the same pool every other
   named filter uses - not the questions of a test card. */
test('the incorrect footer counts questions with a wrong answer', () => {
    AppState.stats['src-a_1'].wrong = 2;
    renderStatsList('incorrect', '');
    assert.match(document.getElementById('statsFooter').textContent, /\b1\b/);
});
