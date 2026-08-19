/* ============================================================
   items.js — every item, what it does and how it is used
   ============================================================ */

import {
  ITEM_DIR, RULES, SHINY_INCENSE_ODDS,
  SUPER_INCUBATOR, incubatorDiscount, MAX_STAT_BOOSTS
} from './data.js';

/**
 * `use` describes how the player triggers it from the Items tab:
 *   'none'      — consumed automatically by another action (discs)
 *   'creature'  — pick an eligible creature, then it applies (potion / revive)
 *   'timed'     — confirm, then a countdown starts (incense / magnet)
 *   'place'     — dropped onto the map once (breeding centre)
 */
export const ITEMS = {
  capture_disc: {
    id: 'capture_disc',
    name: 'Capturing Disc',
    plural: 'Capturing Discs',
    image: 'Capture disc.png',
    use: 'none',
    order: 1,
    blurb: 'Needed to capture a wild creature. One is used per capture.'
  },
  ultra_disc: {
    id: 'ultra_disc',
    name: 'Ultra Capture Disc',
    plural: 'Ultra Capture Discs',
    image: 'Ultra capture disc.png',
    use: 'none',
    order: 2,
    blurb: 'Needed to capture a raid boss after you beat it. One is used per capture.'
  },
  potion: {
    id: 'potion',
    name: 'Potion',
    plural: 'Potions',
    image: 'Potion.png',
    use: 'creature',
    order: 3,
    heals: 50,
    blurb: 'Restores 50 HP. Cannot be used in battle, or on a creature that has fainted.'
  },
  revive: {
    id: 'revive',
    name: 'Revive',
    plural: 'Revives',
    image: 'Revive.png',
    use: 'creature',
    order: 4,
    blurb: 'Brings a fainted creature back with full HP.'
  },
  full_heal: {
    id: 'full_heal',
    name: 'Full Heal',
    plural: 'Full Heals',
    image: 'full_heal.png',
    use: 'creature',
    order: 4.5,
    blurb: 'Restores a creature to full HP in one go, however hurt it is. Handy when a Potion at a time would take half your bag. It cannot revive a fainted creature — that still needs a Revive.'
  },
  incense: {
    id: 'incense',
    name: 'Incense',
    plural: 'Incenses',
    image: 'incense.png',
    use: 'timed',
    order: 5,
    durationMs: RULES.INCENSE_DURATION_MS,
    blurb: 'For 20 minutes a creature appears where you are standing every 2 minutes. Each one lasts 1 min 30 s.'
  },
  rare_incense: {
    id: 'rare_incense',
    name: 'Rare Incense',
    plural: 'Rare Incenses',
    image: 'rare incense.png',
    use: 'timed',
    order: 5.5,
    durationMs: RULES.INCENSE_DURATION_MS,
    rareOdds: true,
    blurb: 'Works like an Incense — 20 minutes, a creature every 2 minutes lasting 1 min 30 s — but the odds lean hard towards rarer creatures.'
  },
  shiny_incense: {
    id: 'shiny_incense',
    name: 'Shiny Incense',
    plural: 'Shiny Incenses',
    image: 'shiny incense.png',
    use: 'timed',
    order: 5.7,
    durationMs: RULES.INCENSE_DURATION_MS,
    shinyOdds: true,
    blurb: `Works like an Incense — 20 minutes, a creature every 2 minutes lasting 1 min 30 s — but every creature you catch while it burns has a ${Math.round(SHINY_INCENSE_ODDS * 100)}% chance of being shiny. It replaces the usual shiny odds rather than adding to them, so it does not stack with a Shiny Bonanza.`
  },
  stardust_magnet: {
    id: 'stardust_magnet',
    name: 'Stardust Magnet',
    plural: 'Stardust Magnets',
    image: 'stardustmagnet.png',
    use: 'timed',
    order: 6,
    durationMs: RULES.MAGNET_DURATION_MS,
    blurb: `For 15 minutes every creature you catch gives an additional 4× your player level in stardust.`
  },
  breeding_center: {
    id: 'breeding_center',
    name: 'Breeding Centre',
    plural: 'Breeding Centres',
    image: 'breedingcenter.png',
    use: 'place',
    order: 7,
    blurb: 'Pin it to the map once. Leave two creatures of the same species inside to generate candy.'
  },
  incubator: {
    id: 'incubator',
    name: 'Incubator',
    plural: 'Incubators',
    image: 'incubator.png',
    use: 'egg',
    order: 8,
    blurb: 'Reusable. Put an egg in, walk the distance, and it frees up for the next one. It can only hold one egg at a time. You get one at player level 5.'
  },
  single_use_incubator: {
    id: 'single_use_incubator',
    name: 'Single Use Incubator',
    plural: 'Single Use Incubators',
    image: 'single use incubator.png',
    use: 'egg',
    order: 9,
    blurb: 'Holds one egg and is used up the moment you start it. Dropped by raid wins and handed out by several missions.'
  },
  super_incubator: {
    id: 'super_incubator',
    name: 'Super Incubator',
    plural: 'Super Incubators',
    // The only item whose art lives outside the items folder.
    image: 'images/incubator3.png',
    use: 'egg',
    order: 10,
    blurb: `Single use like the one above, but it cuts the distance the egg needs by ${Math.round(incubatorDiscount(SUPER_INCUBATOR) * 100)}% — a 10 km egg hatches after 7.5 km. Dropped by grunt battles and some daily missions.`
  },
  stat_booster: {
    id: 'stat_booster',
    name: 'Stat Booster',
    plural: 'Stat Boosters',
    image: 'stat_booster.png',
    use: 'creature',
    order: 11,
    blurb: `Permanently adds +1 to one stat of one creature — you pick which. It survives levelling up and evolving, and is applied after every other calculation. A creature can hold ${MAX_STAT_BOOSTS} boosts in total across all four stats. Made at the Research Lab from spare candy, and occasionally dropped by grunts.`
  },
  research_lab: {
    id: 'research_lab',
    name: 'Research Lab',
    plural: 'Research Labs',
    // The shipped filename is misspelled; kept as-is rather than renaming assets.
    image: 'resarch_lab.png',
    use: 'place',
    order: 12,
    blurb: 'Pin it to the map once, like a Breeding Centre. Visit it to turn spare candy into Stat Boosters.'
  }
};

export const ITEM_IDS = Object.keys(ITEMS);

/**
 * Every incense variant. They all share the single incense effect slot, so
 * only one can burn at a time — no stacking a Shiny on top of a Rare.
 */
export const INCENSE_ITEMS = ['incense', 'rare_incense', 'shiny_incense'];

export const item = id => ITEMS[id] || null;

/**
 * Item art lives in ITEM_DIR, but an `image` containing a slash is taken as a
 * path from the project root — the Super Incubator's art ships in `images/`.
 */
export const itemImage = id => {
  const it = ITEMS[id];
  if (!it) return '';
  if (it.image.includes('/')) {
    return it.image.split('/').map(encodeURIComponent).join('/');
  }
  return `${ITEM_DIR}/${encodeURIComponent(it.image)}`;
};

export const itemName = (id, qty = 1) => {
  const it = ITEMS[id];
  if (!it) return id;
  return qty === 1 ? it.name : it.plural;
};

/** Items sorted for display in the Items tab. */
export const itemsInOrder = () =>
  ITEM_IDS.map(id => ITEMS[id]).sort((a, b) => a.order - b.order);

/** Turns { capture_disc: 2 } into "2 Capturing Discs". */
export function describeDrop(drop) {
  return Object.entries(drop)
    .map(([id, n]) => `${n} ${itemName(id, n)}`)
    .join(', ');
}
