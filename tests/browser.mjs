// Real local WebRTC and persisted group flow in Chromium / WebKit.
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch();
const base = process.env.TEST_URL || 'http://127.0.0.1:8080';
const errors = [], external = [];
const nav = (p, label) => p.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: label, exact: true }).click();
async function extra(p, label) { await p.getByRole('button', { name: 'Open app menu', exact: true }).click(); await p.locator('.app-menu').getByRole('button', { name: label, exact: true }).click(); }
try {
  const hc = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const gc = await browser.newContext({ viewport: { width: 390, height: 844 } });
  for (const context of [hc, gc]) await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === new URL(base).origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  let host = await hc.newPage(); const guest = await gc.newPage();
  for (const p of [host, guest]) p.on('pageerror', e => errors.push(e.message));
  await Promise.all([host.goto(base), guest.goto(base)]);
  await host.getByText('Offline app ready', { exact: true }).waitFor();
  await guest.getByText('Offline app ready', { exact: true }).waitFor();
  await host.getByText('Group and display names', { exact: true }).click();
  await host.getByLabel('Group name', { exact: true }).fill('Browser tea crew');
  await host.getByLabel('Your name', { exact: true }).fill('Anu');
  await host.getByRole('button', { name: 'Pair without internet', exact: true }).click();
  await host.getByRole('heading', { name: 'Browser tea crew' }).waitFor();
  await guest.getByRole('button', { name: 'Join with a code', exact: true }).click();
  await guest.getByLabel('Your name', { exact: true }).fill('Bala');
  await guest.getByRole('button', { name: 'Pair without internet', exact: true }).click();
  async function pair() {
    await host.getByRole('button', { name: 'Pair without internet', exact: true }).click();
    const hd = host.getByRole('dialog'), gd = guest.getByRole('dialog');
    await hd.getByRole('button', { name: 'Create offer', exact: true }).click();
    await hd.getByLabel('Pairing text', { exact: true }).waitFor();
    await gd.getByLabel('Paste offer', { exact: true }).fill(await hd.getByLabel('Pairing text', { exact: true }).inputValue());
    await gd.getByRole('button', { name: 'Create answer', exact: true }).click();
    await gd.getByLabel('Pairing text', { exact: true }).waitFor();
    await hd.getByLabel('Paste answer', { exact: true }).fill(await gd.getByLabel('Pairing text', { exact: true }).inputValue());
    await hd.getByRole('button', { name: 'Connect person', exact: true }).click();
    await gd.getByText('Connected. You can close this panel.', { exact: true }).waitFor({ timeout: 30000 });
    await hd.getByText('Connected. You can close this panel.', { exact: true }).waitFor();
    await hd.getByRole('button', { name: 'Close', exact: true }).click();
    await gd.getByRole('button', { name: 'Close', exact: true }).click();
  }
  await pair();
  assert.equal(await host.locator('.people li').count(), 2);
  await nav(host, 'Menu');
  assert.equal(await host.locator('.item-list li').count(), 0, 'No default items');
  await host.getByRole('button', { name: 'Add common tea-break items', exact: true }).click();
  await host.waitForFunction(() => document.querySelectorAll('.item-list li').length === 9);
  await host.getByRole('button', { name: 'Edit items', exact: true }).click();
  for (const [name, price] of [['Chai', '10'], ['Samosa', '20']]) {
    const row = host.locator('.item-list li').filter({ has: host.getByText(name, { exact: true }) });
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await host.getByRole('dialog').getByLabel('Price (Rs)', { exact: true }).fill(price);
    await host.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await host.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  await nav(host, 'My picks'); await host.getByRole('button', { name: 'Add one Chai', exact: true }).click();
  await nav(guest, 'My picks'); await guest.getByRole('button', { name: 'Add one Samosa', exact: true }).click();
  await guest.getByRole('button', { name: 'Add a note for Samosa', exact: true }).click();
  await guest.getByRole('dialog').getByLabel('Item note', { exact: true }).fill('extra chutney');
  await guest.getByRole('dialog').getByRole('button', { name: 'Save note', exact: true }).click();
  await nav(host, 'Order'); await host.getByText('Per-person breakdown', { exact: true }).click();
  await host.getByText('Note: extra chutney', { exact: true }).waitFor();
  await host.getByRole('button', { name: 'Lock order', exact: true }).click();
  await host.getByRole('dialog', { name: 'Order locked.' }).waitFor();
  await host.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
  await guest.getByText('The order is locked. Your picks are saved.', { exact: true }).waitFor();
  assert.ok(await guest.getByRole('button', { name: 'Add one Samosa', exact: true }).isDisabled());
  await nav(host, 'Costs'); await host.getByLabel('Bill total (Rs)', { exact: true }).fill('36');
  await host.getByRole('button', { name: 'Save actual bill', exact: true }).click();
  await host.getByText('Rs 13', { exact: true }).waitFor(); await host.getByText('Rs 23', { exact: true }).waitFor();
  await host.getByLabel('Split the difference').selectOption('proportional');
  await host.getByRole('button', { name: 'Save actual bill', exact: true }).click();
  await host.getByText('Rs 12', { exact: true }).waitFor(); await host.getByText('Rs 24', { exact: true }).waitFor();
  await host.getByRole('button', { name: 'Finish round', exact: true }).click();
  await host.getByRole('dialog').getByRole('button', { name: 'Finish round', exact: true }).click();
  await extra(host, 'History'); await host.getByText('Bala → Anu', { exact: true }).waitFor();
  await extra(guest, 'History'); await guest.getByText('Bala → Anu', { exact: true }).waitFor();
  await host.screenshot({ path: process.env.SCREENSHOT_PATH || join(tmpdir(), 'chaikadi-history.png'), fullPage: true });
  assert.equal(await host.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await host.close();
  await guest.getByText('Note: host is offline. Your picks are saved and will sync when they return.', { exact: false }).waitFor({ timeout: 30000 });
  await nav(guest, 'My picks'); await guest.getByRole('button', { name: 'Add one Chai', exact: true }).click();
  await guest.getByLabel('Chai, quantity 1', { exact: true }).waitFor();
  await gc.setOffline(true); await guest.reload();
  await guest.getByRole('heading', { name: 'Browser tea crew' }).waitFor();
  await nav(guest, 'My picks'); assert.equal(await guest.getByLabel('Chai, quantity 1', { exact: true }).textContent(), '1');
  await gc.setOffline(false); host = await hc.newPage(); host.on('pageerror', e => errors.push(e.message));
  await host.goto(base); await host.getByRole('heading', { name: 'Browser tea crew' }).waitFor();
  await extra(guest, 'Pair without internet'); await pair();
  await nav(host, 'Order'); await host.getByText('Per-person breakdown', { exact: true }).click();
  await host.locator('.plain-list').getByText('1 × Chai', { exact: true }).waitFor();
  await guest.waitForFunction(() => !document.querySelector('.sync-status'));
  assert.deepEqual(errors, []); assert.ok(external.every(url => /0\.peerjs\.com/.test(url)));
  console.log(`${process.env.BROWSER || 'chromium'}: manual WebRTC, opt-in menu, notes, lock sheet, bill, history and offline recovery passed.`);
} finally { await browser.close(); }
