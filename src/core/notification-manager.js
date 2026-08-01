/**
 * Exam App — Notification Manager
 *
 * Single owner of all notification logic:
 *  - Service Worker registration
 *  - Permission request (opt-in, triggered at positive moments)
 *  - Payload building (4-variant rotation, streak-aware)
 *  - Quiet hours & adaptive silencing
 *  - Scheduling via SW postMessage
 *  - Settings persistence via AppState.continuityConfig.notificationSettings
 *
 * Two independent channels:
 *  A — "General Streak" reminder   (default 09:00, always if enabled)
 *  B — "Focus Streak"  reminder    (default 19:00, only if focus pool active)
 */

import { AppState, saveContinuityConfig } from './state.js';
import {
    calculateGlobalStreak,
    calculateFocusStreak,
    getLiveFocusSources,
    getFocusSourceLabel,
    getLocalDateStr,
    initTodayActivity
} from '../features/stats/continuity-engine.js';
import { t } from './i18n.js';

/* ------------------------------------------------------------------ */
/* Internal helpers                                                     */
/* ------------------------------------------------------------------ */

function getSettings() {
    // Ensure the notificationSettings object always has all keys even for
    // users who loaded their config before this feature was added.
    const defaults = {
        enabled: false,
        focusEnabled: false,
        quietHoursStart: '22:00',
        quietHoursEnd: '08:00',
        dailyScheduleHour: 9,
        dailyScheduleMinute: 0,
        focusScheduleHour: 19,
        focusScheduleMinute: 0,
        lastNotifiedDate: null,
        lastFocusNotifiedDate: null,
        ignoreStreakA: 0,
        ignoreStreakB: 0,
        pausedUntilA: null,
        pausedUntilB: null,
        optInDismissedAt: null,
        optInFocusDismissedAt: null
    };
    if (!AppState.continuityConfig) AppState.continuityConfig = {};
    if (!AppState.continuityConfig.notificationSettings) {
        AppState.continuityConfig.notificationSettings = {};
    }
    return Object.assign(defaults, AppState.continuityConfig.notificationSettings);
}

function saveSettings(patch) {
    if (!AppState.continuityConfig) AppState.continuityConfig = {};
    AppState.continuityConfig.notificationSettings = Object.assign(getSettings(), patch);
    saveContinuityConfig();
}

/** Day-of-year index used to rotate message variants. */
function dayOfYear() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const diff = now - start;
    return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/** Returns today's YYYY-MM-DD string. */
function today() { return getLocalDateStr(); }

/** Adds N calendar days to a YYYY-MM-DD string. */
function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return getLocalDateStr(d);
}

/* ------------------------------------------------------------------ */
/* Quiet-hours check                                                    */
/* ------------------------------------------------------------------ */

/**
 * Returns true if the current time is inside the configured quiet window.
 * Handles overnight spans (e.g. 22:00–08:00).
 */
function isQuietHours(s = getSettings()) {
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = s.quietHoursStart.split(':').map(Number);
    const [eh, em] = s.quietHoursEnd.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins   = eh * 60 + em;

    if (startMins <= endMins) {
        return nowMins >= startMins && nowMins < endMins;
    }
    // Overnight: e.g. 22:00 → 08:00
    return nowMins >= startMins || nowMins < endMins;
}

/* ------------------------------------------------------------------ */
/* Adaptive silencing                                                   */
/* ------------------------------------------------------------------ */

/**
 * Checks whether channel A (General) should fire today.
 * If 3 consecutive dismissals → pause for 2 days.
 */
function shouldSendA(s) {
    if (s.pausedUntilA && today() < s.pausedUntilA) return false;
    if ((s.ignoreStreakA || 0) >= 3) {
        saveSettings({ pausedUntilA: addDays(today(), 2), ignoreStreakA: 0 });
        return false;
    }
    return true;
}

/** Same for channel B (Focus). */
function shouldSendB(s) {
    if (s.pausedUntilB && today() < s.pausedUntilB) return false;
    if ((s.ignoreStreakB || 0) >= 3) {
        saveSettings({ pausedUntilB: addDays(today(), 2), ignoreStreakB: 0 });
        return false;
    }
    return true;
}

/* ------------------------------------------------------------------ */
/* Payload builders                                                     */
/* ------------------------------------------------------------------ */

