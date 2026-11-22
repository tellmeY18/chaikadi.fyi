// Money without handling money: UPI scan → owner approves → payer gets Pay
// links; QR scanning with a fake camera; and the "buy a chai" supporter flow.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, nav, menu, button, dialog } from './helpers.mjs';
import { qrVideo } from './camera.mjs';

let good, bad, join;
before(async () => {
  good = await start({ camera: qrVideo('upi://pay?pa=Anu@okbank&pn=Anu%20K') });
  bad = await start({ camera: qrVideo('https://evil.example/pay?pa=x@y') });
  join = await start({ camera: qrVideo('http://127.0.0.1/?room=ABCD') });
});
after(async () => {
  for (const app of [good, bad, join]) { await app.finish(); assert.deepEqual(app.errors, []); assert.deepEqual(app.blocked, [], 'no outside requests'); }
});
const nav2 = page => page.getByRole('navigation', { name: 'Main navigation' });
const device = async (app, options) => { const context = await app.device({ permissions: ['camera', 'clipboard-read', 'clipboard-write'], ...options }); return { context, page: await context.newPage() }; };
const online = (page, n) => page.waitForFunction(count => document.querySelectorAll('.people .presence.online').length === count, n, { timeout: 20000 });

test('scan a UPI QR: the owner approves it, then the payer gets Pay links with the right amount', async () => {
  const anu = await device(good), bala = await device(good);
  await anu.page.goto(good.url); await anu.page.waitForSelector('.app-shell');
  await anu.page.getByLabel('Your name', { exact: true }).fill('Anu K');
  await button(anu.page, 'Create').click(); await anu.page.locator('.room-plate').waitFor();
  await anu.page.waitForFunction(() => !document.querySelector('.banner.warning'), null, { timeout: 15000 });
  const room = await anu.page.locator('.plate-letters').textContent();
  await bala.page.goto(`${good.url}/?room=${room}`);
  await nav2(bala.page).waitFor({ timeout: 20000 });
  await menu(anu.page, 'Group'); await online(anu.page, 2);

  // Anu adds an item and Bala picks it; Anu locks.
  await nav(anu.page, 'Menu'); await anu.page.getByRole('button', { name: 'Add', exact: true }).click();
  await dialog(anu.page).getByRole('button', { name: 'Item', exact: true }).click();
  await dialog(anu.page).getByLabel('Item name').fill('Chai'); await dialog(anu.page).getByLabel('Price (Rs)').fill('12');
  await dialog(anu.page).getByRole('button', { name: 'Save', exact: true }).click();
  await nav(bala.page, 'My picks'); await button(bala.page, 'Add one Chai').click(); await button(bala.page, 'Add one Chai').click();
  await nav(anu.page, 'Order'); await anu.page.getByText('Chai x 2').waitFor();
  await button(anu.page, 'Lock').click(); await dialog(anu.page).getByRole('button', { name: 'Done', exact: true }).click();

  // Bala: Anu has no UPI ID yet, so Bala is offered a scan.
  await nav(bala.page, 'Costs');
  await bala.page.getByRole('heading', { name: 'Pay Anu K by UPI' }).waitFor();
  await bala.page.getByRole('button', { name: /^Scan UPI QR/ }).click();
  await bala.page.getByText('Sent to Anu K to approve.').waitFor({ timeout: 20000 });
  await bala.page.getByText('Waiting for Anu K to approve the UPI ID you scanned.').waitFor();

  // Anu: a sheet opens by itself and names the ID; nothing is saved until approved.
  await dialog(anu.page).getByText('anu@okbank', { exact: true }).waitFor({ timeout: 15000 });
  await dialog(anu.page).getByText(/Only approve it if this is your UPI ID/).waitFor();
  await dialog(anu.page).getByRole('button', { name: 'Yes, this is my UPI ID' }).click();
  await menu(anu.page, 'Settings');
  assert.equal(await anu.page.getByLabel('UPI ID').inputValue(), 'anu@okbank');
  await nav(anu.page, 'Costs');

  // Bala can now pay the exact share.
  await anu.page.getByLabel('Bill total (Rs, optional)').fill('30'); await button(anu.page, 'Save bill').click();
  await bala.page.getByRole('button', { name: /^Pay Anu K Rs/ }).waitFor({ timeout: 15000 });
  await bala.page.getByRole('button', { name: /^Pay Anu K Rs/ }).click();
  const sheet = dialog(bala.page);
  await sheet.getByText('Pay Anu K', { exact: true }).waitFor();
  await sheet.getByText('anu@okbank', { exact: true }).waitFor();
  const href = await sheet.getByRole('link', { name: 'Pay with UPI app' }).getAttribute('href');
  assert.match(href, /^upi:\/\/pay\?pa=anu@okbank&pn=Anu%20K&am=\d+\.\d\d&cu=INR&tn=/);
  assert.ok((await sheet.getByRole('link', { name: 'Google Pay' }).getAttribute('href')).startsWith('gpay://upi/pay?'));
  await sheet.getByRole('button', { name: /Copy UPI ID/ }).click();
  assert.equal(await bala.page.evaluate(() => navigator.clipboard.readText()), 'anu@okbank');
  await sheet.getByRole('button', { name: /Show UPI QR/ }).click();
  await sheet.locator('canvas[role="img"]').waitFor();
  await sheet.getByRole('button', { name: /Hide UPI QR/ }).click();
  await sheet.getByRole('button', { name: 'Close' }).click();
  // Anu marks it paid; Bala sees the stamp.
  await anu.page.getByRole('button', { name: /: not paid/ }).click();
  await bala.page.locator('.stamp', { hasText: 'PAID' }).waitFor();
});

