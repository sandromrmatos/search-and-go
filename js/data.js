/* ============================================================
   data.js — creature data, families, and all game tables
   ============================================================ */

export const CSV_FILE = 'Elemental Awakening Creatures.csv';
export const SET_NAME = 'Elemental Awakening';

/* ---------------------------------------------------------------
   Tunable game rules (all values come from the game spec)
   --------------------------------------------------------------- */
export const RULES = {
  SCAN_RADIUS_M: 250,         // POI search radius around the player
  CAPTURE_RANGE_M: 5,         // must be this close to capture
  SPAWN_CHANCE: 0.30,         // 30% chance per eligible POI per scan
  SPAWN_MIN_MS: 10 * 60_000,  // spawn lifetime lower bound (10 min)
  SPAWN_MAX_MS: 20 * 60_000,  // spawn lifetime upper bound (20 min)
  MIN_SPAWN_SEPARATION_M: 25, // no two spawns within 25 m
  SCAN_INTERVAL_MS: 5 * 60_000, // re-scan every 5 minutes
  CAPTURE_ANIM_MS: 5000,      // 5 second capture animation
  EVOLVE_ANIM_MS: 5000        // 5 second evolution animation
};


/* Rarity → spawn weight (%) */
export const RARITY_WEIGHTS = { 1: 60, 2: 28, 3: 8, 4: 3, 5: 1 };

export const RARITY_NAMES = {
  1: 'Common', 2: 'Uncommon', 3: 'Rare', 4: 'Epic', 5: 'Legendary'
};

/* Rarity → [minCandy, maxCandy] awarded on capture */
export const CANDY_ON_CAPTURE = {
  1: [3, 5], 2: [3, 6], 3: [4, 6], 4: [5, 7], 5: [6, 8]
};

/* Rarity → [minDust, maxDust] awarded on capture */
export const DUST_ON_CAPTURE = {
  1: [10, 15], 2: [12, 18], 3: [15, 20], 4: [20, 30], 5: [30, 50]
};

/* Rarity → player XP awarded on capture */
export const XP_ON_CAPTURE = { 1: 2, 2: 3, 3: 5, 4: 10, 5: 20 };

/* Player XP awarded on evolution, keyed by the stage you evolve FROM */
export const XP_ON_EVOLVE = { 1: 30, 2: 50 };

/* Candy awarded for deleting a creature (always to the family) */
export const CANDY_ON_DELETE = 1;

/* Stardust cost to reach the given creature level (from the previous one) */
export const CREATURE_LEVEL_COST = {
  2: 25, 3: 70, 4: 150, 5: 300, 6: 500, 7: 800, 8: 1100, 9: 1400, 10: 1800
};
export const MAX_CREATURE_LEVEL = 10;

/* Cumulative player XP needed to reach each player level */
export const PLAYER_LEVEL_XP = {
  1: 0,
  2: 25,
  3: 100,
  4: 250,
  5: 1000,
  6: 2000,
  7: 3500,
  8: 6000,
  9: 10000,
  10: 15000,
  11: 22000,
  12: 30000,
  13: 38000,
  14: 45000,
  15: 50000
};
export const MAX_PLAYER_LEVEL = 15;

export const TYPES = ['Neutral', 'Mystic', 'Wind', 'Celestial', 'Mechanic'];

/* Sets shown in the Collection menu (index 0 is the real one) */
export const SETS = [
  { id: 'elemental-awakening', title: SET_NAME, available: true },
  { id: 'coming-soon', title: 'Coming Soon', available: false }
];

/* ---------------------------------------------------------------
   CSV parsing
   --------------------------------------------------------------- */

/** Minimal RFC-4180-ish CSV parser (handles quotes, CRLF, embedded commas). */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;

  // strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  // drop fully-empty rows
  return rows.filter(r => r.some(v => String(v).trim() !== ''));
}

