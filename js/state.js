import { CATEGORIES, validCode } from './config.js';
import { validUpi, normalizeUpi } from './upi.js';

const clone = value => JSON.parse(JSON.stringify(value));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const text = (value, max, label) => {
  assert(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, `${label} must be 1–${max} characters.`);
  return value.trim();
};
const idString = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const money = value => Number.isSafeInteger(value) && value >= 0 && value <= 100000000;
const popularity = value => value === undefined || (Number.isInteger(value) && value >= 0 && value <= 1000);
const sameName = (a, b) => a.normalize('NFKC').toLowerCase() === b.normalize('NFKC').toLowerCase();

// Where an imported menu came from: a snapshot of the library prices (in
// minor units) so later edits can be offered back as suggested updates.
const LIBRARY_CATEGORIES = ['Tea', 'Coffee', 'Drinks', 'Snacks', 'Meal', 'Dessert', 'Other'];
function menuSource(value) {
  if (value === null || value === undefined) return null;
  assert(value && typeof value === 'object' && (/^(node|way|relation)\/[1-9][0-9]{0,14}$/.test(value.placeId) || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.placeId)) && value.placeId.length <= 60 &&
    /^[a-z]{2}\/[a-z0-9-]{1,60}\/[a-z0-9-]{1,60}$/.test(value.city) && /^\d{4}-\d{2}-\d{2}$/.test(value.lastConfirmed) &&
    Array.isArray(value.items) && value.items.length <= 300, 'Invalid menu library link.');
  return {
    placeId: value.placeId, city: value.city, name: text(value.name, 80, 'Library place name'), lastConfirmed: value.lastConfirmed,
    sample: value.sample === true,
    items: value.items.map(item => {
      assert(item && money(item.price) && LIBRARY_CATEGORIES.includes(item.category), 'Invalid library item.');
      return { name: text(item.name, 80, 'Library item name'), category: item.category, price: item.price };
    }),
  };
}

// Items of a library-linked menu whose price differs from the imported price.
export function libraryChanges(state, menuId = state.activeMenuId) {
  const menu = state.menus?.find(m => m.id === menuId);
  if (!menu?.source) return [];
  return state.menu.filter(i => i.menuId === menuId).flatMap(item => {
    const original = menu.source.items.find(s => sameName(s.name.slice(0, 60), item.name));
    return original && original.price !== item.price ? [{ name: original.name, category: original.category, price: item.price, before: original.price }] : [];
  });
}

export function newGroup({ id, code, name, memberId, memberName, roundId }) {
  assert(validCode(code), 'Invalid room code.');
  return {
    schema: 1,
    group: { id, roomCode: code, name: text(name, 60, 'Group name'), version: 1, hostId: memberId,
      ordererId: memberId, status: 'open', currency: 'Rs' },
    members: [{ id: memberId, name: text(memberName, 30, 'Display name'), online: true }],
    menus: [], activeMenuId: null, menu: [], picks: [], history: [], receipts: [],
    round: { id: roundId, actualTotal: null, splitMode: 'equal', payments: {} },
  };
}

// Groups saved before multiple menus existed: their items become one menu
// called "Menu". Deterministic, so host and members migrate identically.
// Additive storage migration. Older clients must update for multi-menu edits.
export function migrate(state) {
  if (!state || Array.isArray(state.menus) || !Array.isArray(state.menu)) return state;
  const s = clone(state);
  s.menus = s.menu.length ? [{ id: 'menu-1', name: 'Menu' }] : [];
  s.activeMenuId = s.menus[0]?.id || null;
  for (const item of s.menu) item.menuId = item.menuId || 'menu-1';
  return s;
}

