import test, { before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let storage, store, ereaderStore, ereaderSync, imp, AppState;
let mergeEreaderIndex, pullEreader, pushEreader, bookFilename, INDEX_FILENAME, _resetEreaderSyncForTests;

function makeIdb() {
    const map = new Map();
    return {
        map,
        get: async key => (map.has(key) ? map.get(key) : undefined),
        set: async (key, value) => { map.set(key, value); return true; },
        del: async key => { map.delete(key); return true; }
    };
}

function sampleBook(id = 'book-1', title = 'Test Book', updatedAt = 1000) {
    return {
        id,
        title,
        author: 'Author',
        language: 'en',
        sourceType: 'other',
        bookKey: id,
        part: { from: 1, to: 1, total: 1, unit: 'section' },
        updatedAt,
        sections: [
            { id: 's1', title: 'Chapter 1', level: 1, text: 'Hello world.' }
        ]
    };
}

before(async () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
    dom.window.scrollTo = () => {};

    storage = await import('../src/core/storage.js');
    store = await import('../src/core/store.js');
    ereaderStore = await import('../src/features/ereader/ereader-store.js');
    ereaderSync = await import('../src/features/ereader/ereader-sync.js');
    imp = await import('../src/features/ereader/ereader-import.js');
    AppState = (await import('../src/core/state.js')).AppState;

    ({
        mergeEreaderIndex, pullEreader, pushEreader, bookFilename, INDEX_FILENAME,
        _resetEreaderSyncForTests
    } = ereaderSync);
});

beforeEach(async () => {
    storage._setIdbBackendForTests(makeIdb());
    ereaderStore._resetEreaderStoreForTests();
    _resetEreaderSyncForTests();
    store._reset();
    AppState.githubToken = 'test-token';
    AppState.githubGistId = 'test-gist';
    await ereaderStore.loadEreader();
});

afterEach(() => {
    storage._setIdbBackendForTests(null);
    delete global.fetch;
});

// ── Pure merge tests ───────────────────────────────────────────────────────

test('1. mergeEreaderIndex: tombstones union with maximum timestamp', () => {
    const local = {
        schema: 1,
        books: [],
        progress: {},
        tombstones: { b1: 100, b2: 300 }
    };
    const remote = {
        schema: 1,
        books: [],
        progress: {},
        tombstones: { b1: 200, b3: 400 }
    };
    const merged = mergeEreaderIndex(local, remote);
    assert.deepEqual(merged.tombstones, { b1: 200, b2: 300, b3: 400 });
});

test('2. mergeEreaderIndex: tombstoned books and progress are dropped', () => {
    const local = {
        schema: 1,
        books: [{ id: 'b1', updatedAt: 100 }],
        progress: { b1: { sectionId: 's1', offset: 0, percent: 10, at: 100 } },
        tombstones: {}
    };
    const remote = {
        schema: 1,
        books: [{ id: 'b1', updatedAt: 200 }, { id: 'b2', updatedAt: 150 }],
        progress: { b1: { sectionId: 's1', offset: 0, percent: 20, at: 200 }, b2: { at: 150 } },
        tombstones: { b1: 500 }
    };
    const merged = mergeEreaderIndex(local, remote);
    assert.equal(merged.books.find(b => b.id === 'b1'), undefined, 'tombstoned b1 must be dropped from books');
    assert.equal(merged.progress.b1, undefined, 'tombstoned b1 must be dropped from progress');
    assert.equal(merged.books.find(b => b.id === 'b2')?.id, 'b2');
    assert.ok(merged.progress.b2);
});

test('3. mergeEreaderIndex: higher updatedAt wins for books, higher at wins for progress', () => {
    const local = {
        schema: 1,
        books: [{ id: 'b1', title: 'Old Title', updatedAt: 100 }],
        progress: { b1: { sectionId: 's1', at: 500 } },
        tombstones: {}
    };
    const remote = {
        schema: 1,
        books: [{ id: 'b1', title: 'Newer Title', updatedAt: 200 }],
        progress: { b1: { sectionId: 's2', at: 300 } },
        tombstones: {}
    };
    const merged = mergeEreaderIndex(local, remote);
    assert.equal(merged.books[0].title, 'Newer Title');
    assert.equal(merged.progress.b1.sectionId, 's1', 'Local progress has higher at timestamp and must win');
});

