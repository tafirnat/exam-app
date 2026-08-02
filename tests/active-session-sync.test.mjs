/**
 * The unfinished test, across two devices.
 *
 * Before this the session was device-local: the Gist carried stats, activity and
 * the library, but nothing that said "a test is half done". Answering four of
 * seven questions on one device and picking up the other one therefore showed
 * "Yeniden Başlat" - the FSRS progress had synced, the session had not.
 *
 * Syncing it is cheap: `currentTest` is a list of `sourceId_questionId` keys, so
 * the record is a description of a session, not a copy of the questions. What is
 * not cheap is getting the conflict rules wrong, and there are three that matter:
 *
 *   - A device sitting in a test must keep its own session. A pull that lands
 *     mid-test - a second tab booting, an explicit sync tap - must not swap the
 *     questions under the user.
 *   - A finished test must stay finished. "No record" and "never wrote one" look
 *     identical, so completion leaves a dated tombstone instead of a deletion.
 *   - Otherwise the newer record wins, which is what carries a session forward
 *     from the device that was last used to the one being picked up.
 */

import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let AppState, sync;

const THIS_DEVICE = 'device-here';
const OTHER_DEVICE = 'device-there';

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    AppState = (await import('../src/core/state.js')).AppState;
    sync = await import('../src/core/github-sync.js');
});

/** An unfinished test, `agoMs` milliseconds old. */
function session(deviceId, { answered = 2, agoMs = 0, questions = 7 } = {}) {
    return {
        currentTest: Array.from({ length: questions }, (_, i) => `src-1_q${i}`),
        currentIndex: answered,
        userAnswers: Object.fromEntries(
            Array.from({ length: answered }, (_, i) => [`src-1_q${i}`, ['a']])
        ),
        isAnswerChecked: {},
        shuffledOptionsMap: {},
        testTracking: { results: [], mode: 'normal', _flushedCount: answered },
        deviceId,
        updatedAt: Date.now() - agoMs
    };
}

/** What clearActiveTest() leaves behind when a test is finished. */
function finished(deviceId, agoMs = 0) {
    return { cleared: true, deviceId, updatedAt: Date.now() - agoMs };
}

/** Payload halves, with only the fields the session rules read. */
function sides(localSession, remoteSession) {
    return [
        { deviceId: THIS_DEVICE, activeSession: localSession },
        { deviceId: OTHER_DEVICE, activeSession: remoteSession }
    ];
}

function mergedSession(localSession, remoteSession) {
    const [local, remote] = sides(localSession, remoteSession);
    return sync.mergeSyncData(local, remote).activeSession;
}

beforeEach(() => {
    AppState.deviceId = THIS_DEVICE;
    AppState.sources = [];
    AppState.stats = {};
    AppState.studyActivity = {};
    AppState.lastResetTimestamp = 0;
    AppState.lastProgressResetTimestamp = 0;
});

// ── Carrying a session between devices ──────────────────────────────────────

test('a session from the other device is picked up when this one has none', () => {
    const remote = session(OTHER_DEVICE, { answered: 4 });

    const merged = mergedSession(null, remote);

    assert.equal(merged.currentIndex, 4, 'the half-done test must survive the merge');
    assert.equal(merged.currentTest.length, 7);
});

test('the session record names questions, not question bodies', () => {
    const merged = mergedSession(null, session(OTHER_DEVICE));

    assert.ok(merged.currentTest.every(id => typeof id === 'string'),
        'a session that carried question text would put the library in the progress file');
    assert.ok(JSON.stringify(merged).length < 2000);
});

test('the newer of two idle sessions wins', () => {
    const older = session(THIS_DEVICE, { answered: 1, agoMs: 60 * 60 * 1000 });
    const newer = session(OTHER_DEVICE, { answered: 5, agoMs: 10 * 60 * 1000 });

    assert.equal(mergedSession(older, newer).currentIndex, 5);
    assert.equal(mergedSession(newer, older).currentIndex, 5);
});

