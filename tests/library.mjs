// Real-browser menu library test. Serves data through Playwright routes built
// from the chaikadi-data fixtures (hashes recomputed), so it needs no network.
//   PLAYWRIGHT_MODULE=… node tests/library.mjs   (app served at TEST_URL)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const base = process.env.TEST_URL || 'http://127.0.0.1:8080';
// The static library (Settings → Data source → Static library) at its real,
// cross-origin address; served from fixtures through Playwright routes.
const DATA = 'https://data.chaikadi.fyi';

// A non-sample copy of the first fixture place, so the share prompt applies.
const bundle = JSON.parse(readFileSync(new URL('fixtures/data/v2/index/in-kl-ernakulam.json', import.meta.url), 'utf8'));
bundle.places[0] = { ...bundle.places[0], name: 'Test Chai Corner', sample: undefined };
const bundleText = JSON.stringify(bundle);
const manifest = JSON.parse(readFileSync(new URL('fixtures/data/v2/manifest.json', import.meta.url), 'utf8'));
manifest.cities[0].sha256 = createHash('sha256').update(bundleText).digest('hex');
manifest.cities[0].bytes = Buffer.byteLength(bundleText);
const tampered = bundleText.replace('"Chai"', '"Tea!"');

async function setup(context, { bundleBody = bundleText } = {}) {
  const external = [];
  await context.route('**/*', route => {
    const url = route.request().url();
    const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*' };
    if (url === `${DATA}/v2/manifest.json`) return route.fulfill({ status: 200, headers, body: JSON.stringify(manifest) });
    if (url === `${DATA}/v2/index/in-kl-ernakulam.json`) return route.fulfill({ status: 200, headers, body: bundleBody });
    if (new URL(url).origin === new URL(base).origin) return route.continue();
    external.push(url); return route.abort();
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('.room-plate').waitFor();
  await page.getByRole('button', { name: 'Open app menu', exact: true }).click();
  await page.locator('.app-menu').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Static library', exact: true }).click();
  await page.getByText('Data source saved.', { exact: true }).waitFor();
  return { page, errors, external };
}
const nav = (page, label) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: label, exact: true }).click();
const sheet = page => page.getByRole('dialog', { name: 'Menu library' });
async function openLibrary(page) {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Pick from library', exact: true }).click();
}

