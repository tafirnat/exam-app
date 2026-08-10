import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

/* The prompt library. One template answered one question - "explain the correct
   solution" - and the three things the user actually wants from an external AI
   (check this question, teach me this topic, grade my open answer) each need a
   different instruction and different variables.

   Two halves are load-bearing and neither is obvious from the feature:

   - The library is a *list*, so it merges by id with tombstones. A list carried
     as one synced setting loses a prompt whenever two devices each add one -
     the value ranks by stamp and the loser's whole list goes.
   - The standard prompt is NOT in the list. It resolves through customAIPrompt
     and, when that is empty, through the translations - which is what keeps it
     following the app language and what makes "cannot be deleted" true by
     construction rather than by a guard someone can remove.

   And the formatter: a variable with nothing behind it takes its line with it,
   because the open-ended questions this feature exists for have no options at
   all and the old formatter printed "Options: Text response" in their place. */

let AppState, initState, saveAiPrompts, trackDeletedAiPrompt, saveActivePromptId,
    saveAdhocPrompt, saveCustomAIPrompt, SYNCED_SETTINGS, clearProgressData, clearLocalStudyData;
let mergeSyncData, getSyncPayload;
let listPrompts, resolveActivePrompt, fillTemplate, buildPromptVars, buildQuestionAnswerText,
    defaultPromptBody, insertVariableAt, DEFAULT_PROMPT_ID, ADHOC_PROMPT_ID, PROMPT_VARIABLES;
let seedAiPrompts;
let translations;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    ({
        AppState, initState, saveAiPrompts, trackDeletedAiPrompt, saveActivePromptId,
        saveAdhocPrompt, saveCustomAIPrompt, SYNCED_SETTINGS, clearProgressData, clearLocalStudyData
    } = await import('../src/core/state.js'));
    ({ mergeSyncData, getSyncPayload } = await import('../src/core/github-sync.js'));
    ({
        listPrompts, resolveActivePrompt, fillTemplate, buildPromptVars, buildQuestionAnswerText,
        defaultPromptBody, insertVariableAt, DEFAULT_PROMPT_ID, ADHOC_PROMPT_ID, PROMPT_VARIABLES
    } = await import('../src/core/ai-prompts.js'));
    ({ seedAiPrompts } = await import('../src/core/migration.js'));
    ({ translations } = await import('../src/core/i18n.js'));
});

beforeEach(() => {
    localStorage.clear();
    AppState.aiPrompts = [];
    AppState.deletedAiPromptIds = [];
    AppState.activePromptId = 'default';
    AppState.adhocPrompt = '';
    AppState.customAIPrompt = '';
    AppState.language = 'en';
    AppState.deletedSourceIds = [];
    AppState.deletedFolderIds = [];
    AppState.deletedQuickPresetIds = [];
    AppState.sources = [];
    AppState.lastResetTimestamp = 0;
    AppState.lastProgressResetTimestamp = 0;
});

/** A record as the library stores one. */
function prompt(id, title, body, at = 1000) {
    return { id, title, body, createdAt: at, updatedAt: at };
}

/** A sync payload carrying nothing but what these cases weigh. */
function payload(over = {}) {
    return {
        sources: [], folders: [], quickPresets: [], aiPrompts: [],
        deletedSourceIds: [], deletedFolderIds: [], deletedQuickPresetIds: [],
        deletedAiPromptIds: [],
        stats: {}, recentTests: [], studyActivity: {}, continuityConfig: {},
        lastResetTimestamp: 0, lastProgressResetTimestamp: 0, lastUpdated: 0,
        ...over
    };
}

// ── The standard prompt ─────────────────────────────────────────────────────

test('the standard prompt is not a record, so there is nothing to delete', () => {
    AppState.aiPrompts = [prompt('p1', 'Mine', 'body')];

    const all = listPrompts();
    assert.equal(all[0].id, DEFAULT_PROMPT_ID);
    assert.equal(all[0].builtin, true);

    /* The guarantee is structural: the standard prompt is absent from the
       stored list, so no delete can name it. A `builtin` flag on a stored
       record would only be as good as the check that reads it. */
    assert.equal(AppState.aiPrompts.some(p => p.id === DEFAULT_PROMPT_ID), false);
});

