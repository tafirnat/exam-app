/* The editor's two new behaviours: the gate in front of unsaved work, and the
 * focus mode that hands the screen to one field.
 *
 * The editor writes its fields back into the working copy only on tab switches
 * and saves, so "is this dirty" has to read the inputs itself - every case below
 * goes through the real inputs for that reason.
 *
 * jsdom has no layout, so what a CSS rule *does* is measured in a browser. What
 * is asserted here is the mechanism: which classes land where, and that the
 * stylesheet keys its hiding off exactly those classes.
 */
import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let dom, editor, AppState, stableStringify;

/* The real shared confirmation card, lifted out of index.html rather than
   hand-rolled: showDecision() drives those exact ids, and a stand-in would let
   the markup and the code drift apart without a test noticing. */
function sharedModalMarkup() {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const doc = new JSDOM(html).window.document;
    return doc.getElementById('customModalOverlay').outerHTML;
}

before(async () => {
    dom = new JSDOM(`<!doctype html><html><body><div id="toast"></div>${sharedModalMarkup()}</body></html>`,
        { url: 'http://localhost/' });

    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    editor = await import('../src/features/stats/question-editor.js');
    ({ AppState } = await import('../src/core/state.js'));
    ({ stableStringify } = await import('../src/core/utils.js'));
});

const focusIn = (el) => el.dispatchEvent(new dom.window.FocusEvent('focusin', { bubbles: true }));
const pointerDown = (el) => el.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
const card = () => document.querySelector('.editor-card');

const openReading = () => editor.openQuestionEditor({
    id: 'read_002', sourceId: 's1', type: 'reading',
    content: { text: 'prose' }, answer: { explanation: 'e' }
});

const openChoice = () => editor.openQuestionEditor({
    id: 'mc_1', sourceId: 's1', type: 'single_choice',
    options: [{ id: 1, text: 'a', media: [] }, { id: 2, text: 'b', media: [] }],
    answer: { correct_ids: [1] }, content: { text: 'q' }
});

beforeEach(() => {
    AppState.sources = [{
        id: 's1', name: 'S', active: true, archived: false,
        questions: [{ id: 'read_002', type: 'reading', content: { text: 'prose' }, answer: { explanation: 'e' } }]
    }];
    AppState.stats = {};
});

// ── Unsaved-changes gate ────────────────────────────────────────────────────

test('an untouched question is not dirty', () => {
    openReading();
    assert.equal(editor.isEditorDirty(), false);
});

test('typing into a field makes it dirty', () => {
    openReading();
    document.querySelector('[data-group="content"]').click();
    document.getElementById('edit-text').value = 'prose, revised';
    assert.equal(editor.isEditorDirty(), true);
});

test('the dirty check reads the inputs, not just the last synced copy', () => {
    /* Without the sync, half-typed text is invisible to the check: the editor
       would call the question clean and throw the edit away without asking. */
    openReading();
    document.querySelector('[data-group="answer"]').click();
    const exp = document.getElementById('edit-explanation');
    exp.value = 'a longer explanation';
    // No tab switch, no save - nothing has written this back yet.
    assert.equal(editor.isEditorDirty(), true);
});

test('the same question handed over with its keys in another order opens clean', () => {
    /* Callers build the question object differently - resolvePreviewQuestion()
       assembles it from spreads, the source list passes the stored object
       through - so the same question arrives with its keys in different orders. */
    editor.openQuestionEditor({
        id: 'sa_1', sourceId: 's1', type: 'short_answer',
        content: { text: 'q' }, answer: { explanation: 'e', accepted_texts: ['x'] }
    });
    assert.equal(editor.isEditorDirty(), false);

    editor.openQuestionEditor({
        id: 'sa_1', sourceId: 's1', type: 'short_answer',
        answer: { accepted_texts: ['x'], explanation: 'e' },   // same data, other order
        content: { text: 'q' }
    });
    assert.equal(editor.isEditorDirty(), false);
});

