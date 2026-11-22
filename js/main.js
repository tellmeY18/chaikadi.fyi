import { mark, watchAppFrame } from './launch.js';
import { AppStore } from './store.js';
import { mount } from './ui.js';

// Hold the launch screen until the UI fonts are in (they are cached), so the
// app appears once, already in its final type, instead of reflowing after.
const FONTS = ['400 1em "Atkinson Hyperlegible Mono"', '700 1em "Atkinson Hyperlegible Mono"', '400 1em "Atkinson Hyperlegible Next"', '400 1em "Courier Prime"', '700 1em "Courier Prime"'];
const sheet = link => link.media === 'all' ? Promise.resolve() : new Promise(done => link.addEventListener('load', done, { once: true }));
await Promise.all([...document.querySelectorAll('link[data-app-css]')].map(sheet));
await Promise.race([Promise.all(FONTS.map(f => document.fonts.load(f))).catch(() => {}), new Promise(done => setTimeout(done, 1200))]);
mark('fontsReady');
const store = new AppStore();
mount(store, document.getElementById('app'));
mark('mounted'); watchAppFrame();
window.chaikadiStarted = true;
try { sessionStorage.removeItem('chaikadi-recovered'); } catch { /* storage blocked */ }
// Chrome (Android, desktop) fires this once the app is installable. Keep the
// event so an Install button can show the native dialog at a good moment.
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); store.ui.installEvent = event; store.emit(); });
window.addEventListener('appinstalled', () => { store.ui.installEvent = null; store.emit(); });
store.boot(new URL(location.href).searchParams.get('room')?.toUpperCase() || '')
  .catch(error => store.notice(`Could not restore local data: ${error.message}`));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { store.foreground(); checkForUpdate(); }
  else { store.background(); autoUpdate(); }
});
window.addEventListener('online', () => { store.foreground(); checkForUpdate(); });
window.addEventListener('pageshow', event => { if (event.persisted) store.foreground(); });

// App updates install in the background and apply themselves: right away when
// the app is in the background (or just opened), otherwise after a minute
// with no taps or typing and no sheet, dialog or text field open, so nobody is
// interrupted mid-action. Restarting is needed to run new code; saved groups,
// picks and queued changes are restored and connections reconnect on their own.
// "Update now" in Settings stays as a manual fallback.
let registration = null, lastCheck = 0, applying = false, takenOver = false, lastInput = Date.now();
const IDLE_MS = 60 * 1000;
for (const type of ['pointerdown', 'keydown', 'input', 'scroll']) addEventListener(type, () => { lastInput = Date.now(); store.touch(); }, { passive: true, capture: true });
function safeToRestart() {
  if (document.visibilityState === 'hidden') return true;
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
  return registration.waiting || takenOver ? 'ready' : 'current';
}
store.checkForUpdate = () => checkForUpdate({ force: true });
store.applyUpdate = async () => {
  if ((!registration?.waiting && !takenOver) || applying) return;
  applying = true; store.ui.updating = true; store.emit();
  await store.persist().catch(() => {});
  if (takenOver) { location.reload(); return; }
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  // Fallback if controllerchange never fires (e.g. worker already active).
  setTimeout(() => location.reload(), 4000);
};

if ('serviceWorker' in navigator) {
  // New workers take over on install; this page still runs the old code, so
  // restart into the new version at the next safe moment.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applying) { location.reload(); return; }
    if (!hadController) return; // first install: this page is already current
    takenOver = true; store.ui.updateReady = true; store.emit(); autoUpdate();
  });
  navigator.serviceWorker.register('./sw.js').then(async reg => {
    registration = reg;
    await navigator.serviceWorker.ready;
    mark('swReady'); store.ui.offline = 'Offline app ready'; store.emit();
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