test('an un-overridden standard prompt follows the app language', () => {
    AppState.language = 'de';
    assert.equal(defaultPromptBody(), translations.de.ai_prompt_template);

    AppState.language = 'tr';
    assert.equal(defaultPromptBody(), translations.tr.ai_prompt_template);

    /* A stored copy would have frozen in whichever language it was seeded in.
       This is the whole reason the standard prompt stays virtual. */
    AppState.customAIPrompt = 'my own wording';
    assert.equal(defaultPromptBody(), 'my own wording');
});

test('an unknown language falls back rather than showing a key', () => {
    AppState.language = 'fr';
    assert.equal(defaultPromptBody(), translations.en.ai_prompt_template);
});

// ── Selection ───────────────────────────────────────────────────────────────

test('the selection is a synced setting', () => {
    assert.ok(SYNCED_SETTINGS.includes('activePromptId'));

    initState({ force: true });
    AppState.activePromptId = 'p1';
    saveActivePromptId();
    assert.equal(localStorage.getItem('focus_app_active_prompt_id'), 'p1');
    // Stamped, or the merge has nothing to rank the two devices' choices by.
    assert.ok(AppState.settingsRevisions.activePromptId?.at > 0);
});

test('a selection naming a deleted prompt falls back to the standard one', () => {
    AppState.aiPrompts = [prompt('p1', 'Mine', 'body')];
    AppState.activePromptId = 'p1';
    assert.equal(resolveActivePrompt().id, 'p1');

    /* The selection syncs, so it outlives the prompt it names: another device
       deletes the record and this one is left pointing at nothing. Sending the
       question with the standard prompt beats an error about a record the user
       never saw. */
    AppState.aiPrompts = [];
    assert.equal(resolveActivePrompt().id, DEFAULT_PROMPT_ID);
});

// ── The one-off prompt ──────────────────────────────────────────────────────

test('the ad-hoc prompt never enters the sync payload', () => {
    AppState.adhocPrompt = 'just for this question';
    saveAdhocPrompt();

    const sent = getSyncPayload();
    assert.equal('adhocPrompt' in sent, false);
    assert.equal(JSON.stringify(sent).includes('just for this question'), false);
});

test('the ad-hoc prompt is not a synced setting either', () => {
    /* The other route it could leak by: SYNCED_SETTINGS travels inside the
       payload's `settings`, so a key added there would sync without ever
       appearing as a top-level field. */
    assert.equal(SYNCED_SETTINGS.includes('adhocPrompt'), false);
});

test('the ad-hoc prompt is selectable while it lives', () => {
    AppState.adhocPrompt = 'one-off';
    AppState.activePromptId = ADHOC_PROMPT_ID;

    const resolved = resolveActivePrompt();
    assert.equal(resolved.id, ADHOC_PROMPT_ID);
    assert.equal(resolved.body, 'one-off');

    // Cleared, it stops being offered at all rather than resolving to nothing.
    AppState.adhocPrompt = '';
    assert.equal(listPrompts().some(p => p.id === ADHOC_PROMPT_ID), false);
    assert.equal(resolveActivePrompt().id, DEFAULT_PROMPT_ID);
});

test('a blank ad-hoc prompt is not an entry', () => {
    AppState.adhocPrompt = '   ';
    assert.equal(listPrompts().some(p => p.id === ADHOC_PROMPT_ID), false);
});

// ── Filling the template ────────────────────────────────────────────────────

test('a variable with no value takes its whole line with it', () => {
    const body = 'Question: {question}\nOptions: {options}\nMy answer: {answer}';
    const out = fillTemplate(body, { question: 'Explain the OSI model.', options: '', answer: '7 layers' });

    assert.equal(out, 'Question: Explain the OSI model.\nMy answer: 7 layers');
    /* Not merely an empty value: the label goes too. The old formatter wrote
       "Options: Text response" for a question that has no options, which told
       the AI nothing and read as a real option list. */
    assert.equal(out.includes('Options:'), false);
});

test('one filled variable keeps a line that has several', () => {
    const out = fillTemplate('Q: {question} — A: {answer}', { question: 'Why?', answer: '' });
    // Dropping would throw away the question, which the user can see is there.
    assert.ok(out.includes('Why?'));
});

test('text outside the known variables is left alone', () => {
    const out = fillTemplate('Reply as {"role":"tutor"} about {question}', { question: 'X' });
    assert.ok(out.includes('{"role":"tutor"}'));
    assert.ok(out.includes('about X'));
});

