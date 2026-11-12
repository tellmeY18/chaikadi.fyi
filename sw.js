// Bump this version whenever any app-shell file changes. Cache installation is
// atomic: one missing dependency fails installation rather than half-caching.
const CACHE = 'chaikadi-shell-v5';
const SHELL = [
  './', './styles.css', './manifest.json',
  './js/config.js', './js/state.js', './js/store.js', './js/p2p.js', './js/qr.js', './js/ui.js', './js/main.js',
  './vendor/preact.module.js', './vendor/htm.module.js', './vendor/peerjs.min.js', './vendor/qrcode.js', './vendor/jsQR.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('chaikadi-shell-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Query-string room invitations resolve to the precached SPA offline too.
  // Cache "./" (not index.html): hosts like Cloudflare Pages redirect
  // /index.html -> /, and a cached redirect cannot answer a navigation.
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(cache => cache.match('./')).then(cached => cached || fetch(event.request)));
    return;
  }
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request, { ignoreSearch: true })) || fetch(event.request)));
});
