import { AppState, saveStudyActivity, saveContinuityConfig } from '../../core/state.js';
import { calculateRetrievability } from '../test/test-engine.js';

export function getLocalDateStr(d = new Date()) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * Calculates the required question count to maintain daily streak.
 * - If overdueSnapshot >= 15 -> 15 questions
 * - If 0 < overdueSnapshot < 15 -> overdueSnapshot questions
 * - If overdueSnapshot === 0 -> 15 questions
 */
export function getDailyRequirement(overdueSnapshot) {
    if (overdueSnapshot === null || overdueSnapshot === undefined) return 15;
    if (overdueSnapshot >= 15) return 15;
    if (overdueSnapshot > 0) return overdueSnapshot;
    return 15;
}

/**
 * Checks if global activity record meets streak requirement.
 */
export function isActivityRequirementMet(act) {
    if (!act) return false;
    if (act.frozen) return true;
    if (!act.studied) return false;
    
    const req = getDailyRequirement(act.overdueSnapshot);
    return (act.questionCount || 0) >= req;
}

/**
 * Checks if focus activity record meets focus streak requirement.
 */
export function isFocusActivityRequirementMet(act) {
    if (!act) return false;
    if (act.focusFrozen) return true;
    if (!act.focusStudied) return false;

    const req = getDailyRequirement(act.focusOverdueSnapshot);
    return (act.focusQuestionCount || 0) >= req;
}

export function getFocusSources() {
    return AppState.continuityConfig?.focusSources || [];
}

/**
 * Calculates question target distribution for up to 3 selected focus sources.
 * Returns { totalTarget, distribution: { [sourceId]: targetCount } }
 */
export function calculateFocusTargetDistribution(sourceIds = getFocusSources()) {
    if (!sourceIds || sourceIds.length === 0) {
        return { totalTarget: 15, distribution: {} };
    }

    const selectedSources = sourceIds.slice(0, 3);
    const distribution = {};

    if (selectedSources.length === 1) {
        distribution[selectedSources[0]] = 15;
    } else if (selectedSources.length === 2) {
        // Calculate available unlearned counts to assign 8 to the larger source
        const count0 = (AppState.questions || []).filter(q => q.sourceId === selectedSources[0]).length;
        const count1 = (AppState.questions || []).filter(q => q.sourceId === selectedSources[1]).length;

        if (count0 >= count1) {
            distribution[selectedSources[0]] = 8;
            distribution[selectedSources[1]] = 7;
        } else {
            distribution[selectedSources[0]] = 7;
            distribution[selectedSources[1]] = 8;
        }
    } else {
        // 3 sources -> 5, 5, 5
        selectedSources.forEach(id => {
            distribution[id] = 5;
        });
    }

    const totalTarget = Object.values(distribution).reduce((sum, val) => sum + val, 0);
    return { totalTarget, distribution };
}

/**
 * Gets snapshot of focus overdue questions for today across selected focus sources.
 */
export function getDailyFocusOverdueSnapshot() {
    const activity = initTodayActivity();
    if (activity.focusOverdueSnapshot !== null && activity.focusOverdueSnapshot !== undefined) {
        return activity.focusOverdueSnapshot;
    }

    const focusSources = getFocusSources();
    if (!focusSources || focusSources.length === 0) {
        activity.focusOverdueSnapshot = 15;
        saveStudyActivity();
        return 15;
    }

    const distInfo = calculateFocusTargetDistribution(focusSources);
    activity.focusOverdueSnapshot = distInfo.totalTarget;
    saveStudyActivity();
    return distInfo.totalTarget;
}

/**
 * Initializes default freeze token configurations for both Global & Focus tracks.
 */
export function checkAndReplenishTokens() {
    if (!AppState.continuityConfig) AppState.continuityConfig = {};
    const config = AppState.continuityConfig;

    if (!config.freezeTokens || !config.freezeTokens.initialized) {
        config.freezeTokens = {
            total: 1,
            remaining: 1,
            tier1Earned: false,
            tier2Earned: false,
            initialized: true
        };
    }

    if (!config.focusFreezeTokens || !config.focusFreezeTokens.initialized) {
        config.focusFreezeTokens = {
            total: 1,
            remaining: 1,
            tier1Earned: false,
            tier2Earned: false,
            initialized: true
        };
    }

    saveContinuityConfig();
    evaluateFreezeTokenEligibility();
    evaluateFocusFreezeTokenEligibility();
}

/**
 * Calculates FSRS completion rate & streak continuity over past N days for Global track.
 */
