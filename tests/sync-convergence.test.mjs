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

let AppState, mergeSyncData, addToDay;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    AppState = (await import('../src/core/state.js')).AppState;
    mergeSyncData = (await import('../src/core/github-sync.js')).mergeSyncData;
    addToDay = (await import('../src/core/daily-activity.js')).addToDay;
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

/* The reset scenario needs the clock to be a real instant, not a counter: the
   progress-reset floor is a timestamp read as a *day*, so a counter would put
   every reset in 1970 and the floor would void nothing. Anchored so that "now"
   is 2026-08-03 - after every day in DAYS, which a reset therefore clears - and
   the days worked afterwards are their own, later keys. */
const CLOCK_EPOCH = Date.UTC(2026, 7, 3, 6, 0);
/* The reset day is the first of these on purpose. It is the one day whose record
   can be either pre- or post-reset, so it is where the floor is decided per side
   rather than per day - and work done on it after the reset has to merge like any
   other day's. Leaving it out would test only the easy part. */
const RESET_DAY = '2026-08-03';
const POST_RESET_DAYS = [RESET_DAY, '2026-08-04', '2026-08-05'];

function newDevice(id) {
    return {
        id,
        studyActivity: {},
        stats: {},
        progressResetAt: 0,
        continuityConfig: {
            /* The gift token and nothing earned yet, which is where a real
               install starts. Seeding both tiers as already earned - as this
               did - meant no device ever ran the earning path, so the half of
               the token account that a merge can silently undo never reached
               the merge at all. */
            freezeTokens: {
                total: 1, remaining: 1, tier1Earned: false, tier2Earned: false,
                initialized: true, spentOn: [], grants: []
            },
            focusSources: [],
            revisions: {}
        }
    };
}

/** The day an entry bought or was earned on, read off its name. */
const dayOf = (name) => name.slice(name.indexOf(':') + 1);

/**
 * How many freezes an account can still pay for, written out here rather than
 * imported from core/freeze-tokens.js on purpose: importing the implementation
 * to check the implementation only asserts that the function was called. This is
 * the rule as the spec states it - a grant forgives one freeze older than
 * itself - and the harness computes it from what the *run* did, not from what a
 * device happens to be holding.
 */
function remainingFrom({ total, spentOn = [], grants = [] }) {
    const spendDays = spentOn.map(dayOf).sort();
    const grantDays = grants.map(dayOf).sort();

    let forgiven = 0;
    grantDays.forEach(grantDay => {
        if (forgiven < spendDays.length && spendDays[forgiven] < grantDay) forgiven++;
    });

    return Math.max(0, Math.min(total, total - (spendDays.length - forgiven)));
}

