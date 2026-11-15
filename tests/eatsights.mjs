// Real-browser test of the Eatsights contribution triggers (prompts.js rules
// wired into the app). A fake Eatsights answers through Playwright routes, so
// no network is used and every signed request is checked.
//   PLAYWRIGHT_MODULE=… TEST_URL=http://127.0.0.1:8090 node tests/eatsights.mjs
// Optional: CHROME=/path/to/chrome (a browser build other than Playwright's).
import assert from 'node:assert/strict';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const base = process.env.TEST_URL || 'http://127.0.0.1:8090';
const ES = 'https://eatsights.letsimpl.fyi';
const day = new Date().toISOString();

// ---- fake Eatsights ---------------------------------------------------------
const id = (prefix, n) => `${prefix}01M7BHQY50D2K939M5G5K8${String(n).padStart(4, '0')}`;
const fact = (status, amount, last = day) => ({ property: 'price.amount', status, confidence: .5, counts: { confirmations: 2, disputes: 0, distinct_contributors: status === 'confirmed' ? 3 : 1 },
  current_value: { amount_minor: amount, currency: 'INR', fulfilment: 'dine_in' }, last_observed_at: last, last_confirmed_at: last, half_life_hours: 1440, computed_at: day, sources: ['customer'] });
function stall(n, name, items) {
  const pl = id('pl_', n), sc = id('sc_', n);
  return { place: { id: pl, category: 'tea_stall', city: 'ernakulam', names: { en: name }, osm: { state: 'unchecked' }, record_state: 'active', created_at: day, location: { lat: 9.9, lng: 76.2 } },
    sections: [{ id: sc, kind: 'drinks', labels: { en: 'Tea' }, place_id: pl, sort: 1 }],
    items: items.map(([label, f], i) => ({ item: { id: id('mi_', n * 100 + i), labels: { en: label }, section_id: sc, place_id: pl, record_state: 'active' }, facts: f ? [f] : [] })), place_facts: [], built_at: day };
}
const STALLS = [
  stall(1, 'Fresh Corner', [['Chai', fact('confirmed', 1200)]]),
  stall(2, 'Unsure Corner', [['Chai', fact('unconfirmed', 1200)], ['Coffee', fact('contested', 1500)], ['Vada', fact('stale', 1000)], ['Bun', fact('unconfirmed', 800)], ['Puffs', fact('confirmed', 2500, '2026-01-01T00:00:00Z')]]),
  stall(3, 'Empty Corner', []),
];
const posts = [];
let offline = false;
async function route(r) {
  const url = new URL(r.request().url());
  const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  if (offline) return r.abort('internetdisconnected');
  if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,if-none-match', 'access-control-allow-methods': 'GET,POST' } });
  if (r.request().method() === 'POST') {
    const body = JSON.parse(r.request().postData());
    posts.push({ path: url.pathname, body });
    if (url.pathname === '/v1/keys') return json({ key_id: 'k', level: 'unverified' });
    if (url.pathname === '/v1/entities') {
      for (const e of body) if (e.entity_type === 'menu_item') {
        const s = STALLS.find(x => x.place.id === e.entity.place_id);
        if (!s.sections.some(x => x.id === e.entity.section_id)) s.sections.push({ id: e.entity.section_id, kind: 'other', labels: { en: 'Menu' }, place_id: s.place.id, sort: 9 });
        s.items.push({ item: { ...e.entity, record_state: 'active' }, facts: [] });
      } else if (e.entity_type === 'section') { const s = STALLS.find(x => x.place.id === e.entity.place_id); s.sections.push({ ...e.entity }); }
      return json({ results: body.map((e, index) => ({ index, id: e.id, status: 'accepted' })) });
    }
    return json({ results: body.map((o, index) => ({ index, id: o.id, status: o.value?.amount_minor === 99900 ? 'rejected' : 'accepted', ...(o.value?.amount_minor === 99900 ? { problem: { title: 'price looks off' } } : {}) })) });
  }
  const menu = url.pathname.match(/^\/v1\/places\/(pl_\w+)\/menu$/);
  if (menu) return json(STALLS.find(s => s.place.id === menu[1]));
  if (url.pathname === '/v1/places') return json({ items: url.searchParams.get('city') === 'ernakulam' ? STALLS.map(s => s.place) : [], next_cursor: null });
  return json({ title: 'not found' }, 404);
}

