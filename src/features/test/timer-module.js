import { AppState } from '../../core/state.js';

let timerInterval = null;

export function initTimer() {
    if (timerInterval) clearInterval(timerInterval);
    const displayElement = document.getElementById('timerDisplay');
    const textElement = document.getElementById('timerText');

    if (!AppState.timerStopwatchEnabled && !AppState.timerCountdownEnabled) {
        if (displayElement) displayElement.style.display = 'none';
        return;
    }

    if (displayElement) displayElement.style.display = 'flex';

    // Initialize properties if they don't exist
    if (AppState.testTracking) {
        if (AppState.testTracking.elapsedSeconds === undefined) AppState.testTracking.elapsedSeconds = 0;
        if (!AppState.testTracking.questionTimeRemaining) AppState.testTracking.questionTimeRemaining = {};
    }

    timerInterval = setInterval(() => {
        tickTimer(textElement);
    }, 1000);
}

export function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

export function resetTimerForNewQuestion() {
    if (!AppState.timerCountdownEnabled) return;
    const qIndex = AppState.currentIndex;
    if (AppState.testTracking && AppState.testTracking.questionTimeRemaining) {
        // If we revisit a question, don't reset unless it's not set yet
        if (AppState.testTracking.questionTimeRemaining[qIndex] === undefined) {
            AppState.testTracking.questionTimeRemaining[qIndex] = AppState.timerCountdownLimit || 59;
        }
    }
    // Update display immediately so there's no 1-sec lag
    const textElement = document.getElementById('timerText');
    tickTimer(textElement, true);
}

function tickTimer(textElement, skipIncrement = false) {
    if (!AppState.testTracking) return;

    let displayStr = '';
    const qIndex = AppState.currentIndex;

    // Check if the current question is already answered. If so, pause countdown.
    const isChecked = AppState.isAnswerChecked[qIndex];

    if (AppState.timerStopwatchEnabled) {
        if (!skipIncrement && !isChecked) {
            AppState.testTracking.elapsedSeconds++;
        }
        const totalSecs = AppState.testTracking.elapsedSeconds || 0;
        const m = Math.floor(totalSecs / 60).toString().padStart(2, '0');
        const s = (totalSecs % 60).toString().padStart(2, '0');
        displayStr = `${m}:${s}`;

        if (textElement) textElement.style.color = 'var(--text-secondary)'; // default color
    } else if (AppState.timerCountdownEnabled) {
        // Countdown mode
        if (AppState.testTracking.questionTimeRemaining[qIndex] === undefined) {
            AppState.testTracking.questionTimeRemaining[qIndex] = AppState.timerCountdownLimit || 59;
        }

        if (!skipIncrement && !isChecked) {
            if (AppState.testTracking.questionTimeRemaining[qIndex] > 0) {
                AppState.testTracking.questionTimeRemaining[qIndex]--;
            } else if (AppState.testTracking.questionTimeRemaining[qIndex] === 0) {
                if (AppState.timerAutoCheckEnabled) {
                    if (!AppState.isAnswerChecked[qIndex]) {
                        if (window.handleCheckAnswer) {
                            window.handleCheckAnswer(true);
                        } else {
                            // Fallback if not attached yet
                            import('./test-ui.js').then(m => m.handleCheckAnswer(true));
                        }
                    }
                }
            }
        }

        const rem = AppState.testTracking.questionTimeRemaining[qIndex] || 0;
        displayStr = rem.toString() + 's';

        if (textElement) {
            if (rem <= 10 && !isChecked) {
                textElement.style.color = 'var(--error-color)';
            } else {
                textElement.style.color = 'var(--text-secondary)';
            }
        }
    }

    if (textElement && displayStr) {
        textElement.innerText = displayStr;
    }
}
