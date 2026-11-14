import test from 'node:test';
import assert from 'node:assert/strict';
import { createEatsightsClient, mapMenu, toSlug, fromSlug, placeSummary, factSummary } from '../js/eatsights.js';
import { memoryStorage, withFallback, orderableItems } from '../js/data.js';
import { canonical, createContributor, keyIdOf, b64url, ulid } from '../js/contrib.js';

const PL = 'pl_01M7BHQY50D2K939M5G5K824XX', SC = 'sc_01M7BHQY5750K7PNHST10PXP47';
const MI = 'mi_01M7BHQY5MQJQCFKEN7SE4ZN1Y', MI2 = 'mi_01M7BHQY5MQJQCFKEN7SE4ZN2Z';
const fact = (status, extra = {}) => ({ property: 'price.amount', status, confidence: .6, counts: { confirmations: 2, disputes: 0, distinct_contributors: 3 },
  current_value: { amount_minor: 1500, currency: 'INR', fulfilment: 'dine_in' }, last_observed_at: '2026-11-13T10:00:00Z', last_confirmed_at: '2026-11-12T10:00:00Z',
  half_life_hours: 1440, computed_at: '2026-11-13T10:00:00Z', sources: ['customer'], ...extra });
// Recorded from develop.letsimpl.fyi (shape of GET /v1/places/{id}/menu), plus a second item.
const MENU = {
  built_at: '2026-11-13T22:51:37Z',
  place: { id: PL, category: 'tea_stall', city: 'ernakulam', names: { en: 'E2E Chaya Kada', ml: 'ചായക്കട' }, osm: { state: 'unchecked' }, record_state: 'active', created_at: '2026-11-13T22:51:37Z', location: { lat: 9.93, lng: 76.26 } },
  sections: [{ id: SC, kind: 'drinks', labels: { en: 'Tea' }, place_id: PL, sort: 1 }],
  items: [
    { item: { id: MI, labels: { en: 'Chai' }, section_id: SC, place_id: PL, record_state: 'active' }, facts: [fact('confirmed')] },
    { item: { id: MI2, labels: { en: 'Masala Chai' }, section_id: SC, place_id: PL, record_state: 'active' },
      facts: [fact('unconfirmed', { counts: { confirmations: 1, disputes: 0, distinct_contributors: 1 }, sources: ['vendor'], current_value: { amount_minor: 2000, currency: 'INR', fulfilment: 'dine_in' } })] },
  ],
  place_facts: [],
};

test('Eatsights ids round-trip through Chaikadi slugs', () => {
  const slug = toSlug(PL);
  assert.equal(slug, 'es-01m7bhqy50d2k939m5g5k824xx');
  assert.ok(slug.length <= 60 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug));
  assert.equal(fromSlug(slug, 'pl_'), PL);
  assert.equal(fromSlug('chai-corner', 'pl_'), null);
  assert.equal(toSlug('pl_not-a-ulid'), null);
});

test('a menu maps onto the library place shape with fact summaries', () => {
  const place = mapMenu(MENU, 'in/kl/ernakulam');
  assert.equal(place.id, toSlug(PL));
  assert.equal(place.name, 'E2E Chaya Kada');
  assert.equal(place.localName, 'ചായക്കട');
  assert.equal(place.kind, 'tea-stall');
  assert.equal(place.itemCount, 2);
  const [chai, masala] = place.sections[0].items;
  assert.deepEqual([chai.name, chai.price, chai.category], ['Chai', 15, 'Tea']);
  assert.equal(masala.price, 20);
  assert.equal(masala.uncertain, true);
  assert.equal(place.es.items[chai.id].status, 'confirmed');
  assert.equal(place.es.items[masala.id].vendor, true, 'vendor-declared value');
  assert.equal(place.es.summary.status, 'unconfirmed');
  assert.equal(place.osm, undefined, 'OSM only when linked');
  assert.deepEqual(orderableItems(place).map(i => [i.name, i.id]), [['Chai', chai.id], ['Masala Chai', masala.id]]);
});

test('stall freshness: contested wins, all stale is stale, all confirmed is confirmed', () => {
  const f = s => factSummary(fact(s));
  assert.equal(placeSummary([f('confirmed'), f('contested')]).status, 'contested');
  assert.equal(placeSummary([f('stale'), f('stale')]).status, 'stale');
  assert.equal(placeSummary([f('confirmed'), f('stale')]).status, 'confirmed');
  assert.equal(placeSummary([f('confirmed'), f('unconfirmed')]).status, 'unconfirmed');
  assert.deepEqual(placeSummary([f('confirmed')]), { status: 'confirmed', contributors: 3, last: '2026-11-12' });
  assert.equal(factSummary({ status: 'weird' }), null);
});

function fakeApi({ fail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    if (fail) throw new TypeError('network');
    const json = url.includes('/menu') ? MENU : { items: [MENU.place], next_cursor: null };
    if (init?.headers?.['If-None-Match'] === 'W/"1"') return { ok: false, status: 304, headers: { get: () => null } };
    return { ok: true, status: 200, headers: { get: k => (k === 'etag' ? 'W/"1"' : null) }, text: async () => JSON.stringify(json) };
  };
  return { fetchImpl, calls };
}

