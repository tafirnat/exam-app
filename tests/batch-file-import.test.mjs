import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

let AppState, initState, createUncategorizedFolderRecord;
let loadFromFile, loadFromFiles, processJSON;

class MockFileReader {
    readAsText(blob) {
        setTimeout(() => {
            if (blob._shouldFail) {
                if (this.onerror) this.onerror(new Error('Failed to read'));
            } else {
                this.result = blob._text !== undefined ? blob._text : (blob.text ? blob.text : '');
                if (this.onload) this.onload({ target: { result: this.result } });
            }
        }, 5);
    }
}

function createFakeFile(name, content, shouldFail = false) {
    return {
        name,
        _text: typeof content === 'string' ? content : JSON.stringify(content),
        _shouldFail: shouldFail
    };
}

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    global.FileReader = MockFileReader;
    dom.window.FileReader = MockFileReader;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    ({ AppState, initState, createUncategorizedFolderRecord } = await import('../src/core/state.js'));
    ({ loadFromFile, loadFromFiles, processJSON } = await import('../src/features/sources/sources-service.js'));
});

beforeEach(() => {
    localStorage.clear();
    initState({ force: true });
    AppState.sources = [];
    AppState.folders = [createUncategorizedFolderRecord()];
});

test('index.html has input[type=file] with multiple and #fileDropZone', () => {
    const htmlPath = path.resolve('index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(html.includes('id="fileInput" accept=".json" multiple') || html.includes('id="fileInput" multiple accept=".json"'),
        'fileInput must have multiple attribute');
    assert.ok(html.includes('id="fileDropZone"'), 'fileDropZone must exist in index.html');
});

test('loadFromFiles with empty input returns empty arrays', async () => {
    const res1 = await loadFromFiles([]);
    assert.deepEqual(res1, { sources: [], failed: [] });

    const res2 = await loadFromFiles(null);
    assert.deepEqual(res2, { sources: [], failed: [] });
});

test('loadFromFiles with a single valid file behaves like single import', async () => {
    const file = createFakeFile('single.json', {
        exam_metadata: { title: 'Single Exam' },
        questions: [
            { id: 'q1', type: 'single_choice', content: { text: 'Q1' }, options: [{ text: 'O1', isCorrect: true }] }
        ]
    });

    const result = await loadFromFiles([file], { silent: true });
    assert.equal(result.sources.length, 1);
    assert.equal(result.failed.length, 0);
    assert.equal(result.sources[0].name, 'Single Exam');
    assert.equal(AppState.sources.length, 1);
});

test('loadFromFiles with multiple valid files loads all into AppState and preserves questions', async () => {
    const file1 = createFakeFile('exam1.json', {
        exam_metadata: { title: 'Exam 1' },
        questions: [
            { id: 'q1', type: 'single_choice', content: { text: 'Q1' }, options: [{ text: 'A', isCorrect: true }] }
        ]
    });

    const file2 = createFakeFile('exam2.json', {
        exam_metadata: { title: 'Exam 2' },
        questions: [
            { id: 'q2', type: 'single_choice', content: { text: 'Q2' }, options: [{ text: 'B', isCorrect: true }] },
            { id: 'q3', type: 'single_choice', content: { text: 'Q3' }, options: [{ text: 'C', isCorrect: true }] }
        ]
    });

    const file3 = createFakeFile('exam3.json', {
        exam_metadata: { title: 'Exam 3' },
        questions: [
            { id: 'q4', type: 'single_choice', content: { text: 'Q4' }, options: [{ text: 'D', isCorrect: true }] }
        ]
    });

    const result = await loadFromFiles([file1, file2, file3], { silent: true });
    assert.equal(result.sources.length, 3);
    assert.equal(result.failed.length, 0);
    assert.equal(AppState.sources.length, 3);

    const names = AppState.sources.map(s => s.name);
    assert.ok(names.includes('Exam 1'));
    assert.ok(names.includes('Exam 2'));
    assert.ok(names.includes('Exam 3'));

    const totalQuestions = AppState.sources.reduce((acc, s) => acc + s.questions.length, 0);
    assert.equal(totalQuestions, 4);
});

test('loadFromFiles with mixed valid and invalid files imports valid ones and reports failed ones', async () => {
    const validFile = createFakeFile('good.json', {
        exam_metadata: { title: 'Good Exam' },
        questions: [
            { id: 'q1', type: 'single_choice', content: { text: 'Good Q' }, options: [{ text: 'OK', isCorrect: true }] }
        ]
    });

    const corruptJsonFile = createFakeFile('bad.json', '{ corrupted json ...');
    const invalidSchemaFile = createFakeFile('empty_questions.json', { questions: [] });

    const result = await loadFromFiles([validFile, corruptJsonFile, invalidSchemaFile], { silent: true });

    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].name, 'Good Exam');
    assert.equal(AppState.sources.length, 1);

    assert.equal(result.failed.length, 2);
    assert.equal(result.failed[0].file, 'bad.json');
    assert.equal(result.failed[1].file, 'empty_questions.json');
});

test('loadFromFiles with all invalid files loads zero sources and lists all failures', async () => {
    const corrupt1 = createFakeFile('bad1.json', '{ bad');
    const corrupt2 = createFakeFile('bad2.json', '{ also bad');

    const result = await loadFromFiles([corrupt1, corrupt2], { silent: true });
    assert.equal(result.sources.length, 0);
    assert.equal(result.failed.length, 2);
    assert.equal(AppState.sources.length, 0);
});
