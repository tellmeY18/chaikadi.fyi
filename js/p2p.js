import { validCode, uid, EXTRA_STUN } from './config.js';

const MAX_MESSAGE = 4 * 1024 * 1024;
// The signaling server keeps a vanished socket's id for up to ~90 s, so a host
// that reloads or loses its socket can see its own room code as "taken".
const ID_RECLAIM_MS = 120000;
// peer.reconnect() can hang without any event (peerjs#1289): replace the peer.
const RECONNECT_WATCHDOG_MS = 10000;
export const PUBLIC_INTENTS = new Set(['member.rename', 'member.remove', 'orderer.set', 'menu.upsert', 'item.price',
  'menu.delete', 'menu.create', 'menu.rename', 'menu.remove', 'menu.activate', 'menu.source', 'pick.set', 'order.lock', 'order.unlock', 'bill.set', 'payment.set',
  'round.finish', 'history.payment', 'group.currency']);

// Transport only: PeerJS room connections. Authentication and the
// host-authoritative protocol live in store.js.
export class Network {
  constructor({ onMessage, onLink, onStatus, onCollision, onUnreachable }) {
    Object.assign(this, { onMessage, onLink, onStatus, onCollision, onUnreachable });
    this.links = new Map(); this.peer = null;
    this.running = false; this.retry = null; this.connectTimer = null;
    this.roomReady = false; this.attempt = 0;
  }
  start({ host, code, config, fresh = false }) {
    this.stopRoom();
    Object.assign(this, { host, code, config, fresh, running: true, takenSince: 0 });
    this.openPeer();
  }
  openPeer() {
    if (!this.running || !validCode(this.code)) return;
    this.onStatus('Connecting to room signaling…');
    let peer;
    try {
      peer = new window.Peer(this.host ? `chaikadi-${this.code}` : undefined, {
        ...this.config.signaling, config: { iceServers: withExtraStun(this.config.iceServers) }, debug: 0,
      });
    } catch { this.unreachable(); this.schedule(); return; }
    this.peer = peer;
    this.connectTimer = setTimeout(() => {
      if (this.peer !== peer || this.roomReady) return;
      this.unreachable();
      if (!peer.open) { peer.destroy(); this.peer = null; }
      this.schedule();
    }, 15000);
    peer.on('open', () => {
      if (this.peer !== peer) return;
      clearTimeout(this.connectTimer);
      this.roomReady = true; this.fresh = false; this.takenSince = 0; if (this.host) this.attempt = 0;
      this.onStatus(this.host ? 'Room code ready · host on this device' : 'Finding the host…');
      if (!this.host) this.connectHost();
    });
    peer.on('connection', conn => {
      if (!this.host) return conn.close();
      this.attachPeer(conn);
    });
    peer.on('disconnected', () => {
      if (this.peer !== peer || !this.running) return;
      this.roomReady = false;
      this.onStatus('Signaling offline. Existing peer connections can keep working.');
      this.onUnreachable(); this.schedule();
    });
    peer.on('close', () => {
      if (this.peer !== peer || !this.running) return;
      this.roomReady = false; this.schedule();
    });
    peer.on('error', error => {
      if (this.peer !== peer) return;
      if (error.type === 'unavailable-id' && this.host) {
        // A brand-new code that is taken: pick another. Our own code: it is
        // usually our previous socket; wait for the server to release it.
        this.takenSince ||= Date.now();
        if (this.fresh || Date.now() - this.takenSince > ID_RECLAIM_MS) { this.stopRoom(); this.onCollision(); return; }
        this.onStatus('Reclaiming the room code…');
        this.drop(peer); this.schedule(); return;
      }
      if (error.type === 'peer-unavailable') this.onStatus('No host at that code. Check the code, or ask the host to reopen Chaikadi.');
      else if (['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(error.type)) this.unreachable();
      else this.onStatus('Could not connect directly. Retrying…');
      this.onUnreachable(); this.schedule();
    });
  }
  unreachable() {
    this.onStatus('No connection. Retrying…');
    this.onUnreachable();
  }
  // Retry quickly after a blip (1 s), then back off to at most 10 s, with a
  // little jitter so a group's phones do not all redial at the same moment.
  retryDelay() { return Math.min(10000, 1000 * 2 ** Math.min(this.attempt++, 4)) + Math.floor(Math.random() * 400); }
  schedule() {
    if (!this.running || this.retry) return;
    this.retry = setTimeout(() => { this.retry = null; this.resume(); }, this.retryDelay());
  }
  resume() {
    if (!this.running) return;
    clearTimeout(this.retry); this.retry = null;
    if (!this.peer || this.peer.destroyed) this.openPeer();
    else if (this.peer.disconnected) {
      const peer = this.peer;
      try { peer.reconnect(); } catch { this.drop(peer); this.schedule(); return; }
      clearTimeout(this.watchdog);
      this.watchdog = setTimeout(() => { if (this.peer === peer && !peer.open && this.running) { this.drop(peer); this.openPeer(); } }, RECONNECT_WATCHDOG_MS);
    } else if (this.peer.open && !this.host) this.connectHost();
  }
  // Stop using a signaling peer. Destroying a PeerJS peer closes its data
  // connections, so one that still carries live links is kept (retired) until
  // the room stops; only its signaling role is replaced.
  drop(peer) {
    if (this.peer === peer) { this.peer = null; this.roomReady = false; }
    const live = Object.values(peer.connections || {}).flat().some(c => c.open);
    if (live) { (this.retired ||= new Set()).add(peer); return; }
    try { peer.destroy(); } catch { /* already gone */ }
  }
  connectHost() {
    if ([...this.links.values()].some(l => l.mode === 'room')) return;
    if (this.dialing || !this.peer?.open) return;
    this.dialing = true;
    // PeerJS binary serialization chunks large snapshots (JSON mode does not).
    const conn = this.peer.connect(`chaikadi-${this.code}`, { reliable: true, serialization: 'binary' });
    this.attachPeer(conn);
    const timeout = setTimeout(() => {
      this.dialing = false;
      if (!conn.open) { conn.close(); this.onStatus('Host unreachable. Retrying…'); this.onUnreachable(); this.schedule(); }
    }, 15000);
    conn.on('open', () => { clearTimeout(timeout); this.dialing = false; this.attempt = 0; });
    conn.on('close', () => { clearTimeout(timeout); this.dialing = false; this.schedule(); });
    conn.on('error', () => { clearTimeout(timeout); this.dialing = false; this.schedule(); });
  }
  attachPeer(conn) {
    let link;
    conn.on('open', () => {
      link = this.addLink('room', message => conn.send(message), () => conn.close());
    });
    conn.on('data', message => { if (link) this.receive(link, message); });
    const close = () => { if (link) this.dropLink(link); };
    conn.on('close', close); conn.on('error', close);
  }
  addLink(mode, send, close) {
    const link = { id: uid(), mode, send, close, memberId: null, lastSeen: Date.now() };
    this.links.set(link.id, link); this.onLink(link, true);
    return link;
  }
  receive(link, message) {
    try {
      if (typeof message === 'string') {
        if (message.length > MAX_MESSAGE) throw new Error('Too large');
        message = JSON.parse(message);
      }
      if (!message || typeof message !== 'object' || typeof message.type !== 'string' || JSON.stringify(message).length > MAX_MESSAGE) return;
      link.lastSeen = Date.now();
      this.onMessage(link, message);
    } catch { /* malformed peer data cannot crash the UI */ }
  }
  send(link, message) {
    if (!link || !this.links.has(link.id)) return false;
    if (JSON.stringify(message).length > MAX_MESSAGE) {
      this.onStatus('Group history is too large to sync (4 MiB limit). Export a backup and start a fresh group.');
      return false;
    }
    try { link.send(message); return true; } catch { this.dropLink(link); return false; }
  }
  dropLink(link) {
    if (!this.links.delete(link.id)) return;
    try { link.close(); } catch { /* already closed */ }
    this.onLink(link, false);
    if (!this.host && link.mode === 'room') this.schedule();
  }
  stopRoom() {
    this.running = false; this.roomReady = false; this.dialing = false;
    clearTimeout(this.retry); this.retry = null; clearTimeout(this.connectTimer); clearTimeout(this.watchdog);
    const peer = this.peer; this.peer = null;
    for (const old of this.retired || []) try { old.destroy(); } catch { /* gone */ }
    this.retired = null;
    for (const link of [...this.links.values()]) if (link.mode === 'room') this.dropLink(link);
    peer?.destroy();
  }
  stop() {
    this.stopRoom();
    for (const link of [...this.links.values()]) this.dropLink(link);
  }
}

// Saved configs keep their own servers; a few public STUN servers are always
// added so one being unreachable does not stop direct connections.
export function withExtraStun(servers = []) {
  const have = new Set(servers.flatMap(s => [].concat(s.urls)));
  return [...servers, ...EXTRA_STUN.filter(u => !have.has(u)).map(urls => ({ urls }))];
}
