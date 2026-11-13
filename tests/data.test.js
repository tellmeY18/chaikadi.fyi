// Menu library client tests. Fixtures are copied verbatim from the
// chaikadi-data build output (manifest + Ernakulam bundle). No build step:
//   node --test tests/data.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDataClient, memoryStorage, sanitizePlace, sanitizeManifest, cleanText, freshnessOf, matchPlaces, orderableItems, placeItems,
  buildSuggestion, suggestionIssueUrl, sendSuggestion } from '../js/data.js';
import { AppStore } from '../js/store.js';
import { libraryChanges } from '../js/state.js';

const BASE = 'https://data.example.test';
const fixture = path => readFileSync(new URL(`fixtures/data/${path}`, import.meta.url));
const V2 = `${BASE}/v2/manifest.json`, V2_CITY = `${BASE}/v2/index/in-kl-ernakulam.json`;
const files = {
  [V2]: fixture('v2/manifest.json'), [V2_CITY]: fixture('v2/index/in-kl-ernakulam.json'),
  [`${BASE}/manifest.json`]: fixture('manifest.json'), [`${BASE}/index/in-kl-ernakulam.json`]: fixture('index/in-kl-ernakulam.json'),
};
const SFK = 'smart-foodie-kitchen-cyber-green';
function fakeNetwork(overrides = {}) {
  const calls = [];
  let offline = false;
  const fetchImpl = async (url, options) => {
    calls.push({ url, cache: options.cache, credentials: options.credentials });
    if (offline) throw new TypeError('Failed to fetch');
    const body = overrides[url] ?? files[url];
    if (!body) return new Response('missing', { status: 404 });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls, setOffline: value => { offline = value; }, online: () => !offline };
}
const client = (net, storage = memoryStorage()) => createDataClient({ baseUrl: BASE, fetchImpl: net.fetchImpl, storage, online: net.online, timeoutMs: 1000 });
const settle = () => new Promise(r => setTimeout(r, 10));

test('first load fetches, verifies the sha256 and caches; searchPlaces and getPlace work', async () => {
  const net = fakeNetwork(), c = client(net);
  const { manifest, cached } = await c.loadManifest();
  assert.equal(cached, false);
  assert.equal(manifest.cities[0].name, 'Ernakulam');
  const { bundle, verified } = await c.loadCityBundle('in/kl/ernakulam');
  assert.equal(verified, true);
  assert.equal(bundle.places.length, 4);
  assert.equal(net.calls[0].url, V2, 'v2 first');
  assert.ok(net.calls.every(call => call.credentials === 'omit'));
  assert.deepEqual((await c.searchPlaces('in/kl/ernakulam', 'snack edap')).map(p => p.id), ['sample-snack-counter-edappally']);
  assert.deepEqual((await c.searchPlaces('in/kl/ernakulam', 'cyber green')).map(p => p.id), [SFK], 'search covers the location');
  assert.equal((await c.searchPlaces('in/kl/ernakulam', '')).length, 4);
  const place = await c.getPlace('sample-meals-hotel-fort-kochi');
  assert.equal(place.city, 'in/kl/ernakulam');
  assert.equal(place.sample, true);
});

test('stale-while-revalidate: cached data returns immediately, refresh happens in the background', async () => {
  const net = fakeNetwork(), storage = memoryStorage();
  await client(net, storage).loadCityBundle('in/kl/ernakulam');
  const second = client(net, storage);
  let resolveSlow;
  const slow = new Promise(r => { resolveSlow = r; });
  const slowNet = { ...net, fetchImpl: async (...args) => { await slow; return net.fetchImpl(...args); } };
  const third = createDataClient({ baseUrl: BASE, fetchImpl: slowNet.fetchImpl, storage, online: net.online, timeoutMs: 1000 });
  const result = await third.loadManifest();
  assert.equal(result.cached, true, 'served from cache without waiting for the network');
  const events = [];
  third.subscribe(e => events.push(e.type));
  resolveSlow(); await settle();
  assert.equal(net.calls.at(-1).cache, 'reload', 'background refresh bypasses HTTP and SW caches');
  assert.deepEqual(events, [], 'unchanged manifest does not emit an update');
  assert.equal((await second.loadCityBundle('in/kl/ernakulam')).cached, true);
});