test('the comparison itself is blind to key order', () => {
    /* Locked on the helper rather than through the editor, honestly: on today's
       code path both the baseline and every later comparison run through the
       same syncDataFromInputs(), so plain JSON.stringify would agree with this
       and no editor-level case can tell them apart. The ordering matters the
       moment anything reshapes the object between the two reads - which is
       exactly what normalizeForType() does on a type change - so the guarantee
       is stated where it can actually be held. */
    assert.equal(
        stableStringify({ b: 1, a: { d: [1, 2], c: 3 } }),
        stableStringify({ a: { c: 3, d: [1, 2] }, b: 1 })
    );
    // Order-blind, not difference-blind.
    assert.notEqual(stableStringify({ a: 1 }), stableStringify({ a: 2 }));
    // Arrays are sequences: their order is data, not layout.
    assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
});

test('a closed editor is neither open nor dirty', () => {
    openReading();
    assert.equal(editor.isQuestionEditorOpen(), true);
    editor.closeQuestionEditor();
    assert.equal(editor.isQuestionEditorOpen(), false);
    assert.equal(editor.isEditorDirty(), false);
});

test('leaving a clean editor asks nothing', async () => {
    openReading();
    assert.equal(document.getElementById('customModalOverlay').classList.contains('active'), false);
    assert.equal(await editor.requestEditorExit(), 'discarded');
    assert.equal(document.getElementById('customModalOverlay').classList.contains('active'), false,
        'a clean editor must not put a dialog in the way');
});

/**
 * Makes the editor dirty and asks to leave, leaving the dialog on screen.
 *
 * showDecision attaches its listeners synchronously inside the promise
 * executor, so the buttons are live by the time this returns and the caller can
 * inspect the dialog before answering it.
 */
function askToLeaveDirty() {
    openReading();
    document.querySelector('[data-group="content"]').click();
    document.getElementById('edit-text').value = 'prose, revised';
    return editor.requestEditorExit();
}

/** …and presses one of the three buttons straight away. */
function leaveDirtyVia(buttonId) {
    const outcome = askToLeaveDirty();
    document.getElementById(buttonId).click();
    return outcome;
}

test('leaving a dirty editor asks, and Cancel keeps the caller where it is', async () => {
    assert.equal(await leaveDirtyVia('modalCancelBtn'), 'cancel');
    assert.equal(AppState.sources[0].questions[0].content.text, 'prose', 'nothing may be written');
    // The editor stays open: 'cancel' is the answer that forbids going anywhere.
    assert.equal(editor.isQuestionEditorOpen(), true);
});

test('Discard leaves without writing', async () => {
    assert.equal(await leaveDirtyVia('modalAltBtn'), 'discarded');
    assert.equal(AppState.sources[0].questions[0].content.text, 'prose');
});

test('Save writes and then lets the caller go', async () => {
    assert.equal(await leaveDirtyVia('modalConfirmBtn'), 'saved');
    assert.equal(AppState.sources[0].questions[0].content.text, 'prose, revised');
});

test('pressing Save on a question that cannot be saved refuses the exit too', async () => {
    /* Reporting 'saved' here would let the caller navigate away from work that
       was never written - the worst of the three outcomes, reached by pressing
       the button that promises the opposite. */
    openReading();
    document.querySelector('[data-group="content"]').click();
    document.getElementById('edit-text').value = '';   // reading needs its text

    const outcome = editor.requestEditorExit();
    document.getElementById('modalConfirmBtn').click();

    assert.equal(await outcome, 'cancel');
    assert.equal(AppState.sources[0].questions[0].content.text, 'prose');
    assert.ok(document.querySelector('.editor-error'), 'and the reason has to be on screen');
});

