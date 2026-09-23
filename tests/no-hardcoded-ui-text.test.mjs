import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * No user-visible string is written in one language in the code.
 *
 * Five of these had accumulated, all of them Turkish, all of them read as
 * Turkish in the English and German builds: the source picker's "at most N
 * sources" toast, its "N selected" badge and empty state, the quick-group row
 * tooltips, and both focus-pool warnings. Each was invisible to anyone testing
 * in Turkish, which is how five of them got in.
 *
 * The scan looks for Turkish-specific letters in a string that is being put on
 * screen. That is narrow on purpose - it cannot catch an English literal - but
 * it catches this whole family, and the family is what kept recurring.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const TURKISH = /[çğıİşöüÇĞŞÖÜ]/;

/* Sinks that put a string in front of the user. A literal reaching one of
   these has skipped t(). */
const SINKS = [
    /showToast\(\s*(['"`])/,
    /showAlert\(\s*(['"`])/,
    /showConfirm\(\s*(['"`])/,
    /\.textContent\s*=\s*(['"`])/,
    /\.innerText\s*=\s*(['"`])/,
    /setAttribute\(\s*['"](?:title|aria-label|placeholder)['"]\s*,\s*(['"`])/
];

function walk(dir) {
    return readdirSync(dir).flatMap(name => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return walk(full);
        return full.endsWith('.js') ? [full] : [];
    });
}

/** The scan must not trip over the rule as written down in a comment. */
function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

test('no user-visible literal is written in a single language', async () => {
    const offenders = [];
    walk(SRC).forEach(file => {
        // i18n.js IS the translations; guide-content.js is prose, by language.
        if (file.endsWith('i18n.js') || file.includes('guide-content')) return;
        if (file.includes('motivation-quotes')) return; // quotes, per language, by design
        stripComments(readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
            if (!TURKISH.test(line)) return;
            if (SINKS.some(re => re.test(line))) {
                offenders.push(`${file.slice(SRC.length + 1)}:${i + 1}  ${line.trim().slice(0, 80)}`);
            }
        });
    });
    assert.deepEqual(offenders, [], 'route these through t() and add the key in tr/en/de');
});

test('the scan actually catches something - a deliberate violation', async () => {
    // Guards against the scan silently matching nothing, which is how a green
    // static scan hides a whole class of bug.
    const sample = `showToast('En fazla 3 kaynak seçebilirsiniz');`;
    assert.ok(TURKISH.test(sample) && SINKS.some(re => re.test(sample)));
});

test('the scan ignores the rule written in a comment', async () => {
    const sample = `// showToast('Kaynak seçildi') would be an offence\nconst x = 1;`;
    const stripped = stripComments(sample);
    assert.ok(!TURKISH.test(stripped) || !SINKS.some(re => re.test(stripped)));
});
