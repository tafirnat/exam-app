import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

/* The unfinished-test record is synced, so the home screen's "Devam Et" button
   changes without anyone on this device touching it: the other device leaves a
   test open, or finishes one and leaves a cleared record behind. It used to be
   recomputed only on navigation, which meant the home screen could sit on a
   stale answer in both directions - no button for a test still open elsewhere,
   or a button for one already finished - and a manual page refresh was the only
   way to find out.
 *
 * The fix had to split checkActiveTest() in two, and that split is the thing
 * worth pinning: the half that promotes a preset's saved session *writes*, and
 * the write stamps the record with this device's id and the current time. If
 * that half ran on a store emit, this device would claim another device's live
 * session the instant it synced - which is precisely what pickActiveSession()
 * reads to decide who is sitting in the test. */

let renderResumeButton, storage;

const HOME = `<!doctype html><html><body>
    <div id="startBtnContainer">
        <button id="resumeBtn" style="display:none"></button>
        <button id="startBtn"></button>
    </div>
</body></html>`;

before(async () => {
    const dom = new JSDOM(HOME, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    storage = await import('../src/core/storage.js');
    ({ renderResumeButton } = await import('../src/features/test/test-ui.js'));
});

beforeEach(() => {
    localStorage.clear();
    document.getElementById('resumeBtn').style.display = 'none';
});

const resumeShown = () => document.getElementById('resumeBtn').style.display !== 'none';

test('an open session on the record offers a resume', () => {
    storage.persist('focus_app_active_test', {
        currentTest: ['src-a_1', 'src-a_2'], currentIndex: 1, deviceId: 'dev-b', updatedAt: Date.now()
    });

    renderResumeButton();

    assert.equal(resumeShown(), true);
    assert.equal(document.getElementById('startBtn').getAttribute('data-i18n'), 'new_test');
});

test('a test finished on another device takes the button away', () => {
    storage.persist('focus_app_active_test', {
        currentTest: ['src-a_1'], currentIndex: 0, deviceId: 'dev-b', updatedAt: Date.now()
    });
    renderResumeButton();
    assert.equal(resumeShown(), true);

    // What clearActiveTest() leaves behind: a tombstone, not an absent key -
    // "I finished mine" has to be a dated fact the merge can weigh.
    storage.persist('focus_app_active_test', { cleared: true, deviceId: 'dev-b', updatedAt: Date.now() });
    renderResumeButton();

    assert.equal(resumeShown(), false);
    assert.equal(document.getElementById('startBtn').getAttribute('data-i18n'), 'start_test');
});

test('no record at all offers no resume', () => {
    renderResumeButton();
    assert.equal(resumeShown(), false);
});

test('a corrupted record costs the button, not the home screen', () => {
    // This runs on every return to home. A bare JSON.parse here once broke that
    // path outright; the worst it may do is offer nothing to resume.
    localStorage.setItem('focus_app_active_test', '{not json');

    assert.doesNotThrow(() => renderResumeButton());
    assert.equal(resumeShown(), false);
});

test('drawing the button never writes', () => {
    /* The load-bearing property. A renderer that wrote would re-stamp the
       record on every redraw, and the store redraws whenever the record
       changes - including when it changed because another device pushed it. */
    storage.persist('focus_app_active_test', {
        currentTest: ['src-a_1'], currentIndex: 0, deviceId: 'dev-b', updatedAt: 111
    });
    const before = localStorage.getItem('focus_app_active_test');

    renderResumeButton();
    renderResumeButton();

    assert.equal(localStorage.getItem('focus_app_active_test'), before);
});

test('redrawing is idempotent', () => {
    storage.persist('focus_app_active_test', { currentTest: ['q1'], updatedAt: 1 });
    renderResumeButton();
    const first = document.getElementById('startBtnContainer').outerHTML;

    renderResumeButton();

    assert.equal(document.getElementById('startBtnContainer').outerHTML, first);
});

// ── The wiring ──────────────────────────────────────────────────────────────

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

test('the button is wired to the slice, not left to navigation', () => {
    const bindings = readFileSync(SRC + 'core/ui-bindings.js', 'utf8');

    // One row in the table is the whole fix - see CLAUDE.md rule 2. Without it
    // the renderer exists and nothing ever calls it on a sync.
    assert.match(bindings, /renderResumeButton/,
        'ui-bindings.js has no row for the resume button');
    const row = bindings.slice(bindings.indexOf("name: 'home:resume'"), bindings.indexOf("name: 'home:activeSources'"));
    assert.match(row, /Slice\.ACTIVE_TEST/, 'the row does not listen to Slice.ACTIVE_TEST');
});

test('the promote-and-stamp half stayed off the render path', () => {
    const mainSrc = readFileSync(SRC + 'main.js', 'utf8');
    const testUi = readFileSync(SRC + 'features/test/test-ui.js', 'utf8');

    // The write lives in main.js's checkActiveTest(), on the navigation path.
    assert.match(mainSrc, /function checkActiveTest\(\)[\s\S]*?persist\('focus_app_active_test'/,
        'the preset promotion should stay in checkActiveTest()');
    // And must not have followed the renderer into the module the store calls.
    assert.doesNotMatch(testUi, /persist\(\s*'focus_app_active_test'/,
        'the renderer module must never write the active-test record');
});
