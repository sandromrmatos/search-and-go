/* ============================================================
   data.js — creature data, families, stats, moves and every game table

   Two CSVs are joined on `id_output`:
     • Elemental Awakening Creatures.csv            — species list, images
     • Elemental Awakening Creatures Stats and Moves.csv — stats + learnsets
   ============================================================ */

export const CSV_FILE = 'Elemental Awakening Creatures.csv';
export const STATS_CSV_FILE = 'Elemental Awakening Creatures Stats and Moves.csv';
export const SET_NAME = 'Elemental Awakening';

export const IMAGE_DIR = 'images';
export const SHINY_DIR = 'shiny';
export const ITEM_DIR = 'items';

/* ---------------------------------------------------------------
   Core rules
   --------------------------------------------------------------- */
export const RULES = {
  SCAN_RADIUS_M: 250,           // POI search radius around the player
  CAPTURE_RANGE_M: 5,           // must be this close to interact with anything
  MIN_SPAWN_SEPARATION_M: 25,   // no two map points within 25 m
  MIN_GRUNT_SEPARATION_M: 50,   // grunts also keep 50 m from each other
  SCAN_INTERVAL_MS: 5 * 60_000, // everything re-rolls every 5 minutes

  CAPTURE_ANIM_MS: 5000,
  EVOLVE_ANIM_MS: 5000,

  // Lifetimes, per map-point kind
  LIFETIME_MS: {
    creature: [15 * 60_000, 25 * 60_000],
    discs:    [15 * 60_000, 25 * 60_000],
    items:    [15 * 60_000, 25 * 60_000],
    raid:     [25 * 60_000, 35 * 60_000],
    grunt:    [20 * 60_000, 25 * 60_000],
    incense:  [90_000, 90_000]           // incense spawns live 1 min 30 s
  },

  // Parks roll separately from shops/amenities
  GRUNT_CHANCE: 0.20,

  // Incense
  INCENSE_DURATION_MS: 20 * 60_000,
  INCENSE_EVERY_MS: 2 * 60_000,

  // Stardust magnet
  MAGNET_DURATION_MS: 15 * 60_000,
  MAGNET_BONUS_DUST: 2
};

/**
 * What a shop/amenity POI turns into on each scan. Weights are percentages
 * and must total 100.
 */
export const POI_OUTCOMES = [
  { kind: 'creature', weight: 15 },
  { kind: 'discs',    weight: 25 },
  { kind: 'items',    weight: 15 },
  { kind: 'raid',     weight: 5 },
  { kind: 'nothing',  weight: 40 }
];

/** A "discs" point rolls one of these payloads. */
export const DISC_DROPS = [
  { weight: 90, items: { capture_disc: 1 } },
  { weight: 5,  items: { capture_disc: 2 } },
  { weight: 5,  items: { ultra_disc: 1 } }
];

/** An "items" point rolls one of these payloads. */
export const ITEM_DROPS = [
  { weight: 50, items: { potion: 1 } },
  { weight: 50, items: { revive: 1 } }
];

/* ---------------------------------------------------------------
   Rarity
   --------------------------------------------------------------- */
export const RARITY_WEIGHTS = { 1: 60, 2: 28, 3: 8, 4: 3, 5: 1 };

export const RARITY_NAMES = {
  1: 'Common', 2: 'Uncommon', 3: 'Rare', 4: 'Epic', 5: 'Legendary'
};

export const CANDY_ON_CAPTURE = {
  1: [3, 5], 2: [3, 6], 3: [4, 6], 4: [5, 7], 5: [6, 8]
};

export const DUST_ON_CAPTURE = {
  1: [10, 15], 2: [12, 18], 3: [15, 20], 4: [20, 30], 5: [30, 50]
};

export const XP_ON_CAPTURE = { 1: 2, 2: 3, 3: 5, 4: 10, 5: 20 };

export const XP_ON_EVOLVE = { 1: 30, 2: 50 };

export const CANDY_ON_DELETE = 1;

/** Extra candy for capturing the boss at the end of a raid. */
export const RAID_CAPTURE_BONUS_CANDY = 2;
/** Creatures caught from a raid always arrive at this level. */
export const RAID_CAPTURE_LEVEL = 3;

