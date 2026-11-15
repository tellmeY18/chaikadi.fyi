// Seed Eatsights with Chaikadi's own CC0 library data (phase 3 of
// EATSIGHTS-INTEGRATION.md). Node 22, no dependencies.
//
//   node tools/eatsights-seed.mjs [--base URL] [--pace] [--dry-run] <place.json>...
//
// - Signs with a dedicated import key kept in .dev/eatsights-import-key.json
//   (git-ignored; created on first run and registered with POST /v1/keys).
// - Entities (place, sections, menu items) via signed POST /v1/entities, then
//   price.amount and listing.status observations via POST /v1/submissions with
//   (needs a per-key rate limit above the batch size, e.g.
//   EATSIGHTS_RATE_PER_KEY_PER_MIN=10000 on develop; reruns are safe)
//   source_type/method "import". Prices are observed on the file's
//   last_confirmed date, so freshness stays honest (D9).
// - IDs are derived from the Chaikadi ids, so reruns report "duplicate".
// - Not sent: sample stalls, notes, descriptions, OSM (server-controlled),
//   diet/spice/portion (need dish links or other properties). Location is the
//   city centre with precision 5 km until someone drops a real pin (D3).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { canonical, b64url, keyIdOf } from '../js/contrib.js';
import { EATSIGHTS_BASE_URL, EATSIGHTS_CITIES } from '../js/config.js';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const base = (opt('--base') || EATSIGHTS_BASE_URL).replace(/\/+$/, '');
const dryRun = flag('--dry-run');
if (!args.length) { console.error('usage: node tools/eatsights-seed.mjs [--base URL] [--dry-run] <place.json>...'); process.exit(2); }

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
// Stable 26-char Crockford id from a name (first char ≤ 7, as ULIDs require).
const stableId = (prefix, ...parts) => {
  const bytes = createHash('sha256').update(['chaikadi-seed-v1', ...parts].join('\u0000')).digest();
  let out = CROCKFORD[bytes[0] % 8];
  for (let i = 1; i < 26; i++) out += CROCKFORD[bytes[i] % 32];
  return prefix + out;
};
const KIND = { 'tea-stall': 'tea_stall', 'juice-shop': 'juice_shop', hotel: 'small_hotel', restaurant: 'restaurant', cafe: 'cafe', canteen: 'canteen', bakery: 'bakery' };
const SECTION_KIND = { Tea: 'drinks', Coffee: 'drinks', Drinks: 'drinks', Snacks: 'snacks', Meal: 'meals', Dessert: 'desserts' };
const NAMED_KIND = [[/breakfast/i, 'breakfast'], [/combo/i, 'combos'], [/extra|add.?on|side/i, 'sides'], [/starter/i, 'starters'], [/beverage|shake|juice|tea|coffee/i, 'drinks'], [/snack/i, 'snacks'], [/dessert|sweet/i, 'desserts'], [/lunch|dinner|main|meal|biriyani|rice/i, 'meals']];
const sectionKind = (name, items) => NAMED_KIND.find(([re]) => re.test(name))?.[1]
  || SECTION_KIND[items.map(i => i.category).sort((a, b) => items.filter(x => x.category === b).length - items.filter(x => x.category === a).length)[0]] || 'other';
const SIZES = ['small', 'regular', 'large', 'half', 'full'];

