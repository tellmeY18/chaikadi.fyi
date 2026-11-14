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

export const LIBRARY_CATEGORIES = ['Tea', 'Coffee', 'Drinks', 'Snacks', 'Meal', 'Dessert', 'Other'];
export const LIMITS = Object.freeze({ manifestBytes: 128 * 1024, bundleBytes: 512 * 1024, cities: 500, places: 3000, items: 300, sections: 40, text: 80, note: 160 });
const OSM_ID = /^(node|way|relation)\/[1-9][0-9]{0,14}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CITY_ID = /^[a-z]{2}\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$/;
const DAYS = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];
// A place key: v2 slug, or an OSM ref for places from v1-only data hosts.
export const isPlaceId = id => typeof id === 'string' && id.length <= 60 && (SLUG.test(id) || OSM_ID.test(id));

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
const toPrice = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100000 ? Math.round(v * 100) / 100 : null);
const optText = (out, key, value, max = LIMITS.text) => { const t = cleanText(value, max); if (t) out[key] = t; };

// Manifest v2 (current) or v1 (older data hosts). Same shape afterwards.
export function sanitizeManifest(raw) {
  if (!raw || typeof raw !== 'object' || ![1, 2].includes(raw.schemaVersion) || !Array.isArray(raw.cities)) throw new DataError('invalid', 'The library index is not in a supported format.');
  const fresh = Number.isInteger(raw.freshness?.freshDays) ? raw.freshness.freshDays : 90;
  const stale = Number.isInteger(raw.freshness?.staleDays) ? raw.freshness.staleDays : 365;
  const cities = [];
  for (const c of raw.cities.slice(0, LIMITS.cities)) {
    if (!c || !CITY_ID.test(c.id) || typeof c.url !== 'string' || !/^index\/[a-z0-9-]{1,120}\.json$/.test(c.url) ||
        !/^[0-9a-f]{64}$/.test(c.sha256) || !Number.isInteger(c.bytes) || c.bytes < 2 || c.bytes > LIMITS.bundleBytes) continue;
    if (cities.some(x => x.id === c.id)) continue;
    cities.push({ id: c.id, name: cleanText(c.name) || c.id, placeCount: Number.isInteger(c.placeCount) && c.placeCount >= 0 ? c.placeCount : 0, url: c.url, sha256: c.sha256, bytes: c.bytes, schemaVersion: raw.schemaVersion });
  }
  return { schemaVersion: raw.schemaVersion, generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt.slice(0, 30) : '',
    freshness: { freshDays: Math.min(Math.max(fresh, 1), 3650), staleDays: Math.min(Math.max(stale, fresh), 3650) },
    cities: cities.sort((a, b) => a.name.localeCompare(b.name)) };
}

function sanitizeHours(raw) {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.slice(0, 14).filter(h => h && TIME.test(h.open) && TIME.test(h.close)).map(h => {
    const days = Array.isArray(h.days) ? [...new Set(h.days.filter(d => DAYS.includes(d)))] : [];
    return { ...(days.length ? { days } : {}), open: h.open, close: h.close };
  });
  return out.length ? out : undefined;
}

function sanitizeItem(raw, ids) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && SLUG.test(raw.id) && raw.id.length <= 60 ? raw.id : null;
  const name = cleanText(raw.name);
  if (!id || !name || ids.has(id)) return null;
  const item = { id, name, category: LIBRARY_CATEGORIES.includes(raw.category) ? raw.category : 'Other' };
  optText(item, 'localName', raw.localName);
  optText(item, 'description', raw.description, LIMITS.note);
  const variants = Array.isArray(raw.variants) ? raw.variants.slice(0, 10).map(v => ({ name: cleanText(v?.name, 40), price: toPrice(v?.price), portion: cleanText(v?.portion, 40) }))
    .filter(v => v.name && v.price !== null).map(v => (v.portion ? v : { name: v.name, price: v.price })) : [];
  if (variants.length >= 2) item.variants = variants;
  else if (toPrice(raw.price) !== null) item.price = toPrice(raw.price);
  if (['market', 'seasonal', 'ask'].includes(raw.priceStatus)) item.priceStatus = raw.priceStatus;
  if (item.price === undefined && !item.variants && !item.priceStatus) return null;
  optText(item, 'portion', raw.portion, 40);
  if (['veg', 'vegan', 'egg', 'non-veg'].includes(raw.diet)) item.diet = raw.diet;
  if (Number.isInteger(raw.spice) && raw.spice >= 0 && raw.spice <= 3) item.spice = raw.spice;
  if (raw.addOn === true) item.addOn = true;
  item.available = raw.available !== false;
  if (raw.uncertain === true) item.uncertain = true;
  optText(item, 'note', raw.note, LIMITS.note);
  ids.add(id);
  return item;
}