test('the three choices stack instead of being clipped by the card', async () => {
    /* `.btn` never wraps its label and `.modal-card` clips its overflow, so a
       row that does not fit is cut off rather than squeezed — measured in the
       browser: "Abbrechen" was sliced in half by the card's left edge. The
       layout is a class so the card can go back to a row for the next dialog. */
    const footer = document.getElementById('modalFooter');

    const outcome = askToLeaveDirty();
    assert.ok(footer.classList.contains('is-decision'), 'three choices read as a list, not a row');

    document.getElementById('modalCancelBtn').click();
    await outcome;
    assert.equal(footer.classList.contains('is-decision'), false, 'and the row comes back');
});

test('the stacked layout puts the primary first and never sets a fixed width', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');   // the rules are explained at length beside them

    // DOM order is cancel, alt, confirm — reversing the column leads with Save.
    assert.match(css, /\.modal-footer\.is-decision\s*\{[^}]*flex-direction:\s*column-reverse/);
    assert.match(css, /\.modal-footer\.is-decision\s*\{[^}]*align-items:\s*stretch/);
    // The floor under any footer that outgrows its row, decision or not.
    assert.match(css, /\.modal-footer\s*\{[^}]*flex-wrap:\s*wrap/);
});

test('the third button belongs to this dialog alone', async () => {
    /* The card is shared with showConfirm and showAlert. A stray third button
       inherited from a previous dialog is worse than no third button at all, so
       both ends guard it: showDecision puts it away, and the others refuse to
       inherit it. Each is asserted against a card deliberately left dirty. */
    const altBtn = document.getElementById('modalAltBtn');
    const footer = document.getElementById('modalFooter');

    await leaveDirtyVia('modalAltBtn');
    assert.equal(altBtn.style.display, 'none', 'showDecision must put it away');

    const { showConfirm, showAlert } = await import('../src/core/utils.js');

    // Deliberately left dirty, so the guard is measured rather than assumed.
    altBtn.style.display = 'inline-flex';
    footer.classList.add('is-decision');
    const confirmed = showConfirm('anything');
    assert.equal(altBtn.style.display, 'none', 'a plain confirmation must not inherit it');
    assert.equal(footer.classList.contains('is-decision'), false, 'nor the stacked layout');
    document.getElementById('modalCancelBtn').click();
    await confirmed;

    altBtn.style.display = 'inline-flex';
    footer.classList.add('is-decision');
    const alerted = showAlert('anything');
    assert.equal(altBtn.style.display, 'none', 'nor an alert');
    assert.equal(footer.classList.contains('is-decision'), false);
    document.getElementById('modalConfirmBtn').click();
    await alerted;
});

test('the dialog restores the labels it borrowed', async () => {
    /* showDecision renames Confirm and Cancel. Leaving those names behind would
       relabel the next dialog to use this card - a plain "are you sure?" would
       come up offering "Save changes".

       Asserted against the borrowed label rather than a remembered one: earlier
       cases in this file already ran the dialog, so a label that is never
       restored is equal before and after and a snapshot comparison passes. */
    const { t } = await import('../src/core/i18n.js');
    const confirmBtn = document.getElementById('modalConfirmBtn');
    const cancelBtn = document.getElementById('modalCancelBtn');

    await leaveDirtyVia('modalCancelBtn');

    assert.notEqual(confirmBtn.innerText, t('save_changes'));
    assert.notEqual(cancelBtn.innerText, t('discard_changes'));
});

test('a saved question is clean again', () => {
    // Otherwise saving and then moving on would ask about changes already written.
    openReading();
    document.querySelector('[data-group="content"]').click();
    document.getElementById('edit-text').value = 'prose, revised';

    assert.equal(editor.saveEditor(), true);
    assert.equal(editor.isEditorDirty(), false);
    assert.equal(AppState.sources[0].questions[0].content.text, 'prose, revised');
});

