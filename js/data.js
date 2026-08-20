/* ============================================================
   data.js — creature data, families, stats, moves and every game table

   Two CSVs are joined on `id_output`:
     • Elemental Awakening Creatures.csv            — species list, images
     • Elemental Awakening Creatures Stats and Moves.csv — stats + learnsets
   ============================================================ */

export const CSV_FILE = 'Elemental Awakening Creatures.csv';
export const STATS_CSV_FILE = 'Elemental Awakening Creatures Stats and Moves.csv';
export const SET_NAME = 'Elemental Awakening';

/**
 * Raid-exclusive creatures. One self-contained file: species info, stats and
 * moves all sit on the same row, unlike the main set which splits them.
 */
export const EXCLUSIVE_CSV_FILE = 'Raid Exclusive - Search and Go.csv';
export const EXCLUSIVE_SET_NAME = 'Exclusive';

/**
 * The second full set. Its creatures are locked behind the Set missions: a
 * rarity only joins the spawn pools once its mission has been claimed.
 */
export const GALACTIC_CSV_FILE = 'Galactic Adventures.csv';
export const GALACTIC_SET_NAME = 'Galactic Adventures';

/** Mythicals: rarity 6, one per egg, never in a spawn pool. */
export const MYTHICAL_CSV_FILE = 'Mythicals.csv';
export const MYTHICAL_SET_NAME = 'Mythical';
export const MYTHICAL_RARITY = 6;
/** The one mythical so far. Pinned so its egg can never hatch anything else. */
export const MYTHICAL_ASTRALYON_ID = 'Mythical_01';

/**
 * Dex numbers per set, spaced so the shared sort keeps each collection
 * together and in the same order as the Collection tabs.
 */
export const GALACTIC_ORDER_BASE = 1000;
export const EXCLUSIVE_ORDER_BASE = 2000;
export const MYTHICAL_ORDER_BASE = 3000;

export const IMAGE_DIR = 'images';
export const SHINY_DIR = 'shiny';
export const ITEM_DIR = 'items';

/* ---------------------------------------------------------------
   Core rules
   --------------------------------------------------------------- */
/** Shared so the grunt spread and the POI search can never drift apart. */
const SCAN_RADIUS_M = 250;

export const RULES = {
  SCAN_RADIUS_M,                // POI search radius around the player
  CAPTURE_RANGE_M: 25,         // must be this close to interact with anything
  RELAX_RANGE_M: 100,          // widened reach during Relax and Good Night
  MIN_SPAWN_SEPARATION_M: 15,   // no two map points within 15 m
  MIN_GRUNT_SEPARATION_M: 20,   // grunts also keep 20 m from each other
  SCAN_INTERVAL_MS: 3 * 60_000, // everything re-rolls every 3 minutes

  CAPTURE_ANIM_MS: 5000,
  EVOLVE_ANIM_MS: 5000,
  EGG_SHAKE_MS: 1600,           // the egg wobbles this long before the reveal

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
  GRUNT_CHANCE: 0.40,
  GARDEN_GRUNT_CHANCE: 0.25,    // leisure=garden is a much quieter spot

  /* Grunt placement.
     A park is a single POI however big it is, so one roll per park would make
     the middle of a huge park as quiet as a pocket garden. Each park instead
     gets GRUNT_ROLLS_PER_PARK independent rolls and keeps that many grunts
     alive, topped up on every scan. They are scattered across the whole scan
     radius, exactly like every other spawn, because a park polygon's centre
     is often nowhere near the player. */
  GRUNT_ROLLS_PER_PARK: 3,
  GRUNT_SPAWN_MIN_M: 15,        // never right on top of you
  GRUNT_SPAWN_MAX_M: SCAN_RADIUS_M,
  GRUNT_PLACEMENT_TRIES: 24,    // random spots tried before a roll gives up
  MAX_ACTIVE_GRUNTS: 6,         // hard ceiling across every park at once

  /* One trainer walks right up to you once per 8-hour window (00–08, 08–16,
     16–24 local), the first time the game is open during it. This one ignores
     GRUNT_SPAWN_MIN_M and does not count against MAX_ACTIVE_GRUNTS. */
  WINDOW_GRUNT_MS: 30 * 60_000,

  // Step counter
  METRES_PER_STEP: 0.75,        // average stride length
  MAX_WALK_JUMP_M: 50,          // bigger single jumps are treated as GPS noise

  // Incense
  INCENSE_DURATION_MS: 20 * 60_000,
  INCENSE_EVERY_MS: 2 * 60_000,

  // Stardust magnet
  MAGNET_DURATION_MS: 15 * 60_000,
  MAGNET_BONUS_MULTIPLIER: 4   // bonus = 4 × playerLevel per capture
};

/**
 * What a shop/amenity POI turns into on each scan. Weights are percentages
 * and must total 100. Weekends run a better Exclusive Raid rate, taken out of
 * the "nothing" slice so every other outcome keeps its weekday odds.
 */
export const POI_OUTCOMES = [
  { kind: 'creature', weight: 22 },
  { kind: 'discs',    weight: 28 },
  { kind: 'items',    weight: 15 },
  { kind: 'raid',     weight: 5 },
  { kind: 'exraid',   weight: 2 },
  { kind: 'nothing',  weight: 28 }
];

export const POI_OUTCOMES_WEEKEND = [
  { kind: 'creature', weight: 22 },
  { kind: 'discs',    weight: 28 },
  { kind: 'items',    weight: 15 },
  { kind: 'raid',     weight: 5 },
  { kind: 'exraid',   weight: 4 },
  { kind: 'nothing',  weight: 26 }
];

/**
 * Raid Invasion odds. There is no "nothing" slice at all, so every POI in
 * range produces something, and raids of both kinds take up 40% of the table.
 */
export const POI_OUTCOMES_RAID_INVASION = [
  { kind: 'creature', weight: 10 },
  { kind: 'discs',    weight: 40 },
  { kind: 'items',    weight: 10 },
  { kind: 'raid',     weight: 30 },
  { kind: 'exraid',   weight: 10 }
];

/**
 * Training Dojo Hour odds. This is the only table where a shop or amenity can
 * turn into a grunt — normally grunts only come out of parks and gardens. Like
 * the invasion table it has no "nothing" slice.
 */
export const POI_OUTCOMES_TRAINING_DOJO = [
  { kind: 'creature', weight: 10 },
  { kind: 'discs',    weight: 15 },
  { kind: 'items',    weight: 35 },
  { kind: 'raid',     weight: 3 },
  { kind: 'exraid',   weight: 2 },
  { kind: 'grunt',    weight: 35 }
];

/** A "discs" point rolls one of these payloads. */
export const DISC_DROPS = [
  { weight: 70, items: { capture_disc: 1 } },
  { weight: 20, items: { capture_disc: 2 } },
  { weight: 10, items: { ultra_disc: 1 } }
];

/** An "items" point rolls one of these payloads. */
export const ITEM_DROPS = [
  { weight: 50, items: { potion: 1 } },
  { weight: 50, items: { revive: 1 } }
];

/** On top of the payload above, an item point can also carry a Full Heal. */
export const ITEM_DROP_FULL_HEAL_CHANCE = 0.10;

/* ---------------------------------------------------------------
   Rarity
   --------------------------------------------------------------- */
export const RARITY_WEIGHTS = { 1: 60, 2: 28, 3: 8, 4: 3, 5: 1 };

/** Rare Incense tilts the same roll heavily towards the rarer tiers. */
export const RARE_INCENSE_WEIGHTS = { 1: 32, 2: 30, 3: 25, 4: 10, 5: 3 };

export const RARITY_NAMES = {
  1: 'Common', 2: 'Uncommon', 3: 'Rare', 4: 'Epic', 5: 'Legendary',
  // Rarity 6 exists but never appears in a weight table, so nothing can roll it.
  6: 'Mythical'
};

export const CANDY_ON_CAPTURE = {
  1: [3, 5], 2: [3, 6], 3: [4, 6], 4: [5, 7], 5: [6, 8],
  // Mythicals arrive with a big bonus candy payout of their own, so the base
  // figure is a flat 5 rather than a range.
  6: [5, 5]
};

export const DUST_ON_CAPTURE = {
  1: [10, 15], 2: [12, 18], 3: [15, 20], 4: [20, 30], 5: [30, 50]
};

export const XP_ON_CAPTURE = { 1: 2, 2: 3, 3: 5, 4: 10, 5: 20, 6: 30 };

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
  3:  { stardust: 500,   candy: 20 },
  4:  { stardust: 750,   candy: 30 },
  5:  { stardust: 1000,  candy: 40 },
  6:  { stardust: 2000,  candy: 60 },
  7:  { stardust: 4000,  candy: 100 },
  8:  { stardust: 10000, candy: 200 },
  9:  { stardust: 25000, candy: 300 },
  10: { stardust: 50000, candy: 500 }
};
export const MAX_CREATURE_LEVEL = 10;

/** Every creature level adds 10% of the base stat (linear, not compounding). */
export const STAT_GROWTH_PER_LEVEL = 0.10;

/* ---------------------------------------------------------------
   Stat Boosters — a flat, permanent +1 to one stat of one creature.

   Deliberately applied *after* the stat modifier and the level growth, so +1
   always shows up as exactly +1 on the number the player is looking at. If it
   were folded into the base it would be multiplied by growth and drift.
   --------------------------------------------------------------- */
export const STAT_BOOSTER_ITEM = 'stat_booster';
/** Total boosts one creature can ever hold, summed across all four stats. */
export const MAX_STAT_BOOSTS = 20;

/**
 * Candy needed for one Stat Booster, by the rarity of the species whose candy
 * you are spending. Commons are plentiful, so they cost far more.
 */
export const STAT_BOOSTER_CANDY_COST = { 1: 50, 2: 30, 3: 15, 4: 10, 5: 10, 6: 10 };

/** Falls back to the rarity 1 price for anything with no rarity of its own. */
export const statBoosterCost = rarity =>
  STAT_BOOSTER_CANDY_COST[rarity] ?? STAT_BOOSTER_CANDY_COST[1];

/** An empty boost record. */
export const emptyBoosts = () => ({ hp: 0, attack: 0, defence: 0, speed: 0 });

/** How many boosts a creature is carrying in total. */
export const totalBoosts = boosts =>
  STAT_KEYS.reduce((sum, k) => sum + (Number(boosts?.[k]) || 0), 0);

export const boostsLeft = boosts => Math.max(0, MAX_STAT_BOOSTS - totalBoosts(boosts));

/** Total XP needed to reach each player level. */
export const PLAYER_LEVEL_XP = {
  1: 0, 2: 25, 3: 100, 4: 250, 5: 1000, 6: 2000, 7: 3500, 8: 6000,
  9: 10000, 10: 15000, 11: 22000, 12: 30000, 13: 42000, 14: 60000, 15: 80000
};
/**
 * Player level-up loot, in three layers:
 *   `every`     — granted on every single level.
 *   `fromLevel` — granted on every level at or past that threshold.
 *   `special`   — granted once, on exactly that level.
 */
export const LEVEL_UP_REWARDS = {
  every: { capture_disc: 5, incense: 1, stardust_magnet: 1 },
  fromLevel: {
    8: { rare_incense: 1 }
  },
  special: {
    3: { breeding_center: 1 },
    5: { incubator: 1 }
  }
};

