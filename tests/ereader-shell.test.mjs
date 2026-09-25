import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import {
    EREADER_VIEWS,
    isEreaderView,
    headerChromeFor,
    applyEreaderChrome,
    bindEreaderShell
} from '../src/features/ereader/ereader-shell.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html);
const document = dom.window.document;

test('1. #actionMenu > .menu-items has exactly two .menu-mode-group children (test, ereader) and no other children', () => {
    const menuItems = document.querySelector('#actionMenu > .menu-items');
    assert.ok(menuItems, '#actionMenu > .menu-items must exist');
    const children = [...menuItems.children];
    assert.equal(children.length, 2, 'menu-items should have exactly 2 children');
    assert.ok(children[0].classList.contains('menu-mode-group'), 'child 0 must be .menu-mode-group');
    assert.equal(children[0].getAttribute('data-menu-mode'), 'test');
    assert.ok(children[1].classList.contains('menu-mode-group'), 'child 1 must be .menu-mode-group');
    assert.equal(children[1].getAttribute('data-menu-mode'), 'ereader');
});

test('2. test menu group contains all legacy menu IDs', () => {
    const testGroup = document.querySelector('#actionMenu .menu-mode-group[data-menu-mode="test"]');
    assert.ok(testGroup, 'test group must exist');
    const requiredIds = [
        'menuExportBtn', 'menuImportBtn', 'menuEditPrompt', 'menuManageAIProviders',
        'menuTheme', 'menuStar', 'menuFlag', 'menuNote', 'menuTranslateAll',
        'menuCopyAI', 'menuOpenGuide', 'menuStartOnboarding', 'menuResetApp',
        'testOnlyMenuItems'
    ];
    for (const id of requiredIds) {
        const el = testGroup.querySelector(`#${id}`);
        assert.ok(el, `test group must contain #${id}`);
    }
});

test('3. ereader menu group contains exactly the specified IDs and no others', () => {
    const ereaderGroup = document.querySelector('#actionMenu .menu-mode-group[data-menu-mode="ereader"]');
    assert.ok(ereaderGroup, 'ereader group must exist');
    const expectedIds = [
        'menuEreaderLibrary',
        'ereaderTocMenuSection',
        'ereaderTocList',
        'ereaderReadingMenuSection',
        'ereaderFontDecBtn',
        'ereaderFontValue',
        'ereaderFontIncBtn',
        'ereaderPrintBtn',
        'menuEreaderReset'
    ];
    const actualIds = [...ereaderGroup.querySelectorAll('[id]')].map(el => el.id);
    assert.deepEqual(actualIds.sort(), [...expectedIds].sort(), 'ereader group IDs must match exactly');
});

test('4. no duplicate IDs anywhere in the document', () => {
    const allElementsWithId = document.querySelectorAll('[id]');
    const seen = new Set();
    const duplicates = [];
    for (const el of allElementsWithId) {
        if (seen.has(el.id)) {
            duplicates.push(el.id);
        }
        seen.add(el.id);
    }
    assert.deepEqual(duplicates, [], `Duplicate IDs found: ${duplicates.join(', ')}`);
});

test('5. ereader group has no inline style attributes except the two display:none sections', () => {
    const ereaderGroup = document.querySelector('#actionMenu .menu-mode-group[data-menu-mode="ereader"]');
    assert.ok(ereaderGroup, 'ereader group must exist');
    const elementsWithStyle = [...ereaderGroup.querySelectorAll('[style]')];
    if (ereaderGroup.hasAttribute('style')) {
        elementsWithStyle.unshift(ereaderGroup);
    }
    const allowedIds = new Set(['ereaderTocMenuSection', 'ereaderReadingMenuSection']);
    for (const el of elementsWithStyle) {
        assert.ok(allowedIds.has(el.id), `Element with id "${el.id}" has unexpected inline style: ${el.getAttribute('style')}`);
        assert.equal(el.getAttribute('style').trim().replace(/\s+/g, ' '), 'display: none;');
    }
    assert.equal(elementsWithStyle.length, 2, 'Exactly 2 elements in ereader group may have inline styles');
});

test('6. header elements are placed correctly with respect to siblings', () => {
    const headerBackBtn = document.getElementById('headerBackBtn');
    const headerEreaderBtn = document.getElementById('headerEreaderBtn');
    assert.ok(headerBackBtn && headerEreaderBtn, 'both header buttons must exist');
    assert.equal(headerBackBtn.nextElementSibling, headerEreaderBtn, '#headerEreaderBtn must be immediate next sibling of #headerBackBtn');

    const headerSyncContainer = document.querySelector('.header-sync-container');
    const ereaderHeaderTools = document.getElementById('ereaderHeaderTools');
    assert.ok(headerSyncContainer && ereaderHeaderTools, 'both tools and sync container must exist');
    assert.equal(headerSyncContainer.previousElementSibling, ereaderHeaderTools, '#ereaderHeaderTools must be immediate previous sibling of .header-sync-container');
});

test('7. ereader views are direct children of <main>', () => {
    const main = document.querySelector('main');
    assert.ok(main, '<main> element must exist');
    const libraryView = document.getElementById('ereaderLibraryView');
    const bookView = document.getElementById('ereaderBookView');
    assert.ok(libraryView, '#ereaderLibraryView must exist');
    assert.ok(bookView, '#ereaderBookView must exist');
    assert.equal(libraryView.parentElement, main, '#ereaderLibraryView must be direct child of <main>');
    assert.equal(bookView.parentElement, main, '#ereaderBookView must be direct child of <main>');

    const printHost = document.getElementById('ereaderPrintHost');
    assert.ok(printHost, '#ereaderPrintHost must exist');
    assert.equal(printHost.parentElement, document.body, '#ereaderPrintHost must be direct child of <body>');
});

