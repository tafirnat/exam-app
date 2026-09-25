import test from 'node:test';
import assert from 'node:assert/strict';
import {
    canMergeParts,
    doPartsOverlap,
    detectGaps,
    checkDensity,
    mergeBookParts,
    hasMissingRanges,
    getNextFrom,
    generateNextPartPrompt
} from '../src/features/ereader/ereader-parts.js';
import {
    loadEreader,
    listBooks,
    getBook,
    addBook,
    deleteBook,
    getTombstones,
    _resetEreaderStoreForTests
} from '../src/features/ereader/ereader-store.js';

test.beforeEach(async () => {
    await _resetEreaderStoreForTests();
    await loadEreader();
});

test('1. canMergeParts validates bookKey, language, and unit compatibility', () => {
    const baseBook = {
        bookKey: 'my-book',
        language: 'de',
        parts: [{ unit: 'page', from: 1, to: 10, total: 30 }]
    };

    // Compatible book
    const matchingBook = {
        bookKey: 'my-book',
        language: 'de',
        parts: [{ unit: 'page', from: 11, to: 20, total: 30 }]
    };
    assert.deepEqual(canMergeParts(baseBook, matchingBook), { ok: true });

    // Different bookKey
    const diffKey = { ...matchingBook, bookKey: 'other-book' };
    assert.equal(canMergeParts(baseBook, diffKey).ok, false);
    assert.equal(canMergeParts(baseBook, diffKey).reason, 'ereader_warn_diff_lang_or_unit');

    // Different language
    const diffLang = { ...matchingBook, language: 'en' };
    assert.equal(canMergeParts(baseBook, diffLang).ok, false);
    assert.equal(canMergeParts(baseBook, diffLang).reason, 'ereader_warn_diff_lang_or_unit');

    // Different unit
    const diffUnit = {
        ...matchingBook,
        parts: [{ unit: 'section', from: 11, to: 20, total: 30 }]
    };
    assert.equal(canMergeParts(baseBook, diffUnit).ok, false);
    assert.equal(canMergeParts(baseBook, diffUnit).reason, 'ereader_warn_diff_lang_or_unit');
});

test('2. doPartsOverlap correctly detects overlapping ranges', () => {
    const partsA = [{ from: 1, to: 10 }];
    const partsB = [{ from: 11, to: 20 }];
    const partsC = [{ from: 10, to: 15 }]; // overlaps with partsA at 10

    assert.equal(doPartsOverlap(partsA, partsB), false);
    assert.equal(doPartsOverlap(partsA, partsC), true);
    assert.equal(doPartsOverlap(partsB, partsC), true);
});

test('3. Three parts added in reverse order merge into single book with correct section order', () => {
    const part3Book = {
        bookKey: 'algebra-101',
        title: 'Algebra 101',
        language: 'en',
        sourceType: 'pdf',
        parts: [{ unit: 'page', from: 21, to: 30, total: 30, importedAt: 100 }],
        sections: [
            { id: 's-3a', title: 'Quadratic Equations', level: 1, pageStart: 21, text: 'Quadratic text' },
            { id: 's-3b', title: 'Complex Numbers', level: 1, pageStart: 26, text: 'Complex text' }
        ]
    };

    const part2Book = {
        bookKey: 'algebra-101',
        title: 'Algebra 101',
        language: 'en',
        sourceType: 'pdf',
        parts: [{ unit: 'page', from: 11, to: 20, total: 30, importedAt: 200 }],
        sections: [
            { id: 's-2a', title: 'Linear Systems', level: 1, pageStart: 11, text: 'Linear text' },
            { id: 's-2b', title: 'Matrices', level: 1, pageStart: 16, text: 'Matrices text' }
        ]
    };

    const part1Book = {
        bookKey: 'algebra-101',
        title: 'Algebra 101',
        language: 'en',
        sourceType: 'pdf',
        parts: [{ unit: 'page', from: 1, to: 10, total: 30, importedAt: 300 }],
        sections: [
            { id: 's-1a', title: 'Introduction', level: 1, pageStart: 1, text: 'Intro text' },
            { id: 's-1b', title: 'Variables', level: 1, pageStart: 5, text: 'Variables text' }
        ]
    };

    // Merge in reverse order: part 3 first, then part 2, then part 1
    let merged = mergeBookParts(part3Book, part2Book);
    merged = mergeBookParts(merged, part1Book);

    assert.equal(merged.parts.length, 3);
    assert.deepEqual(merged.parts.map(p => p.from), [1, 11, 21]);

    // Sections must be sorted according to part.from ascending
    assert.equal(merged.sections.length, 6);
    assert.deepEqual(merged.sections.map(s => s.id), [
        's-1a', 's-1b', 's-2a', 's-2b', 's-3a', 's-3b'
    ]);
});