/**
 * Everything one particular level-up hands over, with the three layers already
 * merged and stacked. Single source of truth so granting and reporting can
 * never drift apart.
 * @returns {Object<string, number>} itemId -> quantity
 */
export function levelUpRewardsFor(level) {
  const out = {};
  const add = table => {
    for (const [id, n] of Object.entries(table || {})) out[id] = (out[id] || 0) + n;
  };

  add(LEVEL_UP_REWARDS.every);
  for (const [from, table] of Object.entries(LEVEL_UP_REWARDS.fromLevel || {})) {
    if (level >= Number(from)) add(table);
  }
  add(LEVEL_UP_REWARDS.special[level]);
  return out;
}

/** The level from which a given item starts arriving every level, or null. */
export const levelUpRewardFromLevel = itemId => {
  const hit = Object.entries(LEVEL_UP_REWARDS.fromLevel || {})
    .find(([, table]) => table[itemId] != null);
  return hit ? Number(hit[0]) : null;
};

export const MAX_PLAYER_LEVEL = 15;

/** Every player level past 1 adds this much to any stardust reward. */
export const DUST_BONUS_PER_PLAYER_LEVEL = 3;

/* ---------------------------------------------------------------
   Stardust Sunday
   Every Sunday all stardust is doubled. The multiplier is applied last, on
   top of the player-level bonus and any Stardust Magnet, so it doubles the
   final figure rather than the base one.
   --------------------------------------------------------------- */
export const STARDUST_SUNDAY_MULTIPLIER = 2;
export const STARDUST_SUNDAY_LABEL = 'Stardust Sunday';

export const isStardustSunday = (now = new Date()) => now.getDay() === 0;

/** What any stardust gain should be multiplied by right now. */
export const stardustMultiplier = (now = new Date()) =>
  isStardustSunday(now) ? STARDUST_SUNDAY_MULTIPLIER : 1;

/* ---------------------------------------------------------------
   Types and battle
   --------------------------------------------------------------- */
export const TYPES = ['Neutral', 'Mystic', 'Wind', 'Celestial', 'Mechanic'];

export const STAT_KEYS = ['hp', 'attack', 'defence', 'speed'];
export const STAT_LABELS = { hp: 'HP', attack: 'Attack', defence: 'Defence', speed: 'Speed' };

/**
 * "Attack" / "Attack and Speed" / "Attack, Defence and Speed" — a buff move's
 * stats in words. Mythicals raise more than one at a time.
 */
export function buffStatsLabel(move) {
  const stats = move?.buffStats?.length ? move.buffStats : [move?.buffStat];
  const names = stats.filter(Boolean).map(s => STAT_LABELS[s] || s);
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "Raises Attack, Defence and Speed by 15%" */
export const buffMoveText = move =>
  `Raises ${buffStatsLabel(move)} by ${Math.round((move?.buffPct || 0) * 100)}%`;

/** attacker type -> the type it hits for extra damage. */
export const TYPE_ADVANTAGE = {
  Mystic: 'Wind',
  Wind: 'Celestial',
  Celestial: 'Mystic',
  Mechanic: 'Neutral',
  Neutral: null
};
export const SUPER_EFFECTIVE_MULTIPLIER = 1.4;

/**
 * attacker type -> the types that shrug its hits off.
 *
 * Deliberately its own table rather than the mirror of TYPE_ADVANTAGE: the two
 * charts are unrelated. Mechanic hits Neutral hard but is resisted by the other
 * three, and Neutral is resisted by nobody despite having no advantage itself.
 */
export const TYPE_RESISTANCE = {
  Mechanic: ['Wind', 'Mystic', 'Celestial'],
  Wind: ['Mechanic'],
  Mystic: ['Neutral'],
  Celestial: ['Neutral'],
  Neutral: []
};
export const NOT_VERY_EFFECTIVE_MULTIPLIER = 0.7;

export const BATTLE_TEAM_SIZE = 3;

/* ---------------------------------------------------------------
   Abilities

   An ability belongs to a species and holds one or more *clauses*. Each clause
   pairs one effect with one trigger, which is why the source file has a row per
   clause rather than a row per ability: a single ability often wants opposite
   effects under opposite conditions ("+50% below 10 degrees, -50% above 20").

   Nothing here reads the clock or the weather on its own. Everything is
   evaluated against a context the battle passes in, so the same ability can be
   previewed on a storage sheet without pretending a battle is happening.
   --------------------------------------------------------------- */

export const ABILITIES_CSV_FILE = 'Abilities Search and Go.csv';

/** The four things an ability can do, and which multiplier each one moves. */
export const ABILITY_EFFECTS = {
  'deal more': { channel: 'deal', direction: 1 },
  'deal less': { channel: 'deal', direction: -1 },
  'take more': { channel: 'take', direction: 1 },
  'take less': { channel: 'take', direction: -1 }
};

/** Triggers that read a list of allowed values out of the `Value` column. */
export const ABILITY_LIST_TRIGGERS = [
  'opposing type', 'opposing stage', 'opposing rarity', 'opposing set', 'day', 'month'
];
/** Triggers that read `Min` / `Max` instead. */
export const ABILITY_RANGE_TRIGGERS = [
  'temperature', 'time', 'cloud cover', 'humidity', 'wind'
];

/**
 * The weather-driven triggers, and the field each one reads. All follow the
 * same rule as temperature: with no reading, the clause never fires.
 */
export const ABILITY_WEATHER_TRIGGERS = {
  'temperature': { field: 'temperature', unit: '°C', label: 'temperature' },
  'cloud cover': { field: 'cloudCover', unit: '%', label: 'cloud cover' },
  'humidity': { field: 'humidity', unit: '%', label: 'humidity' },
  'wind': { field: 'wind', unit: ' km/h', label: 'wind speed' }
};
export const ABILITY_TRIGGERS = [...ABILITY_LIST_TRIGGERS, ...ABILITY_RANGE_TRIGGERS];

/**
 * Clauses are only ever expected to fire one at a time, but if several do their
 * multipliers compound. Clamped so a stack can never trivialise a battle.
 */
export const ABILITY_MULTIPLIER_MIN = 0.25;
export const ABILITY_MULTIPLIER_MAX = 4;

export const DAY_NAMES_LONG =
  ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTH_NAMES_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Normalises the weather half of an ability context. Accepts either a `weather`
 * object or a bare `temperature`, so callers that only care about the
 * temperature — the ability preview on a storage sheet, for instance — do not
 * have to build a whole reading.
 */
export function abilityWeather(ctx = {}) {
  const w = ctx.weather || {};
  const pick = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    temperature: pick(w.temperature ?? ctx.temperature),
    cloudCover: pick(w.cloudCover),
    humidity: pick(w.humidity),
    wind: pick(w.wind)
  };
}

const clampAbilityMultiplier = m =>
  Math.min(ABILITY_MULTIPLIER_MAX, Math.max(ABILITY_MULTIPLIER_MIN, m));

/** A clause's multiplier, e.g. "deal less 50" -> 0.5. */
export function clauseMultiplier(clause) {
  const spec = ABILITY_EFFECTS[clause.effect];
  if (!spec) return 1;
  return 1 + spec.direction * (clause.percent / 100);
}

/** The rarity to judge an opponent by, falling back to its family's. */
const rarityOf = sp => sp?.rarity || familyRarity(sp?.id) || null;