function payloadOf(device, clock) {
    return clone({
        version: 4,
        lastUpdated: clock,
        lastResetTimestamp: 0,
        lastProgressResetTimestamp: device.progressResetAt || 0,
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
function world(seed, { resetOnTurn = null } = {}) {
    const random = rng(seed);
    const devices = ['dev-a', 'dev-b', 'dev-c'].map(newDevice);
    let remote = null;
    let clock = CLOCK_EPOCH;

    const pick = (list) => list[Math.floor(random() * list.length)];
    const tick = () => (clock += 1000);

    /* A device that has reset works on days the reset did not clear. Mixing
       post-reset work into a cleared day would be asking a different question -
       the reset day is the one the merge deliberately leaves to whoever reset. */
    const daysFor = (device) => (device.progressResetAt ? POST_RESET_DAYS : DAYS);

    /* A device answering a question: the day's counters move and the question's
       FSRS record is rewritten, both at the same instant, exactly as
       commitAnsweredSlice() and applyFSRS() do it. */
    function answer(device) {
        const dateKey = pick(daysFor(device));
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
        addToDay(day, device.id, {
            questionCount: 1,
            correctCount: correct ? 1 : 0,
            wrongCount: correct ? 0 : 1
        });
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

    /* Everything the run actually did to the account, so a settled device can be
       checked against what happened rather than against its own stored ledger -
       which is the only way to see a merge quietly dropping an entry. */
    const madeSpends = new Set();
    const madeGrants = new Set();

    function freezeMissedDay(device) {
        const dateKey = pick(daysFor(device));
        const day = device.studyActivity[dateKey];
        if (!day || day.frozen) return;
        if (device.continuityConfig.freezeTokens.remaining <= 0) return;
        day.frozen = true;
        device.continuityConfig = clone(device.continuityConfig);
        const tokens = { ...device.continuityConfig.freezeTokens };
        /* Named for the day it bought, which is what makes the same freeze made
           on two devices one spend - and what lets a reset tell which spends it
           voided. See core/freeze-tokens.js. */
        const name = `global:${dateKey}`;
        tokens.spentOn = [...(tokens.spentOn || []), name];
        tokens.remaining = remainingFrom(tokens);
        device.continuityConfig.freezeTokens = tokens;
        device.continuityConfig.revisions.freezeTokens = { at: tick(), by: device.id };
        madeSpends.add(name);
    }

    /**
     * What evaluateFreezeTokenEligibility() does when a window comes good.
     *
     * The grant is recorded rather than applied by deleting a spend, because
     * deletion is the one edit the union merge cannot carry: the push path
     * merges against the remote before it writes, the remote still holds the
     * spend, and the earning is undone on the way out. That is the defect this
     * action exists to expose - and it is invisible to a single-device test,
     * which is why it took three of them to find.
     */
    function earnToken(device) {
        const tokens = { ...device.continuityConfig.freezeTokens };
        const tier = !tokens.tier1Earned ? 'tier1' : (!tokens.tier2Earned ? 'tier2' : null);
        if (!tier) return;

        /* Named for the day it was earned on. Two devices reaching the same tier
           on the same day write the same name and it is one grant; on different
           days they are two, and the cap at `total` is what keeps that from
           inflating. */
        const name = `${tier}:${pick(daysFor(device))}`;
        if ((tokens.grants || []).includes(name)) return;

        device.continuityConfig = clone(device.continuityConfig);
        tokens.grants = [...(tokens.grants || []), name];
        if (tier === 'tier1') {
            tokens.tier1Earned = true;
            tokens.total = Math.max(tokens.total, 1);
        } else {
            tokens.tier2Earned = true;
            tokens.total = 2;
        }
        tokens.remaining = remainingFrom(tokens);
        device.continuityConfig.freezeTokens = tokens;
        device.continuityConfig.revisions.freezeTokens = { at: tick(), by: device.id };
        madeGrants.add(name);
    }

    /**
     * What clearProgressData() does: progress gone, the token ledger emptied and
     * stamped, the focus selection deliberately kept with the stamp it had.
     */
    function progressReset(device) {
        const at = tick();
        device.stats = {};
        device.studyActivity = {};
        device.continuityConfig = clone({
            ...device.continuityConfig,
            freezeTokens: {
                total: 1, remaining: 1, tier1Earned: false, tier2Earned: false,
                initialized: true, spentOn: [], grants: []
            }
        });
        device.continuityConfig.revisions.freezeTokens = { at, by: device.id };
        device.progressResetAt = at;
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
        /* Adopted, exactly as syncFromGist() persists it - which is the whole
           reason the reset guard has to expire: within one sync every device
           holds the same non-zero instant. */
        device.progressResetAt = Math.max(device.progressResetAt, merged.lastProgressResetTimestamp || 0);
        if (merged.hasLocalChanges) push(device);
    }

    return {
        devices,
        random,
        step(device, turn) {
            if (resetOnTurn !== null && turn === resetOnTurn && !device.progressResetAt) {
                progressReset(device);
                return;
            }
            const roll = random();
            if (roll < 0.42) answer(device);
            else if (roll < 0.52) chooseFocusSources(device);
            else if (roll < 0.59) freezeMissedDay(device);
            else if (roll < 0.65) earnToken(device);
            else if (roll < 0.83) push(device);
            else pull(device);
        },
        /** Everyone stops working and syncs until nothing changes any more. */
        settle() {
            for (let round = 0; round < 6; round++) {
                devices.forEach(push);
                devices.forEach(pull);
            }
        },
        get remote() { return remote; },
        /** Every spend and grant the run made, whoever made it. */
        get made() { return { spends: [...madeSpends], grants: [...madeGrants] }; }
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

test('a progress reset does not stop the devices converging afterwards', () => {
    /* The reset instant is propagated to every device by the pull, so "both
       sides hold the same non-zero instant" is where every device that has ever
       seen a progress reset permanently lives. Deciding the config on those two
       instants alone left the guard switched on there for good: every device
       kept its own config and none ever adopted anything from the Gist - in both
       directions, since the push path merges before it writes. All 60 seeds here
       ended with the three devices on three different focus selections while the
       day records they were derived from stayed identical, which is exactly how
       it read from the outside: the daily FSRS synced, Odak Seri did not.

       Nothing in this file caught it, because every case ran with the reset
       instant at 0 - the one state a device leaves permanently the first time it
       resets anything. */
    for (let seed = 1; seed <= 60; seed++) {
        const w = world(seed, { resetOnTurn: 9 });

        for (let turn = 0; turn < 24; turn++) {
            const device = w.devices[turn % w.devices.length];
            for (let i = 0; i < 5; i++) w.step(device, turn);
        }

        w.settle();

        // The reset has to have reached everyone, or the case below is asserting
        // that three devices which never left the pre-reset state agree.
        assert.ok(w.devices.every(d => d.progressResetAt > 0),
            `seed ${seed}: the reset never reached all three devices`);

        const [a, b, c] = w.devices.map(visibleState);
        assert.deepEqual(a, b, `seed ${seed}: dev-a and dev-b disagree`);
        assert.deepEqual(b, c, `seed ${seed}: dev-b and dev-c disagree`);
    }
});

test('a reset voids the freezes it cleared, on every device', () => {
    /* Convergence alone would be satisfied by three devices agreeing that the
       pre-reset spends are still charged - and they would, because the ledger
       merges by union and a union is unconditional. The days those freezes
       bought are gone from studyActivity; the charge for them has to go too. */
    for (let seed = 1; seed <= 40; seed++) {
        const w = world(seed, { resetOnTurn: 9 });

        for (let turn = 0; turn < 24; turn++) {
            const device = w.devices[turn % w.devices.length];
            for (let i = 0; i < 5; i++) w.step(device, turn);
        }

        w.settle();

        w.devices.forEach(device => {
            const spentOn = device.continuityConfig.freezeTokens.spentOn || [];
            spentOn.forEach(name => {
                const day = name.slice(name.indexOf(':') + 1);
                assert.ok(POST_RESET_DAYS.includes(day),
                    `seed ${seed}, ${device.id}: ${name} bought a day the reset cleared`);
            });
        });
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

/* ── The token account ──────────────────────────────────────────────────────
   Spending was already exercised here; earning was not, and the two halves fail
   in opposite directions. A lost *spend* shows up as a free freeze, which the
   union merge was built to prevent. A lost *grant* shows up as a token that was
   earned and never arrived - and because the tier flag latches, it never comes
   back. That was live: with sync connected the blue snowflake could be spent
   once and never re-earned, and no case in this file could see it, because every
   device started with both tiers already earned. */

test('no token that was earned is lost, and none is earned twice', () => {
    for (let seed = 1; seed <= 60; seed++) {
        const w = world(seed);
        for (let turn = 0; turn < 24; turn++) {
            const device = w.devices[turn % 3];
            for (let i = 0; i < 5; i++) w.step(device);
        }

        w.settle();

        const { grants, spends } = w.made;
        w.devices.forEach(device => {
            const settled = device.continuityConfig.freezeTokens;
            grants.forEach(name => assert.ok((settled.grants || []).includes(name),
                `seed ${seed}, ${device.id}: grant ${name} was earned and did not survive`));
            spends.forEach(name => assert.ok((settled.spentOn || []).includes(name),
                `seed ${seed}, ${device.id}: spend ${name} was made and did not survive`));

            // A union, so nothing can appear twice however often it is merged.
            assert.equal(new Set(settled.grants).size, (settled.grants || []).length,
                `seed ${seed}, ${device.id}: a grant is recorded more than once`);
            assert.equal(new Set(settled.spentOn).size, (settled.spentOn || []).length,
                `seed ${seed}, ${device.id}: a spend is recorded more than once`);
        });
    }
});

test('the token count settles on what the run actually did', () => {
    /* The correctness half. Convergence alone is satisfied by three devices
       agreeing on a wrong number - and they would agree, because dropping a
       grant is perfectly convergent too. Recomputed here from the run's own
       record of every freeze and every tier, by a formula written independently
       of the one under test. */
    for (let seed = 1; seed <= 60; seed++) {
        const w = world(seed);
        for (let turn = 0; turn < 24; turn++) {
            const device = w.devices[turn % 3];
            for (let i = 0; i < 5; i++) w.step(device);
        }

        w.settle();

        const { grants, spends } = w.made;
        const total = w.devices[0].continuityConfig.freezeTokens.total;
        const expected = remainingFrom({ total, spentOn: spends, grants });

        w.devices.forEach(device => {
            assert.equal(device.continuityConfig.freezeTokens.remaining, expected,
                `seed ${seed}, ${device.id}: holds ${device.continuityConfig.freezeTokens.remaining} tokens, the run earned and spent its way to ${expected}`);
        });
    }
});

test('a reset voids the grants it cleared as well as the freezes', () => {
    /* A grant that forgave a voided spend has nothing left to forgive. Keeping
       it while dropping the spend leaves a credit standing against a freeze that
       no longer exists - the reset's refill, counted a second time. */
    for (let seed = 1; seed <= 40; seed++) {
        const w = world(seed, { resetOnTurn: 9 });
        for (let turn = 0; turn < 24; turn++) {
            const device = w.devices[turn % 3];
            for (let i = 0; i < 5; i++) w.step(device, turn);
        }

        w.settle();

        w.devices.forEach(device => {
            (device.continuityConfig.freezeTokens.grants || []).forEach(name => {
                assert.ok(POST_RESET_DAYS.includes(dayOf(name)),
                    `seed ${seed}, ${device.id}: ${name} was earned on a day the reset cleared`);
            });
        });
    }
});

test('no answer is lost and none is counted twice', () => {
    /* Two devices are two *parts* of a day, so the settled total is the sum of
       what each one actually answered - not the larger of the two, which is
       what Math.max gave and which simply lost the smaller side, and not the
       sum of the flat totals re-added on every sync, which is how a day once
       reached the millions. Counted here from the buckets themselves, which is
       the only place the answers are recorded once each. */
    for (let seed = 1; seed <= 40; seed++) {
        const w = world(seed);
        for (let turn = 0; turn < 20; turn++) w.step(w.devices[turn % 3]);

        // Every bucket any device has seen, at its highest.
        const answered = {};
        w.devices.forEach(device => {
            Object.entries(device.studyActivity).forEach(([dateKey, day]) => {
                const perBucket = answered[dateKey] || (answered[dateKey] = {});
                Object.entries(day.byDevice || {}).forEach(([bucket, counts]) => {
                    perBucket[bucket] = Math.max(perBucket[bucket] || 0, counts.questionCount || 0);
                });
            });
        });

        w.settle();

        Object.entries(answered).forEach(([dateKey, perBucket]) => {
            const expected = Object.values(perBucket).reduce((a, b) => a + b, 0);
            const settled = w.devices[0].studyActivity[dateKey];
            assert.equal(settled.questionCount, expected,
                `seed ${seed}, ${dateKey}: settled at ${settled.questionCount}, answers were ${expected}`);
        });
    }
});
