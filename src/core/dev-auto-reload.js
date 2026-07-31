/**
 * Developer Mode Auto-Reload System (Method A: Version Polling)
 * 
 * IMPORTANT / PRODUCTION SAFETY NOTE:
 * - This auto-reload polling system is designed strictly for test / staging / developer environments.
 * - It will ONLY execute if ONE of the following conditions is met:
 *     1) localStorage item 'dev_auto_reload' is set to 'true' (toggle in Dev Settings)
 *     2) URL contains query parameter '?dev=1' or '?auto_reload=1'
 *     3) Application is running in Vite local dev mode (import.meta.env.DEV)
 * - In standard production mode for regular end users, this module is inactive and does NOT
 *   make repeated network requests or refresh the page.
 */

let initialTimestamp = null;
let pollingIntervalId = null;

/**
 * Checks whether developer auto-reload mode is enabled.
 * @returns {boolean}
 */
export function isDevAutoReloadEnabled() {
	if (typeof window === "undefined") return false;
	const urlParams = new URLSearchParams(window.location.search);
	const urlFlag = urlParams.has("dev") || urlParams.get("auto_reload") === "1";
	const storageFlag = localStorage.getItem("dev_auto_reload") === "true";
	const isLocalDev = Boolean(import.meta.env && import.meta.env.DEV);

	return isLocalDev || urlFlag || storageFlag;
}

/**
 * Toggles the developer auto-reload feature in localStorage.
 * @param {boolean} [enable]
 * @returns {boolean} New status
 */
export function toggleDevAutoReload(enable) {
	const current = localStorage.getItem("dev_auto_reload") === "true";
	const next = enable !== undefined ? enable : !current;
	localStorage.setItem("dev_auto_reload", next ? "true" : "false");
	if (next) {
		startVersionPolling();
	} else {
		stopVersionPolling();
	}
	return next;
}

/**
 * Fetches version.json from server and reloads page if build timestamp has changed.
 */
async function checkVersion() {
	try {
		const res = await fetch(`./version.json?t=${Date.now()}`, {
			cache: "no-store",
			headers: { "Cache-Control": "no-cache" }
		});
		if (!res.ok) return;

		const data = await res.json();
		if (!data || !data.timestamp) return;

		if (initialTimestamp === null) {
			initialTimestamp = data.timestamp;
			console.log(`[DevAutoReload] Initialized with build timestamp: ${data.timestamp} (${data.buildTime || "N/A"})`);
		} else if (initialTimestamp !== data.timestamp) {
			console.log(`[DevAutoReload] New version detected! Current: ${initialTimestamp}, Remote: ${data.timestamp}. Reloading page...`);
			window.location.reload();
		}
	} catch (err) {
		// Silent failure during network instability or offline testing
	}
}

/**
 * Starts version polling at specified interval (default: 7 seconds).
 * @param {number} [intervalMs=7000]
 */
export function startVersionPolling(intervalMs = 7000) {
	if (pollingIntervalId) clearInterval(pollingIntervalId);
	checkVersion();
	pollingIntervalId = setInterval(checkVersion, intervalMs);
	console.log(`[DevAutoReload] Active: Checking for new version every ${intervalMs / 1000}s`);
}

/**
 * Stops version polling.
 */
export function stopVersionPolling() {
	if (pollingIntervalId) {
		clearInterval(pollingIntervalId);
		pollingIntervalId = null;
		console.log("[DevAutoReload] Stopped version polling");
	}
}

/**
 * Initializes developer auto-reload system upon app start.
 */
export function initDevAutoReload() {
	if (isDevAutoReloadEnabled()) {
		startVersionPolling(7000);
	}
}