/* ---------------------------------------------------------------
   Levelling
   --------------------------------------------------------------- */

/** Cost to reach the given creature level: stardust + candy of that family. */
export const CREATURE_LEVEL_COST = {
  2:  { stardust: 250,   candy: 10 },
  3:  { stardust: 600,   candy: 20 },
  4:  { stardust: 1200,  candy: 40 },
  5:  { stardust: 2500,  candy: 80 },
  6:  { stardust: 4500,  candy: 130 },
  7:  { stardust: 8000,  candy: 200 },
  8:  { stardust: 15000, candy: 300 },
  9:  { stardust: 28000, candy: 400 },
  10: { stardust: 50000, candy: 500 }
};
export const MAX_CREATURE_LEVEL = 10;

/** Every creature level adds 5% of the base stat (linear, not compounding). */
export const STAT_GROWTH_PER_LEVEL = 0.05;

export const PLAYER_LEVEL_XP = {
  1: 0, 2: 25, 3: 100, 4: 250, 5: 1000, 6: 2000, 7: 3500, 8: 6000,
  9: 10000, 10: 15000, 11: 22000, 12: 30000, 13: 38000, 14: 45000, 15: 50000
};
export const MAX_PLAYER_LEVEL = 15;

/** Every player level past 1 adds this much to any stardust reward. */
export const DUST_BONUS_PER_PLAYER_LEVEL = 1;

/* ---------------------------------------------------------------
   Types and battle
   --------------------------------------------------------------- */
export const TYPES = ['Neutral', 'Mystic', 'Wind', 'Celestial', 'Mechanic'];

export const STAT_KEYS = ['hp', 'attack', 'defence', 'speed'];
export const STAT_LABELS = { hp: 'HP', attack: 'Attack', defence: 'Defence', speed: 'Speed' };

/** attacker type -> the type it hits for extra damage. */
export const TYPE_ADVANTAGE = {
  Mystic: 'Wind',
  Wind: 'Celestial',
  Celestial: 'Mystic',
  Mechanic: 'Neutral',
  Neutral: null
};
export const SUPER_EFFECTIVE_MULTIPLIER = 1.2;

export const BATTLE_TEAM_SIZE = 3;

/* Raid bosses are beefed up versions of a normal creature. */
export const RAID_BOSS_MODIFIERS = { hp: 3, attack: 1.1, defence: 1.1, speed: 1.1 };

/** Which rarity a raid is, what level the boss is, and what beating it pays. */
export const RAID_TIERS = {
  1: { weight: 30, levels: [3, 4], xp: 10, dust: [30, 40] },
  2: { weight: 25, levels: [4, 5], xp: 15, dust: [40, 50] },
  3: { weight: 20, levels: [5, 6], xp: 25, dust: [45, 60] },
  4: { weight: 15, levels: [6, 7], xp: 50, dust: [55, 75] },
  5: { weight: 10, levels: [7, 8], xp: 80, dust: [70, 100] }
};

/* ---------------------------------------------------------------
   Battle grunts
   --------------------------------------------------------------- */
export const GRUNT_CHARACTERS = [
  { id: 'young_man',   label: 'Young man' },
  { id: 'young_woman', label: 'Young woman' },
  { id: 'adult_man',   label: 'Adult man' },
  { id: 'adult_woman', label: 'Adult woman' }
];

export const GRUNT_PHRASES = [
  "I'm so excited to be battling you!",
  "You picked the wrong park to walk through.",
  "My team has been training all week for this.",
  "Don't hold back — I certainly won't.",
  "I've never lost a battle in this park. Let's keep it that way.",
  "Three of yours against three of mine. Simple.",
  "You look strong. Good, this should be fun.",
  "I was hoping someone would finally challenge me.",
  "Let's see whose creatures have been better looked after.",
  "Win or lose, this is going to be a good one."
];

/** Grunt creature levels scale with the player's level. */
export const GRUNT_LEVEL_BANDS = [
  { maxPlayerLevel: 3,        levels: [2, 3] },
  { maxPlayerLevel: 5,        levels: [3, 6] },
  { maxPlayerLevel: 7,        levels: [5, 7] },
  { maxPlayerLevel: Infinity, levels: [6, 9] }
];

