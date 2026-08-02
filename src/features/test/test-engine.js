import { AppState, saveStats, saveRecentTests, saveActiveTest, clearActiveTest, saveSources, clearPresetSessionData, findMatchingPresetId } from '../../core/state.js';
import { shuffleArray, getCorrectAnswers } from '../../core/utils.js';
import { getQuestionCategory } from '../../core/question-rules.js';
import { gradeCloze } from '../../core/cloze.js';
import { getDailyOverdueSnapshot, applyFocusPools, recordTestFinished, commitOneAnswerToActivity } from '../stats/continuity-engine.js';

// FSRS v4.5 Simplified Constants
export const FSRS_W = [0.4, 0.9, 2.3, 10.9, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.26, 2.05];

export function calculateRetrievability(stability, lastReviewDate) {
    if (!lastReviewDate || !stability) return 0;
    const elapsedDays = (new Date() - new Date(lastReviewDate)) / (1000 * 60 * 60 * 24);
    return Math.pow(0.9, elapsedDays / stability);
}

/**
 * Builds the selection pool and the composite-id lookup table.
 * Always call this before starting or resuming a test to ensure lookups are stable.
 *
 * The two serve different jobs and deliberately have different widths:
 *
 * - `rawQuestions` is what a test is drawn FROM, so it honours `scope`:
 *   'active' keeps the manual test flow unchanged, 'all' backs the streak run,
 *   which is source-independent by design.
 * - `questionMap` is only ever read as `questionMap[compositeId]`, so it always
 *   covers every live source. Keeping it narrow bought nothing and broke resume:
 *   a streak test spanning a currently inactive source came back from
 *   "Devam Et" with unresolvable ids.
 *
 * Archived sources are in neither: their questions are offloaded and their FSRS
 * clock is frozen (see thawStatsOnRestore in archive.js).
 */
export function buildQuestionPool(options = {}) {
    const { scope = 'active' } = options;

    const rawQuestions = [];
    const questionMap = {};

    AppState.sources.forEach(s => {
        if (s.archived || !s.questions) return;
        const inScope = scope === 'all' || s.active;
        s.questions.forEach(q => {
            const entry = { ...q, sourceId: s.id };
            questionMap[`${s.id}_${q.id}`] = entry;
            if (inScope) rawQuestions.push(entry);
        });
    });

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
        // FSRS v4.5: D' = D - w6*(r-3), ardından mean reversion: D_new = w7*D0(4) + (1-w7)*D'
        const d0_easy = Math.min(Math.max(FSRS_W[4] - FSRS_W[5] * 1, 1), 10); // D0(rating=4)
        const dPrime = stat.difficulty - FSRS_W[6] * (rating - 3);
        stat.difficulty = Math.min(Math.max(FSRS_W[7] * d0_easy + (1 - FSRS_W[7]) * dPrime, 1), 10);
        if (rating === 1) {
            // FSRS v4.5: S'_f = w11 * D^(-w12) * ((S+1)^w13 - 1) * e^(w14*(1-R))
            const sf = FSRS_W[11]
                * Math.pow(stat.difficulty, -FSRS_W[12])
                * (Math.pow(stat.stability + 1, FSRS_W[13]) - 1)
                * Math.exp(FSRS_W[14] * (1 - retrievability));
            stat.stability = Math.max(sf, 0.1);
        } else {
            const hardFactor = rating === 2 ? FSRS_W[15] : 1;
            const easyFactor = rating === 4 ? FSRS_W[16] : 1;
            // FSRS v4.5: S'_r = S * (1 + core * hardFactor * easyFactor)
            // Cezalar/bonuslar sadece büyümeyi etkiler, temel stability'yi değil
            const core = Math.exp(FSRS_W[8]) * (11 - stat.difficulty) *
                Math.pow(stat.stability, -FSRS_W[9]) *
                (Math.exp(FSRS_W[10] * (1 - retrievability)) - 1);
            stat.stability = stat.stability * (1 + core * hardFactor * easyFactor);
        }
    }
    stat.lastReview = new Date().toISOString();
    stat.coeff = stat.difficulty / 2;
}