test('a saved question is stored as a copy, not aliased to the editor', () => {
    /* Storing the working object would alias the library to the editor's scratch
       space: the next keystroke synced from an input lands in the source with
       nothing to persist it, and the library disagrees with the disk. */
    openReading();
    document.querySelector('[data-group="content"]').click();
    document.getElementById('edit-text').value = 'saved text';
    editor.saveEditor();

    document.getElementById('edit-text').value = 'typed after saving';
    editor.isEditorDirty();   // syncs the inputs into the working copy

    assert.equal(AppState.sources[0].questions[0].content.text, 'saved text');
});

test('one review does not get stored on the question itself', () => {
    /* The Edit button hands over whatever the preview is showing, and from the
       results screen that object carries the answer the user gave. Measured
       before the fix: saving stored `userAnswer: ["B"]`, `isCorrect: false` and
       the stats list's own row labels inside the library question — and the sync
       then carried that to every other device. */
    editor.openQuestionEditor({
        id: 'read_002', sourceId: 's1', type: 'reading',
        content: { text: 'prose' }, answer: { explanation: 'e' },
        userAnswer: ['B'], isCorrect: false, isUnanswered: false,
        sourceName: 'S', originalIndex: 1
    });
    document.querySelector('[data-group="content"]').click();
    document.getElementById('edit-text').value = 'prose, revised';
    assert.equal(editor.saveEditor(), true);

    const stored = AppState.sources[0].questions[0];
    assert.equal(stored.content.text, 'prose, revised', 'the actual edit still lands');
    for (const field of ['userAnswer', 'isCorrect', 'isUnanswered', 'sourceName', 'originalIndex']) {
        assert.ok(!(field in stored), `${field} belongs to a review, not to the question`);
    }
});

test('a refused save reports failure instead of writing', () => {
    editor.openQuestionEditor({
        id: 'read_002', sourceId: 's1', type: 'reading',
        content: { text: 'prose' }, answer: { explanation: 'e' }
    });
    document.querySelector('[data-group="content"]').click();
    document.getElementById('edit-text').value = '';   // reading needs its text

    assert.equal(editor.saveEditor(), false);
    assert.equal(AppState.sources[0].questions[0].content.text, 'prose');
    assert.ok(document.querySelector('.editor-error'), 'the reason has to be on screen');
});

// ── Question navigation ─────────────────────────────────────────────────────

test('the footer carries the same arrow component as the preview bar', () => {
    openReading();
    const prev = document.getElementById('editor-nav-prev');
    const next = document.getElementById('editor-nav-next');
    assert.ok(prev && next, 'both arrows must exist in the editor footer');
    assert.ok(prev.classList.contains('q-nav-btn'));
    assert.ok(next.classList.contains('q-nav-btn'));
    assert.ok(prev.closest('.editor-footer'), 'the arrows belong to the footer');
});

test('the arrows are re-wired and re-enabled on every render, not only the first', () => {
    /* renderEditorModal() rebuilds the footer from scratch, so handlers attached
       once at open are dead after the first tab switch - and a tab switch is the
       most ordinary thing to do in this modal. The buttons also ship `disabled`,
       so the render has to hand the position back too or they come back inert
       and a click reaches nothing. */
    let delta = null;
    let refreshes = 0;
    window.navigateAdjacentQuestion = (d) => { delta = d; };
    window.refreshQuestionNavUI = () => {
        refreshes++;
        document.getElementById('editor-nav-prev').disabled = false;
        document.getElementById('editor-nav-next').disabled = false;
    };

    openReading();
    assert.ok(refreshes > 0, 'opening must ask for the position');

    const before = refreshes;
    document.querySelector('[data-group="content"]').click();
    assert.ok(refreshes > before, 'so must every later render');

    document.getElementById('editor-nav-next').click();
    assert.equal(delta, 1, 'the next arrow must still work after a re-render');

    document.getElementById('editor-nav-prev').click();
    assert.equal(delta, -1);

    delete window.navigateAdjacentQuestion;
    delete window.refreshQuestionNavUI;
});

