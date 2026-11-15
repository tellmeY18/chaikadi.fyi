// Settings → Developer options: live connection details, relay settings and
// the connection log. Everything stays on this device.
import { h, Component } from '../vendor/preact.module.js';
import htm from '../vendor/htm.module.js';
import { relayServers } from './config.js';
import { withExtraStun } from './p2p.js';
import { logs, logText, clearLogs, onLog } from './netlog.js';
import { t } from './strings.js';
import { Icon } from './components.js';

const html = htm.bind(h);
const ROUTE = { host: 'same network', srflx: 'direct (STUN)', prflx: 'direct', relay: 'relay (TURN)' };

// Can this device get a relay address from the TURN servers? (No peer needed.)
export function testRelay(iceServers, timeoutMs = 8000) {
  return new Promise(resolve => {
    if (typeof RTCPeerConnection === 'undefined') { resolve({ ok: false, error: 'WebRTC unavailable' }); return; }
    const started = Date.now();
    let pc;
    const done = result => { clearTimeout(timer); try { pc.close(); } catch { /* closed */ } resolve({ ...result, ms: Date.now() - started }); };
    const timer = setTimeout(() => done({ ok: false, error: 'no relay address within 8 s' }), timeoutMs);
    try {
      pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'relay' });
      pc.createDataChannel('relay-test');
      pc.onicecandidate = e => { if (e.candidate && / typ relay /.test(e.candidate.candidate)) done({ ok: true, candidate: e.candidate.candidate.split(' ').slice(4, 8).join(' ') }); };
      pc.onicecandidateerror = e => { if (e.errorCode && e.errorCode !== 701) done({ ok: false, error: `${e.url || ''} ${e.errorCode} ${e.errorText || ''}`.trim() }); };
      pc.createOffer().then(o => pc.setLocalDescription(o)).catch(error => done({ ok: false, error: error.message }));
    } catch (error) { done({ ok: false, error: error.message }); }
  });
}

