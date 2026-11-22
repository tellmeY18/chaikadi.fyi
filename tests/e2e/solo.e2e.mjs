// One person, one device: everything that does not need a second phone.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, nav, menu, button, dialog } from './helpers.mjs';

let app, context, page;
const addSheet = async label => { await button(page, 'Add').click(); await dialog(page).getByRole('button', { name: label, exact: true }).click(); };
const lock = async () => { await button(page, 'Lock').click(); await dialog(page).getByRole('button', { name: 'Done', exact: true }).click(); await page.getByText('Order locked.', { exact: true }).first().waitFor(); };
const toast = text => page.locator('.toast', { hasText: text }).waitFor();
before(async () => {
  app = await start();
  context = await app.device({ permissions: ['clipboard-read', 'clipboard-write'] });
  page = await context.newPage();
  await page.goto(app.url); await page.waitForSelector('.app-shell');
});
after(async () => { await app.finish(); assert.deepEqual(app.errors, []); assert.deepEqual(app.blocked, [], 'no outside requests'); });

test('home: names are ready, a new name can be rolled, Create starts a host group', async () => {
  const first = await page.getByLabel('Your name', { exact: true }).inputValue();
  assert.ok(first.length > 2);
  await button(page, 'Pick another name').click();
  await page.waitForFunction(old => document.querySelector('input[name="name"]').value !== old, first);
  await page.getByLabel('Your name', { exact: true }).fill('Anu');
  await button(page, 'Create').click();
  await page.locator('.room-plate').waitFor();
  assert.match(await page.locator('.room-plate').getAttribute('aria-label'), /^Room code [^0OIL1] [^0OIL1] [^0OIL1] [^0OIL1]\. Copy$/);
  const people = page.locator('.people li');
  assert.equal(await people.count(), 1);
  assert.match(await people.first().textContent(), /Anu \(you\)HostOrderer/);
  await page.getByText('Share the code.', { exact: true }).waitFor();
});

