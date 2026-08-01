import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let AppState, getOrderedLiveSources, getDifficultyNavItems;

before(async () => {
    const dom = new JSDOM('<!doctype html><html lang="tr"><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    const stateMod = await import('../src/core/state.js');
    AppState = stateMod.AppState;

    const uiMod = await import('../src/features/stats/continuity-ui.js');
    getOrderedLiveSources = uiMod.getOrderedLiveSources;
    getDifficultyNavItems = uiMod.getDifficultyNavItems;
});

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const markup = new JSDOM(html).window.document;

test('homeDifficultyStatsCard carries badge and control buttons in header', () => {
    const card = markup.getElementById('homeDifficultyStatsCard');
    assert.ok(card, 'homeDifficultyStatsCard should exist');
    assert.ok(markup.getElementById('diffCardSourceBadge'), 'diffCardSourceBadge should exist');
    assert.ok(markup.getElementById('diffCardStarBtn'), 'diffCardStarBtn should exist');
    assert.ok(markup.getElementById('diffCardPrevBtn'), 'diffCardPrevBtn should exist');
    assert.ok(markup.getElementById('diffCardNextBtn'), 'diffCardNextBtn should exist');
});

test('getDifficultyNavItems orders items: All Active Sources -> Starred (folder order) -> Unstarred (folder order)', () => {
    AppState.folders = [
        { id: 'f1', name: 'Matematik', order: 0 },
        { id: 'f2', name: 'Fizik', order: 1 }
    ];
    AppState.sources = [
        { id: 's1', name: 'Mat 1', folderId: 'f1', order: 0, starred: false, active: true },
        { id: 's2', name: 'Mat 2 (Starred)', folderId: 'f1', order: 1, starred: true, active: true },
        { id: 's3', name: 'Fiz 1 (Starred)', folderId: 'f2', order: 0, starred: true, active: true },
        { id: 's4', name: 'Fiz 2', folderId: 'f2', order: 1, starred: false, active: true }
    ];

    const navItems = getDifficultyNavItems();

    assert.equal(navItems.length, 5, 'Should have 1 "all" item + 4 sources');
    assert.equal(navItems[0].id, 'all', 'First item must be "all"');

    // Starred sources in folder order (Mat 2, then Fiz 1)
    assert.equal(navItems[1].id, 's2');
    assert.equal(navItems[1].isStarred, true);
    assert.equal(navItems[2].id, 's3');
    assert.equal(navItems[2].isStarred, true);

    // Unstarred sources in folder order (Mat 1, then Fiz 2)
    assert.equal(navItems[3].id, 's1');
    assert.equal(navItems[3].isStarred, false);
    assert.equal(navItems[4].id, 's4');
    assert.equal(navItems[4].isStarred, false);
});

test('getDifficultyNavItems excludes archived sources automatically', () => {
    AppState.folders = [{ id: 'f1', name: 'Kimya', order: 0 }];
    AppState.sources = [
        { id: 's1', name: 'Active Source', folderId: 'f1', order: 0, active: true, starred: true },
        { id: 's2', name: 'Archived Source', folderId: 'f1', order: 1, active: true, starred: true, archived: true }
    ];

    const navItems = getDifficultyNavItems();
    assert.equal(navItems.length, 2, 'Should only contain "all" and the active non-archived source');
    assert.equal(navItems[1].id, 's1');
});