export function getFsrsStatsForRange(days = 7) {
    const activities = AppState.studyActivity || {};
    let totalTarget = 0;
    let totalSolved = 0;
    let streakSustained = true;

    let currentDate = new Date();
    const todayStr = getLocalDateStr(currentDate);
    const todayAct = activities[todayStr];
    if (todayAct && !isActivityRequirementMet(todayAct)) {
        currentDate.setDate(currentDate.getDate() - 1);
    }

    for (let i = 0; i < days; i++) {
        const dateStr = getLocalDateStr(currentDate);
        const act = activities[dateStr];

        if (!act || (!act.studied && !act.frozen)) {
            streakSustained = false;
        }

        const snapshot = act?.overdueSnapshot ?? 0;
        const target = snapshot > 0 ? snapshot : 15;
        const solved = Math.min(act?.questionCount || 0, target);

        totalTarget += target;
        totalSolved += solved;

        currentDate.setDate(currentDate.getDate() - 1);
    }

    const rate = totalTarget > 0 ? Math.round((totalSolved / totalTarget) * 100) : 100;
    return { rate, streakSustained, totalSolved, totalTarget };
}

/**
 * Calculates stats over past N days for Focus track.
 */
export function getFocusStatsForRange(days = 7) {
    const activities = AppState.studyActivity || {};
    let totalSolved = 0;
    let totalTarget = 0;
    let streakSustained = true;

    let currentDate = new Date();
    const todayStr = getLocalDateStr(currentDate);
    const todayAct = activities[todayStr];
    if (todayAct && !isFocusActivityRequirementMet(todayAct)) {
        currentDate.setDate(currentDate.getDate() - 1);
    }

    for (let i = 0; i < days; i++) {
        const dateStr = getLocalDateStr(currentDate);
        const act = activities[dateStr];

        if (!act || (!act.focusStudied && !act.focusFrozen)) {
            streakSustained = false;
        }

        const snapshot = act?.focusOverdueSnapshot ?? 15;
        const target = snapshot > 0 ? snapshot : 15;
        const solved = Math.min(act?.focusQuestionCount || 0, target);

        totalTarget += target;
        totalSolved += solved;

        currentDate.setDate(currentDate.getDate() - 1);
    }

    const rate = totalTarget > 0 ? Math.round((totalSolved / totalTarget) * 100) : 100;
    return { rate, streakSustained, totalSolved, totalTarget };
}

/**
 * Evaluates performance for Global freeze tokens.
 */
export function evaluateFreezeTokenEligibility() {
    if (!AppState.continuityConfig?.freezeTokens) return;
    const tokens = AppState.continuityConfig.freezeTokens;
    const globalStreak = calculateGlobalStreak();

    if (globalStreak === 0) {
        tokens.tier1Earned = false;
        tokens.tier2Earned = false;
        saveContinuityConfig();
        return;
    }

    let updated = false;

    if (globalStreak >= 7 && !tokens.tier1Earned) {
        const stats7 = getFsrsStatsForRange(7);
        if (stats7.rate >= 70 && stats7.streakSustained) {
            tokens.tier1Earned = true;
            tokens.total = Math.max(tokens.total, 1);
            tokens.remaining = Math.min(tokens.total, tokens.remaining + 1);
            updated = true;
        }
    }

    if (globalStreak >= 14 && !tokens.tier2Earned) {
        const stats14 = getFsrsStatsForRange(14);
        if (stats14.rate >= 80 && stats14.streakSustained) {
            tokens.tier2Earned = true;
            tokens.total = 2;
            tokens.remaining = Math.min(2, tokens.remaining + 1);
            updated = true;
        }
    }

    if (updated) saveContinuityConfig();
}

/**
 * Evaluates performance for Focus freeze tokens (15 q/day sustained).
 */
export function evaluateFocusFreezeTokenEligibility() {
    if (!AppState.continuityConfig?.focusFreezeTokens) return;
    const tokens = AppState.continuityConfig.focusFreezeTokens;
    const focusStreak = calculateFocusStreak();

    if (focusStreak === 0) {
        tokens.tier1Earned = false;
        tokens.tier2Earned = false;
        saveContinuityConfig();
        return;
    }

    let updated = false;

    if (focusStreak >= 7 && !tokens.tier1Earned) {
        const stats7 = getFocusStatsForRange(7);
        if (stats7.streakSustained) {
            tokens.tier1Earned = true;
            tokens.total = Math.max(tokens.total, 1);
            tokens.remaining = Math.min(tokens.total, tokens.remaining + 1);
            updated = true;
        }
    }

    if (focusStreak >= 14 && !tokens.tier2Earned) {
        const stats14 = getFocusStatsForRange(14);
        if (stats14.streakSustained) {
            tokens.tier2Earned = true;
            tokens.total = 2;
            tokens.remaining = Math.min(2, tokens.remaining + 1);
            updated = true;
        }
    }

    if (updated) saveContinuityConfig();
}