export function prepareTest(count) {
    const rawQuestions = buildQuestionPool();
    if (rawQuestions.length === 0) return null;

    const matchedPresetId = findMatchingPresetId();
    if (matchedPresetId) {
        clearPresetSessionData(matchedPresetId);
    }
    clearActiveTest();
    
    // Ensure daily overdue snapshot is taken before starting the test
    getDailyOverdueSnapshot(rawQuestions);

    // FSRS Selection logic: Prioritize Overdue (R <= 0.9), then use Smart Selection
    let qs = rawQuestions.map((q, idx) => {
        const key = `${q.sourceId}_${q.id}`;
        const stat = AppState.stats[key] || { difficulty: 5.0, learned: false };
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

    // Apply Focus Pools (Silent Fallback)
    selectedObjects = applyFocusPools(selectedObjects, nonLearned);

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

/**
 * Names the sources a session actually drew from, derived from the questions
 * themselves rather than from whatever happens to be switched on. A streak run
 * spans the whole library, so the active-source list says nothing about it - and
 * even a normal test should not name a source it took no question from.
 */
function deriveSourceLabels(compositeIds) {
    const seen = [];
    compositeIds.forEach(cid => {
        const sourceId = AppState.questionMap[cid]?.sourceId;
        if (sourceId && !seen.includes(sourceId)) seen.push(sourceId);
    });

    const names = seen.map(id => {
        const source = AppState.sources.find(s => s.id === id);
        return source?.name || id;
    });

    if (names.length === 0) return { names: [], sourceTitle: 'Unknown Source' };
    if (names.length === 1) return { names, sourceTitle: names[0] };
    // A run touching a dozen sources would otherwise produce an unreadable
    // history row, so only the leading few are spelled out.
    const sourceTitle = names.length <= 3
        ? names.join(' + ')
        : `${names.slice(0, 3).join(' + ')} +${names.length - 3}`;
    return { names, sourceTitle };
}

function startTestTracking(count) {
    const { names, sourceTitle } = deriveSourceLabels(AppState.currentTest || []);

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

/**
 * Installs an explicit, already-ordered list of questions as the current test.
 * Shared by the retake flow and the streak run: both know exactly which
 * questions they want, and differ only in whether the order may be disturbed.
 *
 * `mode` travels with the tracking record into the saved session, which is how
 * the resume path knows to rebuild the wide question map and how saveActiveTest
 * knows to keep a streak run out of the preset sessions.
 */
export function prepareFromCompositeIds(compositeIds, options = {}) {
    const { shuffle = true, mode = null, retakeOfId = null, sourceNames, sourceTitle } = options;

    const known = (compositeIds || []).filter(cid => AppState.questionMap[cid]);
    if (known.length === 0) return null;

    const ordered = shuffle ? shuffleArray(known) : known;

    AppState.currentTest = ordered;
    AppState.currentIndex = 0;
    AppState.userAnswers = {};
    AppState.isAnswerChecked = {};
    AppState.shuffledOptionsMap = {};
    AppState.hasReachedEnd = false;

    ordered.forEach(cid => {
        const q = AppState.questionMap[cid];
        if (q?.options) AppState.shuffledOptionsMap[q.id] = shuffleArray([...q.options]);
    });

    const voices = ["A", "B", "C", "D", "E", "F", "G"];
    AppState.currentTtsVoice = voices[Math.floor(Math.random() * voices.length)];

    const derived = deriveSourceLabels(ordered);
    AppState.testTracking = {
        startTime: new Date().toISOString(),
        endTime: null,
        sourceNames: sourceNames || derived.names,
        sourceTitle: sourceTitle || derived.sourceTitle,
        questionCount: ordered.length,
        elapsedSeconds: 0,
        questionTimeRemaining: {},
        results: []
    };
    if (mode) AppState.testTracking.mode = mode;
    if (retakeOfId) AppState.testTracking.retakeOfId = retakeOfId;

    return AppState.currentTest;
}

export function prepareRetake(historyEntry, onlyIncorrect = false) {
    if (!historyEntry || !Array.isArray(historyEntry.questions)) return null;

    let retakeQuestions = historyEntry.questions;
    if (onlyIncorrect) {
        retakeQuestions = retakeQuestions.filter(q => !q.isCorrect);
    }
    if (retakeQuestions.length === 0) return null;

    buildQuestionPool();

    return prepareFromCompositeIds(
        retakeQuestions.map(rq => `${rq.sourceId}_${rq.id}`),
        {
            shuffle: true,
            retakeOfId: historyEntry.id,
            sourceNames: historyEntry.sourceNames,
            sourceTitle: historyEntry.sourceTitle
                || (historyEntry.sourceNames?.length > 1
                    ? historyEntry.sourceNames.join(' + ')
                    : historyEntry.sourceNames?.[0])
        }
    );
}


export async function finishTest() {
    if (!AppState.testTracking) {
        console.warn("finishTest: No active testTracking found.");
        return;
    }

    // Read before the finally block nulls the tracking record.
    const isStreakRun = AppState.testTracking.mode === 'streak';

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
                    isUnanswered: false,
                    answeredAt: result.answeredAt || Date.now()
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

        // Record for continuity / streak layer. Pass ONLY evaluated/answered questions
        // so that unanswered questions in the test run do not count as solved.
        const answeredQuestions = sessionQuestions.filter(q => !q.isUnanswered);
        const answeredCount = answeredQuestions.length;
        const answeredWrongCount = Math.max(0, answeredCount - correctCount);

        if (answeredCount === 0 && (AppState.testTracking?._flushedCount || 0) === 0) {
            console.log("finishTest: Discarding empty test session with 0 answered questions.");
            return;
        }

        if (answeredCount > 0 || (AppState.testTracking?._flushedCount || 0) > 0) {
            recordTestFinished(answeredCount, correctCount, answeredWrongCount, 0, answeredQuestions);
        }

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
        // A streak run was never filed under a preset, so it must not clear one
        // either - the user's saved preset session has to survive it.
        if (!isStreakRun) {
            const matchedPresetId = findMatchingPresetId();
            if (matchedPresetId) {
                clearPresetSessionData(matchedPresetId);
            }
        }
        clearActiveTest();
    }
}

export function evaluateAnswer(questionIndex, userAnswer) {
    const q = AppState.questionMap[AppState.currentTest[questionIndex]];
    let isCorrect = false;

    const category = getQuestionCategory(q.type);
    const isCaseSensitive = q.answer?.caseSensitive || q.caseSensitive || false;

    if (category === 'cloze') {
        // Every blank must be right; the expected values live in the sentence.
        return gradeCloze(q.content?.text || q.text || '', userAnswer || [], isCaseSensitive);
    }

    if (category === 'text') {
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

export function updateFlashcardStats(sourceId, questionId, rating) {
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
    const stat = AppState.stats[key];
    const q = AppState.questionMap?.[key];

    // Snapshot for toggle logic
    let existingResult = AppState.testTracking?.results?.find(r =>
        String(r.questionId) === String(questionId) && String(r.sourceId || sourceId) === String(sourceId)
    );
    if (existingResult && existingResult._preSessionState) {
        Object.keys(existingResult._preSessionState).forEach(prop => {
            stat[prop] = JSON.parse(JSON.stringify(existingResult._preSessionState[prop]));
        });
        existingResult.answeredAt = Date.now();
    } else if (!existingResult) {
        const snapshot = JSON.parse(JSON.stringify(stat));
        existingResult = { questionId, sourceId, answeredAt: Date.now(), isCorrect: rating >= 3, userAnswer: [String(rating)], _preSessionState: snapshot };
        if (AppState.testTracking) AppState.testTracking.results.push(existingResult);
    }

    applyFSRS(stat, rating, q?.difficulty);

    // Streak and learned
    if (rating >= 3) {
        if (stat.streak < 0) stat.streak = 1; else stat.streak++;
        stat.correct++;
    } else {
        if (stat.streak > 0) stat.streak = -1; else stat.streak--;
        stat.wrong++;
        stat.learned = false;
    }
    if (stat.streak >= 5 || stat.stability > 30) stat.learned = true;

    if (existingResult) {
        existingResult.isCorrect = rating >= 3;
        existingResult.userAnswer = [String(rating)];
        existingResult.streak = stat.streak;
    }

    saveActiveTest();
    saveStats();

    // Broadcast this answer to the activity counters so the heatmap and
    // trend charts update in real-time via the store's Slice.ACTIVITY emit.
    commitOneAnswerToActivity(rating >= 3);
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
        existingResult = AppState.testTracking.results.find(r =>
            String(r.questionId) === String(questionId) && String(r.sourceId || sourceId) === String(sourceId)
        );
    }

    // Toggle Logic: restore to pre-session state before re-applying
    if (existingResult && existingResult._preSessionState) {
        Object.keys(existingResult._preSessionState).forEach(prop => {
            stat[prop] = JSON.parse(JSON.stringify(existingResult._preSessionState[prop]));
        });
        existingResult.answeredAt = Date.now();
    } else if (AppState.testTracking && !existingResult) {
        // First answer in this session: snapshot current state
        const snapshot = JSON.parse(JSON.stringify(stat));
        existingResult = {
            questionId,
            sourceId,
            answeredAt: Date.now(),
            isCorrect,
            userAnswer,
            streak: stat.streak,
            _preSessionState: snapshot
        };
        AppState.testTracking.results.push(existingResult);
    }

    // FSRS Rating: 1=Again, 2=Hard, 3=Good, 4=Easy
    // Doğru cevap: feedback rating'i kaydırır (3→2 veya 3→4)
    // Yanlış cevap: her zaman rating=1 (Again), feedback sonradan ek düzeltme olarak uygulanır
    let rating = isCorrect ? 3 : 1;
    if (isCorrect) {
        if (feedback === 'hard') rating = 2;
        if (feedback === 'easy') rating = 4;
    }

    // Apply FSRS algorithm
    const q = AppState.questionMap?.[key];
    applyFSRS(stat, rating, q?.difficulty);

    // Yanlış + feedback: rating=1 sonucuna ek düzeltme uygula
    // Hard: stability daha da kıs (W[15]=0.26), difficulty biraz daha artır
    // Easy: stability biraz geri ver (W[16]=2.05), difficulty artışını azalt
    if (!isCorrect && feedback === 'hard') {
        stat.stability = Math.max(stat.stability * FSRS_W[15], 0.1);
        stat.difficulty = Math.min(stat.difficulty + FSRS_W[6], 10);
        stat.coeff = stat.difficulty / 2;
    } else if (!isCorrect && feedback === 'easy') {
        stat.stability = stat.stability * FSRS_W[16];
        stat.difficulty = Math.max(stat.difficulty - FSRS_W[6], 1);
        stat.coeff = stat.difficulty / 2;
    }

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
        } else {
            // Seçim kaldırıldı: feedback temizle, aksi halde soru tekrar ziyaret edildiğinde
            // buton yanlışlıkla aktif görünür
            delete existingResult.feedback;
        }
    }

    saveActiveTest();
    saveStats();

    // Broadcast this answer to the activity counters so the heatmap and
    // trend charts update in real-time via the store's Slice.ACTIVITY emit.
    commitOneAnswerToActivity(isCorrect);
}
