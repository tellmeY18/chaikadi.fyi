// Contributions to Eatsights (opt-in, off by default). Only structured facts
// leave the device: a price, "sold out", a wait, a 1–5 score, or a new stall's
// name, kind, city and coarse location. Never names, groups, notes or picks.
//
// Identity is one Ed25519 key made on this device (WebCrypto, private key not
// extractable, kept in IndexedDB). Eatsights publishes only a per-place
// pseudonym, never the key. Signing follows Eatsights proposal 0001:
// key_id = base64url(SHA-256(raw public key)[0..16]); the signature covers the
// RFC 8785 (JCS) canonical JSON of the object without `signature`.
//
// Unsent observations wait in an outbox and go out when the device is online.
import { EATSIGHTS_BASE_URL, APP_VERSION, DATA_FETCH_TIMEOUT_MS } from './config.js';
import { idbStorage } from './data.js';

export const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// RFC 8785 for the JSON Chaikadi produces (strings, integers, booleans, objects, arrays).
export function canonical(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Cannot sign a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function ulid(now = Date.now(), random = crypto.getRandomValues(new Uint8Array(16))) {
  let time = '';
  for (let t = now, i = 0; i < 10; i++) { time = CROCKFORD[t % 32] + time; t = Math.floor(t / 32); }
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[random[i] % 32];
  return time + rand;
}
export const newId = prefix => `${prefix}${ulid()}`;
export async function keyIdOf(rawPublicKey) {
  return b64url((await crypto.subtle.digest('SHA-256', rawPublicKey)).slice(0, 16));
}
export const supported = () => !!globalThis.crypto?.subtle && typeof indexedDB !== 'undefined';

export class ContribError extends Error { constructor(code, message) { super(message); this.code = code; } }

export function createContributor({ baseUrl = EATSIGHTS_BASE_URL, storage = idbStorage(), fetchImpl = (...a) => globalThis.fetch(...a),
  online = () => globalThis.navigator?.onLine !== false, timeoutMs = DATA_FETCH_TIMEOUT_MS, now = () => new Date() } = {}) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const KEY = 'contrib:key', OUTBOX = 'contrib:outbox';
  let keyPromise = null;

  async function key() {
    return keyPromise ??= (async () => {
      const saved = await storage.get(KEY);
      if (saved?.privateKey && saved.publicKey && saved.keyId) return saved;
      let pair;
      try { pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']); }
      catch { throw new ContribError('unsupported', 'This browser cannot make a contributor key. Try an up-to-date browser.'); }
      const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
      const record = { privateKey: pair.privateKey, publicKey: b64url(raw), keyId: await keyIdOf(raw), registered: false, createdAt: now().toISOString() };
      await storage.set(KEY, record);
      return record;
    })().catch(error => { keyPromise = null; throw error; });
  }
  async function sign(object) {
    const k = await key();
    const { signature: _drop, ...rest } = object;
    const bytes = new TextEncoder().encode(canonical(rest));
    return { ...rest, signature: b64url(await crypto.subtle.sign({ name: 'Ed25519' }, k.privateKey, bytes)) };
  }
  async function post(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${base}${path}`, { method: 'POST', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      let json = null;
      try { json = await response.json(); } catch { /* empty body */ }
      if (!response.ok) throw new ContribError('http', json?.detail || json?.title || `Eatsights answered ${response.status}.`);
      return json;
    } catch (error) {
      if (error instanceof ContribError) throw error;
      throw new ContribError(online() ? 'network' : 'offline', online() ? 'Could not reach Eatsights.' : 'You are offline.');
    } finally { clearTimeout(timer); }
  }
  async function register() {
    const k = await key();
    if (k.registered) return k;
    const proof = await sign({ type: 'key_registration', algorithm: 'ed25519', public_key: k.publicKey, created_at: now().toISOString() });
    await post('/v1/keys', proof);
    const saved = { ...k, registered: true };
    await storage.set(KEY, saved);
    keyPromise = Promise.resolve(saved);
    return saved;
  }

  // One observation about a menu item. ids are Eatsights ids (pl_…, mi_…).
  async function observation({ property, placeId, itemId, value, method = 'order_flow', prompt }) {
    const k = await key();
    const t = now().toISOString();
    return sign({ id: newId('ob_'), schema_version: '0.3', kind: 'value', property,
      subject: { scope: 'menu_item', place_id: placeId, menu_item_id: itemId }, value,
      observed_at: t, submitted_at: t, method, source_type: 'customer', ...(prompt ? { prompt_type: prompt } : {}),
      client: { app_id: 'chaikadi', app_version: APP_VERSION }, license: 'CC0-1.0', contributor: { key_id: k.keyId } });
  }
  const resultOf = r => r?.status === 'accepted' ? { status: 'sent' } : r?.status === 'duplicate' ? { status: 'already' }
    : { status: 'rejected', reason: r?.problem?.detail || r?.problem?.title || 'Not accepted.' };

  // Send signed observations; returns one result per input (sent / already /
  // rejected / queued). Network failures queue everything for later.
  async function submit(observations) {
    if (!observations.length) return [];
    try {
      await register();
      const results = [];
      for (let i = 0; i < observations.length; i += 100) {
        const batch = observations.slice(i, i + 100);
        const reply = await post('/v1/submissions', batch);
        for (let j = 0; j < batch.length; j++) results.push(resultOf(reply?.results?.find(r => r.index === j) ?? reply?.results?.[j]));
      }
      return results;
    } catch (error) {
      if (!['network', 'offline'].includes(error.code)) throw error;
      const box = (await storage.get(OUTBOX)) || [];
      await storage.set(OUTBOX, [...box, ...observations].slice(-500));
      return observations.map(() => ({ status: 'queued' }));
    }
  }
  async function pending() { return ((await storage.get(OUTBOX)) || []).length; }
  async function flush() {
    const box = (await storage.get(OUTBOX)) || [];
    if (!box.length || !online()) return { sent: 0 };
    await storage.set(OUTBOX, []);
    const results = await submit(box).catch(async error => { await storage.set(OUTBOX, box); throw error; });
    return { sent: results.filter(r => r.status === 'sent').length };
  }
  async function discardPending() { await storage.set(OUTBOX, []); }
  async function reset() { await storage.set(KEY, null); await storage.set(OUTBOX, []); keyPromise = null; }
  async function info() { const k = await storage.get(KEY); return k?.keyId ? { keyId: k.keyId, createdAt: k.createdAt, registered: k.registered } : null; }

  // New stall (proposal 0001 entity submission). place: client fields only.
  async function createPlace(place) {
    const k = await register();
    const submission = await sign({ id: newId('es_'), schema_version: '0.4', op: 'create', entity_type: 'place', entity: place,
      submitted_at: now().toISOString(), contributor: { key_id: k.keyId }, license: 'CC0-1.0' });
    const reply = await post('/v1/entities', [submission]);
    const r = reply?.results?.[0];
    if (r?.status === 'accepted' || r?.status === 'duplicate') return { id: place.id, status: r.status };
    throw new ContribError('rejected', r?.problem?.detail || r?.problem?.title || 'Eatsights did not accept this stall.');
  }

  return { key, sign, register, observation, submit, flush, pending, discardPending, reset, info, createPlace };
}

let contributor = null;
export const contrib = () => (contributor ??= createContributor());
