/**
 * The day boundary, and why it belongs to the app rather than to the device.
 *
 * A day key used to be read off whatever timezone the device was set to, which
 * made "today" a per-device notion: the same instant is already the 3rd on a
 * phone at UTC+3 while a laptop at UTC+2 still calls it the 2nd, so the two
 * filed one study session under two keys. No merge rule can repair that - the
 * records are about different days - and it surfaces as a streak that reads
 * differently on each device, and as a day one device thinks was missed and
 * pays a freeze token for.
 *
 * These cases pin the key to one zone, and pin the day *arithmetic* to the same
 * calendar: stepping a run of days by mutating a Date steps in device days
 * while the format reads app days, which is a different bug wearing the same
 * clothes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DAY_ZONE, getLocalDateStr, shiftDateStr, getDayAnchor
} from '../src/core/daily-activity.js';

/** The instant at `hhmm` UTC on the given date. */
const utc = (y, m, d, hh, mm = 0) => new Date(Date.UTC(y, m - 1, d, hh, mm));

test('the day is anchored to one named zone, not to whatever the device says', () => {
    assert.equal(DAY_ZONE, 'Europe/Berlin');
});

test('one instant is one day key, whatever the device clock reads', () => {
    /* 22:30 UTC on 2 August is 01:30 on the 3rd in Istanbul and 00:30 on the
       3rd in Berlin - but 23:30 on the 2nd in London. Devices in all three
       places have to agree, and under device-local formatting they did not. */
    const instant = utc(2026, 8, 2, 22, 30);

    assert.equal(getLocalDateStr(instant), '2026-08-03');
});

test('the hour before the zone rolls over still belongs to the previous day', () => {
    // 21:30 UTC = 00:30 on the 3rd in Istanbul, but 23:30 on the 2nd in Berlin.
    // This is the window the three devices used to disagree in.
    assert.equal(getLocalDateStr(utc(2026, 8, 2, 21, 30)), '2026-08-02');
});

test('the zone is followed across its own clock change, not a fixed offset', () => {
    // Berlin is UTC+2 in August and UTC+1 in December. A hard-coded offset
    // would put one of these two on the wrong day.
    assert.equal(getLocalDateStr(utc(2026, 8, 2, 22, 30)), '2026-08-03', 'summer');
    assert.equal(getLocalDateStr(utc(2026, 12, 2, 22, 30)), '2026-12-02', 'winter');
});

test('the same instant read twice gives the same key', () => {
    const instant = utc(2026, 8, 2, 22, 30);
    assert.equal(getLocalDateStr(instant), getLocalDateStr(new Date(instant.getTime())));
});

// ── Walking a run of days ───────────────────────────────────────────────────

test('stepping back a day steps back exactly one calendar day', () => {
    assert.equal(shiftDateStr('2026-08-03', -1), '2026-08-02');
    assert.equal(shiftDateStr('2026-08-03', -2), '2026-08-01');
    assert.equal(shiftDateStr('2026-08-03', 0), '2026-08-03');
    assert.equal(shiftDateStr('2026-08-03', 1), '2026-08-04');
});

test('stepping crosses month and year boundaries', () => {
    assert.equal(shiftDateStr('2026-08-01', -1), '2026-07-31');
    assert.equal(shiftDateStr('2026-01-01', -1), '2025-12-31');
    assert.equal(shiftDateStr('2024-02-28', 1), '2024-02-29', 'leap year');
    assert.equal(shiftDateStr('2025-02-28', 1), '2025-03-01');
});

test('a 365-day walk visits 365 distinct days, clock changes included', () => {
    /* The streak walk runs exactly this loop. Mutating a Date instead would
       repeat or skip a key on the two nights a year the offsets move apart,
       and a repeated key reads as a day studied twice - or a broken streak. */
    const seen = new Set();
    let day = '2026-08-03';
    for (let i = 0; i < 365; i++) {
        seen.add(day);
        day = shiftDateStr(day, -1);
    }

    assert.equal(seen.size, 365);
    assert.equal(day, '2025-08-03', 'and lands a year earlier to the day');
});

// ── The calendar the UI draws ───────────────────────────────────────────────

test('the drawing anchor carries the app day in its own fields', () => {
    /* The heatmap takes its weekday column and month tick off a Date and keys
       the cell with getLocalDateStr(). Seeding that walk with `new Date()`
       leaves the two on different calendars for as long as the device's date
       differs from the zone's, and the grid draws a day out of step. */
    const anchor = getDayAnchor('2026-08-03');

    assert.equal(anchor.getFullYear(), 2026);
    assert.equal(anchor.getMonth(), 7);
    assert.equal(anchor.getDate(), 3);
    assert.equal(getLocalDateStr(anchor), '2026-08-03', 'and reads back as the day it stands for');
});

test('the anchor survives being stepped a day at a time', () => {
    const anchor = getDayAnchor('2026-03-29'); // the day Berlin's clocks go forward
    anchor.setDate(anchor.getDate() - 1);

    assert.equal(getLocalDateStr(anchor), '2026-03-28');
});

test('the anchor defaults to the day it currently is', () => {
    assert.equal(getLocalDateStr(getDayAnchor()), getLocalDateStr());
});
