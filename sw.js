const CACHE_NAME = 'music-cache-v2'; // Cambiar si actualizas archivos
const ASSETS = [
    'index.html',
    'manifest.json',
    'icon.png',
    'app.js',
    'api.js'
    // Si tienes más archivos críticos, agrégalos aquí
];

// Instalar y guardar archivos en caché
self.addEventListener('install', event => {
    self.skipWaiting(); // Activa la nueva versión inmediatamente
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
});

// Activar el nuevo service worker y eliminar caché viejo
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        })
    );
    self.clients.claim(); // Toma control inmediato de las páginas abiertas
});

// Interceptar peticiones y devolver desde caché si es posible
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            // Devuelve la respuesta cacheada o la busca de la red
            return response || fetch(event.request).catch(() => {
                // Si falla la red y no está en caché, se puede mostrar algo opcional
                if (event.request.destination === 'document') {
                    return new Response('<h1>Sin conexión</h1><p>No se pudo cargar el contenido.</p>', {
                        headers: { 'Content-Type': 'text/html' }
                    });
                }
            });
        })
    );
});