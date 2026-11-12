// Developer tool: capture the real app's screens for the FigCraft design file.
// Drives the app through its main flows (host + one manually paired guest),
// saves 390×844 screenshots (2× pixels) and the bounds of every control that
// leads to another screen, so prototype hotspots match the app exactly.
//   python3 tools/serve.py   # in another terminal
//   PLAYWRIGHT_MODULE=… node tools/capture-screens.mjs
// Output: design/screens/*.png and design/screens/screens.json
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_URL || 'http://127.0.0.1:8080';
const out = new URL('../design/screens/', import.meta.url).pathname;
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const W = 390, H = 844;
const browser = await chromium.launch();
const screens = [];
let cur = null;

const ctx = () => browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce' });
const hostCtx = await ctx(), guestCtx = await ctx();
const page = await hostCtx.newPage(), guest = await guestCtx.newPage();
const errors = [];
for (const p of [page, guest]) p.on('pageerror', e => errors.push(e.message));

async function settle(p = page) {
  await p.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 8000 }).catch(() => {});
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(450);
}
async function shot(id, name, flow, p = page) {
  await settle(p);
  const file = `${id}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}.png`;
  await p.screenshot({ path: join(out, file) });
  cur = { id, name, flow, file, hotspots: [] };
  screens.push(cur);
  console.log(`${id} ${name}`);
}
async function hot(label, locator, to) {
  const box = await locator.first().boundingBox().catch(() => null);
  if (!box || box.width < 1 || box.y < 0 || box.y + box.height > H + 1) return;
  cur.hotspots.push({ label, to, x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) });
}
const tab = (label, p = page) => p.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: label, exact: true });
const btn = (name, p = page) => p.getByRole('button', { name, exact: true });
const dialog = (p = page) => p.getByRole('dialog');
async function appMenu(item) { await btn('Open app menu').click(); await page.locator('.app-menu').getByRole('button', { name: item, exact: true }).click(); }

