import { validCode, uid } from './config.js';

const MAX_MESSAGE = 4 * 1024 * 1024;
export const PUBLIC_INTENTS = new Set(['member.rename', 'member.remove', 'orderer.set', 'menu.upsert',
  'menu.delete', 'menu.create', 'menu.rename', 'menu.remove', 'menu.activate', 'menu.source', 'pick.set', 'order.lock', 'order.unlock', 'bill.set', 'payment.set',
  'round.finish', 'history.payment', 'group.currency']);

// Transport only: both PeerJS and manual DataChannels expose the same link.
// Authentication and the host-authoritative protocol live in main.js.
export class Network {
  constructor({ onMessage, onLink, onStatus, onCollision, onManualRequired }) {
    Object.assign(this, { onMessage, onLink, onStatus, onCollision, onManualRequired });
    this.links = new Map(); this.manual = new Map(); this.peer = null;
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
      this.onManualRequired(); this.schedule();
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
      else this.onStatus('Could not connect directly. Try again on the same Wi-Fi, manual pairing, or configure TURN.');
      this.onManualRequired(); this.schedule();
    });
  }
  unreachable() {
    this.onStatus('Room signaling is unreachable. No internet? Pair manually on the same Wi-Fi.');
    this.onManualRequired();
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
      if (!conn.open) { conn.close(); this.onStatus('Host unreachable. Keep the host’s app open, check the room code, or try manual pairing.'); this.onManualRequired(); this.schedule(); }
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
    for (const session of this.manual.values()) session.pc.close();
    this.manual.clear();
  }
  // Manual flow deliberately has ZERO ICE servers. The completed local SDP
  // includes all candidates; there is no trickle-ICE or signaling dependency.
  async makeOffer() {
    const id = uid();
    const pc = new RTCPeerConnection({ iceServers: [] });
    this.manual.set(id, { pc });
    this.attachChannel(pc.createDataChannel('chaikadi', { ordered: true }), pc, id);
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await gatherICE(pc);
      return { v: 1, id, type: 'offer', sdp: compactSDP(pc.localDescription.sdp) };
    } catch (error) { pc.close(); this.manual.delete(id); throw error; }
  }
  async makeAnswer(offer) {
    validateSDP(offer, 'offer');
    const pc = new RTCPeerConnection({ iceServers: [] });
    this.manual.set(offer.id, { pc });
    pc.ondatachannel = event => this.attachChannel(event.channel, pc, offer.id);
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gatherICE(pc);
      return { v: 1, id: offer.id, type: 'answer', sdp: compactSDP(pc.localDescription.sdp) };
    } catch (error) { pc.close(); this.manual.delete(offer.id); throw error; }
  }
  async acceptAnswer(answer) {
    validateSDP(answer, 'answer');
    const session = this.manual.get(answer.id);
    if (!session) throw new Error('This answer belongs to an old offer. Create a new offer and try again.');
    await session.pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
  }
  cancelManual(id) {
    const session = this.manual.get(id);
    if (session && !session.connected) { session.pc.close(); this.manual.delete(id); }
  }
  attachChannel(channel, pc, id) {
    let link;
    channel.onopen = () => {
      const session = this.manual.get(id);
      if (session) session.connected = true;
      link = this.addLink('manual', message => {
        const data = JSON.stringify(message);
        // Small ordered chunks stay below mobile SCTP message limits.
        for (let offset = 0; offset < data.length; offset += 12000) {
          channel.send(JSON.stringify({ chunk: data.slice(offset, offset + 12000), end: offset + 12000 >= data.length }));
        }
      }, () => { channel.close(); pc.close(); this.manual.delete(id); });
    };
    let buffer = '';
    channel.onmessage = event => {
      try {
        const frame = JSON.parse(event.data);
        if (typeof frame.chunk !== 'string' || frame.chunk.length > 12000) return;
        buffer += frame.chunk;
        if (buffer.length > MAX_MESSAGE) { buffer = ''; return; }
        if (frame.end) { const data = buffer; buffer = ''; if (link) this.receive(link, data); }
      } catch { buffer = ''; }
    };
    channel.onclose = () => { if (link) this.dropLink(link); };
    channel.onerror = () => { if (link) this.dropLink(link); };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) {
        if (link) this.dropLink(link);
        else this.onStatus('Manual pairing failed. Use the same Wi-Fi; disable client isolation. iOS mDNS candidates may prevent pairing on some networks.');
      }
    };
  }
}

function validateSDP(value, type) {
  if (value?.v !== 1 || value.type !== type || typeof value.id !== 'string' || value.id.length > 80 ||
      typeof value.sdp !== 'string' || value.sdp.length > 64000 || !value.sdp.startsWith('v=0')) {
    throw new Error(`Paste or scan a valid Chaikadi ${type}.`);
  }
}
function compactSDP(sdp) {
  return sdp.split(/\r?\n/).filter(line => line && !/^a=(extmap-allow-mixed|msid-semantic:|ice-options:trickle)/.test(line)).join('\r\n') + '\r\n';
}
function gatherICE(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      if (pc.iceGatheringState !== 'complete') return;
      clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', done); resolve();
    };
    const timer = setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', done); pc.close();
      reject(new Error('ICE gathering timed out. Check local network permission and try again.'));
    }, 20000);
    pc.addEventListener('icegatheringstatechange', done); done();
  });
}

export async function encodePairing(value) {
  const raw = new TextEncoder().encode(JSON.stringify(value));
  let bytes = raw, mode = 'n';
  if (typeof CompressionStream !== 'undefined') {
    try {
      const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
      const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
      if (compressed.length < raw.length) { bytes = compressed; mode = 'z'; }
    } catch { /* uncompressed, copyable fallback */ }
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `CK1.${mode}.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}
export async function decodePairing(text) {
  const parts = text.trim().split('.');
  if (text.length > 100000 || parts.length !== 3 || parts[0] !== 'CK1' || !['n', 'z'].includes(parts[1])) throw new Error('This is not a Chaikadi pairing code.');
  let bytes;
  try { bytes = Uint8Array.from(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }
  catch { throw new Error('Pairing text is incomplete. Copy the entire code.'); }
  if (parts[1] === 'z') {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read compressed codes. Ask the other person to use “Compatibility text”.');
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 100000) { await reader.cancel(); throw new Error('Pairing data is too large.'); }
      chunks.push(value);
    }
    bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error('Pairing text is damaged. Copy or scan it again.'); }
}
export function compatibilityPairing(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return 'CK1.n.' + btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
