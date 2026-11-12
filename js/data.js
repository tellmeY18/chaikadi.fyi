// Menu library client (no UI code). Data comes from a separate volunteer repo
// published as static JSON (see DATA_BASE_URL). Everything fetched is treated
// as untrusted: sizes are capped, unknown fields are ignored, text is cleaned,
// city bundles must match the manifest's sha256. The UI renders text only via
// Preact text nodes (escaped), never as HTML.
//
// Caching is stale-while-revalidate: cached data from IndexedDB is returned
// immediately and refreshed in the background when online. A bundle whose
// hash does not match is discarded; the last good copy is kept.
import { DATA_BASE_URL, DATA_FETCH_TIMEOUT_MS, validateDataBaseUrl } from './config.js';

export const LIBRARY_CATEGORIES = ['Tea', 'Coffee', 'Snacks', 'Meal', 'Other'];
export const LIMITS = Object.freeze({ manifestBytes: 128 * 1024, bundleBytes: 512 * 1024, cities: 500, places: 3000, items: 150, text: 80 });
const OSM_ID = /^(node|way|relation)\/[1-9][0-9]{0,14}$/;
const CITY_ID = /^[a-z]{2}\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class DataError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ---- untrusted input cleaning -------------------------------------------
// Strip control and bidirectional-override characters; collapse whitespace.
export function cleanText(value, max = LIMITS.text) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max).trim();
}
const isDate = v => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const toPrice = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10000 ? Math.round(v * 100) / 100 : null);

export function sanitizeManifest(raw) {
  if (!raw || typeof raw !== 'object' || raw.schemaVersion !== 1 || !Array.isArray(raw.cities)) throw new DataError('invalid', 'The library index is not in a supported format.');
  const fresh = Number.isInteger(raw.freshness?.freshDays) ? raw.freshness.freshDays : 90;
  const stale = Number.isInteger(raw.freshness?.staleDays) ? raw.freshness.staleDays : 365;
  const cities = [];
  for (const c of raw.cities.slice(0, LIMITS.cities)) {
    if (!c || !CITY_ID.test(c.id) || typeof c.url !== 'string' || !/^index\/[a-z0-9-]{1,120}\.json$/.test(c.url) ||
        !/^[0-9a-f]{64}$/.test(c.sha256) || !Number.isInteger(c.bytes) || c.bytes < 2 || c.bytes > LIMITS.bundleBytes) continue;
    if (cities.some(x => x.id === c.id)) continue;
    cities.push({ id: c.id, name: cleanText(c.name) || c.id, placeCount: Number.isInteger(c.placeCount) && c.placeCount >= 0 ? c.placeCount : 0, url: c.url, sha256: c.sha256, bytes: c.bytes });
  }
  return { schemaVersion: 1, generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt.slice(0, 30) : '',
    freshness: { freshDays: Math.min(Math.max(fresh, 1), 3650), staleDays: Math.min(Math.max(stale, fresh), 3650) },
    cities: cities.sort((a, b) => a.name.localeCompare(b.name)) };
}

export function sanitizePlace(raw) {
  if (!raw || typeof raw !== 'object' || !OSM_ID.test(raw.id) || !isDate(raw.last_confirmed)) return null;
  const name = cleanText(raw.name);
  const currency = typeof raw.currency === 'string' && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : null;
  if (!name || !currency || !Array.isArray(raw.menu)) return null;
  const menu = [], ids = new Set();
  for (const item of raw.menu.slice(0, LIMITS.items)) {
    const itemName = cleanText(item?.name), price = toPrice(item?.price);
    const id = typeof item?.id === 'string' && /^[a-z0-9-]{1,60}$/.test(item.id) ? item.id : null;
    if (!itemName || price === null || !id || ids.has(id)) continue;
    ids.add(id);
    const clean = { id, name: itemName, category: LIBRARY_CATEGORIES.includes(item.category) ? item.category : 'Other', price, available: item.available !== false };
    if (typeof item.veg === 'boolean') clean.veg = item.veg;
    menu.push(clean);
  }
  if (!menu.length) return null;
  return { id: raw.id, name, currency, last_confirmed: raw.last_confirmed, sample: raw.sample === true, itemCount: menu.length, menu };
}

