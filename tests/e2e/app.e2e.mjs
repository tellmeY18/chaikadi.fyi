// App-level behaviour: joining mistakes, one-window-per-device, install
// guidance, developer options and the idle-session archive.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, nav, menu, button, dialog } from './helpers.mjs';

let app;
before(async () => { app = await start(); });
after(async () => { await app.finish(); assert.deepEqual(app.errors, []); assert.deepEqual(app.blocked, [], 'no outside requests'); });
const open = async (options, path = '') => { const context = await app.device(options), page = await context.newPage(); await page.goto(app.url + path); await page.waitForSelector('.app-shell'); return { context, page }; };
const code = async (page, text) => { await page.locator('.code-boxes input').first().click(); await page.keyboard.type(text); };

test('join: a made-up code explains itself, can be corrected, and Back returns to Create', async () => {
  const { page } = await open();
  await button(page, 'Join').click();
  await code(page, 'ABCD');
  await page.getByText(/Can’t reach ABCD/).waitFor({ timeout: 25000 });
  await button(page, 'Back').click();
  await button(page, 'Create').waitFor();
});

test('join: pasting a whole code fills every box; letters that are not in the alphabet are dropped', async () => {
  const { page, context } = await open({ permissions: ['clipboard-read', 'clipboard-write'] });
  await button(page, 'Join').click();
  const boxes = page.locator('.code-boxes input');
  await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text', 'k-7m!p'); boxes0().dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); function boxes0() { return document.querySelector('.code-boxes input'); } });
  assert.deepEqual(await boxes.evaluateAll(els => els.map(e => e.value)), ['K', '7', 'M', 'P']);
  await page.keyboard.press('Backspace');
  await context.close();
});

test('an invite link with no saved group joins by itself; leaving returns to the start', async () => {
  const host = await open(); await button(host.page, 'Create').click(); await host.page.locator('.room-plate').waitFor();
  await host.page.waitForFunction(() => !document.querySelector('.banner.warning'), null, { timeout: 15000 });
  const room = await host.page.locator('.plate-letters').textContent();
  const guest = await open({}, `/?room=${room}`);
  await guest.page.getByRole('navigation', { name: 'Main navigation' }).waitFor({ timeout: 20000 });
  await menu(guest.page, 'Settings');
  await button(guest.page, 'Leave group').click();
  await dialog(guest.page).getByRole('button', { name: 'Leave group' }).click();
  await button(guest.page, 'Create').waitFor();
});

test('a saved group stops a different invite link from replacing it', async () => {
  const { page } = await open();
  await button(page, 'Create').click(); await page.locator('.room-plate').waitFor();
  await page.goto(`${app.url}/?room=ZZZZ`); await page.waitForSelector('.app-shell');
  await page.getByText(/This link is for ZZZZ\. You have a saved group/).waitFor();
  assert.ok(await page.locator('.room-plate').count() || await page.getByRole('navigation', { name: 'Main navigation' }).count());
});

test('one window per device: the newest takes over and the older one can take it back', async () => {
  const context = await app.device({ serviceWorkers: 'block' }), a = await context.newPage(), b = await context.newPage();
  await a.goto(app.url); await button(a, 'Create').click(); await a.locator('.room-plate').waitFor();
  assert.equal(await a.getByText('Open in another window').count(), 0);
  await b.goto(app.url);
  await a.getByText('Open in another window').waitFor({ timeout: 10000 });
  await b.locator('.room-plate').waitFor({ timeout: 10000 });
  assert.equal(await a.getByRole('navigation', { name: 'Main navigation' }).count(), 0, 'old window shows no tabs');
  await button(a, 'Use this window').click();
  await a.locator('.room-plate').waitFor({ timeout: 10000 });
  await b.getByText('Open in another window').waitFor({ timeout: 10000 });
});

test('install: Chrome’s prompt is offered once, can be snoozed, and warns when mid-order', async () => {
  const { page } = await open();
  assert.equal(await page.getByText('Install Chaikadi').count(), 0, 'nothing to offer before the browser says it is installable');
  await page.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = async () => { window.__prompted = true; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
  await page.getByRole('heading', { name: 'Install Chaikadi' }).waitFor();
  await button(page, 'Install app').click();
  await page.waitForFunction(() => window.__prompted === true);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await page.getByRole('heading', { name: 'Install Chaikadi' }).waitFor({ state: 'detached' });
  // snooze
  await page.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = async () => {}; window.dispatchEvent(e); });
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  await page.getByRole('heading', { name: 'Install Chaikadi' }).waitFor({ state: 'detached' });
  // in a group the card tells people to wait
  await button(page, 'Create').click(); await page.locator('.room-plate').waitFor();
  await menu(page, 'Settings');
  await page.getByRole('heading', { name: 'Install after this order' }).waitFor();
  await page.getByRole('button', { name: 'Install anyway' }).click();
  await dialog(page).getByRole('button', { name: 'Install anyway' }).click();
});