/** Two-digit clock label for the time trigger, e.g. 13.5 -> "13:30". */
const hourLabel = h => {
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return `${String(whole % 24).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

/**
 * Is this clause active right now?
 *
 * @param {object} clause
 * @param {object} ctx
 * @param {object|null} ctx.opponent the species facing this creature
 * @param {Date}        ctx.now
 * @param {object}      ctx.weather  { temperature, cloudCover, humidity, wind },
 *   any of which may be null when that reading is unknown
 * @returns {{active:boolean, reason:string}} `reason` is written for the log,
 *   describing the world as it stands whether or not the clause fired.
 */
export function evaluateClause(clause, ctx = {}) {
  const { opponent = null, now = new Date() } = ctx;
  const weather = abilityWeather(ctx);
  const list = clause.values || [];
  const has = v => list.some(x => String(x).toLowerCase() === String(v).toLowerCase());

  switch (clause.trigger) {
    case 'opposing type': {
      if (!opponent) return { active: false, reason: 'no opponent yet' };
      return { active: has(opponent.type), reason: `opponent is ${opponent.type}` };
    }
    case 'opposing stage': {
      if (!opponent) return { active: false, reason: 'no opponent yet' };
      return { active: has(opponent.stage), reason: `opponent is Stage ${opponent.stage}` };
    }
    case 'opposing rarity': {
      if (!opponent) return { active: false, reason: 'no opponent yet' };
      const r = rarityOf(opponent);
      if (r == null) return { active: false, reason: 'opponent has no rarity' };
      return { active: has(r), reason: `opponent is rarity ${r}` };
    }
    case 'opposing set': {
      if (!opponent) return { active: false, reason: 'no opponent yet' };
      const set = opponent.set || SET_NAME;
      return { active: has(set), reason: `opponent is from ${set}` };
    }
    case 'temperature':
    case 'cloud cover':
    case 'humidity':
    case 'wind': {
      const spec = ABILITY_WEATHER_TRIGGERS[clause.trigger];
      const value = weather?.[spec.field];
      // Decision: never guess. No reading means the clause simply does not fire.
      if (value == null || !Number.isFinite(value)) {
        return { active: false, reason: `${spec.label} unavailable` };
      }
      const okMin = clause.min == null || value >= clause.min;
      const okMax = clause.max == null || value < clause.max;
      const shown = `${Math.round(value)}${spec.unit}`;
      return {
        active: okMin && okMax,
        reason: clause.trigger === 'temperature'
          ? `it is ${shown}`
          : `${spec.label} is ${shown}`
      };
    }
    case 'time': {
      const h = now.getHours() + now.getMinutes() / 60;
      const { min, max } = clause;
      let active;
      if (min == null && max == null) active = false;
      else if (min == null) active = h < max;
      else if (max == null) active = h >= min;
      // min greater than max reads as a window that wraps past midnight.
      else if (min <= max) active = h >= min && h < max;
      else active = h >= min || h < max;
      return { active, reason: `the time is ${hourLabel(h)}` };
    }
    case 'day': {
      const name = DAY_NAMES_LONG[now.getDay()];
      return { active: has(name), reason: `it is ${name}` };
    }
    case 'month': {
      const name = MONTH_NAMES_LONG[now.getMonth()];
      return { active: has(name), reason: `it is ${name}` };
    }
    default:
      return { active: false, reason: 'unknown trigger' };
  }
}

/**
 * Runs every clause of an ability and reduces them to the two multipliers the
 * damage step needs, plus a per-clause breakdown for the battle log.
 */
export function evaluateAbility(ability, ctx = {}) {
  const out = {
    ability,
    clauses: [],
    dealMultiplier: 1,
    takeMultiplier: 1,
    anyActive: false
  };
  if (!ability) return out;

  for (const clause of ability.clauses) {
    const { active, reason } = evaluateClause(clause, ctx);
    out.clauses.push({ clause, active, reason });
    if (!active) continue;
    out.anyActive = true;
    const channel = ABILITY_EFFECTS[clause.effect]?.channel;
    if (channel === 'deal') out.dealMultiplier *= clauseMultiplier(clause);
    if (channel === 'take') out.takeMultiplier *= clauseMultiplier(clause);
  }

  out.dealMultiplier = clampAbilityMultiplier(out.dealMultiplier);
  out.takeMultiplier = clampAbilityMultiplier(out.takeMultiplier);
  return out;
}

/** "deals 50% more damage" — the effect half of a clause, in words. */
export function clauseEffectText(clause) {
  const pct = clause.percent;
  switch (clause.effect) {
    case 'deal more': return `deals ${pct}% more damage`;
    case 'deal less': return `deals ${pct}% less damage`;
    case 'take more': return `takes ${pct}% more damage`;
    case 'take less': return `takes ${pct}% less damage`;
    default: return 'has no effect';
  }
}

/** "the opponent is Mystic" — the condition half of a clause, in words. */
export function clauseConditionText(clause) {
  const list = clause.values || [];
  const join = arr => arr.length <= 1
    ? String(arr[0] ?? '')
    : `${arr.slice(0, -1).join(', ')} or ${arr[arr.length - 1]}`;

  switch (clause.trigger) {
    case 'opposing type': return `the opposing creature is ${join(list)}`;
    case 'opposing stage': return `the opposing creature is Stage ${join(list)}`;
    case 'opposing rarity': return `the opposing creature is rarity ${join(list)}`;
    case 'opposing set': return `the opposing creature is from ${join(list)}`;
    case 'temperature':
    case 'cloud cover':
    case 'humidity':
    case 'wind': {
      const { unit, label } = ABILITY_WEATHER_TRIGGERS[clause.trigger];
      const n = v => `${v}${unit}`;
      if (clause.min != null && clause.max != null) {
        return `the ${label} is between ${n(clause.min)} and ${n(clause.max)}`;
      }
      if (clause.max != null) return `the ${label} is below ${n(clause.max)}`;
      if (clause.min != null) return `the ${label} is ${n(clause.min)} or above`;
      return `the ${label} is known`;
    }
    case 'time': {
      if (clause.min != null && clause.max != null) {
        return `the time is between ${hourLabel(clause.min)} and ${hourLabel(clause.max)}`;
      }
      if (clause.max != null) return `the time is before ${hourLabel(clause.max)}`;
      if (clause.min != null) return `the time is after ${hourLabel(clause.min)}`;
      return 'any time';
    }
    case 'day': return `it is ${join(list)}`;
    case 'month': return `it is ${join(list)}`;
    default: return 'an unknown condition';
  }
}

/** One clause as a sentence: "Deals 50% more damage if …". */
export const clauseText = clause =>
  `${clauseEffectText(clause).replace(/^./, ch => ch.toUpperCase())} if ${clauseConditionText(clause)}.`;

/** The whole ability in words, using the authored text when there is one. */
export function abilityText(ability) {
  if (!ability) return '';
  if (ability.description) return ability.description;
  return ability.clauses.map(clauseText).join(' ');
}

/* Raid bosses are beefed up versions of a normal creature. */
export const RAID_BOSS_MODIFIERS = { hp: 3, attack: 1.25, defence: 1.25, speed: 1.25 };

/** Exclusive raid bosses are tougher again: more HP and a bigger stat buff. */
export const EXCLUSIVE_RAID_BOSS_MODIFIERS = { hp: 4, attack: 1.30, defence: 1.30, speed: 1.30 };

/** The right modifier table for a raid. */
export const raidModifiers = (exclusive = false) =>
  exclusive ? EXCLUSIVE_RAID_BOSS_MODIFIERS : RAID_BOSS_MODIFIERS;

/** Which rarity a raid is, what level the boss is, and what beating it pays. */
export const RAID_TIERS = {
  1: { weight: 30, levels: [3, 4], xp: 10, dust: [40, 60] },
  2: { weight: 25, levels: [4, 5], xp: 15, dust: [60, 100] },
  3: { weight: 20, levels: [5, 6], xp: 25, dust: [120, 200] },
  4: { weight: 15, levels: [6, 7], xp: 50, dust: [300, 450] },
  5: { weight: 10, levels: [7, 8], xp: 80, dust: [500, 750] }
};

/**
 * Exclusive raids only ever hold rarity 3, 4 or 5 bosses. Levels and payouts
 * are the same as the equivalent normal raid tier — only the odds differ.
 */
export const EXCLUSIVE_RAID_WEIGHTS = { 3: 50, 4: 35, 5: 15 };

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
  { maxPlayerLevel: 6,        levels: [2, 5] },
  { maxPlayerLevel: 9,        levels: [3, 7] },
  { maxPlayerLevel: Infinity, levels: [6, 9] }
];

/**
 * Extra loot for beating a raid boss, on top of the XP and stardust.
 *
 * Rarity 4 and 5 bosses are the hard ones, so they pay better: the Single Use
 * Incubator is guaranteed rather than a coin flip, and they can also drop a
 * Rare Incense. Anything else falls back to `incubatorChance` and no incense.
 */
export const RAID_REWARD = {
  incubatorChance: 0.2,
  incubatorItem: 'single_use_incubator',
  incubatorChanceByRarity: { 4: 1, 5: 1 },
  rareIncenseItem: 'rare_incense',
  rareIncenseChanceByRarity: { 4: 0.25, 5: 0.25 },
  always: { revive: 2, full_heal: 1 }   // every raid win, win or catch
};

/** Odds of a Single Use Incubator dropping from a boss of this rarity. */
export const raidIncubatorChance = rarity =>
  RAID_REWARD.incubatorChanceByRarity[rarity] ?? RAID_REWARD.incubatorChance;

/** Odds of a Rare Incense dropping from a boss of this rarity. 0 for most. */
export const raidRareIncenseChance = rarity =>
  RAID_REWARD.rareIncenseChanceByRarity[rarity] ?? 0;

/** The rarities that get the better drop table, for the how-to-play copy. */
export const RAID_BONUS_RARITIES =
  Object.keys(RAID_REWARD.incubatorChanceByRarity).map(Number).sort((a, b) => a - b);

/**
 * Extra drops on top of the normal raid table, only from Exclusive Raids. The
 * two rolls are independent, so one win can pay both, either or neither.
 */
export const EXCLUSIVE_RAID_REWARD = {
  shinyIncenseChance: 0.25,
  shinyIncenseItem: 'shiny_incense',
  eggChance: 0.25,
  eggType: '15km'
};

export const GRUNT_REWARD = {
  dust: [70, 95],
  /** Handed over on every win, on top of the healing supplies below. */
  always: { full_heal: 1 },
  bonus: [
    { weight: 5,  item: 'incense' },
    { weight: 5,  item: 'stardust_magnet' },
    { weight: 90, item: null }
  ],
  /**
   * Independent rolls, unlike `bonus` which picks at most one thing. Each is
   * checked separately, so a single win can pay both, either or neither.
   */
  extras: [
    { item: 'super_incubator', chance: 0.30 },
    { item: 'stat_booster',    chance: 0.10 }
  ]
};

/** Grunts always hand over healing supplies. Weights are percentages. */
export const GRUNT_ITEM_DROPS = [
  { weight: 40, items: { revive: 1 } },
  { weight: 30, items: { potion: 1 } },
  { weight: 30, items: { potion: 1, revive: 1 } }
];

export const rollGruntItems = () => ({ ...weightedPick(GRUNT_ITEM_DROPS).items });

/* ---------------------------------------------------------------
   Shiny
   --------------------------------------------------------------- */
export const SHINY_ODDS = {
  normal: { spawn: 0.01, raid: 0.02 },
  bonanza: { spawn: 0.02, raid: 0.04 }
};

/**
 * Shiny Incense pins the shiny rate to a flat 3% for everything caught while
 * it burns. It replaces the usual odds rather than multiplying them, so it
 * never stacks with a Shiny Bonanza.
 */
export const SHINY_INCENSE_ODDS = 0.03;

/** Shiny Bonanza Hour: local 17:30–18:30. */
export const BONANZA_HOUR_START = 17.5;  // 17:30
export const BONANZA_HOUR_END = 18.5;    // 18:30

/* ---------------------------------------------------------------
   Relax and Good Night: local 22:30–22:45, the interaction range widens
   from CAPTURE_RANGE_M to RELAX_RANGE_M so you can reach most of what is
   on screen without walking to it.
   --------------------------------------------------------------- */
export const RELAX_HOUR_START = 22.5;    // 22:30
export const RELAX_HOUR_END = 22.75;     // 22:45
export const RELAX_HOUR_LABEL = 'Relax and Good Night';

/* ---------------------------------------------------------------
   Weekly events that rewrite the POI odds for their window.

   Both replace the ordinary weekday/weekend table outright rather than
   nudging it, which is why each of their tables has to total 100 on its own.
   They cannot overlap: one is a Wednesday, the other a Saturday.
   --------------------------------------------------------------- */

/** Raid Invasion: Wednesdays 19:00–20:00. */
export const RAID_INVASION_LABEL = 'Raid Invasion';
export const RAID_INVASION_DAY = 3;        // 0 = Sunday, so 3 = Wednesday
export const RAID_INVASION_START = 19;     // 19:00
export const RAID_INVASION_END = 20;       // 20:00
/**
 * Handed over by every disc point during the invasion, on top of its drop.
 * Always at least one Ultra Capture Disc, and a quarter of the time a second.
 */
export const RAID_INVASION_DISC_BONUS = { ultra_disc: 1 };
export const RAID_INVASION_DOUBLE_CHANCE = 0.25;

/** Training Dojo Hour: Saturdays 13:30–14:00. */
export const TRAINING_DOJO_LABEL = 'Training Dojo Hour';
export const TRAINING_DOJO_DAY = 6;        // Saturday
export const TRAINING_DOJO_START = 13.5;   // 13:30
export const TRAINING_DOJO_END = 14;       // 14:00

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
   Eggs
   Dropped by disc and item points, incubated, then hatched by walking.
   Rarity odds are per egg type, and shinies use the raid rate.
   --------------------------------------------------------------- */
export const EGG_DIR = 'eggs';
export const MAX_EGGS = 6;
/** Exclusive 15 km eggs sit in their own three slots, not the six above. */
export const MAX_EXCLUSIVE_EGGS = 3;
export const EGG_DROP_CHANCE = 0.10;
/** Hatchlings arrive part-grown rather than at level 1. */
export const EGG_HATCH_LEVEL = 3;

export const EGG_TYPES = {
  '5km': {
    id: '5km', km: 5, dust: 70, xp: 20, image: '5km_egg.png', bonusCandy: 2,
    weights: { 1: 45, 2: 30, 3: 17, 4: 6, 5: 2 }
  },
  '10km': {
    id: '10km', km: 10, dust: 150, xp: 50, image: '10km_egg.png', bonusCandy: 5,
    weights: { 1: 32, 2: 30, 3: 25, 4: 10, 5: 3 }
  },
  /**
   * Only ever dropped by an Exclusive Raid. Hatches from the exclusive pool,
   * and pays a 10 km egg's rewards plus 50 stardust and 2 candies.
   */
  '15km': {
    id: '15km', km: 15, dust: 200, xp: 50, image: '15km_egg.png', bonusCandy: 7,
    exclusive: true,
    weights: { 3: 50, 4: 35, 5: 15 }
  },
  /**
   * The mythical egg. `speciesId` pins what comes out, so adding more mythicals
   * to the CSV later cannot dilute this one — a future mythical needs its own
   * egg entry. It also never rolls a shiny, and ignores the storage caps.
   */
  '50km': {
    id: '50km', km: 50, dust: 500, xp: 100, image: '50km_egg.png', bonusCandy: 25,
    mythical: true,
    speciesId: MYTHICAL_ASTRALYON_ID,
    noShiny: true,
    ignoresStorageLimit: true
  }
};

/** The egg type Exclusive Raids drop. */
export const EXCLUSIVE_EGG_TYPE = '15km';
/** The egg the final Set mission hands over. */
export const MYTHICAL_EGG_TYPE = '50km';

/** Which egg you get when one drops. */
export const EGG_TYPE_ROLL = [
  { weight: 80, type: '5km' },
  { weight: 20, type: '10km' }
];

/** Items that can hold an egg. The reusable one is freed when the egg hatches. */
export const INCUBATOR_ITEMS = ['incubator', 'single_use_incubator', 'super_incubator'];
export const REUSABLE_INCUBATOR = 'incubator';
export const SUPER_INCUBATOR = 'super_incubator';

/**
 * How much an incubator cuts off the distance an egg needs. Only the Super
 * Incubator does anything; everything else walks the full length.
 */
export const INCUBATOR_DISCOUNT = { [SUPER_INCUBATOR]: 0.25 };
export const incubatorDiscount = itemId => INCUBATOR_DISCOUNT[itemId] || 0;

export const eggDef = type => EGG_TYPES[type] || EGG_TYPES['5km'];
export const eggImage = type => `${EGG_DIR}/${encodeURIComponent(eggDef(type).image)}`;
export const eggLabel = type => `${eggDef(type).km} km egg`;
export const eggMetres = type => eggDef(type).km * 1000;

/**
 * The distance this egg actually needs, given the incubator it is sitting in.
 * A Super Incubator takes 25% off, so a 10 km egg hatches after 7.5 km.
 */
export const eggMetresFor = (type, incubatorId = null) =>
  Math.round(eggMetres(type) * (1 - incubatorDiscount(incubatorId)));
export const rollEggType = () => weightedPick(EGG_TYPE_ROLL).type;
/** True for the 15 km egg, which uses the separate exclusive slots. */
export const isExclusiveEgg = type => !!eggDef(type).exclusive;
/** True for the 50 km egg, which has no slot limit at all. */
export const isMythicalEgg = type => !!eggDef(type).mythical;
/** Some eggs can never produce a shiny. */
export const eggCanBeShiny = type => !eggDef(type).noShiny;

/**
 * What an egg hatches. Most roll their own rarity table rather than the wild
 * spawn weights; an egg with a pinned `speciesId` always gives that creature.
 */
export const rollEggSpecies = type => {
  const def = eggDef(type);
  if (def.speciesId) {
    const fixed = species(def.speciesId);
    if (fixed) return fixed;
    // Nothing sensible to fall back to, so say so loudly rather than silently
    // handing over a random creature from a mythical egg.
    console.warn(`[data] egg "${type}" wants missing species "${def.speciesId}"`);
  }
  return def.exclusive
    ? rollExclusiveSpecies(def.weights)
    : rollSpawnSpecies(def.weights);
};

/* ---------------------------------------------------------------
   Shop

   Coins come from watching rewarded video, one coin per video, and buy the
   consumables below. Every row carries its own daily cap so no amount of
   watching can flood a save with Ultra Discs.

   `limit` is per local day and resets at midnight with the daily missions.
   Coins themselves do *not* reset — an unspent coin would be a nasty thing to
   take away from someone who watched an ad for it.
   --------------------------------------------------------------- */

/** Coins earned per completed rewarded video. */
export const COINS_PER_AD = 1;

/** Shown next to a coin count. */
export const COIN_ICON = '🪙';

export const SHOP_ITEMS = [
  { id: 'shop_discs',      item: 'capture_disc',         qty: 2, coins: 1, limit: 3 },
  { id: 'shop_potions',    item: 'potion',               qty: 2, coins: 1, limit: 5 },
  { id: 'shop_revives',    item: 'revive',               qty: 2, coins: 1, limit: 5 },
  { id: 'shop_ultra',      item: 'ultra_disc',           qty: 1, coins: 1, limit: 2 },
  { id: 'shop_incubator',  item: 'single_use_incubator', qty: 1, coins: 2, limit: 1 },
  { id: 'shop_incense',    item: 'incense',              qty: 1, coins: 3, limit: 1 },
  { id: 'shop_magnet',     item: 'stardust_magnet',      qty: 1, coins: 3, limit: 1 }
];

export const shopItem = id => SHOP_ITEMS.find(s => s.id === id) || null;

/** Coins needed to buy one of everything, once each — for the info menu. */
export const shopFullSweepCoins = () =>
  SHOP_ITEMS.reduce((a, s) => a + s.coins * s.limit, 0);

/* ---------------------------------------------------------------
   Buddy
   A creature picked in your Profile walks with you and earns candy for its
   own family. Rarer families need a longer walk per candy.
   --------------------------------------------------------------- */
export const BUDDY_KM_PER_CANDY = { 1: 2, 2: 4, 3: 8, 4: 12, 5: 16, 6: 20 };

/** Metres of walking one candy costs for a buddy of this family rarity. */
export function buddyMetresPerCandy(rarity) {
  const km = BUDDY_KM_PER_CANDY[rarity] ?? BUDDY_KM_PER_CANDY[1];
  return km * 1000;
}

/* ---------------------------------------------------------------
   Breeding centre
   --------------------------------------------------------------- */
export const BREEDING_UNLOCK_LEVEL = 3;

/** Player level -> total slots available. */
export const BREEDING_SLOTS_BY_LEVEL = { 3: 1, 5: 2, 7: 3, 8: 4, 9: 5 };

/** Hours to generate one candy, by the pair's Stage 1 rarity. */
export const BREEDING_HOURS = { 1: 12, 2: 12, 3: 18, 4: 24, 5: 36, 6: 48 };

export const BREEDING_CANDY_CAP = 5;

/* ---------------------------------------------------------------
   Missions
   --------------------------------------------------------------- */
export const MISSIONS = [
  { id: 'reg5',    kind: 'registered', target: 5,    xp: 10,  dust: 50,  label: 'Register 5 unique creatures' },
  { id: 'reg10',   kind: 'registered', target: 10,   xp: 20,  dust: 100, label: 'Register 10 unique creatures' },
  { id: 'reg20',   kind: 'registered', target: 20,   xp: 40,  dust: 150, label: 'Register 20 unique creatures' },
  { id: 'reg50',   kind: 'registered', target: 50,   xp: 50,  dust: 200, label: 'Register 50 unique creatures' },

  /**
   * The only mission with two conditions. `progress` counts registrations and
   * `requireLevel` gates the claim, so the bar shows the part you are actually
   * working on rather than sitting at 0 until you level up.
   */
  {
    id: 'lab', kind: 'registered', target: 70, requireLevel: 7,
    xp: 50, dust: 200, items: { incense: 1, research_lab: 1 },
    label: 'Reach level 7 and register 70 creatures'
  },
  { id: 'cat50',   kind: 'captures',   target: 50,   xp: 5,   dust: 20,  label: 'Catch 50 creatures' },
  { id: 'cat100',  kind: 'captures',   target: 100,  xp: 10,  dust: 50,  label: 'Catch 100 creatures' },
  { id: 'cat200',  kind: 'captures',   target: 200,  xp: 20,  dust: 100, label: 'Catch 200 creatures' },
  { id: 'cat500',  kind: 'captures',   target: 500,  xp: 50,  dust: 200, label: 'Catch 500 creatures' },
  { id: 'cat1000', kind: 'captures',   target: 1000, xp: 100, dust: 300, label: 'Catch 1000 creatures' },
  {
    id: 'cat2000', kind: 'captures', target: 2000, xp: 150, dust: 500,
    items: { ultra_disc: 1, incense: 1, stardust_magnet: 1 },
    label: 'Catch 2000 creatures'
  },
  {
    id: 'cat3000', kind: 'captures', target: 3000, xp: 200, dust: 1000,
    items: { ultra_disc: 1, incense: 1, stardust_magnet: 1 },
    label: 'Catch 3000 creatures'
  },
  {
    id: 'cat5000', kind: 'captures', target: 5000, xp: 300, dust: 2000,
    items: { ultra_disc: 2, incense: 2, stardust_magnet: 2 },
    label: 'Catch 5000 creatures'
  },
  {
    id: 'cat7500', kind: 'captures', target: 7500, xp: 400, dust: 3500,
    items: { shiny_incense: 1, rare_incense: 1, incense: 1 },
    label: 'Catch 7500 creatures'
  },
  {
    id: 'cat10000', kind: 'captures', target: 10000, xp: 500, dust: 5000,
    items: { breeding_center: 1, incense: 2, stardust_magnet: 2 },
    label: 'Catch 10000 creatures'
  },

  // ---- raids won ----
  { id: 'raid5',   kind: 'raidsWon', target: 5,   xp: 5,   dust: 20,  items: { single_use_incubator: 1 }, label: 'Successfully defeat 5 raids' },
  { id: 'raid10',  kind: 'raidsWon', target: 10,  xp: 10,  dust: 50,  items: { single_use_incubator: 1 }, label: 'Successfully defeat 10 raids' },
  { id: 'raid20',  kind: 'raidsWon', target: 20,  xp: 20,  dust: 100, items: { single_use_incubator: 1 }, label: 'Successfully defeat 20 raids' },
  { id: 'raid50',  kind: 'raidsWon', target: 50,  xp: 50,  dust: 250, items: { single_use_incubator: 1 }, label: 'Successfully defeat 50 raids' },
  { id: 'raid100', kind: 'raidsWon', target: 100, xp: 100, dust: 500, items: { single_use_incubator: 2 }, label: 'Successfully defeat 100 raids' },

  // ---- one raid of each rarity ----
  { id: 'raidR1', kind: 'raidRarity', rarity: 1, target: 1, xp: 5,   dust: 20,  items: { single_use_incubator: 1 }, label: 'Successfully defeat a Rarity 1 raid' },
  { id: 'raidR2', kind: 'raidRarity', rarity: 2, target: 1, xp: 10,  dust: 50,  items: { single_use_incubator: 1 }, label: 'Successfully defeat a Rarity 2 raid' },
  { id: 'raidR3', kind: 'raidRarity', rarity: 3, target: 1, xp: 20,  dust: 100, items: { single_use_incubator: 1 }, label: 'Successfully defeat a Rarity 3 raid' },
  { id: 'raidR4', kind: 'raidRarity', rarity: 4, target: 1, xp: 50,  dust: 250, items: { single_use_incubator: 2 }, label: 'Successfully defeat a Rarity 4 raid' },
  { id: 'raidR5', kind: 'raidRarity', rarity: 5, target: 1, xp: 100, dust: 500, items: { single_use_incubator: 2 }, label: 'Successfully defeat a Rarity 5 raid' },

  // ---- exclusive raids ----
  // Exclusive wins also feed the plain raid missions above, so these stack.
  { id: 'exRaidR3', kind: 'exclusiveRaidRarity', rarity: 3, target: 1, xp: 20,  dust: 200,  items: { ultra_disc: 2 }, label: 'Defeat a Rarity 3 Exclusive Raid' },
  { id: 'exRaidR4', kind: 'exclusiveRaidRarity', rarity: 4, target: 1, xp: 50,  dust: 500,  items: { ultra_disc: 2 }, label: 'Defeat a Rarity 4 Exclusive Raid' },
  { id: 'exRaidR5', kind: 'exclusiveRaidRarity', rarity: 5, target: 1, xp: 100, dust: 1000, items: { ultra_disc: 3, incense: 1, stardust_magnet: 1 }, label: 'Defeat a Rarity 5 Exclusive Raid' },

  { id: 'exRaid5',  kind: 'exclusiveRaidsWon', target: 5,  xp: 25,  dust: 250,  items: { ultra_disc: 2 }, label: 'Defeat 5 Exclusive Raids' },
  { id: 'exRaid10', kind: 'exclusiveRaidsWon', target: 10, xp: 50,  dust: 500,  items: { ultra_disc: 2, incense: 1 }, label: 'Defeat 10 Exclusive Raids' },
  { id: 'exRaid20', kind: 'exclusiveRaidsWon', target: 20, xp: 100, dust: 1000, items: { ultra_disc: 3, rare_incense: 1, shiny_incense: 1 }, label: 'Defeat 20 Exclusive Raids' },
  { id: 'exRaid50', kind: 'exclusiveRaidsWon', target: 50, xp: 150, dust: 1500, items: { ultra_disc: 3, shiny_incense: 1 }, label: 'Defeat 50 Exclusive Raids' },

  // ---- grunts beaten ----
  { id: 'grunt5',   kind: 'gruntsBeaten', target: 5,   xp: 5,   dust: 20,   items: { stardust_magnet: 1 }, label: 'Successfully defeat 5 grunts' },
  { id: 'grunt10',  kind: 'gruntsBeaten', target: 10,  xp: 10,  dust: 50,   items: { incense: 1 }, label: 'Successfully defeat 10 grunts' },
  { id: 'grunt20',  kind: 'gruntsBeaten', target: 20,  xp: 20,  dust: 100,  items: { stardust_magnet: 2 }, label: 'Successfully defeat 20 grunts' },
  { id: 'grunt50',  kind: 'gruntsBeaten', target: 50,  xp: 50,  dust: 250,  items: { incense: 2 }, label: 'Successfully defeat 50 grunts' },
  { id: 'grunt100', kind: 'gruntsBeaten', target: 100, xp: 100, dust: 500,  items: { incense: 2, stardust_magnet: 2 }, label: 'Successfully defeat 100 grunts' },
  { id: 'grunt200', kind: 'gruntsBeaten', target: 200, xp: 150, dust: 1000, items: { incense: 2, stardust_magnet: 2 }, label: 'Successfully defeat 200 grunts' },
  { id: 'grunt500', kind: 'gruntsBeaten', target: 500, xp: 200, dust: 2000, items: { incense: 3, stardust_magnet: 3 }, label: 'Successfully defeat 500 grunts' },

  // ---- eggs hatched ----
  { id: 'egg5',   kind: 'eggsHatched', target: 5,   xp: 5,   dust: 20,   items: { single_use_incubator: 1 }, label: 'Hatch 5 eggs' },
  { id: 'egg20',  kind: 'eggsHatched', target: 20,  xp: 10,  dust: 50,   items: { single_use_incubator: 1 }, label: 'Hatch 20 eggs' },
  { id: 'egg50',  kind: 'eggsHatched', target: 50,  xp: 20,  dust: 100,  items: { single_use_incubator: 1 }, label: 'Hatch 50 eggs' },
  { id: 'egg100', kind: 'eggsHatched', target: 100, xp: 50,  dust: 250,  items: { single_use_incubator: 1 }, label: 'Hatch 100 eggs' },
  { id: 'egg200', kind: 'eggsHatched', target: 200, xp: 100, dust: 500,  items: { single_use_incubator: 2 }, label: 'Hatch 200 eggs' },
  { id: 'egg300', kind: 'eggsHatched', target: 300, xp: 200, dust: 1000, items: { single_use_incubator: 2 }, label: 'Hatch 300 eggs' },
  { id: 'egg500', kind: 'eggsHatched', target: 500, xp: 250, dust: 1500, items: { single_use_incubator: 3 }, label: 'Hatch 500 eggs' },

  /* ---- creatures raised to a level ----
     `kind: 'creaturesAtLevel'` counts creatures in storage sitting at or above
     `level`, so these tick up and down with the collection rather than reading
     a stored counter. Levelling one creature to 10 therefore also credits the
     level 5 and level 7 missions. */
  { id: 'lv5x5',    kind: 'creaturesAtLevel', level: 5,  target: 5,   xp: 10,  dust: 100,  discs: 5, items: { revive: 2 },        label: 'Level up 5 creatures to level 5' },
  { id: 'lv5x10',   kind: 'creaturesAtLevel', level: 5,  target: 10,  xp: 25,  dust: 250,  discs: 5, items: { potion: 2 },        label: 'Level up 10 creatures to level 5' },
  { id: 'lv5x20',   kind: 'creaturesAtLevel', level: 5,  target: 20,  xp: 50,  dust: 500,  discs: 5, items: { ultra_disc: 1 },    label: 'Level up 20 creatures to level 5' },
  { id: 'lv5x30',   kind: 'creaturesAtLevel', level: 5,  target: 30,  xp: 75,  dust: 1000, discs: 5, items: { ultra_disc: 2 },    label: 'Level up 30 creatures to level 5' },
  { id: 'lv5x50',   kind: 'creaturesAtLevel', level: 5,  target: 50,  xp: 100, dust: 1500, discs: 5, items: { incense: 1 },       label: 'Level up 50 creatures to level 5' },
  { id: 'lv5x100',  kind: 'creaturesAtLevel', level: 5,  target: 100, xp: 150, dust: 2500, discs: 5, items: { rare_incense: 1 },  label: 'Level up 100 creatures to level 5' },

  { id: 'lv7x2',    kind: 'creaturesAtLevel', level: 7,  target: 2,   xp: 10,  dust: 100,  discs: 5, items: { revive: 2 },        label: 'Level up 2 creatures to level 7' },
  { id: 'lv7x5',    kind: 'creaturesAtLevel', level: 7,  target: 5,   xp: 25,  dust: 250,  discs: 5, items: { potion: 2 },        label: 'Level up 5 creatures to level 7' },
  { id: 'lv7x10',   kind: 'creaturesAtLevel', level: 7,  target: 10,  xp: 50,  dust: 500,  discs: 5, items: { ultra_disc: 1 },    label: 'Level up 10 creatures to level 7' },
  { id: 'lv7x15',   kind: 'creaturesAtLevel', level: 7,  target: 15,  xp: 75,  dust: 1000, discs: 5, items: { ultra_disc: 2 },    label: 'Level up 15 creatures to level 7' },
  { id: 'lv7x25',   kind: 'creaturesAtLevel', level: 7,  target: 25,  xp: 100, dust: 1500, discs: 5, items: { incense: 1 },       label: 'Level up 25 creatures to level 7' },
  { id: 'lv7x50',   kind: 'creaturesAtLevel', level: 7,  target: 50,  xp: 150, dust: 2500, discs: 5, items: { rare_incense: 1 },  label: 'Level up 50 creatures to level 7' },

  { id: 'lv10x1',   kind: 'creaturesAtLevel', level: 10, target: 1,   xp: 75,  dust: 2000, discs: 5, items: { ultra_disc: 2 },    label: 'Level up 1 creature to level 10' },
  { id: 'lv10x5',   kind: 'creaturesAtLevel', level: 10, target: 5,   xp: 100, dust: 2500, discs: 5, items: { incense: 1 },       label: 'Level up 5 creatures to level 10' },
  { id: 'lv10x10',  kind: 'creaturesAtLevel', level: 10, target: 10,  xp: 150, dust: 5000, discs: 5, items: { rare_incense: 1 },  label: 'Level up 10 creatures to level 10' }
];

/* Weekly missions reset every Monday, local time. */
export const WEEKLY_MISSIONS = [
  {
    id: 'week150', kind: 'capturesWeek', target: 150, xp: 40, dust: 200, discs: 3,
    items: { ultra_disc: 1 },
    label: 'Catch 150 creatures this week'
  },
  {
    id: 'week300', kind: 'capturesWeek', target: 300, xp: 80, dust: 500, discs: 5,
    items: { ultra_disc: 1, single_use_incubator: 1 },
    label: 'Catch 300 creatures this week'
  },
  {
    id: 'weekDaily', kind: 'daysCaughtThisWeek', target: 7, xp: 50, dust: 300, discs: 2,
    items: { rare_incense: 1 },
    label: 'Catch a creature every day this week'
  },

  // ---- walking ----
  // Targets are in metres because that is what the step counter measures;
  // `unit: 'km'` tells the mission row to show kilometres.
  {
    id: 'weekWalk25', kind: 'metresWeek', target: 25_000, unit: 'km', xp: 20, dust: 250,
    items: { incense: 2 },
    label: 'Walk 25 km this week'
  },
  {
    id: 'weekWalk50', kind: 'metresWeek', target: 50_000, unit: 'km', xp: 50, dust: 500,
    items: { rare_incense: 1 },
    label: 'Walk 50 km this week'
  },
  {
    id: 'weekWalk75', kind: 'metresWeek', target: 75_000, unit: 'km', xp: 75, dust: 700,
    items: { shiny_incense: 1 },
    label: 'Walk 75 km this week'
  }
];

/* ---------------------------------------------------------------
   Set missions

   A ladder that opens Galactic Adventures one rarity at a time. Each rung wants
   a number of Elemental Awakening creatures registered *and* a player level, so
   the set cannot be rushed by a single very active week.

   `unlockGalacticRarity` is applied on claim, which is what puts those creatures
   into the spawn pools. They never reset.
   --------------------------------------------------------------- */
export const SET_MISSIONS = [
  {
    id: 'ga1', kind: 'registeredInSet', set: SET_NAME, target: 65, requireLevel: 7,
    xp: 25, dust: 250, unlockGalacticRarity: 1,
    label: `Register 65 creatures from ${SET_NAME}`
  },
  {
    id: 'ga2', kind: 'registeredInSet', set: SET_NAME, target: 70, requireLevel: 9,
    xp: 40, dust: 400, unlockGalacticRarity: 2,
    label: `Register 70 creatures from ${SET_NAME}`
  },
  {
    id: 'ga3', kind: 'registeredInSet', set: SET_NAME, target: 75, requireLevel: 11,
    xp: 60, dust: 600, unlockGalacticRarity: 3,
    label: `Register 75 creatures from ${SET_NAME}`
  },
  {
    id: 'ga4', kind: 'registeredInSet', set: SET_NAME, target: 77, requireLevel: 12,
    xp: 80, dust: 800, unlockGalacticRarity: 4,
    label: `Register 77 creatures from ${SET_NAME}`
  },
  {
    id: 'ga5', kind: 'registeredInSet', set: SET_NAME, target: 79, requireLevel: 13,
    xp: 150, dust: 1500, unlockGalacticRarity: 5,
    items: { breeding_center: 1 },
    grantEgg: MYTHICAL_EGG_TYPE,
    label: `Register all 79 creatures in ${SET_NAME}`
  }
];

export const DAILY_MISSIONS = [
  { id: 'daily5',  kind: 'capturesToday', target: 5,  xp: 5,  dust: 20, discs: 2, label: 'Catch 5 creatures today' },
  { id: 'daily20', kind: 'capturesToday', target: 20, xp: 10, dust: 30, discs: 2, label: 'Catch 20 creatures today' },
  {
    id: 'daily50', kind: 'capturesToday', target: 50, xp: 20, dust: 50, discs: 2,
    items: { incense: 1, stardust_magnet: 1, super_incubator: 1 },
    label: 'Catch 50 creatures today'
  },

  // ---- walking ----
  { id: 'dailyWalk1', kind: 'metresToday', target: 1_000, unit: 'km', xp: 5, dust: 50, label: 'Walk 1 km' },
  {
    id: 'dailyWalk5', kind: 'metresToday', target: 5_000, unit: 'km', xp: 10, dust: 75,
    items: { ultra_disc: 1, stardust_magnet: 1 },
    label: 'Walk 5 km'
  },
  {
    id: 'dailyWalk10', kind: 'metresToday', target: 10_000, unit: 'km', xp: 15, dust: 150,
    items: { ultra_disc: 2, incense: 1, super_incubator: 1 },
    label: 'Walk 10 km'
  }
];

/* ---------------------------------------------------------------
   Sets shown in the Collection menu
   --------------------------------------------------------------- */
export const SETS = [
  { id: 'elemental-awakening', title: SET_NAME, available: true, setName: SET_NAME },
  { id: 'galactic-adventures', title: GALACTIC_SET_NAME, available: true, setName: GALACTIC_SET_NAME, galactic: true },
  { id: 'exclusive', title: EXCLUSIVE_SET_NAME, available: true, exclusive: true, setName: EXCLUSIVE_SET_NAME },
  { id: 'mythical', title: MYTHICAL_SET_NAME, available: true, mythical: true, setName: MYTHICAL_SET_NAME },
  { id: 'coming-soon', title: 'Coming Soon', available: false }
];

/* ---------------------------------------------------------------
   Galactic Adventures unlocks

   Which rarities are in play is player progress, so state.js owns the truth and
   pushes it here. Everything that rolls a creature reads DB.byRarity or
   DB.available, so telling data.js once keeps wild spawns, incense, eggs, raids
   and grunt teams consistent without touching any of them.
   --------------------------------------------------------------- */

let galacticUnlocked = new Set();

/** True once the Set mission for this Galactic rarity has been claimed. */
export const isGalacticRarityUnlocked = r => galacticUnlocked.has(Number(r));
export const unlockedGalacticRarities = () => [...galacticUnlocked].sort((a, b) => a - b);

/**
 * Replaces the unlocked set and rebuilds the pools. Call it on load and after
 * claiming a Set mission.
 */
export function setGalacticUnlocked(rarities = []) {
  galacticUnlocked = new Set((rarities || []).map(Number).filter(r => r >= 1 && r <= 5));
  if (DB.loaded) rebuildSpawnPools();
  return unlockedGalacticRarities();
}

/**
 * Recomputes every pool a roll can draw from.
 *
 * The rarity weights are untouched: a rarity 1 roll is still 60%, it simply
 * chooses from a longer list once Galactic rarity 1 is unlocked.
 */
export function rebuildSpawnPools() {
  const inPlay = sp => {
    if (sp.exclusive || sp.mythical) return false;
    if (sp.galactic) return isGalacticRarityUnlocked(sp.rarity || familyRarity(sp.id));
    return true;
  };

  DB.available = DB.species.filter(inPlay);
  DB.stage1 = DB.available.filter(s => s.stage === 1);
  DB.spawnable = DB.stage1.filter(s => s.rarity >= 1 && s.rarity <= 5);

  DB.byRarity = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const sp of DB.spawnable) DB.byRarity[sp.rarity].push(sp);
  return DB.spawnable.length;
}

/** The ability a species has, or null. */
export const abilityOf = speciesId => DB.abilities.get(speciesId) || null;
export const hasAbility = speciesId => DB.abilities.has(speciesId);

/**
 * The species a collection tab lists. Each set gets its own tab so the "x / y"
 * counter is honest per set — the main tab must read 79, not 79 plus whatever
 * mythicals exist.
 */
export function speciesForSet(set) {
  if (set?.galactic) return DB.galactic;
  if (set?.exclusive) return DB.exclusive;
  if (set?.mythical) return DB.mythical;
  return DB.species.filter(s => !s.galactic && !s.exclusive && !s.mythical);
}

/* ---------------------------------------------------------------
   Ability file parsing
   --------------------------------------------------------------- */

/** Splits a `Value` cell into trimmed entries. Blank yields an empty list. */
function abilityValues(raw) {
  return String(raw ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

const numOrNull = raw => {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/**
 * Turns the ability rows into `speciesId -> ability`, one row per clause.
 * Rows are grouped by creature and ability name, so the order of the file does
 * not matter and an ability's clauses do not have to be adjacent.
 *
 * Anything unparseable is skipped with a warning rather than thrown: a typo in
 * one clause should not cost the player the whole battle system.
 */
function buildAbilities(rows) {
  const byKey = new Map();

  rows.forEach((r, i) => {
    const line = i + 2;   // +1 for the header, +1 for 1-based counting
    const rawId = r['id_output'] || r['id'];
    if (!rawId) return;
    const id = String(rawId).replace(/\.png$/i, '').trim();

    const sp = DB.byId.get(id);
    if (!sp) {
      DB.warnings.push(`Abilities line ${line}: no creature with id "${id}"`);
      return;
    }
    // The name column is a human cross-check; a mismatch is worth flagging but
    // the id is what counts.
    const named = (r['name'] || '').trim();
    if (named && named.toLowerCase() !== sp.name.toLowerCase()) {
      DB.warnings.push(`Abilities line ${line}: "${named}" does not match ${id} (${sp.name})`);
    }

    const abilityName = (r['ability name'] || '').trim();
    if (!abilityName) {
      DB.warnings.push(`Abilities line ${line}: missing Ability Name`);
      return;
    }

    const effect = (r['effect'] || '').trim().toLowerCase();
    if (!ABILITY_EFFECTS[effect]) {
      DB.warnings.push(`Abilities line ${line}: unknown Effect "${r['effect']}"`);
      return;
    }

    const trigger = (r['trigger'] || '').trim().toLowerCase();
    if (!ABILITY_TRIGGERS.includes(trigger)) {
      DB.warnings.push(`Abilities line ${line}: unknown Trigger "${r['trigger']}"`);
      return;
    }

    const percent = numOrNull(r['percent']);
    if (percent == null || percent <= 0) {
      DB.warnings.push(`Abilities line ${line}: Percent must be a positive number`);
      return;
    }
    // Reducing by more than 100% is meaningless, and would flip the sign.
    if (effect.endsWith('less') && percent > 100) {
      DB.warnings.push(`Abilities line ${line}: "${effect}" cannot exceed 100%`);
      return;
    }

    // A single clause beyond the cap would be silently clamped in battle, which
    // is confusing to author against, so say so up front.
    const single = 1 + ABILITY_EFFECTS[effect].direction * (percent / 100);
    if (single < ABILITY_MULTIPLIER_MIN || single > ABILITY_MULTIPLIER_MAX) {
      DB.warnings.push(
        `Abilities line ${line}: ${percent}% is outside the ` +
        `${ABILITY_MULTIPLIER_MIN}x–${ABILITY_MULTIPLIER_MAX}x cap and will be clamped`);
    }

    const values = abilityValues(r['value']);
    const min = numOrNull(r['min']);
    const max = numOrNull(r['max']);

    if (ABILITY_LIST_TRIGGERS.includes(trigger) && !values.length) {
      DB.warnings.push(`Abilities line ${line}: "${trigger}" needs a Value`);
      return;
    }
    if (ABILITY_RANGE_TRIGGERS.includes(trigger) && min == null && max == null) {
      DB.warnings.push(`Abilities line ${line}: "${trigger}" needs a Min or a Max`);
      return;
    }

    const key = `${id}::${abilityName.toLowerCase()}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        speciesId: id,
        name: abilityName,
        description: (r['ability description'] || '').trim() || null,
        clauses: []
      });
    }
    const ability = byKey.get(key);
    // A description on any row of the ability applies to the whole thing.
    if (!ability.description && (r['ability description'] || '').trim()) {
      ability.description = r['ability description'].trim();
    }
    ability.clauses.push({ effect, percent, trigger, values, min, max });
  });

  const out = new Map();
  for (const ability of byKey.values()) {
    if (!ability.clauses.length) continue;
    if (out.has(ability.speciesId)) {
      // One ability per creature is the design. Keep the first and say so.
      DB.warnings.push(
        `${ability.speciesId} has more than one ability; ignoring "${ability.name}"`);
      continue;
    }
    out.set(ability.speciesId, ability);
  }
  return out;
}

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
 * move slots 3 and 4 earlier, never below level 1. A big shift on slot 4 can
 * bring it in ahead of slot 3, which is intentional — the roll table has an
 * entry that moves only slot 4.
 */
