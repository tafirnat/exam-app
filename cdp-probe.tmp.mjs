/* Throwaway CDP probe: does a data change actually repaint the charts in a real
   browser, with no reload? jsdom cannot answer this - it has no layout, no
   IntersectionObserver and no animation frames, and the heatmap depends on all
   three.

   Run: a Vite dev server on :5173 and a Chromium started with
   --remote-debugging-port=9222, already pointed at the app. */

const list = await (await fetch('http://localhost:9222/json/list')).json();
const page = list.find(t => t.type === 'page' && t.url.includes('localhost:5173'));
if (!page) throw new Error('app page not found');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
const consoleErrors = [];
ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(msg.params.args.map(a => a.value ?? a.description).join(' '));
    }
    if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
    }
});

function send(method, params = {}) {
    const msgId = ++id;
    return new Promise(resolve => {
        pending.set(msgId, resolve);
        ws.send(JSON.stringify({ id: msgId, method, params }));
    });
}

async function evaluate(expression) {
    const res = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
    });
    const ex = res.result?.exceptionDetails;
    if (ex) throw new Error(ex.exception?.description || JSON.stringify(ex));
    return res.result?.result?.value;
}

/** Every evaluate() returns JSON so failures carry their own diagnosis. */
const json = async expr => JSON.parse(await evaluate(`(async () => { ${expr} })()`));

await send('Runtime.enable');

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

/* initApp() runs asynchronously after load; probing before it has registered
   the bindings measures nothing. */
for (let i = 0; i < 40; i++) {
    const n = await evaluate('window.appStore ? window.appStore._inspect().subscribers.length : 0');
    if (n > 0) break;
    await new Promise(r => setTimeout(r, 500));
}

// ── 0. Reach the live modules, and prove they are the live ones ─────────────
/* main.js hangs the store on window precisely because a dynamic import can hand
   back a second copy of a module. state.js has no such handle, so the probe
   imports it - and that is only sound if a dynamic import of an already-loaded
   module is the same instance. The store namespace object is the control: if
   `import('/src/core/store.js')` is identical to the one main.js exported, the
   module registry is shared and the state.js import is the app's own state. */
const wiring = await json(`
    const store = await import('/src/core/store.js');
    const state = await import('/src/core/state.js');
    const engine = await import('/src/features/stats/continuity-engine.js');
    window.__probe = { store, state, engine };
    window.__probeSentinel = 'sentinel-' + Math.random();
    return JSON.stringify({
        sameStoreInstance: store === window.appStore,
        subscribers: window.appStore._inspect().subscribers,
        activeView: window.appStore._inspect().activeView,
        hasAppState: !!state.AppState,
        hasSave: typeof state.saveStudyActivity === 'function'
    });
`);
check('dynamic import is the live module instance', wiring.sameStoreInstance,
    `store === window.appStore: ${wiring.sameStoreInstance}, AppState reachable: ${wiring.hasAppState}`);
check('bindings registered', wiring.subscribers.length > 0,
    `${wiring.subscribers.length} consumers, activeView=${wiring.activeView}`);
check('charts bound to studyActivity',
    wiring.subscribers.some(s => s.name === 'home:charts' && s.slices.includes('studyActivity')),
    JSON.stringify(wiring.subscribers.find(s => s.name === 'home:charts')));

if (!wiring.sameStoreInstance || !wiring.hasAppState) {
    console.log('\nABORT: cannot reach the running app state; later checks would be meaningless');
    ws.close();
    process.exit(1);
}

// ── 1. Put the app in the state the claim is about ──────────────────────────
/* Home, heatmap scrolled into view (its first paint is behind an
   IntersectionObserver), and one day of activity already on screen, so what
   step 2 measures is a *re*paint and not a first paint. */
const setup = await json(`
    const { state, engine } = window.__probe;
    window.__probeOriginalActivity = JSON.parse(JSON.stringify(state.AppState.studyActivity || {}));
    window.__probeToday = engine.getLocalDateStr();

    window.switchView('home');
    document.getElementById('homeHeatmapCard')?.scrollIntoView({ block: 'center' });

    state.AppState.studyActivity = state.AppState.studyActivity || {};
    state.AppState.studyActivity[window.__probeToday] = {
        studied: true, questionCount: 5, frozen: false, overdueSnapshot: null,
        focusStudied: false, focusQuestionCount: 0, focusFrozen: false, focusOverdueSnapshot: null
    };
    state.saveStudyActivity();

    await new Promise(r => setTimeout(r, 1200));
    return JSON.stringify({
        today: window.__probeToday,
        hadToken: !!localStorage.getItem('focus_app_github_token'),
        cells: document.getElementById('continuityHeatmap')?.children.length ?? -1,
        heatmapVisible: getComputedStyle(document.getElementById('homeHeatmapCard')).display,
        trendVisible: getComputedStyle(document.getElementById('homeWeeklyTrendCard')).display
    });
`);
check('charts are on screen to begin with',
    setup.cells > 0 && setup.heatmapVisible !== 'none' && setup.trendVisible !== 'none',
    `${setup.cells} heatmap cells, heatmap=${setup.heatmapVisible}, trend=${setup.trendVisible}, today=${setup.today}`);
if (setup.hadToken) console.log('  note: this profile has a GitHub token; the probe restores the original activity at the end');

// ── 2. Does a data change repaint the heatmap and the trend, no reload? ─────
/* saveStudyActivity() names no renderer - it only emits Slice.ACTIVITY. Any
   change to these pixels therefore came through the store. */
