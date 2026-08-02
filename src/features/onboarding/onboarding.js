/**
 * Exam App - Onboarding (Kullanım Rehberi) Feature Module
 */

import { t } from '../../core/i18n.js';
import { persist } from '../../core/storage.js';

const STORAGE_KEY = 'exam_app_onboarding_completed';

let currentStepIndex = 0;
let backdropEl = null;
let svgPathEl = null;
let svgRingEl = null;
let popoverEl = null;
let activeSteps = [];
let updateHandler = null;

function getSteps() {
    return [
        {
            target: '#headerTitle',
            titleKey: 'onboarding_step1_title',
            descKey: 'onboarding_step1_desc',
            defaultTitle: 'Exam App\'e Hoş Geldiniz! 🚀',
            defaultDesc: 'İnteraktif sınav platformunuz ile sorularınızı çözebilir, FSRS algoritmasıyla akıllı tekrarlar yapabilirsiniz.'
        },
        {
            target: '#menuToggleBtn',
            titleKey: 'onboarding_step2_title',
            descKey: 'onboarding_step2_desc',
            defaultTitle: 'Yan Menü & Ayarlar ⚙️',
            defaultDesc: 'Görünüm (Tema), dil, veri yedekleme, AI entegrasyonu ve zamanlayıcı ayarlarına menüden ulaşabilirsiniz.'
        },
        {
            target: '#continuityCarouselWrapper',
            titleKey: 'onboarding_step3_title',
            descKey: 'onboarding_step3_desc',
            defaultTitle: 'FSRS & Günlük Çalışma Serisi 🔥',
            defaultDesc: 'FSRS sistemi unutma eğrinize göre soruları zamanlar. Günlük çalışma hedefinizi tamamlayarak serinizi koruyun!'
        },
        {
            target: '#homeStatsCard',
            titleKey: 'onboarding_step4_title',
            descKey: 'onboarding_step4_desc',
            defaultTitle: 'Soru & Test Özeti 📝',
            defaultDesc: 'Seçili kaynaklarınızın soru sayısı, ortalama zorluk derecesi ve öğrenme ilerlemesini buradan takip edip test başlatabilirsiniz.'
        },
        {
            target: '#quickSourcesBtn',
            titleKey: 'onboarding_step5_title',
            descKey: 'onboarding_step5_desc',
            defaultTitle: 'Hızlı Erişim & Karma Çalışma 📌',
            defaultDesc: 'Farklı kaynaklardaki soruları tek bir hızlı erişim paketinde birleştirerek karma pratik ve tekrar yapabilirsiniz.'
        },
        {
            target: '#homeSourcesBtn',
            titleKey: 'onboarding_step6_title',
            descKey: 'onboarding_step6_desc',
            defaultTitle: 'Kaynak Ekleme & Yönetimi 📁',
            defaultDesc: 'JSON dosyalarınızı yükleyin, URL ile soru bankası ekleyin, klasörleyin veya aktif çalışacağınız kaynakları belirleyin.'
        },
        {
            target: '#homeStatsBtn',
            titleKey: 'onboarding_step7_title',
            descKey: 'onboarding_step7_desc',
            defaultTitle: 'Soru Detayları & Arama 🔍',
            defaultDesc: 'Tüm sorularınızın geçmiş performansını inceleyin. Soru metni, cevaplar veya #etiket bazlı detaylı aramalar yapın.'
        },
        {
            target: '.home-charts-grid',
            titleKey: 'onboarding_step8_title',
            descKey: 'onboarding_step8_desc',
            defaultTitle: 'Grafikler & İlerleme Analizi 📊',
            defaultDesc: 'Soru zorluk dağılımı (Donut Grafik) ve Haftalık/Aylık çalışma trendiniz ile gelişiminizi görsel olarak analiz edin.'
        }
    ];
}

