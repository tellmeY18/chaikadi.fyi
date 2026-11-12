// Live smoke test of the published menu library against https://chaikadi.fyi
// with the default data host. Run after deploys:
//   PLAYWRIGHT_MODULE=… node tests/live-library.mjs
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const APP = process.env.TEST_URL || 'https://chaikadi.fyi';
const args = process.env.DATA_RESOLVE ? [`--host-resolver-rules=MAP data.chaikadi.fyi ${process.env.DATA_RESOLVE}`] : [];
const browser = await chromium.launch({ args });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [], hosts = new Set();
  page.on('pageerror', e => errors.push(e.message));
  context.on('request', r => hosts.add(new URL(r.url()).host));
  await page.goto(APP);
  await page.getByText('Offline app ready', { exact: true }).waitFor({ timeout: 30000 });
  // CORS from the app's origin, credentials omitted, as the app does it.
  const cors = await page.evaluate(async () => { const r = await fetch('https://data.chaikadi.fyi/v2/manifest.json', { credentials: 'omit', cache: 'reload' }); return { ok: r.ok, cities: (await r.json()).cities.length }; });
  assert.deepEqual(cors, { ok: true, cities: 1 });

  await page.getByRole('button', { name: 'Pair without internet', exact: true }).click();
  await page.locator('.room-plate').waitFor();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Pick from library', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Menu library' });
  await sheet.locator('.library-result').nth(3).waitFor({ timeout: 30000 });
  const chips = await sheet.locator('.fresh-chip').allTextContents();
  console.log('results:', (await sheet.locator('.library-name').allTextContents()).join(' | '));
  console.log('chips:', chips.join(' | '));
  assert.equal(await sheet.getByText('Sample', { exact: true }).count(), 3);
  await sheet.getByLabel('Search by name').fill('kaloor');
  await sheet.locator('.library-result').first().click();
  await sheet.getByRole('button', { name: 'Use this menu', exact: true }).click();
  await page.getByText(/Sample Chai Corner, Kaloor: 8 added/).waitFor();
  await page.locator('.item-list li', { hasText: 'Filter Coffee' }).getByText('Rs 18', { exact: true }).waitFor();

  const stored = await page.evaluate(async () => ({ caches: await caches.keys(), sw: !!navigator.serviceWorker.controller }));
  assert.ok(stored.caches.includes('chaikadi-data-v1'), 'service worker runtime cache for the data host');
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('heading', { name: 'Sample Chai Corner, Kaloor', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Pick from library', exact: true }).click();
  await sheet.locator('.library-result').nth(3).waitFor();
  await sheet.getByText('Showing saved menus. Updates download when you are online.', { exact: true }).waitFor();
  await context.setOffline(false);
  assert.deepEqual(errors, []);
  const third = [...hosts].filter(h => !['chaikadi.fyi', 'data.chaikadi.fyi'].includes(h) && !h.endsWith('peerjs.com'));
  assert.deepEqual(third, [], `unexpected hosts: ${third}`);
  console.log(`live: ${APP} + data.chaikadi.fyi — CORS, search, freshness, Sample labels, import, offline reopen passed. Hosts: ${[...hosts].join(', ')}`);
} finally { await browser.close(); }
