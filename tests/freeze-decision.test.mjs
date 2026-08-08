import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/**
 * Who pays for a frozen day.
 *
 * The ledger in core/freeze-tokens.js was covered from the start; the code that
 * decides *which* record to charge was not covered at all, and that is where the
 * two measured defects lived. Both were invisible to the ledger tests, because
 * the ledger was doing exactly what it was told:
 *
 *   - the Odak track was frozen every single day for users who had never
 *     selected a focus source, since a track with no sources can never meet its
 *     requirement. Two day-opens emptied all three tokens, two of them global
 *     jokers spent on `focus:` days, and the Genel streak was left unprotected.
 *   - the Genel track was resolved to completion before Odak was offered
 *     anything, so it could take Odak's last token as a joker and Odak then lost
 *     the very day that token was there for.
 */

let engine, AppState, shiftDateStr, today, day;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    ({ AppState } = await import('../src/core/state.js'));
    engine = await import('../src/features/stats/continuity-engine.js');
    ({ shiftDateStr } = await import('../src/core/daily-activity.js'));

    today = engine.getLocalDateStr();
    day = (n) => shiftDateStr(today, n);
});

/** A day the user met the global bar on and did nothing towards focus. */
const globalOnlyDay = () => ({
    studied: true, questionCount: 20, frozen: false, overdueSnapshot: 20,
    focusStudied: false, focusQuestionCount: 0, focusFrozen: false, focusOverdueSnapshot: 15,
    byDevice: { dev1: { questionCount: 20 } }
});

/** A day nothing at all happened on. */
const missedDay = () => ({
    studied: false, questionCount: 0, frozen: false, overdueSnapshot: 20,
    focusStudied: false, focusQuestionCount: 0, focusFrozen: false, focusOverdueSnapshot: 15,
    byDevice: {}
});

const tokenRecord = (extra = {}) => ({
    total: 1, remaining: 1, tier1Earned: false, tier2Earned: false,
    initialized: true, spentOn: [], grants: [], ...extra
});

/** A library with `history` days of solid global-only work behind today. */
function seed({ history = 20, focusSources = [], global: g, focus: f } = {}) {
    AppState.deviceId = 'dev1';
    AppState.sources = focusSources.map(id => ({ id, name: id, archived: false, questions: [] }));
    AppState.stats = {};
    AppState.questions = [];
    AppState.studyActivity = {};
    for (let i = history; i >= 1; i--) AppState.studyActivity[day(-i)] = globalOnlyDay();
    AppState.continuityConfig = {
        focusSources,
        focusSourceNames: {},
        focusSourceTimestamps: {},
        freezeTokens: tokenRecord(g),
        focusFreezeTokens: tokenRecord(f)
    };
}

const tokens = () => [
    AppState.continuityConfig.freezeTokens,
    AppState.continuityConfig.focusFreezeTokens
];

beforeEach(() => { if (global.localStorage) global.localStorage.clear(); });

// ── The Odak track has to exist before it is worth protecting ───────────────

test('no focus source selected means no focus day is ever frozen', () => {
    seed({ focusSources: [], global: { total: 2, remaining: 2, tier1Earned: true, tier2Earned: true } });

    engine.initTodayActivity();

    const [g, f] = tokens();
    assert.equal(g.remaining, 2, 'the Genel tokens are untouched');
    assert.equal(f.remaining, 1, 'and so is the Odak one');
    assert.deepEqual(g.spentOn, [], 'nothing was charged for a track the user does not have');
    assert.equal(AppState.studyActivity[day(-1)].focusFrozen, false);
});

test('a global joker is never spent on a focus day the user cannot study', () => {
    /* The measured drain, at its sharpest: the joker exists to protect the streak
       the user is actually running, and it was going to the one they never
       opened. */
    seed({ focusSources: [], global: { total: 2, remaining: 2, tier1Earned: true, tier2Earned: true },
           focus: { total: 1, remaining: 0, spentOn: ['focus:2026-01-01'] } });

    engine.initTodayActivity();

    const [g] = tokens();
    assert.equal(g.remaining, 2);
    assert.ok(!g.spentOn.some(name => name.startsWith('focus:')),
        'no global token paid for a focus day');
});

test('a selection whose sources are all archived counts as no selection', () => {
    // The requirement cannot be met either way, so freezing only burns tokens.
    seed({ focusSources: ['src-a'] });
    AppState.sources = [{ id: 'src-a', name: 'A', archived: true, questions: [] }];

    engine.initTodayActivity();

    assert.equal(tokens()[1].remaining, 1, 'the Odak token is kept for when the source comes back');
    assert.equal(AppState.studyActivity[day(-1)].focusFrozen, false);
});