export function moveLevelFor(move, offsets) {
  if (!offsets) return move.level;
  const shift = offsets[move.slot] || 0;
  return Math.max(1, move.level - shift);
}

/**
 * The last species in a creature's family — Stage 2 or Stage 3 depending on
 * whether the middle form evolves again.
 */
export function finalEvolutionOf(speciesId) {
  const chain = familyChain(speciesId);
  return chain[chain.length - 1] || species(speciesId) || null;
}

/**
 * Every move a creature line can ever learn, gathered across the whole family
 * so an early form still lists all four. Earlier forms often only carry the
 * first two or three slots, and the missing ones live on the final evolution.
 *
 * Each entry keeps the first species in the chain that actually has that slot,
 * which is what decides whether the move needs an evolution to become usable.
 */
export function fullLearnset(speciesId) {
  const bySlot = new Map();
  for (const sp of familyChain(speciesId)) {
    if (!sp) continue;
    for (const m of sp.moves) {
      // The earliest form to learn a slot wins: that is where it unlocks.
      if (bySlot.has(m.slot)) continue;
      bySlot.set(m.slot, { ...m, fromId: sp.id, fromName: sp.name, fromStage: sp.stage });
    }
  }
  return [...bySlot.values()].sort((a, b) => a.level - b.level || a.slot - b.slot);
}