// ---- import key ------------------------------------------------------------
const KEY_FILE = new URL('../.dev/eatsights-import-key.json', import.meta.url);
async function importKey() {
  if (existsSync(KEY_FILE)) {
    const saved = JSON.parse(readFileSync(KEY_FILE, 'utf8'));
    const privateKey = await webcrypto.subtle.importKey('jwk', saved.jwk, { name: 'Ed25519' }, false, ['sign']);
    return { ...saved, privateKey };
  }
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const raw = await webcrypto.subtle.exportKey('raw', pair.publicKey);
  const saved = { jwk: await webcrypto.subtle.exportKey('jwk', pair.privateKey), publicKey: b64url(raw), keyId: await keyIdOf(raw), createdAt: new Date().toISOString() };
  mkdirSync(new URL('../.dev/', import.meta.url), { recursive: true });
  writeFileSync(KEY_FILE, JSON.stringify(saved, null, 2), { mode: 0o600 });
  return { ...saved, privateKey: pair.privateKey };
}
async function sign(key, object) {
  const sig = await webcrypto.subtle.sign({ name: 'Ed25519' }, key.privateKey, new TextEncoder().encode(canonical(object)));
  return { ...object, signature: b64url(sig) };
}
// Production allows 120 signed items per key per minute: --pace sends 50 at a
// time with a pause between batches.
const pace = flag('--pace');
const BATCH = pace ? 50 : 100, PAUSE_MS = pace ? 26000 : 0;
let lastBatch = 0;
async function post(path, body) {
  if (dryRun) return { results: (Array.isArray(body) ? body : [body]).map((_, index) => ({ index, status: 'dry-run' })) };
  if (Array.isArray(body) && PAUSE_MS) { const wait = lastBatch + PAUSE_MS - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait)); lastBatch = Date.now(); }
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${path}: ${response.status} ${json?.detail || json?.title || ''}`);
  return json;
}

// ---- mapping ---------------------------------------------------------------
export function plan(place) {
  if (place.sample) throw new Error(`${place.id}: sample stalls are not migrated`);
  const city = EATSIGHTS_CITIES.find(c => c.id === place.city);
  if (!city) throw new Error(`${place.id}: city ${place.city} is not in EATSIGHTS_CITIES`);
  const pl = stableId('pl_', 'place', place.city, place.id);
  const entities = [{ entity_type: 'place', entity: { id: pl, names: { en: place.name, ...(place.localName ? { ml: place.localName } : {}) }, category: KIND[place.kind] || 'other',
    location: { lat: city.centre.lat, lng: city.centre.lng, precision_m: 5000 }, city: city.slug } }];
  const items = [], facts = [];
  let sort = 0;
  const addSection = (s, parent, path) => {
    const own = s.items || [], all = own.concat((s.sections || []).flatMap(x => x.items || []));
    const id = stableId('sc_', 'section', pl, ...path);
    entities.push({ entity_type: 'section', entity: { id, place_id: pl, ...(parent ? { parent_section_id: parent } : {}), labels: { en: s.name }, kind: sectionKind(s.name, all), sort: ++sort } });
    for (const sub of s.sections || []) addSection(sub, id, [...path, sub.id]);
    for (const item of own) {
      const lines = item.variants?.length ? item.variants.map(v => ({ key: [item.id, v.id || v.name], label: `${item.name} (${v.name})`, price: v.price,
        variant: SIZES.includes(String(v.name).toLowerCase()) ? { size: String(v.name).toLowerCase() } : { label: { en: v.name } } }))
        : [{ key: [item.id], label: item.name, price: item.price }];
      for (const line of lines) {
        const mi = stableId('mi_', 'item', pl, ...path, ...line.key);
        items.push({ entity_type: 'menu_item', entity: { id: mi, place_id: pl, section_id: id, labels: { en: line.label, ...(item.localName ? { ml: item.localName } : {}) }, ...(line.variant ? { variant: line.variant } : {}) } });
        const listing = item.available === false ? 'delisted' : item.priceStatus === 'seasonal' ? 'seasonal' : 'listed';
        facts.push({ mi, property: 'listing.status', value: { state: listing } });
        if (typeof line.price === 'number') facts.push({ mi, property: 'price.amount',
          value: { amount_minor: Math.round(line.price * 100), currency: place.currency || 'INR', fulfilment: 'dine_in', ...(typeof place.tax?.included === 'boolean' ? { tax_included: place.tax.included } : {}) } });
      }
    }
  };
  for (const s of place.sections || []) addSection(s, null, [s.id]);
  return { pl, entities: [...entities, ...items], facts, observedAt: `${place.last_confirmed}T12:00:00Z` };
}

async function seed(file, key) {
  const place = JSON.parse(readFileSync(file, 'utf8'));
  const { pl, entities, facts, observedAt } = plan(place);
  const now = new Date().toISOString();
  const counts = {};
  const tally = (results, kind) => { for (const r of results || []) { const k = `${kind}:${r.status}`; counts[k] = (counts[k] || 0) + 1; if (r.status === 'rejected') console.error(`  rejected ${kind} #${r.index}: ${r.problem?.detail || r.problem?.title}`); } };
  for (let i = 0; i < entities.length; i += BATCH) {
    const batch = [];
    for (const e of entities.slice(i, i + BATCH)) batch.push(await sign(key, { id: stableId('es_', 'entity', e.entity.id), schema_version: '0.4', op: 'create', ...e, submitted_at: now, contributor: { key_id: key.keyId }, license: 'CC0-1.0' }));
    tally((await post('/v1/entities', batch)).results, 'entity');
  }
  for (let i = 0; i < facts.length; i += BATCH) {
    const batch = [];
    for (const f of facts.slice(i, i + BATCH)) batch.push(await sign(key, { id: stableId('ob_', 'obs', f.mi, f.property, observedAt), schema_version: '0.3', kind: 'value', property: f.property,
      subject: { scope: 'menu_item', place_id: pl, menu_item_id: f.mi }, value: f.value, observed_at: observedAt, submitted_at: now, method: 'import', source_type: 'import',
      client: { app_id: 'chaikadi-seed', app_version: '1' }, license: 'CC0-1.0', contributor: { key_id: key.keyId } }));
    tally((await post('/v1/submissions', batch)).results, 'observation');
  }
  console.log(`${place.id} -> ${pl}`, counts);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const key = await importKey();
  if (!dryRun) await post('/v1/keys', await sign(key, { type: 'key_registration', algorithm: 'ed25519', public_key: key.publicKey, created_at: key.createdAt }));
  console.log(`import key ${key.keyId} -> ${dryRun ? 'dry run' : base}`);
  for (const file of args) await seed(file, key);
}
