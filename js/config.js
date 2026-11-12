// CONFIG HOOK: change these defaults, or use Settings on each device.
// TURN credentials bundled in a static app are public. Use short-lived credentials
// from a service you control if you deploy a production TURN service.
export const DEFAULT_CONFIG = {
  signaling: { host: '0.peerjs.com', port: 443, path: '/', secure: true, key: 'peerjs' },
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }],
};
export const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CATEGORIES = ['Tea', 'Snacks', 'Meal', 'Other'];
export const PRESETS = [
  ['Chai', 'Tea'], ['Masala Chai', 'Tea'], ['Ginger Chai', 'Tea'],
  ['Black Tea', 'Tea'], ['Coffee', 'Tea'], ['Biscuits', 'Snacks'],
  ['Samosa', 'Snacks'], ['Vada', 'Snacks'], ['Bun Maska', 'Snacks'],
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
