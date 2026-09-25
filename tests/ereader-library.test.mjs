import test, { before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let storage, store, ereaderStore, lib, imp, shell, bindings, t;

function makeIdb() {
    const map = new Map();
    return {
        map,
        get: async key => (map.has(key) ? map.get(key) : undefined),
        set: async (key, value) => { map.set(key, value); return true; },
        del: async key => { map.delete(key); return true; }
    };
}

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

/** Answers the shared dialog card once it is open. */
async function answer(buttonId) {
    await tick();
    const overlay = document.getElementById('customModalOverlay');
    assert.ok(overlay.classList.contains('active'), `dialog must be open before pressing #${buttonId}`);
    document.getElementById(buttonId).click();
}

function bookJson({ title = 'Book', author = 'A', key, from = 1, to = 2, sections } = {}) {
    return {
        ereader: {
            schema: 1,
            ...(key ? { book_key: key } : {}),
            title, author, language: 'de', source_type: 'pdf',
            part: { unit: 'page', from, to, total: 10, next_from: to + 1, is_last: false }
        },
        sections: sections || [{ id: 's-1', title: 'One', level: 1, text: 'Hello' }]
    };
}

before(async () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
    delete global.requestAnimationFrame;

    storage = await import('../src/core/storage.js');
    store = await import('../src/core/store.js');
    ereaderStore = await import('../src/features/ereader/ereader-store.js');
    lib = await import('../src/features/ereader/ereader-library-ui.js');
    imp = await import('../src/features/ereader/ereader-import.js');
    shell = await import('../src/features/ereader/ereader-shell.js');
    bindings = await import('../src/core/ui-bindings.js');
    ({ t } = await import('../src/core/i18n.js'));
});

beforeEach(async () => {
    storage._setIdbBackendForTests(makeIdb());
    ereaderStore._resetEreaderStoreForTests();
    store._reset();
    document.getElementById('ereaderAddPanel').style.display = 'none';
    document.getElementById('ereaderLibraryEmpty').style.display = 'none';
    document.getElementById('ereaderBookList').replaceChildren();
    document.getElementById('ereaderBookActionsOverlay').classList.remove('active');
    document.getElementById('customModalOverlay').classList.remove('active');
});

afterEach(() => {
    storage._setIdbBackendForTests(null);
});

const rows = () => [...document.querySelectorAll('#ereaderBookList .ereader-book-row')];

// ── empty state ────────────────────────────────────────────────────────────

test('before the index is read the library says nothing - not "no books"', () => {
    lib.renderEreaderLibrary();
    assert.equal(document.getElementById('ereaderLibraryEmpty').style.display, 'none');
    assert.equal(document.getElementById('ereaderAddPanel').style.display, 'none');
    assert.equal(rows().length, 0);
});

test('an empty library shows the empty state and opens the add panel', async () => {
    await ereaderStore.loadEreader();
    lib.renderEreaderLibrary();
    assert.equal(document.getElementById('ereaderLibraryEmpty').style.display, 'block');
    assert.equal(document.getElementById('ereaderAddPanel').style.display, 'block');
    assert.equal(document.getElementById('ereaderLibraryCount').textContent, t('ereader_book_count', { count: 0 }));
});

test('with books the empty state is hidden and every book has a row', async () => {
    await ereaderStore.loadEreader();
    await imp.importEreaderJson(bookJson({ title: 'One', key: 'one' }));
    await imp.importEreaderJson(bookJson({ title: 'Two', key: 'two' }));
    lib.renderEreaderLibrary();
    assert.equal(document.getElementById('ereaderLibraryEmpty').style.display, 'none');
    assert.equal(rows().length, 2);
    assert.equal(document.getElementById('ereaderLibraryCount').textContent, t('ereader_book_count', { count: 2 }));
});

