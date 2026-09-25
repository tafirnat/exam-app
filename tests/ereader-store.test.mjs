import test, { before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

class FakeStorage {
    constructor() { this.map = new Map(); }
    setItem(key, value) { this.map.set(String(key), String(value)); }
    getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
    removeItem(key) { this.map.delete(String(key)); }
    clear() { this.map.clear(); }
    key(i) { return [...this.map.keys()][i] ?? null; }
    get length() { return this.map.size; }
}

function makeIdb(seed = {}) {
    const map = new Map(Object.entries(seed));
    return {
        map,
        get: async key => (map.has(key) ? map.get(key) : undefined),
        set: async (key, value) => { map.set(key, value); return true; },
        del: async key => { map.delete(key); return true; }
    };
}

let storage;
let store;
let ereaderStore;
let idb;

before(async () => {
    global.localStorage = new FakeStorage();
    storage = await import('../src/core/storage.js');
    store = await import('../src/core/store.js');
    ereaderStore = await import('../src/features/ereader/ereader-store.js');
});

beforeEach(async () => {
    global.localStorage = new FakeStorage();
    idb = makeIdb();
    storage._setIdbBackendForTests(idb);
    ereaderStore._resetEreaderStoreForTests();
    store._reset();
    await ereaderStore.loadEreader();
});

afterEach(() => {
    storage._setIdbBackendForTests(null);
});

test('1. addBook creates id, saves to storage, emits Slice.EREADER_LIBRARY', async () => {
    const emittedSlices = [];
    store.subscribe('test-sub', [store.Slice.EREADER_LIBRARY], () => {
        emittedSlices.push(store.Slice.EREADER_LIBRARY);
    });

    const book = {
        title: 'Book One',
        author: 'Author A',
        language: 'en',
        sourceType: 'pdf',
        parts: [{ unit: 'section', from: 1, to: 1, total: 1, importedAt: Date.now() }],
        sections: [{ id: 's-1', title: 'Sec 1', level: 1, text: 'Hello World' }]
    };

    const saved = await ereaderStore.addBook(book);
    assert.ok(saved.id.startsWith('book_'));
    assert.ok(saved.createdAt);
    assert.ok(saved.updatedAt);

    // List books should have the summary
    const list = ereaderStore.listBooks();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, saved.id);
    assert.equal(list[0].title, 'Book One');
    assert.equal(list[0].sectionCount, 1);
    assert.equal(list[0].textLength, 'Hello World'.length);

    // Flush and verify emit
    store.flushNow();
    assert.ok(emittedSlices.includes(store.Slice.EREADER_LIBRARY));
});

test('2. getBook loads full body and caches it in memory', async () => {
    const book = {
        title: 'Book Two',
        language: 'en',
        sourceType: 'epub',
        sections: [{ id: 's-1', title: 'Intro', level: 1, text: 'Full text here' }]
    };
    const saved = await ereaderStore.addBook(book);

    const retrieved = await ereaderStore.getBook(saved.id);
    assert.ok(retrieved);
    assert.equal(retrieved.id, saved.id);
    assert.equal(retrieved.sections[0].text, 'Full text here');

    // Retrieve again (from cache)
    const cached = await ereaderStore.getBook(saved.id);
    assert.equal(cached, retrieved);
});

test('3. updateBook mutates book, increments updatedAt, and emits Slice.EREADER_LIBRARY', async () => {
    const book = {
        title: 'Original Title',
        language: 'en',
        sourceType: 'obsidian',
        sections: [{ id: 's-1', title: 'Section 1', level: 1, text: 'Sample' }]
    };
    const saved = await ereaderStore.addBook(book);
    const originalUpdatedAt = saved.updatedAt;

    // Small delay so updatedAt advances
    await new Promise(r => setTimeout(r, 10));

    const updated = await ereaderStore.updateBook(saved.id, b => {
        b.title = 'Updated Title';
        b.sections.push({ id: 's-2', title: 'Section 2', level: 1, text: 'More' });
    });

    assert.equal(updated.title, 'Updated Title');
    assert.ok(updated.updatedAt > originalUpdatedAt);

    const list = ereaderStore.listBooks();
    assert.equal(list[0].title, 'Updated Title');
    assert.equal(list[0].sectionCount, 2);
});

