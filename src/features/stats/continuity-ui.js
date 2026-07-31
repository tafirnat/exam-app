import { AppState, saveContinuityConfig } from '../../core/state.js';
import {
    calculateGlobalStreak,
    calculateFocusStreak,
    getLocalDateStr,
    getDailyOverdueSnapshot,
    getDailyFocusOverdueSnapshot,
    initTodayActivity,
    getDailyRequirement,
    isActivityRequirementMet,
    isFocusActivityRequirementMet,
    getFsrsStatsForRange,
    getFocusStatsForRange,
    getFocusSources,
    calculateFocusTargetDistribution
} from './continuity-engine.js';
import { buildQuestionPool } from '../test/test-engine.js';
import { showToast } from '../../core/utils.js';

let carouselTimer = null;
let currentSlideIndex = 0;

export function renderContinuityBlock() {
    renderGlobalCharts();
    
    const wrapper = document.getElementById('continuityCarouselWrapper');
    if (!wrapper) return;
    
    // Only show if user has active sources or stats
    const liveQ = buildQuestionPool();
    if (!liveQ || liveQ.length === 0) {
        wrapper.style.display = 'none';
        return;
    }
    
    wrapper.style.display = 'block';
    
    renderGlobalSlide(liveQ);
    renderFocusSlide();
    initCarouselEvents();
    bindFocusModalEvents();
}

function renderGlobalSlide(liveQ) {
    const card = document.getElementById('continuityCard');
    if (!card) return;

    // Streak
    const streak = calculateGlobalStreak();
    document.getElementById('continuityStreakCount').textContent = streak;
    
    // Ring Progress
    const ring = document.getElementById('continuityRing');
    const todayAct = initTodayActivity();
    const overdueCount = getDailyOverdueSnapshot(liveQ);
    const req = getDailyRequirement(overdueCount);
    const solved = todayAct.questionCount || 0;
    
    // Overdue text & Progress Ring
    const textEl = document.getElementById('continuityOverdueText');
    if (isActivityRequirementMet(todayAct)) {
        textEl.textContent = 'Günün serisi korundu 🎉';
        textEl.style.color = 'var(--success-color, #10b981)';
        ring.style.stroke = 'var(--success-color, #10b981)';
        ring.setAttribute('stroke-dasharray', '100, 100');
    } else {
        const progress = Math.min(100, Math.round((solved / req) * 100));
        ring.setAttribute('stroke-dasharray', `${progress}, 100`);
        ring.style.stroke = 'var(--primary-color)';
        textEl.style.color = 'var(--text-secondary)';

        if (overdueCount === 0) {
            textEl.textContent = `Seri için: ${solved}/15 soru`;
        } else if (overdueCount > 15) {
            textEl.textContent = `Seri için: ${solved}/15 soru (FSRS: ${overdueCount})`;
        } else {
            textEl.textContent = `Seri için: ${solved}/${overdueCount} FSRS sorusu`;
        }
    }
    
    // Tokens
    const tokensEl = document.getElementById('continuityTokens');
    tokensEl.innerHTML = '';
    const freezeTokens = AppState.continuityConfig?.freezeTokens || { remaining: 1, total: 1 };
    
    const stats7 = getFsrsStatsForRange(7);
    const stats14 = getFsrsStatsForRange(14);

    tokensEl.title = `Kalan Dondurma: ${freezeTokens.remaining}/${freezeTokens.total}\n` +
        `• 7 Gün Seri + %70 FSRS: ${stats7.rate}% (${stats7.streakSustained ? 'Seri OK' : 'Seri Yok'})\n` +
        `• 14 Gün Seri + %80 FSRS: ${stats14.rate}% (${stats14.streakSustained ? 'Seri OK' : 'Seri Yok'})`;
    
    const tokenLabel = document.createElement('span');
    tokenLabel.style.fontSize = '0.7rem';
    tokenLabel.style.fontWeight = '600';
    tokenLabel.style.color = 'var(--text-secondary)';
    tokenLabel.style.marginRight = '2px';
    tokenLabel.textContent = `Dondurma:`;
    tokensEl.appendChild(tokenLabel);

    for (let i = 0; i < freezeTokens.total; i++) {
        const svg = createTokenSvg(i < freezeTokens.remaining);
        tokensEl.appendChild(svg);
    }
}

