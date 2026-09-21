import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let AppState, initState, openPresetEditModal, translations, UNCATEGORIZED_FOLDER_ID;

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const html = () => read('../index.html');

before(async () => {
    const dom = new JSDOM(html(), { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    const stateMod = await import('../src/core/state.js');
    AppState = stateMod.AppState;
    initState = stateMod.initState;
    UNCATEGORIZED_FOLDER_ID = stateMod.UNCATEGORIZED_FOLDER_ID;
    initState();

    ({ openPresetEditModal } = await import('../src/features/sources/quick-presets-ui.js'));
    ({ translations } = await import('../src/core/i18n.js'));
});

const sourceWith = (id, name, count = 2) => ({
    id, name, active: false, archived: false, folderId: null,
    questions: Array.from({ length: count }, (_, i) => ({ id: `q${i}`, type: 'flashcard', text: 'x' }))
});

beforeEach(() => {
    AppState.sources = [sourceWith('s1', 'Alpha'), sourceWith('s2', 'Beta'), sourceWith('s3', 'Gamma'), sourceWith('s4', 'Delta')];
    /* The picker groups by folder, so a library with no folders draws nothing.
       Every real install has the uncategorized one - migration.js makes it. */
    AppState.folders = [{ id: UNCATEGORIZED_FOLDER_ID, name: 'Uncategorized', isSystem: true, order: 0 }];
    AppState.quickPresets = [];
    document.getElementById('presetEditOverlay').classList.remove('active');
});

const open = (preset) => {
    AppState.quickPresets = [preset];
    openPresetEditModal(preset);
    return document.getElementById('presetEditOverlay');
};

const clickSource = (id) => {
    const row = document.querySelector(`#presetEditSourceList [data-source-id="${id}"]`);
    assert.ok(row, `no row for ${id} in the picker`);
    row.onclick();
};

// ── the modal opens with the group in it ────────────────────────────────────

test('the modal opens carrying the group name', () => {
    const overlay = open({ id: 'p1', name: 'Exam prep', sourceIds: ['s1'] });
    assert.ok(overlay.classList.contains('active'));
    assert.equal(document.getElementById('presetEditNameInput').value, 'Exam prep');
});

test('the sources already in the group come up selected', () => {
    open({ id: 'p1', name: 'g', sourceIds: ['s1', 's3'] });
    const selected = [...document.querySelectorAll('#presetEditSourceList .source-item.active')]
        .map(el => el.dataset.sourceId);
    assert.deepEqual(selected.sort(), ['s1', 's3']);
});

test('the count says how many are selected', () => {
    open({ id: 'p1', name: 'g', sourceIds: ['s1', 's2'] });
    assert.match(document.getElementById('presetEditCount').textContent, /2/);
});

// ── adding and removing ─────────────────────────────────────────────────────

test('a source can be added to the group from here', () => {
    const preset = { id: 'p1', name: 'g', sourceIds: ['s1'] };
    open(preset);
    clickSource('s2');
    document.getElementById('presetEditSaveBtn').onclick();
    assert.deepEqual(preset.sourceIds.sort(), ['s1', 's2']);
});

test('a selected source can be removed from the group from here', () => {
    const preset = { id: 'p1', name: 'g', sourceIds: ['s1', 's2'] };
    open(preset);
    clickSource('s1');
    document.getElementById('presetEditSaveBtn').onclick();
    assert.deepEqual(preset.sourceIds, ['s2']);
});

test('the group has no source ceiling - it is the user study set, not the focus three', () => {
    const preset = { id: 'p1', name: 'g', sourceIds: [] };
    open(preset);
    // Four, deliberately: the focus picker's ceiling is three, so a case that
    // stops at three passes whether the ceiling is there or not.
    ['s1', 's2', 's3', 's4'].forEach(clickSource);
    document.getElementById('presetEditSaveBtn').onclick();
    assert.equal(preset.sourceIds.length, 4, 'the fourth source was refused by a ceiling');
});

// ── renaming, which the button always did ───────────────────────────────────

test('renaming still works - it is what this button was for', () => {
    const preset = { id: 'p1', name: 'old', sourceIds: ['s1'] };
    open(preset);
    document.getElementById('presetEditNameInput').value = 'new name';
    document.getElementById('presetEditSaveBtn').onclick();
    assert.equal(preset.name, 'new name');
});

test('an empty name is refused rather than written', () => {
    const preset = { id: 'p1', name: 'keep me', sourceIds: ['s1'] };
    const overlay = open(preset);
    document.getElementById('presetEditNameInput').value = '   ';
    document.getElementById('presetEditSaveBtn').onclick();
    assert.equal(preset.name, 'keep me');
    assert.ok(overlay.classList.contains('active'), 'the modal closed on a refused save');
});

test('a group with no sources is refused - it would start an empty test', () => {
    const preset = { id: 'p1', name: 'g', sourceIds: ['s1'] };
    const overlay = open(preset);
    clickSource('s1');
    document.getElementById('presetEditSaveBtn').onclick();
    assert.deepEqual(preset.sourceIds, ['s1'], 'the group was emptied');
    assert.ok(overlay.classList.contains('active'));
});

// ── persistence and sync ────────────────────────────────────────────────────

test('a save stamps the preset, or the merge cannot see the edit', () => {
    // Quick presets merge by id on updatedAt. An unstamped change is one the
    // merge has no way to prefer, so the next pull writes over it.
    const preset = { id: 'p1', name: 'g', sourceIds: ['s1'], updatedAt: 1 };
    open(preset);
    clickSource('s2');
    document.getElementById('presetEditSaveBtn').onclick();
    assert.ok(preset.updatedAt > 1, 'the edit was not stamped');
});

test('cancel changes nothing', () => {
    const preset = { id: 'p1', name: 'g', sourceIds: ['s1'] };
    const overlay = open(preset);
    clickSource('s2');
    document.getElementById('presetEditNameInput').value = 'not saved';
    document.getElementById('presetEditCancelBtn').onclick();
    assert.equal(preset.name, 'g');
    assert.deepEqual(preset.sourceIds, ['s1']);
    assert.ok(!overlay.classList.contains('active'));
});

// ── the component it is built from ──────────────────────────────────────────

test('the picker is the shared one, not a second source list', () => {
    // A hand-rolled list here would drift from the focus picker: folders,
    // counts, folded-by-default and selected state all come from that one
    // component.
    const src = read('../src/features/sources/quick-presets-ui.js');
    assert.ok(/renderSourcePicker\(/.test(src), 'the modal builds its own list');
});

test('the edit button opens the modal rather than only renaming inline', () => {
    const src = read('../src/features/sources/quick-presets-ui.js');
    const btnBlock = src.slice(src.indexOf("editBtn.addEventListener"), src.indexOf("const deleteBtn"));
    assert.ok(/openPresetEditModal\(/.test(btnBlock), 'the pencil still only renames');
});

test('the overlay sits above the manage modal and below customModalOverlay', () => {
    // It opens on top of #quickPresetsManageOverlay, which takes the
    // .modal-overlay default of 9999; customModalOverlay must stay on top of
    // everything - see CLAUDE.md rule 6.
    const src = html();
    const z = /id="presetEditOverlay"[^>]*z-index:\s*(\d+)/.exec(src);
    assert.ok(z, 'presetEditOverlay declares no z-index');
    const n = Number(z[1]);
    assert.ok(n > 9999, 'it would open behind the modal it was opened from');
    assert.ok(n < 10100, 'it would cover the shared confirm box');
});

// ── the label in front of the focus source gear ─────────────────────────────

test('the focus source gear has a word in front of it', () => {
    const src = html();
    const row = src.slice(src.indexOf('<div class="continuity-icon-row">'), src.indexOf('id="focusContinuityInfoBtn"'));
    const labelAt = row.indexOf('data-i18n="focus_sources_label"');
    const btnAt = row.indexOf('id="openFocusSourceModalBtn"');
    assert.ok(labelAt !== -1, 'no label next to the source gear');
    assert.ok(labelAt < btnAt, 'the label has to come before the button it points at');
});

test('the label is a label - it does not steal the gear taps', () => {
    const css = read('../src/style.css');
    const rule = css.slice(css.indexOf('.continuity-icon-label {'));
    assert.ok(/pointer-events:\s*none/.test(rule.slice(0, 400)), 'a tap on the word would hit nothing');
});

test('every new string is in all three languages', () => {
    ['focus_sources_label', 'qs_edit_group_title', 'qs_group_name', 'qs_group_sources',
     'qs_group_selected_count', 'qs_group_saved', 'qs_group_name_required',
     'qs_group_needs_source', 'source_picker_max'].forEach(key => {
        ['tr', 'en', 'de'].forEach(lang => {
            assert.ok(translations[lang][key], `${lang}.${key} is missing`);
        });
    });
});

test('the picker limit message is translated rather than hard-coded Turkish', () => {
    const src = read('../src/features/sources/sources-ui.js');
    assert.ok(!/En fazla \$\{max\} kaynak/.test(src), 'the German build still says this in Turkish');
});