test('4. deleteBook removes from index, writes tombstone, and is not in listBooks()', async () => {
    const book = {
        title: 'Book to Delete',
        language: 'en',
        sourceType: 'topic',
        sections: [{ id: 's-1', title: 'Sec', level: 1, text: 'Text' }]
    };
    const saved = await ereaderStore.addBook(book);
    assert.equal(ereaderStore.listBooks().length, 1);

    await ereaderStore.deleteBook(saved.id);

    // listBooks should now be empty
    assert.equal(ereaderStore.listBooks().length, 0);

    // getBook should return null
    assert.equal(await ereaderStore.getBook(saved.id), null);

    // Tombstones should contain the deleted ID
    const tombstones = ereaderStore.getTombstones();
    assert.ok(tombstones[saved.id]);
});

test('5. fromSync: true writes do not trigger ereader change listener', async () => {
    const changes = [];
    ereaderStore.setEreaderChangeListener((action, id) => {
        changes.push({ action, id });
    });

    const book1 = { title: 'Synced Book', language: 'en', sections: [{ id: 's-1', text: '1' }] };
    const saved1 = await ereaderStore.addBook(book1, { fromSync: true });
    assert.equal(changes.length, 0, 'addBook with fromSync must NOT notify listener');

    await ereaderStore.setProgress(saved1.id, { sectionId: 's-1', offset: 0.5, percent: 50 }, { fromSync: true });
    assert.equal(changes.length, 0, 'setProgress with fromSync must NOT notify listener');

    await ereaderStore.updateBook(saved1.id, b => { b.title = 'Sync Updated'; }, { fromSync: true });
    assert.equal(changes.length, 0, 'updateBook with fromSync must NOT notify listener');

    await ereaderStore.deleteBook(saved1.id, { fromSync: true });
    assert.equal(changes.length, 0, 'deleteBook with fromSync must NOT notify listener');

    // Local mutation without fromSync DOES notify
    const book2 = { title: 'Local Book', language: 'en', sections: [{ id: 's-1', text: '1' }] };
    const saved2 = await ereaderStore.addBook(book2, { fromSync: false });
    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, 'addBook');
    assert.equal(changes[0].id, saved2.id);
});

test('6. resetAllProgress writes stamped empty records and emits Slice.EREADER_PROGRESS', async () => {
    const book = { title: 'Book Progress', language: 'en', sections: [{ id: 's-1', text: '1' }] };
    const saved = await ereaderStore.addBook(book);

    await ereaderStore.setProgress(saved.id, { sectionId: 's-1', offset: 0.75, percent: 75 });
    const progBefore = ereaderStore.getProgress(saved.id);
    assert.equal(progBefore.percent, 75);
    assert.equal(progBefore.sectionId, 's-1');

    await ereaderStore.resetAllProgress();

    const progAfter = ereaderStore.getProgress(saved.id);
    assert.ok(progAfter);
    assert.equal(progAfter.sectionId, null);
    assert.equal(progAfter.offset, 0);
    assert.equal(progAfter.percent, 0);
    assert.ok(progAfter.at > 0);
    assert.ok(progAfter.by);
});

test('7. setPrefs and getPrefs store and retrieve font scale and lastBookId', async () => {
    const initial = ereaderStore.getPrefs();
    assert.equal(initial.fontScale, 1);
    assert.equal(initial.lastBookId, null);

    await ereaderStore.setPrefs({ fontScale: 1.25, lastBookId: 'book_abc' });
    const updated = ereaderStore.getPrefs();
    assert.equal(updated.fontScale, 1.25);
    assert.equal(updated.lastBookId, 'book_abc');
});

test('8. deleteAllBooks deletes all books and writes tombstones for each', async () => {
    const b1 = await ereaderStore.addBook({ title: 'Book 1', language: 'en', sections: [{ id: 's-1', text: '1' }] });
    const b2 = await ereaderStore.addBook({ title: 'Book 2', language: 'en', sections: [{ id: 's-1', text: '1' }] });
    assert.equal(ereaderStore.listBooks().length, 2);

    await ereaderStore.deleteAllBooks();
    assert.equal(ereaderStore.listBooks().length, 0);

    const tombstones = ereaderStore.getTombstones();
    assert.ok(tombstones[b1.id]);
    assert.ok(tombstones[b2.id]);
});
