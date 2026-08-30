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
/**
 * The second wave of exclusives. Same collection tab and same pools as the
 * first, but locked behind its own Set mission — until that is claimed these
 * creatures are not in the Collection at all, and no raid or egg can produce
 * one. Their ids continue the first file's numbering, so they share its
 * order base and slot straight in after it.
 */
export const EXCLUSIVE2_CSV_FILE = 'Exclusives2.csv';
/**
 * The third wave: the Grand Raid Challenge bosses at the top of each Battle
 * Frontier challenge. They share the Exclusive collection tab, but unlike the
 * first two waves nothing rolls them — no exclusive raid, no 15 km egg. Clearing
 * all ten levels of a challenge in one mode is the only way to meet one, which
 * is why they are filtered out of the roll pools in rebuildExclusivePools.
 *
 * Optional, like the event casts: without the file the challenges still run and
 * simply have no Grand Raid at the top.
 */
export const EXCLUSIVE3_CSV_FILE = 'Exclusives3.csv';
export const EXCLUSIVE_SET_NAME = 'Exclusive';

/**
 * The second full set. Its creatures are locked behind the Set missions: a
 * rarity only joins the spawn pools once its mission has been claimed.
 */
export const GALACTIC_CSV_FILE = 'Galactic Adventures.csv';
export const GALACTIC_SET_NAME = 'Galactic Adventures';

/**
 * The third full set, gated the same way as Galactic Adventures but off the
 * back of *that* set's registrations rather than the first one's. Two things
 * are new here and nowhere else:
 *
 *   • some creatures list more than one `Evolves to` target, and the player
 *     chooses which way to go when they evolve one;
 *   • some carry a `Spawn Restriction`, a condition that has to hold before
 *     they will spawn, appear in a raid or hatch at all.
 */
export const TEMPORAL_CSV_FILE = 'Temporal Rift.csv';
export const TEMPORAL_SET_NAME = 'Temporal Rift';

/**
 * Creature lists for the two annual events that use hand-picked casts rather
 * than a type or the whole pool. One `id,name` row per creature, the same shape
 * as the Creature Spotlight rota. Both files are optional: without one, that
 * event simply hands out no hourly creature.
 */
export const HALLOWEEN_CSV_FILE = 'Halloween.csv';
export const THANKSGIVING_CSV_FILE = 'Thanks Giving.csv';

/**
 * The Battle Frontier ladder: one row per challenge and level, carrying the
 * three creatures the trainer brings, their levels, held items and stat boosts.
 * Optional — without it the building still opens and simply has no challenges.
 */
export const FRONTIER_CSV_FILE = 'Battle Frontier.csv';

/** Mythicals: rarity 6, one per egg, never in a spawn pool. */
export const MYTHICAL_CSV_FILE = 'Mythicals.csv';
export const MYTHICAL_SET_NAME = 'Mythical';
export const MYTHICAL_RARITY = 6;
/**
 * The mythicals, each pinned to its own egg so adding another to the CSV can
 * never dilute an egg that already exists.
 */
export const MYTHICAL_ASTRALYON_ID = 'Mythical_01';
export const MYTHICAL_CHROMARION_ID = 'Mythical_02';

/**
 * Dex numbers per set, spaced so the shared sort keeps each collection
 * together and in the same order as the Collection tabs.
 */
export const GALACTIC_ORDER_BASE = 1000;
/**
 * Slotted between Galactic Adventures and the Exclusives rather than after the
 * Mythicals, because the Collection shows the three numbered sets side by side
 * and this base has to agree with that order.
 */
export const TEMPORAL_ORDER_BASE = 1500;
export const EXCLUSIVE_ORDER_BASE = 2000;
/**
 * The Grand Raid bosses get their own base rather than sharing the Exclusive
 * one. Their ids are `Exclusive_battlefrontier_01`..`_05`, whose trailing
 * numbers would otherwise collide with `Exclusive_01`..`_05` and scatter them
 * through the middle of the tab. This keeps them together at the bottom, after
 * every exclusive from an ordinary raid.
 */
export const EXCLUSIVE_FRONTIER_ORDER_BASE = 2500;
export const MYTHICAL_ORDER_BASE = 3000;

export const IMAGE_DIR = 'images';
export const SHINY_DIR = 'shiny';
export const ITEM_DIR = 'items';

/* ---------------------------------------------------------------
   Core rules
   --------------------------------------------------------------- */
/**
 * Shared so the grunt spread and the POI search can never drift apart.
 *
 * Cut from 250 m to 150 m once trees, poles, crossings and leisure joined the
 * POI list: in a city the wider circle held so many points that the map itself
 * got heavy. A tighter circle scanned more often turned out to feel better than
 * a wide one scanned rarely, and it is much kinder on Overpass too.
 */
const SCAN_RADIUS_M = 150;

export const RULES = {
  SCAN_RADIUS_M,                // POI search radius around the player
  CAPTURE_RANGE_M: 25,         // must be this close to interact with anything
  RELAX_RANGE_M: 100,          // widened reach during Relax and Good Night
  MIN_SPAWN_SEPARATION_M: 15,   // no two map points within 15 m
  MIN_GRUNT_SEPARATION_M: 20,   // grunts also keep 20 m from each other
  SCAN_INTERVAL_MS: 90_000,     // everything re-rolls every 1 min 30 s

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

  // Green space rolls separately from shops/amenities
  GRUNT_CHANCE: 0.40,
  GARDEN_GRUNT_CHANCE: 0.25,    // leisure=garden is a much quieter spot
  GRASS_GRUNT_CHANCE: 0.25,     // landuse=grass, usually a verge or a lawn

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
  /* Hard ceiling across every piece of green space at once. Raised from 6 to 11
     when landuse=grass joined parks and gardens as a grunt source, so the new
     areas add grunts rather than competing for the same six slots. */
  MAX_ACTIVE_GRUNTS: 11,

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
  MAGNET_BONUS_MULTIPLIER: 4,   // bonus = 4 × playerLevel per capture

  /* Molten Seeker: widens how far you can reach for 15 minutes. It stacks with
     nothing — whichever of the seeker and Relax Hour reaches further wins. */
  SEEKER_DURATION_MS: 15 * 60_000,
  SEEKER_RANGE_M: 50
};

/**
 * "3 min", "1 min 30 s", "45 s" — the scan interval in words.
 *
 * Exists because the interval stopped being a whole number of minutes: dividing
 * by 60000 used to read "3 minutes" and now reads "1.5 minutes".
 */
export function scanIntervalLabel(ms = RULES.SCAN_INTERVAL_MS) {
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  if (!secs) return `${mins} min`;
  return mins ? `${mins} min ${secs} s` : `${secs} s`;
}

/**
 * The three timed effect slots, each holding one effect at a time.
 *
 * Kept as one table because the slots used to be spelled out as a literal
 * `['incense', 'magnet']` in four different places, and a new slot that missed
 * any one of them was silently never started, never expired or never saved.
 */
export const EFFECT_SLOTS = {
  incense: { defaultItem: 'incense',         durationMs: RULES.INCENSE_DURATION_MS },
  magnet:  { defaultItem: 'stardust_magnet', durationMs: RULES.MAGNET_DURATION_MS },
  seeker:  { defaultItem: 'molten_seeker',   durationMs: RULES.SEEKER_DURATION_MS }
};

export const EFFECT_KINDS = Object.keys(EFFECT_SLOTS);

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
 * turn into a grunt — normally grunts only come out of green space. Like the
 * invasion table it has no "nothing" slice.
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

/**
 * The last two levels are worth more than the eight before them: from level 9,
 * each level adds 20% of the base stat instead of 10%, across all four stats.
 *
 * Still measured against the *base* stat, like every other level: level 10 is
 * base × 2.1 (0.10 × 7 for levels 2–8, then 0.20 twice), not the level 9 figure
 * plus another fifth of itself.
 */
export const HIGH_GROWTH_FROM_LEVEL = 9;
export const HIGH_STAT_GROWTH_PER_LEVEL = 0.20;

/** What every stat is multiplied by at `level`, before boosts and held items. */
export function statGrowthFor(level) {
  const lv = Math.max(1, Number(level) || 1);
  // Steps taken at HIGH_GROWTH_FROM_LEVEL or above pay the higher rate.
  const highSteps = Math.max(0, lv - (HIGH_GROWTH_FROM_LEVEL - 1));
  return 1 + STAT_GROWTH_PER_LEVEL * (lv - 1)
    + (HIGH_STAT_GROWTH_PER_LEVEL - STAT_GROWTH_PER_LEVEL) * highSteps;
}

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

/* ---------------------------------------------------------------
   Exchange Corner

   The Research Lab's second counter: hand over a pile of one everyday item and
   pick something else back. Every deal is deliberately lossy — six of a common
   item for two of another, or three of a scarcer one — so it is a way out of a
   drawer full of Potions, never a way to farm discs.

   `cost` is how many of `from` one trade takes; each entry in `to` is what a
   single trade pays out.
   --------------------------------------------------------------- */

/**
 * The everyday items, all interchangeable at the same rate: hand over six, take
 * two of another back. A Full Heal counts as one of these, so it trades exactly
 * like a Potion in both directions.
 */
export const EXCHANGE_EVERYDAY_ITEMS = ['potion', 'revive', 'capture_disc', 'full_heal'];
/** The scarcer pair: three of one buys two everyday items, or one of the other. */
export const EXCHANGE_SCARCE_ITEMS = ['ultra_disc', 'single_use_incubator'];

export const EXCHANGE_EVERYDAY_COST = 6;
export const EXCHANGE_SCARCE_COST = 3;
export const EXCHANGE_EVERYDAY_PAYOUT = 2;
export const EXCHANGE_SCARCE_PAYOUT = 1;

/**
 * Built from the two lists rather than written out, so every deal stays
 * symmetrical: adding an item to a list gives it a trade-in of its own and adds
 * it as a payout everywhere else in one go. Nothing can be traded for itself.
 */
function buildItemExchanges() {
  const out = [];

  for (const from of EXCHANGE_EVERYDAY_ITEMS) {
    out.push({
      from,
      cost: EXCHANGE_EVERYDAY_COST,
      to: [
        ...EXCHANGE_EVERYDAY_ITEMS
          .filter(id => id !== from)
          .map(item => ({ item, qty: EXCHANGE_EVERYDAY_PAYOUT })),
        ...EXCHANGE_SCARCE_ITEMS.map(item => ({ item, qty: EXCHANGE_SCARCE_PAYOUT }))
      ]
    });
  }

  for (const from of EXCHANGE_SCARCE_ITEMS) {
    out.push({
      from,
      cost: EXCHANGE_SCARCE_COST,
      to: [
        ...EXCHANGE_EVERYDAY_ITEMS.map(item => ({ item, qty: EXCHANGE_EVERYDAY_PAYOUT })),
        ...EXCHANGE_SCARCE_ITEMS
          .filter(id => id !== from)
          .map(item => ({ item, qty: EXCHANGE_SCARCE_PAYOUT }))
      ]
    });
  }

  return out;
}

export const ITEM_EXCHANGES = buildItemExchanges();

/** The deal for handing over this item, or null if it cannot be traded in. */
export const itemExchange = fromId =>
  ITEM_EXCHANGES.find(x => x.from === fromId) || null;

/** What one trade of `fromId` pays out in `toId`, or null if that is not offered. */
export const itemExchangeOption = (fromId, toId) =>
  itemExchange(fromId)?.to.find(t => t.item === toId) || null;

/**
 * Total XP needed to reach each player level.
 *
 * Levels 2–15 are hand-tuned. From 16 on, each level's *step* is the previous
 * step plus about 20%, rounded to the nearest thousand — so the last stretch
 * is 24k, 29k, 35k, 42k and 50k on top of the 20k that level 15 asked for.
 */
export const PLAYER_LEVEL_XP = {
  1: 0, 2: 25, 3: 100, 4: 250, 5: 1000, 6: 2000, 7: 3500, 8: 6000,
  9: 10000, 10: 15000, 11: 22000, 12: 30000, 13: 42000, 14: 60000, 15: 80000,
  16: 104000, 17: 133000, 18: 168000, 19: 210000, 20: 260000
};
/**
 * Player level-up loot, in three layers:
 *   `every`     — granted on every single level.
 *   `fromLevel` — granted on every level at or past that threshold.
 *   `special`   — granted once, on exactly that level.
 *
 * The level 16 tier is what makes the last five levels worth the climb: they
 * pay everything level 15 did plus the four items below, every time. Written as
 * a `fromLevel` tier rather than five identical `special` blocks so raising the
 * cap again cannot leave a level silently paying less than the one before it.
 */
export const LEVEL_UP_REWARDS = {
  every: { capture_disc: 5, incense: 1, stardust_magnet: 1 },
  fromLevel: {
    8: { rare_incense: 1 },
    16: { molten_seeker: 1, shiny_incense: 1, mysterious_incense: 1, strength_reroll: 1 }
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

export const MAX_PLAYER_LEVEL = 20;

/** Every level-up tier, lowest threshold first, for the info screen. */
export const levelUpTiers = () =>
  Object.entries(LEVEL_UP_REWARDS.fromLevel || {})
    .map(([from, table]) => ({ from: Number(from), table }))
    .sort((a, b) => a.from - b.from);

/** XP needed to get from `level` to the next one, or 0 at the cap. */
export const playerLevelStep = level =>
  Math.max(0, (PLAYER_LEVEL_XP[level + 1] ?? PLAYER_LEVEL_XP[level] ?? 0) - (PLAYER_LEVEL_XP[level] ?? 0));

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
   Sweet Toothsday

   Every Tuesday, all day, candy from a capture, a raid capture or an egg hatch
   is doubled. Deliberately only those three: buddy walking, the breeding centre
   and Essence Harvesting all pay candy on a *rate* rather than per event, and
   doubling those would quietly double the value of a walk started on Monday.
   --------------------------------------------------------------- */
export const SWEET_TOOTHSDAY_MULTIPLIER = 2;
export const SWEET_TOOTHSDAY_LABEL = 'Sweet Toothsday';
export const SWEET_TOOTHSDAY_DAY = 2;      // 0 = Sunday, so 2 = Tuesday

export const isSweetToothsday = (now = new Date()) => now.getDay() === SWEET_TOOTHSDAY_DAY;

/** What candy from a capture, raid capture or hatch is multiplied by right now. */
export const candyMultiplier = (now = new Date()) =>
  isSweetToothsday(now) ? SWEET_TOOTHSDAY_MULTIPLIER : 1;

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

export const ABILITIES_CSV_FILE = 'Abilities.csv';

/**
 * What an ability can do.
 *
 * The first four move a damage multiplier and are the ordinary case. The fifth
 * is different in kind: it deals a one-off hit at the moment its owner is
 * knocked out, so it has no channel and is handled by the faint step rather than
 * the damage step. `clauseMultiplier` leaves it alone.
 */
export const ABILITY_EFFECTS = {
  'deal more': { channel: 'deal', direction: 1 },
  'deal less': { channel: 'deal', direction: -1 },
  'take more': { channel: 'take', direction: 1 },
  'take less': { channel: 'take', direction: -1 },
  'deal on faint': { channel: 'faint', direction: 0 }
};

/** Triggers that read a list of allowed values out of the `Value` column. */
export const ABILITY_LIST_TRIGGERS = [
  'opposing type', 'opposing stage', 'opposing rarity', 'opposing set',
  'day', 'month', 'daylight',
  'opposing held', 'opposing buffed', 'last standing', 'moon', 'team'
];
/**
 * Triggers that depend on who is standing opposite. Everything else can be
 * judged from the clock and the weather alone, which is what lets the team
 * picker say whether an ability will do anything before a battle starts.
 */
export const ABILITY_OPPONENT_TRIGGERS = [
  'opposing type', 'opposing stage', 'opposing rarity', 'opposing set',
  'opposing level', 'opposing held', 'opposing hp', 'opposing buffed'
];
/**
 * Triggers that cannot be judged until a battle is actually running: they read
 * how hurt a creature is, how much of the team is left, or what the opponent has
 * done to itself so far.
 *
 * The team picker reports these as "may apply" rather than yes or no, because
 * answering with the state at the moment the team is chosen would be a
 * confidently wrong answer rather than an honest "it depends".
 */
export const ABILITY_IN_BATTLE_TRIGGERS = [
  'own hp', 'opposing hp', 'last standing', 'opposing buffed'
];
/**
 * The only two values the daylight trigger accepts, plus the spellings the
 * sheets actually use. "Daytime" and "Day" mean the same thing.
 */
export const DAYLIGHT_VALUES = ['Day', 'Night'];
const DAYLIGHT_SYNONYMS = { day: 'Day', daytime: 'Day', night: 'Night', nighttime: 'Night' };
/** Normalises a written daylight value, or null when it is not one. */
export const daylightValue = raw => DAYLIGHT_SYNONYMS[String(raw ?? '').trim().toLowerCase()] || null;
/** Triggers that read `Min` / `Max` instead. */
export const ABILITY_RANGE_TRIGGERS = [
  'temperature', 'time', 'cloud cover', 'humidity', 'wind', 'precipitation',
  'walked today', 'grunts today', 'raids today', 'captures today', 'shinies today',
  'day of month', 'battery', 'elevation', 'points scanned',
  'own hp', 'opposing hp', 'opposing level'
];

/**
 * Range triggers whose `Max` includes the number itself.
 *
 * The older weather and clock triggers treat `Max` as a ceiling you have to stay
 * under, and everything written against them relies on that — a 12:00–14:00
 * window must not also cover 14:00. The newer ones count whole things, where a
 * sheet saying "the first five days of the month" plainly means the 5th is in,
 * and "20% battery or less" means 20 is in.
 */
const INCLUSIVE_MAX_TRIGGERS = new Set([
  'walked today', 'grunts today', 'raids today', 'captures today', 'shinies today',
  'day of month', 'battery', 'elevation', 'points scanned',
  'own hp', 'opposing hp', 'opposing level'
]);

/**
 * The weather-driven triggers, and the field each one reads. All follow the
 * same rule as temperature: with no reading, the clause never fires.
 */
export const ABILITY_WEATHER_TRIGGERS = {
  'temperature': { field: 'temperature', unit: '°C', label: 'temperature' },
  'cloud cover': { field: 'cloudCover', unit: '%', label: 'cloud cover' },
  'humidity': { field: 'humidity', unit: '%', label: 'humidity' },
  'wind': { field: 'wind', unit: ' km/h', label: 'wind speed' },
  'precipitation': { field: 'precipitation', unit: ' mm', label: 'precipitation' }
};

/**
 * Triggers read off the player's own day rather than the world. Kept separate
 * because they need a figure pushed in from state.js — data.js must not import
 * it, or the two would import each other.
 *
 * `walked today` is in kilometres, which is how both the sheets and the player
 * think about it, even though the save counts metres.
 */
export const DAILY_COUNTER_TRIGGERS = {
  'walked today': { field: 'kmToday', unit: ' km', label: 'distance walked today' },
  'grunts today': { field: 'gruntsToday', unit: '', label: 'grunts beaten today' },
  'raids today': { field: 'raidsToday', unit: '', label: 'raids won today' },
  'captures today': { field: 'capturesToday', unit: '', label: 'creatures caught today' },
  'shinies today': { field: 'shiniesToday', unit: '', label: 'shinies caught today' }
};

/**
 * Triggers read off the device and the place the player is standing, rather than
 * the clock, the weather or the battle. Pushed in from outside like everything
 * else, and null when unavailable — the Battery Status API in particular does not
 * exist on iOS, so a battery clause simply never fires there.
 */
export const WORLD_READING_TRIGGERS = {
  'elevation': { field: 'elevation', unit: ' m', label: 'elevation' },
  'battery': { field: 'battery', unit: '%', label: 'battery level' },
  'points scanned': { field: 'pointsScanned', unit: '', label: 'points in range' }
};

/** In-battle readings: how hurt each side is, and how big the opponent is. */
export const BATTLE_READING_TRIGGERS = {
  'own hp': { field: 'selfHpPct', unit: '%', label: 'its own HP' },
  'opposing hp': { field: 'foeHpPct', unit: '%', label: "the opponent's HP" },
  'opposing level': { field: 'foeLevel', unit: '', label: "the opponent's level" }
};

/** Trigger that is simply always on. Used by effects that carry their own timing. */
export const ALWAYS_TRIGGER = 'always';

export const ABILITY_TRIGGERS = [
  ...ABILITY_LIST_TRIGGERS, ...ABILITY_RANGE_TRIGGERS, ALWAYS_TRIGGER
];

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
  const flag = v => (typeof v === 'boolean' ? v : null);
  return {
    temperature: pick(w.temperature ?? ctx.temperature),
    cloudCover: pick(w.cloudCover),
    humidity: pick(w.humidity),
    wind: pick(w.wind),
    precipitation: pick(w.precipitation),
    // Daylight is a flag rather than a reading, so it gets its own passthrough.
    // null means the reading is missing, which switches the trigger off.
    isDay: flag(w.isDay ?? ctx.isDay)
  };
}

/**
 * Normalises the "what has the player done today" half of a context, the same
 * way abilityWeather does for the world. A missing figure is null, which
 * switches its trigger off rather than reading as zero.
 */
export function abilityDaily(ctx = {}) {
  const d = ctx.daily || {};
  const pick = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const metres = pick(d.metresToday);
  return {
    kmToday: metres == null ? null : metres / 1000,
    gruntsToday: pick(d.gruntsToday),
    raidsToday: pick(d.raidsToday),
    capturesToday: pick(d.capturesToday),
    shiniesToday: pick(d.shiniesToday)
  };
}

/** The device-and-place half of a context. Same never-guess rule throughout. */
export function abilityWorld(ctx = {}) {
  const w = ctx.world || {};
  const pick = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    elevation: pick(w.elevation),
    battery: pick(w.battery),
    pointsScanned: pick(w.pointsScanned)
  };
}

