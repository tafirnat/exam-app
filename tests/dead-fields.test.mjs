import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* `totalStats` rode along in the sync payload for years with nothing on either
   end of it: no code in features/ read it or wrote it, the manual backup export
   never included it, and its merge rule handed the remote an outright win - not
   even a max - so a device's own totals could not have reached the Gist even if
   something had been producing them. It cost a field in every push, three
   branches in the merge, and a line in two apply paths.

   A dead field is easy to reintroduce, because reintroducing it looks like
   fixing an omission: the reset functions still clear the old storage key, and
   AppState no longer has the property, so the obvious "repair" is to add it
   back. This scan is here to make that fail loudly and say why. */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function jsFilesUnder(dir) {
    return readdirSync(dir).flatMap(entry => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return jsFilesUnder(full);
        return entry.endsWith('.js') ? [full] : [];
    });
}

/**
 * Source with comments stripped, so the scan does not trip over the note that
 * documents the removal. That mistake has been made three times in this repo.
 */
function codeOnly(text) {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

test('totalStats stays gone from the sync payload and the merge', () => {
    const offenders = jsFilesUnder(SRC)
        .filter(file => /totalStats/.test(codeOnly(readFileSync(file, 'utf8'))))
        .map(file => file.slice(SRC.length));

    assert.deepEqual(offenders, [],
        'totalStats had no reader and no writer; the per-question counts in `stats` are the real ones');
});

test('the scan would notice if it came back', () => {
    // Guarding the guard: a scan that cannot fail is worse than no scan, and a
    // comment-stripping one is exactly the shape that quietly stops matching.
    const withField = 'const payload = { stats: {}, totalStats: AppState.totalStats };';
    const withOnlyAComment = '/* No totalStats here - it was removed on purpose. */\nconst payload = {};';

    assert.match(codeOnly(withField), /totalStats/);
    assert.doesNotMatch(codeOnly(withOnlyAComment), /totalStats/);
});
