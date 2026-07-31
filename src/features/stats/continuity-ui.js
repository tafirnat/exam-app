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
import { showToast, showAlert } from '../../core/utils.js';

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
    bindContinuityModalEvents();
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
    
    // Tokens - ALWAYS render both tokens (Normal & Super/Joker)
    const tokensEl = document.getElementById('continuityTokens');
    tokensEl.innerHTML = '';
    const freezeTokens = AppState.continuityConfig?.freezeTokens || { remaining: 1, total: 2 };
    
    const stats7 = getFsrsStatsForRange(7);
    const stats14 = getFsrsStatsForRange(14);

    tokensEl.title = `Kalan Dondurma: ${freezeTokens.remaining}/2\n` +
        `• 1. Jeton (Kar Tanesi): Hediye / 7 Gün Seri + %70 FSRS (${stats7.streakSustained ? 'Aktif' : 'Pasif'})\n` +
        `• 2. Joker Jeton (Alev): 14 Gün Seri + %80 FSRS (${stats14.streakSustained ? 'Aktif' : 'Pasif'})`;

    for (let i = 0; i < 2; i++) {
        const isActive = i < (freezeTokens.remaining || 0);
        const svg = createTokenSvg(i, isActive);
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

        const selectedNames = focusSources
            .map(id => (AppState.sources || []).find(s => s.id === id)?.name || id)
            .filter(Boolean)
            .join(', ');

        if (isFocusActivityRequirementMet(todayAct)) {
            textEl.textContent = selectedNames ? `Odak serisi korundu 🎉 (${selectedNames})` : 'Odak serisi korundu 🎉';
            textEl.style.color = 'var(--success-color, #10b981)';
            ring.style.stroke = 'var(--success-color, #10b981)';
            ring.setAttribute('stroke-dasharray', '100, 100');
        } else {
            const progress = Math.min(100, Math.round((solved / req) * 100));
            ring.setAttribute('stroke-dasharray', `${progress}, 100`);
            ring.style.stroke = 'var(--info-color, #3b82f6)';
            textEl.style.color = 'var(--text-secondary)';
            textEl.textContent = selectedNames 
                ? `Seri için: ${solved}/${req} soru (${selectedNames})`
                : `Seri için: ${solved}/${req} soru (${focusSources.length} kaynak)`;
        }
    }

    // Focus Tokens - ALWAYS render both tokens (Normal & Super/Joker)
    const tokensEl = document.getElementById('focusContinuityTokens');
    tokensEl.innerHTML = '';
    const focusTokens = AppState.continuityConfig?.focusFreezeTokens || { remaining: 1, total: 2 };
    const stats7 = getFocusStatsForRange(7);
    const stats14 = getFocusStatsForRange(14);

    tokensEl.title = `Kalan Odak Dondurma: ${focusTokens.remaining}/2\n` +
        `• 1. Odak Jetonu: Hediye / 7 Gün Odak Seri (${stats7.streakSustained ? 'Aktif' : 'Pasif'})\n` +
        `• 2. Joker Odak Jetonu: 14 Gün Odak Seri (${stats14.streakSustained ? 'Aktif' : 'Pasif'})`;

    for (let i = 0; i < 2; i++) {
        const isActive = i < (focusTokens.remaining || 0);
        const svg = createTokenSvg(i, isActive);
        tokensEl.appendChild(svg);
    }
}