// ── The device actually sitting in the test ─────────────────────────────────

test('a live local session is never replaced, even by a newer remote one', () => {
    const live = session(THIS_DEVICE, { answered: 3, agoMs: 1000 });
    // The other device wrote its copy a moment later - and is wrong to.
    const remote = session(OTHER_DEVICE, { answered: 6, agoMs: 0 });

    const merged = mergedSession(live, remote);

    assert.equal(merged.currentIndex, 3, 'the questions must not change under the user mid-test');
    assert.equal(merged.deviceId, THIS_DEVICE);
});

test('a local session goes stale once the device stops writing to it', () => {
    const abandoned = session(THIS_DEVICE, { answered: 3, agoMs: 30 * 60 * 1000 });
    const remote = session(OTHER_DEVICE, { answered: 6, agoMs: 60 * 1000 });

    assert.equal(mergedSession(abandoned, remote).currentIndex, 6);
});

test('a live session belonging to some other device does not get the exemption', () => {
    // Same record, but this device is not the one that wrote it.
    const notOurs = { ...session(OTHER_DEVICE, { answered: 3, agoMs: 1000 }) };
    const newer = session(OTHER_DEVICE, { answered: 6, agoMs: 0 });

    assert.equal(mergedSession(notOurs, newer).currentIndex, 6);
});

// ── Finishing ───────────────────────────────────────────────────────────────

test('a finished test is not resurrected by the other device\'s stale copy', () => {
    const stale = session(OTHER_DEVICE, { answered: 4, agoMs: 60 * 60 * 1000 });
    const done = finished(THIS_DEVICE, 1000);

    const merged = mergedSession(done, stale);

    assert.equal(merged.cleared, true);
    assert.ok(!merged.currentTest, 'a cleared record offers nothing to resume');
});

test('finishing on the other device clears it here too', () => {
    const mine = session(THIS_DEVICE, { answered: 4, agoMs: 60 * 60 * 1000 });
    const done = finished(OTHER_DEVICE, 1000);

    assert.equal(mergedSession(mine, done).cleared, true);
});

test('finishing does not out-rank a test being taken right now', () => {
    const live = session(THIS_DEVICE, { answered: 2, agoMs: 500 });
    const done = finished(OTHER_DEVICE, 0);

    assert.equal(mergedSession(live, done).currentIndex, 2);
});

// ── Degenerate records ──────────────────────────────────────────────────────

test('no session on either side stays no session', () => {
    assert.equal(mergedSession(null, null), null);
});

test('an undated record from an older build loses to a dated one', () => {
    const undated = { currentTest: ['src-1_q0'], currentIndex: 0, deviceId: THIS_DEVICE };
    const dated = session(OTHER_DEVICE, { answered: 3, agoMs: 60 * 60 * 1000 });

    assert.equal(mergedSession(undated, dated).currentIndex, 3);
});

test('an undated record still beats having nothing at all', () => {
    const undated = { currentTest: ['src-1_q0'], currentIndex: 0 };

    assert.ok(mergedSession(undated, null));
    assert.ok(mergedSession(null, undated));
});

// ── Getting it back to the Gist ─────────────────────────────────────────────

test('keeping the local session marks the merge as having local changes', () => {
    const [local, remote] = sides(
        session(THIS_DEVICE, { answered: 3, agoMs: 1000 }),
        session(OTHER_DEVICE, { answered: 6, agoMs: 0 })
    );

    assert.equal(sync.mergeSyncData(local, remote).hasLocalChanges, true,
        'the remote is holding a session this device has already moved past');
});

test('the session travels in the progress file, not the sources file', () => {
    AppState.sources = [];
    const files = sync.splitSyncPayload({
        ...sync.getSyncPayload(),
        activeSession: session(THIS_DEVICE)
    });

    assert.ok(files['exam_app_backup.json'].activeSession,
        'it belongs with the small, frequently-written file');
    assert.ok(!('activeSession' in files['exam_app_sources.json']));
});
