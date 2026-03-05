
export function initTheme() {
    const theme = localStorage.getItem('focus_theme') || 'dark';
    document.body.setAttribute('data-theme', theme);
    updateThemeUI(theme);
}

export function toggleTheme() {
    const current = document.body.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    localStorage.setItem('focus_theme', next);
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