function renderFocusSlide() {
    const card = document.getElementById('focusContinuityCard');
    if (!card) return;

    const focusStreak = calculateFocusStreak();
    document.getElementById('focusStreakCount').textContent = focusStreak;

    const ring = document.getElementById('focusContinuityRing');
    const todayAct = initTodayActivity();
    const focusSources = getFocusSources();

    const textEl = document.getElementById('focusContinuityOverdueText');

    if (!focusSources || focusSources.length === 0) {
        textEl.textContent = 'Kaynak seçilmedi. ⚙️ ikonuna dokunun.';
        textEl.style.color = 'var(--text-secondary)';
        ring.setAttribute('stroke-dasharray', '0, 100');
    } else {
        const focusOverdue = getDailyFocusOverdueSnapshot();
        const req = getDailyRequirement(focusOverdue);
        const solved = todayAct.focusQuestionCount || 0;

        if (isFocusActivityRequirementMet(todayAct)) {
            textEl.textContent = 'Odak serisi korundu 🎉';
            textEl.style.color = 'var(--success-color, #10b981)';
            ring.style.stroke = 'var(--success-color, #10b981)';
            ring.setAttribute('stroke-dasharray', '100, 100');
        } else {
            const progress = Math.min(100, Math.round((solved / req) * 100));
            ring.setAttribute('stroke-dasharray', `${progress}, 100`);
            ring.style.stroke = 'var(--info-color, #3b82f6)';
            textEl.style.color = 'var(--text-secondary)';
            textEl.textContent = `Odak Seri için: ${solved}/${req} soru (${focusSources.length} kaynak)`;
        }
    }

    // Focus Tokens
    const tokensEl = document.getElementById('focusContinuityTokens');
    tokensEl.innerHTML = '';
    const focusTokens = AppState.continuityConfig?.focusFreezeTokens || { remaining: 1, total: 1 };
    const stats7 = getFocusStatsForRange(7);
    const stats14 = getFocusStatsForRange(14);

    tokensEl.title = `Kalan Odak Dondurma: ${focusTokens.remaining}/${focusTokens.total}\n` +
        `• 7 Gün Odak Seri: ${stats7.streakSustained ? 'Tamam' : 'Eksik'}\n` +
        `• 14 Gün Odak Seri (Joker): ${stats14.streakSustained ? 'Tamam' : 'Eksik'}`;

    const tokenLabel = document.createElement('span');
    tokenLabel.style.fontSize = '0.7rem';
    tokenLabel.style.fontWeight = '600';
    tokenLabel.style.color = 'var(--text-secondary)';
    tokenLabel.style.marginRight = '2px';
    tokenLabel.textContent = `Dondurma:`;
    tokensEl.appendChild(tokenLabel);

    for (let i = 0; i < focusTokens.total; i++) {
        const svg = createTokenSvg(i < focusTokens.remaining);
        tokensEl.appendChild(svg);
    }
}

function createTokenSvg(active) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', active ? 'var(--info-color, #3b82f6)' : 'var(--text-secondary)');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.style.opacity = active ? '1' : '0.3';
    svg.innerHTML = `
        <line x1="12" y1="2" x2="12" y2="22"></line>
        <path d="M17 5l-5 5-5-5"></path>
        <path d="M17 19l-5-5-5 5"></path>
        <line x1="2" y1="12" x2="22" y2="12"></line>
        <path d="M5 7l5 5-5 5"></path>
        <path d="M19 7l-5 5 5 5"></path>
    `;
    return svg;
}

let isAnimating = false;

const CAROUSEL_INTERVAL_MS = 5000;

// Read the slide duration from CSS so timing lives in one place.
function getSlideDuration(carousel) {
    const raw = getComputedStyle(carousel).getPropertyValue('--carousel-duration').trim();
    if (raw.endsWith('ms')) return parseFloat(raw) || 600;
    if (raw.endsWith('s')) return (parseFloat(raw) || 0.6) * 1000;
    return 600;
}

