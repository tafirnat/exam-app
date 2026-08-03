import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let getDailyRequirement,
    isActivityRequirementMet,
    isFocusActivityRequirementMet,
    getFsrsStatsForRange,
    calculateFocusTargetDistribution,
    calculateFocusStreak,
    checkAndReplenishTokens,
    initTodayActivity,
    getDailyOverdueSnapshot,
    getDailyFocusOverdueSnapshot,
    getLocalDateStr,
    getCurrentOverdueCount,
    AppState;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    const stateMod = await import('../src/core/state.js');
    AppState = stateMod.AppState;

    const engineMod = await import('../src/features/stats/continuity-engine.js');
    getDailyRequirement = engineMod.getDailyRequirement;
    isActivityRequirementMet = engineMod.isActivityRequirementMet;
    isFocusActivityRequirementMet = engineMod.isFocusActivityRequirementMet;
    getFsrsStatsForRange = engineMod.getFsrsStatsForRange;
    calculateFocusTargetDistribution = engineMod.calculateFocusTargetDistribution;
    calculateFocusStreak = engineMod.calculateFocusStreak;
    checkAndReplenishTokens = engineMod.checkAndReplenishTokens;
    initTodayActivity = engineMod.initTodayActivity;
    getDailyOverdueSnapshot = engineMod.getDailyOverdueSnapshot;
    getDailyFocusOverdueSnapshot = engineMod.getDailyFocusOverdueSnapshot;
    getLocalDateStr = engineMod.getLocalDateStr;
    getCurrentOverdueCount = engineMod.getCurrentOverdueCount;
});

/* The day's bar is measured once per device and then frozen. The merge decides
   between two devices' measurements by which came first, so a measurement
   without a time cannot be compared to anything - and every record would be
   undated if the engine stopped writing the stamp, which would leave the merge
   silently back on "take the larger" without a single failing case to say so. */

test('measuring the day records when it was measured', () => {
    AppState.studyActivity = {};
    AppState.stats = {};
    AppState.sources = [];
    AppState.continuityConfig = { focusSources: [] };

    const before = Date.now();
    getDailyOverdueSnapshot([]);
    const day = AppState.studyActivity[getLocalDateStr()];

    assert.equal(day.overdueSnapshot, 0, 'an empty library really has nothing overdue');
    assert.ok(day.overdueSnapshotAt >= before, 'and the moment it was measured is on the record');
});

test('the focus bar is stamped the same way', () => {
    AppState.studyActivity = {};
    AppState.stats = {};
    AppState.sources = [];
    AppState.continuityConfig = { focusSources: [] };

    const before = Date.now();
    getDailyFocusOverdueSnapshot();
    const day = AppState.studyActivity[getLocalDateStr()];

    assert.equal(day.focusOverdueSnapshot, 15);
    assert.ok(day.focusOverdueSnapshotAt >= before);
});

test('a measured day is not measured again', () => {
    AppState.studyActivity = {};
    AppState.stats = {};
    AppState.sources = [];
    AppState.continuityConfig = { focusSources: [] };

    getDailyOverdueSnapshot([]);
    const firstAt = AppState.studyActivity[getLocalDateStr()].overdueSnapshotAt;

    getDailyOverdueSnapshot([]);

    // Re-measuring would move the bar the user is already running at, and would
    // hand this device a later stamp than the one it earned the day under.
    assert.equal(AppState.studyActivity[getLocalDateStr()].overdueSnapshotAt, firstAt);
});

test('getDailyRequirement calculates correct limits', () => {
    assert.equal(getDailyRequirement(25), 15);
    assert.equal(getDailyRequirement(15), 15);
    assert.equal(getDailyRequirement(8), 8);
    assert.equal(getDailyRequirement(1), 1);
    assert.equal(getDailyRequirement(0), 15);
    assert.equal(getDailyRequirement(null), 15);
});

test('isActivityRequirementMet evaluates global study requirement correctly', () => {
    assert.equal(isActivityRequirementMet({ frozen: true }), true);
    assert.equal(isActivityRequirementMet({ studied: false, questionCount: 10 }), false);
    assert.equal(isActivityRequirementMet({ studied: true, questionCount: 10, overdueSnapshot: 20 }), false);
    assert.equal(isActivityRequirementMet({ studied: true, questionCount: 15, overdueSnapshot: 20 }), true);
    assert.equal(isActivityRequirementMet({ studied: true, questionCount: 5, overdueSnapshot: 5 }), true);
});

