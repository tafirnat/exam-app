import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// The Gist is split across files so that the thing written most often is not
// also the thing that is largest. Answering one question schedules a sync; if
// that push carries the question library, every answer re-uploads the whole app.
// What these cases pin down is the split itself, the reassembly on the way back
// in - including the shapes older builds leave behind - and the 1MB inline limit
// the GitHub API imposes on both of the big files.

let AppState, sync;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    AppState = (await import('../src/core/state.js')).AppState;
    sync = await import('../src/core/github-sync.js');
});

const BACKUP = 'exam_app_backup.json';
const SOURCES = 'exam_app_sources.json';
const ARCHIVE = 'exam_app_archive.json';

/** A source big enough that finding it in a payload is unambiguous. */
function librarySource(id = 'src-1') {
    return {
        id,
        name: 'Anatomy',
        updatedAt: 1000,
        questions: Array.from({ length: 50 }, (_, i) => ({
            id: `q${i}`,
            text: `NEEDLE-QUESTION-BODY-${id}-${i}`,
            options: [{ id: 'a', text: 'one' }, { id: 'b', text: 'two' }]
        }))
    };
}

/** Records every request and answers each one as GitHub would. */
function captureFetch(responder) {
    const calls = [];
    global.fetch = async (url, init = {}) => {
        calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
        return responder ? responder(url, init) : { ok: true, status: 200, json: async () => ({}) };
    };
    return calls;
}

function connected() {
    AppState.githubToken = 'test-token';
    AppState.githubGistId = 'test-gist';
}

/**
 * The writes among the recorded calls.
 *
 * A push reads the Gist before it writes - it merges what is already up there
 * into the payload rather than overwriting it - so the raw call list holds a GET
 * per push. Every case below is about what gets *written*, so it counts these.
 */
function pushes(calls) {
    return calls.filter(c => c.init.method === 'PATCH');
}