export const activeItems = state => state.menu.filter(i => i.menuId === state.activeMenuId);
// Most-ordered first: an item's declared `popularity` (0–1000, part of the
// menu schema) plus how often the group has ordered it in finished rounds.
export function orderCounts(state) {
  const counts = new Map();
  for (const round of state.history || []) for (const pick of round.picks || []) counts.set(pick.itemId, (counts.get(pick.itemId) || 0) + pick.qty);
  return counts;
}
export function rankItems(state, items) {
  const counts = orderCounts(state);
  const score = item => (item.popularity || 0) + 10 * (counts.get(item.id) || 0);
  return items.map((item, index) => ({ item, index, score: score(item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index).map(x => x.item);
}
const fold = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function searchItems(items, query = '') {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return words.length ? items.filter(item => words.every(w => fold(item.name).includes(w))) : items;
}
export const activeMenu = state => state.menus.find(m => m.id === state.activeMenuId) || null;

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

// A finished round as stored in history: everything needed to show it later.
export function roundRecord(s, date) {
  const totals = costs(s);
  return { ...clone(s.round), date, picks: clone(s.picks), menu: clone(activeItems(s)), menuName: activeMenu(s)?.name || '',
    members: clone(s.members), currency: s.group.currency, ordererId: s.group.ordererId,
    estimatedTotal: totals.estimatedTotal, amounts: totals.people.map(m => ({ id: m.id, name: m.name, owed: m.owed })) };
}

// A session is a group plus its current round. When it ends without Finish
// (idle too long, or the person leaves) whatever was entered is kept as
// history, so nothing typed is lost. Returns null for an empty session.
export const SESSION_ARCHIVE_LIMIT = 30;
export const isStale = (lastActive, now, ttl) => Number.isFinite(lastActive) && now - lastActive > ttl;
export function archiveSession(state, { endedAt, archivedAt = endedAt }) {
  if (!state) return null;
  const s = migrate(clone(state));
  const rounds = clone(s.history);
  if (s.picks.length > 0) rounds.push(roundRecord(s, new Date(endedAt).toISOString()));
  if (!rounds.length) return null;
  return { id: `${s.group.id}:${s.round.id}`, name: s.group.name, roomCode: s.group.roomCode, currency: s.group.currency,
    unfinished: s.picks.length > 0, endedAt: new Date(endedAt).toISOString(), archivedAt: new Date(archivedAt).toISOString(), rounds };
}
export const addArchive = (archive, entry) => entry ? [entry, ...(archive || []).filter(e => e.id !== entry.id)].slice(0, SESSION_ARCHIVE_LIMIT) : archive || [];

// The only authoritative writer is the host. This pure reducer also drives
// offline optimistic previews; the host checks the same intents on reconnect.
// IDs and round IDs originate outside this function: no time/random side effects.
export function reduce(state, intent) {
  assert(state?.schema === 1 && intent && idString(intent.id), 'Invalid change.');
  if (state.receipts.includes(intent.id)) return state;
  const { type, payload: p = {}, senderId } = intent;
  assert(p && typeof p === 'object', 'Invalid change details.');
  const s = migrate(clone(state));
  const host = senderId === s.group.hostId;
  const member = s.members.find(m => m.id === senderId);
  const orderer = senderId === s.group.ordererId;
  assert(member, 'You are no longer in this group.');
  const open = () => assert(s.group.status === 'open', 'The order is locked. Ask the orderer to unlock it.');
  const ordererOnly = () => assert(orderer, 'Only the designated orderer can do that.');
  const hostOnly = () => assert(host, 'Only the host can do that.');
  if (['pick.set', 'menu.activate', 'order.lock', 'order.unlock', 'bill.set', 'payment.set', 'round.finish'].includes(type)) {
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
      s.upiProposals = (s.upiProposals || []).filter(x => x.forId !== p.id && x.byId !== p.id);
      delete s.round.payments[p.id];
      if (s.group.ordererId === p.id) s.group.ordererId = s.group.hostId;
      break;
    case 'member.upi': {
      const me = s.members.find(m => m.id === senderId);
      if (p.upi === '' || p.upi === null) delete me.upi;
      else { assert(validUpi(p.upi), 'Enter a UPI ID like name@bank.'); me.upi = normalizeUpi(p.upi); }
      s.upiProposals = (s.upiProposals || []).filter(x => x.forId !== senderId);
      break;
    }
    // Someone scanned your UPI QR and proposes that ID for you. Nothing changes
    // until you approve it: only the owner can set their own UPI ID.
    case 'upi.propose': {
      assert(s.members.some(m => m.id === p.forId) && p.forId !== senderId, 'Ask someone else to show their UPI QR.');
      assert(validUpi(p.upi), 'That is not a UPI ID.');
      const name = typeof p.name === 'string' ? p.name.trim().slice(0, 40) : '';
      s.upiProposals = [...(s.upiProposals || []).filter(x => x.forId !== p.forId), { forId: p.forId, upi: normalizeUpi(p.upi), name, byId: senderId }];
      break;
    }
    case 'upi.decide': {
      const proposal = (s.upiProposals || []).find(x => x.forId === senderId);
      assert(proposal, 'Nothing to approve.');
      if (p.approve === true) {
        assert(p.upi === proposal.upi, 'The scanned UPI ID changed. Please review it again.');
        member.upi = proposal.upi;
      }
      s.upiProposals = s.upiProposals.filter(x => x.forId !== senderId);
      break;
    }
    case 'orderer.set':
      hostOnly();
      assert(s.members.some(m => m.id === p.id), 'Unknown orderer.');
      s.group.ordererId = p.id;
      break;
    case 'menu.create': {
      assert(idString(p.id) && !s.menus.some(m => m.id === p.id), 'Invalid menu.');
      assert(s.menus.length < 20, 'A group can keep up to 20 menus.');
      const name = text(p.name, 60, 'Menu name');
      assert(!s.menus.some(m => sameName(m.name, name)), 'A menu with that name already exists.');
      const source = menuSource(p.source);
      s.menus.push(source ? { id: p.id, name, source } : { id: p.id, name });
      // The first menu becomes the round's menu automatically: no extra tap.
      if (!s.activeMenuId) s.activeMenuId = p.id;
      break;
    }
    case 'menu.source': {
      const menu = s.menus.find(m => m.id === p.id);
      assert(menu, 'That menu was removed.');
      const source = menuSource(p.source);
      if (source) menu.source = source; else delete menu.source;
      break;
    }
    case 'menu.rename': {
      assert(s.menus.some(m => m.id === p.id), 'That menu was removed.');
      const name = text(p.name, 60, 'Menu name');
      assert(!s.menus.some(m => m.id !== p.id && sameName(m.name, name)), 'A menu with that name already exists.');
      s.menus.find(m => m.id === p.id).name = name;
      break;
    }
    case 'menu.remove': {
      assert(s.menus.some(m => m.id === p.id), 'That menu was removed.');
      if (p.id === s.activeMenuId) {
        assert(orderer || host, 'Only the orderer or host can remove this round’s menu.');
        open();
      }
      const gone = new Set(s.menu.filter(i => i.menuId === p.id).map(i => i.id));
      s.menus = s.menus.filter(m => m.id !== p.id);
      s.menu = s.menu.filter(i => !gone.has(i.id));
      s.picks = s.picks.filter(pick => !gone.has(pick.itemId));
      if (s.activeMenuId === p.id) s.activeMenuId = s.menus[0]?.id || null;
      break;
    }
    case 'menu.activate': {
      // Picking where to order from is the orderer's (or host's) call.
      assert(orderer || host, 'Only the orderer or host can choose the menu for this round.');
      open();
      assert(s.menus.some(m => m.id === p.id), 'That menu was removed.');
      s.activeMenuId = p.id;
      const active = new Set(s.menu.filter(i => i.menuId === p.id).map(i => i.id));
      s.picks = s.picks.filter(pick => active.has(pick.itemId));
      break;
    }
    case 'menu.upsert': {
      assert(idString(p.id) && money(p.price) && CATEGORIES.includes(p.category) && popularity(p.popularity), 'Enter a valid item, price and category.');
      const index = s.menu.findIndex(i => i.id === p.id);
      // Old clients omit menuId: keep the item's menu, else use the active one.
      const menuId = p.menuId || s.menu[index]?.menuId || s.activeMenuId;
      assert(s.menus.some(m => m.id === menuId), 'Create a menu first.');
      assert(index < 0 || s.menu[index].menuId === menuId, 'Items cannot be moved between menus. Add a new item instead.');
      if (menuId === s.activeMenuId || s.menu[index]?.menuId === s.activeMenuId) open();
      const item = { id: p.id, name: text(p.name, 60, 'Item name'), price: p.price, category: p.category, menuId };
      const rank = p.popularity ?? s.menu[index]?.popularity;
      if (rank) item.popularity = rank;
      assert(index >= 0 || s.menu.filter(i => i.menuId === menuId).length < 200, 'A menu can contain up to 200 items.');
      if (index >= 0) s.menu[index] = item;
      else s.menu.push(item);
      break;
    }
    case 'item.price': {
      // Starter items cost 0: the host (or orderer) declares prices, also
      // while the order is locked, until the bill is entered.
      assert(host || orderer, 'Only the host or orderer can set prices.');
      assert(Array.isArray(p.prices) && p.prices.length <= 200, 'Invalid prices.');
      assert(s.group.status === 'open' || s.round.actualTotal === null, 'Unlock the order to change prices after the bill is entered.');
      for (const entry of p.prices) {
        const item = s.menu.find(i => i.id === entry?.id && i.menuId === s.activeMenuId);
        assert(item && money(entry.price), 'Enter a valid price.');
        item.price = entry.price;
      }
      break;
    }
    case 'menu.delete':
      if (s.menu.find(i => i.id === p.id)?.menuId === s.activeMenuId) open();
      s.menu = s.menu.filter(i => i.id !== p.id);
      s.picks = s.picks.filter(pick => pick.itemId !== p.id);
      break;
    case 'pick.set': {
      open();
      assert(s.menu.some(i => i.id === p.itemId && i.menuId === s.activeMenuId), 'That item isn’t on this round’s menu any more.');
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
      // null: no separate bill (e.g. menu prices already include GST); the total
      // is the sum of the picked items' prices.
      assert((p.actualTotal === null || money(p.actualTotal)) && ['equal', 'proportional'].includes(p.splitMode), 'Enter a valid bill and split mode.');
      assert(p.actualTotal === null || s.picks.length > 0 || p.actualTotal === 0, 'Add picks before splitting a bill.');
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
      s.history.push(roundRecord(s, p.date));
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
