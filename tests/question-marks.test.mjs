import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let setMark, toggleMark, pickMark, hasUserAnnotation, markStampKey, MARK_KEYS;
let mergeSyncData;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    const marks = await import('../src/core/question-marks.js');
    ({ setMark, toggleMark, pickMark, hasUserAnnotation, markStampKey, MARK_KEYS } = marks);

    mergeSyncData = (await import('../src/core/github-sync.js')).mergeSyncData;
});

const emptyPayload = (extra = {}) => ({
    sources: [], folders: [], stats: {}, recentTests: [], studyActivity: {},
    deletedSourceIds: [], deletedFolderIds: [], deletedQuickPresetIds: [], quickPresets: [],
    ...extra
});

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
/** Static scans must not trip over the rule written down in a comment. */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// ── the writer ──────────────────────────────────────────────────────────────

test('setMark stamps the moment of the write', async () => {
    const stat = {};
    setMark(stat, 'starred', true, 1000);
    assert.equal(stat.starred, true);
    assert.equal(stat.starredUpdatedAt, 1000);
});

test('setMark stamps an UNSET too - that is the whole point', async () => {
    const stat = { starred: true, starredUpdatedAt: 1000 };
    setMark(stat, 'starred', false, 2000);
    assert.equal(stat.starred, false);
    assert.equal(stat.starredUpdatedAt, 2000, 'an unstamped unset cannot be merged');
});

test('toggleMark flips and stamps', async () => {
    const stat = { flagged: true, flaggedUpdatedAt: 5 };
    toggleMark(stat, 'flagged', 99);
    assert.equal(stat.flagged, false);
    assert.equal(stat.flaggedUpdatedAt, 99);
    toggleMark(stat, 'flagged', 100);
    assert.equal(stat.flagged, true);
    assert.equal(stat.flaggedUpdatedAt, 100);
});

// ── the merge rule ──────────────────────────────────────────────────────────

test('the newest stamp wins, including a stamped unset', async () => {
    const local = { starred: false, starredUpdatedAt: 2000 };
    const remote = { starred: true, starredUpdatedAt: 1000 };
    assert.deepEqual(pickMark(local, remote, 'starred'), { value: false, updatedAt: 2000 });
});

test('the newest stamp wins when it is the remote that unset', async () => {
    const local = { starred: true, starredUpdatedAt: 1000 };
    const remote = { starred: false, starredUpdatedAt: 2000 };
    assert.deepEqual(pickMark(local, remote, 'starred'), { value: false, updatedAt: 2000 });
});

test('a setting newer than an unsetting still wins', async () => {
    const local = { flagged: true, flaggedUpdatedAt: 3000 };
    const remote = { flagged: false, flaggedUpdatedAt: 1000 };
    assert.equal(pickMark(local, remote, 'flagged').value, true);
});

test('two unstamped records keep the old forgiving rule', async () => {
    // Nothing here was written since the upgrade, so there is no deletion to
    // carry - only a mark one device happens to have. Dropping it would lose
    // data on upgrade.
    assert.equal(pickMark({ starred: true }, {}, 'starred').value, true);
    assert.equal(pickMark({}, { starred: true }, 'starred').value, true);
    assert.equal(pickMark({ starred: true }, {}, 'starred').updatedAt, undefined);
});

test('a stamped unset beats an unstamped set', async () => {
    // The device that unstarred knows when it did; the other one has never
    // touched the mark since the upgrade.
    const local = { starred: false, starredUpdatedAt: 500 };
    const remote = { starred: true };
    assert.equal(pickMark(local, remote, 'starred').value, false);
});

test('an identical stamp on both sides converges', async () => {
    const a = pickMark({ starred: true, starredUpdatedAt: 7 }, { starred: false, starredUpdatedAt: 7 }, 'starred');
    const b = pickMark({ starred: false, starredUpdatedAt: 7 }, { starred: true, starredUpdatedAt: 7 }, 'starred');
    assert.equal(a.value, b.value, 'the merge must not depend on which device runs it');
});

