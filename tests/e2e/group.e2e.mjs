// Two phones and a laptop in one group over real WebRTC data channels. Only
// signaling is faked (in-process PeerJS), so no internet is needed.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, nav, menu, button, dialog } from './helpers.mjs';

let app, host, anu, bala, chitra;
const online = (page, n) => page.waitForFunction(count => document.querySelectorAll('.people .presence.online').length === count, n, { timeout: 20000 });
const goto = async (page, path = '') => { await page.goto(app.url + path); await page.waitForSelector('.app-shell'); };
before(async () => {
  app = await start();
  host = await app.device();
  [anu, bala, chitra] = await Promise.all([host.newPage(), (await app.device()).newPage(), (await app.device()).newPage()]);
});
after(async () => { await app.finish(); assert.deepEqual(app.errors, []); assert.deepEqual(app.blocked, [], 'no outside requests'); });

test('host creates, a guest joins with the code, a third joins by invite link', async () => {
  await goto(anu);
  await anu.getByLabel('Your name', { exact: true }).fill('Anu');
  await button(anu, 'Create').click();
  await anu.locator('.room-plate').waitFor();
  await anu.waitForFunction(() => !document.querySelector('.banner.warning'), null, { timeout: 15000 });
  const code = (await anu.locator('.plate-letters').textContent());
  assert.match(code, /^[A-HJ-KM-NP-Z2-9]{4}$/);
  assert.deepEqual(app.signaling.ids, [`chaikadi-${code}`]);

  await goto(bala);
  await button(bala, 'Join').click();
  await bala.getByLabel('Your name', { exact: true }).fill('Bala');
  await bala.locator('.code-boxes input').first().click();
  await bala.keyboard.type(code.toLowerCase());
  await bala.getByRole('navigation', { name: 'Main navigation' }).waitFor({ timeout: 20000 });
  await menu(anu, 'Group'); await online(anu, 2);

  // invite link: joins straight away with the prefilled name, no taps
  await goto(chitra, `/?room=${code}`);
  await chitra.getByRole('navigation', { name: 'Main navigation' }).waitFor({ timeout: 20000 });
  await menu(anu, 'Group'); await online(anu, 3);
  assert.equal(await anu.locator('.people li').count(), 3);
  assert.equal(await anu.locator('.tag', { hasText: 'Host' }).count(), 1);
});

test('names stay unique: taking someone else\'s name is refused with a reason', async () => {
  await menu(bala, 'Settings');
  await bala.getByLabel('Name', { exact: true }).fill('anu');
  await bala.locator('form', { has: bala.getByLabel('UPI ID') }).getByRole('button', { name: 'Save' }).click();
  await bala.getByText('That display name is taken.').first().waitFor({ timeout: 10000 });
  await menu(anu, 'Group');
  assert.equal(await anu.locator('.people strong', { hasText: /^anu/i }).count(), 1, 'only the host holds that name');
});

test('members add menu items and picks; everyone converges, only the host sees host powers', async () => {
  await menu(anu, 'Group'); // host-only controls
  assert.ok(await anu.getByRole('button', { name: /^Edit Bala/ }).count());
  assert.equal(await bala.getByRole('button', { name: /^Edit/ }).count(), 0, 'members cannot manage people');
  await nav(bala, 'Menu');
  await bala.getByRole('button', { name: 'Add', exact: true }).click();
  await dialog(bala).getByRole('button', { name: 'Item', exact: true }).click();
  await dialog(bala).getByLabel('Item name').fill('Chai');
  await dialog(bala).getByLabel('Price (Rs)').fill('10');
  await dialog(bala).getByRole('button', { name: 'Save', exact: true }).click();
  await nav(anu, 'Menu'); await anu.locator('.item-list li', { hasText: 'Chai' }).waitFor();
  await nav(chitra, 'Menu'); await chitra.locator('.item-list li', { hasText: 'Chai' }).waitFor();

  await nav(anu, 'My picks'); await button(anu, 'Add one Chai').click();
  await nav(bala, 'My picks'); await button(bala, 'Add one Chai').click(); await button(bala, 'Add one Chai').click();
  await bala.getByRole('button', { name: 'Add a note for Chai', exact: true }).first().click();
  await dialog(bala).getByLabel('Item note').fill('extra sugar');
  await dialog(bala).getByRole('button', { name: 'Save note' }).click();
  await nav(anu, 'Order');
  await anu.getByText('Chai x 3').waitFor();
  await anu.getByText(/- .*extra sugar/).waitFor();
  // a member can't lock
  await nav(bala, 'Order');
  assert.equal(await bala.getByRole('button', { name: 'Lock', exact: true }).count(), 0);
});

