/* ============================================================
   state.js — the game save, plus every mutation that touches it
   ============================================================ */

import { Persist } from './persist.js';
import {
  DB, species, familyRoot, familyRarity, familyChain,
  candyForCapture, dustForCapture, xpForCapture, dustBonusFor,
  XP_ON_EVOLVE, CANDY_ON_DELETE, levelUpCost, MAX_CREATURE_LEVEL,
  playerProgress, playerLevelFor, statsFor, rollStatModifier, rollMoveUnlock,
  rollShiny, chance, RULES, RAID_CAPTURE_LEVEL, RAID_CAPTURE_BONUS_CANDY,
  MISSIONS, DAILY_MISSIONS, breedingSlotsFor, breedingIntervalMs,
  BREEDING_CANDY_CAP, BREEDING_UNLOCK_LEVEL,
  dustInRange, weightedPick, GRUNT_REWARD, LEVEL_UP_REWARDS
} from './data.js';
import { ITEMS, item as itemDef } from './items.js';

export const SAVE_VERSION = 2;

/** Local calendar day key, used for daily missions. */
export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function blankState() {
  return {
    version: SAVE_VERSION,
    createdAt: Date.now(),
    nickname: null,

    xp: 0,
    stardust: 0,
    candy: {},          // familyRootId -> candy
    inventory: { capture_disc: 5 },      // start with 5 capturing discs
    storage: [],        // individual creatures
    registered: {},     // speciesId -> first registered at

    points: [],         // live map points of every kind
    effects: { incense: null, magnet: null },
    breeding: null,     // { lat, lng, placedAt, slots: [...] }

    missions: {},       // missionId -> { claimedAt }
    daily: { date: dayKey(), capturesToday: 0, claimed: {} },

    stats: {
      captures: 0, evolutions: 0, deletes: 0, levelUps: 0, scans: 0,
      raidsWon: 0, gruntsBeaten: 0, itemsCollected: 0, shinies: 0
    },

    lastScanAt: 0,
    nextUid: 1,
    debug: { enabled: false, lat: null, lng: null, ignoreRange: false, showPois: false, shinyBoost: false },
    ui: {
      storageTab: 'creatures', storageSort: 'id', storageDir: 1,
      filterType: '', filterStage: '', filterRarity: '', setIndex: 0
    }
  };
}

/* ---------------------------------------------------------------
   Creature helpers
   --------------------------------------------------------------- */

/** Full stat block for a stored creature, including its stat modifier. */
export function creatureStats(c) {
  const sp = species(c.speciesId);
  if (!sp) return { hp: 1, attack: 1, defence: 1, speed: 1 };
  return statsFor(sp, c.level, c.statMod);
}

export const maxHpOf = c => creatureStats(c).hp;

/** Current HP, treating a missing value as full health. */
export function hpOf(c) {
  const max = maxHpOf(c);
  if (c.hp == null) return max;
  return Math.max(0, Math.min(max, c.hp));
}

export const isFainted = c => hpOf(c) <= 0;
export const isHurt = c => hpOf(c) < maxHpOf(c);

/* ---------------------------------------------------------------
   Migration
   --------------------------------------------------------------- */
