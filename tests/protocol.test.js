import test from 'node:test';
import assert from 'node:assert/strict';
import { AppStore } from '../js/store.js';
import { uid, PROTOCOL_VERSION } from '../js/config.js';

async function host() {
  const app = new AppStore();
  app.db = { save: async () => {} };
  app.startRoom = () => {}; await app.create('Crew', 'Host');
  await app.newMenu('Test menu');
  app.sent = [];
  app.network.send = (link, message) => { app.sent.push({ link, message }); return true; };
  return app;
}
async function join(app, id = uid(), token = uid(), name = 'Guest') {
  const link = { id: uid(), mode: 'room', lastSeen: Date.now(), close() {} };
  app.network.links.set(link.id, link);
  await app.receive(link, { type: 'hello', senderId: id, payload: { token, name, protocol: PROTOCOL_VERSION } });
  return { link, id, token };
}
test('host authenticates reconnect token and refuses identity spoofing', async () => {
  const app = await host(), guest = await join(app);
  assert.equal(guest.link.memberId, guest.id);
  const forged = await join(app, guest.id, uid(), 'Guest');
  assert.equal(forged.link.memberId, null);
  assert.match(app.sent.at(-1).message.payload.message, /another device/);
  const before = app.data.state.group.version;
  await app.receive(guest.link, { type: 'intent', payload: { id: uid(), type: 'orderer.set', senderId: app.data.identity.id, payload: { id: guest.id } } });
  assert.equal(app.data.state.group.version, before);
  const reconnected = await join(app, guest.id, guest.token, 'Guest');
  assert.equal(reconnected.link.memberId, guest.id);
  assert.equal(app.data.state.members.length, 2);
});
test('clashing names are auto-suffixed; a new group ships the basic menu', async () => {
  const app = await host();
  assert.deepEqual(app.data.state.menu.map(i => [i.name, i.price]), [['Tea', 0], ['Coffee', 0], ['Black Tea', 0], ['Black Coffee', 0], ['Lime Tea', 0]]);
  const a = await join(app, uid(), uid(), 'Sunny Otter'), b = await join(app, uid(), uid(), 'sunny otter');
  assert.ok(a.link.memberId && b.link.memberId);
  assert.deepEqual(app.data.state.members.map(m => m.name).slice(1), ['Sunny Otter', 'sunny otter 2']);
});
test('wire intents cannot invoke host-internal presence or join actions', async () => {
  const app = await host(), guest = await join(app);
  const before = app.data.state.group.version;
  await app.receive(guest.link, { type: 'intent', payload: { id: uid(), type: 'member.join', senderId: guest.id, payload: { id: 'fake', name: 'Fake' } } });
  assert.equal(app.data.state.group.version, before);
});
test('invalid member intent receives authoritative state plus rejection ack', async () => {
  const app = await host(), guest = await join(app), id = uid();
  await app.receive(guest.link, { type: 'intent', payload: { id, type: 'order.lock', senderId: guest.id, roundId: app.data.state.round.id, payload: {} } });
  const response = app.sent.at(-1).message;
  assert.equal(response.payload.ack, id); assert.match(response.payload.error, /orderer/);
  assert.equal(response.payload.state.group.status, 'open');
});
test('member queues offline edits, survives snapshot, reconciles and ignores old versions', async () => {
  const app = await host(), guest = await join(app);
  await app.dispatch('menu.upsert', { id: 'chai', name: 'Chai', price: 1000, category: 'Tea' });
  const member = new AppStore(); member.db = { save: async () => {} };
  Object.assign(member.data, { role: 'member', state: structuredClone(app.data.state), identity: { id: guest.id, token: guest.token, name: 'Guest' } });
  await member.dispatch('pick.set', { itemId: 'chai', qty: 2, note: 'less sugar' });
  assert.equal(member.data.state.picks.length, 0); assert.equal(member.view().state.picks[0].qty, 2);
  const saved = structuredClone(member.data);
  const restored = new AppStore(); restored.db = { save: async () => {} }; restored.data = saved;
  assert.equal(restored.view().state.picks[0].note, 'less sugar');
  const intent = saved.outbox[0];
  await app.receive(guest.link, { type: 'intent', payload: intent });
  const response = app.sent.at(-1).message;
  const hostLink = { id: uid(), mode: 'room', send() {} }; restored.network.links.set(hostLink.id, hostLink);
  await restored.receive(hostLink, response);
  assert.equal(restored.data.outbox.length, 0); assert.equal(restored.ui.hostOnline, true);
  const version = restored.data.state.group.version;
  await restored.receive(hostLink, { ...response, payload: { protocol: PROTOCOL_VERSION, state: { ...saved.state, group: { ...saved.state.group, version: version - 1 } } } });
  assert.equal(restored.data.state.group.version, version);
});
test('host persists before acknowledging a change', async () => {
  const app = await host(), guest = await join(app);
  const events = [];
  app.db.save = async () => { events.push('saved'); };
  app.network.send = (_link, msg) => { if (msg.payload?.ack) events.push('acked'); return true; };
  await app.receive(guest.link, { type: 'intent', payload: { id: uid(), type: 'menu.upsert', senderId: guest.id, payload: { id: 'chai', name: 'Chai', price: 0, category: 'Tea' } } });
  assert.deepEqual(events, ['saved', 'acked']);
});
test('rapid quantity taps serialize against latest state instead of stale rendered quantities', async () => {
  const app = await host();
  await app.dispatch('menu.upsert', { id: 'chai', name: 'Chai', price: 1000, category: 'Tea' });
  await Promise.all([app.changePick('chai', 1), app.changePick('chai', 1), app.changePick('chai', 1)]);
  assert.equal(app.data.state.picks[0].qty, 3);
  await app.saveNote('chai', 'less sugar');
  assert.equal(app.data.state.picks[0].qty, 3); assert.equal(app.data.state.picks[0].note, 'less sugar');
});
test('host rolls back unsaved changes rather than acknowledging them as accepted', async () => {
  const app = await host(), guest = await join(app);
  const version = app.data.state.group.version;
  app.db.save = async () => { throw new Error('Storage full'); };
  await app.receive(guest.link, { type: 'intent', payload: { id: uid(), type: 'menu.upsert', senderId: guest.id, payload: { id: 'chai', name: 'Chai', price: 0, category: 'Tea' } } });
  assert.equal(app.data.state.group.version, version); assert.ok(!app.data.state.menu.some(i => i.id === 'chai'));
  assert.match(app.sent.at(-1).message.payload.error, /Storage full/);
});
test('old clients cannot drop menu IDs when joining a multi-menu host', async () => {
  const app = await host();
  const link = { id: uid(), mode: 'room', close() {} };
  app.network.links.set(link.id, link);
  await app.receive(link, { type: 'hello', senderId: uid(), payload: { token: uid(), name: 'Old client' } });
  assert.equal(app.data.state.members.length, 1);
  assert.equal(app.sent.at(-1).message.type, 'rejected');
  assert.match(app.sent.at(-1).message.payload.message, /Update Chaikadi/);
});
test('a stall menu saves on the device with its prices and comes back as a new group menu', async () => {
  const app = await host();
  const menuId = app.data.state.activeMenuId;
  await app.quickAdd('Samosa 15');
  await app.saveMenuLocally(menuId);
  await app.saveMenuLocally(menuId);
  assert.equal(app.data.profile.saved.length, 1, 'same name replaces');
  const saved = app.data.profile.saved[0];
  assert.equal(saved.name, 'Basic menu');
  assert.deepEqual(saved.items.find(i => i.name === 'Samosa'), { name: 'Samosa', category: 'Snacks', price: 1500 });
  const id = await app.useSavedMenu(saved.id);
  assert.ok(id && id !== menuId);
  assert.equal(app.data.state.menus.length, 3);
  assert.equal(app.data.state.menu.filter(i => i.menuId === id).find(i => i.name === 'Samosa').price, 1500);
  await app.deleteSavedMenu(saved.id);
  assert.equal(app.data.profile.saved.length, 0);
});
test('a window that another window took over stops its room, stops saving and refuses actions', async () => {
  const app = await host();
  let saves = 0; app.db = { save: async () => { saves++; } };
  app.supersede();
  assert.equal(app.ui.superseded, true);
  await app.persist(); assert.equal(saves, 0, 'no writes from the old window');
  let started = 0; app.network.start = () => { started++; }; app.startRoom(); assert.equal(started, 0, 'does not re-register the room code');
  assert.equal(await app.dispatch('menu.create', { id: uid(), name: 'Other' }), false, 'actions are refused');
  assert.match(app.ui.notice, /another window/);
});