try {
  await Promise.all([page.goto(base), guest.goto(base)]);
  await page.getByText('Offline app ready', { exact: true }).waitFor();
  await guest.getByText('Offline app ready', { exact: true }).waitFor();
  // Library data from the local fixture (same files the data host serves).
  await appMenu('Settings');
  await page.getByLabel('Menu library address', { exact: true }).fill(`${base}/tests/fixtures/data`);
  await btn('Save address').click();
  await page.goto(base);

  // ---- 1. Start and join ------------------------------------------------
  await shot('01', 'Home', 'Start and join');
  await hot('Create a group', btn('Create a group'), '04');
  await hot('Join with a code', btn('Join with a code'), '03');
  await hot('Group and display names', page.getByText('Group and display names', { exact: true }), '02');
  await page.getByText('Group and display names', { exact: true }).click();
  await page.getByLabel('Group name', { exact: true }).fill('The 4 PM crew');
  await page.getByLabel('Your name', { exact: true }).fill('Anu');
  await shot('02', 'Home names', 'Start and join');
  await hot('Create a group', btn('Create a group'), '04');
  await hot('Join with a code', btn('Join with a code'), '03');

  await guest.getByRole('button', { name: 'Join with a code', exact: true }).click();
  await guest.getByLabel('Your name', { exact: true }).fill('Bala');
  await shot('03', 'Join with a code', 'Start and join', guest);
  await hot('Back', btn('Back', guest), '01');

  await btn('Create a group').click();
  await page.locator('.room-plate').waitFor();
  await page.getByText('Note: the room code is not ready. Retry or pair without internet.', { exact: true }).waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  // Pair the guest locally (no signaling needed).
  await guest.getByRole('button', { name: 'Pair without internet', exact: true }).click();
  await btn('Pair without internet').last().click();
  await dialog().getByRole('button', { name: 'Create offer', exact: true }).click();
  await dialog().getByLabel('Pairing text', { exact: true }).waitFor();
  await shot('22', 'Pair without internet', 'More');
  await hot('Close', dialog().getByRole('button', { name: 'Close', exact: true }), '04');
  await dialog(guest).getByLabel('Paste offer', { exact: true }).fill(await dialog().getByLabel('Pairing text', { exact: true }).inputValue());
  await dialog(guest).getByRole('button', { name: 'Create answer', exact: true }).click();
  await dialog(guest).getByLabel('Pairing text', { exact: true }).waitFor();
  await dialog().getByLabel('Paste answer', { exact: true }).fill(await dialog(guest).getByLabel('Pairing text', { exact: true }).inputValue());
  await dialog().getByRole('button', { name: 'Connect person', exact: true }).click();
  await dialog(guest).getByText('Connected. You can close this panel.', { exact: true }).waitFor({ timeout: 30000 });
  await dialog().getByRole('button', { name: 'Close', exact: true }).click();
  await dialog(guest).getByRole('button', { name: 'Close', exact: true }).click();

  await page.waitForFunction(() => document.querySelectorAll('.people > li').length === 2);
  await page.evaluate(() => scrollTo(0, 0));
  await shot('04', 'Group', 'Start and join');
  await hot('Show QR', btn('Show QR'), '05');
  await hot('Open app menu', btn('Open app menu'), '24');
  await hot('Menu tab', tab('Menu'), '06');
  await btn('Show QR').click();
  await page.locator('.qr canvas').waitFor();
  await page.locator('.qr').scrollIntoViewIfNeeded();
  await shot('05', 'Group QR', 'Start and join');
  await hot('Hide QR', btn('Hide QR'), '04');
  await hot('Menu tab', tab('Menu'), '06');
  await page.evaluate(() => scrollTo(0, 0));

  // ---- 2. Menus and library ---------------------------------------------
  await tab('Menu').click();
  await shot('06', 'Menu empty', 'Menus and library');
  await hot('Snap a menu', btn('Snap a menu'), '12');
  await hot('Add item', btn('Add item'), '11');
  await hot('Pick from library', btn('Pick from library'), '07');
  await hot('My picks tab', tab('My picks'), '13');
  await btn('Pick from library').click();
  await dialog().locator('.library-result').nth(2).waitFor();
  await shot('07', 'Library', 'Menus and library');
  await hot('Sample Chai Corner', dialog().locator('.library-result').first(), '08');
  await hot('Close', dialog().getByRole('button', { name: 'Close', exact: true }), '06');
  await dialog().locator('.library-result').first().click();
  await dialog().getByRole('button', { name: 'Use this menu', exact: true }).waitFor();
  await shot('08', 'Library preview', 'Menus and library');
  await hot('Use this menu', dialog().getByRole('button', { name: 'Use this menu', exact: true }), '09');
  await hot('Back to results', dialog().getByRole('button', { name: 'Back to results', exact: true }), '07');
  await dialog().getByRole('button', { name: 'Use this menu', exact: true }).click();
  await page.getByRole('heading', { name: 'Sample Chai Corner, Kaloor', exact: true }).waitFor();
  await shot('09', 'Menu', 'Menus and library');
  await hot('Edit items', btn('Edit items'), '10');
  await hot('Snap a menu', btn('Snap a menu'), '12');
  await hot('Add item', btn('Add item'), '11');
  await hot('Pick from library', btn('Pick from library'), '07');
  await hot('My picks tab', tab('My picks'), '13');
  await btn('Edit items').click();
  await shot('10', 'Menu edit', 'Menus and library');
  await hot('Done', btn('Done'), '09');
  await hot('Edit Chai', page.locator('.item-list li').first().getByRole('button', { name: 'Edit', exact: true }), '11');
  await btn('Done').click();
  await btn('Add item').click();
  await dialog().getByLabel('Item name', { exact: true }).fill('Kattan Chai');
  await dialog().getByLabel('Price (Rs)', { exact: true }).fill('10');
  await shot('11', 'Add item', 'Menus and library');
  await hot('Save', dialog().getByRole('button', { name: 'Save', exact: true }), '09');
  await hot('Close', dialog().getByRole('button', { name: 'Close', exact: true }), '09');
  await page.keyboard.press('Escape');
  await btn('Snap a menu').click();
  await dialog().getByText('Take photo').waitFor();
  await shot('12', 'Snap a menu', 'Menus and library');
  await hot('Close', dialog().getByRole('button', { name: 'Close', exact: true }), '09');
  await page.keyboard.press('Escape');

  // ---- 3. Picking ---------------------------------------------------------
  await tab('My picks', guest).click();
  await guest.getByRole('button', { name: 'Add one Masala Chai', exact: true }).click();
  await guest.getByRole('button', { name: 'Add one Egg Puffs', exact: true }).click();
  await tab('My picks').click();
  await btn('Add a note for Chai').click();
  await dialog().getByLabel('Item note', { exact: true }).fill('Less sugar');
  await shot('14', 'Item note', 'Picking');
  await hot('Save note', dialog().getByRole('button', { name: 'Save note', exact: true }), '13');
  await hot('Close', dialog().getByRole('button', { name: 'Close', exact: true }), '13');
  await dialog().getByRole('button', { name: 'Save note', exact: true }).click();
  await btn('Add one Pazham Pori').click();
  await btn('Add one Pazham Pori').click();
  await page.getByLabel('Pazham Pori, quantity 2', { exact: true }).waitFor();
  await page.evaluate(() => scrollTo(0, 0));
  await shot('13', 'My picks', 'Picking');
  await hot('Can’t decide?', btn('Can’t decide?'), '15');
  await hot('Chai (note)', btn('Add a note for Chai'), '14');
  await hot('Order tab', tab('Order'), '16');
  await btn('Can’t decide?').click();
  await dialog().locator('.shuffle-result:not(.striking)').waitFor();
  await page.waitForTimeout(600);
  await shot('15', 'Can’t decide', 'Picking');
  await hot('Add to my picks', dialog().getByRole('button', { name: 'Add to my picks', exact: true }), '13');
  await hot('Close', dialog().getByRole('button', { name: 'Close', exact: true }), '13');
  await page.keyboard.press('Escape');

  // ---- 4. Order and bill ----------------------------------------------------
  await tab('Order').click();
  await btn('Lock order').evaluate(el => el.scrollIntoView({ block: 'center' }));
  await shot('16', 'Order', 'Order and bill');
  await hot('Lock order', btn('Lock order'), '17');
  await hot('Costs tab', tab('Costs'), '18');
  await hot('Copy order as text', btn('Copy order as text'), '16');
  await btn('Lock order').click();
  await page.getByRole('dialog', { name: 'Order locked.' }).waitFor();
  await page.waitForTimeout(1200);
  await shot('17', 'Order locked', 'Order and bill');
  await hot('Done', dialog().getByRole('button', { name: 'Done', exact: true }), '18');
  await dialog().getByRole('button', { name: 'Done', exact: true }).click();
  await tab('Costs').click();
  await page.getByLabel('Bill total (Rs)', { exact: true }).fill('90');
  await btn('Save actual bill').click();
  await page.locator('.cost-people').getByText('Rs 46', { exact: true }).waitFor();
  await btn('Finish round').evaluate(el => el.scrollIntoView({ block: 'center' }));
  await shot('18', 'Costs', 'Order and bill');
  await hot('Finish round', btn('Finish round'), '19');
  await hot('Order tab', tab('Order'), '16');
  await btn('Finish round').click();
  await shot('19', 'Finish round', 'Order and bill');
  await hot('Keep', dialog().getByRole('button', { name: 'Keep', exact: true }), '18');
  await hot('Finish round', dialog().getByRole('button', { name: 'Finish round', exact: true }), '20');
  await dialog().getByRole('button', { name: 'Finish round', exact: true }).click();
  await appMenu('History');
  await page.locator('.history-round summary').first().click();
  await shot('20', 'History', 'Order and bill');
  await hot('Open app menu', btn('Open app menu'), '24');
  await hot('Menu tab', tab('Menu'), '09');

  // ---- 5. More --------------------------------------------------------------
  await btn('Open app menu').click();
  await shot('24', 'App menu', 'More');
  for (const [label, to] of [['Group', '04'], ['History', '20'], ['Settings', '21'], ['Pair without internet', '22']]) {
    await hot(label, page.locator('.app-menu').getByRole('button', { name: label, exact: true }), to);
  }
  await page.locator('.app-menu').getByRole('button', { name: 'Settings', exact: true }).click();
  await shot('21', 'Settings', 'More');
  await hot('Open app menu', btn('Open app menu'), '24');
  await hot('Menu tab', tab('Menu'), '09');
  await page.getByLabel('Theme').selectOption('dark');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await tab('Menu').click();
  await shot('23', 'Menu dark', 'More');
  await hot('My picks tab', tab('My picks'), '13');
  await appMenu('Settings');
  await page.getByLabel('Theme').selectOption('auto');

  screens.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(join(out, 'screens.json'), `${JSON.stringify({ app: 'chaikadi.fyi', viewport: { width: W, height: H, scale: 2 }, capturedAt: new Date().toISOString(), screens }, null, 2)}\n`);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`${screens.length} screens, ${screens.reduce((n, s) => n + s.hotspots.length, 0)} hotspots → design/screens/`);
} finally { await browser.close(); }