test('4. Gap detection identifies missing ranges between parts', () => {
    const partsWithGap = [
        { unit: 'page', from: 1, to: 10, total: 50 },
        { unit: 'page', from: 21, to: 30, total: 50 }
    ];

    const gaps = detectGaps(partsWithGap);
    assert.equal(gaps.length, 1);
    assert.deepEqual(gaps[0], { from: 11, to: 20, unit: 'page' });

    const book = {
        bookKey: 'gap-book',
        title: 'Gap Book',
        language: 'en',
        parts: partsWithGap
    };
    assert.equal(hasMissingRanges(book), true);
    assert.equal(getNextFrom(book), 11);
});

test('5. Deduplicates colliding sections by page_start + normalized title', () => {
    const part1Book = {
        bookKey: 'history-book',
        title: 'World History',
        language: 'en',
        parts: [{ unit: 'page', from: 1, to: 15, total: 30 }],
        sections: [
            { id: 's-1', title: 'Ancient Greece', pageStart: 1, text: 'Greece text' },
            { id: 's-2', title: 'Roman Empire', pageStart: 10, text: 'Rome text part 1' }
        ]
    };

    const part2Book = {
        bookKey: 'history-book',
        title: 'World History',
        language: 'en',
        parts: [{ unit: 'page', from: 10, to: 25, total: 30 }],
        sections: [
            // Duplicate section overlapping at page 10 with same title
            { id: 's-2-incoming', title: '  roman empire  ', pageStart: 10, text: 'Rome text part 2' },
            { id: 's-3', title: 'Middle Ages', pageStart: 16, text: 'Middle ages text' }
        ]
    };

    const merged = mergeBookParts(part1Book, part2Book);
    assert.equal(merged.sections.length, 3);
    assert.deepEqual(merged.sections.map(s => s.title.trim()), [
        'Ancient Greece', 'Roman Empire', 'Middle Ages'
    ]);
});

test('6. Rewrites colliding section IDs when merging different sections with same ID', () => {
    const part1Book = {
        bookKey: 'bio-book',
        title: 'Biology',
        language: 'en',
        parts: [{ unit: 'page', from: 1, to: 10, total: 20 }],
        sections: [
            { id: 'intro', title: 'Intro to Cells', pageStart: 1, text: 'Cells' },
            { id: 'summary', title: 'Cell Summary', pageStart: 8, text: 'Summary A' }
        ]
    };

    const part2Book = {
        bookKey: 'bio-book',
        title: 'Biology',
        language: 'en',
        parts: [{ unit: 'page', from: 11, to: 20, total: 20 }],
        sections: [
            // Colliding ID 'intro' but different section
            { id: 'intro', title: 'Intro to Genetics', pageStart: 11, text: 'Genetics' },
            // Colliding ID 'summary'
            { id: 'summary', title: 'Genetics Summary', pageStart: 18, text: 'Summary B' }
        ]
    };

    const merged = mergeBookParts(part1Book, part2Book);
    assert.equal(merged.sections.length, 4);

    const ids = merged.sections.map(s => s.id);
    assert.equal(new Set(ids).size, 4, 'All section IDs must be unique');
    assert.deepEqual(ids, ['intro', 'summary', 'intro-2', 'summary-2']);
});

test('7. Incompatible language or unit throws when attempting merge', () => {
    const bookDe = {
        bookKey: 'tech-book',
        language: 'de',
        parts: [{ unit: 'page', from: 1, to: 10 }]
    };
    const bookEn = {
        bookKey: 'tech-book',
        language: 'en',
        parts: [{ unit: 'page', from: 11, to: 20 }]
    };
    assert.throws(() => mergeBookParts(bookDe, bookEn), /ereader_warn_diff_lang_or_unit/);

    const bookSection = {
        bookKey: 'tech-book',
        language: 'de',
        parts: [{ unit: 'section', from: 11, to: 20 }]
    };
    assert.throws(() => mergeBookParts(bookDe, bookSection), /ereader_warn_diff_lang_or_unit/);
});

