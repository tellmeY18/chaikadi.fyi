// Real-browser checks for multi-menu use, theme persistence, form sheets,
// pasted room codes, and narrow-screen / 200% text layouts.
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch();
const base = process.env.TEST_URL || 'http://127.0.0.1:8080';
const directory = process.env.SCREENSHOT_DIR || tmpdir();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base); await page.getByText('Offline app ready', { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(directory, 'chaikadi-home-v02.png'), fullPage: true });
  await page.getByText('Group and display names', { exact: true }).click();
  assert.ok((await page.getByLabel('Your name', { exact: true }).inputValue()).length > 0);
  await page.getByLabel('Group name', { exact: true }).fill('The 4 PM crew');
  await page.getByLabel('Your name', { exact: true }).fill('Anu');
  await page.getByRole('button', { name: 'Pair without internet', exact: true }).click();
  await page.locator('.room-plate').waitFor();
  await page.screenshot({ path: join(directory, 'chaikadi-group-v02.png'), fullPage: true });
  assert.equal(await page.locator('.bottom-nav > button').count(), 4);
  const nav = label => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: label, exact: true }).click();
  await nav('Menu'); assert.equal(await page.locator('.item-list li').count(), 0);
  async function createMenu(name, item, price) {
    await page.getByRole('button', { name: 'New menu', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Menu name', { exact: true }).fill(name);
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Add item', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Item name', { exact: true }).fill(item);
    await page.getByRole('dialog').getByLabel('Price (Rs)', { exact: true }).fill(price);
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  await createMenu('Raju Chai Kada', 'Masala chai', '20');
  await nav('My picks'); await page.getByRole('button', { name: 'Add one Masala chai', exact: true }).click();
  await page.getByLabel('Masala chai, quantity 1', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add a note for Masala chai', exact: true }).click();
  await page.getByLabel('Item note', { exact: true }).fill('less sugar');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await page.getByText('less sugar', { exact: true }).waitFor();
  await page.screenshot({ path: join(directory, 'chaikadi-picks-v02.png'), fullPage: true });
  await nav('Menu'); await createMenu('Lunch place', 'Veg biryani', '120');
  await page.getByRole('button', { name: 'Use for this round', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Keep', exact: true }).click();
  await nav('My picks'); assert.ok(await page.getByLabel('Masala chai, quantity 1', { exact: true }).isVisible());
  await nav('Menu'); await page.getByRole('button', { name: 'Use for this round', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Use for this round', exact: true }).click();
  await nav('My picks'); await page.getByRole('button', { name: 'Add one Veg biryani', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Add one Masala chai', exact: true }).count(), 0);
  assert.equal(await page.locator('.pick-row.selected').count(), 0);
  await page.getByRole('button', { name: 'Can’t decide?', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add to my picks', exact: true }).click();
  await page.getByLabel('Veg biryani, quantity 1', { exact: true }).waitFor();
  async function settings() {
    await page.getByRole('button', { name: 'Open app menu', exact: true }).click();
    await page.locator('.app-menu').getByRole('button', { name: 'Settings', exact: true }).click();
  }
  await settings(); await page.getByLabel('Theme').selectOption('dark');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await nav('My picks'); await page.getByLabel('Veg biryani, quantity 1', { exact: true }).waitFor();
  await page.screenshot({ path: join(directory, 'chaikadi-dark-v02.png'), fullPage: true });
  await settings(); await page.getByLabel('Theme').selectOption('light');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.setViewportSize({ width: 320, height: 844 });
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  for (const tab of ['Menu', 'My picks', 'Order', 'Costs']) {
    await nav(tab);
    const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => `${el.tagName}.${el.className}: ${el.getBoundingClientRect().right}`).slice(0, 15));
    if (overflow.length) console.log(tab, overflow);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${tab}: overflow at 320px / 200% text`);
  }
  await page.evaluate(() => document.documentElement.style.fontSize = '');
  // Four boxes accept a full paste with normal browser keyboard semantics.
  const emptyContext = await browser.newContext(); const joiner = await emptyContext.newPage();
  joiner.on('pageerror', e => errors.push(e.message));
  await joiner.goto(base); await joiner.getByRole('button', { name: 'Join with a code', exact: true }).click();
  const first = joiner.getByLabel('Room code, character 1', { exact: true });
  await first.evaluate(el => { const data = new DataTransfer(); data.setData('text', 'ab2'); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true })); });
  assert.deepEqual(await joiner.locator('.code-boxes input').evaluateAll(inputs => inputs.map(i => i.value)), ['A', 'B', '2', '']);
  await joiner.getByLabel('Room code, character 2', { exact: true }).fill('');
  assert.deepEqual(await joiner.locator('.code-boxes input').evaluateAll(inputs => inputs.map(i => i.value)), ['A', '', '2', '']);
  await emptyContext.close();
  assert.deepEqual(errors, []);
  console.log(`${process.env.BROWSER || 'chromium'}: multi-menu, sheets, shuffle, theme persistence, code paste and 200% text passed.`);
} finally { await browser.close(); }
