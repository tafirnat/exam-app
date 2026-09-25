import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildChapters,
    chapterOfSection,
    weightedPercent
} from '../src/features/ereader/ereader-chapters.js';

test('1. returns empty array for empty or missing sections', () => {
    assert.deepEqual(buildChapters([]), []);
    assert.deepEqual(buildChapters(null), []);
});

test('2. book with preface (sections before first minLevel section are chapter 0)', () => {
    const sections = [
        { id: 's-preface', title: 'Vorwort', level: 2, text: 'Kurzes Vorwort.' },
        { id: 's-intro', title: 'Einleitung', level: 2, text: 'Zweiter Vorwortteil.' },
        { id: 's-c1', title: 'Kapitel 1', level: 1, text: 'Haupttext 1...' },
        { id: 's-c1-1', title: 'Kapitel 1.1', level: 2, text: 'Unterkapitel...' },
        { id: 's-c2', title: 'Kapitel 2', level: 1, text: 'Haupttext 2...' }
    ];

    const chapters = buildChapters(sections);
    assert.equal(chapters.length, 3);

    // Chapter 0: Preface sections before the first level 1
    assert.equal(chapters[0].index, 0);
    assert.equal(chapters[0].title, 'Vorwort');
    assert.deepEqual(chapters[0].sectionIds, ['s-preface', 's-intro']);
    assert.equal(chapters[0].textLength, 'Kurzes Vorwort.'.length + 'Zweiter Vorwortteil.'.length);

    // Chapter 1: First level 1
    assert.equal(chapters[1].index, 1);
    assert.equal(chapters[1].title, 'Kapitel 1');
    assert.deepEqual(chapters[1].sectionIds, ['s-c1', 's-c1-1']);

    // Chapter 2: Second level 1
    assert.equal(chapters[2].index, 2);
    assert.equal(chapters[2].title, 'Kapitel 2');
    assert.deepEqual(chapters[2].sectionIds, ['s-c2']);
});

test('3. single-level book: each section is its own chapter', () => {
    const sections = [
        { id: 's-1', title: 'Teil 1', level: 1, text: 'Text 1' },
        { id: 's-2', title: 'Teil 2', level: 1, text: 'Text 2' },
        { id: 's-3', title: 'Teil 3', level: 1, text: 'Text 3' }
    ];

    const chapters = buildChapters(sections);
    assert.equal(chapters.length, 3);
    assert.equal(chapters[0].index, 0);
    assert.equal(chapters[0].title, 'Teil 1');
    assert.deepEqual(chapters[0].sectionIds, ['s-1']);

    assert.equal(chapters[1].index, 1);
    assert.equal(chapters[1].title, 'Teil 2');
    assert.deepEqual(chapters[1].sectionIds, ['s-2']);

    assert.equal(chapters[2].index, 2);
    assert.equal(chapters[2].title, 'Teil 3');
    assert.deepEqual(chapters[2].sectionIds, ['s-3']);
});

test('4. chapterOfSection finds corresponding chapter or returns null', () => {
    const sections = [
        { id: 's-1', title: 'Kapitel 1', level: 1, text: 'Text 1' },
        { id: 's-1-sub', title: 'Unterabschnitt', level: 2, text: 'Sub text' },
        { id: 's-2', title: 'Kapitel 2', level: 1, text: 'Text 2' }
    ];
    const chapters = buildChapters(sections);

    const ch1 = chapterOfSection(chapters, 's-1');
    assert.equal(ch1?.index, 0);

    const chSub = chapterOfSection(chapters, 's-1-sub');
    assert.equal(chSub?.index, 0);

    const ch2 = chapterOfSection(chapters, 's-2');
    assert.equal(ch2?.index, 1);

    const chNone = chapterOfSection(chapters, 'non-existent');
    assert.equal(chNone, null);
    assert.equal(chapterOfSection(null, 's-1'), null);
});

test('5. weighted percent gives accurate weighted progress (short preface does not count as 50%)', () => {
    // Preface is 100 chars, Main Chapter is 900 chars. Total = 1000 chars.
    const chapters = [
        { index: 0, title: 'Preface', sectionIds: ['s-pref'], textLength: 100 },
        { index: 1, title: 'Chapter 1', sectionIds: ['s-c1'], textLength: 900 }
    ];

    // At the start of preface (offset 0)
    assert.equal(weightedPercent(chapters, 0, 0), 0);

    // Halfway through preface (offset 0.5): (0 + 0.5 * 100) / 1000 = 5.0%
    assert.equal(weightedPercent(chapters, 0, 0.5), 5);

    // At the end of preface (offset 1.0): (0 + 1.0 * 100) / 1000 = 10.0% (NOT 50%!)
    assert.equal(weightedPercent(chapters, 0, 1.0), 10);

    // Halfway through Chapter 1 (offset 0.5): (100 + 0.5 * 900) / 1000 = 55.0%
    assert.equal(weightedPercent(chapters, 1, 0.5), 55);

    // At the end of Chapter 1 (offset 1.0): (100 + 1.0 * 900) / 1000 = 100.0%
    assert.equal(weightedPercent(chapters, 1, 1.0), 100);
});

test('6. weighted percent clamps bounds and handles empty or zero total length', () => {
    assert.equal(weightedPercent([], 0, 0.5), 0);

    const zeroLengthChapters = [
        { index: 0, title: 'Empty', sectionIds: ['s-0'], textLength: 0 }
    ];
    assert.equal(weightedPercent(zeroLengthChapters, 0, 0.5), 0);

    const chapters = [
        { index: 0, title: 'Ch 1', sectionIds: ['s-1'], textLength: 100 }
    ];
    // Offset out of [0, 1] range gets clamped
    assert.equal(weightedPercent(chapters, 0, -0.5), 0);
    assert.equal(weightedPercent(chapters, 0, 1.5), 100);
});