// ---- app helpers ------------------------------------------------------------
const errors = [];
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.route(`${ES}/**`, route);
await context.route('https://data.chaikadi.fyi/**', r => r.abort());
const p = await context.newPage();
p.on('pageerror', e => errors.push(e.message));
const nav = label => p.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: label, exact: true }).click();
const sheet = () => p.locator('dialog[open]');
const submissions = () => posts.filter(x => x.path === '/v1/submissions').flatMap(x => x.body);

async function useStall(name, { activate = true } = {}) {
  await nav('Menu');
  await p.getByRole('button', { name: 'Add', exact: true }).click();
  await p.getByRole('button', { name: 'Pick from library' }).click();
  await sheet().locator('.library-result', { hasText: name }).click();
  await sheet().getByRole('button', { name: 'Use this menu' }).click();
  await sheet().waitFor({ state: 'detached' });
  if (activate) await activateMenu();
}
async function activateMenu() {
  const use = p.getByRole('button', { name: 'Use this menu' });
  if (await use.count()) { await use.click(); const ok = p.locator('.confirm-dialog').getByRole('button', { name: 'Use this menu' }); if (await ok.count()) await ok.click(); }
}
async function setSharing(label) {
  await p.getByRole('button', { name: 'Open app menu' }).click();
  await p.locator('.app-menu').getByRole('button', { name: 'Settings' }).click();
  await p.locator('fieldset', { hasText: 'Share prices with Eatsights' }).getByRole('button', { name: label, exact: true }).click();
}
async function round(picks, { prices = {}, soldOut = [] } = {}) {
  await nav('Menu');
  for (const name of soldOut) {
    await p.locator('.item-name', { hasText: name }).first().click();
    await sheet().getByRole('button', { name: 'Sold out today' }).click();
  }
  for (const [name, price] of Object.entries(prices)) {
    await p.getByRole('button', { name: 'Edit items' }).click();
    await p.locator('.menu-row', { hasText: name }).getByRole('button', { name: 'Edit', exact: true }).click();
    await sheet().getByLabel('Price (Rs)').fill(String(price));
    await sheet().getByRole('button', { name: 'Save', exact: true }).click();
    await p.getByRole('button', { name: 'Done' }).click();
  }
  await nav('My picks');
  for (const name of picks) await p.getByRole('button', { name: `Add one ${name}`, exact: true }).click();
  await nav('Order');
  await p.getByRole('button', { name: 'Lock' }).click();
  await sheet().getByRole('button', { name: 'Done' }).click();
  await nav('Costs');
  await p.getByLabel(/Bill total/).fill('100');
  await p.getByRole('button', { name: 'Save bill' }).click();
  await p.getByRole('button', { name: 'Finish', exact: true }).click();
  await p.locator('.confirm-dialog').getByRole('button', { name: 'Finish' }).click();
  await p.getByText('Saved to History.').waitFor();
  await p.waitForTimeout(600);
  return (await sheet().count()) && await sheet().getByRole('heading', { name: 'Help the next group' }).count() ? sheet() : null;
}

