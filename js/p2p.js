import { validCode, uid } from './config.js';

const MAX_MESSAGE = 4 * 1024 * 1024;
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
    this.roomReady = false;
  }
  start({ host, code, config }) {
    this.stopRoom();
    Object.assign(this, { host, code, config, running: true });
    this.openPeer();
  }
  openPeer() {
    if (!this.running || !validCode(this.code)) return;
    this.onStatus('Connecting to room signaling…');
    let peer;
    try {
      peer = new window.Peer(this.host ? `chaikadi-${this.code}` : undefined, {
        ...this.config.signaling, config: { iceServers: this.config.iceServers }, debug: 0,
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
      this.roomReady = true;
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
        this.stopRoom(); this.onCollision(); return;
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
  schedule() {
    if (!this.running || this.retry) return;
    this.retry = setTimeout(() => { this.retry = null; this.resume(); }, 6000);
  }
  resume() {
    if (!this.running) return;
    if (!this.peer || this.peer.destroyed) this.openPeer();
    else if (this.peer.disconnected) {
      try { this.peer.reconnect(); } catch { this.schedule(); }
    } else if (this.peer.open && !this.host) this.connectHost();
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
    conn.on('open', () => { clearTimeout(timeout); this.dialing = false; });
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
    clearTimeout(this.retry); this.retry = null; clearTimeout(this.connectTimer);
    const peer = this.peer; this.peer = null;
    for (const link of [...this.links.values()]) if (link.mode === 'room') this.dropLink(link);
    peer?.destroy();
  }
  stop() {
    this.stopRoom();
    for (const link of [...this.links.values()]) this.dropLink(link);
  }
}
