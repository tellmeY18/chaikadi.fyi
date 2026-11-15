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

// ---- signaling recovery with a fake PeerJS ---------------------------------
class FakePeer {
  static all = [];
  constructor(id) { this.id = id; this.handlers = {}; this.open = false; this.disconnected = false; this.destroyed = false; this.connections = {}; FakePeer.all.push(this); }
  on(type, fn) { (this.handlers[type] ||= []).push(fn); }
  fire(type, arg) { for (const fn of this.handlers[type] || []) fn(arg); }
  reconnect() { this.disconnected = false; /* hangs: no event, like peerjs#1289 */ }
  destroy() { this.destroyed = true; }
}
function network(extra = {}) {
  FakePeer.all = [];
  globalThis.window = { Peer: FakePeer };
  const calls = { collision: 0 };
  const net = new Network({ onMessage() {}, onLink() {}, onStatus() {}, onUnreachable() {}, onCollision: () => calls.collision++, ...extra });
  return { net, calls };
}
const config = { signaling: { host: 'x', port: 443, path: '/', secure: true, key: 'k' }, iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

test('a host whose own code is still held by the server waits instead of switching codes', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 });
  const { net, calls } = network();
  net.start({ host: true, code: 'ABCD', config, fresh: false });
  FakePeer.all[0].fire('error', { type: 'unavailable-id' });
  assert.equal(calls.collision, 0, 'no new code, no error notice');
  t.mock.timers.tick(1500);
  assert.equal(FakePeer.all.length, 2, 'tries the same code again');
  assert.equal(FakePeer.all[1].id, 'chaikadi-ABCD');
  t.mock.timers.tick(121000);
  if (!net.peer) net.resume();
  net.peer.fire('error', { type: 'unavailable-id' });
  assert.equal(calls.collision, 1, 'still taken after ~2 minutes: report it');
  net.stop();
});

test('a brand-new room code that is taken picks another at once', () => {
  const { net, calls } = network();
  net.start({ host: true, code: 'ABCD', config, fresh: true });
  FakePeer.all[0].fire('error', { type: 'unavailable-id' });
  assert.equal(calls.collision, 1);
});

test('a hung signaling reconnect is replaced without closing live data links', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { net } = network();
  net.start({ host: false, code: 'ABCD', config });
  const first = FakePeer.all[0];
  first.connect = () => ({ on() {}, open: false, close() {} });
  first.open = true; first.fire('open');
  first.connections = { 'chaikadi-ABCD': [{ open: true }] };
  first.open = false; first.disconnected = true; first.fire('disconnected');
  net.resume();
  t.mock.timers.tick(10000);
  assert.equal(FakePeer.all.length, 2, 'a fresh signaling peer is made');
  assert.equal(first.destroyed, false, 'the old peer keeps its live data connection');
  net.stop();
  assert.equal(first.destroyed, true, 'cleaned up when the room stops');
});

test('extra public STUN servers are added once', async () => {
  const { withExtraStun } = await import('../js/p2p.js');
  const out = withExtraStun([{ urls: 'stun:stun.cloudflare.com:3478' }]);
  assert.equal(out.filter(s => s.urls === 'stun:stun.cloudflare.com:3478').length, 1);
  assert.ok(out.some(s => s.urls === 'stun:stun1.l.google.com:19302'));
});

test('relay choice: none by default, or your own server', async () => {
  const { relayServers } = await import('../js/config.js');
  assert.deepEqual(relayServers(), []);
  assert.deepEqual(relayServers({ relay: 'auto' }), [], 'old saved "free relay" choice: none');
  assert.deepEqual(relayServers({ relay: 'custom', custom: { urls: 'turn:a.example:3478, https://bad , turns:a.example:443?transport=tcp', username: 'u', credential: 'p' } }),
    [{ urls: ['turn:a.example:3478', 'turns:a.example:443?transport=tcp'], username: 'u', credential: 'p' }]);
  assert.deepEqual(relayServers({ relay: 'custom', custom: { urls: '' } }), []);
});

test('connection log keeps debug lines only while verbose, capped and clearable', async () => {
  const { log, logs, clearLogs, setVerbose, logText } = await import('../js/netlog.js');
  clearLogs(); setVerbose(false);
  log('debug', 'hidden'); log('info', 'shown', { a: 1 });
  assert.deepEqual(logs().map(e => e.message), ['shown']);
  setVerbose(true); log('debug', 'now shown');
  assert.equal(logs().length, 2);
  for (let i = 0; i < 600; i++) log('info', `x${i}`);
  assert.equal(logs().length, 500);
  assert.match(logText(), /INFO  x599/);
  clearLogs(); setVerbose(false);
  assert.equal(logs().length, 0);
});