export const GRUNT_REWARD = {
  dust: [50, 75],
  bonus: [
    { weight: 5,  item: 'incense' },
    { weight: 5,  item: 'stardust_magnet' },
    { weight: 90, item: null }
  ]
};

/* ---------------------------------------------------------------
   Shiny
   --------------------------------------------------------------- */
export const SHINY_ODDS = {
  normal: { spawn: 0.01, raid: 0.02 },
  bonanza: { spawn: 0.02, raid: 0.04 }
};

/** Shiny Bonanza Hour: local 17:00–17:59. */
export const BONANZA_HOUR = 17;

/* ---------------------------------------------------------------
   Move unlock luck (rolled once per captured creature, kept by the family)
   NOTE: the brief lists 20 + 20 + 10 + 2 + 38 = 90. The missing 10 points are
   parked on "no change" until confirmed — change NONE_WEIGHT to rebalance.
   --------------------------------------------------------------- */
export const MOVE_UNLOCK_ROLL = [
  { weight: 20, offsets: { 3: 0, 4: 1 } },
  { weight: 20, offsets: { 3: 1, 4: 0 } },
  { weight: 10, offsets: { 3: 1, 4: 1 } },
  { weight: 2,  offsets: { 3: 2, 4: 2 } },
  { weight: 48, offsets: { 3: 0, 4: 0 } }   // 38 in the brief + the spare 10
];

/* ---------------------------------------------------------------
   Breeding centre
   --------------------------------------------------------------- */
export const BREEDING_UNLOCK_LEVEL = 3;

/** Player level -> total slots available. */
export const BREEDING_SLOTS_BY_LEVEL = { 3: 1, 5: 2, 7: 3, 8: 4, 9: 5 };

/** Hours to generate one candy, by the pair's Stage 1 rarity. */
export const BREEDING_HOURS = { 1: 12, 2: 12, 3: 18, 4: 24, 5: 36 };

export const BREEDING_CANDY_CAP = 5;

/* ---------------------------------------------------------------
   Missions
   --------------------------------------------------------------- */
export const MISSIONS = [
  { id: 'reg5',    kind: 'registered', target: 5,    xp: 10,  dust: 50,  label: 'Register 5 unique creatures' },
  { id: 'reg10',   kind: 'registered', target: 10,   xp: 20,  dust: 100, label: 'Register 10 unique creatures' },
  { id: 'reg20',   kind: 'registered', target: 20,   xp: 40,  dust: 150, label: 'Register 20 unique creatures' },
  { id: 'reg50',   kind: 'registered', target: 50,   xp: 50,  dust: 200, label: 'Register 50 unique creatures' },
  { id: 'cat50',   kind: 'captures',   target: 50,   xp: 5,   dust: 20,  label: 'Catch 50 creatures' },
  { id: 'cat100',  kind: 'captures',   target: 100,  xp: 10,  dust: 50,  label: 'Catch 100 creatures' },
  { id: 'cat200',  kind: 'captures',   target: 200,  xp: 20,  dust: 100, label: 'Catch 200 creatures' },
  { id: 'cat500',  kind: 'captures',   target: 500,  xp: 50,  dust: 200, label: 'Catch 500 creatures' },
  { id: 'cat1000', kind: 'captures',   target: 1000, xp: 100, dust: 300, label: 'Catch 1000 creatures' }
];

export const DAILY_MISSIONS = [
  { id: 'daily5',  kind: 'capturesToday', target: 5,  xp: 5,  dust: 20, label: 'Catch 5 creatures today' },
  { id: 'daily20', kind: 'capturesToday', target: 20, xp: 10, dust: 30, label: 'Catch 20 creatures today' },
  { id: 'daily50', kind: 'capturesToday', target: 50, xp: 20, dust: 50, label: 'Catch 50 creatures today' }
];

/* ---------------------------------------------------------------
   Sets shown in the Collection menu
   --------------------------------------------------------------- */
export const SETS = [
  { id: 'elemental-awakening', title: SET_NAME, available: true },
  { id: 'coming-soon', title: 'Coming Soon', available: false }
];

