/* The parser has to finish.
 *
 * `tests/markdown.test.mjs` already fuzzes malformed input, but it asserts
 * `doesNotThrow` — and a parser that never returns does not throw. It spins,
 * synchronously, which in a browser means the tab locks up with no error in the
 * console and nothing in a log. That is how a line of exactly `## ` shipped: the
 * H2 toolbar button inserts it whenever nothing is selected, and every screen
 * that renders the question froze on it, not just the editor.
 *
 * The mechanism was a disagreement between two predicates. The block dispatcher
 * needed text after the hashes to call a line a heading; startsBlock() needed
 * only the hashes and a space. A line that satisfied the second and not the
 * first fell through every branch to the paragraph collector, which asked
 * startsBlock() about it, was told "that is a block", broke with nothing
 * consumed, and left the cursor exactly where it was.
 *
 * Each case runs in a worker with a deadline. node:test's own timeout cannot
 * help here — an infinite synchronous loop never yields, so the timer never
 * fires and the whole run hangs instead of going red.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';

const MODULE_URL = new URL('../src/core/markdown.js', import.meta.url).href;
const DEADLINE_MS = 5000;

const WORKER_SOURCE = `
    import { parentPort, workerData } from 'node:worker_threads';
    import { renderMarkdown, renderInlineMarkdown, plainText } from ${JSON.stringify(MODULE_URL)};
    const out = [];
    for (const text of workerData) {
        renderMarkdown(text);
        renderInlineMarkdown(text);
        plainText(text);
        out.push(text);
    }
    parentPort.postMessage(out.length);
`;

/** Resolves with the number of inputs parsed, or rejects when the parse hangs. */
function parseAll(texts) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(
            new URL(`data:text/javascript,${encodeURIComponent(WORKER_SOURCE)}`),
            { workerData: texts }
        );
        const timer = setTimeout(() => {
            worker.terminate();
            reject(new Error(`parser did not terminate within ${DEADLINE_MS}ms`));
        }, DEADLINE_MS);

        worker.on('message', (n) => { clearTimeout(timer); worker.terminate(); resolve(n); });
        worker.on('error', (err) => { clearTimeout(timer); worker.terminate(); reject(err); });
    });
}

/* Exactly what each toolbar button inserts when nothing is selected — prefix
   immediately followed by suffix, which is why the paired markers arrive
   doubled. Measured against the real buttons rather than read off their
   data-prefix, because `==` and `====` are not the same input to the parser. */
const TOOLBAR_INSERTIONS = [
    '****',            // bold        ** + **
    '**',              // italic      *  + *
    '``',              // code        `  + `
    '====',            // highlight   == + ==
    '[](https://)',    // link
    '- ',              // list
    '## ',             // heading  ← the one that froze the tab
    '> [!note]\n> '    // callout
];

test('every toolbar button produces text the parser can finish', async () => {
    const parsed = await parseAll(TOOLBAR_INSERTIONS);
    assert.equal(parsed, TOOLBAR_INSERTIONS.length);
});

test('a heading marker with nothing typed after it still terminates', async () => {
    /* One space is the case that could not backtrack its way to a match, so it
       is the one that diverged. Two spaces always did match, which is why the
       inconsistency went unnoticed. */
    const cases = [];
    for (const hashes of ['#', '##', '###', '####', '#####', '######']) {
        cases.push(hashes, `${hashes} `, `${hashes}  `, `${hashes}\t`, `${hashes} x`);
    }
    cases.push('####### ', 'Absatz\n## \nweiter', '## \n\n## ');

    const parsed = await parseAll(cases);
    assert.equal(parsed, cases.length);
});

test('the parser consumes a line every branch rejects, rather than spinning on it', async () => {
    /* The invariant behind all of the above: whatever the eight block branches
       decline, the paragraph collector takes. Asserted through behaviour — the
       line has to come out somewhere — because a cursor that fails to advance
       has no other visible symptom until the tab stops responding. */
    const { renderMarkdown } = await import('../src/core/markdown.js');
    const html = renderMarkdown('## ');
    assert.ok(html.length > 0, 'a line that reaches the parser must reach the output');
});

test('an empty heading renders as a heading, the way a spaced one always did', async () => {
    const { renderMarkdown } = await import('../src/core/markdown.js');
    // `##   ` has always produced an empty heading; `## ` now agrees with it.
    assert.equal(
        renderMarkdown('## ').replace(/\s+/g, ''),
        renderMarkdown('##   ').replace(/\s+/g, '')
    );
});

test('block markers in pairs terminate, whichever order they arrive in', async () => {
    /* startsBlock() looks one line ahead, so two-line documents are where a
       lookahead and the dispatcher can part company. */
    const markers = [
        '', ' ', '\t', 'Absatz',
        '#', '## ', '###### ', '####### ',
        '-', '- ', '* ', '1. ', '  - ',
        '>', '> ', '> [!note]', '> [!note]-',
        '```', '```js', '---', '***', '- - -',
        '|', '| a |', '|---|', '| --- |', 'a | b',
        '~~', '__', '==', '%%', '[[', '![[x]]'
    ];

    const cases = [];
    for (const a of markers) {
        for (const b of markers) cases.push(`${a}\n${b}`);
    }

    const parsed = await parseAll(cases);
    assert.equal(parsed, cases.length, `${cases.length} two-line documents must all finish`);
});
