// Two windows on the same storage (a browser tab and the installed app share it): the newer one takes
// over and the older one stops, so they never both claim the same room code.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_URL || 'http://127.0.0.1:8080';
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME, args: ['--no-sandbox'] } : {});
try {
  const ctx = await browser.newContext({ viewport: { width: 450, height: 800 }, serviceWorkers: 'block' });
  const a = await ctx.newPage(), b = await ctx.newPage();
  await a.goto(base); await a.getByRole('button', { name: 'Create', exact: true }).click();
  await a.getByRole('button', { name: /Room code/ }).waitFor();
  assert.equal(await a.getByText('Open in another window').count(), 0, 'first window is active');
  await b.goto(base);
  await a.getByText('Open in another window').waitFor({ timeout: 10000 });
  await b.getByRole('button', { name: /Room code/ }).waitFor({ timeout: 10000 });
  assert.equal(await b.getByText('Open in another window').count(), 0, 'newer window is active');
  assert.equal(await a.getByRole('navigation', { name: 'Main navigation' }).count(), 0, 'old window shows no tabs');
  await a.getByRole('button', { name: 'Use this window', exact: true }).click();
  await a.getByRole('button', { name: /Room code/ }).waitFor({ timeout: 10000 });
  await b.getByText('Open in another window').waitFor({ timeout: 10000 });
  console.log('session ok: newest window wins, the other stops, Use this window swaps them');
} finally { await browser.close(); }
