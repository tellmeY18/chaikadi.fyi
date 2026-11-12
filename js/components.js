import { h, Component } from '../vendor/preact.module.js';
import htm from '../vendor/htm.module.js';
import { t } from './strings.js';
const html = htm.bind(h);

// Original drafted icons: no icon font, third-party fetch, rounded caps or emoji.
const paths = {
  menu: 'M4 3h16v18H4z M8 7h8 M8 12h8 M8 17h5',
  user: 'M8 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M4 21v-3a8 8 0 0 1 16 0v3',
  receipt: 'M5 2h14v20l-3-2-4 2-4-2-3 2z M8 7h8 M8 11h8 M8 15h5',
  rupee: 'M6 4h13 M6 8h13 M9 4c9 0 9 9 0 9H6l11 8',
  plus: 'M12 5v14 M5 12h14', minus: 'M5 12h14', check: 'M4 12l5 5L20 6', close: 'M5 5l14 14 M19 5L5 19',
  dice: 'M4 4h16v16H4z M8 8h.01 M16 8h.01 M12 12h.01 M8 16h.01 M16 16h.01',
  copy: 'M8 8h12v13H8z M16 8V3H3v13h5', share: 'M12 16V3 M7 8l5-5 5 5 M4 12v9h16v-9',
  qr: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h3v3h4v4h-7z M21 14v3',
  offline: 'M3 3l18 18 M3 9a15 15 0 0 1 4-2 M10 6a15 15 0 0 1 11 3 M6 13a10 10 0 0 1 4-2 M15 12l3 1 M10 17l2-1 2 1 M12 21h.01',
  settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
  history: 'M3 10a9 9 0 1 1 1 8 M3 4v6h6 M12 7v6l4 2',
  lock: 'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3',
  unlock: 'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0 M12 14v3',
  edit: 'M4 16L16 4l4 4L8 20H4z M13 7l4 4', trash: 'M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
  alert: 'M12 3L2 21h20z M12 9v5 M12 17v1', note: 'M4 3h16v13l-5 5H4z M15 21v-5h5 M8 7h8 M8 11h6',
  camera: 'M3 7h4l2-3h6l2 3h4v14H3z M8 13a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  more: 'M3 6h18 M3 12h18 M3 18h18', link: 'M9 15l6-6 M8 7l3-3a5 5 0 0 1 7 7l-3 3 M16 17l-3 3a5 5 0 0 1-7-7l3-3',
  tumbler: 'M5 9h14l-2 12H7z M9 2c-2 2 2 3 0 5 M14 1c-2 2 2 3 0 5 M6 14h12',
  book: 'M4 4h7a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H4z M20 4h-6 M20 4v14h-6',
  external: 'M14 3h7v7 M21 3L11 13 M18 14v7H3V6h7',
  clock: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M12 7v5l3 2',
};
export function Icon({ name, size = 24 }) {
  return html`<svg class="icon" viewBox="0 0 24 24" width=${size} height=${size} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d=${paths[name] || paths.menu}/></svg>`;
}
export function Empty({ text, children, icon = 'tumbler' }) {
  return html`<div class="empty"><${Icon} name=${icon} size=${48}/><p>${text}</p>${children}</div>`;
}
export function Sheet({ children, ...props }) { return html`<${Modal} ...${props} sheet=${true}>${children}<//>`; }
export class Modal extends Component {
  componentDidMount() { this.dialog.showModal(); }
  render({ title, children, onClose, sheet = false, className = '' }) {
    return html`<dialog class=${`${sheet ? 'sheet' : 'confirm-dialog'} ${className}`} ref=${el => this.dialog = el}
      aria-label=${title} onCancel=${e => { e.preventDefault(); onClose(); }}
      onClick=${e => { if (e.target === this.dialog) { const r = this.dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
      ${sheet && html`<div class="drag-handle" aria-hidden="true" onTouchStart=${e => this.touchY = e.touches[0].clientY} onTouchEnd=${e => { if (e.changedTouches[0].clientY - this.touchY > 60) onClose(); }}><span></span></div>`}
      <header class="sheet-header"><h2>${title}</h2><button class="quiet icon-button" aria-label=${t('close')} onClick=${onClose}><${Icon} name="close"/></button></header>
      ${children}
    </dialog>`;
  }
}

export class CodeInput extends Component {
  constructor(props) { super(props); this.state = { digits: Array.from({ length: 4 }, (_, i) => props.value?.[i] || '') }; this.inputs = []; }
  update(value, index) {
    const digits = Array.isArray(value) ? value : Array.from({ length: 4 }, (_, i) => value.toUpperCase().replace(/[^A-Z0-9]/g, '')[i] || '');
    this.setState({ digits }); this.props.onInput(digits.join(''));
    this.inputs[Math.min(index, 3)]?.focus();
  }
  render() {
    return html`<fieldset class="code-field"><legend>${t('roomCode')}</legend><div class="code-boxes">
      ${Array.from({ length: 4 }, (_, i) => html`<input key=${i} ref=${el => this.inputs[i] = el} value=${this.state.digits[i]}
        aria-label=${t('codeDigit', i + 1)} autocomplete=${i === 0 ? 'one-time-code' : 'off'} autocapitalize="characters" spellcheck=${false}
        onFocus=${e => e.currentTarget.select()}
        onPaste=${e => { e.preventDefault(); this.update(e.clipboardData.getData('text'), 3); }}
        onInput=${e => { const typed = e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (typed.length >= 4) this.update(typed, 3); else { const chars = [...this.state.digits]; chars[i] = typed.slice(-1); this.update(chars, typed ? i + 1 : i); } }}
        onKeyDown=${e => { if (e.key === 'Backspace' && !this.state.digits[i] && i > 0) this.inputs[i - 1]?.focus(); if (e.key === 'ArrowLeft' && i) this.inputs[i - 1]?.focus(); if (e.key === 'ArrowRight' && i < 3) this.inputs[i + 1]?.focus(); }}/>`)}
      </div><p class="muted">${t('codeHint')}</p></fieldset>`;
  }
}