test('install: iPhone gets Share → Add to Home Screen steps; in-app browsers are told to open Safari', async () => {
  const ios = await open({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' });
  await ios.page.getByText('Choose “Add to Home Screen”.').waitFor();
  const inApp = await open({ userAgent: 'Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' });
  await inApp.page.getByText(/in-app browser cannot install/).waitFor();
  const android = await open({ userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' });
  await android.page.getByText('Choose “Install app” or “Add to home screen”.').waitFor();
});

test('developer options: verbose log, self-test, relay settings and log tools', async () => {
  const { page, context } = await open({ permissions: ['clipboard-read', 'clipboard-write'] });
  await button(page, 'Create').click(); await page.locator('.room-plate').waitFor();
  await menu(page, 'Settings');
  await page.locator('summary', { hasText: 'Developer options' }).click();
  const dev = page.locator('.dev-details');
  await dev.getByText('Connection', { exact: true }).first().waitFor();
  await dev.getByText(/host · [A-Z0-9]{4}/).waitFor();
  await dev.locator('fieldset', { hasText: 'Verbose connection log' }).getByRole('button', { name: 'On', exact: true }).click();
  await dev.getByRole('button', { name: 'Run self-test' }).click();
  await dev.getByRole('button', { name: 'Run self-test' }).waitFor({ timeout: 20000 });
  await dev.locator('fieldset', { hasText: 'Relay (TURN)' }).getByRole('button', { name: 'My server' }).click();
  await dev.getByLabel('TURN URLs (comma separated)').fill('turn:turn.example.com:3478');
  await dev.getByLabel('Username').fill('u'); await dev.getByLabel('Password').fill('p');
  await dev.locator('form').getByRole('button', { name: 'Save' }).click();
  await page.locator('.toast', { hasText: 'Saved. Reconnecting…' }).waitFor();
  await dev.locator('fieldset', { hasText: 'Relay (TURN)' }).getByRole('button', { name: 'None' }).click();
  await dev.locator('fieldset', { hasText: 'Verbose connection log' }).getByRole('button', { name: 'Off', exact: true }).click();
  await dev.getByRole('button', { name: /^Copy report/ }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /app start/);
  const download = page.waitForEvent('download');
  await dev.getByRole('button', { name: /^Download report/ }).click();
  assert.match((await download).suggestedFilename(), /chaikadi-connection/);
  await dev.getByRole('button', { name: 'Clear log' }).click();
  await dev.getByText('Nothing logged yet.').waitFor();
  await context.close();
});

test('a session idle for over an hour is archived to History on the next open', async () => {
  const { page, context } = await open();
  await button(page, 'Create').click(); await page.locator('.room-plate').waitFor();
  await nav(page, 'My picks');
  await page.getByLabel('Add an item for everyone').fill('Samosa 15'); await page.locator('.quick-add button').click();
  await page.getByLabel('Samosa, quantity 1', { exact: true }).waitFor();
  await page.waitForTimeout(500);
  await page.clock.install({ time: Date.now() + 2 * 3600 * 1000 });
  await page.reload(); await page.waitForSelector('.app-shell');
  await page.getByText(/was idle for over an hour and was archived to History with its open order/).waitFor();
  await button(page, 'View history').click();
  await page.locator('details.archived summary').click();
  await page.getByText('not finished').first().waitFor();
  await context.close();
});

test('offline: the app opens and works from the service worker, and an update check does not break it', async () => {
  const { page, context } = await open();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await button(page, 'Create').click(); await page.locator('.room-plate').waitFor();
  await context.setOffline(true);
  await page.reload(); await page.locator('.room-plate').waitFor();
  await menu(page, 'Settings');
  await button(page, 'Check for updates').click();
  await page.locator('.toast', { hasText: /No connection\.|You have the latest version\./ }).waitFor();
  await context.close();
});
