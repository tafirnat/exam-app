import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let ui, ai;

before(async () => {
    const dom = new JSDOM(html, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
    ui = await import('../src/features/ai/ai-connect-ui.js');
    ai = await import('../src/core/ai-client.js');
    ui.bindAiConnect({ closeMenu: () => {} });
});

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

test('R2-12: "Connect AI" sits under the AI Integration section, after the existing web-AI entries', () => {
    const section = document.getElementById('section-ai');
    const ids = [...section.querySelectorAll('button[id]')].map(b => b.id);
    assert.deepEqual(ids, ['menuEditPrompt', 'menuManageAIProviders', 'menuConnectAI']);
});

test('R2-12: the page may reach a local AI server (CSP connect-src)', () => {
    const csp = html.match(/connect-src([^;]*)/)[1];
    assert.ok(csp.includes('http://localhost:*') && csp.includes('http://127.0.0.1:*'));
});

test('R2-12: the menu entry opens the dialog; cloud says coming soon; local saves the connection', async () => {
    document.getElementById('menuConnectAI').click();
    const overlay = document.getElementById('aiConnectOverlay');
    assert.ok(overlay.classList.contains('active'));
    assert.equal(document.getElementById('aiConnectBaseUrl').value, 'http://localhost:11434', 'Ollama by default');

    document.querySelector('#aiConnectOverlay .ai-connect-tab[data-tab="cloud"]').click();
    assert.notEqual(document.querySelector('#aiConnectOverlay [data-pane="cloud"]').style.display, 'none');
    assert.equal(document.querySelector('#aiConnectOverlay [data-pane="local"]').style.display, 'none');
    assert.equal(document.getElementById('aiConnectSaveBtn').style.display, 'none', 'nothing to save for cloud yet');

    document.querySelector('#aiConnectOverlay .ai-connect-tab[data-tab="local"]').click();
    document.querySelector('#aiConnectOverlay .ai-connect-preset[data-preset="lmstudio"]').click();
    assert.equal(document.getElementById('aiConnectBaseUrl').value, 'http://localhost:1234/v1');
    document.getElementById('aiConnectModel').value = 'qwen2.5';
    document.getElementById('aiConnectSaveBtn').click();
    assert.equal(overlay.classList.contains('active'), false);
    assert.deepEqual(
        { baseUrl: ai.getAiConnection().baseUrl, model: ai.getAiConnection().model },
        { baseUrl: 'http://localhost:1234/v1', model: 'qwen2.5' }
    );
    assert.ok(document.getElementById('menuConnectAI').classList.contains('connected'));

    ui.openAiConnect();
    document.getElementById('aiConnectDisconnectBtn').click();
    assert.equal(ai.getAiConnection(), null);
});

test('R2-12: the paragraph box can open the dialog (open-ai-connect event)', async () => {
    ui.closeAiConnect();
    window.dispatchEvent(new window.CustomEvent('open-ai-connect'));
    await tick();
    assert.ok(ui.isAiConnectOpen());
    ui.closeAiConnect();
});

test('A8: Esc closes the Connect AI dialog', () => {
    ui.openAiConnect();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(ui.isAiConnectOpen(), false);
});
