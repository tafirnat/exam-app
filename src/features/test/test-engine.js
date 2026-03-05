
import { AppState, saveRecentTests } from '../../core/state.js';
import { shuffleArray } from '../../core/utils.js';

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

    AppState.currentTest.forEach(idx => {
        const q = rawQuestions[idx];
        if (q.options) AppState.shuffledOptionsMap[q.id] = shuffleArray([...q.options]);
    });

    startTestTracking(count);

    return AppState.currentTest;
}

function startTestTracking(count) {
    const activeSources = AppState.sources.filter(s => s.active);
    const sourceTitle = activeSources.length === 1 ? activeSources[0].title : activeSources.length + " Sources";

    AppState.testTracking = {
        startTime: new Date().toISOString(),
        endTime: null,
        sourceTitle: sourceTitle,
        questionCount: count,
        results: [] // Will store { questionId, isCorrect, userAnswer }
    };
}

export function finishTest() {
    if (!AppState.testTracking) return;

    AppState.testTracking.endTime = new Date().toISOString();

    // Convert current results into a list of questions for historical view
    const historyEntry = {
        id: Date.now(),
        sourceTitle: AppState.testTracking.sourceTitle,
        startTime: AppState.testTracking.startTime,
        endTime: AppState.testTracking.endTime,
        questionCount: AppState.testTracking.results.length,
        questions: AppState.testTracking.results.map(r => {
            const q = AppState.rawQuestions.find(q => q.id === r.questionId);
            return {
                ...q,
                userAnswer: r.userAnswer,
                isCorrect: r.isCorrect
            };
        })
    };

    // Add to recentTests, keep only last 5
    AppState.recentTests.unshift(historyEntry);
    if (AppState.recentTests.length > 5) {
        AppState.recentTests = AppState.recentTests.slice(0, 5);
    }

    saveRecentTests();
    AppState.testTracking = null;
}

export function evaluateAnswer(questionIndex, userAnswer) {
    const q = AppState.rawQuestions[AppState.currentTest[questionIndex]];
    let isCorrect = false;

    if (q.type === 'text' || q.type === 'text_input' || q.type === 'open_ended' || q.type === 'fill_in_the_blank') {
        const val = (userAnswer[0] || '').toString().trim().toLowerCase();
        const correctAnswers = q.correctOptionIds || q.answer?.accepted_texts || [];
        isCorrect = correctAnswers.some(c => String(c).trim().toLowerCase() === val);
    } else {
        const sel = userAnswer || [];
        const correctIds = q.correctOptionIds || [];
        const cSet = new Set(correctIds.map(String));
        const sSet = new Set(sel.map(String));
        isCorrect = cSet.size === sSet.size && [...sSet].every(id => cSet.has(id));
    }

    return isCorrect;
}

export function updateStats(questionId, isCorrect, userAnswer) {
    if (!AppState.stats[questionId]) {
        AppState.stats[questionId] = { coeff: 1.0, correct: 0, wrong: 0 };
    }
    const stat = AppState.stats[questionId];
    stat.coeff = isCorrect ? Math.max(0.1, stat.coeff - 0.2) : Math.min(5.0, stat.coeff + 0.4);
    if (isCorrect) stat.correct++; else stat.wrong++;

    // Update current test tracking
    if (AppState.testTracking) {
        AppState.testTracking.results.push({
            questionId,
            isCorrect,
            userAnswer
        });
    }
}
