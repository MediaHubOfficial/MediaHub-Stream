const CACHE_NAME = 'music-cache-v2'; // Cambia el nombre en cada actualización
const ASSETS = [
    'index.html',
    'manifest.json',
    'icon.png'
];

// Instalar y guardar en caché
self.addEventListener('install', event => {
    self.skipWaiting(); // Activa la nueva versión inmediatamente
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
});

// Activar y eliminar caché antigua
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        })
    );
});

// Interceptar peticiones y devolver desde caché si es posible
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request);
        })
    );
});
