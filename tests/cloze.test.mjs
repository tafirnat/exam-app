/* Fill-in-the-blank questions keep their answers inside the sentence, so the
   parser is the answer key. Three places depend on it agreeing with itself: the
   test runner renders the gaps, the grader checks them, the editor and importer
   validate that any exist. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseCloze, hasBlanks, countEmptyBlanks, clozeAnswers, fillCloze,
    clozeMarkup, matchesBlank, gradeCloze
} from '../src/core/cloze.js';
import { SENTINEL } from '../src/core/markdown.js';

const SENTENCE = "Ankara {{Türkiye'nin}} başkentidir.";

test('a sentence splits into its literal text and its blanks', () => {
    const { segments, blanks } = parseCloze(SENTENCE);
    assert.deepEqual(segments.map(s => s.type), ['text', 'blank', 'text']);
    assert.equal(segments[0].value, 'Ankara ');
    assert.equal(segments[2].value, ' başkentidir.');
    assert.equal(blanks.length, 1);
    assert.deepEqual(blanks[0].answers, ["Türkiye'nin"]);
});

test('several blanks are numbered in reading order', () => {
    const { blanks } = parseCloze('HTTP {{80}} portunu, HTTPS {{443}} portunu kullanır.');
    assert.deepEqual(blanks.map(b => b.index), [0, 1]);
    assert.deepEqual(clozeAnswers('HTTP {{80}} portunu, HTTPS {{443}} portunu kullanır.'), ['80', '443']);
});

test('a pipe lists alternative spellings, the first one being canonical', () => {
    const { blanks } = parseCloze('DNS {{53|Port 53|port 53}} kullanır.');
    assert.deepEqual(blanks[0].answers, ['53', 'Port 53', 'port 53']);
    assert.deepEqual(clozeAnswers('DNS {{53|Port 53}} kullanır.'), ['53'], 'feedback shows the first');
});

test('text without markers has no blanks', () => {
    assert.equal(hasBlanks('Ankara başkenttir.'), false);
    assert.deepEqual(parseCloze('Ankara başkenttir.').segments.map(s => s.type), ['text']);
});

test('an empty marker is detected rather than silently accepted', () => {
    assert.equal(hasBlanks('Ankara {{}} başkentidir.'), false, 'a blank with no answer is not usable');
    assert.equal(countEmptyBlanks('Ankara {{}} başkentidir.'), 1);
    assert.equal(countEmptyBlanks('Ankara {{ | }} başkentidir.'), 1, 'whitespace-only alternatives count as empty');
    assert.equal(countEmptyBlanks(SENTENCE), 0);
});

test('a blank accepts any of its spellings, trimmed and case-insensitive', () => {
    const [blank] = parseCloze('{{53|Port 53}}').blanks;
    assert.equal(matchesBlank(blank, '53'), true);
    assert.equal(matchesBlank(blank, '  Port 53  '), true, 'trimmed');
    assert.equal(matchesBlank(blank, 'port 53'), true, 'case-insensitive by default');
    assert.equal(matchesBlank(blank, 'port 53', true), false, 'unless the question asks otherwise');
    assert.equal(matchesBlank(blank, '54'), false);
    assert.equal(matchesBlank(blank, ''), false, 'an empty answer is never right');
});

test('grading requires every blank, not just one', () => {
    const two = 'HTTP {{80}}, HTTPS {{443}}.';
    assert.equal(gradeCloze(two, ['80', '443']), true);
    assert.equal(gradeCloze(two, ['80', '444']), false);
    assert.equal(gradeCloze(two, ['80']), false, 'a missing second answer fails');
    assert.equal(gradeCloze(two, []), false);
    assert.equal(gradeCloze('no markers here', []), false, 'nothing to grade is not a pass');
});

test('the sentence renders with numbered gaps inside Markdown', () => {
    const markup = clozeMarkup(SENTENCE);
    assert.equal(markup, '<div class="md-content"><p>Ankara <span class="cloze-gap" data-blank="0">1</span> başkentidir.</p></div>');

    const risky = clozeMarkup('<script>x</script> {{a}}');
    assert.ok(!risky.includes('<script>'), 'XSS tags are escaped before rendering');
});

test('Step 3 (a): cloze sentence with bold formatting around a blank', () => {
    const markdownCloze = '**Ankara** {{Türkiye\'nin}} başkentidir.';
    const html = clozeMarkup(markdownCloze);
    assert.equal(html.includes('<strong>Ankara</strong>'), true);
    assert.equal(html.includes('<span class="cloze-gap" data-blank="0">1</span>'), true);
});

test('Step 3 (b): {{x}} inside inline code or fenced code is NOT a gap', () => {
    const inlineCodeCloze = 'Code `{{var}}` is raw';
    const { blanks: inlineBlanks } = parseCloze(inlineCodeCloze);
    assert.equal(inlineBlanks.length, 0);
    const inlineHtml = clozeMarkup(inlineCodeCloze);
    assert.equal(inlineHtml.includes('class="cloze-gap"'), false);
    assert.equal(inlineHtml.includes('<code>{{var}}</code>'), true);

    const fencedCodeCloze = '```js\nfunction test() { return "{{val}}"; }\n```';
    const { blanks: fencedBlanks } = parseCloze(fencedCodeCloze);
    assert.equal(fencedBlanks.length, 0);
    const fencedHtml = clozeMarkup(fencedCodeCloze);
    assert.equal(fencedHtml.includes('class="cloze-gap"'), false);
});

test('Step 3 (c): corpus gap count and order parity with parseCloze', () => {
    const corpus = [
        'Plain {{one}} and {{two}} gaps.',
        'Heading\n\n- List {{item1}}\n- List {{item2}}',
        'Callout > [!note]\n> Body {{answer1}} and {{answer2}}',
        'Table | H1 | H2 |\n|---|---|\n| {{a}} | {{b}} |'
    ];

    for (const text of corpus) {
        const { blanks } = parseCloze(text);
        const html = clozeMarkup(text);
        const gapMatches = [...html.matchAll(/class="cloze-gap" data-blank="(\d+)"/g)];
        
        assert.equal(gapMatches.length, blanks.length, `Gap count mismatch for text: ${text}`);
        for (let i = 0; i < blanks.length; i++) {
            assert.equal(Number(gapMatches[i][1]), blanks[i].index, `Index mismatch at position ${i}`);
        }
    }
});

test('filling in shows the solved sentence', () => {
    assert.equal(fillCloze(SENTENCE), "Ankara Türkiye'nin başkentidir.");
    assert.equal(fillCloze(SENTENCE, ['Türkiyenin']), 'Ankara Türkiyenin başkentidir.');
});

test('junk input does not throw', () => {
    assert.deepEqual(parseCloze(null).blanks, []);
    assert.deepEqual(parseCloze(undefined).segments, []);
    assert.equal(hasBlanks(''), false);
});

test('audit: a forged cloze placeholder cannot manufacture a gap', () => {
    // parseCloze is the sole authority on what a blank is. An author who writes
    // the renderer's internal placeholder must not create a gap the grader has
    // no answer for, which would make the question ungradeable.
    const forged = `Ankara ${SENTINEL}cloze0${SENTINEL} baskentidir.`;
    assert.equal(parseCloze(forged).blanks.length, 0);

    const html = clozeMarkup(forged);
    assert.equal(html.includes('cloze-gap'), false);
    assert.equal(html.includes(SENTINEL), false, 'placeholder delimiter must not reach the output');
    assert.equal(html.includes('Ankara'), true);
    assert.equal(html.includes('baskentidir'), true);
});

test('audit: gaps survive inside every block construct', () => {
    // Each case renders its blank through a different code path — list item,
    // callout body, table cell, heading, nested list — and all of them must
    // still agree with parseCloze on how many gaps there are and in what order.
    const cases = [
        '- item {{a}}\n- item {{b}}',
        '> [!note] Title\n> body {{z}}',
        '| head | value |\n| --- | --- |\n| row | {{cell}} |',
        '## Heading {{h}}\n\nBody text.',
        '- parent {{p}}\n  - child {{c}}'
    ];
    for (const source of cases) {
        const expected = parseCloze(source).blanks.length;
        assert.ok(expected > 0, `fixture should have blanks: ${source}`);

        const html = clozeMarkup(source);
        const found = [...html.matchAll(/class="cloze-gap" data-blank="(\d+)"/g)].map(m => Number(m[1]));
        assert.equal(found.length, expected, `gap count for: ${source}`);
        assert.deepEqual(found, [...Array(expected).keys()], `gap order for: ${source}`);
    }
});