test('isFocusActivityRequirementMet evaluates focus study requirement correctly', () => {
    assert.equal(isFocusActivityRequirementMet({ focusFrozen: true }), true);
    assert.equal(isFocusActivityRequirementMet({ focusStudied: false, focusQuestionCount: 10 }), false);
    assert.equal(isFocusActivityRequirementMet({ focusStudied: true, focusQuestionCount: 15, focusOverdueSnapshot: 15 }), true);
    assert.equal(isFocusActivityRequirementMet({ focusStudied: true, focusQuestionCount: 5, focusOverdueSnapshot: 5 }), true);
});

test('calculateFocusTargetDistribution divides targets across sources properly', () => {
    AppState.questions = [
        { id: 1, sourceId: 'srcA' },
        { id: 2, sourceId: 'srcA' },
        { id: 3, sourceId: 'srcA' },
        { id: 4, sourceId: 'srcB' }
    ];

    // 1 source -> 15
    const dist1 = calculateFocusTargetDistribution(['srcA']);
    assert.equal(dist1.totalTarget, 15);
    assert.equal(dist1.distribution['srcA'], 15);

    // 2 sources -> 8 to srcA (3 questions) and 7 to srcB (1 question)
    const dist2 = calculateFocusTargetDistribution(['srcA', 'srcB']);
    assert.equal(dist2.totalTarget, 15);
    assert.equal(dist2.distribution['srcA'], 8);
    assert.equal(dist2.distribution['srcB'], 7);

    // 3 sources -> 5, 5, 5
    const dist3 = calculateFocusTargetDistribution(['srcA', 'srcB', 'srcC']);
    assert.equal(dist3.totalTarget, 15);
    assert.equal(dist3.distribution['srcA'], 5);
    assert.equal(dist3.distribution['srcB'], 5);
    assert.equal(dist3.distribution['srcC'], 5);
});

test('initTodayActivity and checkAndReplenishTokens do not exceed maximum call stack size', () => {
    assert.doesNotThrow(() => {
        initTodayActivity();
        checkAndReplenishTokens();
    });
});

/* An auto-freeze has to say which day it bought, not just that a token went.
   The engine could satisfy every count on this device with a bare `remaining--`
   and nothing here or in the merge would complain - but a decrement is the one
   shape last-writer-wins destroys: two devices freezing two different missed
   days both go 2 -> 1, the merge keeps one of those, and a day ends up frozen
   for free. The name is what makes the spend survive the trip, and it has to be
   the day itself so the same freeze made twice is recognised as one. */

test('an auto-freeze is charged by name, so another device can see what it paid for', () => {
    const dayAgo = (n) => {
        const d = new Date();
        d.setDate(d.getDate() - n);
        return getLocalDateStr(d);
    };

    AppState.continuityConfig = {
        focusSources: [],
        freezeTokens: {
            initialized: true, total: 2, remaining: 2,
            tier1Earned: true, tier2Earned: false, spentOn: []
        },
        focusFreezeTokens: {
            initialized: true, total: 2, remaining: 0,
            tier1Earned: false, tier2Earned: false, spentOn: []
        }
    };
    // A studied day further back, so the two missed days sit inside a run.
    AppState.studyActivity = { [dayAgo(5)]: { studied: true, questionCount: 20 } };

    initTodayActivity();

    assert.equal(AppState.studyActivity[dayAgo(1)].frozen, true);
    assert.equal(AppState.studyActivity[dayAgo(2)].frozen, true);
    assert.deepEqual(
        AppState.continuityConfig.freezeTokens.spentOn.sort(),
        [`global:${dayAgo(2)}`, `global:${dayAgo(1)}`].sort(),
        'each freeze names the day and track it bought'
    );
    assert.equal(AppState.continuityConfig.freezeTokens.remaining, 0,
        'and the count is derived from that ledger rather than decremented beside it');
});