function sanitizeSections(raw, ids, depth = 0, counter = { n: 0 }) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const s of raw.slice(0, depth ? 20 : LIMITS.sections)) {
    const name = cleanText(s?.name);
    if (!name) continue;
    const section = { id: typeof s.id === 'string' && SLUG.test(s.id) ? s.id : `s${out.length}`, name };
    const hours = sanitizeHours(s.hours);
    if (hours) section.hours = hours;
    optText(section, 'note', s.note, LIMITS.note);
    if (!depth && Array.isArray(s.sections)) {
      section.sections = sanitizeSections(s.sections, ids, 1, counter);
      if (!section.sections.length) continue;
    } else {
      section.items = [];
      for (const raw of Array.isArray(s.items) ? s.items : []) {
        if (counter.n >= LIMITS.items) break;
        const item = sanitizeItem(raw, ids);
        if (item) { section.items.push(item); counter.n++; }
      }
      if (!section.items.length) continue;
    }
    out.push(section);
  }
  return out;
}

// One shape for the app, from v2 places or v1 (flat-menu) places.
export function sanitizePlace(raw) {
  if (!raw || typeof raw !== 'object' || !isPlaceId(raw.id) || !isDate(raw.last_confirmed)) return null;
  const name = cleanText(raw.name);
  const currency = typeof raw.currency === 'string' && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : null;
  if (!name || !currency) return null;
  const ids = new Set();
  let sections;
  if (Array.isArray(raw.sections)) sections = sanitizeSections(raw.sections, ids);
  else if (Array.isArray(raw.menu)) {
    const items = raw.menu.slice(0, 150).map(i => sanitizeItem({ ...i, diet: i?.veg === true ? 'veg' : undefined }, ids)).filter(Boolean);
    sections = items.length ? [{ id: 'menu', name: 'Menu', items }] : [];
  } else return null;
  if (!sections.length) return null;
  const place = { id: raw.id, name, currency, last_confirmed: raw.last_confirmed, sample: raw.sample === true, sections };
  optText(place, 'localName', raw.localName);
  if (['tea-stall', 'cafe', 'restaurant', 'canteen', 'bakery', 'juice-shop', 'food-court-stall', 'hotel', 'other'].includes(raw.kind)) place.kind = raw.kind;
  if (raw.osm && ['node', 'way', 'relation'].includes(raw.osm.type) && Number.isSafeInteger(raw.osm.id) && raw.osm.id > 0 && ['is', 'inside', 'near'].includes(raw.osm.relation)) {
    place.osm = { type: raw.osm.type, id: raw.osm.id, relation: raw.osm.relation };
  } else if (OSM_ID.test(raw.id)) {
    const [type, id] = raw.id.split('/');
    place.osm = { type, id: Number(id), relation: 'is' };
  }
  if (raw.location && typeof raw.location === 'object') {
    const location = {};
    for (const key of ['building', 'floor', 'area']) optText(location, key, raw.location[key], key === 'floor' ? 40 : LIMITS.text);
    if (typeof raw.location.postcode === 'string' && /^[A-Z0-9][A-Z0-9 -]{1,9}$/.test(raw.location.postcode)) location.postcode = raw.location.postcode;
    if (Object.keys(location).length) place.location = location;
  }
  if (typeof raw.tax?.included === 'boolean') { place.tax = { included: raw.tax.included }; optText(place.tax, 'note', raw.tax.note, LIMITS.note); }
  const hours = sanitizeHours(raw.hours);
  if (hours) place.hours = hours;
  optText(place, 'note', raw.note, LIMITS.note);
  if (['in-person', 'printed-menu', 'menu-board', 'bill'].includes(raw.source)) place.source = raw.source;
  place.itemCount = sections.reduce((n, s) => n + (s.items || s.sections.flatMap(x => x.items)).length, 0);
  return place;
}

