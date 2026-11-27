import { h, Component } from '../vendor/preact.module.js';
import htm from '../vendor/htm.module.js';
import { t } from './strings.js';
import { Icon } from './components.js';
const html = htm.bind(h);

// First-run walkthrough: each step dims the screen and rings the real control
// it talks about. Finishing or skipping stores preferences.tour = 'done';
// Settings can replay it. Before a group exists the tour waits on the Home
// screen and carries on by itself once the user creates or joins one.
export const STEPS = Object.freeze([
  { id: 'welcome' },
  { id: 'group', target: '.home form', targetInGroup: '.header-presence' },
  { id: 'nav', tab: 'menu', target: '.bottom-nav', demo: [['menu', 'menu'], ['user', 'picks'], ['receipt', 'order'], ['rupee', 'costs']], demoKey: 'tourNav' },
  { id: 'menu', tab: 'menu', target: '.menu-chips, main .empty' },
  { id: 'prices', tab: 'menu', target: '.section-heading .tools .icon-button' },
  { id: 'add', tab: 'picks', target: '.quick-add' },
  { id: 'picks', tab: 'picks', target: '.pick-row, main .empty' },
  { id: 'order', tab: 'order', target: '.order-actions' },
  { id: 'costs', tab: 'costs', target: '.bill-form label, .ls-receipt' },
  { id: 'upi', tab: 'settings', target: 'label:has(input[name="upi"])' },
  { id: 'upiScan', demo: [['qr', 'friend'], ['alert', 'you'], ['check', 'you']] },
]);
export const tourDue = view => !!view.ready && !view.superseded && !view.preferences?.tour;

export class Tour extends Component {
  state = { step: 0, rect: null, top: false };
  componentDidMount() { this.timer = setInterval(() => this.measure(), 250); }
  componentWillUnmount() { clearInterval(this.timer); }
  componentDidUpdate(previous) {
    if (this.props.inGroup && !previous.inGroup && this.state.step === 1) this.go(2);
  }
  go(step) {
    this.setState({ step, rect: null });
    const tab = STEPS[step].tab;
    if (tab && this.props.inGroup) this.props.onTab(tab);
    setTimeout(() => { this.scrolled = false; this.measure(); }, 120);
  }
  measure() {
    const step = STEPS[this.state.step];
    const selector = this.props.inGroup && step.targetInGroup || step.target;
    const found = selector && document.querySelector(selector);
    if (!found) { if (this.state.rect) this.setState({ rect: null }); return; }
    if (!this.scrolled) { this.scrolled = true; found.scrollIntoView({ block: 'center', behavior: 'auto' }); }
    const r = found.getBoundingClientRect(), pad = 6;
    const rect = { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
    const old = this.state.rect;
    if (!old || ['x', 'y', 'w', 'h'].some(k => Math.abs(old[k] - rect[k]) > 1)) this.setState({ rect, top: r.top + r.height / 2 > innerHeight / 2 });
  }
  render({ inGroup, onDone }, { step, rect, top }) {
    const last = step === STEPS.length - 1, id = STEPS[step].id, waiting = id === 'group' && !inGroup;
    return html`<div class="tour-layer">
      <div class="tour-dim" aria-hidden="true" style=${rect ? `clip-path:polygon(evenodd,0 0,100% 0,100% 100%,0 100%,0 0,${rect.x}px ${rect.y}px,${rect.x}px ${rect.y + rect.h}px,${rect.x + rect.w}px ${rect.y + rect.h}px,${rect.x + rect.w}px ${rect.y}px,${rect.x}px ${rect.y}px)` : ''}></div>
      ${rect && html`<div class="tour-spot" aria-hidden="true" style=${`left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px`}></div>`}
      <section class=${`tour ${top ? 'at-top' : ''}`} role="region" aria-label=${t('tourLabel')}>
        <p class="tour-count">${t('tourCount', step + 1, STEPS.length)}</p>
        <h2>${t(`tour_${id}_title`)}</h2>
        <p aria-live="polite">${t(`tour_${id}_body`)}</p>
        ${STEPS[step].demo && html`<ol class="tour-demo">${STEPS[step].demo.map(([icon, who], i) => html`<li key=${i}><${Icon} name=${icon} size=${20}/><span><strong>${t(`tourWho_${who}`)}</strong> ${t(STEPS[step].demoKey || 'tourDemo')[i]}</span></li>`)}</ol>`}
        ${waiting && html`<p class="tour-wait"><${Icon} name="arrow" size=${20}/>${t('tourWait')}</p>`}
        <div class="tour-actions">
          <button class="quiet" onClick=${onDone}>${t('tourSkip')}</button>
          ${step > 0 && html`<button onClick=${() => this.go(step - 1)}>${t('back')}</button>`}
          ${!waiting && html`<button class="primary" autofocus onClick=${() => last ? onDone() : this.go(step + 1)}>${last ? t('tourFinish') : t('tourNext')}${!last && html`<${Icon} name="arrow" size=${20}/>`}</button>`}
        </div>
      </section></div>`;
  }
}
