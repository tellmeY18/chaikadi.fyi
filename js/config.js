// CONFIG HOOK: change these defaults, or use Settings on each device.
// TURN credentials bundled in a static app are public. Use short-lived credentials
// from a service you control if you deploy a production TURN service.
export const DEFAULT_CONFIG = {
  signaling: { host: '0.peerjs.com', port: 443, path: '/', secure: true, key: 'peerjs' },
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }],
};
// Relay (TURN) for phones that cannot reach each other directly (some mobile
// networks). None is built in: the free public relays have shut down or need
// an account. Settings → Developer options → Relay can add your own server.
export function relayServers(dev = {}) {
  if (dev.relay !== 'custom') return [];
  const urls = String(dev.custom?.urls || '').split(/[\s,]+/).filter(u => /^turns?:[^\s]+$/.test(u));
  return urls.length ? [{ urls, username: String(dev.custom?.username || ''), credential: String(dev.custom?.credential || '') }] : [];
}
export const EXTRA_STUN = ['stun:stun.cloudflare.com:3478', 'stun:stun1.l.google.com:19302'];
export const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
// Shown in Settings. Bump with the service-worker cache version on release.
export const APP_VERSION = '2026.11.22-14';
// Multi-menu writes require the same protocol on every peer. Storage remains
// schema 1 with an additive migration; old app versions must not drop menu IDs.
// v3: menus can record the library place they were imported from.
// v4: library places have their own ids (not only OSM refs) and 7 categories.
// v5: items carry `popularity`; host/orderer can set prices while locked.
// v6: members can share a UPI ID (member.upi) so payers can pay the orderer.
// v7: members propose a UPI ID by scanning someone's UPI QR; the owner approves (upi.propose, upi.decide).
export const PROTOCOL_VERSION = 7;
// A session idle for longer than this is archived to History on the next open.
export const SESSION_TTL_MS = 60 * 60 * 1000;

// MENU LIBRARY HOOK. Menus come from Eatsights, the open food data API
// (https://github.com/tellmeY18/eatsights): CC0 data, public reads, opt-out
// signed contributions. Development server: https://develop.letsimpl.fyi.
export const EATSIGHTS_BASE_URL = 'https://eatsights.letsimpl.fyi';
export const REPO_URL = 'https://github.com/tellmeY18/chaikadi.fyi';
export const LETSIMPL_URL = 'https://letsimpl.fyi';
export const EATSIGHTS_URL = 'https://github.com/tellmeY18/eatsights';
export const DATA_FETCH_TIMEOUT_MS = 8000;
// Eatsights has no cities endpoint yet. id: Chaikadi city id; slug: Eatsights
// `city`; centre: used as a coarse location for new stalls (precision 5 km).
export const EATSIGHTS_CITIES = [
  { id: 'in/kl/ernakulam', slug: 'ernakulam', name: 'Ernakulam', centre: { lat: 9.9816, lng: 76.2999 } },
  { id: 'in/kl/thiruvananthapuram', slug: 'thiruvananthapuram', name: 'Thiruvananthapuram', centre: { lat: 8.5241, lng: 76.9366 } },
  { id: 'in/kl/kozhikode', slug: 'kozhikode', name: 'Kozhikode', centre: { lat: 11.2588, lng: 75.7804 } },
  { id: 'in/kl/thrissur', slug: 'thrissur', name: 'Thrissur', centre: { lat: 10.5276, lng: 76.2144 } },
];
export const CATEGORIES = ['Tea', 'Snacks', 'Meal', 'Other'];
// The basic menu every new session starts with. Prices are 0: the host sets
// them (Costs tab) before entering the bill. [name, category, popularity]
export const PRESETS = [
  ['Tea', 'Tea', 100], ['Coffee', 'Tea', 95], ['Black Tea', 'Tea', 80],
  ['Black Coffee', 'Tea', 75], ['Lime Tea', 'Tea', 70],
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
