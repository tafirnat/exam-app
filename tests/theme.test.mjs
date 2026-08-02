import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

/* The stored theme was known in two places: theme.js kept it under
   'focus_theme' defaulting to dark, and the backup export read
   'focus_app_theme' defaulting to light. The second key was never written by
   anything, so every exported backup claimed a light theme regardless of what
   the user was looking at - a copy of a fact drifting away from the fact.
   getActiveTheme() is now the single answer, and these cases keep it that way. */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

let theme, storage;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    theme = await import('../src/core/theme.js');
    storage = await import('../src/core/storage.js');
});

beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
});

test('the stored theme is what getActiveTheme reports', () => {
    storage.persist('focus_theme', 'light');
    assert.equal(theme.getActiveTheme(), 'light');
});

test('an unset theme is dark, the same default initTheme paints', () => {
    assert.equal(theme.getActiveTheme(), 'dark');

    theme.initTheme();
    assert.equal(document.documentElement.getAttribute('data-theme'), 'dark',
        'the default must not differ between the reader and the painter');
});

test('initTheme paints the stored theme', () => {
    storage.persist('focus_theme', 'light');
    theme.initTheme();
    assert.equal(document.documentElement.getAttribute('data-theme'), 'light');
});

test('toggling stores under the same key getActiveTheme reads', () => {
    theme.initTheme();                       // dark
    theme.toggleTheme();                     // -> light

    assert.equal(theme.getActiveTheme(), 'light',
        'a toggle that writes a key nobody reads is how the backup got stuck on light');
    assert.equal(document.documentElement.getAttribute('data-theme'), 'light');
});

function jsFiles(dir) {
    return readdirSync(dir).flatMap(entry => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return jsFiles(full);
        return entry.endsWith('.js') ? [full] : [];
    });
}

/* Matches the phantom key inside an actual storage call, not in prose. A plain
   substring search would fire on the comment in theme.js that explains why the
   key is forbidden, and a rule that breaks on its own documentation gets
   deleted by the next person who trips over it. */
const PHANTOM_KEY_CALL = /(?:persist|persistRemove|read[A-Za-z]*|getItem|setItem)\(\s*['"]focus_app_theme['"]/;

test('nothing reads or writes a second theme key', () => {
    // 'focus_app_theme' is a key nothing ever wrote. Reading it cannot fail
    // loudly - it just quietly yields the fallback, which is how the backup
    // ended up claiming a light theme for everyone.
    const offenders = jsFiles(SRC)
        .filter(file => PHANTOM_KEY_CALL.test(readFileSync(file, 'utf8')))
        .map(file => file.slice(SRC.length));

    assert.deepEqual(offenders, [],
        `these touch a theme key nothing writes - ask theme.js instead:\n  ${offenders.join('\n  ')}`);
});

test('the phantom-key scan looks at calls, not at prose', () => {
    assert.equal(PHANTOM_KEY_CALL.test("   'focus_app_theme' and default to 'light', so backups"), false);
    assert.equal(PHANTOM_KEY_CALL.test("readString('focus_app_theme') || 'light'"), true);
    assert.equal(PHANTOM_KEY_CALL.test('localStorage.getItem("focus_app_theme")'), true);
});