export function sanitizeBundle(raw, cityId) {
  if (!raw || typeof raw !== 'object' || ![1, 2].includes(raw.schemaVersion) || raw.city !== cityId || !Array.isArray(raw.places)) {
    throw new DataError('invalid', 'This city’s menus are not in a supported format.');
  }
  const places = [], seen = new Set();
  for (const p of raw.places.slice(0, LIMITS.places)) {
    const place = sanitizePlace(p);
    if (place && !seen.has(place.id)) { seen.add(place.id); places.push(place); }
  }
  return { city: cityId, generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt.slice(0, 30) : '', places };
}

// Every item with where it is on the menu.
export function placeItems(place) {
  const out = [];
  for (const section of place.sections || []) {
    for (const item of section.items || []) out.push({ item, section, subsection: null });
    for (const sub of section.sections || []) for (const item of sub.items) out.push({ item, section, subsection: sub });
  }
  return out;
}
// The orderable lines a group can import: one per priced item or variant.
// Same-named items get the section that tells them apart; unpriced items
// (seasonal, market price, ask) are left out because a group menu needs a price.
export function orderableItems(place) {
  const entries = placeItems(place);
  const counts = new Map();
  for (const { item } of entries) counts.set(item.name.toLowerCase(), (counts.get(item.name.toLowerCase()) || 0) + 1);
  const words = s => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(w => w.replace(/s$/, ''));
  const label = (item, section, sub) => {
    const own = new Set(words(item.name));
    return sub && words(sub.name).some(w => !own.has(w)) ? sub.name : section.name;
  };
  const out = [];
  for (const { item, section, subsection } of entries) {
    if (item.available === false) continue;
    const base = counts.get(item.name.toLowerCase()) > 1 ? `${item.name} (${label(item, section, subsection)})` : item.name;
    if (item.variants) for (const v of item.variants) out.push({ name: `${base} (${v.name})`, category: item.category, price: v.price, id: item.id });
    else if (typeof item.price === 'number') out.push({ name: base, category: item.category, price: item.price, id: item.id });
  }
  return out;
}

