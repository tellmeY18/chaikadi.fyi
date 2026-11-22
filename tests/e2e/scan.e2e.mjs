// Menu scanner: a noisy, slightly rotated menu "photo" goes through the
// on-device OCR (Tesseract WASM), is reviewed and saved; then again offline.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, nav, button, dialog } from './helpers.mjs';

let app, context, page, file;
before(async () => {
  app = await start();
  context = await app.device();
  page = await context.newPage();
  await page.goto(app.url); await page.waitForSelector('.app-shell');
  await button(page, 'Create').click(); await page.locator('.room-plate').waitFor();
  await nav(page, 'Menu');
  const photo = await page.evaluate(async () => {
    // Fixed seed: a regression test must not pose a different OCR problem every run.
    let seed = 0xc0ffee;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const c = document.createElement('canvas'); c.width = 1100; c.height = 900;
    const g = c.getContext('2d');
    g.fillStyle = '#f3ecd9'; g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(80,60,30,${random() * 0.12})`; g.fillRect(random() * 1100, random() * 900, 2, 2); }
    g.translate(550, 450); g.rotate(-0.025); g.translate(-550, -450);
    g.fillStyle = '#2a1d10'; g.font = 'bold 56px Georgia, serif'; g.fillText('RAJU CHAI KADA', 260, 100);
    g.font = '40px Arial, sans-serif';
    [['Masala Chai', '20'], ['Ginger Tea', '15'], ['Filter Coffee', '25'], ['Samosa', '18'], ['Pazham Pori', '15'], ['Egg Puff', '30'], ['Veg Biryani', '120']]
      .forEach(([n, p], i) => { const y = 200 + i * 90; g.fillText(n, 120, y); g.fillText('........', 560, y); g.fillText('₹ ' + p, 820, y); });
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  file = { name: 'menu.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(photo) };
});
after(async () => { await app.finish(); assert.deepEqual(app.errors, []); assert.deepEqual(app.blocked, [], 'the scanner must not call any third-party server'); });

async function scan() {
  await button(page, 'Add').click();
  await dialog(page).getByRole('button', { name: 'Snap a menu', exact: true }).click();
  await dialog(page).locator('label.button', { hasText: 'Choose photo' }).locator('input').setInputFiles(file);
  await dialog(page).getByRole('heading', { name: /^Found \d+ items?$/ }).waitFor({ timeout: 120000 });
  return dialog(page).locator('.scan-list li').evaluateAll(lis => lis.map(li => `${li.querySelector('.scan-name').value}=${li.querySelector('.scan-price').value}`));
}

test('scan: prices are found, edits in review win, and the items land on the menu', { timeout: 180000 }, async () => {
  const rows = await scan();
  // OCR can add a stray character to a name; the price and the name's start must be right.
  for (const [name, price] of [['Masala Chai', 20], ['Ginger Tea', 15], ['Filter Coffee', 25], ['Samosa', 18], ['Egg Puff', 30], ['Veg Biryani', 120]]) assert.ok(rows.some(r => r.startsWith(name) && r.endsWith(`=${price}`)), `missing ${name}=${price} in ${rows}`);
  assert.ok(rows.length <= 9, `too many false positives: ${rows}`);
  const ginger = dialog(page).locator('.scan-list li').filter({ has: page.getByRole('checkbox', { name: 'Include Ginger Tea', exact: true }) });
  await ginger.locator('.scan-price').fill('15.50');
  await dialog(page).getByRole('checkbox', { name: 'Include Egg Puff', exact: true }).uncheck();
  await dialog(page).getByText('Show recognised text').click();
  await dialog(page).getByRole('button', { name: /^Add \d+ items? to menu$/ }).click();
  await page.locator('.toast', { hasText: /Saved to Basic menu: \d+ added/ }).waitFor();
  await page.locator('.item-list li', { hasText: 'Masala Chai' }).getByText('Rs 20', { exact: true }).waitFor();
  await page.locator('.item-list li', { hasText: 'Ginger Tea' }).getByText('Rs 15.50', { exact: true }).waitFor();
  assert.equal(await page.locator('.item-list li', { hasText: 'Egg Puff' }).count(), 0, 'unticked rows are not added');
});

test('scan again, fully offline: it still works and flags prices that will update', { timeout: 180000 }, async () => {
  await context.setOffline(true);
  await page.reload(); await page.waitForSelector('.app-shell');
  await nav(page, 'Menu');
  const rows = await scan();
  assert.ok(rows.includes('Masala Chai=20'));
  await dialog(page).getByText('Already on this menu — price will update').first().waitFor();
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await context.setOffline(false);
});

test('scan: a photo with no prices is explained, not silently empty', { timeout: 120000 }, async () => {
  const blank = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = c.height = 300; c.getContext('2d').fillRect(0, 0, 1, 1); return [...new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer())]; });
  await button(page, 'Add').click();
  await dialog(page).getByRole('button', { name: 'Snap a menu', exact: true }).click();
  await dialog(page).locator('label.button', { hasText: 'Choose photo' }).locator('input').setInputFiles({ name: 'blank.png', mimeType: 'image/png', buffer: Buffer.from(blank) });
  await dialog(page).getByText(/No priced items found|Could not read that photo/).waitFor({ timeout: 110000 });
});
