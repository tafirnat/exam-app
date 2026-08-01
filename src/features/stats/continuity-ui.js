import { AppState, liveSources, saveContinuityConfig } from '../../core/state.js';
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
    getLiveFocusSources,
    getFocusSourceLabel,
    calculateFocusTargetDistribution
} from './continuity-engine.js';
import { buildQuestionPool } from '../test/test-engine.js';
import { buildStreakRun, prepareStreakRun, resolveStreakCount } from './streak-run.js';
import { renderSourcePicker } from '../sources/sources-ui.js';
import { showToast, showAlert } from '../../core/utils.js';
import { t } from '../../core/i18n.js';

let carouselTimer = null;
let currentSlideIndex = 0;

export function renderContinuityBlock() {
    renderGlobalCharts();
    
    const wrapper = document.getElementById('continuityCarouselWrapper');
    if (!wrapper) return;
    
    // The whole library, not just the active sources: the Genel Seri is
    // source-independent, so its target must be measured over everything the
    // streak run can actually draw from.
    const liveQ = buildQuestionPool({ scope: 'all' });
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
    bindStreakRunModalEvents();
}

/* ------------------------------------------------------------------ */
/* Streak run: one tap from a card into the questions FSRS wants today */
/* ------------------------------------------------------------------ */

export const STREAK_ORDERS = ['mixed', 'grouped'];

/**
 * The remembered presentation mode. Null until the user has picked one, which
 * is what makes the first tap open the picker and every later tap start
 * immediately - the promise of the feature is a single tap, so the popup must
 * not become a daily toll.
 */
export function getStreakOrder() {
    const stored = AppState.continuityConfig?.streakRunOrder;
    return STREAK_ORDERS.includes(stored) ? stored : null;
}

function setStreakOrder(order) {
    if (!STREAK_ORDERS.includes(order)) return;
    if (!AppState.continuityConfig) AppState.continuityConfig = {};
    AppState.continuityConfig.streakRunOrder = order;
    saveContinuityConfig();
}

/** The session size the user already configured for manual tests. */
function readQuestionCountPreference() {
    const el = document.getElementById('questionCount');
    return resolveStreakCount(el ? el.value : undefined);
}

/**
 * Label and availability for one card's run button. The count is the real
 * length of the run that would start, so the button never promises questions
 * that are not there.
 */
export function describeStreakRun(scope) {
    const available = buildStreakRun({
        scope,
        order: getStreakOrder() || 'mixed',
        count: readQuestionCountPreference()
    }).length;

    if (available === 0) {
        return { available, enabled: false, label: 'Tekrar bekleyen soru yok' };
    }

    const todayAct = initTodayActivity();
    const met = scope === 'focus'
        ? isFocusActivityRequirementMet(todayAct)
        : isActivityRequirementMet(todayAct);

    // Once the day is safe the button keeps working; it just stops claiming to
    // be rescuing a streak that is already secured.
    return {
        available,
        enabled: true,
        label: met ? `FSRS ile Çalış (${available})` : `Seriyi Koru (${available})`
    };
}

function renderStreakRunButton(scope) {
    const prefix = scope === 'focus' ? 'focus' : 'global';
    const btn = document.getElementById(`${prefix}StreakRunBtn`);
    const modeBtn = document.getElementById(`${prefix}StreakModeBtn`);
    const label = document.getElementById(`${prefix}StreakRunLabel`);
    if (!btn || !label) return;

    const state = describeStreakRun(scope);
    label.textContent = state.label;
    btn.disabled = !state.enabled;
    if (modeBtn) modeBtn.disabled = !state.enabled;
}

function startStreakRun(scope, order) {
    const started = prepareStreakRun({
        scope,
        order,
        count: readQuestionCountPreference()
    });

    if (!started) {
        showToast('Bugün tekrar bekleyen soru yok');
        return;
    }

    closeStreakRunModal();
    // The view switch lives in main.js; a card must not reach into it directly.
    window.dispatchEvent(new CustomEvent('streak-run-started', { detail: { scope, order } }));
}

function handleStreakRunClick(scope) {
    const order = getStreakOrder();
    if (!order) {
        openStreakRunModal(scope);
        return;
    }
    startStreakRun(scope, order);
}

let pendingStreakScope = 'global';

function openStreakRunModal(scope) {
    pendingStreakScope = scope;
    const modal = document.getElementById('streakRunModal');
    if (!modal) return;

    const subtitle = document.getElementById('streakRunModalSubtitle');
    if (subtitle) {
        const state = describeStreakRun(scope);
        subtitle.textContent = scope === 'focus'
            ? `Odak Seri · ${state.available} soru hazır`
            : `Genel Seri · ${state.available} soru hazır`;
    }

    const current = getStreakOrder();
    modal.querySelectorAll('[data-streak-order]').forEach(el => {
        el.classList.toggle('active', el.dataset.streakOrder === current);
    });

    modal.style.display = 'flex';
}

function closeStreakRunModal() {
    const modal = document.getElementById('streakRunModal');
    if (modal) modal.style.display = 'none';
}

function bindStreakRunModalEvents() {
    const modal = document.getElementById('streakRunModal');
    if (!modal || modal.dataset.bound) return;
    modal.dataset.bound = 'true';

    const closeBtn = document.getElementById('streakRunModalCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', () => closeStreakRunModal());

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeStreakRunModal();
            return;
        }
        const option = e.target.closest('[data-streak-order]');
        if (!option) return;
        const order = option.dataset.streakOrder;
        setStreakOrder(order);
        startStreakRun(pendingStreakScope, order);
    });
}

function renderGlobalSlide(liveQ) {
    const card = document.getElementById('continuityCard');
    if (!card) return;

    // Streak
    const streak = calculateGlobalStreak();
    updateStreakCountDisplay('continuityStreakCount', streak);
    
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
    
    const stats7 = getFsrsStatsForRange(7);
    const stats14 = getFsrsStatsForRange(14);

    tokensEl.title = `Kalan Dondurma: 0/2 (Test Modu: Pasif)\n` +
        `• 1. Mavi Kar Tanesi: Pasif\n` +
        `• 2. Kızıl Kar Tanesi: Pasif`;

    for (let i = 0; i < 2; i++) {
        const isActive = false;
        const svg = createTokenSvg(i, isActive);
        tokensEl.appendChild(svg);
    }

    renderStreakRunButton('global');
}

function renderFocusSlide() {
    const card = document.getElementById('focusContinuityCard');
    if (!card) return;

    const focusStreak = calculateFocusStreak();
    updateStreakCountDisplay('focusStreakCount', focusStreak);

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

        // Names come from the snapshot when a source is gone, so the card keeps
        // describing the streak instead of falling back to a raw id.
        const liveFocusSources = getLiveFocusSources();
        const selectedNames = focusSources
            .map(id => {
                const label = getFocusSourceLabel(id);
                return liveFocusSources.includes(id) ? label : `${label} (kaynak yok)`;
            })
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
    const stats7 = getFocusStatsForRange(7);
    const stats14 = getFocusStatsForRange(14);

    tokensEl.title = `Kalan Odak Dondurma: 2/2 (Test Modu: Aktif)\n` +
        `• 1. Mavi Kar Tanesi: Aktif\n` +
        `• 2. Kızıl Kar Tanesi: Aktif`;

    for (let i = 0; i < 2; i++) {
        const isActive = true;
        const svg = createTokenSvg(i, isActive);
        tokensEl.appendChild(svg);
    }

    renderStreakRunButton('focus');
}

// Gradient ids have to be unique per rendered icon or the first <defs> in the
let tokenGradientSeq = 0;

