import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let AppState, mergeSyncData, sanitizeActivityRecord, sanitizeStudyActivity, getLocalDateStr;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    const stateMod = await import('../src/core/state.js');
    AppState = stateMod.AppState;

    const syncMod = await import('../src/core/github-sync.js');
    mergeSyncData = syncMod.mergeSyncData;

    getLocalDateStr = (await import('../src/core/daily-activity.js')).getLocalDateStr;

    const migrationMod = await import('../src/core/migration.js');
    sanitizeActivityRecord = migrationMod.sanitizeActivityRecord;
    sanitizeStudyActivity = migrationMod.sanitizeStudyActivity;
});

const emptyPayload = (extra = {}) => ({
    sources: [], folders: [], stats: {}, recentTests: [], studyActivity: {},
    deletedSourceIds: [], deletedFolderIds: [], deletedQuickPresetIds: [], quickPresets: [],
    ...extra
});

/* Two devices are two *parts* of a day, not two views of it: answer five on the
   laptop and five on the phone and the day is ten. Math.max over the flat
   counters said five and the losing five were simply gone. But the opposite
   reading is worse - adding the flat counters re-adds the same answers on every
   sync, which is how a day once reached the millions - so each device counts
   into its own bucket, the day is the sum across buckets, and merging is max
   *within* a bucket. These cases pin both halves of that. */

const withBuckets = (byDevice, extra = {}) => ({
    studied: false, frozen: false, focusStudied: false, focusFrozen: false,
    byDevice, ...extra
});

test('two views of the same bucket do not add up', () => {
    // The same day seen twice - one device, synced back to itself. Adding here
    // is the doubling that once ran a day into the millions.
    const day = { studied: true, questionCount: 7, correctCount: 5, wrongCount: 2, overdueSnapshot: 12 };
    const merged = mergeSyncData(
        emptyPayload({ studyActivity: { '2026-07-31': { ...day } } }),
        emptyPayload({ studyActivity: { '2026-07-31': { ...day } } })
    ).studyActivity['2026-07-31'];

    assert.equal(merged.questionCount, 7);
    assert.equal(merged.correctCount, 5);
    assert.equal(merged.wrongCount, 2);
});

test('two devices working the same day add up', () => {
    const merged = mergeSyncData(
        emptyPayload({ studyActivity: { d1: withBuckets({ 'dev-a': { questionCount: 5, correctCount: 4, wrongCount: 1 } }) } }),
        emptyPayload({ studyActivity: { d1: withBuckets({ 'dev-b': { questionCount: 5, correctCount: 3, wrongCount: 2 } }) } })
    ).studyActivity.d1;

    // Ten questions were answered, so the day is ten - not five.
    assert.equal(merged.questionCount, 10);
    assert.equal(merged.correctCount, 7);
    assert.equal(merged.wrongCount, 3);
});

test('a day split across two devices still counts as earned', () => {
    // Eight each against a fifteen-question bar. Neither device set `studied`,
    // because neither reached the bar alone - the sum is what earns the day.
    const merged = mergeSyncData(
        emptyPayload({ studyActivity: { d1: withBuckets({ 'dev-a': { questionCount: 8, correctCount: 8 } }, { overdueSnapshot: 20 }) } }),
        emptyPayload({ studyActivity: { d1: withBuckets({ 'dev-b': { questionCount: 8, correctCount: 8 } }, { overdueSnapshot: 20 }) } })
    ).studyActivity.d1;

    assert.equal(merged.questionCount, 16);
    assert.equal(merged.studied, true);
});

test('a bucket that already synced is not counted again', () => {
    const shared = { 'dev-a': { questionCount: 5, correctCount: 5 } };
    let day = withBuckets(shared);

    for (let i = 0; i < 10; i++) {
        day = mergeSyncData(
            emptyPayload({ studyActivity: { d1: day } }),
            emptyPayload({ studyActivity: { d1: withBuckets({ ...shared }) } })
        ).studyActivity.d1;
    }

    assert.equal(day.questionCount, 5);
});