/**
 * The battle half of a context, as plain readings rather than battler objects.
 *
 * Deliberately not the battlers themselves: data.js knows nothing about battle.js
 * and must not start to. The battle builds these five numbers and two lists, and
 * outside a battle they are all null — which switches their clauses off, the same
 * as a missing weather reading.
 */
export function abilityBattle(ctx = {}) {
  const b = ctx.battle || {};
  const pick = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const flag = v => (typeof v === 'boolean' ? v : null);
  return {
    selfHpPct: pick(b.selfHpPct),
    foeHpPct: pick(b.foeHpPct),
    foeLevel: pick(b.foeLevel),
    /** The held item id the opponent is carrying, or null for none. */
    foeHeld: b.foeHeld || null,
    /** stat -> percentage the opponent has moved it by, positive or negative. */
    foeBuffs: b.foeBuffs || null,
    lastStanding: flag(b.lastStanding),
    /** Names of the *other* creatures on this creature's team, or null. */
    teamMates: Array.isArray(b.teamMates) ? b.teamMates : null
  };
}

/* ---- moon phase ----
   Worked out from the date alone: the synodic month is a fixed 29.53 days and a
   known new moon anchors it, so no API and no permission are needed. Good to
   within a few hours, which is far better than the trigger needs.

   The cycle is split into the eight named phases, so "Full" covers the couple of
   nights either side of the exact full moon rather than one instant nobody would
   ever catch. */

/** A known new moon: 2000-01-06 18:14 UTC, the standard epoch for this. */
const LUNAR_EPOCH = Date.UTC(2000, 0, 6, 18, 14);
const SYNODIC_MONTH_MS = 29.530588853 * 86_400_000;

export const MOON_PHASES = [
  'New', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
  'Full', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'
];

/** How far through the cycle `now` is, from 0 (new) to just under 1. */
export function moonAge(now = new Date()) {
  const since = now.getTime() - LUNAR_EPOCH;
  const frac = (since % SYNODIC_MONTH_MS) / SYNODIC_MONTH_MS;
  return frac < 0 ? frac + 1 : frac;
}

/** The named phase `now` falls in, e.g. "Full". */
export function moonPhase(now = new Date()) {
  // +0.5 of a slot so each name is centred on its moment rather than starting at it.
  const slot = Math.floor(moonAge(now) * 8 + 0.5) % 8;
  return MOON_PHASES[slot];
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

/**
 * "the temperature", but "its own HP" left alone. Trigger labels are plain nouns
 * where an article reads naturally and already possessive where it does not, so
 * one of these is needed rather than hard-coding "the" everywhere.
 */
const withArticle = label =>
  /^(the|its|his|her|their)\b/i.test(label) ? label : `the ${label}`;

/** Every table a numeric trigger's label and unit might live in. */
const numericTriggerSpec = trigger =>
  ABILITY_WEATHER_TRIGGERS[trigger]
  || DAILY_COUNTER_TRIGGERS[trigger]
  || WORLD_READING_TRIGGERS[trigger]
  || BATTLE_READING_TRIGGERS[trigger]
  || (trigger === 'day of month' ? { unit: '', label: 'day of the month' } : null);

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

  /* Bounds. `min` is inclusive by default. `max` is exclusive for the weather and
     clock triggers, which is what everything written against them relies on, and
     inclusive for the counting triggers, where "the first five days" plainly
     includes the fifth. A spawn restriction can also ask for a strict `min`,
     because "Precipitation > 0" has to mean *some* rain — an inclusive floor of 0
     would be true in perfect sunshine. */
  const inRange = value => {
    const inclusiveMax = clause.maxInc || INCLUSIVE_MAX_TRIGGERS.has(clause.trigger);
    const okMin = clause.min == null
      || (clause.minEx ? value > clause.min : value >= clause.min);
    const okMax = clause.max == null
      || (inclusiveMax ? value <= clause.max : value < clause.max);
    return okMin && okMax;
  };

  /** Shared shape for every "read a number, compare it to the bounds" trigger. */
  const numeric = (value, { label, unit, decimals = 0, missing }) => {
    if (value == null || !Number.isFinite(value)) {
      return { active: false, reason: missing || `${withArticle(label)} is unknown` };
    }
    const shown = `${decimals ? value.toFixed(decimals) : Math.round(value)}${unit}`;
    return { active: inRange(value), reason: `${withArticle(label)} is ${shown}` };
  };

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
    case 'wind':
    case 'precipitation': {
      const spec = ABILITY_WEATHER_TRIGGERS[clause.trigger];
      const value = weather?.[spec.field];
      // Decision: never guess. No reading means the clause simply does not fire.
      if (value == null || !Number.isFinite(value)) {
        return { active: false, reason: `${withArticle(spec.label)} is unavailable` };
      }
      // Rain is reported to a tenth of a millimetre, and rounding it to whole
      // millimetres would show "0 mm" during a real drizzle.
      const shown = clause.trigger === 'precipitation'
        ? `${value.toFixed(1)}${spec.unit}`
        : `${Math.round(value)}${spec.unit}`;
      return {
        active: inRange(value),
        reason: clause.trigger === 'temperature'
          ? `it is ${shown}`
          : `${withArticle(spec.label)} is ${shown}`
      };
    }
    case 'walked today':
    case 'grunts today':
    case 'raids today':
    case 'captures today':
    case 'shinies today': {
      const spec = DAILY_COUNTER_TRIGGERS[clause.trigger];
      // Same rule as the weather: without the figure the clause does not fire.
      return numeric(abilityDaily(ctx)[spec.field], {
        label: spec.label, unit: spec.unit,
        decimals: clause.trigger === 'walked today' ? 1 : 0
      });
    }
    case 'elevation':
    case 'battery':
    case 'points scanned': {
      const spec = WORLD_READING_TRIGGERS[clause.trigger];
      return numeric(abilityWorld(ctx)[spec.field], {
        label: spec.label, unit: spec.unit,
        // Worth naming the reason for battery: on iOS it is never knowable, and
        // "unknown" in the log is what tells the player why nothing happened.
        missing: clause.trigger === 'battery'
          ? 'the battery level cannot be read on this device'
          : `${spec.label} unknown`
      });
    }
    case 'own hp':
    case 'opposing hp':
    case 'opposing level': {
      const spec = BATTLE_READING_TRIGGERS[clause.trigger];
      return numeric(abilityBattle(ctx)[spec.field], {
        label: spec.label, unit: spec.unit,
        missing: `${spec.label} is not known outside a battle`
      });
    }
    case 'opposing held': {
      const held = abilityBattle(ctx).foeHeld;
      if (!opponent) return { active: false, reason: 'no opponent yet' };
      // "Any" means any held item at all; anything else names the item wanted.
      const wantAny = !list.length || has('Any') || has('Yes');
      const name = held ? (heldItem(held)?.name || held) : null;
      if (!held) return { active: false, reason: 'the opponent is carrying nothing' };
      return {
        active: wantAny || has(held) || (name && has(name)),
        reason: `the opponent is carrying a ${name}`
      };
    }
    case 'opposing buffed': {
      const buffs = abilityBattle(ctx).foeBuffs;
      if (!opponent) return { active: false, reason: 'no opponent yet' };
      if (!buffs) return { active: false, reason: 'not known outside a battle' };
      // Only a stat the opponent has raised counts. A stat it has had *lowered*
      // is the opposite situation and must not fire this.
      const raised = STAT_KEYS.filter(k => (Number(buffs[k]) || 0) > 0);
      const wanted = list.length
        ? STAT_KEYS.filter(k => has(k) || has(STAT_LABELS[k]))
        : STAT_KEYS;
      const hit = wanted.filter(k => raised.includes(k));
      return {
        active: hit.length > 0,
        reason: raised.length
          ? `the opponent has raised its ${raised.map(k => STAT_LABELS[k]).join(' and ')}`
          : 'the opponent has raised nothing'
      };
    }
    case 'last standing': {
      const alone = abilityBattle(ctx).lastStanding;
      if (alone == null) return { active: false, reason: 'not known outside a battle' };
      // The value says which way round the clause wants it, so one ability can
      // reward being alone and another reward not being.
      const wantAlone = !list.length || has('Yes') || has('True');
      return {
        active: wantAlone ? alone : !alone,
        reason: alone ? 'it is the last one standing' : 'it still has team mates'
      };
    }
    case 'team': {
      const mates = abilityBattle(ctx).teamMates;
      if (!mates) return { active: false, reason: 'the team is not known yet' };
      if (!list.length) return { active: false, reason: 'no team mates named' };
      const lower = mates.map(m => String(m).toLowerCase());
      // Every name listed has to be there. That covers both shapes the sheet
      // uses: one companion named, or a whole line-up that must be complete.
      const missing = list.filter(v => !lower.includes(String(v).toLowerCase()));
      return {
        active: missing.length === 0,
        reason: missing.length
          ? `the team is missing ${missing.join(' and ')}`
          : `the team has ${list.join(' and ')}`
      };
    }
    case 'moon': {
      const phase = moonPhase(now);
      return { active: has(phase), reason: `the moon is ${phase}` };
    }
    case 'day of month': {
      return numeric(now.getDate(), { label: 'the day of the month', unit: '' });
    }
    case ALWAYS_TRIGGER:
      // No condition to report, so the reason describes when the effect that
      // uses this trigger actually lands.
      return { active: true, reason: 'on being knocked out' };
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
    case 'daylight': {
      // Whether the sun is up where the player is, straight from the weather
      // reading. Same rule as every other reading: no data, no trigger.
      if (weather.isDay == null) return { active: false, reason: 'daylight unavailable' };
      const nowIs = weather.isDay ? 'Day' : 'Night';
      return {
        // Matched through the synonym table so a sheet saying "Daytime" works.
        active: list.some(v => daylightValue(v) === nowIs),
        reason: weather.isDay ? 'it is daytime' : 'it is night'
      };
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
    /**
     * Percentage of the opponent's remaining HP to deal when this creature is
     * knocked out, or 0 for the great majority of abilities. Kept apart from the
     * two multipliers because it is not a multiplier: it fires once, on a faint.
     */
    faintPercent: 0,
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
    // Several faint clauses would be odd authoring; the biggest one wins rather
    // than compounding into something unbounded.
    if (channel === 'faint') out.faintPercent = Math.max(out.faintPercent, clause.percent);
  }

  out.dealMultiplier = clampAbilityMultiplier(out.dealMultiplier);
  out.takeMultiplier = clampAbilityMultiplier(out.takeMultiplier);
  return out;
}

/**
 * Damage a parting shot should do: a share of what the opponent has left,
 * rounded like every other hit and never less than 1, so an opponent on 1 HP is
 * taken down with it.
 */
export function faintDamage(percent, opponentHp) {
  const pct = Number(percent) || 0;
  const hp = Math.max(0, Number(opponentHp) || 0);
  if (pct <= 0 || hp <= 0) return 0;
  return Math.max(1, Math.round(hp * pct / 100));
}