function initCarouselEvents() {
    const wrapper = document.getElementById('continuityCarouselWrapper');
    if (!wrapper || wrapper.dataset.carouselInited) return;
    wrapper.dataset.carouselInited = 'true';

    const carousel = wrapper.querySelector('.continuity-carousel');
    const slides = wrapper.querySelectorAll('.continuity-slide');
    const dots = wrapper.querySelectorAll('.continuity-dots .dot');
    if (!slides.length) return;

    function goToSlide(targetIndex, direction = 'next') {
        if (targetIndex === currentSlideIndex || isAnimating) return;

        const currentSlide = slides[currentSlideIndex];
        const nextSlide = slides[targetIndex];
        if (!currentSlide || !nextSlide) return;

        isAnimating = true;

        // Highlight active dot immediately
        dots.forEach((d, idx) => d.classList.toggle('active', idx === targetIndex));

        const isNext = direction === 'next';

        // Reset lingering animation classes on all slides
        slides.forEach(s => {
            s.classList.remove('slide-out-left', 'slide-out-right', 'slide-in-left', 'slide-in-right', 'slide-in-active');
        });

        // Position next slide at start location
        nextSlide.classList.add(isNext ? 'slide-in-right' : 'slide-in-left');

        // Force browser layout reflow
        void nextSlide.offsetWidth;

        // Trigger smooth slide transitions
        currentSlide.classList.add(isNext ? 'slide-out-left' : 'slide-out-right');
        nextSlide.classList.add('slide-in-active');

        currentSlideIndex = targetIndex;

        setTimeout(() => {
            slides.forEach((s, idx) => {
                s.classList.remove('slide-out-left', 'slide-out-right', 'slide-in-left', 'slide-in-right', 'slide-in-active');
                s.classList.toggle('active', idx === targetIndex);
            });
            isAnimating = false;
        }, getSlideDuration(carousel || wrapper) + 40);
    }

    function startTimer() {
        stopTimer();
        carouselTimer = setInterval(() => {
            const nextIdx = (currentSlideIndex + 1) % slides.length;
            goToSlide(nextIdx, 'next');
        }, CAROUSEL_INTERVAL_MS);
    }

    function stopTimer() {
        if (carouselTimer) {
            clearInterval(carouselTimer);
            carouselTimer = null;
        }
    }

    wrapper.addEventListener('mouseenter', stopTimer);
    wrapper.addEventListener('mouseleave', startTimer);

    // Touch swipe handling for mobile
    let touchStartX = 0;
    let touchStartY = 0;

    wrapper.addEventListener('touchstart', (e) => {
        stopTimer();
        if (e.touches.length === 1) {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }
    }, { passive: true });

    wrapper.addEventListener('touchend', (e) => {
        startTimer();
        if (e.changedTouches.length === 1) {
            const diffX = e.changedTouches[0].clientX - touchStartX;
            const diffY = e.changedTouches[0].clientY - touchStartY;
            if (Math.abs(diffX) > 35 && Math.abs(diffX) > Math.abs(diffY)) {
                if (diffX < 0) {
                    // Swipe Left -> next slide (right-to-left)
                    const nextIdx = (currentSlideIndex + 1) % slides.length;
                    goToSlide(nextIdx, 'next');
                } else {
                    // Swipe Right -> previous slide (left-to-right)
                    const prevIdx = (currentSlideIndex - 1 + slides.length) % slides.length;
                    goToSlide(prevIdx, 'prev');
                }
            }
        }
    }, { passive: true });

    dots.forEach((dot, idx) => {
        dot.addEventListener('click', (e) => {
            e.stopPropagation();
            const dir = idx > currentSlideIndex ? 'next' : (idx < currentSlideIndex ? 'prev' : 'next');
            goToSlide(idx, dir);
            startTimer();
        });
    });

    startTimer();
}

function bindFocusModalEvents() {
    const openBtn = document.getElementById('openFocusSourceModalBtn');
    const modal = document.getElementById('focusSourceModal');
    const closeBtn = document.getElementById('focusSourceModalCloseBtn');
    const saveBtn = document.getElementById('focusSourceModalSaveBtn');

    if (openBtn && !openBtn.dataset.bound) {
        openBtn.dataset.bound = 'true';
        openBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openFocusSourceModal();
        });
    }

    if (closeBtn && !closeBtn.dataset.bound) {
        closeBtn.dataset.bound = 'true';
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }

    if (saveBtn && !saveBtn.dataset.bound) {
        saveBtn.dataset.bound = 'true';
        saveBtn.addEventListener('click', () => {
            saveFocusSourceSelection();
            modal.style.display = 'none';
            renderFocusSlide();
            showToast('Özel Odak kaynakları güncellendi');
        });
    }
}

