import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

/**
 * What the filter bar is filtering, and what survives leaving the screen.
 *
 * Three rules, all of them found by driving the real app: the running filter has
 * to survive a trip through history, a named scope has to survive a filter
 * click, and nothing may widen the pool behind the user's back.
 */

let AppState, renderStatsList, inspectSourceQuestions;
let keptSearchOnFilterClick, statsHistoryState, stampStatsHistory;
let dom;

before(async () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    dom = new JSDOM(html, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.history = dom.window.history;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    AppState = (await import('../src/core/state.js')).AppState;
    const statsMod = await import('../src/features/stats/stats-module.js');
    renderStatsList = statsMod.renderStatsList;
    inspectSourceQuestions = statsMod.inspectSourceQuestions;
    const nav = await import('../src/features/stats/stats-nav.js');
    keptSearchOnFilterClick = nav.keptSearchOnFilterClick;
    statsHistoryState = nav.statsHistoryState;
    stampStatsHistory = nav.stampStatsHistory;
});

const q = (id, text) => ({ id, text, content: { text } });

beforeEach(() => {
    AppState.sources = [
        { id: 'exam_alpha_1_a', name: 'Alpha', active: true, questions: [q(1, 'a1'), q(2, 'a2')] },
        { id: 'exam_beta_2_b', name: 'Beta', active: true, questions: [q(1, 'b1')] },
        { id: 'exam_gamma_3_c', name: 'Gamma', active: false, questions: [q(1, 'c1'), q(2, 'c2')] }
    ];
    AppState.stats = {
        'exam_alpha_1_a_1': { correct: 0, wrong: 0, difficulty: 5, starred: true },
        'exam_beta_2_b_1': { correct: 0, wrong: 0, difficulty: 5, starred: true },
        'exam_gamma_3_c_1': { correct: 0, wrong: 0, difficulty: 5, starred: true }
    };
    AppState.recentTests = [];
    AppState.activeTagFilter = null;
    AppState.activeStatsFilter = 'all';
    AppState.searchKeyword = '';
    AppState.activeStatsSortField = 'original';
    AppState.activeStatsSortDir = 'asc';
    AppState.currentSourceKey = 'exam_alpha_1_a';
    document.getElementById('statsGlobalToggle').checked = false;
    document.getElementById('statsSearchInput').value = '';
    history.replaceState({ view: 'stats', searchQuery: '', filter: 'all' }, '', '#stats');
});

const rowTexts = () => [...document.querySelectorAll('#statsList .stats-item-text')].map(e => e.textContent.trim());

/* --- the pool a "$source" scope describes -------------------------------- */

/* "İncele" opens a source that may not be active. It used to get there by
   switching "Tüm Kaynaklar" on, and nothing ever switched it back: from then
   on every filter the user pressed quietly described the whole library. */
test('a $source scope reaches a live source that is not active', () => {
    renderStatsList('all', '$Gamma');
    assert.deepEqual(rowTexts().sort(), ['c1', 'c2']);
    assert.equal(document.getElementById('statsGlobalToggle').checked, false,
        'the header toggle is the user\'s, not a lever the scope pulls');
});

test('a named filter narrows inside the $source scope, not around it', () => {
    renderStatsList('starred', '$Alpha');
    assert.deepEqual(rowTexts(), ['a1']);
});

test('without a scope the pool is still only the active sources', () => {
    renderStatsList('starred', '');
    assert.deepEqual(rowTexts().sort(), ['a1', 'b1']);
});

test('inspectSourceQuestions leaves the header toggle alone', () => {
    global.window.switchView = () => {};
    inspectSourceQuestions('exam_gamma_3_c');
    assert.equal(document.getElementById('statsGlobalToggle').checked, false);
    assert.deepEqual(rowTexts().sort(), ['c1', 'c2']);
});

/* --- what a filter click keeps ------------------------------------------- */

test('a filter button keeps a source scope and drops everything else', () => {
    assert.equal(keptSearchOnFilterClick('starred', '$Alpha'), '$Alpha');
    assert.equal(keptSearchOnFilterClick('starred', 'a1'), '');
    assert.equal(keptSearchOnFilterClick('starred', '#etiket'), '');
    assert.equal(keptSearchOnFilterClick('starred', '$'), '', 'a bare $ names no source');
    // "Tümü" is the one filter that leaves the search box alone entirely.
    assert.equal(keptSearchOnFilterClick('all', 'a1'), 'a1');
});

/* The two history tabs list tests, not questions - the search box has never
   reached them, so leaving a scope in the box would show a scope they ignore. */
test('the history tabs clear the box rather than ignore it', () => {
    assert.equal(keptSearchOnFilterClick('recent', '$Alpha'), '');
    assert.equal(keptSearchOnFilterClick('incorrect', '$Alpha'), '');
});

/* --- the history entry is a picture of what is running ------------------- */

/* popstate believes what the entry says. Writing filter: 'all' into every entry
   made opening a question from "Yanlış Yapılanlar" and coming back land on
   "Tümü" with every question of every active source. */
test('the stats history entry records the running filter and search', () => {
    AppState.activeStatsFilter = 'flagged';
    AppState.searchKeyword = '$Alpha';
    assert.deepEqual(statsHistoryState('stats'), {
        view: 'stats', searchQuery: '$Alpha', filter: 'flagged'
    });
});

test('a tag search is recorded as the tag filter it is', () => {
    AppState.activeTagFilter = 'kimya';
    AppState.activeStatsFilter = 'all';
    assert.equal(statsHistoryState('stats').filter, 'tag:kimya');
});

test('every other view keeps the plain entry', () => {
    AppState.activeStatsFilter = 'flagged';
    assert.deepEqual(statsHistoryState('statsPreview'), {
        view: 'statsPreview', searchQuery: '', filter: 'all'
    });
});

/* The entry is written once on the way in, but the user goes on changing the
   filter inside it, so it has to be re-pointed or Back restores the filter that
   was running when the screen was opened. */
test('stamping re-points the entry at the filter now on screen', () => {
    history.replaceState({ view: 'stats', searchQuery: '', filter: 'all' }, '', '#stats');
    AppState.activeStatsFilter = 'starred';
    stampStatsHistory();
    assert.equal(history.state.filter, 'starred');
});

test('stamping never touches an entry belonging to another view', () => {
    history.replaceState({ view: 'statsPreview', searchQuery: '', filter: 'all' }, '', '#statsPreview');
    AppState.activeStatsFilter = 'starred';
    stampStatsHistory();
    assert.equal(history.state.filter, 'all');
    assert.equal(history.state.view, 'statsPreview');
});

/* --- the wiring in main.js ------------------------------------------------ */

/* The rules above are only worth anything if the click handler and switchView
   actually run them; a mutant that drops either call passes every case above. */
test('main.js runs the rules it delegates', () => {
    const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    assert.ok(src.includes('keptSearchOnFilterClick(btn.dataset.filter'),
        'the filter click has to ask what the search box keeps');
    assert.ok(src.includes('history.pushState(statsHistoryState(view)'),
        'switchView has to push the running filter, not a default');
    assert.ok(!/pushState\(\{\s*view,\s*searchQuery: '',\s*filter: 'all'\s*\}/.test(src),
        'the invented entry is what reset the filter on every Back');
    const clickBody = src.slice(src.indexOf("document.querySelectorAll('.filter-btn')"));
    assert.ok(clickBody.slice(0, clickBody.indexOf('});')).includes('stampStatsHistory()'),
        'a filter change has to re-point the entry it happens inside');
});