test('every variable the editor advertises is one the formatter substitutes', () => {
    /* The hint in the editor is built from PROMPT_VARIABLES, so a name listed
       there but not handled would be offered to the user and then printed
       literally into the prompt. */
    const body = PROMPT_VARIABLES.map(v => `${v}: {${v}}`).join('\n');
    const vars = Object.fromEntries(PROMPT_VARIABLES.map(v => [v, `val-${v}`]));
    const out = fillTemplate(body, vars);

    PROMPT_VARIABLES.forEach(v => {
        assert.ok(out.includes(`val-${v}`), `${v} was not substituted`);
        assert.equal(out.includes(`{${v}}`), false, `${v} survived as a placeholder`);
    });
});

// ── Inserting a variable from the hint ──────────────────────────────────────

test('a variable is inserted at the caret, not at the end', () => {
    const { value, caret } = insertVariableAt('Frage:  — bewerte das.', 'question', 7, 7);
    assert.equal(value, 'Frage: {question} — bewerte das.');
    // The caret follows the inserted name, so a second click carries on from there.
    assert.equal(caret, 'Frage: {question}'.length);
});

test('an untouched field appends rather than prepends', () => {
    /* selectionStart is 0 on a textarea nobody has focused, so this is the case
       the editor guards by putting the caret at the end when it opens - and the
       one that would otherwise write the name in front of the whole prompt. */
    const body = 'Bewerte meine Antwort.';
    const { value } = insertVariableAt(body, 'answer', body.length, body.length);
    assert.equal(value, 'Bewerte meine Antwort. {answer}');
});

test('a separator is added only where one is missing', () => {
    assert.equal(insertVariableAt('Frage:', 'question', 6).value, 'Frage: {question}');
    // Already spaced - a second space would show.
    assert.equal(insertVariableAt('Frage: ', 'question', 7).value, 'Frage: {question}');
    // A newline is a separator too.
    assert.equal(insertVariableAt('Frage:\n', 'question', 7).value, 'Frage:\n{question}');
    // Nothing before it at all.
    assert.equal(insertVariableAt('', 'question', 0).value, '{question}');
});

test('a selection is replaced rather than pushed aside', () => {
    const { value } = insertVariableAt('Frage: XXXX bewerten', 'question', 7, 11);
    assert.equal(value, 'Frage: {question} bewerten');
});

test('an out-of-range caret does not corrupt the body', () => {
    /* The body has to be longer than the negative offset, or the case passes
       for the wrong reason: String.slice reads a negative index as "from the
       end", and on a short string that happens to land on 0 anyway. Measured -
       with 'kurz' the clamp could be deleted and every case stayed green. */
    const body = 'Bewerte meine Antwort';
    assert.equal(insertVariableAt(body, 'question', 999).value, `${body} {question}`);
    assert.equal(insertVariableAt(body, 'question', -5).value, `{question}${body}`);
});

test('a backwards selection does not duplicate what it spans', () => {
    // start > end, which is what a drag from right to left reports.
    const { value } = insertVariableAt('Frage: XXXX bewerten', 'question', 11, 7);
    assert.equal(value, 'Frage: XXXX {question} bewerten');
});

// ── Building the variables ──────────────────────────────────────────────────

const choiceQuestion = () => ({
    id: 'q1', sourceId: 's1', type: 'single_choice',
    content: { text: 'Which layer routes packets?' },
    options: [{ id: 'a', text: 'Data link' }, { id: 'b', text: 'Network' }],
    answer: { correct_ids: ['b'] }
});

const openQuestion = () => ({
    id: 'q2', sourceId: 's1', type: 'short_answer',
    content: { text: 'Explain the OSI model.' },
    answer: { accepted_texts: ['Seven layers, from physical to application.'] }
});

test('a choice question resolves options, the marked answer and the user pick', () => {
    const vars = buildPromptVars(choiceQuestion(), { userAnswer: ['a'], sourceName: 'Networking' });
    assert.equal(vars.options, 'Data link, Network');
    assert.equal(vars.correct, 'Network');
    assert.equal(vars.answer, 'Data link');
    assert.equal(vars.source, 'Networking');
});

test('an open-ended question carries the typed answer and no options at all', () => {
    const vars = buildPromptVars(openQuestion(), { userAnswer: ['The OSI model has 7 layers…'] });

    /* This is the case the whole feature turns on: "evaluate my answer" is
       impossible unless the answer reaches the prompt, and the question has no
       options to speak of. */
    assert.equal(vars.answer, 'The OSI model has 7 layers…');
    assert.equal(vars.correct, 'Seven layers, from physical to application.');
    assert.equal(vars.options, '');

    const out = fillTemplate('Q: {question}\nOptions: {options}\nMine: {answer}', vars);
    assert.equal(out, 'Q: Explain the OSI model.\nMine: The OSI model has 7 layers…');
});

