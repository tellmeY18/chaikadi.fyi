// Eatsights read client: the same interface as createDataClient (data.js), so
// the library UI and store do not care where menus come from. Uses only the
// public Eatsights API (no keys, no special endpoints). Everything fetched is
// untrusted: places go through sanitizePlace and the Eatsights facts are
// reduced to a small, validated `es` summary per place and item.
//
// Caching mirrors data.js: cached data first, refresh in the background,
// IndexedDB per place menu with its ETag (304 keeps the cached copy).
import { EATSIGHTS_BASE_URL, EATSIGHTS_CITIES, DATA_FETCH_TIMEOUT_MS } from './config.js';
import { DataError, sanitizePlace, matchPlaces, idbStorage, cleanText, registerEatsights } from './data.js';

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const STATUSES = ['confirmed', 'unconfirmed', 'contested', 'stale'];
export const ES_PREFIX = 'es-';
// pl_01ABC… <-> es-01abc… : fits Chaikadi's place/item id rules (no protocol change).
export const toSlug = id => (typeof id === 'string' && ULID.test(id.slice(3)) ? ES_PREFIX + id.slice(3).toLowerCase() : null);
export const fromSlug = (slug, prefix) => {
  if (typeof slug !== 'string' || !slug.startsWith(ES_PREFIX)) return null;
  const ulid = slug.slice(ES_PREFIX.length).toUpperCase();
  return ULID.test(ulid) ? prefix + ulid : null;
};
export const isEatsightsPlace = id => !!fromSlug(id, 'pl_');

const KIND = { tea_stall: 'tea-stall', juice_shop: 'juice-shop', small_hotel: 'hotel', cafe: 'cafe', restaurant: 'restaurant',
  canteen: 'canteen', bakery: 'bakery', street_cart: 'other', office_counter: 'other', other: 'other' };
export const KIND_TO_CATEGORY = { 'tea-stall': 'tea_stall', 'juice-shop': 'juice_shop', hotel: 'small_hotel', other: 'other' };
const SECTION_CATEGORY = { drinks: 'Drinks', beverages: 'Drinks', tea: 'Tea', coffee: 'Coffee', snacks: 'Snacks', meals: 'Meal', mains: 'Meal',
  breakfast: 'Meal', lunch: 'Meal', dinner: 'Meal', desserts: 'Dessert', sweets: 'Dessert' };
const categoryOf = (section, label) => {
  const c = SECTION_CATEGORY[section?.kind] || 'Other';
  // Drinks sections named "Tea"/"Chai" read better as Tea.
  return c === 'Drinks' && /\b(tea|chai|chaya)\b/i.test(label || '') ? 'Tea' : c;
};
const day = iso => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(iso) ? iso.slice(0, 10) : null);
const label = (map, ...langs) => { for (const l of langs) { const v = cleanText(map?.[l]); if (v) return v; } return ''; };

// One fact -> { status, contributors, last, vendor, vendorDiffers }.
export function factSummary(fact) {
  if (!fact || !STATUSES.includes(fact.status)) return null;
  const last = day(fact.last_confirmed_at) || day(fact.last_observed_at);
  const sources = Array.isArray(fact.sources) ? fact.sources : [];
  return { status: fact.status, contributors: Number.isInteger(fact.counts?.distinct_contributors) ? Math.min(fact.counts.distinct_contributors, 9999) : 0,
    last: last || null, observed: day(fact.last_observed_at) || last || null,
    vendor: sources.length > 0 && sources.every(s => s === 'vendor'), vendorDiffers: fact.vendor_value_differs === true,
    imported: sources.length > 0 && sources.every(s => s === 'import') };
}
// The stall's overall freshness from its item price facts.
export function placeSummary(facts) {
  const list = facts.filter(Boolean);
  if (!list.length) return { status: 'unconfirmed', contributors: 0, last: null };
  const status = list.some(f => f.status === 'contested') ? 'contested'
    : list.every(f => f.status === 'stale') ? 'stale'
      : list.every(f => f.status === 'confirmed' || f.status === 'stale') ? 'confirmed' : 'unconfirmed';
  const last = list.map(f => f.last).filter(Boolean).sort().pop() || null;
  const relevant = list.filter(f => f.status === status);
  return { status, contributors: Math.max(0, ...relevant.map(f => f.contributors)), last };
}