export function getSnowflakeSvgHtml(tokenIndex, active = true, width = 24, height = 24, customClass = '') {
    const mainBodyD = "M7530 15750 c-46 -24 -90 -67 -115 -110 -28 -52 -26 -179 5 -240 55 -109 97 -154 905 -960 l335 -335 0 -448 c0 -386 -2 -448 -14 -445 -11 2 -700 674 -1035 1009 -39 39 -130 99 -179 118 -99 39 -182 21 -257 -56 -43 -45 -50 -67 -49 -163 1 -107 41 -182 189 -356 58 -68 83 -98 163 -193 101 -120 412 -484 461 -541 64 -73 220 -249 235 -266 237 -251 366 -407 396 -475 5 -13 14 -31 18 -39 24 -42 34 -65 51 -122 40 -130 46 -180 45 -358 -1 -96 -2 -579 -3 -1072 l-2 -898 -33 -25 c-42 -32 -61 -32 -95 3 -25 24 -296 286 -681 657 -74 72 -160 155 -191 185 -31 30 -168 163 -305 295 -137 132 -312 301 -389 375 -77 75 -170 164 -207 200 -55 52 -68 69 -68 94 0 17 -6 90 -15 161 -8 72 -21 202 -30 290 -8 88 -20 203 -26 255 -6 52 -14 140 -19 195 -4 55 -12 143 -18 195 -6 52 -18 167 -27 255 -19 190 -40 382 -56 520 -6 55 -15 138 -19 185 -14 154 -78 328 -151 407 -51 55 -93 73 -169 73 -73 0 -120 -19 -162 -67 -46 -51 -47 -62 -41 -953 6 -803 5 -840 -12 -840 -10 0 -39 21 -65 48 -156 156 -750 726 -761 730 -25 9 -40 70 -49 194 -9 132 -17 205 -46 448 -8 69 -14 143 -14 165 0 22 -7 78 -15 125 -8 47 -15 104 -15 128 0 24 -6 87 -14 140 -8 53 -22 151 -31 217 -37 279 -69 450 -99 525 -51 131 -189 194 -307 140 -60 -27 -84 -48 -108 -96 -37 -71 -44 -142 -27 -260 9 -57 16 -121 16 -142 0 -20 6 -84 15 -142 8 -58 21 -168 29 -245 9 -77 20 -187 27 -245 6 -58 15 -152 19 -210 5 -58 14 -139 19 -180 6 -41 12 -129 14 -195 2 -112 0 -122 -21 -151 -45 -60 -75 -61 -382 -18 -58 8 -118 14 -135 14 -16 0 -77 6 -135 15 -58 8 -161 21 -230 30 -69 9 -174 22 -235 30 -60 8 -135 16 -165 19 -30 3 -84 10 -120 16 -113 17 -235 13 -280 -10 -83 -42 -130 -150 -108 -248 10 -44 20 -61 61 -98 92 -82 184 -113 442 -145 44 -5 96 -14 115 -19 19 -6 50 -10 69 -10 19 0 73 -7 120 -14 148 -25 234 -38 301 -46 63 -8 113 -15 305 -45 134 -21 326 -45 360 -45 40 0 116 -25 194 -63 47 -24 81 -51 130 -107 36 -41 202 -209 369 -373 166 -165 302 -306 302 -313 0 -19 -178 -18 -710 1 -701 25 -829 20 -926 -37 -85 -50 -104 -171 -44 -270 18 -29 42 -63 54 -74 56 -57 198 -114 282 -114 21 0 95 -6 164 -14 166 -20 323 -36 445 -46 55 -4 143 -13 195 -19 52 -6 140 -15 195 -22 55 -6 145 -15 200 -19 124 -10 282 -26 440 -46 66 -8 140 -14 165 -15 66 0 269 -34 310 -52 59 -26 112 -73 525 -472 28 -27 96 -93 151 -145 55 -52 214 -205 354 -340 139 -135 326 -315 414 -400 89 -85 203 -195 254 -245 82 -79 142 -162 142 -196 0 -5 -475 -9 -1193 -9 -1123 0 -1193 1 -1208 18 -9 9 -37 35 -64 57 -27 22 -97 81 -155 130 -58 50 -132 113 -165 140 -33 28 -71 60 -85 71 -59 51 -261 222 -305 259 -62 52 -102 86 -195 165 -42 36 -108 90 -145 120 -37 30 -75 62 -84 71 -9 8 -45 37 -81 64 -36 27 -67 52 -70 56 -6 8 -274 208 -356 265 -119 83 -193 100 -288 67 -103 -37 -155 -122 -142 -232 14 -116 22 -125 667 -752 355 -344 441 -424 476 -441 16 -7 29 -23 31 -36 l3 -22 -484 0 -485 0 -40 53 c-22 29 -176 188 -343 354 -642 637 -704 691 -900 789 -124 62 -213 39 -303 -79 -21 -28 -26 -45 -26 -95 0 -109 -15 -92 610 -721 379 -381 502 -511 564 -597 13 -17 12 -23 -11 -52 -48 -64 -122 -140 -529 -552 -656 -663 -634 -637 -634 -730 0 -98 78 -193 168 -205 47 -6 135 6 169 23 10 5 36 17 58 28 125 58 324 248 945 904 221 233 277 290 287 290 4 0 217 0 473 0 400 1 465 -1 465 -14 0 -12 -353 -378 -785 -815 -169 -171 -278 -292 -325 -363 -48 -70 -49 -73 -49 -152 -1 -94 15 -131 76 -171 32 -21 49 -25 118 -25 88 0 164 21 247 66 41 23 117 76 133 94 3 3 30 25 60 50 30 25 57 47 60 51 3 3 50 43 105 89 55 46 105 89 111 94 6 6 32 29 59 51 40 33 209 178 850 727 17 15 66 57 110 94 44 38 82 71 85 74 3 3 34 30 70 60 36 30 78 67 94 82 l30 28 1131 0 c1065 0 1133 -1 1147 -17 37 -42 33 -61 -24 -116 -337 -329 -704 -685 -757 -736 -36 -35 -133 -130 -216 -210 -82 -81 -287 -280 -455 -443 -168 -163 -307 -299 -310 -302 -7 -7 -154 -26 -280 -36 -58 -4 -150 -13 -205 -20 -55 -6 -161 -18 -235 -26 -549 -61 -665 -74 -795 -89 -66 -8 -181 -21 -255 -30 -74 -9 -180 -22 -235 -30 -55 -9 -114 -15 -131 -15 -36 0 -121 -24 -174 -49 -95 -44 -156 -121 -176 -221 -16 -80 -4 -112 56 -149 28 -17 56 -31 63 -31 7 0 23 -7 36 -17 22 -15 69 -16 585 -7 309 5 647 9 751 9 184 0 190 -1 193 -20 3 -19 -155 -179 -688 -695 -43 -42 -95 -83 -116 -92 -42 -17 -228 -48 -291 -48 -22 0 -65 -5 -94 -10 -30 -6 -99 -15 -154 -20 -95 -8 -159 -16 -347 -41 -46 -6 -121 -14 -168 -19 -250 -22 -579 -76 -648 -106 -18 -8 -41 -14 -50 -14 -10 0 -27 -7 -38 -15 -10 -8 -27 -15 -36 -15 -23 0 -82 -53 -109 -97 -18 -28 -22 -51 -22 -107 0 -103 36 -164 119 -200 36 -15 62 -17 185 -13 79 2 180 9 224 15 44 6 143 18 220 27 77 8 199 22 270 30 72 8 193 21 270 30 77 8 205 22 285 31 144 17 146 17 186 -4 59 -30 71 -74 56 -200 -7 -53 -12 -115 -12 -137 0 -41 -19 -229 -46 -455 -8 -69 -14 -143 -14 -165 0 -22 -7 -94 -15 -160 -37 -292 -45 -367 -51 -480 -7 -139 3 -190 46 -233 49 -49 103 -72 171 -72 121 0 184 59 252 235 17 44 38 172 62 390 9 77 21 176 27 220 6 44 14 118 18 165 10 111 35 325 71 595 6 50 15 128 19 175 10 115 29 196 59 250 15 28 152 172 360 378 395 392 439 432 452 411 5 -8 9 -301 9 -688 0 -728 5 -815 48 -884 67 -109 231 -98 354 24 32 32 62 68 68 81 5 12 14 30 19 38 15 27 33 84 37 120 11 94 36 319 49 435 8 72 19 175 26 230 6 55 15 143 19 195 4 52 13 138 19 190 12 93 27 229 56 492 8 73 21 192 30 263 8 72 15 140 15 152 0 12 12 48 27 80 33 70 64 101 1057 1068 186 182 376 366 421 410 44 44 152 149 237 233 86 83 160 152 165 152 4 0 14 -10 21 -21 38 -60 39 -100 46 -1136 7 -939 6 -1017 -10 -1075 -9 -35 -23 -70 -31 -79 -7 -8 -13 -19 -13 -24 0 -8 -49 -70 -92 -117 -14 -14 -81 -91 -149 -170 -68 -78 -128 -147 -135 -153 -6 -5 -53 -59 -105 -120 -51 -60 -99 -114 -105 -120 -6 -5 -94 -107 -195 -225 -100 -118 -186 -217 -189 -220 -3 -3 -30 -34 -59 -70 -30 -36 -60 -69 -66 -75 -6 -5 -49 -55 -95 -110 -47 -55 -95 -111 -108 -125 -43 -46 -137 -174 -153 -210 -47 -102 -54 -126 -54 -200 0 -71 2 -79 33 -118 47 -58 117 -81 199 -63 85 18 161 53 228 105 63 48 159 141 627 607 241 239 440 433 443 431 3 -3 5 -197 5 -431 l0 -425 -147 -151 c-82 -82 -349 -353 -594 -600 -245 -248 -453 -464 -461 -480 -57 -107 -60 -118 -61 -215 -2 -127 23 -174 120 -224 85 -43 175 -4 343 149 61 55 497 476 674 650 40 40 251 236 374 348 58 52 65 56 83 44 42 -30 148 -131 673 -642 494 -482 531 -515 604 -546 54 -23 80 -24 134 -2 166 65 194 198 84 408 -39 74 -94 135 -475 525 -191 195 -401 411 -466 480 -66 69 -129 134 -140 145 -11 12 -44 46 -72 77 l-53 57 0 410 c0 371 2 411 16 411 9 0 106 -89 215 -198 766 -758 845 -834 914 -883 50 -35 138 -69 179 -69 33 0 123 46 152 77 32 34 64 105 64 141 -1 71 -70 219 -152 324 -23 29 -44 55 -48 58 -5 4 -196 226 -456 529 -88 102 -122 142 -174 201 -32 36 -70 81 -86 100 -16 19 -31 37 -34 40 -3 3 -102 117 -220 255 -118 137 -221 257 -230 266 -8 8 -40 46 -70 83 -97 119 -89 9 -89 1202 l-1 1050 26 53 c15 29 32 55 40 58 7 2 30 -13 51 -34 21 -21 198 -194 393 -383 195 -190 387 -376 426 -415 151 -149 873 -854 943 -921 71 -68 74 -73 87 -140 7 -38 13 -91 14 -119 0 -45 10 -131 41 -375 7 -47 15 -123 19 -170 5 -47 13 -121 19 -165 5 -44 15 -118 22 -165 6 -47 14 -121 19 -165 4 -44 13 -118 19 -165 6 -47 18 -137 27 -200 8 -63 19 -146 25 -185 6 -38 15 -104 19 -145 28 -240 84 -360 209 -447 39 -28 55 -32 107 -33 80 0 128 33 170 116 l29 59 -2 555 c-2 305 -6 642 -9 747 -6 166 -4 193 9 198 15 7 228 -195 602 -569 136 -136 209 -218 228 -253 29 -55 53 -162 66 -303 5 -47 14 -123 20 -170 6 -47 18 -148 26 -225 33 -296 46 -413 56 -485 6 -41 15 -111 19 -155 15 -155 58 -409 77 -460 63 -163 130 -225 244 -225 76 0 144 33 190 92 l34 42 -2 146 c-1 80 -9 192 -17 249 -9 58 -16 126 -16 151 0 26 -5 72 -11 101 -5 30 -14 101 -19 159 -4 58 -13 148 -19 200 -6 52 -17 158 -26 235 -8 77 -15 160 -15 185 0 25 -7 101 -17 169 l-17 124 23 18 c13 11 32 19 42 19 10 0 38 5 63 12 46 12 199 4 471 -27 72 -8 195 -21 275 -30 80 -8 190 -22 245 -30 55 -9 119 -15 142 -15 23 0 77 -7 120 -15 43 -8 127 -15 186 -15 95 0 114 3 156 25 133 67 161 224 61 338 -63 71 -195 125 -350 142 -66 7 -237 30 -375 50 -55 8 -113 15 -130 15 -16 0 -75 7 -130 15 -55 8 -163 22 -240 30 -77 9 -192 22 -255 30 -63 8 -128 15 -144 15 -57 0 -249 51 -306 82 -105 56 -224 163 -537 481 -138 140 -257 265 -263 278 l-12 22 263 -7 c145 -3 489 -9 765 -13 560 -7 551 -8 641 64 48 38 60 75 48 150 -6 40 -16 56 -73 113 -93 93 -209 149 -312 150 -25 0 -81 7 -125 15 -44 8 -96 15 -115 15 -19 0 -80 6 -135 14 -55 9 -163 22 -240 31 -77 9 -198 23 -270 31 -71 8 -168 20 -215 26 -47 6 -125 14 -175 18 -49 4 -135 13 -190 19 -302 35 -356 41 -425 47 -111 8 -187 29 -246 66 -43 27 -205 180 -628 593 -23 22 -160 155 -306 295 -146 140 -283 273 -306 295 -23 22 -152 147 -288 279 -175 169 -246 245 -246 260 0 13 10 32 23 44 l23 22 1125 0 1124 0 95 -81 c52 -45 111 -96 130 -113 19 -18 67 -59 105 -91 39 -32 72 -62 75 -65 3 -3 70 -62 150 -130 80 -69 150 -129 155 -135 6 -6 39 -36 75 -66 36 -29 67 -56 70 -59 4 -5 409 -354 525 -453 305 -260 313 -266 385 -299 192 -90 288 -89 379 4 50 51 54 190 9 281 -14 28 -207 227 -589 608 -313 312 -569 572 -569 578 0 6 3 11 8 12 69 5 784 8 829 3 70 -8 21 34 424 -354 118 -113 266 -255 329 -315 63 -61 160 -154 215 -207 219 -212 366 -338 426 -367 99 -47 206 -36 280 28 74 63 98 151 62 229 -39 85 -68 117 -583 642 -241 245 -456 468 -479 495 -24 28 -54 63 -67 79 -13 15 -24 38 -24 50 0 24 -1 22 661 696 257 261 476 486 486 500 11 14 27 45 37 69 15 40 16 47 1 91 -19 58 -74 124 -126 150 -88 45 -190 18 -374 -101 -82 -53 -606 -560 -955 -925 -135 -141 -187 -173 -328 -199 -83 -16 -110 -17 -245 -6 -84 6 -218 11 -299 11 -177 0 -178 1 -85 99 34 37 114 122 177 191 136 146 111 119 240 260 58 63 133 144 167 180 218 229 367 400 400 458 110 194 -58 361 -299 298 -77 -20 -145 -61 -270 -162 -60 -49 -127 -103 -149 -120 -51 -41 -129 -106 -143 -119 -6 -6 -33 -28 -61 -50 -27 -22 -198 -164 -379 -315 -181 -151 -345 -287 -364 -303 -20 -15 -39 -31 -42 -35 -3 -4 -34 -32 -70 -62 -36 -30 -88 -76 -117 -101 -95 -85 -203 -148 -323 -190 l-65 -22 -1083 -1 c-1062 -1 -1084 -1 -1098 18 -26 36 -17 66 34 115 26 25 173 168 326 316 153 149 306 297 340 330 34 33 158 152 276 265 118 113 240 230 271 260 122 120 436 419 464 442 65 54 141 79 294 99 136 17 206 25 621 64 85 9 216 22 290 30 74 8 158 15 185 15 28 0 93 7 145 15 52 8 120 15 151 15 30 0 80 4 110 10 30 5 99 14 154 20 125 12 203 26 325 57 52 14 106 27 120 30 45 10 116 64 150 115 31 45 34 55 34 127 0 120 -36 163 -159 196 -50 13 -155 14 -786 8 -656 -6 -729 -5 -734 9 -5 12 101 124 367 388 205 205 389 383 408 395 41 27 241 63 468 85 51 5 97 12 102 15 5 3 51 10 102 14 51 5 126 14 166 20 39 6 105 16 145 22 39 6 106 15 147 19 312 33 619 101 758 169 55 26 112 112 112 167 0 47 -30 131 -59 163 -53 59 -91 71 -227 71 -67 0 -146 -5 -175 -11 -30 -5 -97 -14 -149 -19 -110 -10 -243 -25 -350 -41 -41 -6 -115 -15 -165 -19 -103 -10 -231 -24 -390 -45 -194 -26 -267 -17 -297 38 -15 27 -13 221 3 341 5 45 14 133 19 196 4 63 13 160 20 215 6 55 18 161 26 235 18 162 37 323 58 485 20 150 20 171 -1 234 -41 129 -192 196 -316 141 -43 -19 -92 -69 -125 -129 -20 -34 -51 -160 -52 -204 0 -21 -7 -84 -15 -140 -26 -174 -45 -310 -49 -357 -2 -25 -9 -83 -15 -130 -7 -47 -18 -137 -26 -200 -8 -63 -21 -169 -29 -235 -9 -66 -16 -138 -16 -160 0 -60 -29 -271 -47 -340 -37 -144 -106 -252 -228 -361 -190 -168 -335 -304 -523 -491 -62 -62 -117 -113 -122 -113 -14 0 -15 84 -7 737 9 755 6 932 -21 984 -54 106 -105 143 -198 142 -57 0 -67 -4 -112 -39 -47 -37 -101 -111 -131 -178 -21 -49 -51 -177 -51 -221 0 -43 -22 -249 -46 -430 -8 -60 -14 -128 -14 -150 0 -22 -6 -96 -15 -165 -8 -69 -21 -190 -30 -270 -8 -80 -22 -199 -30 -265 -9 -66 -15 -133 -15 -150 0 -16 -6 -84 -15 -150 -16 -130 -42 -356 -49 -421 -2 -22 -16 -67 -31 -100 -32 -69 -81 -119 -1174 -1184 -184 -179 -373 -363 -420 -410 -182 -178 -259 -250 -268 -250 -6 0 -26 16 -46 35 l-37 36 0 1184 0 1184 66 78 c36 43 76 89 88 103 226 259 1238 1447 1282 1505 72 95 79 108 105 187 23 73 23 77 3 149 -51 180 -268 210 -446 62 -24 -19 -140 -130 -258 -247 -118 -117 -294 -286 -390 -376 -195 -183 -326 -308 -375 -357 -18 -18 -39 -33 -49 -33 -15 0 -16 34 -16 381 0 395 1 401 44 443 12 12 66 68 121 126 100 104 457 479 505 529 14 14 61 64 105 111 43 47 122 130 175 186 147 156 173 185 221 249 110 146 134 211 116 307 -13 73 -65 137 -134 168 -106 47 -167 19 -369 -166 -18 -16 -184 -178 -370 -360 -656 -640 -672 -654 -711 -654 -10 0 -47 26 -83 58 -59 51 -459 431 -570 540 -179 176 -495 478 -540 517 -98 82 -178 104 -250 65z";

    const seq = ++tokenGradientSeq;
    const gradientId = `snowflakeGrad_${tokenIndex}_${seq}`;

    let stopStart, stopEnd, dropShadowColor;
    if (tokenIndex === 1) {
        // Kızıl Kar Tanesi (Flame Crimson to Golden Orange Gradient)
        stopStart = active ? '#ff4c0d' : '#94a3b8';
        stopEnd = active ? '#fc9502' : '#64748b';
        dropShadowColor = 'rgba(239, 68, 68, 0.9)';
    } else {
        // Mavi Kar Tanesi (Ice Sky Blue to Deep Cyan Gradient)
        stopStart = active ? '#7dd3fc' : '#94a3b8';
        stopEnd = active ? '#0284c7' : '#64748b';
        dropShadowColor = 'rgba(56, 189, 248, 0.85)';
    }

    const filterStyle = active ? `filter: drop-shadow(0 0 5px ${dropShadowColor});` : '';
    const opacityStyle = active ? 'opacity: 1;' : 'opacity: 0.38;';
    const classAttr = customClass ? `class="${customClass}"` : 'class="continuity-token-icon"';

    return `<svg viewBox="0 0 1800 1800" width="${width}" height="${height}" ${classAttr} style="vertical-align: middle; display: inline-block; cursor: pointer; ${opacityStyle} ${filterStyle}">` +
        `<defs>` +
            `<linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">` +
                `<stop offset="0%" stop-color="${stopStart}"/>` +
                `<stop offset="100%" stop-color="${stopEnd}"/>` +
            `</linearGradient>` +
        `</defs>` +
        `<g transform="translate(0.000000,1800.000000) scale(0.100000,-0.100000)" stroke="none">` +
            `<path d="${mainBodyD}" fill="url(#${gradientId})"/>` +
        `</g>` +
    `</svg>`;
}