test('a device that has fallen behind on its own bucket takes the higher figure', () => {
    // Only dev-a writes dev-a's bucket, and it only grows, so the larger figure
    // is simply the more recent one.
    const merged = mergeSyncData(
        emptyPayload({ studyActivity: { d1: withBuckets({ 'dev-a': { questionCount: 3 } }) } }),
        emptyPayload({ studyActivity: { d1: withBuckets({ 'dev-a': { questionCount: 9 } }) } })
    ).studyActivity.d1;

    assert.equal(merged.questionCount, 9);
});

test('a day from before per-device counting keeps its figures and still accepts new ones', () => {
    const merged = mergeSyncData(
        // An old record: flat counters, no buckets.
        emptyPayload({ studyActivity: { d1: { studied: true, questionCount: 12, correctCount: 12, overdueSnapshot: 15 } } }),
        emptyPayload({ studyActivity: { d1: withBuckets({ 'dev-b': { questionCount: 4, correctCount: 4 } }) } })
    ).studyActivity.d1;

    // The old figures survive whole, in their own bucket, and the new device's
    // work is added rather than compared against them.
    assert.equal(merged.questionCount, 16);
    assert.equal(merged.byDevice._legacy.questionCount, 12);
});

test('the focus track is counted per device too', () => {
    const merged = mergeSyncData(
        emptyPayload({ studyActivity: { d1: withBuckets({ 'dev-a': { questionCount: 6, focusQuestionCount: 6 } }) } }),
        emptyPayload({ studyActivity: { d1: withBuckets({ 'dev-b': { questionCount: 4, focusQuestionCount: 4 } }) } })
    ).studyActivity.d1;

    assert.equal(merged.focusQuestionCount, 10);
});

test('repeated merges stay stable and never compound', () => {
    let state = { studied: true, questionCount: 12, correctCount: 8, wrongCount: 4 };

    for (let i = 0; i < 20; i++) {
        const merged = mergeSyncData(
            emptyPayload({ studyActivity: { '2026-07-31': state } }),
            emptyPayload({ studyActivity: { '2026-07-31': state } })
        );
        state = merged.studyActivity['2026-07-31'];
    }

    assert.equal(state.questionCount, 12);
});

test('study activity merge preserves the focus track fields', () => {
    const local = emptyPayload({
        studyActivity: { '2026-07-31': { questionCount: 15, focusStudied: true, focusQuestionCount: 8, focusOverdueSnapshot: 15 } }
    });
    const remote = emptyPayload({
        studyActivity: { '2026-07-31': { questionCount: 10, focusQuestionCount: 3 } }
    });

    const day = mergeSyncData(local, remote).studyActivity['2026-07-31'];

    assert.equal(day.focusStudied, true);
    assert.equal(day.focusQuestionCount, 8);
    assert.equal(day.focusOverdueSnapshot, 15);
});

test('snapshot merge treats null as unmeasured and keeps a real zero', () => {
    const merged = mergeSyncData(
        emptyPayload({ studyActivity: { d1: { overdueSnapshot: null }, d2: { overdueSnapshot: 0 } } }),
        emptyPayload({ studyActivity: { d1: { overdueSnapshot: 9 }, d2: { overdueSnapshot: null } } })
    );

    assert.equal(merged.studyActivity.d1.overdueSnapshot, 9);
    assert.equal(merged.studyActivity.d2.overdueSnapshot, 0);
});

/* The day's bar is defined as the backlog at the start of the day, and two
   devices each measure it once from their own view of the library. Taking the
   larger of the two could raise the bar after the fact and retract a day that
   had already been earned - which is one of the ways three devices ended up
   disagreeing about a streak while holding the same activity. The earlier
   measurement is the start-of-day one, so the earlier measurement wins. */

/** A day one device measured, with the moment it measured it. */
const measured = (snapshot, at, extra = {}) => ({
    studied: false, questionCount: 0, correctCount: 0, wrongCount: 0, unansweredCount: 0,
    overdueSnapshot: snapshot, overdueSnapshotAt: at, ...extra
});

