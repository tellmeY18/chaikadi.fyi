// Library data rules: sanitizing places, orderable lines, search, importing
// into a group menu. Places come from the chaikadi-data fixtures (the same
// shape Eatsights menus are mapped into).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizePlace, cleanText, matchPlaces, orderableItems } from '../js/data.js';
import { AppStore } from '../js/store.js';
import { libraryChanges } from '../js/state.js';

const bundle = JSON.parse(readFileSync(new URL('fixtures/data/v2/index/in-kl-ernakulam.json', import.meta.url), 'utf8'));
const placeById = id => sanitizePlace(bundle.places.find(p => p.id === id));
const SFK = 'smart-foodie-kitchen-cyber-green';

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
});

test('search folds accents', () => {
  assert.deepEqual(matchPlaces([{ name: 'Café Kochi' }, { name: 'Chai Kochi' }], 'cafe').map(p => p.name), ['Café Kochi']);
});

test('importing a library place: new menu, then add-missing or replace without duplicates', async () => {
  const stall = placeById('sample-snack-counter-edappally');
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

test('a rich v2 place imports variants as separate items and skips unpriced ones', async () => {
  const place = placeById(SFK);
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
