/* ============================================================
   items.js — the seven items, what they do and how they are used
   ============================================================ */

import { ITEM_DIR, RULES } from './data.js';

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
  }
};

export const ITEM_IDS = Object.keys(ITEMS);

export const item = id => ITEMS[id] || null;

export const itemImage = id => {
  const it = ITEMS[id];
  return it ? `${ITEM_DIR}/${encodeURIComponent(it.image)}` : '';
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