export function sanitizeBundle(raw, cityId) {
  if (!raw || typeof raw !== 'object' || raw.schemaVersion !== 1 || raw.city !== cityId || !Array.isArray(raw.places)) {
    throw new DataError('invalid', 'This city’s menus are not in a supported format.');
  }
  const places = [], seen = new Set();
  for (const p of raw.places.slice(0, LIMITS.places)) {
    const place = sanitizePlace(p);
    if (place && !seen.has(place.id)) { seen.add(place.id); places.push(place); }
  }
  return { city: cityId, generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt.slice(0, 30) : '', places };
}

// ---- freshness and search -------------------------------------------------
export function freshnessOf(lastConfirmed, { freshDays = 90, staleDays = 365 } = {}, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.max(0, Math.floor((today - Date.parse(`${lastConfirmed}T00:00:00Z`)) / 86400000));
  return { days, status: days <= freshDays ? 'fresh' : days <= staleDays ? 'stale' : 'unverified' };
}
const fold = s => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function matchPlaces(places, query) {
  const tokens = fold(cleanText(query, 60)).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const hits = places.filter(p => { const name = fold(p.name); return tokens.every(t => name.includes(t)); });
  const q = tokens.join(' ');
  return hits.sort((a, b) => Number(fold(b.name).startsWith(q)) - Number(fold(a.name).startsWith(q)) || a.name.localeCompare(b.name));
}