// ── through the real merge ──────────────────────────────────────────────────

test('unstarring propagates through mergeSyncData', async () => {
    const local = emptyPayload({
        stats: { 's1_q1': { correct: 1, wrong: 0, starred: false, starredUpdatedAt: 2000 } }
    });
    const remote = emptyPayload({
        stats: { 's1_q1': { correct: 1, wrong: 0, starred: true, starredUpdatedAt: 1000 } }
    });
    const merged = mergeSyncData(local, remote);
    assert.equal(merged.stats['s1_q1'].starred, false, 'the star came back after being cleared');
    assert.equal(merged.hasLocalChanges, true, 'the clearing has to travel back up to the Gist');
});

test('unflagging propagates through mergeSyncData', async () => {
    const local = emptyPayload({
        stats: { 's1_q1': { flagged: false, flaggedUpdatedAt: 2000 } }
    });
    const remote = emptyPayload({
        stats: { 's1_q1': { flagged: true, flaggedUpdatedAt: 1000 } }
    });
    assert.equal(mergeSyncData(local, remote).stats['s1_q1'].flagged, false);
});

test('a mark set on one device still reaches the other', async () => {
    const local = emptyPayload({ stats: { 's1_q1': { starred: false } } });
    const remote = emptyPayload({
        stats: { 's1_q1': { starred: true, starredUpdatedAt: 1000 } }
    });
    assert.equal(mergeSyncData(local, remote).stats['s1_q1'].starred, true);
});

// ── the progress floor keeps the user's own writing ─────────────────────────

test('a reset keeps the note it promised to keep', async () => {
    const reset = 5_000_000;
    const local = emptyPayload({
        lastProgressResetTimestamp: reset,
        stats: {
            's1_q1': {
                correct: 9, wrong: 4, stability: 40,
                lastReview: new Date(reset - 86400000).toISOString(),
                note: 'mnemonic I worked out myself'
            }
        }
    });
    const merged = mergeSyncData(local, emptyPayload({ lastProgressResetTimestamp: reset }));
    const stat = merged.stats['s1_q1'];
    assert.ok(stat, 'the annotated record was thrown away by the reset');
    assert.equal(stat.note, 'mnemonic I worked out myself');
});

test('a kept annotation carries no progress with it', async () => {
    const reset = 5_000_000;
    const local = emptyPayload({
        lastProgressResetTimestamp: reset,
        stats: {
            's1_q1': {
                correct: 9, wrong: 4, stability: 40, streak: 6, learned: true,
                lastReview: new Date(reset - 86400000).toISOString(),
                starred: true
            }
        }
    });
    const stat = mergeSyncData(local, emptyPayload({ lastProgressResetTimestamp: reset })).stats['s1_q1'];
    assert.equal(stat.starred, true);
    assert.equal(stat.correct, 0, 'a reset counter came back through the annotation door');
    assert.equal(stat.wrong, 0);
    assert.ok(!stat.stability, 'keeping the old stability leaves the question out of rotation');
    assert.ok(!stat.lastReview);
    assert.ok(!stat.learned);
});

test('an annotation coming from the REMOTE is stripped the same way', async () => {
    // The two sides are filtered by separate code paths, and only the local one
    // was covered: a mutant that let the remote keep its pre-reset progress
    // survived the whole file. The remote is also the side a device that never
    // saw the reset pushes from, so this is the path that actually matters.
    const reset = 5_000_000;
    const remote = emptyPayload({
        stats: {
            's1_q1': {
                correct: 9, wrong: 4, stability: 40, learned: true,
                lastReview: new Date(reset - 86400000).toISOString(),
                note: 'kept'
            }
        }
    });
    const stat = mergeSyncData(emptyPayload({ lastProgressResetTimestamp: reset }), remote).stats['s1_q1'];
    assert.equal(stat.note, 'kept');
    assert.equal(stat.correct, 0, 'the remote walked its pre-reset progress back in');
    assert.ok(!stat.stability);
    assert.ok(!stat.learned);
});