function updateStreakCountDisplay(elementId, count) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = count;
    const len = String(count).length;
    if (len >= 3) {
        el.style.fontSize = '0.98rem';
    } else if (len === 2) {
        el.style.fontSize = '1.16rem';
    } else {
        el.style.fontSize = '1.28rem';
    }
}

function createTokenSvg(tokenIndex, active) {
    const span = document.createElement('span');
    span.setAttribute('data-token-index', tokenIndex);
    span.setAttribute('class', 'continuity-icon-btn continuity-token-icon');
    span.style.cursor = 'pointer';
    span.style.display = 'inline-flex';
    span.style.alignItems = 'center';
    span.style.justifyContent = 'center';

    const tokenLabel = tokenIndex === 1
        ? `2. Kızıl Kar Tanesi — ${active ? 'Aktif' : 'Pasif'}`
        : `1. Mavi Kar Tanesi — ${active ? 'Aktif' : 'Pasif'}`;

    span.title = tokenLabel;
    span.innerHTML = getSnowflakeSvgHtml(tokenIndex, active, 24, 24);
    return span;
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

    // The info buttons are handled by the card-level delegation in
    // bindContinuityModalEvents, so nothing extra is wired here.

    startTimer();
}

function bindFocusModalEvents() {
    const openBtn = document.getElementById('openFocusSourceModalBtn');
    const modal = document.getElementById('focusSourceModal');
    const closeBtn = document.getElementById('focusSourceModalCloseBtn');

    if (openBtn && !openBtn.dataset.bound) {
        openBtn.dataset.bound = 'true';
        openBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openFocusSourceModal();
        });
    }

    if (closeBtn && !closeBtn.dataset.bound) {
        closeBtn.dataset.bound = 'true';
        closeBtn.addEventListener('click', () => closeFocusSourceModal());
    }

    if (modal && !modal.dataset.backdropBound) {
        modal.dataset.backdropBound = 'true';
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeFocusSourceModal();
        });
    }
}

