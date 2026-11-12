import { AppStore } from './store.js';
import { mount } from './ui.js';

const store = new AppStore();
mount(store, document.getElementById('app'));
store.boot(new URL(location.href).searchParams.get('room')?.toUpperCase() || '')
  .catch(error => store.notice(`Could not restore local data: ${error.message}`));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { store.foreground(); checkForUpdate(); }
});
window.addEventListener('online', () => { store.foreground(); checkForUpdate(); });
window.addEventListener('pageshow', event => { if (event.persisted) store.foreground(); });

// App updates. A new service worker installs in the background and WAITS: an
// active order never switches versions on its own. The in-app "Update now"
// button saves everything, activates the new worker and restarts the page
// once (running new code requires that). Saved groups, picks and queued
// changes are restored and room-code connections reconnect automatically.
let registration = null, lastCheck = 0, applying = false;
function markReady() {
  if (registration?.waiting && navigator.serviceWorker.controller) { store.ui.updateReady = true; store.emit(); }
}
async function checkForUpdate({ force = false } = {}) {
  if (!registration || (!force && Date.now() - lastCheck < 30 * 60 * 1000)) return 'skipped';
  lastCheck = Date.now();
  try { await registration.update(); } catch { return 'offline'; }
  // A found update finishes installing asynchronously; give it a moment.
  for (let i = 0; i < 40 && registration.installing; i++) await new Promise(r => setTimeout(r, 250));
  markReady();
  return registration.waiting ? 'ready' : 'current';
}
store.checkForUpdate = () => checkForUpdate({ force: true });
store.applyUpdate = async () => {
  if (!registration?.waiting || applying) return;
  applying = true; store.ui.updating = true; store.emit();
  await store.persist().catch(() => {});
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  // Fallback if controllerchange never fires (e.g. worker already active).
  setTimeout(() => location.reload(), 4000);
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (applying) location.reload(); });
  navigator.serviceWorker.register('./sw.js').then(async reg => {
    registration = reg;
    await navigator.serviceWorker.ready;
    store.ui.offline = 'Offline app ready'; store.emit();
    markReady();
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed') markReady(); });
    });
    lastCheck = Date.now();
  }).catch(() => {
    store.ui.offline = 'Offline app unavailable — use HTTPS and allow site storage'; store.emit();
  });
}
