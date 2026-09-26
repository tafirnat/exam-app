import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEreaderFile, validateSyncedBook, slugify } from '../src/features/ereader/ereader-schema.js';

test('1. slugify converts umlauts and replaces non-alphanumerics with underscores', () => {
    assert.equal(slugify('ITIL® 4 Foundation de'), 'itil_4_foundation_de');
    assert.equal(slugify('Türkçe Başlık ÇŞĞIÖÜ'), 'turkce_baslik_csgiou');
    assert.equal(slugify('Grüße aus Köln!'), 'grusse_aus_koln');
    assert.equal(slugify(''), 'exam');
    assert.equal(slugify(null), 'exam');
});

test('2. rejects invalid or non-object root JSON', () => {
    const cases = [null, undefined, 123, 'string', true, []];
    for (const c of cases) {
        const res = validateEreaderFile(c);
        assert.equal(res.ok, false);
        assert.ok(res.errors.includes('ereader_err_invalid_json'));
        assert.equal(res.book, null);
    }
});

test('3. rejects missing or non-object ereader header', () => {
    const res1 = validateEreaderFile({});
    assert.equal(res1.ok, false);
    assert.ok(res1.errors.includes('ereader_err_missing_ereader'));

    const res2 = validateEreaderFile({ ereader: 'invalid' });
    assert.equal(res2.ok, false);
    assert.ok(res2.errors.includes('ereader_err_missing_ereader'));
});

test('4. schema defaults to 1 when absent; rejects unsupported schema versions', () => {
    const validNoSchema = {
        ereader: { title: 'Test Book' },
        sections: [{ id: 's-1', text: 'Hello' }]
    };
    const res1 = validateEreaderFile(validNoSchema);
    assert.equal(res1.ok, true);

    const invalidSchema = {
        ereader: { schema: 2, title: 'Test Book' },
        sections: [{ id: 's-1', text: 'Hello' }]
    };
    const res2 = validateEreaderFile(invalidSchema);
    assert.equal(res2.ok, false);
    assert.ok(res2.errors.includes('ereader_err_unsupported_schema'));
});

test('5. rejects missing, empty, or whitespace title', () => {
    const cases = [undefined, '', '   ', 123, null];
    for (const title of cases) {
        const res = validateEreaderFile({
            ereader: { title },
            sections: [{ id: 's-1', text: 'Hello' }]
        });
        assert.equal(res.ok, false);
        assert.ok(res.errors.includes('ereader_err_missing_title'));
    }
});

test('6. defaults author to empty string without warning', () => {
    const res = validateEreaderFile({
        ereader: { title: 'Book Title' },
        sections: [{ id: 's-1', text: 'Hello' }]
    });
    assert.equal(res.ok, true);
    assert.equal(res.book.author, '');
});

test('7. language missing or empty warns and defaults to "und"', () => {
    const res = validateEreaderFile({
        ereader: { title: 'Book Title' },
        sections: [{ id: 's-1', text: 'Hello' }]
    });
    assert.equal(res.ok, true);
    assert.equal(res.book.language, 'und');
    assert.ok(res.warnings.includes('ereader_warn_default_language'));
});

test('8. source_type defaults to "other" with warning when absent or invalid; accepts valid types', () => {
    const resInvalid = validateEreaderFile({
        ereader: { title: 'Book Title', source_type: 'docx' },
        sections: [{ id: 's-1', text: 'Hello' }]
    });
    assert.equal(resInvalid.ok, true);
    assert.equal(resInvalid.book.sourceType, 'other');
    assert.ok(resInvalid.warnings.includes('ereader_warn_unknown_source_type'));

    for (const type of ['pdf', 'epub', 'obsidian', 'topic']) {
        const resValid = validateEreaderFile({
            ereader: { title: 'Book Title', source_type: type, language: 'en' },
            sections: [{ id: 's-1', text: 'Hello' }]
        });
        assert.equal(resValid.ok, true);
        assert.equal(resValid.book.sourceType, type);
    }
});

test('9. book_key is preserved if string, or auto-generated with slugify if missing', () => {
    const resProvided = validateEreaderFile({
        ereader: { title: 'Book Title', book_key: 'custom-key-123', language: 'en' },
        sections: [{ id: 's-1', text: 'Hello' }]
    });
    assert.equal(resProvided.book.bookKey, 'custom-key-123');

    const resGenerated = validateEreaderFile({
        ereader: { title: 'My Great Book', author: 'Jane Doe', language: 'en' },
        sections: [{ id: 's-1', text: 'Hello' }]
    });
    assert.equal(resGenerated.book.bookKey, 'my_great_book_jane_doe_en');
});

