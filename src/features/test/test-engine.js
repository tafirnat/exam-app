import { AppState, saveRecentTests, saveActiveTest, clearActiveTest } from '../../core/state.js';
import { shuffleArray, getCorrectAnswers } from '../../core/utils.js';

export function prepareTest(count) {
    const rawQuestions = [];
    AppState.sources.forEach(s => {
        if (s.active) rawQuestions.push(...s.questions);
    });

    if (rawQuestions.length === 0) return null;

    clearActiveTest();

    // Smart Selection logic: 60% hard, 30% medium, 10% easy
    // Based on coefficient (higher = harder)
    // Filter out learned questions
    let qs = rawQuestions.map((q, idx) => {
        const stat = AppState.stats[q.id] || { coeff: 1.5, learned: false };
        return { idx, q, coeff: stat.coeff, learned: !!stat.learned };
    });

    const nonLearned = qs.filter(item => !item.learned);
    if (nonLearned.length > 0) {
        qs = nonLearned.sort((a, b) => b.coeff - a.coeff);
    } else {
        // Fallback: if all active questions are learned, use all of them for review
        qs = qs.sort((a, b) => b.coeff - a.coeff);
    }

    let selectedObjects = [];
    const actualCount = Math.min(count, qs.length);

    if (qs.length <= count) {
        selectedObjects = shuffleArray(qs);
    } else {
        const p1 = qs.slice(0, Math.ceil(qs.length * 0.4)); // Hardest 40%
        const p2 = qs.slice(p1.length, p1.length + Math.ceil(qs.length * 0.3)); // Middle 30%
        const p3 = qs.slice(p1.length + p2.length); // Easiest 30%

        const take = (pool, n) => {
            const shuffledPool = shuffleArray(pool);
            const actual = Math.min(n, shuffledPool.length);
            selectedObjects.push(...shuffledPool.slice(0, actual));
            return n - actual;
        };

        const n1 = Math.round(actualCount * 0.6);
        const n2 = Math.round(actualCount * 0.3);
        const n3 = actualCount - n1 - n2;

        let rem = take(p1, n1);
        rem = take(p2, n2 + rem);
        take(p3, n3 + rem);
        selectedObjects = shuffleArray(selectedObjects);
    }

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
        AppState.stats[questionId] = { coeff: 1.5, correct: 0, wrong: 0, starred: false, flagged: false, streak: 0 };
    }
    const stat = AppState.stats[questionId];
    if (stat.streak === undefined) stat.streak = 0;

    let existingResult = null;
    if (AppState.testTracking) {
        existingResult = AppState.testTracking.results.find(r => String(r.questionId) === String(questionId));
    }

    if (feedback !== undefined) {
        // Rating update (setting 'hard'/'easy' OR toggling off with null)
        const oldDelta = (existingResult && existingResult.appliedDelta !== undefined) ? existingResult.appliedDelta : 0;

        // Calculate the underlying algorithmic delta again to base our modifiers on it
        const streakFactor = Math.max(1, Math.abs(stat.streak || 1));
        const algorithmicDelta = (isCorrect ? -0.25 : 0.25) * (1 + (streakFactor - 1) * 0.5);

        let newDelta = algorithmicDelta;

        if (feedback === 'easy') {
            // Bias downwards: make it easier (subtracts 0.3 from whatever the delta was)
            newDelta = algorithmicDelta - 0.3;
        } else if (feedback === 'hard') {
            // Bias upwards: make it harder, and unlearn if it was previously learned
            newDelta = algorithmicDelta + 0.3;
            stat.learned = false;
        } else {
            // feedback is null -> toggle off, revert purely to algorithmic delta
            newDelta = algorithmicDelta;
            if (stat.streak < 5) stat.learned = false;
        }

        stat.coeff = stat.coeff - oldDelta + newDelta;
        stat.coeff = Math.max(0.1, Math.min(3.0, stat.coeff));

        if (existingResult) {
            existingResult.appliedDelta = newDelta;
            existingResult.feedback = feedback;
        }
    } else {
        // Initial session update (from handleCheckAnswer)
        // Update Streak
        if (isCorrect) {
            if (stat.streak < 0) stat.streak = 1;
            else stat.streak++;
        } else {
            if (stat.streak > 0) stat.streak = -1;
            else stat.streak--;
        }

        // Adaptive Delta based on streak
        // Every consecutive correct answer increases the reduction by 50% of the base
        // Every consecutive wrong answer increases the penalty by 50% of the base
        const streakFactor = Math.abs(stat.streak);
        const baseDelta = isCorrect ? -0.25 : 0.25;
        const multiplier = 1 + (streakFactor - 1) * 0.5;
        const delta = baseDelta * multiplier;

        stat.coeff = Math.max(0.1, Math.min(3.0, stat.coeff + delta));

        // Mark as learned if streak reaches 5
        if (stat.streak >= 5) {
            stat.learned = true;
            stat.coeff = 0.1; // Ensure it's at minimum
        } else if (!isCorrect) {
            stat.learned = false; // Reset learned if wrong
        }

        // Only increment counters on initial check
        if (!existingResult) {
            if (isCorrect) stat.correct++; else stat.wrong++;
        }

        if (AppState.testTracking) {
            if (!existingResult) {
                AppState.testTracking.results.push({
                    questionId,
                    isCorrect,
                    userAnswer,
                    appliedDelta: delta,
                    streak: stat.streak
                });
            } else {
                existingResult.isCorrect = isCorrect;
                existingResult.userAnswer = userAnswer;
                existingResult.appliedDelta = delta;
                existingResult.streak = stat.streak;
            }
        }
    }
    saveActiveTest();
}