test('an unanswered question yields no answer rather than an empty label', () => {
    const vars = buildPromptVars(openQuestion(), { userAnswer: null });
    assert.equal(vars.answer, '');
    assert.equal(fillTemplate('Mine: {answer}', vars), '');
});

// ── The copy payload ────────────────────────────────────────────────────────

/* The AI menu ends in two actions and they carry different things: share hands
   out the *prompt* (instruction, options, the user's own answer), copy takes
   the question and its answer and nothing else. Copying used to take the
   question text alone, which left the answer to be looked up again wherever the
   text landed. */

const unmarkedOpenQuestion = () => ({
    id: 'q3', sourceId: 's1', type: 'short_answer',
    content: { text: 'Describe your own study routine.' }
});

test('copying takes the question with its answer, and nothing else', () => {
    const text = buildQuestionAnswerText(choiceQuestion());

    assert.ok(text.includes('Which layer routes packets?'));
    assert.ok(text.includes(`${translations.en.correct_answer}: Network`));

    /* The option list is the prompt's business. 'Data link' is an option and
       not the answer, so its absence is what says the two payloads stayed
       apart - a copy that quietly became the prompt would carry it. */
    assert.ok(!text.includes('Data link'));
});

test('an open-ended question with no marked answer copies the question alone', () => {
    const text = buildQuestionAnswerText(unmarkedOpenQuestion());

    /* Nothing to copy as the answer - the user writes it themselves. A bare
       "Correct Answer:" reads as an answer that went missing, which is the same
       reason fillTemplate drops a line whose variables came up empty. */
    assert.equal(text, 'Describe your own study routine.');
    assert.ok(!text.includes(translations.en.correct_answer));
});

test('the copy label follows the app language', () => {
    AppState.language = 'de';
    const text = buildQuestionAnswerText(choiceQuestion());
    assert.ok(text.includes(`${translations.de.correct_answer}: Network`));
});

test('a question with no text copies nothing', () => {
    assert.equal(buildQuestionAnswerText(null), '');
    assert.equal(buildQuestionAnswerText({ id: 'q4', type: 'single_choice', content: {} }), '');
});

// ── Merge ───────────────────────────────────────────────────────────────────

test('two devices each adding a prompt end up with both', () => {
    /* The reason the library is not a synced setting. A stamped scalar ranks
       the two lists and keeps one, so whichever device pushed second would
       silently lose the other's prompt. */
    const local = payload({ aiPrompts: [prompt('p-local', 'Local', 'L')] });
    const remote = payload({ aiPrompts: [prompt('p-remote', 'Remote', 'R')] });

    const merged = mergeSyncData(local, remote);
    const ids = merged.aiPrompts.map(p => p.id).sort();
    assert.deepEqual(ids, ['p-local', 'p-remote']);
    assert.equal(merged.hasLocalChanges, true);
});

test('the newer edit of the same prompt wins', () => {
    const local = payload({ aiPrompts: [prompt('p1', 'New title', 'new body', 2000)] });
    const remote = payload({ aiPrompts: [prompt('p1', 'Old title', 'old body', 1000)] });

    assert.equal(mergeSyncData(local, remote).aiPrompts[0].body, 'new body');
    // And the other way round, so the case is not passing on local's account.
    const back = mergeSyncData(
        payload({ aiPrompts: [prompt('p1', 'Old', 'old body', 1000)] }),
        payload({ aiPrompts: [prompt('p1', 'New', 'new body', 2000)] })
    );
    assert.equal(back.aiPrompts[0].body, 'new body');
});

test('a deleted prompt is not resurrected by a device that still has it', () => {
    const local = payload({ aiPrompts: [], deletedAiPromptIds: ['p1'] });
    const remote = payload({ aiPrompts: [prompt('p1', 'Gone', 'body')] });

    const merged = mergeSyncData(local, remote);
    assert.deepEqual(merged.aiPrompts, []);
    assert.ok(merged.deletedAiPromptIds.includes('p1'));
});

test('a deletion learned from the remote is applied locally', () => {
    const local = payload({ aiPrompts: [prompt('p1', 'Still here', 'body')] });
    const remote = payload({ aiPrompts: [], deletedAiPromptIds: ['p1'] });

    assert.deepEqual(mergeSyncData(local, remote).aiPrompts, []);
});