test('8. headerChromeFor returns table values and enforces invariant ereaderBtn === flex => homeBtn !== flex', () => {
    // home
    const homeChrome = headerChromeFor('home');
    assert.deepEqual(homeChrome, {
        ereaderBtn: 'flex',
        homeBtn: null,
        menuToggle: null,
        header: null,
        tools: 'none',
        sync: '',
        menuMode: 'test'
    });

    // ereaderLibrary
    const libChrome = headerChromeFor('ereaderLibrary');
    assert.deepEqual(libChrome, {
        ereaderBtn: 'none',
        homeBtn: 'flex',
        menuToggle: 'flex',
        header: 'flex',
        tools: 'none',
        sync: 'none',
        menuMode: 'ereader'
    });

    // ereaderBook
    const bookChrome = headerChromeFor('ereaderBook');
    assert.deepEqual(bookChrome, {
        ereaderBtn: 'none',
        homeBtn: 'flex',
        menuToggle: 'flex',
        header: 'flex',
        tools: 'flex',
        sync: 'none',
        menuMode: 'ereader'
    });

    // other test views
    const otherViews = ['sources', 'stats', 'test', 'statsPreview', 'results', 'unknownView'];
    for (const v of otherViews) {
        const c = headerChromeFor(v);
        assert.deepEqual(c, {
            ereaderBtn: 'none',
            homeBtn: null,
            menuToggle: null,
            header: null,
            tools: 'none',
            sync: '',
            menuMode: 'test'
        });
    }

    // Invariant check across all views
    const allViews = ['home', 'ereaderLibrary', 'ereaderBook', ...otherViews];
    for (const v of allViews) {
        const c = headerChromeFor(v);
        if (c.ereaderBtn === 'flex') {
            assert.notEqual(c.homeBtn, 'flex', `Invariant broken for view ${v}: ereaderBtn and homeBtn are both flex`);
        }
    }
});

test('9. ereader.css link is in <head>', () => {
    const link = document.querySelector('head link[href="/src/features/ereader/ereader.css"]');
    assert.ok(link, 'link to /src/features/ereader/ereader.css must exist in <head>');
});

test('10. isEreaderView correctly identifies ereader views', () => {
    assert.equal(isEreaderView('ereaderLibrary'), true);
    assert.equal(isEreaderView('ereaderBook'), true);
    assert.equal(isEreaderView('home'), false);
    assert.equal(isEreaderView('test'), false);
    assert.equal(isEreaderView('stats'), false);
});

test('11. applyEreaderChrome applies chrome and wires goHome in DOM', () => {
    const testDom = new JSDOM(html);
    const win = testDom.window;
    globalThis.document = win.document;

    let homeNavigated = false;
    applyEreaderChrome('ereaderLibrary', { goHome: () => { homeNavigated = true; } });

    assert.equal(win.document.getElementById('actionMenu').dataset.mode, 'ereader');
    assert.equal(win.document.getElementById('headerBackBtn').style.display, 'flex');
    assert.equal(win.document.getElementById('headerEreaderBtn').style.display, 'none');
    assert.equal(win.document.getElementById('ereaderHeaderTools').style.display, 'none');
    assert.equal(win.document.querySelector('.header-sync-container').style.display, 'none');
    assert.equal(win.document.getElementById('ereaderTocMenuSection').style.display, 'none');
    assert.equal(win.document.getElementById('ereaderReadingMenuSection').style.display, 'none');

    // Trigger goHome
    win.document.getElementById('headerBackBtn').click();
    assert.equal(homeNavigated, true, 'clicking #headerBackBtn in ereader view must call goHome');

    // Test ereaderBook chrome
    applyEreaderChrome('ereaderBook', { goHome: () => {} });
    assert.equal(win.document.getElementById('actionMenu').dataset.mode, 'ereader');
    assert.equal(win.document.getElementById('ereaderHeaderTools').style.display, 'flex');
    assert.equal(win.document.getElementById('ereaderTocMenuSection').style.display, 'block');
    assert.equal(win.document.getElementById('ereaderReadingMenuSection').style.display, 'block');

    // Test returning to home
    applyEreaderChrome('home', { goHome: () => {} });
    assert.equal(win.document.getElementById('actionMenu').dataset.mode, 'test');
    assert.equal(win.document.getElementById('headerEreaderBtn').style.display, 'flex');
    assert.equal(win.document.getElementById('ereaderHeaderTools').style.display, 'none');
    assert.equal(win.document.querySelector('.header-sync-container').style.display, '');
    assert.equal(win.document.getElementById('ereaderTocMenuSection').style.display, 'none');
    assert.equal(win.document.getElementById('ereaderReadingMenuSection').style.display, 'none');
});

test('12. bindEreaderShell wires switchView and closeMenu correctly', () => {
    const testDom = new JSDOM(html);
    const win = testDom.window;
    globalThis.document = win.document;

    let targetView = null;
    let menuClosed = false;

    bindEreaderShell({
        switchView: (v) => { targetView = v; },
        closeMenu: () => { menuClosed = true; }
    });

    win.document.getElementById('headerEreaderBtn').click();
    assert.equal(targetView, 'ereaderLibrary');

    targetView = null;
    win.document.getElementById('menuEreaderLibrary').click();
    assert.equal(menuClosed, true);
    assert.equal(targetView, 'ereaderLibrary');
});
