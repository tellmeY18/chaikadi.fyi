import test from 'node:test';
import assert from 'node:assert/strict';
import { AppStore, LINK_TIMEOUT_MS, RESUME_GRACE_MS, OFFLINE_DELAY_MS } from '../js/store.js';
import { Network } from '../js/p2p.js';
import { uid, PROTOCOL_VERSION } from '../js/config.js';

async function host() {
  const app = new AppStore();
  app.db = { save: async () => {} };
  app.startRoom = () => {}; await app.create('Crew', 'Host');
  app.network.send = () => true;
  return app;
}
async function join(app) {
  const link = { id: uid(), mode: 'room', lastSeen: Date.now(), close() {} };
  app.network.links.set(link.id, link);
  await app.receive(link, { type: 'hello', senderId: uid(), payload: { token: uid(), name: 'Guest', protocol: PROTOCOL_VERSION } });
  return link;
}
const online = app => app.data.state.members.filter(m => m.online).length;

test('a silent link is dropped only after the timeout while visible', async () => {
  const app = await host(), link = await join(app);
  const t0 = link.lastSeen;
  app.tick(t0 + LINK_TIMEOUT_MS - 1000);
  assert.ok(app.network.links.has(link.id), 'still within the timeout');
  app.tick(t0 + LINK_TIMEOUT_MS + 1000);
  assert.ok(!app.network.links.has(link.id), 'dropped after the timeout');
});

test('background and waking up never drop a link that just could not answer', async () => {
  const app = await host(), link = await join(app);
  link.lastSeen = Date.now() - 10 * 60000; // nothing heard while the phone slept
  app.background();
  app.tick();
  assert.ok(app.network.links.has(link.id), 'hidden: timers are throttled, so no drop');
  app.network.resume = () => {};
  app.foreground();
  const woke = Date.now();
  app.tick(woke + RESUME_GRACE_MS - 1000);
  assert.ok(app.network.links.has(link.id), 'grace after foreground to answer a fresh ping');
  app.tick(woke + RESUME_GRACE_MS + 1000);
  assert.ok(!app.network.links.has(link.id), 'still silent after the grace: dropped');
});

test('people show offline only if they stay gone, not during a quick reconnect', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = await host(), link = await join(app);
  assert.equal(online(app), 2);
  app.network.links.delete(link.id);
  await app.linkChanged(link, false);
  assert.equal(online(app), 2, 'not marked offline at once');
  // Reconnects within the delay with the same member id.
  const again = { ...link, id: uid() };
  app.network.links.set(again.id, again);
  t.mock.timers.tick(OFFLINE_DELAY_MS);
  await app.queue;
  await new Promise(r => setImmediate(r));
  assert.equal(online(app), 2, 'reconnected in time: never shown offline');
  app.network.links.delete(again.id);
  await app.linkChanged(again, false);
  t.mock.timers.tick(OFFLINE_DELAY_MS);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(online(app), 1, 'gone for good: shown offline');
});

test('redial backs off from about 1 s to at most about 10 s and resets on success', () => {
  const net = new Network({});
  const delays = Array.from({ length: 7 }, () => net.retryDelay());
  assert.ok(delays[0] >= 1000 && delays[0] < 1400, `first retry ${delays[0]}`);
  for (let i = 1; i < delays.length; i++) assert.ok(delays[i] >= delays[i - 1] - 400, 'never shrinks');
  assert.ok(delays.at(-1) <= 10400, 'capped');
  net.attempt = 0;
  assert.ok(net.retryDelay() < 1400, 'reset after a connection opens');
});
