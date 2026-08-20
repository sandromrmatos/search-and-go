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
  MISSIONS, DAILY_MISSIONS, WEEKLY_MISSIONS, SET_MISSIONS,
  setGalacticUnlocked, isMythicalEgg, eggCanBeShiny, MYTHICAL_EGG_TYPE,
  breedingSlotsFor, breedingIntervalMs,
  BREEDING_CANDY_CAP, BREEDING_UNLOCK_LEVEL,
  dustInRange, weightedPick, GRUNT_REWARD, levelUpRewardsFor,
  buddyMetresPerCandy, stardustMultiplier, isStardustSunday, RAID_REWARD,
  raidIncubatorChance, raidRareIncenseChance, EXCLUSIVE_RAID_REWARD,
  rollGruntItems, RARE_INCENSE_WEIGHTS,
  EGG_TYPES, MAX_EGGS, EGG_DROP_CHANCE, EGG_HATCH_LEVEL, INCUBATOR_ITEMS, REUSABLE_INCUBATOR,
  eggDef, eggMetres, eggMetresFor, rollEggType, rollEggSpecies,
  MAX_EXCLUSIVE_EGGS, EXCLUSIVE_EGG_TYPE, isExclusiveEgg,
  emptyBoosts, totalBoosts, boostsLeft, MAX_STAT_BOOSTS, STAT_BOOSTER_ITEM,
  statBoosterCost, STAT_KEYS,
  SHOP_ITEMS, shopItem, COINS_PER_AD
} from './data.js';
import { ITEMS, item as itemDef } from './items.js';

export const SAVE_VERSION = 3;

/** Local calendar day key, used for daily missions. */
export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Key for the local week, identified by its Monday. Weekly missions roll over
 * at midnight between Sunday and Monday.
 */
export function weekKey(d = new Date()) {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // getDay(): 0 = Sunday, so Sunday belongs to the week that began 6 days ago.
  const back = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - back);
  return dayKey(monday);
}

/**
 * The day is split into three 8-hour windows: 0 = 00:00–08:00,
 * 1 = 08:00–16:00, 2 = 16:00–24:00. One grunt turns up on the player's own
 * position in each window, so the stamp has to identify the window, not just
 * the day.
 */
export const GRUNT_WINDOW_HOURS = 8;
export const gruntWindowIndex = (d = new Date()) => Math.floor(d.getHours() / GRUNT_WINDOW_HOURS);
export const gruntWindowKey = (d = new Date()) => `${dayKey(d)}#${gruntWindowIndex(d)}`;

const blankWeekly = () => ({
  week: weekKey(), capturesWeek: 0, metresWeek: 0, days: {}, claimed: {}
});

/**
 * A fresh daily block. This used to be an inline literal repeated in three
 * places, which meant any new counter was silently wiped at the next rollover
 * unless every copy was updated.
 */
const blankDaily = () => ({
  date: dayKey(), capturesToday: 0, metresToday: 0, claimed: {},
  /** shopItemId -> how many bought today. Enforces the per-day shop caps. */
  shop: {}
});

function blankState() {
  return {
    version: SAVE_VERSION,
    createdAt: Date.now(),
    nickname: null,

    xp: 0,
    stardust: 0,
    /** Shop coins, one per rewarded video watched. Never resets. */
    coins: 0,
    candy: {},          // familyRootId -> candy
    inventory: { capture_disc: 5 },      // start with 5 capturing discs
    storage: [],        // individual creatures
    registered: {},     // speciesId -> first registered at
    shinyCaught: {},   // speciesId -> true when a shiny of this species has been caught
    caughtCount: {},   // speciesId -> total number ever caught (including released)

    points: [],         // live map points of every kind
    effects: { incense: null, magnet: null },
    breeding: null,     // { lat, lng, placedAt, slots: [...] }
    researchLab: null,  // { lat, lng, placedAt }
    /** Galactic Adventures rarities opened by the Set missions. Never resets. */
    galacticUnlocked: [],
    buddy: null,        // { uid, metres, candyEarned, since }
    eggs: [],           // { id, type, collectedAt, metres, incubator: itemId|null }
    nextEggId: 1,

    missions: {},       // missionId -> { claimedAt }
    daily: blankDaily(),
    weekly: blankWeekly(),

    /** Day + 8-hour slot of the last "grunt at your feet" spawn, e.g. "2026-08-13#1". */
    gruntWindow: null,

    /** Newest news entry the player has seen, as a timestamp. */
    newsSeenAt: 0,

    stats: {
      captures: 0, evolutions: 0, deletes: 0, levelUps: 0, scans: 0,
      raidsWon: 0, gruntsBeaten: 0, itemsCollected: 0, shinies: 0,
      metresWalked: 0, steps: 0,
      eggsHatched: 0,
      raidsByRarity: {},  // rarity -> raid bosses beaten, for the per-rarity missions
      exclusiveRaidsWon: 0,
      exclusiveRaidsByRarity: {},
      adsWatched: 0, shopBuys: 0
    },

    lastScanAt: 0,
    nextUid: 1,
    debug: { enabled: false, lat: null, lng: null, ignoreRange: false, showPois: false, shinyBoost: false },
    ui: {
      storageTab: 'creatures', storageSort: 'id', storageDir: 1, storagePage: 0,
      filterType: '', filterStage: '', filterRarity: '', setIndex: 0,
      // Hides the ticked-off points on the map. They stay live underneath and
      // keep their spot reserved — this only stops them being drawn.
      hideCollectedPoints: false,
      /** Collection shows shiny artwork, with silhouettes for shinies not caught. */
      collectionShiny: false,
      /** Storage is filtered to one family root id, or '' for everything. */
      storageFamily: ''
    }
  };
}

/* ---------------------------------------------------------------
   Creature helpers
   --------------------------------------------------------------- */

/**
 * Full stat block for a stored creature: base, stat modifier, level growth and
 * finally any Stat Boosters it is carrying.
 */
