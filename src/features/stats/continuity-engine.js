import { AppState, saveStudyActivity, saveContinuityConfig, saveActiveTest } from '../../core/state.js';
import { calculateRetrievability } from '../test/test-engine.js';
import { getDailyRequirement, addToDay, getLocalDateStr, shiftDateStr } from '../../core/daily-activity.js';
import { spendName, chargeSpend, grantToken, recomputeRemaining } from '../../core/freeze-tokens.js';

/* Re-exported so the many callers that already ask the engine for the day's
   requirement keep working; the rule itself lives in core/daily-activity.js,
   which is the one place the engine, migration.js and the sync merge can all
   reach without importing each other. */
export { getDailyRequirement, getLocalDateStr };



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
        activity.focusOverdueSnapshotAt = Date.now();
        saveStudyActivity();
        return 15;
    }

    const distInfo = calculateFocusTargetDistribution(focusSources);
    activity.focusOverdueSnapshot = distInfo.totalTarget;
    activity.focusOverdueSnapshotAt = Date.now();
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
                initialized: true,
                spentOn: []
            };
        }
        // Records from before the ledger get one built from their own count.
        recomputeRemaining(config.freezeTokens);

        if (!config.focusFreezeTokens || !config.focusFreezeTokens.initialized) {
            config.focusFreezeTokens = {
                total: 1,
                remaining: 1,
                tier1Earned: false,
                tier2Earned: false,
                initialized: true,
                spentOn: []
            };
        }
        recomputeRemaining(config.focusFreezeTokens);

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

    const todayStr = getLocalDateStr();
    let dateStr = todayStr;
    const todayAct = activities[todayStr];
    if (todayAct && !isActivityRequirementMet(todayAct)) {
        dateStr = shiftDateStr(dateStr, -1);
    }

    for (let i = 0; i < days; i++) {
        const act = activities[dateStr];

        if (!act || (!act.studied && !act.frozen)) {
            streakSustained = false;
        }

        const snapshot = act?.overdueSnapshot ?? 0;
        const target = snapshot > 0 ? snapshot : 15;
        const solved = Math.min(act?.questionCount || 0, target);

        totalTarget += target;
        totalSolved += solved;

        dateStr = shiftDateStr(dateStr, -1);
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

    const todayStr = getLocalDateStr();
    let dateStr = todayStr;
    const todayAct = activities[todayStr];
    if (todayAct && !isFocusActivityRequirementMet(todayAct)) {
        dateStr = shiftDateStr(dateStr, -1);
    }

    for (let i = 0; i < days; i++) {
        const act = activities[dateStr];

        if (!act || (!act.focusStudied && !act.focusFrozen)) {
            streakSustained = false;
        }

        const snapshot = act?.focusOverdueSnapshot ?? 15;
        const target = snapshot > 0 ? snapshot : 15;
        const solved = Math.min(act?.focusQuestionCount || 0, target);

        totalTarget += target;
        totalSolved += solved;

        dateStr = shiftDateStr(dateStr, -1);
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
            grantToken(tokens);
            updated = true;
        }
    }

    if (globalStreak >= 14 && !tokens.tier2Earned) {
        const stats14 = getFsrsStatsForRange(14);
        if (stats14.rate >= 80 && stats14.streakSustained) {
            tokens.tier2Earned = true;
            tokens.total = 2;
            grantToken(tokens);
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
            grantToken(tokens);
            updated = true;
        }
    }

    if (focusStreak >= 14 && !tokens.tier2Earned) {
        const stats14 = getFocusStatsForRange(14);
        if (stats14.streakSustained) {
            tokens.tier2Earned = true;
            tokens.total = 2;
            grantToken(tokens);
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

        /* Global Track Freeze. The charge is named for the day and the track
           it protects, so the same freeze made on a second device is the same
           entry and costs nothing - see core/freeze-tokens.js. */
        if (!isActivityRequirementMet(act) && !act.frozen) {
            const name = spendName('global', dateStr);
            if (globalTokens && chargeSpend(globalTokens, name)) {
                act.frozen = true;
                saveContinuityConfig();
            } else if (focusTokens && focusTokens.tier2Earned && chargeSpend(focusTokens, name)) {
                // Use Cross-Streak Tier 2 Focus Token as Joker!
                act.frozen = true;
                saveContinuityConfig();
            }
        }

        // Focus Track Freeze
        if (!isFocusActivityRequirementMet(act) && !act.focusFrozen) {
            const name = spendName('focus', dateStr);
            if (focusTokens && chargeSpend(focusTokens, name)) {
                act.focusFrozen = true;
                saveContinuityConfig();
            } else if (globalTokens && globalTokens.tier2Earned && chargeSpend(globalTokens, name)) {
                // Use Cross-Streak Tier 2 Global Token as Joker!
                act.focusFrozen = true;
                saveContinuityConfig();
            }
        }
    };

    const today = getLocalDateStr();
    checkAndFreeze(shiftDateStr(today, -1));
    checkAndFreeze(shiftDateStr(today, -2));
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
    
    let dateStr = getLocalDateStr();
    let firstDay = true;

    for (let i = 0; i < 365; i++) {
        const act = activities[dateStr];

        if (act && isActivityRequirementMet(act)) {
            streak++;
        } else if (firstDay) {
            // Today is allowed to be missing since it's not over yet.
        } else {
            break;
        }

        firstDay = false;
        dateStr = shiftDateStr(dateStr, -1);
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

    let dateStr = getLocalDateStr();
    let firstDay = true;

    for (let i = 0; i < 365; i++) {
        const act = activities[dateStr];

        if (act && isFocusActivityRequirementMet(act)) {
            streak++;
        } else if (firstDay) {
            // Today is allowed to be missing
        } else {
            break;
        }

        firstDay = false;
        dateStr = shiftDateStr(dateStr, -1);
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

    // Focus Track: worked out before the write so both tracks land together.
    let netFocus = 0;
    const focusSources = getFocusSources();
    const timestamps = AppState.continuityConfig?.focusSourceTimestamps || {};
    if (focusSources.length > 0 && answeredQuestions.length > 0) {
        const focusQuestionsSolved = answeredQuestions.filter(q => {
            const sid = q.sourceId || q.q?.sourceId;
            if (!sid || !focusSources.includes(sid)) return false;
            const sourceAddedAt = timestamps[sid] || 0;
            const answeredAt = q.answeredAt || Date.now();
            return answeredAt >= sourceAddedAt;
        }).length;
        netFocus = Math.max(0, focusQuestionsSolved - flushedFocus);
    }

    const questionLog = {};
    const unansweredQuestions = (testQuestions || []).filter(q => q && (q.isUnanswered || q.userAnswer === null || q.userAnswer === undefined));
    unansweredQuestions.forEach(q => {
        const qId = String(q.id || q.q?.id);
        if (!questionLog[qId]) {
            questionLog[qId] = { correct: 0, wrong: 0, empty: 0, isFocus: false };
        }
        questionLog[qId].empty++;

        const sid = q.sourceId || q.q?.sourceId;
        if (sid && focusSources.includes(sid)) {
            if (Date.now() >= (timestamps[sid] || 0)) {
                questionLog[qId].isFocus = true;
            }
        }
    });

    // Into this device's bucket - see commitAnsweredSlice().
    addToDay(activity, AppState.deviceId, {
        questionCount: net,
        correctCount: netCorrect,
        wrongCount: netWrong,
        unansweredCount,
        focusQuestionCount: netFocus,
        questionLog: Object.keys(questionLog).length > 0 ? questionLog : undefined
    });

    saveStudyActivity();
    evaluateFreezeTokenEligibility();
    evaluateFocusFreezeTokenEligibility();
}

/**
 * How many of `results` count towards the focus track.
 *
 * A question qualifies when its source is in the focus selection *and* it was
 * answered after that source joined it - questions solved before the user
 * picked the source were never part of the bargain.
 */
function countFocusAnswers(results) {
    const focusSources = getFocusSources();
    if (focusSources.length === 0) return 0;

    const timestamps = AppState.continuityConfig?.focusSourceTimestamps || {};
    return results.filter(r => {
        /* The result carries its own sourceId; the questionMap lookup is the
           fallback for records written before it did. */
        const sid = r.sourceId
            || AppState.questionMap?.[`${r.sourceId || ''}_${r.questionId}`]?.sourceId
            || Object.values(AppState.questionMap || {})
                .find(q => String(q.id) === String(r.questionId))?.sourceId;
        if (!sid || !focusSources.includes(sid)) return false;
        return (r.answeredAt || Date.now()) >= (timestamps[sid] || 0);
    }).length;
}

/**
 * Writes every answer this session has not yet contributed into today's
 * activity and moves the checkpoint past them.
 *
 * This is the *only* place today's counters are advanced from a session. The
 * live per-answer path and the flush path both call it, which is what makes
 * them safe to interleave in any order: the cursor `_flushedCount` walks one
 * direction over one ordered array, so an answer behind it can never be
 * counted again.
 *
 * That was not always so. The live path kept its own cursor (`_liveCommitCount`)
 * while flush and recordTestFinished read `_flushedCount`, and the two were
 * reconciled by arithmetic at each site. recordTestFinished subtracted only
 * `_flushedCount`, so a test finished without ever leaving the test view - the
 * ordinary case - re-added every answer the live path had already written and
 * the day ran at double. The focus track escaped the doubling only because the
 * live path did not count it at all, which is why Genel and Odak could disagree
 * about identical study, and why a max-merge then froze the inflated number
 * onto every other device.
 *
 * @returns {boolean} whether anything was committed.
 */
function commitAnsweredSlice(tracking) {
    if (!tracking || !Array.isArray(tracking.results)) return false;

    /* A session started by a build that still kept a separate live cursor may
       be resumed under this one. Whatever that cursor reached is already in
       today's totals, so the unified cursor has to start at least there. */
    if (tracking._liveCommitCount > (tracking._flushedCount || 0)) {
        tracking._flushedCount = tracking._liveCommitCount;
    }
    delete tracking._liveCommitCount;

    const answered = tracking.results.filter(r => r.userAnswer !== null && r.userAnswer !== undefined);
    const alreadyCounted = tracking._flushedCount || 0;
    const pending = answered.slice(alreadyCounted);
    if (pending.length === 0) return false;

    const activity = initTodayActivity();

    const correct = pending.filter(r => r.isCorrect).length;
    const wrong = pending.length - correct;

    /* Counted from the same slice as the global track rather than at flush
       time, so the two tracks are always derived from the same answers. A tab
       the browser closes mid-session used to leave the focus track behind. */
    const focusDelta = countFocusAnswers(pending);

    const questionLog = {};
    const focusSources = getFocusSources();
    const timestamps = AppState.continuityConfig?.focusSourceTimestamps || {};
    
    pending.forEach(r => {
        const qId = String(r.questionId);
        if (!questionLog[qId]) {
            questionLog[qId] = { correct: 0, wrong: 0, empty: 0, isFocus: false };
        }
        if (r.isCorrect) questionLog[qId].correct++;
        else questionLog[qId].wrong++;

        const sid = r.sourceId
            || AppState.questionMap?.[`${r.sourceId || ''}_${r.questionId}`]?.sourceId
            || Object.values(AppState.questionMap || {})
                .find(q => String(q.id) === String(r.questionId))?.sourceId;
        
        if (sid && focusSources.includes(sid)) {
            if ((r.answeredAt || Date.now()) >= (timestamps[sid] || 0)) {
                questionLog[qId].isFocus = true;
            }
        }
    });

    /* Into this device's own bucket. The day's totals are the sum across
       buckets, so the other device's answers to the same day are added to
       these rather than competing with them. */
    addToDay(activity, AppState.deviceId, {
        questionCount: pending.length,
        correctCount: correct,
        wrongCount: wrong,
        focusQuestionCount: focusDelta,
        questionLog: Object.keys(questionLog).length > 0 ? questionLog : undefined
    });

    tracking._flushedCount = answered.length;
    tracking._flushedCorrectCount = (tracking._flushedCorrectCount || 0) + correct;
    tracking._flushedWrongCount = (tracking._flushedWrongCount || 0) + wrong;
    tracking._flushedFocusCount = (tracking._flushedFocusCount || 0) + focusDelta;

    saveStudyActivity();
    evaluateFreezeTokenEligibility();
    evaluateFocusFreezeTokenEligibility();
    return true;
}

/**
 * Commits questions answered so far in an unfinished test to the daily streak.
 *
 * Safe to call multiple times - the checkpoint on testTracking means only the
 * answers nothing has counted yet are added. recordTestFinished() then subtracts
 * the same checkpoint, so completing the test does not re-add them.
 *
 * Call this whenever the user leaves the test view without finishing
 * (view switch, browser back, page visibility change, etc.).
 */
export function flushInProgressAnswers() {
    const tracking = AppState.testTracking;
    if (!commitAnsweredSlice(tracking)) return;

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
        /* The whole count taken at one instant. Per-question clock reads put
           questions either side of the R <= 0.9 line depending on where the
           millisecond fell, so the same library could measure a different
           backlog twice in a row - and this number is the day's bar. */
        const measuredAt = Date.now();
        rawQuestions.forEach(q => {
            const key = `${q.sourceId}_${q.id}`;
            const stat = AppState.stats[key] || { learned: false };
            if (!stat.learned) {
                const r = calculateRetrievability(stat.stability, stat.lastReview, measuredAt);
                if (r > 0 && r <= 0.9) {
                    currentOverdueCount++;
                }
            }
        });
    }
    
    activity.overdueSnapshot = currentOverdueCount;
    /* When the measurement was taken, not just what it said. The day's bar is
       meant to be fixed at the start of the day; two devices each measure it
       once from their own view of the library, and the merge has to be able to
       tell which of those two measurements was the start-of-day one. Without a
       time there was nothing to compare and the merge took the larger, which
       could raise the bar above a target the user had already hit. */
    activity.overdueSnapshotAt = Date.now();
    saveStudyActivity();
    return currentOverdueCount;
}

export function getCurrentOverdueCount(rawQuestions) {
    let currentOverdueCount = 0;
    if (rawQuestions && rawQuestions.length > 0) {
        /* The whole count taken at one instant. Per-question clock reads put
           questions either side of the R <= 0.9 line depending on where the
           millisecond fell, so the same library could measure a different
           backlog twice in a row - and this number is the day's bar. */
        const measuredAt = Date.now();
        rawQuestions.forEach(q => {
            const key = `${q.sourceId}_${q.id}`;
            const stat = AppState.stats[key] || { learned: false };
            if (!stat.learned) {
                const r = calculateRetrievability(stat.stability, stat.lastReview, measuredAt);
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
 * Commits the answer just recorded to today's activity counters in real-time.
 *
 * The per-answer counterpart of flushInProgressAnswers(): where flush batches on
 * test-exit, this fires on *every* answer so the heatmap and trend charts show
 * the current session rather than yesterday's snapshot. Both go through
 * commitAnsweredSlice(), so both tracks - Genel and Odak - advance from the same
 * answers at the same moment, and neither path can count an answer the other
 * already did.
 *
 * The caller must have pushed the result onto testTracking.results first; the
 * correctness of the answer is read from there rather than passed in, so the
 * two can never disagree.
 *
 * Persisting emits Slice.ACTIVITY, which is what repaints the charts.
 */
export function commitOneAnswerToActivity() {
    commitAnsweredSlice(AppState.testTracking);
}