test('host hands the order to Bala, who locks it; everyone sees the lock', async () => {
  await menu(anu, 'Group');
  await anu.getByRole('button', { name: /^Edit Bala/ }).click();
  await dialog(anu).getByRole('button', { name: 'Make orderer' }).click();
  await bala.getByRole('button', { name: 'Lock', exact: true }).waitFor();
  await button(bala, 'Lock').click();
  await dialog(bala).getByRole('button', { name: 'Done', exact: true }).click();
  await nav(anu, 'My picks');
  await anu.getByText('Order locked.', { exact: true }).first().waitFor();
  assert.ok(await button(anu, 'Add one Chai').isDisabled());
  await nav(chitra, 'My picks'); assert.ok(await button(chitra, 'Add one Chai').isDisabled());
});

test('bill, split, payment marks and finish round trip through the host', async () => {
  await nav(bala, 'Costs');
  await bala.getByLabel('Bill total (Rs, optional)').fill('36');
  await button(bala, 'Save bill').click();
  await nav(anu, 'Costs');
  await anu.locator('.r-total', { hasText: 'Rs 36' }).waitFor();
  await bala.getByRole('button', { name: /Anu: not paid/ }).click();
  await anu.locator('.stamp', { hasText: 'PAID' }).waitFor();
  await button(bala, 'Finish').click();
  await dialog(bala).getByRole('button', { name: 'Finish', exact: true }).click();
  await menu(anu, 'History');
  await anu.getByText('All paid.', { exact: true }).waitFor();
  await menu(chitra, 'History');
  await chitra.getByRole('heading', { name: 'History' }).waitFor();
  await chitra.getByText('Orderer: Bala').first().waitFor();
});

test('host removes a person; the removed phone keeps its history and is told', async () => {
  await menu(anu, 'Group');
  await anu.getByRole('button', { name: /^Edit (?!Bala)/ }).first().click();
  await dialog(anu).getByRole('button', { name: /^Remove/ }).click();
  await dialog(anu).getByRole('button', { name: /^Remove/ }).last().click();
  await chitra.getByText(/host removed you from this group/i).waitFor({ timeout: 15000 });
});

test('host goes offline: a member keeps working and everything syncs on return', async () => {
  await anu.close();
  await bala.getByText(/Host offline/).first().waitFor({ timeout: 30000 });
  await nav(bala, 'My picks');
  await button(bala, 'Add one Chai').click();
  await bala.getByLabel('Chai, quantity 1', { exact: true }).waitFor();
  await bala.context().setOffline(true); await bala.reload(); await bala.waitForSelector('.app-shell');
  await nav(bala, 'My picks');
  assert.equal(await bala.getByLabel('Chai, quantity 1', { exact: true }).textContent(), '1');
  await bala.context().setOffline(false);
  anu = await host.newPage(); await goto(anu);
  await anu.locator('.section-heading h1').waitFor();
  await online(anu, 2).catch(async () => { await menu(anu, 'Group'); await online(anu, 2); });
  await nav(anu, 'Order'); await anu.getByText('Chai x 1').waitFor({ timeout: 20000 });
});
