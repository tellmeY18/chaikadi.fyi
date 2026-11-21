// Menu ingestor: photo -> [{ name, price (minor units), category }].
// Framework-agnostic and fully on-device. Two engines, best first:
//   1. Chrome's built-in model (Prompt API / Gemini Nano) with image input,
//      used only when already downloaded ("available"); never triggers a
//      multi-GB model download on its own.
//   2. Tesseract OCR (WASM, vendored in /vendor/ocr) + parseMenuText().
//      Works on iOS Safari 16.4+ and Android Chrome, offline after first use.
// The caller always shows a review step; nothing here mutates app state.

const OCR_BASE = new URL('../vendor/ocr/', import.meta.url).href;
const MAX_SIDE = 2000;

export const CATEGORY_HINTS = [
  ['Tea', /\b(chai|tea|coffee|kaapi|kapi|latte|cappuccino|espresso|americano|mocha|milk|horlicks|boost|bournvita|lassi|juice|shake|soda|lime|water|cooler|sharbat|buttermilk|chaas)\b/i],
  ['Meal', /\b(meals?|thali|biryani|biriyani|rice|pulao|parotta|porotta|paratha|roti|chapati|naan|kulcha|curry|masala dosa|dosa|idli|appam|puttu|noodles|fried rice|combo|lunch|dinner|breakfast|pongal|upma|poori|puri|chole|rajma|dal|fish|chicken|mutton|beef|egg|paneer|gravy|sandwich|burger|pizza|wrap|roll)\b/i],
  ['Snacks', /\b(samosa|vada|vadai|bajji|bhaji|pakora|pakoda|cutlet|puff|biscuits?|cookies?|bun|maska|rusk|toast|chips|banana|pazham|pori|bonda|kachori|sweet|cake|muffin|brownie|donut|fries|nuggets|momos?|spring roll|snacks?)\b/i],
];

export function guessCategory(name) {
  for (const [category, pattern] of CATEGORY_HINTS) if (pattern.test(name)) return category;
  return 'Other';
}

// "Masala Chai ....... ₹ 20", "Samosa (2 pcs) - Rs.30/-", "Coffee 15.50",
// "Veg Puff 25 / 30" (first price wins). Number must be at the end of the line.
const PRICE_AT_END = /^(.*?[A-Za-z\u0080-\uFFFF].*?)[\s.:·•…_\-–—|=*]*(?:₹|rs\.?|inr|\$|€|£)?\s*(\d{1,6}(?:[.,]\d{1,2})?)\s*(?:\/-|\/=|-|\/|\s+\d{1,6}(?:[.,]\d{1,2})?)*\s*$/i;
const PRICE_ONLY = /^(?:₹|rs\.?|inr|\$|€|£)?\s*(\d{1,6}(?:[.,]\d{1,2})?)\s*(?:\/-|-)?$/i;
const NOISE = /^(menu|price|prices|rate|rates|item|items|qty|gst.*|tax.*|total.*|thank.*|welcome.*|open.*|timing.*|phone.*|ph[.:].*|mob.*|www\..*|.*@.*|since \d+)$/i;

const toMinor = text => Math.round(Number(text.replace(',', '.')) * 100);

