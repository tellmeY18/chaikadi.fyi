// Launch timeline, for diagnosing how opening the (installed) app looks. Each
// load records when the page, fonts, app and first app frame happened, plus
// whether the page was restarted (reload / service-worker takeover). The last
// few launches are kept on this device and shown in Settings → Developer options.
const KEY = 'chaikadi-launches', KEEP = 8;
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const nav = performance.getEntriesByType('navigation')[0];
let loads = 1;
try { loads = Number(sessionStorage.getItem('chaikadi-loads') || 0) + 1; sessionStorage.setItem('chaikadi-loads', String(loads)); } catch { /* storage blocked */ }
const entry = {
  at: new Date().toISOString(),
  standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  nav: nav?.type || 'unknown', loadsThisSession: loads,
  controlled: !!navigator.serviceWorker?.controller, visible: document.visibilityState,
  marks: {},
};
function save() { try { localStorage.setItem(KEY, JSON.stringify([...read().filter(e => e.at !== entry.at), entry].slice(-KEEP))); } catch { /* storage blocked */ } }
export function mark(name) { entry.marks[name] = Math.round(performance.now()); save(); }
// Everything that happened before main.js: response, DOM, and the browser's own paints.
if (nav) { entry.marks.responseEnd = Math.round(nav.responseEnd); entry.marks.domInteractive = Math.round(nav.domInteractive); }
for (const p of performance.getEntriesByType('paint')) entry.marks[p.name] = Math.round(p.startTime);
try { new PerformanceObserver(list => { for (const p of list.getEntries()) { entry.marks[p.name] = Math.round(p.startTime); } save(); }).observe({ type: 'paint', buffered: true }); } catch { /* unsupported */ }
mark('main.js');
// First frame that actually shows the app (not the launch screen).
export function watchAppFrame() {
  const check = () => {
    if (document.querySelector('.app-shell')) requestAnimationFrame(() => mark('appFrame'));
    else requestAnimationFrame(check);
  };
  check();
}
addEventListener('pagehide', () => mark('pagehide'));
export function launchText() {
  return read().map(e => `${e.at} ${e.standalone ? 'PWA' : 'browser'} nav=${e.nav} loadsThisSession=${e.loadsThisSession} sw=${e.controlled ? 'yes' : 'no'}\n  ` +
    Object.entries(e.marks).map(([k, v]) => `${k} ${v}ms`).join(' · ')).join('\n') || 'No launches recorded.';
}