// ---- storage ---------------------------------------------------------------
export function memoryStorage() {
  const map = new Map();
  return {
    get: async key => (map.has(key) ? structuredClone(map.get(key)) : null),
    set: async (key, value) => { map.set(key, structuredClone(value)); },
    keys: async prefix => [...map.keys()].filter(k => k.startsWith(prefix)),
  };
}
export function idbStorage() {
  if (typeof indexedDB === 'undefined') return memoryStorage();
  let opened;
  const db = () => (opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('chaikadi-library', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const run = async (mode, fn) => {
    const store = (await db()).transaction('kv', mode).objectStore('kv');
    return new Promise((resolve, reject) => { const req = fn(store); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  };
  const fallback = memoryStorage();
  return {
    get: key => run('readonly', s => s.get(key)).then(v => v ?? null).catch(() => fallback.get(key)),
    set: (key, value) => run('readwrite', s => s.put(value, key)).catch(() => fallback.set(key, value)),
    keys: prefix => run('readonly', s => s.getAllKeys()).then(keys => keys.filter(k => String(k).startsWith(prefix))).catch(() => fallback.keys(prefix)),
  };
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new DataError('unverifiable', 'This browser cannot verify library data (HTTPS is required).');
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---- client ------------------------------------------------------------------
export function createDataClient({ baseUrl = DATA_BASE_URL, fetchImpl = (...a) => globalThis.fetch(...a), storage = idbStorage(),
  timeoutMs = DATA_FETCH_TIMEOUT_MS, online = () => globalThis.navigator?.onLine !== false } = {}) {
  const base = validateDataBaseUrl(baseUrl);
  const manifestUrl = `${base}/manifest.json`;
  const listeners = new Set();
  const inflight = new Map();
  const memory = new Map(); // cityId -> bundle (verified)
  const emit = event => { for (const fn of listeners) { try { fn(event); } catch { /* listener bug must not break data */ } } };
  const key = (kind, id = '') => `${kind}:${base}:${id}`;

  async function fetchBytes(url, { reload, max }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
        cache: reload ? 'reload' : 'default', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new DataError('http', `The menu library answered ${response.status}.`);
      const declared = Number(response.headers?.get?.('content-length'));
      if (declared > max) throw new DataError('too-large', 'Library data is larger than allowed.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > max) throw new DataError('too-large', 'Library data is larger than allowed.');
      return bytes;
    } catch (error) {
      if (error instanceof DataError) throw error;
      throw new DataError(online() ? 'network' : 'offline', online() ? 'Could not reach the menu library.' : 'You are offline.');
    } finally { clearTimeout(timer); }
  }
  const parse = bytes => { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new DataError('invalid', 'Library data is damaged.'); } };
  const once = (id, fn) => { if (!inflight.has(id)) inflight.set(id, fn().finally(() => inflight.delete(id))); return inflight.get(id); };
  const background = (id, fn) => { if (online()) once(id, fn).catch(error => emit({ type: 'error', error })); };

  function refreshManifest({ reload = true } = {}) {
    return once('manifest', async () => {
      const manifest = sanitizeManifest(parse(await fetchBytes(manifestUrl, { reload, max: LIMITS.manifestBytes })));
      const previous = await storage.get(key('manifest'));
      await storage.set(key('manifest'), { data: manifest, fetchedAt: Date.now() });
      if (JSON.stringify(previous?.data) !== JSON.stringify(manifest)) emit({ type: 'manifest', manifest });
      return manifest;
    });
  }

  async function loadManifest() {
    const cached = await storage.get(key('manifest'));
    if (cached?.data) {
      background('manifest', () => refreshManifest());
      return { manifest: cached.data, cached: true, fetchedAt: cached.fetchedAt };
    }
    if (!online()) throw new DataError('offline-empty', 'The menu library isn’t saved on this device yet. Connect to the internet once to download it.');
    return { manifest: await refreshManifest({ reload: false }), cached: false, fetchedAt: Date.now() };
  }

  function refreshBundle(entry, { reload = true } = {}) {
    return once(`bundle:${entry.id}`, async () => {
      const bytes = await fetchBytes(new URL(entry.url, manifestUrl).href, { reload, max: Math.min(entry.bytes, LIMITS.bundleBytes) });
      if (await sha256Hex(bytes) !== entry.sha256) {
        throw new DataError('hash-mismatch', 'Downloaded menus did not match the library index, so they were not used.');
      }
      const bundle = sanitizeBundle(parse(bytes), entry.id);
      await storage.set(key('bundle', entry.id), { sha256: entry.sha256, data: bundle, fetchedAt: Date.now() });
      memory.set(entry.id, bundle);
      emit({ type: 'bundle', cityId: entry.id, bundle });
      return bundle;
    });
  }

  async function loadCityBundle(cityId) {
    if (!CITY_ID.test(cityId)) throw new DataError('unknown-city', 'Unknown city.');
    const cached = await storage.get(key('bundle', cityId));
    let manifest;
    try { manifest = (await loadManifest()).manifest; }
    catch (error) { if (cached?.data) return { bundle: cached.data, cached: true, verified: false }; throw error; }
    const entry = manifest.cities.find(c => c.id === cityId);
    if (cached?.data) {
      memory.set(cityId, cached.data);
      if (entry && cached.sha256 !== entry.sha256) background(`bundle:${cityId}`, () => refreshBundle(entry));
      return { bundle: cached.data, cached: true, verified: !!entry && cached.sha256 === entry.sha256 };
    }
    if (!entry) throw new DataError('unknown-city', 'That city is not in the menu library.');
    if (!online()) throw new DataError('offline-empty', 'This city’s menus aren’t saved on this device yet. Connect to the internet once to download them.');
    return { bundle: await refreshBundle(entry, { reload: false }), cached: false, verified: true };
  }

  async function searchPlaces(cityId, query = '') {
    const bundle = memory.get(cityId) || (await loadCityBundle(cityId)).bundle;
    return matchPlaces(bundle.places, query);
  }

  async function getPlace(id, cityId) {
    if (!OSM_ID.test(id)) return null;
    if (cityId) {
      const bundle = memory.get(cityId) || (await loadCityBundle(cityId)).bundle;
      const place = bundle.places.find(p => p.id === id);
      return place ? { ...place, city: cityId } : null;
    }
    for (const [city, bundle] of memory) { const place = bundle.places.find(p => p.id === id); if (place) return { ...place, city }; }
    for (const k of await storage.keys(key('bundle'))) {
      const bundle = (await storage.get(k))?.data;
      const place = bundle?.places?.find(p => p.id === id);
      if (place) return { ...place, city: bundle.city };
    }
    return null;
  }

  return { baseUrl: base, loadManifest, loadCityBundle, searchPlaces, getPlace, refreshManifest,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
}

// ---- default client used by the app -----------------------------------------
let client = null;
const appListeners = new Set();
export function configureData({ baseUrl = DATA_BASE_URL } = {}) {
  const url = validateDataBaseUrl(baseUrl || DATA_BASE_URL);
  if (!client || client.baseUrl !== url) {
    client = createDataClient({ baseUrl: url });
    client.subscribe(event => { for (const fn of appListeners) fn(event); });
  }
  return client;
}
const current = () => client || configureData();
export const loadManifest = () => current().loadManifest();
export const loadCityBundle = cityId => current().loadCityBundle(cityId);
export const searchPlaces = (cityId, query) => current().searchPlaces(cityId, query);
export const getPlace = (id, cityId) => current().getPlace(id, cityId);
export function subscribeData(fn) { appListeners.add(fn); return () => appListeners.delete(fn); }

// ---- suggestions (no personal data) ------------------------------------------
// changes: [{ name, category, price (rupees) }]. Category must be a library one.
export function buildSuggestion({ placeId, city, name, changes, seen }) {
  if (!OSM_ID.test(placeId) || !CITY_ID.test(city) || !isDate(seen)) throw new DataError('invalid', 'Cannot prepare that suggestion.');
  const clean = (changes || []).slice(0, LIMITS.items).map(c => ({ name: cleanText(c.name), category: LIBRARY_CATEGORIES.includes(c.category) ? c.category : 'Other', price: toPrice(c.price) }))
    .filter(c => c.name && c.price !== null && !/[|\n]/.test(c.name));
  return { schemaVersion: 1, kind: 'update-menu', placeId, city, name: cleanText(name), seen, changes: clean };
}
const changeLine = c => `${c.name} | ${c.category} | ${c.price}`;
export function suggestionIssueUrl(suggestion, repoUrl, maxLength = 6000) {
  const url = new URL(`${repoUrl.replace(/\/+$/, '')}/issues/new`);
  url.searchParams.set('template', 'update-menu.yml');
  url.searchParams.set('title', `Update menu: ${suggestion.name || suggestion.placeId}`.slice(0, 120));
  url.searchParams.set('place-id', suggestion.placeId);
  url.searchParams.set('date-seen', suggestion.seen);
  const lines = [];
  for (const change of suggestion.changes) {
    lines.push(changeLine(change));
    url.searchParams.set('changes', lines.join('\n'));
    if (url.href.length > maxLength) { lines.pop(); break; }
  }
  url.searchParams.set('changes', lines.join('\n'));
  return url.href;
}
export async function sendSuggestion(suggestion, endpoint, { fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = DATA_FETCH_TIMEOUT_MS } = {}) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:') throw new DataError('invalid', 'The suggestion endpoint must use HTTPS.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url.href, { method: 'POST', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(suggestion), signal: controller.signal });
    if (!response.ok) throw new DataError('http', `The suggestion service answered ${response.status}.`);
    return true;
  } catch (error) {
    throw error instanceof DataError ? error : new DataError('network', 'Could not send the suggestion. Try again when online.');
  } finally { clearTimeout(timer); }
}
