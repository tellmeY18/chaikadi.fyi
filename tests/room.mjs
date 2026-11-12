// Optional public-cloud room-code integration smoke. Requires internet.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch();
const base = process.env.TEST_URL || 'http://127.0.0.1:8080';
try {
  const hc = await browser.newContext(), gc = await browser.newContext();
  const host = await hc.newPage(), guest = await gc.newPage();
  const errors = [];
  for (const p of [host, guest]) p.on('pageerror', e => errors.push(e.message));
  await Promise.all([host.goto(base), guest.goto(base)]);
  await host.getByText('Group and display names', { exact: true }).click();
  await host.getByLabel('Group name', { exact: true }).fill('Room integration');
  await host.getByRole('button', { name: 'Create a group', exact: true }).click();
  await host.locator('.room-plate').waitFor();
  await host.getByText('Note: the room code is not ready. Retry or pair without internet.', { exact: true }).waitFor({ state: 'hidden', timeout: 45000 });
  const code = await host.locator('.plate-letters').textContent();
  await guest.goto(`${base}/?room=${code}`);
  await guest.getByRole('heading', { name: 'Menus', exact: true }).waitFor({ timeout: 45000 });
  await host.waitForFunction(() => document.querySelectorAll('.presence.online').length === 2);
  await guest.getByRole('button', { name: 'Add common tea-break items', exact: true }).click();
  await host.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Menu', exact: true }).click();
  await host.waitForFunction(() => document.querySelectorAll('.item-list li').length === 9);
  await guest.reload();
  await guest.waitForFunction(() => document.querySelectorAll('.presence.online').length === 2, { timeout: 45000 });
  await host.reload();
  await host.waitForFunction(() => document.querySelectorAll('.presence.online').length === 2, { timeout: 45000 });
  await guest.waitForFunction(() => document.querySelectorAll('.presence.online').length === 2, { timeout: 45000 });
  assert.deepEqual(errors, []);
  console.log('Room code: public signaling, invite auto-join, shared menu, refresh and reconnect passed.');
} finally { await browser.close(); }