/** "deals 50% more damage" — the effect half of a clause, in words. */
export function clauseEffectText(clause) {
  const pct = clause.percent;
  switch (clause.effect) {
    case 'deal more': return `deals ${pct}% more damage`;
    case 'deal less': return `deals ${pct}% less damage`;
    case 'take more': return `takes ${pct}% more damage`;
    case 'take less': return `takes ${pct}% less damage`;
    case 'deal on faint':
      return `deals ${pct}% of the opponent's remaining HP as it faints`;
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
    case 'wind':
    case 'precipitation':
    case 'walked today':
    case 'grunts today':
    case 'raids today':
    case 'captures today':
    case 'shinies today':
    case 'elevation':
    case 'battery':
    case 'points scanned':
    case 'own hp':
    case 'opposing hp':
    case 'opposing level':
    case 'day of month': {
      const { unit, label } = numericTriggerSpec(clause.trigger);
      const what = withArticle(label);
      const n = v => `${v}${unit}`;
      const inclusiveMax = clause.maxInc || INCLUSIVE_MAX_TRIGGERS.has(clause.trigger);
      // "at full HP" rather than "HP is 100% or above", which invites the
      // question of how HP could ever be above its maximum.
      if (clause.trigger === 'opposing hp' && clause.min === 100 && clause.max == null) {
        return 'the opposing creature is at full HP';
      }
      if (clause.trigger === 'own hp' && clause.min === 100 && clause.max == null) {
        return 'it is at full HP';
      }
      if (clause.min != null && clause.max != null) {
        return `${what} is between ${n(clause.min)} and ${n(clause.max)}`;
      }
      if (clause.max != null) {
        return inclusiveMax
          ? `${what} is ${n(clause.max)} or below`
          : `${what} is below ${n(clause.max)}`;
      }
      if (clause.min != null) {
        return clause.minEx
          ? `${what} is over ${n(clause.min)}`
          : `${what} is ${n(clause.min)} or above`;
      }
      return `${what} is known`;
    }
    case 'time': {
      if (clause.min != null && clause.max != null) {
        return `the time is between ${hourLabel(clause.min)} and ${hourLabel(clause.max)}`;
      }
      if (clause.max != null) return `the time is before ${hourLabel(clause.max)}`;
      if (clause.min != null) return `the time is after ${hourLabel(clause.min)}`;
      return 'any time';
    }
    case 'daylight':
      return `it is ${join(list.map(v => (daylightValue(v) === 'Day' ? 'daytime' : 'night')))}`;
    case 'day': return `it is ${join(list)}`;
    case 'month': return `it is ${join(list)}`;
    case 'moon': return `the moon is ${join(list)}`;
    case 'opposing held':
      return list.length && !list.some(v => /^(any|yes)$/i.test(v))
        ? `the opposing creature is carrying ${join(list)}`
        : 'the opposing creature is carrying a held item';
    case 'opposing buffed': {
      const stats = list.length
        ? list.map(v => STAT_LABELS[String(v).toLowerCase()] || v)
        : STAT_KEYS.map(k => STAT_LABELS[k]);
      return `the opposing creature has raised its ${join(stats)}`;
    }
    case 'last standing':
      return list.some(v => /^(no|false)$/i.test(v))
        ? 'it still has team mates left'
        : 'it is the last creature standing';
    case 'team':
      // "and", not "or": every creature listed has to be there. The shared
      // `join` reads as "or", which would describe the opposite rule.
      if (!list.length) return 'the team matches';
      return list.length === 1
        ? `the team includes ${list[0]}`
        : `the rest of the team is ${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
    case ALWAYS_TRIGGER: return 'it faints';
    default: return 'an unknown condition';
  }
}

/** One clause as a sentence: "Deals 50% more damage if …". */
export const clauseText = clause =>
  `${clauseEffectText(clause).replace(/^./, ch => ch.toUpperCase())} if ${clauseConditionText(clause)}.`;

/* ---------------------------------------------------------------
   Spawn restrictions

   A creature in Temporal Rift can carry a `Spawn Restriction`: a condition that
   has to hold before it will spawn on the map, head a raid or hatch from an egg.
   Outside its window it is simply not in the pool.

   The conditions are written in the sheet in plain language — "Daylight =
   Night", "Temperature > 18", "Humidity > 75", "Day = Monday" — and are parsed
   into exactly the same clause shape abilities use, so there is one condition
   evaluator in the game rather than two that can drift apart.

   Everything is forgiving on the way in: an expression we cannot read is
   reported as a warning and the creature is left *unrestricted*, because a typo
   in a spreadsheet should make a creature slightly too easy to find rather than
   impossible.
   --------------------------------------------------------------- */

/** Triggers a Spawn Restriction may use, mapped from how the sheets write them. */
const RESTRICTION_TRIGGERS = {
  'daylight': 'daylight',
  'day': 'day',
  'month': 'month',
  'temperature': 'temperature',
  'temp': 'temperature',
  'cloud cover': 'cloud cover',
  'cloudcover': 'cloud cover',
  'clouds': 'cloud cover',
  'humidity': 'humidity',
  'wind': 'wind',
  'precipitation': 'precipitation',
  'rain': 'precipitation',
  'hour': 'time',
  'time': 'time',
  'walked today': 'walked today',
  'grunts today': 'grunts today'
};

/**
 * "9" and "5" in "Hour between 9 and 5" are opening hours, not a window that
 * wraps around midnight, so the smaller end is read as an afternoon time. Only
 * applied to a `between` on the clock, where a backwards range is otherwise
 * almost certainly a 12-hour-clock shorthand.
 */
function normaliseHourWindow(from, to) {
  if (from == null || to == null) return { min: from, max: to };
  return { min: from, max: to < from && to + 12 > from ? to + 12 : to };
}

/** Parses one side of a Spawn Restriction, e.g. "Temperature > 18". */
function parseRestrictionClause(text, where) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  const fail = why => { DB.warnings.push(`${where}: ${why} in "${raw}" — restriction ignored`); return null; };

  const m = raw.match(/^([A-Za-z][A-Za-z\s]*?)\s*(>=|<=|=|>|<|between)\s*(.+)$/i);
  if (!m) return fail('could not tell the condition from the value');

  const trigger = RESTRICTION_TRIGGERS[m[1].trim().toLowerCase()];
  if (!trigger) return fail(`"${m[1].trim()}" is not a condition we know`);
  const op = m[2].toLowerCase();
  const rest = m[3].trim();

  if (op === '=') {
    const values = splitList(rest);
    if (!values.length) return fail('nothing listed after the "="');
    if (!ABILITY_LIST_TRIGGERS.includes(trigger)) {
      return fail(`"${trigger}" needs a comparison such as > or <, not "="`);
    }
    if (trigger === 'daylight') {
      const bad = values.filter(v => !daylightValue(v));
      if (bad.length) return fail(`"${bad.join(', ')}" is not day or night`);
      return { trigger, values: values.map(daylightValue), min: null, max: null };
    }
    if (trigger === 'day') {
      const bad = values.filter(v =>
        !DAY_NAMES_LONG.some(d => d.toLowerCase() === v.toLowerCase()));
      if (bad.length) return fail(`"${bad.join(', ')}" is not a day of the week`);
    }
    if (trigger === 'month') {
      const bad = values.filter(v =>
        !MONTH_NAMES_LONG.some(d => d.toLowerCase() === v.toLowerCase()));
      if (bad.length) return fail(`"${bad.join(', ')}" is not a month`);
    }
    return { trigger, values, min: null, max: null };
  }

  if (!ABILITY_RANGE_TRIGGERS.includes(trigger)) {
    return fail(`"${trigger}" is a list condition, so it needs "=" and a value`);
  }

  if (op === 'between') {
    const ends = rest.split(/\s*(?:and|&|-|to)\s*/i).map(numOrNull).filter(v => v != null);
    if (ends.length !== 2) return fail('a "between" needs two numbers');
    const [lo, hi] = ends;
    const { min, max } = trigger === 'time'
      ? normaliseHourWindow(lo, hi)
      : { min: Math.min(lo, hi), max: Math.max(lo, hi) };
    // Inclusive at both ends: "between 9 and 5" plainly includes 5 o'clock.
    return { trigger, values: [], min, max, maxInc: true };
  }

  const n = numOrNull(rest);
  if (n == null) return fail(`"${rest}" is not a number`);
  switch (op) {
    // Strictly greater. This is the difference between "Precipitation > 0"
    // meaning "it is raining" and it meaning "always".
    case '>':  return { trigger, values: [], min: n, max: null, minEx: true };
    case '>=': return { trigger, values: [], min: n, max: null };
    case '<':  return { trigger, values: [], min: null, max: n };
    case '<=': return { trigger, values: [], min: null, max: n, maxInc: true };
    default:   return fail('unsupported comparison');
  }
}

/**
 * Parses a whole `Spawn Restriction` cell. Sides joined by `&` all have to hold
 * at once, which is how "Day = Monday … & Hour between 9 and 5" reads.
 *
 * @returns {{text:string, clauses:Array}|null} null when there is no restriction
 */
function parseSpawnRestriction(raw, name) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const where = `${name}: spawn restriction`;

  const clauses = [];
  for (const part of text.split('&')) {
    if (!part.trim()) continue;
    const clause = parseRestrictionClause(part, where);
    // One unreadable side would make the whole restriction a guess, so the
    // creature is left unrestricted rather than half-restricted.
    if (!clause) return null;
    clauses.push(clause);
  }
  if (!clauses.length) return null;
  return { text, clauses };
}

/**
 * The conditions spawn restrictions are judged against, pushed in from outside.
 *
 * data.js cannot read the weather or the save directly — state.js and weather.js
 * both sit above it — so the same "owner pushes it down" arrangement the unlocks
 * use applies here. Until something pushes a reading in, every weather-based and
 * counter-based restriction is simply unmet.
 */
let spawnConditions = { weather: null, daily: null, world: null };

/**
 * The last filtered pools, kept because a scan rolls many creatures in a row
 * against conditions that have not moved. Keyed on everything a restriction can
 * read, so it cannot go stale: change the weather, the hour, the day or a
 * counter and the key changes with it.
 */
let restrictedCache = { key: null, byRarity: null, list: null };

/** Replaces the conditions and drops the cached pools. Cheap to call often. */
export function setSpawnConditions({ weather = null, daily = null, world = null } = {}) {
  spawnConditions = { weather, daily, world };
  restrictedCache = { key: null, byRarity: null, list: null };
  return spawnConditions;
}

/** What a restriction is currently being judged against. Exposed for the UI. */
export const spawnConditionContext = (now = new Date()) => ({
  now,
  weather: spawnConditions.weather,
  daily: spawnConditions.daily,
  world: spawnConditions.world
});

/**
 * Is this creature allowed to appear right now? True for anything without a
 * restriction, which is every creature outside Temporal Rift.
 */
export function canSpawnNow(sp, now = new Date()) {
  const r = sp?.spawnRestriction;
  if (!r) return true;
  const ctx = spawnConditionContext(now);
  return r.clauses.every(c => evaluateClause(c, ctx).active);
}

/**
 * Why a restricted creature is or is not available, for the Collection sheet:
 * one line per condition with the reading behind it.
 */
export function spawnRestrictionState(sp, now = new Date()) {
  const r = sp?.spawnRestriction;
  if (!r) return null;
  const ctx = spawnConditionContext(now);
  const clauses = r.clauses.map(c => {
    const { active, reason } = evaluateClause(c, ctx);
    return { clause: c, active, reason, text: clauseConditionText(c) };
  });
  return { text: r.text, clauses, active: clauses.every(c => c.active) };
}

/** Every creature that only appears under some condition. */
export const restrictedSpecies = () => DB.species.filter(s => s.spawnRestriction);

/** The whole ability in words, using the authored text when there is one. */
export function abilityText(ability) {
  if (!ability) return '';
  if (ability.description) return ability.description;
  return ability.clauses.map(clauseText).join(' ');
}

/** True when any clause depends on who is standing opposite. */
export const abilityNeedsOpponent = ability =>
  !!ability?.clauses.some(c => ABILITY_OPPONENT_TRIGGERS.includes(c.trigger));

/**
 * True when any clause can only be judged once a battle is under way — how hurt
 * something is, who is left standing, what the opponent has buffed.
 *
 * The team picker uses this to say "may apply" instead of guessing.
 */
export const abilityNeedsBattle = ability =>
  !!ability?.clauses.some(c => ABILITY_IN_BATTLE_TRIGGERS.includes(c.trigger));

/** True when the ability does its work by fainting rather than by hitting. */
export const abilityFaintsToFire = ability =>
  !!ability?.clauses.some(c => ABILITY_EFFECTS[c.effect]?.channel === 'faint');

/**
 * Would this ability actually do anything in a battle that has not started yet?
 *
 * The clock and the weather are already known, and so is the opposing side — a
 * raid has one boss, a grunt brings three — so every clause can be judged up
 * front. Opponent clauses are checked against each creature the player could
 * meet, which is why the answer carries `against` out of `total`: an ability
 * that only fires against one of three is still worth taking, but it is not the
 * same as one that fires against all of them.
 *
 * @param {object|null} ability
 * @param {object} ctx
 * @param {object[]} [ctx.opponents] species the ability might face
 * @param {Date}     [ctx.now]
 * @param {object}   [ctx.weather]
 */
export function abilityOutlook(ability, ctx = {}) {
  const { opponents = [], now = new Date() } = ctx;
  const out = {
    ability: ability || null,
    has: !!ability,
    applies: false,
    against: 0,
    total: 0,
    needsOpponent: abilityNeedsOpponent(ability),
    /**
     * True when the answer genuinely cannot be known yet: the ability turns on
     * how hurt something is, who is left standing, or what the opponent has
     * buffed. The picker shows "may apply" rather than a confident no.
     */
    mayApply: abilityNeedsBattle(ability),
    /** True when the ability works by being knocked out rather than by hitting. */
    onFaint: abilityFaintsToFire(ability),
    detail: ''
  };
  if (!ability) return out;

  // With nothing known to fight, judge it on the world alone.
  const foes = opponents.length ? opponents : [null];
  out.total = foes.length;

  const reads = foes.map(op => evaluateAbility(ability, { ...ctx, opponent: op, now }));
  const hits = reads.filter(r => r.anyActive);
  out.against = hits.length;
  out.applies = hits.length > 0;

  // What fired, or — when nothing did — why not.
  const source = out.applies ? hits[0] : reads[0];
  const parts = out.applies
    ? source.clauses.filter(c => c.active).map(c => `${clauseEffectText(c.clause)} — ${c.reason}`)
    : source.clauses.map(c => `${clauseEffectText(c.clause)} needs ${clauseConditionText(c.clause)}`);
  out.detail = parts.join('; ');

  return out;
}

/** One line for a tooltip: what the ability will or will not do in this battle. */
export function abilityOutlookLabel(look) {
  if (!look?.has) return '';
  const name = look.ability.name;
  // Checked before `applies`, because a parting shot's condition is always true
  // and yet it only pays out on being knocked out.
  if (look.onFaint) {
    return `${name} — fires only when this creature is knocked out. ${look.detail}.`;
  }
  if (!look.applies && look.mayApply) {
    return `${name} — depends on how the battle goes, so it cannot be called yet. ${look.detail}.`;
  }
  if (!look.applies) return `${name} — will not apply in this battle. ${look.detail}.`;
  const scope = look.needsOpponent && look.total > 1 && look.against < look.total
    ? ` against ${look.against} of their ${look.total}`
    : '';
  return `${name} — applies in this battle${scope}: ${look.detail}.`;
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
  /** Halved from 25%: an incense was turning up more often than it felt worth. */
  rareIncenseChanceByRarity: { 4: 0.125, 5: 0.125 },
  always: { revive: 2 }   // every raid win, win or catch
};

/**
 * A Full Heal from a raid or a grunt win is a coin flip rather than a
 * certainty. Both use the same figure so the two never drift apart.
 */
export const WIN_FULL_HEAL_CHANCE = 0.5;
export const WIN_FULL_HEAL_ITEM = 'full_heal';

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
  /** Halved from 25%, along with every other incense drop in the game. */
  shinyIncenseChance: 0.125,
  shinyIncenseItem: 'shiny_incense',
  eggChance: 0.25,
  eggType: '15km'
};

export const GRUNT_REWARD = {
  dust: [70, 95],
  /**
   * Nothing is unconditional beyond the healing supplies below and the Full
   * Heal coin flip — see WIN_FULL_HEAL_CHANCE.
   */
  always: {},
  /**
   * At most one of these per win. Weights are out of 200 rather than 100 so the
   * halved 2.5% odds stay whole numbers: an Incense and a Stardust Magnet were
   * each 5% and are now each 2.5%, with the freed 5% going back to "nothing".
   */
  bonus: [
    { weight: 5,   item: 'incense' },
    { weight: 5,   item: 'stardust_magnet' },
    { weight: 190, item: null }
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
   Battle Frontier

   A building you pin to the map, holding one challenge per type. Each challenge
   is a ten-level ladder of trainer battles, and each level can be beaten once
   per *mode* — a restriction on the creatures you are allowed to bring. Fifteen
   modes times ten levels is a lot of fights out of one building, which is the
   point: the ladder is fixed, and the mode is what makes it hard.

   Clear all ten levels in one mode and the Grand Raid Challenge opens: a level
   11 in all but name, against a boss that exists nowhere else in the game. It
   is scored per mode, so the same boss can be won fifteen times over.
   --------------------------------------------------------------- */

/** Levels in every challenge. The Grand Raid sits one above the top. */
export const FRONTIER_LEVELS = 10;
export const FRONTIER_GRAND_LEVEL = FRONTIER_LEVELS + 1;
export const FRONTIER_GRAND_LABEL = 'Grand Raid Challenge';

/** The Grand Raid boss is always this level, whatever the mode or challenge. */
export const FRONTIER_RAID_LEVEL = 8;

/** Creatures a Frontier trainer brings, matching an ordinary battle. */
export const FRONTIER_TEAM_SIZE = 3;

/**
 * One challenge per type. `name` has to match the "Challenge name" column in
 * Battle Frontier.csv, and `trainer` the artwork shipped in `images/`.
 */
export const FRONTIER_CHALLENGES = [
  {
    id: 'mystic', name: 'Mystic', type: 'Mystic',
    trainer: 'challenge mystic.png', trainerName: 'Seer Vionne',
    phrase: 'I already know how this ends. Show me I am wrong.'
  },
  {
    id: 'celestial', name: 'Celestial', type: 'Celestial',
    trainer: 'challenge celestial.png', trainerName: 'Warden Lyrae',
    phrase: 'Every light in the sky is watching. Do not disappoint them.'
  },
  {
    id: 'neutral', name: 'Neutral', type: 'Neutral',
    trainer: 'challenge neutral.png', trainerName: 'Steward Bram',
    phrase: 'No tricks, no advantages. Just which of us trained harder.'
  },
  {
    id: 'wind', name: 'Wind', type: 'Wind',
    trainer: 'challenge wind.png', trainerName: 'Gale Rider Isa',
    phrase: 'If you can keep up with my team, you have earned the win.'
  },
  {
    id: 'mechanic', name: 'Mechanic', type: 'Mechanic',
    trainer: 'challenge mechanic.png', trainerName: 'Engineer Kovak',
    phrase: 'My machines do not get tired, and they do not get nervous.'
  }
];

export const frontierChallenge = id =>
  FRONTIER_CHALLENGES.find(c => c.id === id) || null;

/** The artwork path for a challenge's trainer. */
export const frontierTrainerImage = id => {
  const ch = frontierChallenge(id);
  return ch ? `${IMAGE_DIR}/${encodeURIComponent(ch.trainer)}` : '';
};

/**
 * The restrictions you can take a ladder on. `kind` is what gets checked:
 *
 *   'type'      — every creature must be this type
 *   'rarity'    — every creature must be this rarity, its family's if it has none
 *   'set'       — every creature must come from this set
 *   'exclusive' — every creature must be an Exclusive
 *   'any'       — bring whatever you like
 *
 * A mode is not required to be *possible*: "Only Rarity 1" at level 10 is meant
 * to be brutal, and "Only Exclusives" is meant to be a late-game bragging right.
 * The picker says how many creatures qualify rather than hiding the option.
 */
export const FRONTIER_MODES = [
  ...TYPES.map(type => ({
    id: `type_${type.toLowerCase()}`,
    label: `Only ${type}`,
    kind: 'type', value: type,
    blurb: `Every creature on your team must be ${type}.`
  })),
  ...[1, 2, 3, 4, 5].map(rarity => ({
    id: `rarity_${rarity}`,
    label: `Only Rarity ${rarity}`,
    kind: 'rarity', value: rarity,
    blurb: `Every creature on your team must be rarity ${rarity} (${RARITY_NAMES[rarity]}).`
  })),
  {
    id: 'set_elemental', label: `Only ${SET_NAME}`,
    kind: 'set', value: SET_NAME,
    blurb: `Every creature on your team must come from ${SET_NAME}.`
  },
  {
    id: 'set_galactic', label: `Only ${GALACTIC_SET_NAME}`,
    kind: 'set', value: GALACTIC_SET_NAME,
    blurb: `Every creature on your team must come from ${GALACTIC_SET_NAME}.`
  },
  {
    id: 'set_temporal', label: `Only ${TEMPORAL_SET_NAME}`,
    kind: 'set', value: TEMPORAL_SET_NAME,
    blurb: `Every creature on your team must come from ${TEMPORAL_SET_NAME}.`
  },
  {
    id: 'set_exclusive', label: 'Only Exclusives',
    kind: 'exclusive',
    blurb: 'Every creature on your team must be an Exclusive.'
  },
  {
    id: 'open', label: 'No restriction',
    kind: 'any',
    blurb: 'Bring any three creatures you like.'
  }
];

export const frontierMode = id => FRONTIER_MODES.find(m => m.id === id) || null;

/** Whether one stored creature is allowed in under this mode. */
export function frontierModeAllows(mode, creature) {
  const def = typeof mode === 'string' ? frontierMode(mode) : mode;
  if (!def) return false;
  const sp = species(creature?.speciesId);
  if (!sp) return false;
  switch (def.kind) {
    case 'any': return true;
    case 'type': return String(sp.type).toLowerCase() === String(def.value).toLowerCase();
    // A creature with no rarity of its own is judged by its family's, the same
    // way the Collection filter and the storage search judge it.
    case 'rarity': return (sp.rarity || familyRarity(sp.id) || 1) === Number(def.value);
    case 'set': return sp.set === def.value;
    case 'exclusive': return !!sp.exclusive;
    default: return false;
  }
}

/* ---------------------------------------------------------------
   What beating a level pays

   Three bands on top of a base every level hands over, exactly as specified.
   `heldItem` is rolled on the win rather than fixed here, so two players who
   clear level 7 do not walk away with the same trinket.
   --------------------------------------------------------------- */
export const FRONTIER_REWARD_BASE = {
  potion: 1, full_heal: 1, revive: 2, ultra_disc: 1, molten_seeker: 1
};

export const FRONTIER_REWARD_BANDS = [
  { fromLevel: 4, heldItem: true, items: {} },
  { fromLevel: 6, items: { stat_booster: 1 } },
  { fromLevel: 8, items: { strength_reroll: 1, mysterious_incense: 1 } }
];

/**
 * Everything one level win pays: `items` for the ordinary inventory, and
 * `heldItem` for "and one random held item on top".
 */
export function frontierLevelRewards(level) {
  const lvl = Number(level) || 0;
  const items = { ...FRONTIER_REWARD_BASE };
  let heldItem = false;
  for (const band of FRONTIER_REWARD_BANDS) {
    if (lvl < band.fromLevel) continue;
    if (band.heldItem) heldItem = true;
    for (const [id, n] of Object.entries(band.items || {})) {
      items[id] = (items[id] || 0) + n;
    }
  }
  return { items, heldItem };
}

/* ---------------------------------------------------------------
   The ladder itself, read from Battle Frontier.csv
   --------------------------------------------------------------- */

/**
 * "Attack: 10, Defence: 5, Speed: 5" -> { attack: 10, defence: 5, speed: 5 }.
 *
 * Capped at the player's own ceiling: a trainer is allowed exactly the twenty
 * points a Stat Booster user gets, so a typo in the sheet cannot hand one of
 * them a stat spread no player could ever match.
 */
export function parseFrontierBoosts(raw, where = 'Battle Frontier') {
  const out = emptyBoosts();
  const text = String(raw ?? '').trim();
  if (!text) return out;
  for (const part of text.split(/[,;]/)) {
    const bit = part.trim();
    if (!bit) continue;
    const m = bit.match(/^([A-Za-z ]+)\s*[:=]\s*(-?\d+)$/);
    if (!m) {
      DB.warnings.push(`${where}: cannot read stat boost "${bit}" — ignored`);
      continue;
    }
    const key = normaliseStatKey(m[1]);
    const n = Number(m[2]);
    if (!key) {
      DB.warnings.push(`${where}: "${m[1].trim()}" is not a stat — boost ignored`);
      continue;
    }
    if (!(n > 0)) continue;
    out[key] += n;
  }
  const total = totalBoosts(out);
  if (total > MAX_STAT_BOOSTS) {
    DB.warnings.push(
      `${where}: stat boosts add up to ${total}, above the ${MAX_STAT_BOOSTS} a player can reach — scaled back`);
    /* Scaled proportionally rather than trimmed off the top, so a sheet asking
       for twice the budget still gets the build it described. Flooring can leave
       a few points spare, which go to the biggest stats in turn. */
    const scale = MAX_STAT_BOOSTS / total;
    for (const k of STAT_KEYS) out[k] = Math.floor(out[k] * scale);
    const byBiggest = [...STAT_KEYS].sort((a, b) => out[b] - out[a]);
    let spare = MAX_STAT_BOOSTS - totalBoosts(out);
    for (let i = 0; spare > 0; i = (i + 1) % byBiggest.length, spare--) {
      out[byBiggest[i]]++;
    }
  }
  return out;
}

/** "Defense", "defence", "HP" -> a STAT_KEYS entry, or null. */
function normaliseStatKey(raw) {
  const low = String(raw ?? '').trim().toLowerCase();
  if (low === 'defense') return 'defence';
  return STAT_KEYS.includes(low) ? low : null;
}

/**
 * A held item written in the sheet, by display name or by id. Names are what
 * the generated file uses because they are what a person would type.
 */
export function resolveHeldItemName(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  if (isHeldItem(text)) return text;
  const low = text.toLowerCase();
  for (const def of Object.values(HELD_ITEMS)) {
    if (def.name.toLowerCase() === low) return def.id;
  }
  const underscored = low.replace(/\s+/g, '_');
  return isHeldItem(underscored) ? underscored : null;
}

/**
 * Reads Battle Frontier.csv into DB.frontier: challenge id -> level -> team.
 *
 * A row whose creatures cannot be resolved is dropped with a warning rather
 * than half-loaded, because a trainer with two creatures would quietly be an
 * easier fight than the sheet intends.
 */
function loadFrontierLadder(rows) {
  DB.frontier = new Map();
  for (const ch of FRONTIER_CHALLENGES) DB.frontier.set(ch.id, new Map());

  for (const r of rows) {
    const name = (r['challenge name'] || '').trim();
    const ch = FRONTIER_CHALLENGES.find(c =>
      c.name.toLowerCase() === name.toLowerCase() || c.id === name.toLowerCase());
    if (!ch) {
      if (name) DB.warnings.push(`Battle Frontier: unknown challenge "${name}" — row skipped`);
      continue;
    }
    const level = int(r['challenge level']);
    if (!level || level < 1 || level > FRONTIER_LEVELS) {
      DB.warnings.push(`Battle Frontier ${ch.name}: level "${r['challenge level']}" is not 1-${FRONTIER_LEVELS} — row skipped`);
      continue;
    }
    const where = `Battle Frontier ${ch.name} level ${level}`;

    const team = [];
    for (let i = 1; i <= FRONTIER_TEAM_SIZE; i++) {
      const rawId = (r[`creature ${i} id`] || '').trim().replace(/\.png$/i, '');
      const rawName = (r[`creature ${i} name`] || '').trim();
      const sp = (rawId && DB.byId.get(rawId))
        || (rawName && DB.byName.get(rawName.toLowerCase()))
        || null;
      if (!sp) {
        DB.warnings.push(`${where}: no creature matches "${rawId || rawName}"`);
        continue;
      }
      if (rawName && sp.name.toLowerCase() !== rawName.toLowerCase()) {
        DB.warnings.push(`${where}: id "${rawId}" is ${sp.name}, not "${rawName}" — going by the id`);
      }
      const cLevel = Math.min(MAX_CREATURE_LEVEL,
        Math.max(1, int(r[`creature ${i} level`]) || 1));
      const held = resolveHeldItemName(r[`creature ${i} held item`]);
      if (!held && (r[`creature ${i} held item`] || '').trim()) {
        DB.warnings.push(`${where}: "${r[`creature ${i} held item`]}" is not a held item — ignored`);
      }
      team.push({
        speciesId: sp.id,
        name: sp.name,
        level: cLevel,
        held,
        boosts: parseFrontierBoosts(r[`creature ${i} stat boosts`], where)
      });
    }

    if (team.length !== FRONTIER_TEAM_SIZE) {
      DB.warnings.push(`${where}: only ${team.length} of ${FRONTIER_TEAM_SIZE} creatures resolved — level skipped`);
      continue;
    }
    if (DB.frontier.get(ch.id).has(level)) {
      DB.warnings.push(`${where}: listed twice — keeping the first`);
      continue;
    }
    DB.frontier.get(ch.id).set(level, team);
  }
}

/** The trainer's team for one challenge level, or null if the sheet lacks it. */
export function frontierTeam(challengeId, level) {
  const team = DB.frontier?.get(challengeId)?.get(Number(level));
  // Handed out as copies: a battle should never be able to write back into the
  // loaded sheet and change the ladder for the next attempt.
  return team ? team.map(t => ({ ...t, boosts: { ...t.boosts } })) : null;
}

/** How many of the ten levels this challenge actually has creatures for. */
export const frontierLevelsLoaded = challengeId =>
  DB.frontier?.get(challengeId)?.size || 0;

/** True once the ladder has enough of the sheet to be playable. */
export const frontierReady = () =>
  FRONTIER_CHALLENGES.some(ch => frontierLevelsLoaded(ch.id) > 0);

/* ---------------------------------------------------------------
   Grand Raid Challenge bosses

   One per challenge, from Exclusives3.csv. Matched on type first, so the Mystic
   ladder ends against the Mystic boss whatever order the file is written in,
   with the file's own order as the fallback when the types do not line up.
   --------------------------------------------------------------- */
export function rebuildFrontierBosses() {
  DB.frontierBossByChallenge = new Map();
  const pool = DB.exclusive.filter(s => s.frontier);
  if (!pool.length) return 0;

  const taken = new Set();
  // Pass one: the boss whose own type is the challenge's type.
  for (const ch of FRONTIER_CHALLENGES) {
    const hit = pool.find(sp =>
      !taken.has(sp.id) && String(sp.type).toLowerCase() === ch.type.toLowerCase());
    if (hit) {
      taken.add(hit.id);
      DB.frontierBossByChallenge.set(ch.id, hit.id);
    }
  }
  /* Pass two: anything still unclaimed, in file order, for challenges that did
     not find a type match. This only happens when the file is short or a Type
     cell is wrong, and pairing a Mystic ladder with a Wind boss is exactly the
     sort of thing that should be said out loud rather than shipped quietly. */
  const spare = pool.filter(sp => !taken.has(sp.id));
  for (const ch of FRONTIER_CHALLENGES) {
    if (DB.frontierBossByChallenge.has(ch.id)) continue;
    const next = spare.shift();
    if (!next) {
      DB.warnings.push(
        `Battle Frontier: no Grand Raid boss for the ${ch.name} challenge — `
        + `Exclusives3.csv has no ${ch.type} creature and none spare`);
      continue;
    }
    DB.warnings.push(
      `Battle Frontier: no ${ch.type} creature in Exclusives3.csv, so the ${ch.name} `
      + `challenge falls back to ${next.name} (${next.type})`);
    DB.frontierBossByChallenge.set(ch.id, next.id);
  }
  return DB.frontierBossByChallenge.size;
}

/** The Grand Raid boss species for a challenge, or null if the file is absent. */
export const frontierBoss = challengeId =>
  species(DB.frontierBossByChallenge?.get(challengeId)) || null;

/**
 * The Grand Raid, in the shape the raid machinery already understands: an
 * exclusive raid at a fixed level, so it gets the tougher boss modifiers, raid
 * shiny odds and the Ultra Disc catch without any of that code changing.
 */
export function frontierGrandRaid(challengeId) {
  const sp = frontierBoss(challengeId);
  if (!sp) return null;
  const rarity = sp.rarity >= 3 && sp.rarity <= 5 ? sp.rarity : 5;
  const tier = RAID_TIERS[rarity];
  return {
    speciesId: sp.id,
    rarity,
    exclusive: true,
    frontier: challengeId,
    level: FRONTIER_RAID_LEVEL,
    xp: tier.xp,
    dustRange: tier.dust
  };
}

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

/* ---------------------------------------------------------------
   Mysterious Incense

   You choose the creature before it is lit, and every single spawn is that
   creature. The trade is time: the rarer the creature you pick, the shorter it
   burns, so a Legendary run is four minutes and two spawns rather than half an
   hour. Spawn rhythm and spawn lifetime are the ordinary incense ones.

   Only a creature you have already registered can be chosen, only Stage 1
   forms, and never an Exclusive or a Mythical — those have exactly one route
   each by design, and a repeatable incense would be a way around it.
   --------------------------------------------------------------- */
export const MYSTERIOUS_INCENSE_ITEM = 'mysterious_incense';

/** How long it burns, by the rarity of the chosen creature. */
export const MYSTERIOUS_INCENSE_DURATION_MS = {
  1: 30 * 60_000,
  2: 20 * 60_000,
  3: 12 * 60_000,
  4: 8 * 60_000,
  5: 4 * 60_000
};

/** Falls back to the Common duration for anything with no rarity of its own. */
export const mysteriousIncenseDurationMs = rarity =>
  MYSTERIOUS_INCENSE_DURATION_MS[rarity] ?? MYSTERIOUS_INCENSE_DURATION_MS[1];

/** How many spawns one run is worth, for the info screen. */
export const mysteriousIncenseSpawns = rarity =>
  Math.floor(mysteriousIncenseDurationMs(rarity) / RULES.INCENSE_EVERY_MS);

/** Chance of one dropping from a grunt win. Halved, like every incense drop. */
export const MYSTERIOUS_INCENSE_GRUNT_CHANCE = 0.005;

/** Chance of one dropping from a raid win, by boss rarity. Halved throughout. */
export const MYSTERIOUS_INCENSE_RAID_CHANCE = {
  1: 0.005, 2: 0.005, 3: 0.01, 4: 0.015, 5: 0.02
};

export const mysteriousIncenseRaidChance = rarity =>
  MYSTERIOUS_INCENSE_RAID_CHANCE[rarity] ?? MYSTERIOUS_INCENSE_RAID_CHANCE[1];

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

/** Raid Invasion: Wednesdays 18:00–19:00. */
export const RAID_INVASION_LABEL = 'Raid Invasion';
export const RAID_INVASION_DAY = 3;        // 0 = Sunday, so 3 = Wednesday
export const RAID_INVASION_START = 18;     // 18:00
export const RAID_INVASION_END = 19;       // 19:00
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
   Galactic Adventures Take Over: Thursdays 18:00–19:00.

   The odds of meeting anything are untouched — what changes is *which*
   creatures are behind them. For the hour, wild spawns, incense spawns, normal
   raids and ordinary eggs all draw from the unlocked Galactic Adventures
   creatures alone, and the Elemental Awakening pool is out of play entirely.

   Exclusive Raids and the 15 km and 50 km eggs are unaffected: they read their
   own pools, and taking them over would make the only route to those creatures
   vanish for an hour. It also does nothing at all until at least one Galactic
   rarity has been unlocked, since there would be nothing to spawn.
   --------------------------------------------------------------- */
export const GALACTIC_TAKEOVER_LABEL = 'Galactic Adventures Take Over';
export const GALACTIC_TAKEOVER_DAY = 4;      // Thursday
export const GALACTIC_TAKEOVER_START = 18;   // 18:00
export const GALACTIC_TAKEOVER_END = 19;     // 19:00

/* ---------------------------------------------------------------
   Annual events

   Nine events that come round once a year. Unlike the weekly ones these run for
   whole days rather than an hour, so they are defined by a *date window* rather
   than a day-and-hour, and they all share one table: everything that varies
   between them — what spawns, what the bonuses are — is data on the entry, not
   another predicate somewhere else.

   Most of them hand out one creature an hour, on the player's own position,
   lasting half an hour. Where those creatures come from is the only real
   difference between them:

     • Halloween and Thanksgiving draw from a hand-written list in their own CSV.
     • The Holiday event draws from everything you could normally catch.
     • The five awareness days each draw from a single type.

   All of them use the same flattened rarity odds, which are much kinder to the
   rare end than an ordinary spawn: a Legendary is 15% here against 1% in the
   wild. That is the point of them.
   --------------------------------------------------------------- */

/** How long an event creature waits on your position. */
export const EVENT_SPAWN_MS = 30 * 60_000;

/**
 * Rarity odds for an event spawn. Deliberately flat compared with
 * RARITY_WEIGHTS — these are a once-an-hour treat, not the everyday pool.
 */
export const EVENT_SPAWN_WEIGHTS = { 1: 15, 2: 20, 3: 30, 4: 20, 5: 15 };

/** Local midnight on `y-m-d`. Month is 0-based, matching Date. */
const localDay = (y, m, d) => new Date(y, m, d);

/**
 * Easter Sunday for a Gregorian year, by the Meeus/Jones/Butcher algorithm.
 *
 * Worked out rather than tabulated so the events keep working for every future
 * year without anyone having to maintain a list. Returns local midnight.
 */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);   // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return localDay(year, month - 1, day);
}

/**
 * The `n`th `weekday` of a month, e.g. the 4th Thursday of November.
 * `weekday` is 0 = Sunday, matching Date.getDay().
 */
export function nthWeekdayOfMonth(year, month, weekday, n) {
  const first = localDay(year, month, 1);
  const shift = (weekday - first.getDay() + 7) % 7;
  return localDay(year, month, 1 + shift + (n - 1) * 7);
}

/** Local midnight, so two dates can be compared as calendar days. */
const atMidnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Is `day` within [from, to], counting whole days at both ends? */
const dayWithin = (day, from, to) =>
  atMidnight(day) >= atMidnight(from) && atMidnight(day) <= atMidnight(to);

/**
 * A window of `days` days that starts on a fixed date every year.
 * Returns a predicate for the calendar table, which is given local midnight.
 */
const annualWindow = (month, date, days) => day => {
  const from = localDay(day.getFullYear(), month, date);
  const to = localDay(day.getFullYear(), month, date + days - 1);
  return dayWithin(day, from, to);
};

/** Good Friday to Easter Sunday: three days, moving with Easter every year. */
export function easterWindow(year) {
  const sunday = easterSunday(year);
  const friday = new Date(sunday);
  friday.setDate(friday.getDate() - 2);
  return { from: friday, to: sunday };
}

/**
 * The Tuesday, Wednesday and Thursday of US Thanksgiving week.
 *
 * Anchored on the 4th Thursday and counted back two days, rather than looking up
 * "the 4th Tuesday": in a year where November starts on a Thursday the 4th
 * Tuesday falls *after* the 4th Thursday, so the two do not always describe the
 * same week.
 */
export function thanksgivingWindow(year) {
  const thursday = nthWeekdayOfMonth(year, 10, 4, 4);   // November, Thursday, 4th
  const tuesday = new Date(thursday);
  tuesday.setDate(tuesday.getDate() - 2);
  return { from: tuesday, to: thursday };
}

/**
 * Every annual event, in calendar order.
 *
 * `onDay` is handed local midnight and must only look at the calendar. The rest
 * of the fields describe what the event *does*, and are read by the spawn loop,
 * the reward paths and the missions — none of which needs to know which event it
 * is looking at.
 *
 * Behaviour fields, all optional:
 *   hourlySpawn  {type} | {list} | {any}  where the once-an-hour creature comes from
 *   catchBonus   {candy, stardust}        added to catches and raid catches
 *   hatchBonus   {candy, stardust}        added to egg hatches
 *   halveEggs    true                     eggs incubated now need half the distance
 *   dailyMission missionId                a daily mission that only exists now
 */
export const ANNUAL_EVENTS = [
  {
    id: 'easter',
    label: 'Easter Egg Hunt',
    icon: '🐣',
    onDay: day => {
      const { from, to } = easterWindow(day.getFullYear());
      return dayWithin(day, from, to);
    },
    halveEggs: true,
    hatchBonus: { candy: 3, stardust: 20 },
    blurb: 'Eggs you start now need half the distance, and every hatch pays +3 candy and +20 stardust.'
  },
  {
    id: 'labourDay',
    label: 'Labour Day',
    icon: '🔧',
    onDay: annualWindow(4, 1, 3),           // 1–3 May
    hourlySpawn: { type: 'Mechanic' },
    blurb: 'A Mechanic creature comes to you every hour, with far better odds of a rare one.'
  },
  {
    id: 'environmentDay',
    label: 'World Environment Day',
    icon: '🌱',
    onDay: annualWindow(5, 5, 3),           // 5–7 June
    hourlySpawn: { type: 'Celestial' },
    blurb: 'A Celestial creature comes to you every hour, with far better odds of a rare one.'
  },
  {
    id: 'seabirdDay',
    label: 'World Seabird Day',
    icon: '🐦',
    onDay: annualWindow(6, 3, 3),           // 3–5 July
    hourlySpawn: { type: 'Wind' },
    blurb: 'A Wind creature comes to you every hour, with far better odds of a rare one.'
  },
  {
    id: 'humanitarianDay',
    label: 'World Humanitarian Day',
    icon: '🕊',
    onDay: annualWindow(7, 19, 3),          // 19–21 August
    hourlySpawn: { type: 'Mystic' },
    blurb: 'A Mystic creature comes to you every hour, with far better odds of a rare one.'
  },
  {
    id: 'peaceDay',
    label: 'International Day of Peace',
    icon: '☮',
    onDay: annualWindow(8, 21, 3),          // 21–23 September
    hourlySpawn: { type: 'Neutral' },
    blurb: 'A Neutral creature comes to you every hour, with far better odds of a rare one.'
  },
  {
    id: 'halloween',
    label: 'Halloween',
    icon: '🎃',
    onDay: annualWindow(9, 29, 3),          // 29–31 October
    hourlySpawn: { list: 'halloween' },
    catchBonus: { candy: 3 },
    hatchBonus: { candy: 3 },
    blurb: 'Every catch, raid catch and hatch pays +3 candy, and a costumed creature comes to you every hour.'
  },
  {
    id: 'thanksgiving',
    label: 'Thanksgiving',
    icon: '🦃',
    onDay: day => {
      const { from, to } = thanksgivingWindow(day.getFullYear());
      return dayWithin(day, from, to);
    },
    hourlySpawn: { list: 'thanksgiving' },
    blurb: 'A creature comes to you every hour, from Tuesday to Thanksgiving Thursday.'
  },
  {
    id: 'holiday',
    label: 'Holiday Season',
    icon: '🎁',
    // The only window that crosses a year boundary, so it is written as two
    // pieces rather than a range.
    onDay: day => (day.getMonth() === 11 && day.getDate() >= 20)
      || (day.getMonth() === 0 && day.getDate() === 1),
    hourlySpawn: { any: true },
    catchBonus: { candy: 1, stardust: 15 },
    hatchBonus: { candy: 1, stardust: 15 },
    dailyMission: 'holidayLogin',
    blurb: 'Every catch, raid catch and hatch pays +1 candy and +15 stardust, a creature comes to you '
      + 'every hour, and there is a daily gift for logging in.'
  }
];

export const annualEvent = id => ANNUAL_EVENTS.find(e => e.id === id) || null;

/** Every annual event running on the day `now` falls in. */
export function activeAnnualEvents(now = new Date()) {
  const day = atMidnight(now);
  return ANNUAL_EVENTS.filter(e => e.onDay(day));
}

/** True when this particular event is running. */
export const isAnnualEvent = (id, now = new Date()) =>
  activeAnnualEvents(now).some(e => e.id === id);

/**
 * The flat bonuses owed on a reward right now, totalled across every running
 * event so two overlapping ones could never silently cancel out.
 *
 * `kind` is 'catch' for a capture or raid catch, 'hatch' for an egg.
 */
export function eventRewardBonus(kind, now = new Date()) {
  const field = kind === 'hatch' ? 'hatchBonus' : 'catchBonus';
  let candy = 0, stardust = 0;
  const from = [];
  for (const e of activeAnnualEvents(now)) {
    const b = e[field];
    if (!b) continue;
    candy += b.candy || 0;
    stardust += b.stardust || 0;
    from.push(e.label);
  }
  return { candy, stardust, from };
}

/** True while eggs put into an incubator should need only half the distance. */
export const eggsAreHalved = (now = new Date()) =>
  activeAnnualEvents(now).some(e => e.halveEggs);

/** The running event that hands out an hourly creature, or null. */
export const hourlySpawnEvent = (now = new Date()) =>
  activeAnnualEvents(now).find(e => e.hourlySpawn) || null;

/* ---------------------------------------------------------------
   Essence Harvesting

   A creature you have already registered turns up somewhere in the scan radius
   once per two-hour block. Tapping it opens a small game of accuracy that pays
   candy for that creature's family — no capture, no disc, no range limit.
   --------------------------------------------------------------- */

/** Blocks are 00:00–02:00, 02:00–04:00 and so on: twelve a day. */
export const ESSENCE_WINDOW_HOURS = 2;

/** Nothing spawns before this player level. */
export const ESSENCE_MIN_LEVEL = 2;

/** How long the harvest point sits on the map. */
export const ESSENCE_SPAWN_MS = 30 * 60_000;

/** Chance of a Molten Seeker on top, but only if at least one candy was won. */
export const ESSENCE_SEEKER_CHANCE = 0.15;

/**
 * Attempts allowed, by how far away the creature is when you open it. Walking
 * closer is worth it, but you can always play from wherever you are.
 * Read as "more than `over` metres away", first match wins.
 */
export const ESSENCE_PIN_BANDS = [
  { over: 125, pins: 1 },
  { over: 100, pins: 2 },
  { over: 75,  pins: 3 },
  { over: 50,  pins: 4 },
  { over: 25,  pins: 5 },
  { over: -1,  pins: 6 }
];

export const ESSENCE_MAX_PINS = 6;

export function essencePinsFor(metres) {
  const d = Number(metres);
  if (!isFinite(d)) return 1;
  return (ESSENCE_PIN_BANDS.find(b => d > b.over) || { pins: 1 }).pins;
}

/** Candy for hitting each ring, innermost first. */
export const ESSENCE_RING_CANDY = { inner: 3, mid: 2, outer: 1 };

/** Ring radii in px for a rarity 1 creature: the easiest target in the game. */
export const ESSENCE_RINGS = { outer: 78, mid: 50, inner: 24 };

/**
 * How much of the rarity 1 target each rarity draws. Spelled out per rarity
 * rather than derived, because the two ends are deliberate: a Common gets the
 * full-size rings and a Legendary gets half of what a Common does.
 */
export const ESSENCE_RING_SCALE = { 1: 1, 2: 0.84, 3: 0.68, 4: 0.52, 5: 0.36 };

/** The creature's picture at rarity 1. Shrinks with the rings so it never hides them. */
export const ESSENCE_ART_PX = 44;

/**
 * Drift speed in px per second for rarity 1, and what each rarity multiplies it
 * by. Flat multiples of the base so the jump is easy to reason about: an
 * Uncommon is twice a Common, a Legendary five times.
 */
export const ESSENCE_SPEED_PX = 46;
export const ESSENCE_SPEED_MULTIPLIER = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 };

/**
 * The highest rarity that can leave an essence. Mythicals are shut out — one
 * exists, it comes from a single 50 km egg, and its candy is not something a
 * two-hourly mini-game should be handing over.
 */
export const ESSENCE_MAX_RARITY = 5;

/** Whether this creature can leave an essence at all. */
export const essenceEligible = sp =>
  !!sp && !sp.mythical && (sp.rarity || familyRarity(sp.id) || 1) <= ESSENCE_MAX_RARITY;

/**
 * How hard one essence is: tighter rings and a quicker drift as rarity climbs.
 * Rarity is clamped to the eligible range, so nothing can ask for a game
 * harder than a Legendary's even if a stale save points at one.
 */
export function essenceDifficulty(rarity = 1) {
  const asked = Number(rarity) || 1;
  const capped = Math.min(Math.max(asked, 1), ESSENCE_MAX_RARITY);
  const scale = ESSENCE_RING_SCALE[capped] ?? 1;
  const multiple = ESSENCE_SPEED_MULTIPLIER[capped] ?? capped;
  return {
    rarity: capped,
    scale,
    multiple,
    rings: {
      outer: Math.round(ESSENCE_RINGS.outer * scale),
      mid: Math.round(ESSENCE_RINGS.mid * scale),
      inner: Math.round(ESSENCE_RINGS.inner * scale)
    },
    // The picture rides along with the rings, or at a Legendary's size it would
    // cover the target it is supposed to be sitting inside.
    artPx: Math.round(ESSENCE_ART_PX * scale),
    speed: ESSENCE_SPEED_PX * multiple
  };
}

/** Which ring a tap `dist` px from the centre landed in, or null for a miss. */
export function essenceRingHit(dist, rings) {
  if (dist <= rings.inner) return 'inner';
  if (dist <= rings.mid) return 'mid';
  if (dist <= rings.outer) return 'outer';
  return null;
}

/* ---------------------------------------------------------------
   Creature Spotlight: Mondays 18:00–19:00.

   Unlike the two above this does NOT rewrite the POI odds table. It leaves
   every outcome alone and only biases *which* creature a creature-point turns
   into, so it needs no table of its own.
   --------------------------------------------------------------- */
export const SPOTLIGHT_LABEL = 'Creature Spotlight';
export const SPOTLIGHT_DAY = 1;            // Monday
export const SPOTLIGHT_START = 18;         // 18:00
export const SPOTLIGHT_END = 19;           // 19:00

/** Which creature is featured each week, from the spotlight CSV. */
export const SPOTLIGHT_CSV_FILE = 'Creature Spotlight List.csv';

/**
 * When the drawn rarity matches the spotlight creature's rarity, this is the
 * chance the spawn becomes the spotlight creature rather than a normal pick
 * from that tier. A different rarity is left completely alone.
 */
export const SPOTLIGHT_SUBSTITUTE_CHANCE = 0.50;

/** Extra candy for capturing the spotlight creature during its hour. */
export const SPOTLIGHT_BONUS_CANDY = 2;

/** How long a spotlight spawn that comes to you sticks around. */
export const SPOTLIGHT_SPAWN_MS = 5 * 60_000;

/**
 * Minutes after the start of the hour at which a guaranteed spotlight spawn
 * appears on the player's own position. Rarer creatures come round less often,
 * and every pattern divides the hour exactly.
 */
export const SPOTLIGHT_SPAWN_OFFSETS = {
  1: [0, 10, 20, 30, 40, 50],
  2: [0, 15, 30, 45],
  3: [0, 20, 40],
  4: [0, 20, 40],
  5: [0, 30]
};

/** The offsets for one rarity, falling back to the rarity 3/4 rhythm. */
export const spotlightOffsetsFor = rarity =>
  SPOTLIGHT_SPAWN_OFFSETS[rarity] || SPOTLIGHT_SPAWN_OFFSETS[3];

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
  },
  /**
   * Chromarion's egg — the promised "own egg entry" for the second mythical,
   * rather than a second creature added to the pool of the first. Identical to
   * Astralyon's in every number; only the creature inside differs, which is why
   * it carries a `label` of its own. Two eggs both reading "50 km egg" in the
   * list would be impossible to tell apart.
   */
  '50km-chromarion': {
    id: '50km-chromarion', km: 50, dust: 500, xp: 100, image: '50km_egg.png', bonusCandy: 25,
    label: 'Chromarion 50 km egg',
    mythical: true,
    speciesId: MYTHICAL_CHROMARION_ID,
    noShiny: true,
    ignoresStorageLimit: true
  }
};

/** The egg type Exclusive Raids drop. */
export const EXCLUSIVE_EGG_TYPE = '15km';
/** The egg the last Galactic Adventures Set mission hands over. */
export const MYTHICAL_EGG_TYPE = '50km';
/** The egg the last Temporal Rift Set mission hands over. */
export const CHROMARION_EGG_TYPE = '50km-chromarion';

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
/** A name for the egg. Distances are not unique, so a def may override it. */
export const eggLabel = type => eggDef(type).label || `${eggDef(type).km} km egg`;
export const eggMetres = type => eggDef(type).km * 1000;

/** What an Easter incubation takes off the distance, on top of the incubator. */
export const EASTER_EGG_MULTIPLIER = 0.5;

/**
 * The distance this egg actually needs, given the incubator it is sitting in and
 * whether it was started during Easter.
 *
 * A Super Incubator takes 25% off, so a 10 km egg hatches after 7.5 km. Easter
 * then halves whatever is left, which is why the two are applied in this order: a
 * 15 km egg in a Super Incubator comes to 15 × 0.75 × 0.5 = 5.625 km.
 *
 * `halved` is a property of the *egg*, stamped on when it went into the
 * incubator, not a question about today. The event lasts three days and a 15 km
 * egg does not, so an egg started during Easter has to keep its discount after
 * the event has ended — otherwise the requirement would jump back up mid-walk.
 */
export const eggMetresFor = (type, incubatorId = null, halved = false) =>
  Math.round(eggMetres(type)
    * (1 - incubatorDiscount(incubatorId))
    * (halved ? EASTER_EGG_MULTIPLIER : 1));
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
  { id: 'shop_magnet',     item: 'stardust_magnet',      qty: 1, coins: 3, limit: 1 },
  /* The three special incenses. Deliberately the most expensive things on the
     shelf and one a day each: they are meant to be a considered purchase after
     a run of ads, not something you stock up on. */
  { id: 'shop_rare_incense',      item: 'rare_incense',       qty: 1, coins: 10, limit: 1 },
  { id: 'shop_shiny_incense',     item: 'shiny_incense',      qty: 1, coins: 50, limit: 1 },
  { id: 'shop_mysterious_incense', item: 'mysterious_incense', qty: 1, coins: 50, limit: 1 }
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
   Held items

   A creature can carry exactly one held item. Some are gated on the creature's
   type, its stage or its level, so most items only suit part of the roster.
   Stat bonuses are flat and applied after level growth, the same way a Stat
   Booster is, so "+10 Attack" reads as exactly +10 on the sheet.

   Two are consumables: they are spent by the thing they help with rather than
   handed back, so they cannot be taken off a creature once given.
   --------------------------------------------------------------- */

export const HELD_ITEM_DIR = 'held items';

/** One per type, three flavours: the bulk of the list. */
const TYPE_TRINKETS = [
  { suffix: 'gem',    label: 'Gem',    stat: 'attack',  amount: 10, order: 20 },
  { suffix: 'shield', label: 'Shield', stat: 'defence', amount: 10, order: 30 },
  { suffix: 'cog',    label: 'Cog',    stat: 'speed',   amount: 10, order: 40 }
];

function buildHeldItems() {
  const out = {};
  const add = def => { out[def.id] = def; };

  add({
    id: 'miracle_coin', name: 'Miracle Coin', image: 'miracle_coin.png', order: 10,
    effect: 'survive',
    blurb: 'At full health, an attack that would knock this creature out leaves it on 1 HP instead. '
      + 'Once it has taken any damage at all it can be knocked out like anything else.'
  });

  for (const t of TYPE_TRINKETS) {
    for (const type of TYPES) {
      add({
        id: `${type.toLowerCase()}_${t.suffix}`,
        name: `${type} ${t.label}`,
        image: `${type.toLowerCase()}_${t.suffix}.png`,
        order: t.order,
        effect: 'stat', stat: t.stat, amount: t.amount,
        requireType: type,
        blurb: `+${t.amount} ${STAT_LABELS[t.stat]} for a ${type} creature. Only a ${type} creature can hold it.`
      });
    }
  }

  add({
    id: 'growth_crystal', name: 'Growth Crystal', image: 'growth_crystal.png', order: 50,
    effect: 'stat', stat: 'hp', amount: 20,
    requireStage: 2, returnOnEvolve: true,
    blurb: '+20 HP for a Stage 2 creature. Only a Stage 2 creature can hold it, and it comes '
      + 'straight back to your storage if that creature evolves.'
  });
  add({
    id: 'strength_sigil', name: 'Strength Sigil', image: 'strength_sigil.png', order: 60,
    effect: 'stat', stat: 'attack', amount: 20,
    requireLevel: 8,
    blurb: '+20 Attack, for a creature at level 8 or above.'
  });

  add({
    id: 'breeding_amulet', name: 'Breeding Amulet', image: 'breeding_amulet.png', order: 70,
    effect: 'breeding', consumable: true,
    blurb: 'Put two creatures that are both holding one into the Breeding Centre and their candy '
      + 'arrives twice as fast. Both halves of the pair need one. Used up once that pair has '
      + `earned ${BREEDING_CANDY_CAP} candy.`
  });
  add({
    id: 'candy_pouch', name: 'Candy Pouch', image: 'candy_pouch.png', order: 80,
    effect: 'buddy', consumable: true,
    blurb: 'While this creature is your buddy it needs half the usual distance to earn a candy. '
      + 'Used up the moment it earns one.'
  });

  return out;
}

export const HELD_ITEMS = buildHeldItems();

export const heldItem = id => HELD_ITEMS[id] || null;
export const isHeldItem = id => !!HELD_ITEMS[id];
export const isConsumableHeldItem = id => !!HELD_ITEMS[id]?.consumable;
export const heldItemName = id => HELD_ITEMS[id]?.name || id;
/** The folder name has a space in it, so both halves need escaping. */
export const heldItemImage = id => (HELD_ITEMS[id]
  ? `${encodeURIComponent(HELD_ITEM_DIR)}/${encodeURIComponent(HELD_ITEMS[id].image)}`
  : '');

export const heldItemsInOrder = () =>
  Object.values(HELD_ITEMS).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

/** Every held item, grouped for a legend: the permanent ones and the consumables. */
export const permanentHeldItems = () => heldItemsInOrder().filter(d => !d.consumable);
export const consumableHeldItems = () => heldItemsInOrder().filter(d => d.consumable);

/**
 * Can this creature hold this item? Returns why not, in words, so both the
 * "pick an item for this creature" and "pick a creature for this item" screens
 * can explain a greyed-out row.
 */
export function heldItemFits(itemId, creature, sp = null) {
  const def = HELD_ITEMS[itemId];
  if (!def) return { ok: false, reason: 'That is not a held item' };
  const s = sp || species(creature?.speciesId);
  if (!creature || !s) return { ok: false, reason: 'No creature' };

  if (def.requireType && s.type !== def.requireType) {
    return { ok: false, reason: `${def.requireType} creatures only` };
  }
  if (def.requireStage && s.stage !== def.requireStage) {
    return { ok: false, reason: `Stage ${def.requireStage} only` };
  }
  if (def.requireLevel && (Number(creature.level) || 1) < def.requireLevel) {
    return { ok: false, reason: `Level ${def.requireLevel} or above` };
  }
  return { ok: true, reason: '' };
}

/* ---- where held items come from ----

   A raid can pay one out, and the chance rides on the level of the boss you
   just beat: the bands line up exactly with the levels RAID_TIERS hands out. */

export const HELD_ITEM_RAID_CHANCE = [
  { maxLevel: 4, chance: 0.01 },
  { maxLevel: 6, chance: 0.02 },
  { maxLevel: 8, chance: 0.04 }
];
/** Anything above the last band keeps the best rate rather than falling to zero. */
export const heldItemRaidChance = level => {
  const lv = Number(level) || 1;
  const band = HELD_ITEM_RAID_CHANCE.find(b => lv <= b.maxLevel);
  return band ? band.chance : HELD_ITEM_RAID_CHANCE[HELD_ITEM_RAID_CHANCE.length - 1].chance;
};

/** When one does drop, how often it is one of the two consumables. */
export const HELD_ITEM_CONSUMABLE_CHANCE = 0.4;

/**
 * One held item at random. The consumables are drawn as a group so their share
 * stays at HELD_ITEM_CONSUMABLE_CHANCE however many of each kind exist — there
 * are two consumables against eighteen of the others, so rolling a flat list
 * would almost never produce one.
 */
export function rollHeldItem(rng = Math.random) {
  const pool = rng() < HELD_ITEM_CONSUMABLE_CHANCE
    ? consumableHeldItems()
    : permanentHeldItems();
  const list = pool.length ? pool : heldItemsInOrder();
  return list[Math.floor(rng() * list.length)]?.id || null;
}

/** What the restrictions are, for the item's own description. */
export function heldItemRequirement(itemId) {
  const def = HELD_ITEMS[itemId];
  if (!def) return '';
  const parts = [];
  if (def.requireType) parts.push(`${def.requireType} type`);
  if (def.requireStage) parts.push(`Stage ${def.requireStage}`);
  if (def.requireLevel) parts.push(`level ${def.requireLevel}+`);
  return parts.join(' · ');
}

/**
 * The flat stat bonus a creature gets from what it is holding. Applied after
 * level growth, so it is worth the same at level 1 and level 10.
 */
export function heldStatBonus(creature, sp = null) {
  const out = { hp: 0, attack: 0, defence: 0, speed: 0 };
  const def = HELD_ITEMS[creature?.held];
  if (!def || def.effect !== 'stat') return out;
  // An item whose conditions no longer hold simply stops paying out. Nothing
  // can currently drift out of range except a Growth Crystal on a creature that
  // evolved, which is handed back, but a hand-edited save should not get a bonus
  // it has not earned either.
  if (!heldItemFits(def.id, creature, sp).ok) return out;
  out[def.stat] += def.amount;
  return out;
}

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
  /** The same shape one rung further along, and it hands over the Battle Frontier. */
  {
    id: 'frontier', kind: 'registered', target: 100, requireLevel: 9,
    xp: 100, dust: 300, items: { rare_incense: 1, battle_frontier: 1 },
    label: 'Reach level 9 and register 100 creatures'
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

  /* ---- Essence Harvesting ----
     Counts harvests that actually paid candy, so a run of six misses does not
     tick these along. */
  { id: 'ess10',  kind: 'essenceHarvests', target: 10,  xp: 10, dust: 50,  label: 'Get candies through Essence Harvesting 10 times' },
  { id: 'ess20',  kind: 'essenceHarvests', target: 20,  xp: 20, dust: 75,  label: 'Get candies through Essence Harvesting 20 times' },
  {
    id: 'ess50', kind: 'essenceHarvests', target: 50, xp: 30, dust: 150,
    items: { single_use_incubator: 1 },
    label: 'Get candies through Essence Harvesting 50 times'
  },
  {
    id: 'ess100', kind: 'essenceHarvests', target: 100, xp: 50, dust: 250,
    items: { super_incubator: 1 },
    label: 'Get candies through Essence Harvesting 100 times'
  },
  {
    id: 'ess250', kind: 'essenceHarvests', target: 250, xp: 80, dust: 500,
    items: { molten_seeker: 1, rare_incense: 1 },
    label: 'Get candies through Essence Harvesting 250 times'
  },

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
  {
    // Opening the game completes it, so it is really a weekly held item.
    id: 'weekLogin', kind: 'loggedInThisWeek', target: 1, xp: 10, dust: 50,
    heldItem: 'random',
    label: 'Log in to the game this week'
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
  },

  // ---- Essence Harvesting ----
  {
    id: 'weekEssence20', kind: 'essenceWeek', target: 20, xp: 20, dust: 150,
    items: { molten_seeker: 1 },
    label: 'Get candies through Essence Harvesting 20 times this week'
  }
];

/* ---------------------------------------------------------------
   Set missions

   Two ladders, each opening a set one rarity at a time, plus the one-rung
   exclusive ladder. Every rung wants a number of creatures registered from the
   *previous* set *and* an amount of total player XP, so a set cannot be rushed
   by a single very active week: Elemental Awakening opens Galactic Adventures,
   and Galactic Adventures opens Temporal Rift.

   `requireXp` is deliberately total lifetime XP rather than a player level:
   levels are a coarse, front-loaded curve, and XP keeps the gate meaningful
   past the level cap.

   `unlockGalacticRarity` / `unlockTemporalRarity` are applied on claim, which is
   what puts those creatures into the spawn pools. They never reset.
   --------------------------------------------------------------- */
export const SET_MISSIONS = [
  {
    id: 'ga1', kind: 'registeredInSet', set: SET_NAME, target: 65, requireXp: 10_000,
    xp: 25, dust: 250, unlockGalacticRarity: 1,
    label: `Register 65 creatures from ${SET_NAME}`
  },
  {
    id: 'ga2', kind: 'registeredInSet', set: SET_NAME, target: 70, requireXp: 13_000,
    xp: 40, dust: 400, unlockGalacticRarity: 2,
    label: `Register 70 creatures from ${SET_NAME}`
  },
  {
    id: 'ga3', kind: 'registeredInSet', set: SET_NAME, target: 75, requireXp: 18_000,
    xp: 60, dust: 600, unlockGalacticRarity: 3,
    label: `Register 75 creatures from ${SET_NAME}`
  },
  {
    id: 'ga4', kind: 'registeredInSet', set: SET_NAME, target: 77, requireXp: 22_000,
    xp: 80, dust: 800, unlockGalacticRarity: 4,
    label: `Register 77 creatures from ${SET_NAME}`
  },
  {
    id: 'ga5', kind: 'registeredInSet', set: SET_NAME, target: 79, requireXp: 25_000,
    xp: 150, dust: 1500, unlockGalacticRarity: 5,
    items: { breeding_center: 1 },
    grantEgg: MYTHICAL_EGG_TYPE,
    label: `Register all 79 creatures in ${SET_NAME}`
  },
  /**
   * The Temporal Rift ladder. Same shape as the one above, one set further along:
   * it counts Galactic Adventures registrations, so a player has to have worked
   * through the second set before the third opens at all. The XP gates carry on
   * from where the Galactic ladder left off.
   */
  {
    id: 'tr1', kind: 'registeredInSet', set: GALACTIC_SET_NAME, target: 65, requireXp: 24_000,
    xp: 30, dust: 300, unlockTemporalRarity: 1,
    label: `Register 65 creatures from ${GALACTIC_SET_NAME}`
  },
  {
    id: 'tr2', kind: 'registeredInSet', set: GALACTIC_SET_NAME, target: 70, requireXp: 27_000,
    xp: 45, dust: 450, unlockTemporalRarity: 2,
    label: `Register 70 creatures from ${GALACTIC_SET_NAME}`
  },
  {
    id: 'tr3', kind: 'registeredInSet', set: GALACTIC_SET_NAME, target: 73, requireXp: 30_000,
    xp: 65, dust: 650, unlockTemporalRarity: 3,
    label: `Register 73 creatures from ${GALACTIC_SET_NAME}`
  },
  {
    id: 'tr4', kind: 'registeredInSet', set: GALACTIC_SET_NAME, target: 75, requireXp: 33_000,
    xp: 85, dust: 850, unlockTemporalRarity: 4,
    label: `Register 75 creatures from ${GALACTIC_SET_NAME}`
  },
  {
    id: 'tr5', kind: 'registeredInSet', set: GALACTIC_SET_NAME, target: 77, requireXp: 38_000,
    xp: 175, dust: 1750, unlockTemporalRarity: 5,
    items: { mysterious_incense: 1 },
    grantEgg: CHROMARION_EGG_TYPE,
    label: `Register all 77 creatures in ${GALACTIC_SET_NAME}`
  },
  /**
   * The exclusive ladder. Filling in the first wave of Exclusives opens the
   * second, which is the only way those creatures enter the Collection or the
   * exclusive raid and 15 km egg pools. No XP gate: getting 19 raid-only
   * creatures registered is the work.
   */
  {
    id: 'ex1', kind: 'registeredInSet', set: EXCLUSIVE_SET_NAME, target: 19, requireXp: 0,
    xp: 50, dust: 500, unlockExclusiveSet: true,
    label: `Register 19 ${EXCLUSIVE_SET_NAME} creatures`
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
  },

  // ---- Essence Harvesting ----
  {
    id: 'dailyEssence3', kind: 'essenceToday', target: 3, xp: 10, dust: 75,
    items: { ultra_disc: 1 },
    label: 'Get candies through Essence Harvesting 3 times'
  },

  /**
   * The Holiday gift. `onlyDuring` names an annual event, and the mission does
   * not exist at all outside it — the Missions tab has no room for eleven months
   * of a greyed-out row nobody can do anything about.
   *
   * Opening the game is the whole task, so it is complete the moment it appears.
   */
  {
    id: 'holidayLogin', kind: 'loggedInToday', target: 1,
    onlyDuring: 'holiday',
    xp: 20, dust: 200,
    heldItem: 'random',
    randomIncense: true,
    label: 'Log in today'
  }
];

/**
 * Which incense the Holiday mission hands over. Weighted so the plain one is the
 * usual outcome and a Mysterious Incense is a genuine surprise.
 */
export const HOLIDAY_INCENSE_ODDS = [
  { weight: 45, item: 'incense' },
  { weight: 30, item: 'rare_incense' },
  { weight: 15, item: 'shiny_incense' },
  { weight: 10, item: 'mysterious_incense' }
];

export const rollHolidayIncense = () => weightedPick(HOLIDAY_INCENSE_ODDS).item;

/* ---------------------------------------------------------------
   Sets shown in the Collection menu
   --------------------------------------------------------------- */
export const SETS = [
  { id: 'elemental-awakening', title: SET_NAME, available: true, setName: SET_NAME },
  { id: 'galactic-adventures', title: GALACTIC_SET_NAME, available: true, setName: GALACTIC_SET_NAME, galactic: true },
  { id: 'temporal-rift', title: TEMPORAL_SET_NAME, available: true, setName: TEMPORAL_SET_NAME, temporal: true },
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

/* ---------------------------------------------------------------
   Temporal Rift unlocks

   Identical in shape to the Galactic ladder above, and deliberately a separate
   set of rarities rather than a shared one: the two ladders are climbed at
   different times and a player can be several rungs up one and none up the
   other.
   --------------------------------------------------------------- */

let temporalUnlocked = new Set();

/* ---------------------------------------------------------------
   Exclusive wave 2 unlock

   Same shape as the Galactic unlocks above: state.js owns the truth and pushes
   it here, and one rebuild keeps the Collection tab, exclusive raids and 15 km
   eggs consistent without any of them knowing about the mission.
   --------------------------------------------------------------- */

let exclusive2Unlocked = false;

export const isExclusive2Unlocked = () => exclusive2Unlocked;

/** Replaces the flag and rebuilds the exclusive pools. */
export function setExclusive2Unlocked(on = false) {
  exclusive2Unlocked = !!on;
  if (DB.loaded) rebuildExclusivePools();
  return exclusive2Unlocked;
}

/**
 * Recomputes which exclusives are reachable. Only stage 1 creatures go into the
 * rarity buckets, because that is all a raid or an egg can produce.
 */
export function rebuildExclusivePools() {
  DB.exclusiveInPlay = DB.exclusive.filter(s => !s.exclusive2 || exclusive2Unlocked);
  // Frontier bosses are in the Collection but never in a roll. Everything that
  // draws an exclusive at random reads `exclusiveRollable` or the rarity
  // buckets below, so leaving them out here keeps them out of raids and eggs.
  DB.exclusiveRollable = DB.exclusiveInPlay.filter(s => !s.frontier);
  DB.exclusiveByRarity = { 3: [], 4: [], 5: [] };
  for (const sp of DB.exclusiveRollable) {
    if (sp.stage === 1 && DB.exclusiveByRarity[sp.rarity]) DB.exclusiveByRarity[sp.rarity].push(sp);
  }
  return DB.exclusiveInPlay.length;
}

/**
 * How many creatures the player could possibly register right now. The locked
 * second wave of exclusives is left out, so "registered x / y" never counts
 * creatures that are not in the game yet for them.
 */
export const discoverableSpeciesCount = () =>
  DB.species.length - (exclusive2Unlocked ? 0 : DB.exclusive2.length);

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

/** True once the Set mission for this Temporal Rift rarity has been claimed. */
export const isTemporalRarityUnlocked = r => temporalUnlocked.has(Number(r));
export const unlockedTemporalRarities = () => [...temporalUnlocked].sort((a, b) => a - b);

/** The Temporal Rift twin of setGalacticUnlocked. */
export function setTemporalUnlocked(rarities = []) {
  temporalUnlocked = new Set((rarities || []).map(Number).filter(r => r >= 1 && r <= 5));
  if (DB.loaded) rebuildSpawnPools();
  return unlockedTemporalRarities();
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
    if (sp.temporal) return isTemporalRarityUnlocked(sp.rarity || familyRarity(sp.id));
    return true;
  };

  DB.available = DB.species.filter(inPlay);
  DB.stage1 = DB.available.filter(s => s.stage === 1);
  DB.spawnable = DB.stage1.filter(s => s.rarity >= 1 && s.rarity <= 5);

  DB.byRarity = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const sp of DB.spawnable) DB.byRarity[sp.rarity].push(sp);

  // The Galactic-only view of the same thing, for the weekly takeover. Built
  // here so it can never fall out of step with an unlock.
  DB.galacticSpawnable = DB.spawnable.filter(s => s.galactic);
  DB.galacticByRarity = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const sp of DB.galacticSpawnable) DB.galacticByRarity[sp.rarity].push(sp);

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
  if (set?.temporal) return DB.temporal;
  // In play only: the second wave of exclusives stays out of the tab entirely
  // until its Set mission is claimed, rather than sitting there as a spoiler.
  if (set?.exclusive) return DB.exclusiveInPlay;
  if (set?.mythical) return DB.mythical;
  return DB.species.filter(s =>
    !s.galactic && !s.exclusive && !s.mythical && !s.temporal);
}

/* ---------------------------------------------------------------
   Ability file parsing
   --------------------------------------------------------------- */

/**
 * Splits a comma-separated cell into trimmed entries. Blank yields an empty
 * list. Used for an ability's `Value` column and for the `Evolves to` column,
 * which can now name more than one creature.
 */
function splitList(raw) {
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

    const channel = ABILITY_EFFECTS[effect].channel;

    // A single clause beyond the cap would be silently clamped in battle, which
    // is confusing to author against, so say so up front. A faint effect moves no
    // multiplier, so the cap does not apply to it — its percentage is a share of
    // the opponent's HP, and anything over 100% of that is meaningless.
    if (channel === 'faint') {
      if (percent > 100) {
        DB.warnings.push(
          `Abilities line ${line}: "${effect}" cannot exceed 100% of the opponent's HP`);
        return;
      }
    } else {
      const single = 1 + ABILITY_EFFECTS[effect].direction * (percent / 100);
      if (single < ABILITY_MULTIPLIER_MIN || single > ABILITY_MULTIPLIER_MAX) {
        DB.warnings.push(
          `Abilities line ${line}: ${percent}% is outside the ` +
          `${ABILITY_MULTIPLIER_MIN}x–${ABILITY_MULTIPLIER_MAX}x cap and will be clamped`);
      }
    }

    const values = splitList(r['value']);
    const min = numOrNull(r['min']);
    const max = numOrNull(r['max']);

    /* `always` carries no condition at all, which is the point: the effects that
       use it bring their own timing. It is only meaningful with such an effect,
       so pairing it with a damage multiplier is a mistake worth naming. */
    if (trigger === ALWAYS_TRIGGER) {
      if (channel !== 'faint') {
        DB.warnings.push(
          `Abilities line ${line}: "${ALWAYS_TRIGGER}" has no condition, so it only ` +
          `makes sense with an effect that has its own timing, not "${effect}"`);
        return;
      }
    } else if (channel === 'faint') {
      DB.warnings.push(
        `Abilities line ${line}: "${effect}" fires when the creature faints, so its ` +
        `trigger must be "${ALWAYS_TRIGGER}", not "${trigger}"`);
      return;
    }

    if (ABILITY_LIST_TRIGGERS.includes(trigger) && !values.length) {
      DB.warnings.push(`Abilities line ${line}: "${trigger}" needs a Value`);
      return;
    }
    // A team clause names creatures, so a typo would parse happily and then never
    // fire. Checked against the database, which is already loaded by this point.
    if (trigger === 'team') {
      const bad = values.filter(v => !DB.byName.has(String(v).toLowerCase()));
      if (bad.length) {
        DB.warnings.push(
          `Abilities line ${line}: "team" names no such creature: "${bad.join(', ')}"`);
        return;
      }
      if (values.length >= BATTLE_TEAM_SIZE) {
        DB.warnings.push(
          `Abilities line ${line}: "team" lists ${values.length} creatures, but a team ` +
          `is only ${BATTLE_TEAM_SIZE} including this one — it could never fire`);
        return;
      }
    }
    // Same reasoning for a stat name.
    if (trigger === 'opposing buffed') {
      const bad = values.filter(v =>
        !STAT_KEYS.some(k => k === String(v).toLowerCase()
          || STAT_LABELS[k].toLowerCase() === String(v).toLowerCase()));
      if (bad.length) {
        DB.warnings.push(
          `Abilities line ${line}: "opposing buffed" takes a stat name, not "${bad.join(', ')}"`);
        return;
      }
    }
    if (trigger === 'moon') {
      const bad = values.filter(v =>
        !MOON_PHASES.some(p => p.toLowerCase() === String(v).toLowerCase()));
      if (bad.length) {
        DB.warnings.push(
          `Abilities line ${line}: "moon" takes one of ${MOON_PHASES.join(', ')}, ` +
          `not "${bad.join(', ')}"`);
        return;
      }
    }
    // Daylight has exactly two legal values, and a typo would otherwise parse
    // happily and then silently never fire.
    if (trigger === 'daylight') {
      const bad = values.filter(v =>
        !DAYLIGHT_VALUES.some(d => d.toLowerCase() === String(v).toLowerCase()));
      if (bad.length) {
        DB.warnings.push(
          `Abilities line ${line}: "daylight" takes ${DAYLIGHT_VALUES.join(' or ')}, ` +
          `not "${bad.join(', ')}"`);
        return;
      }
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
  const path = lineagePath(speciesId);
  return path[path.length - 1] || species(speciesId) || null;
}