function buildGeneralPayload(overdueCount, globalStreak) {
    const estMins = Math.max(1, Math.round((overdueCount || 15) * 0.75));
    const count = overdueCount || '?';
    const idx = dayOfYear() % 4;

    const bodyVariants = [
        `${globalStreak > 0 ? `🔥 ${globalStreak} günlük serin devam ediyor · ` : ''}Bugün ${count} kart hazır (~${estMins} dk)`,
        `📚 ${count} kart seni bekliyor${globalStreak > 0 ? ` · ${globalStreak} günlük seriyi koru` : ''}!`,
        `⚡ Bugün ${count} tekrar var · Toplam ~${estMins} dakika yeter`,
        `🎯 ${count} kart gün bitmeden hazır${globalStreak > 0 ? ` · Serinle devam et` : ''}`
    ];

    return {
        title: 'Exam App',
        body:  bodyVariants[idx],
        icon:  '/app-icon.png',
        badge: '/app-icon.png',
        action: 'streak'
    };
}

function buildFocusPayload(focusStreak, remaining) {
    const focusSources = getLiveFocusSources();
    const primaryLabel = focusSources.length > 0
        ? getFocusSourceLabel(focusSources[0])
        : 'Odak';
    const idx = dayOfYear() % 4;

    const bodyVariants = [
        `🎯 Odak hedefin tamamlanmadı · ${primaryLabel}: ${remaining} soru kaldı`,
        `📌 ${focusStreak > 0 ? `${focusStreak} günlük odak serin devam ediyor · ` : ''}${remaining} sorunu bitir`,
        `⏰ Günün bitmeden ${remaining} odak sorusu var · ${primaryLabel}`,
        `🏹 ${primaryLabel} — ${remaining} adım kaldı${focusStreak > 0 ? `, ${focusStreak} günlük serin güvende` : ''}`
    ];

    return {
        title: 'Exam App',
        body:  bodyVariants[idx],
        icon:  '/app-icon.png',
        badge: '/app-icon.png',
        action: 'focus'
    };
}

/* ------------------------------------------------------------------ */
/* Remaining focus questions helper                                     */
/* ------------------------------------------------------------------ */

function getFocusRemainingToday() {
    const todayActivity = (AppState.studyActivity || {})[today()];
    if (!todayActivity) return 15;
    const req = Math.max(1, todayActivity.focusOverdueSnapshot || 15);
    const done = todayActivity.focusQuestionCount || 0;
    return Math.max(0, req - done);
}

/* ------------------------------------------------------------------ */
/* Service Worker communication                                         */
/* ------------------------------------------------------------------ */

let _swReg = null;  // Cached SW registration

/** Sends a message to the active SW controller (or cached registration). */
async function swPost(msg) {
    try {
        if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage(msg);
        } else if (_swReg && _swReg.active) {
            _swReg.active.postMessage(msg);
        }
    } catch (e) {
        console.warn('[NotifMgr] SW post failed:', e);
    }
}

/** Next occurrence of HH:MM today (or tomorrow if already past). */
function nextOccurrence(hour, minute) {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.getTime();
}

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */

/**
 * Registers the Service Worker. Call once on app boot (main.js).
 * Returns the SW registration or null.
 */
export async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        _swReg = reg;
        console.log('[NotifMgr] SW registered:', reg.scope);

        // Listen for messages from SW (click & dismiss events)
        navigator.serviceWorker.addEventListener('message', handleSwMessage);

        return reg;
    } catch (err) {
        console.warn('[NotifMgr] SW registration failed:', err);
        return null;
    }
}

/**
 * Schedules notifications for today into the SW.
 * Called on every app boot and after settings change.
 */
export function scheduleNotifications() {
    const s = getSettings();
    if (isQuietHours(s)) return;  // Reschedule will happen on next boot

    const todayStr = today();

    // Channel A — General Streak
    if (s.enabled && shouldSendA(s) && s.lastNotifiedDate !== todayStr) {
        const globalStreak = calculateGlobalStreak();
        const act = initTodayActivity();
        const overdue = act.overdueSnapshot ?? 15;
        const payload = buildGeneralPayload(overdue, globalStreak);
        const scheduledAt = nextOccurrence(s.dailyScheduleHour, s.dailyScheduleMinute);

        swPost({ type: 'SCHEDULE_NOTIFICATION', channel: 'general', scheduledAt, payload });
    }

    // Channel B — Focus Streak (only if focus pool is active)
    const focusSources = getLiveFocusSources();
    if (s.focusEnabled && focusSources.length > 0 && shouldSendB(s) && s.lastFocusNotifiedDate !== todayStr) {
        const focusStreak = calculateFocusStreak();
        const remaining = getFocusRemainingToday();
        if (remaining > 0) {
            const payload = buildFocusPayload(focusStreak, remaining);
            const scheduledAt = nextOccurrence(s.focusScheduleHour, s.focusScheduleMinute);

            swPost({ type: 'SCHEDULE_NOTIFICATION', channel: 'focus', scheduledAt, payload });
        }
    }
}

