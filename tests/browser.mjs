// Optional real-browser acceptance smoke. Install Playwright separately; it is
// never a runtime dependency. Set PLAYWRIGHT_MODULE to its absolute index.mjs.
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
const browser = await engine.launch({ headless: true });
const base = process.env.TEST_URL || 'http://127.0.0.1:8080';
const errors = [], external = [];
try {
  const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  for (const context of [hostContext, guestContext]) {
    // Both clients have only the local static server, no signaling/STUN HTTP.
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === new URL(base).origin) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
  }
  let host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  for (const page of [host, guest]) page.on('pageerror', e => errors.push(e.message));
  await Promise.all([host.goto(base), guest.goto(base)]);
  await host.getByText('Offline app ready', { exact: true }).waitFor();
  await guest.getByText('Offline app ready', { exact: true }).waitFor();
  await host.locator('summary').first().click();
  await host.getByLabel('Group name', { exact: true }).fill('Browser tea crew');
  await host.getByLabel('Your name').fill('Anu');
  await host.getByRole('button', { name: 'No internet? Start offline', exact: true }).click();
  await host.getByRole('heading', { name: 'Browser tea crew' }).waitFor();
  await guest.getByRole('button', { name: 'Join one', exact: true }).click();
  await guest.getByLabel('Your name').fill('Bala');
  await guest.getByRole('button', { name: 'No internet?', exact: true }).click();

  async function pair() {
    await host.getByRole('button', { name: 'Add person manually', exact: true }).click();
    await host.getByRole('button', { name: 'Create offer · add person', exact: true }).click();
    const hostDialog = host.getByRole('dialog'), guestDialog = guest.getByRole('dialog');
    await hostDialog.getByLabel('Pairing text', { exact: true }).waitFor().catch(async error => {
      console.error('Host pairing panel:', await hostDialog.innerText()); throw error;
    });
    const offer = await hostDialog.getByLabel('Pairing text', { exact: true }).inputValue();
    await guestDialog.getByLabel('Paste offer', { exact: true }).fill(offer);
    await guestDialog.getByRole('button', { name: 'Create answer', exact: true }).click();
    await guestDialog.getByLabel('Pairing text', { exact: true }).waitFor();
    const answer = await guestDialog.getByLabel('Pairing text', { exact: true }).inputValue();
    await hostDialog.getByLabel('Paste answer', { exact: true }).fill(answer);
    await hostDialog.getByRole('button', { name: 'Connect person', exact: true }).click();
    await guestDialog.getByText('Connected! You can close this panel.', { exact: true }).waitFor({ timeout: 30000 });
    await hostDialog.getByText('Connected! You can close this panel.', { exact: true }).waitFor();
    await hostDialog.getByRole('button', { name: 'Close manual pairing' }).click();
    await guestDialog.getByRole('button', { name: 'Close manual pairing' }).click();
  }
  await pair();
  await guest.getByRole('navigation').getByRole('button', { name: 'Group', exact: true }).click();
  assert.equal(await host.locator('.people li').count(), 2);
  assert.equal(await guest.locator('.people li').count(), 2);
  await host.getByRole('navigation').getByRole('button', { name: 'Menu', exact: true }).click();
  await host.getByRole('button', { name: 'Add tea-break presets' }).click();
  await host.waitForFunction(() => document.querySelectorAll('.item-list li').length === 9);
  for (const [name, price] of [['Chai', '10'], ['Samosa', '20']]) {
    const row = host.locator('.item-list li').filter({ has: host.getByText(name, { exact: true }) });
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await host.getByLabel('Price (₹)').fill(price);
    await host.getByRole('button', { name: 'Save changes', exact: true }).click();
    await host.getByRole('heading', { name: 'Add an item', exact: true }).waitFor();
  }
  await host.getByRole('navigation').getByRole('button', { name: 'My picks', exact: true }).click();
  await host.getByRole('button', { name: 'Add one Chai', exact: true }).click();
  await guest.getByRole('navigation').getByRole('button', { name: 'My picks', exact: true }).click();
  await guest.getByRole('button', { name: 'Add one Samosa', exact: true }).click();
  await guest.getByLabel('Item note', { exact: true }).fill('extra chutney');
  await guest.getByRole('button', { name: 'Save note', exact: true }).click();
  await host.getByRole('navigation').getByRole('button', { name: 'Order', exact: true }).click();
  await host.getByText('Note: extra chutney', { exact: true }).waitFor();
  await host.getByRole('button', { name: 'Lock & place order', exact: true }).click();
  await guest.getByText('The order is locked. Your picks are saved.', { exact: true }).waitFor();
  assert.equal(await guest.getByRole('button', { name: 'Add one Samosa', exact: true }).isDisabled(), true);
  await host.getByRole('navigation').getByRole('button', { name: 'Costs', exact: true }).click();
  await host.getByLabel('Bill total (₹)').fill('36');
  await host.getByRole('button', { name: 'Save actual bill', exact: true }).click();
  await host.getByText('₹13.00', { exact: true }).waitFor();
  await host.getByText('₹23.00', { exact: true }).waitFor();
  await host.getByLabel('Split the difference').selectOption('proportional');
  await host.getByRole('button', { name: 'Save actual bill', exact: true }).click();
  await host.getByText('₹12.00', { exact: true }).waitFor();
  await host.getByText('₹24.00', { exact: true }).waitFor();
  host.on('dialog', dialog => dialog.accept());
  await host.getByRole('button', { name: 'Finish round', exact: true }).click();
  await host.getByRole('navigation').getByRole('button', { name: 'History', exact: true }).click();
  await host.getByText('Bala → Anu', { exact: true }).waitFor();
  await guest.getByRole('navigation').getByRole('button', { name: 'History', exact: true }).click();
  await guest.getByText('Bala → Anu', { exact: true }).waitFor();
  await host.screenshot({ path: process.env.SCREENSHOT_PATH || join(tmpdir(), 'chaikadi-history.png'), fullPage: true });
  assert.equal(await host.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);

  // Saved host closes, guest queues an edit and reloads with the internet off.
  await host.close();
  await guest.getByText('Host offline.', { exact: true }).waitFor({ timeout: 30000 });
  await guest.getByRole('navigation').getByRole('button', { name: 'My picks', exact: true }).click();
  await guest.getByRole('button', { name: 'Add one Chai', exact: true }).click();
  await guest.waitForFunction(() => document.querySelector('output[aria-label="Chai quantity"]')?.textContent === '1');
  await guestContext.setOffline(true);
  await guest.reload();
  await guest.getByRole('heading', { name: 'Browser tea crew' }).waitFor();
  await guest.getByRole('navigation').getByRole('button', { name: 'My picks', exact: true }).click();
  assert.equal(await guest.getByLabel('Chai quantity', { exact: true }).textContent(), '1');
  await guestContext.setOffline(false);
  host = await hostContext.newPage(); host.on('pageerror', e => errors.push(e.message));
  await host.goto(base);
  await host.getByRole('heading', { name: 'Browser tea crew' }).waitFor();
  await guest.getByRole('button', { name: 'Pair manually', exact: true }).click();
  await pair();
  await host.getByRole('navigation').getByRole('button', { name: 'Order', exact: true }).click();
  await host.locator('.plain-list').getByText('1 × Chai', { exact: true }).waitFor();
  await guest.waitForFunction(() => !document.querySelector('.sync-status'));
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('; ')}`);
  assert.ok(external.every(url => /0\.peerjs\.com/.test(url)), `Unexpected third-party HTTP: ${external}`);
  console.log(`${process.env.BROWSER || 'chromium'}: UI, real manual WebRTC, shared picks, locking, exact splits, history, offline reload and queued reconnect passed.`);
} finally { await browser.close(); }
