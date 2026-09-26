import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let fit;

before(async () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    fit = await import('../src/features/stats/filter-bar-fit.js');
});

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

test('R2-06: the first density that fits wins; nothing fits means icons only', () => {
    const { chooseFitMode, FitMode } = fit;
    assert.equal(chooseFitMode(() => false), FitMode.FULL);
    assert.equal(chooseFitMode(m => m === FitMode.FULL), FitMode.ACTIVE_LABEL);
    assert.equal(chooseFitMode(m => m !== FitMode.ICONS), FitMode.ICONS);
    assert.equal(chooseFitMode(() => true), FitMode.ICONS);
});

test('R2-06: the bar is measured, not sized by a breakpoint', () => {
    const bar = document.getElementById('statsFilterBar');
    let width = 0;
    Object.defineProperty(bar, 'clientWidth', { get: () => 300, configurable: true });
    Object.defineProperty(bar, 'scrollWidth', { get: () => width, configurable: true });

    width = 280;
    assert.equal(fit.fitFilterBar(bar), 'full');
    assert.equal(bar.classList.contains('fit-icons'), false);

    /* Labels make it too wide in full; the active-label mode is narrower. */
    Object.defineProperty(bar, 'scrollWidth', { get: () => (bar.classList.contains('fit-active-label') || bar.classList.contains('fit-icons') ? 290 : 500), configurable: true });
    assert.equal(fit.fitFilterBar(bar), 'active-label');
    assert.ok(bar.classList.contains('fit-active-label'));

    Object.defineProperty(bar, 'scrollWidth', { get: () => (bar.classList.contains('fit-icons') ? 290 : 500), configurable: true });
    assert.equal(fit.fitFilterBar(bar), 'icons');
    assert.ok(bar.classList.contains('fit-icons'));
    assert.equal(bar.classList.contains('fit-active-label'), false);

    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    assert.equal(/@media \(max-width: 1024px\)\s*\{\s*\.filter-btn:not\(\.active\)/.test(css), false, 'the old breakpoint rule is gone');
});

test('R2-06: the chosen filter is named in the header for a moment, then the title returns', async () => {
    const title = document.getElementById('headerTitle');
    title.setAttribute('data-i18n', 'show_stats');
    title.textContent = 'Question Details';

    fit.flashHeaderLabel('Noted', 20);
    assert.equal(title.textContent, 'Noted');
    assert.ok(title.classList.contains('header-title-flash'));
    assert.equal(title.hasAttribute('data-i18n'), false, 'a language change must not overwrite the flash');

    await tick(40);
    assert.equal(title.textContent, 'Question Details');
    assert.equal(title.getAttribute('data-i18n'), 'show_stats');
    assert.equal(title.classList.contains('header-title-flash'), false);
});

test('R2-06: a title set by someone else during the flash is kept', async () => {
    const title = document.getElementById('headerTitle');
    title.textContent = 'Question Details';
    fit.flashHeaderLabel('Starred', 20);
    title.textContent = 'e-Reader';
    await tick(40);
    assert.equal(title.textContent, 'e-Reader');
});

test('A7: ending the flash at once (a view change) restores the title and drops the style', () => {
    const title = document.getElementById('headerTitle');
    title.textContent = 'Question Details';
    fit.flashHeaderLabel('Starred', 5000);
    fit.endHeaderFlash();
    assert.equal(title.textContent, 'Question Details');
    assert.equal(title.classList.contains('header-title-flash'), false);
});

test('A7: main.js ends the flash when the view changes', () => {
    const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    const body = main.slice(main.indexOf('function switchView('), main.indexOf('function switchView(') + 600);
    assert.ok(body.includes('endHeaderFlash()'));
});
