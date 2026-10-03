/**
 * The "how do you want to share this?" dialog (#shareOptionsOverlay): copy to
 * clipboard, share as text, share as a .json file, open in the browser.
 *
 * One dialog for everything the app shares as JSON - a test source, an
 * e-Reader book. The caller supplies the JSON (built at click time, so the
 * dialog's own switch can change it) and what "download" means for it.
 */

import { t } from './i18n.js';
import { showToast } from './utils.js';

function triggerDownload(fileName, jsonStr) {
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
    } else {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
    }
    showToast(t('copy_success'));
}

/**
 * @param {object} opts
 * @param {string} opts.name            shown under the dialog title and used as the share title
 * @param {string} opts.fileName        name of the shared/downloaded .json file
 * @param {(o: {toggle: boolean}) => (string|Promise<string>)} opts.getJson the JSON text to share
 * @param {(o: {toggle: boolean}) => void} [opts.onDownload] fallback when sharing a file is not possible
 * @param {{label: string, checked?: boolean}|null} [opts.toggle] an optional switch shown above the options
 */
export async function openShareOptions({ name, fileName, getJson, onDownload = null, toggle = null }) {
    const overlay = document.getElementById('shareOptionsOverlay');
    const nameEl = document.getElementById('shareOptionsSourceName');
    const hintBox = document.getElementById('shareLargeDataHint');
    const hintText = document.getElementById('shareLargeDataHintText');
    const toggleRow = document.getElementById('shareIncludeFolderRow');
    const toggleCheck = document.getElementById('shareIncludeFolderCheck');
    const toggleLabel = document.getElementById('shareIncludeFolderLabel');

    const copyBtn = document.getElementById('shareCopyClipboardBtn');
    const textBtn = document.getElementById('shareAsTextBtn');
    const fileBtn = document.getElementById('shareAsFileBtn');
    const viewBrowserBtn = document.getElementById('shareViewBrowserBtn');
    const closeBtn = document.getElementById('shareOptionsCloseBtn');

    if (toggleRow && toggleCheck) {
        toggleRow.style.display = toggle ? 'flex' : 'none';
        toggleCheck.checked = !!(toggle && toggle.checked);
        if (toggleLabel && toggle) toggleLabel.textContent = toggle.label;
    }
    // Read at click time: the switch sits in the same dialog as the buttons.
    const currentOptions = () => ({ toggle: !!(toggle && toggleCheck && toggleCheck.checked) });
    const buildJson = async () => String(await getJson(currentOptions()));
    const download = (jsonStr) => {
        if (typeof onDownload === 'function') onDownload(currentOptions());
        else triggerDownload(fileName, jsonStr);
    };

    if (!overlay || !copyBtn || !textBtn || !fileBtn || !closeBtn) {
        // Basic fallback if modal elements are missing
        try {
            await copyText(await buildJson());
        } catch (_) { /* nothing else to fall back to */ }
        return;
    }

    if (nameEl) nameEl.textContent = name || '';

    const initialJson = await buildJson();
    if (hintBox) {
        if (initialJson.length > 500 && hintText) {
            hintText.textContent = t('share_large_data_hint', { count: initialJson.length });
            hintBox.style.display = 'flex';
        } else {
            hintBox.style.display = 'none';
        }
    }

    overlay.classList.add('active');

    const closeShareOptions = () => {
        overlay.classList.remove('active');
        copyBtn.onclick = null;
        textBtn.onclick = null;
        fileBtn.onclick = null;
        if (viewBrowserBtn) viewBrowserBtn.onclick = null;
        closeBtn.onclick = null;
        overlay.onclick = null;
    };

    // 1. Copy to clipboard - the pure JSON string, ready to paste.
    copyBtn.onclick = async () => {
        const jsonStr = await buildJson();
        closeShareOptions();
        try {
            await copyText(jsonStr);
        } catch (err) {
            console.error('Clipboard copy failed:', err);
        }
    };

    // 2. Share as text via the Web Share API.
    textBtn.onclick = async () => {
        const jsonStr = await buildJson();
        closeShareOptions();
        if (navigator.share) {
            try {
                await navigator.share({ title: name, text: jsonStr });
            } catch (err) {
                if (err.name !== 'AbortError') console.error('Share text failed:', err);
            }
        } else {
            try {
                await copyText(jsonStr);
            } catch (e) {
                download(jsonStr);
            }
        }
    };

    // 3. Share as a .json file.
    fileBtn.onclick = async () => {
        const jsonStr = await buildJson();
        closeShareOptions();
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const file = new File([blob], fileName, { type: 'application/json' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ title: name, files: [file] });
                return;
            } catch (err) {
                if (err.name === 'AbortError') return;
                console.error('File share failed, falling back to download:', err);
            }
        }
        // Browsers without file sharing get the file as a download instead.
        download(jsonStr);
    };

    // 4. Open the JSON natively in the browser.
    if (viewBrowserBtn) {
        viewBrowserBtn.onclick = async () => {
            const jsonStr = await buildJson();
            closeShareOptions();
            try {
                const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
                const blobUrl = URL.createObjectURL(blob);
                const win = window.open(blobUrl, '_blank');
                if (!win) window.location.href = blobUrl;
                setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
            } catch (err) {
                console.error('Open in browser failed:', err);
            }
        };
    }

    closeBtn.onclick = closeShareOptions;
    overlay.onclick = (e) => {
        if (e.target === overlay) closeShareOptions();
    };
}
