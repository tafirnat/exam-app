/**
 * Exam App — Service Worker
 * Handles scheduled local notifications for:
 *   - Channel A: General Streak reminder (default 09:00)
 *   - Channel B: Focus Streak reminder   (default 19:00)
 *
 * No external push server required. Notifications are scheduled via
 * postMessage from notification-manager.js and shown with showNotification().
 */

const SW_VERSION = 'exam-app-sw-v1';

/* ------------------------------------------------------------------ */
/* Lifecycle                                                            */
/* ------------------------------------------------------------------ */

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

/* ------------------------------------------------------------------ */
/* Scheduled notification timers                                        */
/* Timers are reset every time the app page sends SCHEDULE_NOTIFICATION */
/* ------------------------------------------------------------------ */

const scheduledTimers = {};  // { 'general': timeoutId, 'focus': timeoutId }

/**
 * Schedules a showNotification() call at the given timestamp.
 * If the timestamp is already in the past, fires within 1 second.
 */
function scheduleNotification(channel, scheduledAt, payload) {
    // Clear any existing timer for this channel
    if (scheduledTimers[channel] !== undefined) {
        clearTimeout(scheduledTimers[channel]);
        delete scheduledTimers[channel];
    }

    const now = Date.now();
    const delay = Math.max(scheduledAt - now, 1000);

    scheduledTimers[channel] = setTimeout(async () => {
        delete scheduledTimers[channel];
        try {
            await self.registration.showNotification(payload.title, {
                body:     payload.body,
                icon:     payload.icon    || '/app-icon.png',
                badge:    payload.badge   || '/app-icon.png',
                tag:      `exam-app-${channel}`,  // replaces previous same-channel notif
                renotify: false,
                data:     { channel, action: payload.action || 'open' }
            });
        } catch (err) {
            console.warn('[SW] showNotification failed:', err);
        }
    }, delay);
}

/* ------------------------------------------------------------------ */
/* Message handler (from notification-manager.js)                      */
/* ------------------------------------------------------------------ */

self.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || !msg.type) return;

    switch (msg.type) {
        case 'SCHEDULE_NOTIFICATION': {
            const { channel, scheduledAt, payload } = msg;
            if (!channel || !scheduledAt || !payload) break;
            scheduleNotification(channel, scheduledAt, payload);
            break;
        }

        case 'CANCEL_NOTIFICATION': {
            const { channel } = msg;
            if (channel && scheduledTimers[channel] !== undefined) {
                clearTimeout(scheduledTimers[channel]);
                delete scheduledTimers[channel];
            } else if (!channel) {
                // Cancel all
                Object.keys(scheduledTimers).forEach(ch => clearTimeout(scheduledTimers[ch]));
                Object.keys(scheduledTimers).forEach(ch => delete scheduledTimers[ch]);
            }
            break;
        }

        case 'PING':
            // Keepalive — notification-manager.js sends this every 20s while timers are active
            break;
    }
});

/* ------------------------------------------------------------------ */
/* Notification click handler                                           */
/* ------------------------------------------------------------------ */

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const { channel } = event.notification.data || {};

    const targetUrl = channel === 'focus'
        ? self.registration.scope + '?action=focus'
        : self.registration.scope + '?action=streak';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clients) => {
                // If app already open, focus it and send a message
                for (const client of clients) {
                    if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
                        client.focus();
                        client.postMessage({ type: 'NOTIFICATION_CLICKED', channel });
                        return;
                    }
                }
                return self.clients.openWindow(targetUrl);
            })
    );
});

/* ------------------------------------------------------------------ */
/* Notification close (dismiss) handler — for ignore streak tracking   */
/* ------------------------------------------------------------------ */

self.addEventListener('notificationclose', (event) => {
    const { channel } = event.notification.data || {};
    if (!channel) return;

    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clients) => {
            clients.forEach(client =>
                client.postMessage({ type: 'NOTIFICATION_DISMISSED', channel })
            );
        });
});