// ── Two-device Simulated Sync ──────────────────────────────────────────────

test('4. Two virtual devices: Device A adds book -> pushes -> Device B pulls and gets book', async () => {
    // Shared simulated Gist store
    const gistFiles = {};

    function mockFetch(url, init = {}) {
        const method = (init.method || 'GET').toUpperCase();
        if (method === 'GET') {
            return {
                ok: true,
                status: 200,
                json: async () => ({ files: { ...gistFiles } })
            };
        }
        if (method === 'PATCH') {
            const body = JSON.parse(init.body || '{}');
            if (body.files) {
                for (const [name, val] of Object.entries(body.files)) {
                    if (val === null) {
                        delete gistFiles[name];
                    } else {
                        gistFiles[name] = { content: val.content };
                    }
                }
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({ files: { ...gistFiles } })
            };
        }
        return { ok: false, status: 404 };
    }

    global.fetch = mockFetch;

    // Device A adds a book and pushes
    const bookA = sampleBook('book-alpha', 'Alpha Book', 1000);
    await ereaderStore.replaceBook(bookA);
    await ereaderStore.setProgress('book-alpha', { sectionId: 's1', offset: 0.5, percent: 50, at: 1000 });
    await pushEreader();

    assert.ok(gistFiles[INDEX_FILENAME], 'Index must be present in Gist');
    assert.ok(gistFiles[bookFilename('book-alpha')], 'Book alpha must be in Gist');

    // Switch to Device B (reset local storage)
    const idbB = makeIdb();
    storage._setIdbBackendForTests(idbB);
    ereaderStore._resetEreaderStoreForTests();
    _resetEreaderSyncForTests();
    await ereaderStore.loadEreader();

    assert.equal(ereaderStore.listBooks().length, 0, 'Device B starts empty');

    // Device B pulls
    await pullEreader({ force: true });

    const booksB = ereaderStore.listBooks();
    assert.equal(booksB.length, 1);
    assert.equal(booksB[0].id, 'book-alpha');
    const fullB = await ereaderStore.getBook('book-alpha');
    assert.equal(fullB.title, 'Alpha Book');
    const progB = ereaderStore.getProgress('book-alpha');
    assert.equal(progB.offset, 0.5);
});

test('5. Device B deletes book -> pushes -> Device A pulls and book is deleted and file is null', async () => {
    const gistFiles = {};

    function mockFetch(url, init = {}) {
        const method = (init.method || 'GET').toUpperCase();
        if (method === 'GET') {
            return {
                ok: true,
                status: 200,
                json: async () => ({ files: { ...gistFiles } })
            };
        }
        if (method === 'PATCH') {
            const body = JSON.parse(init.body || '{}');
            if (body.files) {
                for (const [name, val] of Object.entries(body.files)) {
                    if (val === null) {
                        delete gistFiles[name];
                    } else {
                        gistFiles[name] = { content: val.content };
                    }
                }
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({ files: { ...gistFiles } })
            };
        }
        return { ok: false, status: 404 };
    }

    global.fetch = mockFetch;

    // Seed book in Gist
    const book = sampleBook('book-del', 'To Delete', 1000);
    await ereaderStore.replaceBook(book);
    await pushEreader();
    assert.ok(gistFiles[bookFilename('book-del')]);

    // Device B deletes book
    await ereaderStore.deleteBook('book-del');
    await pushEreader();

    // The book file should have been deleted from Gist
    assert.equal(gistFiles[bookFilename('book-del')], undefined, 'File must be deleted in Gist');

    // Now Device A pulls
    const idbA = makeIdb();
    storage._setIdbBackendForTests(idbA);
    ereaderStore._resetEreaderStoreForTests();
    _resetEreaderSyncForTests();
    await ereaderStore.loadEreader();
    // Device A had the book
    await ereaderStore.replaceBook(book);
    assert.equal(ereaderStore.listBooks().length, 1);

    await pullEreader({ force: true });
    assert.equal(ereaderStore.listBooks().length, 0, 'Device A must have deleted the book after pull');
    assert.ok(ereaderStore.getTombstones()['book-del'], 'Tombstone must be recorded in Device A');
});

