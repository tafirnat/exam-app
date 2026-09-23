import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let AppState, storage;
let getActiveContextKey, getSessionContextKey, saveContextSession, getContextSession, clearContextSession, snapshotCurrentSession;
let clearActiveTest, renderResumeButton;

const HTML_FIXTURE = `<!doctype html><html><body>
    <div id="startBtnContainer">
        <button id="resumeBtn" style="display:none"></button>
        <button id="startBtn"></button>
    </div>
</body></html>`;

before(async () => {
    const dom = new JSDOM(HTML_FIXTURE, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    storage = await import('../src/core/storage.js');
    const stateModule = await import('../src/core/state.js');
    AppState = stateModule.AppState;
    getActiveContextKey = stateModule.getActiveContextKey;
    getSessionContextKey = stateModule.getSessionContextKey;
    saveContextSession = stateModule.saveContextSession;
    getContextSession = stateModule.getContextSession;
    clearContextSession = stateModule.clearContextSession;
    snapshotCurrentSession = stateModule.snapshotCurrentSession;
    clearActiveTest = stateModule.clearActiveTest;

    const testUi = await import('../src/features/test/test-ui.js');
    renderResumeButton = testUi.renderResumeButton;
});

beforeEach(() => {
    localStorage.clear();
    AppState.sources = [
        { id: 'src_1', name: 'Source 1', active: false, archived: false, questions: [{ id: 'q1' }] },
        { id: 'src_2', name: 'Source 2', active: false, archived: false, questions: [{ id: 'q2' }] },
        { id: 'src_3', name: 'Source 3', active: false, archived: false, questions: [{ id: 'q3' }] }
    ];
    AppState.quickPresets = [
        { id: 'qp_combo', name: 'Preset 1+2', sourceIds: ['src_1', 'src_2'] }
    ];
    AppState.contextSessions = {};
    AppState.presetSessions = {};
    AppState.currentTest = [];
    AppState.currentIndex = 0;
    AppState.userAnswers = {};
    AppState.isAnswerChecked = {};
    AppState.shuffledOptionsMap = {};
    AppState.testTracking = null;
    document.getElementById('resumeBtn').style.display = 'none';
});

const isResumeVisible = () => document.getElementById('resumeBtn').style.display !== 'none';

test('getActiveContextKey resolves streak mode correctly', () => {
    const focusStreakKey = getActiveContextKey({ mode: 'streak', scope: 'focus' });
    assert.equal(focusStreakKey, 'streak:focus');

    const globalStreakKey = getActiveContextKey({ mode: 'streak', scope: 'global' });
    assert.equal(globalStreakKey, 'streak:global');
});

test('getActiveContextKey resolves single source and combo and preset', () => {
    // 1. No active sources
    assert.equal(getActiveContextKey(), null);

    // 2. Single active source
    AppState.sources[0].active = true;
    assert.equal(getActiveContextKey(), 'source:src_1');

    // 3. Two active sources matching quick preset 'qp_combo'
    AppState.sources[1].active = true;
    assert.equal(getActiveContextKey(), 'preset:qp_combo');

    // 4. Sources not matching any preset
    AppState.sources[2].active = true;
    assert.equal(getActiveContextKey(), 'combo:src_1+src_2+src_3');
});

test('saveContextSession and getContextSession persist and retrieve data properly', () => {
    const sessionData = {
        currentTest: ['src_1_q1'],
        currentIndex: 0,
        userAnswers: {},
        isAnswerChecked: {}
    };

    saveContextSession('source:src_1', sessionData);

    const retrieved = getContextSession('source:src_1');
    assert.ok(retrieved);
    assert.deepEqual(retrieved.currentTest, ['src_1_q1']);
    assert.equal(retrieved.contextKey, 'source:src_1');

    // Preset sessions should sync with presetSessions for backward compatibility
    saveContextSession('preset:qp_combo', sessionData);
    assert.ok(AppState.presetSessions['qp_combo']);
    assert.deepEqual(getContextSession('preset:qp_combo').currentTest, ['src_1_q1']);
});

test('snapshotCurrentSession saves current test state to active context', () => {
    AppState.sources[0].active = true; // context = source:src_1
    AppState.currentTest = ['src_1_q1', 'src_1_q2'];
    AppState.currentIndex = 1;
    AppState.userAnswers = { 'src_1_q1': [0] };
    AppState.testTracking = { mode: 'normal', sourceNames: ['Source 1'] };

    snapshotCurrentSession();

    const saved = getContextSession('source:src_1');
    assert.ok(saved);
    assert.equal(saved.currentIndex, 1);
    assert.deepEqual(saved.userAnswers, { 'src_1_q1': [0] });
});

test('switching sources cleanly resets resume button when second source has no test, while keeping first source session', () => {
    // 1. Source 1 has an in-progress test
    AppState.sources[0].active = true;
    AppState.currentTest = ['src_1_q1'];
    AppState.currentIndex = 0;
    snapshotCurrentSession();
    storage.persist('focus_app_active_test', {
        currentTest: ['src_1_q1'],
        currentIndex: 0,
        testTracking: { mode: 'normal' }
    });

    renderResumeButton();
    assert.equal(isResumeVisible(), true, 'Devam Et should be visible on Source 1');

    // 2. Switch to Source 2 (which has no test)
    snapshotCurrentSession(); // snapshots Source 1
    AppState.sources[0].active = false;
    AppState.sources[1].active = true;

    // Simulate checkActiveTest logic for Source 2
    const key = getActiveContextKey();
    assert.equal(key, 'source:src_2');
    const savedForSrc2 = getContextSession(key);
    assert.equal(savedForSrc2, null);

    // Demote old active test from memory and storage without deleting Source 1's saved session
    AppState.currentTest = [];
    clearActiveTest(null, { clearSavedSession: false });
    renderResumeButton();

    assert.equal(isResumeVisible(), false, 'Devam Et must NOT be visible on Source 2');
    assert.equal(document.getElementById('startBtn').getAttribute('data-i18n'), 'start_test');

    // Verify Source 1's session was NOT deleted from contextSessions
    assert.ok(getContextSession('source:src_1'), 'Source 1 session should still exist in contextSessions');

    // 3. Switch back to Source 1
    AppState.sources[1].active = false;
    AppState.sources[0].active = true;
    const restoredSession = getContextSession(getActiveContextKey());
    assert.ok(restoredSession);

    AppState.currentTest = restoredSession.currentTest;
    storage.persist('focus_app_active_test', restoredSession);
    renderResumeButton();

    assert.equal(isResumeVisible(), true, 'Devam Et must be restored when switching back to Source 1');
});

test('clearActiveTest with clearSavedSession: true clears contextSession', () => {
    AppState.sources[0].active = true;
    saveContextSession('source:src_1', { currentTest: ['src_1_q1'] });
    assert.ok(getContextSession('source:src_1'));

    clearActiveTest('source:src_1', { clearSavedSession: true });
    assert.equal(getContextSession('source:src_1'), null);
});

test('getSessionContextKey accurately identifies origin context from session and composite question IDs', () => {
    // 1. Direct contextKey
    assert.equal(getSessionContextKey({ contextKey: 'source:src_1' }), 'source:src_1');

    // 2. Direct testTracking.contextKey
    assert.equal(getSessionContextKey({ testTracking: { contextKey: 'streak:focus' } }), 'streak:focus');

    // 3. Streak mode without contextKey
    assert.equal(getSessionContextKey({ testTracking: { mode: 'streak', scope: 'global' } }), 'streak:global');

    // 4. Introspecting question IDs when contextKey is missing
    const singleSourceSession = {
        currentTest: ['src_1_q1', 'src_1_q2']
    };
    assert.equal(getSessionContextKey(singleSourceSession), 'source:src_1');

    // 5. Introspecting preset questions
    const comboSession = {
        currentTest: ['src_1_q1', 'src_2_q2']
    };
    assert.equal(getSessionContextKey(comboSession), 'preset:qp_combo');
});

test('renderResumeButton rejects activeData when active source does not match session context', () => {
    // Active source is Source 2
    AppState.sources[0].active = false;
    AppState.sources[1].active = true; // activeContextKey = 'source:src_2'

    // But focus_app_active_test has data from Source 1
    storage.persist('focus_app_active_test', {
        contextKey: 'source:src_1',
        currentTest: ['src_1_q1'],
        currentIndex: 0,
        userAnswers: {},
        isAnswerChecked: {},
        testTracking: { mode: 'normal', sourceNames: ['Source 1'] }
    });

    renderResumeButton();

    // Devam Et must be hidden and Başla must be shown
    assert.equal(isResumeVisible(), false, 'Devam Et should be rejected for mismatched source');
    assert.equal(document.getElementById('startBtn').getAttribute('data-i18n'), 'start_test');
});

