import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let AppState, clearLocalStudyData, clearProgressData, clearSourcesData, createUncategorizedFolderRecord;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    const stateMod = await import('../src/core/state.js');
    AppState = stateMod.AppState;
    clearLocalStudyData = stateMod.clearLocalStudyData;
    clearProgressData = stateMod.clearProgressData;
    clearSourcesData = stateMod.clearSourcesData;
    createUncategorizedFolderRecord = stateMod.createUncategorizedFolderRecord;
});

beforeEach(() => {
    // Seed initial dummy data
    AppState.sources = [{ id: 'src1', name: 'Source 1', questions: [{ id: 1 }] }];
    AppState.folders = [createUncategorizedFolderRecord(), { id: 'f1', name: 'Folder 1' }];
    AppState.stats = { src1_1: { stability: 5, difficulty: 3 } };
    AppState.recentTests = [{ id: 'test1' }];
    AppState.quickPresets = [{ id: 'preset1', sourceIds: ['src1'] }];
    AppState.studyActivity = { '2026-08-01': { studied: true, questionCount: 15 } };
    AppState.continuityConfig = {
        freezeTokens: { total: 2, remaining: 1, tier1Earned: true, tier2Earned: false },
        focusFreezeTokens: { total: 2, remaining: 1, tier1Earned: true, tier2Earned: false },
        focusSources: ['src1'],
        focusSourceNames: { src1: 'Source 1' }
    };
});

test('clearProgressData resets stats & streaks but keeps sources, folders, and presets', () => {
    clearProgressData();

    // Stats & Progress cleared
    assert.deepEqual(AppState.stats, {});
    assert.deepEqual(AppState.recentTests, []);
    assert.deepEqual(AppState.studyActivity, {});
    
    // Tokens reset to default state
    assert.equal(AppState.continuityConfig.freezeTokens.remaining, 1);
    assert.equal(AppState.continuityConfig.freezeTokens.tier1Earned, false);

    // Sources & Folders preserved
    assert.equal(AppState.sources.length, 1);
    assert.equal(AppState.sources[0].id, 'src1');
    assert.equal(AppState.folders.length, 2);
    assert.equal(AppState.quickPresets.length, 1);
});

test('clearSourcesData resets sources & folders but preserves state structure', () => {
    clearSourcesData();

    // Sources, folders, presets cleared
    assert.deepEqual(AppState.sources, []);
    assert.equal(AppState.folders.length, 1); // Only uncategorized remains
    assert.equal(AppState.folders[0].id, 'uncategorized-folder');
    assert.deepEqual(AppState.quickPresets, []);
});

test('clearLocalStudyData performs a full factory reset and clears sample key so sample JSON auto-loads', () => {
    clearLocalStudyData();

    assert.deepEqual(AppState.sources, []);
    assert.deepEqual(AppState.stats, {});
    assert.deepEqual(AppState.recentTests, []);
    assert.deepEqual(AppState.studyActivity, {});
    assert.equal(AppState.folders.length, 1);
    assert.deepEqual(AppState.quickPresets, []);
    assert.equal(global.localStorage.getItem('focus_app_sample_loaded'), null);
});

test('fresh state returns 0 streak without falsely auto-freezing yesterday', async () => {
    clearLocalStudyData();
    const { calculateGlobalStreak, calculateFocusStreak } = await import('../src/features/stats/continuity-engine.js');

    assert.equal(calculateGlobalStreak(), 0);
    assert.equal(calculateFocusStreak(), 0);
    assert.equal(AppState.continuityConfig.freezeTokens.remaining, 1);
    assert.equal(AppState.continuityConfig.focusFreezeTokens.remaining, 1);
});