export class DevOptions extends Component {
  constructor(props) { super(props); this.state = { details: null, log: logs(), test: null, testing: false, custom: props.view.preferences.dev?.custom || { urls: '', username: '', credential: '' } }; }
  componentDidMount() {
    this.off = onLog(() => this.setState({ log: logs() }));
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 2000);
  }
  componentWillUnmount() { this.off?.(); clearInterval(this.timer); }
  async refresh() {
    const net = this.props.store.network;
    await net.refreshRoutes?.().catch(() => {});
    this.setState({ details: net.details ? net.details() : null });
  }
  async copy() {
    const d = this.state.details, v = this.props.view;
    const text = `Chaikadi connection report ${new Date().toISOString()}\n${navigator.userAgent}\nonline: ${navigator.onLine}\n${JSON.stringify({ ...d, hostOnline: v.hostOnline, pending: v.pending, status: v.status }, null, 2)}\n\n${logText()}`;
    try { await navigator.clipboard.writeText(text); this.props.store.toast(t('copied')); } catch { this.props.store.notice(t('devCopyFailed')); }
  }
  async test() {
    const dev = this.props.view.preferences.dev || {};
    this.setState({ testing: true, test: null });
    const result = await testRelay(withExtraStun(relayServers(dev)).filter(s => [].concat(s.urls).some(u => /^turns?:/.test(u))));
    this.setState({ testing: false, test: result });
  }
  render({ view, store }) {
    const dev = view.preferences.dev || {}, relay = dev.relay === 'custom' ? 'custom' : 'off';
    const { details: d, log, test, testing, custom } = this.state;
    const set = patch => store.devOptions(patch);
    const row = (k, v) => html`<tr><th scope="row">${k}</th><td>${v}</td></tr>`;
    return html`<div class="stack dev-options">
      <p class="muted">${t('devIntro')}</p>
      <fieldset><legend>${t('devVerbose')}</legend><div class="segmented">${[[true, 'on'], [false, 'off']].map(([value, key]) => html`<button type="button" aria-pressed=${!!dev.verbose === value} onClick=${() => set({ verbose: value })}>${!!dev.verbose === value && html`<${Icon} name="check" size=${20}/>`}${t(key)}</button>`)}</div><small>${t('devVerboseHint')}</small></fieldset>

      <h3>${t('devConnection')}</h3>
      ${!d || !d.code ? html`<p class="muted">${t('devNoRoom')}</p>` : html`<table class="dev-table"><tbody>
        ${row(t('devRole'), `${d.role} · ${d.code}`)}
        ${row(t('devStatus'), view.status || '')}
        ${row(t('devSignaling'), d.signaling ? `${d.signaling.open ? 'open' : d.signaling.disconnected ? 'disconnected' : d.signaling.destroyed ? 'destroyed' : 'connecting'} · ${d.signaling.server} · ${d.signaling.id || '—'}` : 'none')}
        ${row(t('devRetry'), `${d.retryPending ? 'pending' : 'idle'} · attempt ${d.attempt}${d.reclaimingCode ? ' · reclaiming code' : ''}${d.retiredPeers ? ` · ${d.retiredPeers} retired` : ''}`)}
        ${row(t('devNetwork'), `${navigator.onLine ? 'online' : 'offline'}${navigator.connection?.effectiveType ? ` · ${navigator.connection.effectiveType}` : ''}`)}
        ${row(t('devPolicy'), d.iceTransportPolicy === 'relay' ? t('devRelayOnly') : t('devAllRoutes'))}
        ${row(t('devPending'), String(view.pending || 0))}
      </tbody></table>
      <h3>${t('devLinks', d.links.length)}</h3>
      ${!d.links.length ? html`<p class="muted">${t('devNoLinks')}</p>` : html`<ul class="dev-links">${d.links.map(l => html`<li key=${l.id}>
        <strong>${l.peer || l.id}</strong>${l.authenticated ? ' · ✓' : ''}
        <span>${t('devLinkLine', l.ice, l.openFor, l.quietFor)}</span>
        <span>${l.route ? `${ROUTE[l.route.local] || l.route.local} → ${ROUTE[l.route.remote] || l.route.remote}${l.route.protocol ? ` · ${l.route.protocol}` : ''}${l.route.rttMs !== null ? ` · ${l.route.rttMs} ms` : ''}` : t('devRouteUnknown')}</span></li>`)}</ul>`}`}

      <fieldset><legend>${t('devRelay')}</legend><div class="choice-row">${[['off', 'devRelayOff'], ['custom', 'devRelayCustom']].map(([value, key]) => html`<button type="button" aria-pressed=${relay === value} onClick=${() => set({ relay: value })}>${t(key)}</button>`)}</div>
        <small>${t(relay === 'custom' ? 'devRelayCustomHint' : 'devRelayOffHint')}</small></fieldset>
      ${relay === 'custom' && html`<form class="stack" onSubmit=${e => { e.preventDefault(); set({ custom }); store.toast(t('devSaved')); }}>
        <label>${t('devTurnUrls')}<input value=${custom.urls} placeholder="turn:turn.example.com:3478, turns:turn.example.com:443?transport=tcp" autocomplete="off" spellcheck=${false} onInput=${e => this.setState({ custom: { ...custom, urls: e.currentTarget.value } })}/></label>
        <label>${t('devTurnUser')}<input value=${custom.username} autocomplete="off" spellcheck=${false} onInput=${e => this.setState({ custom: { ...custom, username: e.currentTarget.value } })}/></label>
        <label>${t('devTurnPass')}<input type="password" value=${custom.credential} autocomplete="off" onInput=${e => this.setState({ custom: { ...custom, credential: e.currentTarget.value } })}/></label>
        <button>${t('save')}</button></form>`}
      <fieldset><legend>${t('devForceRelay')}</legend><div class="segmented">${[[true, 'on'], [false, 'off']].map(([value, key]) => html`<button type="button" aria-pressed=${!!dev.forceRelay === value} disabled=${relay === 'off' && value} onClick=${() => set({ forceRelay: value })}>${!!dev.forceRelay === value && html`<${Icon} name="check" size=${20}/>`}${t(key)}</button>`)}</div><small>${t('devForceRelayHint')}</small></fieldset>
      <button type="button" disabled=${testing || relay === 'off'} onClick=${() => this.test()}>${testing ? t('devTesting') : t('devTestRelay')}</button>
      ${test && html`<p class=${`banner ${test.ok ? 'info' : 'dashed'}`} role="status"><${Icon} name=${test.ok ? 'check' : 'alert'}/><span>${test.ok ? t('devRelayOk', test.ms, test.candidate) : t('devRelayFail', test.error)}</span></p>`}

      <h3>${t('devLog', log.length)}</h3>
      <pre class="dev-log" aria-live="off">${log.slice(-200).map(e => `${new Date(e.time).toISOString().slice(11, 19)} ${e.level.toUpperCase().padEnd(5)} ${e.message}${e.detail ? ` ${e.detail}` : ''}`).join('\n') || t('devLogEmpty')}</pre>
      <div class="actions two"><button type="button" class="outbound" onClick=${() => this.copy()}><${Icon} name="copy"/>${t('devCopy')}</button><button type="button" class="danger" onClick=${() => clearLogs()}>${t('devClear')}</button></div>
    </div>`;
  }
}