test('one book is counted in the singular', async () => {
    await ereaderStore.loadEreader();
    await imp.importEreaderJson(bookJson({ title: 'Only', key: 'only' }));
    lib.renderEreaderLibrary();
    assert.equal(document.getElementById('ereaderLibraryCount').textContent, t('ereader_book_count_one'));
});

// ── order ──────────────────────────────────────────────────────────────────

test('books sort by last read first, then by last change', () => {
    const books = [
        { id: 'a', updatedAt: 300 },
        { id: 'b', updatedAt: 100 },
        { id: 'c', updatedAt: 200 },
        { id: 'd', updatedAt: 50 }
    ];
    const progress = { b: { at: 900 }, d: { at: 500 } };
    const order = lib.sortBooks(books, id => progress[id] || null).map(b => b.id);
    assert.deepEqual(order, ['b', 'd', 'a', 'c']);
});

test('the list paints in that order', async () => {
    await ereaderStore.loadEreader();
    const first = await imp.importEreaderJson(bookJson({ title: 'Older', key: 'older' }));
    await tick(2);
    await imp.importEreaderJson(bookJson({ title: 'Newer', key: 'newer' }));
    lib.renderEreaderLibrary();
    assert.deepEqual(rows().map(r => r.querySelector('.ereader-book-title').textContent), ['Newer', 'Older']);

    await ereaderStore.setProgress(first.book.id, { sectionId: 's-1', offset: 0, percent: 40 });
    lib.renderEreaderLibrary();
    assert.deepEqual(rows().map(r => r.querySelector('.ereader-book-title').textContent), ['Older', 'Newer']);
    assert.equal(rows()[0].querySelector('.ereader-progress-value').textContent, '40%');
});

// ── escaping ───────────────────────────────────────────────────────────────

test('a title carrying markup is shown as text, never parsed', async () => {
    await ereaderStore.loadEreader();
    const evil = '<img src=x onerror="window.__pwned=1">';
    await imp.importEreaderJson(bookJson({ title: evil, author: '<b>x</b>', key: 'evil' }));
    lib.renderEreaderLibrary();
    const list = document.getElementById('ereaderBookList');
    assert.equal(list.querySelector('img'), null);
    assert.equal(list.querySelector('b'), null);
    assert.equal(rows()[0].querySelector('.ereader-book-title').textContent, evil);
});

// ── import ─────────────────────────────────────────────────────────────────

test('the same file twice is refused; another range of the same book is added', async () => {
    await ereaderStore.loadEreader();
    const a = await imp.importEreaderJson(bookJson({ key: 'itil', from: 1, to: 48 }));
    const again = await imp.importEreaderJson(bookJson({ key: 'itil', from: 1, to: 48 }));
    const next = await imp.importEreaderJson(bookJson({ key: 'itil', from: 49, to: 96 }));
    assert.equal(a.status, 'added');
    assert.equal(again.status, 'duplicate');
    assert.equal(next.status, 'added');
    assert.equal(ereaderStore.listBooks().length, 2);
});

test('a duplicate import tells the user so and adds nothing', async () => {
    await ereaderStore.loadEreader();
    await imp.importEreaderJson(bookJson({ key: 'k' }));
    const res = lib.reportImportResults([await imp.importEreaderJson(bookJson({ key: 'k' }))]);
    assert.deepEqual(res, { added: 0, duplicates: 1, failed: 0 });
    assert.equal(document.getElementById('toast').innerText, t('ereader_already_added'));
});

test('one broken file does not stop the others', async () => {
    await ereaderStore.loadEreader();
    const file = (name, body) => ({ name, text: async () => body });
    const results = await imp.importFromFiles([
        file('good.json', JSON.stringify(bookJson({ title: 'Good', key: 'good' }))),
        file('broken.json', '{ not json'),
        file('nosections.json', JSON.stringify({ ereader: { title: 'X' }, sections: [] })),
        file('also-good.json', JSON.stringify(bookJson({ title: 'Also', key: 'also' })))
    ]);
    assert.deepEqual(results.map(r => r.status), ['added', 'invalid', 'invalid', 'added']);
    assert.deepEqual(results[1].errors, ['ereader_err_invalid_json']);
    assert.deepEqual(results[2].errors, ['ereader_err_no_sections']);
    assert.deepEqual(ereaderStore.listBooks().map(b => b.title).sort(), ['Also', 'Good']);
});

