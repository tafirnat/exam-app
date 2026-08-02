import { AppState, saveStudyActivity, saveContinuityConfig, saveActiveTest } from '../../core/state.js';
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

/**
 * The Odak Seri selection. Streak history itself never keys on a source: it
 * lives day-by-day in AppState.studyActivity, so archiving, deleting or swapping
 * a source changes only which questions count from tomorrow on - everything
 * already earned stays earned. Both tracks (Genel and Odak) follow this rule.
 */
export function getFocusSources() {
    return AppState.continuityConfig?.focusSources || [];
}

/**
 * Selected sources that are still in the live library. A source the user
 * archived or deleted drops out here (it can contribute no questions) while
 * getFocusSources keeps the raw selection for display.
 */
export function getLiveFocusSources() {
    const selected = getFocusSources();
    if (selected.length === 0) return [];
    const live = new Set((AppState.sources || []).filter(s => !s.archived).map(s => s.id));
    return selected.filter(id => live.has(id));
}

/**
 * Name for a selected source id. Falls back to the snapshot taken when the
 * selection was saved, so a card describing past streak days stays readable
 * after the source itself is gone.
 */
export function getFocusSourceLabel(sourceId) {
    const source = (AppState.sources || []).find(s => s.id === sourceId);
    if (source && source.name) return source.name;
    const snapshot = AppState.continuityConfig?.focusSourceNames || {};
    return snapshot[sourceId] || sourceId;
}

/**
 * Calculates question target distribution for up to 3 selected focus sources.
 * Returns { totalTarget, distribution: { [sourceId]: targetCount } }
 */