/**
 * Closing IS the commit: there is no save button, so whatever is ticked at this
 * moment becomes the selection. Runs exactly once per open - the handle is
 * dropped first, so a backdrop click landing after the X button cannot save a
 * second time.
 */
function closeFocusSourceModal() {
    const modal = document.getElementById('focusSourceModal');
    if (modal) modal.style.display = 'none';

    const handle = focusPickerHandle;
    focusPickerHandle = null;
    if (!handle) return;

    const previous = getFocusSources();
    const selectedIds = handle.getSelected().slice(0, MAX_FOCUS_SOURCES);
    const changed =
        previous.length !== selectedIds.length ||
        selectedIds.some(id => !previous.includes(id));

    saveFocusSourceSelection(selectedIds);
    renderFocusSlide();
    if (changed) showToast('Odak Seri kaynakları güncellendi');
}

/**
 * Every element on a continuity card owns its own explanation: the ring shows
 * progress, the overdue line shows how the daily target was derived, the tokens
 * show freeze rules. The general series guide belongs to the "i" button alone -
 * the card title and the empty space around the widgets stay inert, so brushing
 * the card no longer throws the guide over whatever the user was reading.
 */
function bindContinuityModalEvents() {
    const cardGlobal = document.getElementById('continuityCard');
    if (cardGlobal && !cardGlobal.dataset.bound) {
        cardGlobal.dataset.bound = 'true';
        cardGlobal.addEventListener('click', (e) => {
            // Checked first: the run controls sit inside the card, and every
            // other branch below opens an explanatory modal instead.
            if (e.target.closest('#globalStreakModeBtn')) {
                e.stopPropagation();
                openStreakRunModal('global');
                return;
            }
            if (e.target.closest('#globalStreakRunBtn')) {
                e.stopPropagation();
                handleStreakRunClick('global');
                return;
            }
            const tokenSvg = e.target.closest('[data-token-index]');
            if (tokenSvg) {
                e.stopPropagation();
                const tokenIndex = parseInt(tokenSvg.getAttribute('data-token-index'), 10);
                showSingleTokenModal('global', tokenIndex);
                return;
            }
            if (e.target.closest('#continuityTokens')) {
                e.stopPropagation();
                showFreezeTokenModal('global');
                return;
            }
            if (e.target.closest('#globalRingContainer')) {
                e.stopPropagation();
                showContinuityProgressModal('global');
                return;
            }
            if (e.target.closest('#continuityOverdueText')) {
                e.stopPropagation();
                showContinuityTargetModal('global');
                return;
            }
            if (e.target.closest('#continuityInfoBtn')) {
                e.stopPropagation();
                showContinuityInfoModal('global');
                return;
            }
        });
    }

    const cardFocus = document.getElementById('focusContinuityCard');
    if (cardFocus && !cardFocus.dataset.bound) {
        cardFocus.dataset.bound = 'true';
        cardFocus.addEventListener('click', (e) => {
            if (e.target.closest('#focusStreakModeBtn')) {
                e.stopPropagation();
                openStreakRunModal('focus');
                return;
            }
            if (e.target.closest('#focusStreakRunBtn')) {
                e.stopPropagation();
                handleStreakRunClick('focus');
                return;
            }
            if (e.target.closest('#openFocusSourceModalBtn')) {
                e.stopPropagation();
                openFocusSourceModal();
                return;
            }
            const tokenSvg = e.target.closest('[data-token-index]');
            if (tokenSvg) {
                e.stopPropagation();
                const tokenIndex = parseInt(tokenSvg.getAttribute('data-token-index'), 10);
                showSingleTokenModal('focus', tokenIndex);
                return;
            }
            if (e.target.closest('#focusContinuityTokens')) {
                e.stopPropagation();
                showFreezeTokenModal('focus');
                return;
            }
            if (e.target.closest('#focusRingContainer')) {
                e.stopPropagation();
                showContinuityProgressModal('focus');
                return;
            }
            if (e.target.closest('#focusContinuityOverdueText')) {
                e.stopPropagation();
                showContinuityTargetModal('focus');
                return;
            }
            if (e.target.closest('#focusContinuityInfoBtn')) {
                e.stopPropagation();
                showContinuityInfoModal('focus');
                return;
            }
        });
    }
}

export const MAX_FOCUS_SOURCES = 3;

// Live handle on the open picker; null whenever the popup is closed.
let focusPickerHandle = null;

function updateFocusSelectionCount(count) {
    const countEl = document.getElementById('focusSourceSelectionCount');
    if (countEl) countEl.textContent = `${count} / ${MAX_FOCUS_SOURCES} kaynak seçildi`;
}

function openFocusSourceModal() {
    const modal = document.getElementById('focusSourceModal');
    const listEl = document.getElementById('focusSourceList');
    if (!modal || !listEl) return;

    // Same folder/source layout as the sources screen, selection only - the
    // picker deliberately exposes no folder or source settings.
    focusPickerHandle = renderSourcePicker(listEl, {
        selected: getFocusSources(),
        max: MAX_FOCUS_SOURCES,
        startCollapsed: true,
        onChange: (ids) => updateFocusSelectionCount(ids.length)
    });

    modal.style.display = 'flex';
}