test('the earlier measurement sets the day, not the larger one', () => {
    const merged = mergeSyncData(
        emptyPayload({ studyActivity: { d1: measured(8, 1000) } }),
        emptyPayload({ studyActivity: { d1: measured(20, 5000) } })
    );

    assert.equal(merged.studyActivity.d1.overdueSnapshot, 8);
    assert.equal(merged.studyActivity.d1.overdueSnapshotAt, 1000);
});

test('the earlier measurement wins from whichever side it arrives on', () => {
    const merged = mergeSyncData(
        emptyPayload({ studyActivity: { d1: measured(20, 5000) } }),
        emptyPayload({ studyActivity: { d1: measured(8, 1000) } })
    );

    // A rule that depended on which side was "local" would leave the two
    // devices permanently disagreeing about the same day.
    assert.equal(merged.studyActivity.d1.overdueSnapshot, 8);
});

test('a day earned against the morning bar survives the afternoon measurement', () => {
    // The regression in full: 8 overdue at 09:00, eight answered, day earned.
    // The old max merge raised the bar to 20 - requirement 15 - and the day went.
    const local = emptyPayload({
        studyActivity: {
            d1: measured(8, 1000, { studied: true, questionCount: 8, correctCount: 8 })
        }
    });
    const remote = emptyPayload({ studyActivity: { d1: measured(20, 5000) } });

    const day = mergeSyncData(local, remote).studyActivity.d1;
    const requirement = day.overdueSnapshot >= 15 ? 15 : (day.overdueSnapshot > 0 ? day.overdueSnapshot : 15);

    assert.equal(day.studied && day.questionCount >= requirement, true);
});

test('local measuring first is a local change, so the remote hears about it', () => {
    const merged = mergeSyncData(
        emptyPayload({ studyActivity: { d1: measured(8, 1000) } }),
        emptyPayload({ studyActivity: { d1: measured(20, 5000) } })
    );

    // Measuring first is worth nothing if it never leaves the device.
    assert.equal(merged.hasLocalChanges, true);
});

test('the only measurement whose time is known wins over an undated one', () => {
    const merged = mergeSyncData(
        emptyPayload({ studyActivity: { d1: measured(20, 4000) } }),
        emptyPayload({ studyActivity: { d1: { overdueSnapshot: 8 } } })
    );

    // An undated record predates this build; it cannot be compared to anything,
    // including the next device's measurement.
    assert.equal(merged.studyActivity.d1.overdueSnapshot, 20);
});

test('two undated measurements keep the old behaviour rather than invent an order', () => {
    const merged = mergeSyncData(
        emptyPayload({ studyActivity: { d1: { overdueSnapshot: 8 } } }),
        emptyPayload({ studyActivity: { d1: { overdueSnapshot: 20 } } })
    );

    assert.equal(merged.studyActivity.d1.overdueSnapshot, 20);
    // Absent, not null: a day with nothing to stamp is left exactly as it was.
    assert.equal('overdueSnapshotAt' in merged.studyActivity.d1, false);
});

test('the focus track is measured on the same rule', () => {
    const merged = mergeSyncData(
        emptyPayload({ studyActivity: { d1: { focusOverdueSnapshot: 7, focusOverdueSnapshotAt: 1000 } } }),
        emptyPayload({ studyActivity: { d1: { focusOverdueSnapshot: 15, focusOverdueSnapshotAt: 5000 } } })
    );

    assert.equal(merged.studyActivity.d1.focusOverdueSnapshot, 7);
    assert.equal(merged.studyActivity.d1.focusOverdueSnapshotAt, 1000);
});

test('a stamp whose measurement did not survive is dropped', () => {
    // Ranking a value that is no longer there ahead of a real one would be worse
    // than having no stamp at all.
    const repaired = sanitizeActivityRecord({ overdueSnapshot: null, overdueSnapshotAt: 1000 });

    assert.equal(repaired.overdueSnapshot, null);
    assert.equal('overdueSnapshotAt' in repaired, false);
});