function openFocusSourceModal() {
    const modal = document.getElementById('focusSourceModal');
    const listEl = document.getElementById('focusSourceList');
    if (!modal || !listEl) return;

    listEl.innerHTML = '';
    const selectedSources = getFocusSources();
    const allSources = AppState.sources || [];

    if (allSources.length === 0) {
        listEl.innerHTML = '<div style="font-size:0.8rem; color:var(--text-secondary); padding:0.5rem;">Henüz ekli kaynak yok.</div>';
    } else {
        allSources.forEach(source => {
            const isChecked = selectedSources.includes(source.id);
            const item = document.createElement('label');
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.justifyContent = 'space-between';
            item.style.padding = '0.6rem 0.75rem';
            item.style.backgroundColor = 'var(--surface-hover)';
            item.style.borderRadius = '8px';
            item.style.cursor = 'pointer';

            item.innerHTML = `
                <span style="font-size:0.88rem; font-weight:500;">${source.name || source.id}</span>
                <input type="checkbox" value="${source.id}" ${isChecked ? 'checked' : ''} class="focus-source-checkbox">
            `;
            listEl.appendChild(item);
        });

        // Limit to max 3 checkboxes
        const checkboxes = listEl.querySelectorAll('.focus-source-checkbox');
        checkboxes.forEach(cb => {
            cb.addEventListener('change', () => {
                const checkedCount = listEl.querySelectorAll('.focus-source-checkbox:checked').length;
                if (checkedCount > 3) {
                    cb.checked = false;
                    showToast('En fazla 3 kaynak seçebilirsiniz!');
                }
            });
        });
    }

    modal.style.display = 'flex';
}

function saveFocusSourceSelection() {
    const listEl = document.getElementById('focusSourceList');
    if (!listEl) return;

    const checkedInputs = listEl.querySelectorAll('.focus-source-checkbox:checked');
    const selectedIds = Array.from(checkedInputs).map(cb => cb.value);

    if (!AppState.continuityConfig) AppState.continuityConfig = {};
    AppState.continuityConfig.focusSources = selectedIds;
    saveContinuityConfig();
}

/**
 * Single entry point for every chart on the home screen. The heatmap card and
 * the difficulty/trend card render independently: an empty stats set hides the
 * latter but the heatmap still has a year of activity to draw.
 */
export function renderGlobalCharts() {
    renderHeatmapCard();
    renderActivityCharts();
}