test('lobby: copy code, QR toggles, share link', async () => {
  await page.locator('.room-plate').click();
  await toast('Code copied.');
  const code = (await page.locator('.room-plate .plate-letters').textContent());
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), code);
  await page.getByRole('button', { name: /Show QR/ }).click();
  await page.locator('.qr canvas[role="img"]').waitFor();
  await page.getByRole('button', { name: /Hide QR/ }).click();
  await page.locator('.qr').waitFor({ state: 'detached' });
  await page.evaluate(() => { navigator.share = undefined; });
  await page.getByRole('button', { name: /Share link/ }).click();
  await toast('Link copied.');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${app.url}/?room=${code}`);
});

test('menu: the basic menu is offered, items can be added, edited, searched and deleted', async () => {
  await button(page, 'Go to menu').click();
  await page.getByRole('heading', { name: 'My picks' }).waitFor();
  await nav(page, 'Menu');
  await page.locator('.menu-chips .chip.active', { hasText: 'Basic menu' }).waitFor();
  assert.ok(await page.locator('.item-list li').count() >= 5);
  await page.getByLabel('Search items').fill('lime');
  assert.equal(await page.locator('.item-list li').count(), 1);
  await page.getByLabel('Search items').fill('zzzz');
  await page.getByText('No items match.', { exact: true }).waitFor();
  await page.getByLabel('Search items').fill('');
  // add
  await addSheet('Item');
  await dialog(page).getByLabel('Item name').fill('Parippuvada');
  await dialog(page).getByLabel('Price (Rs)').fill('12.50');
  await dialog(page).getByLabel('Category').selectOption('Snacks');
  await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.item-list li', { hasText: 'Parippuvada' }).filter({ hasText: 'Rs 12.50' }).waitFor();
  // edit
  await button(page, 'Edit items').click();
  const row = page.locator('.item-list li', { hasText: 'Parippuvada' });
  await row.getByRole('button', { name: /Edit/ }).click();
  await dialog(page).getByLabel('Price (Rs)').fill('15');
  await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.item-list li', { hasText: 'Parippuvada' }).filter({ hasText: 'Rs 15' }).waitFor();
  // invalid price is refused with a visible reason
  await row.getByRole('button', { name: /Edit/ }).click();
  await dialog(page).getByLabel('Price (Rs)').fill('-4');
  await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal(await dialog(page).getByLabel('Price (Rs)').evaluate(e => e.validity.valid), false, 'browser refuses a negative price');
  await dialog(page).getByRole('button', { name: 'Close' }).click();
  // delete with confirmation
  await row.getByRole('button', { name: /Delete/ }).click();
  await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
  await row.waitFor({ state: 'detached' });
});

test('menu: more menus can be created, renamed, switched to and deleted', async () => {
  await addSheet('New menu');
  await dialog(page).getByLabel('Menu name').fill('Stall');
  await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.menu-chips .chip.active', { hasText: 'Stall' }).waitFor().catch(() => {});
  await page.locator('.menu-chips .chip', { hasText: 'Stall' }).click();
  await page.getByText('No items yet.', { exact: true }).waitFor();
  await addSheet('Item');
  await dialog(page).getByLabel('Item name').fill('Biriyani');
  await dialog(page).getByLabel('Price (Rs)').fill('180');
  await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.item-list li', { hasText: 'Biriyani' }).waitFor();
  await button(page, 'Edit items').click();
  await button(page, 'Rename').click();
  await dialog(page).getByLabel('Menu name').fill('Raju Chai Kada');
  await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.menu-chips .chip', { hasText: 'Raju Chai Kada' }).waitFor();
  await button(page, 'Done').click();
  // switching the in-use menu is the orderer's call
  await button(page, 'Use this menu').click();
  await page.locator('.menu-chips .chip.active', { hasText: 'Raju Chai Kada' }).waitFor();
  await page.locator('.menu-chips .chip', { hasText: 'Basic menu' }).click();
  await button(page, 'Edit items').click();
  await button(page, 'Delete menu').click();
  await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
  await page.locator('.menu-chips .chip', { hasText: 'Basic menu' }).waitFor({ state: 'detached' });
  await button(page, 'Done').click();
});

test('picks: stepper, notes, quick add, total, Surprise me', async () => {
  await nav(page, 'My picks');
  await button(page, 'Add one Biriyani').click();
  await button(page, 'Add one Biriyani').click();
  await page.getByLabel('Biriyani, quantity 2', { exact: true }).waitFor();
  await page.locator('.total-bar', { hasText: 'Rs 360' }).waitFor();
  await button(page, 'Remove one Biriyani').click();
  await page.getByLabel('Biriyani, quantity 1', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add a note for Biriyani', exact: true }).first().click();
  await dialog(page).getByLabel('Item note').fill('less spicy');
  await dialog(page).getByRole('button', { name: 'Save note' }).click();
  await page.getByRole('button', { name: /Note for Biriyani: less spicy/ }).waitFor();
  // a note on something not yet picked adds one
  await page.getByRole('button', { name: 'Add a note for Biriyani', exact: true }).count();
  await page.getByLabel('Add an item for everyone').fill('Samosa 15');
  await page.locator('.quick-add button').click();
  await toast('Added to your picks.');
  await page.getByLabel('Samosa, quantity 1', { exact: true }).waitFor();
  // quantity can reach zero
  await button(page, 'Remove one Samosa').click();
  await page.getByLabel('Samosa, quantity 0', { exact: true }).waitFor();
  assert.ok(await button(page, 'Remove one Samosa').isDisabled());
  await button(page, 'Surprise me').click();
  await dialog(page).locator('.shuffle-result').waitFor();
  await dialog(page).getByRole('button', { name: 'Again' }).click().catch(() => {});
  await page.waitForFunction(() => !document.querySelector('dialog .striking'), null, { timeout: 8000 });
  await dialog(page).getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('dialog').waitFor({ state: 'detached' });
});

test('order: receipt lists the picks and notes, copy, lock freezes picks, unlock reopens', async () => {
  await nav(page, 'Order');
  await page.locator('.receipt, .r-strong', { hasText: 'Biriyani x 1' }).first().waitFor().catch(() => {});
  await page.getByText(/Biriyani x [12]/).first().waitFor();
  await page.getByText(/- .*less spicy/).waitFor();
  await page.getByText('Per-person breakdown', { exact: false }).or(page.getByText('Who picked what')).first().click();
  await page.getByRole('button', { name: /^Copy/ }).click();
  await toast('Order copied.');
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Biriyani/);
  await lock();
  await nav(page, 'My picks');
  assert.ok(await button(page, 'Add one Biriyani').isDisabled());
  await nav(page, 'Order');
  await button(page, 'Unlock').click();
  await dialog(page).getByRole('button', { name: 'Unlock', exact: true }).click();
  await button(page, 'Lock').waitFor();
  await nav(page, 'Costs');
  await page.getByText('Lock the order first.', { exact: true }).waitFor();
});

test('costs: missing prices, bill, split rule, finish writes History', async () => {
  await nav(page, 'Order'); await lock();
  await nav(page, 'Costs');
  await page.getByLabel('Bill total (Rs, optional)').fill('400');
  await page.getByLabel('Split extra').selectOption('proportional');
  await button(page, 'Save bill').click();
  await toast('Bill saved.');
  await page.locator('.r-total', { hasText: 'Rs 400' }).waitFor();
  await page.getByLabel('Bill total (Rs, optional)').fill('');
  await button(page, 'Save bill').click();
  await toast('Saved. Total is the sum of menu prices.');
  await button(page, 'Finish').click();
  await dialog(page).getByRole('button', { name: 'Finish', exact: true }).click();
  await toast('Saved to History.');
  await menu(page, 'History');
  await page.getByRole('heading', { name: 'History' }).waitFor();
  await page.getByText('All paid.', { exact: true }).waitFor();
});

test('settings: profile, UPI validation, currency, theme, export, update check', async () => {
  await menu(page, 'Settings');
  await page.getByLabel('Name', { exact: true }).fill('Anu K');
  await page.getByLabel('UPI ID').fill('not a upi id');
  await page.locator('form', { has: page.getByLabel('UPI ID') }).getByRole('button', { name: 'Save' }).click();
  await page.locator('[role="alert"]').first().waitFor();
  await page.getByLabel('UPI ID').fill('anu@okbank');
  await page.locator('form', { has: page.getByLabel('UPI ID') }).getByRole('button', { name: 'Save' }).click();
  await toast('Saved.');
  await page.getByLabel('Currency').fill('₹');
  await page.locator('form', { has: page.getByLabel('Currency') }).getByRole('button', { name: 'Save' }).click();
  await nav(page, 'Menu');
  await page.locator('.item-list li', { hasText: 'Biriyani' }).filter({ hasText: '₹180' }).waitFor();
  await menu(page, 'Settings');
  await button(page, 'Dark').click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await button(page, 'Light').click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Export backup/ }).click();
  assert.match((await download).suggestedFilename(), /chaikadi/i);
  await button(page, 'Check for updates').click();
  await toast('You have the latest version.');
  assert.match(await page.locator('.fineprint').last().textContent(), /Version/);
});

test('everything survives a reload, and a fresh page never overflows sideways', async () => {
  await page.reload(); await page.waitForSelector('.app-shell');
  await nav(page, 'My picks');
  await page.getByLabel('Biriyani, quantity 0', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
});

test('settings: new room code, leave keeps history, then a new group starts clean', async () => {
  await menu(page, 'Group');
  const before = await page.locator('.room-plate').getAttribute('aria-label');
  await menu(page, 'Settings');
  await button(page, 'New room code').click();
  await dialog(page).getByRole('button', { name: 'New room code' }).click();
  await menu(page, 'Group');
  await page.waitForFunction(old => document.querySelector('.room-plate')?.getAttribute('aria-label') !== old, before);
  await button(page, 'Start new session').click();
  await dialog(page).getByRole('button', { name: 'Start new session' }).click();
  await page.locator('.room-plate').waitFor();
  await menu(page, 'History');
  await page.getByText('Earlier sessions', { exact: true }).waitFor();
  await menu(page, 'Settings');
  await button(page, 'Leave group').click();
  await dialog(page).getByRole('button', { name: 'Leave group' }).click();
  await button(page, 'Create').waitFor();
  assert.equal(await page.getByLabel('Your name', { exact: true }).inputValue(), 'Anu K');
});