function stageNumber(raw) {
  const m = String(raw).match(/(\d+)/);
  return m ? Number(m[1]) : 1;
}

/* ---------------------------------------------------------------
   Species database
   --------------------------------------------------------------- */

export class Species {
  constructor(o) { Object.assign(this, o); }
  get imagePath() { return 'images/' + encodeURIComponent(this.image); }
  get rarityName() { return this.rarity ? RARITY_NAMES[this.rarity] : null; }
  get stageLabel() { return `Stage ${this.stage}`; }
}

export const DB = {
  loaded: false,
  species: [],              // ordered by CSV / id
  byId: new Map(),
  byName: new Map(),
  stage1: [],
  spawnable: [],            // stage 1 AND has a rarity
  byRarity: { 1: [], 2: [], 3: [], 4: [], 5: [] },
  familyOf: new Map(),      // speciesId -> root speciesId
  familyMembers: new Map(), // rootId -> [speciesId, ...] in evolution order
  evolvesFrom: new Map(),   // speciesId -> speciesId that evolves into it
  types: []
};

export async function loadDatabase(csvUrl = CSV_FILE) {
  const res = await fetch(encodeURI(csvUrl) + '?v=' + Date.now());
  if (!res.ok) throw new Error(`Could not load "${csvUrl}" (HTTP ${res.status})`);
  const rows = parseCSV(await res.text());
  if (rows.length < 2) throw new Error('Creature CSV looks empty');

  const header = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names) => {
    for (const n of names) {
      const i = header.indexOf(n.toLowerCase());
      if (i !== -1) return i;
    }
    return -1;
  };
  const cId      = col('id_output', 'id');
  const cName    = col('name');
  const cStage   = col('stage');
  const cType    = col('type');
  const cImage   = col('image');
  const cRarity  = col('rarity');
  const cEvolves = col('evolves to', 'evolves_to', 'evolvesto');
  const cCandy   = col('evolution candy', 'evolution_candy', 'evolutioncandy');

  if (cId < 0 || cName < 0) throw new Error('Creature CSV is missing id/Name columns');

  DB.species = [];
  DB.byId.clear(); DB.byName.clear();
  DB.evolvesFrom.clear(); DB.familyOf.clear(); DB.familyMembers.clear();
  DB.stage1 = []; DB.spawnable = [];
  DB.byRarity = { 1: [], 2: [], 3: [], 4: [], 5: [] };

  rows.slice(1).forEach((r, idx) => {
    const get = i => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');
    const id = get(cId);
    if (!id) return;
    const rarityRaw = get(cRarity);
    const candyRaw = get(cCandy);
    const numMatch = id.match(/(\d+)\s*$/);

    const sp = new Species({
      id,
      order: numMatch ? Number(numMatch[1]) : idx + 1,
      name: get(cName),
      stage: stageNumber(get(cStage)),
      type: get(cType) || 'Neutral',
      image: get(cImage) || `${get(cName)}.png`,
      rarity: rarityRaw ? Number(rarityRaw) : null,
      evolvesToName: get(cEvolves) || null,
      evolutionCandy: candyRaw ? Number(candyRaw) : null,
      set: SET_NAME
    });

    DB.species.push(sp);
    DB.byId.set(sp.id, sp);
    DB.byName.set(sp.name.toLowerCase(), sp);
  });

  DB.species.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  // resolve evolution links by name
  for (const sp of DB.species) {
    sp.evolvesToId = null;
    if (sp.evolvesToName) {
      const target = DB.byName.get(sp.evolvesToName.toLowerCase());
      if (target) {
        sp.evolvesToId = target.id;
        DB.evolvesFrom.set(target.id, sp.id);
      } else {
        console.warn(`[data] "${sp.name}" evolves to unknown creature "${sp.evolvesToName}"`);
      }
    }
  }

  // families: walk from every root (a species nothing evolves into)
  for (const sp of DB.species) {
    if (DB.evolvesFrom.has(sp.id)) continue; // not a root
    const chain = [];
    let cur = sp, guard = 0;
    while (cur && guard++ < 12) {
      chain.push(cur.id);
      DB.familyOf.set(cur.id, sp.id);
      cur = cur.evolvesToId ? DB.byId.get(cur.evolvesToId) : null;
    }
    DB.familyMembers.set(sp.id, chain);
  }
  // safety net for any orphan
  for (const sp of DB.species) if (!DB.familyOf.has(sp.id)) {
    DB.familyOf.set(sp.id, sp.id);
    DB.familyMembers.set(sp.id, [sp.id]);
  }

  DB.stage1 = DB.species.filter(s => s.stage === 1);
  DB.spawnable = DB.stage1.filter(s => s.rarity >= 1 && s.rarity <= 5);
  for (const sp of DB.spawnable) DB.byRarity[sp.rarity].push(sp);

  DB.types = TYPES.filter(t => DB.species.some(s => s.type === t));
  for (const s of DB.species) if (!DB.types.includes(s.type)) DB.types.push(s.type);

  DB.loaded = true;
  return DB;
}

