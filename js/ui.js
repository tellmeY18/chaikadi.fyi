import { h, render, Component } from '../vendor/preact.module.js';
import htm from '../vendor/htm.module.js';
import { CATEGORIES, uid, funGroup, validCode, APP_VERSION, EATSIGHTS_URL } from './config.js';
import { costs, debts, activeItems, activeMenu, rankItems, searchItems } from './state.js';
import { LibrarySheet } from './library-ui.js';
import { EsRoundSheet, EsItemSheet, ContribSettings, ResetKeySheet, AddStallSheet, sharingOn, esSource, roundFacts } from './eatsights-ui.js';
import { planRound, afterSheet, today } from './prompts.js';
import { contrib } from './contrib.js';
import { DevOptions } from './dev-ui.js';
import { drawQR, scanQR } from './qr.js';
import { t, money } from './strings.js';
import { Icon, Sheet, Modal, CodeInput, Empty } from './components.js';

const html = htm.bind(h);
const fields = event => Object.fromEntries(new FormData(event.currentTarget));
const date = value => new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const nameOf = (state, id) => state.members.find(m => m.id === id)?.name || t('formerMember');
const leader = (label, value, cls = '') => html`<div class=${`leader ${cls}`}><span>${label}</span><span class="dots" aria-hidden="true"></span><strong class="amount">${value}</strong></div>`;
const heading = (title, description) => html`<div class="section-heading"><h1>${title}</h1>${description && html`<p>${description}</p>`}</div>`;
// Receipts are paper: Courier Prime, ink black, perforated edges. Never inverted.
const receipt = (children, key) => html`<div class="receipt" key=${key}><div class="receipt-paper">${children}</div></div>`;
const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
// Two themes only. Older saved 'auto' resolves once to the device setting.
export const resolvedTheme = theme => theme === 'dark' || theme === 'light' ? theme : systemDark() ? 'dark' : 'light';
function cents(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value || '0'))) throw new Error(t('invalidAmount'));
  return Math.round(Number(value || 0) * 100);
}
const textLeader = (label, value) => `${label} ${'.'.repeat(Math.max(2, 36 - [...label].length - [...value].length))} ${value}`;
// "2 x less sugar (Asha)" for each pick of this item that has a note.
const itemNotes = (s, itemId) => s.picks.filter(p => p.itemId === itemId && p.note)
  .map(p => `${p.qty > 1 ? `${p.qty} x ` : ''}${p.note} (${nameOf(s, p.memberId)})`);