/* ===============================================================
   CSV parsing
   =============================================================== */

/** Minimal RFC-4180-ish CSV parser (handles quotes, CRLF, embedded commas). */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;

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
  return rows.filter(r => r.some(v => String(v).trim() !== ''));
}

/** Turns parsed rows into objects keyed by lower-cased header name. */
function toRecords(rows) {
  const header = rows[0].map(h => h.trim());
  const lower = header.map(h => h.toLowerCase());
  return rows.slice(1).map(r => {
    const o = {};
    lower.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
}

const num = v => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const int = v => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};

/** "15%" or "15" -> 0.15 */
const pct = v => {
  const n = num(String(v ?? '').replace('%', ''));
  return n == null ? null : n / 100;
};

function stageNumber(raw) {
  const m = String(raw).match(/(\d+)/);
  return m ? Number(m[1]) : 1;
}

/* ===============================================================
   Species
   =============================================================== */

export class Species {
  constructor(o) { Object.assign(this, o); }

  get imagePath() { return `${IMAGE_DIR}/${encodeURIComponent(this.image)}`; }
  get shinyPath() { return `${SHINY_DIR}/${encodeURIComponent(this.shinyImage || this.image)}`; }
  spritePath(shiny) { return shiny ? this.shinyPath : this.imagePath; }

  get rarityName() { return this.rarity ? RARITY_NAMES[this.rarity] : null; }
  get stageLabel() { return `Stage ${this.stage}`; }

  /** Moves this species knows at `level`, honouring per-creature unlock luck. */
  movesAt(level, unlockOffsets = null) {
    return this.moves.filter(m => moveLevelFor(m, unlockOffsets) <= level);
  }
}

/**
 * The level a move is actually learned at for one creature. `offsets` shifts
 * move slots 3 and 4 earlier (never below the previous move's level or 1).
 */
export function moveLevelFor(move, offsets) {
  if (!offsets) return move.level;
  const shift = offsets[move.slot] || 0;
  return Math.max(1, move.level - shift);
}

export const DB = {
  loaded: false,
  species: [],
  byId: new Map(),
  byName: new Map(),
  stage1: [],
  spawnable: [],
  byRarity: { 1: [], 2: [], 3: [], 4: [], 5: [] },
  familyOf: new Map(),
  familyMembers: new Map(),
  evolvesFrom: new Map(),
  moveIndex: new Map(),   // move name -> definition
  types: [],
  warnings: []
};

export async function loadDatabase(csvUrl = CSV_FILE, statsUrl = STATS_CSV_FILE) {
  DB.warnings = [];

  const [baseText, statsText] = await Promise.all([
    fetchText(csvUrl),
    fetchText(statsUrl)
  ]);

  const baseRows = toRecords(parseCSV(baseText));
  const statRows = toRecords(parseCSV(statsText));

  const statsById = new Map();
  const statsByName = new Map();
  for (const r of statRows) {
    const id = r['id_output'] || r['id'];
    if (id) statsById.set(id, r);
    if (r['name']) statsByName.set(r['name'].toLowerCase(), r);
  }

  DB.species = [];
  DB.byId.clear(); DB.byName.clear();
  DB.evolvesFrom.clear(); DB.familyOf.clear(); DB.familyMembers.clear();
  DB.moveIndex.clear();
  DB.stage1 = []; DB.spawnable = [];
  DB.byRarity = { 1: [], 2: [], 3: [], 4: [], 5: [] };

  baseRows.forEach((r, idx) => {
    const id = r['id_output'] || r['id'];
    if (!id) return;
    const name = r['name'] || '';
    const numMatch = id.match(/(\d+)\s*$/);

    // stats/moves row: prefer the id join, fall back to the name
    const s = statsById.get(id) || statsByName.get(name.toLowerCase()) || null;
    if (!s) DB.warnings.push(`No stats/moves row for ${name} (${id})`);

    const rarityRaw = r['rarity'];
    const candyRaw = r['evolution candy'];

    const sp = new Species({
      id,
      order: numMatch ? Number(numMatch[1]) : idx + 1,
      name,
      stage: stageNumber(r['stage']),
      type: r['type'] || 'Neutral',
      image: r['image'] || `${name}.png`,
      shinyImage: shinyFileFor(name, r['image'] || `${name}.png`),
      rarity: rarityRaw ? Number(rarityRaw) : null,
      evolvesToName: r['evolves to'] || null,
      evolutionCandy: candyRaw ? Number(candyRaw) : null,
      set: SET_NAME,
      baseStats: readStats(s, name),
      moves: readMoves(s, name)
    });

    DB.species.push(sp);
    DB.byId.set(sp.id, sp);
    DB.byName.set(sp.name.toLowerCase(), sp);
  });

  DB.species.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  // evolution links
  for (const sp of DB.species) {
    sp.evolvesToId = null;
    if (sp.evolvesToName) {
      const target = DB.byName.get(sp.evolvesToName.toLowerCase());
      if (target) {
        sp.evolvesToId = target.id;
        DB.evolvesFrom.set(target.id, sp.id);
      } else {
        DB.warnings.push(`"${sp.name}" evolves to unknown creature "${sp.evolvesToName}"`);
      }
    }
  }

  // families
  for (const sp of DB.species) {
    if (DB.evolvesFrom.has(sp.id)) continue;
    const chain = [];
    let cur = sp, guard = 0;
    while (cur && guard++ < 12) {
      chain.push(cur.id);
      DB.familyOf.set(cur.id, sp.id);
      cur = cur.evolvesToId ? DB.byId.get(cur.evolvesToId) : null;
    }
    DB.familyMembers.set(sp.id, chain);
  }
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
  if (DB.warnings.length) console.warn('[data]', DB.warnings);
  return DB;
}

async function fetchText(url) {
  const res = await fetch(encodeURI(url) + '?v=' + Date.now());
  if (!res.ok) throw new Error(`Could not load "${url}" (HTTP ${res.status})`);
  return res.text();
}

/** The shiny folder mirrors the main image filenames exactly. */
function shinyFileFor(name, image) {
  return image;
}

function readStats(row, name) {
  const fallback = { hp: 50, attack: 50, defence: 50, speed: 50 };
  if (!row) return { ...fallback };
  const stats = {
    hp: int(row['hp']),
    attack: int(row['attack']),
    defence: int(row['defence'] ?? row['defense']),
    speed: int(row['speed'])
  };
  for (const k of STAT_KEYS) {
    if (stats[k] == null || stats[k] <= 0) {
      DB.warnings.push(`${name}: missing ${k}, defaulting to ${fallback[k]}`);
      stats[k] = fallback[k];
    }
  }
  return stats;
}

/** Buff percentage used when the CSV leaves it blank on a 0-power move. */
const DEFAULT_BUFF_PCT = 0.10;

function readMoves(row, name) {
  const moves = [];
  if (!row) return moves;

  for (let slot = 1; slot <= 4; slot++) {
    const mName = row[`move${slot} name`];
    const powerRaw = row[`move${slot} power`];
    const levelRaw = row[`move${slot} level`];
    if (!mName && !powerRaw && !levelRaw) continue;

    const power = int(powerRaw) ?? 0;
    const level = int(levelRaw) ?? 1;
    const buffStat = normaliseStat(row[`move${slot} stat buff`]);
    let buffPct = pct(row[`move${slot} stat buff percentage`]);

    const isBuff = power === 0;
    if (isBuff && !buffStat) {
      DB.warnings.push(`${name}: move ${slot} "${mName}" has no power and no buff stat — skipped`);
      continue;
    }
    if (isBuff && buffPct == null) {
      DB.warnings.push(`${name}: move ${slot} "${mName}" has no buff percentage, using ${DEFAULT_BUFF_PCT * 100}%`);
      buffPct = DEFAULT_BUFF_PCT;
    }

    const move = {
      slot,
      name: mName || `Move ${slot}`,
      power: isBuff ? 0 : power,
      level,
      buffStat: isBuff ? buffStat : null,
      buffPct: isBuff ? buffPct : null,
      get isBuff() { return this.power === 0 && !!this.buffStat; }
    };
    moves.push(move);
    if (!DB.moveIndex.has(move.name)) DB.moveIndex.set(move.name, move);
  }

  moves.sort((a, b) => a.level - b.level || a.slot - b.slot);
  return moves;
}

function normaliseStat(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('hp')) return 'hp';
  if (s.startsWith('att')) return 'attack';
  if (s.startsWith('def')) return 'defence';
  if (s.startsWith('spe')) return 'speed';
  return null;
}