// ── Focus mode ──────────────────────────────────────────────────────────────

test('focusing a textarea marks its block and puts the card in focus mode', () => {
    openReading();
    document.querySelector('[data-group="content"]').click();

    const textarea = document.getElementById('edit-text');
    focusIn(textarea);

    assert.ok(card().classList.contains('is-focus-mode'));
    assert.equal(document.querySelectorAll('.editor-focus-unit').length, 1);

    // The unit is the block, not the field: the toolbar and preview go with it.
    const unit = document.querySelector('.editor-focus-unit');
    assert.ok(unit.contains(textarea));
    assert.ok(unit.querySelector('.md-editor-toolbar'), 'the toolbar stays with its field');
    assert.ok(unit.querySelector('.editor-live-preview-box'), 'so does the live preview');
});

test('the field\'s own Markdown toolbar does not break the mode', () => {
    /* Exempt for a mechanical reason, not a conceptual one: exiting on the
       toolbar's pointerdown re-expands the layout and moves the button out from
       under the pointer, so the press would land somewhere else and the wrap
       would silently never happen. */
    openReading();
    document.querySelector('[data-group="content"]').click();
    focusIn(document.getElementById('edit-text'));

    const toolbarBtn = document.querySelector('.editor-focus-unit .md-tb-btn');
    focusIn(toolbarBtn);
    pointerDown(toolbarBtn);

    assert.ok(card().classList.contains('is-focus-mode'));
});

test('clicking the live preview leaves the mode, even though it is in the same block', () => {
    /* The mode belongs to the textarea, not to the block around it. The block
       keeps the screen so the preview stays readable while typing, but the
       preview is a read-only display — touching it means the user is done with
       the field. An earlier version keyed the exit off the block and so ignored
       every click inside it, the preview included. */
    openReading();
    document.querySelector('[data-group="content"]').click();
    focusIn(document.getElementById('edit-text'));
    assert.ok(card().classList.contains('is-focus-mode'));

    const preview = document.querySelector('.editor-focus-unit .editor-live-preview-container');
    assert.ok(preview, 'the preview must still be inside the focused block');
    pointerDown(preview);

    assert.equal(card().classList.contains('is-focus-mode'), false);
});

test('the label above the field leaves the mode too', () => {
    // Same rule, second surface: only the field and its own controls hold it.
    openReading();
    document.querySelector('[data-group="content"]').click();
    focusIn(document.getElementById('edit-text'));

    pointerDown(document.querySelector('.editor-focus-unit label'));
    assert.equal(card().classList.contains('is-focus-mode'), false);
});

test('clicking outside the focused block leaves focus mode', () => {
    openReading();
    document.querySelector('[data-group="content"]').click();
    focusIn(document.getElementById('edit-text'));

    /* pointerdown, not focusin: clicking the empty part of the content area
       moves focus nowhere and fires no focusin at all, so a mode listening only
       for focus would stick with no way out but a keystroke. */
    pointerDown(document.querySelector('.editor-content-area'));

    assert.equal(card().classList.contains('is-focus-mode'), false);
    assert.equal(document.querySelectorAll('.editor-focus-unit').length, 0);
});

test('moving focus to another field moves the mode with it', () => {
    openChoice();
    document.querySelector('[data-group="options"]').click();

    const fields = [...document.querySelectorAll('.opt-text-field')];
    focusIn(fields[0]);
    const first = document.querySelector('.editor-focus-unit');

    focusIn(fields[1]);
    assert.equal(document.querySelectorAll('.editor-focus-unit').length, 1,
        'only one block can hold the screen');
    assert.notEqual(document.querySelector('.editor-focus-unit'), first);
});

test('the footer is exempt: pressing Save must not collapse the layout under it', () => {
    openReading();
    document.querySelector('[data-group="content"]').click();
    focusIn(document.getElementById('edit-text'));

    pointerDown(document.querySelector('.editor-footer'));
    assert.ok(card().classList.contains('is-focus-mode'));
});