function cleanName(raw) {
  return raw
    .replace(/[|_*•·…]+/g, ' ')
    .replace(/\.{2,}/g, ' ')
    .replace(/^\W+|[\s.:\-–—=]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function plausibleName(name) {
  const letters = (name.match(/[A-Za-z\u0080-\uFFFF]/g) || []).length;
  return name.length >= 2 && name.length <= 60 && letters >= 2 && letters / name.length > 0.5 && !NOISE.test(name);
}

const titleCase = s => (s === s.toUpperCase() && /[A-Z]{3}/.test(s))
  ? s.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase())
  : s;

// "Samosa 15", "Veg puff - Rs 25", "Masala chai". The price is optional (0 means
// "set it in Costs"); the category is guessed, unknown names default to Snacks.
const QUICK = /^(.*?[A-Za-z\u0080-\uFFFF].*?)[\s:\-–=]*(?:₹|rs\.?|inr)?\s*(\d{1,6}(?:[.,]\d{1,2})?)\s*(?:\/-)?$/i;
export function parseQuickItem(raw) {
  const text = String(raw || '').trim();
  const m = QUICK.exec(text);
  const clean = titleCase(cleanName(m ? m[1] : text)).slice(0, 60), name = clean.charAt(0).toUpperCase() + clean.slice(1);
  if (!/[A-Za-z\u0080-\uFFFF]/.test(name)) return null;
  const guess = guessCategory(name);
  return { name, price: m ? toMinor(m[2]) : 0, category: guess === 'Other' ? 'Snacks' : guess };
}

// Pure: OCR text -> candidate items. Exported for tests and other engines.
export function parseMenuText(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const items = [];
  let pendingName = null;
  for (const line of lines) {
    const match = line.match(PRICE_AT_END);
    if (match) {
      const name = cleanName(match[1]);
      const price = toMinor(match[2]);
      if (plausibleName(name) && price > 0 && price <= 10000000) {
        items.push({ name: titleCase(name), price, category: guessCategory(name) });
        pendingName = null;
        continue;
      }
    }
    // Two-column menus often OCR as "Name" on one line and "20" on the next.
    const priceOnly = line.match(PRICE_ONLY);
    if (priceOnly && pendingName) {
      items.push({ name: titleCase(pendingName), price: toMinor(priceOnly[1]), category: guessCategory(pendingName) });
      pendingName = null;
      continue;
    }
    const name = cleanName(line);
    pendingName = plausibleName(name) && !/\d{2,}/.test(name) ? name : null;
  }
  return dedupe(items);
}

// Word-level cleanup for Tesseract output, then the same text parser.
// - Dotted leaders ("........") come back as low-confidence junk words.
// - The eng model has no ₹ glyph: "₹ 20" is read as "320", "720", "¥20", "%20"
//   with low confidence. A low-confidence trailing price whose first char is a
//   typical ₹ misread loses that char. Users still review every item.
const RUPEE_MISREADS = /^[237¥%&?FZz]/;
const PRICE_WORD = /^[^\d\s]{0,2}\d{1,6}(?:[.,]\d{1,2})?(?:\/-|\/|-)?$/;
export function cleanOcrLines(lines) {
  return lines.map(line => {
    const words = (line.words || []).filter(w => w.text?.trim());
    if (!words.length) return '';
    const last = words[words.length - 1];
    let price = '';
    if (PRICE_WORD.test(last.text)) {
      price = last.text.replace(/(?:\/-|\/|-)$/, '');
      const digits = price.replace(/^[^\d]+/, '');
      if (digits !== price) price = digits; // "¥120", "%20" -> "120", "20"
      else if (last.confidence < 70 && price.length >= 3 && RUPEE_MISREADS.test(price) && !/[.,]/.test(price.slice(0, 2))) price = price.slice(1);
      words.pop();
    }
    const name = words.filter(w => w.confidence >= 55 || /^[A-Za-z]{4,}$/.test(w.text) && w.confidence >= 40)
      .map(w => w.text).join(' ');
    return [name, price].filter(Boolean).join(' ');
  }).join('\n');
}

// First heading-like line near the top (no price, mostly letters):
// "RAJU CHAI KADA" -> "Raju Chai Kada". Used to name a new menu.
export function findTitle(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => cleanName(l.replace(/\s+/g, ' ').trim())).filter(Boolean);
  for (const line of lines.slice(0, 4)) {
    if (/\d/.test(line) || !plausibleName(line) || line.length < 3) continue;
    if (/^(menu|our menu|price list|rate list|welcome)$/i.test(line)) continue;
    return titleCase(line).slice(0, 50);
  }
  return '';
}

export function dedupe(items) {
  const seen = new Map();
  for (const item of items) {
    const key = item.name.normalize('NFKC').toLowerCase();
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()].slice(0, 100);
}

// Downscale + grayscale: faster OCR, smaller model input, fixes EXIF rotation
// (createImageBitmap honours orientation in current browsers).
async function prepareImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.filter = 'grayscale(1) contrast(1.35)';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}

// ---- Engine 1: Chrome built-in AI (optional) ----
const SCHEMA = {
  type: 'object',
  properties: { shop: { type: 'string' }, items: { type: 'array', maxItems: 100, items: { type: 'object',
    properties: { name: { type: 'string' }, price: { type: 'number' }, category: { type: 'string', enum: ['Tea', 'Snacks', 'Meal', 'Other'] } },
    required: ['name', 'price', 'category'] } } },
  required: ['items'],
};

export async function builtInAvailable() {
  try {
    const LM = globalThis.LanguageModel;
    if (!LM?.availability) return false;
    return (await LM.availability({ expectedInputs: [{ type: 'image' }], expectedOutputs: [{ type: 'text', languages: ['en'] }] })) === 'available';
  } catch { return false; }
}