test('6. Only changed books are included in push PATCH', async () => {
    const patchCalls = [];
    const gistFiles = {
        [INDEX_FILENAME]: {
            content: JSON.stringify({
                schema: 1,
                books: [{ id: 'b1', updatedAt: 1000 }, { id: 'b2', updatedAt: 1000 }],
                progress: {},
                tombstones: {}
            })
        },
        [bookFilename('b1')]: { content: JSON.stringify(sampleBook('b1', 'Book 1', 1000)) },
        [bookFilename('b2')]: { content: JSON.stringify(sampleBook('b2', 'Book 2', 1000)) }
    };

    global.fetch = async (url, init = {}) => {
        const method = (init.method || 'GET').toUpperCase();
        if (method === 'GET') {
            return {
                ok: true,
                status: 200,
                json: async () => ({ files: { ...gistFiles } })
            };
        }
        if (method === 'PATCH') {
            const body = JSON.parse(init.body || '{}');
            patchCalls.push(body.files);
            return { ok: true, status: 200, json: async () => ({}) };
        }
        return { ok: false, status: 404 };
    };

    // Local store has b1 (unchanged) and b2 (updated at 2000)
    await ereaderStore.replaceBook(sampleBook('b1', 'Book 1', 1000));
    await ereaderStore.replaceBook(sampleBook('b2', 'Book 2', 2000));

    await pushEreader();

    assert.equal(patchCalls.length, 1);
    const patchedFiles = patchCalls[0];
    assert.ok(patchedFiles[INDEX_FILENAME], 'Index must always be patched');
    assert.equal(patchedFiles[bookFilename('b1')], undefined, 'Unchanged b1 must NOT be in patch');
    assert.ok(patchedFiles[bookFilename('b2')], 'Updated b2 MUST be in patch');
});

test('7. fromSync writes do not trigger ereader change listener', async () => {
    let changeNotified = false;
    ereaderStore.setEreaderChangeListener(() => {
        changeNotified = true;
    });

    await ereaderStore.replaceBook(sampleBook('b-sync', 'Sync Book', 1000), { fromSync: true });
    await ereaderStore.setProgress('b-sync', { sectionId: 's1', offset: 0, percent: 0 }, { fromSync: true });
    await ereaderStore.deleteBook('b-sync', { fromSync: true });

    assert.equal(changeNotified, false, 'fromSync: true must never notify change listener');
});

test('8. Remote read failure prevents PATCH (no blind push)', async () => {
    let patchAttempted = false;
    global.fetch = async (url, init = {}) => {
        const method = (init.method || 'GET').toUpperCase();
        if (method === 'GET') {
            return { ok: false, status: 500 };
        }
        if (method === 'PATCH') {
            patchAttempted = true;
            return { ok: true, status: 200, json: async () => ({}) };
        }
    };

    await ereaderStore.replaceBook(sampleBook('b-fail', 'Fail Book', 1000));
    const result = await pushEreader();
    assert.equal(result, false, 'push must fail gracefully');
    assert.equal(patchAttempted, false, 'PATCH must not be called when remote GET fails');
});

test('9. K4 guard: book containing data:image is not pushed', async () => {
    let patchedFiles = null;
    global.fetch = async (url, init = {}) => {
        const method = (init.method || 'GET').toUpperCase();
        if (method === 'GET') {
            return { ok: true, status: 200, json: async () => ({ files: {} }) };
        }
        if (method === 'PATCH') {
            patchedFiles = JSON.parse(init.body || '{}').files;
            return { ok: true, status: 200, json: async () => ({}) };
        }
    };

    const hostileBook = sampleBook('b-k4', 'Hostile', 1000);
    hostileBook.sections[0].text = 'Here is an inline image: ![alt](data:image/png;base64,iVBORw0KGgo=)';
    await ereaderStore.replaceBook(hostileBook);

    await pushEreader();
    assert.ok(patchedFiles);
    assert.equal(patchedFiles[bookFilename('b-k4')], undefined, 'K4 violation: book with data:image must NOT be pushed');
});