export function creatureStats(c) {
  const sp = species(c.speciesId);
  if (!sp) return { hp: 1, attack: 1, defence: 1, speed: 1 };
  return statsFor(sp, c.level, c.statMod, c.boosts);
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
/**
 * Normalises a raw save into the current shape. Exported so save handling can
 * be checked without writing anything to disk.
 */
export function migrate(raw) {
  const base = blankState();
  if (!raw || typeof raw !== 'object') return base;

  const s = {
    ...base, ...raw,
    candy: { ...(raw.candy || {}) },
    inventory: { ...(raw.inventory || {}) },
    registered: { ...(raw.registered || {}) },
    shinyCaught: { ...(raw.shinyCaught || {}) },
    caughtCount: { ...(raw.caughtCount || {}) },
    stats: {
      ...base.stats, ...(raw.stats || {}),
      raidsByRarity: { ...(raw.stats?.raidsByRarity || {}) },
      exclusiveRaidsWon: Number(raw.stats?.exclusiveRaidsWon) || 0,
      exclusiveRaidsByRarity: { ...(raw.stats?.exclusiveRaidsByRarity || {}) }
    },
    debug: { ...base.debug, ...(raw.debug || {}) },
    ui: { ...base.ui, ...(raw.ui || {}) },
    effects: { ...base.effects, ...(raw.effects || {}) },
    missions: { ...(raw.missions || {}) },
    daily: { ...base.daily, ...(raw.daily || {}) },
    weekly: { ...base.weekly, ...(raw.weekly || {}) },
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
  s.coins = Math.max(0, Math.floor(Number(s.coins) || 0));
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
        boosts: validBoosts(c.boosts),
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

  // ---- eggs ----
  // Capped per bucket: six normal eggs and three exclusive 15 km eggs. A flat
  // slice would let a full normal storage push out an exclusive egg.
  const eggRoom = { normal: MAX_EGGS, exclusive: MAX_EXCLUSIVE_EGGS };
  s.eggs = (Array.isArray(raw.eggs) ? raw.eggs : [])
    .filter(e => e && EGG_TYPES[e.type])
    .filter(e => {
      const bucket = isExclusiveEgg(e.type) ? 'exclusive' : 'normal';
      if (eggRoom[bucket] <= 0) return false;
      eggRoom[bucket]--;
      return true;
    })
    .map(e => ({
      id: e.id || `egg${Math.random().toString(36).slice(2, 8)}`,
      type: e.type,
      collectedAt: Number(e.collectedAt) || Date.now(),
      metres: Math.max(0, Number(e.metres) || 0),
      incubator: INCUBATOR_ITEMS.includes(e.incubator) ? e.incubator : null
    }));
  s.nextEggId = Math.max(1, Number(s.nextEggId) || 1);

  // ---- buddy: drop it if that creature is no longer in storage ----
  if (s.buddy && typeof s.buddy === 'object') {
    const stillThere = s.storage.some(c => c.uid === s.buddy.uid);
    s.buddy = stillThere
      ? {
          uid: s.buddy.uid,
          metres: Math.max(0, Number(s.buddy.metres) || 0),
          candyEarned: Math.max(0, Math.floor(Number(s.buddy.candyEarned) || 0)),
          since: Number(s.buddy.since) || Date.now()
        }
      : null;
  } else {
    s.buddy = null;
  }

  // ---- galactic unlocks: whole numbers 1-5, no duplicates ----
  s.galacticUnlocked = [...new Set(
    (Array.isArray(raw.galacticUnlocked) ? raw.galacticUnlocked : [])
      .map(Number)
      .filter(r => Number.isInteger(r) && r >= 1 && r <= 5)
  )].sort((a, b) => a - b);

  // ---- research lab: a pin with no slots, so coordinates are all it needs ----
  if (s.researchLab && (!isFinite(s.researchLab.lat) || !isFinite(s.researchLab.lng))) {
    s.researchLab = null;
  }

  // ---- breeding ----
  if (s.breeding && (!isFinite(s.breeding.lat) || !isFinite(s.breeding.lng))) s.breeding = null;
  if (s.breeding) {
    s.breeding.slots = (Array.isArray(s.breeding.slots) ? s.breeding.slots : [])
      .filter(sl => sl && sl.speciesId && Array.isArray(sl.uids));
  }

  // ---- daily reset ----
  s.daily.capturesToday = Math.max(0, Math.floor(Number(s.daily.capturesToday) || 0));
  s.daily.metresToday = Math.max(0, Number(s.daily.metresToday) || 0);
  // Shop tallies are clamped to that row's own cap, so a tampered save cannot
  // hand out more than a day's worth and cannot go negative either.
  const rawShop = (s.daily.shop && typeof s.daily.shop === 'object') ? s.daily.shop : {};
  s.daily.shop = {};
  for (const row of SHOP_ITEMS) {
    const n = Math.max(0, Math.floor(Number(rawShop[row.id]) || 0));
    if (n > 0) s.daily.shop[row.id] = Math.min(n, row.limit);
  }
  if (s.daily.date !== dayKey()) s.daily = blankDaily();

  // ---- weekly reset (Monday) ----
  s.weekly.days = { ...(s.weekly.days || {}) };
  s.weekly.claimed = { ...(s.weekly.claimed || {}) };
  s.weekly.capturesWeek = Math.max(0, Math.floor(Number(s.weekly.capturesWeek) || 0));
  s.weekly.metresWeek = Math.max(0, Number(s.weekly.metresWeek) || 0);
  if (s.weekly.week !== weekKey()) s.weekly = blankWeekly();

  // ---- grunt window stamp ----
  s.gruntWindow = typeof s.gruntWindow === 'string' ? s.gruntWindow : null;

  // ---- uid counter ----
  let maxUid = 0;
  for (const c of s.storage) {
    const n = Number(String(c.uid).replace(/\D/g, '')) || 0;
    if (n > maxUid) maxUid = n;
  }
  s.nextUid = Math.max(Number(s.nextUid) || 1, maxUid + 1);

  // ---- backfill shinyCaught from existing storage (for old saves) ----
  for (const c of s.storage) {
    if (c.shiny && c.speciesId) s.shinyCaught[c.speciesId] = true;
  }

  // ---- caughtCount ----
  // Version 2 backfilled this from storage on *every* load, adding the whole
  // storage count each time, so the totals ballooned with every refresh.
  // Rebase once to what is actually in storage; from then on only real
  // captures move the number.
  if ((Number(raw.version) || 0) < 3) {
    s.caughtCount = {};
    for (const c of s.storage) {
      if (!c.speciesId) continue;
      s.caughtCount[c.speciesId] = (s.caughtCount[c.speciesId] || 0) + 1;
    }
  }
  for (const [id, n] of Object.entries(s.caughtCount)) {
    if (!DB.byId.has(id)) { delete s.caughtCount[id]; continue; }
    s.caughtCount[id] = Math.max(0, Math.floor(Number(n) || 0));
  }

  return s;
}

const STATS = ['hp', 'attack', 'defence', 'speed'];

/**
 * Stat boosts from a save: whole numbers, never negative, and never more than
 * MAX_STAT_BOOSTS in total. Older saves have no `boosts` at all, which is fine
 * — they simply start with none.
 */
function validBoosts(b) {
  const out = emptyBoosts();
  if (!b || typeof b !== 'object') return out;
  let total = 0;
  for (const k of STATS) {
    const n = Math.max(0, Math.floor(Number(b[k]) || 0));
    // Trim rather than reject, so a tampered save cannot exceed the cap.
    const allowed = Math.min(n, MAX_STAT_BOOSTS - total);
    out[k] = allowed;
    total += allowed;
  }
  return out;
}

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
    /** Set when the last save was refused to protect existing progress. */
    this.saveBlocked = null;
    /** True when loading hit a read error rather than finding nothing. */
    this.loadReadFailed = false;
    /** A snapshot that could be restored, when the save went missing. */
    this.loadRecoverable = null;
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

  /**
   * `force` bypasses the "do not blank an existing save" guard, and is only for
   * changes the player asked for explicitly: Reset all progress, and importing
   * or restoring a save.
   */
  async flush({ force = false } = {}) {
    clearTimeout(this._saveTimer);
    if (this._saving) { this._pendingFlush = true; return; }
    this._saving = true;
    try {
      const at = await Persist.writeNow(this.s, { force });
      // null means the write was refused to protect existing progress.
      if (at == null) {
        this.saveBlocked = Persist.guardTripped;
        this.emit('save-blocked');
      } else {
        this.lastSavedAt = at;
        this.saveBlocked = null;
      }
    } catch (e) {
      console.error('[state] save failed', e);
    } finally {
      this._saving = false;
      if (this._pendingFlush) { this._pendingFlush = false; this.flush({ force }); }
    }
  }

  /**
   * Loads without writing anything. `readFailed` and `recoverable` are kept so
   * the caller can refuse to start a fresh account over a save it merely failed
   * to read.
   */
  async load() {
    const { data, source, readFailed, recoverable } = await Persist.load();
    this.s = migrate(data);
    // The spawn pools depend on saved progress, so they have to be rebuilt
    // before anything can roll a creature.
    this.syncGalacticUnlocks();
    this.loadedFrom = source;
    this.loadReadFailed = !!readFailed;
    this.loadRecoverable = recoverable || null;
    this.emit('load');
    return source;
  }

  async replace(raw) {
    this.s = migrate(raw);
    this.syncGalacticUnlocks();
    await this.flush({ force: true });
    this.emit('load');
  }

  async reset() {
    this.s = blankState();
    this.syncGalacticUnlocks();
    await this.flush({ force: true });
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
      // Grant every level gained, so a multi-level jump pays for each step.
      // Totals are accumulated as we go and reported from the same numbers we
      // credited, which keeps the toast honest.
      const totals = {};
      for (let l = before + 1; l <= after; l++) {
        for (const [id, n] of Object.entries(levelUpRewardsFor(l))) {
          this.addItem(id, n);
          totals[id] = (totals[id] || 0) + n;
        }
      }
      rewards.push(...Object.entries(totals).map(([id, n]) => ({ id, n })));
    }
    return { levelledUp, from: before, to: after, rewards };
  }

  /**
   * Adds stardust and returns the amount actually credited. Gains are doubled
   * on Stardust Sunday, applied here so it lands on top of every other
   * adjustment (player-level bonus, Stardust Magnet, rarity ranges).
   * Callers should report the returned value, not the one they passed in.
   */
  addStardust(n) {
    const raw = Number(n) || 0;
    const amount = raw > 0 ? Math.round(raw * stardustMultiplier()) : raw;
    this.s.stardust = Math.max(0, this.s.stardust + amount);
    return amount;
  }

  /**
   * Accumulates walked distance, converts it into whole steps and feeds the
   * buddy's candy progress.
   * @returns {{changed:boolean, buddyCandy:number, buddy:object|null}}
   *   `changed` is true when something worth re-rendering moved.
   */
  addWalk(metres) {
    const none = { changed: false, buddyCandy: 0, buddy: null };
    if (!isFinite(metres) || metres <= 0) return none;

    const st = this.s.stats;
    st.metresWalked = (Number(st.metresWalked) || 0) + metres;
    const steps = Math.floor(st.metresWalked / RULES.METRES_PER_STEP);
    const stepsMoved = steps !== (Number(st.steps) || 0);
    st.steps = steps;

    const missionDone = this.addWalkMissionProgress(metres);
    const walked = this.addBuddyWalk(metres);
    const eggs = this.addEggWalk(metres);
    return {
      changed: stepsMoved || walked.candy > 0 || walked.progressed || eggs.moved || missionDone,
      buddyCandy: walked.candy,
      buddy: walked.candy > 0 ? this.buddy : null,
      eggsReady: eggs.ready,
      walkMissionDone: missionDone
    };
  }

  /* ---------------- buddy ---------------- */

  /** The creature currently walking with the player, or null. */
  get buddy() {
    const b = this.s.buddy;
    if (!b) return null;
    const c = this.creature(b.uid);
    return c ? c : null;
  }

  isBuddy(uid) { return !!this.s.buddy && this.s.buddy.uid === uid; }

  setBuddy(uid) {
    const c = this.creature(uid);
    if (!c) return { ok: false, reason: 'missing' };
    if (c.breeding != null) return { ok: false, reason: 'breeding' };
    // Swapping buddies loses the part-walked progress, same as Pokémon Go.
    this.s.buddy = { uid, metres: 0, candyEarned: 0, since: Date.now() };
    this.touch('buddy', { immediate: true });
    return { ok: true, creature: c };
  }

  clearBuddy() {
    if (!this.s.buddy) return false;
    this.s.buddy = null;
    this.touch('buddy', { immediate: true });
    return true;
  }

  /** Metres one candy costs for the current buddy, or 0 when there is none. */
  buddyMetresPerCandy() {
    const c = this.buddy;
    if (!c) return 0;
    return buddyMetresPerCandy(familyRarity(c.speciesId));
  }

  /**
   * Buddy walking progress. Awards as many candies as the distance covers,
   * so a long walk with the app open is never rounded away.
   */
  addBuddyWalk(metres) {
    const c = this.buddy;
    if (!c) return { candy: 0, progressed: false };

    const per = this.buddyMetresPerCandy();
    const b = this.s.buddy;
    b.metres = (Number(b.metres) || 0) + metres;

    let candy = 0;
    while (per > 0 && b.metres >= per) {
      b.metres -= per;
      candy++;
    }
    if (candy > 0) {
      this.addCandy(c.speciesId, candy);
      b.candyEarned = (Number(b.candyEarned) || 0) + candy;
    }
    return { candy, progressed: true };
  }

  /** How far the buddy still has to walk for its next candy, in metres. */
  buddyProgress() {
    const c = this.buddy;
    if (!c) return null;
    const per = this.buddyMetresPerCandy();
    const done = Math.max(0, Math.min(per, Number(this.s.buddy.metres) || 0));
    return {
      creature: c,
      metresDone: done,
      metresNeeded: per,
      metresLeft: Math.max(0, per - done),
      pct: per > 0 ? Math.min(100, (done / per) * 100) : 0,
      candyEarned: Number(this.s.buddy.candyEarned) || 0
    };
  }

  /* ===============================================================
     Eggs
     =============================================================== */

  get eggs() { return this.s.eggs; }

  /**
   * Eggs live in two independent buckets: six normal slots and three exclusive
   * slots for 15 km eggs. A full set of normal eggs never blocks an exclusive
   * drop, and vice versa.
   */
  // Mythical eggs sit outside both buckets and have no cap of their own.
  get normalEggs() {
    return this.s.eggs.filter(e => !isExclusiveEgg(e.type) && !isMythicalEgg(e.type));
  }
  get exclusiveEggs() { return this.s.eggs.filter(e => isExclusiveEgg(e.type)); }
  get mythicalEggs() { return this.s.eggs.filter(e => isMythicalEgg(e.type)); }

  eggCapacityFor(type) {
    if (isMythicalEgg(type)) return Infinity;
    return isExclusiveEgg(type) ? MAX_EXCLUSIVE_EGGS : MAX_EGGS;
  }
  eggsHeldFor(type) {
    if (isMythicalEgg(type)) return this.mythicalEggs.length;
    return isExclusiveEgg(type) ? this.exclusiveEggs.length : this.normalEggs.length;
  }
  eggsFullFor(type) { return this.eggsHeldFor(type) >= this.eggCapacityFor(type); }
  eggSpaceLeftFor(type) {
    return Math.max(0, this.eggCapacityFor(type) - this.eggsHeldFor(type));
  }

  /** The normal bucket, which is what the disc/item egg drop uses. */
  get eggsFull() { return this.normalEggs.length >= MAX_EGGS; }
  get eggSpaceLeft() { return Math.max(0, MAX_EGGS - this.normalEggs.length); }
  get exclusiveEggsFull() { return this.exclusiveEggs.length >= MAX_EXCLUSIVE_EGGS; }
  get exclusiveEggSpaceLeft() {
    return Math.max(0, MAX_EXCLUSIVE_EGGS - this.exclusiveEggs.length);
  }

  egg(id) { return this.s.eggs.find(e => e.id === id) || null; }

  /**
   * Metres this egg still needs, and how far along it is. The requirement
   * depends on the incubator: a Super Incubator takes 25% off.
   */
  eggProgress(egg) {
    const need = eggMetresFor(egg.type, egg.incubator);
    const done = Math.max(0, Math.min(need, Number(egg.metres) || 0));
    return {
      done, need,
      left: Math.max(0, need - done),
      pct: need > 0 ? Math.min(100, (done / need) * 100) : 0,
      ready: done >= need
    };
  }

  isEggReady(egg) { return !!egg && !!egg.incubator && this.eggProgress(egg).ready; }
  readyEggs() { return this.s.eggs.filter(e => this.isEggReady(e)); }

  /**
   * `ignoreLimit` is for one-off rewards that must never be lost to a full bag,
   * like the mythical egg from the final Set mission.
   */
  addEgg(type, { ignoreLimit = false } = {}) {
    const capped = !ignoreLimit && !isMythicalEgg(type);
    if (capped && this.eggsFullFor(type)) return { ok: false, reason: 'full' };
    const egg = {
      id: `egg${this.s.nextEggId++}`,
      type,
      collectedAt: Date.now(),
      metres: 0,
      incubator: null
    };
    this.s.eggs.push(egg);
    this.touch('egg', { immediate: true });
    return { ok: true, egg };
  }

  /**
   * Rolled when a disc or item point is collected. Returns the egg, or null.
   * A full egg storage simply means no egg — you have to hatch some first.
   */
  rollEggDrop() {
    if (this.eggsFull) return null;
    if (!chance(EGG_DROP_CHANCE)) return null;
    const r = this.addEgg(rollEggType());
    return r.ok ? r.egg : null;
  }

  /**
   * How many incubators are free. The reusable one is busy while its egg is
   * still walking, single-use ones are spent the moment they are used so the
   * inventory count is the answer.
   */
  freeIncubators() {
    const busy = this.s.eggs.filter(e => e.incubator === REUSABLE_INCUBATOR).length;
    const out = {};
    for (const id of INCUBATOR_ITEMS) {
      out[id] = id === REUSABLE_INCUBATOR
        ? Math.max(0, this.itemCount(id) - busy)
        : this.itemCount(id);
    }
    return out;
  }

  hasFreeIncubator() {
    return Object.values(this.freeIncubators()).some(n => n > 0);
  }

  incubateEgg(eggId, itemId) {
    const egg = this.egg(eggId);
    if (!egg) return { ok: false, reason: 'missing' };
    if (egg.incubator) return { ok: false, reason: 'already' };
    if (!INCUBATOR_ITEMS.includes(itemId)) return { ok: false, reason: 'badItem' };
    if ((this.freeIncubators()[itemId] || 0) < 1) return { ok: false, reason: 'noneFree' };

    // A single use incubator is consumed straight away. The reusable one stays
    // in the inventory and is simply marked busy by this egg.
    if (itemId !== REUSABLE_INCUBATOR) this.spendItem(itemId);

    egg.incubator = itemId;
    this.touch('egg', { immediate: true });
    return { ok: true, egg };
  }

  /** Walking only counts for eggs that are actually in an incubator. */
  addEggWalk(metres) {
    const ready = [];
    let moved = false;
    for (const egg of this.s.eggs) {
      if (!egg.incubator) continue;
      const before = this.eggProgress(egg);
      if (before.ready) continue;
      egg.metres = (Number(egg.metres) || 0) + metres;
      moved = true;
      if (this.eggProgress(egg).ready) ready.push(egg);
    }
    return { moved, ready };
  }

  /**
   * Hatches a ready egg: rolls the creature from that egg's rarity table,
   * pays the egg's own stardust and XP, and frees a reusable incubator.
   */
  hatchEgg(eggId) {
    const egg = this.egg(eggId);
    if (!egg) return { ok: false, reason: 'missing' };
    if (!egg.incubator) return { ok: false, reason: 'notIncubated' };
    if (!this.eggProgress(egg).ready) return { ok: false, reason: 'notReady' };

    const def = eggDef(egg.type);
    const sp = rollEggSpecies(egg.type);

    // Take the egg out of storage first so the hatched creature does not trip
    // over a full-eggs check, and so a failure cannot hatch it twice.
    this.s.eggs = this.s.eggs.filter(e => e.id !== egg.id);

    const res = this.capture(sp.id, {
      origin: 'egg',
      level: EGG_HATCH_LEVEL,
      // Eggs use the raid shiny rate, or the flat Shiny Incense rate if one
      // happens to be burning when the egg cracks. Some eggs — the mythical one
      // — can never produce a shiny at all.
      shiny: eggCanBeShiny(egg.type) && rollShiny('raid', new Date(), this.shinyOpts()),
      dust: def.dust,
      xp: def.xp,
      bonusCandy: def.bonusCandy || 0,
      countsAsCapture: false
    });

    this.s.stats.eggsHatched++;
    this.touch('hatch', { immediate: true });
    return { ok: true, ...res, egg, eggType: egg.type, km: def.km };
  }

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
  hasShinyCaught(speciesId) { return !!this.s.shinyCaught?.[speciesId]; }
  totalCaughtOf(speciesId) { return this.s.caughtCount?.[speciesId] || 0; }
  get registeredCount() { return Object.keys(this.s.registered).length; }
  get shinyCaughtCount() { return Object.keys(this.s.shinyCaught || {}).length; }

  /* ---------------- news ---------------- */

  /** How many entries are newer than the last visit to the News tab. */
  unreadNewsCount(entries) {
    const seen = Number(this.s.newsSeenAt) || 0;
    return (entries || []).filter(e => e.at > seen).length;
  }

  /** Called when the News tab is opened. Returns the previous mark. */
  markNewsSeen(now = Date.now()) {
    const before = Number(this.s.newsSeenAt) || 0;
    this.s.newsSeenAt = now;
    this.touch('news');
    return before;
  }

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

  /* ---------------- shop ---------------- */

  get coins() { return Math.max(0, Math.floor(Number(this.s.coins) || 0)); }

  /** Paid out when a rewarded video completes. */
  addCoins(n = COINS_PER_AD) {
    const add = Math.max(0, Math.floor(Number(n) || 0));
    if (!add) return this.coins;
    this.s.coins = this.coins + add;
    this.s.stats.adsWatched = (this.s.stats.adsWatched || 0) + 1;
    this.touch('coins', { immediate: true });
    return this.s.coins;
  }

  /**
   * How many of one shop row were bought today. A stale day reads as zero even
   * before anything writes, so the caps genuinely reset at local midnight
   * rather than at the next purchase.
   */
  shopBoughtToday(id) {
    if (this.s.daily.date !== dayKey()) return 0;
    return Math.max(0, Math.floor(Number(this.s.daily.shop?.[id]) || 0));
  }

  /** One row of the shop, with everything the UI needs to draw it. */
  shopRow(def) {
    const bought = this.shopBoughtToday(def.id);
    const left = Math.max(0, def.limit - bought);
    const affordable = this.coins >= def.coins;
    return {
      def,
      item: ITEMS[def.item],
      held: this.itemCount(def.item),
      bought,
      left,
      soldOut: left <= 0,
      affordable,
      canBuy: left > 0 && affordable
    };
  }

  shopRows() { return SHOP_ITEMS.map(def => this.shopRow(def)); }

  /** True when at least one row could be bought right now. */
  get canBuyAnything() { return this.shopRows().some(r => r.canBuy); }

  /**
   * Spends coins on one shop row. Checks the day, the cap and the balance in
   * that order, and only ever moves one row at a time.
   */
  buyShopItem(id) {
    const def = shopItem(id);
    if (!def) return { ok: false, reason: 'missing' };

    // Roll the day first so a purchase made just after midnight is counted
    // against the new day, not the old one.
    if (this.s.daily.date !== dayKey()) this.s.daily = blankDaily();
    this.s.daily.shop = this.s.daily.shop || {};

    const bought = Math.max(0, Math.floor(Number(this.s.daily.shop[id]) || 0));
    if (bought >= def.limit) return { ok: false, reason: 'limit', limit: def.limit };
    if (this.coins < def.coins) {
      return { ok: false, reason: 'coins', need: def.coins, have: this.coins };
    }

    this.s.coins = this.coins - def.coins;
    this.s.daily.shop[id] = bought + 1;
    this.addItem(def.item, def.qty);
    this.s.stats.itemsCollected += def.qty;
    this.s.stats.shopBuys = (this.s.stats.shopBuys || 0) + 1;
    this.touch('shop', { immediate: true });

    return {
      ok: true,
      item: def.item,
      qty: def.qty,
      spent: def.coins,
      coins: this.coins,
      left: def.limit - (bought + 1)
    };
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

  /** A Full Heal works on anything a potion would, however badly hurt. */
  canUseFullHeal(uid) {
    const c = this.creature(uid);
    if (!c) return { ok: false, reason: 'missing' };
    if (!this.hasItem('full_heal')) return { ok: false, reason: 'noItem' };
    if (isFainted(c)) return { ok: false, reason: 'fainted' };
    if (!isHurt(c)) return { ok: false, reason: 'healthy' };
    return { ok: true };
  }

  /** Straight to full HP, whatever the shortfall. */
  useFullHeal(uid) {
    const check = this.canUseFullHeal(uid);
    if (!check.ok) return check;
    const c = this.creature(uid);
    const max = maxHpOf(c);
    const before = hpOf(c);
    c.hp = null;   // null means "full", so this survives later stat changes
    this.spendItem('full_heal');
    this.touch('full_heal', { immediate: true });
    return { ok: true, before, after: max, max, gained: max - before };
  }

  /** Creatures a potion could help right now: hurt, not fainted, not breeding. */
  healable() {
    return this.s.storage.filter(c => c.breeding == null && !isFainted(c) && isHurt(c));
  }

  /** Creatures a revive could bring back. */
  revivable() {
    return this.s.storage.filter(c => c.breeding == null && isFainted(c));
  }

  /** How many potions it would take to top every hurt creature back to full. */
  potionsNeededForAll() {
    const heals = itemDef('potion').heals || 50;
    return this.healable().reduce(
      (sum, c) => sum + Math.ceil((maxHpOf(c) - hpOf(c)) / heals), 0);
  }

  /**
   * Spends potions across every hurt creature, using as many as each one needs
   * to reach full HP. Stops when the potions run out, part-healing the last one.
   */
  healAll() {
    const heals = itemDef('potion').heals || 50;
    let used = 0, fullyHealed = 0;
    const touched = [];

    for (const c of this.healable()) {
      if (!this.hasItem('potion')) break;
      const max = maxHpOf(c);
      let before = hpOf(c);
      while (hpOf(c) < max && this.hasItem('potion')) {
        this.spendItem('potion');
        used++;
        const next = Math.min(max, hpOf(c) + heals);
        c.hp = next >= max ? null : next;
      }
      if (hpOf(c) > before) touched.push({ uid: c.uid, speciesId: c.speciesId, before, after: hpOf(c), max });
      if (hpOf(c) >= max) fullyHealed++;
    }

    if (used) this.touch('potion', { immediate: true });
    return { ok: used > 0, used, healed: touched.length, fullyHealed, creatures: touched };
  }

  /**
   * One Full Heal per hurt creature, worst first so the most damaged benefit
   * if there are not enough to go round.
   */
  fullHealAll() {
    if (!this.hasItem('full_heal')) return { ok: false, reason: 'noItem' };
    const order = this.healable().sort((a, b) => hpOf(a) / maxHpOf(a) - hpOf(b) / maxHpOf(b));
    let used = 0;
    const touched = [];
    for (const c of order) {
      if (!this.hasItem('full_heal')) break;
      const before = hpOf(c), max = maxHpOf(c);
      c.hp = null;
      this.spendItem('full_heal');
      used++;
      touched.push({ uid: c.uid, speciesId: c.speciesId, before, after: max, max });
    }
    if (used) this.touch('full_heal', { immediate: true });
    return { ok: used > 0, used, healed: used, creatures: touched };
  }

  /** Revives every fainted creature it has revives for. */
  reviveAll() {
    let used = 0;
    const revived = [];
    for (const c of this.revivable()) {
      if (!this.hasItem('revive')) break;
      this.spendItem('revive');
      used++;
      c.hp = null;                       // null means full health
      revived.push({ uid: c.uid, speciesId: c.speciesId, max: maxHpOf(c) });
    }
    if (used) this.touch('revive', { immediate: true });
    return { ok: used > 0, used, revived: revived.length, creatures: revived };
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

  /** True while the running incense is the Rare variety. */
  isRareIncense(now = Date.now()) { return !!this.effect('incense', now)?.rare; }

  /** True while a Shiny Incense is burning, which pins shiny odds to 3%. */
  isShinyIncense(now = Date.now()) { return !!this.effect('incense', now)?.shiny; }

  /** The shiny-odds options for a roll made right now. */
  shinyOpts(now = Date.now()) { return { shinyIncense: this.isShinyIncense(now) }; }

  /**
   * Starts incense or the stardust magnet. One of each at a time — both
   * incense types share the slot, so Rare Incense cannot stack with a plain
   * one. `useItemId` chooses which incense is burned.
   */
  startEffect(kind, now = Date.now(), useItemId = null) {
    const itemId = useItemId || (kind === 'incense' ? 'incense' : 'stardust_magnet');
    if (this.effect(kind, now)) return { ok: false, reason: 'active' };
    if (!this.hasItem(itemId)) return { ok: false, reason: 'noItem' };

    const duration = kind === 'incense' ? RULES.INCENSE_DURATION_MS : RULES.MAGNET_DURATION_MS;
    this.spendItem(itemId);
    this.s.effects[kind] = {
      startedAt: now,
      endsAt: now + duration,
      lastSpawnAt: kind === 'incense' ? 0 : null,
      itemId,
      rare: itemId === 'rare_incense',
      shiny: itemId === 'shiny_incense'
    };
    this.touch('effect', { immediate: true });
    return {
      ok: true,
      endsAt: this.s.effects[kind].endsAt,
      rare: itemId === 'rare_incense',
      shiny: itemId === 'shiny_incense'
    };
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
        ? (this.s.debug.shinyBoost
          ? chance(0.5)
          : rollShiny(origin === 'raid' ? 'raid' : 'spawn', new Date(), this.shinyOpts()))
        : !!shiny,
      statMod: rollStatModifier(),
      moveUnlock: unlock || rollMoveUnlock(),
      boosts: emptyBoosts(),
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

    // Hatching pays the egg's own stardust and XP instead of the capture
    // values, and a Stardust Magnet does not apply — nothing was captured.
    const fromEgg = opts.dust != null || opts.xp != null;
    const magnet = !fromEgg && this.isMagnetActive();
    const candy = candyForCapture(rarity) + (opts.bonusCandy || 0);
    const dust = opts.dust != null
      ? opts.dust + dustBonusFor(this.level)
      : dustForCapture(rarity, this.level) + (magnet ? RULES.MAGNET_BONUS_MULTIPLIER * this.level : 0);
    const xp = opts.xp != null ? opts.xp : xpForCapture(rarity);

    const isNew = this.register(sp.id);
    const candyTotal = this.addCandy(sp.id, candy);
    const dustGained = this.addStardust(dust);   // may be doubled on a Sunday
    const levelUp = this.addXP(xp);

    this.s.caughtCount[sp.id] = (this.s.caughtCount[sp.id] || 0) + 1;
    if (creature.shiny) {
      this.s.stats.shinies++;
      this.s.shinyCaught[sp.id] = true;
    }
    // A hatch is not a catch, so it stays out of the capture missions.
    if (opts.countsAsCapture !== false) {
      this.s.stats.captures++;
      this.bumpDaily('capturesToday');
      this.bumpWeekly();
    }

    this.touch('capture', { immediate: true });
    return {
      creature, sp, isNew, candy, dust: dustGained, xp, candyTotal, levelUp, rarity,
      shiny: creature.shiny, magnet, origin, sunday: isStardustSunday()
    };
  }

  /* ---------------- raid and grunt rewards ---------------- */

  /** XP and stardust for beating a raid boss. Stardust scales with player level. */
  rewardRaidWin(raid) {
    const xp = raid.xp ?? 0;
    const dust = this.addStardust(dustInRange(raid.dustRange || [30, 40], this.level));
    const levelUp = this.addXP(xp);
    this.s.stats.raidsWon++;

    // Track wins per boss rarity so the "defeat a Rarity N raid" missions work.
    const rarity = Number(raid.rarity) || 0;
    if (rarity) {
      const byRarity = this.s.stats.raidsByRarity;
      byRarity[rarity] = (byRarity[rarity] || 0) + 1;
    }

    // Exclusive raids count towards both the general raid tallies above and
    // their own, so a normal "defeat 20 raids" mission still progresses.
    const exclusive = !!raid.exclusive;
    if (exclusive) {
      this.s.stats.exclusiveRaidsWon = (this.s.stats.exclusiveRaidsWon || 0) + 1;
      if (rarity) {
        const exByRarity = this.s.stats.exclusiveRaidsByRarity;
        exByRarity[rarity] = (exByRarity[rarity] || 0) + 1;
      }
    }

    // Guaranteed loot, then the rarity-dependent drops. Rarity 4 and 5 bosses
    // always hand over the incubator and can also drop a Rare Incense.
    const items = {};
    const drop = (id, n = 1) => {
      this.addItem(id, n);
      items[id] = (items[id] || 0) + n;
    };

    for (const [id, n] of Object.entries(RAID_REWARD.always || {})) drop(id, n);
    if (chance(raidIncubatorChance(rarity))) drop(RAID_REWARD.incubatorItem);
    if (chance(raidRareIncenseChance(rarity))) drop(RAID_REWARD.rareIncenseItem);

    // Exclusive raids add two independent bonus rolls on top of everything a
    // normal raid pays. The egg can be lost to full exclusive storage.
    let egg = null;
    let eggBlocked = false;
    if (exclusive) {
      if (chance(EXCLUSIVE_RAID_REWARD.shinyIncenseChance)) {
        drop(EXCLUSIVE_RAID_REWARD.shinyIncenseItem);
      }
      if (chance(EXCLUSIVE_RAID_REWARD.eggChance)) {
        const r = this.addEgg(EXCLUSIVE_EGG_TYPE);
        if (r.ok) egg = r.egg; else eggBlocked = true;
      }
    }

    this.touch('raid-win', { immediate: true });
    return {
      xp, dust, levelUp, items, exclusive, egg, eggBlocked,
      sunday: isStardustSunday()
    };
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
    const dust = this.addStardust(dustInRange(GRUNT_REWARD.dust, this.level));
    const bonus = weightedPick(GRUNT_REWARD.bonus).item;
    if (bonus) this.addItem(bonus, 1);

    // Grunts always hand over healing supplies.
    const items = rollGruntItems();
    // Plus the guaranteed drop, and the independent extra rolls on top.
    for (const [id, n] of Object.entries(GRUNT_REWARD.always || {})) {
      items[id] = (items[id] || 0) + n;
    }
    for (const extra of GRUNT_REWARD.extras || []) {
      if (chance(extra.chance)) items[extra.item] = (items[extra.item] || 0) + 1;
    }
    for (const [id, n] of Object.entries(items)) this.addItem(id, n);

    this.s.stats.gruntsBeaten++;
    this.touch('grunt-win', { immediate: true });
    return { dust, bonus, items, sunday: isStardustSunday() };
  }

  /* ---------------- level up ---------------- */

  canLevelUp(uid) {
    const c = this.creature(uid);
    if (!c) return { ok: false, reason: 'missing' };
    if (c.breeding != null) return { ok: false, reason: 'breeding' };
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
    if (this.isBuddy(uid)) return { ok: false, reason: 'buddy' };

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
      if (this.isBuddy(uid)) continue;   // your buddy is never released in bulk
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

  /* ---------------- the grunt who finds you ---------------- */

  /** True when this 8-hour window has not produced its grunt yet. */
  canSpawnWindowGrunt(now = new Date()) {
    return this.s.gruntWindow !== gruntWindowKey(now);
  }

  markWindowGruntSpawned(now = new Date()) {
    this.s.gruntWindow = gruntWindowKey(now);
    this.touch('grunt-window', { immediate: true });
  }

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

  /* ---------------- research lab ---------------- */

  placeResearchLab(lat, lng) {
    if (this.s.researchLab) return { ok: false, reason: 'placed' };
    if (!this.hasItem('research_lab')) return { ok: false, reason: 'noItem' };
    this.spendItem('research_lab');
    this.s.researchLab = { lat, lng, placedAt: Date.now() };
    this.touch('research-lab', { immediate: true });
    return { ok: true };
  }

  /** Candy needed for one Stat Booster from this species' family. */
  statBoosterCostFor(speciesId) {
    const sp = species(speciesId);
    if (!sp) return Infinity;
    return statBoosterCost(sp.rarity || familyRarity(sp.id) || 1);
  }

  /**
   * Every family whose candy could buy at least one Stat Booster, newest-first
   * by how many it could make. Keyed on the family root, because candy is held
   * per family rather than per species.
   */
  statBoosterOptions() {
    const out = [];
    for (const [rootId, candy] of Object.entries(this.s.candy)) {
      const sp = species(rootId);
      if (!sp || candy <= 0) continue;
      const cost = this.statBoosterCostFor(rootId);
      if (!isFinite(cost) || candy < cost) continue;
      out.push({
        speciesId: rootId,
        species: sp,
        candy,
        cost,
        max: Math.floor(candy / cost)
      });
    }
    return out.sort((a, b) => b.max - a.max || a.species.order - b.species.order);
  }

  /** Turns family candy into Stat Boosters. */
  craftStatBoosters(speciesId, qty = 1) {
    const n = Math.max(1, Math.floor(Number(qty) || 1));
    if (!this.s.researchLab) return { ok: false, reason: 'noLab' };
    const sp = species(speciesId);
    if (!sp) return { ok: false, reason: 'missing' };

    const cost = this.statBoosterCostFor(speciesId);
    const total = cost * n;
    const have = this.candyFor(speciesId);
    if (have < total) return { ok: false, reason: 'candy', cost, total, have, short: total - have };

    this.spendCandy(speciesId, total);
    this.addItem(STAT_BOOSTER_ITEM, n);
    this.touch('craft', { immediate: true });
    return {
      ok: true, made: n, spent: total, cost,
      candyLeft: this.candyFor(speciesId),
      species: sp
    };
  }

  /* ---------------- stat boosters ---------------- */

  boostsOf(c) { return c?.boosts || emptyBoosts(); }
  boostsUsed(c) { return totalBoosts(this.boostsOf(c)); }
  boostsLeftOn(c) { return boostsLeft(this.boostsOf(c)); }

  canBoostStat(uid) {
    const c = this.creature(uid);
    if (!c) return { ok: false, reason: 'missing' };
    if (!this.hasItem(STAT_BOOSTER_ITEM)) return { ok: false, reason: 'noItem' };
    if (c.breeding != null) return { ok: false, reason: 'breeding' };
    if (this.boostsLeftOn(c) <= 0) return { ok: false, reason: 'maxed', max: MAX_STAT_BOOSTS };
    return { ok: true, left: this.boostsLeftOn(c) };
  }

  /**
   * Spends one Stat Booster to add a permanent +1 to `stat`. HP is the awkward
   * one: raising the maximum should not silently leave the creature short of
   * full, so a creature already at full HP stays at full.
   */
  useStatBooster(uid, stat) {
    if (!STAT_KEYS.includes(stat)) return { ok: false, reason: 'badStat' };
    const check = this.canBoostStat(uid);
    if (!check.ok) return check;

    const c = this.creature(uid);
    const wasFull = c.hp == null || hpOf(c) >= maxHpOf(c);
    const before = creatureStats(c);

    if (!c.boosts) c.boosts = emptyBoosts();
    c.boosts[stat] = (Number(c.boosts[stat]) || 0) + 1;
    this.spendItem(STAT_BOOSTER_ITEM);

    // A creature at full health stays at full when its max HP grows.
    if (stat === 'hp' && wasFull) c.hp = null;

    this.touch('stat-booster', { immediate: true });
    return {
      ok: true,
      stat,
      before: before[stat],
      after: creatureStats(c)[stat],
      used: this.boostsUsed(c),
      left: this.boostsLeftOn(c)
    };
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
    if (this.s.daily.date !== dayKey()) this.s.daily = blankDaily();
    this.s.daily[key] = (this.s.daily[key] || 0) + n;
  }

  /**
   * Feeds walked metres into the daily and weekly walk missions. Kept apart
   * from bumpWeekly because that one also stamps "caught something today",
   * and walking is not catching.
   */
  addWalkMissionProgress(metres) {
    if (!isFinite(metres) || metres <= 0) return false;

    if (this.s.daily.date !== dayKey()) this.s.daily = blankDaily();
    if (this.s.weekly.week !== weekKey()) this.s.weekly = blankWeekly();

    const dayBefore = Number(this.s.daily.metresToday) || 0;
    const weekBefore = Number(this.s.weekly.metresWeek) || 0;
    this.s.daily.metresToday = dayBefore + metres;
    this.s.weekly.metresWeek = weekBefore + metres;

    // Did this step finish a walk mission? Reported so the caller can light up
    // the Missions badge straight away rather than at the next full refresh.
    const crossed = (before, after, kind, table) => table.some(m =>
      m.kind === kind && before < m.target && after >= m.target);
    return crossed(dayBefore, this.s.daily.metresToday, 'metresToday', DAILY_MISSIONS)
      || crossed(weekBefore, this.s.weekly.metresWeek, 'metresWeek', WEEKLY_MISSIONS);
  }

  /** Counts a capture towards the weekly missions, rolling the week if needed. */
  bumpWeekly(n = 1) {
    const wk = weekKey();
    if (this.s.weekly.week !== wk) this.s.weekly = blankWeekly();
    this.s.weekly.capturesWeek = (this.s.weekly.capturesWeek || 0) + n;
    this.s.weekly.days[dayKey()] = true;
  }

  /** Live weekly figures, treating a stale week as empty. */
  get weekly() {
    return this.s.weekly.week === weekKey() ? this.s.weekly : blankWeekly();
  }

  missionProgress(m) {
    switch (m.kind) {
      case 'registered': return this.registeredCount;
      case 'capturesWeek': return this.weekly.capturesWeek || 0;
      case 'daysCaughtThisWeek': return Object.keys(this.weekly.days || {}).length;
      case 'captures': return this.s.stats.captures;
      case 'raidsWon': return this.s.stats.raidsWon;
      case 'gruntsBeaten': return this.s.stats.gruntsBeaten;
      case 'eggsHatched': return this.s.stats.eggsHatched;
      case 'raidRarity': return this.s.stats.raidsByRarity?.[m.rarity] || 0;
      // How many creatures of one set are registered. Counted off the registry
      // rather than a tally, so it always matches the Collection.
      case 'registeredInSet': {
        let n = 0;
        for (const id of Object.keys(this.s.registered)) {
          if (species(id)?.set === m.set) n++;
        }
        return n;
      }
      case 'exclusiveRaidsWon': return this.s.stats.exclusiveRaidsWon || 0;
      case 'exclusiveRaidRarity':
        return this.s.stats.exclusiveRaidsByRarity?.[m.rarity] || 0;
      // Counted live off storage rather than a stored tally, so releasing a
      // creature takes its contribution back with it.
      case 'creaturesAtLevel':
        return this.s.storage.filter(c => (Number(c.level) || 1) >= m.level).length;
      case 'capturesToday':
        return this.s.daily.date === dayKey() ? (this.s.daily.capturesToday || 0) : 0;
      // Walk missions are held in metres and shown in km by the UI.
      case 'metresToday':
        return this.s.daily.date === dayKey() ? (this.s.daily.metresToday || 0) : 0;
      case 'metresWeek': return this.weekly.metresWeek || 0;
      default: return 0;
    }
  }

  /** `scope` is 'lifetime', 'daily' or 'weekly'. */
  missionState(m, scope = 'lifetime') {
    const progress = this.missionProgress(m);
    const claimed = scope === 'daily' ? !!this.s.daily.claimed?.[m.id]
      : scope === 'weekly' ? !!this.weekly.claimed?.[m.id]
      // 'lifetime' and 'set' share the permanent store.
      : !!this.s.missions[m.id];
    // A mission can carry a second condition on top of its bar. `requireLevel`
    // does not move the bar, it just holds the claim back until you get there.
    const levelMet = !m.requireLevel || this.level >= m.requireLevel;
    const hit = progress >= m.target;
    return {
      def: m, scope, daily: scope === 'daily', weekly: scope === 'weekly',
      progress,
      target: m.target,
      levelMet,
      levelNeeded: m.requireLevel || null,
      complete: hit && levelMet,
      claimed,
      claimable: hit && levelMet && !claimed
    };
  }

  allMissions() {
    return [
      ...MISSIONS.map(m => this.missionState(m, 'lifetime')),
      // Set missions never reset, so they claim into the same store as lifetime.
      ...SET_MISSIONS.map(m => this.missionState(m, 'set')),
      ...WEEKLY_MISSIONS.map(m => this.missionState(m, 'weekly')),
      ...DAILY_MISSIONS.map(m => this.missionState(m, 'daily'))
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

    const dust = this.addStardust(m.def.dust + dustBonusFor(this.level));
    const levelUp = this.addXP(m.def.xp);

    // Bonus items (e.g. capture discs on daily missions)
    const bonusDiscs = m.def.discs || 0;
    if (bonusDiscs > 0) this.addItem('capture_disc', bonusDiscs);

    // Any extra named items the mission hands out
    const bonusItems = {};
    for (const [itemId, n] of Object.entries(m.def.items || {})) {
      if (!ITEMS[itemId] || !(n > 0)) continue;
      this.addItem(itemId, n);
      bonusItems[itemId] = n;
    }

    // A Set mission opens a Galactic Adventures rarity. This is what actually
    // puts those creatures into circulation, so it happens before the pools are
    // rebuilt below.
    let unlockedRarity = null;
    if (m.def.unlockGalacticRarity) {
      unlockedRarity = m.def.unlockGalacticRarity;
      if (!this.s.galacticUnlocked.includes(unlockedRarity)) {
        this.s.galacticUnlocked.push(unlockedRarity);
        this.s.galacticUnlocked.sort((a, b) => a - b);
      }
      this.syncGalacticUnlocks();
    }

    // Some missions hand over an egg. The mythical egg ignores storage limits,
    // so a full bag can never cost the player a one-off reward.
    let egg = null;
    if (m.def.grantEgg) {
      const r = this.addEgg(m.def.grantEgg, { ignoreLimit: true });
      if (r.ok) egg = r.egg;
    }

    if (m.scope === 'daily') {
      this.s.daily.claimed = this.s.daily.claimed || {};
      this.s.daily.claimed[id] = Date.now();
    } else if (m.scope === 'weekly') {
      if (this.s.weekly.week !== weekKey()) this.s.weekly = blankWeekly();
      this.s.weekly.claimed[id] = Date.now();
    } else {
      // 'lifetime' and 'set' both live here: neither ever resets.
      this.s.missions[id] = { claimedAt: Date.now() };
    }
    this.touch('mission', { immediate: true });
    return {
      ok: true, xp: m.def.xp, dust, levelUp, label: m.def.label,
      discs: bonusDiscs, items: bonusItems,
      unlockedRarity, egg
    };
  }

  /* ---------------- Galactic Adventures unlocks ---------------- */

  get galacticUnlocked() { return [...this.s.galacticUnlocked]; }
  isGalacticUnlocked(rarity) { return this.s.galacticUnlocked.includes(Number(rarity)); }

  /** Pushes the unlocked rarities into data.js, which rebuilds the spawn pools. */
  syncGalacticUnlocks() {
    setGalacticUnlocked(this.s.galacticUnlocked);
  }

  /* ---------------- debug / ui ---------------- */

  setDebug(patch) { Object.assign(this.s.debug, patch); this.touch('debug'); }
  setUI(patch) { Object.assign(this.s.ui, patch); this.touch('ui'); }
}

export const store = new Store();
