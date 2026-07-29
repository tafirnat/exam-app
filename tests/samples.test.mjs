/* The starter samples are the first thing a new reader sees and the file they
   will copy to write their own. They have to pass the same checks the importer
   applies to anything else — a shipped example that the app would flag on
   import is worse than no example. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findContentGaps, canonicalType, KNOWN_TYPES } from '../src/core/question-rules.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public/examples');

const LANGUAGES = ['tr', 'en', 'de'];
const load = (lang) => JSON.parse(readFileSync(join(dir, `sample-${lang}.json`), 'utf8'));

test('there is exactly one sample per supported language, and nothing else', () => {
    const samples = readdirSync(dir).filter(n => n.endsWith('.json')).sort();
    assert.deepEqual(samples, LANGUAGES.map(l => `sample-${l}.json`).sort(),
        'the retired templates should be gone');
});

for (const lang of LANGUAGES) {
    test(`sample-${lang} is free of content gaps`, () => {
        const gaps = findContentGaps(load(lang).questions);
        assert.deepEqual(gaps.map(g => `${g.id}: ${g.issues.map(i => i.code).join(',')}`), []);
    });

    test(`sample-${lang} covers every question type exactly once`, () => {
        const types = load(lang).questions.map(q => q.type);
        assert.deepEqual([...types].sort(), [...KNOWN_TYPES].sort(),
            'one question per type, no duplicates and none missing');
    });

    test(`sample-${lang} uses only canonical type names`, () => {
        for (const q of load(lang).questions) {
            assert.equal(q.type, canonicalType(q.type),
                `${q.id} should not use a retired spelling`);
        }
    });

    test(`sample-${lang} has the metadata the importer titles it from`, () => {
        const { exam_metadata: meta } = load(lang);
        assert.ok(meta?.title, 'a title, or the source is named after the file');
        assert.equal(meta.id, `sample_${lang}`);
        assert.ok(meta.description);
    });
}

test('the three samples describe the same questions in three languages', () => {
    const [tr, en, de] = LANGUAGES.map(l => load(l).questions);
    assert.deepEqual(en.map(q => q.id), tr.map(q => q.id), 'same ids, same order');
    assert.deepEqual(en.map(q => q.id), de.map(q => q.id));
    assert.deepEqual(en.map(q => q.type), tr.map(q => q.type), 'same types, same order');
    assert.deepEqual(en.map(q => q.type), de.map(q => q.type));

    // Same correct answers everywhere, so translating never changed the key.
    const keys = (qs) => qs.map(q => (q.answer?.correct_ids || []).join(','));
    assert.deepEqual(keys(en), keys(tr));
    assert.deepEqual(keys(en), keys(de));
});

test('optional fields are demonstrated but deliberately not all filled', () => {
    const questions = load('en').questions;
    const present = (field) => questions.filter(q => q[field] !== undefined).length;

    for (const field of ['category', 'tags', 'difficulty']) {
        assert.ok(present(field) > 0, `${field} should be shown at least once`);
        assert.ok(present(field) < questions.length,
            `${field} should be left out somewhere, so a minimal question is visible too`);
    }

    const withMedia = questions.filter(q => q.content?.media?.length);
    assert.equal(withMedia.length, 1, 'one question carries an image');
    assert.match(withMedia[0].content.media[0].url, /^https:\/\//);
    assert.ok(['above', 'below'].includes(withMedia[0].content.media[0].position));
});

test('the cloze sample actually contains markers', () => {
    for (const lang of LANGUAGES) {
        const cloze = load(lang).questions.find(q => q.type === 'fill_in_the_blank');
        const text = cloze.content.text;
        assert.match(text, /\{\{.+?\}\}/, `sample-${lang} must show the syntax it describes`);
        assert.match(text, /\{\{[^}]*\|[^}]*\}\}/, 'and demonstrate the alternatives pipe');
    }
});
