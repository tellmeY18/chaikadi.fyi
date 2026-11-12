import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { money } from '../js/strings.js';
const luminance = hex => {
  const a = hex.match(/\w\w/g).map(c => parseInt(c, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * a[0] + .7152 * a[1] + .0722 * a[2];
};
const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
test('brand text/control pairs meet contrast and the palette has no hue', () => {
  for (const [ink, paper, surface, tint, muted] of [['111111', 'F7F7F7', 'FFFFFF', 'EDEDED', '595959'], ['F2F2F2', '0A0A0A', '161616', '232323', 'A3A3A3']]) {
    assert.ok(ratio(ink, paper) >= 7); assert.ok(ratio(ink, surface) >= 3);
    assert.ok(ratio(muted, paper) >= 4.5); assert.ok(ratio(muted, surface) >= 4.5); assert.ok(ratio(muted, tint) >= 4.5);
  }
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  for (const [hex] of css.matchAll(/#[\da-fA-F]{6}\b/g)) {
    assert.equal(hex.slice(1, 3).toLowerCase(), hex.slice(3, 5).toLowerCase());
    assert.equal(hex.slice(1, 3).toLowerCase(), hex.slice(5, 7).toLowerCase());
  }
});
test('Indian currency grouping preserves fractions and font budget is below 150 KB', () => {
  assert.equal(money(12500000), 'Rs 1,25,000'); assert.equal(money(12345), 'Rs 123.45');
  assert.equal(money(12345, '₹'), '₹123.45');
  const files = ['courier-prime-400-latin.woff2', 'courier-prime-700-latin.woff2', 'noto-serif-malayalam.woff2'];
  assert.ok(files.reduce((sum, f) => sum + statSync(new URL(`../fonts/${f}`, import.meta.url)).size, 0) < 150000);
});