/**
 * The one lineage a creature is certain to follow: every form it grew out of,
 * itself, and then its evolutions only for as long as there is a single way
 * forward.
 *
 * A branch stops the walk on purpose. Which arm a creature takes is the
 * player's choice at evolve time, so following one of them would promise moves
 * and a final form it may never get. `familyChain` is still the whole tree —
 * that is what the shared candy pool and the Collection entry are built on.
 */
export function lineagePath(speciesId) {
  const start = species(speciesId);
  if (!start) return [];

  // Up to the root first. `evolvesFrom` holds one parent per creature, so this
  // is unambiguous even in a branching family.
  const path = [];
  let cur = start, guard = 0;
  while (cur && guard++ < 24) {
    path.unshift(cur);
    const parentId = DB.evolvesFrom.get(cur.id);
    cur = parentId ? DB.byId.get(parentId) : null;
  }

  cur = start; guard = 0;
  while (cur && guard++ < 24) {
    if (cur.evolvesToIds?.length !== 1) break;
    const next = DB.byId.get(cur.evolvesToIds[0]);
    if (!next || path.includes(next)) break;
    path.push(next);
    cur = next;
  }
  return path;
}

/** Every creature this one can turn into. Empty for a final form. */
export const evolutionTargets = speciesId =>
  (species(speciesId)?.evolvesToIds || []).map(species).filter(Boolean);

