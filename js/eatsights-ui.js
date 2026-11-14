// Eatsights contribution UI: share sheet v2, results, one-tap checks, sold
// out, wait time, quality score, contribution settings and "Add a stall".
// Everything here is optional; nothing is sent while sharing is off.
import { h, Component } from '../vendor/preact.module.js';
import htm from '../vendor/htm.module.js';
import { EATSIGHTS_CITIES } from './config.js';
import { orderableItems } from './data.js';
import { createEatsightsClient, fromSlug, toSlug, isEatsightsPlace, KIND_TO_CATEGORY } from './eatsights.js';
import { contrib, newId, supported } from './contrib.js';
import { t, money } from './strings.js';
import { Icon, Sheet } from './components.js';
import { EsChip } from './library-ui.js';

const html = htm.bind(h);
let esClient = null;
const eatsights = () => (esClient ??= createEatsightsClient());
const same = (a, b) => String(a).normalize('NFKC').trim().toLowerCase() === String(b).normalize('NFKC').trim().toLowerCase();
// On unless turned off in Settings. Nothing is sent without a tap (Share, Yes, Done…).
export const sharingOn = view => view.preferences.shareEatsights !== false;
export const esSource = menu => (menu?.source && isEatsightsPlace(menu.source.placeId) ? menu.source : null);

// Group item names -> Eatsights ids, using the place's current menu.
async function resolve(source, names) {
  const place = await eatsights().placeMenu(source.placeId, source.city);
  const lines = place ? orderableItems(place) : [];
  return { placeId: place?.es?.id || fromSlug(source.placeId, 'pl_'),
    ids: names.map(name => { const hit = lines.find(l => same(l.name, name)) || lines.find(l => same(l.name.replace(/ \(.*\)$/, ''), name)); return hit ? fromSlug(hit.id, 'mi_') : null; }) };
}
// entries: [{ name, property, value, prompt? }] -> one result per entry.
export async function sendFacts(source, entries) {
  const { placeId, ids } = await resolve(source, entries.map(e => e.name));
  const c = contrib(), out = new Array(entries.length), signed = [], where = [];
  for (let i = 0; i < entries.length; i++) {
    if (!ids[i] || !placeId) { out[i] = { status: 'rejected', reason: 'not on the Eatsights menu' }; continue; }
    signed.push(await c.observation({ property: entries[i].property, placeId, itemId: ids[i], value: entries[i].value, prompt: entries[i].prompt }));
    where.push(i);
  }
  const results = await c.submit(signed);
  where.forEach((i, j) => { out[i] = results[j]; });
  return out;
}
export const priceValue = cents => ({ amount_minor: cents, currency: 'INR', fulfilment: 'dine_in' });

const RESULT = { sent: ['check', false, () => t('esSent')], already: ['dup', true, () => t('esAlready')], rejected: ['close', false, r => t('esRejected', r.reason)], queued: ['clock', true, () => t('esQueued')] };
const ResultChip = ({ result }) => { const [icon, dashed, text] = RESULT[result.status] || RESULT.rejected; return html`<span class=${`fresh-chip ${dashed ? 'dashed' : ''}`}><${Icon} name=${icon} size=${16}/>${text(result)}</span>`; };
const Change = ({ change, currency, children }) => html`<div class="change-copy"><strong>${change.name}</strong>
  <span class="change-diff"><s>${money(change.before, currency)}</s><${Icon} name="arrow" size=${16}/><strong>${money(change.price, currency)}</strong></span>${children}</div>`;

