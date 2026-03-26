import { AppState, saveStats, saveRecentTests, saveActiveTest, clearActiveTest, saveSources } from '../../core/state.js';
import { shuffleArray, getCorrectAnswers } from '../../core/utils.js';

// FSRS v4.5 Simplified Constants
export const FSRS_W = [0.4, 0.9, 2.3, 10.9, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.26, 2.05];

export function calculateRetrievability(stability, lastReviewDate) {
    if (!lastReviewDate || !stability) return 0;
    const elapsedDays = (new Date() - new Date(lastReviewDate)) / (1000 * 60 * 60 * 24);
    return Math.pow(0.9, elapsedDays / stability);
}

/**
 * Builds rawQuestions and questionMap from all active sources.
 * Always call this before starting or resuming a test to ensure lookups are stable.
 */
export function buildQuestionPool() {
    const rawQuestions = [];
    AppState.sources.forEach(s => {
        if (s.active && s.questions) {
            s.questions.forEach(q => rawQuestions.push({ ...q, sourceId: s.id }));
        }
    });
    const questionMap = {};
    rawQuestions.forEach(q => { questionMap[`${q.sourceId}_${q.id}`] = q; });
    AppState.rawQuestions = rawQuestions;
    AppState.questionMap = questionMap;
    return rawQuestions;
}

/**
 * Applies FSRS algorithm to a stat object in-place.
 * @param {Object} stat - The stat record to update.
 * @param {number} rating - FSRS rating: 1=Again, 2=Hard, 3=Good, 4=Easy.
 * @param {number|undefined} qDifficulty - Optional difficulty from question JSON (1-5 scale).
 */
function applyFSRS(stat, rating, qDifficulty) {
    if (!stat.lastReview || !stat.stability || isNaN(stat.stability)) {
        // First review or recovery from corrupt/legacy data
        stat.stability = FSRS_W[rating - 1];
        if (qDifficulty !== undefined) {
            const baseD = Math.min(Math.max(qDifficulty * 2, 1), 10);
            stat.difficulty = Math.min(Math.max(baseD - FSRS_W[6] * (rating - 3), 1), 10);
        } else {
            stat.difficulty = Math.min(Math.max(FSRS_W[4] - FSRS_W[5] * (rating - 3), 1), 10);
        }
    } else {
        const retrievability = calculateRetrievability(stat.stability, stat.lastReview);
        stat.difficulty = Math.min(Math.max(stat.difficulty - FSRS_W[6] * (rating - 3), 1), 10);
        if (rating === 1) {
            stat.stability = Math.max(stat.stability * 0.2, 0.1);
        } else {
            const hardFactor = rating === 2 ? FSRS_W[15] : 1;
            const easyFactor = rating === 4 ? FSRS_W[16] : 1;
            const factor = 1 + Math.exp(FSRS_W[8]) * (11 - stat.difficulty) *
                Math.pow(stat.stability, -FSRS_W[9]) *
                (Math.exp(FSRS_W[10] * (1 - retrievability)) - 1);
            stat.stability = stat.stability * factor * hardFactor * easyFactor;
        }
    }
    stat.lastReview = new Date().toISOString();
    stat.coeff = stat.difficulty / 2;
}