test('repeated merges of a measured day stay put', () => {
    let local = measured(8, 1000, { studied: true, questionCount: 8 });
    const remote = measured(20, 5000);

    for (let i = 0; i < 5; i++) {
        local = mergeSyncData(
            emptyPayload({ studyActivity: { d1: local } }),
            emptyPayload({ studyActivity: { d1: remote } })
        ).studyActivity.d1;
    }

    assert.equal(local.overdueSnapshot, 8);
    assert.equal(local.overdueSnapshotAt, 1000);
});

/* stability, difficulty, coeff, streak and learned are not five independent
   values: one answer rewrites all of them together and lastReview is the moment
   it did. Merged field by field - max on stability and streak, OR on learned -
   the merge could only ever move a question towards "well known", and both of
   those push it out of the overdue set the daily bar is measured from. */

const reviewed = (at, extra = {}) => ({
    correct: 0, wrong: 0, difficulty: 5, stability: 10, streak: 0, learned: false,
    lastReview: at, ...extra
});

const OLD = '2026-07-20T10:00:00.000Z';
const NEW = '2026-07-30T10:00:00.000Z';

test('a wrong answer un-learns a question instead of the merge putting it back', () => {
    // The lapse: device A got it wrong, which clears learned and drops stability.
    const local = emptyPayload({
        stats: { 'src_1': reviewed(NEW, { learned: false, stability: 2, streak: -1, wrong: 1 }) }
    });
    const remote = emptyPayload({
        stats: { 'src_1': reviewed(OLD, { learned: true, stability: 40, streak: 6, correct: 6 }) }
    });

    const stat = mergeSyncData(local, remote).stats['src_1'];

    // OR on learned put it straight back and the question left rotation for good.
    assert.equal(stat.learned, false);
    // max on stability kept the pre-lapse figure, so FSRS went on reporting the
    // question as fresh and it never came due.
    assert.equal(stat.stability, 2);
    assert.equal(stat.streak, -1);
});

test('the newest review wins the whole record, not the most flattering fields', () => {
    const local = emptyPayload({
        stats: { 'src_1': reviewed(OLD, { stability: 40, streak: 6, learned: true, difficulty: 3 }) }
    });
    const remote = emptyPayload({
        stats: { 'src_1': reviewed(NEW, { stability: 2, streak: -1, learned: false, difficulty: 8 }) }
    });

    const stat = mergeSyncData(local, remote).stats['src_1'];

    // Every field comes from the same side: this is the only combination that
    // was ever actually true of the question at one moment.
    assert.equal(stat.stability, 2);
    assert.equal(stat.streak, -1);
    assert.equal(stat.learned, false);
    assert.equal(stat.difficulty, 8);
    assert.equal(stat.coeff, 4);
    assert.equal(stat.lastReview, NEW);
});

test('a correct answer is taken just as readily as a lapse', () => {
    /* The mirror of the case above, and the one that says the rule is "newest
       review" rather than "always assume the worst": here the newer record is
       the *stronger* one. A merge that quietly preferred the lower stability -
       or that only ever moved a question towards due - would get this wrong,
       and every case above would still pass, because in all of them the newer
       review happens to be the weaker one too. */
    const local = emptyPayload({
        stats: { 'src_1': reviewed(NEW, { stability: 40, streak: 6, learned: true, correct: 6 }) }
    });
    const remote = emptyPayload({
        stats: { 'src_1': reviewed(OLD, { stability: 2, streak: -1, learned: false, wrong: 1 }) }
    });

    const stat = mergeSyncData(local, remote).stats['src_1'];

    assert.equal(stat.stability, 40);
    assert.equal(stat.streak, 6);
    assert.equal(stat.learned, true);
});

