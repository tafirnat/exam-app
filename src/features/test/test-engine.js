import { AppState, saveStats, saveRecentTests, saveActiveTest, clearActiveTest } from '../../core/state.js';
import { shuffleArray, getCorrectAnswers } from '../../core/utils.js';

// FSRS v4.5 Simplified Constants
export const FSRS_W = [0.4, 0.9, 2.3, 10.9, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.26, 2.05];

export function calculateRetrievability(stability, lastReviewDate) {
    if (!lastReviewDate || !stability) return 0;
    const elapsedDays = (new Date() - new Date(lastReviewDate)) / (1000 * 60 * 60 * 24);
    return Math.pow(0.9, elapsedDays / stability);
}

export function prepareTest(count) {
    const rawQuestions = [];
    AppState.sources.forEach(s => {
        if (s.active) rawQuestions.push(...s.questions);
    });

    if (rawQuestions.length === 0) return null;

    clearActiveTest();

    // FSRS Selection logic: Prioritize Overdue (R <= 0.9), then use Smart Selection
    let qs = rawQuestions.map((q, idx) => {
        const stat = AppState.stats[q.id] || { coeff: 1.5, learned: false };
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

    // Take as many overdue as possible, up to the count
    selectedObjects.push(...overduePool.slice(0, actualCount));

    // If we need more questions, take from remaining pool
    if (selectedObjects.length < actualCount) {
        const remainingNeeded = actualCount - selectedObjects.length;
        // Apply existing distribution logic to the remaining pool
        const pool = remainingPool.length > 0 ? remainingPool : qs.filter(item => !selectedObjects.includes(item));
        
        if (pool.length <= remainingNeeded) {
            selectedObjects.push(...pool);
        } else {
            // Smart Distribution for the rest: 60% hard, 30% med, 10% easy
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

    AppState.rawQuestions = rawQuestions; // Sync current active pool
    AppState.currentTest = selectedObjects.map(o => o.idx);
    AppState.currentIndex = 0;
    AppState.userAnswers = {};
    AppState.isAnswerChecked = {};
    AppState.shuffledOptionsMap = {};
    AppState.hasReachedEnd = false;

    AppState.currentTest.forEach(idx => {
        const q = rawQuestions[idx];
        if (q.options) AppState.shuffledOptionsMap[q.id] = shuffleArray([...q.options]);
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

    AppState.testTracking = {
        startTime: new Date().toISOString(),
        endTime: null,
        sourceNames: names,
        questionCount: count,
        results: [] // Will store { questionId, isCorrect, userAnswer }
    };
}

export function prepareRetake(historyEntry, onlyIncorrect = false) {
    if (!historyEntry || !Array.isArray(historyEntry.questions)) return null;

    let retakeQuestions = historyEntry.questions;
    if (onlyIncorrect) {
        retakeQuestions = retakeQuestions.filter(q => !q.isCorrect);
    }

    if (retakeQuestions.length === 0) return null;

    // Use rawQuestions but filter and shuffle based on retake selection
    // We need to find the correct index in rawQuestions for each retake item
    const rawQuestions = AppState.rawQuestions.length > 0 ? AppState.rawQuestions : [];

    // Fallback: If rawQuestions is empty, we must ensure it's populated from active sources
    if (rawQuestions.length === 0) {
        AppState.sources.forEach(s => {
            if (s.active) rawQuestions.push(...s.questions);
        });
        AppState.rawQuestions = rawQuestions;
    }

    const selectedIndices = [];
    retakeQuestions.forEach(rq => {
        const idx = rawQuestions.findIndex(q => String(q.id) === String(rq.id));
        if (idx !== -1) selectedIndices.push(idx);
    });

    if (selectedIndices.length === 0) return null;

    // Shuffle the order of questions for the retake
    const shuffledIndices = shuffleArray([...selectedIndices]);

    AppState.currentTest = shuffledIndices;
    AppState.currentIndex = 0;
    AppState.userAnswers = {};
    AppState.isAnswerChecked = {};
    AppState.shuffledOptionsMap = {};
    AppState.hasReachedEnd = false;

    shuffledIndices.forEach(idx => {
        const q = rawQuestions[idx];
        if (q.options) AppState.shuffledOptionsMap[q.id] = shuffleArray([...q.options]);
    });

    // Randomize TTS Voice (A-G)
    const voices = ["A", "B", "C", "D", "E", "F", "G"];
    AppState.currentTtsVoice = voices[Math.floor(Math.random() * voices.length)];

    // Tracking metadata
    AppState.testTracking = {
        startTime: new Date().toISOString(),
        endTime: null,
        sourceNames: historyEntry.sourceNames,
        questionCount: shuffledIndices.length,
        retakeOfId: historyEntry.id, // Reference to original
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

        // Safety check: ensure rawQuestions is populated from active sources if somehow lost
        if (!AppState.rawQuestions || AppState.rawQuestions.length === 0) {
            console.log("finishTest: Reconstructing rawQuestions from active sources...");
            AppState.rawQuestions = [];
            AppState.sources.forEach(s => {
                if (s.active && s.questions) AppState.rawQuestions.push(...s.questions);
            });
        }

        const currentTest = AppState.currentTest || [];
        if (currentTest.length === 0) {
            console.warn("finishTest: currentTest is empty.");
        }

        const sessionQuestions = currentTest.map(idx => {
            const q = AppState.rawQuestions[idx];
            if (!q) {
                console.error(`finishTest: Question at index ${idx} not found in rawQuestions`);
                return null;
            }

            const result = AppState.testTracking.results.find(r => String(r.questionId) === String(q.id));

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
            startTime: AppState.testTracking.startTime,
            endTime: AppState.testTracking.endTime,
            questionCount: total,
            correctCount,
            wrongCount,
            unansweredCount,
            successRate: total > 0 ? Math.round((correctCount / total) * 100) : 0,
            avgCoeff: total > 0 ? sessionQuestions.reduce((acc, q) => acc + (AppState.stats[q.id]?.coeff || 1.5), 0) / total : 2.0,
            questions: sessionQuestions
        };

        // If no questions were answered at all, don't save to history
        if (correctCount === 0 && wrongCount === 0) {
            console.log("finishTest: No questions answered, skipping history save.");
            return null;
        }

        if (!Array.isArray(AppState.recentTests)) AppState.recentTests = [];
        AppState.recentTests.unshift(historyEntry);
        if (AppState.recentTests.length > 15) {
            AppState.recentTests = AppState.recentTests.slice(0, 15);
        }

        saveRecentTests();

        // Dispatch event AFTER state is updated and historyEntry is added
        window.dispatchEvent(new CustomEvent('test-finished', { detail: historyEntry }));

    } catch (err) {
        console.error("Critical error in finishTest:", err);
    } finally {
        AppState.testTracking = null;
        clearActiveTest();
    }
}

export function evaluateAnswer(questionIndex, userAnswer) {
    const q = AppState.rawQuestions[AppState.currentTest[questionIndex]];
    let isCorrect = false;

    if (q.type === 'text' || q.type === 'text_input' || q.type === 'open_ended' || q.type === 'fill_in_the_blank') {
        const val = (userAnswer[0] || '').toString().trim().toLowerCase();
        const correctAnswers = getCorrectAnswers(q);
        isCorrect = correctAnswers.some(c => String(c).trim().toLowerCase() === val);
    } else {
        const sel = userAnswer || [];
        const correctIds = getCorrectAnswers(q);
        const cSet = new Set(correctIds.map(String));
        const sSet = new Set(sel.map(String));
        isCorrect = cSet.size === sSet.size && [...sSet].every(id => cSet.has(id));
    }

    return isCorrect;
}

export function updateStats(questionId, isCorrect, userAnswer, feedback = undefined) {
    if (!AppState.stats[questionId]) {
        AppState.stats[questionId] = { 
            coeff: 1.5, 
            correct: 0, 
            wrong: 0, 
            starred: false, 
            flagged: false, 
            streak: 0,
            stability: 0,
            difficulty: 0, // Will be initialized on first answer
            lastReview: null
        };
    }
    const stat = AppState.stats[questionId];
    if (stat.streak === undefined) stat.streak = 0;

    let existingResult = null;
    if (AppState.testTracking) {
        existingResult = AppState.testTracking.results.find(r => String(r.questionId) === String(questionId));
    }

    // FSRS Rating Mapping
    // 1: Again (Wrong), 2: Hard (Correct + Hard), 3: Good (Correct), 4: Easy (Correct + Easy)
    let rating = isCorrect ? 3 : 1;
    if (feedback === 'easy') rating = 4;
    if (feedback === 'hard') rating = 2;

    const now = new Date().toISOString();

    // FSRS Logic Implementation
    if (!stat.lastReview || !stat.stability || isNaN(stat.stability)) {
        // First review or recovery from corrupt/legacy data
        stat.stability = FSRS_W[rating - 1];
        stat.difficulty = Math.min(Math.max(FSRS_W[4] - FSRS_W[5] * (rating - 3), 1), 10);
    } else {
        const elapsedDays = (new Date() - new Date(stat.lastReview)) / (1000 * 60 * 60 * 24);
        const retrievability = calculateRetrievability(stat.stability, stat.lastReview);

        // Update Difficulty
        stat.difficulty = Math.min(Math.max(stat.difficulty - FSRS_W[6] * (rating - 3), 1), 10);

        // Update Stability
        if (rating === 1) {
            // Again: S_new = w[7] * exp(w[8] * (rate-1)??) -> simplified: S_new = S * factor
            stat.stability = Math.max(stat.stability * 0.2, 0.1);
        } else {
            // Correct answer
            const hardFactor = rating === 2 ? FSRS_W[15] : 1;
            const easyFactor = rating === 4 ? FSRS_W[16] : 1;
            
            // FSRS Stability boost formula (simplified)
            // S = S * (1 + exp(w[8]) * (11 - D) * S^-w[9] * (exp(w[10] * (1 - R)) - 1))
            const factor = 1 + Math.exp(FSRS_W[8]) * (11 - stat.difficulty) * Math.pow(stat.stability, -FSRS_W[9]) * 
                           (Math.exp(FSRS_W[10] * (1 - retrievability)) - 1);
            
            stat.stability = stat.stability * factor * hardFactor * easyFactor;
        }
    }

    stat.lastReview = now;

    // Legacy Coeff update for UI continuity
    // Map Difficulty 1-10 to Coeff 0.1-3.0
    // Difficulty 5 (Neutral) -> Coeff 1.5
    // Difficulty 1 (Easy) -> Coeff 0.1
    // Difficulty 10 (Hard) -> Coeff 3.0
    stat.coeff = 0.1 + (stat.difficulty - 1) * (2.9 / 9);

    if (feedback !== undefined) {
        // Direct feedback update
        if (feedback === 'hard') stat.learned = false;
        if (existingResult) {
            existingResult.feedback = feedback;
        }
    } else {
        // Initial session update
        if (isCorrect) {
            if (stat.streak < 0) stat.streak = 1; else stat.streak++;
            stat.correct++;
        } else {
            if (stat.streak > 0) stat.streak = -1; else stat.streak--;
            stat.wrong++;
            stat.learned = false;
        }

        // Streak-based "Learned" status
        if (stat.streak >= 5 || (stat.stability > 30)) {
            stat.learned = true;
        }

        if (AppState.testTracking && !existingResult) {
            AppState.testTracking.results.push({
                questionId,
                isCorrect,
                userAnswer,
                streak: stat.streak
            });
        }
    }
    saveActiveTest();
    saveStats();
}
