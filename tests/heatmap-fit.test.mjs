import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// The yearly heatmap used to draw a fixed 53 columns, which overflowed every
// phone and left the card sideways-scrolling. It now fits the column count to
// the width instead of changing its shape - what needs guarding is that the
// seven weekday rows survive every screen size and that the window still ends
// on today.

let fitHeatmapWeeks, buildHeatmapWindow;

before(async () => {
    const dom = new JSDOM('<!doctype html><html lang="tr"><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    const mod = await import('../src/features/stats/continuity-ui.js');
    fitHeatmapWeeks = mod.fitHeatmapWeeks;
    buildHeatmapWindow = mod.buildHeatmapWindow;
});

test('a desktop card fits the full year', () => {
    // 53 columns at a 12px pitch need 636px; a desktop card has more than that.
    assert.equal(fitHeatmapWeeks(900, 10), 53);
    assert.equal(fitHeatmapWeeks(636, 10), 53);
});

test('the year is never exceeded, however wide the screen', () => {
    assert.equal(fitHeatmapWeeks(4000, 10), 53);
});

test('a phone gets the weeks that actually fit', () => {
    // ~284px of grid on a 390px phone, 8px cells: 28 columns, no overflow.
    const weeks = fitHeatmapWeeks(284, 8);
    assert.equal(weeks, 28);
    assert.ok(weeks * 10 <= 284, 'the fitted grid must not overflow the width it was given');
});

test('an absurdly narrow card still gets a readable floor', () => {
    assert.equal(fitHeatmapWeeks(40, 8), 12, 'below the floor the card scrolls rather than showing a sliver');
});

test('an unmeasurable width falls back to the full year', () => {
    // A display:none card reports 0 - drawing 0 columns would blank the card.
    assert.equal(fitHeatmapWeeks(0, 10), 53);
    assert.equal(fitHeatmapWeeks(-20, 10), 53);
});

test('the window ends on today and starts on a Monday', () => {
    for (const iso of ['2026-08-01', '2026-08-03', '2026-08-09', '2026-01-01']) {
        const today = new Date(`${iso}T12:00:00`);
        const { start, numDays } = buildHeatmapWindow(26, today);

        assert.equal(start.getDay(), 1, `${iso}: the first column must start on a Monday`);

        const last = new Date(start);
        last.setDate(last.getDate() + numDays - 1);
        assert.equal(last.toDateString(), today.toDateString(), `${iso}: the last cell must be today`);
    }
});

test('every column is a whole week, whatever the count', () => {
    const today = new Date('2026-08-01T12:00:00'); // a Saturday
    for (const weeks of [12, 26, 53]) {
        const { numDays } = buildHeatmapWindow(weeks, today);
        assert.equal(Math.ceil(numDays / 7), weeks, `${weeks} weeks must occupy exactly ${weeks} columns`);
    }
});

test('a Monday today leaves a single-day final column', () => {
    const monday = new Date('2026-08-03T12:00:00');
    const { numDays } = buildHeatmapWindow(20, monday);
    assert.equal(numDays, 19 * 7 + 1);
});
