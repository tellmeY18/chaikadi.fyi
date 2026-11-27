import { validCode, uid, EXTRA_STUN } from './config.js';
import { log, isVerbose } from './netlog.js';
import { instrument } from './icediag.js';

const MAX_MESSAGE = 4 * 1024 * 1024;
// The signaling server keeps a vanished socket's id for up to ~90 s, so a host
// that reloads or loses its socket can see its own room code as "taken".
const ID_RECLAIM_MS = 120000;
// peer.reconnect() can hang without any event (peerjs#1289): replace the peer.
const RECONNECT_WATCHDOG_MS = 10000;
export const PUBLIC_INTENTS = new Set(['member.rename', 'member.upi', 'upi.propose', 'upi.decide', 'member.remove', 'orderer.set', 'menu.upsert', 'item.price',
  'menu.delete', 'menu.create', 'menu.rename', 'menu.remove', 'menu.activate', 'menu.source', 'pick.set', 'order.lock', 'order.unlock', 'bill.set', 'payment.set',
  'round.finish', 'history.payment', 'group.currency']);

// Transport only: PeerJS room connections. Authentication and the
// host-authoritative protocol live in store.js.
export class Network {
  constructor({ onMessage, onLink, onStatus, onCollision, onUnreachable, onIceFailure }) {
    Object.assign(this, { onMessage, onLink, onStatus, onCollision, onUnreachable, onIceFailure });
    this.links = new Map(); this.peer = null;
    this.running = false; this.retry = null; this.connectTimer = null;
    this.roomReady = false; this.attempt = 0;
  }
  start({ host, code, config, fresh = false }) {
    this.stopRoom();
    Object.assign(this, { host, code, config, fresh, running: true, takenSince: 0 });
    log('info', `start ${host ? 'host' : 'member'} room ${code}`, { fresh, relay: (config.iceServers || []).filter(s => [].concat(s.urls).some(u => /^turns?:/.test(u))).length, policy: config.iceTransportPolicy || 'all' });
    this.openPeer();
  }
  openPeer() {
    if (!this.running || !validCode(this.code)) return;
    this.onStatus('Connecting to room signaling…');
    log('info', 'signaling: connecting', { host: this.config.signaling?.host, attempt: this.attempt });
    let peer;
    try {
      peer = new window.Peer(this.host ? `chaikadi-${this.code}` : undefined, {
        ...this.config.signaling, config: { iceServers: withExtraStun(this.config.iceServers), iceTransportPolicy: this.config.iceTransportPolicy || 'all' },
        debug: isVerbose() ? 3 : 0, logFunction: (level, ...rest) => log('debug', `peerjs ${rest.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`),
      });
    } catch (error) { log('error', 'signaling: could not create peer', error?.message); this.unreachable(); this.schedule(); return; }
    this.peer = peer;
    this.connectTimer = setTimeout(() => {
      if (this.peer !== peer || this.roomReady) return;
      log('warn', 'signaling: no answer in 15 s');
      this.unreachable();
      if (!peer.open) { peer.destroy(); this.peer = null; }
      this.schedule();
    }, 15000);
    peer.on('open', () => {
      if (this.peer !== peer) return;
      clearTimeout(this.connectTimer);
      log('info', `signaling: open as ${peer.id}`);
      this.roomReady = true; this.fresh = false; this.takenSince = 0; if (this.host) this.attempt = 0;
      this.onStatus(this.host ? 'Room code ready · host on this device' : 'Finding the host…');
      if (!this.host) this.connectHost();
    });
    peer.on('connection', conn => {
      if (!this.host) return conn.close();
      log('info', `incoming connection from ${conn.peer}`);
      this.attachPeer(conn);
    });
    peer.on('disconnected', () => {
      if (this.peer !== peer || !this.running) return;
      log('warn', 'signaling: disconnected (peer links stay up)');
      this.roomReady = false;
      this.onStatus('Signaling offline. Existing peer connections can keep working.');
      this.onUnreachable(); this.schedule();
    });
    peer.on('close', () => {
      if (this.peer !== peer || !this.running) return;
      log('warn', 'signaling: peer closed');
      this.roomReady = false; this.schedule();
    });
    peer.on('error', error => {
      if (this.peer !== peer) return;
      log('error', `signaling error: ${error.type}`, error.message);
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
    const delay = this.retryDelay();
    log('debug', `retry in ${delay} ms`, { attempt: this.attempt });
    this.retry = setTimeout(() => { this.retry = null; this.resume(); }, delay);
  }
  resume() {
    if (!this.running) return;
    clearTimeout(this.retry); this.retry = null;
    if (!this.peer || this.peer.destroyed) this.openPeer();
    else if (this.peer.disconnected) {
      const peer = this.peer;
      log('info', 'signaling: reconnecting');
      try { peer.reconnect(); } catch { this.drop(peer); this.schedule(); return; }
      clearTimeout(this.watchdog);
      this.watchdog = setTimeout(() => { if (this.peer === peer && !peer.open && this.running) { log('warn', 'signaling: reconnect hung, replacing peer'); this.drop(peer); this.openPeer(); } }, RECONNECT_WATCHDOG_MS);
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
    log('info', `dialing host chaikadi-${this.code}`);
    // PeerJS binary serialization chunks large snapshots (JSON mode does not).
    const conn = this.peer.connect(`chaikadi-${this.code}`, { reliable: true, serialization: 'binary' });
    this.attachPeer(conn);
    const timeout = setTimeout(() => {
      this.dialing = false;
      if (!conn.open) { log('warn', 'host did not answer in 15 s'); conn.iceReport?.(); conn.close(); this.onStatus('Host unreachable. Retrying…'); this.onUnreachable(); this.schedule(); }
    }, 15000);
    conn.on('open', () => { clearTimeout(timeout); this.dialing = false; this.attempt = 0; });
    conn.on('close', () => { clearTimeout(timeout); this.dialing = false; this.schedule(); });
    conn.on('error', () => { clearTimeout(timeout); this.dialing = false; this.schedule(); });
  }
  attachPeer(conn) {
    let link;
    // Failed connections never become links: keep their diagnosis for Developer options.
    const ice = instrument(conn, failure => { this.failures = [failure, ...(this.failures || [])].slice(0, 5); this.onIceFailure?.(failure); });
    conn.iceReport = () => ice.report();
    conn.on('open', () => {
      link = this.addLink('room', message => conn.send(message), () => conn.close(), conn);
      log('info', `link open with ${conn.peer}`, { link: link.id.slice(0, 8) });
      describeRoute(conn).then(route => { if (link) { link.route = route; log('info', `link route ${route.local}→${route.remote}`, route); } }).catch(() => {});
    });
    conn.on('data', message => { if (link) this.receive(link, message); });
    conn.on('iceStateChanged', state => { log(state === 'disconnected' || state === 'failed' ? 'warn' : 'debug', `ice ${state} with ${conn.peer}`); if (link) link.ice = state;
      if (state === 'connected' && link) describeRoute(conn).then(route => { link.route = route; }).catch(() => {}); });
    const close = reason => () => { log('warn', `link ${reason} with ${conn.peer}`); if (link) this.dropLink(link); };
    conn.on('close', close('closed')); conn.on('error', error => { log('error', `link error with ${conn.peer}`, error?.type || error?.message); ice.report(); close('error')(); });
  }
  addLink(mode, send, close, conn = null) {
    const link = { id: uid(), mode, send, close, conn, memberId: null, lastSeen: Date.now(), opened: Date.now(), ice: 'connected' };
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
    log('info', `link dropped (${link.memberId ? `member ${link.memberId.slice(0, 8)}` : 'unauthenticated'})`, { open: `${Math.round((Date.now() - link.opened) / 1000)} s`, quiet: `${Math.round((Date.now() - link.lastSeen) / 1000)} s` });
    try { link.close(); } catch { /* already closed */ }
    this.onLink(link, false);
    if (!this.host && link.mode === 'room') this.schedule();
  }
  // For Developer options: everything about the current connection state.
  details() {
    const p = this.peer;
    return { role: this.host ? 'host' : 'member', code: this.code || '', running: this.running, roomReady: this.roomReady, attempt: this.attempt,
      retryPending: !!this.retry, reclaimingCode: !!this.takenSince, retiredPeers: this.retired?.size || 0,
      signaling: p ? { id: p.id, open: p.open, disconnected: p.disconnected, destroyed: p.destroyed, server: this.config?.signaling?.host } : null,
      iceServers: (this.config?.iceServers ? withExtraStun(this.config.iceServers) : []).map(s => ({ urls: s.urls, ...(s.username ? { auth: 'yes' } : {}) })),
      iceTransportPolicy: this.config?.iceTransportPolicy || 'all',
      failures: this.failures || [],
      links: [...this.links.values()].map(l => ({ id: l.id.slice(0, 8), peer: l.conn?.peer || '', member: l.memberId || '', authenticated: !!l.authenticated,
        openFor: Math.round((Date.now() - l.opened) / 1000), quietFor: Math.round((Date.now() - l.lastSeen) / 1000), ice: l.ice, route: l.route || null })) };
  }
  async refreshRoutes() {
    for (const link of this.links.values()) if (link.conn) link.route = await describeRoute(link.conn).catch(() => link.route);
  }
  stopRoom() {
    log('debug', 'stop room');
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

// Which path a data connection uses: host (same network), srflx (direct via
// STUN), prflx, or relay (through TURN), and the round-trip time.
export async function describeRoute(conn) {
  const pc = conn.peerConnection;
  if (!pc?.getStats) return null;
  const stats = await pc.getStats();
  let pair = null;
  stats.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId); });
  if (!pair) stats.forEach(r => { if (r.type === 'candidate-pair' && (r.nominated || r.selected) && r.state === 'succeeded') pair = r; });
  if (!pair) return null;
  const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
  return { local: local?.candidateType || '?', remote: remote?.candidateType || '?', protocol: local?.protocol || '', relayProtocol: local?.relayProtocol || '',
    rttMs: Number.isFinite(pair.currentRoundTripTime) ? Math.round(pair.currentRoundTripTime * 1000) : null };
}