// "Share these price updates?" v2. Not now stays the main button.
export class EsShareSheet extends Component {
  constructor(props) { super(props); this.state = { picked: props.changes.map(() => true), busy: false, results: null }; }
  async share() {
    const { source, changes, store } = this.props;
    const chosen = changes.filter((_, i) => this.state.picked[i]);
    this.setState({ busy: true });
    try {
      const results = await sendFacts(source, chosen.map(c => ({ name: c.name, property: 'price.amount', value: priceValue(c.price) })));
      this.setState({ busy: false, results, shown: chosen });
    } catch (error) { this.setState({ busy: false }); store.notice(error.message); }
  }
  render({ source, changes, view, currency, onClose, onSettings }) {
    const { picked, busy, results, shown } = this.state, on = sharingOn(view);
    if (results) {
      const queued = results.some(r => r.status === 'queued');
      return html`<${Sheet} title=${t(queued ? 'esQueuedTitle' : 'esSentTitle')} onClose=${onClose}>
        ${queued && html`<div class="banner dashed" role="status"><${Icon} name="offline"/><span><strong>${t('esOffline')}</strong> ${t('esOfflineHint')}</span></div>`}
        <ul class="change-list">${shown.map((c, i) => html`<li key=${c.name}><${Change} change=${c} currency=${currency}><${ResultChip} result=${results[i]}/><//></li>`)}</ul>
        <div class="sheet-actions"><button class="primary" onClick=${onClose}>${t('done')}</button>
          ${queued && html`<button class="danger" onClick=${async () => { await contrib().discardPending(); onClose(); }}>${t('esDontSend')}</button>`}</div><//>`;
    }
    const count = picked.filter(Boolean).length;
    return html`<${Sheet} title=${t('shareTitle')} onClose=${onClose}>
      <p>${t('esShareIntro', source.name)}</p>
      <ul class="change-list">${changes.map((c, i) => html`<li key=${c.name}><label class="check-row"><input type="checkbox" checked=${picked[i]} disabled=${!on}
        onChange=${e => { const next = [...picked]; next[i] = e.currentTarget.checked; this.setState({ picked: next }); }}/><${Change} change=${c} currency=${currency}/></label></li>`)}</ul>
      ${!on && html`<p class="muted">${t('esShareOff')}</p>`}
      <div class="sheet-actions"><button class="primary" onClick=${onClose}>${t('notNow')}</button>
        ${on ? html`<button class="outbound" disabled=${!count || busy} onClick=${() => this.share()}><${Icon} name="share"/>${busy ? t('esSending') : t('esShareN', count)}</button>`
          : html`<button class="quiet" onClick=${onSettings}>${t('esOpenSettings')}</button>`}</div><//>`;
  }
}

// Wait time after Finish round (prep.wait_time on each ordered item).
export class WaitSheet extends Component {
  constructor(props) { super(props); this.state = { seconds: null, busy: false }; }
  async done() {
    const { source, items, store, onNext } = this.props, seconds = this.state.seconds;
    if (seconds !== null) {
      this.setState({ busy: true });
      try { await sendFacts(source, items.map(i => ({ name: i.name, property: 'prep.wait_time', value: { seconds, stage: 'order_to_served' } }))); store.toast(t('esThanks')); }
      catch (error) { store.notice(error.message); }
    }
    onNext();
  }
  render({ onNext }) {
    const { seconds, busy } = this.state;
    return html`<${Sheet} title=${t('esWaitTitle')} onClose=${onNext}><p>${t('esWaitHint')}</p>
      <div class="choice-row" role="group" aria-label=${t('esWaitTitle')}>${t('esWaits').map(([label, s]) => html`<button type="button" aria-pressed=${seconds === s} onClick=${() => this.setState({ seconds: seconds === s ? null : s })}>${label}</button>`)}</div>
      <div class="sheet-actions"><button class="primary" disabled=${busy} onClick=${() => this.done()}>${t('done')}</button><button class="danger" onClick=${onNext}>${t('esSkip')}</button></div><//>`;
  }
}

