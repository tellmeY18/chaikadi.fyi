// "Buy the maker a chai": a tip jar that never nags. Pure functions, no UI, so
// the rules are unit tested (tests/chai.test.js). Chaikadi never moves money:
// it opens the user's own UPI app. The prompt is off for good after "Don't ask
// again", and nothing shows at all until a UPI ID is set below.
import { validUpi, normalizeUpi } from './upi.js';
import { today, addDays } from './prompts.js';
import { parseQuickItem } from './ingest.js';

export const CHAI = Object.freeze({ upi: 'vysakh.6294-4@waaxis', name: 'Chaikadi' });

// amount is in paise (minor units), cups is what it adds to the member card.
export const TIERS = Object.freeze([
  { id: 'chai', amount: 1000, cups: 1 },
  { id: 'chaikadi', amount: 3000, cups: 2 },
  { id: 'round', amount: 5000, cups: 5 },
]);
export const LEVELS = Object.freeze([
  { cups: 12, id: 'owner' }, { cups: 6, id: 'member' }, { cups: 3, id: 'regular' }, { cups: 1, id: 'friend' },
]);
export const RULES = Object.freeze({ afterRounds: 3, repeatDays: 30, laterDays: 14, thankedDays: 90 });

export const chaiEnabled = (cfg = CHAI) => validUpi(cfg.upi);
export const memberLevel = cups => LEVELS.find(l => cups >= l.cups)?.id || null;
export const nextLevel = cups => [...LEVELS].reverse().find(l => cups < l.cups) || null;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const emptyChai = () => ({ rounds: 0, cups: 0, never: false, quietUntil: null });
// Stored preferences are untrusted: keep only valid parts.
export function cleanChai(raw) {
  const c = emptyChai();
  if (!raw || typeof raw !== 'object') return c;
  if (Number.isInteger(raw.rounds) && raw.rounds >= 0) c.rounds = Math.min(raw.rounds, 100000);
  if (Number.isInteger(raw.cups) && raw.cups >= 0) c.cups = Math.min(raw.cups, 100000);
  c.never = raw.never === true;
  if (DATE.test(raw.quietUntil)) c.quietUntil = raw.quietUntil;
  return c;
}

export const countRound = raw => { const c = cleanChai(raw); return { ...c, rounds: c.rounds + 1 }; };
// Ask once the user has really used the app, then rarely, and never after "never".
export function shouldAsk(raw, date = today(), cfg = CHAI, rules = RULES) {
  const c = cleanChai(raw);
  if (!chaiEnabled(cfg) || c.never || c.rounds < rules.afterRounds) return false;
  return !c.quietUntil || date >= c.quietUntil;
}
// outcome: 'later' (Not now), 'never' (Don't ask again), 'paid' (opened UPI to pay).
export function afterAsk(raw, outcome, date = today(), rules = RULES) {
  const c = cleanChai(raw);
  if (outcome === 'never') return { ...c, never: true };
  return { ...c, quietUntil: addDays(date, outcome === 'paid' ? rules.thankedDays : rules.repeatDays) };
}
export const setNever = (raw, never) => ({ ...cleanChai(raw), never: !!never });
export const addCups = (raw, n) => { const c = cleanChai(raw); return { ...c, cups: c.cups + n }; };

export function chaiLink(tier, cfg = CHAI, note = 'A chai for Chaikadi') {
  if (!chaiEnabled(cfg) || !tier) return null;
  const q = [`pa=${normalizeUpi(cfg.upi)}`, `pn=${encodeURIComponent(cfg.name.slice(0, 40))}`, `am=${(tier.amount / 100).toFixed(2)}`, 'cu=INR', `tn=${encodeURIComponent(note.slice(0, 50))}`].join('&');
  return `upi://pay?${q}`;
}

// One-line custom treat, like the quick add on the menu: "Biriyani 300".
// Returns { name, amount (paise), cups } or null when there is no name or amount.
export const MAX_TREAT = 1000000;
export const cupsFor = amount => Math.max(1, Math.min(10, Math.floor(amount / 1000)));
export function parseTreat(text) {
  const item = parseQuickItem(text);
  if (!item || !(item.price > 0) || item.price > MAX_TREAT) return null;
  return { name: item.name, amount: item.price, cups: cupsFor(item.price) };
}
