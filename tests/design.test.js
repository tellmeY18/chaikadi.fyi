import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { money } from '../js/strings.js';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const luminance = hex => {
  const a = hex.match(/\w\w/g).map(c => parseInt(c, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * a[0] + .7152 * a[1] + .0722 * a[2];
};
const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };

test('branding is the vendored letsimpl.fyi brand: tokens, base and components load before the app styles', () => {
  const meta = JSON.parse(read('brand/brand.json'));
  assert.equal(meta.source, 'https://brand.letsimpl.fyi');
  const html = read('index.html');
  const order = ['brand/tokens/tokens.css', 'brand/css/base.css', 'brand/css/components.css', 'styles.css'].map(f => html.indexOf(f));
  assert.ok(order.every(i => i > 0) && [...order].sort((a, b) => a - b).join() === order.join(), 'load order');
  const sw = read('sw.js');
  for (const f of ['brand/tokens/tokens.css', 'brand/css/base.css', 'brand/css/components.css']) assert.ok(sw.includes(`./${f}`), `${f} precached`);
});
test('app styles follow the brand rules: no own colours, shadows, gradients, rounded corners or hatch', () => {
  const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const hexes = [...css.matchAll(/#[\da-fA-F]{3,8}\b/g)].map(m => m[0].toLowerCase());
  assert.deepEqual(hexes, ['#ffffff'], 'only the QR code background may be a literal colour');
  assert.ok(!/box-shadow|drop-shadow|text-shadow/.test(css), 'no shadows');
  assert.ok(!/(linear|radial)-gradient/.test(css.replace(/conic-gradient/g, '')), 'no gradients');
  assert.ok(!/border-radius:\s*[1-9]/.test(css), 'square corners');
  assert.ok(!/--(yellow|green|blue|red|crayon-yellow)\b/.test(css), 'no retired crayon colours');
  const fontFaces = css.match(/@font-face/g);
  assert.equal(fontFaces, null, 'fonts come from the brand');
});
test('brand text and status pairs meet contrast', () => {
  const tokens = read('brand/tokens/tokens.css');
  const get = (name, scope) => tokens.match(new RegExp(`${scope}[^}]*?--${name}:\\s*(#[0-9A-Fa-f]{6})`, 's'))[1].slice(1);
  for (const status of ['danger', 'warning', 'success', 'info']) assert.ok(ratio('111111', get(status, ':root \\{')) >= 7, status);
  for (const [scope, page] of [[':root\\[data-theme="light"\\]', 'FFFFFF'], [':root\\[data-theme="dark"\\]', '000000']]) {
    assert.ok(ratio(get('muted', scope), page) >= 4.5, `muted on ${page}`);
    for (const status of ['danger', 'warning', 'success', 'info']) assert.ok(ratio(get(`${status}-ink`, scope), page) >= 4.5, `${status}-ink on ${page}`);
  }
});
test('Indian currency grouping preserves fractions and font budget is below 190 KB', () => {
  assert.equal(money(12500000), 'Rs 1,25,000'); assert.equal(money(12345), 'Rs 123.45');
  assert.equal(money(12345, '₹'), '₹123.45');
  const files = ['atkinson-hyperlegible-mono-latin.woff2', 'courier-prime-400-latin.woff2', 'courier-prime-700-latin.woff2', 'noto-serif-malayalam.woff2'];
  assert.ok(files.every(f => existsSync(new URL(`../brand/fonts/${f}`, import.meta.url))));
  assert.ok(files.reduce((sum, f) => sum + statSync(new URL(`../brand/fonts/${f}`, import.meta.url)).size, 0) < 190000);
});
