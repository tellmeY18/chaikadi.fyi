import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMenuText, guessCategory, cleanOcrLines } from '../js/ingest.js';

const names = items => items.map(i => `${i.name}=${i.price / 100}:${i.category}`);

test('dotted leaders, currency symbols, Rs and /- suffixes', () => {
  const text = `CHAIKADI MENU
Masala Chai ........ ₹20
Ginger Tea      Rs.15/-
Filter Coffee : 25
Samosa (2 pcs) - Rs 30
Bun Maska 35/-
Veg Puff 25 / 30
Thank you, visit again`;
  assert.deepEqual(names(parseMenuText(text)), [
    'Masala Chai=20:Tea', 'Ginger Tea=15:Tea', 'Filter Coffee=25:Tea',
    'Samosa (2 pcs)=30:Snacks', 'Bun Maska=35:Snacks', 'Veg Puff=25:Snacks',
  ]);
});

test('name and price on separate lines (two-column OCR)', () => {
  assert.deepEqual(names(parseMenuText('Chicken Biryani\n180\nLime Juice\n₹ 40')), ['Chicken Biryani=180:Meal', 'Lime Juice=40:Tea']);
});

test('decimals, ALL CAPS title-casing, duplicates and noise are handled', () => {
  const items = parseMenuText('BLACK TEA 12.50\nblack tea 13\nPhone: 9876543210\nGST 5%\n---- 20\nTotal 500\nVADA 10,5');
  assert.deepEqual(names(items), ['Black Tea=12.5:Tea', 'Vada=10.5:Snacks']);
});

test('garbage and empty input give no items', () => {
  assert.deepEqual(parseMenuText(''), []);
  assert.deepEqual(parseMenuText('|||| ~~~ 2\n%%%\n12345'), []);
});

test('OCR word cleanup: leader junk dropped, misread ₹ removed, confident prices kept', () => {
  const w = (text, confidence) => ({ text, confidence });
  const text = cleanOcrLines([
    { words: [w('Masala', 96), w('Chai', 96), w('ees', 28), w('320', 28)] },
    { words: [w('Samosa', 96), w('vee', 12), w('718', 43)] },
    { words: [w('Veg', 95), w('Biryani', 96), w('eee', 12), w('¥120', 24)] },
    { words: [w('Mutton', 94), w('Biryani', 95), w('320', 92)] },
    { words: [w('Tea', 91), w('%15/-', 40)] },
  ]);
  assert.deepEqual(names(parseMenuText(text)), ['Masala Chai=20:Tea', 'Samosa=18:Snacks', 'Veg Biryani=120:Meal', 'Mutton Biryani=320:Meal', 'Tea=15:Tea']);
});

test('category hints', () => {
  assert.equal(guessCategory('Cutting Chai'), 'Tea');
  assert.equal(guessCategory('Parotta & Beef Curry'), 'Meal');
  assert.equal(guessCategory('Pazham Pori'), 'Snacks');
  assert.equal(guessCategory('Mystery Box'), 'Other');
});
