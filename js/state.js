/* ============================================================
   state.js — the game save, plus every mutation that touches it
   ============================================================ */

import { Persist } from './persist.js';
import {
  DB, species, familyRoot, familyRarity,
  candyForCapture, dustForCapture, xpForCapture,
  XP_ON_EVOLVE, CANDY_ON_DELETE, levelUpCost, MAX_CREATURE_LEVEL,
  playerProgress
} from './data.js';

export const SAVE_VERSION = 1;

function blankState() {
  return {
    version: SAVE_VERSION,
    createdAt: Date.now(),
    xp: 0,
    stardust: 0,
    candy: {},         // familyRootId -> candy count
    storage: [],       // individual creatures
    registered: {},    // speciesId -> timestamp first registered
    spawns: [],        // live spawns (persisted across sessions)
    stats: { captures: 0, evolutions: 0, deletes: 0, levelUps: 0, scans: 0 },
    lastScanAt: 0,
    nextUid: 1,
    debug: { enabled: false, lat: null, lng: null, ignoreRange: false, showPois: false },
    ui: { storageSort: 'id', storageDir: 1, filterType: '', filterStage: '', filterRarity: '', setIndex: 0 }
  };
}

/* Fill in anything a newer version added, and drop nonsense. */
function migrate(raw) {
  const base = blankState();
  if (!raw || typeof raw !== 'object') return base;
  const s = {
    ...base, ...raw,
    candy: { ...(raw.candy || {}) },
    registered: { ...(raw.registered || {}) },
    stats: { ...base.stats, ...(raw.stats || {}) },
    debug: { ...base.debug, ...(raw.debug || {}) },
    ui: { ...base.ui, ...(raw.ui || {}) },
    storage: Array.isArray(raw.storage) ? raw.storage : [],
    spawns: Array.isArray(raw.spawns) ? raw.spawns : []
  };
  s.version = SAVE_VERSION;
  s.xp = Number(s.xp) || 0;
  s.stardust = Number(s.stardust) || 0;

  // Drop creatures whose species no longer exists in the CSV.
  s.storage = s.storage.filter(c => c && c.speciesId && DB.byId.has(c.speciesId)).map(c => ({
    uid: c.uid,
    speciesId: c.speciesId,
    level: Math.min(MAX_CREATURE_LEVEL, Math.max(1, Number(c.level) || 1)),
    capturedAt: Number(c.capturedAt) || Date.now(),
    dustSpent: Number(c.dustSpent) || 0,
    evolvedAt: c.evolvedAt || null,
    origin: c.origin || null
  }));
  // Same for spawns, and forget anything already expired.
  const now = Date.now();
  s.spawns = s.spawns.filter(sp =>
    sp && sp.id && DB.byId.has(sp.speciesId) &&
    Number(sp.expiresAt) > now &&
    isFinite(sp.lat) && isFinite(sp.lng)
  );
  for (const k of Object.keys(s.registered)) if (!DB.byId.has(k)) delete s.registered[k];
  for (const k of Object.keys(s.candy)) if (!DB.byId.has(k)) delete s.candy[k];

  // Repair uid counter.
  let maxUid = 0;
  for (const c of s.storage) {
    const n = Number(String(c.uid).replace(/\D/g, '')) || 0;
    if (n > maxUid) maxUid = n;
  }
  s.nextUid = Math.max(Number(s.nextUid) || 1, maxUid + 1);
  return s;
}

/* ---------------------------------------------------------------
   Store
   --------------------------------------------------------------- */
class Store {
  constructor() {
    this.s = blankState();
    this.listeners = new Set();
    this._saveTimer = null;
    this._saving = false;
    this._dirty = false;
    this.lastSavedAt = 0;
    this.loadedFrom = 'none';
  }

  /* --- plumbing --- */

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(reason = 'change') {
    for (const fn of this.listeners) { try { fn(this.s, reason); } catch (e) { console.error(e); } }
  }