test('the focused block keeps its ancestors, so it is not hidden with them', () => {
    openChoice();
    document.querySelector('[data-group="options"]').click();
    focusIn(document.querySelector('.opt-text-field'));

    const unit = document.querySelector('.editor-focus-unit');
    assert.ok(unit.classList.contains('option-edit-card'), 'an option card is a focus unit too');

    let node = unit.parentElement;
    while (node && !node.classList.contains('edit-section')) {
        assert.ok(node.classList.contains('editor-focus-path'),
            'every container between the block and its section must be on the path');
        node = node.parentElement;
    }
});

test('a render clears focus mode, so the header can always show a refused save', () => {
    openReading();
    document.querySelector('[data-group="content"]').click();
    focusIn(document.getElementById('edit-text'));
    assert.ok(card().classList.contains('is-focus-mode'));

    document.querySelector('[data-group="answer"]').click();
    assert.equal(card().classList.contains('is-focus-mode'), false);
});

test('the escape hatch exists and is bound', () => {
    // On a phone, focus mode leaves very little "outside" left to tap.
    openReading();
    document.querySelector('[data-group="content"]').click();
    focusIn(document.getElementById('edit-text'));

    const exitBtn = document.querySelector('.editor-focus-exit');
    assert.ok(exitBtn, 'focus mode needs a spelled-out way back');
    exitBtn.click();
    assert.equal(card().classList.contains('is-focus-mode'), false);
});

test('the field height comes from a class, so focus mode can override it', () => {
    /* An inline `style="min-height: …"` beats any class rule short of
       !important, which is why these moved out of the markup. */
    openReading();
    document.querySelector('[data-group="content"]').click();
    const textarea = document.getElementById('edit-text');
    assert.equal(textarea.style.minHeight, '', 'no inline height may survive');
    assert.ok(textarea.classList.contains('ta-lg'));
});

test('nothing in the editor sets display or min-height inline', () => {
    /* Focus mode hides siblings and grows the active field from classes, and an
       inline declaration silently outranks both.

       Measured before this was fixed: the media type and position fields sat in
       a wrapper carrying `style="display: grid"` and stayed on screen in focus
       mode, while the media-URL block right beside them — same section, no inline
       style — disappeared as intended. One rule, two outcomes, no error. */
    for (const open of [openReading, openChoice]) {
        open();
        for (const group of ['general', 'content', 'options', 'answer']) {
            const tab = document.querySelector(`[data-group="${group}"]`);
            if (!tab) continue;
            tab.click();

            const offenders = [...document.querySelectorAll('#questionEditorOverlay [style]')]
                .filter(el => el.style.display || el.style.minHeight)
                .map(el => `${el.tagName}.${el.className || '(no class)'}: ${el.getAttribute('style')}`);

            assert.deepEqual(offenders, [], `inline layout in the ${group} tab`);
        }
    }
});

test('the stylesheet hides siblings off the focus classes, and spares the footer', () => {
    // Comments in this file explain the rules at length; strip them or the
    // scan matches its own documentation. See CLAUDE.md, "Statik tarama testi".
    const css = readFileSync(new URL('../src/features/stats/question-editor.css', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');

    assert.match(css, /is-focus-mode[^{]*\.editor-header[^{]*\{[^}]*display:\s*none/);
    assert.match(css, /is-focus-mode[^{]*\.editor-group-nav[^{]*\{[^}]*display:\s*none/);
    assert.match(css, /:not\(\.editor-focus-unit\):not\(\.editor-focus-path\)/,
        'siblings are hidden by class, and the ancestor chain is spared by class');
    assert.ok(!/is-focus-mode\s+\.editor-footer\s*\{[^}]*display:\s*none/.test(css),
        'the footer holds Save and the question arrows - hiding it makes the mode a trap');
});