// 1–5 per item (quality.score). No text, by design.
export class RateSheet extends Component {
  constructor(props) { super(props); this.state = { scores: {}, busy: false }; }
  async done() {
    const { source, items, store, onClose } = this.props, scores = this.state.scores;
    const chosen = items.filter(i => scores[i.name]);
    if (chosen.length) {
      this.setState({ busy: true });
      try { await sendFacts(source, chosen.map(i => ({ name: i.name, property: 'quality.score', value: { score: scores[i.name] } }))); store.toast(t('esThanks')); }
      catch (error) { store.notice(error.message); }
    }
    onClose();
  }
  render({ items, onClose }) {
    const { scores, busy } = this.state;
    return html`<${Sheet} title=${t('esRateTitle')} onClose=${onClose}><p>${t('esRateHint')}</p>
      ${items.map(item => html`<fieldset class="rate-row" key=${item.name}><legend>${item.name}</legend><div class="choice-row five">${[1, 2, 3, 4, 5].map(n => html`<button type="button" aria-label=${t('esRate', item.name, n)} aria-pressed=${scores[item.name] === n}
        onClick=${() => this.setState({ scores: { ...scores, [item.name]: scores[item.name] === n ? 0 : n } })}>${n}</button>`)}</div></fieldset>`)}
      <div class="sheet-actions"><button class="primary" disabled=${busy} onClick=${() => this.done()}>${t('done')}</button><button class="danger" onClick=${onClose}>${t('esSkip')}</button></div><//>`;
  }
}

// "Still Rs 10?" on the Order screen once the order is locked. Never blocking.
export class OneTapCard extends Component {
  constructor(props) { super(props); this.state = { answered: [], changing: false, busy: false }; }
  async answer(item, cents) {
    const { source, store } = this.props;
    this.setState({ busy: true });
    try { await sendFacts(source, [{ name: item.name, property: 'price.amount', value: priceValue(cents), prompt: 'one_tap' }]); store.toast(t('esThanks')); }
    catch (error) { store.notice(error.message); }
    this.skip(item);
  }
  skip(item) { this.setState({ answered: [...this.state.answered, item.id], changing: false, busy: false }); }
  render({ items, currency }) {
    const { answered, changing, busy } = this.state;
    const item = items.find(i => i.price > 0 && !answered.includes(i.id));
    if (!item) return null;
    return html`<section class="card" aria-label=${t('esQuickCheck')}><p class="muted">${t('esQuickCheck')}</p><p><strong>${t('esStill', item.name, money(item.price, currency))}</strong></p>
      ${changing ? html`<form class="with-dice" onSubmit=${e => { e.preventDefault(); const v = new FormData(e.currentTarget).get('price'); if (/^\d+(\.\d{1,2})?$/.test(v)) this.answer(item, Math.round(Number(v) * 100)); }}>
          <label class="sr-only" for="es-new-price">${t('esNewPrice', item.name)}</label><input id="es-new-price" name="price" type="number" inputmode="decimal" min="0" step="0.01" required autofocus placeholder=${t('esNewPrice', item.name)}/><button disabled=${busy}>${t('save')}</button></form>`
        : html`<div class="choice-row"><button disabled=${busy} onClick=${() => this.answer(item, item.price)}><${Icon} name="check" size=${18}/>${t('esYes')}</button>
          <button disabled=${busy} onClick=${() => this.setState({ changing: true })}><${Icon} name="edit" size=${18}/>${t('esChanged')}</button>
          <button class="danger" onClick=${() => this.skip(item)}>${t('esSkip')}</button></div>`}
      <p class="muted">${t('esCheckNote')}</p></section>`;
  }
}

// Item actions on an Eatsights-linked menu (orderer): add to picks, sold out.
export function EsItemSheet({ item, soldOut, onPick, onSoldOut, onClose }) {
  return html`<${Sheet} title=${item.name} onClose=${onClose}><ul class="sheet-list">
    <li><button onClick=${onPick}><${Icon} name="user"/>${t('esItemActions')}</button></li>
    <li><button onClick=${onSoldOut}><${Icon} name=${soldOut ? 'check' : 'soldout'}/><span class="row-copy"><span>${soldOut ? t('esSoldOutUndo') : t('esSoldOutMark')}</span><small>${t('esSoldOutHint')}</small></span></button></li></ul><//>`;
}

