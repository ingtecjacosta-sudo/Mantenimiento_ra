// Service worker: permite instalar la app y abrirla sin conexión (después de la primera carga).
const CACHE = 'mant-ra-v9';
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'js/main.js', 'js/panel.js', 'js/labels.js', 'js/ui.js', 'js/overlay.js', 'js/data.js', 'js/preview.js', 'js/photo.js', 'js/croquis.js', 'js/quicklook.js',
  'data/machines.json', 'data/excavadora-20t.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Librerías del CDN (versión fija): primero caché.
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // Archivos propios: primero la red (para recibir actualizaciones), caché si no hay conexión.
  if (url.origin === self.location.origin) {
    // 'no-cache' obliga a preguntar al servidor: evita mezclar archivos viejos y nuevos.
    e.respondWith(fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true })));
  }
});
