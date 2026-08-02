import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// Source names, folder names, question text and AI provider URLs all reach the
// DOM through `innerHTML` template literals. None of that is HTML-escaped on
// the way in: `sanitizeImportedData()` only strips prototype-pollution keys, so
// a folder the user names `<img src=x onerror=...>` - or an imported JSON, or a
// Gist synced from another device - executes script.
//
// Escaping is applied by hand at each interpolation, which is exactly the kind
// of thing that decays as new templates get written. This test re-derives the
// audit instead of trusting it: every interpolation of a known user-controlled
// field that lands in an `innerHTML` template has to go through escapeHTML().

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/* utils.js pulls in state.js, which reads localStorage while the module is
   still being evaluated - so the DOM globals have to exist before the import. */
let escapeHTML;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    ({ escapeHTML } = await import('../src/core/utils.js'));
});

/* Fields whose values originate from the user, an imported JSON file, or a
   synced Gist - i.e. anything an attacker could have authored. */
const USER_FIELDS = [
    'name', 'description', 'text', 'url', 'back', 'explanation',
    'folderTitle', 'folderDesc', 'qText', 'acceptedTexts'
];

const FIELD_PATTERN = new RegExp(
    `\\$\\{[^}]*(?:\\.(?:${USER_FIELDS.join('|')})\\b|\\b(?:${USER_FIELDS.join('|')})\\b)[^}]*\\}`,
    'g'
);

/* `innerHTML = ` ... `` assignments, including multi-line templates. */
const INNER_HTML_TEMPLATE = /innerHTML\s*\+?=\s*`([^`\\]*(?:\\.[^`\\]*)*)`/gs;

function jsFiles(dir) {
    return readdirSync(dir).flatMap(entry => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return jsFiles(full);
        return entry.endsWith('.js') ? [full] : [];
    });
}

test('no innerHTML template interpolates user data without escapeHTML()', () => {
    const offenders = [];

    for (const file of jsFiles(SRC)) {
        const code = readFileSync(file, 'utf8');

        for (const [template] of code.matchAll(INNER_HTML_TEMPLATE)) {
            for (const [interpolation] of template.matchAll(FIELD_PATTERN)) {
                if (interpolation.includes('escapeHTML')) continue;
                offenders.push(`${file.slice(SRC.length)}: ${interpolation.trim()}`);
            }
        }
    }

    assert.deepEqual(
        offenders,
        [],
        `unescaped user data in innerHTML:\n  ${offenders.join('\n  ')}`
    );
});

test('escapeHTML neutralises the payloads that reach these templates', () => {
    const payloads = [
        '<img src=x onerror=alert(1)>',
        '"><script>alert(1)</script>',
        "'onmouseover='alert(1)",
        '</textarea><script>alert(1)</script>',
        '</option><img src=x onerror=alert(1)>'
    ];

    for (const payload of payloads) {
        const escaped = escapeHTML(payload);
        assert.ok(!escaped.includes('<'), `'<' survived escaping of: ${payload}`);
        assert.ok(!escaped.includes('>'), `'>' survived escaping of: ${payload}`);
        assert.ok(!escaped.includes('"'), `'"' survived escaping of: ${payload}`);
        assert.ok(!escaped.includes("'"), `"'" survived escaping of: ${payload}`);
    }
});