export const DB = {
  loaded: false,
  species: [],
  byId: new Map(),
  byName: new Map(),
  stage1: [],
  spawnable: [],
  byRarity: { 1: [], 2: [], 3: [], 4: [], 5: [] },
  /**
   * Raid-exclusive creatures. Deliberately kept out of `spawnable` and
   * `byRarity` so nothing — wild spawns, incense or normal eggs — can ever
   * reach them. Exclusive raids and 15 km eggs read these lists instead.
   */
  exclusive: [],
  exclusiveByRarity: { 3: [], 4: [], 5: [] },
  /** Galactic Adventures, all 77 whether unlocked or not. */
  galactic: [],
  /** Rarity 6 creatures. Only ever obtained from their own egg. */
  mythical: [],
  /**
   * Everything currently reachable by normal play: the main set plus whichever
   * Galactic rarities have been unlocked. Rebuilt by setGalacticUnlocked.
   */
  available: [],
  /**
   * speciesId -> ability. Empty until the abilities file exists, which is the
   * normal state: the file is optional and the game runs fine without it.
   */
  abilities: new Map(),
  familyOf: new Map(),
  familyMembers: new Map(),
  evolvesFrom: new Map(),
  moveIndex: new Map(),   // move name -> definition
  types: [],
  warnings: []
};