try {
  await p.goto(base);
  await p.getByRole('button', { name: 'Create', exact: true }).click();
  await p.getByRole('heading', { name: 'People' }).waitFor();

  // 1. Confirmed, fresh prices: nothing to ask.
  await useStall('Fresh Corner');
  assert.equal(await round(['Chai']), null, 'confirmed fresh price: no sheet');
  assert.equal(posts.length, 0, 'nothing sent');

  // Sharing off: never asked, even with a changed price.
  await setSharing('Off');
  assert.equal(await round(['Chai'], { prices: { Chai: 30 } }), null, 'sharing off: no sheet');
  await setSharing('On');

  // 2. Uncertain prices: one sheet, at most 3 checks, contested first.
  await useStall('Unsure Corner');
  let s = await round(['Chai', 'Coffee', 'Vada', 'Bun', 'Puffs']);
  assert.ok(s, 'uncertain prices open the sheet');
  const kinds = await s.locator('[data-kind]').evaluateAll(els => els.map(e => e.dataset.kind));
  assert.deepEqual(kinds, ['contested', 'unconfirmed', 'unconfirmed'], 'three checks, contested first');
  await s.getByRole('group', { name: 'Coffee' }).getByRole('button', { name: 'Changed' }).click();
  await s.getByLabel('New price for Coffee').fill('999');
  await s.getByRole('button', { name: /^Send \d+$/ }).click();
  await s.getByRole('heading', { name: 'Price updates sent' }).waitFor();
  assert.ok(await s.getByText('Not accepted · price looks off').count(), 'per-item rejection shown');
  assert.equal(posts[0].path, '/v1/keys', 'key registers first');
  const sent = submissions();
  assert.deepEqual(sent.map(o => [o.property, o.value.amount_minor]).sort(), [['price.amount', 800], ['price.amount', 1200], ['price.amount', 99900]].sort());
  for (const o of sent) {
    assert.equal(o.license, 'CC0-1.0'); assert.equal(o.signature.length, 86); assert.equal(o.client.app_id, 'chaikadi');
    assert.ok(!/Sleepy|Crew|Society|note/i.test(JSON.stringify(o)), 'no names or notes');
  }
  await s.getByRole('button', { name: 'Done' }).click();

  // 3. A stall without items: the group's items are created on Eatsights.
  await useStall('Empty Corner', { activate: false });
  await nav('Menu');
  await p.getByRole('button', { name: 'Add', exact: true }).click();
  await sheet().getByRole('button', { name: 'Item', exact: true }).click();
  await sheet().getByLabel('Item name').fill('Sulaimani');
  await sheet().getByLabel('Price (Rs)').fill('10');
  await sheet().getByRole('button', { name: 'Save', exact: true }).click();
  await sheet().waitFor({ state: 'detached' });
  await activateMenu();
  s = await round(['Sulaimani']);
  assert.ok(s, 'new items are offered');
  assert.deepEqual(await s.locator('[data-kind]').evaluateAll(els => els.map(e => e.dataset.kind)), ['new']);
  // Offline: saved, then sent once online.
  offline = true;
  await s.getByRole('button', { name: /^Send \d+$/ }).click();
  await p.getByText(/Could not reach Eatsights|You are offline/).first().waitFor();
  offline = false;
  await s.getByRole('button', { name: /^Send \d+$/ }).click();
  await s.getByRole('heading', { name: 'Price updates sent' }).waitFor();
  const entities = posts.filter(x => x.path === '/v1/entities').flatMap(x => x.body);
  assert.deepEqual(entities.map(e => e.entity_type), ['section', 'menu_item']);
  assert.equal(entities[1].entity.labels.en, 'Sulaimani');
  assert.ok(submissions().some(o => o.subject.menu_item_id === entities[1].entity.id && o.value.amount_minor === 1000), 'price for the new item');

  await s.getByRole('button', { name: 'Done' }).click();
  await nav('Menu');
  await p.locator('.menu-chips').getByRole('button', { name: 'Unsure Corner' }).click();
  await activateMenu();

  // 4. Same items within 14 days are not asked again; Vada (4th) now is.
  posts.length = 0;
  s = await round(['Chai', 'Coffee', 'Vada', 'Bun']);
  assert.ok(s, 'the item left out last time is asked');
  assert.deepEqual(await s.locator('[data-kind]').evaluateAll(els => els.map(e => e.dataset.kind)), ['stale']);
  // 5. Skipping three rounds in a row pauses asking.
  await s.getByRole('button', { name: 'Not now' }).click();
  for (let i = 0; i < 2; i++) {
    s = await round(['Chai'], { prices: { Chai: 13 + i } });
    assert.ok(s, `changed price asks (skip ${i + 2})`);
    await s.getByRole('button', { name: 'Not now' }).click();
  }
  assert.equal(await round(['Chai'], { prices: { Chai: 20 }, soldOut: ['Bun'] }), null, 'paused after three skips');
  assert.equal(posts.length, 0, 'skipping sends nothing');

  assert.deepEqual(errors, []);
  console.log('Eatsights trigger browser test passed.');
} finally { await browser.close(); }