/* ===============================================================
   Lookups
   =============================================================== */

export const species = id => DB.byId.get(id) || null;
export const speciesByName = n => DB.byName.get(String(n).toLowerCase()) || null;
export const familyRoot = id => DB.familyOf.get(id) || id;
export const familyRootSpecies = id => species(familyRoot(id));
export const familyName = id => (familyRootSpecies(id)?.name ?? '?');
export const familyRarity = id => familyRootSpecies(id)?.rarity ?? 1;
export const familyChain = id => (DB.familyMembers.get(familyRoot(id)) || []).map(species);

/* ===============================================================
   Random helpers
   =============================================================== */

export function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export const chance = p => Math.random() < p;

/** Pick from [{weight, ...}] entries. */
export function weightedPick(entries) {
  const total = entries.reduce((a, e) => a + e.weight, 0);
  let r = Math.random() * total;
  for (const e of entries) {
    r -= e.weight;
    if (r < 0) return e;
  }
  return entries[entries.length - 1];
}

export function rollRarity() {
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const tier of [1, 2, 3, 4, 5]) {
    r -= RARITY_WEIGHTS[tier];
    if (r < 0) return tier;
  }
  return 1;
}

/** Weighted rarity, then a uniform pick inside that tier. Stage 1 only. */
export function rollSpawnSpecies() {
  for (let attempt = 0; attempt < 6; attempt++) {
    const pool = DB.byRarity[rollRarity()];
    if (pool?.length) return pool[Math.floor(Math.random() * pool.length)];
  }
  return DB.spawnable[Math.floor(Math.random() * DB.spawnable.length)];
}