/** Cancels a specific channel ('general' | 'focus') or all if omitted. */
export function cancelNotifications(channel) {
    swPost({ type: 'CANCEL_NOTIFICATION', channel });
}

/**
 * Requests browser notification permission, then enables a channel.
 * Returns 'granted' | 'denied' | 'dismissed'.
 */
export async function requestNotificationPermission(channel = 'general') {
    if (!('Notification' in window)) return 'denied';

    if (Notification.permission === 'granted') {
        _enableChannel(channel);
        return 'granted';
    }

    if (Notification.permission === 'denied') return 'denied';

    const result = await Notification.requestPermission();
    if (result === 'granted') {
        _enableChannel(channel);
        scheduleNotifications();
    }
    return result;
}

function _enableChannel(channel) {
    if (channel === 'general') {
        saveSettings({ enabled: true });
    } else if (channel === 'focus') {
        saveSettings({ focusEnabled: true });
    }
}

/** Disables a channel and cancels its scheduled notification. */
export function disableNotifications(channel = 'general') {
    if (channel === 'general') saveSettings({ enabled: false });
    if (channel === 'focus')   saveSettings({ focusEnabled: false });
    cancelNotifications(channel);
}

/** Returns a snapshot of current notification status. */
export function getNotificationStatus() {
    const s = getSettings();
    return {
        generalEnabled: s.enabled,
        focusEnabled:   s.focusEnabled,
        permission:     'Notification' in window ? Notification.permission : 'unsupported',
        swAvailable:    'serviceWorker' in navigator
    };
}

/**
 * Updates arbitrary fields in notificationSettings and reschedules.
 * Used by the settings UI panel.
 */
export function saveNotificationSettings(patch) {
    saveSettings(patch);
    cancelNotifications(); // cancel all, then reschedule with new config
    scheduleNotifications();
}

/* ------------------------------------------------------------------ */
/* Opt-in flow helpers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Returns true if the opt-in prompt for channel A should be shown now.
 * Rules:
 *  - Notifications not yet enabled
 *  - User hasn't dismissed within 7 days
 */
export function shouldShowOptIn() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'denied') return false;

    const s = getSettings();
    if (s.enabled) return false;   // Already enabled

    if (s.optInDismissedAt) {
        const dismissedDate = new Date(s.optInDismissedAt);
        const diff = (Date.now() - dismissedDate.getTime()) / (1000 * 60 * 60 * 24);
        if (diff < 7) return false;
    }

    return true;
}

/** Same for channel B (Focus). */
export function shouldShowFocusOptIn() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'denied') return false;

    const s = getSettings();
    if (s.focusEnabled) return false;

    const focusSources = getLiveFocusSources();
    if (focusSources.length === 0) return false;  // No focus pool — don't prompt

    if (s.optInFocusDismissedAt) {
        const dismissedDate = new Date(s.optInFocusDismissedAt);
        const diff = (Date.now() - dismissedDate.getTime()) / (1000 * 60 * 60 * 24);
        if (diff < 7) return false;
    }

    return true;
}

/** Records that the user dismissed the opt-in for channel A. */
export function dismissOptIn() {
    saveSettings({ optInDismissedAt: new Date().toISOString() });
}

/** Records that the user dismissed the opt-in for channel B (Focus). */
export function dismissFocusOptIn() {
    saveSettings({ optInFocusDismissedAt: new Date().toISOString() });
}

/**
 * Sends a test notification immediately (for settings verification).
 * Channel defaults to 'general'.
 */
export async function sendTestNotification(channel = 'general') {
    if (Notification.permission !== 'granted') {
        const result = await requestNotificationPermission(channel);
        if (result !== 'granted') return false;
    }

    const payload = channel === 'focus'
        ? buildFocusPayload(calculateFocusStreak(), getFocusRemainingToday())
        : buildGeneralPayload(15, calculateGlobalStreak());

    // Fire in 5 seconds so the user has time to switch away from the tab
    await swPost({
        type: 'SCHEDULE_NOTIFICATION',
        channel,
        scheduledAt: Date.now() + 5000,
        payload
    });
    return true;
}

