// Menu library UI: city picker, search, place preview, import and suggestions.
// Data access lives in data.js; this file only renders and calls the store.
import { h, Component } from '../vendor/preact.module.js';
import htm from '../vendor/htm.module.js';
import { configureData, loadManifest, loadCityBundle, searchPlaces, subscribeData, freshnessOf } from './data.js';
import { DATA_BASE_URL } from './config.js';
import { t, money } from './strings.js';
import { Icon, Sheet, Empty } from './components.js';

const html = htm.bind(h);
const leader = (label, value) => html`<div class="leader"><span>${label}</span><span class="dots" aria-hidden="true"></span><strong class="amount">${value}</strong></div>`;

// Icon + words; never colour alone.
export function FreshChip({ lastConfirmed, freshness }) {
  const { status, days } = freshnessOf(lastConfirmed, freshness);
  const [icon, text] = status === 'fresh' ? ['check', days === 0 ? t('freshToday') : t('freshDays', days)]
    : status === 'stale' ? ['clock', t('staleChip')] : ['alert', t('unverifiedChip')];
  return html`<span class=${`fresh-chip fresh-${status}`}><${Icon} name=${icon} size=${16}/>${text}</span>`;
}
const SampleTag = () => html`<span class="sample-tag">${t('sample')}</span>`;

