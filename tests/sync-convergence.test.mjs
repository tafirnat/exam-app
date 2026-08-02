import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/* Three devices, one Gist, and the question the whole sync exists to answer:
   after everyone has stopped working and synced, does every device hold the
   same thing?
 *
 * Every case elsewhere pins one rule against one hand-built pair of payloads.
 * That is how a value-based merge stayed green for so long while three real
 * devices disagreed: each rule was locally defensible and the combination was
 * not. What this file does instead is generate a long random sequence of
 * ordinary actions - answering questions, picking focus sources, freezing a
 * missed day, syncing - play it out against the real mergeSyncData(), and then
 * assert that the devices agree.
 *
 * The sequence is seeded, so a failure names a seed that reproduces it exactly.
 */

let AppState, mergeSyncData;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    AppState = (await import('../src/core/state.js')).AppState;
    mergeSyncData = (await import('../src/core/github-sync.js')).mergeSyncData;
});

beforeEach(() => {
    // mergeSyncData folds the live tombstone lists in; these cases carry none.
    AppState.deletedSourceIds = [];
    AppState.deletedFolderIds = [];
    AppState.deletedQuickPresetIds = [];
});

/** Deterministic RNG - mulberry32. A failing seed replays exactly. */
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const DAYS = ['2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'];
const QUESTIONS = ['src-a_1', 'src-a_2', 'src-b_1', 'src-b_2', 'src-b_3'];
const SOURCES = ['src-a', 'src-b', 'src-c'];

function newDevice(id) {
    return {
        id,
        studyActivity: {},
        stats: {},
        continuityConfig: {
            freezeTokens: { total: 2, remaining: 2, tier1Earned: true, tier2Earned: true, initialized: true },
            focusSources: [],
            revisions: {}
        }
    };
}

function payloadOf(device, clock) {
    return clone({
        version: 4,
        lastUpdated: clock,
        lastResetTimestamp: 0,
        lastProgressResetTimestamp: 0,
        sources: [], folders: [], quickPresets: [],
        deletedSourceIds: [], deletedFolderIds: [], deletedQuickPresetIds: [],
        recentTests: [],
        stats: device.stats,
        studyActivity: device.studyActivity,
        continuityConfig: device.continuityConfig,
        activeSession: null,
        deviceId: device.id
    });
}

/**
 * One world: three devices and the Gist they share.
 *
 * The clock is a counter rather than Date.now() so a whole run fits in a
 * millisecond without two writes ever colliding by accident - a real collision
 * is its own case, not something to stumble into here.
 */