export function prepareTest(count) {
    const rawQuestions = buildQuestionPool();
    if (rawQuestions.length === 0) return null;

    clearActiveTest();

    // FSRS Selection logic: Prioritize Overdue (R <= 0.9), then use Smart Selection
    let qs = rawQuestions.map((q, idx) => {
        const stat = AppState.stats[q.id] || { difficulty: 5.0, learned: false };
        const r = calculateRetrievability(stat.stability, stat.lastReview);
        return {
            idx,
            q,
            coeff: stat.coeff || 1.5,
            learned: !!stat.learned,
            retrievability: r,
            isOverdue: r > 0 && r <= 0.9
        };
    });

    const nonLearned = qs.filter(item => !item.learned);

    // Primary Pool: Overdue questions
    const overduePool = nonLearned.filter(item => item.isOverdue).sort((a, b) => a.retrievability - b.retrievability);

    // Secondary Pool: Rest of the questions sorted by hardness (coeff)
    const remainingPool = nonLearned.filter(item => !item.isOverdue).sort((a, b) => b.coeff - a.coeff);

    let selectedObjects = [];
    const actualCount = Math.min(count, qs.length);

    selectedObjects.push(...overduePool.slice(0, actualCount));

    if (selectedObjects.length < actualCount) {
        const remainingNeeded = actualCount - selectedObjects.length;
        const pool = remainingPool.length > 0 ? remainingPool : qs.filter(item => !selectedObjects.includes(item));

        if (pool.length <= remainingNeeded) {
            selectedObjects.push(...pool);
        } else {
            // Smart Distribution: 60% hard, 30% med, 10% easy
            const p1 = pool.slice(0, Math.ceil(pool.length * 0.4));
            const p2 = pool.slice(p1.length, p1.length + Math.ceil(pool.length * 0.3));
            const p3 = pool.slice(p1.length + p2.length);

            const take = (sourcePool, n) => {
                const shuffled = shuffleArray(sourcePool);
                const actual = Math.min(n, shuffled.length);
                selectedObjects.push(...shuffled.slice(0, actual));
                return n - actual;
            };

            const n1 = Math.round(remainingNeeded * 0.6);
            const n2 = Math.round(remainingNeeded * 0.3);
            const n3 = remainingNeeded - n1 - n2;

            let rem = take(p1, n1);
            rem = take(p2, n2 + rem);
            take(p3, n3 + rem);
        }
    }

    selectedObjects = shuffleArray(selectedObjects);

    // Store composite IDs (sourceId_questionId) — stable regardless of rawQuestions order
    AppState.currentTest = selectedObjects.map(o => `${o.q.sourceId}_${o.q.id}`);
    AppState.currentIndex = 0;
    AppState.userAnswers = {};
    AppState.isAnswerChecked = {};
    AppState.shuffledOptionsMap = {};
    AppState.hasReachedEnd = false;

    AppState.currentTest.forEach(cid => {
        const q = AppState.questionMap[cid];
        if (q?.options) AppState.shuffledOptionsMap[q.id] = shuffleArray([...q.options]);
    });

    // Randomize TTS Voice (A-G)
    const voices = ["A", "B", "C", "D", "E", "F", "G"];
    AppState.currentTtsVoice = voices[Math.floor(Math.random() * voices.length)];

    startTestTracking(count);

    return AppState.currentTest;
}

function startTestTracking(count) {
    const activeSources = AppState.sources.filter(s => s.active);
    const names = activeSources.map(s => s.name || s.id);
    const sourceTitle = names.length > 1 ? names.join(' + ') : (names[0] || "Unknown Source");

    AppState.testTracking = {
        startTime: new Date().toISOString(),
        endTime: null,
        sourceNames: names,
        sourceTitle,
        questionCount: count,
        elapsedSeconds: 0,
        questionTimeRemaining: {},
        results: []
    };
}

export function prepareRetake(historyEntry, onlyIncorrect = false) {
    if (!historyEntry || !Array.isArray(historyEntry.questions)) return null;

    let retakeQuestions = historyEntry.questions;
    if (onlyIncorrect) {
        retakeQuestions = retakeQuestions.filter(q => !q.isCorrect);
    }
    if (retakeQuestions.length === 0) return null;

    buildQuestionPool();

    // Build composite IDs, filter out questions no longer in active sources
    const compositeIds = shuffleArray(
        retakeQuestions
            .map(rq => `${rq.sourceId}_${rq.id}`)
            .filter(cid => AppState.questionMap[cid])
    );

    if (compositeIds.length === 0) return null;

    AppState.currentTest = compositeIds;
    AppState.currentIndex = 0;
    AppState.userAnswers = {};
    AppState.isAnswerChecked = {};
    AppState.shuffledOptionsMap = {};
    AppState.hasReachedEnd = false;

    compositeIds.forEach(cid => {
        const q = AppState.questionMap[cid];
        if (q?.options) AppState.shuffledOptionsMap[q.id] = shuffleArray([...q.options]);
    });

    const voices = ["A", "B", "C", "D", "E", "F", "G"];
    AppState.currentTtsVoice = voices[Math.floor(Math.random() * voices.length)];

    AppState.testTracking = {
        startTime: new Date().toISOString(),
        endTime: null,
        sourceNames: historyEntry.sourceNames,
        sourceTitle: historyEntry.sourceTitle || (historyEntry.sourceNames?.length > 1 ? historyEntry.sourceNames.join(' + ') : historyEntry.sourceNames?.[0]),
        questionCount: compositeIds.length,
        retakeOfId: historyEntry.id,
        elapsedSeconds: 0,
        questionTimeRemaining: {},
        results: []
    };

    return AppState.currentTest;
}