test('tracking a deletion writes the tombstone through storage', () => {
    initState({ force: true });
    trackDeletedAiPrompt('p1');
    assert.deepEqual(JSON.parse(localStorage.getItem('focus_app_deleted_ai_prompts')), ['p1']);

    // Idempotent - a second delete of the same id must not grow the list.
    trackDeletedAiPrompt('p1');
    assert.equal(AppState.deletedAiPromptIds.length, 1);
});

// ── Resets ──────────────────────────────────────────────────────────────────

test('a progress reset leaves the prompt library alone', () => {
    initState({ force: true });
    AppState.aiPrompts = [prompt('p1', 'Mine', 'body')];
    saveAiPrompts();

    clearProgressData();

    /* A prompt is a tool the user wrote, not a record of what they studied.
       The library sits next to quickPresets in the payload and has its shape,
       which makes it the obvious thing to sweep in alongside. */
    assert.equal(AppState.aiPrompts.length, 1);
    assert.equal(AppState.aiPrompts[0].id, 'p1');
});

test('a factory reset leaves the prompt library alone too', () => {
    initState({ force: true });
    AppState.aiPrompts = [prompt('p1', 'Mine', 'body')];
    saveAiPrompts();

    clearLocalStudyData();
    assert.equal(AppState.aiPrompts.length, 1);
});

test('a reset on one device does not delete the other devices prompts', () => {
    /* The merge-side half of the same rule. Quick presets drop the remote side
       when the local reset is newer; doing that here would make clearing this
       device's progress delete prompts written on the other two. */
    const local = payload({ aiPrompts: [], lastResetTimestamp: 9999 });
    const remote = payload({ aiPrompts: [prompt('p1', 'Theirs', 'body')], lastUpdated: 100 });

    const merged = mergeSyncData(local, remote);
    assert.equal(merged.aiPrompts.length, 1);
    // The same payload must still drop the quick preset, or the case proves nothing.
    const withPreset = mergeSyncData(local, payload({
        quickPresets: [{ id: 'qp1', name: 'Theirs', sourceIds: [] }], lastUpdated: 100
    }));
    assert.deepEqual(withPreset.quickPresets, []);
});

// ── Seeding ─────────────────────────────────────────────────────────────────

test('the starter prompts are seeded once, in the reader language', () => {
    initState({ force: true });
    AppState.language = 'de';
    AppState.aiPrompts = [];

    const added = seedAiPrompts(key => translations.de[key]);
    assert.equal(added, 3);
    assert.equal(AppState.aiPrompts.length, 3);
    assert.equal(AppState.aiPrompts[0].title, translations.de.seed_verify_title);

    // A second boot must not add them again.
    assert.equal(seedAiPrompts(key => translations.de[key]), 0);
    assert.equal(AppState.aiPrompts.length, 3);
});

test('a deleted starter prompt is not seeded back', () => {
    initState({ force: true });
    AppState.aiPrompts = [];
    AppState.deletedAiPromptIds = ['seed-explain'];

    seedAiPrompts(key => translations.en[key]);

    /* A device that pulls the deletion before it has ever seeded would
       otherwise re-create the prompt and push it back at the device that
       deleted it - the tombstone loop sources and presets already avoid. */
    assert.deepEqual(AppState.aiPrompts.map(p => p.id).sort(), ['seed-evaluate', 'seed-verify']);
});

test('the starter prompts carry fixed ids so three devices seed the same three', () => {
    initState({ force: true });
    AppState.aiPrompts = [];
    seedAiPrompts(key => translations.en[key]);
    const first = AppState.aiPrompts.map(p => p.id);

    // A second device, seeding independently against an empty library.
    localStorage.removeItem('focus_app_ai_prompts_seeded');
    AppState.aiPrompts = [];
    seedAiPrompts(key => translations.en[key]);
    const second = AppState.aiPrompts.map(p => p.id);

    /* Ids generated per device would merge into three copies of each prompt -
       the merge is by id and has no way to see two records as one. */
    assert.deepEqual(first, second);
});

test('the starter prompts use the variables they need', () => {
    // "Evaluate my answer" is the reason {answer} exists. A seeded prompt that
    // forgot it would ship the feature's headline case broken.
    assert.ok(translations.en.seed_evaluate_body.includes('{answer}'));
    assert.ok(translations.tr.seed_evaluate_body.includes('{answer}'));
    assert.ok(translations.de.seed_evaluate_body.includes('{answer}'));
});