// Settings → Contributions.
export class ContribSettings extends Component {
  constructor(props) { super(props); this.state = { info: null, pending: 0 }; }
  componentDidMount() { this.load(); }
  async load() {
    if (!supported()) return;
    try { this.setState({ info: await contrib().info(), pending: await contrib().pending() }); } catch { /* storage blocked */ }
  }
  render({ view, store, onReset }) {
    const on = sharingOn(view), { info, pending } = this.state;
    if (!supported()) return html`<section><h2>${t('contribSection')}</h2><p class="muted">${t('contribUnsupported')}</p></section>`;
    return html`<section class="stack"><h2>${t('contribSection')}</h2>
      <fieldset><legend>${t('contribToggle')}</legend><div class="segmented">${[[true, 'on'], [false, 'off']].map(([value, key]) => html`<button type="button" aria-pressed=${on === value}
        onClick=${() => store.preferences({ shareEatsights: value }).then(() => this.load())}>${on === value && html`<${Icon} name="check" size=${20}/>`}${t(key)}</button>`)}</div></fieldset>
      <div><h3>${t('contribWhat')}</h3><ul class="plain-list dotted">${t('contribPoints').map(p => html`<li>${p}</li>`)}</ul></div>
      ${info ? html`<p class="chip-row"><span class="fresh-chip"><${Icon} name="key" size=${16}/>${t('contribKey')}</span></p>` : html`<p class="muted">${t('contribNoKey')}</p>`}
      ${pending > 0 && html`<p class="muted" role="status">${t('contribPending', pending)}</p>`}
      ${info && html`<button class="danger" onClick=${() => onReset(() => this.load())}>${t('contribReset')}</button>`}
    </section>`;
  }
}
export function ResetKeySheet({ store, onClose, onDone }) {
  return html`<${Sheet} title=${t('contribResetTitle')} onClose=${onClose}><p>${t('contribResetBody')}</p>
    <div class="sheet-actions"><button class="primary" onClick=${onClose}>${t('contribKeep')}</button>
      <button class="danger" onClick=${async () => { await contrib().reset(); store.toast(t('contribResetDone')); onDone?.(); onClose(); }}>${t('contribResetAction')}</button></div><//>`;
}

