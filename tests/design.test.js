import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { money } from '../js/strings.js';
const luminance = hex => {
  const a = hex.match(/\w\w/g).map(c => parseInt(c, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * a[0] + .7152 * a[1] + .0722 * a[2];
};
const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
// Semantic crayons (room code, sharing, status/forward action) and receipt paper
// are the only hues allowed. Everything else is greyscale.
const CRAYONS = ['ffe066', '9fcbff', 'a7e3a0'];
const PAPER = ['fbf6e9', 'ede7d6'];
test('brand text/control pairs meet contrast and only semantic hues are used', () => {
  for (const [ink, page, muted, line] of [['000000', 'FFFFFF', '4D4D4D', '8C8C8C'], ['FFFFFF', '000000', 'B8B8B8', '767676']]) {
    assert.ok(ratio(ink, page) >= 7); assert.ok(ratio(muted, page) >= 4.5); assert.ok(ratio(line, page) >= 3);
  }
  for (const crayon of CRAYONS) assert.ok(ratio('111111', crayon) >= 7, `crayon ${crayon}`);
  for (const paper of PAPER) { assert.ok(ratio('111111', paper) >= 7); assert.ok(ratio('4D4D4D', paper) >= 4.5); }
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  for (const [hex] of css.matchAll(/#[\da-fA-F]{6}\b/g)) {
    const h = hex.slice(1).toLowerCase();
    if (CRAYONS.includes(h) || PAPER.includes(h)) continue;
    assert.ok(h.slice(0, 2) === h.slice(2, 4) && h.slice(2, 4) === h.slice(4, 6), `${hex} is not greyscale`);
  }
});
test('Indian currency grouping preserves fractions and font budget is below 150 KB', () => {
  assert.equal(money(12500000), 'Rs 1,25,000'); assert.equal(money(12345), 'Rs 123.45');
  assert.equal(money(12345, '₹'), '₹123.45');
  const files = ['atkinson-hyperlegible-mono-latin.woff2', 'courier-prime-400-latin.woff2', 'courier-prime-700-latin.woff2', 'noto-serif-malayalam.woff2'];
  assert.ok(files.reduce((sum, f) => sum + statSync(new URL(`../fonts/${f}`, import.meta.url)).size, 0) < 150000);
});