  /** Mark dirty, notify the UI, and schedule a debounced write. */
  touch(reason = 'change', { immediate = false } = {}) {
    this._dirty = true;
    this.emit(reason);
    if (immediate) return this.flush();
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.flush(), 700);
  }

  async flush() {
    clearTimeout(this._saveTimer);
    if (this._saving) { this._pendingFlush = true; return; }
    this._saving = true;
    try {
      this.lastSavedAt = await Persist.writeNow(this.s);
      this._dirty = false;
    } catch (e) {
      console.error('[state] save failed', e);
    } finally {
      this._saving = false;
      if (this._pendingFlush) { this._pendingFlush = false; this.flush(); }
    }
  }

  async load() {
    const { data, source } = await Persist.load();
    this.s = migrate(data);
    this.loadedFrom = source;
    this.emit('load');
    return source;
  }

  /** Replace the whole save (import / restore). */
  async replace(raw) {
    this.s = migrate(raw);
    await this.flush();
    this.emit('load');
  }

  async reset() {
    this.s = blankState();
    await this.flush();
    this.emit('load');
  }

  /* --- derived values --- */

  get progress() { return playerProgress(this.s.xp); }
  get level() { return this.progress.level; }

  candyFor(speciesId) { return this.s.candy[familyRoot(speciesId)] || 0; }

  isRegistered(speciesId) { return !!this.s.registered[speciesId]; }

  get registeredCount() { return Object.keys(this.s.registered).length; }

  creature(uid) { return this.s.storage.find(c => c.uid === uid) || null; }

  countOfSpecies(speciesId) { return this.s.storage.filter(c => c.speciesId === speciesId).length; }

  /* --- resources --- */

  addXP(amount) {
    const before = this.level;
    this.s.xp = Math.max(0, this.s.xp + amount);
    const after = this.level;
    return { levelledUp: after > before, from: before, to: after };
  }

  addStardust(n) { this.s.stardust = Math.max(0, this.s.stardust + n); }

  addCandy(speciesId, n) {
    const root = familyRoot(speciesId);
    this.s.candy[root] = Math.max(0, (this.s.candy[root] || 0) + n);
    return this.s.candy[root];
  }

  spendCandy(speciesId, n) {
    const root = familyRoot(speciesId);
    const have = this.s.candy[root] || 0;
    if (have < n) return false;
    this.s.candy[root] = have - n;
    return true;
  }

  /** Registers a species; returns true when it is the first time. */
  register(speciesId) {
    if (this.s.registered[speciesId]) return false;
    this.s.registered[speciesId] = Date.now();
    return true;
  }

  newUid() { return `c${this.s.nextUid++}`; }

  /* --- capture --- */

  /**
   * Applies every reward for capturing a spawn.
   * @returns {{creature, sp, isNew, candy, dust, xp, candyTotal, levelUp}}
   */
  capture(spawnOrSpeciesId, origin = null) {
    const speciesId = typeof spawnOrSpeciesId === 'string' ? spawnOrSpeciesId : spawnOrSpeciesId.speciesId;
    const sp = species(speciesId);
    if (!sp) throw new Error('Unknown creature: ' + speciesId);

    const rarity = sp.rarity || familyRarity(sp.id) || 1;
    const candy = candyForCapture(rarity);
    const dust = dustForCapture(rarity);
    const xp = xpForCapture(rarity);

    const creature = {
      uid: this.newUid(),
      speciesId: sp.id,
      level: 1,
      capturedAt: Date.now(),
      dustSpent: 0,
      evolvedAt: null,
      origin
    };
    this.s.storage.push(creature);

    const isNew = this.register(sp.id);
    const candyTotal = this.addCandy(sp.id, candy);
    this.addStardust(dust);
    const levelUp = this.addXP(xp);
    this.s.stats.captures++;

    this.touch('capture', { immediate: true });
    return { creature, sp, isNew, candy, dust, xp, candyTotal, levelUp, rarity };
  }

  /* --- level up --- */

  canLevelUp(uid) {
    const c = this.creature(uid);
    if (!c) return { ok: false, reason: 'missing' };
    if (c.level >= MAX_CREATURE_LEVEL) return { ok: false, reason: 'max', cost: null };
    const cost = levelUpCost(c.level);
    if (this.s.stardust < cost) return { ok: false, reason: 'dust', cost, short: cost - this.s.stardust };
    return { ok: true, cost };
  }

  levelUp(uid) {
    const check = this.canLevelUp(uid);
    if (!check.ok) return check;
    const c = this.creature(uid);
    this.s.stardust -= check.cost;
    c.level += 1;
    c.dustSpent += check.cost;
    this.s.stats.levelUps++;
    this.touch('levelup', { immediate: true });
    return { ok: true, cost: check.cost, level: c.level };
  }

  /* --- evolution --- */

  canEvolve(uid) {
    const c = this.creature(uid);
    if (!c) return { ok: false, reason: 'missing' };
    const sp = species(c.speciesId);
    if (!sp?.evolvesToId) return { ok: false, reason: 'final' };
    const cost = sp.evolutionCandy || 0;
    const have = this.candyFor(sp.id);
    if (have < cost) return { ok: false, reason: 'candy', cost, have, short: cost - have };
    return { ok: true, cost, have, target: species(sp.evolvesToId) };
  }

  /**
   * Performs the evolution. Candy is spent from the shared family pool,
   * the creature's level carries over, and the new form gets registered.
   */
  evolve(uid) {
    const check = this.canEvolve(uid);
    if (!check.ok) return check;
    const c = this.creature(uid);
    const from = species(c.speciesId);
    const to = species(from.evolvesToId);

    this.spendCandy(from.id, check.cost);
    c.speciesId = to.id;
    c.evolvedAt = Date.now();

    const isNew = this.register(to.id);
    const xp = XP_ON_EVOLVE[from.stage] ?? 30;
    const levelUp = this.addXP(xp);
    this.s.stats.evolutions++;

    this.touch('evolve', { immediate: true });
    return {
      ok: true, from, to, isNew, xp, levelUp,
      cost: check.cost,
      candyLeft: this.candyFor(to.id),
      level: c.level
    };
  }

  /* --- delete --- */

  /** Releasing a creature returns one candy to its family. */
  remove(uid) {
    const i = this.s.storage.findIndex(c => c.uid === uid);
    if (i === -1) return { ok: false };
    const [c] = this.s.storage.splice(i, 1);
    const sp = species(c.speciesId);
    const total = this.addCandy(c.speciesId, CANDY_ON_DELETE);
    this.s.stats.deletes++;
    this.touch('delete', { immediate: true });
    return { ok: true, sp, candy: CANDY_ON_DELETE, candyTotal: total, familyRootId: familyRoot(c.speciesId) };
  }

  /* --- spawns --- */

  get spawns() { return this.s.spawns; }

  activeSpawns(now = Date.now()) { return this.s.spawns.filter(s => s.expiresAt > now); }

  spawn(id) { return this.s.spawns.find(s => s.id === id) || null; }

  /** Removes expired spawns; returns the ones that just went. */
  pruneExpired(now = Date.now()) {
    const gone = this.s.spawns.filter(s => s.expiresAt <= now);
    if (gone.length) {
      this.s.spawns = this.s.spawns.filter(s => s.expiresAt > now);
      this.touch('despawn');
    }
    return gone;
  }

  addSpawns(list) {
    if (!list.length) return;
    this.s.spawns.push(...list);
    this.touch('spawned', { immediate: true });
  }

  removeSpawn(id) {
    const before = this.s.spawns.length;
    this.s.spawns = this.s.spawns.filter(s => s.id !== id);
    if (this.s.spawns.length !== before) this.touch('despawn');
  }

  clearSpawns() { this.s.spawns = []; this.touch('despawn', { immediate: true }); }

  setDebug(patch) { Object.assign(this.s.debug, patch); this.touch('debug'); }
  setUI(patch) { Object.assign(this.s.ui, patch); this.touch('ui'); }
}

export const store = new Store();
