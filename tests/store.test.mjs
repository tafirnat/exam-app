import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// The store is what keeps the screen honest: producers announce a slice, the
// store works out which renderers that implicates, and it runs each of them
// once. The properties worth pinning down are the ones that make it cheap
// enough to call on every save - coalescing, deduplication and the view gate -
// plus the isolation that stops one broken renderer from freezing the rest of
// the screen.

let store;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

    /* jsdom drives rAF off a real timer; the store falls back to setTimeout
       whenever rAF is missing, which keeps these cases deterministic. */
    delete global.requestAnimationFrame;

    store = await import('../src/core/store.js');
});

beforeEach(() => {
    store._reset();
});

/** Runs the queued flush and lets its timer fire. */
function settle() {
    return new Promise(resolve => setTimeout(resolve, 10));
}

test('a consumer runs when a slice it listens to changes', async () => {
    let runs = 0;
    store.subscribe('c', [store.Slice.ACTIVITY], () => { runs++; });

    store.emit(store.Slice.ACTIVITY);
    await settle();

    assert.equal(runs, 1);
});

test('a consumer is left alone by slices it does not listen to', async () => {
    let charts = 0;
    let settings = 0;
    store.subscribe('charts', [store.Slice.ACTIVITY], () => { charts++; });
    store.subscribe('settings', [store.Slice.SETTINGS], () => { settings++; });

    /* The case the slice split exists for: an alert setting must not repaint
       the yearly activity chart. */
    store.emit(store.Slice.SETTINGS);
    await settle();

    assert.equal(settings, 1);
    assert.equal(charts, 0, 'a settings change must not redraw the activity charts');
});

test('emits in one tick coalesce into a single run', async () => {
    let runs = 0;
    store.subscribe('c', [store.Slice.STATS], () => { runs++; });

    for (let i = 0; i < 50; i++) store.emit(store.Slice.STATS);
    await settle();

    assert.equal(runs, 1, '50 saves in a burst must cost one repaint');
});

test('a consumer listening to several changed slices still runs once', async () => {
    let runs = 0;
    store.subscribe('c', [store.Slice.SOURCES, store.Slice.FOLDERS, store.Slice.STATS], () => { runs++; });

    store.emit(store.Slice.SOURCES, store.Slice.FOLDERS, store.Slice.STATS);
    await settle();

    assert.equal(runs, 1);
});

test('a consumer on a hidden view is deferred, then caught up on the way in', async () => {
    let runs = 0;
    store.subscribe('charts', [store.Slice.ACTIVITY], () => { runs++; }, { views: ['home'] });

    store.setActiveView('test');
    store.emit(store.Slice.ACTIVITY);
    await settle();
    assert.equal(runs, 0, 'redrawing a hidden view is wasted work');

    store.setActiveView('home');
    assert.equal(runs, 1, 'the view must never be shown stale');
});

test('several missed changes collapse into one catch-up run', async () => {
    let runs = 0;
    store.subscribe('charts', [store.Slice.ACTIVITY], () => { runs++; }, { views: ['home'] });

    store.setActiveView('test');
    store.emit(store.Slice.ACTIVITY);
    await settle();
    store.emit(store.Slice.ACTIVITY);
    await settle();
    store.emit(store.Slice.ACTIVITY);
    await settle();

    store.setActiveView('home');
    assert.equal(runs, 1, 'a redraw reads current state, so one catch-up is enough');
});

test('an ungated consumer runs regardless of the active view', async () => {
    let runs = 0;
    store.subscribe('badge', [store.Slice.SOURCES], () => { runs++; });

    store.setActiveView('test');
    store.emit(store.Slice.SOURCES);
    await settle();

    assert.equal(runs, 1, 'header badges are visible from every view');
});

test('one failing consumer does not stop the others', async () => {
    const order = [];
    store.subscribe('a', [store.Slice.STATS], () => { order.push('a'); });
    store.subscribe('boom', [store.Slice.STATS], () => { throw new Error('render failed'); });
    store.subscribe('b', [store.Slice.STATS], () => { order.push('b'); });

    const realError = console.error;
    console.error = () => {};
    store.emit(store.Slice.STATS);
    await settle();
    console.error = realError;

    assert.deepEqual(order, ['a', 'b'], 'a stale screen is what lost data looks like to a user');
});

/* The two cases below drive the chained-flush path, where a consumer emits
   while a flush is in progress. Waiting on timers for that is racy - each
   chained pass is its own macrotask - so they step the store synchronously
   through flushNow() instead. Same code path, no interleaving. */

test('a consumer that writes state gets a follow-up pass, not a freeze', () => {
    let repairs = 0;
    let observers = 0;

    store.subscribe('repair', [store.Slice.SOURCES], () => {
        if (repairs === 0) {
            repairs++;
            store.emit(store.Slice.STATS);
        }
    });
    store.subscribe('observer', [store.Slice.STATS], () => { observers++; });

    store.emit(store.Slice.SOURCES);
    store.flushNow();   // repair runs, and emits STATS from inside the flush
    store.flushNow();   // the follow-up pass that emit earned

    assert.equal(repairs, 1);
    assert.equal(observers, 1, 'the follow-up emit must reach its consumer');
});

test('a runaway emit/render loop is cut off rather than freezing the tab', () => {
    let runs = 0;
    store.subscribe('loop', [store.Slice.STATS], () => {
        runs++;
        store.emit(store.Slice.STATS);
    });

    const realError = console.error;
    let reported = false;
    console.error = msg => { if (String(msg).includes('feedback loop')) reported = true; };

    store.emit(store.Slice.STATS);
    /* Well past the cap: the point is that it stops on its own, so the extra
       turns must produce nothing rather than more runs. */
    for (let i = 0; i < 20; i++) store.flushNow();
    console.error = realError;

    assert.ok(runs <= 10, `loop must be cut off, ran ${runs} times`);
    assert.ok(reported, 'the loop must be reported, not silently dropped');
});

test('unsubscribing stops the consumer', async () => {
    let runs = 0;
    const off = store.subscribe('c', [store.Slice.STATS], () => { runs++; });

    store.emit(store.Slice.STATS);
    await settle();
    assert.equal(runs, 1);

    off();
    store.emit(store.Slice.STATS);
    await settle();
    assert.equal(runs, 1);
});

test('re-registering the same name replaces rather than duplicates', async () => {
    let first = 0;
    let second = 0;
    store.subscribe('c', [store.Slice.STATS], () => { first++; });
    store.subscribe('c', [store.Slice.STATS], () => { second++; });

    store.emit(store.Slice.STATS);
    await settle();

    assert.equal(first, 0);
    assert.equal(second, 1, 'registerUIBindings() must be safe to call twice');
});

test('an unknown slice is rejected at registration', () => {
    assert.throws(
        () => store.subscribe('c', ['notASlice'], () => {}),
        /unknown slice/,
        'a typo in a binding must fail loudly, not silently never fire'
    );
});

test('runAll paints visible consumers and defers the rest', () => {
    let home = 0;
    let stats = 0;
    store.subscribe('home', [store.Slice.STATS], () => { home++; }, { views: ['home'] });
    store.subscribe('stats', [store.Slice.STATS], () => { stats++; }, { views: ['stats'] });

    store.setActiveView('home');
    store.runAll();

    assert.equal(home, 1);
    assert.equal(stats, 0);

    store.setActiveView('stats');
    assert.equal(stats, 1, 'the deferred first paint must land on arrival');
});