test('a successful import closes the panel; a failed one leaves it open', async () => {
    await ereaderStore.loadEreader();
    const panel = document.getElementById('ereaderAddPanel');
    panel.style.display = 'block';
    lib.reportImportResults([await imp.importFromText('nope')]);
    assert.equal(panel.style.display, 'block');
    document.getElementById('customModalOverlay').classList.remove('active');

    lib.reportImportResults([await imp.importEreaderJson(bookJson({ key: 'ok' }))]);
    assert.equal(panel.style.display, 'none');
});

// ── delete ─────────────────────────────────────────────────────────────────

test('declining the delete confirmation keeps the book', async () => {
    await ereaderStore.loadEreader();
    const { book } = await imp.importEreaderJson(bookJson({ key: 'keep' }));
    const pending = lib.deleteBookWithConfirm(book.id);
    await answer('modalCancelBtn');
    assert.equal(await pending, false);
    assert.equal(ereaderStore.listBooks().length, 1);
});

test('confirming the delete removes the book and leaves a tombstone', async () => {
    await ereaderStore.loadEreader();
    const { book } = await imp.importEreaderJson(bookJson({ key: 'gone' }));
    const pending = lib.deleteBookWithConfirm(book.id);
    await answer('modalConfirmBtn');
    assert.equal(await pending, true);
    assert.equal(ereaderStore.listBooks().length, 0);
    assert.ok(ereaderStore.getTombstones()[book.id]);
});

test('the actions button opens the modal for that book, and closeEreaderModals closes it', async () => {
    await ereaderStore.loadEreader();
    await imp.importEreaderJson(bookJson({ title: 'Target', key: 'target' }));
    lib.renderEreaderLibrary();
    rows()[0].querySelector('.ereader-book-actions-btn').click();
    const overlay = document.getElementById('ereaderBookActionsOverlay');
    assert.ok(overlay.classList.contains('active'));
    assert.equal(document.getElementById('ereaderBookActionsName').textContent, 'Target');
    assert.equal(lib.closeEreaderModals(), true);
    assert.equal(overlay.classList.contains('active'), false);
    assert.equal(lib.closeEreaderModals(), false);
});

// ── reset ──────────────────────────────────────────────────────────────────

test('reset, progress branch: positions go back to zero, stamped; the books stay', async () => {
    await ereaderStore.loadEreader();
    const { book } = await imp.importEreaderJson(bookJson({ key: 'r1' }));
    await ereaderStore.setProgress(book.id, { sectionId: 's-1', offset: 0.5, percent: 70 });
    const before = ereaderStore.getProgress(book.id).at;
    await tick(2);

    const pending = lib.runEreaderReset();
    await answer('modalConfirmBtn');
    await answer('modalConfirmBtn');
    assert.equal(await pending, 'progress');

    const p = ereaderStore.getProgress(book.id);
    assert.equal(p.percent, 0);
    assert.equal(p.sectionId, null);
    assert.ok(p.at > before, 'the reset must be stamped, or an older position elsewhere wins it back');
    assert.equal(ereaderStore.listBooks().length, 1);
});

test('reset, all-books branch: every book is deleted', async () => {
    await ereaderStore.loadEreader();
    await imp.importEreaderJson(bookJson({ key: 'r2' }));
    await imp.importEreaderJson(bookJson({ key: 'r3' }));

    const pending = lib.runEreaderReset();
    await answer('modalAltBtn');
    await answer('modalConfirmBtn');
    assert.equal(await pending, 'all');
    assert.equal(ereaderStore.listBooks().length, 0);
});

