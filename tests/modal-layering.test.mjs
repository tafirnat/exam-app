import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* customModalOverlay is the shared confirm/alert dialog, and every screen can
   open it. Deleting from the archive screen used to look like a dead button:
   the archive overlay sat at 10001, the confirm opened at 9999 behind it, and
   the user saw nothing happen.
   The invariant is simple enough to check statically, and a comment would not
   have survived the next overlay someone adds with a bigger number. */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'src/style.css'), 'utf8');

/** The z-index every .modal-overlay gets when it declares none of its own. */
function baseOverlayZ() {
    const block = css.match(/^\.modal-overlay\s*\{([^}]*)\}/m);
    assert.ok(block, '.modal-overlay rule not found');
    const z = block[1].match(/z-index:\s*(\d+)/);
    assert.ok(z, '.modal-overlay has no z-index');
    return Number(z[1]);
}

/** Every element carrying class="modal-overlay", with the z-index it ends up at. */
function overlays() {
    const base = baseOverlayZ();
    const found = [];
    for (const m of html.matchAll(/<div\s+id="([^"]+)"\s+class="[^"]*modal-overlay[^"]*"([^>]*)>/g)) {
        const inline = m[2].match(/z-index:\s*(\d+)/);
        found.push({ id: m[1], z: inline ? Number(inline[1]) : base });
    }
    return found;
}

test('every modal overlay was found', () => {
    const all = overlays();
    assert.ok(all.length >= 8, `expected the overlay set, found ${all.length}`);
    assert.ok(all.some(o => o.id === 'customModalOverlay'));
});

test('the shared confirm dialog outranks every other overlay', () => {
    const all = overlays();
    const confirm = all.find(o => o.id === 'customModalOverlay');
    const beaten = all.filter(o => o.id !== 'customModalOverlay' && o.z >= confirm.z);

    assert.deepEqual(beaten.map(o => `${o.id} (${o.z})`), [],
        `these overlays would cover the confirm dialog (z ${confirm.z}), so a confirm opened from them is invisible`);
});

test('the storage notice stays below the confirm it opens', () => {
    const all = overlays();
    const notice = all.find(o => o.id === 'storageNoticeOverlay');
    const confirm = all.find(o => o.id === 'customModalOverlay');
    assert.ok(notice, 'storageNoticeOverlay not found');
    assert.ok(notice.z < confirm.z,
        'the notice asks for delete confirmations - they have to land on top of it');
});