export async function loadDatabase(
  csvUrl = CSV_FILE,
  statsUrl = STATS_CSV_FILE,
  exclusiveUrl = EXCLUSIVE_CSV_FILE,
  abilitiesUrl = ABILITIES_CSV_FILE,
  galacticUrl = GALACTIC_CSV_FILE,
  mythicalUrl = MYTHICAL_CSV_FILE
) {
  DB.warnings = [];

  /** A missing extra set is not fatal: the rest of the game still runs. */
  const optional = (url, what) => fetchText(url).catch(err => {
    DB.warnings.push(`${what} not loaded: ${err.message}`);
    return '';
  });

  const [baseText, statsText, exclusiveText, abilitiesText, galacticText, mythicalText] =
    await Promise.all([
      fetchText(csvUrl),
      fetchText(statsUrl),
      optional(exclusiveUrl, 'Exclusive creatures'),
      // Abilities are entirely optional and the file is expected to be absent
      // until it is authored, so a miss here is silent by design.
      fetchText(abilitiesUrl).catch(() => ''),
      optional(galacticUrl, GALACTIC_SET_NAME),
      optional(mythicalUrl, 'Mythicals')
    ]);

  const baseRows = toRecords(parseCSV(baseText));
  const statRows = toRecords(parseCSV(statsText));
  const exclusiveRows = exclusiveText ? toRecords(parseCSV(exclusiveText)) : [];
  const galacticRows = galacticText ? toRecords(parseCSV(galacticText)) : [];
  const mythicalRows = mythicalText ? toRecords(parseCSV(mythicalText)) : [];

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
  DB.abilities = new Map();
  DB.stage1 = []; DB.spawnable = []; DB.exclusive = [];
  DB.galactic = []; DB.mythical = []; DB.available = [];
  DB.byRarity = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  DB.exclusiveByRarity = { 3: [], 4: [], 5: [] };

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

  /* ---- the self-contained sets ----
     Galactic Adventures, the raid exclusives and the mythicals all ship one row
     per creature carrying info, stats and moves together, unlike the main set
     which splits them across two files. Their `order` is pushed past the main
     set so the shared sort keeps each collection in one block. */
  addSelfContainedSet(galacticRows, {
    setName: GALACTIC_SET_NAME, orderBase: GALACTIC_ORDER_BASE,
    bucket: DB.galactic, flags: { galactic: true }
  });
  addSelfContainedSet(exclusiveRows, {
    setName: EXCLUSIVE_SET_NAME, orderBase: EXCLUSIVE_ORDER_BASE,
    bucket: DB.exclusive, flags: { exclusive: true }
  });
  addSelfContainedSet(mythicalRows, {
    setName: MYTHICAL_SET_NAME, orderBase: MYTHICAL_ORDER_BASE,
    bucket: DB.mythical, flags: { mythical: true }
  });

  DB.species.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  for (const list of [DB.galactic, DB.exclusive, DB.mythical]) {
    list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

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

  // The main set is always in play. Galactic rarities join as they are
  // unlocked; exclusives and mythicals never do. rebuildSpawnPools does the
  // actual work and is re-run whenever an unlock is claimed.
  rebuildSpawnPools();

  for (const sp of DB.exclusive) {
    if (sp.stage === 1 && DB.exclusiveByRarity[sp.rarity]) {
      DB.exclusiveByRarity[sp.rarity].push(sp);
    }
  }
  for (const r of [3, 4, 5]) {
    if (!DB.exclusiveByRarity[r].length) {
      DB.warnings.push(`No rarity ${r} exclusive creatures found`);
    }
  }

  // Abilities come last: they are keyed on species ids, so every creature has
  // to exist before the rows can be validated against them.
  DB.abilities = abilitiesText
    ? buildAbilities(toRecords(parseCSV(abilitiesText)))
    : new Map();
  for (const sp of DB.species) sp.ability = DB.abilities.get(sp.id) || null;

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

/**
 * Loads one of the single-file sets into `DB.species` and its own bucket.
 * Shared by Galactic Adventures, the raid exclusives and the mythicals, which
 * all use the same column layout.
 *
 * @param {Array<object>} rows    parsed records, may be empty
 * @param {object} opts
 * @param {string} opts.setName
 * @param {number} opts.orderBase dex numbers start just past this
 * @param {Array}  opts.bucket    the DB list to also push into
 * @param {object} opts.flags     extra Species fields, e.g. { exclusive: true }
 */
function addSelfContainedSet(rows, { setName, orderBase, bucket, flags = {} }) {
  rows.forEach((r, idx) => {
    const rawId = r['id_output'] || r['id'];
    if (!rawId) return;
    // ids in these files are written with a .png suffix, e.g. "Exclusive_01.png".
    const id = String(rawId).replace(/\.png$/i, '').trim();
    const name = r['name'] || '';
    if (!name) return;

    const numMatch = id.match(/(\d+)\s*$/);
    const rarityRaw = r['rarity'];
    const candyRaw = r['evolution candy'];
    const image = r['image'] || r['Image'] || `${name}.png`;

    const sp = new Species({
      id,
      order: orderBase + (numMatch ? Number(numMatch[1]) : idx + 1),
      name,
      stage: stageNumber(r['stage']),
      type: r['type'] || 'Neutral',
      image,
      shinyImage: shinyFileFor(name, image),
      rarity: rarityRaw ? Number(rarityRaw) : null,
      evolvesToName: r['evolves to'] || null,
      evolutionCandy: candyRaw ? Number(candyRaw) : null,
      set: setName,
      ...flags,
      baseStats: readStats(r, name),
      moves: readMoves(r, name)
    });

    if (DB.byId.has(sp.id)) {
      DB.warnings.push(`${setName} id "${sp.id}" clashes with an existing creature`);
      return;
    }
    DB.species.push(sp);
    bucket.push(sp);
    DB.byId.set(sp.id, sp);
    // Never let a later set shadow an earlier one's name lookup, since evolution
    // targets are matched by name.
    if (DB.byName.has(sp.name.toLowerCase())) {
      DB.warnings.push(`${setName} "${sp.name}" shares a name with another creature`);
    } else {
      DB.byName.set(sp.name.toLowerCase(), sp);
    }
  });
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
    // A buff can name several stats, e.g. "Attack, Defense, Speed".
    const buffStats = normaliseStats(row[`move${slot} stat buff`]);
    const buffStat = buffStats[0] || null;
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
      // `buffStat` is the first of `buffStats`, kept so single-stat callers read
      // naturally. Anything applying the buff must use `buffStats`.
      buffStat: isBuff ? buffStat : null,
      buffStats: isBuff ? buffStats : [],
      buffPct: isBuff ? buffPct : null,
      isBuff
    };
    moves.push(move);
    if (!DB.moveIndex.has(move.name)) DB.moveIndex.set(move.name, move);
  }

  moves.sort((a, b) => a.level - b.level || a.slot - b.slot);
  return moves;
}