/**
 * Every move a creature line can ever learn, gathered along its lineage so an
 * early form still lists all four. Earlier forms often only carry the first two
 * or three slots, and the missing ones live on the final evolution.
 *
 * Each entry keeps the first species in the line that actually has that slot,
 * which is what decides whether the move needs an evolution to become usable.
 *
 * Read along `lineagePath`, not the whole family: a creature facing a choice of
 * evolutions would otherwise list moves from arms it will never take.
 */
export function fullLearnset(speciesId) {
  const bySlot = new Map();
  for (const sp of lineagePath(speciesId)) {
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
  /** Just the second wave, so its size can be counted without re-filtering. */
  exclusive2: [],
  /**
   * The exclusives actually in play: the first wave always, the second only once
   * its Set mission has been claimed. The Collection tab and every exclusive
   * roll read this rather than `exclusive`, so a locked creature cannot be seen
   * or caught. Rebuilt by setExclusive2Unlocked.
   */
  exclusiveInPlay: [],
  /**
   * The exclusives a roll may actually produce: `exclusiveInPlay` without the
   * Battle Frontier bosses. Those show up in the Collection tab like any other
   * exclusive, but no raid and no egg can reach them — clearing a Frontier
   * challenge is the only route, so they are filtered out here rather than at
   * each of the several places that roll one.
   */
  exclusiveRollable: [],
  exclusiveByRarity: { 3: [], 4: [], 5: [] },
  /**
   * The Battle Frontier ladder: challenge id -> level -> the trainer's team of
   * three. Empty when Battle Frontier.csv is missing, which simply means the
   * building has nothing to fight.
   */
  frontier: new Map(),
  /** challenge id -> the species id of its Grand Raid boss. */
  frontierBossByChallenge: new Map(),
  /** Galactic Adventures, all 77 whether unlocked or not. */
  galactic: [],
  /**
   * The unlocked Galactic creatures on their own, in the same shape as
   * `spawnable` and `byRarity`. Only read during Galactic Adventures Take Over,
   * when they are the entire spawn pool. Empty until a Set mission opens one.
   */
  galacticSpawnable: [],
  galacticByRarity: { 1: [], 2: [], 3: [], 4: [], 5: [] },
  /** Temporal Rift, all 74 whether unlocked or not. */
  temporal: [],
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

  /**
   * The Creature Spotlight rota: one entry per week, sorted by date. Empty
   * when the CSV is missing, which simply means the event never fires.
   */
  spotlight: [],
  /**
   * Hand-picked casts for the annual events that use one, keyed by event id.
   * Empty lists are normal and simply mean that event has no hourly creature.
   */
  eventPools: { halloween: [], thanksgiving: [] },
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
  mythicalUrl = MYTHICAL_CSV_FILE,
  spotlightUrl = SPOTLIGHT_CSV_FILE,
  exclusive2Url = EXCLUSIVE2_CSV_FILE,
  temporalUrl = TEMPORAL_CSV_FILE,
  halloweenUrl = HALLOWEEN_CSV_FILE,
  thanksgivingUrl = THANKSGIVING_CSV_FILE,
  exclusive3Url = EXCLUSIVE3_CSV_FILE,
  frontierUrl = FRONTIER_CSV_FILE
) {
  DB.warnings = [];

  /** A missing extra set is not fatal: the rest of the game still runs. */
  const optional = (url, what) => fetchText(url).catch(err => {
    DB.warnings.push(`${what} not loaded: ${err.message}`);
    return '';
  });

  const [baseText, statsText, exclusiveText, abilitiesText, galacticText, mythicalText,
         spotlightText, exclusive2Text, temporalText, halloweenText, thanksgivingText,
         exclusive3Text, frontierText] =
    await Promise.all([
      fetchText(csvUrl),
      fetchText(statsUrl),
      optional(exclusiveUrl, 'Exclusive creatures'),
      // Abilities are entirely optional and the file is expected to be absent
      // until it is authored, so a miss here is silent by design.
      fetchText(abilitiesUrl).catch(() => ''),
      optional(galacticUrl, GALACTIC_SET_NAME),
      optional(mythicalUrl, 'Mythicals'),
      optional(spotlightUrl, SPOTLIGHT_LABEL),
      optional(exclusive2Url, 'Exclusive creatures (second wave)'),
      optional(temporalUrl, TEMPORAL_SET_NAME),
      // Both event casts are optional by design: the event still runs, it just
      // has no hourly creature to hand out until the file exists.
      optional(halloweenUrl, 'Halloween creatures'),
      optional(thanksgivingUrl, 'Thanksgiving creatures'),
      // Both halves of the Battle Frontier are optional too: without the boss
      // file the ladders simply have no Grand Raid, and without the ladder file
      // the building opens to an empty challenge list.
      optional(exclusive3Url, 'Battle Frontier raid bosses'),
      optional(frontierUrl, 'Battle Frontier challenges')
    ]);

  const baseRows = toRecords(parseCSV(baseText));
  const statRows = toRecords(parseCSV(statsText));
  const exclusiveRows = exclusiveText ? toRecords(parseCSV(exclusiveText)) : [];
  const galacticRows = galacticText ? toRecords(parseCSV(galacticText)) : [];
  const mythicalRows = mythicalText ? toRecords(parseCSV(mythicalText)) : [];
  const exclusive2Rows = exclusive2Text ? toRecords(parseCSV(exclusive2Text)) : [];
  const spotlightRows = spotlightText ? toRecords(parseCSV(spotlightText)) : [];
  const temporalRows = temporalText ? toRecords(parseCSV(temporalText)) : [];
  const halloweenRows = halloweenText ? toRecords(parseCSV(halloweenText)) : [];
  const thanksgivingRows = thanksgivingText ? toRecords(parseCSV(thanksgivingText)) : [];
  const exclusive3Rows = exclusive3Text ? toRecords(parseCSV(exclusive3Text)) : [];
  const frontierRows = frontierText ? toRecords(parseCSV(frontierText)) : [];

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
  DB.galactic = []; DB.mythical = []; DB.available = []; DB.temporal = [];
  DB.spotlight = [];
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
      evolvesToNames: splitList(r['evolves to']),
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
  /* The second wave shares the set name, the order base and the bucket, so it
     reads as one continuous Exclusive collection. The `exclusive2` flag is the
     only thing that separates them, and it is what the unlock gates on. */
  addSelfContainedSet(exclusive2Rows, {
    setName: EXCLUSIVE_SET_NAME, orderBase: EXCLUSIVE_ORDER_BASE,
    bucket: DB.exclusive, flags: { exclusive: true, exclusive2: true }
  });
  /* The Grand Raid bosses. Same tab and same bucket again, but on their own
     order base so they sit after every ordinary exclusive, and flagged
     `frontier` so rebuildExclusivePools keeps them out of the roll pools. They
     are deliberately *not* `exclusive2`: the second wave's Set mission has
     nothing to do with reaching one. */
  addSelfContainedSet(exclusive3Rows, {
    setName: EXCLUSIVE_SET_NAME, orderBase: EXCLUSIVE_FRONTIER_ORDER_BASE,
    bucket: DB.exclusive, flags: { exclusive: true, frontier: true }
  });
  addSelfContainedSet(mythicalRows, {
    setName: MYTHICAL_SET_NAME, orderBase: MYTHICAL_ORDER_BASE,
    bucket: DB.mythical, flags: { mythical: true }
  });
  addSelfContainedSet(temporalRows, {
    setName: TEMPORAL_SET_NAME, orderBase: TEMPORAL_ORDER_BASE,
    bucket: DB.temporal, flags: { temporal: true }
  });

  DB.species.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  for (const list of [DB.galactic, DB.exclusive, DB.mythical, DB.temporal]) {
    list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  /* ---- evolution links ----
     A creature may name several targets, which is how a branching line is
     written: "Noctivane, Zephyraun, Florvulpa, Rustarok". `evolvesToId` is kept
     as the first of them so everything written before branching existed still
     reads naturally; anything offering a choice must use `evolvesToIds`. */
  for (const sp of DB.species) {
    sp.evolvesToIds = [];
    for (const wanted of sp.evolvesToNames || []) {
      const target = DB.byName.get(wanted.toLowerCase());
      if (!target) {
        DB.warnings.push(`"${sp.name}" evolves to unknown creature "${wanted}"`);
        continue;
      }
      if (target.id === sp.id) {
        DB.warnings.push(`"${sp.name}" evolves into itself — ignored`);
        continue;
      }
      if (sp.evolvesToIds.includes(target.id)) continue;   // listed twice
      sp.evolvesToIds.push(target.id);
      // One parent per target. Two would make the family tree ambiguous and
      // silently lose a branch, so the second is refused rather than accepted.
      const already = DB.evolvesFrom.get(target.id);
      if (already && already !== sp.id) {
        DB.warnings.push(
          `"${target.name}" is listed as an evolution of both ` +
          `"${species(already)?.name || already}" and "${sp.name}" — keeping the first`);
      } else {
        DB.evolvesFrom.set(target.id, sp.id);
      }
    }
    sp.evolvesToId = sp.evolvesToIds[0] || null;
    /** True when the player has to choose which way this creature evolves. */
    sp.branchingEvolution = sp.evolvesToIds.length > 1;
  }

  /* ---- families ----
     Breadth-first from each root so a branching line still gathers every
     descendant into one family: they share a candy pool and one Collection
     entry however many arms the tree has. Breadth-first also keeps the members
     roughly in stage order, which is what the chain display wants. */
  for (const sp of DB.species) {
    if (DB.evolvesFrom.has(sp.id)) continue;
    const chain = [];
    const seen = new Set();
    const queue = [sp];
    while (queue.length && chain.length < 24) {
      const cur = queue.shift();
      if (!cur || seen.has(cur.id)) continue;
      seen.add(cur.id);
      chain.push(cur.id);
      DB.familyOf.set(cur.id, sp.id);
      for (const id of cur.evolvesToIds) {
        if (!seen.has(id) && DB.byId.has(id)) queue.push(DB.byId.get(id));
      }
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

  DB.exclusive2 = DB.exclusive.filter(s => s.exclusive2);
  /* The Battle Frontier, once every species exists: the ladder resolves its
     creatures by id, and the boss mapping matches on type. */
  loadFrontierLadder(frontierRows);
  rebuildFrontierBosses();
  // Fills exclusiveInPlay and exclusiveByRarity, honouring the unlock. Called
  // again by setExclusive2Unlocked when the mission is claimed.
  rebuildExclusivePools();
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

  buildSpotlightRota(spotlightRows);

  // Event casts come last for the same reason abilities do: they are lists of
  // creature ids, so every set has to exist before they can be resolved.
  DB.eventPools = {
    halloween: buildEventPool(halloweenRows, 'Halloween'),
    thanksgiving: buildEventPool(thanksgivingRows, 'Thanksgiving')
  };

  DB.loaded = true;
  if (DB.warnings.length) console.warn('[data]', DB.warnings);
  return DB;
}

/**
 * Turns the spotlight CSV (`id,name,date` with a Monday in DD/MM/YYYY) into the
 * rota. Runs after every set is loaded, so ids from any set resolve.
 *
 * A row is dropped rather than guessed at if its species or date is unusable —
 * a silently wrong featured creature would be worse than no event that week.
 */
function buildSpotlightRota(rows) {
  const seen = new Set();
  for (const r of rows) {
    const id = r['id'] || r['id_output'];
    const date = parseDayMonthYear(r['date']);
    if (!id || !date) {
      DB.warnings.push(`${SPOTLIGHT_LABEL}: skipped a row with a bad id or date ("${r['date']}")`);
      continue;
    }
    // Ids in this file have no .png suffix, but tolerate one anyway.
    const cleanId = String(id).replace(/\.png$/i, '').trim();
    const sp = DB.byId.get(cleanId) || DB.byName.get(String(r['name'] || '').toLowerCase());
    if (!sp) {
      DB.warnings.push(`${SPOTLIGHT_LABEL}: no creature matches "${r['name']}" (${cleanId})`);
      continue;
    }
    // The rota is keyed on the Monday of that week, so a date written as any
    // day of the week still lands on the right event.
    const monday = mondayOf(date).getTime();
    if (seen.has(monday)) {
      DB.warnings.push(`${SPOTLIGHT_LABEL}: two entries for the week of ${r['date']} — keeping the first`);
      continue;
    }
    seen.add(monday);
    DB.spotlight.push({
      speciesId: sp.id,
      name: sp.name,
      species: sp,
      rarity: sp.rarity || familyRarity(sp.id) || 1,
      monday
    });
  }
  DB.spotlight.sort((a, b) => a.monday - b.monday);
}

/**
 * Turns an event's `id,name` CSV into a list of species.
 *
 * Matched on id first and name second, exactly like the spotlight rota, and a
 * row that resolves to nothing is dropped with a warning rather than guessed at.
 * An empty result is not an error: it means that event has no cast yet.
 */
function buildEventPool(rows, label) {
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    const rawId = r['id'] || r['id_output'];
    const name = String(r['name'] || '').trim();
    if (!rawId && !name) continue;
    const cleanId = String(rawId || '').replace(/\.png$/i, '').trim();
    const sp = DB.byId.get(cleanId) || DB.byName.get(name.toLowerCase());
    if (!sp) {
      DB.warnings.push(`${label} creatures: no creature matches "${name}" (${cleanId})`);
      continue;
    }
    if (seen.has(sp.id)) continue;
    seen.add(sp.id);
    out.push(sp);
  }
  return out;
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
      evolvesToNames: splitList(r['evolves to']),
      evolutionCandy: candyRaw ? Number(candyRaw) : null,
      spawnRestriction: parseSpawnRestriction(r['spawn restriction'], name),
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

/**
 * Reads a move's `Effect` / `Effect number` pair into a normalised effect.
 *
 * The newer creature files replaced the old "Stat Buff" + "Stat Buff Percentage"
 * columns with these two, because a move can now do more than raise the user's
 * own stats. Both spellings are still accepted — see readMoves — so older files
 * keep working untouched.
 *
 * Recognised effects, exactly as they are written in the sheets:
 *   "Heal self"                → number is whole HP, e.g. 30
 *   "Buff self <stat>"         → number is a percentage, e.g. 25%
 *   "Debuff self <stat>"       → number is a percentage
 *   "Debuff opponent <stat>"   → number is a percentage
 *   "Buff opponent <stat>"     → number is a percentage
 * `<stat>` is attack, defence or speed, and more than one may be listed.
 *
 * The last two are drawbacks, and they are what pays for an unusually strong
 * move: "Wind Goal" hits for 65 and hands the opponent 30% more Attack. Buffing
 * the opponent used to be refused as a mistake; it is now taken at face value,
 * so a sheet that means it gets what it asked for.
 *
 * @returns {{kind:string, stats:string[], pct:number|null, amount:number|null}|null}
 */
function readEffect(rawEffect, rawNumber, { name, slot, moveName }) {
  const text = String(rawEffect ?? '').trim();
  if (!text) return null;
  const where = `${name}: move ${slot} "${moveName}"`;
  const low = text.toLowerCase();

  if (/^heals?\b.*\bself\b/.test(low) || /^self\s+heal/.test(low)) {
    const amount = int(rawNumber);
    if (amount == null || amount <= 0) {
      DB.warnings.push(`${where} heals but its effect number "${rawNumber}" is not a positive whole number of HP — effect ignored`);
      return null;
    }
    return { kind: 'healSelf', stats: [], pct: null, amount };
  }

  const m = low.match(/^(de)?buffs?\s+(self|own|opponent|enemy|foe|target)\b(.*)$/);
  if (!m) {
    DB.warnings.push(`${where} has an effect we do not understand: "${text}" — effect ignored`);
    return null;
  }
  const down = !!m[1];
  const onSelf = /^(self|own)$/.test(m[2]);
  const stats = normaliseStats(m[3]);

  if (!stats.length) {
    DB.warnings.push(`${where} says "${text}" but names no stat — effect ignored`);
    return null;
  }
  // HP is deliberately not buffable: a battler's maximum is fixed for the
  // fight, so raising "HP" would move a number nothing reads.
  if (stats.includes('hp')) {
    DB.warnings.push(`${where} tries to change HP, which only "Heal self" can do — effect ignored`);
    return null;
  }
  const p = pct(rawNumber);
  if (p == null || p <= 0) {
    DB.warnings.push(`${where} needs a percentage, got "${rawNumber}" — effect ignored`);
    return null;
  }

  return {
    kind: down
      ? (onSelf ? 'debuffSelf' : 'debuffOpponent')
      : (onSelf ? 'buffSelf' : 'buffOpponent'),
    stats,
    pct: p,
    amount: null
  };
}

/** "Attack and Speed" from a list of stat keys. */
const statListLabel = stats => {
  const names = (stats || []).map(s => STAT_LABELS[s] || s);
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

/**
 * What a move's effect does, in words: "Heals 40 HP", "Raises your Defence by
 * 50%", "Lowers the opponent's Attack by 35%". Empty for a plain damage move.
 */
export function moveEffectText(move) {
  const fx = move?.effect;
  if (!fx) {
    // Older data reached here through the legacy buff columns.
    return move?.isBuff ? buffMoveText(move) : '';
  }
  const amountPct = `${Math.round(fx.pct * 100)}%`;
  switch (fx.kind) {
    case 'healSelf': return `Heals ${fx.amount} HP`;
    case 'buffSelf': return `Raises your ${statListLabel(fx.stats)} by ${amountPct}`;
    case 'debuffSelf': return `Lowers your own ${statListLabel(fx.stats)} by ${amountPct}`;
    case 'debuffOpponent': return `Lowers the opponent's ${statListLabel(fx.stats)} by ${amountPct}`;
    case 'buffOpponent': return `Raises the opponent's ${statListLabel(fx.stats)} by ${amountPct}`;
    default: return '';
  }
}

/** "40 power · Heals 40 HP", or just one half when that is all there is. */
export function moveSummaryText(move) {
  const fx = moveEffectText(move);
  if (!move?.power) return fx;
  return fx ? `${move.power} power · ${fx}` : `${move.power} power`;
}

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
    const moveName = mName || `Move ${slot}`;

    /* ---- the effect, in either of the two column layouts ----
       Newer files carry "Effect" + "Effect number", which can describe a heal or
       a debuff as well as a self-buff. Older files carry "Stat Buff" + "Stat
       Buff Percentage", which could only ever mean a self-buff. Both are read,
       the newer pair winning if a file somehow has both, so no existing sheet
       needs rewriting. */
    let effect = readEffect(
      row[`move${slot} effect`], row[`move${slot} effect number`],
      { name, slot, moveName }
    );
    if (!effect) {
      const legacyStats = normaliseStats(row[`move${slot} stat buff`]);
      if (legacyStats.length) {
        let legacyPct = pct(row[`move${slot} stat buff percentage`]);
        if (legacyPct == null) {
          DB.warnings.push(`${name}: move ${slot} "${moveName}" has no buff percentage, using ${DEFAULT_BUFF_PCT * 100}%`);
          legacyPct = DEFAULT_BUFF_PCT;
        }
        effect = { kind: 'buffSelf', stats: legacyStats, pct: legacyPct, amount: null };
      }
    }

    // A move with no power has to do *something*. It used to have to be a
    // self-buff; now any effect will do, which is what lets a zero-power move
    // be a pure heal or a pure debuff.
    const isStatus = power === 0;
    if (isStatus && !effect) {
      DB.warnings.push(`${name}: move ${slot} "${moveName}" has no power and no effect — skipped`);
      continue;
    }

    // `isBuff` keeps its old meaning — a non-damaging move that raises the
    // user's own stats — so everything written against it still reads true.
    // Use `isStatus` for "deals no damage" and `effect` for what it actually does.
    const selfBuff = effect?.kind === 'buffSelf';
    const isBuff = isStatus && selfBuff;

    const move = {
      slot,
      name: moveName,
      power,
      level,
      effect,
      // `buffStat` is the first of `buffStats`, kept so single-stat callers read
      // naturally. Anything applying the buff must use `buffStats`.
      buffStat: selfBuff ? effect.stats[0] : null,
      buffStats: selfBuff ? effect.stats : [],
      buffPct: selfBuff ? effect.pct : null,
      isBuff,
      isStatus
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

/**
 * Every species whose name contains `text`, case-insensitively. A plain
 * substring match on purpose: typing more letters should only ever narrow the
 * list, never suddenly hide a longer name that still starts the same way.
 */
export function speciesMatching(text) {
  const q = String(text ?? '').trim().toLowerCase();
  if (!q) return [];
  return DB.species.filter(sp => sp.name.toLowerCase().includes(q));
}

/**
 * The family roots behind a search, so "whole family" can reach stages the
 * player has not registered. Read from the database rather than from storage:
 * searching for an evolution you have never owned still has to find the
 * pre-evolution sitting in your boxes.
 */
export const familyRootsMatching = text =>
  [...new Set(speciesMatching(text).map(sp => familyRoot(sp.id)))];

/* ---------------------------------------------------------------
   Storage search

   The box takes a name fragment, as it always did, but it also takes filters:

     type = celestial          only Celestial creatures
     level > 4                 above level 4
     speed > 120               by any of the four stats, as they are right now
     buff = attack             the stat its +10% roll landed on
     debuff = speed            and the stat that took the -10%

   Several are joined with `&` and all of them have to hold, so
   `type = mystic & attack > 70` is the two conditions together. Anything without
   an operator in it is still read as a name, which is what keeps the old
   behaviour intact — and a name can be one of the terms, so
   `toxi & level > 5` works too.

   Only reported as a mistake when the text plainly *tried* to be a filter: an
   operator with a field nobody recognises. Otherwise it is a name and the worst
   that happens is no matches.
   --------------------------------------------------------------- */

/** The fields a storage query may compare, and how each one reads. */
const STORAGE_QUERY_FIELDS = {
  type: 'type',
  level: 'level',
  lvl: 'level',
  buff: 'buff',
  buffed: 'buff',
  debuff: 'debuff',
  debuffed: 'debuff',
  rarity: 'rarity',
  stage: 'stage'
};

/** Comparisons, longest first so `>=` is read before `>`. */
const STORAGE_QUERY_OPS = ['>=', '<=', '==', '!=', '=', '>', '<'];

/** Compares two numbers with one of the operators above. */
export function compareWithOp(a, op, b) {
  switch (op) {
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '!=': return a !== b;
    default: return a === b;    // '=' and '=='
  }
}

/**
 * Parses one `&`-separated piece of a storage query.
 * @returns {object} a term, or `{ kind: 'error', text, why }`
 */
function parseStorageTerm(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  // Find the operator, if there is one. Nothing to do with filters otherwise.
  let op = null, at = -1;
  for (const candidate of STORAGE_QUERY_OPS) {
    const i = text.indexOf(candidate);
    if (i > 0 && (at === -1 || i < at)) { op = candidate; at = i; }
  }
  if (!op) return { kind: 'name', text: text.toLowerCase() };

  const rawField = text.slice(0, at).trim().toLowerCase();
  const rawValue = text.slice(at + op.length).trim();
  const fail = why => ({ kind: 'error', text, why });

  if (!rawValue) return fail('nothing after the ' + op);

  // A stat name is a field in its own right: "speed > 120".
  const stat = normaliseStat(rawField);
  const field = STORAGE_QUERY_FIELDS[rawField] || (stat ? 'stat' : null);
  if (!field) return fail(`"${text.slice(0, at).trim()}" is not something you can filter on`);

  // The numeric comparisons.
  if (field === 'stat' || field === 'level' || field === 'rarity' || field === 'stage') {
    const n = numOrNull(rawValue);
    if (n == null) return fail(`"${rawValue}" is not a number`);
    return field === 'stat'
      ? { kind: 'stat', stat, op, value: n, text }
      : { kind: field, op, value: n, text };
  }

  // The rest name things, and may name more than one: "type = mystic, wind".
  const values = splitList(rawValue);
  if (!values.length) return fail('nothing listed after the ' + op);
  // `!=` on a list reads as "none of these".
  const negate = op === '!=';

  if (field === 'type') {
    const resolved = [];
    for (const v of values) {
      const hit = TYPES.find(t => t.toLowerCase() === v.toLowerCase());
      if (!hit) return fail(`"${v}" is not a type — try ${TYPES.join(', ')}`);
      resolved.push(hit);
    }
    return { kind: 'type', values: resolved, negate, text };
  }

  // buff / debuff name one of the four stats.
  const stats = [];
  for (const v of values) {
    const s = normaliseStat(v);
    if (!s) return fail(`"${v}" is not a stat — try ${STAT_KEYS.join(', ')}`);
    stats.push(s);
  }
  return { kind: field, stats, negate, text };
}

/**
 * Parses a whole storage query into terms plus whatever could not be read.
 *
 * @returns {{terms:Array, errors:Array<{text:string, why:string}>, names:Array}}
 */
export function parseStorageQuery(raw) {
  const terms = [];
  const errors = [];
  for (const part of String(raw ?? '').split('&')) {
    const term = parseStorageTerm(part);
    if (!term) continue;
    if (term.kind === 'error') errors.push({ text: term.text, why: term.why });
    else terms.push(term);
  }
  return {
    terms,
    errors,
    /** The name fragments on their own, for whole-family mode to widen. */
    names: terms.filter(t => t.kind === 'name').map(t => t.text),
    /** True when the query is doing more than matching a name. */
    hasFilters: terms.some(t => t.kind !== 'name')
  };
}

/** "type = Mystic" back out of a parsed term, for the filter chip. */
export function storageTermLabel(term) {
  switch (term.kind) {
    case 'name': return `"${term.text}"`;
    case 'type': return `type ${term.negate ? '≠' : '='} ${term.values.join(' / ')}`;
    case 'buff': return `+10% ${term.stats.map(s => STAT_LABELS[s]).join(' / ')}`;
    case 'debuff': return `−10% ${term.stats.map(s => STAT_LABELS[s]).join(' / ')}`;
    case 'stat': return `${STAT_LABELS[term.stat]} ${term.op} ${term.value}`;
    case 'level': return `level ${term.op} ${term.value}`;
    case 'rarity': return `rarity ${term.op} ${term.value}`;
    case 'stage': return `stage ${term.op} ${term.value}`;
    default: return '';
  }
}

/** Every filter the search box understands, for the help sheet. */
export const STORAGE_QUERY_HELP = [
  { example: 'type = celestial', means: 'only Celestial creatures. Any of the five types.' },
  { example: 'level > 4', means: 'above level 4. Also =, <, >= and <=.' },
  { example: 'speed > 120', means: 'by the stat it has right now, level and boosts included. HP, Attack, Defence or Speed.' },
  { example: 'buff = attack', means: 'the stat its +10% roll landed on.' },
  { example: 'debuff = speed', means: 'the stat that took the −10%.' },
  { example: 'rarity = 5', means: 'by rarity, 1 to 6.' },
  { example: 'stage = 2', means: 'by evolution stage.' },
  { example: 'type = mystic & attack > 70', means: 'join filters with & and all of them have to hold.' },
  { example: 'toxi & level > 5', means: 'a plain name still works, on its own or as one of the terms.' }
];
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
/**
 * The last resort when six rarity rolls all landed on an empty tier.
 *
 * During a takeover the unlocked Galactic rarities may not cover the tier that
 * was drawn, so the fallback has to come from the same pool the buckets did —
 * otherwise the event would leak an Elemental Awakening spawn. `DB.spawnable` is
 * only reached if even that is empty, and it deliberately ignores restrictions:
 * handing back nothing at all would leave a map point with no creature in it.
 */
function spawnFallback(now) {
  const flat = spawnPoolList(now);
  const list = flat.length ? flat : DB.spawnable;
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

export function rollSpawnSpecies(weights = RARITY_WEIGHTS, now = new Date()) {
  const buckets = spawnPoolByRarity(now);
  for (let attempt = 0; attempt < 6; attempt++) {
    const pool = buckets[rollRarityWith(weights)];
    if (pool?.length) return pool[Math.floor(Math.random() * pool.length)];
  }
  return spawnFallback(now);
}

/**
 * What a creature point or an incense spawn turns into.
 *
 * Identical to `rollSpawnSpecies` except during the Creature Spotlight hour:
 * when the drawn rarity happens to match the featured creature's rarity, there
 * is a `SPOTLIGHT_SUBSTITUTE_CHANCE` that the spawn becomes that creature
 * instead of a normal pick from the tier. Any other rarity is left completely
 * alone, so the tier odds themselves never move — only which rarity-N creature
 * you meet changes, and only half the time.
 *
 * Eggs and raids deliberately keep using `rollSpawnSpecies`: the spotlight is
 * about what walks past you on the map.
 */
export function rollWildSpecies(weights = RARITY_WEIGHTS, now = new Date()) {
  // The featured creature still has to be in season. A spotlight cannot conjure
  // a creature the weather says is not around.
  const spotlit = isCreatureSpotlight(now) ? spotlightSpecies(now) : null;
  const featured = spotlit && canSpawnNow(spotlit, now) ? spotlit : null;
  const featuredRarity = featured ? (featured.rarity || familyRarity(featured.id) || 1) : 0;
  const buckets = spawnPoolByRarity(now);

  for (let attempt = 0; attempt < 6; attempt++) {
    const tier = rollRarityWith(weights);
    if (featured && tier === featuredRarity && chance(SPOTLIGHT_SUBSTITUTE_CHANCE)) {
      return featured;
    }
    const pool = buckets[tier];
    if (pool?.length) return pool[Math.floor(Math.random() * pool.length)];
  }
  return spawnFallback(now);
}

/**
 * The pool an annual event's hourly creature is drawn from, as rarity buckets.
 *
 * Built from the ordinary capturable pool, so it already excludes Exclusives and
 * Mythicals and already honours which sets you have unlocked. Spawn restrictions
 * are honoured too: an event cannot conjure a creature the weather says is not
 * around.
 *
 * The weekly Galactic takeover is deliberately *not* consulted. An event spawn is
 * a once-an-hour gift with its own odds, and having one Thursday hour a year
 * quietly narrow it to a single set would be a confusing interaction with no
 * upside.
 */
export function eventSpawnPool(spec, now = new Date()) {
  const buckets = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  if (!spec) return buckets;

  // A hand-written cast ignores rarity odds entirely: it is a short list and the
  // point is that you meet those creatures, not that you roll a tier.
  if (spec.list) return buckets;

  const ok = sp => canSpawnNow(sp, now)
    && (!spec.type || sp.type === spec.type);
  for (const r of [1, 2, 3, 4, 5]) buckets[r] = DB.byRarity[r].filter(ok);
  return buckets;
}

/**
 * What an annual event's hourly spawn turns into, or null when it has nothing to
 * give — a cast whose CSV is missing, or a type with nothing unlocked in it yet.
 */
export function rollEventSpawnSpecies(event, now = new Date()) {
  const spec = event?.hourlySpawn;
  if (!spec) return null;

  // Hand-picked casts are a uniform pick from the list.
  if (spec.list) {
    const pool = (DB.eventPools[spec.list] || []).filter(sp => canSpawnNow(sp, now));
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  const buckets = eventSpawnPool(spec, now);
  for (let attempt = 0; attempt < 8; attempt++) {
    const pool = buckets[rollRarityWith(EVENT_SPAWN_WEIGHTS)];
    if (pool?.length) return pool[Math.floor(Math.random() * pool.length)];
  }
  // Every tier the odds landed on was empty — a narrow type early in the game,
  // say. Fall back to anything in the pool rather than skipping the hour.
  const flat = [1, 2, 3, 4, 5].flatMap(r => buckets[r]);
  return flat.length ? flat[Math.floor(Math.random() * flat.length)] : null;
}

/**
 * Weighted pick from the exclusive pool. Only rarities 3, 4 and 5 exist here.
 */
export function rollExclusiveSpecies(weights = EXCLUSIVE_RAID_WEIGHTS) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const pool = DB.exclusiveByRarity[rollRarityWith(weights)];
    if (pool?.length) return pool[Math.floor(Math.random() * pool.length)];
  }
  const all = DB.exclusiveRollable.filter(s => s.stage === 1);
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
 * True inside the Thursday window, and only once something Galactic is
 * unlocked — with an empty pool there would be nothing to take over with, so
 * the event simply does not happen for a player who has not got there yet.
 */
export function isGalacticTakeover(now = new Date()) {
  if (!DB.galacticSpawnable.length) return false;
  return inWeeklyWindow(now, GALACTIC_TAKEOVER_DAY, GALACTIC_TAKEOVER_START, GALACTIC_TAKEOVER_END);
}

/**
 * A signature for everything a spawn restriction can read. Values are rounded
 * so an imperceptible change in the weather does not rebuild the pools, but not
 * so far that a threshold could be crossed without the key moving.
 */
function restrictionCacheKey(now) {
  const w = spawnConditions.weather || {};
  const d = spawnConditions.daily || {};
  const n = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) : 'x');
  return [
    isGalacticTakeover(now) ? 'g' : 'n',
    now.getDay(), now.getHours(),
    n(w.temperature), n(w.cloudCover), n(w.humidity), n(w.precipitation),
    w.isDay === true ? 'd' : w.isDay === false ? 'n' : 'x',
    // A restriction reads whole kilometres, so 100 m of resolution is plenty.
    Math.floor((Number(d.metresToday) || 0) / 100),
    Number(d.gruntsToday) || 0
  ].join('|');
}

/**
 * The pools with anything currently out of season removed.
 *
 * Filtered here, at the one place every ordinary roll already comes through,
 * rather than in each roll: that is what makes a restriction hold for wild
 * spawns, incense, raids and eggs alike without any of them knowing about it.
 */
function restrictedPools(now) {
  const key = restrictionCacheKey(now);
  if (restrictedCache.key === key) return restrictedCache;

  const takeover = isGalacticTakeover(now);
  const baseByRarity = takeover ? DB.galacticByRarity : DB.byRarity;
  const baseList = takeover ? DB.galacticSpawnable : DB.spawnable;
  const ok = sp => canSpawnNow(sp, now);

  const byRarity = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const r of [1, 2, 3, 4, 5]) byRarity[r] = baseByRarity[r].filter(ok);
  restrictedCache = { key, byRarity, list: baseList.filter(ok) };
  return restrictedCache;
}

/**
 * The rarity buckets any ordinary roll should draw from right now.
 *
 * One accessor rather than a check in each roll, so wild spawns, incense,
 * normal raids and ordinary eggs are taken over together or not at all — and
 * honour a creature's spawn restriction together or not at all.
 */
export function spawnPoolByRarity(now = new Date()) {
  return restrictedPools(now).byRarity;
}

/** The flat fallback list matching `spawnPoolByRarity`. */
export function spawnPoolList(now = new Date()) {
  return restrictedPools(now).list;
}

/* ---------------------------------------------------------------
   Creature Spotlight schedule
   --------------------------------------------------------------- */

/**
 * "24/08/2026" -> local midnight on that day.
 *
 * Deliberately hand-parsed: `Date.parse` reads DD/MM/YYYY as a US MM/DD/YYYY
 * and would silently shift most of the rota by months.
 */
function parseDayMonthYear(raw) {
  const m = String(raw ?? '').trim().match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  // Rejects things like 31/02/2026, which would roll into March.
  if (date.getDate() !== Number(d) || date.getMonth() !== Number(mo) - 1) return null;
  return date;
}

/** Local midnight on the Monday of whichever week `d` falls in. */
function mondayOf(d) {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

/** The rota entry covering the week `now` is in, or null. */
export function spotlightEntry(now = new Date()) {
  if (!DB.spotlight.length) return null;
  const key = mondayOf(now).getTime();
  return DB.spotlight.find(e => e.monday === key) || null;
}

/** The featured species this week, or null when the rota does not cover it. */
export function spotlightSpecies(now = new Date()) {
  return spotlightEntry(now)?.species || null;
}

/** True only inside the Monday 18:00–19:00 window, and only with a rota entry. */
export const isCreatureSpotlight = (now = new Date()) =>
  inWeeklyWindow(now, SPOTLIGHT_DAY, SPOTLIGHT_START, SPOTLIGHT_END)
  && !!spotlightSpecies(now);

/**
 * The next spotlight from `now` on, whether or not one is running: the entry,
 * when its hour starts and ends, and whether that is happening right now.
 * Used by the calendar and the info menu.
 */
export function nextSpotlight(now = new Date()) {
  if (!DB.spotlight.length) return null;
  for (const e of DB.spotlight) {
    const start = new Date(e.monday);
    start.setHours(Math.floor(SPOTLIGHT_START), Math.round((SPOTLIGHT_START % 1) * 60), 0, 0);
    const end = new Date(e.monday);
    end.setHours(Math.floor(SPOTLIGHT_END), Math.round((SPOTLIGHT_END % 1) * 60), 0, 0);
    if (end <= now) continue;          // already finished
    return { ...e, start, end, live: now >= start && now < end, startsIn: Math.max(0, start - now) };
  }
  return null;
}

/** Every spotlight from `now` on, for a calendar listing. */
export function upcomingSpotlights(now = new Date(), limit = 8) {
  const out = [];
  for (const e of DB.spotlight) {
    const start = new Date(e.monday);
    start.setHours(Math.floor(SPOTLIGHT_START), Math.round((SPOTLIGHT_START % 1) * 60), 0, 0);
    const end = new Date(e.monday);
    end.setHours(Math.floor(SPOTLIGHT_END), Math.round((SPOTLIGHT_END % 1) * 60), 0, 0);
    if (end <= now) continue;
    out.push({ ...e, start, end, live: now >= start && now < end });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Millis until the spotlight hour closes, or 0 when it is not running. Mirrors
 * the other two events so the chip can count down the same way.
 */
export const spotlightEndsIn = (now = new Date()) =>
  isCreatureSpotlight(now)
    ? weeklyWindowEndsIn(now, SPOTLIGHT_DAY, SPOTLIGHT_START, SPOTLIGHT_END)
    : 0;

/** The times a guaranteed spotlight spawn is due, as Date objects, for today. */
export function spotlightSpawnTimes(now = new Date()) {
  const sp = spotlightSpecies(now);
  if (!sp) return [];
  const rarity = sp.rarity || familyRarity(sp.id) || 1;
  const base = mondayOf(now);
  return spotlightOffsetsFor(rarity).map(min => {
    const t = new Date(base);
    t.setHours(Math.floor(SPOTLIGHT_START), Math.round((SPOTLIGHT_START % 1) * 60) + min, 0, 0);
    return t;
  });
}

/**
 * Which scheduled spotlight spawn is currently due, as an index into the offset
 * list, or -1. A spawn is "due" from its minute until the next one (or the end
 * of the hour), so opening the game at 18:07 still gets the 18:00 one.
 */
export function dueSpotlightSpawn(now = new Date()) {
  if (!isCreatureSpotlight(now)) return -1;
  const times = spotlightSpawnTimes(now);
  let due = -1;
  for (let i = 0; i < times.length; i++) if (times[i] <= now) due = i;
  return due;
}

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
  if (isGalacticTakeover(now)) {
    // `table: null`, like the spotlight: the takeover changes which creatures
    // are behind the odds, never the odds themselves.
    return {
      id: 'galacticTakeover',
      label: GALACTIC_TAKEOVER_LABEL,
      table: null,
      endsIn: weeklyWindowEndsIn(now, GALACTIC_TAKEOVER_DAY, GALACTIC_TAKEOVER_START, GALACTIC_TAKEOVER_END)
    };
  }
  if (isCreatureSpotlight(now)) {
    // `table: null` on purpose — the spotlight biases which creature a creature
    // point becomes, and must not touch the odds of getting one at all.
    return {
      id: 'creatureSpotlight',
      label: SPOTLIGHT_LABEL,
      table: null,
      species: spotlightSpecies(now),
      endsIn: weeklyWindowEndsIn(now, SPOTLIGHT_DAY, SPOTLIGHT_START, SPOTLIGHT_END)
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
  // An event without a table of its own (the Creature Spotlight) leaves the
  // ordinary odds in place rather than blanking them.
  if (event?.table) return event.table;
  return isWeekend(now) ? POI_OUTCOMES_WEEKEND : POI_OUTCOMES;
}

/** Which map-point kind a POI produces this scan. */
export function rollPOIOutcome(now = new Date()) {
  return weightedPick(poiOutcomeTable(now)).kind;
}

/**
 * During Training Dojo Hour there is no ceiling on grunts standing on ordinary
 * POIs — a shop, an amenity, a bus stop. Green space is untouched by the event
 * and keeps MAX_ACTIVE_GRUNTS, because those grunts are scattered across the
 * scan radius instead of standing on a point.
 */
export const poiGruntsAreUncapped = (now = new Date()) => isTrainingDojo(now);

/* ---------------------------------------------------------------
   Calendar

   Every recurring event in one table so the News tab can list what is coming
   without knowing the rules behind each one. `onDay` is given a date at local
   midnight, so it must only ever look at the calendar, never the clock.
   --------------------------------------------------------------- */

export const CALENDAR_EVENTS = [
  /* The annual events first, so a day that has one leads with it: they come round
     once a year and everything else on the list is weekly or daily. Their entries
     are generated from ANNUAL_EVENTS rather than written out again here, so
     retuning a date or a bonus is a one-line change in one place. */
  ...ANNUAL_EVENTS.map(e => ({
    id: e.id,
    label: e.label,
    icon: e.icon,
    allDay: true,
    annual: true,
    onDay: e.onDay,
    blurb: e.blurb
  })),
  {
    id: 'stardustSunday',
    label: STARDUST_SUNDAY_LABEL,
    icon: '✨',
    allDay: true,
    onDay: d => d.getDay() === 0,
    blurb: `Every stardust reward is ×${STARDUST_SUNDAY_MULTIPLIER}, all day.`
  },
  {
    id: 'sweetToothsday',
    label: SWEET_TOOTHSDAY_LABEL,
    icon: '🍬',
    allDay: true,
    onDay: d => d.getDay() === SWEET_TOOTHSDAY_DAY,
    blurb: `Candy from catching, raid catches and hatching is ×${SWEET_TOOTHSDAY_MULTIPLIER}, all day.`
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
    blurb: 'Grunts take over shops and amenities, with no limit on how many of those appear.'
  },
  {
    id: 'galacticTakeover',
    label: GALACTIC_TAKEOVER_LABEL,
    icon: '🛸',
    start: GALACTIC_TAKEOVER_START,
    end: GALACTIC_TAKEOVER_END,
    // Hidden entirely until something Galactic is unlocked, because until then
    // the hour genuinely does nothing.
    onDay: d => d.getDay() === GALACTIC_TAKEOVER_DAY && DB.galacticSpawnable.length > 0,
    blurb: `Spawns, raids and ordinary eggs all come from your unlocked ${GALACTIC_SET_NAME} creatures.`
  },
  {
    id: 'creatureSpotlight',
    // Names the featured creature, which is the only thing anyone wants to know.
    label: d => {
      const sp = spotlightSpecies(d);
      return sp ? `${SPOTLIGHT_LABEL}: ${sp.name}` : SPOTLIGHT_LABEL;
    },
    icon: '🌟',
    art: d => spotlightSpecies(d)?.imagePath || null,
    start: SPOTLIGHT_START,
    end: SPOTLIGHT_END,
    // Only shows on a Monday the rota actually covers.
    onDay: d => d.getDay() === SPOTLIGHT_DAY && !!spotlightSpecies(d),
    blurb: d => {
      const sp = spotlightSpecies(d);
      if (!sp) return '';
      const rarity = sp.rarity || familyRarity(sp.id) || 1;
      const spawns = spotlightOffsetsFor(rarity).length;
      return `${RARITY_NAMES[rarity] || `Rarity ${rarity}`} · far more common for the hour, `
        + `+${SPOTLIGHT_BONUS_CANDY} candy when you catch it, and it comes to you `
        + `${spawns} time${spawns === 1 ? '' : 's'}.`;
    }
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

/**
 * Everything happening on one day, all-day events first then by start time.
 *
 * `label`, `blurb` and `art` may each be a function of the day, because the
 * Creature Spotlight features a different creature every week and a fixed
 * string could not say which.
 */
export function eventsOnDay(date) {
  const day = dayStart(date);
  const resolve = (v, d) => (typeof v === 'function' ? v(d) : v);
  return CALENDAR_EVENTS
    .filter(e => e.onDay(day))
    .map(e => ({
      id: e.id,
      label: resolve(e.label, day),
      icon: e.icon,
      blurb: resolve(e.blurb, day),
      art: resolve(e.art, day) || null,
      allDay: !!e.allDay,
      annual: !!e.annual,
      start: e.start ?? null,
      end: e.end ?? null
    }))
    // Annual first, then the other all-day ones, then by start time.
    .sort((a, b) =>
      Number(!!b.annual) - Number(!!a.annual)
      || Number(!!b.allDay) - Number(!!a.allDay)
      || (a.start ?? 0) - (b.start ?? 0));
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

/**
 * Re-rolls the pair for a creature that already has one, guaranteeing a genuine
 * change: the stat going up is never the one that was going up, and the stat
 * going down is never the one that was going down.
 *
 * Every valid pair is built and then picked from uniformly rather than rolling
 * until one passes. With four stats there are only seven possibilities, and a
 * reject loop on that small a set is both slower and easier to get subtly wrong.
 */
export function rerollStatModifier(prev) {
  const pairs = [];
  for (const up of STAT_KEYS) {
    if (up === prev?.up) continue;
    for (const down of STAT_KEYS) {
      if (down === up || down === prev?.down) continue;
      pairs.push({ up, down });
    }
  }
  // Only reachable if `prev` was nonsense, in which case any fresh pair will do.
  if (!pairs.length) return rollStatModifier();
  return pairs[Math.floor(Math.random() * pairs.length)];
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
 * base -> stat modifier (+/-10%) -> linear per-level growth -> flat additions.
 */
export function statsFor(sp, level = 1, statMod = null, boosts = null, extra = null) {
  const out = {};
  const growth = statGrowthFor(level);
  for (const k of STAT_KEYS) {
    let v = sp.baseStats[k];
    if (statMod) {
      if (statMod.up === k) v *= 1.1;
      if (statMod.down === k) v *= 0.9;
    }
    // Rounded first, then the flat additions, so a +1 booster reads as +1 on
    // screen and a +10 held item reads as +10 at every level.
    out[k] = Math.max(1, Math.round(v * growth))
      + (Number(boosts?.[k]) || 0)
      + (Number(extra?.[k]) || 0);
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
export function rollRaid(now = new Date()) {
  const rarity = rollRaidRarity();
  // Galactic Adventures Take Over swaps the pool, not the rarity odds, so a
  // Thursday raid is the same difficulty with a different creature inside.
  const pool = spawnPoolByRarity(now)[rarity];
  const sp = pool?.length
    ? pool[Math.floor(Math.random() * pool.length)]
    : rollSpawnSpecies(RARITY_WEIGHTS, now);
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
