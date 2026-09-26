/**
 * Direct AI connection: an OpenAI-compatible chat endpoint.
 *
 * The usual case is a model running on this computer - Ollama, LM Studio,
 * llama.cpp's server - or a small local proxy in front of one, which is how a
 * browser page reaches a local model without CORS trouble. The existing "AI
 * Integration" menu stays as it is: it hands a prompt to a web AI page and
 * needs no connection at all.
 *
 * The connection is kept on this device only (localStorage) and never synced:
 * it names a local address and may carry an API key.
 */

const STORAGE_KEY = 'exam_app_ai_connection';
const DEFAULT_TIMEOUT_MS = 90000;

function storage() {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch (_) {
        return null;
    }
}

/** The saved connection as entered, or null. */
export function readAiConnection() {
    const ls = storage();
    if (!ls) return null;
    try {
        const conn = JSON.parse(ls.getItem(STORAGE_KEY) || 'null');
        return conn && typeof conn === 'object' ? conn : null;
    } catch (_) {
        return null;
    }
}

/** The connection to use, or null when none is complete and switched on. */
export function getAiConnection() {
    const conn = readAiConnection();
    if (!conn || conn.enabled === false) return null;
    if (typeof conn.baseUrl !== 'string' || !conn.baseUrl.trim()) return null;
    if (typeof conn.model !== 'string' || !conn.model.trim()) return null;
    return conn;
}

export function saveAiConnection({ kind = 'local', baseUrl = '', model = '', apiKey = '', enabled = true } = {}) {
    const ls = storage();
    if (!ls) return false;
    const conn = {
        kind,
        baseUrl: String(baseUrl).trim(),
        model: String(model).trim(),
        apiKey: String(apiKey).trim(),
        enabled: !!enabled
    };
    ls.setItem(STORAGE_KEY, JSON.stringify(conn));
    return true;
}

export function clearAiConnection() {
    const ls = storage();
    if (ls) ls.removeItem(STORAGE_KEY);
}

function trimBase(baseUrl) {
    return String(baseUrl || '').trim().replace(/\/+$/, '');
}

/**
 * Pure. The chat URL for whatever form of base URL was typed:
 *   http://localhost:11434            -> .../v1/chat/completions
 *   http://localhost:1234/v1          -> .../v1/chat/completions
 *   http://host/v1/chat/completions   -> unchanged
 */
export function chatCompletionsUrl(baseUrl) {
    const base = trimBase(baseUrl);
    if (/\/chat\/completions$/.test(base)) return base;
    if (/\/v1$/.test(base)) return `${base}/chat/completions`;
    return `${base}/v1/chat/completions`;
}

/** Pure. The model list URL for the same base URL forms. */
export function modelsUrl(baseUrl) {
    const base = trimBase(baseUrl).replace(/\/chat\/completions$/, '');
    if (/\/v1$/.test(base)) return `${base}/models`;
    return `${base}/v1/models`;
}

function headersFor(conn) {
    const headers = { 'Content-Type': 'application/json' };
    if (conn && conn.apiKey) headers.Authorization = `Bearer ${conn.apiKey}`;
    return headers;
}

/** Pure. The reply text of an OpenAI-style (or Ollama /api/chat) response. */
export function replyText(data) {
    const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
    const text = (choice && choice.message && choice.message.content)
        || (choice && typeof choice.text === 'string' ? choice.text : '')
        || (data && data.message && data.message.content)
        || '';
    return String(text).trim();
}

function withTimeout(ms, outer) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    if (outer) outer.addEventListener('abort', () => ctrl.abort(), { once: true });
    return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

/**
 * Sends one prompt and returns the reply text. Throws on a network error, a
 * non-2xx answer or an empty reply.
 */
export async function aiComplete(prompt, {
    system = '',
    conn = getAiConnection(),
    fetchImpl = (typeof fetch === 'function' ? fetch : null),
    signal = null,
    timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
    if (!conn) throw new Error('ai_not_connected');
    if (typeof fetchImpl !== 'function') throw new Error('ai_no_fetch');
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: String(prompt) });

    const t = withTimeout(timeoutMs, signal);
    try {
        const res = await fetchImpl(chatCompletionsUrl(conn.baseUrl), {
            method: 'POST',
            headers: headersFor(conn),
            body: JSON.stringify({ model: conn.model, messages, temperature: 0.3, stream: false }),
            signal: t.signal
        });
        if (!res.ok) throw new Error(`ai_http_${res.status}`);
        const text = replyText(await res.json());
        if (!text) throw new Error('ai_empty_reply');
        return text;
    } finally {
        t.done();
    }
}

/** The model ids the server offers (OpenAI /v1/models, Ollama /api/tags). */
export async function listAiModels({ baseUrl, apiKey = '' } = {}, {
    fetchImpl = (typeof fetch === 'function' ? fetch : null),
    timeoutMs = 8000
} = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('ai_no_fetch');
    const t = withTimeout(timeoutMs);
    try {
        const res = await fetchImpl(modelsUrl(baseUrl), { headers: headersFor({ apiKey }), signal: t.signal });
        if (res.ok) {
            const data = await res.json();
            const ids = Array.isArray(data && data.data) ? data.data.map(m => m && m.id).filter(Boolean) : [];
            if (ids.length > 0) return ids;
        }
        /* Ollama's own listing, for a base URL without the /v1 layer. */
        const tags = await fetchImpl(`${trimBase(baseUrl).replace(/\/v1$/, '')}/api/tags`, { signal: t.signal });
        if (!tags.ok) throw new Error(`ai_http_${tags.status}`);
        const data = await tags.json();
        return Array.isArray(data && data.models) ? data.models.map(m => m && (m.name || m.model)).filter(Boolean) : [];
    } finally {
        t.done();
    }
}
