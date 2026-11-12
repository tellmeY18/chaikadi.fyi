// Optional public-cloud room-code integration smoke. Requires internet.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
const base = process.env.TEST_URL || 'http://127.0.0.1:8080';
try {
  const hc = await browser.newContext(), gc = await browser.newContext();
  const host = await hc.newPage(), guest = await gc.newPage();
  const errors = [];
  for (const page of [host, guest]) page.on('pageerror', e => errors.push(e.message));
  await Promise.all([host.goto(base), guest.goto(base)]);
  await host.locator('summary').first().click();
  await host.getByLabel('Group name', { exact: true }).fill('Room integration');
  await host.getByRole('button', { name: 'Start a tea break →', exact: true }).click();
  await host.getByText('Room code ready · host on this device', { exact: true }).waitFor({ timeout: 45000 });
  const code = await host.locator('.room-code').textContent();
  await guest.goto(`${base}/?room=${code}`);
    await guest.getByText('Connected to host · peer-to-peer', { exact: true }).waitFor({ timeout: 45000 });
  assert.equal(await host.locator('.people li').count(), 2);
  await guest.getByRole('navigation').getByRole('button', { name: 'Menu', exact: true }).click();
  await host.getByRole('navigation').getByRole('button', { name: 'Menu', exact: true }).click();
  await host.waitForFunction(() => document.querySelectorAll('.item-list li').length === 9);
  await guest.reload();
  await guest.getByText('Connected to host · peer-to-peer', { exact: true }).waitFor({ timeout: 45000 });
  assert.equal(await guest.locator('.people li').count(), 2);
  await host.reload();
  await host.getByText('Room code ready · host on this device', { exact: true }).waitFor({ timeout: 45000 });
  await guest.getByText('Connected to host · peer-to-peer', { exact: true }).waitFor({ timeout: 45000 });
  assert.deepEqual(errors, []);
  console.log('Room code: public signaling, real PeerJS DataChannel, member intents, reload/reconnect passed.');
} finally { await browser.close(); }