export function calculateFocusTargetDistribution(sourceIds = getLiveFocusSources()) {
    if (!sourceIds || sourceIds.length === 0) {
        return { totalTarget: 15, distribution: {} };
    }

    const selectedSources = sourceIds.slice(0, 3);
    const distribution = {};

    // AppState.questions is only populated in some flows; fall back to the
    // source records so the 8/7 split is decided on real counts either way.
    const questionCountOf = (sourceId) => {
        const flat = (AppState.questions || []).filter(q => q.sourceId === sourceId).length;
        if (flat > 0) return flat;
        const source = (AppState.sources || []).find(s => s.id === sourceId);
        return (source?.questions || []).length;
    };

    if (selectedSources.length === 1) {
        distribution[selectedSources[0]] = 15;
    } else if (selectedSources.length === 2) {
        // Calculate available unlearned counts to assign 8 to the larger source
        const count0 = questionCountOf(selectedSources[0]);
        const count1 = questionCountOf(selectedSources[1]);

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
    // Once the day has a snapshot it is frozen: swapping the selection mid-day
    // must never move the bar the user is already running at.
    if (activity.focusOverdueSnapshot !== null && activity.focusOverdueSnapshot !== undefined) {
        return activity.focusOverdueSnapshot;
    }

    const focusSources = getLiveFocusSources();
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

let isEvaluatingTokens = false;

/**
 * Initializes default freeze token configurations for both Global & Focus tracks.
 */
export function checkAndReplenishTokens() {
    if (isEvaluatingTokens) return;
    isEvaluatingTokens = true;
    try {
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
    } finally {
        isEvaluatingTokens = false;
    }
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

    const hasPriorActivityBefore = (targetDateStr) => {
        const keys = Object.keys(activities);
        return keys.some(k => k < targetDateStr && (
            activities[k]?.studied ||
            activities[k]?.frozen ||
            activities[k]?.focusStudied ||
            activities[k]?.focusFrozen
        ));
    };

    const checkAndFreeze = (dateStr) => {
        if (!hasPriorActivityBefore(dateStr)) return;

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
    checkAndReplenishTokens();
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

    // Ensure we only count questions that were actually answered/evaluated
    const answeredQuestions = (testQuestions || []).filter(q => q && !q.isUnanswered && q.userAnswer !== null && q.userAnswer !== undefined);
    const actualAnsweredCount = Math.min(questionCount, answeredQuestions.length > 0 ? answeredQuestions.length : questionCount);

    // Subtract the already-flushed in-progress counts to avoid double-counting
    // when flushInProgressAnswers() was called before the test was finished.
    const flushed = AppState.testTracking?._flushedCount || 0;
    const flushedCorrect = AppState.testTracking?._flushedCorrectCount || 0;
    const flushedWrong = AppState.testTracking?._flushedWrongCount || 0;
    const flushedFocus = AppState.testTracking?._flushedFocusCount || 0;

    const net = Math.max(0, actualAnsweredCount - flushed);
    const netCorrect = Math.max(0, correctCount - flushedCorrect);
    const netWrong = Math.max(0, wrongCount - flushedWrong);

    // Global Track Update
    activity.questionCount = (activity.questionCount || 0) + net;
    activity.correctCount = (activity.correctCount || 0) + netCorrect;
    activity.wrongCount = (activity.wrongCount || 0) + netWrong;
    activity.unansweredCount = (activity.unansweredCount || 0) + unansweredCount;
    
    const globalReq = getDailyRequirement(activity.overdueSnapshot);
    if (activity.questionCount >= globalReq) {
        activity.studied = true;
    }

    // Focus Track Update
    const focusSources = getFocusSources();
    if (focusSources.length > 0) {
        const timestamps = AppState.continuityConfig?.focusSourceTimestamps || {};
        let focusQuestionsSolved = 0;

        if (answeredQuestions.length > 0) {
            focusQuestionsSolved = answeredQuestions.filter(q => {
                const sid = q.sourceId || q.q?.sourceId;
                if (!sid || !focusSources.includes(sid)) return false;
                const sourceAddedAt = timestamps[sid] || 0;
                const answeredAt = q.answeredAt || Date.now();
                return answeredAt >= sourceAddedAt;
            }).length;
        }

        const netFocus = Math.max(0, focusQuestionsSolved - flushedFocus);
        activity.focusQuestionCount = (activity.focusQuestionCount || 0) + netFocus;
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
 * Commits questions answered so far in an unfinished test to the daily streak.
 *
 * Safe to call multiple times — uses a checkpoint stored on testTracking so
 * only the *delta* since the last flush is added each time. finishTest() then
 * subtracts the flushed amount to avoid double-counting on proper completion.
 *
 * Call this whenever the user leaves the test view without finishing
 * (view switch, browser back, page visibility change, etc.).
 *
 * Double-counting with commitOneAnswerToActivity:
 * Per-answer live commits (commitOneAnswerToActivity) already advance
 * activity.questionCount ahead of this function. To avoid counting those
 * answers twice we only flush the slice that was NOT already live-committed.
 * _liveCommitCount tracks how many answers went through the live path.
 */
export function flushInProgressAnswers() {
    const tracking = AppState.testTracking;
    if (!tracking || !Array.isArray(tracking.results)) return;

    // Only count questions the user actually interacted with (have a result entry)
    const answeredResults = tracking.results.filter(r => r.userAnswer !== null && r.userAnswer !== undefined);
    const answeredCount = answeredResults.length;

    // Delta since last flush — prevents double-counting on repeated calls
    const alreadyFlushed = tracking._flushedCount || 0;
    const delta = answeredCount - alreadyFlushed;
    if (delta <= 0) return; // nothing new to commit

    // How many of those delta answers were already committed via the live path?
    // _liveCommitCount always equals answeredCount (it advances with each answer),
    // so liveAhead is the number of live-commits that haven't been flushed yet.
    const liveCommitted = tracking._liveCommitCount || 0;
    const liveAhead = Math.max(0, liveCommitted - alreadyFlushed);

    // The truly new (non-live-committed) answers go through the normal path.
    const netDelta = Math.max(0, delta - liveAhead);

    const newSlice = answeredResults.slice(alreadyFlushed);
    const allNewCorrect = newSlice.filter(r => r.isCorrect).length;
    const allNewWrong   = newSlice.filter(r => !r.isCorrect).length;

    // The already-live-committed correct/wrong were already written to activity,
    // so only count the remainder.
    const liveSlice    = newSlice.slice(0, liveAhead);
    const liveCorrect  = liveSlice.filter(r => r.isCorrect).length;
    const liveWrong    = liveSlice.filter(r => !r.isCorrect).length;
    const newCorrect   = allNewCorrect - liveCorrect;
    const newWrong     = allNewWrong   - liveWrong;

    const activity = initTodayActivity();

    // Global track — only add what was NOT already live-committed.
    if (netDelta > 0) {
        activity.questionCount = (activity.questionCount || 0) + netDelta;
        activity.correctCount  = (activity.correctCount  || 0) + newCorrect;
        activity.wrongCount    = (activity.wrongCount    || 0) + newWrong;
    }

    const globalReq = getDailyRequirement(activity.overdueSnapshot);
    if (activity.questionCount >= globalReq) {
        activity.studied = true;
    }

    // Advance checkpoints for global breakdown counts
    tracking._flushedCorrectCount = (tracking._flushedCorrectCount || 0) + allNewCorrect;
    tracking._flushedWrongCount   = (tracking._flushedWrongCount   || 0) + allNewWrong;

    // Focus track
    const focusSources = getFocusSources();
    if (focusSources.length > 0) {
        const timestamps = AppState.continuityConfig?.focusSourceTimestamps || {};
        const focusDelta = answeredResults.slice(alreadyFlushed)
            .filter(r => {
                const q = AppState.questionMap?.[`${r.sourceId || ''}_${r.questionId}`]
                    || Object.values(AppState.questionMap || {}).find(q => String(q.id) === String(r.questionId));
                if (!q) return false;
                const sid = q.sourceId;
                if (!sid || !focusSources.includes(sid)) return false;
                const sourceAddedAt = timestamps[sid] || 0;
                const answeredAt = r.answeredAt || Date.now();
                return answeredAt >= sourceAddedAt;
            }).length;

        const alreadyFlushedFocus = tracking._flushedFocusCount || 0;
        activity.focusQuestionCount = (activity.focusQuestionCount || 0) + focusDelta;
        tracking._flushedFocusCount = alreadyFlushedFocus + focusDelta;

        const focusReq = getDailyRequirement(activity.focusOverdueSnapshot);
        if (activity.focusQuestionCount >= focusReq) {
            activity.focusStudied = true;
        }
    }

    // Advance checkpoint
    tracking._flushedCount = answeredCount;

    saveStudyActivity();
    evaluateFreezeTokenEligibility();
    evaluateFocusFreezeTokenEligibility();

    // Persist the updated checkpoint counters to localStorage so that if the
    // user closes the tab and later resumes, the same answers are NOT counted
    // again by the next flushInProgressAnswers() call on exit.
    saveActiveTest();
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

/**
 * Commits a single answered question to today's activity counters in real-time.
 *
 * This is the per-answer counterpart of flushInProgressAnswers(). Where flush
 * batches all in-progress answers on test-exit, this fires on *every* answer so
 * the heatmap and trend charts always reflect the current session's progress —
 * not yesterday's snapshot — without waiting for the test to finish or for the
 * user to navigate home.
 *
 * Double-counting safety: we track a live commit checkpoint on AppState.testTracking
 * (_liveCommitCount). flushInProgressAnswers already subtracts its own checkpoint
 * (_flushedCount) before writing, so these two never add the same answer twice.
 * recordTestFinished also subtracts _flushedCount (not _liveCommitCount), so it
 * correctly handles whichever path the session takes.
 *
 * Focus-track counting is intentionally omitted here: the focus source membership
 * check requires the full answered-results array, which is only available at
 * flush/finish time. The focus bar therefore updates in batch (on exit or finish)
 * rather than per-answer, which is acceptable since the global bar is what the
 * user watches during a live session.
 *
 * @param {boolean} isCorrect  Whether the answer was marked correct.
 */
export function commitOneAnswerToActivity(isCorrect) {
    // Guard: only commit during an active tracked session.
    const tracking = AppState.testTracking;
    if (!tracking) return;

    // Checkpoint: how many live-commits have we already applied?
    const alreadyCommitted = tracking._liveCommitCount || 0;
    // The total answers seen so far (including the one just recorded).
    const totalAnswered = (tracking.results || []).filter(
        r => r.userAnswer !== null && r.userAnswer !== undefined
    ).length;

    if (totalAnswered <= alreadyCommitted) return; // nothing new

    // Exactly one new answer since last commit.
    const activity = initTodayActivity();

    activity.questionCount = (activity.questionCount || 0) + 1;
    if (isCorrect) {
        activity.correctCount = (activity.correctCount || 0) + 1;
    } else {
        activity.wrongCount = (activity.wrongCount || 0) + 1;
    }

    // Mirror the studied flag logic from flushInProgressAnswers / recordTestFinished.
    const globalReq = getDailyRequirement(activity.overdueSnapshot);
    if (activity.questionCount >= globalReq) {
        activity.studied = true;
    }

    // Advance checkpoint.
    tracking._liveCommitCount = alreadyCommitted + 1;

    // Persist — this emits Slice.ACTIVITY, which triggers home:charts (and
    // stats:list after the ui-bindings change) via the store's broadcast.
    saveStudyActivity();
    evaluateFreezeTokenEligibility();
}