/** Which map-point kind a POI produces this scan. */
export function rollPOIOutcome() {
  return weightedPick(POI_OUTCOMES).kind;
}

export const rollDiscDrop = () => weightedPick(DISC_DROPS).items;
export const rollItemDrop = () => weightedPick(ITEM_DROPS).items;

/** Rolls the per-creature move unlock luck. */
export function rollMoveUnlock() {
  return { ...weightedPick(MOVE_UNLOCK_ROLL).offsets };
}

/** Rolls the +10% / -10% stat pair. */
export function rollStatModifier() {
  const up = STAT_KEYS[Math.floor(Math.random() * STAT_KEYS.length)];
  let down = up;
  while (down === up) down = STAT_KEYS[Math.floor(Math.random() * STAT_KEYS.length)];
  return { up, down };
}

/* ===============================================================
   Rewards
   =============================================================== */

export const candyForCapture = rarity => randInt(...(CANDY_ON_CAPTURE[rarity] ?? [3, 5]));
export const xpForCapture = rarity => XP_ON_CAPTURE[rarity] ?? 2;

/** Player level adds +1 stardust per level above 1 to every stardust reward. */
export const dustBonusFor = playerLevel =>
  Math.max(0, (playerLevel - 1)) * DUST_BONUS_PER_PLAYER_LEVEL;

export function dustForCapture(rarity, playerLevel = 1) {
  return randInt(...(DUST_ON_CAPTURE[rarity] ?? [10, 15])) + dustBonusFor(playerLevel);
}

export function dustInRange(range, playerLevel = 1) {
  return randInt(range[0], range[1]) + dustBonusFor(playerLevel);
}

/** Cost to go from `level` to `level + 1`, or null when maxed. */
export function levelUpCost(level) {
  const next = level + 1;
  return next <= MAX_CREATURE_LEVEL ? CREATURE_LEVEL_COST[next] : null;
}

export function playerLevelFor(xp) {
  let lvl = 1;
  for (let l = 2; l <= MAX_PLAYER_LEVEL; l++) {
    if (xp >= PLAYER_LEVEL_XP[l]) lvl = l; else break;
  }
  return lvl;
}

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

/* ===============================================================
   Stats maths
   =============================================================== */

