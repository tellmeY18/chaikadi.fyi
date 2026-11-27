// First-run tour: shows once, rings real controls, waits for a group, can be skipped and replayed.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, button, menu } from './helpers.mjs';

let app, context, page;
before(async () => {
  app = await start();
  context = await app.device({ tour: true });
  page = await context.newPage();
  await page.goto(app.url); await page.waitForSelector('.app-shell');
});
after(async () => { await app.finish(); assert.deepEqual(app.errors, []); assert.deepEqual(app.blocked, []); });

test('tour: welcome, waits on Home for a group, then follows into the app and finishes once', async () => {
  await page.getByText('Step 1 of 11').waitFor();
  await button(page, 'Next').click();
  await page.getByText('Step 2 of 11').waitFor();
  await page.locator('.tour-spot').waitFor();
  assert.equal(await button(page, 'Next').count(), 0, 'no Next until a group exists');
  await button(page, 'Create').click();
  await page.getByText('Step 3 of 11').waitFor();
  const tour = page.locator('.tour');
  await tour.getByRole('heading', { name: 'The bottom bar' }).waitFor();
  for (const label of ['Menu:', 'My picks:', 'Order:', 'Costs:']) await tour.getByText(label, { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const spot = document.querySelector('.tour-spot'), bar = document.querySelector('.bottom-nav');
    if (!spot || !bar) return false;
    const a = spot.getBoundingClientRect(), b = bar.getBoundingClientRect();
    return a.left <= b.left && a.top <= b.top && a.right >= b.right && a.bottom >= b.bottom;
  });
  for (const n of [4, 5, 6, 7, 8, 9, 10, 11]) { await button(page, 'Next').click(); await page.getByText(`Step ${n} of 11`).waitFor(); }
  await button(page, 'Got it').click();
  await page.locator('.tour-layer').waitFor({ state: 'detached' });
  await page.reload(); await page.waitForSelector('.app-shell');
  assert.equal(await page.locator('.tour-layer').count(), 0, 'never shown again');
});

test('home: how it works is on the page and starts the tour', async () => {
  const fresh = await app.device({ tour: true }), p = await fresh.newPage();
  await p.goto(app.url); await p.waitForSelector('.app-shell');
  await button(p, 'Skip tour').click();
  await p.getByRole('heading', { name: 'How Chaikadi works' }).waitFor();
  await button(p, 'Take the quick tour').click();
  await p.getByText('Step 1 of 11').waitFor();
  await fresh.close();
});

test('tour: replay from Settings, and Skip ends it for good', async () => {
  await menu(page, 'Settings');
  await button(page, 'Show the quick tour again').click();
  await page.getByText('Step 1 of 11').waitFor();
  await button(page, 'Skip tour').click();
  await page.locator('.tour-layer').waitFor({ state: 'detached' });
  await page.reload(); await page.waitForSelector('.app-shell');
  assert.equal(await page.locator('.tour-layer').count(), 0);
});
