/* Every key the code asks for must exist in every language. t() falls back to
   the key name when it misses, so a gap does not throw — it just paints
   "accepted_texts_placeholder" into the UI, or leaves one language's wording
   sitting in another's screen. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { glob } from 'node:fs/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const i18nSource = readFileSync(join(root, 'src/core/i18n.js'), 'utf8');

/** The key sets of each language block, in file order: tr, en, de. */
function languageKeySets() {
    const blocks = i18nSource.split(/^\s{4}(?:tr|en|de):\s*\{$/m).slice(1);
    return blocks.map(block => new Set(
        [...block.matchAll(/^\s{8}([a-z0-9_]+):/gm)].map(m => m[1])
    ));
}

test('the three language blocks were found', () => {
    const sets = languageKeySets();
    assert.equal(sets.length, 3);
    for (const keys of sets) assert.ok(keys.size > 100, `expected a full block, got ${keys.size} keys`);
});

test('no language is missing a key another one has', () => {
    const [tr, en, de] = languageKeySets();
    const all = new Set([...tr, ...en, ...de]);
    const missing = [];
    for (const key of all) {
        if (!tr.has(key)) missing.push(`tr: ${key}`);
        if (!en.has(key)) missing.push(`en: ${key}`);
        if (!de.has(key)) missing.push(`de: ${key}`);
    }
    assert.deepEqual(missing, [], 'every key must be present in tr, en and de');
});

test('every t() key used in the app is defined', async () => {
    const [tr] = languageKeySets();
    const used = new Set();

    for await (const file of glob('src/**/*.js', { cwd: root })) {
        if (file.endsWith('i18n.js')) continue;
        const src = readFileSync(join(root, file), 'utf8');
        // Whole literal keys only. The trailing ) or , excludes composed lookups
        // like t('difficulty_' + rating), whose halves are checked at their own
        // call sites; t(`validation_${code}`) has its own test below.
        for (const m of src.matchAll(/\bt\(\s*['"]([a-z0-9_]+)['"]\s*[),]/g)) used.add(m[1]);
    }

    const undefinedKeys = [...used].filter(key => !tr.has(key)).sort();
    assert.deepEqual(undefinedKeys, [], 'these keys are asked for but never defined');
});

test('every issue code from question-rules has a validation_ message', async () => {
    const [tr] = languageKeySets();
    const rules = readFileSync(join(root, 'src/core/question-rules.js'), 'utf8');
    const codes = [...rules.matchAll(/code:\s*'([a-z_]+)'/g)].map(m => m[1]);

    assert.ok(codes.length >= 8, `expected the full rule set, found ${codes.length}`);
    const missing = [...new Set(codes)].filter(code => !tr.has(`validation_${code}`)).sort();
    assert.deepEqual(missing, [], 'issue codes are turned into t(`validation_${code}`) at runtime');
});
