import test, { before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import {
    UNCATEGORIZED, orderBooks, groupBooks, knownFolders, moveId, exportBookJson, bookFileName
} from '../src/features/ereader/ereader-folders.js';
import { validateEreaderFile } from '../src/features/ereader/ereader-schema.js';

let storage, ereaderStore, lib, manage, imp;

function makeIdb() {
    const map = new Map();
    return {
        get: async key => (map.has(key) ? map.get(key) : undefined),
        set: async (key, value) => { map.set(key, value); return true; },
        del: async key => { map.delete(key); return true; }
    };
}

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

before(async () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
    delete global.requestAnimationFrame;

    storage = await import('../src/core/storage.js');
    ereaderStore = await import('../src/features/ereader/ereader-store.js');
    lib = await import('../src/features/ereader/ereader-library-ui.js');
    manage = await import('../src/features/ereader/ereader-library-manage.js');
    imp = await import('../src/features/ereader/ereader-import.js');
});

beforeEach(async () => {
    storage._setIdbBackendForTests(makeIdb());
    ereaderStore._resetEreaderStoreForTests();
    lib._resetEreaderLibraryUIForTests();
    await ereaderStore.loadEreader();
    lib.bindEreaderLibrary({ switchView: () => {} });
});

afterEach(() => storage._setIdbBackendForTests(null));

async function addBook(title, key) {
    const { book } = await imp.importEreaderJson({
        ereader: { schema: 1, book_key: key, title, author: 'A', language: 'de', source_type: 'pdf' },
        sections: [{ id: 's1', title: 'One', level: 1, text: `Text of ${title}.` }]
    });
    return book;
}

const shownTitles = () => [...document.querySelectorAll('#ereaderBookList .ereader-book-title')].map(e => e.textContent);

// ── pure ──────────────────────────────────────────────────────────────────

test('R2-11: manual order first, then most recently read; moveId puts a book before/after another', () => {
    const books = [
        { id: 'a', updatedAt: 1 }, { id: 'b', updatedAt: 2, order: 1 }, { id: 'c', updatedAt: 3, order: 0 }, { id: 'd', updatedAt: 4 }
    ];
    const progress = { a: { at: 50 } };
    assert.deepEqual(orderBooks(books, id => progress[id]).map(b => b.id), ['c', 'b', 'a', 'd']);
    assert.deepEqual(moveId(['a', 'b', 'c'], 'c', 'a', 'before'), ['c', 'a', 'b']);
    assert.deepEqual(moveId(['a', 'b', 'c'], 'a', 'c', 'after'), ['b', 'c', 'a']);
    assert.deepEqual(moveId(['a', 'b'], 'a', 'zz'), ['b', 'a']);
});

test('R2-11: books are grouped by folder; a folder only a book knows (from a sync) still shows; archived books are apart', () => {
    const books = [
        { id: 'a', folderId: 'f1' }, { id: 'b' }, { id: 'c', folderId: 'f2', folderName: 'Remote' }, { id: 'd', archived: true }
    ];
    const folders = [{ id: 'f1', name: 'Local', order: 0 }];
    assert.deepEqual(knownFolders(folders, books).map(f => f.name), ['Local', 'Remote']);
    const groups = groupBooks(books, folders);
    assert.deepEqual(groups.map(g => [g.folder.id, g.books.map(b => b.id)]), [['f1', ['a']], ['f2', ['c']], [UNCATEGORIZED, ['b']]]);
    assert.deepEqual(groupBooks(books, folders, { archived: true }).map(g => g.books.map(b => b.id)), [['d']]);
    assert.equal(groupBooks([{ id: 'x' }], [])[0].folder, null, 'no folders: one flat list');
});

test('R2-11: a downloaded book is a valid e-Reader file again', () => {
    const book = {
        bookKey: 'k', title: 'Titel', author: 'A', language: 'de', sourceType: 'pdf',
        parts: [{ unit: 'page', from: 5, to: 9, total: 20 }, { unit: 'page', from: 12, to: 14, total: 20 }],
        sections: [{ id: 's1', title: 'T', level: 2, text: 'x', pageStart: 5 }]
    };
    const json = exportBookJson(book);
    assert.deepEqual(json.ereader.part, { unit: 'page', from: 5, to: 14, total: 20 });
    const back = validateEreaderFile(json);
    assert.equal(back.ok, true);
    assert.equal(back.book.title, 'Titel');
    assert.equal(back.book.sections[0].pageStart, 5);
    assert.equal(bookFileName('Çağ / Über: Buch!'), 'Cag_Uber_Buch.ereader.json');
});

// ── store + UI ────────────────────────────────────────────────────────────

