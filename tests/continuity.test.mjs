import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let getDailyRequirement,
    isActivityRequirementMet,
    isFocusActivityRequirementMet,
    getFsrsStatsForRange,
    calculateFocusTargetDistribution,
    calculateFocusStreak,
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