function createTokenSvg(tokenIndex, active) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.style.flexShrink = '0';
    svg.style.transition = 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
    svg.style.cursor = 'pointer';

    // Lighter, luminous ice blue color for vivid snowflake rendering
    const iceColor = active ? '#7dd3fc' : 'var(--text-secondary)';

    if (tokenIndex === 0) {
        // Token 1: Snowflake (Kar Tanesi - Light Ice Blue)
        svg.setAttribute('width', '18');
        svg.setAttribute('height', '18');
        svg.setAttribute('stroke', iceColor);
        svg.setAttribute('stroke-width', '1.8');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.style.opacity = active ? '1' : '0.35';
        if (active) {
            svg.style.filter = 'drop-shadow(0 0 4px rgba(125, 211, 252, 0.85))';
        }
        svg.innerHTML = `
            <line x1="12" y1="2" x2="12" y2="22"></line>
            <line x1="3.34" y1="7" x2="20.66" y2="17"></line>
            <line x1="3.34" y1="17" x2="20.66" y2="7"></line>
            <path d="M9.5 4.5L12 7L14.5 4.5"></path>
            <path d="M9.5 19.5L12 17L14.5 19.5"></path>
            <path d="M5 8.5L8 11.5"></path>
            <path d="M19 15.5L16 12.5"></path>
            <path d="M5 15.5L8 12.5"></path>
            <path d="M19 8.5L16 11.5"></path>
        `;
    } else {
        // Token 2: Super / Joker Token (Kar Tanesi + Alev)
        svg.setAttribute('width', '20');
        svg.setAttribute('height', '20');
        svg.style.opacity = active ? '1' : '0.35';
        if (active) {
            svg.style.filter = 'drop-shadow(0 0 5px rgba(249, 115, 22, 0.75))';
        }
        const flameColor = active ? '#ef4444' : 'var(--text-secondary)';

        svg.innerHTML = `
            <!-- Flame (Alev) Top-Left -->
            <path d="M8.5 1.5C8.5 1.5 5 4.8 5 8.2C5 10.5 6.4 12 7.8 12.4C6.8 11 7.3 9.2 8.6 8.2C9.5 9.7 11 10.1 11.4 8.7C12.4 10.7 11.4 12.5 9.8 13.5" fill="${active ? 'url(#flameGrad)' : 'none'}" stroke="${flameColor}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>
            
            <defs>
                <linearGradient id="flameGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#ef4444" />
                    <stop offset="100%" stop-color="#f97316" />
                </linearGradient>
            </defs>

            <!-- Tilted Snowflake (Kar Tanesi) Bottom-Right -->
            <line x1="9" y1="21" x2="21" y2="9" stroke="${iceColor}" stroke-width="1.8" stroke-linecap="round"></line>
            <line x1="10" y1="10" x2="20" y2="20" stroke="${iceColor}" stroke-width="1.8" stroke-linecap="round"></line>
            <line x1="8.5" y1="15" x2="21.5" y2="15" stroke="${iceColor}" stroke-width="1.8" stroke-linecap="round"></line>
            <line x1="15" y1="8.5" x2="15" y2="21.5" stroke="${iceColor}" stroke-width="1.8" stroke-linecap="round"></line>
            <path d="M17 11L19 9L21 11" stroke="${iceColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="M13 19L11 21L9 19" stroke="${iceColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
        `;
    }

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

    // Dot click listeners
    dots.forEach((dot, idx) => {
        dot.addEventListener('click', () => {
            if (idx === currentSlideIndex) return;
            const dir = idx > currentSlideIndex ? 'next' : 'prev';
            goToSlide(idx, dir);
            startTimer();
        });
    });

    // Wire continuity info modal buttons
    const continuityInfoBtn = document.getElementById('continuityInfoBtn');
    if (continuityInfoBtn) {
        continuityInfoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showContinuityInfoModal('global');
        });
    }

    const focusInfoBtn = document.getElementById('focusContinuityInfoBtn');
    if (focusInfoBtn) {
        focusInfoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showContinuityInfoModal('focus');
        });
    }

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

    if (modal && !modal.dataset.backdropBound) {
        modal.dataset.backdropBound = 'true';
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    }
}

function bindContinuityModalEvents() {
    const continuityInfoBtn = document.getElementById('continuityInfoBtn');
    if (continuityInfoBtn && !continuityInfoBtn.dataset.bound) {
        continuityInfoBtn.dataset.bound = 'true';
        continuityInfoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showContinuityInfoModal('global');
        });
    }

    const focusInfoBtn = document.getElementById('focusContinuityInfoBtn');
    if (focusInfoBtn && !focusInfoBtn.dataset.bound) {
        focusInfoBtn.dataset.bound = 'true';
        focusInfoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showContinuityInfoModal('focus');
        });
    }

    const continuityTokens = document.getElementById('continuityTokens');
    if (continuityTokens && !continuityTokens.dataset.bound) {
        continuityTokens.dataset.bound = 'true';
        continuityTokens.addEventListener('click', (e) => {
            e.stopPropagation();
            showFreezeTokenModal('global');
        });
    }

    const focusTokens = document.getElementById('focusContinuityTokens');
    if (focusTokens && !focusTokens.dataset.bound) {
        focusTokens.dataset.bound = 'true';
        focusTokens.addEventListener('click', (e) => {
            e.stopPropagation();
            showFreezeTokenModal('focus');
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

function openInfoPopupModal(title, htmlContent) {
    const overlay = document.getElementById('infoPopupOverlay');
    const titleEl = document.getElementById('infoPopupTitle');
    const bodyEl = document.getElementById('infoPopupBody');
    if (!overlay || !titleEl || !bodyEl) return;

    titleEl.innerHTML = title;
    bodyEl.innerHTML = htmlContent;
    overlay.style.display = 'flex';

    if (!overlay.dataset.bound) {
        overlay.dataset.bound = 'true';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.style.display = 'none';
            }
        });
    }
}

