import test from 'node:test';
import assert from 'node:assert/strict';
import { newGroup, reduce, costs, debts, Persistence } from '../js/state.js';
import { validCode, roomCode, validateConfig, DEFAULT_CONFIG } from '../js/config.js';
import { encodePairing, decodePairing, compatibilityPairing } from '../js/p2p.js';

let n = 0;
const initial = () => newGroup({ id: 'group', code: 'ABCD', name: 'Tea crew', memberId: 'host', memberName: 'Anu', roundId: 'round1' });
const action = (s, type, payload = {}, senderId = 'host', extra = {}) => reduce(s, {
  id: `action-${++n}`, type, payload, senderId, roundId: s.round.id, ...extra,
});
function populated(prices = [1000, 2000]) {
  let s = initial();
  s = action(s, 'member.join', { id: 'guest', name: 'Bala' });
  for (const [index, price] of prices.entries()) {
    s = action(s, 'menu.upsert', { id: `item${index}`, name: `Chai ${index}`, price, category: 'Tea' });
    s = action(s, 'pick.set', { itemId: `item${index}`, qty: 1, note: index ? 'less sugar' : '' }, index ? 'guest' : 'host');
  }
  return s;
}
const billed = (s, total, splitMode) => action(action(s, 'order.lock'), 'bill.set', { actualTotal: total, splitMode });

