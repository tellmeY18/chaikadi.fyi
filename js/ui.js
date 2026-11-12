import { h, render, Component } from '../vendor/preact.module.js';
import htm from '../vendor/htm.module.js';
import { CATEGORIES, uid, funGroup, validCode } from './config.js';
import { costs, debts, activeItems, activeMenu } from './state.js';
import { drawQR, scanQR } from './qr.js';
import { t, money } from './strings.js';
import { Icon, Sheet, Modal, CodeInput, Empty } from './components.js';

const html = htm.bind(h);
const fields = event => Object.fromEntries(new FormData(event.currentTarget));
const date = value => new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const nameOf = (state, id) => state.members.find(m => m.id === id)?.name || t('formerMember');
const leader = (label, value) => html`<div class="leader"><span>${label}</span><span class="dots" aria-hidden="true"></span><strong class="amount">${value}</strong></div>`;
const heading = (title, description) => html`<div class="section-heading"><h1>${title}</h1>${description && html`<p>${description}</p>`}</div>`;
function cents(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value || '0'))) throw new Error(t('invalidAmount'));
  return Math.round(Number(value || 0) * 100);
}
const textLeader = (label, value) => `${label} ${'.'.repeat(Math.max(2, 36 - [...label].length - [...value].length))} ${value}`;
export function orderText(s) {
  const c = s.group.currency, totals = costs(s);
  const lines = [s.group.name, activeMenu(s)?.name || '', s.group.status === 'locked' ? t('locked') : t('open'), ''];
  for (const item of activeItems(s)) {
    const qty = s.picks.filter(p => p.itemId === item.id).reduce((n, p) => n + p.qty, 0);
    if (qty) lines.push(textLeader(`${item.name} x ${qty}`, money(qty * item.price, c)));
  }
  lines.push('====================================', textLeader(t('estimated'), money(totals.estimatedTotal, c)), '', t('perPerson'));
  for (const person of totals.people.filter(p => p.participating)) {
    lines.push(textLeader(person.name, money(person.subtotal, c)));
    for (const pick of s.picks.filter(p => p.memberId === person.id)) lines.push(`  ${pick.qty} x ${s.menu.find(i => i.id === pick.itemId)?.name}${pick.note ? ` (${pick.note})` : ''}`);
  }
  lines.push('', `${t('orderer')}: ${nameOf(s, s.group.ordererId)}`);
  if (s.round.actualTotal !== null) lines.push(textLeader(t('actual'), money(s.round.actualTotal, c)));
  return lines.join('\n');
}

class QR extends Component {
  componentDidMount() { drawQR(this.base, this.props.text); }
  componentDidUpdate(previous) { if (previous.text !== this.props.text) drawQR(this.base, this.props.text); }
  render() { return html`<div class="qr"></div>`; }
}
class Scanner extends Component {
  componentDidMount() {
    scanQR(this.video, this.props.onResult, this.props.onError).then(stop => { if (this.closed) stop(); else this.stop = stop; });
  }
  componentWillUnmount() { this.closed = true; this.stop?.(); }
  render() { return html`<div><video ref=${el => this.video = el} autoplay playsinline muted></video><p class="muted">${t('cameraHint')}</p></div>`; }
}
class Pairing extends Component {
  constructor(props) { super(props); this.state = { scan: false, input: '' }; }
  async copy(text) {
    try { await navigator.clipboard.writeText(text); this.props.store.toast(t('copied')); }
    catch { this.output?.focus(); this.output?.select(); this.props.store.toast(t('copyHint')); }
  }
  render({ view, store, run }) {
    const p = view.pairing;
    const accept = text => { this.setState({ scan: false, input: text }); run(() => store.pair(text)); };
    return html`<${Sheet} title=${t('pairingTitle')} onClose=${() => store.closeManual()}>
      ${view.notice && html`<p class="banner error" role="alert"><strong>${t('error')}</strong> ${view.notice}</p>`}
      ${view.toast && html`<p role="status">${view.toast}</p>`}
      <p>${t('pairingIntro')}</p><p class="muted">${t('oneOffer')}</p>
      ${p.step === 'host-start' && html`<button class="primary" disabled=${p.busy} onClick=${() => run(() => store.offer())}>${p.busy ? t('gathering') : t('createOffer')}</button>`}
      ${p.step === 'host-answer' && html`<h3>${t('offerStep')}</h3>`}
      ${p.step === 'join-offer' && html`<h3>${t('scanOffer')}</h3>`}
      ${p.step === 'join-answer' && html`<h3>${t('answerStep')}</h3>`}
      ${p.text && html`<${QR} text=${p.text}/><label>${t('pairingText')}<textarea ref=${el => this.output = el} readonly rows="4" value=${p.text} onFocus=${e => e.currentTarget.select()}></textarea></label>
        <div class="actions"><button onClick=${() => this.copy(p.text)}><${Icon} name="copy"/>${t('copy')}</button><button class="quiet" onClick=${() => store.compatibility()}>${t('compatibility')}</button></div><p class="muted">${t('compatibilityHelp')}</p>`}
      ${['host-answer', 'join-offer'].includes(p.step) && html`<section>
        ${p.step === 'host-answer' && html`<h3>${t('scanAnswer')}</h3>`}
        <button disabled=${p.busy} onClick=${() => this.setState({ scan: !this.state.scan })}><${Icon} name="qr"/>${this.state.scan ? t('stopCamera') : t('scanCamera')}</button>
        ${this.state.scan && html`<${Scanner} onResult=${accept} onError=${message => { this.setState({ scan: false }); store.notice(message); }}/>`}
        <form class="stack" onSubmit=${e => { e.preventDefault(); accept(this.state.input); }}>
          <label>${t(p.step === 'host-answer' ? 'pasteAnswer' : 'pasteOffer')}<textarea required rows="4" value=${this.state.input} onInput=${e => this.setState({ input: e.currentTarget.value })} placeholder="CK1.…" autocapitalize="off" spellcheck=${false}></textarea></label>
          <button class="primary" disabled=${p.busy}>${p.busy ? t('gathering') : t(p.step === 'host-answer' ? 'connectPerson' : 'createAnswer')}</button>
        </form></section>`}
      ${['waiting', 'join-answer'].includes(p.step) && html`<p role="status">${t(p.connected ? 'pairingConnected' : 'pairingWaiting')}</p>`}
      <details><summary>${t('pairingTrouble')}</summary><p>${t('pairingTips')}</p></details>
    <//>`;
  }
}

