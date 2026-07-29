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

test('the sentence renders with numbered gaps, escaping only the literal text', () => {
    const markup = clozeMarkup(SENTENCE, (s) => s.replace(/</g, '&lt;'));
    assert.match(markup, /^Ankara <span class="cloze-gap" data-blank="0">1<\/span> başkentidir\.$/);

    const risky = clozeMarkup('<script>x</script> {{a}}', (s) => s.replace(/</g, '&lt;'));
    assert.ok(!risky.includes('<script>'), 'the escape hook is applied to literal text');
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