function world(seed) {
    const random = rng(seed);
    const devices = ['dev-a', 'dev-b', 'dev-c'].map(newDevice);
    let remote = null;
    let clock = 1000;

    const pick = (list) => list[Math.floor(random() * list.length)];
    const tick = () => ++clock;

    /* A device answering a question: the day's counters move and the question's
       FSRS record is rewritten, both at the same instant, exactly as
       commitAnsweredSlice() and applyFSRS() do it. */
    function answer(device) {
        const dateKey = pick(DAYS);
        const qid = pick(QUESTIONS);
        const at = tick();
        const correct = random() > 0.35;

        const day = device.studyActivity[dateKey] || {
            studied: false, questionCount: 0, correctCount: 0, wrongCount: 0,
            unansweredCount: 0, frozen: false, focusStudied: false,
            focusQuestionCount: 0, focusFrozen: false
        };
        if (day.overdueSnapshot === undefined || day.overdueSnapshot === null) {
            day.overdueSnapshot = Math.floor(random() * 25);
            day.overdueSnapshotAt = at;
        }
        day.questionCount++;
        if (correct) day.correctCount++; else day.wrongCount++;
        const requirement = day.overdueSnapshot >= 15 ? 15 : (day.overdueSnapshot > 0 ? day.overdueSnapshot : 15);
        if (day.questionCount >= requirement) day.studied = true;
        device.studyActivity[dateKey] = day;

        const stat = device.stats[qid] || {
            correct: 0, wrong: 0, difficulty: 5, coeff: 2.5,
            stability: 1, streak: 0, learned: false
        };
        if (correct) {
            stat.correct++;
            stat.streak = stat.streak < 0 ? 1 : stat.streak + 1;
            stat.stability = stat.stability * 1.8;
        } else {
            stat.wrong++;
            stat.streak = stat.streak > 0 ? -1 : stat.streak - 1;
            stat.stability = Math.max(stat.stability * 0.26, 0.1);
            stat.learned = false;
        }
        if (stat.streak >= 5 || stat.stability > 30) stat.learned = true;
        // The instant, shared by every field the answer rewrote.
        stat.lastReview = new Date(at).toISOString();
        device.stats[qid] = stat;
    }

    function chooseFocusSources(device) {
        const count = 1 + Math.floor(random() * 3);
        const chosen = [...SOURCES].sort(() => random() - 0.5).slice(0, count);
        device.continuityConfig = clone(device.continuityConfig);
        device.continuityConfig.focusSources = chosen;
        device.continuityConfig.revisions.focusSources = { at: tick(), by: device.id };
    }

    function freezeMissedDay(device) {
        const dateKey = pick(DAYS);
        const day = device.studyActivity[dateKey];
        if (!day || day.frozen) return;
        if (device.continuityConfig.freezeTokens.remaining <= 0) return;
        day.frozen = true;
        device.continuityConfig = clone(device.continuityConfig);
        device.continuityConfig.freezeTokens = {
            ...device.continuityConfig.freezeTokens,
            remaining: device.continuityConfig.freezeTokens.remaining - 1
        };
        device.continuityConfig.revisions.freezeTokens = { at: tick(), by: device.id };
    }

    /** The push path: read the remote, merge into it, write the result. */
    function push(device) {
        const local = payloadOf(device, tick());
        if (!remote) {
            remote = local;
            return;
        }
        const { hasLocalChanges, ...merged } = mergeSyncData(local, clone(remote));
        remote = { ...local, ...merged };
    }

    /** The pull path: merge the remote in, and push back if local had more. */
    function pull(device) {
        if (!remote) return;
        const merged = mergeSyncData(payloadOf(device, tick()), clone(remote));
        device.stats = merged.stats;
        device.studyActivity = merged.studyActivity;
        device.continuityConfig = merged.continuityConfig;
        if (merged.hasLocalChanges) push(device);
    }

    return {
        devices,
        random,
        step(device) {
            const roll = random();
            if (roll < 0.45) answer(device);
            else if (roll < 0.55) chooseFocusSources(device);
            else if (roll < 0.62) freezeMissedDay(device);
            else if (roll < 0.82) push(device);
            else pull(device);
        },
        /** Everyone stops working and syncs until nothing changes any more. */
        settle() {
            for (let round = 0; round < 6; round++) {
                devices.forEach(push);
                devices.forEach(pull);
            }
        },
        get remote() { return remote; }
    };
}

/** What a device shows the user, which is the only thing that has to agree. */
function visibleState(device) {
    return clone({
        studyActivity: device.studyActivity,
        stats: device.stats,
        continuityConfig: device.continuityConfig
    });
}

test('three devices working in turn end up holding the same data', () => {
    for (let seed = 1; seed <= 60; seed++) {
        const w = world(seed);

        /* Sequential use, which is how these devices are actually used: one
           device at a time, for a stretch, then another picks up. */
        for (let turn = 0; turn < 24; turn++) {
            const device = w.devices[turn % w.devices.length];
            for (let i = 0; i < 5; i++) w.step(device);
        }

        w.settle();

        const [a, b, c] = w.devices.map(visibleState);
        assert.deepEqual(a, b, `seed ${seed}: dev-a and dev-b disagree`);
        assert.deepEqual(b, c, `seed ${seed}: dev-b and dev-c disagree`);
    }
});

test('the settled state does not depend on who syncs first', () => {
    // A merge that converged only in the order it happened to be tested in
    // would leave the last device to sync deciding what everyone believes.
    for (let seed = 1; seed <= 40; seed++) {
        const forward = world(seed);
        const reverse = world(seed);

        for (let turn = 0; turn < 18; turn++) {
            forward.step(forward.devices[turn % 3]);
            reverse.step(reverse.devices[turn % 3]);
        }

        forward.settle();
        reverse.devices.reverse();
        reverse.settle();

        const settledForward = visibleState(forward.devices[0]);
        const settledReverse = visibleState(reverse.devices.find(d => d.id === 'dev-a'));

        assert.deepEqual(settledForward, settledReverse, `seed ${seed}: settling order changed the answer`);
    }
});