beforeEach(() => {
    sync._resetSyncQueue();
    AppState.sources = [];
    AppState.stats = {};
    AppState.studyActivity = {};
    AppState.deletedSourceIds = [];
    /* The reset guards filter the merge, and a case that sets a reset timestamp
       would otherwise leave it standing for every case after it. */
    AppState.lastResetTimestamp = 0;
    AppState.lastProgressResetTimestamp = 0;
    connected();
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── The split ───────────────────────────────────────────────────────────────

test('the question library goes in the sources file and nowhere else', () => {
    AppState.sources = [librarySource()];
    AppState.stats = { 'src-1_q0': { correct: 1, wrong: 0 } };

    const files = sync.splitSyncPayload();

    assert.equal(files[SOURCES].sources.length, 1);
    assert.equal(files[SOURCES].sources[0].questions.length, 50);
    assert.ok(!('sources' in files[BACKUP]),
        'the progress file must not carry a sources key at all');
    assert.ok(!JSON.stringify(files[BACKUP]).includes('NEEDLE-QUESTION-BODY'));
});

test('the progress file keeps the parts the merge guards depend on', () => {
    AppState.deletedSourceIds = ['gone-1'];
    AppState.lastResetTimestamp = 111;
    AppState.lastProgressResetTimestamp = 222;
    AppState.stats = { 'src-1_q0': { correct: 3, wrong: 1 } };
    AppState.studyActivity = { '2026-08-02': { studied: true, questionCount: 9 } };

    const progress = sync.splitSyncPayload()[BACKUP];

    assert.deepEqual(progress.deletedSourceIds, ['gone-1']);
    assert.equal(progress.lastResetTimestamp, 111);
    assert.equal(progress.lastProgressResetTimestamp, 222);
    assert.equal(progress.stats['src-1_q0'].correct, 3);
    assert.equal(progress.studyActivity['2026-08-02'].questionCount, 9);
});

test('an offloaded archive entry stays a stub in the sources file', () => {
    AppState.sources = [{ ...librarySource('arch-1'), archived: true, offloaded: true }];

    const files = sync.splitSyncPayload();

    assert.equal(files[SOURCES].sources[0].questions.length, 0,
        'offloaded questions live in the archive file only');
});

// ── What a push actually uploads ────────────────────────────────────────────

test('a progress push does not re-upload the question library', async () => {
    AppState.sources = [librarySource()];
    const calls = captureFetch();

    await sync.syncToGist({ silent: true, scopes: sync.SyncScope.PROGRESS });

    const written = pushes(calls);
    assert.equal(written.length, 1);
    assert.deepEqual(Object.keys(written[0].body.files), [BACKUP]);
    assert.ok(!written[0].init.body.includes('NEEDLE-QUESTION-BODY'),
        'a stats-sized save must not carry a single question over the wire');
});

test('a sources push writes the sources file and leaves the rest alone', async () => {
    AppState.sources = [librarySource()];
    const calls = captureFetch();

    await sync.syncToGist({ silent: true, scopes: sync.SyncScope.SOURCES });

    assert.deepEqual(Object.keys(pushes(calls)[0].body.files), [SOURCES]);
    assert.ok(pushes(calls)[0].init.body.includes('NEEDLE-QUESTION-BODY'));
});

test('an unscoped push still writes everything, which is what a merge needs', async () => {
    AppState.sources = [librarySource()];
    const calls = captureFetch();

    await sync.syncToGist({ silent: true });

    assert.deepEqual(Object.keys(pushes(calls)[0].body.files).sort(), [BACKUP, SOURCES].sort());
});

test('a push names no file it was not asked to write, so the archive is safe', async () => {
    const calls = captureFetch();
    await sync.syncToGist({ silent: true });
    assert.ok(!(ARCHIVE in pushes(calls)[0].body.files));
});

test('the uploaded JSON is not pretty printed', async () => {
    AppState.stats = { 'src-1_q0': { correct: 1, wrong: 0 } };
    const calls = captureFetch();

    await sync.syncToGist({ silent: true, scopes: sync.SyncScope.PROGRESS });

    assert.ok(!pushes(calls)[0].body.files[BACKUP].content.includes('\n'),
        'indentation is re-uploaded on every single save');
});

// ── The debounce window ─────────────────────────────────────────────────────

test('scopes queued in one debounce window are pushed together', async () => {
    AppState.sources = [librarySource()];
    const calls = captureFetch();

    sync.scheduleSync(10, sync.SyncScope.PROGRESS);
    sync.scheduleSync(10, sync.SyncScope.SOURCES);
    await sleep(60);

    assert.equal(pushes(calls).length, 1, 'one push, not one per scope');
    assert.deepEqual(Object.keys(pushes(calls)[0].body.files).sort(), [BACKUP, SOURCES].sort());
});

test('repeated progress saves stay a progress-only push', async () => {
    AppState.sources = [librarySource()];
    const calls = captureFetch();

    sync.scheduleSync(10, sync.SyncScope.PROGRESS);
    sync.scheduleSync(10, sync.SyncScope.PROGRESS);
    sync.scheduleSync(10, sync.SyncScope.PROGRESS);
    await sleep(60);

    assert.equal(pushes(calls).length, 1);
    assert.deepEqual(Object.keys(pushes(calls)[0].body.files), [BACKUP]);
});

test('a push that arrives mid-flight is re-queued, not dropped', async () => {
    AppState.sources = [librarySource()];

    let release;
    const inFlight = new Promise(r => { release = r; });
    const calls = captureFetch(async () => {
        await inFlight;
        return { ok: true, status: 200, json: async () => ({}) };
    });

    const first = sync.syncToGist({ silent: true, scopes: sync.SyncScope.PROGRESS });
    // Still in flight: the sources push has nowhere to go yet.
    const second = await sync.syncToGist({ silent: true, scopes: sync.SyncScope.SOURCES });
    assert.equal(second, false);

    release();
    await first;

    // Whatever re-armed the timer, the queued scope has to survive to the push.
    sync.scheduleSync(10, sync.SyncScope.PROGRESS);
    await sleep(60);

    const written = pushes(calls);
    const last = written[written.length - 1];
    assert.deepEqual(Object.keys(last.body.files).sort(), [BACKUP, SOURCES].sort(),
        'the dropped sources push would otherwise be the only one carrying that file');
});

// ── The save functions users actually trigger ───────────────────────────────
/* The unit cases above hand syncToGist() its scopes directly. These go through
   the real path instead - state.js names the scope across a dynamic import, and
   a typo there costs nothing visible: the push just quietly carries everything
   again. */

test('answering a question pushes progress only, not the library', async () => {
    const { saveStats } = await import('../src/core/state.js');
    AppState.sources = [librarySource()];
    AppState.stats = { 'src-1_q0': { correct: 1, wrong: 0, lastReview: '2026-08-02' } };
    const calls = captureFetch();

    saveStats();                       // debounced at 1500ms
    await sleep(1700);

    assert.equal(pushes(calls).length, 1);
    assert.deepEqual(Object.keys(pushes(calls)[0].body.files), [BACKUP]);
    assert.ok(!pushes(calls)[0].init.body.includes('NEEDLE-QUESTION-BODY'));
});

test('a source edit is the one save that does push the library', async () => {
    const { saveSources } = await import('../src/core/state.js');
    AppState.sources = [librarySource('edited')];
    const calls = captureFetch();

    saveSources();                     // debounced at 300ms
    await sleep(500);

    assert.equal(pushes(calls).length, 1);
    assert.deepEqual(Object.keys(pushes(calls)[0].body.files), [SOURCES]);
});

test('a study-activity save pushes progress only', async () => {
    const { saveStudyActivity } = await import('../src/core/state.js');
    AppState.sources = [librarySource()];
    AppState.studyActivity = { '2026-08-02': { studied: true, questionCount: 12 } };
    const calls = captureFetch();

    saveStudyActivity();
    await sleep(500);

    assert.equal(pushes(calls).length, 1);
    assert.deepEqual(Object.keys(pushes(calls)[0].body.files), [BACKUP]);
});

// ── A push must not overwrite what it has not seen ──────────────────────────
/* A pull happens at boot and on an explicit sync; a push happens on every
   answered question. So the pushing device is routinely behind the Gist, and a
   push that simply serialised local state wrote that staleness over the other
   device's work. The daily activity map is where it showed: the focus track is
   written only when a session is flushed or finished, so it was the first thing
   to be erased - which is exactly what "the two devices disagree about Odak
   Seri" looked like from the outside. */

/** Answers a GET with `remoteFiles` and accepts any PATCH. */
function gistServer(remoteFiles) {
    return async (url, init = {}) => {
        if ((init.method || 'GET') === 'GET') {
            return { ok: true, status: 200, json: async () => gistOf(remoteFiles) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
    };
}

/** The progress file a push wrote, parsed. */
function writtenProgress(calls) {
    return JSON.parse(pushes(calls)[0].body.files[BACKUP].content);
}

test('a push keeps the days only the remote knows about', async () => {
    AppState.studyActivity = { '2026-08-02': { studied: true, questionCount: 20 } };
    const calls = captureFetch(gistServer({
        [BACKUP]: {
            version: 4,
            lastUpdated: 500,
            studyActivity: { '2026-08-01': { studied: true, questionCount: 30 } }
        }
    }));

    await sync.syncToGist({ silent: true, scopes: sync.SyncScope.PROGRESS });

    const activity = writtenProgress(calls).studyActivity;
    assert.ok(activity['2026-08-01'], 'the other device\'s day must survive this push');
    assert.equal(activity['2026-08-01'].questionCount, 30);
    assert.equal(activity['2026-08-02'].questionCount, 20);
});

test('a push does not erase the focus track the other device recorded', async () => {
    /* Focus answers are a subset of all answers, so a record always has
       focusQuestionCount <= questionCount; the fixtures keep that true. This
       device answered 12 with no focus source running, the other answered 15
       that all counted for focus. */
    AppState.studyActivity = {
        '2026-08-02': { studied: true, questionCount: 12, focusStudied: false, focusQuestionCount: 0 }
    };
    const calls = captureFetch(gistServer({
        [BACKUP]: {
            version: 4,
            lastUpdated: 500,
            studyActivity: {
                '2026-08-02': { studied: true, questionCount: 15, focusStudied: true, focusQuestionCount: 15 }
            }
        }
    }));

    await sync.syncToGist({ silent: true, scopes: sync.SyncScope.PROGRESS });

    const day = writtenProgress(calls).studyActivity['2026-08-02'];
    assert.equal(day.focusQuestionCount, 15, 'the focus count must not be written back to zero');
    assert.equal(day.focusStudied, true);
    assert.equal(day.questionCount, 15);
});

test('a push keeps remote stats this device has never seen', async () => {
    // No reset has ever happened here, so nothing filters the remote stats out.
    AppState.lastProgressResetTimestamp = 0;
    AppState.lastResetTimestamp = 0;
    AppState.stats = { 'src-1_q0': { correct: 2, wrong: 0 } };
    const calls = captureFetch(gistServer({
        [BACKUP]: {
            version: 4,
            lastUpdated: 500,
            stats: { 'src-1_q9': { correct: 7, wrong: 1 } }
        }
    }));

    await sync.syncToGist({ silent: true, scopes: sync.SyncScope.PROGRESS });

    const stats = writtenProgress(calls).stats;
    assert.ok(stats['src-1_q9'], 'a stat only the remote had must survive the push');
    assert.ok(stats['src-1_q0']);
});

test('a push that cannot read the remote does not write at all', async () => {
    AppState.studyActivity = { '2026-08-02': { studied: true, questionCount: 5 } };
    const calls = captureFetch(async (url, init = {}) => {
        if ((init.method || 'GET') === 'GET') return { ok: false, status: 500, headers: new Map() };
        return { ok: true, status: 200, json: async () => ({}) };
    });

    const ok = await sync.syncToGist({ silent: true, scopes: sync.SyncScope.PROGRESS });

    assert.equal(ok, false);
    assert.equal(pushes(calls).length, 0,
        'an unreadable remote is the one case where writing would lose data');
});

test('the push that follows a merge does not re-read the Gist', async () => {
    const calls = captureFetch(gistServer({ [BACKUP]: { version: 4, lastUpdated: 1 } }));

    await sync.syncToGist({ silent: true, scopes: sync.SyncScope.PROGRESS, skipRemoteMerge: true });

    assert.equal(calls.filter(c => (c.init.method || 'GET') === 'GET').length, 0);
    assert.equal(pushes(calls).length, 1);
});

// ── Reading it back ─────────────────────────────────────────────────────────

/** A Gist response with the given files inlined. */
function gistOf(files) {
    const out = {};
    for (const [name, value] of Object.entries(files)) {
        out[name] = { content: typeof value === 'string' ? value : JSON.stringify(value) };
    }
    return { files: out };
}

test('the two files are reassembled into one payload', async () => {
    const gist = gistOf({
        [BACKUP]: { version: 4, lastUpdated: 500, stats: { a: 1 }, deletedSourceIds: ['x'] },
        [SOURCES]: { version: 4, lastUpdated: 700, sources: [librarySource()] }
    });

    const payload = await sync.readRemotePayload(gist);

    assert.equal(payload.sources.length, 1);
    assert.deepEqual(payload.deletedSourceIds, ['x']);
    assert.equal(payload.lastUpdated, 700,
        'the remote is as fresh as its freshest file - the reset guards read this');
});

test('a Gist written by an older build still reads', async () => {
    const gist = gistOf({
        [BACKUP]: { version: 3, lastUpdated: 500, sources: [librarySource('old-1')], stats: {} }
    });

    const payload = await sync.readRemotePayload(gist);

    assert.equal(payload.sources.length, 1);
    assert.equal(payload.sources[0].id, 'old-1');
});

test('an older build that rewrote the backup file wins over a stale sources file', async () => {
    // The old build pushes the whole payload into the backup file and never
    // touches the sources file, so the newer write is the one to believe.
    const gist = gistOf({
        [BACKUP]: { version: 3, lastUpdated: 900, sources: [librarySource('from-old-build')] },
        [SOURCES]: { version: 4, lastUpdated: 100, sources: [librarySource('stale')] }
    });

    const payload = await sync.readRemotePayload(gist);

    assert.equal(payload.sources[0].id, 'from-old-build');
});

test('the split sources file wins when it is the newer write', async () => {
    const gist = gistOf({
        [BACKUP]: { version: 3, lastUpdated: 100, sources: [librarySource('stale')] },
        [SOURCES]: { version: 4, lastUpdated: 900, sources: [librarySource('current')] }
    });

    const payload = await sync.readRemotePayload(gist);

    assert.equal(payload.sources[0].id, 'current');
});

test('a Gist with no backup file yields no payload rather than an empty one', async () => {
    assert.equal(await sync.readRemotePayload(gistOf({})), null);
});

test('an empty sources file is not read as "the library was deleted"', async () => {
    const gist = gistOf({
        [BACKUP]: { version: 3, lastUpdated: 900, sources: [librarySource('kept')] },
        [SOURCES]: '   '
    });

    const payload = await sync.readRemotePayload(gist);

    assert.equal(payload.sources[0].id, 'kept');
});

// ── The 1MB inline limit ────────────────────────────────────────────────────

test('a sources file over the inline limit is read from raw_url', async () => {
    const raw = JSON.stringify({ version: 4, lastUpdated: 700, sources: [librarySource('big')] });
    global.fetch = async (url) => {
        assert.equal(url, 'https://gist.example/raw/sources');
        return { ok: true, status: 200, text: async () => raw };
    };

    const gist = {
        files: {
            [BACKUP]: { content: JSON.stringify({ version: 4, lastUpdated: 500 }) },
            [SOURCES]: { truncated: true, raw_url: 'https://gist.example/raw/sources' }
        }
    };

    const payload = await sync.readRemotePayload(gist);
    assert.equal(payload.sources[0].id, 'big');
});

test('a truncated backup file is read from raw_url instead of failing the sync', async () => {
    // Before the files were split this was unhandled: a backup file past 1MB came
    // back with no content and JSON.parse(undefined) killed every sync silently.
    const raw = JSON.stringify({ version: 3, lastUpdated: 500, stats: { a: 1 } });
    global.fetch = async () => ({ ok: true, status: 200, text: async () => raw });

    const gist = {
        files: { [BACKUP]: { truncated: true, raw_url: 'https://gist.example/raw/backup' } }
    };

    const payload = await sync.readRemotePayload(gist);
    assert.equal(payload.stats.a, 1);
});

test('a truncated file with no raw_url throws rather than reporting empty data', async () => {
    const gist = { files: { [BACKUP]: { truncated: true } } };
    await assert.rejects(() => sync.readRemotePayload(gist), /truncated/);
});