test('8. Leftovers of manual merge receive dated tombstones', async () => {
    const book1 = await addBook({
        bookKey: 'chem-101',
        title: 'Chemistry Part 1',
        language: 'en',
        sourceType: 'pdf',
        parts: [{ unit: 'page', from: 1, to: 10, total: 20 }],
        sections: [{ id: 's-1', title: 'Atoms', pageStart: 1, text: 'Atoms' }]
    });

    const book2 = await addBook({
        bookKey: 'chem-101',
        title: 'Chemistry Part 2',
        language: 'en',
        sourceType: 'pdf',
        parts: [{ unit: 'page', from: 11, to: 20, total: 20 }],
        sections: [{ id: 's-2', title: 'Molecules', pageStart: 11, text: 'Molecules' }]
    });

    // Simulate manual merge of book2 into book1
    const full1 = await getBook(book1.id);
    const full2 = await getBook(book2.id);
    const merged = mergeBookParts(full1, full2);

    // Book 2 is deleted after merge
    await deleteBook(book2.id);

    // Check tombstones
    const tombstones = getTombstones();
    assert.ok(tombstones[book2.id], 'Deleted book2 must have a tombstone');
    assert.ok(typeof tombstones[book2.id] === 'number');

    // List books should only contain book1
    const remaining = listBooks();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, book1.id);
});

test('9. Density alarm warns when new part density is < 50% of existing part median', () => {
    // Existing book: 10 pages, 5000 characters -> 500 chars/page
    const existingBook = {
        parts: [{ from: 1, to: 10 }],
        sections: [{ text: 'x'.repeat(5000) }]
    };

    // Low density incoming part: 10 pages, 1500 characters -> 150 chars/page (< 50% of 500)
    const lowDensityPart = {
        parts: [{ from: 11, to: 20 }],
        sections: [{ text: 'y'.repeat(1500) }]
    };

    const result = checkDensity(lowDensityPart, existingBook);
    assert.equal(result.lowDensity, true);
    assert.equal(result.warning, 'ereader_warn_low_density');

    // Normal density incoming part: 10 pages, 4000 characters -> 400 chars/page (>= 250)
    const normalDensityPart = {
        parts: [{ from: 11, to: 20 }],
        sections: [{ text: 'z'.repeat(4000) }]
    };

    const normalResult = checkDensity(normalDensityPart, existingBook);
    assert.equal(normalResult.lowDensity, false);
});

test('10. generateNextPartPrompt generates prompt with book details and next starting position', () => {
    const book = {
        bookKey: 'itil-4',
        title: 'ITIL 4 Foundation',
        author: 'AXELOS',
        language: 'de',
        parts: [{ unit: 'page', from: 1, to: 48, total: 200 }]
    };

    const prompt = generateNextPartPrompt(book);
    assert.ok(prompt.includes('ITIL 4 Foundation'));
    assert.ok(prompt.includes('"book_key": "itil-4"'));
    assert.ok(prompt.includes('"from": 49'));
    assert.ok(prompt.includes('"total": 200'));
    assert.ok(prompt.includes('"unit": "page"'));
    assert.ok(prompt.includes('"language": "de"'));
});

test('11. Preserves distinct sections with same title from different parts when pageStart is missing', () => {
    const part1 = {
        bookKey: 'novel',
        language: 'en',
        parts: [{ unit: 'section', from: 1, to: 5, total: 10 }],
        sections: [
            { id: 'ch1', title: 'Chapter 1', text: 'Text of chapter 1' },
            { id: 'sum1', title: 'Summary', text: 'Summary of chapter 1' }
        ]
    };

    const part2 = {
        bookKey: 'novel',
        language: 'en',
        parts: [{ unit: 'section', from: 6, to: 10, total: 10 }],
        sections: [
            { id: 'ch2', title: 'Chapter 2', text: 'Text of chapter 2' },
            { id: 'sum2', title: 'Summary', text: 'Summary of chapter 2' }
        ]
    };

    const merged = mergeBookParts(part1, part2);
    assert.equal(merged.sections.length, 4, 'Both Summary sections must be preserved since their content differs');
    assert.deepEqual(merged.sections.map(s => s.text), [
        'Text of chapter 1',
        'Summary of chapter 1',
        'Text of chapter 2',
        'Summary of chapter 2'
    ]);

    // If part 2 carried an exact duplicate (same title and identical text), it is deduplicated
    const part2WithDuplicate = {
        bookKey: 'novel',
        language: 'en',
        parts: [{ unit: 'section', from: 6, to: 10, total: 10 }],
        sections: [
            { id: 'sum-dup', title: 'Summary', text: 'Summary of chapter 1' },
            { id: 'ch2', title: 'Chapter 2', text: 'Text of chapter 2' }
        ]
    };
    const mergedDup = mergeBookParts(part1, part2WithDuplicate);
    assert.equal(mergedDup.sections.length, 3, 'Genuinely identical section content must be deduplicated');
});