export function showContinuityInfoModal(type) {
    if (type === 'global') {
        const title = '⚡ Genel FSRS Serisi';
        const html = `
            <div style="font-size: 0.88rem; color: var(--text-primary); text-align: left; display: flex; flex-direction: column; gap: 0.85rem;">
                <div style="background: var(--bg-hover, rgba(59,130,246,0.06)); padding: 0.75rem 0.9rem; border-radius: 8px; border-left: 3px solid var(--primary-color);">
                    <strong style="color: var(--primary-color); font-size: 0.92rem;">📌 Genel Seri Nedir?</strong>
                    <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); line-height: 1.45;">
                        Genel Seri, tüm soru bankanız genelinde FSRS (Spaced Repetition) sistemine göre vadesi gelen soruları çözerek çalışma sürekliliğinizi korumanızı sağlar.
                    </p>
                </div>

                <div>
                    <strong style="display: flex; align-items: center; gap: 0.35rem; margin-bottom: 0.35rem;">
                        <span>🔄</span> Günlük Hedef & Çalışma Disiplini:
                    </strong>
                    <ul style="margin: 0; padding-left: 1.2rem; color: var(--text-secondary); line-height: 1.5;">
                        <li>Her gün sistem FSRS algoritmik vadesi gelen soru hedefini belirler.</li>
                        <li>Günün hedefini tamamladığınızda <strong>Seri Gün Sayısı (+1)</strong> artar.</li>
                        <li>Vadesi gelen soru olmadığında seriniz otomatik olarak korunur.</li>
                    </ul>
                </div>
            </div>
        `;
        openInfoPopupModal(title, html);
    } else {
        const title = '🎯 Özel Odak Serisi';
        const html = `
            <div style="font-size: 0.88rem; color: var(--text-primary); text-align: left; display: flex; flex-direction: column; gap: 0.85rem;">
                <div style="background: var(--bg-hover, rgba(59,130,246,0.06)); padding: 0.75rem 0.9rem; border-radius: 8px; border-left: 3px solid var(--info-color, #3b82f6);">
                    <strong style="color: var(--info-color, #3b82f6); font-size: 0.92rem;">📌 Özel Odak Serisi Nedir?</strong>
                    <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); line-height: 1.45;">
                        Özel Odak Serisi, seçtiğiniz özel kaynaklara (en fazla 3 kaynak) odaklanarak özelleştirilmiş günlük çalışma disiplini sürdürmenizi sağlar.
                    </p>
                </div>

                <div>
                    <strong style="display: flex; align-items: center; gap: 0.35rem; margin-bottom: 0.35rem;">
                        <span>⚙️</span> Kaynak Seçimi & Hedef:
                    </strong>
                    <ul style="margin: 0; padding-left: 1.2rem; color: var(--text-secondary); line-height: 1.5;">
                        <li>Kart başlığındaki ⚙️ ikonuna dokunarak odaklanacağınız kaynakları seçebilirsiniz.</li>
                        <li>Seçilen kaynaklardan günlük vadesi gelen sorular çözüldüğünde <strong>Odak Serisi (+1)</strong> artar.</li>
                    </ul>
                </div>
            </div>
        `;
        openInfoPopupModal(title, html);
    }
}