// /v1/places/{id}/menu -> a library place (passes sanitizePlace) plus `es`
// summaries keyed by item id. `cityId` is the Chaikadi city id.
export function mapMenu(raw, cityId) {
  const p = raw?.place;
  const id = toSlug(p?.id);
  if (!p || !id || p.record_state === 'merged') return null;
  const sections = (Array.isArray(raw.sections) ? raw.sections : []).filter(s => typeof s?.id === 'string')
    .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0));
  const bySection = new Map(sections.map(s => [s.id, []]));
  const itemFacts = {};
  const priceFacts = [];
  let newest = day(raw.built_at) || day(p.created_at);
  let oldest = null;
  for (const entry of Array.isArray(raw.items) ? raw.items.slice(0, 300) : []) {
    const item = entry?.item;
    const itemId = toSlug(item?.id);
    if (!itemId || item.record_state === 'merged' || !bySection.has(item.section_id)) continue;
    const facts = Array.isArray(entry.facts) ? entry.facts : [];
    const price = facts.find(f => f?.property === 'price.amount');
    const listing = facts.find(f => f?.property === 'listing.status');
    const avail = facts.find(f => f?.property === 'availability.observed');
    const amount = price?.current_value?.amount_minor;
    const summary = factSummary(price);
    const soldOut = avail?.current_value?.state && avail.current_value.state !== 'available' && avail.status !== 'stale';
    const out = { id: itemId, name: label(item.labels, 'en', 'ml-Latn', 'ml'), localName: label(item.labels, 'ml'),
      available: listing?.current_value?.state !== 'delisted' && !soldOut };
    if (Number.isInteger(amount) && amount >= 0) out.price = amount / 100;
    else out.priceStatus = 'ask';
    if (summary && summary.status !== 'confirmed') out.uncertain = true;
    if (price?.current_value?.tax_included === false) out.taxExtra = true;
    if (!out.localName || out.localName === out.name) delete out.localName;
    if (!out.name) continue;
    bySection.get(item.section_id).push(out);
    if (summary) {
      itemFacts[itemId] = { ...summary, ...(soldOut ? { soldOut: true } : {}) };
      priceFacts.push(summary);
      if (summary.observed && (!oldest || summary.observed < oldest)) oldest = summary.observed;
      if (summary.observed && (!newest || summary.observed > newest)) newest = summary.observed;
    } else if (soldOut) itemFacts[itemId] = { soldOut: true };
  }
  const tops = sections.filter(s => !s.parent_section_id || !bySection.has(s.parent_section_id));
  const rawSections = tops.map(s => {
    const name = label(s.labels, 'en', 'ml-Latn', 'ml') || 'Menu';
    const subs = sections.filter(x => x.parent_section_id === s.id);
    const items = bySection.get(s.id).map(i => ({ ...i, category: categoryOf(s, name) }));
    if (!subs.length) return { id: toSlug(s.id) || undefined, name, items };
    return { id: toSlug(s.id) || undefined, name, sections: [
      ...(items.length ? [{ id: `${toSlug(s.id)}-own`, name, items }] : []),
      ...subs.map(x => { const n = label(x.labels, 'en', 'ml-Latn', 'ml') || name; return { id: toSlug(x.id) || undefined, name: n, items: bySection.get(x.id).map(i => ({ ...i, category: categoryOf(x, n) || categoryOf(s, name) })) }; }),
    ] };
  });
  const place = sanitizePlace({
    id, name: label(p.names, 'en', 'ml-Latn', 'ml'), localName: label(p.names, 'ml'), currency: 'INR',
    last_confirmed: newest || new Date().toISOString().slice(0, 10), kind: KIND[p.category] || 'other',
    ...(p.osm?.state === 'linked' && ['node', 'way', 'relation'].includes(p.osm.type) && Number.isSafeInteger(p.osm.id) ? { osm: { type: p.osm.type, id: p.osm.id, relation: 'is' } } : {}),
    sections: rawSections,
  });
  // A stall with no priced items yet is still listed (so nobody adds it twice).
  const base = place || (label(p.names, 'en', 'ml-Latn', 'ml') ? { id, name: label(p.names, 'en', 'ml-Latn', 'ml'), currency: 'INR',
    last_confirmed: newest || day(p.created_at) || new Date().toISOString().slice(0, 10), sample: false, sections: [], itemCount: 0, kind: KIND[p.category] || 'other' } : null);
  if (!base) return null;
  const summary = placeSummary(priceFacts);
  base.es = { id: p.id, city: cityId, summary, items: itemFacts, oldest,
    imported: priceFacts.length > 0 && priceFacts.every(f => f.imported) };
  return base;
}

