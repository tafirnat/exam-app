import { AppState } from '../../core/state.js';
import { calculateGlobalStreak, getLocalDateStr, getDailyOverdueSnapshot, initTodayActivity } from './continuity-engine.js';
import { getLiveQuestions } from '../../core/question-rules.js';
import { showToast } from '../../core/utils.js';

export function renderContinuityBlock() {
    const card = document.getElementById('continuityCard');
    if (!card) return;
    
    // Only show if user has active sources or some stats
    const liveQ = getLiveQuestions();
    if (!liveQ || liveQ.length === 0) {
        card.style.display = 'none';
        return;
    }
    
    card.style.display = 'block';
    
    // Streak
    const streak = calculateGlobalStreak();
    document.getElementById('continuityStreakCount').textContent = streak;
    
    // Ring Progress
    const ring = document.getElementById('continuityRing');
    const todayAct = initTodayActivity();
    const overdueCount = getDailyOverdueSnapshot(liveQ);
    
    // Overdue text
    const textEl = document.getElementById('continuityOverdueText');
    if (todayAct.studied) {
        textEl.textContent = 'Günün hedefi tamamlandı 🎉';
        textEl.style.color = 'var(--success-color, #10b981)';
        ring.style.stroke = 'var(--success-color, #10b981)';
        ring.setAttribute('stroke-dasharray', '100, 100');
    } else {
        if (overdueCount === 0) {
            textEl.textContent = 'Bugün tekrar bekleyen soru yok 👍';
            ring.setAttribute('stroke-dasharray', '100, 100');
            ring.style.stroke = 'var(--primary-color)';
        } else {
            textEl.textContent = `Günün hedefi: ${overdueCount} soru`;
            textEl.style.color = 'var(--text-secondary)';
            // calculate progress (we don't track how many of the *specific* overdue questions were answered, 
            // but we track total questionCount studied today.
            const progress = Math.min(100, (todayAct.questionCount / overdueCount) * 100);
            ring.setAttribute('stroke-dasharray', `${progress}, 100`);
            ring.style.stroke = 'var(--primary-color)';
        }
    }
    
    // Tokens
    const tokensEl = document.getElementById('continuityTokens');
    tokensEl.innerHTML = '';
    const freezeTokens = AppState.continuityConfig?.freezeTokens || { remaining: 2, total: 2 };
    for (let i = 0; i < freezeTokens.total; i++) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '14');
        svg.setAttribute('height', '14');
        svg.setAttribute('fill', i < freezeTokens.remaining ? 'var(--info-color, #3b82f6)' : 'none');
        svg.setAttribute('stroke', i < freezeTokens.remaining ? 'none' : 'var(--border-color)');
        svg.setAttribute('stroke-width', '2');
        svg.style.opacity = i < freezeTokens.remaining ? '1' : '0.4';
        // A simple snowflake or circle icon for tokens
        svg.innerHTML = `<circle cx="12" cy="12" r="10"></circle>`;
        tokensEl.appendChild(svg);
    }
    
    // Heatmap (Last 10 days)
    const heatmapEl = document.getElementById('continuityHeatmap');
    heatmapEl.innerHTML = '';
    const activities = AppState.studyActivity || {};
    
    // We want to show a fixed number of days, e.g. 14 days
    const numDays = 14;
    let currentDate = new Date();
    currentDate.setDate(currentDate.getDate() - numDays + 1); // Start 13 days ago
    
    for (let i = 0; i < numDays; i++) {
        const dateStr = getLocalDateStr(currentDate);
        const act = activities[dateStr];
        
        const rect = document.createElement('div');
        rect.style.flex = '1';
        rect.style.borderRadius = '2px';
        rect.title = dateStr;
        
        if (act) {
            if (act.studied) {
                // Determine intensity (based on question count roughly)
                if (act.questionCount > 50) rect.style.backgroundColor = 'var(--success-color, #10b981)';
                else if (act.questionCount > 20) rect.style.backgroundColor = 'color-mix(in srgb, var(--success-color, #10b981) 70%, transparent)';
                else rect.style.backgroundColor = 'color-mix(in srgb, var(--success-color, #10b981) 40%, transparent)';
            } else if (act.frozen) {
                rect.style.backgroundColor = 'var(--info-color, #3b82f6)';
            } else {
                rect.style.backgroundColor = 'var(--surface-hover)';
            }
        } else {
            rect.style.backgroundColor = 'var(--surface-hover)';
        }
        
        heatmapEl.appendChild(rect);
        currentDate.setDate(currentDate.getDate() + 1);
    }
}

export function showDailyMotivationToast() {
    const liveQ = getLiveQuestions();
    if (!liveQ || liveQ.length === 0) return;
    
    const todayAct = initTodayActivity();
    const overdueCount = getDailyOverdueSnapshot(liveQ);
    
    if (overdueCount > 0 && !todayAct.studied) {
        const remaining = Math.max(0, overdueCount - todayAct.questionCount);
        if (remaining > 0) {
            showToast(`Hadi! Bugün ${remaining} soru eksiğin var! Devamlılık senin elinde, tempoyu koru!`, 'info');
        }
    }
}
