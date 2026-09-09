import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

/**
 * A finished test has to still be there after a reload.
 *
 * "Son Cevaplananlar" is the only screen that reads the finished-test logs, and
 * it kept going blank: right after a test the tab was correct, and after a
 * refresh - or after a pull, which is the same thing a moment later - it said
 * there were no tests at all. Two separate writes were being thrown away by the
 * sync merge, and both were silent.
 */

let AppState, mergeSyncData, finishTest, initState;

before(async () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    const stateMod = await import('../src/core/state.js');
    AppState = stateMod.AppState;
    initState = stateMod.initState;
    initState();

    mergeSyncData = (await import('../src/core/github-sync.js')).mergeSyncData;
    finishTest = (await import('../src/features/test/test-engine.js')).finishTest;
});

const entry = (startedAt, overrides = {}) => ({
    id: startedAt,
    sourceNames: ['Alpha'],
    sourceTitle: 'Alpha',
    startTime: new Date(startedAt).toISOString(),
    endTime: new Date(startedAt + 60000).toISOString(),
    questionCount: 2,
    correctCount: 1,
    wrongCount: 1,
    unansweredCount: 0,
    successRate: 50,
    questions: [
        { id: 'q1', sourceId: 'exam_a', isCorrect: true },
        { id: 'q2', sourceId: 'exam_a', isCorrect: false }
    ],
    ...overrides
});

const payload = (extra = {}) => ({
    sources: [], folders: [], stats: {}, studyActivity: {}, recentTests: [],
    deletedSourceIds: [], deletedFolderIds: [], deletedQuickPresetIds: [], quickPresets: [],
    ...extra
});

/* --- the global log ------------------------------------------------------- */

/* The floor asked for `t.timestamp`, and a history entry has never carried one:
   finishTest writes `id`, `startTime` and `endTime`. So the key was 0 for every
   entry ever written and `0 < latestProgressResetAt` was true for all of them -
   one progress or factory reset anywhere, and from then on every single merge
   emptied the global log. The device kept writing entries and the next pull kept
   throwing them away. Measured before the fix: two entries dated a day after the
   reset, zero survivors. */
test('a session finished after a progress reset survives the merge', () => {
    const resetAt = Date.now() - 86400000;
    const local = payload({
        recentTests: [entry(Date.now()), entry(Date.now() - 1000)],
        lastProgressResetTimestamp: resetAt
    });
    const remote = payload({
        lastProgressResetTimestamp: resetAt,
        lastUpdated: new Date().toISOString()
    });
    assert.equal(mergeSyncData(local, remote).recentTests.length, 2);
});

/* The floor still has to do its job - what the reset cleared stays cleared. */
test('a session finished before the reset is still dropped', () => {
    const resetAt = Date.now();
    const local = payload({
        recentTests: [entry(resetAt - 86400000)],
        lastProgressResetTimestamp: resetAt
    });
    const remote = payload({ lastProgressResetTimestamp: resetAt, lastUpdated: new Date().toISOString() });
    assert.equal(mergeSyncData(local, remote).recentTests.length, 0);
});

/* Every sort key was 0 too, so the order was whatever the two arrays happened to
   be concatenated in and the slice(10) kept an arbitrary ten rather than the
   newest ten - the cap quietly threw away the recent tests it exists to keep. */
test('the log is capped at the newest ten, not an arbitrary ten', () => {
    const base = Date.now() - 20 * 60000;
    const local = payload({ recentTests: Array.from({ length: 8 }, (_, i) => entry(base + i * 60000)) });
    const remote = payload({
        recentTests: Array.from({ length: 8 }, (_, i) => entry(base + (i + 8) * 60000)),
        lastUpdated: new Date().toISOString()
    });
    const merged = mergeSyncData(local, remote).recentTests;
    assert.equal(merged.length, 10);
    assert.equal(merged[0].id, base + 15 * 60000, 'the newest session must be first');
    assert.ok(merged.every(t => t.id >= base + 6 * 60000), 'the ten kept must be the newest ten');
});

/* `t.sourceId` does not exist either - a session spans sources, so the ids are on
   its questions. The deleted-source check was a no-op, which is why a deleted
   source's history outlived it; a session that still has a live question in it is
   still a test the user sat, so only an entirely dead one goes. */
test('history goes with the source only when nothing live is left in it', () => {
    const dead = payload({
        recentTests: [entry(Date.now())],
        deletedSourceIds: ['exam_a'],
        lastUpdated: new Date().toISOString()
    });
    assert.equal(mergeSyncData(payload({ deletedSourceIds: ['exam_a'] }), dead).recentTests.length, 0);

    const mixed = entry(Date.now(), {
        questions: [{ id: 'q1', sourceId: 'exam_a' }, { id: 'q2', sourceId: 'exam_b' }]
    });
    const survives = payload({
        recentTests: [mixed],
        deletedSourceIds: ['exam_a'],
        lastUpdated: new Date().toISOString()
    });
    assert.equal(mergeSyncData(payload({ deletedSourceIds: ['exam_a'] }), survives).recentTests.length, 1);
});

/* --- the per-source log --------------------------------------------------- */

/* mergeSyncData picks sources WHOLE, by `updatedAt` - it does not merge their
   fields - so a write that does not stamp the source loses to whatever copy of
   it is already in the Gist. finishTest was the one writer that did not stamp:
   it pushed the session onto source.testResults and called saveSources(), and
   the next pull replaced the source with the remote copy that had never heard of
   it. Everything else that edits a source (rename, folder move, archive) already
   calls touch(). */
test('a source that just logged a test wins against the stale remote copy', async () => {
    AppState.sources = [{
        id: 'exam_a', name: 'Alpha', active: true, updatedAt: 1000,
        questions: [{ id: 'q1', text: 'one' }],
        testResults: []
    }];
    AppState.stats = {};
    AppState.recentTests = [];
    AppState.questionMap = { 'exam_a_q1': { id: 'q1', text: 'one', sourceId: 'exam_a' } };
    AppState.currentTest = ['exam_a_q1'];
    AppState.testTracking = {
        startTime: new Date().toISOString(),
        sourceNames: ['Alpha'],
        sourceTitle: 'Alpha',
        results: [{ questionId: 'q1', userAnswer: ['A'], isCorrect: true, answeredAt: Date.now() }],
        _flushedCount: 0
    };

    await finishTest();

    const source = AppState.sources[0];
    assert.equal(source.testResults.length, 1, 'finishTest must write the per-source log');
    assert.ok(source.updatedAt > 1000, 'and stamp the source, or the merge drops what it wrote');

    const remoteCopy = { ...source, updatedAt: 1000, testResults: [] };
    const merged = mergeSyncData(
        payload({ sources: [source] }),
        payload({ sources: [remoteCopy], lastUpdated: new Date().toISOString() })
    );
    assert.equal(merged.sources[0].testResults.length, 1);
});
