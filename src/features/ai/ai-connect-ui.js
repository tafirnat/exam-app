/**
 * "Connect AI" dialog (R2-12), opened from the AI Integration menu section
 * and from the e-Reader's paragraph box.
 *
 * Local AI: a model served on this computer through an OpenAI-compatible
 * endpoint - Ollama, LM Studio, llama.cpp, or a small local proxy in front of
 * one (the usual way round a browser's CORS rules). The connection is tested
 * here and kept on this device (core/ai-client.js).
 *
 * Cloud AI: not yet - the tab says so.
 */

import { t } from '../../core/i18n.js';
import { showToast } from '../../core/utils.js';
import {
    readAiConnection, getAiConnection, saveAiConnection, clearAiConnection, aiComplete, listAiModels
} from '../../core/ai-client.js';

export const LOCAL_PRESETS = Object.freeze({
    ollama: 'http://localhost:11434',
    lmstudio: 'http://localhost:1234/v1',
    proxy: 'http://localhost:8787'
});

let bound = false;

function $(id) {
    return document.getElementById(id);
}

function setStatus(kind, text) {
    const el = $('aiConnectStatus');
    if (!el) return;
    el.className = `ai-connect-status ${kind || ''}`.trim();
    el.textContent = text || '';
}

function formValues() {
    return {
        baseUrl: ($('aiConnectBaseUrl')?.value || '').trim(),
        model: ($('aiConnectModel')?.value || '').trim(),
        apiKey: ($('aiConnectApiKey')?.value || '').trim()
    };
}

function selectTab(tab) {
    document.querySelectorAll('#aiConnectOverlay .ai-connect-tab').forEach(btn => {
        const on = btn.dataset.tab === tab;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('#aiConnectOverlay .ai-connect-pane').forEach(pane => {
        pane.style.display = pane.dataset.pane === tab ? '' : 'none';
    });
    const save = $('aiConnectSaveBtn');
    if (save) save.style.display = tab === 'local' ? '' : 'none';
}

function selectPreset(name) {
    document.querySelectorAll('#aiConnectOverlay .ai-connect-preset').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === name);
    });
    if (LOCAL_PRESETS[name]) $('aiConnectBaseUrl').value = LOCAL_PRESETS[name];
    setStatus('', '');
}

/** Keeps the menu entry's "connected" dot in step with the saved connection. */
export function refreshAiConnectIndicator() {
    const btn = $('menuConnectAI');
    if (!btn) return;
    const conn = getAiConnection();
    btn.classList.toggle('connected', !!conn);
    const state = $('menuConnectAIState');
    if (state) state.textContent = conn ? conn.model : '';
}

export function openAiConnect() {
    const overlay = $('aiConnectOverlay');
    if (!overlay) return;
    const conn = readAiConnection();
    $('aiConnectBaseUrl').value = conn?.baseUrl || LOCAL_PRESETS.ollama;
    $('aiConnectModel').value = conn?.model || '';
    $('aiConnectApiKey').value = conn?.apiKey || '';
    const preset = Object.entries(LOCAL_PRESETS).find(([, url]) => url === $('aiConnectBaseUrl').value);
    document.querySelectorAll('#aiConnectOverlay .ai-connect-preset').forEach(btn => {
        btn.classList.toggle('active', !!preset && btn.dataset.preset === preset[0]);
    });
    $('aiConnectDisconnectBtn').style.display = conn ? '' : 'none';
    setStatus(getAiConnection() ? 'ok' : '', getAiConnection() ? t('ai_connect_connected', { model: conn.model }) : '');
    selectTab('local');
    overlay.classList.add('active');
}

export function closeAiConnect() {
    const overlay = $('aiConnectOverlay');
    if (overlay) overlay.classList.remove('active');
}

export function isAiConnectOpen() {
    return !!$('aiConnectOverlay')?.classList.contains('active');
}

async function loadModels() {
    const { baseUrl, apiKey } = formValues();
    if (!baseUrl) return;
    setStatus('busy', t('ai_connect_loading_models'));
    try {
        const models = await listAiModels({ baseUrl, apiKey });
        const list = $('aiConnectModelList');
        if (list) {
            list.replaceChildren(...models.map(m => {
                const o = document.createElement('option');
                o.value = m;
                return o;
            }));
        }
        if (models.length > 0 && !$('aiConnectModel').value) $('aiConnectModel').value = models[0];
        setStatus(models.length > 0 ? 'ok' : 'warn', models.length > 0
            ? t('ai_connect_models_found', { count: models.length })
            : t('ai_connect_no_models'));
    } catch (err) {
        console.warn('[ai-connect] model list failed:', err);
        setStatus('error', t('ai_connect_unreachable'));
    }
}

async function testConnection() {
    const values = formValues();
    if (!values.baseUrl || !values.model) {
        setStatus('warn', t('ai_connect_fill'));
        return false;
    }
    setStatus('busy', t('ai_connect_testing'));
    try {
        await aiComplete('Reply with the single word: OK', { conn: values, timeoutMs: 30000 });
        setStatus('ok', t('ai_connect_test_ok', { model: values.model }));
        return true;
    } catch (err) {
        console.warn('[ai-connect] test failed:', err);
        setStatus('error', t('ai_connect_unreachable'));
        return false;
    }
}

function save() {
    const values = formValues();
    if (!values.baseUrl || !values.model) {
        setStatus('warn', t('ai_connect_fill'));
        return;
    }
    saveAiConnection({ kind: 'local', ...values, enabled: true });
    refreshAiConnectIndicator();
    closeAiConnect();
    showToast(t('ai_connect_saved', { model: values.model }));
}

function disconnect() {
    clearAiConnection();
    refreshAiConnectIndicator();
    closeAiConnect();
    showToast(t('ai_connect_removed'));
}

/** One-time wiring: the menu entry, the dialog and the open-ai-connect event. */
export function bindAiConnect({ closeMenu } = {}) {
    if (bound) return;
    bound = true;

    const menuBtn = $('menuConnectAI');
    if (menuBtn) {
        menuBtn.onclick = () => {
            if (typeof closeMenu === 'function') closeMenu();
            openAiConnect();
        };
    }
    window.addEventListener('open-ai-connect', () => openAiConnect());
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isAiConnectOpen()) closeAiConnect();
    });

    document.querySelectorAll('#aiConnectOverlay .ai-connect-tab').forEach(btn => {
        btn.onclick = () => selectTab(btn.dataset.tab);
    });
    document.querySelectorAll('#aiConnectOverlay .ai-connect-preset').forEach(btn => {
        btn.onclick = () => selectPreset(btn.dataset.preset);
    });

    const overlay = $('aiConnectOverlay');
    if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAiConnect(); });
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    on('aiConnectModelsBtn', loadModels);
    on('aiConnectTestBtn', testConnection);
    on('aiConnectSaveBtn', save);
    on('aiConnectCancelBtn', closeAiConnect);
    on('aiConnectDisconnectBtn', disconnect);

    refreshAiConnectIndicator();
}

/** Test seam. */
export function _resetAiConnectForTests() {
    bound = false;
}