export function isOnboardingCompleted() {
    return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function startOnboarding(force = false) {
    if (!force && isOnboardingCompleted()) {
        return;
    }

    activeSteps = getSteps();
    currentStepIndex = 0;

    createDOM();
    renderStep(currentStepIndex, true);

    if (updateHandler) {
        window.removeEventListener('resize', updateHandler);
        window.removeEventListener('scroll', updateHandler);
    }
    updateHandler = () => updateSpotlightAndPopoverPosition();
    window.addEventListener('resize', updateHandler, { passive: true });
    window.addEventListener('scroll', updateHandler, { passive: true });
}

export function stopOnboarding(markCompleted = true) {
    if (markCompleted) {
        persist(STORAGE_KEY, 'true');
    }

    if (updateHandler) {
        window.removeEventListener('resize', updateHandler);
        window.removeEventListener('scroll', updateHandler);
        updateHandler = null;
    }

    if (backdropEl) {
        backdropEl.classList.remove('active');
    }
    if (popoverEl) {
        popoverEl.classList.remove('active');
    }

    setTimeout(() => {
        if (backdropEl && backdropEl.parentNode) {
            backdropEl.parentNode.removeChild(backdropEl);
        }
        if (popoverEl && popoverEl.parentNode) {
            popoverEl.parentNode.removeChild(popoverEl);
        }
        backdropEl = null;
        svgPathEl = null;
        svgRingEl = null;
        popoverEl = null;
    }, 300);
}

function createDOM() {
    if (backdropEl) return;

    // Backdrop with SVG Cutout
    backdropEl = document.createElement('div');
    backdropEl.className = 'onboarding-backdrop';
    backdropEl.innerHTML = `
        <svg class="onboarding-spotlight-svg">
            <path class="onboarding-spotlight-path" fill-rule="evenodd" d=""></path>
            <rect class="onboarding-spotlight-ring" x="0" y="0" width="0" height="0" rx="8"></rect>
        </svg>
    `;
    document.body.appendChild(backdropEl);

    svgPathEl = backdropEl.querySelector('.onboarding-spotlight-path');
    svgRingEl = backdropEl.querySelector('.onboarding-spotlight-ring');

    // Popover Element
    popoverEl = document.createElement('div');
    popoverEl.className = 'onboarding-popover';
    document.body.appendChild(popoverEl);

    requestAnimationFrame(() => {
        backdropEl.classList.add('active');
    });
}

function renderStep(index, isInitial = false) {
    if (index < 0 || index >= activeSteps.length) {
        stopOnboarding(true);
        return;
    }

    const step = activeSteps[index];
    const targetEl = document.querySelector(step.target);

    // Scroll element smoothly into center of viewport on mobile and desktop
    if (targetEl && targetEl.offsetParent !== null) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }

    // Render Popover Content
    const title = t(step.titleKey) || step.defaultTitle;
    const desc = t(step.descKey) || step.defaultDesc;
    const isFirst = index === 0;
    const isLast = index === activeSteps.length - 1;

    const btnNextText = isLast
        ? (t('onboarding_btn_finish') || 'Tamamla')
        : (t('onboarding_btn_next') || 'Sonraki');
    const btnPrevText = t('onboarding_btn_prev') || 'Önceki';
    const btnSkipText = t('onboarding_btn_skip') || 'Atla';

    const dotsHTML = activeSteps.map((_, i) => `<div class="onboarding-dot ${i === index ? 'active' : ''}"></div>`).join('');

    popoverEl.innerHTML = `
        <div class="onboarding-header">
            <span class="onboarding-badge">${index + 1} / ${activeSteps.length}</span>
            <button class="onboarding-close-btn" id="onboardingCloseBtn" title="${btnSkipText}">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
        <h4 class="onboarding-title">${title}</h4>
        <div class="onboarding-desc">${desc}</div>
        <div class="onboarding-footer">
            <div class="onboarding-dots">${dotsHTML}</div>
            <div class="onboarding-actions">
                ${!isFirst ? `<button class="onboarding-btn onboarding-btn-subtle" id="onboardingPrevBtn">${btnPrevText}</button>` : ''}
                <button class="onboarding-btn onboarding-btn-primary" id="onboardingNextBtn">${btnNextText}</button>
            </div>
        </div>
    `;

    // Update spotlight & popover position immediately and after smooth scroll completes
    updateSpotlightAndPopoverPosition();
    setTimeout(() => {
        updateSpotlightAndPopoverPosition();
    }, 150);
    setTimeout(() => {
        updateSpotlightAndPopoverPosition();
    }, 350);

    // Bind event listeners for popover buttons
    const nextBtn = popoverEl.querySelector('#onboardingNextBtn');
    const prevBtn = popoverEl.querySelector('#onboardingPrevBtn');
    const closeBtn = popoverEl.querySelector('#onboardingCloseBtn');

    if (nextBtn) {
        nextBtn.onclick = () => {
            currentStepIndex++;
            renderStep(currentStepIndex);
        };
    }
    if (prevBtn) {
        prevBtn.onclick = () => {
            currentStepIndex--;
            renderStep(currentStepIndex);
        };
    }
    if (closeBtn) {
        closeBtn.onclick = () => {
            stopOnboarding(true);
        };
    }
}

