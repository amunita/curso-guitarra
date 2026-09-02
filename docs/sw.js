/* Service worker: la app completa funciona offline (cache-first). */
const VERSION = 'ae547a6896';
const CACHE = 'guitarra-' + VERSION;
const ASSETS = [
  './',
  './index.html',
  './app.css?v=' + VERSION,
  './app.js?v=' + VERSION,
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './samples/A2.mp3',
  './samples/A3.mp3',
  './samples/A4.mp3',
  './samples/A5.mp3',
  './samples/As5.mp3',
  './samples/B2.mp3',
  './samples/B3.mp3',
  './samples/B4.mp3',
  './samples/Cs3.mp3',
  './samples/Cs4.mp3',
  './samples/Cs5.mp3',
  './samples/D3.mp3',
  './samples/D5.mp3',
  './samples/Ds4.mp3',
  './samples/E2.mp3',
  './samples/E3.mp3',
  './samples/E4.mp3',
  './samples/E5.mp3',
  './samples/Fs2.mp3',
  './samples/Fs3.mp3',
  './samples/Fs4.mp3',
  './samples/Fs5.mp3',
  './samples/G3.mp3',
  './samples/G5.mp3',
  './samples/Gs2.mp3',
  './samples/Gs4.mp3',
  './samples/Gs5.mp3'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' }).then(hit => {
      if (hit) return hit;
      if (e.request.mode === 'navigate') return caches.match('./index.html');
      return fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      });
    })
  );
});