/* ------------------------------------------------------------------ */
/* SW message handler (called from registerServiceWorker)               */
/* ------------------------------------------------------------------ */

function handleSwMessage(event) {
    const msg = event.data;
    if (!msg || !msg.type) return;

    const s = getSettings();

    if (msg.type === 'NOTIFICATION_CLICKED') {
        // User tapped the notification — reset ignore counter
        if (msg.channel === 'general') {
            saveSettings({ ignoreStreakA: 0, lastNotifiedDate: today() });
        } else if (msg.channel === 'focus') {
            saveSettings({ ignoreStreakB: 0, lastFocusNotifiedDate: today() });
        }
    }

    if (msg.type === 'NOTIFICATION_DISMISSED') {
        // User swiped/closed the notification — increment ignore counter
        if (msg.channel === 'general') {
            saveSettings({ ignoreStreakA: (s.ignoreStreakA || 0) + 1, lastNotifiedDate: today() });
        } else if (msg.channel === 'focus') {
            saveSettings({ ignoreStreakB: (s.ignoreStreakB || 0) + 1, lastFocusNotifiedDate: today() });
        }
    }
}

/* ------------------------------------------------------------------ */
/* Opt-in modal (rendered into DOM)                                     */
/* ------------------------------------------------------------------ */

/**
 * Shows the opt-in prompt modal after a positive moment (test finish / streak milestone).
 * If the user accepts, triggers permission request.
 * @param {Object} options
 * @param {boolean} options.offerFocus  - also offer focus channel if pool active
 * @param {Function} options.onDone     - callback when modal is dismissed (any path)
 */
export function showOptInModal({ offerFocus = false, onDone = null } = {}) {
    // Remove any existing modal
    const existing = document.getElementById('notifOptInModal');
    if (existing) existing.remove();

    const focusAvailable = offerFocus && shouldShowFocusOptIn();

    const modal = document.createElement('div');
    modal.id = 'notifOptInModal';
    modal.className = 'notif-optin-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'notifOptInTitle');

    modal.innerHTML = `
        <div class="notif-optin-backdrop"></div>
        <div class="notif-optin-card">
            <div class="notif-optin-icon">🔔</div>
            <h3 class="notif-optin-title" id="notifOptInTitle">${t('notif_opt_in_title')}</h3>
            <p class="notif-optin-body">${t('notif_opt_in_body')}</p>

            <label class="notif-optin-check-row">
                <input type="checkbox" id="notifOptInGeneral" checked>
                <span>${t('notif_opt_in_general')}</span>
                <em class="notif-optin-time">09:00</em>
            </label>

            ${focusAvailable ? `
            <label class="notif-optin-check-row">
                <input type="checkbox" id="notifOptInFocus">
                <span>${t('notif_opt_in_focus')}</span>
                <em class="notif-optin-time">19:00</em>
            </label>` : ''}

            <div class="notif-optin-actions">
                <button class="btn-primary" id="notifOptInYes">${t('notif_opt_in_yes')}</button>
                <button class="btn-ghost"   id="notifOptInNo">${t('notif_opt_in_no')}</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Animate in
    requestAnimationFrame(() => modal.classList.add('visible'));

    function close() {
        modal.classList.remove('visible');
        setTimeout(() => modal.remove(), 300);
        if (typeof onDone === 'function') onDone();
    }

    document.getElementById('notifOptInYes').addEventListener('click', async () => {
        const wantsGeneral = document.getElementById('notifOptInGeneral')?.checked ?? true;
        const wantsFocus   = document.getElementById('notifOptInFocus')?.checked ?? false;

        if (wantsGeneral) {
            await requestNotificationPermission('general');
        }
        if (wantsFocus && focusAvailable) {
            await requestNotificationPermission('focus');
        }

        // If neither box ticked, treat as dismiss
        if (!wantsGeneral && !wantsFocus) {
            dismissOptIn();
            if (focusAvailable) dismissFocusOptIn();
        }

        scheduleNotifications();
        close();
    });

    document.getElementById('notifOptInNo').addEventListener('click', () => {
        dismissOptIn();
        if (focusAvailable) dismissFocusOptIn();
        close();
    });

    document.querySelector('.notif-optin-backdrop').addEventListener('click', () => {
        dismissOptIn();
        close();
    });
}
