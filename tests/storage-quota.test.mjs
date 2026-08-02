import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/* localStorage fills up silently and then simply refuses to write. persist()
   catches that, but by then the save has already been lost. These cases pin the
   ladder that goes in front of the wall: how usage is measured, when each rung
   speaks, which sources it offers, and - the part that decides whether the
   advice is honest - when archiving is not offered at all, because without
   GitHub it frees nothing. */

let AppState, storage, notice, sync;

before(async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
        <div id="testView" style="display: none;"></div>
        <div id="storageNoticeOverlay" class="modal-overlay">
            <div id="storageNoticeTitle"></div>
            <div id="storageNoticeSubtitle"></div>
            <div id="storageNoticeHint" style="display: none;"></div>
            <div id="storageNoticeEmpty" style="display: none;"></div>
            <div id="storageNoticeList"></div>
        </div>
    </body></html>`, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    ({ AppState } = await import('../src/core/state.js'));
    storage = await import('../src/core/storage.js');
    sync = await import('../src/core/github-sync.js');
    notice = await import('../src/features/sources/storage-notice.js');
});

/**
 * Fills the store with `bytes` worth of padding, spread over many keys the way
 * real data is. One giant key would also be the largest value, and the estimate
 * subtracts that as rewrite headroom - so a single blob would leave zero room by
 * construction and hide whatever the case was actually about.
 */
function fillTo(bytes, chunkBytes = 64 * 1024) {
    const chunkChars = chunkBytes / 2;
    let written = 0;
    let i = 0;
    while (written + chunkBytes <= bytes) {
        localStorage.setItem(`pad_${i++}`, 'x'.repeat(chunkChars));
        written += chunkBytes;
    }
    const restChars = Math.max(0, Math.floor((bytes - written) / 2));
    if (restChars > 0) localStorage.setItem(`pad_${i}`, 'x'.repeat(restChars));
}

function sourceWith({ id, name = id, questions = 2, studiedDaysAgo = null, archived = false }) {
    const qs = Array.from({ length: questions }, (_, i) => ({ id: `q${i}`, text: `q ${i}` }));
    if (studiedDaysAgo !== null) {
        const at = new Date(Date.now() - studiedDaysAgo * 86400000).toISOString();
        qs.forEach(q => { AppState.stats[`${id}_${q.id}`] = { correct: 1, wrong: 0, lastReview: at }; });
    }
    return { id, name, questions: qs, archived, updatedAt: 0, lastUsed: 0 };
}

beforeEach(() => {
    localStorage.clear();
    notice._resetStorageNotice();
    AppState.sources = [];
    AppState.stats = {};
    AppState.currentSourceKey = null;
    AppState.githubToken = null;
    AppState.githubGistId = null;
    AppState.syncFailureCount = 0;
    AppState.syncFailureKind = null;
    document.getElementById('storageNoticeOverlay').classList.remove('active');
    document.getElementById('testView').style.display = 'none';
});

// ── Measuring ───────────────────────────────────────────────────────────────

test('usage counts key and value as UTF-16, which is what localStorage stores', () => {
    localStorage.setItem('ab', 'cde');   // (2 + 3) * 2 = 10 bytes
    const usage = storage.measureStorageUsage();
    assert.equal(usage.usedBytes, 10);
});

test('a non-ASCII value is not undercounted', () => {
    // Turkish content is the normal case here, not an edge case: counting bytes
    // as if every character were one would understate the library.
    localStorage.setItem('k', 'ğüşiöç');
    assert.equal(storage.measureStorageUsage().usedBytes, (1 + 6) * 2);
});

test('the largest single value is reported - a rewrite needs room for it', () => {
    localStorage.setItem('small', 'x'.repeat(10));
    localStorage.setItem('library', 'x'.repeat(5000));
    assert.equal(storage.measureStorageUsage().largestValueBytes, 10000);
});

test('usage survives a store that cannot be read', () => {
    const original = Object.getOwnPropertyDescriptor(global, 'localStorage');
    Object.defineProperty(global, 'localStorage', {
        configurable: true,
        get() { throw new Error('storage disabled'); }
    });
    try {
        const usage = storage.measureStorageUsage();
        assert.equal(usage.ratio, 0, 'a store that cannot be read cannot be filled either');
    } finally {
        Object.defineProperty(global, 'localStorage', original);
    }
});

// ── The two rungs ───────────────────────────────────────────────────────────

test('an empty store is on no rung at all', () => {
    assert.equal(notice.evaluateStorageLevel(), null);
});

test('60% reaches the suggestion rung', () => {
    fillTo(storage.ASSUMED_QUOTA_BYTES * 0.62);
    assert.equal(notice.evaluateStorageLevel(), notice.QuotaLevel.SUGGEST);
});

test('85% reaches the critical rung', () => {
    fillTo(storage.ASSUMED_QUOTA_BYTES * 0.87);
    assert.equal(notice.evaluateStorageLevel(), notice.QuotaLevel.CRITICAL);
});

test('just under a threshold stays quiet', () => {
    fillTo(storage.ASSUMED_QUOTA_BYTES * 0.55);
    assert.equal(notice.evaluateStorageLevel(), null);
});

// ── Saying it in questions, not percentages ─────────────────────────────────

test('the remaining estimate is rounded, not a fake-precise number', () => {
    fillTo(storage.ASSUMED_QUOTA_BYTES * 0.5);
    const remaining = notice.estimateRemainingQuestions();
    assert.ok(remaining > 0);
    assert.equal(remaining % 100, 0, 'a four-digit estimate claiming single-question precision is a lie');
});

test('a full store offers no remaining questions rather than a negative number', () => {
    fillTo(storage.ASSUMED_QUOTA_BYTES * 1.2);
    assert.equal(notice.estimateRemainingQuestions(), 0);
});

test('the estimate leaves room to rewrite the biggest value', () => {
    // Half the quota used, and nearly all of it in one blob that must be
    // rewritable. What is really free is much less than the arithmetic says.
    localStorage.setItem('focus_app_sources', 'x'.repeat(storage.ASSUMED_QUOTA_BYTES * 0.25));
    const usage = storage.measureStorageUsage();
    const naive = (usage.quotaBytes - usage.usedBytes);
    const withHeadroom = (usage.quotaBytes - usage.usedBytes - usage.largestValueBytes);
    assert.ok(withHeadroom < naive);
    assert.ok(notice.estimateRemainingQuestions(usage) <= naive / 600);
});

// ── Which sources get offered ───────────────────────────────────────────────

test('the coldest source comes first, by real study dates', () => {
    AppState.sources = [
        sourceWith({ id: 'warm', studiedDaysAgo: 2 }),
        sourceWith({ id: 'cold', studiedDaysAgo: 200 }),
        sourceWith({ id: 'mid', studiedDaysAgo: 40 })
    ];
    assert.deepEqual(notice.coldestSources().map(c => c.source.id), ['cold', 'mid', 'warm']);
});

test('a source left switched on but never opened is not treated as fresh', () => {
    // lastUsed is written when a source is toggled on, so it says nothing about
    // whether the user has actually studied it since.
    const stale = sourceWith({ id: 'stale', studiedDaysAgo: 300 });
    stale.lastUsed = Date.now();
    const busy = sourceWith({ id: 'busy', studiedDaysAgo: 1 });
    AppState.sources = [busy, stale];

    assert.equal(notice.coldestSources()[0].source.id, 'stale');
});

test('a never-studied source sorts coldest of all', () => {
    AppState.sources = [
        sourceWith({ id: 'old', studiedDaysAgo: 500 }),
        sourceWith({ id: 'untouched' })
    ];
    assert.equal(notice.coldestSources()[0].source.id, 'untouched');
});

test('stats are matched on the whole key, so one source id cannot steal another\'s', () => {
    // "src" is a prefix of "src_2": splitting a stat key on "_" to find the
    // source would hand src_2's reviews to src.
    const prefix = sourceWith({ id: 'src' });                       // never studied
    const longer = sourceWith({ id: 'src_2', studiedDaysAgo: 1 });  // studied yesterday
    AppState.sources = [prefix, longer];

    assert.equal(notice.lastStudiedAt(prefix), 0,
        'src has no reviews of its own - src_2\'s must not count for it');
    assert.ok(notice.lastStudiedAt(longer) > 0);
});

test('the source being studied right now is never offered up for deletion', () => {
    AppState.sources = [
        sourceWith({ id: 'focus', studiedDaysAgo: 900 }),
        sourceWith({ id: 'other', studiedDaysAgo: 10 })
    ];
    AppState.currentSourceKey = 'focus';
    assert.deepEqual(notice.coldestSources().map(c => c.source.id), ['other']);
});

test('already archived sources are not offered again', () => {
    AppState.sources = [
        sourceWith({ id: 'gone', studiedDaysAgo: 900, archived: true }),
        sourceWith({ id: 'live', studiedDaysAgo: 10 })
    ];
    assert.deepEqual(notice.coldestSources().map(c => c.source.id), ['live']);
});

test('only three are offered - a list of ten is a chore, not an offer', () => {
    AppState.sources = Array.from({ length: 9 }, (_, i) =>
        sourceWith({ id: `s${i}`, studiedDaysAgo: 100 + i }));
    assert.equal(notice.coldestSources().length, 3);
});

// ── Archiving only counts when it actually frees space ──────────────────────

test('without GitHub, archiving is not offered - it would free nothing', () => {
    AppState.githubToken = null;
    AppState.githubGistId = null;
    assert.equal(notice.archivingFreesSpace(), false);
});

test('with a working GitHub connection, archiving is offered', () => {
    AppState.githubToken = 'tok';
    AppState.githubGistId = 'gist';
    assert.equal(notice.archivingFreesSpace(), true);
});

test('with a dead token, archiving is not offered either', () => {
    // The offload would fail, archive.js would (correctly) keep the questions on
    // the device, and the user would have "fixed" their storage by freeing zero
    // bytes.
    AppState.githubToken = 'tok';
    AppState.githubGistId = 'gist';
    AppState.syncFailureCount = 1;
    AppState.syncFailureKind = sync.SyncFailure.AUTH;
    assert.equal(notice.archivingFreesSpace(), false);
});

test('the dialog says why archiving is missing instead of hiding it silently', () => {
    fillTo(storage.ASSUMED_QUOTA_BYTES * 0.9);
    AppState.sources = [sourceWith({ id: 'cold', studiedDaysAgo: 100 })];

    notice.maybeShowStorageNotice();

    const hint = document.getElementById('storageNoticeHint');
    assert.notEqual(hint.style.display, 'none');
    assert.ok(hint.innerText.trim().length > 0);
});

// ── When it speaks ──────────────────────────────────────────────────────────

test('a store below the first rung shows nothing', () => {
    assert.equal(notice.maybeShowStorageNotice(), false);
    assert.equal(document.getElementById('storageNoticeOverlay').classList.contains('active'), false);
});

test('the suggestion appears once and then not again the same day', () => {
    fillTo(storage.ASSUMED_QUOTA_BYTES * 0.65);
    assert.equal(notice.maybeShowStorageNotice(), true);

    notice._resetStorageNotice();   // a new session, same day
    assert.equal(notice.maybeShowStorageNotice(), false);
});

test('the critical warning ignores the date and speaks every session', () => {
    fillTo(storage.ASSUMED_QUOTA_BYTES * 0.9);
    assert.equal(notice.maybeShowStorageNotice(), true);

    notice._resetStorageNotice();
    assert.equal(notice.maybeShowStorageNotice(), true);
});

test('it speaks only once within one session', () => {
    fillTo(storage.ASSUMED_QUOTA_BYTES * 0.9);
    assert.equal(notice.maybeShowStorageNotice(), true);
    assert.equal(notice.maybeShowStorageNotice(), false, 'once per session, not once per home visit');
});

test('nothing interrupts a test in progress', () => {
    fillTo(storage.ASSUMED_QUOTA_BYTES * 0.95);
    document.getElementById('testView').style.display = 'flex';

    assert.equal(notice.maybeShowStorageNotice(), false);

    // Deferred, not cancelled: back on the home screen it still has its say.
    document.getElementById('testView').style.display = 'none';
    assert.equal(notice.maybeShowStorageNotice(), true);
});

test('it does not stack on top of another dialog', () => {
    fillTo(storage.ASSUMED_QUOTA_BYTES * 0.95);
    const other = document.createElement('div');
    other.className = 'modal-overlay active';
    document.body.appendChild(other);
    try {
        assert.equal(notice.maybeShowStorageNotice(), false);
    } finally {
        other.remove();
    }
});

// ── What the dialog puts on screen ──────────────────────────────────────────

test('the dialog lists the cold sources with an action per row', () => {
    fillTo(storage.ASSUMED_QUOTA_BYTES * 0.9);
    AppState.githubToken = 'tok';
    AppState.githubGistId = 'gist';
    AppState.sources = [
        sourceWith({ id: 'cold', name: 'Eski Kaynak', studiedDaysAgo: 120 }),
        sourceWith({ id: 'warm', name: 'Güncel', studiedDaysAgo: 1 })
    ];

    notice.maybeShowStorageNotice();

    const rows = document.getElementById('storageNoticeList').children;
    assert.equal(rows.length, 2);
    assert.ok(rows[0].textContent.includes('Eski Kaynak'), 'the coldest source leads');
    // Archive, download-and-delete, delete.
    assert.equal(rows[0].querySelectorAll('button').length, 3);
});

test('without GitHub each row drops to two actions', () => {
    fillTo(storage.ASSUMED_QUOTA_BYTES * 0.9);
    AppState.sources = [sourceWith({ id: 'cold', studiedDaysAgo: 120 })];

    notice.maybeShowStorageNotice();

    const row = document.getElementById('storageNoticeList').children[0];
    assert.equal(row.querySelectorAll('button').length, 2);
});

test('the headline talks about questions, never a percentage', () => {
    fillTo(storage.ASSUMED_QUOTA_BYTES * 0.65);
    AppState.sources = [sourceWith({ id: 'cold', studiedDaysAgo: 120, questions: 40 })];

    notice.maybeShowStorageNotice();

    const text = document.getElementById('storageNoticeSubtitle').innerText;
    assert.ok(!text.includes('%'), `a percentage is precision the browser does not offer: "${text}"`);
    assert.ok(/\d/.test(text));
});

test('a user with nothing to offer gets the empty state, not three blank rows', () => {
    fillTo(storage.ASSUMED_QUOTA_BYTES * 0.9);
    AppState.sources = [];

    notice.maybeShowStorageNotice();

    assert.equal(document.getElementById('storageNoticeList').children.length, 0);
    assert.notEqual(document.getElementById('storageNoticeEmpty').style.display, 'none');
});

test('the dialog can be opened deliberately even when storage is fine', () => {
    assert.equal(notice.maybeShowStorageNotice(), false);
    assert.equal(notice.maybeShowStorageNotice({ force: true }), true);
});
