// CONFIG HOOK: change these defaults, or use Settings on each device.
// TURN credentials bundled in a static app are public. Use short-lived credentials
// from a service you control if you deploy a production TURN service.
export const DEFAULT_CONFIG = {
  signaling: { host: '0.peerjs.com', port: 443, path: '/', secure: true, key: 'peerjs' },
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }],
};
export const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
// Shown in Settings. Bump with the service-worker cache version on release.
export const APP_VERSION = '2026.11.13-6';
// Multi-menu writes require the same protocol on every peer. Storage remains
// schema 1 with an additive migration; old app versions must not drop menu IDs.
// v3: menus can record the library place they were imported from.
// v4: library places have their own ids (not only OSM refs) and 7 categories.
// v5: items carry `popularity`; host/orderer can set prices while locked.
export const PROTOCOL_VERSION = 5;

// MENU LIBRARY HOOK. Volunteer-maintained CC0 menu data (static JSON).
// DATA_BASE_URL can be overridden per device in Settings; the service worker
// runtime-caches only this default origin (other origins use IndexedDB only).
export const DATA_BASE_URL = 'https://data.chaikadi.fyi';
export const DATA_FETCH_TIMEOUT_MS = 8000;
// Optional HTTPS endpoint accepting suggested menu updates as JSON. Empty means
// "open a prefilled GitHub issue" instead. Never receives personal data.
export const SUGGEST_ENDPOINT = '';
export const DATA_REPO_URL = 'https://github.com/tellmeY18/chaikadi-data';

// https:// origins only; http:// is allowed for localhost while developing.
export function validateDataBaseUrl(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('Enter a full URL, for example https://data.chaikadi.fyi'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an https:// address without a username, query or #fragment.');
  }
  return url.href.replace(/\/+$/, '');
}
export const CATEGORIES = ['Tea', 'Snacks', 'Meal', 'Other'];
// The basic menu every new session starts with. Prices are 0: the host sets
// them (Costs tab) before entering the bill. [name, category, popularity]
export const PRESETS = [
  ['Tea', 'Tea', 100], ['Coffee', 'Tea', 95], ['Black Tea', 'Tea', 80],
  ['Black Coffee', 'Tea', 75], ['Lime Tea', 'Tea', 70], ['Snack', 'Snacks', 60],
];
export const uid = () => crypto.randomUUID();

// Friendly prefilled names so nobody has to type before starting.
const pick = list => list[crypto.getRandomValues(new Uint32Array(1))[0] % list.length];
const ADJECTIVES = ['Awesome', 'Sleepy', 'Cheerful', 'Brave', 'Witty', 'Jolly', 'Zesty', 'Sunny', 'Cosy', 'Snappy',
  'Mellow', 'Spicy', 'Fluffy', 'Clever', 'Bouncy', 'Dapper', 'Chill', 'Peppy', 'Lucky', 'Gentle'];
const ANIMALS = ['Parrot', 'Panda', 'Otter', 'Tiger', 'Koala', 'Penguin', 'Falcon', 'Mongoose', 'Peacock', 'Dolphin',
  'Squirrel', 'Elephant', 'Kingfisher', 'Hedgehog', 'Llama', 'Owl', 'Gecko', 'Fox', 'Myna', 'Turtle'];
const GROUP_WORDS = ['Chai', 'Samosa', 'Biscuit', 'Masala', 'Ginger', 'Kettle', 'Vada', 'Filter Coffee', 'Bun Maska', 'Cutting Chai'];
const GROUP_NOUNS = ['Crew', 'Gang', 'Club', 'Squad', 'Circle', 'Collective', 'Committee', 'Society', 'Brigade', 'Union'];
export const funName = () => `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
export const funGroup = () => `The ${pick(GROUP_WORDS)} ${pick(GROUP_NOUNS)}`;
export function roomCode() {
  // Rejection sampling avoids modulo bias.
  let code = '';
  while (code.length < 4) {
    const n = crypto.getRandomValues(new Uint8Array(1))[0];
    if (n < Math.floor(256 / ALPHABET.length) * ALPHABET.length) code += ALPHABET[n % ALPHABET.length];
  }
  return code;
}
export const validCode = code => typeof code === 'string' && code.length === 4 && [...code].every(c => ALPHABET.includes(c));
export function validateConfig(value) {
  const s = value?.signaling;
  if (!s || typeof s.host !== 'string' || !s.host.trim() || /[\s/:]/.test(s.host) ||
      !Number.isInteger(s.port) || s.port < 1 || s.port > 65535 ||
      typeof s.path !== 'string' || !s.path.startsWith('/') || s.secure !== true ||
      typeof s.key !== 'string' || !s.key || !Array.isArray(value.iceServers)) {
    throw new Error('Use a signaling hostname, port 1–65535, /path, key, and secure: true (HTTPS).');
  }
  for (const server of value.iceServers) {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    if (!urls.length || urls.some(u => typeof u !== 'string' || !/^(stun|stuns|turn|turns):[^\s]+$/.test(u))) {
      throw new Error('Each ICE server needs a stun:, stuns:, turn: or turns: URL.');
    }
  }
  return value;
}