test('reset: declining the second confirmation changes nothing', async () => {
    await ereaderStore.loadEreader();
    const { book } = await imp.importEreaderJson(bookJson({ key: 'r4' }));
    await ereaderStore.setProgress(book.id, { sectionId: 's-1', offset: 0, percent: 30 });

    const pending = lib.runEreaderReset();
    await answer('modalAltBtn');
    await answer('modalCancelBtn');
    assert.equal(await pending, 'cancel');
    assert.equal(ereaderStore.listBooks().length, 1);
    assert.equal(ereaderStore.getProgress(book.id).percent, 30);
});

// ── wiring ─────────────────────────────────────────────────────────────────

test('entering the library loads the store and the binding paints it', async () => {
    const idb = makeIdb();
    storage._setIdbBackendForTests(idb);
    await ereaderStore.loadEreader();
    await imp.importEreaderJson(bookJson({ title: 'Stored', key: 'stored' }));
    /* The setup write queued its own flush. Drain it and start clean, or that
       flush paints the list and hides whether the load announced itself. */
    await tick(20);
    store._reset();
    ereaderStore._resetEreaderStoreForTests();
    assert.equal(ereaderStore.isEreaderLoaded(), false);

    bindings.registerUIBindings();
    bindings.notifyViewChanged('ereaderLibrary');
    shell.applyEreaderChrome('ereaderLibrary', { goHome: () => {} });
    for (let i = 0; i < 50 && rows().length === 0; i++) await tick(5);

    assert.equal(ereaderStore.isEreaderLoaded(), true);
    assert.deepEqual(rows().map(r => r.querySelector('.ereader-book-title').textContent), ['Stored']);
});

test('a new book reaches the open library through the store, not a direct paint', async () => {
    await ereaderStore.loadEreader();
    bindings.registerUIBindings();
    bindings.notifyViewChanged('ereaderLibrary');
    await imp.importEreaderJson(bookJson({ title: 'Live', key: 'live' }));
    for (let i = 0; i < 50 && rows().length === 0; i++) await tick(5);
    assert.deepEqual(rows().map(r => r.querySelector('.ereader-book-title').textContent), ['Live']);
});

test('opening a book re-marks the last opened row when the library is shown again', async () => {
    await ereaderStore.loadEreader();
    const a = await imp.importEreaderJson(bookJson({ title: 'A', key: 'a' }));
    await imp.importEreaderJson(bookJson({ title: 'B', key: 'b' }));
    await tick(20);
    store._reset();
    lib._resetEreaderLibraryUIForTests();
    const views = [];
    lib.bindEreaderLibrary({ switchView: v => views.push(v) });
    bindings.registerUIBindings();
    bindings.notifyViewChanged('ereaderLibrary');
    lib.renderEreaderLibrary();
    assert.equal(document.querySelector('.ereader-book-row.is-last'), null);

    rows().find(r => r.dataset.bookId === a.book.id).click();
    for (let i = 0; i < 20 && views.length === 0; i++) await tick(5);
    assert.deepEqual(views, ['ereaderBook']);
    bindings.notifyViewChanged('ereaderBook');
    await tick(20);
    bindings.notifyViewChanged('ereaderLibrary');
    assert.equal(document.querySelector('.ereader-book-row.is-last')?.dataset.bookId, a.book.id,
        'the preference write must announce itself, or the library keeps the old mark');
});

test('the book actions modal is a direct child of body and sits under the shared dialog', () => {
    const overlay = document.getElementById('ereaderBookActionsOverlay');
    assert.equal(overlay.parentElement, document.body);
    const z = Number(overlay.style.zIndex);
    assert.ok(z > 10010 && z < 10100, `z-index ${z} must clear .modal-overlay (10010) and stay under customModalOverlay (10100)`);
});