export function orderText(s) {
  const c = s.group.currency, totals = costs(s);
  const lines = [s.group.name, activeMenu(s)?.name || '', s.group.status === 'locked' ? t('locked') : t('open'), ''];
  for (const item of activeItems(s)) {
    const qty = s.picks.filter(p => p.itemId === item.id).reduce((n, p) => n + p.qty, 0);
    if (qty) lines.push(textLeader(`${item.name} x ${qty}`, money(qty * item.price, c)), ...itemNotes(s, item.id).map(n => `  - ${n}`));
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
      this.applyTheme(view.preferences.theme);
    });
    // Contributions saved while offline go out once the device is online.
    this.flush = () => { if (sharingOn(this.state.view)) contrib().flush().catch(() => {}); };
    window.addEventListener('online', this.flush);
    setTimeout(this.flush, 3000);
    this.media = window.matchMedia('(prefers-color-scheme: dark)');
    this.themeChanged = () => this.applyTheme(this.state.view.preferences.theme);
    this.media.addEventListener('change', this.themeChanged);
  }
  componentWillUnmount() { this.unsubscribe?.(); this.media?.removeEventListener('change', this.themeChanged); window.removeEventListener('online', this.flush); }
  componentDidUpdate(_previousProps, previousState) {
    if (this.state.view.state && this.state.view.tab === 'menu' &&
        (previousState.view.tab !== 'menu' || !previousState.view.state)) {
      // Warm the separately cached reader when Menu is first visited. Opening
      // a scan sheet later must still work when the device has gone offline.
      import('./ingest.js').then(m => m.prefetchOCR()).catch(() => {});
    }
  }
  applyTheme(preference) {
    const theme = resolvedTheme(preference);
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('chaikadi-theme', theme); } catch { /* storage blocked */ }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#000000' : '#FFFFFF');
  }
  go(tab) { this.setState({ appMenu: false, editing: false, query: '' }); this.props.store.setTab(tab); window.scrollTo({ top: 0 }); }
  search(count) {
    const query = this.state.query || '';
    return html`<div class="search"><label class="sr-only" for="item-search">${t('searchItems')}</label>
      <input id="item-search" type="search" placeholder=${t('searchItems')} autocomplete="off" enterkeyhint="search" value=${query} onInput=${e => this.setState({ query: e.currentTarget.value })}/>
      ${query && html`<button class="quiet icon-button" aria-label=${t('clearSearch')} onClick=${() => this.setState({ query: '' })}><${Icon} name="close"/></button>`}
      ${query && html`<p class="sr-only" role="status">${t('itemCount', count)}</p>`}</div>`;
  }
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
    return html`<label>${t('yourName')}<span class="with-dice"><input key=${v.identity.name} name="name" required maxlength="30" defaultValue=${v.identity.name} autocomplete="nickname"/><button type="button" class="icon-button" aria-label=${t('randomName')} onClick=${() => this.props.store.rerollName()}><${Icon} name="dice"/></button></span></label>`;
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
    if (join) return html`<section class="home">
      <button type="button" class="back" onClick=${() => { this.run(() => store.resetConnection()); this.setState({ homeMode: 'create' }); }}><${Icon} name="back"/>${t('back')}</button>
      ${heading(t('join'))}
      <form ref=${el => this.homeForm = el} class="stack" onSubmit=${e => { e.preventDefault(); this.run(() => store.join(this.code || v.targetCode, fields(e).name)); }}>
        <${CodeInput} value=${v.targetCode} onInput=${joinNow}/>
        ${v.role === 'member' && v.targetCode && html`<p role="status">${t('joining', v.targetCode)}</p>`}
        ${this.nameField(v)}
        <button class="primary">${t('joinAction')}</button>
        <button type="button" class="outbound" onClick=${() => this.open({ kind: 'roomScan' })}><${Icon} name="qr"/>${t('scanQR')}</button>
      </form></section>`;
    return html`<section class="home">${heading(t('tagline'))}
      <form class="stack" onSubmit=${e => { e.preventDefault(); const f = fields(e); this.run(() => store.create(funGroup(), f.name)); }}>
        ${this.nameField(v)}
        <button class="primary">${t('create')}</button>
        <button type="button" onClick=${() => this.setState({ homeMode: 'join' })}>${t('join')}</button>
      </form>
      ${!v.preferences.installDismissed && !matchMedia('(display-mode: standalone)').matches && html`<aside class="install-hint"><details><summary>${t('install')}</summary><p>${t('installSteps')}</p></details><button class="quiet" onClick=${() => this.run(() => store.preferences({ installDismissed: true }))}>${t('installDone')}</button></aside>`}
    </section>`;
  }
  lobby(v) {
    const s = v.state, host = v.role === 'host';
    const link = `${location.origin}/?room=${s.group.roomCode}`;
    return html`<section>${heading(s.group.name)}
      <button class="room-plate" aria-label=${`${t('roomCode')} ${[...s.group.roomCode].join(' ')}. ${t('copy')}`} onClick=${() => this.copy(s.group.roomCode, t('codeCopied'))}><span class="plate-label">${t('roomCode')}</span><span class="plate-letters crayon crayon-yellow" aria-hidden="true">${[...s.group.roomCode].map(c => html`<span>${c}</span>`)}</span></button>
      <div class="actions two"><button class="outbound" onClick=${() => this.share(link)}><${Icon} name="share"/>${t('share')}</button><button class="outbound" aria-expanded=${this.state.showQR} onClick=${() => this.setState({ showQR: !this.state.showQR })}><${Icon} name="qr"/>${t(this.state.showQR ? 'hideQR' : 'showQR')}</button></div>
      ${this.state.showQR && html`<${QR} text=${link}/>`}
      ${host && !v.roomReady && html`<p class="banner warning"><${Icon} name="alert"/>${t('codeUnavailable')}</p>`}
      <section><h2>${t('members')}</h2>
        ${s.members.length === 1 && html`<p>${t('alone')}</p>`}
        <ul class="people">${s.members.map(m => {
          const online = m.online && (host || v.hostOnline);
          return html`<li key=${m.id}><div class="avatar" aria-hidden="true">${[...m.name][0]}</div><div class="person-detail"><strong>${m.name} ${m.id === v.identity.id ? t('you') : ''}</strong>
            ${(m.id === s.group.hostId || m.id === s.group.ordererId) && html`<div class="role-tags">${m.id === s.group.hostId && html`<span class="tag crayon crayon-green">${t('host')}</span>`}${m.id === s.group.ordererId && html`<span class="tag crayon crayon-green">${t('orderer')}</span>`}</div>`}</div>
            <span class=${`presence ${online ? 'online crayon-green' : ''}`} role="img" aria-label=${t(online ? 'online' : 'offline')}></span>
            ${host && m.id !== s.group.hostId && html`<button class="icon-button" aria-label=${`${t('edit')} ${m.name}`} onClick=${() => this.open({ kind: 'member', member: m })}><${Icon} name="dots"/></button>`}
          </li>`;
        })}</ul>
        ${host && s.group.ordererId !== s.group.hostId && html`<button onClick=${() => this.action('orderer.set', { id: s.group.hostId })}>${t('hostOrders')}</button>`}
      </section>
      <button class="primary full" onClick=${() => this.go(s.picks.some(p => p.memberId === v.identity.id) || s.menu.length ? 'picks' : 'menu')}>${t('goMenu')}</button>
      <button class="new-session full" onClick=${() => this.confirm(t('newSessionConfirm'), t('newSession'), () => this.props.store.newSession(funGroup()))}><${Icon} name="refresh"/>${t('newSession')}</button>
    </section>`;
  }
  menu(v) {
    const s = v.state;
    const viewing = s.menus.find(m => m.id === this.state.viewMenu) || activeMenu(s) || s.menus[0];
    const isActive = viewing?.id === s.activeMenuId, locked = s.group.status !== 'open' && isActive;
    const canChoose = [s.group.hostId, s.group.ordererId].includes(v.identity.id);
    const all = s.menu.filter(i => i.menuId === viewing?.id);
    const items = searchItems(rankItems(s, all), this.state.query);
    const show = id => this.setState({ viewMenu: id, editing: false, query: '' });
    const linked = isActive && esSource(viewing) && s.group.ordererId === v.identity.id;
    const soldOut = this.soldOutToday(v);
    const itemLabel = item => linked && !this.state.editing ? html`<button class="item-name" onClick=${() => this.open({ kind: 'esItem', item })}>${item.name}</button>` : item.name;
    return html`<section>
      <div class="section-heading with-tools"><h1>${t('menu')}</h1><div class="tools">
        ${viewing && html`<button class="icon-button" aria-label=${t(this.state.editing ? 'done' : 'editMenu')} aria-pressed=${this.state.editing} onClick=${() => this.setState({ editing: !this.state.editing })}><${Icon} name=${this.state.editing ? 'check' : 'edit'}/></button>`}
        <button class="icon-button" aria-label=${t('addTitle')} onClick=${() => this.open({ kind: 'add', menuId: viewing?.id, locked })}><${Icon} name="plus"/></button></div></div>
      ${s.menus.length > 0 && html`<div class="menu-chips" aria-label=${t('menus')}>${s.menus.map(m => html`<button key=${m.id} class=${`chip ${viewing?.id === m.id ? 'active' : ''}`} aria-pressed=${viewing?.id === m.id} onClick=${() => show(m.id)}>${m.id === s.activeMenuId && html`<${Icon} name="check" size=${18}/>`}<span>${m.name}</span>${m.id === s.activeMenuId && html`<span class="sr-only">${t('currentMenu')}</span>`}</button>`)}</div>`}
      ${viewing && !isActive && (canChoose ? html`<button disabled=${s.group.status !== 'open' || !items.length} onClick=${() => { const use = () => this.action('menu.activate', { id: viewing.id }); if (s.picks.length) this.confirm(t('switchMenu', viewing.name), t('useMenu'), use); else use(); }}>${t('useMenu')}</button>` : html`<p>${t('ordererChooses')}</p>`)}
      ${viewing && this.state.editing && html`<div class="actions"><button onClick=${() => this.open({ kind: 'menuName', menu: viewing })}><${Icon} name="edit"/>${t('rename')}</button><button class="danger" disabled=${locked || isActive && !canChoose} onClick=${() => this.confirm(t('deleteMenuConfirm', viewing.name), t('delete'), () => this.action('menu.remove', { id: viewing.id }))}><${Icon} name="trash"/>${t('deleteMenu')}</button></div>`}
      ${locked && html`<p class="banner warning"><${Icon} name="lock"/>${t('menuLocked')}</p>`}
      ${!s.menus.length && html`<${Empty} text=${t('noMenus')} icon="menu"><button onClick=${() => this.run(async () => { const r = await this.props.store.presets(); if (r.menuId) show(r.menuId); })}>${t('commonItems')}</button><//>`}
      ${s.menus.length > 0 && !all.length && html`<${Empty} text=${t('emptyMenu')} icon="menu"><button disabled=${locked} onClick=${() => this.run(async () => { const r = await this.props.store.presets(viewing?.id); if (r.menuId) show(r.menuId); })}>${t('commonItems')}</button><//>`}
      ${all.length > 0 && this.search(items.length)}
      ${all.length > 0 && !items.length && html`<p>${t('noMatches')}</p>`}
      ${CATEGORIES.map(category => {
        const list = items.filter(i => i.category === category);
        return list.length > 0 && html`<section class="menu-section"><h3>${t('categories')[category]}</h3><ul class="item-list">${list.map(item => html`<li key=${item.id} class=${soldOut.includes(item.id) ? 'sold-out' : ''}><div class="menu-row">${leader(itemLabel(item), soldOut.includes(item.id) ? html`<span class="fresh-chip"><${Icon} name="soldout" size=${16}/>${t('esSoldOut')}</span>` : item.price === 0 ? t('priceUnset') : money(item.price, s.group.currency))}
          ${this.state.editing && html`<div class="actions"><button disabled=${locked} onClick=${() => this.open({ kind: 'item', menuId: viewing.id, item })}><${Icon} name="edit"/>${t('edit')}</button><button class="danger" disabled=${locked} onClick=${() => this.confirm(t('deleteItem', item.name), t('delete'), () => this.action('menu.delete', { id: item.id }, t('itemDeleted')))}><${Icon} name="trash"/>${t('delete')}</button></div>`}</div></li>`)}</ul></section>`;
      })}
    </section>`;
  }
  picks(v) {
    const s = v.state, locked = s.group.status !== 'open', all = activeItems(s);
    const items = searchItems(rankItems(s, all), this.state.query);
    const myPicks = s.picks.filter(p => p.memberId === v.identity.id);
    return html`<section>${heading(t('picks'))}
      ${locked && html`<p class="banner warning"><${Icon} name="lock"/>${t('lockedPicks')}</p>`}
      ${all.length > 0 && html`<button class="quiet surprise" disabled=${locked} onClick=${() => { this.open({ kind: 'shuffle' }); this.props.store.suggest(matchMedia('(prefers-reduced-motion: reduce)').matches); }}><${Icon} name="dice"/>${t('undecided')}</button>`}
      ${all.length > 0 && this.search(items.length)}
      ${all.length > 0 && !items.length && html`<p>${t('noMatches')}</p>`}
      ${!all.length && html`<${Empty} text=${t('emptyMenu')} icon="menu"><button onClick=${() => this.go('menu')}>${t('menu')}</button><//>`}
      ${items.map(item => {
        const pick = myPicks.find(p => p.itemId === item.id), qty = pick?.qty || 0;
        return html`<article key=${item.id} class=${`pick-row ${qty ? 'selected' : ''}`}>
          ${leader(html`<button class="item-name" disabled=${locked} onClick=${() => this.open({ kind: 'note', item })} aria-label=${t('addNote', item.name)}>${item.name}</button>`, item.price === 0 ? t('priceUnset') : money(item.price, s.group.currency))}
          <div class="row"><button class=${`note-button ${pick?.note ? 'has-note' : ''}`} disabled=${locked} aria-label=${pick?.note ? t('editNoteFor', item.name, pick.note) : t('addNote', item.name)} onClick=${() => this.open({ kind: 'note', item })}><${Icon} name="note" size=${20}/><span>${pick?.note || t('noteShort')}</span></button><div class="stepper"><button aria-label=${t('removeOne', item.name)} disabled=${locked || !qty} onClick=${() => this.props.store.changePick(item.id, -1)}><${Icon} name="minus"/></button><output aria-label=${t('quantity', item.name, qty)} aria-live="polite">${qty}</output><button aria-label=${t('addOne', item.name)} disabled=${locked || qty === 99} onClick=${() => this.props.store.changePick(item.id, 1)}><${Icon} name="plus"/></button></div></div>
        </article>`;
      })}
      ${myPicks.length > 0 && html`<div class="total-bar">${leader(t('subtotal'), money(costs(s).people.find(p => p.id === v.identity.id)?.subtotal || 0, s.group.currency))}</div>`}
    </section>`;
  }
  order(v) {
    const s = v.state, totals = costs(s), orderer = s.group.ordererId === v.identity.id, c = s.group.currency;
    const lines = activeItems(s).map(item => [item, s.picks.filter(p => p.itemId === item.id).reduce((n, p) => n + p.qty, 0)]).filter(([, qty]) => qty);
    return html`<section>${heading(t('order'))}
      ${receipt(html`<p class="r-strong">${s.group.name}</p><p>${activeMenu(s)?.name || ''}</p>${s.group.status === 'locked' && html`<p class="r-strong">${t('locked')}</p>`}<p class="r-gap"></p>
        ${!lines.length && html`<p>${t('noPicks')}</p>`}
        ${lines.map(([item, qty]) => html`${leader(`${item.name} x ${qty}`, money(qty * item.price, c))}${itemNotes(s, item.id).map(n => html`<p class="r-item-note">- ${n}</p>`)}`)}
        <p class="r-rule" aria-hidden="true"></p>${leader(t('estimated'), money(totals.estimatedTotal, c), 'r-strong')}
        <p class="r-gap"></p><p>${t('orderer')}: ${nameOf(s, s.group.ordererId)}</p>`)}
      ${s.picks.length > 0 && html`<details class="breakdown"><summary>${t('perPerson')}</summary>${s.members.map(person => {
        const picks = s.picks.filter(p => p.memberId === person.id);
        return picks.length > 0 && html`<section key=${person.id}><h3>${person.name}</h3><ul class="plain-list">${picks.map(p => html`<li>${p.qty} × ${s.menu.find(i => i.id === p.itemId)?.name}${p.note && html`<small>${p.note}</small>`}</li>`)}</ul></section>`;
      })}</details>`}
      <div class="actions two order-actions"><button class="outbound" disabled=${!s.picks.length} onClick=${() => this.copy(orderText(s), t('orderCopied'))}><${Icon} name="copy"/>${t('copyOrder')}</button>
        ${orderer && (s.group.status === 'open' ? html`<button class="primary" disabled=${!s.picks.length} onClick=${() => this.action('order.lock', {})}><${Icon} name="lock"/>${t('lock')}</button>` : html`<button class="primary" onClick=${() => this.go('costs')}>${t('enterBill')}</button>`)}</div>
      ${orderer && s.group.status === 'locked' && html`<button class="quiet" onClick=${() => this.confirm(t('unlockConfirm'), t('unlock'), () => this.action('order.unlock', {}))}><${Icon} name="unlock"/>${t('unlock')}</button>`}
    </section>`;
  }
  costs(v) {
    const s = v.state, totals = costs(s), orderer = s.group.ordererId === v.identity.id, locked = s.group.status === 'locked', c = s.group.currency;
    const pricer = orderer || s.group.hostId === v.identity.id;
    const ordered = activeItems(s).filter(item => s.picks.some(p => p.itemId === item.id));
    const pricesOpen = pricer && ordered.length > 0 && (!locked || s.round.actualTotal === null);
    const payment = person => {
      const paid = !!s.round.payments[person.id];
      if (person.id === s.group.ordererId) return html`<span class="r-note">${t('ownShare')}</span>`;
      if (!person.participating) return html`<span class="r-note">—</span>`;
      if (orderer && locked) return html`<button class=${paid ? 'stamp' : 'r-button'} aria-pressed=${paid} aria-label=${`${person.name}: ${paid ? 'paid' : 'not paid'}`} onClick=${() => this.action('payment.set', { id: person.id, paid: !paid })}>${t(paid ? 'paid' : 'unpaid')}</button>`;
      return paid ? html`<span class="stamp">${t('paid')}</span>` : '';
    };
    return html`<section>${heading(t('costs'))}
      ${pricesOpen && html`<form class="stack price-form" key=${`prices-${s.round.id}-${s.group.version}`} onSubmit=${e => { e.preventDefault(); const f = fields(e); this.run(() => this.action('item.price', { prices: ordered.map(item => ({ id: item.id, price: cents(f[`price-${item.id}`]) })) }, t('pricesSaved'))); }}>
        <h2>${t('itemPrices')}</h2><p class="muted">${t('itemPricesHelp')}</p>
        ${ordered.map(item => html`<label key=${item.id}>${item.name}<input name=${`price-${item.id}`} type="number" inputmode="decimal" min="0" max="1000000" step="0.01" placeholder="0" defaultValue=${item.price ? item.price / 100 : ''}/></label>`)}
        <button>${t('savePrices')}</button>
      </form>`}
      ${orderer && html`<form class="stack bill-form" key=${s.round.id} onSubmit=${e => { e.preventDefault(); const f = fields(e); this.run(() => this.action('bill.set', { actualTotal: cents(f.bill), splitMode: f.split }, t('billSaved'))); }}>
        ${!locked && html`<p class="banner warning"><${Icon} name="lock"/>${t('lockFirst')}</p>`}
        <label>${t('bill', c)}<input name="bill" required type="number" min="0" max="1000000" step="0.01" inputmode="decimal" defaultValue=${s.round.actualTotal === null ? '' : (s.round.actualTotal / 100).toFixed(2)} disabled=${!locked}/><small>${t('billHelp')}</small></label>
        <label>${t('split')}<select name="split" defaultValue=${s.round.splitMode} disabled=${!locked}><option value="equal">${t('splitEqual')}</option><option value="proportional">${t('splitProportional')}</option></select></label>
        <button disabled=${!locked}>${t('saveBill')}</button>
      </form>`}
      ${receipt(html`<p class="r-strong">${s.group.name}</p><p class="r-gap"></p>
        ${leader(t('estimated'), money(totals.estimatedTotal, c))}
        ${s.round.actualTotal !== null ? leader(t('actual'), money(s.round.actualTotal, c), 'r-strong') : html`<p>${t('actualNotEntered')}</p>`}
        <p class="r-rule single" aria-hidden="true"></p>
        <ul class="r-people">${totals.people.map(person => html`<li key=${person.id}>${leader(person.name, money(person.owed, c))}<span class="r-pay">${payment(person)}</span></li>`)}</ul>
        <p class="r-rule" aria-hidden="true"></p>
        <div class="r-total"><span>${t('finalTotal')}</span><strong>${money(totals.actualTotal, c)}</strong></div>`)}
      ${orderer && locked && html`<button class="primary full" onClick=${() => this.confirm(t('finishConfirm'), t('finish'), () => this.finishRound(s))}>${t('finish')}</button>`}
    </section>`;
  }
  history(v) {
    const s = v.state, tally = debts(s);
    return html`<section>${heading(t('history'))}
      ${!s.history.length ? html`<${Empty} text=${t('emptyHistory')} icon="history"/>` : html`<section><h2>${t('outstanding')}</h2>${!tally.length ? html`<p>${t('allSettled')}</p>` : html`<ul class="item-list">${tally.map(d => html`<li>${leader(`${d.name} → ${d.orderer}`, money(d.amount, d.currency))}</li>`)}</ul>`}</section>`}
      ${[...s.history].reverse().map(round => receipt(html`<p class="r-strong">${date(round.date)}</p><p>${round.menuName || ''}</p><p>${t('orderer')}: ${round.members.find(m => m.id === round.ordererId)?.name}</p><p class="r-gap"></p>
        <ul class="r-people">${round.amounts.filter(p => p.owed || round.picks.some(pick => pick.memberId === p.id)).map(person => {
          const paid = !!round.payments[person.id];
          return html`<li key=${person.id}>${leader(person.name, money(person.owed, round.currency))}<span class="r-pay">${person.id === round.ordererId ? html`<span class="r-note">${t('ownShare')}</span>` : round.ordererId === v.identity.id ? html`<button class=${paid ? 'stamp' : 'r-button'} aria-pressed=${paid} onClick=${() => this.action('history.payment', { roundId: round.id, id: person.id, paid: !paid })}>${t(paid ? 'paid' : 'unpaid')}</button>` : paid ? html`<span class="stamp">${t('paid')}</span>` : ''}</span></li>`;
        })}</ul>
        <p class="r-rule" aria-hidden="true"></p>${leader(t('finalTotal'), money(round.actualTotal ?? round.estimatedTotal, round.currency), 'r-strong')}`, round.id))}
    </section>`;
  }
  settings(v) {
    const s = v.state, store = this.props.store;
    const theme = resolvedTheme(v.preferences.theme);
    return html`<section>${heading(t('settings'))}
      <div class="stack">
      ${s && html`<form class="stack" onSubmit=${e => { e.preventDefault(); this.action('member.rename', { name: fields(e).name }); }}><label>${t('displayName')}<span class="with-dice"><input name="name" required maxlength="30" defaultValue=${v.identity.name}/><button>${t('saveName')}</button></span></label></form>`}
      ${v.role === 'host' && s && html`<form class="stack" onSubmit=${e => { e.preventDefault(); this.action('group.currency', { currency: fields(e).currency }); }}><label>${t('groupCurrency')}<span class="with-dice"><input name="currency" required maxlength="8" defaultValue=${s.group.currency} list="currencies"/><button disabled=${s.group.status !== 'open'}>${t('saveCurrency')}</button></span><small>${t('currencyHint')}</small></label><datalist id="currencies"><option value="Rs"/><option value="₹"/><option value="$"/><option value="€"/></datalist></form>`}
      <fieldset><legend>${t('theme')}</legend><div class="segmented">${['light', 'dark'].map(value => html`<button type="button" aria-pressed=${theme === value} onClick=${() => this.run(() => store.preferences({ theme: value }))}>${theme === value && html`<${Icon} name="check" size=${20}/>`}${t(value)}</button>`)}</div></fieldset>
      ${s && html`<button class="outbound" onClick=${() => this.download(store.backup())}><${Icon} name="share"/>${t('export')}</button>`}
      <${ContribSettings} key=${String(v.preferences.shareEatsights)} view=${v} store=${store} onReset=${done => this.open({ kind: 'resetKey', done })}/>
      ${v.role === 'host' && s && html`<button onClick=${() => this.confirm(t('regenerateConfirm'), t('regenerate'), () => store.regenerateCode())}>${t('regenerate')}</button>`}
      ${s && html`<button class="danger" onClick=${() => this.confirm(t('leaveConfirm'), t('leave'), () => store.leave())}><${Icon} name="alert"/>${t('leave')}</button>`}
      ${v.updateReady ? html`<button class="primary" disabled=${v.updating} onClick=${() => store.applyUpdate?.()}>${t(v.updating ? 'updating' : 'updateNow')}</button>`
        : html`<button class="quiet" disabled=${this.state.checking} onClick=${async () => { this.setState({ checking: true }); const r = await (store.checkForUpdate?.() ?? 'current'); this.setState({ checking: false }); store.toast(t(r === 'ready' ? 'updateFound' : r === 'offline' ? 'updateOffline' : 'upToDate')); }}>${t(this.state.checking ? 'checking' : 'checkUpdates')}</button>`}
      <details class="dev-details" onToggle=${e => this.setState({ devOpen: e.currentTarget.open })}><summary>${t('devOptions')}</summary>${this.state.devOpen && html`<${DevOptions} view=${v} store=${store}/>`}</details>
      <p class="fineprint">${t('version', APP_VERSION)} · <a href="https://github.com/tellmeY18/chaikadi.fyi" target="_blank" rel="noopener">${t('source')}</a> · <a href=${EATSIGHTS_URL} target="_blank" rel="noopener noreferrer">${t('libraryReadme')}</a></p>
      </div>
    </section>`;
  }
  async finishRound(s) {
    // Offer (never send) Eatsights contributions after the round is archived.
    const ok = await this.action('round.finish', { nextRoundId: uid(), date: new Date().toISOString() }, t('roundSaved'));
    const es = esSource(activeMenu(s));
    if (!ok || !es) return;
    // At most one optional sheet, only when it asks something new (rules and
    // tests: prompts.js). Nothing is sent without "Send".
    const v = this.state.view, store = this.props.store;
    const soldOut = this.soldOutToday(v).map(id => s.menu.find(i => i.id === id)?.name).filter(Boolean);
    const items = activeItems(s).filter(item => s.picks.some(p => p.itemId === item.id)).map(item => ({ name: item.name, price: item.price, category: item.category,
      before: es.items.find(x => x.name.toLowerCase() === item.name.toLowerCase())?.price }));
    const facts = sharingOn(v) ? await roundFacts(es, items.map(i => i.name)) : [];
    const { plan, history } = planRound({ isOrderer: s.group.ordererId === v.identity.id, sharing: sharingOn(v), source: es,
      items: items.map((item, i) => ({ ...item, fact: facts[i] })), soldOut, history: v.preferences.esPrompts, date: today() });
    await store.preferences({ esPrompts: history }).catch(() => {});
    if (plan) this.open({ kind: 'esRound', plan, source: es, items });
  }
  // Sold-out marks are kept on this device for the rest of the day.
  soldOutToday(v) { const m = v.preferences.soldOut; return m?.date === new Date().toDateString() && Array.isArray(m.ids) ? m.ids : []; }
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
    if (p.kind === 'library') return html`<${LibrarySheet} key=${p.initialPlace || 'library'} store=${store} view=${v} initialPlace=${p.initialPlace} initialCity=${p.city} onClose=${close} onImported=${id => { this.setState({ viewMenu: id, editing: false }); close(); }}
      onNewMenu=${() => this.open({ kind: 'menuName' })} onAddStall=${city => this.open({ kind: 'addStall', city })}/>`;
    const toSettings = () => { close(); this.go('settings'); };
    if (p.kind === 'esRound') return html`<${EsRoundSheet} plan=${p.plan} source=${p.source} items=${p.items} store=${store} currency=${s?.group.currency || 'Rs'} onClose=${close}
      onOutcome=${outcome => store.preferences({ esPrompts: afterSheet(store.view().preferences.esPrompts, p.plan, outcome, today()) }).catch(() => {})}/>`;
    if (p.kind === 'resetKey') return html`<${ResetKeySheet} store=${store} onClose=${close} onDone=${p.done}/>`;
    if (p.kind === 'addStall') return html`<${AddStallSheet} view=${v} city=${p.city} onClose=${close} onSettings=${toSettings}
      onUse=${(place, city) => this.open({ kind: 'library', initialPlace: place.id, city })}
      onAddItems=${added => this.run(async () => {
        const today = new Date().toISOString().slice(0, 10);
        const id = s ? await store.newMenu(added.name, { placeId: added.id, city: added.city, name: added.name, lastConfirmed: today, sample: false, items: [] }) : null;
        if (!id) { close(); return; }
        this.setState({ viewMenu: id, editing: false }); this.go('menu'); this.open({ kind: 'item', menuId: id });
      })}/>`;
    if (p.kind === 'esItem') {
      const item = p.item, sold = this.soldOutToday(v).includes(item.id);
      return html`<${EsItemSheet} item=${item} soldOut=${sold} onClose=${close} onPick=${() => submit(() => store.changePick(item.id, 1))}
        onSoldOut=${() => this.run(async () => {
          const ids = sold ? this.soldOutToday(v).filter(x => x !== item.id) : [...this.soldOutToday(v), item.id];
          await store.preferences({ soldOut: { date: new Date().toDateString(), ids } });
          close();
          // Offered to Eatsights in the sheet at Finish, not sent now.
          if (!sold) store.toast(t('esSoldOutDone', item.name));
        })}/>`;
    }
    if (p.kind === 'add') return html`<${Sheet} title=${t('addTitle')} onClose=${close}><ul class="sheet-list">
      <li><button disabled=${p.locked} onClick=${() => this.open({ kind: 'item', menuId: p.menuId })}><${Icon} name="plus"/>${t('itemShort')}</button></li>
      <li><button disabled=${p.locked} onClick=${() => this.open({ kind: 'scan', menuId: p.menuId })}><${Icon} name="camera"/>${t('scanMenu')}</button></li>
      <li><button onClick=${() => this.open({ kind: 'library' })}><${Icon} name="book"/>${t('library')}</button></li>
      <li><button onClick=${() => this.open({ kind: 'menuName' })}><${Icon} name="menu"/>${t('newMenu')}</button></li></ul><//>`;
    if (p.kind === 'member') {
      const m = s.members.find(x => x.id === p.member.id);
      if (!m) return null;
      return html`<${Sheet} title=${m.name} onClose=${close}><div class="stack">
        ${m.id !== s.group.ordererId && html`<button onClick=${() => { close(); this.action('orderer.set', { id: m.id }); }}>${t('makeOrderer')}</button>`}
        <button class="danger" disabled=${s.group.status !== 'open'} onClick=${() => { close(); this.confirm(t('removePerson', m.name), t('remove'), () => this.action('member.remove', { id: m.id })); }}><${Icon} name="alert"/>${t('remove')}</button></div><//>`;
    }
    if (p.kind === 'copy') return html`<${Sheet} title=${t('selectCopy')} onClose=${close}><textarea readonly rows="8" value=${p.text} onFocus=${e => e.currentTarget.select()} autofocus></textarea><button class="primary" onClick=${close}>${t('done')}</button><//>`;
    if (p.kind === 'locked') return html`<${Sheet} title=${t('order')} onClose=${close} className="lock-reveal"><${Icon} name="tumbler" size=${48}/><div class="typed-lock" aria-hidden="true">${t('locked')}</div><div class="lock-rule" aria-hidden="true"></div><p>${t('lockHelp')}</p><button class="primary" onClick=${close}>${t('done')}</button><//>`;
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
      return html`<${Sheet} title=${p.item.name} onClose=${close}>${error}<form class="stack" onSubmit=${e => { e.preventDefault(); const note = fields(e).note; submit(async () => { if (!pick && !await store.changePick(p.item.id, 1)) return false; const ok = await store.saveNote(p.item.id, note); if (ok) store.toast(t('noteSaved')); return ok; }); }}><label>${t('itemNote')}<textarea name="note" rows="3" maxlength="160" defaultValue=${pick?.note || ''} placeholder=${p.item.name === 'Snack' ? t('snackPlaceholder') : t('notePlaceholder')} disabled=${locked} autofocus></textarea></label>${!pick && html`<p class="muted">${t('noteAddsItem')}</p>`}<button class="primary" disabled=${locked}>${t('saveNote')}</button></form><//>`;
    }
    return null;
  }
  render() {
    const v = this.state.view, s = v.state, store = this.props.store;
    const tabs = [['menu', 'menu'], ['picks', 'user'], ['order', 'receipt'], ['costs', 'rupee']];
    const online = v.role === 'host' || v.hostOnline;
    const onlineCount = s ? s.members.filter(m => m.online && online).length : 0;
    const count = s?.picks.filter(p => p.memberId === v.identity.id).reduce((n, p) => n + p.qty, 0) || 0;
    return html`<div class="app-shell"><header class="app-header"><div class="header-inner"><a class="brand" href="#" onClick=${e => { e.preventDefault(); this.go('lobby'); }}><${Icon} name="tumbler" size=${28}/><span>${t('app')}</span></a>
      <div class="header-actions">${s && html`<button class="header-presence" aria-label=${`${t('group')}: ${t('onlineCount', onlineCount)}`} onClick=${() => this.go('lobby')}><span class=${`presence ${online ? 'online crayon-green' : ''}`} aria-hidden="true"></span><span aria-hidden="true">${onlineCount}</span></button>`}<button class="quiet icon-button" aria-label=${t('more')} aria-expanded=${this.state.appMenu} onClick=${() => this.setState({ appMenu: !this.state.appMenu })}><${Icon} name="more"/></button></div></div>
      ${this.state.appMenu && html`<nav class="app-menu" aria-label=${t('more')}>${s && html`<button onClick=${() => this.go('lobby')}><${Icon} name="user"/>${t('group')}</button><button onClick=${() => this.go('history')}><${Icon} name="history"/>${t('history')}</button>`}<button onClick=${() => this.go('settings')}><${Icon} name="settings"/>${t('settings')}</button></nav>`}
      </header>
      ${this.state.appMenu && html`<div class="scrim" aria-hidden="true" onClick=${() => this.setState({ appMenu: false })}></div>`}
      <main id="main">
        ${!v.ready ? html`<p role="status">${t('opening')}</p>` : html`
          ${v.updating && html`<p class="sync-status" role="status">${t('updating')}</p>`}
          ${v.storageWarning && html`<div class="banner error" role="alert"><${Icon} name="alert"/><span><span class="sr-only">${t('error')}</span> ${v.storageWarning}</span></div>`}
          ${v.notice && html`<div class="banner error" role="alert"><${Icon} name="alert"/><span><span class="sr-only">${t('error')}</span> ${v.notice}</span><button class="quiet icon-button" aria-label=${t('dismiss')} onClick=${() => store.notice('')}><${Icon} name="close"/></button></div>`}
          ${v.role === 'member' && s && !v.hostOnline && html`<div class="banner warning" role="status"><${Icon} name="offline"/><span>${t('hostOffline')} ${t('queued', v.pending)}</span><button class="quiet" onClick=${() => store.startRoom()}>${t('retry')}</button></div>`}
          ${v.pending > 0 && v.hostOnline && html`<p class="sync-status" role="status">${t('sending', v.pending)}</p>`}
          ${!s && v.role === 'member' && html`<div class=${`banner ${v.unreachable ? 'error' : 'info'}`} role="status">${v.unreachable ? html`<${Icon} name="alert"/><span>${t('hostUnreachable', v.targetCode)}</span><button class="quiet" onClick=${() => store.startRoom()}>${t('retry')}</button>` : html`<span>${t('connecting')}</span>`}</div>`}
          ${v.tab === 'settings' ? this.settings(v) : !s ? this.home(v) : this[v.tab]?.(v)}
        `}
      </main>
      ${s && html`<nav class="bottom-nav" aria-label="Main navigation">${tabs.map(([key, icon]) => html`<button key=${key} class=${v.tab === key ? 'active' : ''} aria-current=${v.tab === key ? 'page' : undefined} onClick=${() => this.go(key)}><span class="tab-icon"><${Icon} name=${icon}/>${key === 'picks' && count > 0 && html`<span class="tab-badge"><span class="sr-only">, </span>${count}</span>`}${key === 'order' && s.group.status === 'locked' && html`<span class="tab-badge"><${Icon} name="lock" size=${12}/><span class="sr-only">, ${t('locked')}</span></span>`}</span><span class="tab-label">${t(key)}</span></button>`)}</nav>`}
      ${v.toast && html`<button class="toast" role="status" aria-live="polite" onClick=${() => store.toast('')}>${v.toast}</button>`}
      ${this.renderSheet(v)}
      ${this.state.confirmation && html`<${Modal} title=${this.state.confirmation.label} onClose=${() => this.setState({ confirmation: null })}><p>${this.state.confirmation.message}</p><div class="stack"><button autofocus onClick=${() => this.setState({ confirmation: null })}>${t('keep')}</button><button class="danger" onClick=${() => { const action = this.state.confirmation.action; this.setState({ confirmation: null }); this.run(action); }}><${Icon} name="alert"/>${this.state.confirmation.label}</button></div><//>`}
    </div>`;
  }
}
export function mount(store, element) { element.replaceChildren(); render(html`<${App} store=${store}/>`, element); }
