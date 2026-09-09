/* The content this repo ships is documentation that executes.
 *
 * `public/examples/sample-*.json` and `public/exams/*.json` are the first thing
 * a new user imports and the concrete answer to "what does a question look
 * like". AI_AGENT_PROMPT.md and docs/MARKDOWN_SPEC.md tell an author that every
 * string is Obsidian Markdown and that raw HTML is escaped rather than honoured
 * — and these files are what that claim is checked against by anyone who reads
 * before they trust.
 *
 * So a tag that slips into shipped content does two things at once: it renders
 * as literal `<b>` on the learner's screen, and it teaches the opposite of the
 * documented rule to everyone who copies the sample. Neither shows up as a
 * failure anywhere else — the app does not crash on it, and no other suite
 * reads these files.
 *
 * Measured when this was written: 370 author-facing strings across four files,
 * zero HTML tags, zero entities, zero hand-typed bullets. The rule was already
 * kept; what was missing was anything that keeps it kept.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const BULLET = '•';

/** Every shipped content file, discovered rather than listed - a new exam has to obey the rule too. */
function contentFiles() {
    const out = [];
    for (const dir of ['public/examples', 'public/exams']) {
        const url = new URL('../' + dir, import.meta.url);
        if (!existsSync(url)) continue;
        for (const name of readdirSync(url)) {
            if (name.endsWith('.json')) out.push(dir + '/' + name);
        }
    }
    return out;
}

/** Author-facing strings, each with the JSON path that locates it. */
function authorStrings(value, path = '', out = []) {
    if (typeof value === 'string') out.push([path, value]);
    else if (Array.isArray(value)) value.forEach((v, i) => authorStrings(v, `${path}[${i}]`, out));
    else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) authorStrings(v, `${path}.${k}`, out);
    }
    return out;
}

const FILES = contentFiles();
const load = (f) => JSON.parse(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));

test('there is shipped content to check', () => {
    // Guards the discovery itself: a rename that empties the list would turn
    // every rule below into a loop over nothing, and pass.
    assert.ok(FILES.length >= 4, `expected the shipped samples and exams, found ${FILES.length}`);
    assert.ok(FILES.some(f => f.includes('sample-')), 'the language samples must be among them');
});

test('no shipped content string carries HTML', () => {
    for (const file of FILES) {
        for (const [path, value] of authorStrings(load(file))) {
            const tags = value.match(/<\/?[a-zA-Z][^>]*>/g) || [];
            assert.deepEqual(tags, [],
                `${file}${path} must be Markdown, not HTML - found ${tags.join(' ')}`);

            const entities = value.match(/&(?:nbsp|amp|lt|gt|quot|#\d+);/g) || [];
            assert.deepEqual(entities, [],
                `${file}${path} carries an HTML entity: ${entities.join(' ')}`);
        }
    }
});

/* The failure this catches is the one the app's own interface strings had:
   text that is tag-free and still not Markdown, because the bullets were typed
   as a character. Such a list renders as one run-on paragraph - no <ul>, no
   hanging indent - and reads as a rendering bug rather than an authoring one. */
test('lists in shipped content are Markdown lists, not typed bullet characters', () => {
    for (const file of FILES) {
        for (const [path, value] of authorStrings(load(file))) {
            assert.ok(!value.includes(BULLET),
                `${file}${path} fakes a bullet with "${BULLET}" - write "- " at the start of a line`);
        }
    }
});

/* Tag-free and bullet-free is necessary, not sufficient: plain prose passes
   both. The samples exist to show the syntax surface, so assert they still
   exercise it - otherwise they can decay into flat text and keep every rule
   above green while teaching nothing. */
test('the language samples still demonstrate the Markdown surface', async () => {
    const { renderMarkdown } = await import('../src/core/markdown.js');

    for (const file of FILES.filter(f => f.includes('sample-'))) {
        const blob = authorStrings(load(file)).map(([, v]) => v).join('\n');
        const html = renderMarkdown(blob);

        for (const [name, tag] of [
            ['bold', '<strong>'], ['inline code', '<code>'], ['list', '<li>'],
            ['heading', '<h'], ['table', '<table>'], ['callout', 'md-callout']
        ]) {
            assert.ok(html.includes(tag), `${file} no longer demonstrates ${name}`);
        }
    }
});

/* Written against the rendered output, not the source: the point is that an
   importer sees blocks. A sample whose Markdown is subtly malformed still
   passes a source-level scan while showing the reader its own asterisks. */
test('shipped content renders without leaking its own markers', async () => {
    const { renderMarkdown, plainText } = await import('../src/core/markdown.js');

    for (const file of FILES) {
        for (const [path, value] of authorStrings(load(file))) {
            const rendered = plainText(renderMarkdown(value));
            assert.ok(!rendered.includes('**'),
                `${file}${path} shows literal ** to the reader`);
        }
    }
});
