// WebRTC (ICE) diagnostics for Developer options: what addresses this browser
// offers, STUN/TURN errors, and why a connection failed. Logs stay on the
// device (netlog.js). Addresses are logged so a failure can be understood;
// they leave the device only if someone copies the report.
import { log } from './netlog.js';

// "candidate:1 1 udp 2122260223 192.168.1.5 54321 typ host ..." -> fields.
export function parseCandidate(line) {
  const parts = String(line || '').replace(/^a=/, '').split(' ');
  const typIndex = parts.indexOf('typ');
  if (parts.length < 8 || typIndex < 0) return null;
  const address = parts[4] || '';
  const tcpIndex = parts.indexOf('tcptype');
  return { protocol: (parts[2] || '').toLowerCase(), address, port: Number(parts[5]) || 0, type: parts[typIndex + 1] || '?',
    mdns: /\.local$/i.test(address), ipv6: address.includes(':'), ...(tcpIndex > 0 ? { tcpType: parts[tcpIndex + 1] } : {}) };
}
const describe = c => `${c.type}${c.mdns ? ' (.local name)' : ''} ${c.protocol}${c.tcpType ? `/${c.tcpType}` : ''} ${c.address}:${c.port}${c.ipv6 ? ' ipv6' : ''}`;

// Why ICE failed, in words, from what each side offered and what was tried.
export function verdict({ local, remote, pairs, errors = [], policy = 'all' }) {
  const has = (list, type) => list.some(c => c.type === type);
  const out = [];
  if (policy === 'relay' && !has(local, 'relay')) out.push('Force relay is on but the relay (TURN) server gave no address: check its URL and login, or turn Force relay off');
  else if (!local.length) out.push('this browser offered no addresses at all (WebRTC blocked or disabled by a setting or add-on)');
  else if (!has(local, 'host')) out.push('this browser offered no local address (privacy setting such as media.peerconnection.ice.no_host, or an add-on like uBlock\u2019s WebRTC option)');
  else if (local.filter(c => c.type === 'host').every(c => c.mdns)) out.push('this browser hides its local address behind a .local name; the other device must resolve it over the network (fails on many routers and hotspots)');
  if (remote.length && !has(remote, 'host')) out.push('the other device offered no local address');
  else if (remote.length && remote.filter(c => c.type === 'host').every(c => c.mdns)) out.push('the other device hides its local address behind a .local name');
  if (!remote.length) out.push('no addresses arrived from the other device (signaling problem, or it blocks WebRTC)');
  if (local.length && !has(local, 'srflx')) out.push(errors.length ? 'STUN failed, so no public address was found' : 'no public address from STUN (STUN blocked, or only one network path allowed)');
  if (!has(local, 'relay') && !has(remote, 'relay')) out.push('no relay (TURN) on either side, so strict networks cannot connect');
  if (pairs.length && !pairs.some(p => p.state === 'succeeded')) out.push(`${pairs.length} address pair(s) tried, none worked (devices cannot reach each other: client isolation, different networks behind strict NAT, VPN or firewall)`);
  return out.length ? out : ['no obvious cause found'];
}

// Snapshot of an RTCPeerConnection's ICE state from getStats().
export async function diagnose(pc, errors = []) {
  const stats = await pc.getStats();
  const local = [], remote = [], pairs = [];
  const asCandidate = r => ({ type: r.candidateType, protocol: (r.protocol || '').toLowerCase(), address: r.address || r.ip || '', port: r.port || 0,
    mdns: /\.local$/i.test(r.address || ''), ipv6: String(r.address || '').includes(':'), ...(r.relayProtocol ? { relayProtocol: r.relayProtocol } : {}) });
  stats.forEach(r => {
    if (r.type === 'local-candidate') local.push(asCandidate(r));
    else if (r.type === 'remote-candidate') remote.push(asCandidate(r));
    else if (r.type === 'candidate-pair') pairs.push(r);
  });
  const byId = id => { const r = stats.get(id); return r ? asCandidate(r) : null; };
  const pairList = pairs.map(p => ({ state: p.state, nominated: !!p.nominated, local: byId(p.localCandidateId), remote: byId(p.remoteCandidateId),
    requests: p.requestsSent ?? null, responses: p.responsesReceived ?? null }));
  const policy = pc.getConfiguration?.().iceTransportPolicy || 'all';
  return { iceConnectionState: pc.iceConnectionState, connectionState: pc.connectionState, gathering: pc.iceGatheringState, policy,
    local, remote, pairs: pairList, errors, verdict: verdict({ local, remote, pairs: pairList, errors, policy }) };
}
export function summaryText(d) {
  return [`ICE ${d.iceConnectionState} · connection ${d.connectionState} · gathering ${d.gathering} · routes ${d.policy === 'relay' ? 'relay only' : 'all'}`,
    `local (${d.local.length}): ${d.local.map(describe).join('; ') || 'none'}`,
    `remote (${d.remote.length}): ${d.remote.map(describe).join('; ') || 'none'}`,
    `pairs (${d.pairs.length}): ${d.pairs.map(p => `${p.local?.type}→${p.remote?.type} ${p.state}${p.requests !== null ? ` req ${p.requests}/resp ${p.responses}` : ''}`).join('; ') || 'none'}`,
    ...(d.errors.length ? [`STUN/TURN errors: ${d.errors.join('; ')}`] : []),
    `likely cause: ${d.verdict.join(' | ')}`].join('\n');
}