async function extractWithBuiltIn(canvas) {
  const session = await globalThis.LanguageModel.create({
    expectedInputs: [{ type: 'image' }], expectedOutputs: [{ type: 'text', languages: ['en'] }],
  });
  try {
    const raw = await session.prompt([{ role: 'user', content: [
      { type: 'text', value: 'This is a photo of a cafe / tea-shop / restaurant menu. Give the shop or menu name if printed (else empty), and list every orderable item with its price as a number (first price if several). Category: Tea for any drink, Snacks for small bites, Meal for full dishes, else Other. Skip headings, phone numbers and taxes.' },
      { type: 'image', value: canvas },
    ] }], { responseConstraint: SCHEMA });
    const parsed = JSON.parse(raw);
    const title = typeof parsed.shop === 'string' ? cleanName(parsed.shop).slice(0, 50) : '';
    return { title, items: dedupe((parsed.items || [])
      .map(i => ({ name: cleanName(String(i.name || '')), price: Math.round(Number(i.price) * 100), category: ['Tea', 'Snacks', 'Meal', 'Other'].includes(i.category) ? i.category : guessCategory(String(i.name)) }))
      .filter(i => plausibleName(i.name) && Number.isSafeInteger(i.price) && i.price >= 0 && i.price <= 10000000)) };
  } finally { session.destroy?.(); }
}

// ---- Engine 2: Tesseract OCR (vendored) ----
let scriptPromise = null;
function loadTesseract() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = OCR_BASE + 'tesseract.min.js';
    script.onload = () => resolve(globalThis.Tesseract);
    script.onerror = () => { scriptPromise = null; reject(new Error('Could not load the menu reader. Open Chaikadi online once to download it (≈ 7 MB), then it works offline.')); };
    document.head.append(script);
  });
  return scriptPromise;
}

async function extractWithOCR(canvas, onProgress) {
  const Tesseract = await loadTesseract();
  const worker = await Tesseract.createWorker('eng', 1, {
    workerPath: OCR_BASE + 'worker.min.js',
    corePath: OCR_BASE + coreFile(), // explicit: we ship only the simd + plain builds
    langPath: OCR_BASE.replace(/\/$/, ''),
    gzip: true,
    cacheMethod: 'none', // the service worker caches the files; avoid a 2nd copy in IndexedDB
    workerBlobURL: false,
    logger: m => {
      if (m.status === 'recognizing text') onProgress?.(0.3 + 0.7 * m.progress, 'Reading the menu…');
      else if (m.status) onProgress?.(0.3 * (m.progress || 0), 'Loading the menu reader…');
    },
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '6' });
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const lines = (data.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines));
    const cleaned = lines.length ? cleanOcrLines(lines) : data.text;
    return { text: data.text, title: findTitle(cleaned), items: parseMenuText(cleaned) };
  } finally { await worker.terminate(); }
}

export async function extractMenu(file, { onProgress, preferBuiltIn = true } = {}) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('Choose a photo of the menu.');
  onProgress?.(0, 'Preparing photo…');
  const canvas = await prepareImage(file);
  if (preferBuiltIn && await builtInAvailable()) {
    try {
      onProgress?.(0.2, 'Reading the menu on-device (built-in AI)…');
      const { title, items } = await extractWithBuiltIn(canvas);
      if (items.length) { onProgress?.(1, 'Done'); return { engine: 'built-in', title, items, text: '' }; }
    } catch { /* fall through to OCR */ }
  }
  const result = await extractWithOCR(canvas, onProgress).catch(error => {
    if (error instanceof Error && error.message.startsWith('Could not load')) throw error;
    throw new Error(navigator.onLine
      ? 'The menu reader failed to start on this device. Try again, or add items by hand.'
      : 'The menu reader isn’t downloaded yet. Open the Menu tab once while online, then it works offline.');
  });
  onProgress?.(1, 'Done');
  return { engine: 'ocr', ...result };
}

// Warm the service-worker cache so scanning works offline later. Only the
// WASM build this device will actually use is fetched (SIMD needs iOS 16.4+).
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
function coreFile() {
  let simd = false;
  try { simd = WebAssembly.validate(SIMD_PROBE); } catch { /* no wasm simd */ }
  return simd ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js';
}
let prefetched = null;
export function prefetchOCR() {
  if (prefetched) return prefetched;
  const core = coreFile();
  // The SW stores the full response before handing it over; we just discard ours.
  return prefetched = Promise.allSettled(['tesseract.min.js', 'worker.min.js', core, 'eng.traineddata.gz']
    .map(f => fetch(OCR_BASE + f).then(r => { if (!r.ok) throw new Error(f); return r.body?.cancel(); })));
}
