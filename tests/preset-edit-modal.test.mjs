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
    /* Not a literal bar. style.css carries a SECOND `.modal-overlay` rule, later
       in the file, that raises the default from 9999 to 10010, and
       #quickPresetsManageOverlay declares no z-index of its own - so it lands on
       that default. The first version of this modal used 10004 and was measured
       in Edge sitting UNDERNEATH the modal it opens from, with its Save button
       covered and nothing thrown. The rule is therefore "above whatever an
       overlay with no inline z-index gets", read from the stylesheet. */
    const css = read('../src/style.css');
    const defaults = [...css.matchAll(/\.modal-overlay[^{]*\{[^}]*?z-index:\s*(\d+)/g)].map(m => Number(m[1]));
    assert.ok(defaults.length > 0, 'no .modal-overlay z-index found to compare against');
    const effectiveDefault = defaults[defaults.length - 1]; // the last rule wins

    const src = html();
    const z = /id="presetEditOverlay"[^>]*z-index:\s*(\d+)/.exec(src);
    assert.ok(z, 'presetEditOverlay declares no z-index');
    const n = Number(z[1]);
    assert.ok(n > effectiveDefault,
        `${n} is not above the .modal-overlay default of ${effectiveDefault} - it would open behind the manage modal`);

    const confirm = /id="customModalOverlay"[^>]*z-index:\s*(\d+)/.exec(src);
    assert.ok(n < Number(confirm[1]), 'it would cover the shared confirm box');
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

// ── quick access from one source (#modalToggleQuickAccessBtn) ───────────────
/* The source actions dialog opens a list of every group with this source's
   membership as the toggle. It could join and leave groups but never START
   one, and leaving the last group's last source left an empty group behind. */

const sqp = () => import('../src/features/sources/quick-presets-ui.js');
const sqpRows = () => [...document.querySelectorAll('#sourceQuickPresetsList .sqp-preset-row')];
const flush = () => new Promise(r => setTimeout(r, 0));

async function openForSource(id, presets) {
    AppState.quickPresets = presets;
    const { showSourceQuickPresetsModal } = await sqp();
    showSourceQuickPresetsModal(AppState.sources.find(s => s.id === id));
}

test('the source dialog offers a new group, and it opens the editor with this source in it', async () => {
    await openForSource('s2', [{ id: 'p1', name: 'Other', sourceIds: ['s1'], order: 0 }]);
    const btn = document.getElementById('sqpNewPresetBtn');
    assert.ok(btn, 'no way to start a group from a source');
    btn.click();

    assert.ok(document.getElementById('presetEditOverlay').classList.contains('active'));
    assert.equal(document.getElementById('presetEditNameInput').value, 'Beta', 'named after the source');
    assert.equal(document.getElementById('presetEditCount').textContent,
        translations[AppState.language].qs_group_selected_count.replace('{count}', '1'),
        'the source is not preselected');
});

test('a new group is a draft: cancelling creates nothing, saving creates it', async () => {
    await openForSource('s2', [{ id: 'p1', name: 'Other', sourceIds: ['s1'], order: 0 }]);
    document.getElementById('sqpNewPresetBtn').click();
    document.getElementById('presetEditCancelBtn').click();
    assert.equal(AppState.quickPresets.length, 1, 'cancel left a group behind');

    document.getElementById('sqpNewPresetBtn').click();
    clickSource('s3');
    document.getElementById('presetEditSaveBtn').click();
    assert.equal(AppState.quickPresets.length, 2);
    const created = AppState.quickPresets[1];
    assert.equal(created.name, 'Beta');
    assert.deepEqual([...created.sourceIds].sort(), ['s2', 's3']);
    assert.ok(created.updatedAt > 0, 'unstamped: the merge would not carry it');
    // and the list behind it shows the new group, with this source ticked
    const row = sqpRows().find(r => r.dataset.presetId === created.id);
    assert.ok(row && row.classList.contains('active'));
});

test('a new group does not take a name that is already there', async () => {
    await openForSource('s2', [{ id: 'p1', name: 'Beta', sourceIds: ['s1'], order: 0 }]);
    document.getElementById('sqpNewPresetBtn').click();
    assert.equal(document.getElementById('presetEditNameInput').value, 'Beta (2)');
});

test('a group with exactly the sources of another one is refused', async () => {
    await openForSource('s2', [{ id: 'p1', name: 'Solo', sourceIds: ['s2'], order: 0 }]);
    document.getElementById('sqpNewPresetBtn').click();
    document.getElementById('presetEditSaveBtn').click();
    assert.equal(AppState.quickPresets.length, 1, 'a duplicate group was saved');
    assert.ok(document.getElementById('presetEditOverlay').classList.contains('active'), 'the editor closed on a refusal');
    document.getElementById('presetEditCancelBtn').click();
});

test('taking the last source out asks, and removes the group only on yes', async () => {
    await openForSource('s1', [{ id: 'p1', name: 'Only', sourceIds: ['s1'], order: 0 }]);

    sqpRows()[0].click();
    await flush();
    assert.ok(document.getElementById('customModalOverlay').classList.contains('active'), 'no question asked');
    document.getElementById('modalCancelBtn').click();
    await flush();
    assert.deepEqual(AppState.quickPresets.map(p => p.sourceIds), [['s1']], 'no must leave the group as it was');

    sqpRows()[0].click();
    await flush();
    document.getElementById('modalConfirmBtn').click();
    await flush();
    assert.equal(AppState.quickPresets.length, 0, 'an empty group was left behind');
    assert.ok(AppState.deletedQuickPresetIds.includes('p1'), 'no tombstone: the next pull brings it back');
});

test('a row shows the question count and its pencil opens the group editor', async () => {
    await openForSource('s1', [{ id: 'p1', name: 'Pair', sourceIds: ['s1', 's2'], order: 0 }]);
    const row = sqpRows()[0];
    assert.equal(row.querySelector('.qs-count').textContent, '4');
    row.querySelector('.sqp-edit-btn').click();
    assert.ok(document.getElementById('presetEditOverlay').classList.contains('active'));
    assert.deepEqual([...AppState.quickPresets[0].sourceIds], ['s1', 's2'], 'the pencil must not toggle membership');
    document.getElementById('presetEditCancelBtn').click();
});

test('the source dialog sits under the group editor it opens', () => {
    const src = html();
    const z = (id) => Number((new RegExp(`id="${id}"[^>]*z-index:\\s*(\\d+)`).exec(src) || [])[1]);
    assert.ok(z('sourceQuickPresetsOverlay') < z('presetEditOverlay'), 'the editor would open underneath');
});

test('the new strings are in all three languages', () => {
    ['qs_group_created', 'qs_new_with_source', 'qs_remove_last_confirm'].forEach(key => {
        ['tr', 'en', 'de'].forEach(lang => assert.ok(translations[lang][key], `${lang}.${key} is missing`));
    });
});