test('recordTestFinished only credits evaluated/answered questions and respects focus selection timestamp', async () => {
    const engineMod = await import('../src/features/stats/continuity-engine.js');
    const recordTestFinished = engineMod.recordTestFinished;

    AppState.studyActivity = {};
    AppState.continuityConfig = {
        focusSources: ['srcFocus'],
        focusSourceTimestamps: {
            'srcFocus': 100000 // selected at t=100000
        }
    };

    const questions = [
        { sourceId: 'srcFocus', id: 'q1', isUnanswered: false, userAnswer: ['1'], answeredAt: 50000 }, // Before focus selection -> should not count for focus
        { sourceId: 'srcFocus', id: 'q2', isUnanswered: false, userAnswer: ['1'], answeredAt: 150000 }, // After focus selection -> should count for focus
        { sourceId: 'srcFocus', id: 'q3', isUnanswered: true, userAnswer: null } // Unanswered -> should not count for anything
    ];

    recordTestFinished(3, 2, 0, 1, questions);

    const todayStr = engineMod.getLocalDateStr();
    const todayAct = AppState.studyActivity[todayStr];

    // Total answered questions = 2 (q1 and q2). q3 is unanswered, so questionCount should be 2
    assert.equal(todayAct.questionCount, 2);

    // Focus answered after timestamp = 1 (q2 only). q1 was answered before focus selection timestamp!
    assert.equal(todayAct.focusQuestionCount, 1);
});

test('recordTestFinished deduplicates correct and wrong counts if flushInProgressAnswers was previously called', async () => {
    const engineMod = await import('../src/features/stats/continuity-engine.js');
    const { recordTestFinished, flushInProgressAnswers, getLocalDateStr } = engineMod;

    AppState.studyActivity = {};
    AppState.continuityConfig = {};
    AppState.questionMap = {
        'src1_q1': { sourceId: 'src1', id: 'q1' },
        'src1_q2': { sourceId: 'src1', id: 'q2' }
    };
    AppState.testTracking = {
        _flushedCount: 0,
        _flushedCorrectCount: 0,
        _flushedWrongCount: 0,
        results: [
            { questionId: 'q1', sourceId: 'src1', isCorrect: true, userAnswer: ['0'], answeredAt: Date.now() }
        ]
    };

    // Flush mid-session -> 1 correct question flushed
    flushInProgressAnswers();

    const todayStr = getLocalDateStr();
    assert.equal(AppState.studyActivity[todayStr].questionCount, 1);
    assert.equal(AppState.studyActivity[todayStr].correctCount, 1);

    // Now user finishes test with 2 questions answered (1 correct, 1 wrong)
    const questions = [
        { sourceId: 'src1', id: 'q1', isUnanswered: false, userAnswer: ['0'], isCorrect: true },
        { sourceId: 'src1', id: 'q2', isUnanswered: false, userAnswer: ['1'], isCorrect: false }
    ];

    recordTestFinished(2, 1, 1, 0, questions);

    // Total question count should be 2, correctCount should be 1, wrongCount should be 1
    assert.equal(AppState.studyActivity[todayStr].questionCount, 2);
    assert.equal(AppState.studyActivity[todayStr].correctCount, 1);
    assert.equal(AppState.studyActivity[todayStr].wrongCount, 1);
});



test('the overdue scan measures every question at one instant', () => {
    /* This count IS the day's bar. Reading the clock per question makes each
       successive question look staler than the last, so questions sitting near
       the R = 0.9 line fall on different sides of it depending only on where
       they happened to be in the loop - and the same library measures a
       different backlog twice in a row.

       The clock is made to tick an hour per read rather than waiting for a real
       boundary: a race a fast machine wins is not something a test can assert. */
    const DAY = 24 * 60 * 60 * 1000;
    const start = Date.now();
    // Just short of due: stability 10 days against 9.9 elapsed, so R sits a
    // hair above 0.9 and a few hours of drift is enough to push it under.
    const lastReview = new Date(start - 9.9 * DAY).toISOString();

    AppState.stats = {};
    const questions = Array.from({ length: 5 }, (_, i) => ({ sourceId: 'src', id: i + 1 }));
    questions.forEach(q => {
        AppState.stats[`src_${q.id}`] = { stability: 10, lastReview, learned: false };
    });

    const realNow = Date.now;
    let tick = start;
    Date.now = () => (tick += 60 * 60 * 1000);

    try {
        // Measured together, not one of them has come due.
        assert.equal(getCurrentOverdueCount(questions), 0);
    } finally {
        Date.now = realNow;
    }
});
