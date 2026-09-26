/**
 * The stats filter bar picks how much text it shows from the width it really
 * has, not from a screen-size breakpoint (R2-06). A laptop card is narrower
 * than the 1024px breakpoint assumed, so the labels wrapped to two lines and
 * the last chip ran out of the card.
 *
 *   full          every chip shows its label
 *   active-label  icons only, the active chip keeps its label
 *   icons         icons only; the chosen filter's name is shown for a moment
 *                 in the header title instead (flashHeaderLabel)
 *
 * The first mode that fits wins. Labels never wrap (CSS), so "fits" is a plain
 * scrollWidth check.
 */

export const FitMode = Object.freeze({
    FULL: 'full',
    ACTIVE_LABEL: 'active-label',
    ICONS: 'icons'
});

const ORDER = [FitMode.FULL, FitMode.ACTIVE_LABEL, FitMode.ICONS];
const CLASS_OF = {
    [FitMode.FULL]: null,
    [FitMode.ACTIVE_LABEL]: 'fit-active-label',
    [FitMode.ICONS]: 'fit-icons'
};
const FLASH_MS = 1800;

/**
 * Pure. overflowsIn(mode) says whether the bar overflows when drawn in that
 * mode; the first mode that does not is chosen, else the densest.
 */
export function chooseFitMode(overflowsIn) {
    for (const mode of ORDER) {
        if (!overflowsIn(mode)) return mode;
    }
    return FitMode.ICONS;
}

function applyMode(bar, mode) {
    for (const cls of Object.values(CLASS_OF)) {
        if (cls) bar.classList.remove(cls);
    }
    if (CLASS_OF[mode]) bar.classList.add(CLASS_OF[mode]);
    bar.dataset.fit = mode;
}

/** Measures and applies. Returns the mode, or null while the bar is hidden. */
export function fitFilterBar(bar = document.getElementById('statsFilterBar')) {
    if (!bar || bar.clientWidth === 0) return null;
    const mode = chooseFitMode((m) => {
        applyMode(bar, m);
        return bar.scrollWidth > bar.clientWidth + 1;
    });
    applyMode(bar, mode);
    return mode;
}

let flashTimer = null;
let flashRestore = null;

/**
 * Shows `text` in #headerTitle for a moment, smaller and softer, then puts the
 * title back as it was (text and its i18n key).
 */
export function flashHeaderLabel(text, ms = FLASH_MS) {
    const title = document.getElementById('headerTitle');
    if (!title || !text) return;
    if (flashRestore) flashRestore();

    const saved = {
        text: title.textContent,
        i18n: title.getAttribute('data-i18n')
    };
    title.removeAttribute('data-i18n');
    title.textContent = text;
    title.classList.add('header-title-flash');

    flashRestore = () => {
        clearTimeout(flashTimer);
        flashTimer = null;
        flashRestore = null;
        title.classList.remove('header-title-flash');
        /* Someone else set the title meanwhile (a view change): theirs stays. */
        if (title.textContent !== text) return;
        title.textContent = saved.text;
        if (saved.i18n) title.setAttribute('data-i18n', saved.i18n);
    };
    flashTimer = setTimeout(() => flashRestore && flashRestore(), ms);
}

/** Ends a running flash now (e.g. the view is left). */
export function endHeaderFlash() {
    if (flashRestore) flashRestore();
}

let observed = false;

/**
 * One-time wiring: refit on size changes, and name the chosen filter in the
 * header when the bar shows icons only.
 */
export function initFilterBarFit() {
    const bar = document.getElementById('statsFilterBar');
    if (!bar || observed) return;
    observed = true;

    if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'function') {
        new window.ResizeObserver(() => fitFilterBar(bar)).observe(bar);
    } else if (typeof window !== 'undefined') {
        window.addEventListener('resize', () => fitFilterBar(bar));
    }

    bar.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-btn');
        if (!btn || bar.dataset.fit !== FitMode.ICONS) return;
        const label = btn.querySelector('.filter-btn-text');
        flashHeaderLabel(label ? label.textContent.trim() : '');
    });
}

/** Test seam. */
export function _resetFilterBarFitForTests() {
    if (flashRestore) flashRestore();
    observed = false;
}
