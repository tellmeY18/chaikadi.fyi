// Shared end-to-end harness: static server, Chromium, a network guard that
// fails the suite on any unexpected outside request, and V8 JS coverage.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const COVERAGE_DIR = join(ROOT, 'coverage', 'e2e');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml' };

export async function serve(root = ROOT) {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(body);
    } catch { res.writeHead(404).end('not found'); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(done => server.close(done)) };
}

// A tiny in-process PeerJS signaling server, so rooms work with no internet:
// ids are claimed per socket, and OFFER/ANSWER/CANDIDATE messages are relayed.
// The browsers still make real WebRTC data connections to each other.
export const SIGNALING = /^wss?:\/\/0\.peerjs\.com\/peerjs/;
function signaling() {
  const sockets = new Map();
  return {
    get ids() { return [...sockets.keys()]; },
    async attach(context) {
      await context.route('https://0.peerjs.com/peerjs/id*', route => route.fulfill({ status: 200, contentType: 'text/html', headers: { 'access-control-allow-origin': '*' }, body: Math.random().toString(36).slice(2, 12) }));
      await context.routeWebSocket(SIGNALING, ws => {
        const id = new URL(ws.url()).searchParams.get('id');
        if (sockets.has(id)) { ws.send(JSON.stringify({ type: 'ID-TAKEN', payload: { msg: 'ID is taken' } })); ws.close(); return; }
        sockets.set(id, ws); ws.send(JSON.stringify({ type: 'OPEN' }));
        ws.onMessage(raw => {
          const message = JSON.parse(String(raw));
          if (!message.dst) return;
          const target = sockets.get(message.dst);
          if (target) target.send(JSON.stringify({ ...message, src: id }));
          else ws.send(JSON.stringify({ type: 'EXPIRE', src: message.dst }));
        });
        ws.onClose(() => { if (sockets.get(id) === ws) sockets.delete(id); });
      });
    },
  };
}

export async function launch({ camera } = {}) {
  const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const options = process.env.CHROME ? { executablePath: process.env.CHROME, args: ['--no-sandbox'] } : {};
  options.args = [...(options.args || []), '--disable-features=WebRtcHideLocalIpsWithMdns'];
  if (camera) options.args.push('--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${camera}`);
  return (pw.chromium || pw.default.chromium).launch(options);
}

// A started app: server + browser + helpers to open isolated "devices".
export async function start({ root, camera } = {}) {
  const server = await serve(root), browser = await launch({ camera });
  const hub = signaling(), errors = [], blocked = [], coverage = [], pages = new Set();
  const app = {
    url: server.url, browser, errors, blocked, signaling: hub,
    // One browser profile (own storage, service worker, locks), like one phone.
    async device({ viewport = { width: 390, height: 844 }, allow = [], routes, tour = false, ...options } = {}) {
      const context = await browser.newContext({ viewport, ...options });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin === server.url || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
        if (routes) { const handled = await routes(route, url); if (handled !== false) return; }
        if (allow.some(rule => rule.test(url.href))) return route.continue();
        blocked.push(url.href); return route.abort();
      });
      context.setDefaultTimeout(6000);
      // The first-run tour is tested in tour.e2e.mjs; elsewhere it is skipped like a user would.
      if (!tour) await context.addInitScript(() => new MutationObserver(() => document.querySelector('.tour-actions .quiet')?.click()).observe(document, { childList: true, subtree: true }));
      await hub.attach(context);
      context.on('page', page => track(page));
      const close = context.close.bind(context);
      context.close = async options => { for (const page of context.pages()) await harvest(page); return close(options); };
      return context;
    },
    async finish() {
      for (const page of pages) await harvest(page);
      await mkdir(COVERAGE_DIR, { recursive: true });
      await writeFile(join(COVERAGE_DIR, `${process.pid}-${Math.random().toString(36).slice(2, 8)}.json`), JSON.stringify(coverage));
      await browser.close(); await server.close();
    },
  };
  function track(page) {
    pages.add(page);
    page.on('pageerror', error => errors.push(`${error.message}`));
    page.on('close', () => { pages.delete(page); });
    page.coverageStarted = page.coverage.startJSCoverage({ resetOnNavigation: false }).catch(() => {});
    const original = page.close.bind(page);
    page.close = async options => { await harvest(page); return original(options); };
  }
  async function harvest(page) {
    if (page.harvested || page.isClosed()) return;
    page.harvested = true;
    try { await page.coverageStarted; coverage.push(...(await page.coverage.stopJSCoverage()).filter(e => e.url.startsWith(server.url)).map(e => ({ url: e.url.slice(server.url.length), length: e.source.length, source: e.source, functions: e.functions }))); } catch { /* page already gone */ }
  }
  return app;
}

export const nav = (page, label) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: new RegExp(`(^|\\s)${label}$`) }).click();
export async function menu(page, label) {
  await page.getByRole('button', { name: 'Open app menu', exact: true }).click();
  await page.locator('.app-menu').getByRole('button', { name: label, exact: true }).click();
}
export const button = (page, name) => page.getByRole('button', { name, exact: true });
export const dialog = page => page.getByRole('dialog');