test('syncing again changes nothing', () => {
    // Idempotence. Counters that grew on every sync are what once turned a
    // day's total into millions within a few page loads.
    for (let seed = 1; seed <= 30; seed++) {
        const w = world(seed);
        for (let turn = 0; turn < 20; turn++) w.step(w.devices[turn % 3]);

        w.settle();
        const first = w.devices.map(visibleState);
        w.settle();
        const second = w.devices.map(visibleState);

        assert.deepEqual(first, second, `seed ${seed}: a second settle moved the data`);
    }
});

/* Agreeing is not the same as being right, and the difference is not academic:
   `Math.max` and `OR` are both perfectly convergent, which is exactly why three
   devices could agree on a wrong number for months. The cases above would pass
   with either rule in place. These two say *which* value they have to settle
   on, by recomputing it independently from what the devices held. */

test('every day settles on the measurement that was taken first', () => {
    for (let seed = 1; seed <= 40; seed++) {
        const w = world(seed);
        for (let turn = 0; turn < 20; turn++) w.step(w.devices[turn % 3]);

        const earliest = {};
        w.devices.forEach(device => {
            Object.entries(device.studyActivity).forEach(([dateKey, day]) => {
                if (!Number.isFinite(day.overdueSnapshotAt)) return;
                const held = earliest[dateKey];
                if (!held || day.overdueSnapshotAt < held.at) {
                    earliest[dateKey] = { at: day.overdueSnapshotAt, value: day.overdueSnapshot };
                }
            });
        });

        w.settle();

        Object.entries(earliest).forEach(([dateKey, expected]) => {
            assert.equal(w.devices[0].studyActivity[dateKey].overdueSnapshot, expected.value,
                `seed ${seed}, ${dateKey}: the day's bar is not the one measured first`);
        });
    }
});

test('every question settles on the record from its most recent review', () => {
    for (let seed = 1; seed <= 40; seed++) {
        const w = world(seed);
        for (let turn = 0; turn < 20; turn++) w.step(w.devices[turn % 3]);

        const newest = {};
        w.devices.forEach(device => {
            Object.entries(device.stats).forEach(([qid, stat]) => {
                const at = stat.lastReview ? Date.parse(stat.lastReview) : 0;
                if (!newest[qid] || at > newest[qid].at) newest[qid] = { at, stat };
            });
        });

        w.settle();

        Object.entries(newest).forEach(([qid, { stat }]) => {
            const settled = w.devices[0].stats[qid];
            // Whole record, one side: a lapse must be able to lower stability
            // and clear `learned`, which max and OR could never do.
            assert.equal(settled.stability, stat.stability, `seed ${seed}, ${qid}: stability`);
            assert.equal(settled.streak, stat.streak, `seed ${seed}, ${qid}: streak`);
            assert.equal(settled.learned, stat.learned, `seed ${seed}, ${qid}: learned`);
        });
    }
});

test('no answer is lost and none is counted twice', () => {
    /* The counters have to end up at the highest single-device view, never the
       sum. Summing is what doubled a day on every sync; dropping is what made
       one device's afternoon vanish when another pushed over it. */
    for (let seed = 1; seed <= 40; seed++) {
        const w = world(seed);
        for (let turn = 0; turn < 20; turn++) w.step(w.devices[turn % 3]);

        // What each device believed about each day before anyone settled.
        const highWater = {};
        w.devices.forEach(device => {
            Object.entries(device.studyActivity).forEach(([dateKey, day]) => {
                highWater[dateKey] = Math.max(highWater[dateKey] || 0, day.questionCount || 0);
            });
        });

        w.settle();

        Object.entries(highWater).forEach(([dateKey, expected]) => {
            const settled = w.devices[0].studyActivity[dateKey];
            assert.equal(settled.questionCount, expected,
                `seed ${seed}, ${dateKey}: settled at ${settled.questionCount}, highest view was ${expected}`);
        });
    }
});
