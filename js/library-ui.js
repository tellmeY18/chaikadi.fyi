// Menu library UI: city picker, search, place preview, import and suggestions.
// Data access lives in data.js; this file only renders and calls the store.
import { h, Component } from '../vendor/preact.module.js';
import htm from '../vendor/htm.module.js';
import { configureData, loadManifest, loadCityBundle, searchPlaces, subscribeData, freshnessOf } from './data.js';
import { DATA_BASE_URL } from './config.js';
import { t, money } from './strings.js';
import { Icon, Sheet, Empty } from './components.js';

const html = htm.bind(h);
const ORDER = ['Tea', 'Coffee', 'Snacks', 'Meal', 'Other'];
const leader = (label, value) => html`<div class="leader"><span>${label}</span><span class="dots" aria-hidden="true"></span><strong class="amount">${value}</strong></div>`;

// Icon + words; never colour alone.
export function FreshChip({ lastConfirmed, freshness }) {
  const { status, days } = freshnessOf(lastConfirmed, freshness);
  const [icon, text] = status === 'fresh' ? ['check', days === 0 ? t('freshToday') : t('freshDays', days)]
    : status === 'stale' ? ['clock', t('staleChip')] : ['alert', t('unverifiedChip')];
  return html`<span class=${`fresh-chip fresh-${status}`}><${Icon} name=${icon} size=${16}/>${text}</span>`;
}
const SampleTag = () => html`<span class="sample-tag">${t('sample')}</span>`;

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
    const currencyLabel = this.props.view.state.group.currency;
    return html`<div class="library-preview">
      <button class="quiet" onClick=${() => this.setState({ place: null, choosing: false })}>${t('backToResults')}</button>
      <h3>${place.name}</h3>
      <div class="chip-row"><${FreshChip} lastConfirmed=${place.last_confirmed} freshness=${manifest.freshness}/>${place.sample && html`<${SampleTag}/>`}</div>
      <p class="caption">${t('lastConfirmed', place.last_confirmed)} ${place.id}</p>
      ${place.sample && html`<p class="muted">${t('sampleNote')}</p>`}
      ${place.currency !== 'INR' && html`<p class="banner warning"><${Icon} name="alert"/>${t('foreignCurrency', place.currency)}</p>`}
      ${ORDER.map(category => {
        const items = place.menu.filter(i => i.category === category);
        return items.length > 0 && html`<section class="menu-section"><h3>${category}</h3><ul class="item-list">${items.map(item => html`<li key=${item.id}>
          ${leader(item.available ? item.name : `${item.name} (${t('notAvailable')})`, money(Math.round(item.price * 100), place.currency === 'INR' ? currencyLabel : place.currency))}</li>`)}</ul></section>`;
      })}
      <div class="sheet-actions">
        ${choosing ? html`<p>${t('linkedChoice', linked?.name || place.name)}</p><p class="muted">${t('replaceHint')}</p>
            <button class="primary" disabled=${busy} onClick=${() => this.use('add')}>${t('addMissing')}</button>
            <button class="danger" disabled=${busy} onClick=${() => this.use('replace')}><${Icon} name="alert"/>${t('replaceItems')}</button>
            <button class="quiet" onClick=${() => this.setState({ choosing: false })}>${t('cancel')}</button>`
          : html`<button class="primary" disabled=${busy} onClick=${() => this.use()}>${busy ? '…' : t('useThisMenu')}</button>
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
            <span class="chip-row"><span class="caption">${t('libraryItems', p.itemCount)}</span><${FreshChip} lastConfirmed=${p.last_confirmed} freshness=${manifest.freshness}/>${p.sample && html`<${SampleTag}/>`}</span>
          </button></li>`)}</ul>`}
      </div>`}
    <//>`;
  }
}