test('10. part object defaults to single full part when omitted', () => {
    const res = validateEreaderFile({
        ereader: { title: 'Book Title', language: 'en' },
        sections: [{ id: 's-1', text: 'A' }, { id: 's-2', text: 'B' }, { id: 's-3', text: 'C' }]
    });
    assert.equal(res.ok, true);
    assert.equal(res.book.parts.length, 1);
    assert.deepEqual(res.book.parts[0], {
        unit: 'section',
        from: 1,
        to: 3,
        total: 3,
        importedAt: res.book.parts[0].importedAt
    });
    assert.equal(typeof res.book.parts[0].importedAt, 'number');
});

test('11. rejects empty or non-array sections', () => {
    const resNoSections = validateEreaderFile({
        ereader: { title: 'Book Title' },
        sections: []
    });
    assert.equal(resNoSections.ok, false);
    assert.ok(resNoSections.errors.includes('ereader_err_no_sections'));

    const resNonArray = validateEreaderFile({
        ereader: { title: 'Book Title' },
        sections: 'not-array'
    });
    assert.equal(resNonArray.ok, false);
    assert.ok(resNonArray.errors.includes('ereader_err_no_sections'));
});

test('12. rejects section missing text or invalid section shape', () => {
    const resInvalidShape = validateEreaderFile({
        ereader: { title: 'Book Title' },
        sections: ['not-an-object']
    });
    assert.equal(resInvalidShape.ok, false);
    assert.ok(resInvalidShape.errors.includes('ereader_err_invalid_section'));

    const resMissingText = validateEreaderFile({
        ereader: { title: 'Book Title' },
        sections: [{ id: 's-1' }]
    });
    assert.equal(resMissingText.ok, false);
    assert.ok(resMissingText.errors.includes('ereader_err_section_missing_text'));
});

test('13. missing section ID is generated as s-<n>; duplicate ID gets -2, -3 suffix with warning', () => {
    const res = validateEreaderFile({
        ereader: { title: 'Book Title', language: 'en' },
        sections: [
            { text: 'First' },
            { id: 'custom', text: 'Second' },
            { id: 'custom', text: 'Third (duplicate)' },
            { id: 'custom', text: 'Fourth (duplicate)' },
            { text: 'Fifth' }
        ]
    });
    assert.equal(res.ok, true);
    assert.equal(res.book.sections[0].id, 's-1');
    assert.equal(res.book.sections[1].id, 'custom');
    assert.equal(res.book.sections[2].id, 'custom-2');
    assert.equal(res.book.sections[3].id, 'custom-3');
    assert.equal(res.book.sections[4].id, 's-5');
    assert.ok(res.warnings.includes('ereader_warn_duplicate_section_id'));
});

test('14. invalid section level gives warning and defaults to 1', () => {
    const res = validateEreaderFile({
        ereader: { title: 'Book Title', language: 'en' },
        sections: [
            { id: 's-1', level: 0, text: 'Under level' },
            { id: 's-2', level: 7, text: 'Over level' },
            { id: 's-3', level: 'two', text: 'String level' },
            { id: 's-4', level: 3, text: 'Valid level' }
        ]
    });
    assert.equal(res.ok, true);
    assert.equal(res.book.sections[0].level, 1);
    assert.equal(res.book.sections[1].level, 1);
    assert.equal(res.book.sections[2].level, 1);
    assert.equal(res.book.sections[3].level, 3);
    assert.ok(res.warnings.includes('ereader_warn_invalid_section_level'));
});

test('15. page_start is kept if integer and omitted if absent or non-integer', () => {
    const res = validateEreaderFile({
        ereader: { title: 'Book Title', language: 'en' },
        sections: [
            { id: 's-1', page_start: 12, text: 'With page' },
            { id: 's-2', page_start: '12', text: 'String page' },
            { id: 's-3', text: 'No page' }
        ]
    });
    assert.equal(res.ok, true);
    assert.equal(res.book.sections[0].pageStart, 12);
    assert.equal('pageStart' in res.book.sections[1], false);
    assert.equal('pageStart' in res.book.sections[2], false);
});

test('16. converts data: and http: image URLs to placeholder:img-<n> and warns; leaves https: untouched', () => {
    const input = {
        ereader: { title: 'Book Title', language: 'en' },
        sections: [
            {
                id: 's-1',
                text: 'Here is an inline data image: ![diagram](data:image/png;base64,iVBORw0KGgo=) and insecure: ![old](http://insecure.com/pic.jpg).'
            },
            {
                id: 's-2',
                text: 'Here is secure: ![photo](https://example.com/photo.png) and another data: ![icon](data:image/svg+xml;utf8,<svg></svg>).'
            }
        ]
    };
    const res = validateEreaderFile(input);
    assert.equal(res.ok, true);
    assert.equal(
        res.book.sections[0].text,
        'Here is an inline data image: ![diagram](placeholder:img-1) and insecure: ![old](placeholder:img-2).'
    );
    assert.equal(
        res.book.sections[1].text,
        'Here is secure: ![photo](https://example.com/photo.png) and another data: ![icon](placeholder:img-3).'
    );
    assert.ok(res.warnings.includes('ereader_warn_image_placeholder'));
});

