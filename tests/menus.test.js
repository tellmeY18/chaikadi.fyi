import test from 'node:test';
import assert from 'node:assert/strict';
import { newGroup, reduce, migrate, activeItems, rankItems, searchItems, costs } from '../js/state.js';
import { AppStore } from '../js/store.js';
let n = 0;
const initial = () => newGroup({ id: 'g', code: 'ABCD', name: 'Group', memberId: 'host', memberName: 'Host', roundId: 'r' });
const act = (s, type, payload, senderId = 'host') => reduce(s, { id: `a${++n}`, type, payload, senderId, roundId: s.round.id });
function populated() {
  let s = initial();
  s = act(s, 'menu.create', { id: 'cafe', name: 'Chai stall' });
  s = act(s, 'menu.create', { id: 'meal', name: 'Meal place' });
  s = act(s, 'menu.upsert', { id: 'chai', menuId: 'cafe', name: 'Chai', price: 2000, category: 'Tea' });
  s = act(s, 'menu.upsert', { id: 'rice', menuId: 'meal', name: 'Rice', price: 8000, category: 'Meal' });
  return s;
}
test('new groups have neither default menus nor items', () => {
  const s = initial(); assert.deepEqual(s.menus, []); assert.deepEqual(s.menu, []); assert.equal(s.activeMenuId, null);
});
test('legacy migration preserves item IDs, picks, currency and history without mutation', () => {
  const old = populated(); delete old.menus; delete old.activeMenuId;
  for (const i of old.menu) delete i.menuId;
  old.group.currency = '₹'; old.picks = [{ memberId: 'host', itemId: 'chai', qty: 2, note: 'less sugar' }];
  const before = JSON.stringify(old), next = migrate(old);
  assert.equal(JSON.stringify(old), before); assert.equal(next.menus[0].name, 'Menu');
  assert.equal(next.menu[0].id, 'chai'); assert.deepEqual(next.picks, old.picks); assert.equal(next.group.currency, '₹');
  assert.equal(activeItems(next).length, 2); assert.strictEqual(migrate(next), next);
});
test('only round menu items can be picked and switching clears old picks', () => {
  let s = populated();
  assert.equal(s.activeMenuId, 'cafe');
  s = act(s, 'pick.set', { itemId: 'chai', qty: 1, note: '' });
  assert.throws(() => act(s, 'pick.set', { itemId: 'rice', qty: 1, note: '' }), /menu/);
  s = act(s, 'member.join', { id: 'guest', name: 'Guest' });
  assert.throws(() => act(s, 'menu.activate', { id: 'meal' }, 'guest'), /orderer/);
  assert.throws(() => act(s, 'menu.remove', { id: 'cafe' }, 'guest'), /orderer/);
  s = act(s, 'menu.activate', { id: 'meal' });
  assert.equal(s.picks.length, 0); assert.equal(activeItems(s)[0].id, 'rice');
});
test('locked round freezes its menu and switching but other menus stay editable', () => {
  let s = act(populated(), 'order.lock', {});
  assert.throws(() => act(s, 'menu.activate', { id: 'meal' }), /locked/);
  assert.throws(() => act(s, 'menu.remove', { id: 'cafe' }), /locked/);
  assert.throws(() => act(s, 'menu.delete', { id: 'chai' }), /locked/);
  s = act(s, 'menu.upsert', { id: 'rice', menuId: 'meal', name: 'Rice', price: 9000, category: 'Meal' });
  assert.equal(s.menu.find(i => i.id === 'rice').price, 9000);
});
test('round snapshot has its menu name and no other shop items; deletion preserves history', () => {
  let s = act(populated(), 'pick.set', { itemId: 'chai', qty: 1, note: '' });
  s = act(s, 'order.lock', {});
  s = act(s, 'round.finish', { nextRoundId: 'r2', date: '2026-11-12T12:00:00Z' });
  assert.equal(s.history[0].menuName, 'Chai stall'); assert.equal(s.history[0].menu.length, 1);
  s = act(s, 'menu.remove', { id: 'cafe' });
  assert.equal(s.history[0].menu[0].name, 'Chai'); assert.equal(s.activeMenuId, 'meal');
});
test('moving an existing item cannot strand its picks in another menu', () => {
  const s = populated();
  assert.throws(() => act(s, 'menu.upsert', { id: 'chai', menuId: 'meal', name: 'Chai', price: 2000, category: 'Tea' }), /cannot be moved/);
});
test('same names in different menus do not overwrite each other; presets are opt-in', async () => {
  const app = new AppStore(); app.db = { save: async () => {} };
  app.startRoom = () => {}; await app.create('Group', 'Host', { starter: false });
  assert.equal(app.data.state.menus.length, 0);
  const a = await app.importMenu([{ name: 'Chai', category: 'Tea', price: 2000 }], { title: 'Stall A' });
  const b = await app.importMenu([{ name: 'Chai', category: 'Tea', price: 3000 }], { title: 'Stall B' });
  assert.notEqual(a.menuId, b.menuId);
  await app.importMenu([{ name: 'Chai', category: 'Tea', price: 2500 }], { menuId: a.menuId });
  assert.deepEqual(app.data.state.menu.map(i => i.price), [2500, 3000]);
  await app.presets(a.menuId);
  assert.equal(app.data.state.menu.find(i => i.menuId === a.menuId && i.name === 'Chai').price, 2500);
});
test('items sort by declared popularity plus past orders, and search filters by name', () => {
  let s = initial();
  s = act(s, 'menu.create', { id: 'm', name: 'Basic' });
  s = act(s, 'menu.upsert', { id: 'snack', menuId: 'm', name: 'Snack', price: 0, category: 'Snacks', popularity: 60 });
  s = act(s, 'menu.upsert', { id: 'tea', menuId: 'm', name: 'Tea', price: 0, category: 'Tea', popularity: 100 });
  s = act(s, 'menu.upsert', { id: 'lime', menuId: 'm', name: 'Lime Tea', price: 0, category: 'Tea', popularity: 70 });
  assert.throws(() => act(s, 'menu.upsert', { id: 'x', menuId: 'm', name: 'X', price: 0, category: 'Tea', popularity: -1 }), /valid/);
  assert.deepEqual(rankItems(s, activeItems(s)).map(i => i.id), ['tea', 'lime', 'snack']);
  // Editing without popularity keeps it.
  s = act(s, 'menu.upsert', { id: 'snack', menuId: 'm', name: 'Snack', price: 0, category: 'Snacks' });
  assert.equal(s.menu.find(i => i.id === 'snack').popularity, 60);
  s = act(s, 'pick.set', { itemId: 'snack', qty: 5, note: 'samosa' });
  s = act(s, 'order.lock', {});
  s = act(s, 'round.finish', { nextRoundId: 'r2', date: '2026-11-13T10:00:00Z' });
  assert.deepEqual(rankItems(s, activeItems(s)).map(i => i.id), ['snack', 'tea', 'lime']);
  assert.deepEqual(searchItems(activeItems(s), 'TEA').map(i => i.id), ['tea', 'lime']);
  assert.deepEqual(searchItems(activeItems(s), 'lime te').map(i => i.id), ['lime']);
});
test('host declares prices while locked, until the bill is entered', () => {
  let s = initial();
  s = act(s, 'menu.create', { id: 'm', name: 'Basic' });
  s = act(s, 'menu.upsert', { id: 'tea', menuId: 'm', name: 'Tea', price: 0, category: 'Tea' });
  s = act(s, 'member.join', { id: 'guest', name: 'Guest' });
  s = act(s, 'pick.set', { itemId: 'tea', qty: 2, note: '' }, 'guest');
  s = act(s, 'order.lock', {});
  assert.throws(() => act(s, 'item.price', { prices: [{ id: 'tea', price: 1500 }] }, 'guest'), /host or orderer/);
  s = act(s, 'item.price', { prices: [{ id: 'tea', price: 1500 }] });
  assert.equal(costs(s).estimatedTotal, 3000);
  s = act(s, 'bill.set', { actualTotal: 3000, splitMode: 'equal' });
  assert.throws(() => act(s, 'item.price', { prices: [{ id: 'tea', price: 2000 }] }), /Unlock/);
});
test('a new session wipes the group and starts again with the basic menu', async () => {
  const app = new AppStore(); app.db = { save: async () => {} };
  app.startRoom = () => {}; await app.create('Group', 'Host');
  const old = app.data.state;
  await app.dispatch('menu.upsert', { id: 'x', menuId: old.activeMenuId, name: 'Extra', price: 500, category: 'Other' });
  await app.newSession('Fresh');
  const s = app.data.state;
  assert.notEqual(s.group.id, old.group.id); assert.equal(s.group.name, 'Fresh');
  assert.equal(s.menus.length, 1); assert.equal(s.menu.length, 6);
  assert.ok(s.menu.every(i => i.price === 0)); assert.equal(s.history.length, 0);
});
