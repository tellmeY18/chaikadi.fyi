import test from 'node:test';
import assert from 'node:assert/strict';
import { AppStore } from '../js/store.js';
import { newGroup, reduce, archiveSession, addArchive, isStale, SESSION_ARCHIVE_LIMIT } from '../js/state.js';
import { SESSION_TTL_MS } from '../js/config.js';

let n = 0;
const act = (s, type, payload = {}, senderId = 'host') => reduce(s, { id: `a${++n}`, type, payload, senderId, roundId: s.round.id });
function session({ picks = true } = {}) {
  let s = newGroup({ id: 'g1', code: 'ABCD', name: 'Chai Gang', memberId: 'host', memberName: 'Anu', roundId: 'r1' });
  s = act(s, 'menu.create', { id: 'm', name: 'Stall' });
  s = act(s, 'member.join', { id: 'guest', name: 'Bala' });
  s = act(s, 'menu.upsert', { id: 'tea', name: 'Tea', price: 1000, category: 'Tea' });
  if (picks) { s = act(s, 'pick.set', { itemId: 'tea', qty: 2, note: '' }, 'guest'); }
  return s;
}
async function store(state) {
  const app = new AppStore();
  app.db = { save: async () => {} };
  app.network.stop = () => {};
  Object.assign(app.data, { state, role: 'host', targetCode: 'ABCD', lastActive: 0 });
  return app;
}

test('idle check: stale only after the TTL', () => {
  const t = 1_000_000;
  assert.ok(!isStale(t, t + SESSION_TTL_MS, SESSION_TTL_MS));
  assert.ok(isStale(t, t + SESSION_TTL_MS + 1, SESSION_TTL_MS));
  assert.ok(!isStale(undefined, t, SESSION_TTL_MS));
});

test('archiving finishes the open round with whatever was entered', () => {
  const s = session(), before = JSON.stringify(s);
  const entry = archiveSession(s, { endedAt: Date.parse('2026-11-21T09:00:00Z'), archivedAt: Date.parse('2026-11-21T11:30:00Z') });
  assert.equal(JSON.stringify(s), before, 'input untouched');
  assert.equal(entry.name, 'Chai Gang'); assert.equal(entry.unfinished, true);
  assert.equal(entry.endedAt, '2026-11-21T09:00:00.000Z'); assert.equal(entry.archivedAt, '2026-11-21T11:30:00.000Z');
  const [round] = entry.rounds;
  assert.equal(round.date, entry.endedAt); assert.equal(round.picks.length, 1);
  assert.equal(round.amounts.find(a => a.id === 'guest').owed, 2000);
  assert.deepEqual(round.payments, {});
});

test('archiving keeps finished rounds and skips empty sessions', () => {
  let s = session();
  s = act(act(s, 'order.lock'), 'round.finish', { nextRoundId: 'r2', date: '2026-11-21T08:00:00.000Z' });
  const entry = archiveSession(s, { endedAt: Date.now() });
  assert.equal(entry.rounds.length, 1); assert.equal(entry.unfinished, false);
  assert.equal(archiveSession(session({ picks: false }), { endedAt: Date.now() }), null);
  assert.equal(archiveSession(null, { endedAt: Date.now() }), null);
});

test('archive list is newest first, de-duplicated and capped', () => {
  let list = [];
  for (let i = 0; i < SESSION_ARCHIVE_LIMIT + 5; i++) list = addArchive(list, { id: `s${i}` });
  assert.equal(list.length, SESSION_ARCHIVE_LIMIT); assert.equal(list[0].id, `s${SESSION_ARCHIVE_LIMIT + 4}`);
  assert.equal(addArchive(list, { id: 's40' }).filter(e => e.id === 's40').length, 1);
  assert.equal(addArchive(list, null), list);
});

test('opening after more than an hour archives the session, resets it and says so', async () => {
  const app = await store(session());
  app.data.identity.name = 'Anu';
  const last = Date.now() - SESSION_TTL_MS - 60_000;
  assert.equal(await app.expireIfStale(Date.now(), last), true);
  assert.equal(app.data.state, null); assert.equal(app.data.role, null);
  assert.equal(app.data.archive.length, 1); assert.equal(app.data.archive[0].name, 'Chai Gang');
  assert.deepEqual(app.data.archiveNotice, { id: app.data.archive[0].id, name: 'Chai Gang', rounds: 1, unfinished: true });
  assert.equal(app.data.identity.name, 'Anu', 'name survives');
});

test('within the hour nothing is archived; an empty stale session is dropped quietly', async () => {
  const app = await store(session());
  assert.equal(await app.expireIfStale(Date.now(), Date.now() - SESSION_TTL_MS + 60_000), false);
  assert.ok(app.data.state);
  const empty = await store(session({ picks: false }));
  assert.equal(await empty.expireIfStale(Date.now(), 1), true);
  assert.equal(empty.data.archive.length, 0); assert.equal(empty.data.archiveNotice, null);
});