const DAY_NAMES = { mo: 'Mon', tu: 'Tue', we: 'Wed', th: 'Thu', fr: 'Fri', sa: 'Sat', su: 'Sun' };
export function hoursText(hours) {
  return hours.map(h => `${h.days ? `${h.days.map(d => DAY_NAMES[d]).join(', ')} ` : ''}${h.open}–${h.close}`).join('; ');
}
export function whereText(place) {
  const l = place.location || {};
  const inside = place.osm?.relation === 'inside' && l.building ? t('insideBuilding', l.building) : l.building;
  return [place.kind ? t(`kind_${place.kind}`) : '', inside, l.floor, [l.area, l.postcode].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
}
// One menu-board row per price; details in words underneath (never colour).
function Items({ items, currency }) {
  return html`<ul class="item-list">${items.map(item => {
    const details = [item.diet && t(`diet_${item.diet}`), item.portion, item.addOn && t('addOnLabel'), item.spice ? t(`spice_${item.spice}`) : '',
      item.available === false && t('notAvailable'), item.localName].filter(Boolean).join(' · ');
    const price = typeof item.price === 'number' ? money(Math.round(item.price * 100), currency) : item.priceStatus ? t(`price_${item.priceStatus}`) : '';
    return html`<li key=${item.id} class=${item.available === false ? 'unavailable' : ''}>
      ${item.variants ? item.variants.map(v => leader(`${item.name} (${v.name}${v.portion ? `, ${v.portion}` : ''})`, money(Math.round(v.price * 100), currency))) : leader(item.name, price)}
      ${item.priceStatus && item.price !== undefined && html`<small>${t(`price_${item.priceStatus}`)}</small>`}
      ${details && html`<small>${details}</small>`}
      ${item.description && html`<small>${item.description}</small>`}
      ${(item.uncertain || item.note) && html`<small class="item-flag">${item.uncertain ? `${t('uncertainLabel')} ` : ''}${item.note || ''}</small>`}
    </li>`;
  })}</ul>`;
}


export class LibrarySheet extends Component {
  constructor(props) {
    super(props);
    this.state = { phase: 'loading', manifest: null, city: '', query: '', results: [], place: null, error: '', cached: false, choosing: false, busy: false };
  }
  componentDidMount() {
    configureData({ baseUrl: this.props.view.config.dataBaseUrl || DATA_BASE_URL });
    this.unsubscribe = subscribeData(event => {
      if (this.closed) return;
      if (event.type === 'manifest') this.open(true);
      else if (event.type === 'bundle' && event.cityId === this.state.city) this.loadCity(this.state.city);
      else if (event.type === 'error' && !this.state.manifest) this.setState({ phase: 'error', error: event.error.message });
    });
    this.open();
  }
  componentWillUnmount() { this.closed = true; this.unsubscribe?.(); }
  async open(quiet = false) {
    try {
      const { manifest, cached } = await loadManifest();
      if (this.closed) return;
      const remembered = this.props.view.preferences.libraryCity;
      const city = manifest.cities.some(c => c.id === this.state.city) ? this.state.city
        : manifest.cities.some(c => c.id === remembered) ? remembered : manifest.cities[0]?.id || '';
      this.setState({ manifest, city, cached });
      if (!city) { this.setState({ phase: 'empty' }); return; }
      await this.loadCity(city, quiet);
    } catch (error) {
      if (!this.closed && !quiet) this.setState({ phase: 'error', error: error.code === 'offline-empty' ? t('libraryOfflineEmpty') : error.message || t('libraryFailed') });
    }
  }
  async loadCity(city, quiet = false) {
    if (!quiet) this.setState({ phase: this.state.phase === 'ready' ? 'ready' : 'loading' });
    try {
      const { cached } = await loadCityBundle(city);
      const results = await searchPlaces(city, this.state.query);
      if (this.closed || city !== this.state.city) return;
      const place = this.state.place && results.find(p => p.id === this.state.place.id);
      this.setState({ phase: 'ready', results, cached, error: '', ...(this.state.place ? { place: place || this.state.place } : {}) });
    } catch (error) {
      if (!this.closed && !quiet) this.setState({ phase: 'error', error: error.code === 'offline-empty' ? t('libraryOfflineEmpty') : error.message || t('libraryFailed') });
    }
  }
  async search(query) {
    this.setState({ query });
    try { const results = await searchPlaces(this.state.city, query); if (!this.closed) this.setState({ results }); } catch { /* keep previous results */ }
  }
  chooseCity(city) {
    this.setState({ city, place: null, query: '', results: [] }, () => this.loadCity(city));
    this.props.store.preferences({ libraryCity: city }).catch(() => {});
  }
  async use(mode) {
    const { place, city } = this.state, store = this.props.store;
    const linked = this.props.view.state.menus.find(m => m.source?.placeId === place.id);
    if (!mode && linked) { this.setState({ choosing: true }); return; }
    this.setState({ busy: true });
    try {
      const result = await store.importLibraryPlace(place, city, mode || 'new');
      if (!result.menuId) return;
      const name = store.view().state.menus.find(m => m.id === result.menuId)?.name || place.name;
      store.toast(t('libraryImported', name, result.added, result.updated, result.removed));
      this.props.onImported(result.menuId);
    } catch (error) { store.notice(error.message); }
    finally { if (!this.closed) this.setState({ busy: false, choosing: false }); }
  }
  preview() {
    const { place, manifest, city, choosing, busy } = this.state;
    const linked = this.props.view.state.menus.find(m => m.source?.placeId === place.id);
    const currency = place.currency === 'INR' ? this.props.view.state.group.currency : place.currency;
    const where = whereText(place);
    return html`<div class="library-preview">
      <button class="quiet" onClick=${() => this.setState({ place: null, choosing: false })}>${t('backToResults')}</button>
      <h3>${place.name}</h3>
      ${place.localName && html`<p class="local-name">${place.localName}</p>`}
      <div class="chip-row"><${FreshChip} lastConfirmed=${place.last_confirmed} freshness=${manifest.freshness}/>${place.sample && html`<${SampleTag}/>`}</div>
      <dl class="place-facts">
        ${where && html`<dt>${t('placeWhere')}</dt><dd>${where}</dd>`}
        ${place.hours && html`<dt>${t('placeHours')}</dt><dd>${hoursText(place.hours)}</dd>`}
        ${place.tax && html`<dt>${t('placeTax')}</dt><dd>${t(place.tax.included ? 'taxIncluded' : 'taxExtra')}${place.tax.note ? ` ${place.tax.note}` : ''}</dd>`}
        <dt>${t('placePrices')}</dt><dd>${t('lastConfirmed', place.last_confirmed)}${place.source ? ` ${t('sourceText', t(`source_${place.source}`))}` : ''}</dd>
        ${place.note && html`<dt>${t('placeNote')}</dt><dd>${place.note}</dd>`}
      </dl>
      <p class="caption">${city}/${place.id}</p>
      ${place.sample && html`<p class="muted">${t('sampleNote')}</p>`}
      ${place.currency !== 'INR' && html`<p class="banner warning"><${Icon} name="alert"/>${t('foreignCurrency', place.currency)}</p>`}
      ${place.sections.map(section => html`<section class="menu-section" key=${section.id}>
        <h3>${section.name}</h3>
        ${section.hours && html`<p class="caption">${hoursText(section.hours)}</p>`}
        ${section.note && html`<p class="caption">${section.note}</p>`}
        ${section.items && html`<${Items} items=${section.items} currency=${currency}/>`}
        ${(section.sections || []).map(sub => html`<div class="menu-subsection" key=${sub.id}><h4>${sub.name}</h4>
          ${sub.hours && html`<p class="caption">${hoursText(sub.hours)}</p>`}
          ${sub.note && html`<p class="caption">${sub.note}</p>`}
          <${Items} items=${sub.items} currency=${currency}/></div>`)}
      </section>`)}
      <div class="sheet-actions">
        ${choosing ? html`<p>${t('linkedChoice', linked?.name || place.name)}</p><p class="muted">${t('replaceHint')}</p>
            <button class="primary" disabled=${busy} onClick=${() => this.use('add')}>${t('addMissing')}</button>
            <button class="danger" disabled=${busy} onClick=${() => this.use('replace')}><${Icon} name="alert"/>${t('replaceItems')}</button>
            <button class="quiet" onClick=${() => this.setState({ choosing: false })}>${t('cancel')}</button>`
          : html`<p class="muted">${t('importNote')}</p><button class="primary" disabled=${busy} onClick=${() => this.use()}>${busy ? '…' : t('useThisMenu')}</button>
            <button onClick=${() => this.props.suggest({ placeId: place.id, city, name: place.name, changes: [] })}><${Icon} name="external"/>${t('suggestUpdate')}</button>`}
      </div>
    </div>`;
  }
  render({ onClose }) {
    const { phase, manifest, city, query, results, place, error, cached } = this.state;
    return html`<${Sheet} title=${t('libraryTitle')} onClose=${onClose} className="library">
      ${phase === 'loading' && html`<p role="status">${t('libraryLoading')}</p>`}
      ${phase === 'error' && html`<${Empty} text=${error} icon="offline"><button onClick=${() => { this.setState({ phase: 'loading' }); this.open(); }}>${t('retry')}</button><//>`}
      ${phase === 'empty' && html`<${Empty} text=${t('libraryNoCities')} icon="book"/>`}
      ${phase === 'ready' && place && this.preview()}
      ${phase === 'ready' && !place && html`<div class="stack">
        ${cached && !navigator.onLine && html`<p class="banner info" role="status"><${Icon} name="offline"/>${t('libraryCached')}</p>`}
        <label>${t('libraryCity')}<select value=${city} onChange=${e => this.chooseCity(e.currentTarget.value)}>${manifest.cities.map(c => html`<option value=${c.id}>${c.name} (${c.placeCount})</option>`)}</select></label>
        <label>${t('librarySearch')}<input type="search" value=${query} maxlength="60" autocomplete="off" onInput=${e => this.search(e.currentTarget.value)}/></label>
        ${!results.length ? html`<p class="muted" role="status">${t('libraryNoResults')}</p>` : html`<ul class="library-results">${results.slice(0, 100).map(p => html`<li key=${p.id}>
          <button class="library-result" onClick=${() => this.setState({ place: p })}>
            <span class="library-name">${p.name}</span>
            ${whereText(p) && html`<span class="caption">${whereText(p)}</span>`}
            <span class="chip-row"><span class="caption">${t('libraryItems', p.itemCount)}</span><${FreshChip} lastConfirmed=${p.last_confirmed} freshness=${manifest.freshness}/>${p.sample && html`<${SampleTag}/>`}</span>
          </button></li>`)}</ul>`}
      </div>`}
    <//>`;
  }
}