test('a record with neither progress nor annotation still goes', async () => {
    const reset = 5_000_000;
    const local = emptyPayload({
        lastProgressResetTimestamp: reset,
        stats: { 's1_q1': { correct: 3, wrong: 1, lastReview: new Date(reset - 1000).toISOString() } }
    });
    const merged = mergeSyncData(local, emptyPayload({ lastProgressResetTimestamp: reset }));
    assert.equal(merged.stats['s1_q1'], undefined);
});

test('work done after the reset is untouched', async () => {
    const reset = 5_000_000;
    const after = new Date(reset + 86400000).toISOString();
    const local = emptyPayload({
        lastProgressResetTimestamp: reset,
        stats: { 's1_q1': { correct: 3, wrong: 1, stability: 12, lastReview: after } }
    });
    const stat = mergeSyncData(local, emptyPayload({ lastProgressResetTimestamp: reset })).stats['s1_q1'];
    assert.equal(stat.correct, 3);
    assert.equal(stat.stability, 12);
});

// ── the writes that feed the rule ───────────────────────────────────────────

test('no module assigns starred or flagged directly', async () => {
    // A hand-written assignment is an unstamped write, and an unstamped write
    // is silently un-mergeable - nothing throws, the mark simply comes back on
    // the next sync. This is the trap CLAUDE.md names: locking the rule is not
    // enough, the write that feeds it has to be locked too.
    const files = [
        'src/main.js',
        'src/features/test/test-ui.js',
        'src/features/sources/import-report.js',
        'src/features/stats/stats-module.js',
        'src/features/stats/question-editor.js'
    ];
    const offenders = [];
    files.forEach(rel => {
        let src;
        try { src = stripComments(read(`../${rel}`)); } catch { return; }
        MARK_KEYS.forEach(mark => {
            const re = new RegExp(`\\.${mark}\\s*=(?!=)`, 'g');
            if (re.test(src)) offenders.push(`${rel}: .${mark} =`);
        });
    });
    assert.deepEqual(offenders, [], 'route the write through setMark/toggleMark');
});

test('the merge reads the stamp rather than OR-ing the marks', async () => {
    const src = stripComments(read('../src/core/github-sync.js'));
    MARK_KEYS.forEach(mark => {
        assert.ok(
            !new RegExp(`${mark}:\\s*!!\\(`).test(src),
            `${mark} is still merged with OR, which cannot carry an unset`
        );
    });
    assert.ok(/pickMark\(/.test(src), 'the merge no longer calls pickMark');
});

test('markStampKey names the field the writer actually writes', async () => {
    const stat = {};
    setMark(stat, 'starred', true, 42);
    assert.equal(stat[markStampKey('starred')], 42);
});

test('hasUserAnnotation sees a note, a star and a flag', async () => {
    assert.equal(hasUserAnnotation({ note: 'x' }), true);
    assert.equal(hasUserAnnotation({ starred: true }), true);
    assert.equal(hasUserAnnotation({ flagged: true }), true);
    assert.equal(hasUserAnnotation({ note: '   ' }), false);
    assert.equal(hasUserAnnotation({ correct: 5 }), false);
    assert.equal(hasUserAnnotation(null), false);
});

// ── the manual backup ───────────────────────────────────────────────────────

test('the manual backup exports everything the import reads back', async () => {
    // handleImport has always read studyActivity and continuityConfig; the
    // export simply never wrote them, so a restored backup came back with no
    // streak at all.
    const src = read('../src/main.js');
    const exportBody = src.slice(src.indexOf('const handleExport'), src.indexOf('const handleImport'));
    ['studyActivity', 'continuityConfig', 'recentTests', 'quickPresets', 'stats', 'sources', 'folders']
        .forEach(key => {
            assert.ok(
                new RegExp(`${key}:\\s*AppState\\.${key}`).test(exportBody),
                `${key} is read on import but never written on export`
            );
        });
});