/** Accepts "Defense" as well as "Defence", which both appear in the CSVs. */
function normaliseStat(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('hp')) return 'hp';
  if (s.startsWith('att')) return 'attack';
  if (s.startsWith('def')) return 'defence';
  if (s.startsWith('spe')) return 'speed';
  return null;
}

/**
 * A buff move can raise more than one stat: mythicals list them as
 * "Attack, Defense, Speed". Returns a de-duplicated array of stat keys.
 */
function normaliseStats(raw) {
  const out = [];
  for (const part of String(raw ?? '').split(/[,/&]|\band\b/)) {
    const stat = normaliseStat(part);
    if (stat && !out.includes(stat)) out.push(stat);
  }
  return out;
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

/** Rarity roll against an arbitrary weight table. */
export function rollRarityWith(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const tier of [1, 2, 3, 4, 5]) {
    r -= weights[tier] || 0;
    if (r < 0) return tier;
  }
  return 1;
}

/**
 * Weighted rarity, then a uniform pick inside that tier. Stage 1 only.
 * Pass a weight table to use different odds, as Rare Incense does.
 */
export function rollSpawnSpecies(weights = RARITY_WEIGHTS) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const pool = DB.byRarity[rollRarityWith(weights)];
    if (pool?.length) return pool[Math.floor(Math.random() * pool.length)];
  }
  return DB.spawnable[Math.floor(Math.random() * DB.spawnable.length)];
}

/**
 * Weighted pick from the exclusive pool. Only rarities 3, 4 and 5 exist here.
 */
export function rollExclusiveSpecies(weights = EXCLUSIVE_RAID_WEIGHTS) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const pool = DB.exclusiveByRarity[rollRarityWith(weights)];
    if (pool?.length) return pool[Math.floor(Math.random() * pool.length)];
  }
  const all = DB.exclusive.filter(s => s.stage === 1);
  return all.length ? all[Math.floor(Math.random() * all.length)] : rollSpawnSpecies();
}

/** True on Saturday and Sunday, which run slightly richer POI odds. */
export const isWeekend = (now = new Date()) => {
  const d = now.getDay();
  return d === 0 || d === 6;
};

/** Is `now` inside a weekly window, given a day and decimal start/end hours? */
const inWeeklyWindow = (now, day, start, end) => {
  if (now.getDay() !== day) return false;
  const t = now.getHours() + now.getMinutes() / 60;
  return t >= start && t < end;
};

/** Millis until a weekly window closes. 0 when it is not running. */
function weeklyWindowEndsIn(now, day, start, end) {
  if (!inWeeklyWindow(now, day, start, end)) return 0;
  // Derived from the end hour so retuning a window only means one edit.
  const to = new Date(now);
  to.setHours(Math.floor(end), Math.round((end % 1) * 60), 0, 0);
  return Math.max(0, to - now);
}

export const isRaidInvasion = (now = new Date()) =>
  inWeeklyWindow(now, RAID_INVASION_DAY, RAID_INVASION_START, RAID_INVASION_END);

export const isTrainingDojo = (now = new Date()) =>
  inWeeklyWindow(now, TRAINING_DOJO_DAY, TRAINING_DOJO_START, TRAINING_DOJO_END);

/**
 * The weekly event that owns the POI odds right now, or null on a normal day.
 * Everything that needs to know an event is running reads this, so the window
 * definitions never have to be re-checked in more than one place.
 */
