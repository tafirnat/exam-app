import { t } from '../../core/i18n.js';
import { emit, Slice } from '../../core/store.js';
import { loadEreader, isEreaderLoaded, listBooks, setPrefs, getPrefs, deleteBook } from './ereader-store.js';
import { bindEreaderLibrary } from './ereader-library-ui.js';
import { bindEreaderReader, enterBookView, leaveBookView, closeSettingsOverlay, openBook } from './ereader-reader-ui.js';
import { pullEreader, initEreaderSync } from './ereader-sync.js';
import { readStringAsync, persistAsync } from '../../core/storage.js';
import { AppState } from '../../core/state.js';
import { importFromUrl } from './ereader-import.js';

export const EREADER_SAMPLE_KEY = 'focus_app_ereader_sample_loaded_v5';

const OLD_SAMPLE_KEYS = new Set([
    'ezop-masallari-secme-hikayeler-tr',
    'aesops-fables-selected-tales-en',
    'aesops-fabeln-ausgewaehlte-erzaehlungen-de'
]);

const NEW_SAMPLE_KEYS = new Set([
    'sistem-mimarisi-ve-ereader-kilavuzu-tr',
    'system-architecture-and-ereader-guide-en',
    'systemarchitektur-und-ereader-handbuch-de'
]);

let loadRequested = false;
let switchViewRef = null;

let starterPromise = null;

/** Runs the starter-book check once per session, whichever entry point -
 *  the view switch or the header button - reaches the e-Reader first. */
function ensureStarterBookLoaded() {
    if (!starterPromise) starterPromise = loadStarterBook();
    return starterPromise;
}

async function loadStarterBook() {
    if (typeof window === 'undefined' || typeof fetch !== 'function' || !window.localStorage) return;
    try {
        if (await readStringAsync(EREADER_SAMPLE_KEY)) return;
        const books = listBooks();
        for (const b of books) {
            if (OLD_SAMPLE_KEYS.has(b.bookKey)) {
                await deleteBook(b.id, { fromSync: true });
            }
        }
        /* A sample imported under an earlier version of the file (bumped with
           EREADER_SAMPLE_KEY) is swapped for the current one in its own
           language, so new specimen content reaches existing installs. */
        const outdated = listBooks().filter(b => NEW_SAMPLE_KEYS.has(b.bookKey));
        for (const b of outdated) {
            await deleteBook(b.id, { fromSync: true });
        }
        const remaining = listBooks();
        if (outdated.length === 0 && remaining.length > 0) {
            await persistAsync(EREADER_SAMPLE_KEY, '1');
            return;
        }
        const preferred = outdated[0]?.language || AppState.language;
        const lang = ['tr', 'en', 'de'].includes(preferred) ? preferred : 'tr';
        const res = await importFromUrl(`./examples/ereader/sample-book-${lang}.json`);
        if (res && res.book && res.book.id) {
            await setPrefs({ lastBookId: res.book.id });
        }
        await persistAsync(EREADER_SAMPLE_KEY, lang);
    } catch (e) {
        console.warn('[ereader] could not load starter book:', e);
    }
}

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
        .then(async () => {
            await ensureStarterBookLoaded();
            emit(Slice.EREADER_LIBRARY);
        })
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

    const progressWrap = document.getElementById('ereaderTocProgressWrap');
    if (progressWrap) {
        progressWrap.style.display = view === 'ereaderBook' ? 'block' : 'none';
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
 * One-time wiring: #headerEreaderBtn, #ereaderSettingsLibraryBtn.
 */
export function bindEreaderShell({ switchView, closeMenu } = {}) {
    const headerEreaderBtn = document.getElementById('headerEreaderBtn');
    if (headerEreaderBtn && typeof switchView === 'function') {
        /* The entry point resumes the last-read book directly - "pick a book"
           is not a step a returning reader should repeat. openBook() itself
           falls back to nothing (leaving this to switchView) when the last
           book no longer exists, or there never was one. */
        headerEreaderBtn.onclick = async () => {
            await loadEreader();
            /* Loading the store here means ensureEreaderLoaded() will find it
               loaded and skip its own starter check - so a fresh install that
               enters through this button would never get the sample book. */
            await ensureStarterBookLoaded();
            emit(Slice.EREADER_LIBRARY);
            const lastId = getPrefs().lastBookId;
            if (lastId && await openBook(lastId, { switchView })) return;
            switchView('ereaderLibrary');
        };
    }

    const settingsLibraryBtn = document.getElementById('ereaderSettingsLibraryBtn');
    if (settingsLibraryBtn) {
        settingsLibraryBtn.onclick = () => {
            closeSettingsOverlay();
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