/**
 * Checks past missed days and auto-freezes if tokens are available.
 * Supports Cross-Streak Tier 2 (Joker) token usage!
 */
function freezeMissedDaysIfPossible() {
    if (!AppState.continuityConfig) return;
    const globalTokens = AppState.continuityConfig.freezeTokens;
    const focusTokens = AppState.continuityConfig.focusFreezeTokens;
    const activities = AppState.studyActivity || {};
    
    const checkAndFreeze = (dateStr) => {
        let act = activities[dateStr];
        if (!act) {
            act = {
                studied: false,
                questionCount: 0,
                frozen: false,
                overdueSnapshot: null,
                focusStudied: false,
                focusQuestionCount: 0,
                focusFrozen: false,
                focusOverdueSnapshot: null
            };
            activities[dateStr] = act;
        }

        // Global Track Freeze
        if (!isActivityRequirementMet(act) && !act.frozen) {
            if (globalTokens && globalTokens.remaining > 0) {
                act.frozen = true;
                globalTokens.remaining--;
                saveContinuityConfig();
            } else if (focusTokens && focusTokens.tier2Earned && focusTokens.remaining > 0) {
                // Use Cross-Streak Tier 2 Focus Token as Joker!
                act.frozen = true;
                focusTokens.remaining--;
                saveContinuityConfig();
            }
        }

        // Focus Track Freeze
        if (!isFocusActivityRequirementMet(act) && !act.focusFrozen) {
            if (focusTokens && focusTokens.remaining > 0) {
                act.focusFrozen = true;
                focusTokens.remaining--;
                saveContinuityConfig();
            } else if (globalTokens && globalTokens.tier2Earned && globalTokens.remaining > 0) {
                // Use Cross-Streak Tier 2 Global Token as Joker!
                act.focusFrozen = true;
                globalTokens.remaining--;
                saveContinuityConfig();
            }
        }
    };
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    checkAndFreeze(getLocalDateStr(yesterday));
    
    const dayBefore = new Date();
    dayBefore.setDate(dayBefore.getDate() - 2);
    checkAndFreeze(getLocalDateStr(dayBefore));
}

export function initTodayActivity() {
    checkAndReplenishTokens();
    const today = getLocalDateStr();
    if (!AppState.studyActivity) AppState.studyActivity = {};
    if (!AppState.studyActivity[today]) {
        AppState.studyActivity[today] = {
            studied: false,
            questionCount: 0,
            frozen: false,
            overdueSnapshot: null,
            focusStudied: false,
            focusQuestionCount: 0,
            focusFrozen: false,
            focusOverdueSnapshot: null
        };
        freezeMissedDaysIfPossible();
        saveStudyActivity();
    }
    return AppState.studyActivity[today];
}

/**
 * Calculates current global streak evaluating backwards from today.
 */
export function calculateGlobalStreak() {
    initTodayActivity();
    const activities = AppState.studyActivity || {};
    let streak = 0;
    
    let currentDate = new Date();
    let firstDay = true;
    
    for (let i = 0; i < 365; i++) {
        const dateStr = getLocalDateStr(currentDate);
        const act = activities[dateStr];
        
        if (act && isActivityRequirementMet(act)) {
            streak++;
        } else if (firstDay) {
            // Today is allowed to be missing since it's not over yet.
        } else {
            break;
        }
        
        firstDay = false;
        currentDate.setDate(currentDate.getDate() - 1);
    }
    
    return streak;
}

/**
 * Calculates current focus streak evaluating backwards from today.
 */
export function calculateFocusStreak() {
    initTodayActivity();
    const activities = AppState.studyActivity || {};
    let streak = 0;

    let currentDate = new Date();
    let firstDay = true;

    for (let i = 0; i < 365; i++) {
        const dateStr = getLocalDateStr(currentDate);
        const act = activities[dateStr];

        if (act && isFocusActivityRequirementMet(act)) {
            streak++;
        } else if (firstDay) {
            // Today is allowed to be missing
        } else {
            break;
        }

        firstDay = false;
        currentDate.setDate(currentDate.getDate() - 1);
    }

    return streak;
}

/**
 * Records test completion and updates both Global and Focus track activities.
 */