try {
  // Service workers are blocked here: WebKit does not pass requests from
  // SW-controlled pages through Playwright routes. The library cache under test
  // is IndexedDB; the offline app shell is covered by tests/browser.mjs.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const { page, errors, external } = await setup(context);
  await nav(page, 'Menu');
  await openLibrary(page);
  await sheet(page).locator('.library-result').nth(3).waitFor();
  assert.equal(await sheet(page).getByLabel('City').inputValue(), 'in/kl/ernakulam');
  assert.equal(await sheet(page).getByText('Sample', { exact: true }).count(), 2, 'samples are labelled');
  for (const chip of await sheet(page).locator('.fresh-chip').allTextContents()) {
    assert.match(chip, /^(Confirmed (today|\d+ days? ago)|Old prices|Unconfirmed)$/);
  }
  await sheet(page).getByLabel('Search by name').fill('chai corner');
  await sheet(page).locator('.library-result').first().waitFor();
  assert.equal(await sheet(page).locator('.library-result').count(), 1);
  await sheet(page).locator('.library-result').first().click();
  await sheet(page).getByText('in/kl/ernakulam/sample-chai-corner-kaloor', { exact: true }).waitFor();
  await sheet(page).getByText('Prices last confirmed 2026-11-01. From the menu board.', { exact: true }).waitFor();
  await sheet(page).getByRole('button', { name: 'Use this menu', exact: true }).click();
  await page.getByText(/Test Chai Corner: 8 added/).waitFor();
  await page.locator('.menu-chips').getByRole('button', { name: 'Test Chai Corner' }).waitFor();
  await page.locator('.item-list li', { hasText: 'Masala Chai' }).getByText('Rs 15', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Use this menu', exact: true }).click();

  // Importing again asks: replace or add. Add creates no duplicates.
  await openLibrary(page);
  await sheet(page).getByLabel('Search by name').fill('chai corner');
  await sheet(page).locator('.library-result').first().click();
  await sheet(page).getByRole('button', { name: 'Use this menu', exact: true }).click();
  await sheet(page).getByRole('button', { name: 'Add missing items only', exact: true }).click();
  await page.getByText('Test Chai Corner: 0 added.', { exact: true }).waitFor();
  assert.equal(await page.locator('.item-list li').count(), 8);
  assert.ok(await sheet(page).count() === 0);

  // A rich v2 place: location, tax, sections with hours, variants, seasonal, unsure.
  await openLibrary(page);
  await sheet(page).getByLabel('Search by name').fill('cyber green');
  await sheet(page).locator('.library-result').first().getByText('Restaurant · Inside Prestige Cyber Green, Phase 1 · Kakkanad 682042', { exact: true }).waitFor();
  await sheet(page).locator('.library-result').first().click();
  for (const text of ['Taxes are extra. Prices exclusive of all taxes.', '08:00–12:00', 'Breads', 'Chicken Biriyani (Half)', 'Seasonal', 'Unsure: name partly illegible ("SAMA")', '2 pcs']) {
    assert.ok(await sheet(page).getByText(text, { exact: true }).count() > 0, text);
  }
  assert.ok(await sheet(page).locator('li', { hasText: 'Chicken Biriyani (Half)' }).getByText('Rs 160', { exact: true }).isVisible());
  await sheet(page).getByRole('button', { name: 'Close', exact: true }).click();
  await sheet(page).waitFor({ state: 'detached' });

  // Group raises a price, orders, and finishes the round.
  await page.getByRole('button', { name: 'Edit items', exact: true }).click();
  await page.locator('.item-list li').filter({ has: page.getByText('Chai', { exact: true }) }).getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Price (Rs)', { exact: true }).fill('14');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await nav(page, 'My picks'); await page.getByRole('button', { name: 'Add one Chai', exact: true }).click();
  await nav(page, 'Order'); await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
  await nav(page, 'Costs'); await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }).click();
  const share = page.getByRole('dialog', { name: 'Share these price updates?' });
  await share.getByText('was Rs 12, now Rs 14', { exact: true }).waitFor();
  assert.equal(await share.locator('.item-list li').count(), 1, 'only changed items');
  assert.equal(external.length, 0, 'nothing sent before the user opts in');
  const popup = context.waitForEvent('page');
  await share.getByRole('button', { name: 'Share these price updates', exact: true }).click();
  await (await popup).waitForLoadState().catch(() => {});
  await page.getByText('Opened a prefilled GitHub issue in a new tab.', { exact: true }).waitFor();
  const issue = new URL(external.find(u => u.startsWith('https://github.com/')));
  assert.equal(issue.pathname, '/tellmeY18/chaikadi-data/issues/new');
  assert.equal(issue.searchParams.get('place-id'), 'in/kl/ernakulam/sample-chai-corner-kaloor');
  assert.equal(issue.searchParams.get('changes'), 'Chai | Tea | 14');
  assert.ok(![...issue.searchParams.values()].some(v => /Crew|Anu|Host/.test(v)), 'no group or member data');

  // Offline: the saved library still opens from IndexedDB, with no requests.
  await context.setOffline(true);
  const before = external.length;
  await nav(page, 'Menu');
  await openLibrary(page);
  await sheet(page).locator('.library-result').nth(3).waitFor();
  await sheet(page).getByText('Saved copy.', { exact: true }).waitFor();
  assert.equal(external.length, before);
  await context.setOffline(false);
  assert.deepEqual(errors, []);
  assert.ok(external.every(u => u.startsWith('https://github.com/tellmeY18/chaikadi-data/issues/new?')), external.join('\n'));
  await context.close();

  // Never cached + offline: clear empty state.
  const offline = await browser.newContext({ serviceWorkers: 'block' });
  const o = await setup(offline);
  await offline.setOffline(true);
  await nav(o.page, 'Menu');
  await openLibrary(o.page);
  await sheet(o.page).getByText(/isn’t saved on this device yet/).waitFor();
  await offline.close();

  // Tampered bundle: rejected, nothing shown or stored.
  const evil = await browser.newContext({ serviceWorkers: 'block' });
  const e = await setup(evil, { bundleBody: tampered });
  await nav(e.page, 'Menu');
  await openLibrary(e.page);
  await sheet(e.page).getByText('Downloaded menus did not match the library index, so they were not used.', { exact: true }).waitFor();
  assert.equal(await sheet(e.page).locator('.library-result').count(), 0);
  await evil.close();
    console.log(`${process.env.BROWSER || 'chromium'}: library search, freshness chips, samples, import add/replace, opt-in share, offline cache, offline-empty and hash rejection passed.`);
} finally { await browser.close(); }
