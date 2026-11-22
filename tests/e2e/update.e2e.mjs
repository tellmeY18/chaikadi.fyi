// A real deploy: serve a temporary copy of the app, change sw.js on disk, then
// check for updates. The new worker waits while the person is active, applies
// itself once they are idle, and the saved group survives the restart.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, ROOT, menu, button } from './helpers.mjs';

let app, dir;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'chaikadi-update-'));
  for (const f of ['index.html', 'styles.css', 'manifest.json', 'sw.js', 'icons', 'brand', 'js', 'vendor']) cpSync(join(ROOT, f), join(dir, f), { recursive: true });
  app = await start({ root: dir });
});
after(async () => { await app.finish(); rmSync(dir, { recursive: true, force: true }); assert.deepEqual(app.errors, []); assert.deepEqual(app.blocked, []); });

const deploy = tag => writeFileSync(join(dir, 'sw.js'), readFileSync(join(dir, 'sw.js'), 'utf8').replace(/chaikadi-shell-[\w-]+/, `chaikadi-shell-${tag}`));
const caches = page => page.evaluate(async () => (await caches.keys()).filter(k => k.startsWith('chaikadi-shell')));

test('update waits while the person is active, applies when idle, and keeps the group', async () => {
  const context = await app.device(), page = await context.newPage();
  await page.clock.install(); await page.clock.resume();
  await page.goto(app.url); await page.waitForSelector('.app-shell');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForSelector('.app-shell'); // a return visit: the page starts under the worker
  await button(page, 'Create').click(); await page.locator('.room-plate').waitFor();
  const group = await page.locator('.section-heading h1').textContent();
  await menu(page, 'Settings');
  await button(page, 'Check for updates').click();
  await page.locator('.toast', { hasText: 'You have the latest version.' }).waitFor();

  deploy('next');
  await page.evaluate(() => { window.__still = true; });
  await page.mouse.click(5, 5); // a tap: the person is active
  await button(page, 'Check for updates').click();
  await button(page, 'Update now').waitFor({ timeout: 20000 });
  assert.equal(await page.evaluate(() => window.__still), true, 'update waits while the person is active');

  // Nobody touches the phone for a while: the app restarts into the new version by itself.
  const reloaded = page.waitForEvent('load', { timeout: 20000 });
  await page.clock.runFor(90 * 1000);
  await reloaded;
  await page.getByRole('heading', { name: group, exact: true }).waitFor();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  assert.deepEqual(await caches(page), ['chaikadi-shell-next'], 'old shell cache removed');
  await context.close();
});

test('"Update now" restarts straight away and the group is still there', async () => {
  const context = await app.device(), page = await context.newPage();
  await page.goto(app.url); await page.waitForSelector('.app-shell');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForSelector('.app-shell'); // a return visit: the page starts under the worker
  await button(page, 'Create').click(); await page.locator('.room-plate').waitFor();
  const group = await page.locator('.section-heading h1').textContent();
  await menu(page, 'Settings');
  deploy('manual');
  await page.mouse.click(5, 5);
  await button(page, 'Check for updates').click();
  await button(page, 'Update now').waitFor({ timeout: 20000 });
  await page.evaluate(() => { window.__still = true; });
  await button(page, 'Update now').click();
  await page.waitForFunction(() => window.__still !== true, null, { timeout: 20000 });
  await page.waitForSelector('.app-shell');
  await page.getByRole('heading', { name: group, exact: true }).waitFor();
  await context.close();
});

test('a broken cached app recovers itself: the page reloads once to fetch the latest version', async () => {
  const context = await app.device({ serviceWorkers: 'block' }), page = await context.newPage();
  await page.clock.install(); await page.clock.resume();
  // main.js never runs (mismatched cached files): chaikadiStarted stays unset.
  await page.route('**/js/main.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.goto(app.url);
  const reloaded = page.waitForEvent('load', { timeout: 20000 });
  await page.clock.runFor(12000);
  await reloaded;
  assert.equal(await page.evaluate(() => sessionStorage.getItem('chaikadi-recovered')), '1', 'only one recovery attempt');
  await context.close();
});