function saveFocusSourceSelection(selectedIds) {
    if (!Array.isArray(selectedIds)) return;

    if (!AppState.continuityConfig) AppState.continuityConfig = {};
    AppState.continuityConfig.focusSources = selectedIds;

    // Names are snapshotted next to the ids so a card can still say which source
    // a streak came from after that source is archived or deleted. The streak
    // itself never depends on this - it lives in studyActivity, keyed by date.
    const names = { ...(AppState.continuityConfig.focusSourceNames || {}) };
    selectedIds.forEach(id => {
        const source = (AppState.sources || []).find(s => s.id === id);
        if (source?.name) names[id] = source.name;
    });
    AppState.continuityConfig.focusSourceNames = names;

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
    const liveQ = buildQuestionPool({ scope: 'all' });
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
    liveSources().forEach(s => {
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
        { label: t('difficulty_easy'), count: diffCounts.easy, color: '#22c55e' },
        { label: t('difficulty_medium'), count: diffCounts.medium, color: '#eab308' },
        { label: t('difficulty_hard'), count: diffCounts.hard, color: '#f97316' },
        { label: t('difficulty_very_hard'), count: diffCounts.veryHard, color: '#ef4444' },
        { label: t('stat_not_solved'), count: diffCounts.unsolved, color: 'var(--text-secondary)' }
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

    // 2. Study Trend (weekly on the card's front face, monthly on its back)
    const activities = AppState.studyActivity || {};
    renderTrendChart(buildWeeklyTrendBuckets(activities), 'trendYAxis', 'trendBars', 'trendXAxis');
    renderTrendChart(buildMonthlyTrendBuckets(activities), 'monthlyTrendYAxis', 'monthlyTrendBars', 'monthlyTrendXAxis');
    bindTrendFlip();
}

/** Wires the flip buttons on both faces of the trend card (once). */
function bindTrendFlip() {
    const card = document.getElementById('homeWeeklyTrendCard');
    if (!card || card.dataset.flipBound) return;
    card.dataset.flipBound = 'true';

    card.querySelectorAll('[data-trend-flip]').forEach(btn => {
        btn.addEventListener('click', () => {
            const flipped = card.classList.toggle('flipped');
            // The hidden face must stay out of the tab order, otherwise focus
            // can land on a button nobody can see.
            card.querySelectorAll('.chart-flip-front [data-trend-flip]').forEach(b => {
                b.tabIndex = flipped ? -1 : 0;
            });
            card.querySelectorAll('.chart-flip-back [data-trend-flip]').forEach(b => {
                b.tabIndex = flipped ? 0 : -1;
            });
        });
    });

    card.querySelectorAll('.chart-flip-back [data-trend-flip]').forEach(b => {
        b.tabIndex = -1;
    });
}

/** One bucket per day for the last 7 days, oldest first. */
export function buildWeeklyTrendBuckets(activities) {
    const numDays = 7;
    const currentDate = new Date();
    currentDate.setDate(currentDate.getDate() - numDays + 1);

    const lang = document.documentElement.lang || 'tr';
    const isTr = lang.startsWith('tr');
    const isDe = lang.startsWith('de');
    const dayLabels = isTr ? ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'] :
                      isDe ? ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] :
                             ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const buckets = [];
    for (let i = 0; i < numDays; i++) {
        const bucket = { label: dayLabels[currentDate.getDay()], correct: 0, wrong: 0, empty: 0, focus: 0, total: 0 };
        addActivityToBucket(bucket, activities[getLocalDateStr(currentDate)]);
        buckets.push(bucket);
        currentDate.setDate(currentDate.getDate() + 1);
    }
    return buckets;
}

/** One bucket per calendar month for the last 6 months, oldest first. */
export function buildMonthlyTrendBuckets(activities) {
    const numMonths = 6;
    const lang = document.documentElement.lang || 'tr';
    const monthFormatter = new Intl.DateTimeFormat(lang, { month: 'short' });

    const today = new Date();
    const buckets = [];
    const bucketByKey = {};

    for (let i = numMonths - 1; i >= 0; i--) {
        const monthDate = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const bucket = {
            label: monthFormatter.format(monthDate),
            correct: 0, wrong: 0, empty: 0, focus: 0, total: 0
        };
        // Keyed by year-month so activity dates land in the right bucket even
        // when the range spans a year boundary.
        bucketByKey[`${monthDate.getFullYear()}-${monthDate.getMonth()}`] = bucket;
        buckets.push(bucket);
    }

    Object.keys(activities).forEach(dateStr => {
        const [y, m] = dateStr.split('-');
        const bucket = bucketByKey[`${Number(y)}-${Number(m) - 1}`];
        if (bucket) addActivityToBucket(bucket, activities[dateStr]);
    });

    return buckets;
}

/** Folds one day's activity record into a bucket's correct/wrong/empty totals. */
function addActivityToBucket(bucket, act) {
    if (!act || !act.studied) return;

    const total = act.questionCount || 0;
    let correct = act.correctCount || 0;
    let wrong = act.wrongCount || 0;
    let empty = act.unansweredCount || 0;

    // Older records only carry a question count; treat those as unanswered so
    // the bar still reflects the day's volume.
    if (total > 0 && correct === 0 && wrong === 0 && empty === 0) {
        empty = total;
    }

    bucket.correct += correct;
    bucket.wrong += wrong;
    bucket.empty += empty;
    bucket.total += total;

    // The focus track only ever counts a subset of the day's questions, so it is
    // clamped to the day's volume - a stale focusQuestionCount must not draw a
    // line above the bar it belongs to.
    bucket.focus += Math.min(act.focusQuestionCount || 0, total);
}

/** Draws the stacked bar chart shared by the weekly and monthly trend faces. */
function renderTrendChart(buckets, yAxisId, barsId, xAxisId) {
    const yAxisEl = document.getElementById(yAxisId);
    const barsEl = document.getElementById(barsId);
    const xAxisEl = document.getElementById(xAxisId);

    if (!yAxisEl || !barsEl || !xAxisEl) return;

    yAxisEl.innerHTML = '';
    barsEl.innerHTML = '';
    xAxisEl.innerHTML = '';

    const maxCount = buckets.reduce((max, b) => Math.max(max, b.total), 0);
    const topLimit = Math.max(10, Math.ceil(maxCount / 5) * 5);

    // Monthly totals run into the hundreds, so the axis gutter grows with the
    // widest tick instead of clipping against the fixed 20px the week needs.
    const labelWidth = Math.max(20, String(topLimit).length * 8);
    const gutter = labelWidth + 5;
    barsEl.style.paddingLeft = `${gutter}px`;
    xAxisEl.style.paddingLeft = `${gutter}px`;
    // The line overlay is absolutely positioned inside the bar strip.
    barsEl.style.position = 'relative';

    for (let i = 0; i <= 5; i++) {
        const val = Math.round((topLimit / 5) * i);
        const line = document.createElement('div');
        line.style.display = 'flex';
        line.style.alignItems = 'center';
        line.style.fontSize = '0.7rem';
        line.style.color = 'var(--text-secondary)';
        line.style.width = '100%';
        line.innerHTML = `<span style="width:${labelWidth}px; text-align:right; margin-right:5px;">${val}</span><div style="flex:1; height:1px; background:var(--border-color); opacity:0.5;"></div>`;
        yAxisEl.appendChild(line);
    }

    buckets.forEach(d => {
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
            // The line series pass straight through this label on a low bar, so
            // it sits above the overlay and carries a surface-coloured halo.
            topLbl.style.zIndex = '3';
            topLbl.style.textShadow = '0 0 3px var(--surface-color), 0 0 3px var(--surface-color), 0 0 2px var(--surface-color)';
            barInner.appendChild(topLbl);
        }
        
        barWrap.appendChild(barInner);
        barsEl.appendChild(barWrap);
    });

    renderTrendLines(barsEl, buckets, topLimit, gutter);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Overlays two line series on the trend bars, sharing the bars' y-scale:
 * the normal (global) track's solved questions and the focus track's subset.
 * Both are drawn from the same buckets, so a line point always sits on the
 * bar it describes.
 */
function renderTrendLines(barsEl, buckets, topLimit, gutter) {
    if (!buckets.length) return;

    const series = [
        { key: 'total', color: 'var(--trend-line-normal)', dash: '' },
        { key: 'focus', color: 'var(--trend-line-focus)', dash: '5 4' }
    ];

    // The viewBox is a plain 0-100 square stretched to the bar strip, so points
    // are expressed as percentages and survive any card width.
    const xAt = i => ((i + 0.5) * 100) / buckets.length;
    const yAt = v => 100 - Math.min(100, Math.max(0, (v / topLimit) * 100));

    const overlay = document.createElement('div');
    overlay.className = 'trend-line-overlay';
    overlay.style.left = `${gutter}px`;
    overlay.style.width = `calc(100% - ${gutter}px)`;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');

    const pointsOf = s => buckets.map((b, i) => `${xAt(i)},${yAt(b[s.key] || 0)}`).join(' ');

    const polyline = (points, stroke, width, dash) => {
        const el = document.createElementNS(SVG_NS, 'polyline');
        el.setAttribute('points', points);
        // Without this the horizontal stretch would fatten the stroke.
        el.setAttribute('vector-effect', 'non-scaling-stroke');
        el.style.fill = 'none';
        el.style.stroke = stroke;
        el.style.strokeWidth = width;
        el.style.strokeLinejoin = 'round';
        el.style.strokeLinecap = 'round';
        if (dash) el.style.strokeDasharray = dash;
        return el;
    };

    // Every halo goes down before any line, otherwise the second series' halo
    // would eat a bite out of the first series' stroke where they cross.
    series.forEach(s => {
        const halo = polyline(pointsOf(s), 'var(--surface-color)', '6', '');
        halo.style.strokeOpacity = '0.8';
        svg.appendChild(halo);
    });
    series.forEach(s => svg.appendChild(polyline(pointsOf(s), s.color, '2', s.dash)));

    overlay.appendChild(svg);

    series.forEach(s => {
        buckets.forEach((b, i) => {
            const dot = document.createElement('div');
            dot.className = 'trend-line-dot';
            dot.style.left = `${xAt(i)}%`;
            dot.style.top = `${yAt(b[s.key] || 0)}%`;
            dot.style.background = s.color;
            overlay.appendChild(dot);
        });
    });

    barsEl.appendChild(overlay);
}

function openInfoPopupModal(title, htmlContent, actionBtnConfig = null) {
    const overlay = document.getElementById('infoPopupOverlay');
    const titleEl = document.getElementById('infoPopupTitle');
    const bodyEl = document.getElementById('infoPopupBody');
    const footerEl = document.getElementById('infoPopupFooter');
    const closeBtn = document.getElementById('infoPopupCloseBtn');
    if (!overlay || !titleEl || !bodyEl) return;

    titleEl.innerHTML = title;
    bodyEl.innerHTML = htmlContent;

    if (footerEl) {
        footerEl.innerHTML = '';

        if (actionBtnConfig) {
            const actionBtn = document.createElement('button');
            actionBtn.className = actionBtnConfig.className || 'btn btn-primary';
            actionBtn.style.fontSize = '0.82rem';
            actionBtn.style.padding = '0.4rem 0.85rem';
            actionBtn.style.borderRadius = '6px';
            actionBtn.style.cursor = 'pointer';
            actionBtn.innerHTML = actionBtnConfig.text;
            actionBtn.addEventListener('click', () => {
                overlay.style.display = 'none';
                if (typeof actionBtnConfig.onClick === 'function') {
                    actionBtnConfig.onClick();
                }
            });
            footerEl.appendChild(actionBtn);
        }

        const dismissBtn = document.createElement('button');
        dismissBtn.className = 'btn btn-subtle';
        dismissBtn.style.fontSize = '0.82rem';
        dismissBtn.style.padding = '0.4rem 0.85rem';
        dismissBtn.style.borderRadius = '6px';
        dismissBtn.style.cursor = 'pointer';
        dismissBtn.textContent = 'Anladım';
        dismissBtn.addEventListener('click', () => {
            overlay.style.display = 'none';
        });
        footerEl.appendChild(dismissBtn);
    }

    overlay.style.display = 'flex';

    if (closeBtn && !closeBtn.dataset.bound) {
        closeBtn.dataset.bound = 'true';
        closeBtn.addEventListener('click', () => {
            overlay.style.display = 'none';
        });
    }

    if (!overlay.dataset.bound) {
        overlay.dataset.bound = 'true';
        overlay.addEventListener('click', (e) => {
            const card = overlay.querySelector('.info-popup-card');
            if (card && !card.contains(e.target)) {
                overlay.style.display = 'none';
            }
        });
    }
}

export function showSingleTokenModal(type, tokenIndex) {
    const isGlobal = type === 'global';
    const seriesTitle = isGlobal ? 'Genel FSRS Serisi' : 'Odak Seri';
    
    if (tokenIndex === 0) {
        // 1st Snowflake: Mavi Kar Tanesi
        const active = isGlobal ? false : true;
        const iconSvg = getSnowflakeSvgHtml(0, active, 22, 22);
        const title = `<span style="vertical-align: middle; margin-right: 4px;">${iconSvg}</span> 1. Mavi Kar Tanesi`;
        const html = `
            <div style="font-size: 0.88rem; color: var(--text-primary); text-align: left; display: flex; flex-direction: column; gap: 0.85rem;">
                <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(125, 211, 252, 0.1); padding: 0.75rem 0.9rem; border-radius: 8px; border-left: 3px solid #7dd3fc;">
                    <div>
                        <strong style="color: #7dd3fc; font-size: 0.92rem; display: flex; align-items: center; gap: 6px;">
                            ${getSnowflakeSvgHtml(0, true, 18, 18)} Mavi Kar Tanesi
                        </strong>
                        <span style="font-size: 0.78rem; color: var(--text-secondary);">Ait Olduğu Seri: ${seriesTitle}</span>
                    </div>
                    <span style="font-size: 0.8rem; font-weight: 700; padding: 3px 8px; border-radius: 12px; background: ${active ? 'rgba(16, 185, 129, 0.2)' : 'rgba(148, 163, 184, 0.2)'}; color: ${active ? '#10b981' : 'var(--text-secondary)'};">
                        ${active ? '● AKTİF' : '○ PASİF'}
                    </span>
                </div>

                <div style="font-size: 0.83rem; color: var(--text-secondary); line-height: 1.5;">
                    <p style="margin: 0 0 0.5rem 0;">
                        Mavi Kar Tanesi, uygulamaya başlarken hediye edilen standart dondurma hakkınızdır. Soru çözemediğiniz bir gün serinizi sıfırlanmaktan otomatik olarak korur.
                    </p>
                    <ul style="margin: 0; padding-left: 1.1rem; line-height: 1.6;">
                        <li><strong>Kazanım Şartı:</strong> Tüketilmesi halinde ${isGlobal ? '7 gün kesintisiz seri + %70 FSRS başarısı' : '7 gün kesintisiz Odak Seri'} tamamlanarak tekrar kazanılır.</li>
                    </ul>
                </div>
            </div>
        `;
        openInfoPopupModal(title, html);
    } else {
        // 2nd Snowflake: Kızıl Kar Tanesi
        const active = isGlobal ? false : true;
        const iconSvg = getSnowflakeSvgHtml(1, active, 22, 22);
        const title = `<span style="vertical-align: middle; margin-right: 4px;">${iconSvg}</span> 2. Kızıl Kar Tanesi`;
        const html = `
            <div style="font-size: 0.88rem; color: var(--text-primary); text-align: left; display: flex; flex-direction: column; gap: 0.85rem;">
                <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(239, 68, 68, 0.08); padding: 0.75rem 0.9rem; border-radius: 8px; border-left: 3px solid #ef4444;">
                    <div>
                        <strong style="color: #ef4444; font-size: 0.92rem; display: flex; align-items: center; gap: 6px;">
                            ${getSnowflakeSvgHtml(1, true, 18, 18)} Kızıl Kar Tanesi
                        </strong>
                        <span style="font-size: 0.78rem; color: var(--text-secondary);">Ait Olduğu Seri: ${seriesTitle}</span>
                    </div>
                    <span style="font-size: 0.8rem; font-weight: 700; padding: 3px 8px; border-radius: 12px; background: ${active ? 'rgba(239, 68, 68, 0.2)' : 'rgba(148, 163, 184, 0.2)'}; color: ${active ? '#ef4444' : 'var(--text-secondary)'};">
                        ${active ? '● AKTİF' : '○ PASİF'}
                    </span>
                </div>

                <div style="font-size: 0.83rem; color: var(--text-secondary); line-height: 1.5;">
                    <p style="margin: 0 0 0.5rem 0;">
                        Kızıl Kar Tanesi dondurma hakkı, genel veya özel tüm serileriniz için ortak dondurma koruması sağlar.
                    </p>
                    <ul style="margin: 0; padding-left: 1.1rem; line-height: 1.6;">
                        <li><strong>Kazanım Şartı:</strong> ${isGlobal ? 'Son 14 günde kesintisiz seri + %80 FSRS başarısı' : 'Son 14 günde kesintisiz Odak Seri'} tamamlanarak elde edilir.</li>
                        <li><strong>Çapraz Joker Özelliği:</strong> Kullanıcı bu dondurma hakkını özel veya normal seri için kullanabilir.</li>
                    </ul>
                </div>
            </div>
        `;
        openInfoPopupModal(title, html);
    }
}

export function showContinuityInfoModal(type) {
    if (type === 'global') {
        const title = '⚡ Genel FSRS Serisi Rehberi';
        const html = `
            <div style="font-size: 0.88rem; color: var(--text-primary); text-align: left; display: flex; flex-direction: column; gap: 0.85rem;">
                <div style="background: var(--bg-hover, rgba(59,130,246,0.06)); padding: 0.8rem 0.95rem; border-radius: 8px; border-left: 3px solid var(--primary-color);">
                    <strong style="color: var(--primary-color); font-size: 0.95rem; display: block; margin-bottom: 0.3rem;">⚡ Genel Seri Nedir?</strong>
                    <p style="margin: 0; color: var(--text-secondary); line-height: 1.5;">
                        Genel Seri, tüm soru bankanız genelinde FSRS (Aralıklı Tekrar) algoritmasına göre vadesi gelen soruları her gün düzenli çözerek çalışma alışkanlığı kazanmanızı sağlar.
                    </p>
                </div>

                <div style="display: flex; flex-direction: column; gap: 0.65rem;">
                    <div style="display: flex; gap: 0.6rem; align-items: flex-start;">
                        <span style="font-size: 1.1rem; line-height: 1;">🚀</span>
                        <div>
                            <strong style="font-size: 0.88rem; color: var(--text-primary);">Seri Nasıl Oluşturulur ve Hedefler?</strong>
                            <p style="margin: 0.15rem 0 0 0; font-size: 0.83rem; color: var(--text-secondary); line-height: 1.45;">
                                Günlük soru hedefinizi tamamladığınızda seri gün sayacınız <strong>+1 gün</strong> artar. Günlük minimum hedefiniz vadesi gelen soru sayısına göre belirlenir:
                            </p>
                            <ul style="margin: 0.25rem 0 0 0; padding-left: 1.1rem; font-size: 0.8rem; color: var(--text-secondary); line-height: 1.5;">
                                <li><strong>Vadesi gelen soru 15 veya fazla ise:</strong> En az 15 soru çözmek gereklidir.</li>
                                <li><strong>Vadesi gelen soru 15'in altında ise:</strong> Seriyi korumak için vadesi gelen soruların <strong>tamamını</strong> çözmek gereklidir.</li>
                                <li><strong>Vadesi gelen soru yoksa:</strong> Günlük 15 soru çözerek seri sürdürülür.</li>
                            </ul>
                        </div>
                    </div>

                    <div style="display: flex; gap: 0.6rem; align-items: flex-start;">
                        <span style="font-size: 1.1rem; line-height: 1;">🛡️</span>
                        <div>
                            <strong style="font-size: 0.88rem; color: var(--text-primary);">Seri Nasıl Korunur?</strong>
                            <p style="margin: 0.15rem 0 0 0; font-size: 0.83rem; color: var(--text-secondary); line-height: 1.45;">
                                Günlük vadesi gelen soruları tamamladığınızda seriniz korunur. Çalışmaya ara verdiğiniz günlerde ise aktif Dondurma Jetonlarınız devreye girerek serinizi korur.
                            </p>
                        </div>
                    </div>

                    <div style="display: flex; gap: 0.6rem; align-items: flex-start;">
                        <span style="display: inline-flex; align-items: center; gap: 2px;">
                            ${getSnowflakeSvgHtml(0, true, 16, 16)}
                        </span>
                        <div>
                            <strong style="font-size: 0.88rem; color: var(--text-primary);">Dondurma Hakları</strong>
                            <p style="margin: 0.15rem 0 0 0; font-size: 0.83rem; color: var(--text-secondary); line-height: 1.45;">
                                1. öge ${getSnowflakeSvgHtml(0, true, 14, 14)} <strong style="color:#7dd3fc;">Mavi Kar Tanesi</strong> standart dondurma hakkıdır. 2. öge ${getSnowflakeSvgHtml(1, true, 14, 14)} <strong style="color:#ef4444;">Kızıl Kar Tanesi</strong> ise gelişmiş dondurma hakkıdır; kullanıcı bu dondurma hakkını Odak Seri veya Genel Seri için kullanabilir.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        openInfoPopupModal(title, html);
    } else {
        const title = '🎯 Odak Seri Rehberi';
        const html = `
            <div style="font-size: 0.88rem; color: var(--text-primary); text-align: left; display: flex; flex-direction: column; gap: 0.85rem;">
                <div style="background: var(--bg-hover, rgba(59,130,246,0.06)); padding: 0.8rem 0.95rem; border-radius: 8px; border-left: 3px solid var(--info-color, #3b82f6);">
                    <strong style="color: var(--info-color, #3b82f6); font-size: 0.95rem; display: block; margin-bottom: 0.3rem;">🎯 Odak Seri Nedir?</strong>
                    <p style="margin: 0; color: var(--text-secondary); line-height: 1.5;">
                        Odak Seri, seçtiğiniz en fazla 3 soru kaynağına yoğunlaşarak özelleştirilmiş günlük çalışma temposu sürdürmenizi sağlar. Seri geçmişiniz kaynaklardan bağımsız tutulur.
                    </p>
                </div>

                <div style="display: flex; flex-direction: column; gap: 0.65rem;">
                    <div style="display: flex; gap: 0.6rem; align-items: flex-start;">
                        <span style="font-size: 1.1rem; line-height: 1;">🚀</span>
                        <div>
                            <strong style="font-size: 0.88rem; color: var(--text-primary);">Seri Nasıl Oluşturulur ve Hedefler?</strong>
                            <p style="margin: 0.15rem 0 0 0; font-size: 0.83rem; color: var(--text-secondary); line-height: 1.45;">
                                Kart üzerindeki ⚙️ ikonundan kaynaklarınızı seçtikten sonra günlük soru hedefini tamamladıkça Odak Seri sayacınız <strong>+1 gün</strong> artar:
                            </p>
                            <ul style="margin: 0.25rem 0 0 0; padding-left: 1.1rem; font-size: 0.8rem; color: var(--text-secondary); line-height: 1.5;">
                                <li><strong>Seçili kaynak vadesi 15 veya fazla ise:</strong> En az 15 soru çözmek gereklidir.</li>
                                <li><strong>Seçili kaynak vadesi 15'in altında ise:</strong> Seçili kaynaklardaki vadesi gelen soruların <strong>tamamını</strong> çözmek gereklidir.</li>
                                <li><strong>Vadesi gelen soru yoksa:</strong> Günlük 15 soru çözülerek seri sürdürülür.</li>
                            </ul>
                        </div>
                    </div>

                    <div style="display: flex; gap: 0.6rem; align-items: flex-start;">
                        <span style="font-size: 1.1rem; line-height: 1;">🛡️</span>
                        <div>
                            <strong style="font-size: 0.88rem; color: var(--text-primary);">Seri Nasıl Korunur?</strong>
                            <p style="margin: 0.15rem 0 0 0; font-size: 0.83rem; color: var(--text-secondary); line-height: 1.45;">
                                Seçili kaynaklardaki günlük vadesi gelen soruları çözerek seriniz korunur. Çalışamadığınız günlerde Odak Dondurma Jetonları serinizi muhafaza eder.
                            </p>
                        </div>
                    </div>

                    <div style="display: flex; gap: 0.6rem; align-items: flex-start;">
                        <span style="display: inline-flex; align-items: center; gap: 2px;">
                            ${getSnowflakeSvgHtml(0, true, 16, 16)}
                        </span>
                        <div>
                            <strong style="font-size: 0.88rem; color: var(--text-primary);">Odak Dondurma Hakları</strong>
                            <p style="margin: 0.15rem 0 0 0; font-size: 0.83rem; color: var(--text-secondary); line-height: 1.45;">
                                1. Odak hakkı ${getSnowflakeSvgHtml(0, true, 14, 14)} <strong style="color:#7dd3fc;">Mavi Kar Tanesi</strong> seçili kaynaklarınız için dondurma sağlarken, 2. Odak hakkı ${getSnowflakeSvgHtml(1, true, 14, 14)} <strong style="color:#ef4444;">Kızıl Kar Tanesi</strong> Odak Seri veya Genel Seri için ortak dondurma hakkı sunar.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        const actionConfig = {
            text: '⚙️ Kaynakları Seç',
            className: 'btn btn-primary',
            onClick: () => {
                openFocusSourceModal();
            }
        };
        openInfoPopupModal(title, html, actionConfig);
    }
}

export function showFreezeTokenModal(type) {
    if (type === 'global') {
        const title = `<span style="vertical-align: middle; margin-right: 4px;">${getSnowflakeSvgHtml(0, true, 22, 22)}</span> Genel Seri Dondurma Hakları`;
        const html = `
            <div style="font-size: 0.88rem; color: var(--text-primary); text-align: left; display: flex; flex-direction: column; gap: 0.85rem;">
                <div style="background: rgba(125, 211, 252, 0.1); padding: 0.75rem 0.9rem; border-radius: 8px; border-left: 3px solid #7dd3fc;">
                    <strong style="color: #7dd3fc; font-size: 0.92rem; display: flex; align-items: center; gap: 6px;">
                        ${getSnowflakeSvgHtml(0, true, 18, 18)} 1. Mavi Kar Tanesi
                    </strong>
                    <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); line-height: 1.45;">
                        İlk dondurma hakkınız uygulamaya başlarken <strong>bir kereliğe mahsus hediye</strong> olarak verilir. Soru çözemediğiniz bir günde serinizi sıfırlanmaktan korur.
                    </p>
                </div>

                <div style="background: rgba(239, 68, 68, 0.08); padding: 0.75rem 0.9rem; border-radius: 8px; border-left: 3px solid #ef4444;">
                    <strong style="color: #ef4444; font-size: 0.92rem; display: flex; align-items: center; gap: 6px;">
                        ${getSnowflakeSvgHtml(1, true, 18, 18)} 2. Kızıl Kar Tanesi
                    </strong>
                    <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); line-height: 1.45;">
                        İkinci dondurma hakkı <strong>Kızıl Kar Tanesi</strong>'dir. Kullanıcı bu dondurma hakkını Odak Seri veya Genel Seri için kullanabilir.
                    </p>
                </div>

                <div>
                    <strong style="display: flex; align-items: center; gap: 0.35rem; margin-bottom: 0.35rem;">
                        🏆 Dondurma Hakkı Kazanım Şartları:
                    </strong>
                    <ul style="margin: 0; padding-left: 1.2rem; color: var(--text-secondary); line-height: 1.5; font-size: 0.84rem;">
                        <li><strong>1. Mavi Kar Tanesi:</strong> Başlangıçta 1 defalık hediye (Tüketilirse: 7 gün seri + %70 FSRS başarısı ile tekrar kazanılır).</li>
                        <li><strong>2. Kızıl Kar Tanesi:</strong> Son 14 günde kesintisiz seri + %80 FSRS başarısı ile kazanılır.</li>
                    </ul>
                </div>
            </div>
        `;
        openInfoPopupModal(title, html);
    } else {
        const title = `<span style="vertical-align: middle; margin-right: 4px;">${getSnowflakeSvgHtml(0, true, 22, 22)}</span> Odak Seri Dondurma Hakları`;
        const html = `
            <div style="font-size: 0.88rem; color: var(--text-primary); text-align: left; display: flex; flex-direction: column; gap: 0.85rem;">
                <div style="background: rgba(125, 211, 252, 0.1); padding: 0.75rem 0.9rem; border-radius: 8px; border-left: 3px solid #7dd3fc;">
                    <strong style="color: #7dd3fc; font-size: 0.92rem; display: flex; align-items: center; gap: 6px;">
                        ${getSnowflakeSvgHtml(0, true, 18, 18)} 1. Mavi Kar Tanesi
                    </strong>
                    <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); line-height: 1.45;">
                        İlk odak dondurma hakkınız <strong>bir kereliğe mahsus hediye</strong> olarak verilir. Seçili odak kaynaklarınızdan soru çözemediğiniz bir günde odak serinizi korur.
                    </p>
                </div>

                <div style="background: rgba(239, 68, 68, 0.08); padding: 0.75rem 0.9rem; border-radius: 8px; border-left: 3px solid #ef4444;">
                    <strong style="color: #ef4444; font-size: 0.92rem; display: flex; align-items: center; gap: 6px;">
                        ${getSnowflakeSvgHtml(1, true, 18, 18)} 2. Kızıl Kar Tanesi
                    </strong>
                    <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); line-height: 1.45;">
                        İkinci odak dondurma hakkı <strong>Kızıl Kar Tanesi</strong>'dir. Kullanıcı bu dondurma hakkını Odak Seri veya Genel Seri için kullanabilir.
                    </p>
                </div>

                <div>
                    <strong style="display: flex; align-items: center; gap: 0.35rem; margin-bottom: 0.35rem;">
                        🏆 Odak Seri Dondurma Hakkı Kazanım Şartları:
                    </strong>
                    <ul style="margin: 0; padding-left: 1.2rem; color: var(--text-secondary); line-height: 1.5; font-size: 0.84rem;">
                        <li><strong>1. Mavi Kar Tanesi:</strong> Başlangıçta 1 defalık hediye (Tüketilirse: 7 gün kesintisiz Odak Seri ile tekrar kazanılır).</li>
                        <li><strong>2. Kızıl Kar Tanesi:</strong> Son 14 günde kesintisiz Odak Seri tamamlanarak kazanılır.</li>
                    </ul>
                </div>
            </div>
        `;
        openInfoPopupModal(title, html);
    }
}

export function showContinuityProgressModal(type) {
    if (type === 'global') {
        const streak = calculateGlobalStreak();
        const todayAct = initTodayActivity();
        const liveQ = buildQuestionPool() || [];
        const overdueCount = getDailyOverdueSnapshot(liveQ);
        const req = getDailyRequirement(overdueCount);
        const solved = todayAct.questionCount || 0;
        const isMet = isActivityRequirementMet(todayAct);

        const title = '📊 Genel Seri İlerleme Durumu';
        const html = `
            <div style="font-size: 0.88rem; color: var(--text-primary); text-align: left; display: flex; flex-direction: column; gap: 0.85rem;">
                <div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-hover); padding: 0.75rem 0.9rem; border-radius: 8px;">
                    <div>
                        <div style="font-size: 0.78rem; color: var(--text-secondary);">Mevcut Kesintisiz Seri</div>
                        <div style="font-size: 1.25rem; font-weight: 800; color: var(--primary-color);">${streak} Gün 🔥</div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 0.78rem; color: var(--text-secondary);">Günün İlerlemesi</div>
                        <div style="font-size: 1.1rem; font-weight: 700; color: ${isMet ? 'var(--success-color, #10b981)' : 'var(--text-primary)'};">
                            ${solved} / ${req} Soru
                        </div>
                    </div>
                </div>
                <p style="margin: 0; font-size: 0.83rem; color: var(--text-secondary); line-height: 1.45;">
                    ${isMet 
                        ? 'Tebrikler! Bugünün FSRS soru hedefini tamamladınız ve serinizi korudunuz. 🎉' 
                        : `Bugün serinizi korumak için ${req - solved} soru daha çözmeniz gerekmektedir.`}
                </p>
            </div>
        `;
        openInfoPopupModal(title, html);
    } else {
        const streak = calculateFocusStreak();
        const todayAct = initTodayActivity();
        const focusOverdue = getDailyFocusOverdueSnapshot();
        const req = getDailyRequirement(focusOverdue);
        const solved = todayAct.focusQuestionCount || 0;
        const isMet = isFocusActivityRequirementMet(todayAct);

        const title = '🎯 Odak Seri İlerleme Durumu';
        const html = `
            <div style="font-size: 0.88rem; color: var(--text-primary); text-align: left; display: flex; flex-direction: column; gap: 0.85rem;">
                <div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-hover); padding: 0.75rem 0.9rem; border-radius: 8px;">
                    <div>
                        <div style="font-size: 0.78rem; color: var(--text-secondary);">Mevcut Odak Seri</div>
                        <div style="font-size: 1.25rem; font-weight: 800; color: var(--info-color, #3b82f6);">${streak} Gün 🎯</div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 0.78rem; color: var(--text-secondary);">Günün İlerlemesi</div>
                        <div style="font-size: 1.1rem; font-weight: 700; color: ${isMet ? 'var(--success-color, #10b981)' : 'var(--text-primary)'};">
                            ${solved} / ${req} Soru
                        </div>
                    </div>
                </div>
                <p style="margin: 0; font-size: 0.83rem; color: var(--text-secondary); line-height: 1.45;">
                    ${isMet 
                        ? 'Tebrikler! Seçili odak kaynaklarınızdan bugünün hedefini tamamladınız. 🎉' 
                        : `Odak serinizi korumak için seçili kaynaklardan ${req - solved} soru daha çözmeniz gerekmektedir.`}
                </p>
            </div>
        `;
        openInfoPopupModal(title, html);
    }
}

export function showContinuityTargetModal(type) {
    if (type === 'global') {
        const liveQ = buildQuestionPool() || [];
        const overdueCount = getDailyOverdueSnapshot(liveQ);
        const title = '🎯 FSRS Günlük Hedef & Seri Kuralları';
        const html = `
            <div style="font-size: 0.88rem; color: var(--text-primary); text-align: left; display: flex; flex-direction: column; gap: 0.85rem;">
                <div style="background: var(--bg-hover); padding: 0.75rem 0.9rem; border-radius: 8px; border-left: 3px solid var(--primary-color);">
                    <strong style="color: var(--primary-color); font-size: 0.9rem;">FSRS Vadesi Gelen Sorular: ${overdueCount} Soru</strong>
                    <p style="margin: 0.35rem 0 0.5rem 0; color: var(--text-secondary); font-size: 0.83rem; line-height: 1.45;">
                        Sistem hafıza eğrinize göre bugün tekrar etmeniz gereken soruları analiz eder.
                    </p>
                    <ul style="margin: 0; padding-left: 1.1rem; color: var(--text-secondary); font-size: 0.82rem; line-height: 1.5;">
                        <li><strong>Vadesi gelen 15 veya daha fazla ise:</strong> Seri için günlük hedef <strong>15 soru</strong>dur.</li>
                        <li><strong>Vadesi gelen 15'in altında ise:</strong> Seriyi korumak için vadesi gelen soruların <strong>tamamı</strong> çözülmelidir.</li>
                        <li><strong>Vadesi gelen soru yoksa:</strong> Seri koruması için <strong>15 soru</strong> hedeflenir.</li>
                    </ul>
                </div>
            </div>
        `;
        openInfoPopupModal(title, html);
    } else {
        const focusOverdue = getDailyFocusOverdueSnapshot();
        const focusSources = getFocusSources();
        const title = '⚙️ Odak Seri Hedef & Seri Kuralları';
        const html = `
            <div style="font-size: 0.88rem; color: var(--text-primary); text-align: left; display: flex; flex-direction: column; gap: 0.85rem;">
                <div style="background: var(--bg-hover); padding: 0.75rem 0.9rem; border-radius: 8px; border-left: 3px solid var(--info-color, #3b82f6);">
                    <strong style="color: var(--info-color, #3b82f6); font-size: 0.9rem;">Seçili Kaynak Vadesi: ${focusOverdue} Soru (${focusSources.length} Kaynak)</strong>
                    <p style="margin: 0.35rem 0 0.5rem 0; color: var(--text-secondary); font-size: 0.83rem; line-height: 1.45;">
                        Yalnızca seçtiğiniz kaynaklardaki FSRS vadesi gelen sorular günlük hedefe dahil edilir. ⚙️ ikonu üzerinden kaynaklarınızı yönetebilirsiniz.
                    </p>
                    <ul style="margin: 0; padding-left: 1.1rem; color: var(--text-secondary); font-size: 0.82rem; line-height: 1.5;">
                        <li><strong>Seçili vadesi 15 veya daha fazla ise:</strong> Seri için günlük hedef <strong>15 soru</strong>dur.</li>
                        <li><strong>Seçili vadesi 15'in altında ise:</strong> Seriyi korumak için vadesi gelen soruların <strong>tamamı</strong> çözülmelidir.</li>
                        <li><strong>Vadesi gelen soru yoksa:</strong> Günlük <strong>15 soru</strong> çözülerek seri sürdürülür.</li>
                    </ul>
                </div>
            </div>
        `;
        openInfoPopupModal(title, html);
    }
}
