import { AppStore } from './store.js';
import { mount } from './ui.js';

const store = new AppStore();
mount(store, document.getElementById('app'));
store.boot(new URL(location.href).searchParams.get('room')?.toUpperCase() || '')
  .catch(error => store.notice(`Could not restore local data: ${error.message}`));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { store.foreground(); checkForUpdate(); }
  else autoUpdate();
});
window.addEventListener('online', () => { store.foreground(); checkForUpdate(); });
window.addEventListener('pageshow', event => { if (event.persisted) store.foreground(); });

// App updates install in the background and apply themselves: right away when
// the app is in the background (or just opened), otherwise after a minute
// with no taps or typing and no sheet, dialog or text field open, so nobody is
// interrupted mid-action. Restarting is needed to run new code; saved groups,
// picks and queued changes are restored and connections reconnect on their own.
// "Update now" in Settings stays as a manual fallback.
let registration = null, lastCheck = 0, applying = false, lastInput = Date.now();
const IDLE_MS = 60 * 1000, LOADED = Date.now();
let touched = false;
for (const type of ['pointerdown', 'keydown', 'input', 'scroll']) addEventListener(type, () => { lastInput = Date.now(); touched = true; }, { passive: true, capture: true });
function safeToRestart() {
  if (document.visibilityState === 'hidden') return true;
  if (!touched && Date.now() - LOADED < 10 * 1000) return true; // just opened
  if (Date.now() - lastInput < IDLE_MS) return false;
  const active = document.activeElement;
  return !document.querySelector('dialog[open]') && !(active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
}
function autoUpdate() {
  if (store.ui.updateReady && !applying && safeToRestart()) store.applyUpdate();
}
setInterval(autoUpdate, 15 * 1000);
setInterval(() => checkForUpdate(), 30 * 60 * 1000);
function markReady() {
  if (registration?.waiting && navigator.serviceWorker.controller) { store.ui.updateReady = true; store.emit(); autoUpdate(); }
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
