// App update flow, as in a real deploy: serve a temporary copy of the app,
// change sw.js on disk, then "Check for updates". The new worker waits while
// the user is active, then applies itself once idle; the saved group survives.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'chaikadi-update-'));
for (const f of ['index.html', 'styles.css', 'manifest.json', 'sw.js', 'icons', 'fonts', 'js', 'vendor']) cpSync(join(root, f), join(dir, f), { recursive: true });
const port = 8000 + Math.floor(Math.random() * 900) + 100;
const server = spawn('python3', [join(root, 'tools/serve.py'), String(port)], { cwd: dir, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
const browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch();
try {
  for (let i = 0; i < 50; i++) { try { await fetch(base); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base); await page.getByText('Offline app ready', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('.room-plate').waitFor();
  const group = await page.locator('.section-heading h1').textContent();
  await page.getByRole('button', { name: 'Open app menu', exact: true }).click();
  await page.locator('.app-menu').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await page.getByText('You have the latest version.', { exact: true }).waitFor();

  // "Deploy" a new version.
  const sw = readFileSync(join(dir, 'sw.js'), 'utf8');
  writeFileSync(join(dir, 'sw.js'), sw.replace(/chaikadi-shell-v\d+/, 'chaikadi-shell-test-next'));
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await page.getByText('Update ready.', { exact: true }).waitFor({ timeout: 20000 });
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting?.state), 'installed', 'update waits while the user is active');
  // No taps: the app applies the update by itself after about a minute.
  await page.waitForEvent('load', { timeout: 120000 });
  await page.getByRole('heading', { name: group, exact: true }).waitFor();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  assert.deepEqual((await page.evaluate(() => caches.keys())).filter(k => k.startsWith('chaikadi-shell')), ['chaikadi-shell-test-next'], 'old shell cache removed');
  assert.deepEqual(errors, []);
  console.log(`${process.env.BROWSER || 'chromium'}: update waits while active, applies itself when idle, group kept.`);
} finally { await browser.close(); server.kill(); }
