import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Mirrors the "$source" branch of the search filter in stats-module.js
function filterQuestionsBySourceScope(questions, searchKeyword) {
    const rawKw = searchKeyword.trim();
    if (!rawKw.startsWith('$')) return questions;
    const srcKw = rawKw.slice(1).trim().toLowerCase();
    if (srcKw === '') return questions;
    return questions.filter(q => {
        if (String(q.sourceId).toLowerCase() === srcKw) return true;
        return String(q.sourceName || '').toLowerCase().includes(srcKw);
    });
}

test('$ source search keeps only the questions of the named source', () => {
    const questions = [
        { id: 1, sourceId: 'src-a', sourceName: 'Matematik Deneme' },
        { id: 2, sourceId: 'src-b', sourceName: 'Tarih Deneme' },
        { id: 3, sourceId: 'src-a', sourceName: 'Matematik Deneme' }
    ];

    assert.deepEqual(
        filterQuestionsBySourceScope(questions, '$Matematik Deneme').map(q => q.id),
        [1, 3]
    );
    assert.deepEqual(
        filterQuestionsBySourceScope(questions, '$tarih').map(q => q.id),
        [2]
    );
    // The source id works as well, so renames mid-session cannot break a link
    assert.deepEqual(
        filterQuestionsBySourceScope(questions, '$src-b').map(q => q.id),
        [2]
    );
    // A bare "$" is not a filter
    assert.deepEqual(
        filterQuestionsBySourceScope(questions, '$').map(q => q.id),
        [1, 2, 3]
    );
});

test('stats-module handles the $ prefix before the # prefix and pools only live sources', () => {
    const src = readFileSync(join(root, 'src/features/stats/stats-module.js'), 'utf8');
    assert.ok(src.includes("if (rawKw.startsWith('$'))"));
    assert.ok(src.includes("} else if (rawKw.startsWith('#'))"));
    // The question pool is built from liveSources(), so archived sources stay out
    // of the results even when the "all sources" toggle is on.
    assert.ok(src.includes('const sortedSources = liveSources()'));
    assert.ok(src.includes('export function inspectSourceQuestions'));
});

/* Including the "all" case. inspectSourceQuestions() builds `$Ad1 & Ad2` from
   the active sources, which is the scope the progress panel describes; the card
   used to hand-roll that branch instead, ticking the global toggle and asking
   for an unfiltered list, so "inspect the sources of my test" opened the whole
   library. Pinned by behaviour rather than by the variable name it is called
   with - the name has already drifted once while this test stayed green-looking
   and red. */
test('inspect buttons route through inspectSourceQuestions', () => {
    const continuity = readFileSync(join(root, 'src/features/stats/continuity-ui.js'), 'utf8');
    const sourcesUi = readFileSync(join(root, 'src/features/sources/sources-ui.js'), 'utf8');

    const handler = continuity.slice(
        continuity.indexOf('inspectBtn.onclick'),
        continuity.indexOf('inspectBtn.onclick') + 900
    );
    assert.match(handler, /inspectSourceQuestions\(/, 'the card must delegate to the shared entry point');
    assert.ok(!handler.includes('renderStatsList('),
        'no hand-rolled list rendering - that branch is what lost the source scope');
    assert.ok(!handler.includes('globalToggle'),
        'and no hand-rolled scope toggling either');

    assert.ok(sourcesUi.includes('inspectSourceQuestions(source.id)'));
});

test('inspect buttons no longer use the eye icon', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    const eyePath = 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z';
    const inspectBtn = html.slice(
        html.indexOf('id="diffCardInspectBtn"'),
        html.indexOf('id="diffCardInspectBtn"') + 800
    );
    assert.ok(!inspectBtn.includes(eyePath));
    const modalBtn = html.slice(
        html.indexOf('id="modalInspectQuestionsBtn"'),
        html.indexOf('id="modalInspectQuestionsLabel"')
    );
    assert.ok(!modalBtn.includes(eyePath));
});

test('search placeholder still advertises only the # tag format', () => {
    const i18nSource = readFileSync(join(root, 'src/core/i18n.js'), 'utf8');
    assert.ok(i18nSource.includes('search_label: "Ara... (#etiket)"'));
    assert.ok(!i18nSource.includes('$kaynak'));
});