test('the record lands the same way whichever device merges', () => {
    const a = reviewed(NEW, { stability: 2, learned: false, streak: -1 });
    const b = reviewed(OLD, { stability: 40, learned: true, streak: 6 });

    const fromA = mergeSyncData(emptyPayload({ stats: { q: a } }), emptyPayload({ stats: { q: b } })).stats.q;
    const fromB = mergeSyncData(emptyPayload({ stats: { q: b } }), emptyPayload({ stats: { q: a } })).stats.q;

    assert.deepEqual(fromA, fromB);
});

test('two reviews at the same instant resolve the same way on both devices', () => {
    const a = reviewed(NEW, { stability: 40, learned: true });
    const b = reviewed(NEW, { stability: 2, learned: false });

    const fromA = mergeSyncData(emptyPayload({ stats: { q: a } }), emptyPayload({ stats: { q: b } })).stats.q;
    const fromB = mergeSyncData(emptyPayload({ stats: { q: b } }), emptyPayload({ stats: { q: a } })).stats.q;

    // Nothing separates these two records, so the rule has to be one that does
    // not depend on which side is "local" - otherwise the two devices sit on
    // different answers forever.
    assert.deepEqual(fromA, fromB);
    // Keeping the question in rotation is the safe direction to break a tie in.
    assert.equal(fromA.stability, 2);
    assert.equal(fromA.learned, false);
});

test('a newer local review is a local change, so the remote stops holding the old one', () => {
    const merged = mergeSyncData(
        emptyPayload({ stats: { 'src_1': reviewed(NEW, { stability: 2 }) } }),
        emptyPayload({ stats: { 'src_1': reviewed(OLD, { stability: 40 }) } })
    );

    assert.equal(merged.hasLocalChanges, true);
});

test('answer counters still take the higher figure', () => {
    const stat = mergeSyncData(
        emptyPayload({ stats: { 'src_1': reviewed(NEW, { correct: 3, wrong: 2 }) } }),
        emptyPayload({ stats: { 'src_1': reviewed(OLD, { correct: 5, wrong: 1 }) } })
    ).stats['src_1'];

    // These only ever go up; the higher figure has seen both devices' answers.
    assert.equal(stat.correct, 5);
    assert.equal(stat.wrong, 2);
});

test('a question neither side has reviewed falls back to whoever answered more', () => {
    const stat = mergeSyncData(
        emptyPayload({ stats: { 'src_1': { correct: 0, wrong: 0, difficulty: 5 } } }),
        emptyPayload({ stats: { 'src_1': { correct: 1, wrong: 0, difficulty: 7 } } })
    ).stats['src_1'];

    assert.equal(stat.difficulty, 7);
});

test('the user marks survive from either side', () => {
    const stat = mergeSyncData(
        emptyPayload({ stats: { 'src_1': reviewed(NEW, { starred: true }) } }),
        emptyPayload({ stats: { 'src_1': reviewed(OLD, { flagged: true, note: 'kalp kapakciklari' }) } })
    ).stats['src_1'];

    // No answer touches these, so they cannot ride along with the review.
    assert.equal(stat.starred, true);
    assert.equal(stat.flagged, true);
    assert.equal(stat.note, 'kalp kapakciklari');
});

test('stats merge keeps lastReview as a usable date instead of NaN', () => {
    const older = '2026-07-20T10:00:00.000Z';
    const newer = '2026-07-30T10:00:00.000Z';

    const merged = mergeSyncData(
        emptyPayload({ stats: { 'src_1': { correct: 3, wrong: 1, difficulty: 6, stability: 4, lastReview: older } } }),
        emptyPayload({ stats: { 'src_1': { correct: 2, wrong: 1, difficulty: 5, stability: 3, lastReview: newer } } })
    );

    const stat = merged.stats['src_1'];
    assert.equal(stat.lastReview, newer);
    assert.ok(Number.isFinite(new Date(stat.lastReview).getTime()));
    assert.equal(stat.coeff, stat.difficulty / 2);
});