test('a bundle whose bytes do not match the manifest hash is discarded and the last good copy kept', async () => {
  const storage = memoryStorage();
  // First visit: tampered bundle, nothing cached -> clear error, nothing stored.
  // Same length, different bytes: only the sha256 check can catch it.
  const tampered = Buffer.from(files[V2_CITY].toString().replace('"Chai"', '"Tea!"'));
  const evil = fakeNetwork({ [V2_CITY]: tampered });
  await assert.rejects(client(evil, storage).loadCityBundle('in/kl/ernakulam'), e => e.code === 'hash-mismatch');
  assert.equal(await storage.get(`v2:bundle:${BASE}:in/kl/ernakulam`), null);
  // Good copy cached; then a new manifest announces a hash the server cannot satisfy.
  await client(fakeNetwork(), storage).loadCityBundle('in/kl/ernakulam');
  const manifest = JSON.parse(files[V2]);
  manifest.cities[0].sha256 = 'f'.repeat(64);
  const net = fakeNetwork({ [V2]: JSON.stringify(manifest), [V2_CITY]: tampered });
  const c = client(net, storage);
  const errors = [];
  c.subscribe(e => { if (e.type === 'error') errors.push(e.error.code); });
  await c.refreshManifest();
  const result = await c.loadCityBundle('in/kl/ernakulam');
  assert.equal(result.verified, false);
  assert.equal(placeItems(result.bundle.places[0])[0].item.name, 'Chai', 'last good copy is still served');
  await settle();
  assert.deepEqual(errors, ['hash-mismatch']);
  assert.equal(placeItems((await storage.get(`v2:bundle:${BASE}:in/kl/ernakulam`)).data.places[0])[0].item.name, 'Chai');
});

test('offline: cached data works; never-cached data gives a clear offline-empty error', async () => {
  const storage = memoryStorage(), net = fakeNetwork();
  net.setOffline(true);
  await assert.rejects(client(net, storage).loadManifest(), e => e.code === 'offline-empty');
  net.setOffline(false);
  await client(net, storage).loadCityBundle('in/kl/ernakulam');
  net.setOffline(true);
  const before = net.calls.length;
  const c = client(net, storage);
  assert.equal((await c.loadManifest()).cached, true);
  assert.equal((await c.searchPlaces('in/kl/ernakulam', 'chai')).length, 1);
  assert.equal(net.calls.length, before, 'no network attempts while offline');
});

test('untrusted data: unknown fields dropped, text cleaned, limits enforced, bad places skipped', () => {
  const place = sanitizePlace({ id: 'stall', name: 'Stall\u202e <b>x</b>', currency: 'INR', last_confirmed: '2026-11-01', evil: 'x', url: 'javascript:alert(1)',
    osm: { type: 'way', id: 5, relation: 'inside', tags: { name: 'x' } }, location: { building: 'B', lat: 9.9 }, tax: { included: 'no' }, hours: [{ open: '25:00', close: '01:00' }],
    sections: [{ id: 's', name: 'S', onclick: 'x', items: [
      { id: 'a', name: 'Chai\n\u0000', category: 'Juice', price: 12.345, diet: 'jain', spice: 9, onclick: 'x' },
      { id: 'a', name: 'Dup', category: 'Tea', price: 1 }, { id: 'b', name: 'Bad', category: 'Tea', price: -1 },
      { id: 'c', name: 'Sizes', category: 'Meal', variants: [{ name: 'Half', price: 1, x: 1 }, { name: 'Full', price: 2 }] }] }] });
  assert.deepEqual(place, { id: 'stall', name: 'Stall <b>x</b>', currency: 'INR', last_confirmed: '2026-11-01', sample: false,
    sections: [{ id: 's', name: 'S', items: [{ id: 'a', name: 'Chai', category: 'Other', price: 12.35, available: true },
      { id: 'c', name: 'Sizes', category: 'Meal', variants: [{ name: 'Half', price: 1 }, { name: 'Full', price: 2 }], available: true }] }],
    osm: { type: 'way', id: 5, relation: 'inside' }, location: { building: 'B' }, itemCount: 2 });
  assert.equal(sanitizePlace({ id: 'node/1', name: 'X', currency: 'INR', last_confirmed: 'yesterday', menu: [] }), null);
  assert.equal(cleanText('x'.repeat(500)).length, 80);
  const manifest = sanitizeManifest({ schemaVersion: 1, cities: [
    { id: 'in/kl/a', name: 'A', url: 'https://evil.example/x.json', sha256: 'a'.repeat(64), bytes: 10 },
    { id: 'in/kl/b', name: 'B', url: 'index/in-kl-b.json', sha256: 'a'.repeat(64), bytes: 10 ** 9 },
    { id: 'in/kl/c', name: 'C', url: 'index/in-kl-c.json', sha256: 'a'.repeat(64), bytes: 10 }] });
  assert.deepEqual(manifest.cities.map(c => c.id), ['in/kl/c']);
  assert.throws(() => sanitizeManifest({ schemaVersion: 3, cities: [] }), /supported/);
});

