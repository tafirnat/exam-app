import { t } from '../../core/i18n.js';
import { emit, Slice } from '../../core/store.js';
import { loadEreader, isEreaderLoaded } from './ereader-store.js';
import { bindEreaderLibrary } from './ereader-library-ui.js';
import { bindEreaderReader, enterBookView, leaveBookView } from './ereader-reader-ui.js';
import { pullEreader, initEreaderSync } from './ereader-sync.js';

let loadRequested = false;
let switchViewRef = null;

/**
 * The e-Reader's storage is read on first entry, not at boot: the test centre
 * never pays for it. Not awaited - switchView stays synchronous, and the
 * library's painter shows nothing (not "no books") until the load announces
 * itself here.
 */
function ensureEreaderLoaded() {
    if (loadRequested || isEreaderLoaded()) return;
    loadRequested = true;
    loadEreader()
        .then(() => emit(Slice.EREADER_LIBRARY))
        .catch((err) => {
            loadRequested = false;
            console.error('[ereader] load failed:', err);
        });
}

export const EREADER_VIEWS = Object.freeze(['ereaderLibrary', 'ereaderBook']);

export function isEreaderView(view) {
    return EREADER_VIEWS.includes(view);
}

/**
 * Pure. What the header and menu must show for a view.
 * Returns { ereaderBtn, homeBtn, menuToggle, header, tools, sync, menuMode }
 * values: 'flex' | 'none' | null (null = "leave as switchView set it")
 */
export function headerChromeFor(view) {
    if (view === 'ereaderLibrary') {
        return {
            ereaderBtn: 'none',
            homeBtn: 'flex',
            menuToggle: 'flex',
            header: 'flex',
            tools: 'none',
            sync: 'none',
            menuMode: 'ereader'
        };
    }
    if (view === 'ereaderBook') {
        return {
            ereaderBtn: 'none',
            homeBtn: 'flex',
            menuToggle: 'flex',
            header: 'flex',
            tools: 'flex',
            sync: 'none',
            menuMode: 'ereader'
        };
    }
    if (view === 'home') {
        return {
            ereaderBtn: 'flex',
            homeBtn: null,
            menuToggle: null,
            header: null,
            tools: 'none',
            sync: '',
            menuMode: 'test'
        };
    }
    // Diğer test görünümleri (stats, sources, test, statsPreview, results vb.)
    return {
        ereaderBtn: 'none',
        homeBtn: null,
        menuToggle: null,
        header: null,
        tools: 'none',
        sync: '',
        menuMode: 'test'
    };
}

/**
 * Applies headerChromeFor(view) to the DOM. Called at the END of switchView.
 */
export function applyEreaderChrome(view, { goHome } = {}) {
    const chrome = headerChromeFor(view);

    const header = document.querySelector('header');
    if (header && chrome.header !== null) {
        header.style.display = chrome.header;
    }

    const ereaderBtn = document.getElementById('headerEreaderBtn');
    if (ereaderBtn && chrome.ereaderBtn !== null) {
        ereaderBtn.style.display = chrome.ereaderBtn;
    }

    const homeBtn = document.getElementById('headerBackBtn');
    if (homeBtn) {
        if (chrome.homeBtn !== null) {
            homeBtn.style.display = chrome.homeBtn;
        }
        if (isEreaderView(view) && typeof goHome === 'function') {
            homeBtn.onclick = goHome;
        }
    }

    const menuToggle = document.getElementById('menuToggleBtn');
    if (menuToggle && chrome.menuToggle !== null) {
        menuToggle.style.display = chrome.menuToggle;
    }

    const tools = document.getElementById('ereaderHeaderTools');
    if (tools && chrome.tools !== null) {
        tools.style.display = chrome.tools;
    }

    const syncEl = document.querySelector('.header-sync-container') || document.getElementById('githubSyncBtn');
    if (syncEl && chrome.sync !== null) {
        syncEl.style.display = chrome.sync;
    }

    const actionMenu = document.getElementById('actionMenu');
    if (actionMenu) {
        actionMenu.dataset.mode = chrome.menuMode;
    }

    /* The book scrolls as one long page; the header (search, tools) has to
       stay on top of it, which body's height:100% would otherwise stop. */
    if (document.body) document.body.classList.toggle('ereader-mode', isEreaderView(view));

    const headerTitle = document.getElementById('headerTitle');
    if (headerTitle) {
        /* R2-07: the header names the app part, e-Reader, in the library and
           in a book alike; the library card carries its own title. */
        if (isEreaderView(view)) {
            headerTitle.setAttribute('data-i18n', 'ereader_header_title');
            headerTitle.textContent = t('ereader_header_title');
        }
    }

    const tocSection = document.getElementById('ereaderTocMenuSection');
    if (tocSection) {
        tocSection.style.display = view === 'ereaderBook' ? 'block' : 'none';
    }

    const readingSection = document.getElementById('ereaderReadingMenuSection');
    if (readingSection) {
        readingSection.style.display = view === 'ereaderBook' ? 'block' : 'none';
    }

    if (isEreaderView(view)) {
        ensureEreaderLoaded();
        pullEreader().catch(err => console.warn('[ereader] sync pull failed:', err));
    }

    /* The book view shows the open book; with none open (Back into the view)
       there is nothing to show, so the library takes its place. Deferred:
       this runs at the end of switchView() itself. */
    if (view === 'ereaderBook') {
        if (!enterBookView() && typeof switchViewRef === 'function') {
            queueMicrotask(() => switchViewRef('ereaderLibrary', true));
        }
    } else {
        leaveBookView();
    }
}

/**
 * One-time wiring: #headerEreaderBtn, #menuEreaderLibrary.
 */
export function bindEreaderShell({ switchView, closeMenu } = {}) {
    const headerEreaderBtn = document.getElementById('headerEreaderBtn');
    if (headerEreaderBtn && typeof switchView === 'function') {
        headerEreaderBtn.onclick = () => switchView('ereaderLibrary');
    }

    const menuEreaderLibrary = document.getElementById('menuEreaderLibrary');
    if (menuEreaderLibrary) {
        menuEreaderLibrary.onclick = () => {
            if (typeof closeMenu === 'function') {
                closeMenu();
            }
            if (typeof switchView === 'function') {
                switchView('ereaderLibrary');
            }
        };
    }

    switchViewRef = switchView;
    bindEreaderReader({ switchView, closeMenu });
    bindEreaderLibrary({ switchView, closeMenu });
    initEreaderSync({ getCurrentView: () => history.state?.view || 'home' });
}
