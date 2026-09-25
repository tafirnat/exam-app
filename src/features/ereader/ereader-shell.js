import { t } from '../../core/i18n.js';

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

    const headerTitle = document.getElementById('headerTitle');
    if (headerTitle) {
        if (isEreaderView(view)) {
            headerTitle.setAttribute('data-i18n', 'ereader_library_title');
            headerTitle.textContent = t('ereader_library_title');
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
}