export function poiEventState(now = new Date()) {
  if (isRaidInvasion(now)) {
    return {
      id: 'raidInvasion',
      label: RAID_INVASION_LABEL,
      table: POI_OUTCOMES_RAID_INVASION,
      endsIn: weeklyWindowEndsIn(now, RAID_INVASION_DAY, RAID_INVASION_START, RAID_INVASION_END)
    };
  }
  if (isTrainingDojo(now)) {
    return {
      id: 'trainingDojo',
      label: TRAINING_DOJO_LABEL,
      table: POI_OUTCOMES_TRAINING_DOJO,
      endsIn: weeklyWindowEndsIn(now, TRAINING_DOJO_DAY, TRAINING_DOJO_START, TRAINING_DOJO_END)
    };
  }
  return null;
}

/**
 * The odds table in force right now. An event wins over the weekday/weekend
 * split — Training Dojo Hour falls on a Saturday, and for those 30 minutes its
 * table replaces the weekend one entirely.
 */
export function poiOutcomeTable(now = new Date()) {
  const event = poiEventState(now);
  if (event) return event.table;
  return isWeekend(now) ? POI_OUTCOMES_WEEKEND : POI_OUTCOMES;
}

/** Which map-point kind a POI produces this scan. */
export function rollPOIOutcome(now = new Date()) {
  return weightedPick(poiOutcomeTable(now)).kind;
}

/** During Training Dojo Hour the map holds as many grunts as it can fit. */
export const gruntsAreUncapped = (now = new Date()) => isTrainingDojo(now);

/* ---------------------------------------------------------------
   Calendar

   Every recurring event in one table so the News tab can list what is coming
   without knowing the rules behind each one. `onDay` is given a date at local
   midnight, so it must only ever look at the calendar, never the clock.
   --------------------------------------------------------------- */

export const CALENDAR_EVENTS = [
  {
    id: 'stardustSunday',
    label: STARDUST_SUNDAY_LABEL,
    icon: '✨',
    allDay: true,
    onDay: d => d.getDay() === 0,
    blurb: `Every stardust reward is ×${STARDUST_SUNDAY_MULTIPLIER}, all day.`
  },
  {
    id: 'bonanzaDay',
    label: 'Shiny Bonanza Day',
    icon: '★',
    allDay: true,
    onDay: isBonanzaDay,
    blurb: 'Shiny odds are doubled all day. The last Saturday of the month.'
  },
  {
    id: 'raidInvasion',
    label: RAID_INVASION_LABEL,
    icon: '🔥',
    start: RAID_INVASION_START,
    end: RAID_INVASION_END,
    onDay: d => d.getDay() === RAID_INVASION_DAY,
    blurb: 'Raids everywhere, and every disc point pays an Ultra Capture Disc.'
  },
  {
    id: 'trainingDojo',
    label: TRAINING_DOJO_LABEL,
    icon: '🥋',
    start: TRAINING_DOJO_START,
    end: TRAINING_DOJO_END,
    onDay: d => d.getDay() === TRAINING_DOJO_DAY,
    blurb: 'Grunts take over the map points, with no limit on how many appear.'
  },
  {
    id: 'bonanzaHour',
    label: 'Shiny Bonanza Hour',
    icon: '✦',
    start: BONANZA_HOUR_START,
    end: BONANZA_HOUR_END,
    onDay: () => true,
    blurb: 'Shiny odds are doubled.'
  },
  {
    id: 'relax',
    label: RELAX_HOUR_LABEL,
    icon: '🌙',
    start: RELAX_HOUR_START,
    end: RELAX_HOUR_END,
    onDay: () => true,
    blurb: `Your reach grows to ${RULES.RELAX_RANGE_M} m.`
  }
];

/** Local midnight `offset` days from `from`. */
function dayStart(from, offset = 0) {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

/** Everything happening on one day, all-day events first then by start time. */
export function eventsOnDay(date) {
  const day = dayStart(date);
  return CALENDAR_EVENTS
    .filter(e => e.onDay(day))
    .map(e => ({
      id: e.id,
      label: e.label,
      icon: e.icon,
      blurb: e.blurb,
      allDay: !!e.allDay,
      start: e.start ?? null,
      end: e.end ?? null
    }))
    .sort((a, b) =>
      Number(!!b.allDay) - Number(!!a.allDay) || (a.start ?? 0) - (b.start ?? 0));
}

/**
 * The next `days` days including today, each with its events.
 * @returns {Array<{date:Date, offset:number, isToday:boolean, events:Array}>}
 */
export function calendarDays(days = 7, from = new Date()) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = dayStart(from, i);
    out.push({ date, offset: i, isToday: i === 0, events: eventsOnDay(date) });
  }
  return out;
}

/**
 * Copies rather than handing back the table's own object — a point's drop is
 * edited in place during a Raid Invasion, and mutating the shared table would
 * corrupt every later roll for the rest of the session.
 */
export const rollDiscDrop = () => ({ ...weightedPick(DISC_DROPS).items });

/** A potion-or-revive point, plus an occasional Full Heal on top. */
export function rollItemDrop() {
  const drop = { ...weightedPick(ITEM_DROPS).items };
  if (chance(ITEM_DROP_FULL_HEAL_CHANCE)) {
    drop.full_heal = (drop.full_heal || 0) + 1;
  }
  return drop;
}

/** Adds the Raid Invasion bonus to a disc drop. No-op outside the window. */
export function applyRaidInvasionBonus(drop, now = new Date()) {
  if (!isRaidInvasion(now)) return drop;
  // The doubling is rolled once for the whole bonus, so a lucky point pays two
  // of everything the bonus contains rather than two of one thing.
  const times = chance(RAID_INVASION_DOUBLE_CHANCE) ? 2 : 1;
  for (const [id, n] of Object.entries(RAID_INVASION_DISC_BONUS)) {
    drop[id] = (drop[id] || 0) + n * times;
  }
  return drop;
}

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
export function statsFor(sp, level = 1, statMod = null, boosts = null) {
  const out = {};
  const growth = 1 + STAT_GROWTH_PER_LEVEL * (Math.max(1, level) - 1);
  for (const k of STAT_KEYS) {
    let v = sp.baseStats[k];
    if (statMod) {
      if (statMod.up === k) v *= 1.1;
      if (statMod.down === k) v *= 0.9;
    }
    // Rounded first, then the flat boost, so a +1 booster reads as +1 on screen.
    out[k] = Math.max(1, Math.round(v * growth)) + (Number(boosts?.[k]) || 0);
  }
  return out;
}

/**
 * Raid boss stats: levelled, then boosted by the raid modifiers. Exclusive
 * raids use the tougher table (4x HP, +30% instead of 3x and +25%).
 */
export function raidBossStats(sp, level, exclusive = false) {
  const base = statsFor(sp, level, null);
  const mods = raidModifiers(exclusive);
  const out = {};
  for (const k of STAT_KEYS) {
    out[k] = Math.max(1, Math.round(base[k] * (mods[k] ?? 1)));
  }
  return out;
}

export const isSuperEffective = (attackerType, defenderType) =>
  TYPE_ADVANTAGE[attackerType] === defenderType;

export const isNotVeryEffective = (attackerType, defenderType) =>
  (TYPE_RESISTANCE[attackerType] || []).includes(defenderType);

/**
 * The type multiplier for one matchup, and the label for it.
 * No pair is both strong and resisted, but advantage wins if that ever changes.
 * @returns {{mult:number, superEffective:boolean, notVeryEffective:boolean}}
 */
export function effectivenessOf(attackerType, defenderType) {
  if (isSuperEffective(attackerType, defenderType)) {
    return { mult: SUPER_EFFECTIVE_MULTIPLIER, superEffective: true, notVeryEffective: false };
  }
  if (isNotVeryEffective(attackerType, defenderType)) {
    return { mult: NOT_VERY_EFFECTIVE_MULTIPLIER, superEffective: false, notVeryEffective: true };
  }
  return { mult: 1, superEffective: false, notVeryEffective: false };
}

/**
 * power x attack / defence, then the type multiplier. Rounded, min 1 — so a
 * resisted hit still always takes at least 1 HP off.
 */
export function damageOf(
  move, attackerType, attackerAttack, defenderType, defenderDefence,
  { dealMultiplier = 1, takeMultiplier = 1 } = {}
) {
  if (!move || move.power <= 0) return 0;
  const { mult } = effectivenessOf(attackerType, defenderType);
  // Abilities are their own layer on top of type effectiveness, so a super
  // effective hit from a +50% ability is 1.4 x 1.5.
  const raw = (move.power * attackerAttack / Math.max(1, defenderDefence))
    * mult * dealMultiplier * takeMultiplier;
  return Math.max(1, Math.round(raw));
}

/* ===============================================================
   Shiny
   =============================================================== */

/** Last Saturday of the month = Shiny Bonanza Day. */
export function isBonanzaDay(now = new Date()) {
  if (now.getDay() !== 6) return false;
  const probe = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  return probe.getMonth() !== now.getMonth();
}

/** 17:30–18:30 local = Shiny Bonanza Hour. */
export const isBonanzaHour = (now = new Date()) => {
  const t = now.getHours() + now.getMinutes() / 60;
  return t >= BONANZA_HOUR_START && t < BONANZA_HOUR_END;
};

export function bonanzaState(now = new Date()) {
  const day = isBonanzaDay(now);
  const hour = isBonanzaHour(now);
  return { active: day || hour, day, hour };
}

/**
 * Shiny chance for one roll. `shinyIncense` overrides everything else: it is a
 * flat rate that deliberately does not stack with a Bonanza, so during an
 * unlucky overlap it can even be lower than the doubled raid rate.
 */
export function shinyOdds(source = 'spawn', now = new Date(), { shinyIncense = false } = {}) {
  if (shinyIncense) return SHINY_INCENSE_ODDS;
  const table = bonanzaState(now).active ? SHINY_ODDS.bonanza : SHINY_ODDS.normal;
  return table[source] ?? table.spawn;
}

export const rollShiny = (source = 'spawn', now = new Date(), opts = {}) =>
  chance(shinyOdds(source, now, opts));

/* ===============================================================
   Relax and Good Night
   =============================================================== */

/** During this window the interaction radius widens to RELAX_RANGE_M. */
export const isRelaxHour = (now = new Date()) => {
  const t = now.getHours() + now.getMinutes() / 60;
  return t >= RELAX_HOUR_START && t < RELAX_HOUR_END;
};

/** Millis until the relax window closes (0 when it is not running). */
export function relaxHourEndsIn(now = new Date()) {
  if (!isRelaxHour(now)) return 0;
  // Derived from RELAX_HOUR_END so retuning the window only means one edit.
  const end = new Date(now);
  end.setHours(Math.floor(RELAX_HOUR_END), Math.round((RELAX_HOUR_END % 1) * 60), 0, 0);
  return Math.max(0, end - now);
}

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

/**
 * An Exclusive Raid: rarity 3, 4 or 5 only, boss drawn from the exclusive
 * pool. Levels and payouts match the equivalent normal raid tier — only the
 * rarity odds, the boss modifiers and the extra drops differ.
 */
export function rollExclusiveRaid() {
  const sp = rollExclusiveSpecies();
  const rarity = sp.rarity >= 3 && sp.rarity <= 5 ? sp.rarity : 3;
  const tier = RAID_TIERS[rarity];
  return {
    speciesId: sp.id,
    rarity,
    exclusive: true,
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
