// When to ask for Eatsights contributions. Pure functions, no UI, no network,
// so every rule is unit tested (tests/prompts.test.js).
//
// Rules: only the orderer, only with sharing on, only for an Eatsights menu,
// at most one sheet per round (at Finish), and only when the answer is new to
// Eatsights. Ignoring the sheet three rounds in a row pauses asking for two
// weeks; what the orderer did themselves (changed prices, sold out) is kept and
// offered at the next sheet for that stall.
export const RULES = Object.freeze({ freshDays: 14, maxChecks: 3, cooldownDays: 14, skipLimit: 3, quietDays: 14, rateEveryDays: 7 });

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const today = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const key = name => String(name).normalize('NFKC').trim().toLowerCase();
const CHECK_ORDER = { contested: 0, unconfirmed: 1, stale: 2, old: 3 };

export function emptyHistory() { return { skips: 0, quietUntil: null, asked: {}, rated: {}, pending: {} }; }
// Stored history is untrusted (it lives in preferences): keep only valid parts.
export function cleanHistory(raw) {
  const h = emptyHistory();
  if (!raw || typeof raw !== 'object') return h;
  if (Number.isInteger(raw.skips) && raw.skips >= 0) h.skips = Math.min(raw.skips, RULES.skipLimit);
  if (DATE.test(raw.quietUntil)) h.quietUntil = raw.quietUntil;
  for (const field of ['asked', 'rated']) for (const [k, v] of Object.entries(raw[field] || {})) if (typeof k === 'string' && k.length <= 200 && DATE.test(v)) h[field][k] = v;
  for (const [stall, p] of Object.entries(raw.pending || {})) {
    if (typeof stall !== 'string' || stall.length > 60 || !p) continue;
    h.pending[stall] = { changes: (Array.isArray(p.changes) ? p.changes : []).filter(c => c && typeof c.name === 'string' && Number.isInteger(c.price) && c.price >= 0).slice(0, 100),
      soldOut: (Array.isArray(p.soldOut) ? p.soldOut : []).filter(n => typeof n === 'string').slice(0, 100) };
  }
  return h;
}

// Why an item's price is worth asking about, or null when Eatsights already knows.
export function checkReason(fact, date, rules = RULES) {
  if (!fact || !fact.status) return 'new';
  if (fact.status === 'confirmed') return fact.last && daysBetween(fact.last, date) > rules.freshDays ? 'old' : null;
  return CHECK_ORDER[fact.status] !== undefined ? fact.status : 'unconfirmed';
}

// input: { isOrderer, sharing, source: { placeId, sample } | null, items: [{ name, price, before?, fact? }],
//          soldOut: [names], history, date }
// -> { plan: null | { stall, prices: [{ name, price, before?, kind }], soldOut, wait, rate }, history }
// kind: 'changed' (orderer changed it), 'new' (not on Eatsights), or a check
// reason ('contested' | 'unconfirmed' | 'stale' | 'old').
export function planRound({ isOrderer, sharing, source, items = [], soldOut = [], history, date = today() }, rules = RULES) {
  const h = cleanHistory(history);
  if (!isOrderer || !sharing || !source?.placeId || source.sample) return { plan: null, history: h };
  const stall = source.placeId;
  const pending = h.pending[stall] || { changes: [], soldOut: [] };
  const changed = new Map(pending.changes.map(c => [key(c.name), c]));
  const prices = [];
  for (const item of items) {
    if (!Number.isInteger(item.price) || item.price <= 0) continue;
    if (Number.isInteger(item.before) && item.before !== item.price) { changed.set(key(item.name), { name: item.name, price: item.price, before: item.before }); continue; }
    const reason = checkReason(item.fact, date, rules);
    if (reason === 'new') { prices.push({ name: item.name, price: item.price, kind: 'new' }); continue; }
    if (!reason) continue;
    const asked = h.asked[`${stall}|${key(item.name)}`];
    if (asked && daysBetween(asked, date) < rules.cooldownDays) continue;
    prices.push({ name: item.name, price: item.price, kind: reason });
  }
  const sold = [...new Set([...pending.soldOut, ...soldOut].map(String))];
  // An item the orderer changed (now or while paused) is not asked about too.
  const open = prices.filter(p => !changed.has(key(p.name)));
  const checks = open.filter(p => p.kind !== 'new').sort((a, b) => CHECK_ORDER[a.kind] - CHECK_ORDER[b.kind]).slice(0, rules.maxChecks);
  const all = [...[...changed.values()].map(c => ({ ...c, kind: 'changed' })), ...open.filter(p => p.kind === 'new'), ...checks];
  const userMade = changed.size > 0 || sold.length > 0;

  if (h.quietUntil && date < h.quietUntil) {
    // Paused: ask nothing; keep what the orderer did for the next sheet.
    if (userMade) h.pending[stall] = { changes: [...changed.values()], soldOut: sold };
    return { plan: null, history: h };
  }
  if (!all.length && !sold.length) return { plan: null, history: h };
  const rated = h.rated[stall];
  const rate = !rated || daysBetween(rated, date) >= rules.rateEveryDays;
  return { plan: { stall, prices: all, soldOut: sold, wait: true, rate: rate ? items.filter(i => i.price > 0).map(i => i.name).slice(0, 5) : [] }, history: h };
}

// After the sheet: outcome 'sent' or 'skipped'. Shown checks are not asked
// again for cooldownDays either way; pending items are cleared once shown.
export function afterSheet(history, plan, outcome, date = today(), rules = RULES) {
  const h = cleanHistory(history);
  if (!plan) return h;
  for (const p of plan.prices) if (p.kind !== 'changed') h.asked[`${plan.stall}|${key(p.name)}`] = date;
  if (plan.rate.length) h.rated[plan.stall] = date;
  delete h.pending[plan.stall];
  if (outcome === 'skipped') {
    h.skips += 1;
    if (h.skips >= rules.skipLimit) { h.skips = 0; h.quietUntil = addDays(date, rules.quietDays); }
  } else h.skips = 0;
  return h;
}