function migrate(raw) {
  const base = blankState();
  if (!raw || typeof raw !== 'object') return base;

  const s = {
    ...base, ...raw,
    candy: { ...(raw.candy || {}) },
    inventory: { ...(raw.inventory || {}) },
    registered: { ...(raw.registered || {}) },
    stats: { ...base.stats, ...(raw.stats || {}) },
    debug: { ...base.debug, ...(raw.debug || {}) },
    ui: { ...base.ui, ...(raw.ui || {}) },
    effects: { ...base.effects, ...(raw.effects || {}) },
    missions: { ...(raw.missions || {}) },
    daily: { ...base.daily, ...(raw.daily || {}) },
    storage: Array.isArray(raw.storage) ? raw.storage : [],
    // v1 saves called these "spawns" and they were always creatures
    points: Array.isArray(raw.points) ? raw.points
          : Array.isArray(raw.spawns) ? raw.spawns.map(p => ({ ...p, kind: p.kind || 'creature' }))
          : []
  };
  delete s.spawns;

  s.version = SAVE_VERSION;
  s.xp = Number(s.xp) || 0;
  s.stardust = Number(s.stardust) || 0;
  s.nickname = typeof s.nickname === 'string' && s.nickname.trim() ? s.nickname.trim() : null;

  // ---- creatures ----
  s.storage = s.storage
    .filter(c => c && c.speciesId && DB.byId.has(c.speciesId))
    .map(c => {
      const level = Math.min(MAX_CREATURE_LEVEL, Math.max(1, Number(c.level) || 1));
      const out = {
        uid: c.uid,
        speciesId: c.speciesId,
        level,
        capturedAt: Number(c.capturedAt) || Date.now(),
        dustSpent: Number(c.dustSpent) || 0,
        evolvedAt: c.evolvedAt || null,
        origin: c.origin || null,
        shiny: !!c.shiny,
        // Creatures caught before these systems existed get them assigned once.
        statMod: validStatMod(c.statMod) || rollStatModifier(),
        moveUnlock: validUnlock(c.moveUnlock) || { 3: 0, 4: 0 },
        breeding: c.breeding ?? null,
        hp: c.hp == null ? null : Math.max(0, Number(c.hp) || 0),
        favourite: !!c.favourite
      };
      // clamp stale HP against the current max
      const max = maxHpOf(out);
      if (out.hp != null && out.hp > max) out.hp = max;
      return out;
    });

  // ---- inventory ----
  for (const k of Object.keys(s.inventory)) {
    if (!ITEMS[k]) delete s.inventory[k];
    else s.inventory[k] = Math.max(0, Math.floor(Number(s.inventory[k]) || 0));
  }

  // ---- map points ----
  const now = Date.now();
  s.points = s.points.filter(p =>
    p && p.id && Number(p.expiresAt) > now && isFinite(p.lat) && isFinite(p.lng)
  ).map(p => ({
    ...p,
    kind: p.kind || 'creature',
    collected: !!p.collected
  })).filter(p => p.kind !== 'creature' || DB.byId.has(p.speciesId));

  for (const k of Object.keys(s.registered)) if (!DB.byId.has(k)) delete s.registered[k];
  for (const k of Object.keys(s.candy)) if (!DB.byId.has(k)) delete s.candy[k];

  // ---- effects: drop anything already finished ----
  for (const key of ['incense', 'magnet']) {
    const fx = s.effects[key];
    if (!fx || !(Number(fx.endsAt) > now)) s.effects[key] = null;
  }

  // ---- breeding ----
  if (s.breeding && (!isFinite(s.breeding.lat) || !isFinite(s.breeding.lng))) s.breeding = null;
  if (s.breeding) {
    s.breeding.slots = (Array.isArray(s.breeding.slots) ? s.breeding.slots : [])
      .filter(sl => sl && sl.speciesId && Array.isArray(sl.uids));
  }

  // ---- daily reset ----
  if (s.daily.date !== dayKey()) s.daily = { date: dayKey(), capturesToday: 0, claimed: {} };

  // ---- uid counter ----
  let maxUid = 0;
  for (const c of s.storage) {
    const n = Number(String(c.uid).replace(/\D/g, '')) || 0;
    if (n > maxUid) maxUid = n;
  }
  s.nextUid = Math.max(Number(s.nextUid) || 1, maxUid + 1);
  return s;
}

const STATS = ['hp', 'attack', 'defence', 'speed'];
function validStatMod(m) {
  if (!m || !STATS.includes(m.up) || !STATS.includes(m.down) || m.up === m.down) return null;
  return { up: m.up, down: m.down };
}
function validUnlock(u) {
  if (!u) return null;
  const three = Number(u[3] ?? u['3']) || 0;
  const four = Number(u[4] ?? u['4']) || 0;
  return { 3: Math.max(0, Math.min(3, three)), 4: Math.max(0, Math.min(3, four)) };
}

