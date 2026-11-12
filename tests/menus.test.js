import test from 'node:test';
import assert from 'node:assert/strict';
import { newGroup, reduce, migrate, activeItems } from '../js/state.js';
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
  await app.create('Group', 'Host', true);
  assert.equal(app.data.state.menus.length, 0);
  const a = await app.importMenu([{ name: 'Chai', category: 'Tea', price: 2000 }], { title: 'Stall A' });
  const b = await app.importMenu([{ name: 'Chai', category: 'Tea', price: 3000 }], { title: 'Stall B' });
  assert.notEqual(a.menuId, b.menuId);
  await app.importMenu([{ name: 'Chai', category: 'Tea', price: 2500 }], { menuId: a.menuId });
  assert.deepEqual(app.data.state.menu.map(i => i.price), [2500, 3000]);
  await app.presets(a.menuId);
  assert.equal(app.data.state.menu.find(i => i.menuId === a.menuId && i.name === 'Chai').price, 2500);
});
