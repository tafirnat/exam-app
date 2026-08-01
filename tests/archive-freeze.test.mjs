import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let AppState, thawStatsOnRestore, calculateRetrievability;

const DAY = 24 * 60 * 60 * 1000;

/* Tolerance for the milliseconds that pass between building a fixture and
   reading the result back. */
const SLACK = 5000;

function iso(ms) {
    return new Date(ms).toISOString();
}

/** Days between a stat's review date and now - what FSRS actually consumes. */
function elapsedDays(stat) {
    return (Date.now() - new Date(stat.lastReview).getTime()) / DAY;
}

/**
 * A source whose single question was last reviewed `reviewedDaysAgo` ago and
 * which went into the archive `archivedDaysAgo` ago.
 */
function seedArchived({ reviewedDaysAgo, archivedDaysAgo, stability = 10 }) {
    const now = Date.now();
    const source = {
        id: 'srcA',
        name: 'Almanca B1',
        archived: true,
        archivedAt: now - archivedDaysAgo * DAY,
        questions: [{ id: 1 }]
    };
    AppState.sources = [source];
    AppState.stats = {
        srcA_1: {
            stability,
            difficulty: 5,
            lastReview: reviewedDaysAgo === null ? null : iso(now - reviewedDaysAgo * DAY)
        }
    };
    return source;
}

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    const stateMod = await import('../src/core/state.js');
    AppState = stateMod.AppState;

    const archiveMod = await import('../src/features/sources/archive.js');
    thawStatsOnRestore = archiveMod.thawStatsOnRestore;

    const engineMod = await import('../src/features/test/test-engine.js');
    calculateRetrievability = engineMod.calculateRetrievability;
});

beforeEach(() => {
    AppState.sources = [];
    AppState.stats = {};
});

test('time in the archive is not consumed: the question resumes where it paused', () => {
    // Reviewed 15 days ago, archived 10 days ago -> 5 days had elapsed on the
    // way in, and with stability 10 that leaves 5 days before it falls due.
    const source = seedArchived({ reviewedDaysAgo: 15, archivedDaysAgo: 10 });

    assert.equal(thawStatsOnRestore(source), 1);

    // Elapsed time is back to what it was at the moment of archiving.
    assert.ok(Math.abs(elapsedDays(AppState.stats.srcA_1) - 5) < SLACK / DAY);
});

test('the whole retrievability curve is preserved, not just the due date', () => {
    const source = seedArchived({ reviewedDaysAgo: 15, archivedDaysAgo: 10, stability: 10 });
    const stat = AppState.stats.srcA_1;

    // R as it stood when the source was archived: 5 days elapsed of stability 10.
    const rAtArchive = Math.pow(0.9, 5 / 10);

    thawStatsOnRestore(source);

    const rAfterRestore = calculateRetrievability(stat.stability, stat.lastReview);
    assert.ok(Math.abs(rAfterRestore - rAtArchive) < 0.001);
});

test('a question already overdue on the way in comes back exactly as overdue', () => {
    // 30 days elapsed against stability 10 - deep into overdue territory.
    const source = seedArchived({ reviewedDaysAgo: 40, archivedDaysAgo: 10, stability: 10 });
    const stat = AppState.stats.srcA_1;

    thawStatsOnRestore(source);

    assert.ok(Math.abs(elapsedDays(stat) - 30) < SLACK / DAY);
    // Still overdue, but no worse than it went in - this is the whole point:
    // a long-parked library must not dump its entire backlog at once.
    assert.ok(calculateRetrievability(stat.stability, stat.lastReview) <= 0.9);
});

test('repeated archive cycles each shift only their own episode', () => {
    // Reviewed 20 days ago, archived 15 days ago: 5 days had elapsed on the way in.
    const source = seedArchived({ reviewedDaysAgo: 20, archivedDaysAgo: 15 });

    thawStatsOnRestore(source);
    const afterFirst = elapsedDays(AppState.stats.srcA_1);
    assert.ok(Math.abs(afterFirst - 5) < SLACK / DAY);

    // Second cycle: two more days ran off the clock before it was archived again.
    source.archivedAt = Date.now() - 2 * DAY;
    thawStatsOnRestore(source);

    // 3 days elapsed - exactly where the clock stood at the second archiving.
    // Re-applying the first 15-day episode would have driven this to 0.
    assert.ok(Math.abs(elapsedDays(AppState.stats.srcA_1) - 3) < SLACK / DAY);
});

test('a restored source cannot be shifted twice: no archivedAt, no shift', () => {
    const source = seedArchived({ reviewedDaysAgo: 15, archivedDaysAgo: 10 });
    thawStatsOnRestore(source);
    const settled = AppState.stats.srcA_1.lastReview;

    delete source.archivedAt;

    assert.equal(thawStatsOnRestore(source), 0);
    assert.equal(AppState.stats.srcA_1.lastReview, settled);
});

test('a source with no archivedAt is left completely alone', () => {
    const source = seedArchived({ reviewedDaysAgo: 15, archivedDaysAgo: 10 });
    delete source.archivedAt;
    const before = AppState.stats.srcA_1.lastReview;

    assert.equal(thawStatsOnRestore(source), 0);
    assert.equal(AppState.stats.srcA_1.lastReview, before);
});

test('never-reviewed questions stay null instead of gaining a fake review date', () => {
    const source = seedArchived({ reviewedDaysAgo: null, archivedDaysAgo: 10 });

    assert.equal(thawStatsOnRestore(source), 0);
    assert.equal(AppState.stats.srcA_1.lastReview, null);
});

test('a corrupt review date is not turned into NaN', () => {
    const source = seedArchived({ reviewedDaysAgo: 15, archivedDaysAgo: 10 });
    AppState.stats.srcA_1.lastReview = 'not-a-date';

    assert.equal(thawStatsOnRestore(source), 0);
    // Left verbatim: a NaN date would make calculateRetrievability return NaN
    // and drop the question out of FSRS scheduling entirely.
    assert.equal(AppState.stats.srcA_1.lastReview, 'not-a-date');
});

test('the shift never pushes a review date into the future', () => {
    // Archived almost immediately after the review, then parked for a year.
    const source = seedArchived({ reviewedDaysAgo: 365, archivedDaysAgo: 364 });

    thawStatsOnRestore(source);

    assert.ok(new Date(AppState.stats.srcA_1.lastReview).getTime() <= Date.now());
});

test('questions without a stat record are skipped without throwing', () => {
    const source = seedArchived({ reviewedDaysAgo: 15, archivedDaysAgo: 10 });
    source.questions.push({ id: 2 });

    assert.equal(thawStatsOnRestore(source), 1);
});
