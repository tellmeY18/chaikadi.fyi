import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAI, TIERS, chaiEnabled, shouldAsk, afterAsk, countRound, addCups, memberLevel, nextLevel, cleanChai, setNever, chaiLink } from '../js/chai.js';

const cfg = { upi: 'maker@upi', name: 'Chaikadi' };
const rounds = n => { let c = null; for (let i = 0; i < n; i++) c = countRound(c); return c; };

test('nothing shows until a valid UPI ID is set', () => {
  assert.equal(chaiEnabled(CHAI), CHAI.upi !== '');
  assert.equal(chaiEnabled({ upi: '' }), false);
  assert.equal(shouldAsk(rounds(5), '2026-01-01', { upi: '' }), false);
  assert.equal(chaiLink(TIERS[0], { upi: '' }), null);
});

test('asks only after the third finished round', () => {
  assert.equal(shouldAsk(rounds(2), '2026-01-01', cfg), false);
  assert.equal(shouldAsk(rounds(3), '2026-01-01', cfg), true);
});

test('Not now and paying both pause the prompt', () => {
  const later = afterAsk(rounds(3), 'later', '2026-01-01');
  assert.equal(shouldAsk(later, '2026-01-15', cfg), false);
  assert.equal(shouldAsk(later, '2026-01-31', cfg), true);
  const paid = afterAsk(rounds(3), 'paid', '2026-01-01');
  assert.equal(shouldAsk(paid, '2026-02-15', cfg), false);
  assert.equal(shouldAsk(paid, '2026-04-02', cfg), true);
});

test("Don't ask again is respected forever, until switched back on in Settings", () => {
  const never = afterAsk(rounds(10), 'never', '2026-01-01');
  assert.equal(shouldAsk(never, '2030-01-01', cfg), false);
  assert.equal(shouldAsk(afterAsk(never, 'later', '2026-01-01'), '2030-01-01', cfg), false);
  assert.equal(shouldAsk(setNever(never, false), '2030-01-01', cfg), true);
});

test('cups add up to member levels', () => {
  assert.equal(memberLevel(0), null);
  assert.equal(memberLevel(1), 'friend');
  assert.equal(memberLevel(addCups(addCups(null, 2), 1).cups), 'regular');
  assert.equal(nextLevel(3).id, 'member');
  assert.equal(nextLevel(12), null);
});

test('stored preferences are cleaned', () => {
  assert.deepEqual(cleanChai({ rounds: -1, cups: 'x', never: 'yes', quietUntil: 'soon' }), { rounds: 0, cups: 0, never: false, quietUntil: null });
});

test('the pay link carries payee, exact amount and note', () => {
  const link = chaiLink(TIERS[1], cfg);
  assert.match(link, /^upi:\/\/pay\?pa=maker@upi&pn=Chaikadi&am=30\.00&cu=INR&tn=/);
});

import { parseTreat, cupsFor } from '../js/chai.js';
test('a custom treat is one line: name and amount', () => {
  assert.deepEqual(parseTreat('biriyani 300'), { name: 'Biriyani', amount: 30000, cups: 10 });
  assert.equal(parseTreat('Samosa 15').amount, 1500);
  assert.equal(parseTreat('biriyani'), null);
  assert.equal(parseTreat('300'), null);
  assert.equal(parseTreat('Feast 99999999'), null);
  assert.equal(cupsFor(500), 1);
  assert.equal(chaiLink({ amount: 30000 }, cfg, 'Biriyani').includes('am=300.00'), true);
});