test('R2-11: a folder is created, a book moved into it and shown under it; renaming renames it on the book', async () => {
    const a = await addBook('Alpha', 'a');
    await addBook('Beta', 'b');
    const folder = await manage.createFolder('ITIL');
    await manage.moveBooksToFolder([a.id], folder.id);
    lib.renderEreaderLibrary();

    const blocks = [...document.querySelectorAll('#ereaderBookList .ereader-folder')];
    assert.deepEqual(blocks.map(b => b.querySelector('.ereader-folder-name').textContent), ['ITIL', 'No folder']);
    assert.deepEqual([...blocks[0].querySelectorAll('.ereader-book-title')].map(e => e.textContent), ['Alpha']);

    await manage.renameFolder(folder.id, 'ITIL 4');
    assert.equal(ereaderStore.listBooks().find(b => b.id === a.id).folderName, 'ITIL 4', 'the name travels with the book');
});

test('R2-11: deleting a folder keeps its books, without a folder', async () => {
    const a = await addBook('Alpha', 'a');
    const folder = await manage.createFolder('Tmp');
    await manage.moveBooksToFolder([a.id], folder.id);
    await manage.deleteFolder(folder.id);
    const book = ereaderStore.listBooks().find(b => b.id === a.id);
    assert.ok(book, 'the book is still there');
    assert.equal(book.folderId, null);
    assert.equal(ereaderStore.listFolders().length, 0);
});

test('R2-11: the book actions dialog offers the source actions; a selection hides the one-book ones', async () => {
    const a = await addBook('Alpha', 'a');
    const b = await addBook('Beta', 'b');
    lib.renderEreaderLibrary();
    document.querySelector(`#ereaderBookList [data-book-id="${a.id}"] .ereader-book-actions-btn`).click();
    const overlay = document.getElementById('ereaderBookActionsOverlay');
    assert.ok(overlay.classList.contains('active'));
    for (const id of ['ereaderEditMetaBtn', 'ereaderDownloadBookBtn', 'ereaderShareBookBtn', 'ereaderPrintBookBtn', 'ereaderArchiveBookBtn', 'ereaderDeleteBookBtn', 'ereaderResetBookBtn']) {
        assert.notEqual(document.getElementById(id).style.display, 'none', `#${id} is offered for one book`);
    }
    document.getElementById('ereaderBookActionsCloseBtn').click();

    manage.enterSelection(UNCATEGORIZED);
    lib.renderEreaderLibrary();
    document.querySelector(`#ereaderBookList [data-book-id="${a.id}"]`).click();
    document.querySelector(`#ereaderBookList [data-book-id="${b.id}"]`).click();
    assert.equal(document.querySelectorAll('#ereaderBookList .ereader-book-row.selected').length, 2);
    document.querySelector('#ereaderBookList .ereader-bulk-bar .btn-primary').click();
    assert.equal(document.getElementById('ereaderBookActionsName').textContent, '2 books selected');
    assert.equal(document.getElementById('ereaderEditMetaBtn').style.display, 'none');
    assert.equal(document.getElementById('ereaderPrintBookBtn').style.display, 'none');

    document.getElementById('ereaderArchiveBookBtn').click();
    await tick(10);
    assert.deepEqual(ereaderStore.listBooks().map(x => x.archived), [true, true], 'bulk archive');
    lib.renderEreaderLibrary();
    assert.deepEqual(shownTitles(), [], 'archived books leave the library');
    document.getElementById('ereaderArchiveViewBtn').click();
    assert.deepEqual(shownTitles().sort(), ['Alpha', 'Beta'], 'and are in the archive');
});

test('R2-11: edit metadata saves title, author and language', async () => {
    const a = await addBook('Alpha', 'a');
    await manage.openMetaDialog(a.id);
    document.getElementById('ereaderMetaTitle').value = 'Alpha II';
    document.getElementById('ereaderMetaAuthor').value = 'B';
    document.getElementById('ereaderMetaLanguage').value = 'en';
    document.getElementById('ereaderMetaSaveBtn').click();
    await tick(10);
    const book = await ereaderStore.getBook(a.id);
    assert.deepEqual([book.title, book.author, book.language], ['Alpha II', 'B', 'en']);
});

test('R2-11: resetting a book clears only its reading position', async () => {
    const a = await addBook('Alpha', 'a');
    const b = await addBook('Beta', 'b');
    await ereaderStore.setProgress(a.id, { sectionId: 's1', offset: 0.5, percent: 40 });
    await ereaderStore.setProgress(b.id, { sectionId: 's1', offset: 0.5, percent: 60 });
    await manage.resetProgressOf([a.id]);
    assert.equal(ereaderStore.getProgress(a.id).percent, 0);
    assert.equal(ereaderStore.getProgress(b.id).percent, 60);
});
