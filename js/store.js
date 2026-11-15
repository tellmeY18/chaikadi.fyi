import { APP_VERSION, relayServers, DEFAULT_CONFIG, PRESETS, PROTOCOL_VERSION, uid, roomCode, validCode, validateConfig, funName } from './config.js';
import { newGroup, reduce, Persistence, migrate } from './state.js';
import { Network, PUBLIC_INTENTS } from './p2p.js';
import { orderableItems } from './data.js';
import { log, setVerbose } from './netlog.js';

export const LINK_TIMEOUT_MS = 45000, RESUME_GRACE_MS = 15000, OFFLINE_DELAY_MS = 8000;

const copy = value => JSON.parse(JSON.stringify(value));
const sameText = (a, b) => a.normalize('NFKC').toLowerCase() === b.normalize('NFKC').toLowerCase();

// Framework-agnostic application store. UI only subscribes and calls actions.
export class AppStore {
  constructor() {
    this.listeners = new Set(); this.queue = Promise.resolve();
    this.data = { identity: { id: uid(), token: uid(), name: '' }, config: copy(DEFAULT_CONFIG),
      state: null, role: null, targetCode: '', outbox: [], credentials: {}, revoked: [], preferences: { theme: 'auto', installDismissed: false } };
    this.ui = { tab: 'lobby', status: 'Ready', notice: '', storageWarning: '', unreachable: false,
      hostOnline: false, suggested: null, shuffling: false, ready: false, blocked: false };
    this.db = new Persistence(message => { this.ui.storageWarning = message; this.emit(); });
    this.network = new Network({
      onMessage: (link, msg) => this.serial(() => this.receive(link, msg)),
      onLink: (link, online) => this.serial(() => this.linkChanged(link, online)),
      onStatus: message => { this.ui.status = message; if (this.network.roomReady) this.freshRoom = false; this.emit(); },
      onUnreachable: () => { this.ui.unreachable = true; this.emit(); },
      onCollision: () => this.serial(() => this.collision()),
    });
  }
  subscribe(fn) { this.listeners.add(fn); fn(this.view()); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this.view()); }
  view() {
    let state = this.data.state;
    for (const intent of this.data.outbox) {
      try { state = reduce(state, intent); } catch { /* conflicts are reported after full host sync */ }
    }
    return { ...this.ui, state, identity: this.data.identity, role: this.data.role,
      config: this.data.config, pending: this.data.outbox.length, targetCode: this.data.targetCode,
      roomReady: this.network.roomReady, preferences: this.data.preferences || { theme: 'auto', installDismissed: false } };
  }
  serial(fn) {
    const result = this.queue.catch(() => {}).then(fn);
    this.queue = result.catch(error => { this.notice(error.message); return false; });
    return this.queue;
  }
  notice(message) { this.ui.notice = message; this.emit(); }
  toast(message) {
    clearTimeout(this.toastTimer); this.ui.toast = message; this.emit();
    if (message) this.toastTimer = setTimeout(() => { this.ui.toast = ''; this.emit(); }, 6000);
  }
  async preferences(patch) {
    this.data.preferences = { theme: 'auto', installDismissed: false, ...this.data.preferences, ...patch };
    await this.persist(); this.emit();
  }
  // Developer options: verbose logging, relay choice, force relay. Changing how
  // to connect restarts the room connection with the new settings.
  async devOptions(patch) {
    const before = this.data.preferences?.dev || {};
    const dev = { ...before, ...patch };
    setVerbose(dev.verbose);
    await this.preferences({ dev });
    const reconnect = ['relay', 'custom', 'forceRelay'].some(k => JSON.stringify(before[k]) !== JSON.stringify(dev[k]));
    if (reconnect && this.data.role && this.data.targetCode && !this.ui.blocked) { log('info', 'reconnecting with new connection settings'); this.startRoom(); }
  }
  async persist() { await this.db.save(this.data); }
  async boot(code = '') {
    await this.db.open();
    const saved = await this.db.load();
    if (saved?.identity && saved.config && (!saved.state || saved.state.schema === 1)) this.data = saved;
    if (!this.data.identity.name) this.data.identity.name = funName();
    setVerbose(this.data.preferences?.dev?.verbose);
    log('info', `app start ${APP_VERSION}`, { browser: globalThis.navigator?.userAgent, webrtc: typeof globalThis.RTCPeerConnection === 'function', online: globalThis.navigator?.onLine });
    this.data.state = migrate(this.data.state);
    this.ui.blocked = !!this.data.removed;
    if (this.ui.blocked) this.ui.notice = 'You were removed from this group. Your saved history is available; leave in Settings to start again.';
    if (!this.data.state && validCode(code)) this.data.targetCode = code;
    else if (this.data.state && validCode(code) && code !== this.data.state.group.roomCode) {
      this.ui.notice = `This link is for ${code}. You have a saved group; leave it in Settings before joining another.`;
    }
    if (this.data.role === 'host' && this.data.state) {
      // Presence is transient: never restore stale green dots from disk.
      for (const member of this.data.state.members) member.online = member.id === this.data.identity.id;
      this.data.state.group.version++;
      this.ui.hostOnline = true;
    }
    this.ui.ready = true; this.emit();
    await this.persist();
    // Groups saved before the basic menu shipped get it once, if they have no menus.
    if (this.data.role === 'host' && this.data.state && !this.data.state.menus.length) await this.presets().catch(() => {});
    if (this.data.role && this.data.targetCode) this.startRoom();
    this.heartbeat = setInterval(() => this.tick(), 5000);
    // Invite link with no saved group: join straight away with the prefilled
    // name. Zero taps; the name can be changed later in Settings.
    if (!this.data.state && !this.data.role && validCode(code)) {
      await this.join(code, this.data.identity.name).catch(error => this.notice(error.message));
    }
  }
  rerollName() { this.data.identity.name = funName(); this.emit(); return this.data.identity.name; }
  setTab(tab) { this.ui.tab = tab; this.emit(); }
  resetConnection() {
    if (this.data.state) return;
    this.network.stop(); this.data.targetCode = ''; this.data.role = null;
    this.ui.hostOnline = false; this.ui.status = 'Ready'; this.emit();
    return this.persist();
  }
  setInvitation(code) {
    if (!validCode(code) || this.data.state) throw new Error('Invalid room invitation.');
    this.data.targetCode = code; this.emit();
  }
  async create(name, displayName, { starter = true } = {}) {
    if (this.data.state) throw new Error('Leave your current group in Settings first.');
    const code = roomCode(), id = this.data.identity.id;
    this.data.state = newGroup({ id: uid(), code, name, memberId: id, memberName: displayName, roundId: uid() });
    this.data.identity.name = displayName.trim();
    Object.assign(this.data, { role: 'host', targetCode: code, outbox: [], credentials: {}, revoked: [], removed: false });
    this.data.credentials[id] = this.data.identity.token;
    this.ui.hostOnline = true; this.ui.tab = 'lobby'; this.freshRoom = true; this.collisions = 0;
    await this.persist(); this.emit();
    if (starter) await this.presets();
    this.startRoom();
    this.emit();
  }
  async join(code, name) {
    code = code.trim().toUpperCase(); name = name.trim();
    if (!validCode(code)) throw new Error('Enter a four-character room code (no 0, O, 1, I or L).');
    if (!name || name.length > 30) throw new Error('Enter a display name of 1–30 characters.');
    if (this.data.state) throw new Error('Leave your current group in Settings first.');
    this.network.stop();
    Object.assign(this.data, { role: 'member', targetCode: code, outbox: [], removed: false });
    this.data.identity.name = name; this.ui.blocked = false;
    await this.persist(); this.emit();
    this.startRoom();
  }
  startRoom() {
    if (this.ui.blocked) return;
    const dev = this.data.preferences?.dev || {};
    const config = { ...this.data.config, iceServers: [...(this.data.config.iceServers || []), ...relayServers(dev)], iceTransportPolicy: dev.forceRelay ? 'relay' : 'all' };
    this.network.start({ host: this.data.role === 'host', code: this.data.targetCode, config, fresh: !!this.freshRoom });
  }
  async collision() {
    if (this.freshRoom && (this.collisions || 0) < 8) {
      this.collisions = (this.collisions || 0) + 1;
      await this.applyHost(this.intent('group.code', { code: roomCode() }));
      this.data.targetCode = this.data.state.group.roomCode;
      await this.persist(); this.startRoom();
    } else this.notice('That room code is already registered. Close any duplicate host tab, wait a moment, then Retry. Or generate a new room code in Settings.');
  }
  intent(type, payload) {
    return { id: uid(), type, payload, senderId: this.data.identity.id,
      version: this.data.state?.group.version || 0, roundId: this.data.state?.round.id };
  }
  dispatch(type, payload) {
    return this.serial(async () => {
      if (this.ui.blocked) throw new Error('You were removed from this group. Leave it in Settings to start again.');
      if (!PUBLIC_INTENTS.has(type)) throw new Error('Unsupported action.');
      const intent = this.intent(type, typeof payload === 'function' ? payload(this.view().state) : payload);
      if (this.data.role === 'host') await this.applyHost(intent);
      else {
        reduce(this.view().state, intent); // validation before optimistic preview
        if (this.data.outbox.length >= 500) throw new Error('500 offline changes are waiting. Reconnect before making more changes.');
        this.data.outbox.push(intent); await this.persist(); this.emit(); this.flush();
      }
      return true;
    });
  }
  changePick(itemId, delta) {
    return this.dispatch('pick.set', state => {
      const current = state.picks.find(p => p.memberId === this.data.identity.id && p.itemId === itemId);
      return { itemId, qty: Math.max(0, Math.min(99, (current?.qty || 0) + delta)), note: current?.note || '' };
    });
  }
  saveNote(itemId, note) {
    return this.dispatch('pick.set', state => {
      const current = state.picks.find(p => p.memberId === this.data.identity.id && p.itemId === itemId);
      if (!current) throw new Error('Add this item to your picks before saving a note.');
      return { itemId, qty: current.qty, note };
    });
  }
  async applyHost(intent) {
    const savedData = copy(this.data);
    const previous = this.data.state;
    const next = reduce(previous, intent);
    this.data.state = next;
    if (intent.type === 'member.remove') {
      if (!this.data.revoked.includes(intent.payload.id)) this.data.revoked.push(intent.payload.id);
      delete this.data.credentials[intent.payload.id];
    }
    this.syncName();
    try { await this.persist(); }
    catch (error) { this.data = savedData; this.emit(); throw error; }
    if (intent.type === 'member.remove') for (const link of [...this.network.links.values()]) {
      if (link.memberId === intent.payload.id) {
        this.network.send(link, { type: 'removed', payload: {}, senderId: next.group.hostId, version: next.group.version });
        setTimeout(() => this.network.dropLink(link), 200);
      }
    }
    this.emit(); this.broadcast(); return next;
  }
  syncName() {
    const me = this.data.state?.members.find(m => m.id === this.data.identity.id);
    if (me) this.data.identity.name = me.name;
  }
  sendState(link, ack = null, error = null) {
    this.network.send(link, { type: 'state', senderId: this.data.identity.id, version: this.data.state.group.version,
      payload: { state: this.data.state, ack, error, protocol: PROTOCOL_VERSION } });
  }
  broadcast() {
    if (this.data.role !== 'host' || !this.data.state) return;
    for (const link of this.network.links.values()) if (link.memberId && this.data.state.members.some(m => m.id === link.memberId)) this.sendState(link);
  }
  hello(link) {
    this.network.send(link, { type: 'hello', senderId: this.data.identity.id, version: this.data.state?.group.version || 0,
      payload: { name: this.data.identity.name, token: this.data.identity.token, groupId: this.data.state?.group.id || null, protocol: PROTOCOL_VERSION } });
  }
  async linkChanged(link, online, settled = false) {
    if (online) {
      if (this.data.role === 'member') this.hello(link);
      return;
    }
    // A reconnect usually follows within seconds: only show someone as
    // offline if they are still gone after OFFLINE_DELAY_MS.
    if (!settled) { setTimeout(() => this.serial(() => this.linkChanged(link, false, true)), OFFLINE_DELAY_MS); return; }
    log('debug', 'link still gone after the offline delay', { member: link.memberId?.slice(0, 8) });
    if (this.data.role === 'host' && link.memberId && this.data.state?.members.some(m => m.id === link.memberId) &&
        ![...this.network.links.values()].some(l => l.memberId === link.memberId)) {
      await this.applyHost(this.intent('member.online', { id: link.memberId, online: false }));
    } else if (this.data.role === 'member') {
      this.ui.hostOnline = [...this.network.links.values()].some(l => l.authenticated);
      if (!this.ui.hostOnline) this.ui.status = 'Host offline. Retrying…';
      this.emit();
    }
  }
  async receive(link, msg) {
    if (!this.network.links.has(link.id)) return;
    if (msg.type === 'ping') { this.network.send(link, { type: 'pong', payload: {}, version: 0, senderId: this.data.identity.id }); return; }
    if (msg.type === 'pong') return;
    if (this.data.role === 'host') {
      if (msg.type === 'hello') {
        const beforeHello = copy(this.data);
        try {
          if (msg.payload?.protocol !== PROTOCOL_VERSION) throw new Error('Update Chaikadi on both devices: close all app windows, reopen online, then join again. Your saved group is kept.');
          const { token, name, groupId } = msg.payload || {};
          const id = msg.senderId;
          if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || id === this.data.identity.id ||
              typeof token !== 'string' || token.length < 20 || token.length > 100) throw new Error('Invalid member identity.');
          if (this.data.revoked.includes(id)) throw new Error('You were removed from this group.');
          if (groupId && groupId !== this.data.state.group.id) throw new Error('This room now belongs to a different group. Leave the saved group before joining it.');
          if (this.data.credentials[id]) {
            if (this.data.credentials[id] !== token) throw new Error('This member identity belongs to another device.');
          } else {
            // Auto-resolve name clashes ("Sunny Otter 2") instead of bouncing the joiner.
            let unique = typeof name === 'string' ? name.trim().slice(0, 27) || 'Guest' : 'Guest';
            const taken = n => this.data.state.members.some(m => m.name.normalize('NFKC').toLowerCase() === n.normalize('NFKC').toLowerCase());
            for (let i = 2; taken(unique) && i < 99; i++) unique = `${unique.replace(/ \d+$/, '')} ${i}`;
            const next = reduce(this.data.state, this.intent('member.join', { id, name: unique }));
            this.data.credentials[id] = token; this.data.state = next;
          }
          // Mark authenticated only after identity validation. Replace an old
          // suspended connection rather than counting a reconnect twice.
          link.memberId = id;
          for (const old of [...this.network.links.values()]) if (old.id !== link.id && old.memberId === id) this.network.dropLink(old);
          if (!this.data.state.members.find(m => m.id === id)?.online) {
            this.data.state = reduce(this.data.state, this.intent('member.online', { id, online: true }));
          }
          await this.persist(); this.sendState(link); this.broadcast(); this.emit();

        } catch (error) {
          this.data = beforeHello; link.memberId = null;
          this.network.send(link, { type: 'rejected', payload: { message: error.message, removed: this.data.revoked.includes(msg.senderId) }, version: 0, senderId: this.data.identity.id });
          setTimeout(() => this.network.dropLink(link), 300);
        }
        return;
      }
      if (!link.memberId) return;
      if (msg.type === 'sync') { this.sendState(link); return; }
      if (msg.type !== 'intent') return;
      const intent = msg.payload;
      if (!intent || !PUBLIC_INTENTS.has(intent.type) || intent.senderId !== link.memberId) return;
      // Bind identity to the authenticated channel, never trust an envelope ID.
      try {
        await this.applyHost({ ...intent, senderId: link.memberId });
        this.sendState(link, intent.id);
      } catch (error) { this.sendState(link, intent.id, error.message); }
    } else if (this.data.role === 'member') {
      if (msg.type === 'removed') {
        this.ui.blocked = true; this.data.removed = true; this.data.outbox = []; this.ui.hostOnline = false;
        this.network.stop(); await this.persist(); this.notice('The host removed you from this group. Your saved history is still available.'); return;
      }
      if (msg.type === 'rejected') {
        this.network.stop(); this.ui.hostOnline = false;
        if (msg.payload?.removed) { this.data.removed = true; this.ui.blocked = true; this.data.outbox = []; await this.persist(); }
        this.notice(msg.payload?.message || 'The host could not accept this connection.'); return;
      }
      if (msg.type !== 'state') return;
      if (msg.payload?.protocol !== PROTOCOL_VERSION) {
        this.network.stop(); this.ui.hostOnline = false;
        this.notice('The host needs the current Chaikadi version. Close all app windows on both devices and reopen online, then join again. Your saved group is kept.');
        return;
      }
      const incoming = migrate(msg.payload?.state);
      if (incoming?.schema !== 1 || !incoming.group || incoming.group.hostId !== msg.senderId ||
          !Number.isSafeInteger(incoming.group.version) || !Array.isArray(incoming.members) || !Array.isArray(incoming.menu) ||
          !Array.isArray(incoming.picks) || !Array.isArray(incoming.history) || !Array.isArray(incoming.receipts) || !incoming.round ||
          !incoming.members.some(m => m.id === this.data.identity.id)) return;
      if (this.data.state && incoming.group.id !== this.data.state.group.id) { this.notice('A different group is using that code. Your saved group has been kept.'); return; }
      if (this.data.state && incoming.group.version < this.data.state.group.version) return;
      const firstSync = !this.data.state;
      link.authenticated = true;

      this.data.state = incoming;
      this.data.targetCode = incoming.group.roomCode;
      this.network.code = incoming.group.roomCode;
      this.data.outbox = this.data.outbox.filter(i => i.id !== msg.payload.ack && !incoming.receipts.includes(i.id));
      this.ui.hostOnline = true; this.ui.unreachable = false; this.ui.status = 'Connected to host'; log('info', 'synced with host', { version: incoming.group.version });
      this.syncName(); await this.persist();
      if (firstSync) this.ui.tab = incoming.menu.length ? 'picks' : 'menu'; // joiners land where the action is
      this.emit();
      if (msg.payload.error) this.notice(`A queued change was not applied: ${msg.payload.error}`);
      this.flush();
    }
  }
  flush() {
    if (this.data.role !== 'member' || !this.data.outbox.length) return;
    const link = [...this.network.links.values()].find(l => l.authenticated);
    if (!link) return;
    // Send one at a time; each ack/full state confirms the next base state.
    const intent = this.data.outbox[0];
    if (this.inflight?.id === intent.id && Date.now() - this.inflight.time < 4000) return;
    this.inflight = { id: intent.id, time: Date.now() };
    this.network.send(link, { type: 'intent', payload: intent, version: this.data.state.group.version, senderId: this.data.identity.id });
  }
  // Liveness: ping every 5 s; a link is dropped only after LINK_TIMEOUT_MS of
  // silence while this app is visible. Phones throttle or freeze timers in the
  // background, so silence then (or just after waking up) is not a dead peer:
  // after foreground() the peer gets RESUME_GRACE_MS to answer a fresh ping.
  tick(now = Date.now()) {
    const grace = this.hidden || now - (this.resumedAt || 0) < RESUME_GRACE_MS;
    for (const link of [...this.network.links.values()]) {
      if (!grace && now - link.lastSeen > LINK_TIMEOUT_MS) { log('warn', `no reply for ${Math.round((now - link.lastSeen) / 1000)} s, dropping link`); this.network.dropLink(link); continue; }
      this.network.send(link, { type: 'ping', payload: {}, version: 0, senderId: this.data.identity.id });
    }
    this.flush();
  }
  background() { this.hidden = true; log('debug', 'app hidden'); }
  foreground() {
    this.hidden = false; this.resumedAt = Date.now(); log('debug', 'app visible');
    this.tick(); this.network.resume();
    for (const link of this.network.links.values()) {
      if (this.data.role === 'member') this.network.send(link, { type: 'sync', payload: {}, senderId: this.data.identity.id, version: this.data.state?.group.version || 0 });
    }
  }
  uniqueMenuName(base) {
    const taken = new Set(this.view().state.menus.map(m => m.name.normalize('NFKC').toLowerCase()));
    let name = (base || 'Menu').trim().slice(0, 55) || 'Menu';
    for (let n = 2; taken.has(name.normalize('NFKC').toLowerCase()); n++) name = `${(base || 'Menu').trim().slice(0, 55)} ${n}`;
    return name;
  }
  async newMenu(name, source) {
    const id = uid();
    await this.dispatch('menu.create', source ? { id, name: this.uniqueMenuName(name), source } : { id, name: this.uniqueMenuName(name) });
    return this.view().state.menus.some(m => m.id === id) ? id : null;
  }
  // Import a (sanitised) library place. Modes:
  //  'new'     – a new saved menu linked to the place (default when not linked yet)
  //  'replace' – make the linked menu match the library: same-name items keep their
  //              id (picks survive) and get library prices; items not in the
  //              library are removed
  //  'add'     – only add items the linked menu does not have yet
  async importLibraryPlace(place, city, mode = 'new') {
    // Group menus are flat and need a price: variants become "Name (Half)",
    // unpriced and unavailable items are skipped. Library categories map onto
    // the app's four (drinks are "Tea", desserts are "Snacks").
    const APP_CATEGORY = { Tea: 'Tea', Coffee: 'Tea', Drinks: 'Tea', Snacks: 'Snacks', Dessert: 'Snacks', Meal: 'Meal', Other: 'Other' };
    const items = [];
    for (const item of orderableItems(place)) {
      const name = item.name.slice(0, 60).trim();
      if (items.some(i => sameText(i.name, name))) continue;
      items.push({ name, category: APP_CATEGORY[item.category] || 'Other', price: Math.round(item.price * 100), libraryCategory: item.category });
    }
    const source = { placeId: place.id, city, name: place.name, lastConfirmed: place.last_confirmed, sample: place.sample === true,
      items: items.map(i => ({ name: i.name, category: i.libraryCategory, price: i.price })) };
    const linked = this.view().state.menus.find(m => m.source?.placeId === place.id);
    if (mode === 'new' || !linked) {
      const menuId = await this.newMenu(place.name, source);
      if (!menuId) return { menuId: null, added: 0, updated: 0, removed: 0 };
      const result = await this.importMenu(items, { menuId });
      return { ...result, removed: 0 };
    }
    const result = await this.importMenu(items, { menuId: linked.id, skipExisting: mode === 'add' });
    let removed = 0;
    if (mode === 'replace') {
      for (const item of this.view().state.menu.filter(i => i.menuId === linked.id && !items.some(x => sameText(x.name, i.name)))) {
        if (!await this.dispatch('menu.delete', { id: item.id })) throw new Error('Some items could not be removed. Check the message above.');
        removed++;
      }
    }
    if (!await this.dispatch('menu.source', { id: linked.id, source })) throw new Error('Could not record where this menu came from.');
    return { ...result, removed, menuId: linked.id };
  }

  // Scanned/imported items go into `menuId` (a new menu named after the
  // scanned heading when omitted). Same-name items in that menu are updated
  // in place, keeping their id so existing picks survive.
  async importMenu(items, { menuId, title, skipExisting = false } = {}) {
    const auto = /^Menu( \d+)?$/;
    let target = menuId && this.view().state.menus.find(m => m.id === menuId);
    if (!target) target = { id: await this.newMenu(title || 'Menu') };
    else if (title && auto.test(target.name) && !this.view().state.menu.some(i => i.menuId === target.id)) {
      await this.dispatch('menu.rename', { id: target.id, name: this.uniqueMenuName(title) });
    }
    if (!target.id) return { added: 0, updated: 0, menuId: null };
    let added = 0, updated = 0;
    for (const item of items) {
      const existing = this.view().state.menu.find(i => i.menuId === target.id && i.name.normalize('NFKC').toLowerCase() === item.name.trim().normalize('NFKC').toLowerCase());
      if (existing && skipExisting) continue;
      const saved = await this.dispatch('menu.upsert', { id: existing?.id || uid(), menuId: target.id, name: item.name, price: item.price, category: item.category,
        ...(item.popularity ? { popularity: item.popularity } : {}) });
      if (!saved) throw new Error('Some items could not be saved. Check the message above and try again.');
      existing ? updated++ : added++;
    }
    return { added, updated, menuId: target.id };
  }
  // The basic menu: generic items at price 0, most-ordered first.
  presets(menuId) {
    return this.importMenu(PRESETS.map(([name, category, popularity]) => ({ name, category, price: 0, popularity })), { menuId, title: 'Basic menu', skipExisting: true });
  }
  // Wipe this device's group (menus, picks, history, members) and host a
  // brand-new one with the basic menu. Identity and preferences are kept.
  async newSession(groupName, displayName = this.data.identity.name) {
    await this.leave();
    await this.create(groupName, displayName);
  }
  suggest(reducedMotion = false) {
    const state = this.view().state;
    const menu = state?.menu.filter(i => i.menuId === state.activeMenuId);
    if (!menu?.length) { this.notice('Add a few menu items first.'); return; }
    if (this.ui.shuffling) return;
    this.ui.shuffling = true; this.emit(); let count = 0;
    const delays = reducedMotion ? [300] : [50, 70, 90, 110, 150, 190, 240, 300];
    const strike = () => {
      this.ui.suggested = menu[crypto.getRandomValues(new Uint32Array(1))[0] % menu.length].id;
      if (++count >= delays.length) this.ui.shuffling = false;
      else setTimeout(strike, delays[count]);
      this.emit();
    };
    setTimeout(strike, delays[0]);
  }
  async settings(config) {
    this.data.config = validateConfig(config);
    await this.persist();
    this.toast('Connection settings saved. They apply to new connections.');
  }
  async regenerateCode() {
    if (this.data.role !== 'host') return;
    await this.dispatchInternalCode(roomCode());
    this.freshRoom = true; this.collisions = 0; this.startRoom();
  }
  async dispatchInternalCode(code) {
    await this.serial(async () => {
      this.data.targetCode = code;
      await this.applyHost(this.intent('group.code', { code }));
    });
  }
  async leave() {
    this.network.stop();
    Object.assign(this.data, { state: null, role: null, targetCode: '', outbox: [], credentials: {}, revoked: [], removed: false });
    Object.assign(this.ui, { hostOnline: false, tab: 'lobby', blocked: false, unreachable: false, notice: '', status: 'Ready' });
    await this.persist(); this.emit();
  }
  backup() { return JSON.stringify({ app: 'chaikadi.fyi', exportedAt: new Date().toISOString(), data: this.data }, null, 2); }
}
