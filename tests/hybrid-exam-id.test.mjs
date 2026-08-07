import test, { before } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

let slugify, generateHybridExamId, processJSON, migrateExamIds, AppState;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    ({ slugify, generateHybridExamId, processJSON } = await import('../src/features/sources/sources-service.js'));
    ({ migrateExamIds } = await import('../src/core/migration.js'));
    ({ AppState } = await import('../src/core/state.js'));
});

test('slugify converts special characters to clean snake_case', () => {
    assert.strictEqual(slugify('03. Systemhaus & Support Praxis'), '03_systemhaus_support_praxis');
    assert.strictEqual(slugify('Başlangıç — Soru Tipleri'), 'baslangic_soru_tipleri');
    assert.strictEqual(slugify('Erste Schritte — Fragetypen'), 'erste_schritte_fragetypen');
});

test('generateHybridExamId creates hybrid format or preserves existing ID', () => {
    const title = '03. Systemhaus & Support Praxis';
    const id1 = generateHybridExamId(title);
    assert.match(id1, /^exam_03_systemhaus_support_praxis_[a-z0-9]+_[a-z0-9]+$/);

    const preserved = generateHybridExamId(title, 'exam_custom_id_123');
    assert.strictEqual(preserved, 'exam_custom_id_123');
});

test('processJSON preserves existing exam_metadata.id or generates hybrid ID', () => {
    const rawWithId = {
        exam_metadata: { title: 'Test Exam', id: 'exam_existing_999' },
        questions: [{ id: 'q1', type: 'single_choice', options: ['A'], answer: { correct_ids: ['A'] } }]
    };
    const s1 = processJSON(rawWithId, 'Test File 1', { silent: true });
    assert.strictEqual(s1.id, 'exam_existing_999');
    assert.strictEqual(s1.metadata.id, 'exam_existing_999');

    const rawWithoutId = {
        exam_metadata: { title: 'New Exam' },
        questions: [{ id: 'q2', type: 'single_choice', options: ['B'], answer: { correct_ids: ['B'] } }]
    };
    const s2 = processJSON(rawWithoutId, 'Test File 2', { silent: true });
    assert.match(s2.id, /^exam_new_exam_/);
    assert.strictEqual(s2.metadata.id, s2.id);
});

test('migrateExamIds is idempotent and preserves existing IDs', () => {
    AppState.sources = [
        { name: 'Source A', id: 'exam_fixed_1', metadata: { id: 'exam_fixed_1' } },
        { name: 'Source B', metadata: {} } // missing id
    ];

    const firstRunChanges = migrateExamIds();
    assert.ok(firstRunChanges > 0);
    assert.strictEqual(AppState.sources[0].id, 'exam_fixed_1');
    assert.match(AppState.sources[1].id, /^exam_source_b_/);
    assert.strictEqual(AppState.sources[1].metadata.id, AppState.sources[1].id);

    const secondRunChanges = migrateExamIds();
    assert.strictEqual(secondRunChanges, 0); // No changes on second run
});