test('oversized responses are rejected before parsing', async () => {
  const net = fakeNetwork({ [V2]: 'x'.repeat(200 * 1024) });
  await assert.rejects(client(net).loadManifest(), e => e.code === 'too-large');
});

test('freshness thresholds match the data repo and search folds accents', () => {
  const now = new Date('2026-11-12T10:00:00Z');
  assert.deepEqual(freshnessOf('2026-11-12', {}, now), { days: 0, status: 'fresh' });
  assert.equal(freshnessOf('2026-08-14', {}, now).status, 'fresh');
  assert.equal(freshnessOf('2026-08-13', {}, now).status, 'stale');
  assert.equal(freshnessOf('2025-11-11', {}, now).status, 'unverified');
  assert.deepEqual(matchPlaces([{ name: 'Café Kochi' }, { name: 'Chai Kochi' }], 'cafe').map(p => p.name), ['Café Kochi']);
});

test('suggestions carry only place, items, prices and date', async () => {
  const s = buildSuggestion({ placeId: 'sample-chai-corner-kaloor', city: 'in/kl/ernakulam', name: 'Sample Chai Corner, Kaloor', seen: '2026-11-12',
    changes: [{ name: 'Chai', category: 'Tea', price: 14, member: 'Anu' }, { name: 'Bad | pipe', category: 'Tea', price: 1 }] });
  assert.deepEqual(s, { schemaVersion: 1, kind: 'update-menu', placeId: 'sample-chai-corner-kaloor', city: 'in/kl/ernakulam', name: 'Sample Chai Corner, Kaloor', seen: '2026-11-12',
    changes: [{ name: 'Chai', category: 'Tea', price: 14 }] });
  const url = new URL(suggestionIssueUrl(s, 'https://github.com/tellmeY18/chaikadi-data'));
  assert.equal(url.pathname, '/tellmeY18/chaikadi-data/issues/new');
  assert.equal(url.searchParams.get('template'), 'update-menu.yml');
  assert.equal(url.searchParams.get('place-id'), 'in/kl/ernakulam/sample-chai-corner-kaloor');
  assert.equal(url.searchParams.get('date-seen'), '2026-11-12');
  assert.equal(url.searchParams.get('changes'), 'Chai | Tea | 14');
  const long = suggestionIssueUrl({ ...s, changes: Array.from({ length: 150 }, (_, i) => ({ name: `Item number ${i} with a longer name`, category: 'Meal', price: 100 })) }, 'https://github.com/x/y');
  assert.ok(long.length <= 6000);
  let sent;
  await sendSuggestion(s, 'https://suggest.example.test/menu', { fetchImpl: async (url, init) => { sent = { url, init }; return new Response(null, { status: 202 }); } });
  assert.equal(sent.init.credentials, 'omit');
  assert.deepEqual(JSON.parse(sent.init.body), s);
  await assert.rejects(sendSuggestion(s, 'http://insecure.example.test'), /HTTPS/);
});

