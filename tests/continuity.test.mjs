import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let getDailyRequirement, isActivityRequirementMet, getFsrsStatsForRange, evaluateFreezeTokenEligibility, AppState;

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
    getFsrsStatsForRange = engineMod.getFsrsStatsForRange;
    evaluateFreezeTokenEligibility = engineMod.evaluateFreezeTokenEligibility;
});

test('getDailyRequirement calculates correct limits', () => {
    // Overdue >= 15 -> 15
    assert.equal(getDailyRequirement(25), 15);
    assert.equal(getDailyRequirement(15), 15);

    // 0 < Overdue < 15 -> Overdue count
    assert.equal(getDailyRequirement(8), 8);
    assert.equal(getDailyRequirement(1), 1);

    // Overdue === 0 -> 15
    assert.equal(getDailyRequirement(0), 15);
    assert.equal(getDailyRequirement(null), 15);
});

test('isActivityRequirementMet evaluates study requirement correctly', () => {
    // Frozen always met
    assert.equal(isActivityRequirementMet({ frozen: true }), true);

    // Not studied and not frozen -> false
    assert.equal(isActivityRequirementMet({ studied: false, questionCount: 10 }), false);

    // Overdue = 20, solved 10 -> false (requires 15)
    assert.equal(isActivityRequirementMet({ studied: true, questionCount: 10, overdueSnapshot: 20 }), false);

    // Overdue = 20, solved 15 -> true
    assert.equal(isActivityRequirementMet({ studied: true, questionCount: 15, overdueSnapshot: 20 }), true);

    // Overdue = 5, solved 5 -> true
    assert.equal(isActivityRequirementMet({ studied: true, questionCount: 5, overdueSnapshot: 5 }), true);

    // Overdue = 0, solved 10 -> false (requires 15)
    assert.equal(isActivityRequirementMet({ studied: true, questionCount: 10, overdueSnapshot: 0 }), false);

    // Overdue = 0, solved 15 -> true
    assert.equal(isActivityRequirementMet({ studied: true, questionCount: 15, overdueSnapshot: 0 }), true);
});

test('getFsrsStatsForRange calculates range percentage accurately', () => {
    AppState.studyActivity = {
        '2026-07-31': { studied: true, questionCount: 15, overdueSnapshot: 15 },
        '2026-07-30': { studied: true, questionCount: 15, overdueSnapshot: 15 },
        '2026-07-29': { studied: true, questionCount: 15, overdueSnapshot: 15 },
        '2026-07-28': { studied: true, questionCount: 15, overdueSnapshot: 15 },
        '2026-07-27': { studied: true, questionCount: 15, overdueSnapshot: 15 },
        '2026-07-26': { studied: true, questionCount: 15, overdueSnapshot: 15 },
        '2026-07-25': { studied: true, questionCount: 15, overdueSnapshot: 15 },
    };

    const stats = getFsrsStatsForRange(7);
    assert.equal(stats.rate, 100);
    assert.equal(stats.streakSustained, true);
});
