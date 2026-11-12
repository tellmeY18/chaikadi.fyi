// Optional real-browser test of the menu scanner (Tesseract WASM, on-device).
// Renders a slightly rotated, noisy menu "photo", feeds it to the file input,
// checks the review list, saves, then repeats fully offline.
import assert from 'node:assert/strict';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
const base = process.env.TEST_URL || 'http://127.0.0.1:8080';
const browser = await engine.launch();
const external = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === new URL(base).origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await page.getByText('Offline app ready', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Pair without internet', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Menu', exact: true }).click();

  const photo = await page.evaluate(async () => {
    // Fixed seed: a regression test must not generate a different OCR problem
    // on every run. Physical-photo accuracy is checked in TEST_PLAN.md.
    let seed = 0xc0ffee;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const c = document.createElement('canvas'); c.width = 1100; c.height = 900;
    const g = c.getContext('2d');
    g.fillStyle = '#f3ecd9'; g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(80,60,30,${random() * 0.12})`; g.fillRect(random() * 1100, random() * 900, 2, 2); }
    g.translate(550, 450); g.rotate(-0.025); g.translate(-550, -450);
    g.fillStyle = '#2a1d10'; g.font = 'bold 56px Georgia, serif'; g.fillText('RAJU CHAI KADA', 260, 100);
    g.font = '40px Arial, sans-serif';
    const rows = [['Masala Chai', '20'], ['Ginger Tea', '15'], ['Filter Coffee', '25'], ['Samosa', '18'], ['Pazham Pori', '15'], ['Egg Puff', '30'], ['Veg Biryani', '120']];
    rows.forEach(([n, p], i) => { const y = 200 + i * 90; g.fillText(n, 120, y); g.fillText('........', 560, y); g.fillText('₹ ' + p, 820, y); });
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  const file = { name: 'menu.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(photo) };

  async function scan() {
    const t = Date.now();
    await page.getByRole('button', { name: 'Snap a menu', exact: true }).click();
    await page.locator('label.button', { hasText: 'Choose photo' }).locator('input').setInputFiles(file);
    await page.getByRole('heading', { name: /^Found \d+ items?$/ }).waitFor({ timeout: 120000 });
    const rows = await page.$$eval('.scan-list li', lis => lis.map(li => `${li.querySelector('.scan-name').value}=${li.querySelector('.scan-price').value}`));
    return { rows, ms: Date.now() - t };
  }
  const first = await scan();
  console.log(`online scan ${first.ms} ms:`, first.rows.join(', '));
  for (const expected of ['Masala Chai=20', 'Ginger Tea=15', 'Filter Coffee=25', 'Samosa=18', 'Egg Puff=30', 'Veg Biryani=120']) {
    assert.ok(first.rows.includes(expected), `missing ${expected}`);
  }
  assert.ok(first.rows.length <= 9, 'too many false positives');
  // Review edits are authoritative even when the OCR was correct initially.
  const gingerRow = page.locator('.scan-list li').filter({ has: page.getByRole('checkbox', { name: 'Include Ginger Tea', exact: true }) });
  await gingerRow.locator('.scan-price').fill('15.50');
  await page.getByRole('button', { name: /^Add \d+ items? to menu$/ }).click();
  await page.getByText(/Saved to .+: \d+ added/).waitFor();
  await page.locator('.item-list li', { hasText: 'Masala Chai' }).getByText('Rs 20', { exact: true }).waitFor();
  await page.locator('.item-list li', { hasText: 'Veg Biryani' }).getByText('Rs 120', { exact: true }).waitFor();
  await page.locator('.item-list li', { hasText: 'Ginger Tea' }).getByText('Rs 15.50', { exact: true }).waitFor();

  await context.setOffline(true);
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Menu', exact: true }).click();
  const second = await scan();
  console.log(`offline scan ${second.ms} ms: ${second.rows.length} items`);
  assert.ok(second.rows.includes('Masala Chai=20'));
  assert.ok(await page.getByText('Already on this menu — price will update').first().isVisible());
  assert.deepEqual(errors, []);
  assert.deepEqual(external, [], 'scanner must not call any third-party server');
  console.log(`${process.env.BROWSER || 'chromium'}: menu scan (OCR) online + offline passed.`);
} finally { await browser.close(); }
