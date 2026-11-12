import { CATEGORIES, validCode } from './config.js';

const clone = value => JSON.parse(JSON.stringify(value));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const text = (value, max, label) => {
  assert(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, `${label} must be 1–${max} characters.`);
  return value.trim();
};
const idString = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const money = value => Number.isSafeInteger(value) && value >= 0 && value <= 100000000;
const sameName = (a, b) => a.normalize('NFKC').toLowerCase() === b.normalize('NFKC').toLowerCase();

export function newGroup({ id, code, name, memberId, memberName, roundId }) {
  assert(validCode(code), 'Invalid room code.');
  return {
    schema: 1,
    group: { id, roomCode: code, name: text(name, 60, 'Group name'), version: 1, hostId: memberId,
      ordererId: memberId, status: 'open', currency: '₹' },
    members: [{ id: memberId, name: text(memberName, 30, 'Display name'), online: true }],
    menu: [], picks: [], history: [], receipts: [],
    round: { id: roundId, actualTotal: null, splitMode: 'equal', payments: {} },
  };
}

export function subtotal(state, memberId) {
  return state.picks.filter(p => p.memberId === memberId).reduce((sum, p) =>
    sum + p.qty * (state.menu.find(i => i.id === p.itemId)?.price || 0), 0);
}

// Integer minor units throughout. Largest-remainder allocation conserves every
// cent, including negative differences (discounts) and all-zero menu prices.
export function costs(state) {
  const people = state.members.map(m => ({ ...m, subtotal: subtotal(state, m.id), owed: 0,
    participating: state.picks.some(p => p.memberId === m.id && p.qty > 0) }));
  const participants = people.filter(p => p.participating);
  const estimatedTotal = people.reduce((n, p) => n + p.subtotal, 0);
  const actualTotal = state.round.actualTotal ?? estimatedTotal;
  if (participants.length) {
    // Equal split means equal *difference*, not equal bill. When a discount
    // would make a person owe less than zero, cap there and reallocate fairly.
    let remaining = actualTotal - estimatedTotal;
    for (const p of participants) p.owed = p.subtotal;
    let active = [...participants];
    while (active.length && remaining !== 0) {
      const proportional = state.round.splitMode === 'proportional';
      const weightTotal = proportional ? active.reduce((n, p) => n + p.subtotal, 0) : 0;
      const shares = active.map(p => {
        const weight = weightTotal ? p.subtotal / weightTotal : 1 / active.length;
        const raw = Math.abs(remaining) * weight;
        return { p, whole: Math.floor(raw), fraction: raw - Math.floor(raw) };
      });
      let pennies = Math.abs(remaining) - shares.reduce((n, s) => n + s.whole, 0);
      shares.sort((a, b) => b.fraction - a.fraction || a.p.id.localeCompare(b.p.id));
      for (const s of shares) if (pennies-- > 0) s.whole++;
      const sign = Math.sign(remaining);
      let used = 0;
      for (const s of shares) {
        const delta = sign > 0 ? s.whole : -Math.min(s.whole, s.p.owed);
        s.p.owed += delta;
        used += delta;
      }
      remaining -= used;
      active = active.filter(p => p.owed > 0 || remaining > 0);
      if (!used) break;
    }
  }
  return { people, estimatedTotal, actualTotal };
}