// ---- freshness and search -------------------------------------------------
export function freshnessOf(lastConfirmed, { freshDays = 90, staleDays = 365 } = {}, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.max(0, Math.floor((today - Date.parse(`${lastConfirmed}T00:00:00Z`)) / 86400000));
  return { days, status: days <= freshDays ? 'fresh' : days <= staleDays ? 'stale' : 'unverified' };
}
const fold = s => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// Name, local name and location words (e.g. "cyber green", "kakkanad").
export function matchPlaces(places, query) {
  const tokens = fold(cleanText(query, 60)).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const text = p => fold([p.name, p.localName, p.location?.building, p.location?.area, p.location?.postcode].filter(Boolean).join(" "));
  const hits = places.filter(p => { const all = text(p); return tokens.every(t => all.includes(t)); });
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
  // v2 (rich) first; v1 for data hosts that only publish the older format.
  const manifestUrls = { 2: `${base}/v2/manifest.json`, 1: `${base}/manifest.json` };
  const listeners = new Set();
  const inflight = new Map();
  const memory = new Map(); // cityId -> bundle (verified)
  const emit = event => { for (const fn of listeners) { try { fn(event); } catch { /* listener bug must not break data */ } } };
  // v2: cached data uses the sectioned place shape (older caches are ignored).
  const key = (kind, id = '') => `v2:${kind}:${base}:${id}`;

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
      let manifest;
      try { manifest = sanitizeManifest(parse(await fetchBytes(manifestUrls[2], { reload, max: LIMITS.manifestBytes }))); }
      catch (error) {
        if (error.code !== 'http') throw error;
        manifest = sanitizeManifest(parse(await fetchBytes(manifestUrls[1], { reload, max: LIMITS.manifestBytes })));
      }
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
      const from = manifestUrls[entry.schemaVersion] || manifestUrls[2];
      const bytes = await fetchBytes(new URL(entry.url, from).href, { reload, max: Math.min(entry.bytes, LIMITS.bundleBytes) });
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
    if (!isPlaceId(id)) return null;
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
// Eatsights first; when it fails and nothing is cached, the city comes from the
// static library instead (bundle.fallback = true, so the UI can say so).
export function withFallback(primary, fallback) {
  const served = new Map(); // cityId -> client that served it
  const listeners = new Set();
  const emit = event => { for (const fn of listeners) fn(event); };
  primary.subscribe(emit);
  fallback.subscribe(event => { if (event.type !== 'manifest') emit(event); });
  async function loadCityBundle(cityId) {
    try { const r = await primary.loadCityBundle(cityId); served.set(cityId, primary); return r; }
    catch (error) {
      if (!['network', 'offline', 'offline-empty', 'http', 'invalid'].includes(error.code)) throw error;
      try {
        const r = await fallback.loadCityBundle(cityId);
        served.set(cityId, fallback);
        return { ...r, bundle: { ...r.bundle, fallback: true }, fallback: true, reason: error.code };
      } catch { throw error; }
    }
  }
  const client = c => served.get(c) || primary;
  return { source: primary.source, baseUrl: primary.baseUrl, loadManifest: () => primary.loadManifest(), refreshManifest: () => primary.refreshManifest(), loadCityBundle,
    async searchPlaces(cityId, query) { if (!served.has(cityId)) await loadCityBundle(cityId); const r = await client(cityId).searchPlaces(cityId, query); return served.get(cityId) === fallback ? r.map(p => ({ ...p, fallback: true })) : r; },
    async getPlace(id, cityId) { return (await primary.getPlace(id, cityId)) || fallback.getPlace(id, cityId); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
}
let client = null;
let clientKey = '';
const appListeners = new Set();
let eatsightsFactory = null;
// eatsights.js imports this module, so it registers itself instead of a cycle.
export function registerEatsights(factory) { eatsightsFactory = factory; }
export function configureData({ baseUrl = DATA_BASE_URL, source = 'static' } = {}) {
  const url = validateDataBaseUrl(baseUrl || DATA_BASE_URL);
  const wanted = source === 'eatsights' && eatsightsFactory ? 'eatsights' : 'static';
  if (!client || clientKey !== `${wanted}|${url}`) {
    const staticClient = createDataClient({ baseUrl: url });
    client = wanted === 'eatsights' ? withFallback(eatsightsFactory(), staticClient) : staticClient;
    clientKey = `${wanted}|${url}`;
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
  if (!isPlaceId(placeId) || !CITY_ID.test(city) || !isDate(seen)) throw new DataError('invalid', 'Cannot prepare that suggestion.');
  const clean = (changes || []).slice(0, LIMITS.items).map(c => ({ name: cleanText(c.name), category: LIBRARY_CATEGORIES.includes(c.category) ? c.category : 'Other', price: toPrice(c.price) }))
    .filter(c => c.name && c.price !== null && !/[|\n]/.test(c.name));
  return { schemaVersion: 1, kind: 'update-menu', placeId, city, name: cleanText(name), seen, changes: clean };
}
const changeLine = c => `${c.name} | ${c.category} | ${c.price}`;
export function suggestionIssueUrl(suggestion, repoUrl, maxLength = 6000) {
  const url = new URL(`${repoUrl.replace(/\/+$/, '')}/issues/new`);
  url.searchParams.set('template', 'update-menu.yml');
  url.searchParams.set('title', `Update menu: ${suggestion.name || suggestion.placeId}`.slice(0, 120));
  // The update form identifies a place as <city>/<place-id>.
  url.searchParams.set('place-id', OSM_ID.test(suggestion.placeId) ? suggestion.placeId : `${suggestion.city}/${suggestion.placeId}`);
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