test('sanitizeActivityRecord pulls an inflated count back to the answer breakdown', () => {
    const repaired = sanitizeActivityRecord({
        studied: true,
        questionCount: 188243403672,
        correctCount: 5,
        wrongCount: 2,
        unansweredCount: 0
    });

    assert.equal(repaired.questionCount, 7);
});

test('sanitizeActivityRecord falls back to the day target when the breakdown is gone', () => {
    assert.equal(sanitizeActivityRecord({ questionCount: 188243403672 }).questionCount, 15);
    assert.equal(sanitizeActivityRecord({ questionCount: 188243403672, overdueSnapshot: 8 }).questionCount, 8);
    assert.equal(sanitizeActivityRecord({ questionCount: 120 }).questionCount, 120);
    assert.equal(sanitizeActivityRecord({ questionCount: -5 }).questionCount, 0);
    assert.equal(sanitizeActivityRecord({ questionCount: NaN }).questionCount, 0);
    assert.equal(sanitizeActivityRecord({ overdueSnapshot: NaN }).overdueSnapshot, null);
    assert.equal(sanitizeActivityRecord({ questionCount: 10, focusQuestionCount: 999 }).focusQuestionCount, 10);
});

test('sanitizeStudyActivity repairs stored days and reports the count', () => {
    AppState.studyActivity = {
        '2026-07-30': { studied: true, questionCount: 15, correctCount: 10, wrongCount: 5, unansweredCount: 0, frozen: false, overdueSnapshot: 15, focusStudied: false, focusQuestionCount: 0, focusFrozen: false, focusOverdueSnapshot: null },
        '2026-07-31': { studied: true, questionCount: 999999999, correctCount: 4, wrongCount: 3, unansweredCount: 0 }
    };

    /* Two, not one: the clean day is rewritten as well, because per-device
       counting moves a day's existing figures into a legacy bucket and every
       stored day needs that once. It is a real migration rather than a field
       appearing for its own sake - the buckets are where the numbers live from
       here on, and a day without one would read as empty. */
    assert.equal(sanitizeStudyActivity(), 2);
    assert.equal(AppState.studyActivity['2026-07-31'].questionCount, 7);
    assert.equal(AppState.studyActivity['2026-07-30'].questionCount, 15);
    // And it happens once - the second pass finds nothing left to do.
    assert.equal(sanitizeStudyActivity(), 0);
});

/* Every key in studyActivity is a *local* calendar day, so anything comparing a
   timestamp against those keys has to speak the same language. The progress
   reset guard did not: it turned the reset instant into a day with
   toISOString(), which is UTC. East of Greenwich the two disagree for the first
   hours of every day, and the guard then cleared the wrong one - the previous
   day went, while the pre-reset activity from the day the user actually reset
   on survived on the remote and came straight back.

   These run against whatever timezone the machine is in. They only *discriminate*
   away from UTC, where the two readings coincide and there is no bug to have. */

const DAY_MS = 24 * 60 * 60 * 1000;

test('the reset day is read in local time, not UTC', () => {
    // Half past midnight: the window where a UTC reading names the day before.
    const resetAt = new Date();
    resetAt.setHours(0, 30, 0, 0);

    assert.equal(getLocalDateStr(resetAt), getLocalDateStr(new Date(resetAt.getTime())));
    if (resetAt.getTimezoneOffset() < 0) {
        assert.notEqual(getLocalDateStr(resetAt), resetAt.toISOString().slice(0, 10),
            'east of UTC the two readings must differ - that is the whole defect');
    }
});