class MenuScan extends Component {
  constructor(props) { super(props); this.state = { busy: false, progress: 0, label: '', result: null, error: '' }; }
  componentDidMount() { import('./ingest.js').then(m => m.prefetchOCR()).catch(() => {}); }
  componentWillUnmount() { this.closed = true; }
  async scan(file) {
    if (!file || this.state.busy) return;
    this.setState({ busy: true, progress: 0, label: t('preparing'), result: null, error: '' });
    try {
      const { extractMenu } = await import('./ingest.js');
      const result = await extractMenu(file, { onProgress: (progress, label) => { if (!this.closed) this.setState({ progress, label }); } });
      if (this.closed) return;
      const known = new Set(this.props.state.menu.filter(i => i.menuId === this.props.menuId).map(i => i.name.normalize('NFKC').toLowerCase()));
      result.items = result.items.map((item, key) => ({ ...item, priceText: String(item.price / 100), key, keep: true, exists: known.has(item.name.normalize('NFKC').toLowerCase()) }));
      this.setState({ busy: false, result, error: result.items.length ? '' : t('scanEmpty') });
    } catch (error) { if (!this.closed) this.setState({ busy: false, error: error.message || t('scanFailed') }); }
  }
  update(key, patch) { this.setState({ result: { ...this.state.result, items: this.state.result.items.map(i => i.key === key ? { ...i, ...patch } : i) } }); }
  async save() {
    this.setState({ busy: true, error: '' });
    try {
      const items = this.state.result.items.filter(i => i.keep).map(i => ({ ...i, price: cents(i.priceText) }));
      const { added, updated, menuId } = await this.props.store.importMenu(items, { menuId: this.props.menuId, title: this.state.result.title });
      if (!menuId) throw new Error(t('scanFailed'));
      const name = this.props.store.view().state.menus.find(m => m.id === menuId)?.name || t('menu');
      this.props.store.toast(t('savedImport', name, added, updated));
      this.props.onSaved(menuId);
    } catch (error) { this.setState({ error: error.message }); }
    finally { if (!this.closed) this.setState({ busy: false }); }
  }
  render({ state, locked, onClose }) {
    const { busy, progress, label, result, error } = this.state;
    const picker = (key, capture) => html`<label class=${`button ${locked || busy ? 'disabled' : ''}`}><${Icon} name="camera"/>${t(key)}<input class="sr-only" type="file" accept="image/*" capture=${capture} disabled=${locked || busy}
      onChange=${e => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; this.scan(f); }}/></label>`;
    const chosen = result?.items.filter(i => i.keep).length || 0;
    return html`<${Sheet} title=${t(this.props.menuId ? 'scanInto' : 'scanMenu')} onClose=${onClose} className="scan">
      ${error && html`<p id="scan-error" class="banner error" role="alert"><${Icon} name="alert"/><span><strong>${t('error')}</strong> ${error}</span></p>`}
      ${!result && html`<p>${t(this.props.menuId ? 'scanUpdate' : 'scanNew')} ${t('scanHint')}</p><div class="actions">${picker('takePhoto', 'environment')}${picker('choosePhoto', undefined)}</div>`}
      ${busy && !result && html`<progress value=${progress} max="1" aria-label=${label}></progress><p role="status">${label} ${Math.round(progress * 100)}%</p>`}
      ${result && html`<form class="stack" onSubmit=${e => { e.preventDefault(); this.save(); }}>
        <h3>${t('found', result.items.length)}</h3>
        ${!this.props.menuId && html`<label>${t('newMenuName')}<input value=${result.title || ''} placeholder=${t('newMenuHint')} maxlength="50" onInput=${e => this.setState({ result: { ...this.state.result, title: e.currentTarget.value } })}/></label>`}
        <p class="muted">${t('review')} ${t(result.engine === 'built-in' ? 'readAI' : 'readOCR')}</p>
        <ul class="scan-list">${result.items.map(item => html`<li key=${item.key} class=${item.keep ? '' : 'off'}>
          <label class="check-target"><input type="checkbox" checked=${item.keep} aria-label=${t('include', item.name)} onChange=${e => this.update(item.key, { keep: e.currentTarget.checked })}/></label>
          <label class="scan-name-label">${t('itemName')}<input class="scan-name" value=${item.name} required=${item.keep} maxlength="60" onInput=${e => this.update(item.key, { name: e.currentTarget.value })}/></label>
          <label class="scan-price-label">${t('price', state.group.currency)}<input class="scan-price" type="number" inputmode="decimal" required=${item.keep} min="0" max="1000000" step="0.01" value=${item.priceText} onInput=${e => this.update(item.key, { priceText: e.currentTarget.value })}/></label>
          <label class="scan-category">${t('category')}<select value=${item.category} onChange=${e => this.update(item.key, { category: e.currentTarget.value })}>${CATEGORIES.map(c => html`<option value=${c}>${t('categories')[c]}</option>`)}</select></label>
          ${item.exists && html`<small class="scan-note">${t('priceUpdate')}</small>`}</li>`)}</ul>
        ${result.text && html`<details><summary>${t('rawText')}</summary><pre class="ocr-text">${result.text}</pre></details>`}
        <div class="sheet-actions"><button class="primary" disabled=${!chosen || locked || busy}>${busy ? '…' : t('addItems', chosen)}</button><button type="button" class="quiet" onClick=${onClose}>${t('cancel')}</button></div>
      </form>`}
    <//>`;
  }
}