// The only authoritative writer is the host. This pure reducer also drives
// offline optimistic previews; the host checks the same intents on reconnect.
// IDs and round IDs originate outside this function: no time/random side effects.
export function reduce(state, intent) {
  assert(state?.schema === 1 && intent && idString(intent.id), 'Invalid change.');
  if (state.receipts.includes(intent.id)) return state;
  const { type, payload: p = {}, senderId } = intent;
  assert(p && typeof p === 'object', 'Invalid change details.');
  const s = clone(state);
  const host = senderId === s.group.hostId;
  const member = s.members.find(m => m.id === senderId);
  const orderer = senderId === s.group.ordererId;
  assert(member, 'You are no longer in this group.');
  const open = () => assert(s.group.status === 'open', 'The order is locked. Ask the orderer to unlock it.');
  const ordererOnly = () => assert(orderer, 'Only the designated orderer can do that.');
  const hostOnly = () => assert(host, 'Only the host can do that.');
  if (['pick.set', 'order.lock', 'order.unlock', 'bill.set', 'payment.set', 'round.finish'].includes(type)) {
    assert(intent.roundId === s.round.id, 'That round has finished. Your old change was not applied.');
  }
  switch (type) {
    case 'member.join': {
      hostOnly();
      assert(idString(p.id) && !s.members.some(m => m.id === p.id), 'Invalid member identity.');
      assert(s.members.length < 15, 'This group is full (15 people maximum).');
      const name = text(p.name, 30, 'Display name');
      assert(!s.members.some(m => sameName(m.name, name)), 'That display name is taken. Please choose another.');
      s.members.push({ id: p.id, name, online: true });
      break;
    }
    case 'member.online':
      hostOnly();
      assert(s.members.some(m => m.id === p.id), 'Unknown member.');
      s.members.find(m => m.id === p.id).online = !!p.online;
      break;
    case 'member.rename': {
      const name = text(p.name, 30, 'Display name');
      assert(!s.members.some(m => m.id !== senderId && sameName(m.name, name)), 'That display name is taken.');
      s.members.find(m => m.id === senderId).name = name;
      break;
    }
    case 'member.remove':
      hostOnly(); open();
      assert(p.id !== s.group.hostId && s.members.some(m => m.id === p.id), 'Cannot remove that member.');
      s.members = s.members.filter(m => m.id !== p.id);
      s.picks = s.picks.filter(pick => pick.memberId !== p.id);
      delete s.round.payments[p.id];
      if (s.group.ordererId === p.id) s.group.ordererId = s.group.hostId;
      break;
    case 'orderer.set':
      hostOnly();
      assert(s.members.some(m => m.id === p.id), 'Unknown orderer.');
      s.group.ordererId = p.id;
      break;
    case 'menu.upsert': {
      open();
      assert(idString(p.id) && money(p.price) && CATEGORIES.includes(p.category), 'Enter a valid item, price and category.');
      const item = { id: p.id, name: text(p.name, 60, 'Item name'), price: p.price, category: p.category };
      const index = s.menu.findIndex(i => i.id === p.id);
      assert(index >= 0 || s.menu.length < 200, 'A menu can contain up to 200 items.');
      if (index >= 0) s.menu[index] = item;
      else s.menu.push(item);
      break;
    }
    case 'menu.delete':
      open();
      s.menu = s.menu.filter(i => i.id !== p.id);
      s.picks = s.picks.filter(pick => pick.itemId !== p.id);
      break;
    case 'pick.set': {
      open();
      assert(s.menu.some(i => i.id === p.itemId), 'That menu item was removed.');
      assert(Number.isInteger(p.qty) && p.qty >= 0 && p.qty <= 99, 'Quantity must be 0–99.');
      assert(typeof p.note === 'string' && p.note.length <= 160, 'Notes can be up to 160 characters.');
      s.picks = s.picks.filter(pick => !(pick.memberId === senderId && pick.itemId === p.itemId));
      if (p.qty) s.picks.push({ memberId: senderId, itemId: p.itemId, qty: p.qty, note: p.note.trim() });
      break;
    }
    case 'order.lock': ordererOnly(); s.group.status = 'locked'; break;
    case 'order.unlock':
      ordererOnly(); s.group.status = 'open';
      s.round.actualTotal = null; s.round.payments = {};
      break;
    case 'bill.set':
      ordererOnly();
      assert(s.group.status === 'locked', 'Lock the order before entering the bill.');
      assert(money(p.actualTotal) && ['equal', 'proportional'].includes(p.splitMode), 'Enter a valid bill and split mode.');
      assert(s.picks.length > 0 || p.actualTotal === 0, 'Add picks before splitting a bill.');
      s.round.actualTotal = p.actualTotal; s.round.splitMode = p.splitMode; s.round.payments = {};
      break;
    case 'payment.set':
      ordererOnly();
      assert(s.group.status === 'locked', 'Lock the order before marking payments.');
      assert(s.members.some(m => m.id === p.id) && typeof p.paid === 'boolean', 'Invalid payment.');
      s.round.payments[p.id] = p.paid;
      break;
    case 'round.finish': {
      ordererOnly();
      assert(s.group.status === 'locked', 'Lock the order before finishing the round.');
      assert(idString(p.nextRoundId) && p.nextRoundId !== s.round.id && typeof p.date === 'string' && Number.isFinite(Date.parse(p.date)), 'Invalid round.');
      const totals = costs(s);
      s.history.push({ ...clone(s.round), date: p.date, picks: clone(s.picks), menu: clone(s.menu),
        members: clone(s.members), currency: s.group.currency, ordererId: s.group.ordererId,
        estimatedTotal: totals.estimatedTotal, amounts: totals.people.map(m => ({ id: m.id, name: m.name, owed: m.owed })) });
      s.picks = []; s.group.status = 'open';
      s.round = { id: p.nextRoundId, actualTotal: null, splitMode: 'equal', payments: {} };
      break;
    }
    case 'history.payment': {
      const round = s.history.find(r => r.id === p.roundId);
      assert(round && round.ordererId === senderId, 'Only that round’s orderer can update its payments.');
      assert(round.amounts.some(m => m.id === p.id) && typeof p.paid === 'boolean', 'Invalid payment.');
      round.payments[p.id] = p.paid;
      break;
    }
    case 'group.currency': hostOnly(); open(); s.group.currency = text(p.currency, 8, 'Currency'); break;
    case 'group.code': hostOnly(); assert(validCode(p.code), 'Invalid code.'); s.group.roomCode = p.code; break;
    default: throw new Error('Unknown change type.');
  }
  s.group.version++;
  s.receipts = [...s.receipts.slice(-1999), intent.id];
  return s;
}

