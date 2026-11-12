// App update flow, as in a real deploy: serve a temporary copy of the app,
// change sw.js on disk, then "Check for updates" -> banner -> "Update now".
// The new worker must wait for the user, and the saved group must survive.
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
  await page.getByText('Group and display names', { exact: true }).click();
  await page.getByLabel('Group name', { exact: true }).fill('Update test crew');
  await page.getByRole('button', { name: 'Pair without internet', exact: true }).click();
  await page.locator('.room-plate').waitFor();
  await page.getByRole('button', { name: 'Open app menu', exact: true }).click();
  await page.locator('.app-menu').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await page.getByText('You have the latest version.', { exact: true }).waitFor();

  // "Deploy" a new version.
  const sw = readFileSync(join(dir, 'sw.js'), 'utf8');
  writeFileSync(join(dir, 'sw.js'), sw.replace(/chaikadi-shell-v\d+/, 'chaikadi-shell-test-next'));
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await page.getByText('A new version of Chaikadi is ready.', { exact: true }).waitFor({ timeout: 20000 });
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting?.state), 'installed', 'update waits for the user');
  const reloaded = page.waitForEvent('load');
  await page.locator('.update-banner').getByRole('button', { name: 'Update now', exact: true }).click();
  await reloaded;
  await page.getByRole('heading', { name: 'Update test crew', exact: true }).waitFor();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  assert.equal(await page.getByText('A new version of Chaikadi is ready.', { exact: true }).count(), 0);
  assert.deepEqual((await page.evaluate(() => caches.keys())).filter(k => k.startsWith('chaikadi-shell')), ['chaikadi-shell-test-next'], 'old shell cache removed');
  assert.deepEqual(errors, []);
  console.log(`${process.env.BROWSER || 'chromium'}: update waits, Update now activates the new version once, group kept.`);
} finally { await browser.close(); server.kill(); }
