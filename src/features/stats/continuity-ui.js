import { AppState } from '../../core/state.js';
import { calculateGlobalStreak, getLocalDateStr, getDailyOverdueSnapshot, initTodayActivity } from './continuity-engine.js';
import { buildQuestionPool } from '../test/test-engine.js';
import { showToast } from '../../core/utils.js';

export function renderContinuityBlock() {
    const card = document.getElementById('continuityCard');
    if (!card) return;
    
    // Only show if user has active sources or some stats
    const liveQ = buildQuestionPool();
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
    
    const tokenLabel = document.createElement('span');
    tokenLabel.style.fontSize = '0.7rem';
    tokenLabel.style.fontWeight = '600';
    tokenLabel.style.color = 'var(--text-secondary)';
    tokenLabel.style.marginRight = '2px';
    tokenLabel.textContent = `Dondurma:`;
    tokensEl.appendChild(tokenLabel);

    for (let i = 0; i < freezeTokens.total; i++) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', i < freezeTokens.remaining ? 'var(--info-color, #3b82f6)' : 'var(--text-secondary)');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.style.opacity = i < freezeTokens.remaining ? '1' : '0.3';
        svg.innerHTML = `
            <line x1="12" y1="2" x2="12" y2="22"></line>
            <path d="M17 5l-5 5-5-5"></path>
            <path d="M17 19l-5-5-5 5"></path>
            <line x1="2" y1="12" x2="22" y2="12"></line>
            <path d="M5 7l5 5-5 5"></path>
            <path d="M19 7l-5 5 5 5"></path>
        `;
        tokensEl.appendChild(svg);
    }
    
    // Heatmap (Last 10 days)
    // Heatmap (Moved to bottom of page, default 365 days, lazy loaded)
    const heatmapCard = document.getElementById('homeHeatmapCard');
    if (heatmapCard) {
        heatmapCard.style.display = 'block';
        
        if (!heatmapCard.dataset.observerBound) {
            // Small delay or IntersectionObserver to prevent blocking main thread
            const observer = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting) {
                    // Small timeout to let UI paint first
                    setTimeout(renderHeatmapYearly, 50);
                    observer.disconnect();
                }
            }, { threshold: 0.1 });
            observer.observe(heatmapCard);
            heatmapCard.dataset.observerBound = 'true';
        } else {
            // Already bound/rendered, but if state changes, update in background
            setTimeout(renderHeatmapYearly, 100);
        }
    }
}

function renderHeatmapYearly() {
    const heatmapEl = document.getElementById('continuityHeatmap');
    const yAxisEl = document.getElementById('heatmapYAxis');
    const xAxisEl = document.getElementById('heatmapXAxis');
    const wrapper = document.getElementById('continuityHeatmapWrapper');
    const placeholder = document.getElementById('heatmapPlaceholder');
    
    if (!heatmapEl || !yAxisEl || !xAxisEl) return;
    
    heatmapEl.innerHTML = '';
    yAxisEl.innerHTML = '';
    xAxisEl.innerHTML = '';
    
    const activities = AppState.studyActivity || {};
    const numDays = 365;
    
    let currentDate = new Date();
    currentDate.setDate(currentDate.getDate() - numDays + 1); 
    
    const lang = document.documentElement.lang || 'tr';
    const isTr = lang.startsWith('tr');
    const isDe = lang.startsWith('de');
    
    const dayLabels = isTr ? ['Pzt', '', 'Çar', '', 'Cum', '', ''] : 
                      isDe ? ['Mo', '', 'Mi', '', 'Fr', '', ''] : 
                             ['Mon', '', 'Wed', '', 'Fri', '', ''];
                             
    dayLabels.forEach(label => {
        const div = document.createElement('div');
        div.textContent = label;
        yAxisEl.appendChild(div);
    });
    
    const startDayOfWeek = currentDate.getDay();
    const paddingDays = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1; 
    
    for (let p = 0; p < paddingDays; p++) {
        const rect = document.createElement('div');
        rect.style.backgroundColor = 'transparent';
        heatmapEl.appendChild(rect);
    }
    
    for (let i = 0; i < numDays; i++) {
        if (i === 0 || currentDate.getDate() === 1) {
            const currentCol = Math.floor((i + paddingDays) / 7);
            const monthStr = new Intl.DateTimeFormat(lang, { month: 'short' }).format(currentDate);
            
            const monthDiv = document.createElement('div');
            monthDiv.textContent = monthStr;
            monthDiv.style.position = 'absolute';
            monthDiv.style.left = `${currentCol * 12}px`;
            monthDiv.style.top = '0';
            xAxisEl.appendChild(monthDiv);
        }

        const dateStr = getLocalDateStr(currentDate);
        const act = activities[dateStr];
        
        const rect = document.createElement('div');
        rect.style.borderRadius = '2px';
        rect.title = dateStr;
        rect.style.width = '100%';
        rect.style.height = '100%';
        
        if (act) {
            if (act.studied) {
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
    
    placeholder.style.display = 'none';
    wrapper.style.display = 'block';
    
    setTimeout(() => {
        wrapper.scrollLeft = wrapper.scrollWidth;
    }, 10);
}

export function showDailyMotivationToast() {
    const liveQ = buildQuestionPool();
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
