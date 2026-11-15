// Connection log for Developer options. Kept in memory on this device only
// (never sent anywhere); the last MAX entries. Important events are always
// recorded; detailed ("debug") ones, including PeerJS's own log, only while
// verbose logging is on.
const MAX = 800;
const entries = [];
const listeners = new Set();
let verbose = false;
// While verbose, the log survives a reload (a crash or an update restart can
// be what you are trying to catch). Stored in this browser only.
const SAVED = 'chaikadi-netlog';
try { const saved = JSON.parse(localStorage.getItem(SAVED) || '[]'); if (Array.isArray(saved)) entries.push(...saved.slice(-MAX)); } catch { /* no storage */ }
let saveTimer = null;
const save = () => {
  if (typeof localStorage === 'undefined' || saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; try { if (verbose) localStorage.setItem(SAVED, JSON.stringify(entries.slice(-MAX))); else localStorage.removeItem(SAVED); } catch { /* full or blocked */ } }, 1000);
};

export function setVerbose(on) { verbose = !!on; save(); }
export const isVerbose = () => verbose;
const text = value => {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
};
export function log(level, message, detail) {
  if (level === 'debug' && !verbose) return;
  entries.push({ time: Date.now(), level, message: String(message), detail: text(detail).slice(0, 600) });
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  save();
  for (const fn of listeners) { try { fn(); } catch { /* listener bug */ } }
}
export const logs = () => entries.slice();
export function clearLogs() { entries.length = 0; save(); for (const fn of listeners) fn(); }
export function onLog(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const logText = () => entries.map(e => `${new Date(e.time).toISOString().slice(11, 23)} ${e.level.toUpperCase().padEnd(5)} ${e.message}${e.detail ? ` ${e.detail}` : ''}`).join('\n');