test('17. part.unit allows only "page" and "section"; other values warn and default to "section"', () => {
    // 1. "page" preserved without warning
    const resPage = validateEreaderFile({
        ereader: { title: 'Book 1', language: 'en', part: { unit: 'page', from: 1, to: 10, total: 100 } },
        sections: [{ id: 's-1', text: 'Text' }]
    });
    assert.equal(resPage.ok, true);
    assert.equal(resPage.book.parts[0].unit, 'page');
    assert.equal(resPage.warnings.includes('ereader_warn_invalid_part_unit'), false);

    // 2. "section" preserved without warning
    const resSection = validateEreaderFile({
        ereader: { title: 'Book 2', language: 'en', part: { unit: 'section', from: 1, to: 5, total: 5 } },
        sections: [{ id: 's-1', text: 'Text' }]
    });
    assert.equal(resSection.ok, true);
    assert.equal(resSection.book.parts[0].unit, 'section');
    assert.equal(resSection.warnings.includes('ereader_warn_invalid_part_unit'), false);

    // 3. "pages" warns and becomes "section"
    const resPages = validateEreaderFile({
        ereader: { title: 'Book 3', language: 'en', part: { unit: 'pages', from: 1, to: 10, total: 100 } },
        sections: [{ id: 's-1', text: 'Text' }]
    });
    assert.equal(resPages.ok, true);
    assert.equal(resPages.book.parts[0].unit, 'section');
    assert.ok(resPages.warnings.includes('ereader_warn_invalid_part_unit'));

    // 4. "chapter" warns and becomes "section"
    const resChapter = validateEreaderFile({
        ereader: { title: 'Book 4', language: 'en', part: { unit: 'chapter', from: 1, to: 2, total: 10 } },
        sections: [{ id: 's-1', text: 'Text' }]
    });
    assert.equal(resChapter.ok, true);
    assert.equal(resChapter.book.parts[0].unit, 'section');
    assert.ok(resChapter.warnings.includes('ereader_warn_invalid_part_unit'));
});

test('18. validateSyncedBook validates stored book format and rejects invalid structures', () => {
    const valid = {
        title: 'Stored Book',
        author: 'Author',
        language: 'en',
        sections: [{ id: 's-1', text: 'Some text' }]
    };
    const resValid = validateSyncedBook(valid);
    assert.equal(resValid.ok, true);
    assert.equal(resValid.book, valid);

    assert.equal(validateSyncedBook(null).ok, false);
    assert.equal(validateSyncedBook([]).ok, false);
    assert.equal(validateSyncedBook({ title: '', sections: [{ id: 's1', text: 't' }] }).ok, false);
    assert.equal(validateSyncedBook({ title: 'Book', sections: [] }).ok, false);
    assert.equal(validateSyncedBook({ title: 'Book', sections: 'not-array' }).ok, false);
    assert.equal(validateSyncedBook({ title: 'Book', sections: [{ id: 's1', text: 123 }] }).ok, false);
});



test('19. rejects a reversed or non-positive part range; total is never below to', () => {
    const file = (part) => ({
        ereader: { title: 'Range', language: 'en', part },
        sections: [{ text: 'x' }]
    });

    const reversed = validateEreaderFile(file({ unit: 'page', from: 30, to: 5, total: 40 }));
    assert.equal(reversed.ok, false);
    assert.deepEqual(reversed.errors, ['ereader_err_invalid_part_range']);

    const zero = validateEreaderFile(file({ unit: 'page', from: 0, to: 5, total: 40 }));
    assert.equal(zero.ok, false);
    assert.deepEqual(zero.errors, ['ereader_err_invalid_part_range']);

    const single = validateEreaderFile(file({ unit: 'page', from: 7, to: 7, total: 40 }));
    assert.equal(single.ok, true, 'A one-page part is a valid range');

    const shortTotal = validateEreaderFile(file({ unit: 'page', from: 1, to: 50, total: 40 }));
    assert.equal(shortTotal.ok, true);
    assert.equal(shortTotal.book.parts[0].total, 50);
});

test('20. a part without "to" runs one unit per section from its "from"', () => {
    const result = validateEreaderFile({
        ereader: { title: 'No To', language: 'en', part: { unit: 'section', from: 50, total: 60 } },
        sections: [{ text: 'a' }, { text: 'b' }, { text: 'c' }]
    });
    assert.equal(result.ok, true);
    assert.equal(result.book.parts[0].from, 50);
    assert.equal(result.book.parts[0].to, 52);
});
