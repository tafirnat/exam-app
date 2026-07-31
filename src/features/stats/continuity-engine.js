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
    return 15; // overdueSnapshot === 0
}

/**
 * Checks if a specific activity record meets the streak requirement.
 */
export function isActivityRequirementMet(act) {
    if (!act) return false;
    if (act.frozen) return true;
    if (!act.studied) return false;
    
    const req = getDailyRequirement(act.overdueSnapshot);
    return (act.questionCount || 0) >= req;
}

/**
 * Initializes default freeze token configuration with 1 welcome token.
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
        saveContinuityConfig();
    }
    evaluateFreezeTokenEligibility();
}

/**
 * Calculates FSRS completion rate & streak continuity over the past N days.
 * @param {number} days - Number of days to look back (e.g. 7 or 14)
 */
export function getFsrsStatsForRange(days = 7) {
    const activities = AppState.studyActivity || {};
    let totalTarget = 0;
    let totalSolved = 0;
    let streakSustained = true;

    let currentDate = new Date();
    // If today hasn't been completed yet, start evaluation from yesterday so we don't break the streak check prematurely
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
 * Evaluates performance over past 7 and 14 days to award 1st and 2nd freeze tokens.
 */
export function evaluateFreezeTokenEligibility() {
    if (!AppState.continuityConfig?.freezeTokens) return;
    const tokens = AppState.continuityConfig.freezeTokens;
    const globalStreak = calculateGlobalStreak();

    // Reset tiers if streak is broken
    if (globalStreak === 0) {
        tokens.tier1Earned = false;
        tokens.tier2Earned = false;
        saveContinuityConfig();
        return;
    }

    let updated = false;

    // Check Tier 1 (7 Days + 70% FSRS)
    if (globalStreak >= 7 && !tokens.tier1Earned) {
        const stats7 = getFsrsStatsForRange(7);
        if (stats7.rate >= 70 && stats7.streakSustained) {
            tokens.tier1Earned = true;
            tokens.total = Math.max(tokens.total, 1);
            tokens.remaining = Math.min(tokens.total, tokens.remaining + 1);
            updated = true;
        }
    }

    // Check Tier 2 (14 Days + 80% FSRS)
    if (globalStreak >= 14 && !tokens.tier2Earned) {
        const stats14 = getFsrsStatsForRange(14);
        if (stats14.rate >= 80 && stats14.streakSustained) {
            tokens.tier2Earned = true;
            tokens.total = 2;
            tokens.remaining = Math.min(2, tokens.remaining + 1);
            updated = true;
        }
    }

    if (updated) {
        saveContinuityConfig();
    }
}

/**
 * Checks past missed days and auto-freezes if tokens are available.
 */
function freezeMissedDaysIfPossible() {
    if (!AppState.continuityConfig?.freezeTokens) return;
    const tokens = AppState.continuityConfig.freezeTokens;
    const activities = AppState.studyActivity || {};
    
    const checkAndFreeze = (dateStr) => {
        let act = activities[dateStr];
        if (!act) {
            act = { studied: false, questionCount: 0, frozen: false, overdueSnapshot: null };
            activities[dateStr] = act;
        }
        if (!isActivityRequirementMet(act) && !act.frozen && tokens.remaining > 0) {
            act.frozen = true;
            tokens.remaining--;
            saveContinuityConfig();
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
            overdueSnapshot: null
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
            // Day missed and not frozen -> streak breaks
            break;
        }
        
        firstDay = false;
        currentDate.setDate(currentDate.getDate() - 1);
    }
    
    return streak;
}

export function recordTestFinished(questionCount, correctCount = 0, wrongCount = 0, unansweredCount = 0) {
    const activity = initTodayActivity();
    activity.questionCount = (activity.questionCount || 0) + questionCount;
    activity.correctCount = (activity.correctCount || 0) + correctCount;
    activity.wrongCount = (activity.wrongCount || 0) + wrongCount;
    activity.unansweredCount = (activity.unansweredCount || 0) + unansweredCount;
    
    const req = getDailyRequirement(activity.overdueSnapshot);
    if (activity.questionCount >= req) {
        activity.studied = true;
    }
    
    saveStudyActivity();
    evaluateFreezeTokenEligibility();
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