test('room codes use only the unambiguous alphabet', () => {
  for (let i = 0; i < 1000; i++) assert.ok(validCode(roomCode()));
  for (const bad of ['A0CD', 'AOCD', 'A1CD', 'AICD', 'ALCD', 'abcD', 'ABCDE']) assert.equal(validCode(bad), false);
});
test('reducer does not mutate input and replaying the same ID is a no-op', () => {
  const s = initial(), original = JSON.stringify(s);
  const intent = { id: 'one', type: 'menu.upsert', senderId: 'host', payload: { id: 'chai', name: 'Chai', price: 2500, category: 'Tea' } };
  const next = reduce(s, intent);
  assert.equal(JSON.stringify(s), original);
  assert.equal(next.group.version, s.group.version + 1);
  assert.strictEqual(reduce(next, intent), next);
});
test('name conflicts normalize Unicode and case, capacity is 15', () => {
  let s = initial();
  assert.throws(() => action(s, 'member.join', { id: 'x', name: 'ＡＮＵ' }), /taken/);
  for (let i = 1; i < 15; i++) s = action(s, 'member.join', { id: `m${i}`, name: `Member ${i}` });
  assert.throws(() => action(s, 'member.join', { id: 'overflow', name: 'Sixteen' }), /full/);
});
test('host/orderer permissions and member-own picks are enforced', () => {
  let s = populated();
  assert.throws(() => action(s, 'order.lock', {}, 'guest'), /orderer/);
  assert.throws(() => action(s, 'member.remove', { id: 'host' }, 'guest'), /host/);
  assert.throws(() => action(s, 'group.currency', { currency: '$' }, 'guest'), /host/);
  s = action(s, 'pick.set', { memberId: 'host', itemId: 'item0', qty: 2, note: '' }, 'guest');
  assert.equal(s.picks.find(p => p.memberId === 'host').qty, 1);
  assert.equal(s.picks.find(p => p.memberId === 'guest' && p.itemId === 'item0').qty, 2);
  s = action(s, 'orderer.set', { id: 'guest' });
  assert.equal(action(s, 'order.lock', {}, 'guest').group.status, 'locked');
});
test('locking freezes picks AND menu; unlock clears bill/payment marks', () => {
  let s = billed(populated(), 3600, 'equal');
  s = action(s, 'payment.set', { id: 'guest', paid: true });
  assert.throws(() => action(s, 'pick.set', { itemId: 'item0', qty: 2, note: '' }), /locked/);
  assert.throws(() => action(s, 'menu.delete', { id: 'item0' }), /locked/);
  assert.throws(() => action(s, 'menu.upsert', { id: 'item0', name: 'Tea', price: 999, category: 'Tea' }), /locked/);
  s = action(s, 'order.unlock');
  assert.equal(s.round.actualTotal, null); assert.deepEqual(s.round.payments, {});
});
test('invalid prices, quantities, notes and categories are rejected', () => {
  const s = populated();
  for (const price of [-1, 0.1, NaN, Infinity, 100000001]) assert.throws(() => action(s, 'menu.upsert', { id: 'x', name: 'X', price, category: 'Tea' }));
  for (const qty of [-1, 1.5, 100]) assert.throws(() => action(s, 'pick.set', { itemId: 'item0', qty, note: '' }));
  assert.throws(() => action(s, 'pick.set', { itemId: 'gone', qty: 1, note: '' }), /removed/);
  assert.throws(() => action(s, 'pick.set', { itemId: 'item0', qty: 1, note: 'x'.repeat(161) }), /160/);
});
test('equal difference and proportional difference have the intended meaning', () => {
  const equal = costs(billed(populated(), 3600, 'equal'));
  assert.deepEqual(equal.people.map(p => p.owed), [1300, 2300]);
  const proportional = costs(billed(populated(), 3600, 'proportional'));
  assert.deepEqual(proportional.people.map(p => p.owed), [1200, 2400]);
});
test('rounding, discounts, zero prices and nonparticipants conserve every cent', () => {
  for (const prices of [[1000, 2000], [1, 9999], [0, 0], [0, 2000], [1, 1]]) {
    let s = populated(prices);
    s = action(s, 'member.join', { id: 'nopicks', name: 'Not hungry' });
    for (const mode of ['equal', 'proportional']) for (const total of [0, 1, 2, 3, 10, 99, 1001, 3001, 500001]) {
      const result = costs(billed(s, total, mode));
      assert.equal(result.people.reduce((sum, p) => sum + p.owed, 0), total, `${prices}/${mode}/${total}`);
      assert.ok(result.people.every(p => Number.isInteger(p.owed) && p.owed >= 0));
      assert.equal(result.people.find(p => p.id === 'nopicks').owed, 0);
    }
  }
});
test('deleting an item removes picks; removing orderer reassigns host', () => {
  let s = populated();
  s = action(s, 'menu.delete', { id: 'item0' });
  assert.ok(s.picks.every(p => p.itemId !== 'item0'));
  s = action(s, 'orderer.set', { id: 'guest' }); s = action(s, 'member.remove', { id: 'guest' });
  assert.equal(s.group.ordererId, 'host'); assert.equal(s.picks.length, 0);
});
test('finish archives immutable snapshots and stale round intents are rejected', () => {
  let s = billed(populated(), 3600, 'equal');
  const intent = { id: 'stale', type: 'pick.set', payload: { itemId: 'item0', qty: 7, note: '' }, senderId: 'host', roundId: s.round.id };
  s = action(s, 'round.finish', { date: '2026-11-12T12:00:00Z', nextRoundId: 'round2' });
  assert.equal(s.history[0].actualTotal, 3600); assert.equal(s.history[0].picks.length, 2);
  assert.equal(s.picks.length, 0); assert.equal(s.menu.length, 2); assert.equal(s.members.length, 2);
  assert.throws(() => reduce(s, intent), /finished/);
  const historyBefore = JSON.stringify(s.history);
  s = action(s, 'menu.upsert', { id: 'item0', name: 'New tea', price: 50, category: 'Tea' });
  assert.equal(JSON.stringify(s.history), historyBefore);
});
test('debt tallies use archived orderer and currency and allow later settlement', () => {
  let s = billed(populated(), 3600, 'equal');
  s = action(s, 'round.finish', { date: '2026-11-12T12:00:00Z', nextRoundId: 'round2' });
  assert.deepEqual(debts(s), [{ name: 'Bala', orderer: 'Anu', currency: '₹', amount: 2300 }]);
  s = action(s, 'orderer.set', { id: 'guest' });
  assert.throws(() => action(s, 'history.payment', { roundId: 'round1', id: 'guest', paid: true }, 'guest'), /round’s orderer/);
  s = action(s, 'history.payment', { roundId: 'round1', id: 'guest', paid: true });
  assert.deepEqual(debts(s), []);
});
test('pairing text roundtrips compressed and compatibility formats', async () => {
  const value = { v: 1, id: 'pair-id', type: 'offer', sdp: 'v=0\r\n' + 'a=candidate:local\r\n'.repeat(40) };
  assert.deepEqual(await decodePairing(await encodePairing(value)), value);
  assert.deepEqual(await decodePairing(compatibilityPairing(value)), value);
  await assert.rejects(decodePairing('not a code'), /not a Chaikadi/);
});
test('connection config rejects unsafe/wrongly shaped settings', () => {
  assert.equal(validateConfig(DEFAULT_CONFIG), DEFAULT_CONFIG);
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, signaling: { ...DEFAULT_CONFIG.signaling, secure: false } }));
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, iceServers: [{ urls: 'https://example.com' }] }));
});
test('localStorage fallback survives reload and reports quota failures', async () => {
  const map = new Map(), previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: k => map.get(k) || null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
  try {
    const warnings = [], db = await new Persistence(m => warnings.push(m)).open();
    await db.save({ state: populated(), outbox: [{ id: 'pending' }] });
    const restored = await new Persistence().load();
    assert.equal(restored.state.group.name, 'Tea crew'); assert.equal(restored.outbox[0].id, 'pending');
    globalThis.localStorage.setItem = () => { throw new Error('Quota'); };
    await assert.rejects(db.save(restored), /save failed/);
    assert.ok(warnings.some(m => m.includes('memory only')));
  } finally { globalThis.localStorage = previous; }
});