test('with a live focus source the focus day is frozen as before', () => {
    // The gate must not turn the feature off for the users it is meant for.
    seed({ focusSources: ['src-a'] });

    engine.initTodayActivity();

    assert.equal(AppState.studyActivity[day(-1)].focusFrozen, true);
    assert.equal(tokens()[1].remaining, 0, 'and it cost the Odak token');
});

// ── Own tokens first, jokers second ────────────────────────────────────────

test('the Genel track does not take the Odak token while Odak still needs it', () => {
    seed({
        focusSources: ['src-a'],
        // Genel is out of its own, Odak holds one and has a joker earned.
        global: { total: 1, remaining: 0, tier1Earned: true, spentOn: ['global:2026-01-01'] },
        focus: { total: 2, remaining: 1, tier1Earned: true, tier2Earned: true, spentOn: ['focus:2026-01-01'] }
    });
    AppState.studyActivity[day(-1)] = missedDay();

    engine.initTodayActivity();

    const yesterday = AppState.studyActivity[day(-1)];
    assert.equal(yesterday.focusFrozen, true, 'Odak spent its own token on its own day');
    assert.equal(yesterday.frozen, false, 'and Genel went without rather than taking it');
});

test('cross-use still happens once every track has been offered its own', () => {
    seed({
        focusSources: ['src-a'],
        global: { total: 1, remaining: 0, tier1Earned: true, spentOn: ['global:2026-01-01'] },
        focus: { total: 2, remaining: 2, tier1Earned: true, tier2Earned: true }
    });
    AppState.studyActivity[day(-1)] = missedDay();

    engine.initTodayActivity();

    const yesterday = AppState.studyActivity[day(-1)];
    assert.equal(yesterday.focusFrozen, true);
    assert.equal(yesterday.frozen, true, 'the spare Odak joker covered the Genel day');
    assert.equal(tokens()[1].remaining, 0);
});

test('only a Tier 2 token crosses tracks', () => {
    seed({
        focusSources: ['src-a'],
        global: { total: 1, remaining: 0, tier1Earned: true, spentOn: ['global:2026-01-01'] },
        focus: { total: 1, remaining: 1, tier1Earned: true, tier2Earned: false }
    });
    AppState.studyActivity[day(-1)] = missedDay();

    engine.initTodayActivity();

    assert.equal(AppState.studyActivity[day(-1)].focusFrozen, true);
    assert.equal(AppState.studyActivity[day(-1)].frozen, false, 'a blue token stays in its own track');
});

// ── The records have to exist before the freeze reads them ─────────────────

test('a config that has never held token records still freezes its first miss', () => {
    /* freezeMissedDaysIfPossible() used to run before the records were created,
       so a config from an older build missed its first freeze entirely and the
       streak dropped with a token sitting unspent. */
    seed({ focusSources: [] });
    delete AppState.continuityConfig.freezeTokens;
    delete AppState.continuityConfig.focusFreezeTokens;
    AppState.studyActivity[day(-1)] = missedDay();

    engine.initTodayActivity();

    assert.equal(AppState.studyActivity[day(-1)].frozen, true);
    assert.ok(engine.calculateGlobalStreak() > 1, 'so the streak survives the miss');
});

// ── Earning ────────────────────────────────────────────────────────────────

test('a frozen day does not count towards earning the next token', () => {
    /* Otherwise the two feed each other: freeze a day, earn a replacement,
       freeze another. Both the spec and the card say "kesintisiz seri". */
    seed({ history: 20, focusSources: [] });
    AppState.studyActivity[day(-3)] = { ...missedDay(), frozen: true };

    engine.initTodayActivity();

    assert.equal(tokens()[0].tier1Earned, false, 'the window has a coasted day in it');
});

test('a clean window still earns', () => {
    seed({ history: 20, focusSources: [] });

    engine.initTodayActivity();

    const [g] = tokens();
    assert.equal(g.tier1Earned, true);
    assert.equal(g.tier2Earned, true);
    assert.ok(g.grants.length > 0, 'and the grant is recorded rather than applied by deletion');
});

test('an earned grant is named for the day it was earned', () => {
    seed({ history: 20, focusSources: [] });

    engine.initTodayActivity();

    assert.ok(tokens()[0].grants.includes(`tier1:${today}`));
});
