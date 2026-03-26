import { AppState } from '../../core/state.js';

let timerTimeout = null;
let lastTickTime = 0;

export function initTimer() {
    stopTimer();
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

    lastTickTime = Date.now();
    scheduleNextTick(textElement);
}

export function stopTimer() {
    if (timerTimeout) {
        clearTimeout(timerTimeout);
        timerTimeout = null;
    }
}

function scheduleNextTick(textElement) {
    if (!AppState.testTracking) return;

    const qIndex = AppState.currentIndex;
    const isCountdown = AppState.timerCountdownEnabled;
    const rem = isCountdown ? (AppState.testTracking.questionTimeRemaining[qIndex] || 0) : 11; // Dummy high value for non-countdown
    const isStopwatch = AppState.timerStopwatchEnabled;
    const elapsed = isStopwatch ? (AppState.testTracking.elapsedSeconds || 0) : 11;
    // Determine interval: 50ms if below 10s, otherwise 1000ms
    const isHighFreq = (isCountdown && rem <= 10 && rem > 0);
    const interval = isHighFreq ? 50 : 1000;

    timerTimeout = setTimeout(() => {
        const now = Date.now();
        const delta = (now - lastTickTime) / 1000;
        lastTickTime = now;
        
        tickTimer(textElement, delta);
        
        // If the timer was not stopped in tickTimer (reached zero), schedule next
        if (timerTimeout) {
            scheduleNextTick(textElement);
        }
    }, interval);
}

export function resetTimerForNewQuestion() {
    const qIndex = AppState.currentIndex;
    if (AppState.timerCountdownEnabled) {
        if (AppState.testTracking && AppState.testTracking.questionTimeRemaining) {
            // If we revisit a question, don't reset unless it's not set yet
            if (AppState.testTracking.questionTimeRemaining[qIndex] === undefined) {
                AppState.testTracking.questionTimeRemaining[qIndex] = AppState.timerCountdownLimit || 59;
            }
        }
    }
    
    // Update display immediately so there's no lag
    const textElement = document.getElementById('timerText');
    lastTickTime = Date.now(); // Reset baseline
    tickTimer(textElement, 0); // Re-render with 0 delta
    
    // Ensure the loop is running (restarts if it was stopped)
    if (!timerTimeout && AppState.testTracking && (AppState.timerCountdownEnabled || AppState.timerStopwatchEnabled)) {
        scheduleNextTick(textElement);
    }
}

function tickTimer(textElement, delta) {
    if (!AppState.testTracking) return;

    let displayStr = '';
    const qIndex = AppState.currentIndex;
    const isChecked = AppState.isAnswerChecked[qIndex];

    if (AppState.timerStopwatchEnabled) {
        // Stopwatch runs continuously regardless of whether the question is checked
        AppState.testTracking.elapsedSeconds += delta;
        const totalSecs = AppState.testTracking.elapsedSeconds || 0;
        displayStr = formatTimeDisplay(totalSecs, false);

        if (textElement) textElement.style.color = 'var(--text-secondary)';
    } else if (AppState.timerCountdownEnabled) {
        if (AppState.testTracking.questionTimeRemaining[qIndex] === undefined) {
            AppState.testTracking.questionTimeRemaining[qIndex] = AppState.timerCountdownLimit || 59;
        }

        if (!isChecked) {
            if (AppState.testTracking.questionTimeRemaining[qIndex] > 0) {
                AppState.testTracking.questionTimeRemaining[qIndex] -= delta;
                // Safety: Clamp to zero
                if (AppState.testTracking.questionTimeRemaining[qIndex] < 0) {
                    AppState.testTracking.questionTimeRemaining[qIndex] = 0;
                }
            }
            
            if (AppState.testTracking.questionTimeRemaining[qIndex] === 0) {
                // Timer reached zero: stop the interval and handle auto-check
                stopTimer();
                if (AppState.timerAutoCheckEnabled && !AppState.isAnswerChecked[qIndex]) {
                    if (window.handleCheckAnswer) {
                        window.handleCheckAnswer(true);
                    } else {
                        import('./test-ui.js').then(m => m.handleCheckAnswer(true));
                    }
                }
            }
        }

        const rem = AppState.testTracking.questionTimeRemaining[qIndex] || 0;
        displayStr = formatTimeDisplay(rem, rem <= 10); // Show ms only when <= 10s

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

function formatTimeDisplay(seconds, showMs) {
    const totalMs = Math.max(0, Math.round(seconds * 1000));
    const m = Math.floor(totalMs / 60000);
    const s = Math.floor((totalMs % 60000) / 1000);
    const ms = Math.floor((totalMs % 1000) / 10); // Show 2 digits (centiseconds)
    
    const mStr = m.toString().padStart(2, '0');
    const sStr = s.toString().padStart(2, '0');
    const msStr = ms.toString().padStart(2, '0');
    
    if (showMs) {
        return `${mStr}:${sStr}:${msStr}`;
    } else {
        return `${mStr}:${sStr}`;
    }
}
