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
import { renderMarkdown, renderInlineMarkdown, SENTINEL } from '../src/core/markdown.js';
import { parseCloze, clozeMarkup } from '../src/core/cloze.js';

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

test('every shipped JSON file is free of raw HTML tags', () => {
    // public/examples is now the only place shipped content lives: it is the
    // only content directory Vite copies into dist, so anything outside it was
    // unreachable from the app. The guard walks the directory rather than a
    // fixed list, so a new file cannot be added without being covered.
    const jsonFiles = readdirSync(dir)
        .filter(name => name.endsWith('.json'))
        .map(name => join(dir, name));

    assert.ok(jsonFiles.length > 0, 'the guard must actually have files to check');

    const htmlTagRegex = /<\/?(h[1-6]|p|div|span|strong|em|b|i|u|code|pre|ul|ol|li|blockquote|table|thead|tbody|tr|th|td|mark|a)\b[^>]*>/i;

    for (const filePath of jsonFiles) {
        const content = readFileSync(filePath, 'utf8');
        const match = content.match(htmlTagRegex);
        assert.equal(match, null, `File ${filePath} contains raw HTML tag: ${match?.[0]}`);
    }
});

/* The samples are the app's worked example of the content format, so they have
   to demonstrate it, not merely comply with it. These assert against the
   rendered output rather than the source, which is what catches a construct
   that is written but silently not rendered. */
test('every sample renders every construct the format supports', () => {
    const required = {
        'h2 heading': /<h2>/,
        'h3 heading': /<h3>/,
        'h4 heading': /<h4>/,
        bold: /<strong>/,
        italic: /<em>/,
        'bold italic': /<strong><em>/,
        strikethrough: /<del>/,
        highlight: /<mark>/,
        'inline code': /<code>/,
        'fenced code with a language': /<pre><code class="language-json">/,
        'fenced code without one': /<pre><code>/,
        'external link': /<a href="https:\/\/[^"]+" target="_blank" rel="noopener noreferrer">/,
        wikilink: /class="md-wikilink"/,
        'unordered list': /<ul>/,
        'ordered list': /<ol>/,
        'nested list': /<li>[^<]*<(?:ul|ol)>/,
        'checked task': /class="md-task"><input type="checkbox" disabled checked>/,
        'unchecked task': /class="md-task"><input type="checkbox" disabled>/,
        blockquote: /<blockquote>/,
        'thematic break': /<hr>/,
        'soft line break': /<br>/,
        table: /<table>/,
        'table left alignment': /text-align: left/,
        'table centre alignment': /text-align: center/
    };
    // Enough distinct callout types that the per-type token bindings are exercised.
    for (const type of ['tip', 'warning', 'example', 'info', 'note']) {
        required[`${type} callout`] = new RegExp(`md-callout-${type}\\b`);
    }

    for (const lang of LANGUAGES) {
        const html = load(lang).questions.flatMap(q => [
            q.content?.text, q.answer?.explanation, q.answer?.back,
            ...(q.options ?? []).map(o => o.text)
        ]).filter(s => typeof s === 'string').map(renderMarkdown).join('\n');

        const missing = Object.entries(required).filter(([, re]) => !re.test(html)).map(([name]) => name);
        assert.deepEqual(missing, [], `sample-${lang} never renders: ${missing.join(', ')}`);
    }
});

test('sample option text is rendered as Markdown, not shown raw', () => {
    for (const lang of LANGUAGES) {
        const mc = load(lang).questions.find(q => q.type === 'multiple_choice');
        const formatted = mc.options.filter(o => /[*`=~]/.test(o.text));
        assert.ok(formatted.length > 0, `sample-${lang} should show that options carry formatting`);
        for (const option of formatted) {
            const html = renderInlineMarkdown(option.text);
            assert.match(html, /<(code|strong|em|mark|del)>/, `option ${option.id} should render an element`);
            // Inline rendering only: an option is a single line, never a block.
            assert.doesNotMatch(html, /<(p|h[2-6]|ul|ol|div)\b/, 'options must stay inline');
        }
    }
});

test('the samples never emit an escaped tag or leak a parser placeholder', () => {
    for (const lang of LANGUAGES) {
        for (const q of load(lang).questions) {
            const strings = [q.content?.text, q.answer?.explanation, q.answer?.back,
                             ...(q.options ?? []).map(o => o.text)].filter(s => typeof s === 'string');
            for (const source of strings) {
                const html = renderMarkdown(source);
                assert.doesNotMatch(html, /&lt;\/?[a-z]/i,
                    `${lang}/${q.id} contains HTML that would show as literal text`);
                assert.equal(html.includes(SENTINEL), false, `${lang}/${q.id} leaked a placeholder`);
            }
        }
    }
});

test('a cloze example shown inside a code fence creates no blanks', () => {
    // The fill_in_the_blank explanation prints the marker syntax. If that counted
    // as blanks, the explanation would silently change the question's answer key.
    for (const lang of LANGUAGES) {
        const cloze = load(lang).questions.find(q => q.type === 'fill_in_the_blank');
        assert.match(cloze.answer.explanation, /\{\{.+?\}\}/, 'it should show the syntax');
        assert.equal(parseCloze(cloze.answer.explanation).blanks.length, 0,
            'but inside a fence it is documentation, not blanks');

        const gaps = [...clozeMarkup(cloze.content.text).matchAll(/data-blank="(\d+)"/g)].map(m => Number(m[1]));
        assert.deepEqual(gaps, [...Array(parseCloze(cloze.content.text).blanks.length).keys()],
            'and the question itself still numbers its gaps in order');
    }
});
