import { AppState, saveStudyActivity, saveContinuityConfig } from '../../core/state.js';
import { calculateRetrievability } from '../test/test-engine.js';

export function getLocalDateStr(d = new Date()) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function getMondayStr(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(date.setDate(diff));
    const yyyy = monday.getFullYear();
    const mm = String(monday.getMonth() + 1).padStart(2, '0');
    const dd = String(monday.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * Initializes and manages weekly freeze tokens.
 */
export function checkAndReplenishTokens() {
    if (!AppState.continuityConfig) return;
    const config = AppState.continuityConfig;
    if (!config.freezeTokens) {
        config.freezeTokens = { total: 2, remaining: 2, weekStart: null };
    }
    
    const currentMonday = getMondayStr(new Date());
    if (config.freezeTokens.weekStart !== currentMonday) {
        config.freezeTokens.weekStart = currentMonday;
        config.freezeTokens.remaining = config.freezeTokens.total;
        saveContinuityConfig();
    }
}

/**
 * Checks past days. If a day is missing (not studied), and we have tokens for THAT week,
 * we consume a token and mark it as frozen.
 */
function freezeMissedDaysIfPossible() {
    if (!AppState.continuityConfig?.freezeTokens) return;
    const tokens = AppState.continuityConfig.freezeTokens;
    const activities = AppState.studyActivity || {};
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getLocalDateStr(yesterday);
    
    const dayBefore = new Date();
    dayBefore.setDate(dayBefore.getDate() - 2);
    const dayBeforeStr = getLocalDateStr(dayBefore);
    
    const checkAndFreeze = (dateStr) => {
        let act = activities[dateStr];
        if (!act) {
            act = { studied: false, questionCount: 0, frozen: false, overdueSnapshot: null };
            activities[dateStr] = act;
        }
        if (!act.studied && !act.frozen && tokens.remaining > 0) {
            act.frozen = true;
            tokens.remaining--;
            saveContinuityConfig();
        }
    };
    
    checkAndFreeze(dayBeforeStr);
    checkAndFreeze(yesterdayStr);
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
 * Calculates current global streak using studyActivity and token model.
 * Evaluates backwards from today.
 */
export function calculateGlobalStreak() {
    initTodayActivity(); // ensure today is initialized and tokens replenished/frozen
    const activities = AppState.studyActivity || {};
    let streak = 0;
    
    let currentDate = new Date();
    let firstDay = true;
    
    for (let i = 0; i < 365; i++) {
        const dateStr = getLocalDateStr(currentDate);
        const act = activities[dateStr];
        
        if (act && act.studied) {
            streak++;
        } else if (act && act.frozen) {
            streak++; // frozen days count towards maintaining the streak, though visually they might differ
        } else if (firstDay) {
            // Today is allowed to be missing since it's not over yet.
        } else {
            // Day missed and not frozen -> streak breaks here
            break;
        }
        
        firstDay = false;
        currentDate.setDate(currentDate.getDate() - 1);
    }
    
    return streak;
}

export function recordTestFinished(questionCount) {
    const activity = initTodayActivity();
    activity.studied = true;
    activity.questionCount += questionCount;
    saveStudyActivity();
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
