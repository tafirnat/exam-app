const CACHE_NAME = 'focus-app-v2';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './src/main.js',
    './src/style.css',
    './manifest.webmanifest',
    './icon-192.png',
    './icon-512.png',
    './examples/standard-exam.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});