/* ===============================================================
   Store
   =============================================================== */
class Store {
  constructor() {
    this.s = blankState();
    this.listeners = new Set();
    this._saveTimer = null;
    this._saving = false;
    this.lastSavedAt = 0;
    this.loadedFrom = 'none';
  }

  /* ---------------- plumbing ---------------- */

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(reason = 'change') {
    for (const fn of this.listeners) { try { fn(this.s, reason); } catch (e) { console.error(e); } }
  }

  touch(reason = 'change', { immediate = false } = {}) {
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

  /* ---------------- player ---------------- */

  get progress() { return playerProgress(this.s.xp); }
  get level() { return this.progress.level; }
  get nickname() { return this.s.nickname; }

  setNickname(name) {
    const clean = String(name || '').trim().slice(0, 20);
    if (!clean) return false;
    this.s.nickname = clean;
    this.touch('nickname', { immediate: true });
    return true;
  }

  addXP(amount) {
    const before = this.level;
    this.s.xp = Math.max(0, this.s.xp + amount);
    const after = this.level;
    const levelledUp = after > before;
    const rewards = [];
    if (levelledUp) {
      // Grant rewards for every level gained (handles multi-level jumps)
      for (let l = before + 1; l <= after; l++) {
        for (const [id, n] of Object.entries(LEVEL_UP_REWARDS.every)) this.addItem(id, n);
        const special = LEVEL_UP_REWARDS.special[l];
        if (special) for (const [id, n] of Object.entries(special)) this.addItem(id, n);
      }
      rewards.push(...Object.entries(LEVEL_UP_REWARDS.every).map(([id, n]) => ({ id, n: n * (after - before) })));
      for (let l = before + 1; l <= after; l++) {
        const special = LEVEL_UP_REWARDS.special[l];
        if (special) rewards.push(...Object.entries(special).map(([id, n]) => ({ id, n })));
      }
    }
    return { levelledUp, from: before, to: after, rewards };
  }

  addStardust(n) { this.s.stardust = Math.max(0, this.s.stardust + n); }

  /* ---------------- candy ---------------- */

  candyFor(speciesId) { return this.s.candy[familyRoot(speciesId)] || 0; }

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

  /* ---------------- collection ---------------- */

  isRegistered(speciesId) { return !!this.s.registered[speciesId]; }
  get registeredCount() { return Object.keys(this.s.registered).length; }

  register(speciesId) {
    if (this.s.registered[speciesId]) return false;
    this.s.registered[speciesId] = Date.now();
    return true;
  }

  /* ---------------- creatures ---------------- */

  newUid() { return `c${this.s.nextUid++}`; }

  creature(uid) { return this.s.storage.find(c => c.uid === uid) || null; }
  countOfSpecies(speciesId) { return this.s.storage.filter(c => c.speciesId === speciesId).length; }

  /** Creatures that may be taken into a battle. */
  battleReady() {
    return this.s.storage.filter(c => c.breeding == null && !isFainted(c));
  }

  /* ---------------- items ---------------- */

  itemCount(id) { return this.s.inventory[id] || 0; }
  hasItem(id, n = 1) { return this.itemCount(id) >= n; }

  addItem(id, n = 1) {
    if (!ITEMS[id] || n <= 0) return 0;
    this.s.inventory[id] = this.itemCount(id) + n;
    return this.s.inventory[id];
  }

  addItems(drop) {
    let total = 0;
    for (const [id, n] of Object.entries(drop || {})) {
      this.addItem(id, n);
      total += n;
    }
    if (total) this.s.stats.itemsCollected += total;
    return total;
  }

  spendItem(id, n = 1) {
    if (!this.hasItem(id, n)) return false;
    this.s.inventory[id] -= n;
    if (this.s.inventory[id] <= 0) delete this.s.inventory[id];
    return true;
  }

  /** Every item the player actually holds, plus its quantity. */
  ownedItems() {
    return Object.entries(this.s.inventory)
      .filter(([id, n]) => n > 0 && ITEMS[id])
      .map(([id, n]) => ({ def: ITEMS[id], qty: n }))
      .sort((a, b) => a.def.order - b.def.order);
  }

  /* ---------------- healing ---------------- */

  canUsePotion(uid) {
    const c = this.creature(uid);
    if (!c) return { ok: false, reason: 'missing' };
    if (!this.hasItem('potion')) return { ok: false, reason: 'noItem' };
    if (isFainted(c)) return { ok: false, reason: 'fainted' };
    if (!isHurt(c)) return { ok: false, reason: 'healthy' };
    return { ok: true };
  }

  usePotion(uid) {
    const check = this.canUsePotion(uid);
    if (!check.ok) return check;
    const c = this.creature(uid);
    const max = maxHpOf(c);
    const before = hpOf(c);
    const healed = Math.min(max, before + (itemDef('potion').heals || 50));
    c.hp = healed >= max ? null : healed;
    this.spendItem('potion');
    this.touch('potion', { immediate: true });
    return { ok: true, before, after: hpOf(c), max, gained: hpOf(c) - before };
  }

  canUseRevive(uid) {
    const c = this.creature(uid);
    if (!c) return { ok: false, reason: 'missing' };
    if (!this.hasItem('revive')) return { ok: false, reason: 'noItem' };
    if (!isFainted(c)) return { ok: false, reason: 'notFainted' };
    return { ok: true };
  }

  useRevive(uid) {
    const check = this.canUseRevive(uid);
    if (!check.ok) return check;
    const c = this.creature(uid);
    c.hp = null;                 // back to full
    this.spendItem('revive');
    this.touch('revive', { immediate: true });
    return { ok: true, max: maxHpOf(c) };
  }

  /** Writes HP back after a battle. */
  applyBattleDamage(results = []) {
    for (const { uid, hp } of results) {
      const c = this.creature(uid);
      if (!c) continue;
      const max = maxHpOf(c);
      c.hp = hp >= max ? null : Math.max(0, hp);
    }
    this.touch('battle-damage', { immediate: true });
  }

  /* ---------------- timed effects ---------------- */

  effect(kind, now = Date.now()) {
    const fx = this.s.effects[kind];
    return fx && fx.endsAt > now ? fx : null;
  }

  isMagnetActive(now = Date.now()) { return !!this.effect('magnet', now); }
  isIncenseActive(now = Date.now()) { return !!this.effect('incense', now); }

  /** Starts incense or the stardust magnet. One at a time, each. */
  startEffect(kind, now = Date.now()) {
    const itemId = kind === 'incense' ? 'incense' : 'stardust_magnet';
    if (this.effect(kind, now)) return { ok: false, reason: 'active' };
    if (!this.hasItem(itemId)) return { ok: false, reason: 'noItem' };

    const duration = kind === 'incense' ? RULES.INCENSE_DURATION_MS : RULES.MAGNET_DURATION_MS;
    this.spendItem(itemId);
    this.s.effects[kind] = {
      startedAt: now,
      endsAt: now + duration,
      lastSpawnAt: kind === 'incense' ? 0 : null
    };
    this.touch('effect', { immediate: true });
    return { ok: true, endsAt: this.s.effects[kind].endsAt };
  }

  clearExpiredEffects(now = Date.now()) {
    let changed = false;
    for (const kind of ['incense', 'magnet']) {
      const fx = this.s.effects[kind];
      if (fx && fx.endsAt <= now) { this.s.effects[kind] = null; changed = true; }
    }
    if (changed) this.touch('effect');
    return changed;
  }

  /* ---------------- capture ---------------- */

  /**
   * Builds a brand new creature instance with its own shiny roll,
   * stat modifier and move-unlock luck.
   */
  makeCreature(speciesId, { level = 1, shiny = null, origin = 'wild', unlock = null } = {}) {
    const sp = species(speciesId);
    return {
      uid: this.newUid(),
      speciesId: sp.id,
      level,
      capturedAt: Date.now(),
      dustSpent: 0,
      evolvedAt: null,
      origin,
      shiny: shiny == null
        ? (this.s.debug.shinyBoost ? chance(0.5) : rollShiny(origin === 'raid' ? 'raid' : 'spawn'))
        : !!shiny,
      statMod: rollStatModifier(),
      moveUnlock: unlock || rollMoveUnlock(),
      breeding: null,
      hp: null
    };
  }

  /**
   * Applies every reward for a capture.
   * @param {object} opts  { origin, level, shiny, bonusCandy, unlock }
   */
  capture(spawnOrSpeciesId, opts = {}) {
    const speciesId = typeof spawnOrSpeciesId === 'string'
      ? spawnOrSpeciesId
      : spawnOrSpeciesId.speciesId;
    const sp = species(speciesId);
    if (!sp) throw new Error('Unknown creature: ' + speciesId);

    const origin = opts.origin || 'wild';
    const rarity = sp.rarity || familyRarity(sp.id) || 1;

    const creature = this.makeCreature(sp.id, {
      level: opts.level ?? (origin === 'raid' ? RAID_CAPTURE_LEVEL : 1),
      shiny: opts.shiny ?? null,
      origin,
      unlock: opts.unlock ?? null
    });
    this.s.storage.push(creature);

    const magnet = this.isMagnetActive();
    const candy = candyForCapture(rarity) + (opts.bonusCandy || 0);
    const dust = dustForCapture(rarity, this.level) + (magnet ? RULES.MAGNET_BONUS_DUST : 0);
    const xp = xpForCapture(rarity);

    const isNew = this.register(sp.id);
    const candyTotal = this.addCandy(sp.id, candy);
    this.addStardust(dust);
    const levelUp = this.addXP(xp);

    this.s.stats.captures++;
    if (creature.shiny) this.s.stats.shinies++;
    this.bumpDaily('capturesToday');

    this.touch('capture', { immediate: true });
    return {
      creature, sp, isNew, candy, dust, xp, candyTotal, levelUp, rarity,
      shiny: creature.shiny, magnet, origin
    };
  }

  /* ---------------- raid and grunt rewards ---------------- */

  /** XP and stardust for beating a raid boss. Stardust scales with player level. */
  rewardRaidWin(raid) {
    const xp = raid.xp ?? 0;
    const dust = dustInRange(raid.dustRange || [30, 40], this.level);
    this.addStardust(dust);
    const levelUp = this.addXP(xp);
    this.s.stats.raidsWon++;
    this.touch('raid-win', { immediate: true });
    return { xp, dust, levelUp };
  }

  /**
   * Capture the boss after winning. Always arrives at RAID_CAPTURE_LEVEL with
   * two bonus candy, and keeps the shiny status you already saw in the fight.
   */
  captureRaidBoss(raid) {
    if (!this.hasItem('ultra_disc')) return { ok: false, reason: 'noItem' };
    this.spendItem('ultra_disc');
    const res = this.capture(raid.speciesId, {
      origin: 'raid',
      level: RAID_CAPTURE_LEVEL,
      shiny: !!raid.shiny,
      bonusCandy: RAID_CAPTURE_BONUS_CANDY
    });
    return { ok: true, ...res, bonusCandy: RAID_CAPTURE_BONUS_CANDY };
  }

  /** Stardust for beating a grunt, plus a small chance of a bonus item. */
  rewardGruntWin() {
    const dust = dustInRange(GRUNT_REWARD.dust, this.level);
    this.addStardust(dust);
    const bonus = weightedPick(GRUNT_REWARD.bonus).item;
    if (bonus) this.addItem(bonus, 1);
    this.s.stats.gruntsBeaten++;
    this.touch('grunt-win', { immediate: true });
    return { dust, bonus };
  }

  /* ---------------- level up ---------------- */

  canLevelUp(uid) {
    const c = this.creature(uid);
    if (!c) return { ok: false, reason: 'missing' };
    if (c.level >= MAX_CREATURE_LEVEL) return { ok: false, reason: 'max', cost: null };

    const cost = levelUpCost(c.level);
    const haveDust = this.s.stardust;
    const haveCandy = this.candyFor(c.speciesId);
    const shortDust = Math.max(0, cost.stardust - haveDust);
    const shortCandy = Math.max(0, cost.candy - haveCandy);

    if (shortDust || shortCandy) {
      return {
        ok: false,
        reason: shortDust && shortCandy ? 'both' : (shortDust ? 'dust' : 'candy'),
        cost, haveDust, haveCandy, shortDust, shortCandy
      };
    }
    return { ok: true, cost, haveDust, haveCandy, shortDust: 0, shortCandy: 0 };
  }

  levelUp(uid) {
    const check = this.canLevelUp(uid);
    if (!check.ok) return check;
    const c = this.creature(uid);
    const hpBefore = hpOf(c);
    const maxBefore = maxHpOf(c);

    this.s.stardust -= check.cost.stardust;
    this.spendCandy(c.speciesId, check.cost.candy);
    c.level += 1;
    c.dustSpent += check.cost.stardust;

    // A bigger HP pool should not silently heal or hurt: keep the same deficit.
    if (c.hp != null) c.hp = Math.max(0, hpBefore + (maxHpOf(c) - maxBefore));

    this.s.stats.levelUps++;
    this.touch('levelup', { immediate: true });
    return { ok: true, cost: check.cost, level: c.level };
  }

  /* ---------------- evolution ---------------- */

  canEvolve(uid) {
    const c = this.creature(uid);
    if (!c) return { ok: false, reason: 'missing' };
    if (c.breeding != null) return { ok: false, reason: 'breeding' };
    const sp = species(c.speciesId);
    if (!sp?.evolvesToId) return { ok: false, reason: 'final' };
    const cost = sp.evolutionCandy || 0;
    const have = this.candyFor(sp.id);
    if (have < cost) return { ok: false, reason: 'candy', cost, have, short: cost - have };
    return { ok: true, cost, have, target: species(sp.evolvesToId) };
  }

  /**
   * Candy comes from the shared family pool, level and shiny status carry over,
   * and the move-unlock luck stays with the creature.
   */
  evolve(uid) {
    const check = this.canEvolve(uid);
    if (!check.ok) return check;
    const c = this.creature(uid);
    const from = species(c.speciesId);
    const to = species(from.evolvesToId);
    const hpBefore = hpOf(c);
    const maxBefore = maxHpOf(c);

    this.spendCandy(from.id, check.cost);
    c.speciesId = to.id;
    c.evolvedAt = Date.now();
    if (c.hp != null) c.hp = Math.max(0, hpBefore + (maxHpOf(c) - maxBefore));

    const isNew = this.register(to.id);
    const xp = XP_ON_EVOLVE[from.stage] ?? 30;
    const levelUp = this.addXP(xp);
    this.s.stats.evolutions++;

    this.touch('evolve', { immediate: true });
    return {
      ok: true, from, to, isNew, xp, levelUp,
      cost: check.cost,
      candyLeft: this.candyFor(to.id),
      level: c.level,
      shiny: c.shiny
    };
  }

  /* ---------------- release ---------------- */

  remove(uid) {
    const c = this.creature(uid);
    if (!c) return { ok: false, reason: 'missing' };
    if (c.breeding != null) return { ok: false, reason: 'breeding' };
    if (c.favourite) return { ok: false, reason: 'favourite' };

    const i = this.s.storage.findIndex(x => x.uid === uid);
    this.s.storage.splice(i, 1);
    const sp = species(c.speciesId);
    const total = this.addCandy(c.speciesId, CANDY_ON_DELETE);
    this.s.stats.deletes++;
    this.touch('delete', { immediate: true });
    return { ok: true, sp, candy: CANDY_ON_DELETE, candyTotal: total, familyRootId: familyRoot(c.speciesId) };
  }

  toggleFavourite(uid) {
    const c = this.creature(uid);
    if (!c) return false;
    c.favourite = !c.favourite;
    this.touch('favourite', { immediate: true });
    return c.favourite;
  }

  /** Mass release: skips favourites and breeding creatures. Returns total candy gained. */
  massRelease(uids) {
    let totalCandy = 0;
    const released = [];
    for (const uid of uids) {
      const c = this.creature(uid);
      if (!c || c.favourite || c.shiny || c.breeding != null) continue;
      const i = this.s.storage.findIndex(x => x.uid === uid);
      if (i === -1) continue;
      this.s.storage.splice(i, 1);
      this.addCandy(c.speciesId, CANDY_ON_DELETE);
      totalCandy += CANDY_ON_DELETE;
      released.push(uid);
      this.s.stats.deletes++;
    }
    if (released.length) this.touch('delete', { immediate: true });
    return { released: released.length, candy: totalCandy };
  }

  /* ---------------- map points ---------------- */

  get points() { return this.s.points; }

  activePoints(now = Date.now()) { return this.s.points.filter(p => p.expiresAt > now); }
  point(id) { return this.s.points.find(p => p.id === id) || null; }

  pointsOfKind(kind, now = Date.now()) {
    return this.activePoints(now).filter(p => p.kind === kind);
  }

  /** Points that still block a new spawn from appearing nearby. */
  occupiedPoints(now = Date.now()) { return this.activePoints(now); }

  addPoints(list) {
    if (!list?.length) return;
    this.s.points.push(...list);
    this.touch('spawned', { immediate: true });
  }

  /**
   * A collected point stays on the map with a tick until its timer runs out —
   * it just can't be interacted with any more.
   */
  markCollected(id) {
    const p = this.point(id);
    if (!p || p.collected) return false;
    p.collected = true;
    p.collectedAt = Date.now();
    this.touch('collected', { immediate: true });
    return true;
  }

  removePoint(id) {
    const before = this.s.points.length;
    this.s.points = this.s.points.filter(p => p.id !== id);
    if (this.s.points.length !== before) this.touch('despawn');
  }

  pruneExpired(now = Date.now()) {
    const gone = this.s.points.filter(p => p.expiresAt <= now);
    if (gone.length) {
      this.s.points = this.s.points.filter(p => p.expiresAt > now);
      this.touch('despawn');
    }
    return gone;
  }

  clearPoints() { this.s.points = []; this.touch('despawn', { immediate: true }); }

  /* ---------------- breeding centre ---------------- */

  get breedingUnlocked() { return this.level >= BREEDING_UNLOCK_LEVEL; }
  get breedingSlots() { return breedingSlotsFor(this.level); }

  placeBreedingCentre(lat, lng) {
    if (this.s.breeding) return { ok: false, reason: 'placed' };
    if (!this.hasItem('breeding_center')) return { ok: false, reason: 'noItem' };
    this.spendItem('breeding_center');
    this.s.breeding = { lat, lng, placedAt: Date.now(), slots: [] };
    this.touch('breeding', { immediate: true });
    return { ok: true };
  }

  /** Two creatures of the exact same species start generating that family's candy. */
  addBreedingPair(uidA, uidB) {
    if (!this.s.breeding) return { ok: false, reason: 'noCentre' };
    if (this.s.breeding.slots.length >= this.breedingSlots) return { ok: false, reason: 'full' };
    const a = this.creature(uidA), b = this.creature(uidB);
    if (!a || !b || a.uid === b.uid) return { ok: false, reason: 'missing' };
    if (a.speciesId !== b.speciesId) return { ok: false, reason: 'species' };
    if (a.breeding != null || b.breeding != null) return { ok: false, reason: 'busy' };

    const index = this.s.breeding.slots.length;
    this.s.breeding.slots.push({
      speciesId: a.speciesId,
      uids: [a.uid, b.uid],
      startedAt: Date.now()
    });
    a.breeding = index;
    b.breeding = index;
    this.touch('breeding', { immediate: true });
    return { ok: true, index };
  }

  /** Candy a slot has generated so far, capped. */
  breedingProgress(slot, now = Date.now()) {
    const rarity = familyRarity(slot.speciesId);
    const every = breedingIntervalMs(rarity);
    const earned = Math.min(BREEDING_CANDY_CAP, Math.floor((now - slot.startedAt) / every));
    const nextAt = earned >= BREEDING_CANDY_CAP ? null : slot.startedAt + (earned + 1) * every;
    return { earned, cap: BREEDING_CANDY_CAP, every, nextAt, rarity };
  }

  /** Collect a pair back and bank whatever candy they made. */
  collectBreedingSlot(index, now = Date.now()) {
    if (!this.s.breeding) return { ok: false, reason: 'noCentre' };
    const slot = this.s.breeding.slots[index];
    if (!slot) return { ok: false, reason: 'empty' };

    const { earned } = this.breedingProgress(slot, now);
    if (earned > 0) this.addCandy(slot.speciesId, earned);

    for (const uid of slot.uids) {
      const c = this.creature(uid);
      if (c) c.breeding = null;
    }
    this.s.breeding.slots.splice(index, 1);
    // slot indices shifted — repoint the creatures still inside
    this.s.breeding.slots.forEach((sl, i) => {
      for (const uid of sl.uids) {
        const c = this.creature(uid);
        if (c) c.breeding = i;
      }
    });

    this.touch('breeding', { immediate: true });
    return { ok: true, candy: earned, speciesId: slot.speciesId, uids: slot.uids };
  }

  /* ---------------- missions ---------------- */

  bumpDaily(key, n = 1) {
    if (this.s.daily.date !== dayKey()) {
      this.s.daily = { date: dayKey(), capturesToday: 0, claimed: {} };
    }
    this.s.daily[key] = (this.s.daily[key] || 0) + n;
  }

  missionProgress(m) {
    switch (m.kind) {
      case 'registered': return this.registeredCount;
      case 'captures': return this.s.stats.captures;
      case 'capturesToday':
        return this.s.daily.date === dayKey() ? (this.s.daily.capturesToday || 0) : 0;
      default: return 0;
    }
  }

  missionState(m, daily = false) {
    const progress = this.missionProgress(m);
    const claimed = daily
      ? !!this.s.daily.claimed?.[m.id]
      : !!this.s.missions[m.id];
    return {
      def: m, daily, progress,
      target: m.target,
      complete: progress >= m.target,
      claimed,
      claimable: progress >= m.target && !claimed
    };
  }

  allMissions() {
    return [
      ...MISSIONS.map(m => this.missionState(m, false)),
      ...DAILY_MISSIONS.map(m => this.missionState(m, true))
    ];
  }

  get claimableMissionCount() {
    return this.allMissions().filter(m => m.claimable).length;
  }

  claimMission(id) {
    const all = this.allMissions();
    const m = all.find(x => x.def.id === id);
    if (!m) return { ok: false, reason: 'missing' };
    if (!m.complete) return { ok: false, reason: 'incomplete' };
    if (m.claimed) return { ok: false, reason: 'claimed' };

    const dust = m.def.dust + dustBonusFor(this.level);
    this.addStardust(dust);
    const levelUp = this.addXP(m.def.xp);

    if (m.daily) {
      this.s.daily.claimed = this.s.daily.claimed || {};
      this.s.daily.claimed[id] = Date.now();
    } else {
      this.s.missions[id] = { claimedAt: Date.now() };
    }
    this.touch('mission', { immediate: true });
    return { ok: true, xp: m.def.xp, dust, levelUp, label: m.def.label };
  }

  /* ---------------- debug / ui ---------------- */

  setDebug(patch) { Object.assign(this.s.debug, patch); this.touch('debug'); }
  setUI(patch) { Object.assign(this.s.ui, patch); this.touch('ui'); }
}

export const store = new Store();
