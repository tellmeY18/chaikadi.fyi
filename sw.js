// Bump this version whenever any app-shell file changes. Cache installation is
// atomic: one missing dependency fails installation rather than half-caching.
const CACHE = 'chaikadi-shell-v35';
// The ~7 MB menu reader (OCR) is NOT part of the shell: it is cached on first
// use in its own cache, which survives shell updates. Bump only when
// vendor/ocr/ files change.
const OCR_CACHE = 'chaikadi-ocr-v1';
// Menus come from Eatsights (cross-origin): the app caches them in IndexedDB
// with ETags, so this worker leaves those requests alone. The old static
// library cache is deleted on activate (any chaikadi-* cache not kept below).
const SHELL = [
  './', './styles.css', './manifest.json',
  './js/config.js', './js/state.js', './js/store.js', './js/p2p.js', './js/qr.js', './js/ui.js', './js/main.js', './js/ingest.js',
  './js/strings.js', './js/components.js', './js/data.js', './js/library-ui.js', './js/eatsights.js', './js/contrib.js', './js/eatsights-ui.js', './js/prompts.js', './js/netlog.js', './js/dev-ui.js', './js/icediag.js', './js/upi.js', './js/install.js',
  './brand/tokens/tokens.css', './brand/css/base.css', './brand/css/components.css',
  './brand/fonts/atkinson-hyperlegible-mono-latin.woff2', './brand/fonts/courier-prime-400-latin.woff2', './brand/fonts/courier-prime-700-latin.woff2', './brand/fonts/noto-serif-malayalam.woff2',
  './vendor/preact.module.js', './vendor/htm.module.js', './vendor/peerjs.min.js', './vendor/qrcode.js', './vendor/jsQR.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
];
self.addEventListener('install', event => {
  // cache: 'reload' skips the browser's HTTP cache. Without it Safari can mix
  // a fresh file with hours-old ones (the CDN may send max-age), breaking imports.
  // skipWaiting: a broken page cannot ask for the update, so take over at once.
  event.waitUntil(caches.open(CACHE)
    .then(cache => cache.addAll(SHELL.map(path => new Request(path, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
// Updates download in the background and the app applies them on its own
// when idle or in the background (see main.js).
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', event => {
  const keep = new Set([CACHE, OCR_CACHE]);
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('chaikadi-') && !keep.has(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  // Query-string room invitations resolve to the precached SPA offline too.
  // Cache "./" (not index.html): hosts like Cloudflare Pages redirect
  // /index.html -> /, and a cached redirect cannot answer a navigation.
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(cache => cache.match('./')).then(cached => cached || fetch(event.request)));
    return;
  }
  if (url.pathname.includes('/vendor/ocr/')) {
    event.respondWith(caches.open(OCR_CACHE).then(async cache => {
      const cached = await cache.match(url.pathname);
      if (cached) return cached;
      const response = await fetch(url.pathname);
      if (response.ok) await cache.put(url.pathname, response.clone());
      return response;
    }));
    return;
  }
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request, { ignoreSearch: true })) || fetch(event.request, { cache: 'no-cache' })));
});
