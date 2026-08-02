import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/* A scheduled push is silent by design. Its failure used to be silent too: it
   went to console.error and nowhere else, while lastSyncTime - the one number
   the UI showed - moves only on success. The result was a user whose token had
   expired reading a plausible "last sync" line for weeks with no second copy
   behind it.
   These cases pin down the state that failure now leaves behind: a persisted
   consecutive-failure streak, a kind that separates "your token is dead" from
   "the network blipped", and a badge that only speaks when it has something
   worth saying. */

let AppState, sync, initState;

before(async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
        <button id="githubSyncBtn"><span id="githubSyncLabel"></span></button>
        <div id="githubSyncDropdown">
            <div id="githubDropdownUser"></div>
            <div id="githubDropdownLastSync"></div>
            <div id="githubDropdownHealth" style="display: none;"></div>
        </div>
    </body></html>`, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    ({ AppState, initState } = await import('../src/core/state.js'));
    sync = await import('../src/core/github-sync.js');
});

/** Answers a PATCH the way GitHub would, with real Headers so 403 stays honest. */
function respondWith({ ok = true, status = 200, headers = {} } = {}) {
    global.fetch = async () => ({
        ok,
        status,
        headers: new global.window.Headers(headers),
        json: async () => ({}),
        text: async () => ''
    });
}

/** fetch itself rejecting - offline, DNS, a dropped connection. */
function respondOffline() {
    global.fetch = async () => { throw new TypeError('Failed to fetch'); };
}

beforeEach(() => {
    localStorage.clear();
    sync._resetSyncQueue();
    AppState.githubToken = 'test-token';
    AppState.githubGistId = 'test-gist';
    AppState.githubUser = { login: 'octocat', name: 'Octo Cat' };
    AppState.sources = [];
    AppState.stats = {};
    AppState.studyActivity = {};
    AppState.lastSyncTime = 0;
    AppState.syncFailureCount = 0;
    AppState.syncFailureKind = null;
});

// ── The streak ──────────────────────────────────────────────────────────────

test('a failed silent push leaves a recorded failure behind', async () => {
    respondWith({ ok: false, status: 500 });

    await sync.syncToGist({ silent: true });

    const health = sync.getSyncHealth();
    assert.equal(health.failureCount, 1);
    assert.equal(health.kind, sync.SyncFailure.NETWORK);
});

test('lastSyncTime does not move on a failed push', async () => {
    AppState.lastSyncTime = 1000;
    respondWith({ ok: false, status: 500 });

    await sync.syncToGist({ silent: true });

    assert.equal(AppState.lastSyncTime, 1000,
        'lastSyncTime means the last SUCCESS - a failure must not refresh it');
    assert.equal(sync.getSyncHealth().lastSuccessAt, 1000);
});

test('consecutive failures accumulate', async () => {
    respondWith({ ok: false, status: 500 });

    await sync.syncToGist({ silent: true });
    await sync.syncToGist({ silent: true });
    await sync.syncToGist({ silent: true });

    assert.equal(sync.getSyncHealth().failureCount, 3);
});

test('a success clears the streak', async () => {
    respondWith({ ok: false, status: 500 });
    await sync.syncToGist({ silent: true });
    await sync.syncToGist({ silent: true });
    assert.equal(sync.getSyncHealth().failureCount, 2);

    respondWith({ ok: true, status: 200 });
    await sync.syncToGist({ silent: true });

    const health = sync.getSyncHealth();
    assert.equal(health.failureCount, 0);
    assert.equal(health.kind, null);
    assert.ok(health.lastSuccessAt > 0);
});

test('the streak survives a reload - the failure it reports outlives the session', async () => {
    respondWith({ ok: false, status: 401 });
    await sync.syncToGist({ silent: true });
    await sync.syncToGist({ silent: true });

    // Wipe the in-memory copy the way a fresh page load would.
    AppState.syncFailureCount = 0;
    AppState.syncFailureKind = null;
    initState({ force: true });

    const health = sync.getSyncHealth();
    assert.equal(health.failureCount, 2);
    assert.equal(health.kind, sync.SyncFailure.AUTH);
});

test('logging out drops the streak with the connection', async () => {
    respondWith({ ok: false, status: 401 });
    await sync.syncToGist({ silent: true });

    // logout() prompts, and the prompt is not what this case is about.
    document.getElementById('githubSyncDropdown').innerHTML += '';
    global.window.confirm = () => false;
    await sync.logout();

    assert.equal(sync.getSyncHealth().failureCount, 0);
    assert.equal(localStorage.getItem('focus_app_sync_failures'), null);
});

// ── Telling a dead token from a bad minute ──────────────────────────────────

test('401 is an auth failure - only the user can fix it', async () => {
    respondWith({ ok: false, status: 401 });
    await sync.syncToGist({ silent: true });
    assert.equal(sync.getSyncHealth().kind, sync.SyncFailure.AUTH);
});

test('403 without rate-limit headers is an auth failure', async () => {
    respondWith({ ok: false, status: 403 });
    await sync.syncToGist({ silent: true });
    assert.equal(sync.getSyncHealth().kind, sync.SyncFailure.AUTH);
});

test('403 with the rate limit exhausted is NOT read as a dead token', async () => {
    respondWith({ ok: false, status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    await sync.syncToGist({ silent: true });
    assert.equal(sync.getSyncHealth().kind, sync.SyncFailure.NETWORK,
        'telling the user to reconnect a perfectly good token helps nobody');
});

test('403 with retry-after (secondary rate limit) is NOT read as a dead token', async () => {
    respondWith({ ok: false, status: 403, headers: { 'retry-after': '60' } });
    await sync.syncToGist({ silent: true });
    assert.equal(sync.getSyncHealth().kind, sync.SyncFailure.NETWORK);
});

test('429 is a rate limit, not an auth failure', async () => {
    respondWith({ ok: false, status: 429 });
    await sync.syncToGist({ silent: true });
    assert.equal(sync.getSyncHealth().kind, sync.SyncFailure.NETWORK);
});

test('a transport error with no response at all is a network failure', async () => {
    respondOffline();
    await sync.syncToGist({ silent: true });
    assert.equal(sync.getSyncHealth().kind, sync.SyncFailure.NETWORK);
});

test('a failed pull is recorded too', async () => {
    respondWith({ ok: false, status: 401 });
    await sync.syncFromGist({ silent: true });
    assert.equal(sync.getSyncHealth().kind, sync.SyncFailure.AUTH);
});

// ── When the badge is allowed to speak ──────────────────────────────────────

test('one network failure is not worth a badge - this app works offline', async () => {
    respondWith({ ok: false, status: 500 });
    await sync.syncToGist({ silent: true });
    assert.equal(sync.getSyncHealth().unhealthy, false);
});

test('a repeated network failure earns the badge', async () => {
    respondWith({ ok: false, status: 500 });
    await sync.syncToGist({ silent: true });
    await sync.syncToGist({ silent: true });
    await sync.syncToGist({ silent: true });
    assert.equal(sync.getSyncHealth().unhealthy, true);
});

test('an auth failure earns the badge on the first try - it never fixes itself', async () => {
    respondWith({ ok: false, status: 401 });
    await sync.syncToGist({ silent: true });
    assert.equal(sync.getSyncHealth().unhealthy, true);
});

// ── What ends up on screen ──────────────────────────────────────────────────

test('the header badge carries the unhealthy state', async () => {
    respondWith({ ok: false, status: 401 });
    await sync.syncToGist({ silent: true });
    sync.updateSyncUI();

    const btn = document.getElementById('githubSyncBtn');
    assert.ok(btn.classList.contains('sync-unhealthy'));
    assert.ok(btn.getAttribute('title').length > 0);
});

test('the badge goes quiet again after a success', async () => {
    respondWith({ ok: false, status: 401 });
    await sync.syncToGist({ silent: true });
    sync.updateSyncUI();

    respondWith({ ok: true, status: 200 });
    await sync.syncToGist({ silent: true });
    sync.updateSyncUI();

    assert.equal(document.getElementById('githubSyncBtn').classList.contains('sync-unhealthy'), false);
});

test('the dropdown names the failure and marks an expired token critical', async () => {
    respondWith({ ok: false, status: 401 });
    await sync.syncToGist({ silent: true });
    sync.updateSyncUI();

    const healthEl = document.getElementById('githubDropdownHealth');
    assert.notEqual(healthEl.style.display, 'none');
    assert.ok(healthEl.innerText.trim().length > 0);
    assert.ok(healthEl.classList.contains('critical'));
    // A warning with nowhere to go is noise: this one opens the reconnect flow.
    assert.equal(typeof healthEl.onclick, 'function');
});

test('a network failure is reported without claiming the token is dead', async () => {
    respondWith({ ok: false, status: 500 });
    await sync.syncToGist({ silent: true });
    sync.updateSyncUI();

    const healthEl = document.getElementById('githubDropdownHealth');
    assert.notEqual(healthEl.style.display, 'none');
    assert.equal(healthEl.classList.contains('critical'), false);
    assert.equal(healthEl.onclick, null, 'reconnecting fixes nothing when the network is the problem');
});

test('the health line disappears while sync is working', async () => {
    respondWith({ ok: false, status: 500 });
    await sync.syncToGist({ silent: true });
    sync.updateSyncUI();

    respondWith({ ok: true, status: 200 });
    await sync.syncToGist({ silent: true });
    sync.updateSyncUI();

    const healthEl = document.getElementById('githubDropdownHealth');
    assert.equal(healthEl.style.display, 'none');
    assert.equal(healthEl.innerText, '');
});

test('a sync that never happened does not get a clock time', () => {
    AppState.lastSyncTime = 0;
    sync.updateSyncUI();

    const timeEl = document.getElementById('githubDropdownLastSync');
    assert.ok(!/\d\d:\d\d/.test(timeEl.innerText),
        'an empty backup must not read like it happened at some hour today');
});

test('a sync from an earlier day is dated, not just clocked', () => {
    // A bare "14:32" is what made a five-week-old backup look like this
    // afternoon.
    AppState.lastSyncTime = Date.now() - 35 * 24 * 60 * 60 * 1000;
    sync.updateSyncUI();

    const text = document.getElementById('githubDropdownLastSync').innerText;
    const expectedDate = new Date(AppState.lastSyncTime).toLocaleDateString();
    assert.ok(text.includes(expectedDate), `expected a date in "${text}"`);
});
