import { AppState } from '../../core/state.js';
import { escapeHTML } from '../../core/utils.js';
import { renderMarkdown } from '../../core/markdown.js';
import { APP_VERSION } from '../../core/version.js';
import {
    GUIDE_SECTIONS, GUIDE_TITLE, GUIDE_INTRO, CONTACT_EMAIL, guideLang
} from './guide-content.js';

/**
 * The in-app user guide.
 *
 * Reads like a web page rather than a wall of prose: a list of links at the
 * top, and a section that opens where it stands when you pick one. The
 * question it is built to answer is "how do I do X" - so the first thing on
 * screen is the list of X.
 *
 * Only the OPEN section's Markdown is rendered. The guide is around 40KB of
 * text across three languages and parsing all of it on open would be work
 * nobody asked for; a section parses the first time it is opened and is kept
 * from then on. That is also why a section's body lives in a data structure
 * rather than in the HTML: the markup for seventeen sections in three
 * languages would be in index.html forever, in every language at once.
 */

let bound = false;
/* Parsed bodies, memoised. The key carries the LANGUAGE as well as the section
   id, which is the whole of what makes a language change safe: switching to
   German cannot be served the Turkish parse, and switching back does not have
   to parse again. A cache keyed on the id alone would need to be emptied on
   every language change, and forgetting to would show the previous language's
   prose under the new language's heading. */
const rendered = new Map();

function currentLang() {
    return guideLang(AppState.language);
}

function sectionHTML(section, lang) {
    const key = `${lang}:${section.id}`;
    if (!rendered.has(key)) rendered.set(key, renderMarkdown(section.body[lang]));
    return rendered.get(key);
}

/** Opens one section, closing whichever was open, and scrolls it into view. */
function openSection(id, { scroll = true } = {}) {
    const lang = currentLang();
    const section = GUIDE_SECTIONS.find(s => s.id === id);
    if (!section) return;

    const body = document.getElementById(`guideBody-${id}`);
    const item = document.getElementById(`guideItem-${id}`);
    const head = document.getElementById(`guideHead-${id}`);
    if (!body || !item || !head) return;

    const wasOpen = item.classList.contains('is-open');

    /* One at a time. Several open sections turn the page back into the wall of
       text the contents list exists to avoid. */
    document.querySelectorAll('.guide-item.is-open').forEach(el => {
        el.classList.remove('is-open');
        const h = el.querySelector('.guide-head');
        if (h) h.setAttribute('aria-expanded', 'false');
    });

    if (wasOpen) return; // a second tap on the open one closes it

    /* render() leaves every body empty, so this is the first parse of this
       section in this language - after that the memo answers. */
    body.innerHTML = sectionHTML(section, lang);
    item.classList.add('is-open');
    head.setAttribute('aria-expanded', 'true');
    /* Guarded: scrollIntoView is missing in jsdom and its options argument is
       not universal. Scrolling is a nicety here - the section is already open
       and the failure would take the opening with it. */
    if (scroll && typeof item.scrollIntoView === 'function') {
        try { item.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { item.scrollIntoView(); }
    }
}

function render() {
    const lang = currentLang();
    const overlay = document.getElementById('guideOverlay');
    if (!overlay) return;

    const titleEl = document.getElementById('guideTitle');
    if (titleEl) titleEl.textContent = GUIDE_TITLE[lang];
    const introEl = document.getElementById('guideIntro');
    if (introEl) introEl.textContent = GUIDE_INTRO[lang];
    const verEl = document.getElementById('guideVersion');
    if (verEl) verEl.textContent = `v${APP_VERSION}`;

    const toc = document.getElementById('guideToc');
    const list = document.getElementById('guideSections');
    if (!toc || !list) return;

    toc.innerHTML = GUIDE_SECTIONS.map((s, i) => `
        <button type="button" class="guide-toc-link" data-guide-jump="${escapeHTML(s.id)}">
            <span class="guide-toc-num">${i + 1}</span>${escapeHTML(s.title[lang])}
        </button>`).join('');

    list.innerHTML = GUIDE_SECTIONS.map(s => `
        <div class="guide-item" id="guideItem-${escapeHTML(s.id)}">
            <button type="button" class="guide-head" id="guideHead-${escapeHTML(s.id)}"
                    data-guide-toggle="${escapeHTML(s.id)}" aria-expanded="false"
                    aria-controls="guideBody-${escapeHTML(s.id)}">
                <span class="guide-head-text">${escapeHTML(s.title[lang])}</span>
                <svg class="guide-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none"
                     stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </button>
            <div class="guide-body md-content" id="guideBody-${escapeHTML(s.id)}"></div>
        </div>`).join('');

    const contactEl = document.getElementById('guideContact');
    if (contactEl) {
        contactEl.innerHTML = `<a href="mailto:${escapeHTML(CONTACT_EMAIL)}">${escapeHTML(CONTACT_EMAIL)}</a>`;
    }
}

export function closeGuide() {
    const overlay = document.getElementById('guideOverlay');
    if (overlay) overlay.classList.remove('active');
}

export function openGuide(sectionId = null) {
    const overlay = document.getElementById('guideOverlay');
    if (!overlay) return;

    render();

    if (!bound) {
        bound = true;
        /* Delegated, and bound once. The list is rebuilt on every open (the
           language may have changed), so per-button handlers would pile up a
           copy per open and every stale copy would be deciding on a detached
           node - the trap the editor's focus mode hit. */
        overlay.addEventListener('click', (e) => {
            const jump = e.target.closest('[data-guide-jump]');
            if (jump) {
                openSection(jump.dataset.guideJump);
                return;
            }
            const toggle = e.target.closest('[data-guide-toggle]');
            if (toggle) {
                openSection(toggle.dataset.guideToggle, { scroll: false });
                return;
            }
            // The backdrop closes it; the card does not.
            if (e.target === overlay) closeGuide();
        });
        const closeBtn = document.getElementById('guideCloseBtn');
        if (closeBtn) closeBtn.addEventListener('click', closeGuide);
    }

    overlay.classList.add('active');
    const scroller = document.getElementById('guideScroll');
    if (scroller) scroller.scrollTop = 0;
    if (sectionId) openSection(sectionId);
}