/* ---------------------------------------------------------------
   Helpers
   --------------------------------------------------------------- */

export const species = id => DB.byId.get(id) || null;

export const familyRoot = id => DB.familyOf.get(id) || id;

export const familyRootSpecies = id => species(familyRoot(id));

/** Family display name — always the Stage 1 creature's name. */
export const familyName = id => (familyRootSpecies(id)?.name ?? '?');

/** Rarity of the family's Stage 1 creature (used for reward tables). */
export const familyRarity = id => familyRootSpecies(id)?.rarity ?? 1;

export function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Pick a rarity tier using the weighted spawn table. */
export function rollRarity() {
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const tier of [1, 2, 3, 4, 5]) {
    r -= RARITY_WEIGHTS[tier];
    if (r < 0) return tier;
  }
  return 1;
}

/** Roll a full spawn: weighted rarity, then a uniform pick inside that tier. */
export function rollSpawnSpecies() {
  for (let attempt = 0; attempt < 6; attempt++) {
    const tier = rollRarity();
    const pool = DB.byRarity[tier];
    if (pool && pool.length) return pool[Math.floor(Math.random() * pool.length)];
  }
  return DB.spawnable[Math.floor(Math.random() * DB.spawnable.length)];
}

export const candyForCapture = rarity => randInt(...(CANDY_ON_CAPTURE[rarity] ?? [3, 5]));
export const dustForCapture  = rarity => randInt(...(DUST_ON_CAPTURE[rarity] ?? [10, 15]));
export const xpForCapture    = rarity => XP_ON_CAPTURE[rarity] ?? 2;

/** Stardust needed to go from `level` to `level + 1`, or null if maxed. */
export function levelUpCost(level) {
  const next = level + 1;
  return next <= MAX_CREATURE_LEVEL ? CREATURE_LEVEL_COST[next] : null;
}

/** Player level for a given total XP. */
export function playerLevelFor(xp) {
  let lvl = 1;
  for (let l = 2; l <= MAX_PLAYER_LEVEL; l++) {
    if (xp >= PLAYER_LEVEL_XP[l]) lvl = l; else break;
  }
  return lvl;
}

/** XP progress info for the HUD. */
export function playerProgress(xp) {
  const level = playerLevelFor(xp);
  const cur = PLAYER_LEVEL_XP[level] ?? 0;
  if (level >= MAX_PLAYER_LEVEL) {
    return { level, cur: xp, into: 0, need: 0, pct: 100, max: true, nextAt: null };
  }
  const nextAt = PLAYER_LEVEL_XP[level + 1];
  const span = nextAt - cur;
  const into = xp - cur;
  return { level, cur: xp, into, need: span, pct: span ? Math.min(100, (into / span) * 100) : 0, max: false, nextAt };
}
