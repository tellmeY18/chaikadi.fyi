import { h, render, Component } from '../vendor/preact.module.js';
import htm from '../vendor/htm.module.js';
import { CATEGORIES, uid, funGroup, validCode } from './config.js';
import { costs, debts } from './state.js';
import { drawQR, scanQR } from './qr.js';

const html = htm.bind(h);
const amount = (n, currency = '₹') => `${currency}${(n / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fields = event => Object.fromEntries(new FormData(event.currentTarget));
function cents(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value || '0'))) throw new Error('Enter a non-negative amount with up to two decimal places.');
  return Math.round(Number(value || 0) * 100);
}
const formatDate = date => new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const memberName = (s, id) => s.members.find(m => m.id === id)?.name || 'Former member';

export function orderText(s) {
  const c = s.group.currency, totals = costs(s);
  const lines = [`${s.group.name} — tea / food order`, s.group.status === 'locked' ? 'LOCKED' : 'DRAFT', ''];
  for (const item of s.menu) {
    const qty = s.picks.filter(p => p.itemId === item.id).reduce((n, p) => n + p.qty, 0);
    if (qty) lines.push(`${qty} × ${item.name} — ${amount(qty * item.price, c)}`);
  }
  lines.push('', 'Per person:');
  for (const person of totals.people.filter(p => p.participating)) {
    lines.push(`${person.name} — ${amount(person.subtotal, c)}`);
    for (const pick of s.picks.filter(p => p.memberId === person.id)) {
      lines.push(`  ${pick.qty} × ${s.menu.find(i => i.id === pick.itemId)?.name || 'Removed item'}${pick.note ? ` (${pick.note})` : ''}`);
    }
  }
  lines.push('', `Estimated total: ${amount(totals.estimatedTotal, c)}`, `Orderer: ${memberName(s, s.group.ordererId)}`);
  if (s.round.actualTotal !== null) lines.push(`Actual bill: ${amount(s.round.actualTotal, c)}`);
  return lines.join('\n');
}

class QR extends Component {
  componentDidMount() { this.draw(); }
  componentDidUpdate(previous) { if (previous.text !== this.props.text) this.draw(); }
  draw() { drawQR(this.base, this.props.text); }
  render() { return html`<div class="qr"></div>`; }
}

class Scanner extends Component {
  componentDidMount() {
    scanQR(this.video, this.props.onResult, this.props.onError).then(stop => {
      if (this.closed) stop(); else this.stop = stop;
    });
  }
  componentWillUnmount() { this.closed = true; this.stop?.(); }
  render() { return html`<div><video ref=${el => this.video = el} autoplay playsinline muted></video><p class="muted">Point your camera at the other device’s QR.</p></div>`; }
}

class Pairing extends Component {
  constructor(props) { super(props); this.state = { scan: false, input: '' }; }
  componentDidMount() { this.dialog.showModal(); }
  async copy(text, store) {
    try { await navigator.clipboard.writeText(text); store.notice('Copied.'); }
    catch {
      // Keep clipboard fallback inside the modal's focus/inert boundary.
      const field = this.dialog.querySelector('textarea[readonly]');
      field?.focus(); field?.select();
      store.notice('Pairing text selected. Use your device’s Copy command.');
    }
  }
  render({ view, store, run }) {
    const p = view.pairing;
    const accept = text => { this.setState({ scan: false, input: text }); run(() => store.pair(text)); };
    return html`<dialog ref=${el => this.dialog = el} onCancel=${e => { e.preventDefault(); store.closeManual(); }} aria-labelledby="pair-title">
      <header class="row"><h2 id="pair-title">Manual pairing</h2><button class="quiet" onClick=${() => store.closeManual()} aria-label="Close manual pairing">Close</button></header>
      ${view.notice && html`<p class="warning" role="status">${view.notice}</p>`}
      <p>Both devices must be on the same local Wi-Fi. Internet is not needed. Keep this panel open until connected.</p>
      <p class="muted">One offer pairs one person. Pair each additional person separately.</p>
      ${p.step === 'host-start' && html`<button disabled=${p.busy} onClick=${() => run(() => store.offer())}>${p.busy ? 'Gathering local candidates…' : 'Create offer · add person'}</button>`}
      ${p.step === 'host-answer' && html`<h3>1. Send this offer to the other person</h3>`}
      ${p.step === 'join-offer' && html`<h3>1. Scan or paste the host’s offer</h3>`}
      ${p.step === 'join-answer' && html`<h3>2. Send this answer back to the host</h3>`}
      ${p.text && html`<${QR} text=${p.text}/><label>Pairing text<textarea readonly rows="4" value=${p.text} onFocus=${e => e.currentTarget.select()}></textarea></label>
        <div class="actions"><button onClick=${() => this.copy(p.text, store)}>Copy text</button><button class="secondary" onClick=${() => store.compatibility()}>Compatibility text</button></div>
        <p class="muted">Compatibility text works on browsers without compression support. Large codes use text only.</p>`}
      ${['host-answer', 'join-offer'].includes(p.step) && html`<section>
        ${p.step === 'host-answer' && html`<h3>2. Scan or paste their answer</h3>`}
        <button class="secondary" disabled=${p.busy} onClick=${() => this.setState({ scan: !this.state.scan })}>${this.state.scan ? 'Stop camera' : 'Scan QR with camera'}</button>
        ${this.state.scan && html`<${Scanner} onResult=${accept} onError=${message => { this.setState({ scan: false }); store.notice(message); }}/>`}
        <form onSubmit=${e => { e.preventDefault(); accept(this.state.input); }}>
          <label>Paste ${p.step === 'host-answer' ? 'answer' : 'offer'}<textarea required rows="4" value=${this.state.input} onInput=${e => this.setState({ input: e.currentTarget.value })} placeholder="CK1.…" autocapitalize="off" spellcheck=${false}></textarea></label>
          <button disabled=${p.busy}>${p.busy ? 'Gathering local candidates…' : p.step === 'host-answer' ? 'Connect person' : 'Create answer'}</button>
        </form>
      </section>`}
      ${['waiting', 'join-answer'].includes(p.step) && html`<p role="status">${p.connected ? 'Connected! You can close this panel.' : 'Waiting for the local connection… Check the member list once connected.'}</p>`}
      <details><summary>Pairing not working?</summary><p>Allow camera and local-network access. Use the same Wi-Fi and turn off guest/client isolation. Keep Wi-Fi on when testing without internet. Some iOS versions hide ICE addresses with mDNS names; those names may not resolve on your network. Try another shared Wi-Fi or room-code mode with internet. A failed or refreshed manual connection needs a new offer and answer.</p></details>
    </dialog>`;
  }
}

class App extends Component {
  constructor(props) {
    super(props); this.state = { view: props.store.view(), edit: null, scanRoom: false, copyFallback: null, homeMode: 'create' };
    this.run = fn => Promise.resolve().then(fn).catch(error => props.store.notice(error.message || 'Something went wrong. Please try again.'));
    this.copyText = async text => {
      try { await navigator.clipboard.writeText(text); props.store.notice('Copied.'); }
      catch { this.setState({ copyFallback: text }); }
    };
  }
  componentDidMount() { this.unsubscribe = this.props.store.subscribe(view => this.setState({ view })); }
  componentWillUnmount() { this.unsubscribe?.(); }
  action(type, payload) { return this.props.store.dispatch(type, payload); }
  home(v) {
    const store = this.props.store;
    const joinMode = this.state.homeMode === 'join' || !!v.targetCode || v.role === 'member';
    const groupName = this.state.groupName ?? (this.state.groupName = funGroup());
    // Shared name field with a dice button: prefilled, never required to type.
    const nameField = html`<label>Your name<span class="with-dice"><input key=${v.identity.name} aria-label="Your name" name="name" required maxlength="30" defaultValue=${v.identity.name} autocomplete="nickname"/><button type="button" class="secondary dice" aria-label="Pick another name" onClick=${() => store.rerollName()}>🎲</button></span></label>`;
    const joinNow = code => this.run(() => store.join(code, document.querySelector('.home input[name="name"]')?.value || v.identity.name));
    return html`<section class="home">
      <p class="eyebrow">A small break. A shared order.</p><h1>What are we<br/>having today?</h1>
      <div class="segmented" aria-label="Create or join"><button class=${!joinMode ? 'active' : ''} onClick=${() => { this.run(() => store.resetConnection()); this.setState({ homeMode: 'create' }); }}>Start a break</button><button class=${joinMode ? 'active' : ''} onClick=${() => this.setState({ homeMode: 'join' })}>Join one</button></div>
      ${joinMode ? html`<form class="card stack" key="join" onSubmit=${e => { e.preventDefault(); const f = fields(e); this.run(() => store.join(f.code, f.name, e.submitter?.value === 'manual')); }}>
        ${v.role === 'member' && v.targetCode ? html`<p role="status"><strong>Joining ${v.targetCode}…</strong> ${v.status}</p>` : html`<p class="muted">Type the 4-letter code. You’ll join as soon as it’s complete.</p>`}
        <label>Room code<input name="code" defaultValue=${v.targetCode} maxlength="4" placeholder="ABCD" autocapitalize="characters" autocorrect="off" autocomplete="off" spellcheck=${false} class="code-input" autofocus=${!v.targetCode}
          onInput=${e => { const el = e.currentTarget; el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (validCode(el.value)) joinNow(el.value); }}/></label>
        ${nameField}
        <button>Join</button>
        <div class="actions"><button type="button" class="secondary" onClick=${() => this.setState({ scanRoom: !this.state.scanRoom })}>${this.state.scanRoom ? 'Stop camera' : 'Scan QR'}</button><button type="submit" value="manual" class="quiet">No internet?</button></div>
        ${this.state.scanRoom && html`<${Scanner} onResult=${text => {
          try {
            const url = new URL(text); const code = url.searchParams.get('room') || '';
            if (![location.hostname, 'chaikadi.fyi', 'chaikadi.pages.dev'].includes(url.hostname) || !validCode(code)) throw new Error();
            this.setState({ scanRoom: false }); joinNow(code);
          } catch { store.notice('That QR is not a Chaikadi room link. Use “No internet?” for pairing codes.'); }
        }} onError=${m => { this.setState({ scanRoom: false }); store.notice(m); }}/>`}
      </form>` : html`<form class="card stack" key="create" onSubmit=${e => { e.preventDefault(); const f = fields(e); this.run(() => store.create(f.group, f.name, e.submitter?.value === 'manual')); }}>
        <button class="big">Start a tea break →</button>
        <p class="muted">Menu comes pre-filled with chai & snacks. Change anything later.</p>
        <details><summary>Names: ${groupName} · ${v.identity.name}</summary><div class="stack">
          <label>Group name<span class="with-dice"><input key=${groupName} aria-label="Group name" name="group" required maxlength="60" defaultValue=${groupName}/><button type="button" class="secondary dice" aria-label="Pick another group name" onClick=${() => this.setState({ groupName: funGroup() })}>🎲</button></span></label>
          ${nameField}
          <button type="submit" value="manual" class="quiet">No internet? Start offline</button>
        </div></details>
      </form>`}
      <details class="card"><summary>Install & use offline</summary><p>iPhone: Safari → Share → Add to Home Screen. Android: menu → Install app. Room codes need internet to connect; “No internet?” pairs on shared Wi-Fi.</p></details>
    </section>`;
  }
  lobby(v) {
    const s = v.state, host = v.role === 'host', store = this.props.store;
    const link = `${location.origin}/?room=${s.group.roomCode}`;
    return html`<section><div class="section-heading"><p class="eyebrow">YOUR TABLE</p><h1>${s.group.name}</h1><p>${s.members.length}/15 people · ${s.group.status === 'open' ? 'Picks are open' : 'Order locked'}</p></div>
      <div class="card share-card"><h2>Come, have a chai.</h2><p>Share this room code. Keep the host’s app open.</p><div class="room-code" aria-label=${`Room code ${s.group.roomCode}`}>${s.group.roomCode}</div>
        ${host && !v.roomReady && html`<p class="warning">Room signaling is not ready. Retry or use manual pairing.</p>`}
        <${QR} text=${link}/><a class="share-link" href=${link}>${link}</a><div class="actions"><button onClick=${() => this.copyText(link)}>Copy invite link</button><button class="secondary" onClick=${() => store.showManual()}>${host ? 'Add person manually' : 'Pair with host manually'}</button></div>
      </div>
      <div class="card"><h2>At the table</h2><ul class="people">${s.members.map(m => html`<li key=${m.id}><div><strong>${m.name}${m.id === v.identity.id ? ' (you)' : ''}</strong><small>${m.id === s.group.hostId ? 'Host · ' : ''}${m.id === s.group.ordererId ? 'Orderer · ' : ''}<span class=${`presence ${m.online && (host || v.hostOnline) ? 'online' : ''}`}></span>${m.online && (host || v.hostOnline) ? 'Online' : 'Offline'}</small></div>
        ${host && html`<div class="actions compact">${m.id !== s.group.ordererId && html`<button class="secondary" onClick=${() => this.action('orderer.set', { id: m.id })}>Make orderer</button>`}${m.id !== s.group.hostId && html`<button class="quiet danger" disabled=${s.group.status !== 'open'} onClick=${() => { if (confirm(`Remove ${m.name} and their current picks? Past rounds are kept.`)) this.action('member.remove', { id: m.id }); }}>Remove</button>`}</div>`}
      </li>`)}</ul></div><button onClick=${() => store.setTab('menu')}>${s.menu.length ? 'See the menu' : 'Build your menu'} →</button>
    </section>`;
  }
  menu(v) {
    const s = v.state, locked = s.group.status !== 'open';
    const edit = s.menu.find(i => i.id === this.state.edit);
    return html`<section><div class="section-heading"><p class="eyebrow">SOMETHING FOR EVERYONE</p><h1>The menu</h1><p>Anyone can edit. Prices are per item.</p></div>
      <button class="secondary" disabled=${locked} onClick=${() => this.run(() => this.props.store.presets())}>＋ Add tea-break presets</button>
      ${locked && html`<p class="warning">Menu and picks are frozen while the order is locked.</p>`}
      ${CATEGORIES.map(category => {
        const items = s.menu.filter(i => i.category === category);
        return items.length > 0 && html`<div class="card"><h2>${category}</h2><ul class="item-list">${items.map(item => html`<li key=${item.id}><div><strong>${item.name}</strong><small>${amount(item.price, s.group.currency)}${item.price === 0 ? ' · price not set / free' : ''}</small></div><div class="actions compact"><button class="secondary" disabled=${locked} onClick=${() => this.setState({ edit: item.id })}>Edit</button><button class="quiet danger" disabled=${locked} onClick=${() => { if (confirm(`Delete ${item.name}? This also removes current picks for it.`)) this.action('menu.delete', { id: item.id }); }}>Delete</button></div></li>`)}</ul></div>`;
      })}
      <form class="card stack" key=${edit?.id || 'new-item'} onSubmit=${e => {
        e.preventDefault(); const f = fields(e), form = e.currentTarget;
        this.run(async () => { await this.action('menu.upsert', { id: edit?.id || uid(), name: f.name, price: cents(f.price), category: f.category }); this.setState({ edit: null }); if (!edit) form.reset(); });
      }}><h2>${edit ? 'Edit item' : 'Add an item'}</h2><label>Item name<input name="name" maxlength="60" required defaultValue=${edit?.name || ''} disabled=${locked}/></label>
        <div class="form-grid"><label>Price (${s.group.currency})<input name="price" type="number" min="0" max="1000000" step="0.01" inputmode="decimal" placeholder="0.00" defaultValue=${edit ? (edit.price / 100).toFixed(2) : ''} disabled=${locked}/></label><label>Category<select name="category" defaultValue=${edit?.category || 'Tea'} disabled=${locked}>${CATEGORIES.map(c => html`<option value=${c}>${c}</option>`)}</select></label></div>
        <div class="actions"><button disabled=${locked}>${edit ? 'Save changes' : 'Add to menu'}</button>${edit && html`<button type="button" class="quiet" onClick=${() => this.setState({ edit: null })}>Cancel edit</button>`}</div>
      </form></section>`;
  }
  picks(v) {
    const s = v.state, locked = s.group.status !== 'open';
    const mine = s.picks.filter(p => p.memberId === v.identity.id);
    const adjust = (itemId, delta) => this.props.store.changePick(itemId, delta);
    const suggested = s.menu.find(i => i.id === v.suggested);
    return html`<section><div class="section-heading"><p class="eyebrow">YOUR BREAK, YOUR PICK</p><h1>What sounds good?</h1><p>${locked ? 'The order is locked. Your picks are saved.' : 'Choose items and quantities. No voting needed.'}</p></div>
      <div class="card helper"><div class="row"><div><h2>Can’t decide?</h2><p class="muted">A little nudge, just for you.</p></div><button class="secondary" disabled=${locked || v.shuffling || !s.menu.length} onClick=${() => this.props.store.suggest()}>${suggested ? 'Re-roll' : 'Surprise me'}</button></div>
        ${suggested && html`<div class=${`suggestion ${v.shuffling ? 'shuffle' : ''}`} aria-live="polite"><strong>${suggested.name}</strong><button disabled=${locked || v.shuffling} onClick=${() => adjust(suggested.id, 1)}>Add 1</button></div>`}
      </div>
      ${!s.menu.length && html`<div class="empty"><p>No items yet. Add a few favourites to the shared menu.</p><button onClick=${() => this.props.store.setTab('menu')}>Add menu items</button></div>`}
      ${CATEGORIES.map(category => {
        const items = s.menu.filter(i => i.category === category);
        return items.length > 0 && html`<h2 class="category-heading">${category}</h2>${items.map(item => {
          const pick = mine.find(p => p.itemId === item.id), qty = pick?.qty || 0;
          return html`<article class=${`card pick-card ${qty ? 'selected' : ''}`} key=${item.id}><div class="row"><div><h3>${item.name}</h3><span class="muted">${amount(item.price, s.group.currency)}</span></div><div class="stepper"><button class="secondary" aria-label=${`Remove one ${item.name}`} disabled=${locked || qty === 0} onClick=${() => adjust(item.id, -1)}>−</button><output aria-label=${`${item.name} quantity`}>${qty}</output><button aria-label=${`Add one ${item.name}`} disabled=${locked || qty === 99} onClick=${() => adjust(item.id, 1)}>＋</button></div></div>
            ${qty > 0 && html`<form class="note-form" onSubmit=${e => { e.preventDefault(); this.props.store.saveNote(item.id, fields(e).note); }}><label>Item note<input key=${pick.note} name="note" maxlength="160" defaultValue=${pick.note} placeholder="Less sugar, extra chutney…" disabled=${locked}/></label><button class="secondary" disabled=${locked}>Save note</button></form>`}
          </article>`;
        })}`;
      })}
      <div class="total-bar"><span>Your subtotal</span><strong>${amount(costs(s).people.find(p => p.id === v.identity.id)?.subtotal || 0, s.group.currency)}</strong></div>
    </section>`;
  }
  order(v) {
    const s = v.state, totals = costs(s), orderer = s.group.ordererId === v.identity.id;
    return html`<section><div class="section-heading"><p class="eyebrow">ALL TOGETHER NOW</p><h1>The order</h1><p>${memberName(s, s.group.ordererId)} is placing this order. ${s.group.status === 'locked' ? 'Picks are locked.' : 'Picks are still open.'}</p></div>
      <div class="card"><h2>Consolidated order</h2>${!s.picks.length && html`<p class="muted">No picks yet.</p>`}<ul class="item-list">${s.menu.map(item => {
        const qty = s.picks.filter(p => p.itemId === item.id).reduce((n, p) => n + p.qty, 0);
        return qty > 0 && html`<li key=${item.id}><span><strong>${qty} ×</strong> ${item.name}</span><strong>${amount(qty * item.price, s.group.currency)}</strong></li>`;
      })}</ul><div class="total-bar"><span>Estimated total</span><strong>${amount(totals.estimatedTotal, s.group.currency)}</strong></div>
        <button class="secondary" onClick=${() => this.copyText(orderText(s))}>Copy order as text</button>
      </div>
      ${s.members.map(person => {
        const picks = s.picks.filter(p => p.memberId === person.id);
        return picks.length > 0 && html`<div class="card" key=${person.id}><h2>${person.name}</h2><ul class="plain-list">${picks.map(p => html`<li key=${p.itemId}>${p.qty} × ${s.menu.find(i => i.id === p.itemId)?.name}${p.note && html`<small>Note: ${p.note}</small>`}</li>`)}</ul></div>`;
      })}
      ${orderer && html`<div class="card"><h2>You’re the orderer</h2><p>Copy the order and place it with your shop. Chaikadi does not send orders or take payments.</p>
        ${s.group.status === 'open' ? html`<button disabled=${!s.picks.length} onClick=${() => this.action('order.lock', {})}>Lock & place order</button>` : html`<div class="actions"><button onClick=${() => this.props.store.setTab('costs')}>Enter the actual bill →</button><button class="secondary" onClick=${() => { if (confirm('Unlock picks? The actual bill and current payment marks will be cleared.')) this.action('order.unlock', {}); }}>Unlock order</button></div>`}
      </div>`}
    </section>`;
  }
  costs(v) {
    const s = v.state, totals = costs(s), orderer = s.group.ordererId === v.identity.id, locked = s.group.status === 'locked';
    return html`<section><div class="section-heading"><p class="eyebrow">KEEP IT SQUARE</p><h1>Split the bill</h1><p>Estimated ${amount(totals.estimatedTotal, s.group.currency)}${s.round.actualTotal !== null ? ` · Actual ${amount(s.round.actualTotal, s.group.currency)}` : ' · Actual bill not entered'}</p></div>
      ${orderer && html`<form class="card stack" key=${s.round.id} onSubmit=${e => { e.preventDefault(); const f = fields(e); this.run(() => this.action('bill.set', { actualTotal: cents(f.bill), splitMode: f.split })); }}><h2>Actual bill</h2><p class="muted">Include delivery and tax. Only people with picks share the difference. Saving a new bill clears payment marks.</p><label>Bill total (${s.group.currency})<input name="bill" required type="number" min="0" max="1000000" step="0.01" inputmode="decimal" defaultValue=${s.round.actualTotal === null ? '' : (s.round.actualTotal / 100).toFixed(2)} disabled=${!locked}/></label><label>Split the difference<select name="split" defaultValue=${s.round.splitMode} disabled=${!locked}><option value="equal">Equally among people with picks</option><option value="proportional">Proportionally to each subtotal</option></select></label><button disabled=${!locked}>Save actual bill</button>${!locked && html`<p class="muted">Lock the order first to enter a bill or mark payments.</p>`}</form>`}
      <div class="card"><h2>Who owes what</h2><p class="muted">${s.round.actualTotal === null ? 'Amounts below are estimates.' : `Difference: ${amount(s.round.actualTotal - totals.estimatedTotal, s.group.currency)} · ${s.round.splitMode} split`}</p>
        <ul class="people">${totals.people.map(person => html`<li key=${person.id}><div><strong>${person.name}</strong><small>Items: ${amount(person.subtotal, s.group.currency)}${!person.participating ? ' · No picks' : ''}</small></div><div class="payment"><strong>${amount(person.owed, s.group.currency)}</strong>${person.id === s.group.ordererId ? html`<small>Orderer’s own share</small>` : orderer && locked && person.participating ? html`<button class=${s.round.payments[person.id] ? 'paid secondary' : 'secondary'} onClick=${() => this.action('payment.set', { id: person.id, paid: !s.round.payments[person.id] })}>${s.round.payments[person.id] ? 'Paid ✓' : 'Not paid'}</button>` : html`<small>${person.participating ? s.round.payments[person.id] ? 'Paid ✓' : 'Not paid' : '—'}</small>`}</div></li>`)}</ul>
        <div class="total-bar"><span>${s.round.actualTotal === null ? 'Estimated total' : 'Final total'}</span><strong>${amount(totals.actualTotal, s.group.currency)}</strong></div>
      </div>
      ${orderer && locked && html`<button onClick=${() => { if (confirm('Archive this round and start fresh? Menu and members stay. Unpaid amounts remain in History.')) this.action('round.finish', { nextRoundId: uid(), date: new Date().toISOString() }); }}>Finish round</button>`}
    </section>`;
  }
  history(v) {
    const s = v.state, tally = debts(s);
    return html`<section><div class="section-heading"><p class="eyebrow">BREAKS GONE BY</p><h1>History</h1><p>${s.history.length} finished round${s.history.length === 1 ? '' : 's'} · stored on this device</p></div>
      <div class="card"><h2>Outstanding across rounds</h2>${!tally.length ? html`<p class="muted">All settled. No outstanding amounts.</p>` : html`<ul class="item-list">${tally.map(d => html`<li><span>${d.name} → ${d.orderer}</span><strong>${amount(d.amount, d.currency)}</strong></li>`)}</ul>`}</div>
      ${[...s.history].reverse().map(round => html`<details class="card" key=${round.id}><summary><strong>${formatDate(round.date)}</strong><span>${amount(round.actualTotal ?? round.estimatedTotal, round.currency)}${round.actualTotal === null ? ' estimated' : ''}</span></summary><p>Estimated: ${amount(round.estimatedTotal, round.currency)} · Actual: ${round.actualTotal === null ? 'not entered' : amount(round.actualTotal, round.currency)} · ${round.splitMode} difference split</p><p>Orderer: ${round.members.find(m => m.id === round.ordererId)?.name}</p>
        <ul class="people">${round.amounts.filter(p => p.owed || round.picks.some(pick => pick.memberId === p.id)).map(person => html`<li key=${person.id}><div><strong>${person.name} · ${amount(person.owed, round.currency)}</strong>${round.picks.filter(p => p.memberId === person.id).map(p => html`<small>${p.qty} × ${round.menu.find(i => i.id === p.itemId)?.name}${p.note ? ` (${p.note})` : ''}</small>`)}</div><div>${person.id === round.ordererId ? html`<small>Own share</small>` : round.ordererId === v.identity.id ? html`<button class="secondary" onClick=${() => this.action('history.payment', { roundId: round.id, id: person.id, paid: !round.payments[person.id] })}>${round.payments[person.id] ? 'Paid ✓' : 'Not paid'}</button>` : html`<span>${round.payments[person.id] ? 'Paid ✓' : 'Not paid'}</span>`}</div></li>`)}</ul>
      </details>`)}
    </section>`;
  }
  settings(v) {
    const s = v.state, store = this.props.store;
    return html`<section><div class="section-heading"><p class="eyebrow">MAKE YOURSELF AT HOME</p><h1>Settings</h1></div>
      ${s && html`<form class="card stack" onSubmit=${e => { e.preventDefault(); this.action('member.rename', { name: fields(e).name }); }}><h2>Your display name</h2><label>Name<input name="name" required maxlength="30" defaultValue=${v.identity.name}/></label><button>Save name</button></form>`}
      ${v.role === 'host' && s && html`<form class="card stack" onSubmit=${e => { e.preventDefault(); this.action('group.currency', { currency: fields(e).currency }); }}><h2>Group currency</h2><label>Symbol or code<input name="currency" required maxlength="8" defaultValue=${s.group.currency}/></label><p class="muted">Two decimal places. Change the label while picks are open; this does not convert prices. Archived rounds keep their original currency.</p><button disabled=${s.group.status !== 'open'}>Save currency</button></form>`}
      <form class="card stack" onSubmit=${e => { e.preventDefault(); const f = fields(e); this.run(() => store.settings({ signaling: JSON.parse(f.signaling), iceServers: JSON.parse(f.ice) })); }}><h2>Connection settings</h2><p class="muted">Each device must use the same signaling server and key. Settings apply to new connections. Your custom servers will receive connection metadata.</p><label>PeerJS signaling (JSON)<textarea name="signaling" rows="7" required spellcheck=${false} defaultValue=${JSON.stringify(v.config.signaling, null, 2)}></textarea></label><label>ICE / STUN / TURN servers (JSON)<textarea name="ice" rows="7" required spellcheck=${false} defaultValue=${JSON.stringify(v.config.iceServers, null, 2)}></textarea></label><button>Save connection settings</button></form>
      <div class="card stack"><h2>Connections & local data</h2><button class="secondary" onClick=${() => store.startRoom()} disabled=${!v.role || !v.targetCode}>Retry room connection</button>${v.role === 'host' && html`<button class="secondary" onClick=${() => { if (confirm('Generate a new code? Disconnected members will need the new code or manual pairing.')) this.run(() => store.regenerateCode()); }}>Generate a new room code</button>`}
        ${s && html`<button class="secondary" onClick=${() => this.download(store.backup(), 'chaikadi-backup.json')}>Export local backup (JSON)</button><p class="muted">Backup includes this device’s private reconnect credentials. Keep it private. Readable JSON export; automatic import is not part of this MVP.</p><button class="danger secondary" onClick=${() => { if (confirm('Leave and clear this device’s group and history? Export first if needed. If you are host, the group cannot resume without your data.')) this.run(() => store.leave()); }}>Leave group & clear local group data</button>`}
      </div><details class="card"><summary>Install & offline help</summary><p>Safari on iPhone: Share → Add to Home Screen. Chrome on Android: menu → Install app / Add to Home screen. Visit online once; then the app shell and saved data work offline.</p><p>Disconnected members can edit locally; changes wait for the host to accept them. Locks, removed items, or finished rounds may reject queued changes. Manual connections need a new pairing after a connection loss. Keep the host foregrounded.</p><p>Browser site-data clearing removes local data. Export important history. One active tab per device/group is recommended.</p></details>
    </section>`;
  }
  download(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  render() {
    const v = this.state.view, store = this.props.store;
    const tabs = [['lobby', 'Group'], ['menu', 'Menu'], ['picks', 'My picks'], ['order', 'Order'], ['costs', 'Costs'], ['history', 'History']];
    return html`<div class="app-shell"><header class="app-header"><a class="brand" href="#" onClick=${e => { e.preventDefault(); store.setTab('lobby'); }}><img src="./icons/icon.svg" width="34" height="34" alt=""/><span>Chaikadi<span class="brand-dot">.</span></span></a><button class="quiet" aria-label="Settings" onClick=${() => store.setTab('settings')}>Settings</button></header>
      <main id="main">
        ${!v.ready ? html`<p role="status">Opening your table…</p>` : html`
          ${v.storageWarning && html`<div class="banner warning" role="alert">${v.storageWarning}</div>`}
          ${v.notice && html`<div class="banner notice" role="status"><span>${v.notice}</span><button class="quiet" aria-label="Dismiss message" onClick=${() => store.notice('')}>×</button></div>`}
          ${v.role && html`<div class="connection-status"><span class=${`presence ${v.hostOnline ? 'online' : ''}`}></span><span>${v.status}</span><button class="quiet" onClick=${() => store.showManual()}>Pair manually</button></div>`}
          ${v.role === 'member' && v.state && !v.hostOnline && html`<div class="banner warning" role="status"><strong>Host offline.</strong> Changes stay on this device until the host returns. ${v.pending} waiting.</div>`}
          ${v.pending > 0 && v.hostOnline && html`<p class="sync-status" role="status">Syncing ${v.pending} local change${v.pending === 1 ? '' : 's'}…</p>`}
          ${v.manualHint && !v.state && v.role && html`<div class="banner warning">No internet? Both devices can join the same Wi-Fi and pair manually.</div>`}
          ${v.tab === 'settings' ? this.settings(v) : !v.state ? this.home(v) : this[v.tab]?.(v)}
        `}
        <footer><span>Made for a little break.</span><a href="https://github.com/tellmeY18/chaikadi.fyi" target="_blank" rel="noopener">Source code (AGPL-3.0)</a><span id="offline-status">${v.offline || 'Offline app preparing…'}</span></footer>
      </main>
      ${v.state && html`<nav class="bottom-nav" aria-label="Main navigation">${tabs.map(([key, label]) => html`<button key=${key} class=${v.tab === key ? 'active' : ''} aria-current=${v.tab === key ? 'page' : undefined} onClick=${() => { this.setState({ edit: null }); store.setTab(key); window.scrollTo({ top: 0 }); }}>${label}</button>`)}</nav>`}
      ${v.pairing && html`<${Pairing} view=${v} store=${store} run=${this.run}/>`}
      ${this.state.copyFallback !== null && html`<div class="copy-fallback card" role="region" aria-label="Copy text manually"><h2>Select and copy</h2><textarea readonly rows="7" value=${this.state.copyFallback} onFocus=${e => e.currentTarget.select()}></textarea><button onClick=${() => this.setState({ copyFallback: null })}>Done</button></div>`}
    </div>`;
  }
}

export function mount(store, element) {
  element.replaceChildren(); // Preact must not retain the static loading fallback.
  render(html`<${App} store=${store}/>`, element);
}