export async function finishTest() {
    if (!AppState.testTracking) {
        console.warn("finishTest: No active testTracking found.");
        return;
    }

    try {
        AppState.testTracking.endTime = new Date().toISOString();

        const currentTest = AppState.currentTest || [];
        if (currentTest.length === 0) {
            console.warn("finishTest: currentTest is empty.");
        }

        const sessionQuestions = currentTest.map(compositeId => {
            const q = AppState.questionMap[compositeId];
            if (!q) {
                console.error(`finishTest: Question '${compositeId}' not found in questionMap`);
                return null;
            }

            const result = AppState.testTracking.results.find(r =>
                String(r.questionId) === String(q.id)
            );

            if (result) {
                return {
                    ...JSON.parse(JSON.stringify(q)),
                    userAnswer: result.userAnswer,
                    isCorrect: result.isCorrect,
                    isUnanswered: false
                };
            } else {
                return {
                    ...JSON.parse(JSON.stringify(q)),
                    userAnswer: null,
                    isCorrect: false,
                    isUnanswered: true
                };
            }
        }).filter(Boolean);

        const total = sessionQuestions.length;
        const correctCount = sessionQuestions.filter(q => q.isCorrect).length;
        const unansweredCount = sessionQuestions.filter(q => q.isUnanswered).length;
        const wrongCount = total - correctCount - unansweredCount;

        const historyEntry = {
            id: Date.now(),
            sourceNames: AppState.testTracking.sourceNames || ["Unknown Source"],
            sourceTitle: AppState.testTracking.sourceTitle || (AppState.testTracking.sourceNames?.length > 1 ? AppState.testTracking.sourceNames.join(' + ') : AppState.testTracking.sourceNames?.[0]),
            startTime: AppState.testTracking.startTime,
            endTime: AppState.testTracking.endTime,
            questionCount: total,
            correctCount,
            wrongCount,
            unansweredCount,
            elapsedSeconds: AppState.testTracking.elapsedSeconds || 0,
            successRate: total > 0 ? Math.round((correctCount / total) * 100) : 0,
            avgCoeff: total > 0 ? sessionQuestions.reduce((acc, q) => {
                const key = `${q.sourceId}_${q.id}`;
                return acc + (AppState.stats[key]?.coeff || 1.5);
            }, 0) / total : 2.0,
            questions: sessionQuestions
        };

        if (!Array.isArray(AppState.recentTests)) AppState.recentTests = [];
        AppState.recentTests.unshift(historyEntry);
        if (AppState.recentTests.length > 10) {
            AppState.recentTests = AppState.recentTests.slice(0, 10);
        }
        saveRecentTests();

        // --- Per-Source Logging (Limit 5) ---
        const involvedSourceIds = new Set();
        sessionQuestions.forEach(q => { if (q.sourceId) involvedSourceIds.add(q.sourceId); });

        involvedSourceIds.forEach(sourceId => {
            const source = AppState.sources.find(s => s.id === sourceId);
            if (!source) return;

            const sourceQuestions = sessionQuestions.filter(q => q.sourceId === sourceId);
            if (sourceQuestions.length === 0) return;

            const sourceCorrectCount = sourceQuestions.filter(q => q.isCorrect).length;
            const sourceUnansweredCount = sourceQuestions.filter(q => q.isUnanswered).length;
            const sourceWrongCount = sourceQuestions.length - sourceCorrectCount - sourceUnansweredCount;

            const sourceEntry = {
                ...historyEntry,
                id: Date.now() + Math.random(),
                questionCount: sourceQuestions.length,
                correctCount: sourceCorrectCount,
                wrongCount: sourceWrongCount,
                unansweredCount: sourceUnansweredCount,
                successRate: sourceQuestions.length > 0 ? Math.round((sourceCorrectCount / sourceQuestions.length) * 100) : 0,
                questions: sourceQuestions,
                sourceNames: historyEntry.sourceNames,
                sourceTitle: historyEntry.sourceTitle
            };

            if (!source.testResults) source.testResults = [];
            source.testResults.unshift(sourceEntry);
            if (source.testResults.length > 5) source.testResults = source.testResults.slice(0, 5);

            if (sourceWrongCount > 0) {
                if (!source.wrongData) source.wrongData = [];
                source.wrongData.unshift(sourceEntry);
                if (source.wrongData.length > 5) source.wrongData = source.wrongData.slice(0, 5);
            }
        });
        saveSources();

        window.dispatchEvent(new CustomEvent('test-finished', { detail: historyEntry }));

    } catch (err) {
        console.error("Critical error in finishTest:", err);
    } finally {
        AppState.testTracking = null;
        clearActiveTest();
    }
}