export function recordTestFinished(questionCount, correctCount = 0, wrongCount = 0, unansweredCount = 0, testQuestions = []) {
    const activity = initTodayActivity();

    // Global Track Update
    activity.questionCount = (activity.questionCount || 0) + questionCount;
    activity.correctCount = (activity.correctCount || 0) + correctCount;
    activity.wrongCount = (activity.wrongCount || 0) + wrongCount;
    activity.unansweredCount = (activity.unansweredCount || 0) + unansweredCount;
    
    const globalReq = getDailyRequirement(activity.overdueSnapshot);
    if (activity.questionCount >= globalReq) {
        activity.studied = true;
    }

    // Focus Track Update
    const focusSources = getFocusSources();
    if (focusSources.length > 0) {
        let focusQuestionsSolved = 0;
        if (testQuestions && testQuestions.length > 0) {
            focusQuestionsSolved = testQuestions.filter(q => focusSources.includes(q.sourceId || q.q?.sourceId)).length;
        } else {
            // Fallback if testQuestions array isn't explicitly passed
            focusQuestionsSolved = questionCount;
        }

        activity.focusQuestionCount = (activity.focusQuestionCount || 0) + focusQuestionsSolved;
        const focusReq = getDailyRequirement(activity.focusOverdueSnapshot);
        if (activity.focusQuestionCount >= focusReq) {
            activity.focusStudied = true;
        }
    }

    saveStudyActivity();
    evaluateFreezeTokenEligibility();
    evaluateFocusFreezeTokenEligibility();
}

/**
 * Gets the daily overdue snapshot. If it doesn't exist for today, calculates it.
 */
export function getDailyOverdueSnapshot(rawQuestions) {
    const activity = initTodayActivity();
    if (activity.overdueSnapshot !== null) {
        return activity.overdueSnapshot;
    }
    
    let currentOverdueCount = 0;
    if (rawQuestions && rawQuestions.length > 0) {
        rawQuestions.forEach(q => {
            const key = `${q.sourceId}_${q.id}`;
            const stat = AppState.stats[key] || { learned: false };
            if (!stat.learned) {
                const r = calculateRetrievability(stat.stability, stat.lastReview);
                if (r > 0 && r <= 0.9) {
                    currentOverdueCount++;
                }
            }
        });
    }
    
    activity.overdueSnapshot = currentOverdueCount;
    saveStudyActivity();
    return currentOverdueCount;
}

export function getCurrentOverdueCount(rawQuestions) {
    let currentOverdueCount = 0;
    if (rawQuestions && rawQuestions.length > 0) {
        rawQuestions.forEach(q => {
            const key = `${q.sourceId}_${q.id}`;
            const stat = AppState.stats[key] || { learned: false };
            if (!stat.learned) {
                const r = calculateRetrievability(stat.stability, stat.lastReview);
                if (r > 0 && r <= 0.9) {
                    currentOverdueCount++;
                }
            }
        });
    }
    return currentOverdueCount;
}

export function getFocusPools() {
    return AppState.continuityConfig?.focusPools || [];
}

export function applyFocusPools(selectedObjects, qsPool) {
    const focusPools = getFocusPools();
    if (focusPools.length === 0) return selectedObjects;
    
    const newSelected = [...selectedObjects];
    const selectedIds = new Set(newSelected.map(item => `${item.q.sourceId}_${item.q.id}`));
    
    focusPools.forEach(pool => {
        let matchingQs = [];
        
        if (pool.targetType === 'folder') {
            const sourcesInFolder = AppState.sources.filter(s => s.folderId === pool.targetId).map(s => s.id);
            matchingQs = qsPool.filter(item => sourcesInFolder.includes(item.q.sourceId) && !item.learned);
        } else {
            matchingQs = qsPool.filter(item => item.q.sourceId === pool.targetId && !item.learned);
        }
        
        let alreadyIncluded = 0;
        matchingQs.forEach(item => {
            if (selectedIds.has(`${item.q.sourceId}_${item.q.id}`)) {
                alreadyIncluded++;
            }
        });
        
        let remainingNeeded = pool.count - alreadyIncluded;
        if (remainingNeeded > 0) {
            const availableToInject = matchingQs
                .filter(item => !selectedIds.has(`${item.q.sourceId}_${item.q.id}`))
                .sort((a, b) => a.retrievability - b.retrievability);
            
            const toInject = availableToInject.slice(0, remainingNeeded);
            toInject.forEach(item => {
                newSelected.push(item);
                selectedIds.add(`${item.q.sourceId}_${item.q.id}`);
            });
        }
    });
    
    return newSelected;
}