export function debts(state) {
  const result = new Map();
  for (const round of state.history) for (const person of round.amounts) {
    if (!person.owed || person.id === round.ordererId || round.payments[person.id]) continue;
    const key = `${person.id}:${round.ordererId}:${round.currency}`;
    const debt = result.get(key) || { name: person.name,
      orderer: round.members.find(m => m.id === round.ordererId)?.name || 'Former member', currency: round.currency, amount: 0 };
    debt.amount += person.owed;
    result.set(key, debt);
  }
  return [...result.values()];
}

// One snapshot transaction includes identity, host-only pairing credentials,
// confirmed state and queued intents, so reloads never generate a new identity.
export class Persistence {
  constructor(onWarning = () => {}) { this.warning = onWarning; this.db = null; this.chain = Promise.resolve(); this.lastSavedAt = 0; }
  async open() {
    try {
      this.db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('chaikadi', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('snapshots');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('Database blocked'));
      });
    } catch { this.warning('IndexedDB unavailable. Using local storage; keep this browser’s site data.'); }
    return this;
  }
  async load() {
    let primary = null;
    if (this.db) {
      try {
        primary = await new Promise((resolve, reject) => {
          const req = this.db.transaction('snapshots').objectStore('snapshots').get('current');
          req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error);
        });
      } catch { this.warning('Could not read IndexedDB. Trying the local backup.'); }
    }
    let fallback = null;
    try { fallback = JSON.parse(localStorage.getItem('chaikadi.snapshot') || 'null'); } catch { /* unavailable */ }
    const value = (fallback?.savedAt || 0) > (primary?.savedAt || 0) ? fallback : primary || fallback;
    this.lastSavedAt = Math.max(primary?.savedAt || 0, fallback?.savedAt || 0);
    return value?.data || null;
  }
  save(data) {
    this.lastSavedAt = Math.max(Date.now(), this.lastSavedAt + 1);
    const snapshot = { savedAt: this.lastSavedAt, data: clone(data) };
    this.chain = this.chain.catch(() => {}).then(async () => {
      if (this.db) {
        try {
          await new Promise((resolve, reject) => {
            const tx = this.db.transaction('snapshots', 'readwrite');
            tx.objectStore('snapshots').put(snapshot, 'current');
            tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
          });
          try { localStorage.removeItem('chaikadi.snapshot'); } catch { /* unavailable */ }
          return;
        } catch { this.warning('Database save failed. Trying local storage.'); }
      }
      try { localStorage.setItem('chaikadi.snapshot', JSON.stringify(snapshot)); }
      catch { this.warning('Storage is full or disabled. Changes are in memory only. Export a backup in Settings now.'); throw new Error('Local save failed'); }
    });
    return this.chain;
  }
}
