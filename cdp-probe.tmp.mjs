/* Throwaway CDP probe: does a data change actually repaint the charts in a real
   browser, with no reload? jsdom cannot answer this - it has no layout and no
   animation frames. */

const list = await (await fetch('http://localhost:9222/json/list')).json();
const page = list.find(t => t.type === 'page' && t.url.includes('localhost:5173'));
if (!page) throw new Error('app page not found');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
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
    if (res.result?.exceptionDetails) {
        throw new Error(JSON.stringify(res.result.exceptionDetails.exception?.description || res.result.exceptionDetails));
    }
    return res.result?.result?.value;
}

/* initApp() runs asynchronously after load; probing before it has registered
   the bindings measures nothing. */
for (let i = 0; i < 40; i++) {
    const n = await evaluate(`(async () => {
        const s = await import('/src/core/store.js');
        return s._inspect().subscribers.length;
    })()`);
    if (n > 0) break;
    await new Promise(r => setTimeout(r, 500));
}

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// ── 1. Are the bindings actually installed in the running app? ───────────────
const inspect = await evaluate(`(async () => {
    const store = await import('/src/core/store.js');
    return JSON.stringify(store._inspect());
})()`);
const state = JSON.parse(inspect);
check('bindings registered', state.subscribers.length > 0,
    `${state.subscribers.length} consumers, activeView=${state.activeView}`);
check('charts bound to activity',
    state.subscribers.some(s => s.name === 'home:charts' && s.slices.includes('studyActivity')));

// ── 2. Does an activity change repaint the heatmap, with no reload? ─────────
const repaint = await evaluate(`(async () => {
    const store = await import('/src/core/store.js');
    const st = await import('/src/core/state.js');

    const host = document.getElementById('continuityHeatmapContainer')
              || document.getElementById('homeHeatmapCard');
    if (!host) return JSON.stringify({ error: 'heatmap host not in DOM' });

    /* Stamp the current DOM. If the container is rebuilt the stamp is gone -
       a direct proof of a redraw that does not depend on reading pixel data. */
    const stampedAt = host.innerHTML.length;
    host.setAttribute('data-probe-stamp', 'before');

    const today = new Date().toISOString().slice(0, 10);
    st.AppState.studyActivity = st.AppState.studyActivity || {};
    st.AppState.studyActivity[today] = { count: 37, correct: 30, wrong: 7, durationMs: 60000 };
    st.saveStudyActivity();          // emits Slice.ACTIVITY - names no renderer

    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const after = document.getElementById('continuityHeatmapContainer')
               || document.getElementById('homeHeatmapCard');
    return JSON.stringify({
        stampSurvived: after?.getAttribute('data-probe-stamp') === 'before',
        lengthBefore: stampedAt,
        lengthAfter: after ? after.innerHTML.length : -1,
        reloaded: performance.getEntriesByType('navigation').length
    });
})()`);
const r2 = JSON.parse(repaint);
if (r2.error) {
    check('activity change repaints heatmap', false, r2.error);
} else {
    check('activity change repaints heatmap',
        r2.lengthAfter > 0 && (!r2.stampSurvived || r2.lengthAfter !== r2.lengthBefore),
        `html ${r2.lengthBefore} -> ${r2.lengthAfter}, stamp survived: ${r2.stampSurvived}`);
}

// ── 3. Does the view gate defer work for a hidden view, then catch up? ──────
const gate = await evaluate(`(async () => {
    const store = await import('/src/core/store.js');
    const st = await import('/src/core/state.js');

    let runs = 0;
    store.subscribe('probe:gated', [store.Slice.ACTIVITY], () => { runs++; }, { views: ['home'] });

    store.setActiveView('test');                 // pretend the user is mid-test
    st.saveStudyActivity();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const whileHidden = runs;

    store.setActiveView('home');                 // and now they come back
    const afterReturn = runs;

    return JSON.stringify({ whileHidden, afterReturn });
})()`);
const r3 = JSON.parse(gate);
check('hidden view is not repainted', r3.whileHidden === 0, `runs=${r3.whileHidden}`);
check('hidden view catches up on return', r3.afterReturn === 1, `runs=${r3.afterReturn}`);

// ── 4. Are unrelated slices really independent? ─────────────────────────────
const isolation = await evaluate(`(async () => {
    const store = await import('/src/core/store.js');
    const st = await import('/src/core/state.js');

    let chartRuns = 0;
    store.subscribe('probe:charts', [store.Slice.ACTIVITY], () => { chartRuns++; });
    store.setActiveView('home');

    st.saveTtsSettings();                        // a settings change, nothing else
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    return JSON.stringify({ chartRuns });
})()`);
const r4 = JSON.parse(isolation);
check('a settings change does not repaint the charts', r4.chartRuns === 0, `chart runs=${r4.chartRuns}`);

// ── 5. Any console errors along the way? ───────────────────────────────────
console.log('');
const failed = results.filter(r => !r.pass);
console.log(failed.length === 0
    ? `ALL ${results.length} CHECKS PASSED`
    : `${failed.length}/${results.length} FAILED`);

ws.close();
process.exit(failed.length === 0 ? 0 : 1);