// Watch a PeerJS data connection's RTCPeerConnection without replacing
// PeerJS's own handlers. onFailure(summary) runs once when ICE fails.
export function instrument(conn, onFailure) {
  let tries = 0;
  const errors = [];
  const handle = { report: async () => {} };
  const attach = () => {
    const pc = conn.peerConnection;
    if (!pc) { if (tries++ < 50) setTimeout(attach, 100); return; }
    const who = conn.peer;
    log('debug', `ice watch ${who}: started (${conn.metadata?.dir || (pc.localDescription ? 'answering' : 'dialing')})`);
    pc.addEventListener('icecandidate', e => {
      if (!e.candidate) { log('debug', `ice ${who}: gathering complete`); return; }
      const c = parseCandidate(e.candidate.candidate);
      if (c) log('debug', `ice ${who}: offered ${describe(c)}`);
    });
    pc.addEventListener('icecandidateerror', e => {
      const text = `${e.url || '?'} ${e.errorCode || ''} ${e.errorText || ''}`.trim();
      errors.push(text);
      log('warn', `ice ${who}: STUN/TURN error ${text}`);
    });
    pc.addEventListener('icegatheringstatechange', () => log('debug', `ice ${who}: gathering ${pc.iceGatheringState}`));
    pc.addEventListener('signalingstatechange', () => log('debug', `ice ${who}: signaling ${pc.signalingState}`));
    pc.addEventListener('connectionstatechange', () => log(pc.connectionState === 'failed' ? 'warn' : 'debug', `ice ${who}: connection ${pc.connectionState}`));
    // PeerJS closes the connection as soon as ICE fails, after which Firefox
    // refuses getStats(): keep a recent snapshot while ICE is still checking.
    let reported = false, last = null, poll = null;
    const snapshot = () => diagnose(pc, errors).then(d => { last = d; }).catch(() => {});
    const watch = on => { clearInterval(poll); poll = on ? setInterval(snapshot, 1500) : null; };
    const report = async () => {
      if (reported) return;
      reported = true; watch(false);
      try {
        const d = await diagnose(pc, errors).catch(() => last && { ...last, iceConnectionState: 'failed', note: 'from the last snapshot' });
        if (!d) throw new Error('connection closed before any statistics');
        log('error', `ICE failed with ${who}. ${d.verdict[0]}`, summaryText(d));
        onFailure?.({ peer: who, time: Date.now(), ...d });
      } catch (error) { log('error', `ICE failed with ${who}; no stats`, error?.message); }
    };
    handle.report = report;
    pc.addEventListener('iceconnectionstatechange', () => {
      const state = pc.iceConnectionState;
      if (state === 'checking' || state === 'new') { snapshot(); watch(true); }
      if (state === 'connected' || state === 'completed' || state === 'closed') watch(false);
      if (state === 'failed') report();
      // Firefox may close the connection right after "failed": snapshot early.
      if (state === 'disconnected') diagnose(pc, errors).then(d => log('warn', `ICE disconnected with ${who}`, summaryText(d))).catch(() => {});
    });
  };
  attach();
  return handle;
}

// Self-test: which addresses can this browser offer with these ICE servers?
export function selfTest(iceServers, timeoutMs = 8000) {
  return new Promise(resolve => {
    if (typeof RTCPeerConnection === 'undefined') { resolve({ local: [], errors: ['RTCPeerConnection is not available (WebRTC disabled)'], verdict: ['WebRTC is disabled in this browser'] }); return; }
    const local = [], errors = [];
    let pc;
    const done = () => {
      clearTimeout(timer);
      try { pc.close(); } catch { /* closed */ }
      const v = verdict({ local, remote: [{ type: 'host' }], pairs: [], errors }).filter(x => !/other device|address pair/.test(x));
      resolve({ local, errors, verdict: v.length ? v : ['looks fine: local and public addresses offered'] });
    };
    const timer = setTimeout(done, timeoutMs);
    try {
      pc = new RTCPeerConnection({ iceServers });
      pc.createDataChannel('self-test');
      pc.onicecandidate = e => { if (!e.candidate) { done(); return; } const c = parseCandidate(e.candidate.candidate); if (c) local.push(c); };
      pc.onicecandidateerror = e => errors.push(`${e.url || '?'} ${e.errorCode || ''} ${e.errorText || ''}`.trim());
      pc.createOffer().then(o => pc.setLocalDescription(o)).catch(error => { errors.push(error.message); done(); });
    } catch (error) { errors.push(error.message); done(); }
  });
}
export const candidateText = describe;