// Add a stall: details -> location -> duplicate check -> added.
export class AddStallSheet extends Component {
  constructor(props) {
    super(props);
    this.state = { step: 'details', name: '', local: '', kind: 'tea-stall', city: props.city || EATSIGHTS_CITIES[0].id, similar: [], busy: false, error: '', added: null };
  }
  async check() {
    this.setState({ busy: true, error: '' });
    try {
      const similar = await eatsights().findSimilar(this.state.city, this.state.name);
      if (similar.length) this.setState({ step: 'duplicates', similar, busy: false }); else await this.create();
    } catch (error) { this.setState({ busy: false, error: error.message }); }
  }
  async create() {
    const { name, local, kind, city } = this.state, c = EATSIGHTS_CITIES.find(x => x.id === city);
    this.setState({ busy: true, error: '' });
    try {
      const id = newId('pl_');
      await contrib().createPlace({ id, names: { en: name.trim(), ...(local.trim() ? { ml: local.trim() } : {}) }, category: KIND_TO_CATEGORY[kind] || 'other',
        location: { lat: c.centre.lat, lng: c.centre.lng, precision_m: 5000 }, city: c.slug });
      this.setState({ step: 'added', busy: false, added: { id: toSlug(id), name: name.trim(), city } });
    } catch (error) { this.setState({ busy: false, error: error.message }); }
  }
  render({ view, onClose, onSettings, onUse, onAddItems }) {
    const { step, name, local, kind, city, similar, busy, error, added } = this.state;
    const err = error && html`<p class="banner error" role="alert"><${Icon} name="alert"/><span><strong>${t('error')}</strong> ${error}</span></p>`;
    if (!sharingOn(view)) return html`<${Sheet} title=${t('addStall')} onClose=${onClose}><p>${t('stallNeedsSharing')}</p><div class="sheet-actions"><button class="primary" onClick=${onSettings}>${t('esOpenSettings')}</button></div><//>`;
    if (step === 'added') return html`<${Sheet} title=${t('stallAdded')} onClose=${onClose}><div class="stack"><${Icon} name="store" size=${40}/><h3>${added.name}</h3>
      <p class="chip-row"><${EsChip} summary=${{ status: 'unconfirmed', contributors: 1, last: new Date().toISOString().slice(0, 10) }}/></p><p>${t('stallAddedHint')}</p></div>
      <div class="sheet-actions"><button class="primary" onClick=${() => onAddItems(added)}>${t('addItemsNow')}</button><button onClick=${onClose}>${t('done')}</button></div><//>`;
    if (step === 'duplicates') return html`<${Sheet} title=${t('isItOne')} onClose=${onClose}>${err}<p>${t('similarNear')}</p>
      <ul class="library-results">${similar.map(p => html`<li key=${p.id} class="stack dup-row"><strong>${p.name}</strong><button onClick=${() => onUse(p, city)}>${t('useThisOne')}</button></li>`)}</ul>
      <div class="sheet-actions"><button class="primary" disabled=${busy} onClick=${() => this.create()}>${busy ? t('esSending') : t('noneAddNew')}</button></div><//>`;
    if (step === 'location') return html`<${Sheet} title=${t('whereIsIt')} onClose=${onClose}>${err}<p>${t('whereHint')}</p>
      <fieldset class="radio-list"><legend class="sr-only">${t('whereIsIt')}</legend>
        <label class="radio-row"><input type="radio" name="loc" checked/><${Icon} name="globe" size=${20}/><span><strong>${t('locCentre')}</strong><small>${t('locCentreHint')}</small></span></label>
        <label class="radio-row disabled"><input type="radio" name="loc" disabled/><${Icon} name="target" size=${20}/><span><strong>${t('locMine')}</strong><small>${t('locMineHint')}</small></span></label>
        <label class="radio-row disabled"><input type="radio" name="loc" disabled/><${Icon} name="map" size=${20}/><span><strong>${t('locMap')}</strong><small>${t('locMapHint')}</small></span></label></fieldset>
      <p class="muted">${t('stallShared')}</p>
      <div class="sheet-actions"><button class="primary" disabled=${busy} onClick=${() => this.check()}>${busy ? t('esSending') : t('checkDuplicates')}</button></div><//>`;
    return html`<${Sheet} title=${t('addStall')} onClose=${onClose}><form class="stack" onSubmit=${e => { e.preventDefault(); this.setState({ step: 'location' }); }}>
      <label>${t('stallName')}<input required maxlength="80" value=${name} onInput=${e => this.setState({ name: e.currentTarget.value })} autofocus/></label>
      <label>${t('stallLocalName')}<input maxlength="80" lang="ml" placeholder=${t('optional')} value=${local} onInput=${e => this.setState({ local: e.currentTarget.value })}/></label>
      <fieldset><legend>${t('stallKind')}</legend><div class="choice-row two">${t('stallKinds').map(([value, label]) => html`<button type="button" aria-pressed=${kind === value} onClick=${() => this.setState({ kind: value })}>${kind === value && html`<${Icon} name="check" size=${18}/>`}${label}</button>`)}</div></fieldset>
      <label>${t('stallCity')}<select value=${city} onChange=${e => this.setState({ city: e.currentTarget.value })}>${EATSIGHTS_CITIES.map(c => html`<option value=${c.id}>${c.name}</option>`)}</select></label>
      <button class="primary" disabled=${!name.trim()}>${t('nextLocation')}</button></form><//>`;
  }
}
