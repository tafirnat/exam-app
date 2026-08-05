import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

test('importJSON extracts keepOrder from JSON root and exam_metadata', async () => {
    const dom = new JSDOM(indexHtml, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.navigator = dom.window.navigator;
    global.localStorage = dom.window.localStorage;
    global.crypto = dom.window.crypto;

    const { importJSON } = await import('../src/features/sources/sources-service.js');

    const jsonWithRootKeepOrder = {
        exam_metadata: { title: 'Test Root KeepOrder', id: 'src_root_order' },
        keepOrder: true,
        questions: [
            { id: 'q1', type: 'single_choice', content: { text: 'Q1' }, answer: { correctOptions: [0] } },
            { id: 'q2', type: 'single_choice', content: { text: 'Q2' }, answer: { correctOptions: [0] } }
        ]
    };

    const source1 = importJSON(jsonWithRootKeepOrder, { silent: true });
    assert.equal(source1.keepOrder, true);

    const jsonWithMetaKeepOrder = {
        exam_metadata: { title: 'Test Meta KeepOrder', id: 'src_meta_order', keepOrder: true },
        questions: [
            { id: 'q1', type: 'single_choice', content: { text: 'Q1' }, answer: { correctOptions: [0] } },
            { id: 'q2', type: 'single_choice', content: { text: 'Q2' }, answer: { correctOptions: [0] } }
        ]
    };

    const source2 = importJSON(jsonWithMetaKeepOrder, { silent: true });
    assert.equal(source2.keepOrder, true);
});

test('prepareFromCompositeIds preserves question order when keepOrder is true', async () => {
    const dom = new JSDOM(indexHtml, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.navigator = dom.window.navigator;
    global.localStorage = dom.window.localStorage;
    global.crypto = dom.window.crypto;

    const { AppState } = await import('../src/core/state.js');
    const { prepareFromCompositeIds } = await import('../src/features/test/test-engine.js');

    const sourceId = 'src_ordered_test';
    AppState.sources = [{
        id: sourceId,
        name: 'Ordered Test Source',
        keepOrder: true,
        questions: []
    }];

    const cids = [];
    for (let i = 1; i <= 20; i++) {
        const cid = `${sourceId}_q${i}`;
        cids.push(cid);
        AppState.questionMap[cid] = { id: `q${i}`, sourceId };
    }

    const testList = prepareFromCompositeIds(cids, { shuffle: true });
    assert.deepEqual(testList, cids, 'Question sequence should remain identical when keepOrder is true');
});
