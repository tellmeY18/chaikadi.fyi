import test from 'node:test';
import assert from 'node:assert/strict';
import { planRound, afterSheet, checkReason, cleanHistory, emptyHistory, addDays, RULES } from '../js/prompts.js';

const D = '2026-11-14';
const fresh = { status: 'confirmed', last: '2026-11-10' };
const source = { placeId: 'es-01m7bhqy50d2k939m5g5k824xx' };
const base = (over = {}) => ({ isOrderer: true, sharing: true, source, date: D, history: emptyHistory(), soldOut: [],
  items: [{ name: 'Chai', price: 1200, before: 1200, fact: fresh }], ...over });
const kinds = plan => plan?.prices.map(p => `${p.name}:${p.kind}`);

test('nothing is asked when Eatsights already knows: confirmed and fresh', () => {
  assert.equal(planRound(base()).plan, null);
});

test('who and where: only the orderer, sharing on, an Eatsights non-sample menu', () => {
  const items = [{ name: 'Chai', price: 1200, before: 1000, fact: fresh }];
  assert.ok(planRound(base({ items })).plan, 'orderer with a changed price is asked');
  assert.equal(planRound(base({ items, isOrderer: false })).plan, null, 'members are never asked');
  assert.equal(planRound(base({ items, sharing: false })).plan, null, 'sharing off');
  assert.equal(planRound(base({ items, source: null })).plan, null, 'hand-made or old-library menu');
  assert.equal(planRound(base({ items, source: { ...source, sample: true } })).plan, null, 'sample stall');
});

test('check reasons: contested, unconfirmed, stale, old confirmed, missing', () => {
  assert.equal(checkReason(fresh, D), null);
  assert.equal(checkReason({ status: 'confirmed', last: addDays(D, -(RULES.freshDays + 1)) }, D), 'old');
  assert.equal(checkReason({ status: 'confirmed', last: addDays(D, -RULES.freshDays) }, D), null, 'exactly 14 days is still fresh');
  for (const s of ['contested', 'unconfirmed', 'stale']) assert.equal(checkReason({ status: s }, D), s);
  assert.equal(checkReason(undefined, D), 'new');
});

test('changed and new prices are always included; uncertain checks are capped at 3, contested first', () => {
  const items = [
    { name: 'Chai', price: 1400, before: 1200, fact: fresh },
    { name: 'Vada', price: 1000 },
    { name: 'A', price: 100, before: 100, fact: { status: 'stale' } },
    { name: 'B', price: 100, before: 100, fact: { status: 'unconfirmed' } },
    { name: 'C', price: 100, before: 100, fact: { status: 'contested' } },
    { name: 'D', price: 100, before: 100, fact: { status: 'confirmed', last: '2026-01-01' } },
    { name: 'Free', price: 0, fact: { status: 'unconfirmed' } },
  ];
  const { plan } = planRound(base({ items }));
  assert.deepEqual(kinds(plan), ['Chai:changed', 'Vada:new', 'C:contested', 'B:unconfirmed', 'A:stale']);
  assert.equal(plan.prices[0].before, 1200);
  assert.equal(plan.wait, true);
});

test('sold-out marks alone open the sheet', () => {
  const { plan } = planRound(base({ soldOut: ['Chai'] }));
  assert.deepEqual(plan.soldOut, ['Chai']);
  assert.deepEqual(plan.prices, []);
});

test('the same item at the same stall is not checked again within 14 days', () => {
  const items = [{ name: 'Chai', price: 1200, before: 1200, fact: { status: 'unconfirmed' } }];
  const first = planRound(base({ items }));
  const history = afterSheet(first.history, first.plan, 'sent', D);
  assert.equal(planRound(base({ items, history, date: addDays(D, 13) })).plan, null);
  assert.ok(planRound(base({ items, history, date: addDays(D, 14) })).plan);
  const other = planRound(base({ items, history, source: { placeId: 'es-01m7cr6pz5ghva671370k4e27f' }, date: addDays(D, 1) }));
  assert.ok(other.plan, 'another stall is asked');
  // A changed price is never held back by the cool-down.
  assert.ok(planRound(base({ items: [{ ...items[0], price: 1500 }], history, date: addDays(D, 1) })).plan);
});

test('three skips in a row pause asking for 14 days; user-made changes wait for the next sheet', () => {
  const ask = date => base({ date, items: [{ name: 'Chai', price: 1200, before: 1200, fact: { status: 'stale' } }, { name: `Tea ${date}`, price: 800, before: 800, fact: { status: 'unconfirmed' } }] });
  let history = emptyHistory();
  for (let i = 0; i < 3; i++) {
    const r = planRound({ ...ask(addDays(D, i * 20)), history });
    assert.ok(r.plan, `round ${i + 1} asks`);
    history = afterSheet(r.history, r.plan, 'skipped', addDays(D, i * 20));
  }
  const pausedFrom = addDays(D, 40);
  assert.equal(history.quietUntil, addDays(pausedFrom, 14));
  assert.equal(history.skips, 0);
  // During the pause: nothing asked, but the orderer's own change is kept.
  const quiet = planRound(base({ date: addDays(pausedFrom, 3), history, items: [{ name: 'Chai', price: 1500, before: 1200, fact: fresh }], soldOut: ['Vada'] }));
  assert.equal(quiet.plan, null);
  assert.deepEqual(quiet.history.pending[source.placeId].changes.map(c => c.price), [1500]);
  // After the pause the kept change comes back once, even with nothing new.
  const back = planRound(base({ date: addDays(pausedFrom, 14), history: quiet.history }));
  assert.deepEqual(kinds(back.plan), ['Chai:changed']);
  assert.deepEqual(back.plan.soldOut, ['Vada']);
  const cleared = afterSheet(back.history, back.plan, 'sent', addDays(pausedFrom, 14));
  assert.equal(cleared.pending[source.placeId], undefined);
  const later = addDays(pausedFrom, 15);
  assert.equal(planRound(base({ date: later, history: cleared, items: [{ name: 'Chai', price: 1500, before: 1500, fact: { status: 'confirmed', last: later } }] })).plan, null);
});

test('sending resets the skip count', () => {
  const items = [{ name: 'Chai', price: 1200, before: 1000, fact: fresh }];
  let history = emptyHistory();
  for (const outcome of ['skipped', 'skipped', 'sent', 'skipped', 'skipped']) {
    const r = planRound(base({ items, history }));
    history = afterSheet(r.history, r.plan, outcome, D);
  }
  assert.equal(history.quietUntil, null);
  assert.equal(history.skips, 2);
});

test('rating is offered at most once a week per stall', () => {
  const items = [{ name: 'Chai', price: 1200, before: 1000, fact: fresh }];
  const first = planRound(base({ items }));
  assert.deepEqual(first.plan.rate, ['Chai']);
  const history = afterSheet(first.history, first.plan, 'skipped', D);
  assert.deepEqual(planRound(base({ items, history, date: addDays(D, 6) })).plan.rate, []);
  assert.deepEqual(planRound(base({ items, history, date: addDays(D, 7) })).plan.rate, ['Chai']);
});

test('stored history is cleaned before use', () => {
  const h = cleanHistory({ skips: 99, quietUntil: 'soon', asked: { a: '2026-11-01', b: 5 }, rated: null, pending: { x: { changes: [{ name: 'Chai', price: 'free' }], soldOut: ['Vada', 3] } } });
  assert.deepEqual(h, { skips: RULES.skipLimit, quietUntil: null, asked: { a: '2026-11-01' }, rated: {}, pending: { x: { changes: [], soldOut: ['Vada'] } } });
});