test('a reset just after local midnight clears its own day, not the one before', () => {
    const resetAt = new Date();
    resetAt.setHours(0, 30, 0, 0);
    const resetDay = getLocalDateStr(resetAt);
    const dayBefore = getLocalDateStr(new Date(resetAt.getTime() - DAY_MS));
    const dayAfter = getLocalDateStr(new Date(resetAt.getTime() + DAY_MS));

    const merged = mergeSyncData(
        // The device that reset: intentionally empty, and newer.
        emptyPayload({ studyActivity: {}, lastProgressResetTimestamp: resetAt.getTime() }),
        // A peer still holding what was there before the reset, plus a later day.
        emptyPayload({
            studyActivity: {
                [dayBefore]: { studied: true, questionCount: 15 },
                [resetDay]: { studied: true, questionCount: 7 },
                [dayAfter]: { studied: true, questionCount: 9 }
            },
            lastProgressResetTimestamp: 0
        })
    ).studyActivity;

    assert.equal(merged[dayBefore], undefined, 'days before the reset go');
    assert.equal(merged[resetDay], undefined, 'and so does the reset day itself');
    // Work done after the reset on another device is not what a reset clears.
    assert.equal(merged[dayAfter]?.questionCount, 9);
});

/* ── The per-question log has to survive both repair and merge ───────────────
   A day's buckets hold one thing beyond their counters: which questions were
   worked, so the trend bars can count a question answered four times once. It
   is written on the answering device and then passed through
   sanitizeActivityRecord twice over - by the boot repair, and by every record
   the Gist merge produces. A repair that rebuilds a bucket from the counter
   list alone dropped it at both points, so the log never outlived the session
   that wrote it and never reached another device at all. */

const loggedDay = (deviceKey, log, counts) => ({
    studied: false, frozen: false,
    byDevice: { [deviceKey]: { unansweredCount: 0, focusQuestionCount: 0, ...counts, questionLog: log } }
});

test('repairing a day keeps its per-question log', () => {
    const repaired = sanitizeActivityRecord(loggedDay('phone',
        { 's1_1': { correct: 2, wrong: 1, empty: 0, isFocus: true } },
        { questionCount: 3, correctCount: 2, wrongCount: 1 }));

    assert.deepEqual(repaired.byDevice.phone.questionLog, {
        's1_1': { correct: 2, wrong: 1, empty: 0, isFocus: true }
    });
    assert.equal(repaired.questionCount, 3, 'and still recomputes the totals from the counters');
});

test('a log entry with no answer behind it is dropped', () => {
    const repaired = sanitizeActivityRecord(loggedDay('phone', {
        's1_1': { correct: 1, wrong: 0, empty: 0, isFocus: false },
        's1_2': { correct: 0, wrong: 0, empty: 0, isFocus: false },
        's1_3': 'not a record'
    }, { questionCount: 1, correctCount: 1 }));

    assert.deepEqual(Object.keys(repaired.byDevice.phone.questionLog), ['s1_1']);
});

test('a bucket that logged nothing gains no empty log', () => {
    const repaired = sanitizeActivityRecord({
        studied: false, byDevice: { phone: { questionCount: 4, correctCount: 4 } }
    });

    // Absent, not {}: an empty log would read as "this device logged, and
    // worked nothing", which is what sends its four questions off the chart.
    assert.equal('questionLog' in repaired.byDevice.phone, false);
});

test('a Gist merge carries both devices logs through intact', () => {
    const day = '2026-08-04';
    const merged = mergeSyncData(
        emptyPayload({
            studyActivity: {
                [day]: loggedDay('phone', { 's1_1': { correct: 1, wrong: 0, empty: 0, isFocus: false } },
                    { questionCount: 1, correctCount: 1 })
            }
        }),
        emptyPayload({
            studyActivity: {
                [day]: loggedDay('laptop', { 's1_2': { correct: 0, wrong: 1, empty: 0, isFocus: false } },
                    { questionCount: 1, wrongCount: 1 })
            }
        })
    ).studyActivity[day];

    assert.deepEqual(Object.keys(merged.byDevice).sort(), ['laptop', 'phone']);
    assert.deepEqual(merged.byDevice.phone.questionLog, { 's1_1': { correct: 1, wrong: 0, empty: 0, isFocus: false } });
    assert.deepEqual(merged.byDevice.laptop.questionLog, { 's1_2': { correct: 0, wrong: 1, empty: 0, isFocus: false } });
    assert.equal(merged.questionCount, 2, 'two devices are two parts of the day');
});
