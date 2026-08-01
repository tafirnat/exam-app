// Bump on every release: the activate handler deletes any cache whose name no
// longer matches, and an unchanged name is also what stops the browser from
// noticing this file changed at all.
const CACHE_NAME = 'focus-app-v23';
// cache.addAll rejects as a whole if any one entry 404s, which would leave the
// install with no cache at all — so this list has to track the files that
// actually ship. All three samples are precached because the language is only
// known at runtime and a first run may already be offline.
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.webmanifest?v=2',
    './app-icon.png?v=2',
    './examples/sample-tr.json',
    './examples/sample-en.json',
    './examples/sample-de.json'
];

// Installaion: Cache files and skip waiting
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

// Activation: Clean up old caches and claim clients immediately
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Skip waiting message listener
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// Fetch: Network First Strategy
self.addEventListener('fetch', (event) => {
    // Skip non-http/https requests and Google API requests
    if (!event.request.url.startsWith('http') || event.request.url.includes('googleapis.com') || event.request.url.includes('google.com/gsi')) {
        return;
    }


    // The whole app is one index.html, so a stale copy of it freezes every
    // feature at once. Navigations bypass the HTTP cache; without this, the
    // network-first strategy still resolves from the browser cache and the
    // page can stay on an old build long after a deploy.
    const request = event.request.mode === 'navigate'
        ? new Request(event.request, { cache: 'reload' })
        : event.request;

    event.respondWith(
        fetch(request)
            .then((response) => {
                // If network works, update cache and return response
                if (response && response.status === 200 && event.request.method === 'GET') {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }

                return response;
            })
            .catch(() => {
                // If network fails, try cache
                return caches.match(event.request);
            })
    );
});
