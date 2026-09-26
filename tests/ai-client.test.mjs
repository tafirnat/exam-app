import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
global.localStorage = dom.window.localStorage;

const ai = await import('../src/core/ai-client.js');
const tts = await import('../src/features/ereader/ereader-tts.js');

test('the chat URL is built from any form of base URL', () => {
    assert.equal(ai.chatCompletionsUrl('http://localhost:11434'), 'http://localhost:11434/v1/chat/completions');
    assert.equal(ai.chatCompletionsUrl('http://localhost:1234/v1/'), 'http://localhost:1234/v1/chat/completions');
    assert.equal(ai.chatCompletionsUrl('http://x/v1/chat/completions'), 'http://x/v1/chat/completions');
    assert.equal(ai.modelsUrl('http://localhost:11434'), 'http://localhost:11434/v1/models');
    assert.equal(ai.modelsUrl('http://localhost:1234/v1'), 'http://localhost:1234/v1/models');
});

test('a connection needs a base URL and a model, and can be switched off', () => {
    ai.clearAiConnection();
    assert.equal(ai.getAiConnection(), null);
    ai.saveAiConnection({ baseUrl: 'http://localhost:11434', model: '' });
    assert.equal(ai.getAiConnection(), null, 'no model, no connection');
    ai.saveAiConnection({ baseUrl: 'http://localhost:11434', model: 'llama3', enabled: false });
    assert.equal(ai.getAiConnection(), null, 'switched off');
    ai.saveAiConnection({ baseUrl: ' http://localhost:11434 ', model: 'llama3' });
    assert.equal(ai.getAiConnection().baseUrl, 'http://localhost:11434');
    ai.clearAiConnection();
});

test('aiComplete posts an OpenAI chat request and reads the reply (OpenAI or Ollama shape)', async () => {
    const seen = [];
    const conn = { baseUrl: 'http://localhost:11434', model: 'm1', apiKey: 'k' };
    const reply = await ai.aiComplete('hello', {
        conn,
        system: 'be brief',
        fetchImpl: async (url, opts) => {
            seen.push({ url, opts });
            return { ok: true, json: async () => ({ choices: [{ message: { content: ' hi ' } }] }) };
        }
    });
    assert.equal(reply, 'hi');
    assert.equal(seen[0].url, 'http://localhost:11434/v1/chat/completions');
    assert.equal(seen[0].opts.headers.Authorization, 'Bearer k');
    const body = JSON.parse(seen[0].opts.body);
    assert.equal(body.model, 'm1');
    assert.deepEqual(body.messages.map(m => m.role), ['system', 'user']);

    assert.equal(ai.replyText({ message: { content: 'ollama says' } }), 'ollama says');
});

test('aiComplete refuses without a connection and on an HTTP error', async () => {
    await assert.rejects(ai.aiComplete('x', { conn: null }), /ai_not_connected/);
    await assert.rejects(ai.aiComplete('x', {
        conn: { baseUrl: 'http://h', model: 'm' },
        fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) })
    }), /ai_http_404/);
});

test('speech: the book language decides the voice language; long text is cut at sentence ends', () => {
    assert.equal(tts.speechLang('de'), 'de');
    assert.equal(tts.speechLang('en_US'), 'en');
    assert.equal(tts.speechLang('pt-BR'), 'pt');
    assert.equal(tts.speechLang('und'), 'en');
    assert.equal(tts.speechLang(''), 'en');

    const text = 'Erster Satz ist hier. ' + 'Zweiter Satz ist etwas länger als der erste. '.repeat(6) + 'Ende.';
    const pieces = tts.splitForSpeech(text, 100);
    assert.ok(pieces.length > 1);
    assert.ok(pieces.every(p => p.length <= 100), 'no piece over the limit');
    assert.equal(pieces.join(' ').replace(/\s+/g, ' '), text.trim().replace(/\s+/g, ' '), 'nothing lost or reordered');
    assert.ok(pieces.every(p => /[.!?…]$/.test(p)), 'cut at sentence ends when sentences fit');
});