const repaint = await json(`
    const { state } = window.__probe;
    const today = window.__probeToday;
    const $ = sel => document.getElementById(sel);

    const todayCell = () => [...($('continuityHeatmap')?.children || [])].find(c => c.title === today);
    const before = {
        cellColor: todayCell()?.style.backgroundColor ?? null,
        cellNode: todayCell(),
        trendAxis: $('trendYAxis')?.textContent ?? null,
        trendBarsHTML: $('trendBars')?.innerHTML.length ?? -1,
        monthlyAxis: $('monthlyTrendYAxis')?.textContent ?? null,
        navigations: performance.getEntriesByType('navigation').length,
        sentinel: window.__probeSentinel
    };

    /* 5 -> 137 crosses every heatmap colour threshold and lifts the trend
       axis past its 10-question floor, so a stale chart cannot coincidentally
       look like a fresh one. */
    state.AppState.studyActivity[today].questionCount = 137;
    state.saveStudyActivity();

    /* renderHeatmapCard() defers the grid rebuild by a timer, so a frame is
       not enough; poll instead of guessing a single sleep. */
    const deadline = Date.now() + 4000;
    let after;
    do {
        await new Promise(r => setTimeout(r, 100));
        after = {
            cellColor: todayCell()?.style.backgroundColor ?? null,
            trendAxis: $('trendYAxis')?.textContent ?? null,
            trendBarsHTML: $('trendBars')?.innerHTML.length ?? -1,
            monthlyAxis: $('monthlyTrendYAxis')?.textContent ?? null
        };
    } while (Date.now() < deadline &&
             after.cellColor === before.cellColor &&
             after.trendAxis === before.trendAxis);

    return JSON.stringify({
        heatmapBefore: before.cellColor, heatmapAfter: after.cellColor,
        heatmapCellReplaced: before.cellNode !== todayCell(),
        trendBefore: before.trendAxis, trendAfter: after.trendAxis,
        monthlyBefore: before.monthlyAxis, monthlyAfter: after.monthlyAxis,
        navigationsBefore: before.navigations,
        navigationsAfter: performance.getEntriesByType('navigation').length,
        sentinelSurvived: window.__probeSentinel === before.sentinel,
        renderedCount: state.AppState.studyActivity[today].questionCount
    });
`);
check('activity change repaints the heatmap',
    repaint.heatmapAfter !== null && repaint.heatmapAfter !== repaint.heatmapBefore,
    `today's cell ${repaint.heatmapBefore} -> ${repaint.heatmapAfter}, node replaced: ${repaint.heatmapCellReplaced}`);
check('activity change repaints the weekly trend',
    repaint.trendAfter !== null && repaint.trendAfter !== repaint.trendBefore,
    `y-axis "${repaint.trendBefore}" -> "${repaint.trendAfter}"`);
check('activity change repaints the monthly trend',
    repaint.monthlyAfter !== null && repaint.monthlyAfter !== repaint.monthlyBefore,
    `y-axis "${repaint.monthlyBefore}" -> "${repaint.monthlyAfter}"`);
check('no reload happened',
    repaint.sentinelSurvived && repaint.navigationsAfter === repaint.navigationsBefore,
    `sentinel kept: ${repaint.sentinelSurvived}, navigation entries: ${repaint.navigationsBefore} -> ${repaint.navigationsAfter}`);

// ── 3. Does the view gate defer work for a hidden view, then catch up? ──────
const gate = await json(`
    const { store, state } = window.__probe;
    const today = window.__probeToday;
    let runs = 0;
    store.subscribe('probe:gated', [store.Slice.ACTIVITY], () => { runs++; }, { views: ['home'] });

    store.setActiveView('test');                 // pretend the user is mid-test
    state.AppState.studyActivity[today].questionCount = 41;
    state.saveStudyActivity();
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 250)));
    const whileHidden = runs;

    store.setActiveView('home');                 // and now they come back
    const afterReturn = runs;
    return JSON.stringify({ whileHidden, afterReturn });
`);
check('a hidden view is not repainted', gate.whileHidden === 0, `runs while hidden=${gate.whileHidden}`);
check('a hidden view catches up on return', gate.afterReturn === 1, `runs after return=${gate.afterReturn}`);

// ── 4. Are unrelated slices really independent? ─────────────────────────────
const isolation = await json(`
    const { store, state } = window.__probe;
    let chartRuns = 0;
    store.subscribe('probe:charts', [store.Slice.ACTIVITY], () => { chartRuns++; });
    store.setActiveView('home');

    state.AppState.ttsSpeed = (state.AppState.ttsSpeed === 1 ? 1.25 : 1);
    state.saveTtsSettings();                     // a settings change, nothing else
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 250)));
    return JSON.stringify({ chartRuns });
`);
check('a settings change does not repaint the charts', isolation.chartRuns === 0,
    `chart-slice runs=${isolation.chartRuns}`);

// ── 5. Leave the profile as we found it ────────────────────────────────────
const cleanup = await json(`
    const { store, state } = window.__probe;
    /* subscribe() returns its own unsubscribe; re-register then drop, which is
       the only handle the probe has on subscriptions it made in an earlier
       evaluate. */
    store.subscribe('probe:gated', [store.Slice.ACTIVITY], () => {})();
    store.subscribe('probe:charts', [store.Slice.ACTIVITY], () => {})();
    state.AppState.studyActivity = window.__probeOriginalActivity;
    state.saveStudyActivity();
    return JSON.stringify({ restored: Object.keys(state.AppState.studyActivity).length });
`);
console.log(`\nrestored original studyActivity (${cleanup.restored} days)`);

check('no console errors during the run', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | '));

const failed = results.filter(r => !r.pass);
console.log(failed.length === 0
    ? `\nALL ${results.length} CHECKS PASSED`
    : `\n${failed.length}/${results.length} FAILED`);

ws.close();
process.exit(failed.length === 0 ? 0 : 1);