function updateSpotlightAndPopoverPosition() {
    if (!popoverEl || currentStepIndex >= activeSteps.length) return;

    const step = activeSteps[currentStepIndex];
    const targetEl = document.querySelector(step.target);

    let rect = {
        top: window.innerHeight / 2 - 100,
        left: window.innerWidth / 2 - 150,
        width: 300,
        height: 200,
        bottom: window.innerHeight / 2 + 100,
        right: window.innerWidth / 2 + 150
    };

    let isTargetVisible = false;

    if (targetEl && targetEl.offsetParent !== null) {
        const bRect = targetEl.getBoundingClientRect();
        if (bRect.width > 0 && bRect.height > 0) {
            rect = bRect;
            isTargetVisible = true;
        }
    }

    const padding = step.target === '#quickSourcesBtn' ? 8 : 6;
    const rx = 8;
    const x = Math.max(2, rect.left - padding);
    const y = Math.max(2, rect.top - padding);
    const w = Math.min(window.innerWidth - x - 2, rect.width + padding * 2);
    const h = Math.min(window.innerHeight - y - 2, rect.height + padding * 2);
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // SVG path cutout around target rectangle
    if (isTargetVisible) {
        svgPathEl.setAttribute('d', `M0,0 H${vw} V${vh} H0 Z M${x + rx},${y} H${x + w - rx} a${rx},${rx} 0 0 1 ${rx},${rx} V${y + h - rx} a${rx},${rx} 0 0 1 -${rx},${rx} H${x + rx} a${rx},${rx} 0 0 1 -${rx},-${rx} V${y + rx} a${rx},${rx} 0 0 1 ${rx},-${rx} Z`);
        svgRingEl.setAttribute('x', x);
        svgRingEl.setAttribute('y', y);
        svgRingEl.setAttribute('width', w);
        svgRingEl.setAttribute('height', h);
        svgRingEl.setAttribute('rx', rx);
        svgRingEl.style.display = 'block';
    } else {
        svgPathEl.setAttribute('d', `M0,0 H${vw} V${vh} H0 Z`);
        svgRingEl.style.display = 'none';
    }

    positionPopover(x, y, w, h, step.target);
}

function positionPopover(x, y, w, h, targetSelector) {
    popoverEl.classList.remove('active');

    const popoverWidth = Math.min(window.innerWidth - 32, 380);
    const popoverHeight = popoverEl.offsetHeight || 210;
    const margin = 14;
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    let popLeft = x + (w / 2) - (popoverWidth / 2);
    let popTop;

    const spaceBelow = vh - (y + h + margin);
    const spaceAbove = y - margin;

    // Specific placement for #quickSourcesBtn to avoid obscuring header button
    if (targetSelector === '#quickSourcesBtn') {
        popTop = y + h + margin;
        // On desktop, align popover towards the right of target or center below
        popLeft = x + w - popoverWidth;
    } else if (spaceBelow >= popoverHeight + margin) {
        // Prefer placing BELOW target if space is sufficient
        popTop = y + h + margin;
    } else if (spaceAbove >= popoverHeight + margin) {
        // Otherwise place ABOVE target if space is sufficient
        popTop = y - popoverHeight - margin;
    } else {
        // Tight space: pick whichever side has more room and clamp strictly inside viewport
        if (spaceBelow >= spaceAbove) {
            popTop = Math.min(y + h + margin, vh - popoverHeight - margin);
        } else {
            popTop = Math.max(margin, y - popoverHeight - margin);
        }
    }

    // Strict boundary clamping so popover NEVER overflows off top/bottom/left/right of viewport
    popLeft = Math.max(margin, Math.min(popLeft, vw - popoverWidth - margin));
    popTop = Math.max(margin, Math.min(popTop, vh - popoverHeight - margin));

    popoverEl.style.left = `${popLeft}px`;
    popoverEl.style.top = `${popTop}px`;

    requestAnimationFrame(() => {
        popoverEl.classList.add('active');
    });
}
