
import { AppState } from '../../core/state.js';
import { t } from '../../core/i18n.js';

export function renderStatsList(filter = 'all') {
    const list = document.getElementById('statsList');
    if (!list) return;
    list.innerHTML = '';

    // Use the pool of questions from currently active sources
    const activeQuestions = [];
    AppState.sources.forEach(s => {
        if (s.active) activeQuestions.push(...s.questions);
    });

    let filteredQuestions = activeQuestions;
    if (filter !== 'all') {
        filteredQuestions = activeQuestions.filter(q => {
            const s = AppState.stats[q.id] || {};
            if (filter === 'starred') return s.starred;
            if (filter === 'flagged') return s.flagged;
            if (filter === 'noted') return s.note && s.note.trim() !== '';
            return true;
        });
    }

    filteredQuestions.forEach((q, i) => {
        const s = AppState.stats[q.id] || { correct: 0, wrong: 0, coeff: 1.0 };
        const total = s.correct + s.wrong;
        const percent = total > 0 ? Math.round((s.correct / total) * 100) : 0;
        const item = document.createElement('div');
        item.className = 'stats-list-item';
        const qText = q.content?.text || q.text || 'Untitled Question';
        item.innerHTML = `
            <div class="stats-item-num">#${i + 1}</div>
            <div class="stats-item-text">${qText}</div>
            <div class="stats-item-meta">
                <span>✓${s.correct} ✗${s.wrong} (${percent}%)</span>
                <span>${t('coeff_label')} ${s.coeff.toFixed(1)}</span>
            </div>
        `;
        item.onclick = () => {
            if (window.onPreviewQuestion) window.onPreviewQuestion(q);
        };
        list.appendChild(item);
    });
}

export function updateHomeStats() {
    const activeQuestions = [];
    AppState.sources.forEach(s => {
        if (s.active) activeQuestions.push(...s.questions);
    });

    const total = activeQuestions.length;
    const statTotalEl = document.getElementById('statTotal');
    if (statTotalEl) statTotalEl.innerText = total;

    let solved = 0;
    let totalCoeff = 0;
    activeQuestions.forEach(q => {
        if (!q) return;
        const s = AppState.stats[q.id];
        if (s) {
            if (s.correct > 0 || s.wrong > 0) solved++;
            totalCoeff += s.coeff || 1.0;
        } else {
            totalCoeff += 1.0;
        }
    });

    const avgCoeff = total > 0 ? (totalCoeff / total).toFixed(1) : "0.0";
    const statAvgEl = document.getElementById('statAvg');
    if (statAvgEl) statAvgEl.innerText = avgCoeff;

    const pct = total > 0 ? Math.round((solved / total) * 100) : 0;
    const homePctEl = document.getElementById('homeProgressPercent');
    if (homePctEl) homePctEl.innerText = `${pct}%`;
    const homeBarEl = document.getElementById('homeProgressBarFill');
    if (homeBarEl) homeBarEl.style.width = `${pct}%`;
    const homeDetailEl = document.getElementById('homeProgressDetail');
    if (homeDetailEl) homeDetailEl.innerText = t('solved_count', { solved: solved, total: total });

    const startPanel = document.getElementById('startPanel');
    const statsBtn = document.getElementById('homeStatsBtn');

    if (total > 0) {
        if (startPanel) {
            startPanel.style.opacity = '1';
            startPanel.style.pointerEvents = 'all';
        }
        if (statsBtn) statsBtn.disabled = false;
    } else {
        if (startPanel) {
            startPanel.style.opacity = '0.5';
            startPanel.style.pointerEvents = 'none';
        }
        if (statsBtn) statsBtn.disabled = true;
    }
}
