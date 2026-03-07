import { AppState, saveRecentTests } from '../../core/state.js';
import { shuffleArray, getCorrectAnswers } from '../../core/utils.js';

export function prepareTest(count) {
    const rawQuestions = [];
    AppState.sources.forEach(s => {
        if (s.active) rawQuestions.push(...s.questions);
    });

    if (rawQuestions.length === 0) return null;

    // Smart Selection logic: 60% hard, 30% medium, 10% easy
    // Based on coefficient (higher = harder)
    const qs = rawQuestions.map((q, idx) => {
        const stat = AppState.stats[q.id] || { coeff: 1.0 };
        return { idx, q, coeff: stat.coeff };
    }).sort((a, b) => b.coeff - a.coeff);

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
            avgCoeff: total > 0 ? sessionQuestions.reduce((acc, q) => acc + (AppState.stats[q.id]?.coeff || 1.0), 0) / total : 1.0,
            questions: sessionQuestions
        };

        if (!Array.isArray(AppState.recentTests)) AppState.recentTests = [];
        AppState.recentTests.unshift(historyEntry);
        if (AppState.recentTests.length > 5) {
            AppState.recentTests = AppState.recentTests.slice(0, 5);
        }

        saveRecentTests();

        // Dispatch event AFTER state is updated and historyEntry is added
        window.dispatchEvent(new CustomEvent('test-finished', { detail: historyEntry }));

    } catch (err) {
        console.error("Critical error in finishTest:", err);
    } finally {
        AppState.testTracking = null;
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

export function updateStats(questionId, isCorrect, userAnswer, feedback = null) {
    if (!AppState.stats[questionId]) {
        AppState.stats[questionId] = { coeff: 1.0, correct: 0, wrong: 0 };
    }
    const stat = AppState.stats[questionId];

    let existingResult = null;
    if (AppState.testTracking) {
        existingResult = AppState.testTracking.results.find(r => String(r.questionId) === String(questionId));
    }

    if (feedback) {
        // Feedback logic:
        // Correct + Easy:   -0.3
        // Correct + Hard:   -0.1  
        // Wrong + Easy:  +0.2
        // Wrong + Hard:    +0.5
        let newDelta = 0;
        if (isCorrect) {
            newDelta = (feedback === 'easy') ? -0.3 : -0.1;
        } else {
            newDelta = (feedback === 'easy') ? 0.2 : 0.5;
        }

        // Revert previous delta if exists to avoid double-counting
        const oldDelta = (existingResult && existingResult.appliedDelta !== undefined) ? existingResult.appliedDelta : 0;
        stat.coeff = stat.coeff - oldDelta + newDelta;

        // Clamp
        stat.coeff = Math.max(0.1, Math.min(5.0, stat.coeff));

        // Update tracking
        if (existingResult) {
            existingResult.appliedDelta = newDelta;
            existingResult.feedback = feedback;
        }
    } else {
        // Initial update (default logic)
        const delta = isCorrect ? -0.2 : 0.4;
        stat.coeff = isCorrect ? Math.max(0.1, stat.coeff + delta) : Math.min(5.0, stat.coeff + delta);

        if (isCorrect) stat.correct++; else stat.wrong++;

        // Update current test tracking
        if (AppState.testTracking) {
            if (!existingResult) {
                AppState.testTracking.results.push({
                    questionId,
                    isCorrect,
                    userAnswer,
                    appliedDelta: delta
                });
            } else {
                // Update existing
                existingResult.isCorrect = isCorrect;
                existingResult.userAnswer = userAnswer;
                existingResult.appliedDelta = delta;
            }
        }
    }
}
