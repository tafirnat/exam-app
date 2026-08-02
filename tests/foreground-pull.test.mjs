import test, { before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/* A push fires on every answered question; a pull fired at boot and on the sync
   button, and nowhere else. Three devices left open therefore each kept their
   own view of the day - the Gist held the union and none of them read it back -
   and since the streak, the ring and the token count are all derived from local
   studyActivity, one body of work showed up as three different numbers.

   These cases pin the pull to the moment the app comes back in front of the
   user, and pin down the three things that moment must not do: fire while
   someone is mid-question, fire twice for one alt-tab, or fire at all when the
   app is not connected. */

let AppState, sync, store;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    AppState = (await import('../src/core/state.js')).AppState;
    store = await import('../src/core/store.js');
    sync = await import('../src/core/github-sync.js');

    /* Registers the listeners the way boot does. The pull it makes on the way
       through is the boot pull; every case below starts from a clean count. */
    connected();
    countingFetch();
    await sync.initSync();
});

/** A Gist that parses, so a pull runs to completion instead of failing early. */
function countingFetch() {
    const calls = { get: 0, patch: 0 };
    global.fetch = async (url, init = {}) => {
        if ((init.method || 'GET') === 'GET') calls.get++;
        else calls.patch++;
        return {
            ok: true,
            status: 200,
            headers: new global.window.Headers({}),
            json: async () => ({
                files: {
                    'exam_app_backup.json': {
                        content: JSON.stringify({
                            version: 4,
                            lastUpdated: Date.now(),
                            stats: {},
                            studyActivity: {},
                            continuityConfig: {}
                        })
                    }
                }
            }),
            text: async () => ''
        };
    };
    return calls;
}

function connected() {
    AppState.githubToken = 'test-token';
    AppState.githubGistId = 'test-gist';
}

function setVisibility(value) {
    Object.defineProperty(document, 'visibilityState', { value, configurable: true });
}

/** The app coming back in front of the user, as the browser reports it. */
function returnToForeground() {
    setVisibility('visible');
    document.dispatchEvent(new window.Event('visibilitychange'));
}

/** Lets the handler's un-awaited syncFromGist run to completion. */
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

beforeEach(() => {
    sync._resetSyncQueue();
    connected();
    store.setActiveView('home');
    setVisibility('visible');
    AppState.sources = [];
    AppState.stats = {};
    AppState.studyActivity = {};
    AppState.continuityConfig = {};
});

afterEach(() => {
    store._reset();
});

test('returning to the foreground pulls', async () => {
    const calls = countingFetch();

    returnToForeground();
    await settle();

    assert.equal(calls.get, 1);
});

test('a desktop window regaining focus counts as returning', async () => {
    const calls = countingFetch();

    window.dispatchEvent(new window.Event('focus'));
    await settle();

    assert.equal(calls.get, 1);
});

test('a bfcache restore counts as returning', async () => {
    const calls = countingFetch();

    window.dispatchEvent(new window.Event('pageshow'));
    await settle();

    assert.equal(calls.get, 1);
});

test('the tab going away does not pull', async () => {
    const calls = countingFetch();

    setVisibility('hidden');
    document.dispatchEvent(new window.Event('visibilitychange'));
    await settle();

    assert.equal(calls.get, 0);
});

test('a second return inside the interval does not pull again', async () => {
    const calls = countingFetch();

    returnToForeground();
    await settle();
    returnToForeground();
    window.dispatchEvent(new window.Event('focus'));
    await settle();

    // One alt-tab out and back fires several of these events; they are one
    // return, and they cost one request.
    assert.equal(calls.get, 1);
});

test('the test view holds the pull back', async () => {
    const calls = countingFetch();
    store.setActiveView('test');

    returnToForeground();
    await settle();

    // A pull replaces AppState.stats and rebuilds the question pool. Doing that
    // under someone who is mid-question is worse than a stale streak.
    assert.equal(calls.get, 0);
});

test('the mid-test stats preview holds the pull back too', async () => {
    const calls = countingFetch();
    store.setActiveView('statsPreview');

    returnToForeground();
    await settle();

    // switchView() declines to flush on this view for the same reason: the
    // session is still live and the user is coming back to it.
    assert.equal(calls.get, 0);
});

test('leaving the test view lets the held-back pull happen', async () => {
    const calls = countingFetch();
    store.setActiveView('test');

    returnToForeground();
    await settle();
    assert.equal(calls.get, 0);

    store.setActiveView('home');
    returnToForeground();
    await settle();

    // The interval must not have been consumed by the pull that never ran.
    assert.equal(calls.get, 1);
});

test('a disconnected app never pulls', async () => {
    const calls = countingFetch();
    AppState.githubToken = null;
    AppState.githubGistId = null;

    returnToForeground();
    await settle();

    assert.equal(calls.get, 0);
});

test('an explicit sync consumes the interval too', async () => {
    const calls = countingFetch();

    await sync.syncFromGist({ silent: true });
    assert.equal(calls.get, 1);

    returnToForeground();
    await settle();

    // Reading the same Gist again seconds later would answer the same thing.
    assert.equal(calls.get, 1);
});