function renderHeatmapCard() {
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
    
    heatmapEl.style.gridTemplateRows = 'repeat(7, 10px)';
    heatmapEl.style.gridAutoFlow = 'column';
    heatmapEl.style.gridAutoColumns = '10px';
    heatmapEl.style.justifyContent = 'flex-start';
    
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
    
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const colorLevel1 = isDark ? '#0e4429' : '#9be9a8';
    const colorLevel2 = isDark ? '#006d32' : '#40c463';
    const colorLevel3 = isDark ? '#26a641' : '#30a14e';
    const colorLevel4 = isDark ? '#39d353' : '#216e39';
    const colorEmpty  = isDark ? 'rgba(255, 255, 255, 0.05)' : '#ebedf0';
    const colorFrozen = isDark ? '#38bdf8' : '#3b82f6';
    
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
        rect.style.width = '10px'; // strictly 10px to avoid flex stretching
        rect.style.height = '10px';
        
        if (act) {
            if (act.studied) {
                if (act.questionCount > 40) rect.style.backgroundColor = colorLevel4;
                else if (act.questionCount > 20) rect.style.backgroundColor = colorLevel3;
                else if (act.questionCount > 10) rect.style.backgroundColor = colorLevel2;
                else rect.style.backgroundColor = colorLevel1;
            } else if (act.frozen) {
                rect.style.backgroundColor = colorFrozen;
            } else {
                rect.style.backgroundColor = colorEmpty;
            }
        } else {
            rect.style.backgroundColor = colorEmpty;
        }
        
        heatmapEl.appendChild(rect);
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    if (placeholder) placeholder.style.display = 'none';
    if (!wrapper) return;
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

function renderActivityCharts() {
    const diffContainer = document.getElementById('homeDifficultyStatsCard');
    const trendContainer = document.getElementById('homeWeeklyTrendCard');
    const globalContainer = document.getElementById('homeGlobalStatsCard');

    const statsKeys = Object.keys(AppState.stats || {});
    const hasActivity = AppState.studyActivity && Object.keys(AppState.studyActivity).length > 0;
    const hasStats = statsKeys.length > 0;

    if (!hasStats && !hasActivity) {
        if (diffContainer) diffContainer.style.display = 'none';
        if (trendContainer) trendContainer.style.display = 'none';
        if (globalContainer) globalContainer.style.display = 'none';
        return;
    }

    if (diffContainer) diffContainer.style.display = 'block';
    if (trendContainer) trendContainer.style.display = 'block';
    if (globalContainer) globalContainer.style.display = 'block';

    // 1. Difficulty Donut Chart
    let diffCounts = { easy: 0, medium: 0, hard: 0, veryHard: 0, unsolved: 0 };
    let totalQuestions = 0;
    
    const allQuestions = [];
    (AppState.sources || []).forEach(s => {
        if (s.questions) {
            s.questions.forEach(q => allQuestions.push(`${s.id}_${q.id}`));
        }
    });
    totalQuestions = allQuestions.length;

    let solvedCount = 0;
    allQuestions.forEach(key => {
        const s = AppState.stats[key];
        if (!s || (s.correct === 0 && s.wrong === 0)) {
            diffCounts.unsolved++;
        } else {
            solvedCount++;
            const d = s.difficulty || 5;
            if (d <= 4) diffCounts.easy++;
            else if (d <= 6) diffCounts.medium++;
            else if (d <= 8) diffCounts.hard++;
            else diffCounts.veryHard++;
        }
    });

    const diffData = [
        { label: 'Kolay', count: diffCounts.easy, color: '#22c55e' },
        { label: 'Orta', count: diffCounts.medium, color: '#eab308' },
        { label: 'Zor', count: diffCounts.hard, color: '#f97316' },
        { label: 'Çok Zor', count: diffCounts.veryHard, color: '#ef4444' },
        { label: 'Çözülmedi', count: diffCounts.unsolved, color: 'var(--text-secondary)' }
    ];

    let currentDegree = 0;
    let gradientParts = [];
    diffData.forEach(d => {
        if (d.count > 0) {
            const percentage = (d.count / totalQuestions) * 360;
            gradientParts.push(`${d.color} ${currentDegree}deg ${currentDegree + percentage}deg`);
            currentDegree += percentage;
        }
    });

    const donutEl = document.getElementById('difficultyDonutChart');
    if (donutEl) {
        if (gradientParts.length > 0) {
            donutEl.style.background = `conic-gradient(${gradientParts.join(', ')})`;
        } else {
            donutEl.style.background = 'var(--surface-hover)';
        }
    }
    const countEl = document.getElementById('donutTotalCount');
    if (countEl) countEl.textContent = totalQuestions;

    const legendEl = document.getElementById('difficultyLegend');
    if (legendEl) {
        legendEl.innerHTML = '';
        diffData.forEach(d => {
            const perc = totalQuestions > 0 ? Math.round((d.count / totalQuestions) * 100) : 0;
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '8px';
            row.innerHTML = `
                <div style="width:12px; height:12px; border-radius:50%; background:${d.color};"></div>
                <span>${d.label}: ${d.count} (${perc}%)</span>
            `;
            legendEl.appendChild(row);
        });
    }

    // 2. Weekly Study Trend
    const activities = AppState.studyActivity || {};
    const yAxisEl = document.getElementById('trendYAxis');
    const barsEl = document.getElementById('trendBars');
    const xAxisEl = document.getElementById('trendXAxis');
    
    if (!yAxisEl || !barsEl || !xAxisEl) return;
    
    yAxisEl.innerHTML = '';
    barsEl.innerHTML = '';
    xAxisEl.innerHTML = '';

    const numDays = 7;
    let currentDate = new Date();
    currentDate.setDate(currentDate.getDate() - numDays + 1);
    
    const lang = document.documentElement.lang || 'tr';
    const isTr = lang.startsWith('tr');
    const isDe = lang.startsWith('de');
    const daysArr = [];
    let maxCount = 0;
    
    for (let i = 0; i < numDays; i++) {
        const dateStr = getLocalDateStr(currentDate);
        const act = activities[dateStr];
        
        const dayLabels = isTr ? ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'] : 
                          isDe ? ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] : 
                                 ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        
        const dayLabel = dayLabels[currentDate.getDay()];
        
        let c = 0, w = 0, u = 0, t = 0;
        if (act && act.studied) {
            c = act.correctCount || 0;
            w = act.wrongCount || 0;
            u = act.unansweredCount || 0;
            t = act.questionCount || 0;
            
            if (t > 0 && c === 0 && w === 0 && u === 0) {
                u = t;
            }
        }
        
        if (t > maxCount) maxCount = t;
        
        daysArr.push({ label: dayLabel, correct: c, wrong: w, empty: u, total: t });
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    const topLimit = Math.max(10, Math.ceil(maxCount / 5) * 5);
    for (let i = 0; i <= 5; i++) {
        const val = Math.round((topLimit / 5) * i);
        const line = document.createElement('div');
        line.style.display = 'flex';
        line.style.alignItems = 'center';
        line.style.fontSize = '0.7rem';
        line.style.color = 'var(--text-secondary)';
        line.style.width = '100%';
        line.innerHTML = `<span style="width:20px; text-align:right; margin-right:5px;">${val}</span><div style="flex:1; height:1px; background:var(--border-color); opacity:0.5;"></div>`;
        yAxisEl.appendChild(line);
    }

    daysArr.forEach(d => {
        const xLbl = document.createElement('div');
        xLbl.textContent = d.label;
        xLbl.style.flex = '1';
        xLbl.style.textAlign = 'center';
        xAxisEl.appendChild(xLbl);
        
        const barWrap = document.createElement('div');
        barWrap.style.flex = '1';
        barWrap.style.height = '100%';
        barWrap.style.display = 'flex';
        barWrap.style.flexDirection = 'column-reverse';
        barWrap.style.alignItems = 'center';
        barWrap.style.padding = '0 8px';
        
        const barInner = document.createElement('div');
        barInner.style.width = '100%';
        barInner.style.maxWidth = '24px';
        barInner.style.height = '100%';
        barInner.style.display = 'flex';
        barInner.style.flexDirection = 'column-reverse';
        barInner.style.position = 'relative';
        
        if (d.total > 0) {
            const hPerc = (d.total / topLimit) * 100;
            barInner.style.height = `${hPerc}%`;
            
            const wPerc = (d.wrong / d.total) * 100;
            const uPerc = (d.empty / d.total) * 100;
            const cPerc = (d.correct / d.total) * 100;
            
            if (wPerc > 0) {
                const wDiv = document.createElement('div');
                wDiv.style.height = `${wPerc}%`;
                wDiv.style.background = '#ef4444';
                wDiv.style.width = '100%';
                if (uPerc === 0 && cPerc === 0) wDiv.style.borderRadius = '4px 4px 0 0';
                barInner.appendChild(wDiv);
            }
            if (uPerc > 0) {
                const uDiv = document.createElement('div');
                uDiv.style.height = `${uPerc}%`;
                uDiv.style.background = '#64748b';
                uDiv.style.width = '100%';
                if (cPerc === 0) uDiv.style.borderRadius = '4px 4px 0 0';
                barInner.appendChild(uDiv);
            }
            if (cPerc > 0) {
                const cDiv = document.createElement('div');
                cDiv.style.height = `${cPerc}%`;
                cDiv.style.background = '#22c55e';
                cDiv.style.width = '100%';
                cDiv.style.borderRadius = '4px 4px 0 0';
                barInner.appendChild(cDiv);
            }
            
            const topLbl = document.createElement('span');
            topLbl.textContent = d.total;
            topLbl.style.position = 'absolute';
            topLbl.style.top = '-16px';
            topLbl.style.width = '100%';
            topLbl.style.textAlign = 'center';
            topLbl.style.fontSize = '0.7rem';
            topLbl.style.fontWeight = 'bold';
            topLbl.style.color = 'var(--text-primary)';
            barInner.appendChild(topLbl);
        }
        
        barWrap.appendChild(barInner);
        barsEl.appendChild(barWrap);
    });
}
