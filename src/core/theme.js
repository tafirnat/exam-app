import { persist, readString } from './storage.js';


// The attribute goes on <html>, not <body>: :root-level custom properties that
// reference other theme variables are substituted on the element that declares
// them, so a theme flag below :root leaves those tokens stuck on the light
// palette. See the comment above <html> in index.html.
/* One key, one default, one place. The backup export used to spell the key
   'focus_app_theme' and default to 'light', so every exported backup recorded a
   light theme no matter what the user was actually looking at - two copies of a
   fact that only one module owns. */
const THEME_KEY = 'focus_theme';
const DEFAULT_THEME = 'dark';

/** The theme in force. Anything that needs to know asks here. */
export function getActiveTheme() {
    return readString(THEME_KEY) || DEFAULT_THEME;
}

export function initTheme() {
    const theme = getActiveTheme();
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeUI(theme);
}

export function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    persist(THEME_KEY, next);
    updateThemeUI(next);
}

export function updateThemeUI(theme) {
    const icon = document.getElementById('menuThemeIcon');
    const text = document.getElementById('menuThemeText');
    if (!icon || !text) return;

    if (theme === 'dark') {
        icon.innerHTML = '<path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-11.314l.707.707m11.314 11.314l.707.707M12 5a7 7 0 100 14 7 7 0 000-14z"></path>';
        text.innerText = 'Helles Design';
    } else {
        icon.innerHTML = '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"></path>';
        text.innerText = 'Dunkles Design';
    }
}