export function evaluateAnswer(questionIndex, userAnswer) {
    const q = AppState.questionMap[AppState.currentTest[questionIndex]];
    let isCorrect = false;

    if (q.type === 'text' || q.type === 'text_input' || q.type === 'open_ended' || q.type === 'fill_in_the_blank') {
        const isCaseSensitive = q.answer?.caseSensitive || q.caseSensitive || false;
        let val = (userAnswer[0] || '').toString().trim();
        if (!isCaseSensitive) val = val.toLowerCase();

        const correctAnswers = getCorrectAnswers(q);
        isCorrect = correctAnswers.some(c => {
            let target = String(c).trim();
            if (!isCaseSensitive) target = target.toLowerCase();
            return target === val;
        });
    } else {
        const sel = userAnswer || [];
        const correctIds = getCorrectAnswers(q);
        const cSet = new Set(correctIds.map(String));
        const sSet = new Set(sel.map(String));
        isCorrect = cSet.size === sSet.size && [...sSet].every(id => cSet.has(id));
    }

    return isCorrect;
}

export function updateStats(sourceId, questionId, isCorrect, userAnswer, feedback = undefined) {
    const key = `${sourceId}_${questionId}`;
    if (!AppState.stats[key]) {
        AppState.stats[key] = {
            difficulty: 5.0,
            correct: 0,
            wrong: 0,
            starred: false,
            flagged: false,
            streak: 0,
            stability: 0,
            lastReview: null
        };
    }
    let stat = AppState.stats[key];
    if (stat.streak === undefined) stat.streak = 0;

    let existingResult = null;
    if (AppState.testTracking && AppState.testTracking.results) {
        existingResult = AppState.testTracking.results.find(r => String(r.questionId) === String(questionId));
    }

    // Toggle Logic: restore to pre-session state before re-applying
    if (existingResult && existingResult._preSessionState) {
        Object.keys(existingResult._preSessionState).forEach(prop => {
            stat[prop] = JSON.parse(JSON.stringify(existingResult._preSessionState[prop]));
        });
    } else if (AppState.testTracking && !existingResult) {
        // First answer in this session: snapshot current state
        const snapshot = JSON.parse(JSON.stringify(stat));
        existingResult = {
            questionId,
            isCorrect,
            userAnswer,
            streak: stat.streak,
            _preSessionState: snapshot
        };
        AppState.testTracking.results.push(existingResult);
    }

    // FSRS Rating: 1=Again, 2=Hard, 3=Good, 4=Easy
    let rating = isCorrect ? 3 : 1;
    if (feedback === 'easy') rating = 4;
    if (feedback === 'hard') rating = 2;

    // Apply FSRS algorithm
    const q = AppState.questionMap?.[key];
    applyFSRS(stat, rating, q?.difficulty);

    // Streak and learned status
    if (isCorrect) {
        if (stat.streak < 0) stat.streak = 1; else stat.streak++;
        stat.correct++;
    } else {
        if (stat.streak > 0) stat.streak = -1; else stat.streak--;
        stat.wrong++;
        stat.learned = false;
    }

    if (stat.streak >= 5 || stat.stability > 30) {
        stat.learned = true;
    }

    if (existingResult) {
        existingResult.isCorrect = isCorrect;
        existingResult.userAnswer = userAnswer;
        existingResult.streak = stat.streak;
        if (feedback !== undefined) {
            existingResult.feedback = feedback;
            if (feedback === 'hard') stat.learned = false;
        }
    }

    saveActiveTest();
    saveStats();
}