test('10. Re-importing a deleted book gets a new ID and is not blocked by tombstone', async () => {
    const rawJson = {
        ereader: { schema: 1, title: 'Revived Book', author: 'Author', language: 'en', source_type: 'other' },
        sections: [{ id: 's1', title: 'Chapter 1', level: 1, text: 'Content.' }]
    };

    // First import
    const { book: firstBook } = await imp.importEreaderJson(rawJson);
    const firstId = firstBook.id;

    // Delete it
    await ereaderStore.deleteBook(firstId);
    assert.ok(ereaderStore.getTombstones()[firstId]);

    // Re-import the exact same book JSON
    const { book: revivedBook } = await imp.importEreaderJson(rawJson);
    assert.ok(revivedBook, 'Re-import must succeed');
    assert.notEqual(revivedBook.id, firstId, 'New book must receive a new distinct ID');
    assert.ok(ereaderStore.listBooks().some(b => b.id === revivedBook.id), 'Revived book must be in library');
});

test('11. K4 guard leaves skipped book index entry in remote state and does not trigger on plain text data:image (Fix 5)', async () => {
    let patchedFiles = null;
    const remoteIndexData = {
        schema: 1,
        books: [{ id: 'b-remote', title: 'Remote Book', updatedAt: 100 }],
        progress: {},
        tombstones: {}
    };

    global.fetch = async (url, init = {}) => {
        const method = (init.method || 'GET').toUpperCase();
        if (method === 'GET') {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    files: {
                        [INDEX_FILENAME]: { content: JSON.stringify(remoteIndexData) }
                    }
                })
            };
        }
        if (method === 'PATCH') {
            patchedFiles = JSON.parse(init.body || '{}').files;
            return { ok: true, status: 200, json: async () => ({}) };
        }
    };

    // Book 1: updated locally to have an inline data:image image, updatedAt: 200
    const hostileBook = sampleBook('b-remote', 'Remote Book Modified', 200);
    hostileBook.sections[0].text = 'Inline image: ![pic](data:image/jpeg;base64,12345)';
    await ereaderStore.replaceBook(hostileBook);

    // Book 2: normal book that merely mentions "data:image" in plain text
    const textBook = sampleBook('b-text', 'Text Book', 200);
    textBook.sections[0].text = 'The data:image URI scheme is used in web development.';
    await ereaderStore.replaceBook(textBook);

    await pushEreader();

    assert.ok(patchedFiles);
    // b-remote must NOT be pushed
    assert.equal(patchedFiles[bookFilename('b-remote')], undefined, 'Hostile book must not be pushed');
    // b-text MUST be pushed (not blocked by plain text)
    assert.ok(patchedFiles[bookFilename('b-text')], 'Text book mentioning data:image in text must be pushed');

    // In the pushed index, b-remote must retain its remote updatedAt (100), not local (200)
    const pushedIndex = JSON.parse(patchedFiles[INDEX_FILENAME].content);
    const remoteBookEntry = pushedIndex.books.find(b => b.id === 'b-remote');
    assert.ok(remoteBookEntry);
    assert.equal(remoteBookEntry.updatedAt, 100, 'Skipped book must retain remote updatedAt so other devices are not corrupted');
});

