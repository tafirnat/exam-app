const CACHE_NAME = 'focus-app-v14';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.webmanifest',
    './app-icon.png',
    './examples/standard-exam.json',
    './examples/ihk-fisi-flashcards.json'
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

// Activation: Clean up old caches
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
        })
    );
});

// Fetch: Network First Strategy
self.addEventListener('fetch', (event) => {
    // Skip non-http/https requests and Google API requests
    if (!event.request.url.startsWith('http') || event.request.url.includes('googleapis.com') || event.request.url.includes('google.com/gsi')) {
        return;
    }


    event.respondWith(
        fetch(event.request)
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