test('a decline leaves the owner without a UPI ID', async () => {
  const anu = await device(good), bala = await device(good);
  await anu.page.goto(good.url); await button(anu.page, 'Create').click(); await anu.page.locator('.room-plate').waitFor();
  await anu.page.waitForFunction(() => !document.querySelector('.banner.warning'), null, { timeout: 15000 });
  const room = await anu.page.locator('.plate-letters').textContent();
  await bala.page.goto(`${good.url}/?room=${room}`); await nav2(bala.page).waitFor({ timeout: 20000 });
  await nav(bala.page, 'Order');
  await bala.page.getByRole('button', { name: /^Scan UPI QR/ }).click();
  await bala.page.getByText(/Sent to .* to approve\./).waitFor({ timeout: 20000 });
  await dialog(anu.page).getByRole('button', { name: 'No, not mine' }).click({ timeout: 15000 });
  await dialog(anu.page).waitFor({ state: 'detached' });
  await anu.page.getByRole('button', { name: 'Review' }).waitFor({ state: 'detached' });
  await menu(anu.page, 'Settings');
  assert.equal(await anu.page.getByLabel('UPI ID').inputValue(), '');
});

test('a QR that is not a UPI person code is refused', async () => {
  const anu = await device(bad), bala = await device(bad);
  await anu.page.goto(bad.url); await button(anu.page, 'Create').click(); await anu.page.locator('.room-plate').waitFor();
  await anu.page.waitForFunction(() => !document.querySelector('.banner.warning'), null, { timeout: 15000 });
  const room = await anu.page.locator('.plate-letters').textContent();
  await bala.page.goto(`${bad.url}/?room=${room}`); await nav2(bala.page).waitFor({ timeout: 20000 });
  await nav(bala.page, 'Order');
  await bala.page.getByRole('button', { name: /^Scan UPI QR/ }).click();
  await bala.page.locator('.toast', { hasText: 'That is not a UPI QR code for a person.' }).waitFor({ timeout: 20000 });
});

test('scan a room QR: a Chaikadi link joins; a foreign link does not', async () => {
  const ok = await device(join);
  await ok.page.goto(join.url); await button(ok.page, 'Join').click();
  await ok.page.getByRole('button', { name: /^Scan QR/ }).click();
  await ok.page.getByText(/Can’t reach ABCD/).waitFor({ timeout: 25000 });

  const foreign = await device(bad);
  await foreign.page.goto(bad.url); await button(foreign.page, 'Join').click();
  await foreign.page.getByRole('button', { name: /^Scan QR/ }).click();
  await foreign.page.getByText('Not a Chaikadi link.').first().waitFor({ timeout: 20000 });
});

test('camera refused: the scanner explains and offers the typed code', async () => {
  const denied = await good.device({ permissions: [] }), page = await denied.newPage();
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })); });
  await page.goto(good.url); await button(page, 'Join').click();
  await page.getByRole('button', { name: /^Scan QR/ }).click();
  await page.getByText('Camera permission denied. Allow it in browser settings, or paste the text.').first().waitFor();
});

test('chai: supporter sheet, tiers pay by UPI link and fill the card, custom treats, Don’t ask again', async () => {
  const { page } = await device(good);
  await page.goto(good.url); await button(page, 'Create').click(); await page.locator('.room-plate').waitFor();
  await menu(page, 'Settings');
  await page.getByRole('button', { name: 'Buy a chai' }).click();
  const sheet = dialog(page);
  await sheet.getByText('Your Chaikadi card is empty. Your first chai makes you a Chai Friend.').waitFor();
  assert.match(await sheet.getByRole('link', { name: /^A chai · ₹10/ }).getAttribute('href'), /^upi:\/\/pay\?pa=.+&am=10\.00&cu=INR/);
  await sheet.getByLabel('Or treat me to something else').fill('Biriyani 300');
  const treat = sheet.getByRole('link', { name: /Biriyani · ₹300/ });
  assert.match(await treat.getAttribute('href'), /am=300\.00/);
  // stop the real navigation to upi:// and just record the click
  await page.evaluate(() => document.addEventListener('click', e => { if (e.target.closest('a[href^="upi:"]')) e.preventDefault(); }, true));
  await sheet.getByRole('link', { name: /^A chai · ₹10/ }).click();
  await sheet.waitFor({ state: 'detached' });
  await page.getByText(/Your Chaikadi card:/).waitFor();
  await page.getByText(/Chai Friend · 1 cup/).waitFor();
  await page.getByLabel('Remind me now and then about buying a chai').uncheck();
  await page.reload(); await page.waitForSelector('.app-shell');
  await menu(page, 'Settings');
  assert.equal(await page.getByLabel('Remind me now and then about buying a chai').isChecked(), false, 'the choice is remembered');
  await page.getByRole('button', { name: 'Buy a chai' }).click();
  await dialog(page).getByRole('button', { name: /Copy UPI ID/ }).click();
  await page.locator('.toast', { hasText: 'UPI ID copied.' }).waitFor();
});