test('importing a library place: new menu, then add-missing or replace without duplicates', async () => {
  const net = fakeNetwork(), c = client(net);
  const stall = await c.getPlace('sample-snack-counter-edappally', 'in/kl/ernakulam');
  const app = new AppStore(); app.db = { save: async () => {} };
  app.startRoom = () => {}; await app.create('Crew', 'Host', { starter: false });
  const first = await app.importLibraryPlace(stall, 'in/kl/ernakulam');
  const state = () => app.data.state;
  const menu = state().menus.find(m => m.id === first.menuId);
  assert.equal(menu.name, 'Sample Snack Counter, Edappally');
  assert.equal(menu.source.placeId, 'sample-snack-counter-edappally');
  assert.equal(state().activeMenuId, first.menuId);
  // Unavailable "Bun Maska" is not imported; 25.5 becomes 2550 minor units elsewhere.
  assert.deepEqual(state().menu.map(i => [i.name, i.category, i.price]), [['Cutting Chai', 'Tea', 1000], ['Lime Juice', 'Tea', 3000], ['Samosa', 'Snacks', 1500], ['Uzhunnu Vada', 'Snacks', 1200]]);
  // Group edits: price change + an extra item of their own.
  const samosa = state().menu.find(i => i.name === 'Samosa');
  await app.dispatch('menu.upsert', { ...samosa, price: 1800 });
  await app.dispatch('menu.upsert', { id: 'own', menuId: first.menuId, name: 'Extra Biscuit', category: 'Snacks', price: 500 });
  assert.deepEqual(libraryChanges(state()), [{ name: 'Samosa', category: 'Snacks', price: 1800, before: 1500 }]);
  await app.dispatch('pick.set', { itemId: samosa.id, qty: 2, note: '' });
  const added = await app.importLibraryPlace(stall, 'in/kl/ernakulam', 'add');
  assert.deepEqual([added.added, added.updated, added.removed], [0, 0, 0]);
  assert.equal(state().menu.find(i => i.name === 'Samosa').price, 1800, 'add keeps group prices');
  const replaced = await app.importLibraryPlace(stall, 'in/kl/ernakulam', 'replace');
  assert.deepEqual([replaced.added, replaced.updated, replaced.removed], [0, 4, 1]);
  assert.equal(state().menus.length, 1, 'no duplicate menus');
  assert.equal(state().menu.length, 4, 'no duplicate items; own extra removed by replace');
  assert.equal(state().menu.find(i => i.name === 'Samosa').price, 1500);
  assert.equal(state().picks[0].itemId, samosa.id, 'picks survive replace (item ids kept)');
  assert.deepEqual(libraryChanges(state()), []);
});

test('reducer rejects malformed library links from peers', async () => {
  const app = new AppStore(); app.db = { save: async () => {} };
  app.startRoom = () => {}; await app.create('Crew', 'Host', { starter: false });
  const ok = await app.dispatch('menu.create', { id: 'm1', name: 'X', source: { placeId: 'node/1', city: 'in/kl/x', name: 'X', lastConfirmed: '2026-01-01', items: [{ name: 'A', category: 'Juice', price: 1 }] } });
  assert.equal(ok, false);
  assert.equal(app.data.state.menus.length, 0);
});

test('older data hosts: v1 manifest and flat bundles are used when v2 is missing', async () => {
  const net = fakeNetwork({ [V2]: undefined });
  delete files[V2];
  try {
    const c = client(net);
    const { manifest } = await c.loadManifest();
    assert.equal(manifest.schemaVersion, 1);
    const { bundle } = await c.loadCityBundle('in/kl/ernakulam');
    assert.deepEqual(bundle.places.map(p => p.id), ['node/9000000000001', 'node/9000000000002', 'way/9000000000003']);
    const hotel = bundle.places[2];
    assert.deepEqual(hotel.osm, { type: 'way', id: 9000000000003, relation: 'is' });
    assert.ok(orderableItems(hotel).some(i => i.name === 'Omelette (Double)' && i.price === 50));
  } finally { files[V2] = fixture('v2/manifest.json'); }
});

test('a rich v2 place imports variants as separate items and skips unpriced ones', async () => {
  const c = client(fakeNetwork());
  const place = await c.getPlace(SFK, 'in/kl/ernakulam');
  assert.deepEqual(place.osm, { type: 'way', id: 1292036173, relation: 'inside' });
  assert.equal(place.tax.included, false);
  assert.equal(place.sections[0].sections[0].name, 'Breads');
  const items = orderableItems(place);
  assert.equal(items.length, 97);
  for (const n of ['Chicken Biriyani (Full)', 'Chicken Biriyani (Half)', 'Chicken Curry (Breakfast)', 'Gheerice Combo (Chicken / Beef)']) assert.ok(items.some(i => i.name === n), n);
  assert.ok(!items.some(i => i.name.startsWith('Fish Curry')), 'seasonal items without a price are not imported');
  const app = new AppStore(); app.db = { save: async () => {} };
  app.startRoom = () => {}; await app.create('Crew', 'Host', { starter: false });
  const result = await app.importLibraryPlace(place, 'in/kl/ernakulam');
  assert.equal(result.added, 97);
  const menu = app.data.state.menu;
  assert.equal(new Set(menu.map(i => i.name.toLowerCase())).size, 97, 'no duplicate names');
  assert.equal(menu.find(i => i.name === 'Chicken Biriyani (Half)').price, 16000);
  assert.equal(menu.find(i => i.name === 'Tender Coconut').category, 'Tea', 'drinks map to the app Tea category');
  assert.equal(app.data.state.menus[0].source.placeId, SFK);
});