// ---- client ------------------------------------------------------------------
export function createEatsightsClient({ baseUrl = EATSIGHTS_BASE_URL, cities = EATSIGHTS_CITIES, fetchImpl = (...a) => globalThis.fetch(...a),
  storage = idbStorage(), timeoutMs = DATA_FETCH_TIMEOUT_MS, online = () => globalThis.navigator?.onLine !== false, concurrency = 4 } = {}) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const listeners = new Set();
  const inflight = new Map();
  const memory = new Map(); // cityId -> bundle
  const emit = event => { for (const fn of listeners) { try { fn(event); } catch { /* listener bug */ } } };
  const key = (kind, id = '') => `es1:${kind}:${base}:${id}`;
  const once = (id, fn) => { if (!inflight.has(id)) inflight.set(id, fn().finally(() => inflight.delete(id))); return inflight.get(id); };
  const background = (id, fn) => { if (online()) once(id, fn).catch(error => emit({ type: 'error', error })); };

  async function getJson(path, { etag } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${base}${path}`, { signal: controller.signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/json', ...(etag ? { 'If-None-Match': etag } : {}) } });
      if (response.status === 304) return { notModified: true };
      if (!response.ok) throw new DataError('http', `Eatsights answered ${response.status}.`);
      const text = await response.text();
      if (text.length > 2 * 1024 * 1024) throw new DataError('too-large', 'Eatsights data is larger than allowed.');
      try { return { json: JSON.parse(text), etag: response.headers?.get?.('etag') || '' }; }
      catch { throw new DataError('invalid', 'Eatsights data is damaged.'); }
    } catch (error) {
      if (error instanceof DataError) throw error;
      throw new DataError(online() ? 'network' : 'offline', online() ? 'Could not reach Eatsights.' : 'You are offline.');
    } finally { clearTimeout(timer); }
  }

  async function manifestFromCache() {
    const counts = await storage.get(key('counts')) || {};
    return { schemaVersion: 2, source: 'eatsights', generatedAt: '', freshness: { freshDays: 90, staleDays: 365 },
      cities: cities.map(c => ({ id: c.id, name: c.name, placeCount: Number.isInteger(counts[c.id]) ? counts[c.id] : null, slug: c.slug })) };
  }
  async function refreshManifest() { const manifest = await manifestFromCache(); emit({ type: 'manifest', manifest }); return manifest; }
  async function loadManifest() { return { manifest: await manifestFromCache(), cached: false, fetchedAt: Date.now() }; }

  async function fetchMenu(placeId, cityId) {
    const cached = await storage.get(key('menu', placeId));
    let result;
    try { result = await getJson(`/v1/places/${encodeURIComponent(placeId)}/menu`, { etag: cached?.etag }); }
    catch (error) { if (cached?.raw && ['network', 'offline'].includes(error.code)) return mapMenu(cached.raw, cityId); throw error; }
    if (result.notModified && cached?.raw) return mapMenu(cached.raw, cityId);
    await storage.set(key('menu', placeId), { etag: result.etag, raw: result.json, fetchedAt: Date.now() });
    return mapMenu(result.json, cityId);
  }

  function refreshCity(cityId) {
    return once(`city:${cityId}`, async () => {
      const city = cities.find(c => c.id === cityId);
      if (!city) throw new DataError('unknown-city', 'That city is not in the menu library.');
      const ids = [];
      let cursor = '';
      for (let page = 0; page < 20; page++) {
        const { json } = await getJson(`/v1/places?city=${encodeURIComponent(city.slug)}&limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        for (const p of Array.isArray(json?.items) ? json.items : []) if (toSlug(p?.id) && p.record_state !== 'merged' && !ids.includes(p.id)) ids.push(p.id);
        cursor = typeof json?.next_cursor === 'string' && json.next_cursor && json.items?.length ? json.next_cursor : '';
        if (!cursor || ids.length >= 3000) break;
      }
      const places = new Array(ids.length);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
        while (next < ids.length) { const i = next++; try { places[i] = await fetchMenu(ids[i], cityId); } catch (error) { if (error.code === 'offline') throw error; places[i] = null; } }
      }));
      const bundle = { city: cityId, generatedAt: new Date().toISOString(), source: 'eatsights', places: places.filter(Boolean) };
      await storage.set(key('bundle', cityId), { data: bundle, fetchedAt: Date.now() });
      const counts = await storage.get(key('counts')) || {};
      counts[cityId] = bundle.places.length;
      await storage.set(key('counts'), counts);
      memory.set(cityId, bundle);
      emit({ type: 'bundle', cityId, bundle });
      return bundle;
    });
  }

  async function loadCityBundle(cityId) {
    if (!cities.some(c => c.id === cityId)) throw new DataError('unknown-city', 'Unknown city.');
    const cached = await storage.get(key('bundle', cityId));
    if (cached?.data) {
      memory.set(cityId, cached.data);
      background(`city:${cityId}`, () => refreshCity(cityId));
      return { bundle: cached.data, cached: true, verified: true, fetchedAt: cached.fetchedAt };
    }
    if (!online()) throw new DataError('offline-empty', 'This city’s menus aren’t saved on this device yet.');
    return { bundle: await refreshCity(cityId), cached: false, verified: true, fetchedAt: Date.now() };
  }
  async function searchPlaces(cityId, query = '') {
    const bundle = memory.get(cityId) || (await loadCityBundle(cityId)).bundle;
    return matchPlaces(bundle.places, query);
  }
  async function getPlace(id, cityId) {
    const plId = fromSlug(id, 'pl_');
    if (!plId) return null;
    for (const [city, bundle] of memory) { if (cityId && city !== cityId) continue; const place = bundle.places.find(p => p.id === id); if (place) return { ...place, city }; }
    try { const place = await fetchMenu(plId, cityId || ''); return place ? { ...place, city: cityId || place.es.city } : null; } catch { return null; }
  }
  // Fresh menu for one place (bypasses the city bundle), used before sending
  // observations so Eatsights ids are current.
  const placeMenu = (id, cityId) => { const plId = fromSlug(id, 'pl_'); return plId ? fetchMenu(plId, cityId) : Promise.resolve(null); };
  // Server name search for the duplicate check when adding a stall.
  async function findSimilar(cityId, name) {
    const city = cities.find(c => c.id === cityId);
    if (!city) return [];
    const { json } = await getJson(`/v1/places?city=${encodeURIComponent(city.slug)}&q=${encodeURIComponent(cleanText(name, 60))}&limit=5`);
    return (Array.isArray(json?.items) ? json.items : []).map(p => ({ id: toSlug(p.id), esId: p.id, name: label(p.names, 'en', 'ml-Latn', 'ml') })).filter(p => p.id && p.name);
  }

  return { source: 'eatsights', baseUrl: base, loadManifest, loadCityBundle, searchPlaces, getPlace, refreshManifest, placeMenu, findSimilar,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
}

registerEatsights(() => createEatsightsClient());
