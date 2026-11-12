import { AppStore } from './store.js';
import { mount } from './ui.js';

const store = new AppStore();
mount(store, document.getElementById('app'));
store.boot(new URL(location.href).searchParams.get('room')?.toUpperCase() || '')
  .catch(error => store.notice(`Could not restore local data: ${error.message}`));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') store.foreground();
});
window.addEventListener('online', () => store.foreground());
window.addEventListener('pageshow', event => { if (event.persisted) store.foreground(); });

// Let an updated worker wait until all old tabs close: an active order should
// never reload or switch app versions halfway through a peer message.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(async registration => {
    await navigator.serviceWorker.ready;
    store.ui.offline = 'Offline app ready'; store.emit();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          store.notice('An app update is ready. Close all Chaikadi tabs and reopen when your round is finished.');
        }
      });
    });
  }).catch(() => {
    store.ui.offline = 'Offline app unavailable — use HTTPS and allow site storage'; store.emit();
  });
}
