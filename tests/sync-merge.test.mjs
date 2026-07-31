import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let AppState, mergeSyncData, sanitizeActivityRecord, sanitizeStudyActivity;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    const stateMod = await import('../src/core/state.js');
    AppState = stateMod.AppState;

    const syncMod = await import('../src/core/github-sync.js');
    mergeSyncData = syncMod.mergeSyncData;

    const migrationMod = await import('../src/core/migration.js');
    sanitizeActivityRecord = migrationMod.sanitizeActivityRecord;
    sanitizeStudyActivity = migrationMod.sanitizeStudyActivity;
});

const emptyPayload = (extra = {}) => ({
    sources: [], folders: [], stats: {}, recentTests: [], studyActivity: {},
    deletedSourceIds: [], deletedFolderIds: [], deletedQuickPresetIds: [], quickPresets: [],
    ...extra
});

test('study activity merge keeps the higher count instead of summing it', () => {
    const local = emptyPayload({
        studyActivity: { '2026-07-31': { studied: true, questionCount: 7, correctCount: 5, wrongCount: 2, overdueSnapshot: 12 } }
    });
    const remote = emptyPayload({
        studyActivity: { '2026-07-31': { studied: true, questionCount: 7, correctCount: 5, wrongCount: 2, overdueSnapshot: 12 } }
    });

    const merged = mergeSyncData(local, remote);
    const day = merged.studyActivity['2026-07-31'];

    assert.equal(day.questionCount, 7);
    assert.equal(day.correctCount, 5);
    assert.equal(day.wrongCount, 2);
});

test('repeated merges stay stable and never compound', () => {
    let state = { studied: true, questionCount: 12, correctCount: 8, wrongCount: 4 };

    for (let i = 0; i < 20; i++) {
        const merged = mergeSyncData(
            emptyPayload({ studyActivity: { '2026-07-31': state } }),
            emptyPayload({ studyActivity: { '2026-07-31': state } })
        );
        state = merged.studyActivity['2026-07-31'];
    }

    assert.equal(state.questionCount, 12);
});

test('study activity merge preserves the focus track fields', () => {
    const local = emptyPayload({
        studyActivity: { '2026-07-31': { questionCount: 15, focusStudied: true, focusQuestionCount: 8, focusOverdueSnapshot: 15 } }
    });
    const remote = emptyPayload({
        studyActivity: { '2026-07-31': { questionCount: 10, focusQuestionCount: 3 } }
    });

    const day = mergeSyncData(local, remote).studyActivity['2026-07-31'];

    assert.equal(day.focusStudied, true);
    assert.equal(day.focusQuestionCount, 8);
    assert.equal(day.focusOverdueSnapshot, 15);
});

test('snapshot merge treats null as unmeasured and keeps a real zero', () => {
    const merged = mergeSyncData(
        emptyPayload({ studyActivity: { d1: { overdueSnapshot: null }, d2: { overdueSnapshot: 0 } } }),
        emptyPayload({ studyActivity: { d1: { overdueSnapshot: 9 }, d2: { overdueSnapshot: null } } })
    );

    assert.equal(merged.studyActivity.d1.overdueSnapshot, 9);
    assert.equal(merged.studyActivity.d2.overdueSnapshot, 0);
});

test('stats merge keeps lastReview as a usable date instead of NaN', () => {
    const older = '2026-07-20T10:00:00.000Z';
    const newer = '2026-07-30T10:00:00.000Z';

    const merged = mergeSyncData(
        emptyPayload({ stats: { 'src_1': { correct: 3, wrong: 1, difficulty: 6, stability: 4, lastReview: older } } }),
        emptyPayload({ stats: { 'src_1': { correct: 2, wrong: 1, difficulty: 5, stability: 3, lastReview: newer } } })
    );

    const stat = merged.stats['src_1'];
    assert.equal(stat.lastReview, newer);
    assert.ok(Number.isFinite(new Date(stat.lastReview).getTime()));
    assert.equal(stat.coeff, stat.difficulty / 2);
});

test('sanitizeActivityRecord pulls an inflated count back to the answer breakdown', () => {
    const repaired = sanitizeActivityRecord({
        studied: true,
        questionCount: 188243403672,
        correctCount: 5,
        wrongCount: 2,
        unansweredCount: 0
    });

    assert.equal(repaired.questionCount, 7);
});

test('sanitizeActivityRecord falls back to the day target when the breakdown is gone', () => {
    assert.equal(sanitizeActivityRecord({ questionCount: 188243403672 }).questionCount, 15);
    assert.equal(sanitizeActivityRecord({ questionCount: 188243403672, overdueSnapshot: 8 }).questionCount, 8);
    assert.equal(sanitizeActivityRecord({ questionCount: 120 }).questionCount, 120);
    assert.equal(sanitizeActivityRecord({ questionCount: -5 }).questionCount, 0);
    assert.equal(sanitizeActivityRecord({ questionCount: NaN }).questionCount, 0);
    assert.equal(sanitizeActivityRecord({ overdueSnapshot: NaN }).overdueSnapshot, null);
    assert.equal(sanitizeActivityRecord({ questionCount: 10, focusQuestionCount: 999 }).focusQuestionCount, 10);
});

test('sanitizeStudyActivity repairs stored days and reports the count', () => {
    AppState.studyActivity = {
        '2026-07-30': { studied: true, questionCount: 15, correctCount: 10, wrongCount: 5, unansweredCount: 0, frozen: false, overdueSnapshot: 15, focusStudied: false, focusQuestionCount: 0, focusFrozen: false, focusOverdueSnapshot: null },
        '2026-07-31': { studied: true, questionCount: 999999999, correctCount: 4, wrongCount: 3, unansweredCount: 0 }
    };

    assert.equal(sanitizeStudyActivity(), 1);
    assert.equal(AppState.studyActivity['2026-07-31'].questionCount, 7);
    assert.equal(AppState.studyActivity['2026-07-30'].questionCount, 15);
    assert.equal(sanitizeStudyActivity(), 0);
});
