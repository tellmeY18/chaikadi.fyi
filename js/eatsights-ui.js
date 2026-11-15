// Eatsights contribution UI: the one optional sheet per round (prices, sold
// out, wait time, rating), item actions, contribution settings and "Add a stall".
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

// Group item names -> Eatsights ids, using the place's current menu (cached
// copy when offline). Returns the mapped place too, for its facts.
async function resolve(source, names) {
  const place = await eatsights().placeMenu(source.placeId, source.city);
  const lines = place ? orderableItems(place) : [];
  const find = name => lines.find(l => same(l.name, name)) || lines.find(l => same(l.name.replace(/ \(.*\)$/, ''), name));
  return { place, placeId: place?.es?.id || fromSlug(source.placeId, 'pl_'),
    ids: names.map(name => { const hit = find(name); return hit ? fromSlug(hit.id, 'mi_') : null; }),
    facts: names.map(name => { const hit = find(name); return hit ? place.es.items[hit.id] || null : null; }) };
}
// Eatsights facts for the round's items (null for items Eatsights lacks).
export async function roundFacts(source, names) {
  try { return (await resolve(source, names)).facts; } catch { return names.map(() => undefined); }
}
const SECTION_KIND = { Tea: 'drinks', Snacks: 'snacks', Meal: 'meals', Other: 'other' };
// Items the group added that Eatsights does not have yet: one section per
// category (reusing the stall's own) and one menu item each.
async function createItems(place, placeId, missing) {
  const sections = new Map();
  for (const s of place?.sections || []) {
    const hit = Object.entries(SECTION_KIND).find(([category, kind]) => same(s.name, kind) || same(s.name, t('categories')[category]));
    if (hit && !sections.has(hit[1]) && fromSlug(s.id, 'sc_')) sections.set(hit[1], fromSlug(s.id, 'sc_'));
  }
  const list = [], ids = [], at = [], sectionAt = new Map();
  for (const item of missing) {
    const kind = SECTION_KIND[item.category] || 'other';
    if (!sections.get(kind)) {
      const id = newId('sc_');
      sections.set(kind, id);
      sectionAt.set(kind, list.length);
      list.push({ entity_type: 'section', entity: { id, place_id: placeId, labels: { en: t('categories')[item.category] || 'Menu' }, kind } });
    }
    const id = newId('mi_');
    ids.push(id); at.push([list.length, kind]);
    list.push({ entity_type: 'menu_item', entity: { id, place_id: placeId, section_id: sections.get(kind), labels: { en: item.name.slice(0, 80) } } });
  }
  const results = list.length ? await contrib().createEntities(list) : [];
  const ok = i => i === undefined || results[i]?.status !== 'rejected';
  return ids.map((id, i) => (ok(at[i][0]) && ok(sectionAt.get(at[i][1])) ? id : null));
}
// entries: [{ name, property, value, category?, prompt? }] -> one result per
// entry. Price entries for items Eatsights lacks create those items first.
export async function sendFacts(source, entries) {
  const { place, placeId, ids } = await resolve(source, entries.map(e => e.name));
  const missing = entries.map((e, i) => (!ids[i] && e.property === 'price.amount' ? i : -1)).filter(i => i >= 0);
  if (missing.length && placeId) {
    const made = await createItems(place, placeId, missing.map(i => entries[i]));
    missing.forEach((i, j) => { ids[i] = made[j]; });
    // Other facts about a just-created item (sold out, rating) use its new id.
    entries.forEach((e, i) => { if (!ids[i]) { const k = entries.findIndex((x, j) => ids[j] && same(x.name, e.name)); if (k >= 0) ids[i] = ids[k]; } });
  }
  const c = contrib(), out = new Array(entries.length), signed = [], where = [];
  for (let i = 0; i < entries.length; i++) {
    if (!ids[i] || !placeId) { out[i] = { status: 'rejected', reason: t('esNotOnMenu') }; continue; }
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
const KIND_TEXT = { changed: null, new: 'esKindNew', contested: 'esKindContested', unconfirmed: 'esKindUnconfirmed', stale: 'esKindStale', old: 'esKindOld' };

// The one optional sheet per round (see prompts.js for when it shows).
// Not now stays the main button; nothing is sent without "Send".
export class EsRoundSheet extends Component {
  constructor(props) {
    super(props);
    const { plan } = props;
    this.state = { answers: plan.prices.map(p => (p.kind === 'changed' || p.kind === 'new' ? 'send' : 'same')), newPrices: {}, sold: plan.soldOut.map(() => true),
      wait: null, scores: {}, busy: false, results: null };
  }
  entries() {
    const { plan, items } = this.props, { answers, newPrices, sold, wait, scores } = this.state;
    const category = name => items.find(i => same(i.name, name))?.category;
    const out = [];
    plan.prices.forEach((p, i) => {
      const a = answers[i];
      if (a === 'skip') return;
      const price = a === 'changed' ? newPrices[i] : p.price;
      if (Number.isInteger(price) && price >= 0) out.push({ name: p.name, label: p.name, property: 'price.amount', value: priceValue(price), category: category(p.name), prompt: p.kind === 'changed' || p.kind === 'new' ? undefined : 'one_tap' });
    });
    plan.soldOut.forEach((name, i) => { if (sold[i]) out.push({ name, label: `${name} · ${t('esSoldOut')}`, property: 'availability.observed', value: { state: 'sold_out' } }); });
    if (wait) for (const p of items.slice(0, 5)) out.push({ name: p.name, label: `${p.name} · ${t('esWaitShort')}`, property: 'prep.wait_time', value: { seconds: wait, stage: 'order_to_served' }, hidden: true });
    for (const [name, score] of Object.entries(scores)) if (score) out.push({ name, label: `${name} · ${score}/5`, property: 'quality.score', value: { score } });
    return out;
  }
  async send() {
    const entries = this.entries();
    this.setState({ busy: true });
    try {
      const results = await sendFacts(this.props.source, entries);
      this.setState({ busy: false, results, sent: entries });
      this.props.onOutcome('sent');
    } catch (error) { this.setState({ busy: false }); this.props.store.notice(error.message); }
  }
  render({ plan, currency, onClose, onOutcome }) {
    const { answers, newPrices, sold, wait, scores, busy, results, sent } = this.state;
    if (results) {
      const queued = results.some(r => r.status === 'queued');
      const shown = sent.map((e, i) => [e, results[i]]).filter(([e]) => !e.hidden);
      return html`<${Sheet} title=${t(queued ? 'esQueuedTitle' : 'esSentTitle')} onClose=${onClose}>
        ${queued && html`<div class="banner dashed" role="status"><${Icon} name="offline"/><span><strong>${t('esOffline')}</strong> ${t('esOfflineHint')}</span></div>`}
        <ul class="change-list">${shown.map(([e, r]) => html`<li key=${e.label}><div class="change-copy"><strong>${e.label}</strong>${e.property === 'price.amount' && html`<span>${money(e.value.amount_minor, currency)}</span>`}<${ResultChip} result=${r}/></div></li>`)}</ul>
        <div class="sheet-actions"><button class="primary" onClick=${onClose}>${t('done')}</button>
          ${queued && html`<button class="danger" onClick=${async () => { await contrib().discardPending(); onClose(); }}>${t('esDontSend')}</button>`}</div><//>`;
    }
    const setAnswer = (i, a) => { const next = [...answers]; next[i] = a; this.setState({ answers: next }); };
    const count = this.entries().length;
    return html`<${Sheet} title=${t('esRoundTitle')} className="round-sheet" onClose=${() => { onOutcome('skipped'); onClose(); }}>
      <p>${t('esRoundIntro')}</p>
      ${plan.prices.length > 0 && html`<h3 class="round-heading">${t('esPrices')}</h3><ul class="change-list">${plan.prices.map((p, i) => html`<li key=${p.name} data-kind=${p.kind}>
        ${p.kind === 'changed' || p.kind === 'new'
          ? html`<label class="check-row"><input type="checkbox" checked=${answers[i] !== 'skip'} onChange=${e => setAnswer(i, e.currentTarget.checked ? 'send' : 'skip')}/>
              <div class="change-copy"><strong>${p.name}</strong>${p.kind === 'changed' ? html`<span class="change-diff"><s>${money(p.before, currency)}</s><${Icon} name="arrow" size=${16}/><strong>${money(p.price, currency)}</strong></span>` : html`<span class="change-diff"><strong>${money(p.price, currency)}</strong></span><small>${t('esKindNew')}</small>`}</div></label>`
          : html`<div class="change-copy"><strong>${t('esStill', p.name, money(p.price, currency))}</strong><small>${t(KIND_TEXT[p.kind])}</small>
              <div class="choice-row" role="group" aria-label=${p.name}>${[['same', 'esYes'], ['changed', 'esChanged'], ['skip', 'esSkip']].map(([a, k]) => html`<button type="button" aria-pressed=${answers[i] === a} onClick=${() => setAnswer(i, a)}>${t(k)}</button>`)}</div>
              ${answers[i] === 'changed' && html`<label>${t('esNewPrice', p.name)}<input type="number" inputmode="decimal" min="0" step="0.01" autofocus
                onInput=${e => { const v = e.currentTarget.value; this.setState({ newPrices: { ...newPrices, [i]: /^\d+(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : undefined } }); }}/></label>`}</div>`}
      </li>`)}</ul>`}
      ${plan.soldOut.length > 0 && html`<h3 class="round-heading">${t('esSoldOut')}</h3><ul class="change-list">${plan.soldOut.map((name, i) => html`<li key=${name}><label class="check-row"><input type="checkbox" checked=${sold[i]}
        onChange=${e => { const next = [...sold]; next[i] = e.currentTarget.checked; this.setState({ sold: next }); }}/><strong>${name}</strong></label></li>`)}</ul>`}
      ${plan.wait && html`<fieldset class="round-wait"><legend class="round-heading">${t('esWaitTitle')}</legend><div class="choice-row four">${t('esWaits').map(([label, s]) => html`<button type="button" aria-pressed=${wait === s} onClick=${() => this.setState({ wait: wait === s ? null : s })}>${label}</button>`)}</div></fieldset>`}
      ${plan.rate.length > 0 && html`<h3 class="round-heading">${t('esRateTitle')}</h3><ul class="rate-list">${plan.rate.map(name => html`<li key=${name} class="rate-row"><span class="rate-name">${name}</span><div class="choice-row five">${[1, 2, 3, 4, 5].map(n => html`<button type="button" aria-label=${t('esRate', name, n)} aria-pressed=${scores[name] === n}
        onClick=${() => this.setState({ scores: { ...scores, [name]: scores[name] === n ? 0 : n } })}>${n}</button>`)}</div></li>`)}</ul>`}
      <div class="sheet-actions"><button class="primary" onClick=${() => { onOutcome('skipped'); onClose(); }}>${t('notNow')}</button>
        <button class="outbound" disabled=${!count || busy} onClick=${() => this.send()}><${Icon} name="share"/>${busy ? t('esSending') : t('esSendN', count)}</button></div><//>`;
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