class App extends Component {
  constructor(props) {
    super(props);
    this.state = { view: props.store.view(), homeMode: 'create', groupName: funGroup(), sheet: null, editing: false, appMenu: false, showQR: false, formError: '' };
    this.run = fn => Promise.resolve().then(fn).catch(error => { props.store.notice(error.message); return false; });
  }
  componentDidMount() {
    this.unsubscribe = this.props.store.subscribe(view => {
      const previous = this.state.view.state;
      const lockedNow = previous?.group.status === 'open' && view.state?.group.status === 'locked' && previous.round.id === view.state.round.id && view.state.group.ordererId === view.identity.id;
      this.setState({ view, ...(lockedNow ? { sheet: { kind: 'locked' } } : {}) });
      const theme = view.preferences.theme;
      if (theme === 'auto') delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = theme;
      this.updateThemeColor(theme);
    });
    this.media = window.matchMedia('(prefers-color-scheme: dark)');
    this.themeChanged = () => this.updateThemeColor();
    this.media.addEventListener('change', this.themeChanged);
  }
  componentWillUnmount() { this.unsubscribe?.(); this.media?.removeEventListener('change', this.themeChanged); }
  componentDidUpdate(_previousProps, previousState) {
    if (this.state.view.state && this.state.view.tab === 'menu' &&
        (previousState.view.tab !== 'menu' || !previousState.view.state)) {
      // Warm the separately cached reader when Menu is first visited. Opening
      // a scan sheet later must still work when the device has gone offline.
      import('./ingest.js').then(m => m.prefetchOCR()).catch(() => {});
    }
  }
  updateThemeColor(theme = this.state.view.preferences.theme) {
    const dark = theme === 'dark' || theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0A0A0A' : '#111111');
  }
  go(tab) { this.setState({ appMenu: false, editing: false }); this.props.store.setTab(tab); window.scrollTo({ top: 0 }); }
  open(sheet) { this.setState({ sheet, formError: '' }); }
  close() { this.setState({ sheet: null, formError: '' }); }
  async action(type, payload, success) {
    const ok = await this.props.store.dispatch(type, payload);
    if (ok && success) this.props.store.toast(success);
    return ok;
  }
  confirm(message, label, action) { this.setState({ confirmation: { message, label, action } }); }
  async copy(text, message = t('copied')) {
    try { await navigator.clipboard.writeText(text); this.props.store.toast(message); }
    catch { this.open({ kind: 'copy', text }); }
  }
  async share(link) {
    if (navigator.share) {
      try { await navigator.share({ title: t('app'), url: link }); return; }
      catch (error) { if (error.name === 'AbortError') return; }
    }
    this.copy(link, t('linkCopied'));
  }
  nameField(v) {
    return html`<label>${t('yourName')}<span class="with-dice"><input key=${v.identity.name} aria-label=${t('yourName')} name="name" required maxlength="30" defaultValue=${v.identity.name} autocomplete="nickname"/><button type="button" class="icon-button" aria-label=${t('randomName')} onClick=${() => this.props.store.rerollName()}><${Icon} name="dice"/></button></span></label>`;
  }
  home(v) {
    const store = this.props.store;
    const join = this.state.homeMode === 'join' || !!v.targetCode || v.role === 'member';
    const joinNow = code => {
      this.code = code;
      if (validCode(code) && code !== this.lastAutoCode) {
        this.lastAutoCode = code;
        this.run(() => store.join(code, this.homeForm?.elements.name?.value || v.identity.name));
      }
    };
    return html`<section class="home">${heading(t('tagline'), t('homeIntro'))}
      ${join ? html`<form ref=${el => this.homeForm = el} class="stack" onSubmit=${e => { e.preventDefault(); this.run(() => store.join(this.code || v.targetCode, fields(e).name, e.submitter?.value === 'manual')); }}>
        <button type="button" class="quiet" onClick=${() => { this.run(() => store.resetConnection()); this.setState({ homeMode: 'create' }); }}>${t('back')}</button>
        <${CodeInput} value=${v.targetCode} onInput=${joinNow}/>
        ${v.role === 'member' && v.targetCode && html`<p role="status">${t('joining', v.targetCode)}</p>`}
        ${this.nameField(v)}
        <button class="primary">${t('joinAction')}</button>
        <button type="button" onClick=${() => this.open({ kind: 'roomScan' })}><${Icon} name="qr"/>${t('scanQR')}</button>
        <button class="quiet" value="manual">${t('pair')}</button>
      </form>` : html`<form class="stack" onSubmit=${e => { e.preventDefault(); const f = fields(e); this.run(() => store.create(f.group, f.name, e.submitter?.value === 'manual')); }}>
        <button class="primary">${t('create')}</button>
        <button type="button" onClick=${() => this.setState({ homeMode: 'join' })}>${t('join')}</button>
        <button class="quiet" value="manual">${t('pair')}</button>
        <details class="names"><summary>${t('names')}</summary><p class="muted">${t('homeHint')}</p>
          <div class="stack"><label>${t('groupName')}<span class="with-dice"><input key=${this.state.groupName} aria-label=${t('groupName')} name="group" required maxlength="60" defaultValue=${this.state.groupName}/><button type="button" class="icon-button" aria-label=${t('randomGroup')} onClick=${() => this.setState({ groupName: funGroup() })}><${Icon} name="dice"/></button></span></label>${this.nameField(v)}</div>
        </details>
        <p class="caption">${this.state.groupName}<br/>${v.identity.name}</p>
      </form>`}
    </section>`;
  }
  lobby(v) {
    const s = v.state, host = v.role === 'host', store = this.props.store;
    const link = `${location.origin}/?room=${s.group.roomCode}`;
    return html`<section>${heading(s.group.name, `${t('countPeople', s.members.length)} · ${t(s.group.status === 'open' ? 'open' : 'locked')}`)}
      <button class="room-plate" aria-label=${`${t('roomCode')} ${s.group.roomCode}. ${t('copy')}`} onClick=${() => this.copy(s.group.roomCode, t('codeCopied'))}><span class="plate-label">${t('roomCode')}</span><span class="plate-letters" aria-hidden="true">${[...s.group.roomCode].map(c => html`<span>${c}</span>`)}</span></button>
      <p class="muted">${t('inviteHint')}</p>
      <div class="actions"><button onClick=${() => this.share(link)}><${Icon} name="share"/>${t('share')}</button><button onClick=${() => this.setState({ showQR: !this.state.showQR })}><${Icon} name="qr"/>${t(this.state.showQR ? 'hideQR' : 'showQR')}</button></div>
      ${this.state.showQR && html`<${QR} text=${link}/><a class="share-link" href=${link}>${link}</a>`}
      ${host && !v.roomReady && html`<p class="banner warning"><${Icon} name="alert"/>${t('codeUnavailable')}</p>`}
      <section><h2>${t('members')}</h2>
        ${s.members.length === 1 && html`<p class="muted">${t('alone')}</p>`}
        <ul class="people">${s.members.map((m, i) => {
          const online = m.online && (host || v.hostOnline);
          return html`<li key=${m.id}><div class=${`avatar avatar-${i % 6}`} aria-hidden="true">${[...m.name][0]}</div><div class="person-detail"><strong>${m.name} ${m.id === v.identity.id ? t('you') : ''}</strong>
            <div class="role-tags">${m.id === s.group.hostId && html`<span>${t('host')}</span>`}${m.id === s.group.ordererId && html`<strong>${t('orderer')}</strong>`}</div>
            <small class=${online ? 'presence online' : 'presence'}>${online ? '●' : '○'} ${t(online ? 'online' : 'offline')}</small></div>
            ${host && m.id !== s.group.hostId && html`<details class="member-actions"><summary>${t('edit')}</summary><div class="stack">${m.id !== s.group.ordererId && html`<button onClick=${() => this.action('orderer.set', { id: m.id })}>${t('makeOrderer')}</button>`}<button class="danger" disabled=${s.group.status !== 'open'} onClick=${() => this.confirm(t('removePerson', m.name), t('remove'), () => this.action('member.remove', { id: m.id }))}><${Icon} name="alert"/>${t('remove')}</button></div></details>`}
          </li>`;
        })}</ul>
        ${host && s.group.ordererId !== s.group.hostId && html`<button onClick=${() => this.action('orderer.set', { id: s.group.hostId })}>${t('hostOrders')}</button>`}
      </section>
      <div class="stack"><button class="primary" onClick=${() => this.go('menu')}>${t('goMenu')}</button><button class="quiet" onClick=${() => store.showManual()}>${t('pair')}</button></div>
    </section>`;
  }
  menu(v) {
    const s = v.state;
    const viewing = s.menus.find(m => m.id === this.state.viewMenu) || activeMenu(s) || s.menus[0];
    const isActive = viewing?.id === s.activeMenuId, locked = s.group.status !== 'open' && isActive;
    const canChoose = [s.group.hostId, s.group.ordererId].includes(v.identity.id);
    const items = s.menu.filter(i => i.menuId === viewing?.id);
    const show = id => this.setState({ viewMenu: id, editing: false });
    return html`<section>${heading(t('menus'), t('noMenus'))}
      ${s.menus.length > 0 && html`<div class="menu-chips" aria-label=${t('menus')}>${s.menus.map(m => html`<button key=${m.id} class=${`chip ${viewing?.id === m.id ? 'active' : ''}`} aria-pressed=${viewing?.id === m.id} onClick=${() => show(m.id)}>${m.id === s.activeMenuId ? '✓ ' : ''}${m.name}</button>`)}</div>`}
      <div class="actions"><button onClick=${() => this.open({ kind: 'menuName' })}><${Icon} name="plus"/>${t('newMenu')}</button>${viewing && html`<button aria-pressed=${this.state.editing} onClick=${() => this.setState({ editing: !this.state.editing })}><${Icon} name="edit"/>${t(this.state.editing ? 'done' : 'editMenu')}</button>`}</div>
      ${viewing && html`<div class="menu-head"><h2>${viewing.name}</h2><p class="caption">${t('itemCount', items.length)} · ${isActive ? `✓ ${t('currentMenu')}` : t('notCurrent')}</p>
        ${!isActive && (canChoose ? html`<button disabled=${s.group.status !== 'open' || !items.length} onClick=${() => { const use = () => this.action('menu.activate', { id: viewing.id }); if (s.picks.length) this.confirm(t('switchMenu', viewing.name), t('useMenu'), use); else use(); }}>${t('useMenu')}</button>` : html`<p class="muted">${t('ordererChooses')}</p>`)}
        ${this.state.editing && html`<div class="actions"><button onClick=${() => this.open({ kind: 'menuName', menu: viewing })}>${t('rename')}</button><button class="danger" disabled=${locked || isActive && !canChoose} onClick=${() => this.confirm(t('deleteMenuConfirm', viewing.name), t('delete'), () => this.action('menu.remove', { id: viewing.id }))}><${Icon} name="alert"/>${t('deleteMenu')}</button></div>`}</div>`}
      ${locked && html`<p class="banner warning"><${Icon} name="lock"/>${t('menuLocked')}</p>`}
      ${!items.length && html`<${Empty} text=${t('emptyMenu')} icon="menu"/>`}
      <div class="actions menu-tools"><button class="primary" disabled=${locked} onClick=${() => this.open({ kind: 'scan', menuId: viewing?.id })}><${Icon} name="camera"/>${t('scanMenu')}</button><button disabled=${locked} onClick=${() => this.open({ kind: 'item', menuId: viewing?.id })}><${Icon} name="plus"/>${t('add')}</button></div>
      ${!items.length && html`<button class="quiet" disabled=${locked} onClick=${() => this.run(async () => { const r = await this.props.store.presets(viewing?.id); if (r.menuId) show(r.menuId); })}>${t('commonItems')}</button>`}
      ${CATEGORIES.map(category => {
        const list = items.filter(i => i.category === category);
        return list.length > 0 && html`<section class="menu-section"><h3>${t('categories')[category]}</h3><ul class="item-list">${list.map(item => html`<li key=${item.id}><div class="menu-row">${leader(item.name, money(item.price, s.group.currency))}
          ${item.price === 0 && html`<small>${t('priceUnset')}</small>`}
          ${this.state.editing && html`<div class="actions"><button disabled=${locked} onClick=${() => this.open({ kind: 'item', menuId: viewing.id, item })}><${Icon} name="edit"/>${t('edit')}</button><button class="danger" disabled=${locked} onClick=${() => this.confirm(t('deleteItem', item.name), t('delete'), () => this.action('menu.delete', { id: item.id }, t('itemDeleted')))}><${Icon} name="alert"/>${t('delete')}</button></div>`}</div></li>`)}</ul></section>`;
      })}
    </section>`;
  }
  picks(v) {
    const s = v.state, locked = s.group.status !== 'open', items = activeItems(s), current = activeMenu(s);
    const myPicks = s.picks.filter(p => p.memberId === v.identity.id);
    return html`<section>${heading(t('picks'), current ? t('fromMenu', current.name) : t('pickHint'))}
      ${locked && html`<p class="banner warning"><${Icon} name="lock"/>${t('lockedPicks')}</p>`}
      <button class="quiet" disabled=${locked || !items.length} onClick=${() => { this.open({ kind: 'shuffle' }); this.props.store.suggest(matchMedia('(prefers-reduced-motion: reduce)').matches); }}><${Icon} name="dice"/>${t('undecided')}</button>
      ${!myPicks.length && html`<p class="muted">${t('emptyPicks')}</p>`}
      ${!items.length && html`<${Empty} text=${t('emptyMenu')} icon="menu"><button onClick=${() => this.go('menu')}>${t('goMenu')}</button><//>`}
      ${items.map(item => {
        const pick = myPicks.find(p => p.itemId === item.id), qty = pick?.qty || 0;
        return html`<article key=${item.id} class=${`pick-row ${qty ? 'selected' : ''}`}>
          ${leader(html`<button class="item-name quiet" disabled=${locked} onClick=${() => this.open({ kind: 'note', item })} aria-label=${t('addNote', item.name)}>${item.name}</button>`, money(item.price, s.group.currency))}
          <div class="row"><span class="caption">${t('categories')[item.category]}</span><div class="stepper"><button aria-label=${t('removeOne', item.name)} disabled=${locked || !qty} onClick=${() => this.props.store.changePick(item.id, -1)}><${Icon} name="minus"/></button><output aria-label=${t('quantity', item.name, qty)} aria-live="polite">${qty}</output><button aria-label=${t('addOne', item.name)} disabled=${locked || qty === 99} onClick=${() => this.props.store.changePick(item.id, 1)}><${Icon} name="plus"/></button></div></div>
          ${pick?.note && html`<p class="item-note"><${Icon} name="note" size=${16}/><em>${pick.note}</em></p>`}
        </article>`;
      })}
      <div class="total-bar">${leader(t('subtotal'), money(costs(s).people.find(p => p.id === v.identity.id)?.subtotal || 0, s.group.currency))}</div>
    </section>`;
  }
  order(v) {
    const s = v.state, totals = costs(s), orderer = s.group.ordererId === v.identity.id;
    const qtyTotal = s.picks.reduce((n, p) => n + p.qty, 0);
    return html`<section>${heading(t('order'), t('placedBy', nameOf(s, s.group.ordererId)))}
      <div class="card receipt"><h2>${t('consolidated', qtyTotal)}</h2><p class="caption">${activeMenu(s)?.name}</p>
        ${!s.picks.length && html`<${Empty} text=${t('noPicks')} icon="receipt"/>`}
        <ul class="item-list">${activeItems(s).map(item => { const qty = s.picks.filter(p => p.itemId === item.id).reduce((n, p) => n + p.qty, 0); return qty > 0 && html`<li>${leader(`${item.name} x ${qty}`, money(qty * item.price, s.group.currency))}</li>`; })}</ul>
        <div class="total-bar">${leader(t('estimated'), money(totals.estimatedTotal, s.group.currency))}</div>
      </div>
      <details class="breakdown"><summary>${t('perPerson')}</summary>${s.members.map(person => {
        const picks = s.picks.filter(p => p.memberId === person.id);
        return picks.length > 0 && html`<section key=${person.id}><h3>${person.name}</h3><ul class="plain-list">${picks.map(p => html`<li>${p.qty} × ${s.menu.find(i => i.id === p.itemId)?.name}${p.note && html`<small>${t('notePrefix')} ${p.note}</small>`}</li>`)}</ul></section>`;
      })}</details>
      <div class="stack order-actions"><button disabled=${!s.picks.length} onClick=${() => this.copy(orderText(s), t('orderCopied'))}><${Icon} name="copy"/>${t('copyOrder')}</button>
        ${orderer && (s.group.status === 'open' ? html`<button class="primary" disabled=${!s.picks.length} onClick=${() => this.action('order.lock', {})}><${Icon} name="lock"/>${t('lock')}</button>` : html`<button class="primary" onClick=${() => this.go('costs')}>${t('enterBill')}</button><button onClick=${() => this.confirm(t('unlockConfirm'), t('unlock'), () => this.action('order.unlock', {}))}><${Icon} name="unlock"/>${t('unlock')}</button>`)}
        <p class="muted">${t('orderHelp')}</p></div>
    </section>`;
  }
  costs(v) {
    const s = v.state, totals = costs(s), orderer = s.group.ordererId === v.identity.id, locked = s.group.status === 'locked';
    return html`<section>${heading(t('costs'), t('billHelp'))}
      <div class="bill-totals">${leader(t('estimated'), money(totals.estimatedTotal, s.group.currency))}${s.round.actualTotal !== null ? leader(t('actual'), money(s.round.actualTotal, s.group.currency)) : html`<p class="muted">${t('actualNotEntered')}</p>`}</div>
      ${orderer && html`<form class="stack bill-form" key=${s.round.id} onSubmit=${e => { e.preventDefault(); const f = fields(e); this.run(() => this.action('bill.set', { actualTotal: cents(f.bill), splitMode: f.split }, t('billSaved'))); }}>
        <label>${t('bill', s.group.currency)}<input name="bill" required type="number" min="0" max="1000000" step="0.01" inputmode="decimal" defaultValue=${s.round.actualTotal === null ? '' : (s.round.actualTotal / 100).toFixed(2)} disabled=${!locked}/></label>
        <label>${t('split')}<select name="split" defaultValue=${s.round.splitMode} disabled=${!locked}><option value="equal">${t('splitEqual')}</option><option value="proportional">${t('splitProportional')}</option></select></label>
        <p class="muted">${t(locked ? 'billReset' : 'lockFirst')}</p><button disabled=${!locked}>${t('saveBill')}</button>
      </form>`}
      <section><h2>${t('whoOwes')}</h2>${s.round.actualTotal === null && html`<p class="muted">${t('estimateHint')}</p>`}
        <ul class="people cost-people">${totals.people.map(person => html`<li key=${person.id}><div class="person-detail"><strong>${person.name}</strong><small>${t('itemsSubtotal')}: ${money(person.subtotal, s.group.currency)}${!person.participating ? ` · ${t('noPicks')}` : ''}</small></div><div class="payment"><strong class="amount">${money(person.owed, s.group.currency)}</strong>
          ${person.id === s.group.ordererId ? html`<small>${t('ownShare')}</small>` : orderer && locked && person.participating ? html`<button aria-label=${`${person.name}: ${t(s.round.payments[person.id] ? 'paid' : 'unpaid')}`} aria-pressed=${!!s.round.payments[person.id]} class=${`paid-toggle ${s.round.payments[person.id] ? 'paid' : ''}`} onClick=${() => this.action('payment.set', { id: person.id, paid: !s.round.payments[person.id] })}>${t(s.round.payments[person.id] ? 'paid' : 'unpaid')}</button>` : html`<small class=${s.round.payments[person.id] ? 'paid' : ''}>${person.participating ? t(s.round.payments[person.id] ? 'paid' : 'unpaid') : '—'}</small>`}</div></li>`)}</ul>
        <div class="total-bar grand-total"><span>${t('finalTotal')}</span><strong>${money(totals.actualTotal, s.group.currency)}</strong></div>
      </section>
      ${orderer && locked && html`<button class="primary full" onClick=${() => this.confirm(t('finishConfirm'), t('finish'), () => this.action('round.finish', { nextRoundId: uid(), date: new Date().toISOString() }, t('roundSaved')))}>${t('finish')}</button>`}
    </section>`;
  }
  history(v) {
    const s = v.state, tally = debts(s);
    return html`<section>${heading(t('history'), t('rounds', s.history.length))}
      ${!s.history.length ? html`<${Empty} text=${t('emptyHistory')} icon="history"/>` : html`<section><h2>${t('outstanding')}</h2>${!tally.length ? html`<p>${t('allSettled')}</p>` : html`<ul class="item-list">${tally.map(d => html`<li>${leader(`${d.name} → ${d.orderer}`, money(d.amount, d.currency))}</li>`)}</ul>`}</section>`}
      ${[...s.history].reverse().map(round => html`<details class="card history-round" key=${round.id}><summary><strong>${date(round.date)}</strong><span>${round.menuName || ''} · ${money(round.actualTotal ?? round.estimatedTotal, round.currency)}${round.actualTotal === null ? ` ${t('estimateLabel')}` : ''}</span></summary>
        <p>${t('orderer')}: ${round.members.find(m => m.id === round.ordererId)?.name}</p>
        <div class="bill-totals">${leader(t('estimated'), money(round.estimatedTotal, round.currency))}${leader(t('actual'), round.actualTotal === null ? t('noActual') : money(round.actualTotal, round.currency))}</div>
        <ul class="people">${round.amounts.filter(p => p.owed || round.picks.some(pick => pick.memberId === p.id)).map(person => html`<li key=${person.id}><div class="person-detail"><strong>${person.name} · ${money(person.owed, round.currency)}</strong>${round.picks.filter(p => p.memberId === person.id).map(p => html`<small>${p.qty} × ${round.menu.find(i => i.id === p.itemId)?.name}${p.note ? ` (${p.note})` : ''}</small>`)}</div>
          <div>${person.id === round.ordererId ? html`<small>${t('ownShare')}</small>` : round.ordererId === v.identity.id ? html`<button class="paid-toggle" onClick=${() => this.action('history.payment', { roundId: round.id, id: person.id, paid: !round.payments[person.id] })}>${t(round.payments[person.id] ? 'paid' : 'unpaid')}</button>` : html`<small>${t(round.payments[person.id] ? 'paid' : 'unpaid')}</small>`}</div></li>`)}</ul>
      </details>`)}
    </section>`;
  }
  settings(v) {
    const s = v.state, store = this.props.store;
    return html`<section>${heading(t('settings'))}
      <section><h2>${t('appearance')}</h2><label>${t('theme')}<select value=${v.preferences.theme} onChange=${e => { const theme = e.currentTarget.value; this.run(() => store.preferences({ theme })); }}>${['auto', 'light', 'dark'].map(theme => html`<option value=${theme}>${t(theme)}</option>`)}</select></label></section>
      ${s && html`<form class="stack" onSubmit=${e => { e.preventDefault(); this.action('member.rename', { name: fields(e).name }); }}><label>${t('displayName')}<input name="name" required maxlength="30" defaultValue=${v.identity.name}/></label><button>${t('saveName')}</button></form>`}
      ${v.role === 'host' && s && html`<form class="stack" onSubmit=${e => { e.preventDefault(); this.action('group.currency', { currency: fields(e).currency }); }}><h2>${t('groupCurrency')}</h2><label>${t('currency')}<input name="currency" required maxlength="8" defaultValue=${s.group.currency} list="currencies"/><datalist id="currencies"><option value="Rs"/><option value="₹"/><option value="$"/><option value="€"/></datalist></label><p class="muted">${t('currencyHint')}</p><button disabled=${s.group.status !== 'open'}>${t('saveCurrency')}</button></form>`}
      <details><summary>${t('connectionSettings')}</summary><p class="muted">${t('connectionConfigHint')}</p>
        <form class="stack" onSubmit=${e => { e.preventDefault(); const f = fields(e); this.run(() => store.settings({ signaling: JSON.parse(f.signaling), iceServers: JSON.parse(f.ice) })); }}><label>${t('signaling')}<textarea name="signaling" rows="7" required spellcheck=${false} defaultValue=${JSON.stringify(v.config.signaling, null, 2)}></textarea></label><label>${t('ice')}<textarea name="ice" rows="7" required spellcheck=${false} defaultValue=${JSON.stringify(v.config.iceServers, null, 2)}></textarea></label><button>${t('saveConnection')}</button></form>
        <p>${v.status}</p><button disabled=${!v.role || !v.targetCode} onClick=${() => store.startRoom()}>${t('retry')}</button>
        ${v.role === 'host' && html`<button onClick=${() => this.confirm(t('regenerateConfirm'), t('regenerate'), () => store.regenerateCode())}>${t('regenerate')}</button>`}
      </details>
      ${s && html`<section class="stack"><h2>${t('localData')}</h2><button onClick=${() => this.download(store.backup())}>${t('export')}</button><p class="muted">${t('exportHint')}</p><button class="danger" onClick=${() => this.confirm(t('leaveConfirm'), t('leave'), () => store.leave())}><${Icon} name="alert"/>${t('leave')}</button></section>`}
      <details><summary>${t('offlineHelp')}</summary><p>${t('installHint')}</p><p>${t('installSteps')}</p><p>${t('offlineText')}</p></details>
    </section>`;
  }
  download(text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'chaikadi-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  renderSheet(v) {
    const p = this.state.sheet, store = this.props.store, s = v.state;
    if (!p) return null;
    const close = () => this.close();
    const formError = this.state.formError || v.notice;
    const error = formError && html`<p id="sheet-error" class="banner error" role="alert"><${Icon} name="alert"/><span><strong>${t('error')}</strong> ${formError}</span></p>`;
    const submit = fn => this.run(async () => { try { const ok = await fn(); if (ok !== false) close(); } catch (e) { this.setState({ formError: e.message }); } });
    if (p.kind === 'scan') return html`<${MenuScan} key=${p.menuId || 'new'} menuId=${p.menuId} state=${s} store=${store} locked=${p.menuId === s.activeMenuId && s.group.status !== 'open'} onClose=${close} onSaved=${id => { this.setState({ viewMenu: id }); close(); }}/>`;
    if (p.kind === 'roomScan') return html`<${Sheet} title=${t('scanQR')} onClose=${close}><${Scanner} onError=${m => store.notice(m)} onResult=${text => {
      try { const url = new URL(text), code = url.searchParams.get('room'); if (![location.hostname, 'chaikadi.fyi', 'chaikadi.pages.dev'].includes(url.hostname) || !validCode(code)) throw new Error(); close(); this.run(() => store.join(code, this.homeForm?.elements.name?.value || v.identity.name)); }
      catch { store.notice(t('badQR')); }
    }}/>${error}<//>`;
    if (p.kind === 'copy') return html`<${Sheet} title=${t('selectCopy')} onClose=${close}><textarea readonly rows="8" value=${p.text} onFocus=${e => e.currentTarget.select()} autofocus></textarea><button class="primary" onClick=${close}>${t('done')}</button><//>`;
    if (p.kind === 'locked') return html`<${Sheet} title=${t('locked')} onClose=${close} className="lock-reveal"><${Icon} name="tumbler" size=${48}/><div class="typed-lock" aria-hidden="true">${t('locked')}</div><div class="lock-rule" aria-hidden="true"></div><p>${t('lockHelp')}</p><button class="primary" onClick=${close}>${t('done')}</button><//>`;
    if (p.kind === 'shuffle') {
      const item = activeItems(s).find(i => i.id === v.suggested), locked = s.group.status !== 'open';
      return html`<${Sheet} title=${t('suggestion')} onClose=${close}><div class=${`shuffle-result ${v.shuffling ? 'striking' : ''}`} role="status">${item?.name || t('shuffle')}</div><p class="amount">${item ? money(item.price, s.group.currency) : ''}</p>
        <div class="stack"><button class="primary" disabled=${!item || locked || v.shuffling} onClick=${() => submit(() => store.changePick(item.id, 1))}>${t('acceptPick')}</button><button disabled=${locked || v.shuffling} onClick=${() => store.suggest(matchMedia('(prefers-reduced-motion: reduce)').matches)}><${Icon} name="dice"/>${t('reroll')}</button></div><//>`;
    }
    if (p.kind === 'menuName') return html`<${Sheet} title=${t(p.menu ? 'rename' : 'newMenu')} onClose=${close}>${error}<form class="stack" onSubmit=${e => { e.preventDefault(); const name = fields(e).name; submit(async () => { if (p.menu) return this.action('menu.rename', { id: p.menu.id, name }, t('menuSaved')); const id = await store.newMenu(name); if (!id) return false; this.setState({ viewMenu: id, editing: false }); return true; }); }}><label>${t('menuName')}<input name="name" required maxlength="60" defaultValue=${p.menu?.name || store.uniqueMenuName(t('menu'))} autofocus aria-describedby=${formError ? 'sheet-error' : undefined}/></label><button class="primary">${t('save')}</button></form><//>`;
    if (p.kind === 'item') {
      const item = p.item, locked = p.menuId === s.activeMenuId && s.group.status !== 'open';
      return html`<${Sheet} title=${t(item ? 'editItem' : 'add')} onClose=${close}>${error}<form class="stack" onSubmit=${e => { e.preventDefault(); const f = fields(e); submit(async () => { const price = cents(f.price); const menuId = p.menuId || await store.newMenu(t('menu')); if (!menuId) return false; const ok = await this.action('menu.upsert', { id: item?.id || uid(), menuId, name: f.name, price, category: f.category }, t('itemSaved')); if (ok) this.setState({ viewMenu: menuId }); return ok; }); }}>
        <label>${t('itemName')}<input name="name" required maxlength="60" defaultValue=${item?.name || ''} autofocus disabled=${locked}/></label><label>${t('price', s.group.currency)}<input name="price" type="number" inputmode="decimal" min="0" max="1000000" step="0.01" placeholder="0" defaultValue=${item ? item.price / 100 : ''} disabled=${locked}/></label><label>${t('category')}<select name="category" defaultValue=${item?.category || 'Tea'} disabled=${locked}>${CATEGORIES.map(c => html`<option value=${c}>${t('categories')[c]}</option>`)}</select></label><button class="primary" disabled=${locked}>${t('save')}</button>
      </form><//>`;
    }
    if (p.kind === 'note') {
      const item = s.menu.find(i => i.id === p.item.id), pick = s.picks.find(pick => pick.memberId === v.identity.id && pick.itemId === p.item.id);
      const locked = s.group.status !== 'open' || !item || item.menuId !== s.activeMenuId;
      return html`<${Sheet} title=${p.item.name} onClose=${close}>${error}<form class="stack" onSubmit=${e => { e.preventDefault(); const note = fields(e).note; submit(async () => { if (!pick && !await store.changePick(p.item.id, 1)) return false; const ok = await store.saveNote(p.item.id, note); if (ok) store.toast(t('noteSaved')); return ok; }); }}><label>${t('itemNote')}<textarea name="note" rows="3" maxlength="160" defaultValue=${pick?.note || ''} placeholder=${t('notePlaceholder')} disabled=${locked} autofocus></textarea></label>${!pick && html`<p class="muted">${t('noteAddsItem')}</p>`}<button class="primary" disabled=${locked}>${t('saveNote')}</button></form><//>`;
    }
    return null;
  }
  render() {
    const v = this.state.view, s = v.state, store = this.props.store;
    const tabs = [['menu', 'menu'], ['picks', 'user'], ['order', 'receipt'], ['costs', 'rupee']];
    const online = v.role === 'host' || v.hostOnline;
    const count = s?.picks.filter(p => p.memberId === v.identity.id).reduce((n, p) => n + p.qty, 0) || 0;
    return html`<div class="app-shell"><header class="app-header"><div class="header-inner"><a class="brand" href="#" onClick=${e => { e.preventDefault(); this.go('lobby'); }}><${Icon} name="tumbler"/><span>${t('app')}</span></a>
      <div class="header-actions">${s && html`<button class="compact-code" aria-label=${`${t('group')}: ${s.group.roomCode}`} onClick=${() => this.go('lobby')}>${s.group.roomCode}</button><span class="header-presence" aria-live="polite">${online ? `● ${t('onlineCount', s.members.filter(m => m.online).length)}` : `○ ${t('offline')}`}</span>`}<button class="quiet icon-button" aria-label=${t('more')} aria-expanded=${this.state.appMenu} onClick=${() => this.setState({ appMenu: !this.state.appMenu })}><${Icon} name="more"/></button></div></div>
      ${this.state.appMenu && html`<nav class="app-menu" aria-label=${t('more')}>${s && html`<button onClick=${() => this.go('lobby')}><${Icon} name="user"/>${t('group')}</button><button onClick=${() => this.go('history')}><${Icon} name="history"/>${t('history')}</button>`}<button onClick=${() => this.go('settings')}><${Icon} name="settings"/>${t('settings')}</button>${v.role && html`<button onClick=${() => { this.setState({ appMenu: false }); store.showManual(); }}><${Icon} name="offline"/>${t('pair')}</button>`}</nav>`}
      </header><main id="main">
        ${!v.ready ? html`<p role="status">${t('opening')}</p>` : html`
          ${v.storageWarning && html`<div class="banner error" role="alert"><${Icon} name="alert"/><span><strong>${t('error')}</strong> ${v.storageWarning}</span></div>`}
          ${v.notice && html`<div class="banner error" role="alert"><${Icon} name="alert"/><span><strong>${t('error')}</strong> ${v.notice}</span><button class="quiet icon-button" aria-label=${t('dismiss')} onClick=${() => store.notice('')}><${Icon} name="close"/></button></div>`}
          ${v.role === 'member' && s && !v.hostOnline && html`<div class="banner warning" role="status"><${Icon} name="offline"/><span>${t('hostOffline')}<small>${t('queued', v.pending)}</small></span></div>`}
          ${v.pending > 0 && v.hostOnline && html`<p class="sync-status" role="status">${t('sending', v.pending)}</p>`}
          ${!s && v.role === 'member' && html`<div class=${`banner ${v.manualHint ? 'error' : 'info'}`} role="status">${v.manualHint ? html`<${Icon} name="alert"/><span><strong>${t('error')}</strong> ${t('hostUnreachable', v.targetCode)}</span>` : t('connecting')}</div>`}
          ${v.manualHint && !s && v.role && html`<p class="banner warning"><${Icon} name="offline"/>${t('pairHelp')}</p>`}
          ${v.tab === 'settings' ? this.settings(v) : !s ? this.home(v) : this[v.tab]?.(v)}
          ${s && !v.preferences.installDismissed && !matchMedia('(display-mode: standalone)').matches && html`<aside class="install-hint"><details><summary>${t('install')}</summary><p>${t('installHint')}</p><p>${t('installSteps')}</p></details><button class="quiet" onClick=${() => this.run(() => store.preferences({ installDismissed: true }))}>${t('installDone')}</button></aside>`}
        `}
        <footer><span>${t('tagline')}</span><a href="https://github.com/tellmeY18/chaikadi.fyi" target="_blank" rel="noopener">${t('source')}</a><span id="offline-status">${v.offline || t('offlinePreparing')}</span></footer>
      </main>
      ${s && html`<nav class="bottom-nav" aria-label="Main navigation">${tabs.map(([key, icon]) => html`<button key=${key} aria-label=${t(key)} class=${v.tab === key ? 'active' : ''} aria-current=${v.tab === key ? 'page' : undefined} onClick=${() => this.go(key)}><span class="tab-icon"><${Icon} name=${icon}/>${key === 'picks' && count > 0 && html`<span class="tab-badge">${count}</span>`}${key === 'order' && s.group.status === 'locked' && html`<span class="tab-badge" aria-label=${t('locked')}><${Icon} name="lock" size=${12}/></span>`}</span><span>${t(key)}</span></button>`)}</nav>`}
      ${v.toast && html`<div class="toast" role="status" aria-live="polite">${v.toast}</div>`}
      ${v.pairing ? html`<${Pairing} view=${v} store=${store} run=${this.run}/>` : this.renderSheet(v)}
      ${this.state.confirmation && html`<${Modal} title=${this.state.confirmation.label} onClose=${() => this.setState({ confirmation: null })}><p>${this.state.confirmation.message}</p><div class="stack"><button class="primary" autofocus onClick=${() => this.setState({ confirmation: null })}>${t('keep')}</button><button class="danger" onClick=${() => { const action = this.state.confirmation.action; this.setState({ confirmation: null }); this.run(action); }}><${Icon} name="alert"/>${this.state.confirmation.label}</button></div><//>`}
    </div>`;
  }
}
export function mount(store, element) { element.replaceChildren(); render(html`<${App} store=${store}/>`, element); }