/**
 * Effective stats for one stored creature.
 * base -> stat modifier (+/-10%) -> linear 5%-per-level growth.
 */
export function statsFor(sp, level = 1, statMod = null) {
  const out = {};
  const growth = 1 + STAT_GROWTH_PER_LEVEL * (Math.max(1, level) - 1);
  for (const k of STAT_KEYS) {
    let v = sp.baseStats[k];
    if (statMod) {
      if (statMod.up === k) v *= 1.1;
      if (statMod.down === k) v *= 0.9;
    }
    out[k] = Math.max(1, Math.round(v * growth));
  }
  return out;
}

/** Raid boss stats: levelled, then HP tripled and the rest up 10%. */
export function raidBossStats(sp, level) {
  const base = statsFor(sp, level, null);
  const out = {};
  for (const k of STAT_KEYS) {
    out[k] = Math.max(1, Math.round(base[k] * (RAID_BOSS_MODIFIERS[k] ?? 1)));
  }
  return out;
}

/** power x attack / defence, x1.2 when super effective, rounded, min 1. */
export function damageOf(move, attackerType, attackerAttack, defenderType, defenderDefence) {
  if (!move || move.power <= 0) return 0;
  const mult = TYPE_ADVANTAGE[attackerType] === defenderType ? SUPER_EFFECTIVE_MULTIPLIER : 1;
  const raw = (move.power * attackerAttack / Math.max(1, defenderDefence)) * mult;
  return Math.max(1, Math.round(raw));
}

export const isSuperEffective = (attackerType, defenderType) =>
  TYPE_ADVANTAGE[attackerType] === defenderType;

/* ===============================================================
   Shiny
   =============================================================== */

/** Last Saturday of the month = Shiny Bonanza Day. */
export function isBonanzaDay(now = new Date()) {
  if (now.getDay() !== 6) return false;
  const probe = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  return probe.getMonth() !== now.getMonth();
}

/** 17:00–17:59 local = Shiny Bonanza Hour. */
export const isBonanzaHour = (now = new Date()) => now.getHours() === BONANZA_HOUR;

export function bonanzaState(now = new Date()) {
  const day = isBonanzaDay(now);
  const hour = isBonanzaHour(now);
  return { active: day || hour, day, hour };
}

export function shinyOdds(source = 'spawn', now = new Date()) {
  const table = bonanzaState(now).active ? SHINY_ODDS.bonanza : SHINY_ODDS.normal;
  return table[source] ?? table.spawn;
}

export const rollShiny = (source = 'spawn', now = new Date()) => chance(shinyOdds(source, now));

/* ===============================================================
   Raids and grunts
   =============================================================== */

export function rollRaidRarity() {
  const entries = Object.entries(RAID_TIERS).map(([r, t]) => ({ weight: t.weight, rarity: Number(r) }));
  return weightedPick(entries).rarity;
}

/** Builds a raid boss definition: species, level and reward numbers. */
export function rollRaid() {
  const rarity = rollRaidRarity();
  const pool = DB.byRarity[rarity];
  const sp = pool?.length
    ? pool[Math.floor(Math.random() * pool.length)]
    : rollSpawnSpecies();
  const tier = RAID_TIERS[rarity];
  return {
    speciesId: sp.id,
    rarity,
    level: randInt(tier.levels[0], tier.levels[1]),
    xp: tier.xp,
    dustRange: tier.dust
  };
}

export function gruntLevelRange(playerLevel) {
  for (const band of GRUNT_LEVEL_BANDS) {
    if (playerLevel <= band.maxPlayerLevel) return band.levels;
  }
  return GRUNT_LEVEL_BANDS[GRUNT_LEVEL_BANDS.length - 1].levels;
}

/* ===============================================================
   Breeding
   =============================================================== */

export function breedingSlotsFor(playerLevel) {
  let slots = 0;
  for (const [lvl, n] of Object.entries(BREEDING_SLOTS_BY_LEVEL)) {
    if (playerLevel >= Number(lvl)) slots = Math.max(slots, n);
  }
  return slots;
}

export const breedingIntervalMs = rarity =>
  (BREEDING_HOURS[rarity] ?? 12) * 3_600_000;