test('leaving a group also keeps its history; name and UPI survive', async () => {
  const app = await store(session());
  app.data.profile.upi = 'anu@ybl'; app.data.identity.name = 'Anu';
  await app.leave();
  assert.equal(app.data.archive.length, 1); assert.equal(app.data.state, null);
  assert.equal(app.data.profile.upi, 'anu@ybl'); assert.equal(app.data.identity.name, 'Anu');
});

test('UPI profile: validated, stored on the member, clearable, kept in round history', () => {
  let s = session();
  assert.throws(() => act(s, 'member.upi', { upi: 'nope' }), /UPI/);
  s = act(s, 'member.upi', { upi: ' Anu@YBL ' });
  assert.equal(s.members.find(m => m.id === 'host').upi, 'anu@ybl');
  assert.equal(s.members.find(m => m.id === 'guest').upi, undefined, 'only your own record changes');
  const finished = act(act(s, 'order.lock'), 'round.finish', { nextRoundId: 'r2', date: '2026-11-21T08:00:00.000Z' });
  assert.equal(finished.history[0].members.find(m => m.id === 'host').upi, 'anu@ybl');
  assert.equal(act(s, 'member.upi', { upi: '' }).members.find(m => m.id === 'host').upi, undefined);
});

test('saveProfile validates, persists and pushes the UPI ID into the group', async () => {
  const app = await store(session());
  app.data.identity.id = 'host';
  await assert.rejects(app.saveProfile({ name: 'Anu', upi: 'bad' }), /UPI/);
  await app.saveProfile({ name: 'Anu K', upi: 'Anu@ybl' });
  assert.equal(app.data.profile.upi, 'anu@ybl');
  const me = app.data.state.members.find(m => m.id === 'host');
  assert.equal(me.name, 'Anu K'); assert.equal(me.upi, 'anu@ybl');
});

test('scan-to-approve: a proposal changes nothing until the owner approves it', () => {
  let s = session();
  s = act(s, 'upi.propose', { forId: 'host', upi: ' Anu@YBL ', name: 'Anu K' }, 'guest');
  assert.deepEqual(s.upiProposals, [{ forId: 'host', upi: 'anu@ybl', name: 'Anu K', byId: 'guest' }]);
  assert.equal(s.members.find(m => m.id === 'host').upi, undefined, 'not set yet');
  assert.throws(() => act(s, 'upi.decide', { approve: true, upi: 'anu@ybl' }, 'guest'), /Nothing to approve/, 'only the owner can decide');
  assert.throws(() => act(s, 'upi.decide', { approve: true, upi: 'other@ybl' }, 'host'), /changed/);
  const approved = act(s, 'upi.decide', { approve: true, upi: 'anu@ybl' }, 'host');
  assert.equal(approved.members.find(m => m.id === 'host').upi, 'anu@ybl'); assert.deepEqual(approved.upiProposals, []);
  const rejected = act(s, 'upi.decide', { approve: false }, 'host');
  assert.equal(rejected.members.find(m => m.id === 'host').upi, undefined); assert.deepEqual(rejected.upiProposals, []);
});

test('proposals are validated, replaced per person, and dropped with a removed member', () => {
  let s = session();
  assert.throws(() => act(s, 'upi.propose', { forId: 'host', upi: 'nope' }, 'guest'), /not a UPI/);
  assert.throws(() => act(s, 'upi.propose', { forId: 'host', upi: 'a1@ybl' }, 'host'), /someone else/);
  assert.throws(() => act(s, 'upi.propose', { forId: 'ghost', upi: 'a1@ybl' }, 'guest'), /someone else/);
  s = act(s, 'upi.propose', { forId: 'host', upi: 'first@ybl' }, 'guest');
  s = act(s, 'upi.propose', { forId: 'host', upi: 'second@ybl' }, 'guest');
  assert.deepEqual(s.upiProposals.map(x => x.upi), ['second@ybl']);
  assert.deepEqual(act(s, 'member.remove', { id: 'guest' }).upiProposals, []);
  assert.deepEqual(act(s, 'member.upi', { upi: 'mine@ybl' }, 'host').upiProposals, [], 'setting it yourself clears the proposal');
});

test('approving persists the ID on the owner device and survives later syncs', async () => {
  const app = await store(act(session(), 'upi.propose', { forId: 'host', upi: 'anu@ybl', name: 'Anu' }, 'guest'));
  app.data.identity.id = 'host';
  assert.equal(app.proposalForMe().upi, 'anu@ybl');
  await app.decideUpi(true);
  assert.equal(app.data.profile.upi, 'anu@ybl');
  assert.equal(app.data.state.members.find(m => m.id === 'host').upi, 'anu@ybl');
  await app.saveProfile({ name: 'Anu' });
  assert.equal(app.data.profile.upi, 'anu@ybl', 'saving the name alone keeps the ID');
  await app.saveProfile({ name: 'Anu', upi: '' });
  assert.equal(app.data.state.members.find(m => m.id === 'host').upi, undefined, 'an explicit save can clear it');
});
