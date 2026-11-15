// Menu library data rules (no UI, no network). Library places come from
// Eatsights (eatsights.js) and go through sanitizePlace: everything fetched is
// untrusted, sizes are capped, unknown fields are ignored and text is cleaned.
// The UI renders text only via Preact text nodes (escaped), never as HTML.
export const LIBRARY_CATEGORIES = ['Tea', 'Coffee', 'Drinks', 'Snacks', 'Meal', 'Dessert', 'Other'];
export const LIMITS = Object.freeze({ places: 3000, items: 300, sections: 40, text: 80, note: 160 });
const OSM_ID = /^(node|way|relation)\/[1-9][0-9]{0,14}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
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

// ---- search ----------------------------------------------------------------
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