// ── i18n ────────────────────────────────────────────────────────────────────

test('both AI menus carry the two actions, and both are bound', () => {
    /* The menu exists twice - the test screen and the stats preview - and the
       twins are bound in two separate blocks of main.js. Adding a control to
       one and not the other is the standing failure mode here; so is leaving a
       button in the markup with no handler, which reads as a dead button and
       throws nothing. */
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    const main = readFileSync(join(root, 'src/main.js'), 'utf8');

    ['aiCopyQaBtn', 'aiSharePromptBtn', 'previewAiCopyQaBtn', 'previewAiSharePromptBtn'].forEach(id => {
        assert.ok(html.includes(`id="${id}"`), `${id} missing from index.html`);
        assert.ok(
            new RegExp(`getElementById\\('${id}'\\)\\.onclick`).test(main),
            `${id} has no handler`
        );
    });

    ['copy_question_answer', 'share_prompt', 'share_short'].forEach(key => {
        ['tr', 'en', 'de'].forEach(lang => assert.ok(translations[lang][key], `${key} missing in ${lang}`));
    });

    /* Both tooltips exist twice - once per menu. */
    ['copy_question_answer', 'share_prompt'].forEach(key => {
        assert.equal((html.match(new RegExp(`data-i18n-title="${key}"`, 'g')) || []).length, 2);
    });

    const button = (id) => {
        const m = html.match(new RegExp(`<button[^>]*id="${id}"[\\s\\S]*?</button>`));
        assert.ok(m, `${id} markup not found`);
        return m[0];
    };

    ['aiCopyQaBtn', 'previewAiCopyQaBtn'].forEach(id => {
        const markup = button(id);
        /* Wordless by design: the icon is the universal one and the tooltip is
           its only text. A label here would also unbalance the row, which
           carries its hierarchy in width and tone rather than in size. */
        assert.ok(!/data-i18n=/.test(markup), `${id} must carry no label`);
        assert.ok(!/<span/.test(markup), `${id} must carry no label`);
        /* The two-sheet copy glyph the app already uses (#copyMotivationBtn and
           the two share dialogs), not the clipboard it started with. */
        assert.ok(markup.includes('rect x="9" y="9" width="13" height="13"'), `${id} uses the wrong glyph`);
    });

    ['aiSharePromptBtn', 'previewAiSharePromptBtn'].forEach(id => {
        assert.ok(button(id).includes('data-i18n="share_short"'), `${id} must carry the one-word label`);
    });

    /* One word. The row has ~192px and the icon takes part of it. */
    ['tr', 'en', 'de'].forEach(lang => {
        assert.ok(!translations[lang].share_short.includes(' '), `share_short is not one word in ${lang}`);
    });
});

test('sharing hands out the prompt, copying does not', () => {
    /* The whole point of the split. Pointing share at the question text would
       ship the AI half of the menu broken - an external AI asked to check a
       question it cannot see the options of - and nothing would throw. */
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const main = readFileSync(join(root, 'src/main.js'), 'utf8');

    const share = main.match(/function sharePrompt\([^)]*\)\s*\{[\s\S]*?\n\}/);
    assert.ok(share, 'sharePrompt not found');
    assert.ok(share[0].includes('getFormattedPrompt('), 'share must send the formatted prompt');
    assert.ok(share[0].includes('navigator.share'), 'share must reach the OS share sheet');

    const copy = main.match(/function copyQuestionAndAnswer\([^)]*\)\s*\{[\s\S]*?\n\}/);
    assert.ok(copy, 'copyQuestionAndAnswer not found');
    assert.ok(copy[0].includes('buildQuestionAnswerText('), 'copy must send question and answer');
    assert.ok(!copy[0].includes('getFormattedPrompt('), 'copy must not send the prompt');
});

test('every prompt string exists in all three languages', () => {
    /* Hardcoded Turkish has shipped into the German UI before (see CLAUDE.md
       (27)), and these strings were all written in one pass. */
    const keys = Object.keys(translations.tr).filter(k => k.startsWith('prompt_') || k.startsWith('seed_'));
    assert.ok(keys.length >= 20, 'expected the prompt strings to be present');

    ['en', 'de'].forEach(lang => {
        keys.forEach(key => {
            assert.ok(translations[lang][key], `${key} missing in ${lang}`);
        });
    });
});
