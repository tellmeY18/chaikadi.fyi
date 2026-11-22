// The launch must look like one continuous screen: OS splash -> app, with no
// flash of unstyled "Opening Chaikadi" text or an empty frame in between.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.mjs';

let app;
before(async () => { app = await start(); });
after(async () => { await app.finish(); assert.deepEqual(app.errors, []); assert.deepEqual(app.blocked, [], 'no outside requests'); });

// Records what is on screen every animation frame, from the first one.
const frames = () => {
  window.__frames = [];
  const tick = () => {
    const splash = document.querySelector('.splash img'), shell = document.querySelector('.app-shell');
    const r = splash?.getBoundingClientRect();
    const visibleText = [...document.querySelectorAll('#app h1, #app p')].filter(e => e.getBoundingClientRect().width > 2).map(e => e.textContent).join('|');
    window.__frames.push(shell ? 'app' : splash ? `splash@${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}` : 'blank' + (visibleText ? ':' + visibleText : ''));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const sequence = async page => { const all = await page.evaluate(() => window.__frames); return all.filter((f, i) => f !== all[i - 1]); };

for (const scheme of ['light', 'dark']) {
  test(`${scheme}: splash holds one position then the app appears (no text flash)`, async () => {
    const context = await app.device({ colorScheme: scheme }), page = await context.newPage();
    await page.addInitScript(frames);
    await page.goto(app.url); await page.waitForSelector('.app-shell'); await page.waitForTimeout(250);
    const seen = (await sequence(page)).filter(f => f !== 'blank');
    assert.equal(seen.at(-1), 'app');
    const splashes = seen.filter(f => f.startsWith('splash'));
    assert.ok(splashes.length <= 1, `splash stays in one place: ${splashes}`);
    assert.deepEqual(seen.filter(f => f.includes(':')), [], 'no visible text during launch');
    const [bg, ink] = await page.evaluate(() => [getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).color]);
    assert.notEqual(bg, ink);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), scheme);
    await context.close();
  });
}

test('crawlers and screen readers still get the description and heading', async () => {
  const context = await app.device({ javaScriptEnabled: false }), page = await context.newPage();
  await page.goto(app.url);
  assert.match(await page.locator('#app h1').textContent(), /decide, order, split/i);
  assert.match(await page.locator('noscript').textContent(), /needs JavaScript/);
  await context.close();
});

test('the QR libraries are not loaded at start, only on a pairing screen', async () => {
  const context = await app.device(), page = await context.newPage();
  await page.goto(app.url); await page.waitForSelector('.app-shell');
  assert.equal(await page.evaluate(() => [typeof window.qrcode, typeof window.jsQR]).then(x => x.join()), 'undefined,undefined');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: /Show QR/ }).click();
  await page.locator('canvas[role="img"]').waitFor();
  assert.equal(await page.evaluate(() => typeof window.qrcode), 'function');
  await context.close();
});

test('a second launch works offline from the service worker cache and is just as smooth', async () => {
  const context = await app.device(), page = await context.newPage();
  await page.goto(app.url);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  const again = await context.newPage(); await again.addInitScript(frames);
  await again.goto(app.url); await again.waitForSelector('.app-shell'); await again.waitForTimeout(250);
  const seen = (await sequence(again)).filter(f => f !== 'blank');
  assert.equal(seen.at(-1), 'app'); assert.deepEqual(seen.filter(f => f.includes(':')), []);
  await context.close();
});