export function showFreezeTokenModal(type) {
    if (type === 'global') {
        const title = '❄️ Genel Seri Dondurma Jetonları';
        const html = `
            <div style="font-size: 0.88rem; color: var(--text-primary); text-align: left; display: flex; flex-direction: column; gap: 0.85rem;">
                <div style="background: rgba(56, 189, 248, 0.08); padding: 0.75rem 0.9rem; border-radius: 8px; border-left: 3px solid var(--ice-blue, #38bdf8);">
                    <strong style="color: var(--ice-blue, #38bdf8); font-size: 0.92rem;">❄️ 1. Jeton (Kar Tanesi - Hediye Jeton)</strong>
                    <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); line-height: 1.45;">
                        İlk dondurma jetonunuz uygulamaya başlarken <strong>bir kereliğe mahsus hediye</strong> olarak verilir. Soru çözemediğiniz bir günde serinizi sıfırlanmaktan korur.
                    </p>
                </div>

                <div style="background: rgba(249, 115, 22, 0.08); padding: 0.75rem 0.9rem; border-radius: 8px; border-left: 3px solid #f97316;">
                    <strong style="color: #f97316; font-size: 0.92rem;">🔥 2. Jeton (Süper / Joker Jeton - Kar Tanesi & Alev)</strong>
                    <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); line-height: 1.45;">
                        İkinci jeton bir <strong>Joker Jeton</strong>'dur. Hem normal serinizde hem de özel odak serinizde seri koruma hakkı olarak kullanılabilir!
                    </p>
                </div>

                <div>
                    <strong style="display: flex; align-items: center; gap: 0.35rem; margin-bottom: 0.35rem;">
                        🏆 Genel Seri Jeton Kazanım Şartları:
                    </strong>
                    <ul style="margin: 0; padding-left: 1.2rem; color: var(--text-secondary); line-height: 1.5; font-size: 0.84rem;">
                        <li><strong>1. Jeton (Kar Tanesi):</strong> Başlangıçta 1 defalık hediye (Tüketilirse: 7 gün seri + %70 FSRS başarısı ile tekrar kazanılır).</li>
                        <li><strong>2. Jeton (Süper / Joker):</strong> Son 14 günde kesintisiz seri + %80 FSRS başarısı ile kazanılır.</li>
                    </ul>
                </div>
            </div>
        `;
        openInfoPopupModal(title, html);
    } else {
        const title = '❄️ Odak Serisi Dondurma Jetonları';
        const html = `
            <div style="font-size: 0.88rem; color: var(--text-primary); text-align: left; display: flex; flex-direction: column; gap: 0.85rem;">
                <div style="background: rgba(56, 189, 248, 0.08); padding: 0.75rem 0.9rem; border-radius: 8px; border-left: 3px solid var(--ice-blue, #38bdf8);">
                    <strong style="color: var(--ice-blue, #38bdf8); font-size: 0.92rem;">❄️ 1. Odak Jetonu (Kar Tanesi - Hediye Jeton)</strong>
                    <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); line-height: 1.45;">
                        İlk odak dondurma jetonunuz <strong>bir kereliğe mahsus hediye</strong> olarak verilir. Seçili odak kaynaklarınızdan soru çözemediğiniz bir günde odak serinizi korur.
                    </p>
                </div>

                <div style="background: rgba(249, 115, 22, 0.08); padding: 0.75rem 0.9rem; border-radius: 8px; border-left: 3px solid #f97316;">
                    <strong style="color: #f97316; font-size: 0.92rem;">🔥 2. Odak Jetonu (Süper / Joker Jeton - Kar Tanesi & Alev)</strong>
                    <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); line-height: 1.45;">
                        İkinci odak jetonunuz bir <strong>Joker Jeton</strong>'dur. Hem özel odak serinizde hem de normal serinizde ortak seri koruma hakkı olarak kullanılabilir!
                    </p>
                </div>

                <div>
                    <strong style="display: flex; align-items: center; gap: 0.35rem; margin-bottom: 0.35rem;">
                        🏆 Odak Serisi Jeton Kazanım Şartları:
                    </strong>
                    <ul style="margin: 0; padding-left: 1.2rem; color: var(--text-secondary); line-height: 1.5; font-size: 0.84rem;">
                        <li><strong>1. Jeton (Kar Tanesi):</strong> Başlangıçta 1 defalık hediye (Tüketilirse: 7 gün kesintisiz Odak Serisi ile tekrar kazanılır).</li>
                        <li><strong>2. Jeton (Süper / Joker):</strong> Son 14 günde kesintisiz Odak Serisi tamamlanarak kazanılır.</li>
                    </ul>
                </div>
            </div>
        `;
        openInfoPopupModal(title, html);
    }
}
