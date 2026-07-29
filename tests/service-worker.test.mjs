/* cache.addAll() is all-or-nothing: one missing entry rejects the whole install
   and the app ends up with no offline cache at all. That failure is silent in
   normal use, so the precache list is checked against what actually ships. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sw = readFileSync(join(root, 'public/sw.js'), 'utf8');

const precached = () => {
    const list = sw.match(/ASSETS_TO_CACHE\s*=\s*\[([\s\S]*?)\]/)?.[1];
    assert.ok(list, 'ASSETS_TO_CACHE should be a literal array');
    return [...list.matchAll(/'([^']+)'/g)].map(m => m[1]);
};

test('every precached file exists', () => {
    const missing = precached()
        // './' and index.html are produced by the build, not present as-is.
        .filter(p => p !== './' && p !== './index.html')
        .map(p => p.replace(/^\.\//, '').split('?')[0])
        .filter(p => !existsSync(join(root, 'public', p)));

    assert.deepEqual(missing, [], 'a missing entry makes cache.addAll reject and disables offline mode');
});

test('all three language samples are precached', () => {
    const list = precached();
    for (const lang of ['tr', 'en', 'de']) {
        assert.ok(list.includes(`./examples/sample-${lang}.json`),
            `sample-${lang} must be available offline — the language is only known at runtime`);
    }
});
