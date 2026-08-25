/* Moving between questions, and keeping the preview honest.
 *
 * Both halves rest on the same fact: what the preview shows is a *copy* taken
 * when a list row was clicked. Navigation needs the list that copy came from,
 * in the order it was shown; freshness needs the copy reconciled with the stored
 * question, because an edit replaces the object inside the source and leaves the
 * copy pointing at the old one.
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="toast"></div></body></html>',
    { url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

const { AppState } = await import('../src/core/state.js');
const {
    setPreviewNavList, getPreviewNavPosition, navPositionLabel,
    neighbourQuestion, resolvePreviewQuestion, updateNavButtons, currentNavIndex
} = await import('../src/features/stats/preview-nav.js');

const SRC = 'exam_nav_1700000000_aa';

/** A question as the stats list decorates it before handing it to the preview. */
const entry = (n, extra = {}) => ({
    id: `q${n}`, sourceId: SRC, type: 'single_choice',
    content: { text: `Question ${n}` },
    sourceName: 'Nav Source', originalIndex: n,
    ...extra
});

beforeEach(() => {
    AppState.sources = [{
        id: SRC, name: 'Nav Source', active: true, archived: false,
        questions: [1, 2, 3, 4].map(n => ({
            id: `q${n}`, type: 'single_choice', content: { text: `Question ${n}` }
        }))
    }];
    AppState.stats = {};
    setPreviewNavList([1, 2, 3, 4].map(n => entry(n)));
    AppState.previewQuestion = entry(2);
});

test('the position is read from the list, in the order it was given', () => {
    assert.equal(currentNavIndex(), 1);
    assert.deepEqual(getPreviewNavPosition(), { index: 1, total: 4, hasPrev: true, hasNext: true });
    assert.equal(navPositionLabel(), '2 / 4');
});

test('the ends of the list are ends', () => {
    AppState.previewQuestion = entry(1);
    assert.equal(getPreviewNavPosition().hasPrev, false);
    assert.equal(neighbourQuestion(-1), null);

    AppState.previewQuestion = entry(4);
    assert.equal(getPreviewNavPosition().hasNext, false);
    assert.equal(neighbourQuestion(1), null);
});

test('a question outside the list is navigable nowhere, not to position zero', () => {
    AppState.previewQuestion = entry(99);
    assert.equal(currentNavIndex(), -1);
    assert.equal(navPositionLabel(), '');
    assert.equal(neighbourQuestion(1), null);
    assert.equal(neighbourQuestion(-1), null);
});

test('two sources numbering their questions alike are two different questions', () => {
    /* Identity is the composite key. Matching on id alone would let a click on
       source B's "q2" navigate through source A's list. */
    setPreviewNavList([entry(2), { ...entry(2), sourceId: 'exam_other_1700000001_bb' }]);
    AppState.previewQuestion = { ...entry(2), sourceId: 'exam_other_1700000001_bb' };
    assert.equal(currentNavIndex(), 1);
});

test('the neighbour comes back with the stored text, not the copy the list made', () => {
    // The edit an editor save would have made: the source now holds new text.
    AppState.sources[0].questions[2].content.text = 'Edited in the editor';

    const next = neighbourQuestion(1);
    assert.equal(next.id, 'q3');
    assert.equal(next.content.text, 'Edited in the editor');
});

test('resolving keeps what only the copy knows', () => {
    /* userAnswer / isCorrect are what a results or history row is ABOUT, and
       sourceName / originalIndex are decorations the stats list added. The
       stored question has none of them; overwriting them with its blanks would
       turn a reviewed answer into an unanswered question. */
    const reviewed = entry(2, { userAnswer: ['7'], isCorrect: false, isUnanswered: false });
    const fresh = resolvePreviewQuestion(reviewed);

    assert.deepEqual(fresh.userAnswer, ['7']);
    assert.equal(fresh.isCorrect, false);
    assert.equal(fresh.sourceName, 'Nav Source');
    assert.equal(fresh.originalIndex, 2);
});

test('the stored question wins over the stale copy', () => {
    AppState.sources[0].questions[1].content.text = 'Newer';
    const fresh = resolvePreviewQuestion(entry(2));
    assert.equal(fresh.content.text, 'Newer');
});

test('a question that no longer exists comes back untouched', () => {
    // A history row is allowed to outlive the source it describes.
    const orphan = { id: 'gone', sourceId: 'exam_deleted_1700000009_zz', content: { text: 'Old' } };
    assert.deepEqual(resolvePreviewQuestion(orphan), orphan);
    assert.equal(resolvePreviewQuestion(null), null);
});

test('an edit made two questions ago is there when the arrows come back to it', () => {
    // Every step reconciles, so the list never serves a copy that went stale.
    neighbourQuestion(1);
    AppState.sources[0].questions[2].content.text = 'Edited later';

    AppState.previewQuestion = entry(4);
    assert.equal(neighbourQuestion(-1).content.text, 'Edited later');
});

test('a stale review stored on the library question does not win', () => {
    /* The editor is opened with whatever the preview shows, and from the results
       screen that object carries an answer. Library questions have therefore been
       written with a `userAnswer` on them (now stripped on save, but old data and
       synced data still have it), and it must never displace the answer the row
       being looked at is actually about. */
    AppState.sources[0].questions[1].userAnswer = ['stale'];
    AppState.sources[0].questions[1].isCorrect = true;

    const fresh = resolvePreviewQuestion(entry(2, { userAnswer: ['mine'], isCorrect: false }));
    assert.deepEqual(fresh.userAnswer, ['mine']);
    assert.equal(fresh.isCorrect, false);
});

test('the arrows reflect the ends, and leave the tooltip alone', () => {
    const prev = dom.window.document.createElement('button');
    const next = dom.window.document.createElement('button');
    prev.title = 'Previous question';

    updateNavButtons(prev, next);
    assert.equal(prev.disabled, false);
    assert.equal(next.disabled, false);
    /* The position lives in its own node beside the title. Putting it in `title`
       fights data-i18n-title: updateStaticTranslations() writes the tooltip back
       and the two take turns. Measured in the browser, where the tooltip won. */
    assert.equal(prev.title, 'Previous question');

    AppState.previewQuestion = entry(4);
    updateNavButtons(prev, next);
    assert.equal(prev.disabled, false);
    assert.equal(next.disabled, true);
});

test('an empty list disables both arrows rather than throwing', () => {
    setPreviewNavList(null);
    const prev = dom.window.document.createElement('button');
    const next = dom.window.document.createElement('button');
    updateNavButtons(prev, next);
    assert.equal(prev.disabled, true);
    assert.equal(next.disabled, true);
});