test('12. pullEreader validates pushed book format without ereader wrapper and drops invalid books (Fix 6)', async () => {
    // Valid pushed book (no 'ereader' wrapper)
    const validPushedBook = {
        id: 'b-valid',
        title: 'Valid Synced Book',
        author: 'Sync Author',
        language: 'en',
        sourceType: 'other',
        bookKey: 'valid-synced',
        parts: [{ unit: 'section', from: 1, to: 1, total: 1 }],
        updatedAt: 500,
        sections: [
            { id: 's1', title: 'Chapter 1', level: 1, text: 'Valid content.' }
        ]
    };

    // Invalid book (missing sections or corrupt structure)
    const invalidBook = {
        id: 'b-invalid',
        title: 'Corrupt Book',
        sections: "not an array"
    };

    const gistFiles = {
        [INDEX_FILENAME]: {
            content: JSON.stringify({
                schema: 1,
                books: [
                    { id: 'b-valid', title: 'Valid Synced Book', updatedAt: 500 },
                    { id: 'b-invalid', title: 'Corrupt Book', updatedAt: 500 }
                ],
                progress: {},
                tombstones: {}
            })
        },
        [bookFilename('b-valid')]: { content: JSON.stringify(validPushedBook) },
        [bookFilename('b-invalid')]: { content: JSON.stringify(invalidBook) }
    };

    global.fetch = async (url, init = {}) => {
        const method = (init.method || 'GET').toUpperCase();
        if (method === 'GET') {
            return {
                ok: true,
                status: 200,
                json: async () => ({ files: { ...gistFiles } })
            };
        }
    };

    await pullEreader({ force: true });

    // Valid book must be stored
    const storedValid = await ereaderStore.getBook('b-valid');
    assert.ok(storedValid, 'Valid book in pushed format must be saved');
    assert.equal(storedValid.title, 'Valid Synced Book');

    // Invalid book must be dropped
    const storedInvalid = await ereaderStore.getBook('b-invalid');
    assert.equal(storedInvalid, null, 'Invalid book must be dropped and not saved');
});

test('13. pushEreader uses cached index and avoids downloading full gist on subsequent progress-only pushes (Fix 10)', async () => {
    let getGistCalls = 0;
    let patchCalls = 0;

    const book = sampleBook('b-prog', 'Progress Book', 1000);
    await ereaderStore.replaceBook(book);

    const gistFiles = {
        [INDEX_FILENAME]: {
            content: JSON.stringify({
                schema: 1,
                books: [{ id: 'b-prog', title: 'Progress Book', updatedAt: 1000 }],
                progress: {},
                tombstones: {}
            })
        },
        [bookFilename('b-prog')]: { content: JSON.stringify(book) }
    };

    global.fetch = async (url, init = {}) => {
        const method = (init.method || 'GET').toUpperCase();
        if (method === 'GET') {
            getGistCalls++;
            return {
                ok: true,
                status: 200,
                json: async () => ({ files: { ...gistFiles } })
            };
        }
        if (method === 'PATCH') {
            patchCalls++;
            const body = JSON.parse(init.body || '{}');
            for (const [name, val] of Object.entries(body.files || {})) {
                if (val === null) delete gistFiles[name];
                else gistFiles[name] = { content: val.content };
            }
            return { ok: true, status: 200, json: async () => ({ files: { ...gistFiles } }) };
        }
    };

    // First push (books need checking) -> must fetch Gist once
    await pushEreader();
    assert.equal(getGistCalls, 1, 'First push must fetch Gist');
    assert.equal(patchCalls, 1, 'First push must patch Gist');

    // Now update ONLY progress (e.g. while reading)
    await ereaderStore.setProgress('b-prog', { sectionId: 's1', offset: 0.25, percent: 25, at: 2000 });
    await pushEreader();

    // The second push must NOT call fetchGist again because only progress changed!
    assert.equal(getGistCalls, 1, 'Subsequent progress push must not re-fetch the entire gist');
    assert.equal(patchCalls, 2, 'Second push must patch the updated progress index');

    // Another progress update
    await ereaderStore.setProgress('b-prog', { sectionId: 's1', offset: 0.5, percent: 50, at: 3000 });
    await pushEreader();
    assert.equal(getGistCalls, 1, 'Third progress push must also not re-fetch the entire gist');
    assert.equal(patchCalls, 3, 'Third push must patch updated progress');
});