test('client loads a city, caches it, and revalidates menus with ETags', async () => {
  const storage = memoryStorage(), api = fakeApi();
  const c = createEatsightsClient({ fetchImpl: api.fetchImpl, storage, online: () => true });
  const { bundle, cached } = await c.loadCityBundle('in/kl/ernakulam');
  assert.equal(cached, false);
  assert.equal(bundle.places.length, 1);
  assert.ok(api.calls[0].includes('/v1/places?city=ernakulam'));
  assert.equal((await c.searchPlaces('in/kl/ernakulam', 'chaya'))[0].id, toSlug(PL));
  const manifest = (await c.loadManifest()).manifest;
  assert.equal(manifest.cities.find(x => x.id === 'in/kl/ernakulam').placeCount, 1);
  const again = createEatsightsClient({ fetchImpl: api.fetchImpl, storage, online: () => false });
  assert.equal((await again.loadCityBundle('in/kl/ernakulam')).cached, true, 'offline: cached copy');
  const place = await again.placeMenu(toSlug(PL), 'in/kl/ernakulam');
  assert.equal(place.name, 'E2E Chaya Kada', 'offline menu from cache');
});

test('falls back to the static library when Eatsights is unreachable and nothing is cached', async () => {
  const api = fakeApi({ fail: true });
  const primary = createEatsightsClient({ fetchImpl: api.fetchImpl, storage: memoryStorage(), online: () => true });
  const staticPlace = { id: 'chai-corner', name: 'Chai Corner', last_confirmed: '2026-10-01', sections: [] };
  const fallback = { subscribe: () => {}, loadCityBundle: async city => ({ bundle: { city, places: [staticPlace] }, cached: false }),
    searchPlaces: async () => [staticPlace], getPlace: async () => staticPlace };
  const client = withFallback(primary, fallback);
  const result = await client.loadCityBundle('in/kl/ernakulam');
  assert.equal(result.fallback, true);
  assert.equal(result.bundle.fallback, true);
  assert.equal((await client.searchPlaces('in/kl/ernakulam', ''))[0].fallback, true);
});

test('canonical JSON sorts keys and drops nothing else (RFC 8785 subset)', () => {
  assert.equal(canonical({ b: 1, a: [true, null, 'x'], c: { z: 'é', y: 0 } }), '{"a":[true,null,"x"],"b":1,"c":{"y":0,"z":"é"}}');
  assert.match(ulid(), /^[0-9A-HJKMNP-TV-Z]{26}$/);
});

test('key ids follow proposal 0001 and signatures verify over the canonical bytes', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
  const id = await keyIdOf(raw);
  assert.equal(id.length, 22);
  assert.equal(id, b64url((await crypto.subtle.digest('SHA-256', raw)).slice(0, 16)));

  const posted = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    posted.push([url, body]);
    const reply = url.endsWith('/v1/keys') ? { key_id: 'x' } : { results: body.map((_, index) => ({ index, status: index ? 'duplicate' : 'accepted' })) };
    return { ok: true, status: 200, json: async () => reply };
  };
  const c = createContributor({ storage: memoryStorage(), fetchImpl, online: () => true, baseUrl: 'https://es.test' });
  const ob = await c.observation({ property: 'price.amount', placeId: PL, itemId: MI, value: { amount_minor: 1200, currency: 'INR', fulfilment: 'dine_in' } });
  assert.equal(ob.schema_version, '0.3');
  assert.equal(ob.license, 'CC0-1.0');
  assert.equal(ob.source_type, 'customer');
  assert.ok(!JSON.stringify(ob).match(/note|member|group/i), 'no personal fields');
  const k = await c.key();
  const pub = await crypto.subtle.importKey('raw', Uint8Array.from(atob(k.publicKey.replace(/-/g, '+').replace(/_/g, '/') + '='), ch => ch.charCodeAt(0)), { name: 'Ed25519' }, false, ['verify']);
  const { signature, ...rest } = ob;
  const sig = Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/') + '=='), ch => ch.charCodeAt(0));
  assert.equal(signature.length, 86);
  assert.ok(await crypto.subtle.verify({ name: 'Ed25519' }, pub, sig, new TextEncoder().encode(canonical(rest))));

  const results = await c.submit([ob, ob]);
  assert.deepEqual(results.map(r => r.status), ['sent', 'already']);
  assert.equal(posted[0][0], 'https://es.test/v1/keys', 'the key registers before the first submission');
  assert.equal(posted[0][1].type, 'key_registration');
});

test('offline submissions wait in the outbox and flush later', async () => {
  let up = false;
  const fetchImpl = async (url, init) => {
    if (!up) throw new TypeError('offline');
    const body = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => (url.endsWith('/v1/keys') ? {} : { results: body.map((_, index) => ({ index, status: 'accepted' })) }) };
  };
  const c = createContributor({ storage: memoryStorage(), fetchImpl, online: () => up });
  const ob = await c.observation({ property: 'availability.observed', placeId: PL, itemId: MI, value: { state: 'sold_out' } });
  assert.deepEqual((await c.submit([ob])).map(r => r.status), ['queued']);
  assert.equal(await c.pending(), 1);
  up = true;
  assert.deepEqual(await c.flush(), { sent: 1 });
  assert.equal(await c.pending(), 0);
  await c.reset();
  assert.equal(await c.info(), null);
});
