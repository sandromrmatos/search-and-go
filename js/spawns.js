/* ============================================================
   spawns.js — deciding what appears on the map, and when

   Rules implemented here (the numbers all live in RULES / data.js):
     • every shop or amenity within the scan radius rolls one outcome:
         22% creature · 28% discs · 15% items · 5% raid · 2% exclusive raid
         (4% at weekends) · the rest nothing
     • two weekly events replace that table for their window: Raid Invasion
       (Wednesdays 18:00-19:00) and Training Dojo Hour (Saturdays 13:30-14:00),
       the latter being the only time a shop can turn into a grunt
     • leisure=park rolls separately for a battle grunt, leisure=garden rolls
       the same way at a lower chance; grunts are scattered on a ring around
       the player, not at the park centre, and are capped per player
     • nothing may appear within MIN_SPAWN_SEPARATION_M of another map point,
       and grunts also keep MIN_GRUNT_SEPARATION_M from other grunts
     • one point per POI at a time
     • lifetimes: creature/discs/items 15–25 min, raid 25–35, grunt 20–25
     • a collected point stays put, ticked, until its timer runs out
     • the whole thing re-rolls every 5 minutes and on game open
     • incense drops its own 90-second creatures where the player stands
   ============================================================ */

import {
  RULES, randInt, rollSpawnSpecies, rollPOIOutcome, rollDiscDrop, rollItemDrop,
  rollRaid, rollExclusiveRaid, rollShiny, species, gruntLevelRange, GRUNT_CHARACTERS, GRUNT_PHRASES,
  BATTLE_TEAM_SIZE, DB, chance, RARE_INCENSE_WEIGHTS, RARITY_WEIGHTS,
  isRaidInvasion, applyRaidInvasionBonus,
  rollWildSpecies, isCreatureSpotlight, spotlightSpecies, dueSpotlightSpawn, familyRarity,
  canSpawnNow,
  hourlySpawnEvent, rollEventSpawnSpecies, EVENT_SPAWN_MS,
  essenceEligible, ESSENCE_MAX_RARITY,
  SPOTLIGHT_LABEL, SPOTLIGHT_SPAWN_MS, ESSENCE_SPAWN_MS
} from './data.js';
import { distance, offsetMeters } from './geo.js';
import { fetchPOIs, splitPOIs } from './osm.js';
import { store, gruntWindowKey, spotlightSlotKey, essenceWindowKey, eventSpawnKey } from './state.js';
import { itemName } from './items.js';

let scanning = false;
export const isScanning = () => scanning;

function newId(prefix) {
  return `${prefix}@${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function lifetimeFor(kind) {
  const [lo, hi] = RULES.LIFETIME_MS[kind] || RULES.LIFETIME_MS.creature;
  return randInt(lo, hi);
}

/* ---------------------------------------------------------------
   Point builders
   --------------------------------------------------------------- */

function basePoint(kind, poi, now) {
  return {
    id: newId(poi.id),
    kind,
    poiId: poi.id,
    lat: poi.lat,
    lng: poi.lng,
    poiName: poi.name,
    poiKind: poi.kind,
    poiKindValue: poi.kindValue,
    createdAt: now,
    expiresAt: now + lifetimeFor(kind),
    collected: false
  };
}

function makeCreaturePoint(poi, now) {
  // rollWildSpecies, not rollSpawnSpecies: during the Creature Spotlight hour a
  // matching rarity has a chance of becoming the featured creature.
  const sp = rollWildSpecies(RARITY_WEIGHTS, new Date(now));
  // Shiny is decided at capture time for wild spawns, so it stays a surprise.
  return { ...basePoint('creature', poi, now), speciesId: sp.id };
}

function makeDiscPoint(poi, now) {
  // The bonus is baked in when the point is created, so a disc point spawned
  // during the invasion still pays it if you reach it a moment after it closes.
  const at = new Date(now);
  const drop = applyRaidInvasionBonus(rollDiscDrop(), at);
  return {
    ...basePoint('discs', poi, now),
    drop,
    invasion: isRaidInvasion(at) || undefined
  };
}

function makeItemPoint(poi, now) {
  return { ...basePoint('items', poi, now), drop: rollItemDrop() };
}

function makeRaidPoint(poi, now, exclusive = false) {
  // The date matters: during Galactic Adventures Take Over a normal raid boss
  // is drawn from the Galactic pool instead of the ordinary one.
  const raid = exclusive ? rollExclusiveRaid() : rollRaid(new Date(now));
  return {
    ...basePoint('raid', poi, now),
    speciesId: raid.speciesId,
    raid: {
      ...raid,
      // You can see a shiny raid boss before you fight it.
      shiny: store.s.debug.shinyBoost
        ? chance(0.5)
        : rollShiny('raid', new Date(now), store.shinyOpts()),
      defeated: false
    }
  };
}

/** A grunt brings three creatures scaled to the player's level. */
export function buildGruntTeam(playerLevel) {
  const [lo, hi] = gruntLevelRange(playerLevel);
  // Whatever is currently in circulation: the main set plus any unlocked
  // Galactic rarities. Exclusives and mythicals are never in here, so a grunt
  // can field a mixed-set team but never something you cannot otherwise meet.
  const pool = DB.available.length ? DB.available : DB.species.filter(s => !s.exclusive);
  const team = [];
  const used = new Set();
  while (team.length < BATTLE_TEAM_SIZE && used.size < pool.length) {
    const sp = pool[Math.floor(Math.random() * pool.length)];
    if (used.has(sp.id)) continue;
    used.add(sp.id);
    team.push({ speciesId: sp.id, level: randInt(lo, hi) });
  }
  return team;
}

function makeGruntPoint(poi, now, playerLevel) {
  const character = GRUNT_CHARACTERS[Math.floor(Math.random() * GRUNT_CHARACTERS.length)];
  return {
    ...basePoint('grunt', poi, now),
    grunt: {
      character: character.id,
      characterLabel: character.label,
      phrase: GRUNT_PHRASES[Math.floor(Math.random() * GRUNT_PHRASES.length)],
      team: buildGruntTeam(playerLevel),
      defeated: false
    }
  };
}

/* ---------------------------------------------------------------
   Placement rules
   --------------------------------------------------------------- */

/** Would a new point here sit too close to something already on the map? */
function tooClose(candidate, taken, minMetres) {
  return taken.some(p => distance(p, candidate) < minMetres);
}

/**
 * Reads a number out of RULES with a fallback. Hand-editing data.js is normal,
 * and a missing key used to silently switch grunts off completely (a loop of
 * `i < undefined` never runs), which is impossible to spot from the map.
 */
function rule(key, fallback) {
  const v = Number(RULES[key]);
  if (Number.isFinite(v) && v > 0) return v;
  if (!warnedRules.has(key)) {
    warnedRules.add(key);
    console.warn(`[spawns] RULES.${key} is missing or invalid — using ${fallback}`);
  }
  return fallback;
}
const warnedRules = new Set();

/**
 * A random point on the ring between `minM` and `maxM` around `pos`.
 * The sqrt spreads points evenly over the ring's area instead of bunching
 * them near the inner edge.
 */
function scatterNear(pos, minM, maxM) {
  const bearing = Math.random() * Math.PI * 2;
  const d = Math.sqrt(minM * minM + Math.random() * (maxM * maxM - minM * minM));
  return offsetMeters(pos, Math.cos(bearing) * d, Math.sin(bearing) * d);
}

/**
 * Finds somewhere in the scan radius to drop a grunt that respects both
 * separation rules. One unlucky spot should not waste a roll, so this tries
 * a number of places before giving up.
 */
function findGruntSpot(pos, taken, gruntSpots) {
  const minM = rule('GRUNT_SPAWN_MIN_M', 15);
  const maxM = Math.max(minM + 1, rule('GRUNT_SPAWN_MAX_M', RULES.SCAN_RADIUS_M || 250));
  const tries = rule('GRUNT_PLACEMENT_TRIES', 24);
  for (let i = 0; i < tries; i++) {
    const pt = scatterNear(pos, minM, maxM);
    if (tooClose(pt, taken, rule('MIN_SPAWN_SEPARATION_M', 15))) continue;
    if (tooClose(pt, gruntSpots, rule('MIN_GRUNT_SEPARATION_M', 20))) continue;
    return pt;
  }
  return null;
}

/* ---------------------------------------------------------------
   Scan
   --------------------------------------------------------------- */

/**
 * Rolls every nearby POI once.
 * @param {{lat:number,lng:number}} pos
 * @param {object} [opts]
 * @param {boolean} [opts.force]        bypass the POI cache
 * @param {string}  [opts.forceKind]    make every POI produce this kind (debug)
 * @param {boolean} [opts.alwaysGrunt]  make every park produce a grunt (debug)
 */
export async function runScan(pos, { force = false, forceKind = null, alwaysGrunt = false } = {}) {
  if (!pos) throw new Error('No location yet');
  if (scanning) return { created: [], pois: 0, busy: true, counts: {}, skipped: {} };
  scanning = true;
  try {
    const pois = await fetchPOIs(pos.lat, pos.lng, RULES.SCAN_RADIUS_M, { force });
    const { places, parks } = splitPOIs(pois);

    const now = Date.now();
    // One clock reading for the whole scan, so a scan that straddles the end of
    // an event cannot use the event table for some POIs and not others.
    const nowDate = new Date(now);
    const active = store.activePoints(now);
    const occupiedPOIs = new Set(active.map(p => p.poiId));
    const taken = active.map(p => ({ lat: p.lat, lng: p.lng }));
    // The once-per-window trainer who walks up to you is deliberately left out
    // of the park bookkeeping: it is an extra, so it must not use up one of
    // the MAX_ACTIVE_GRUNTS slots or push a park grunt out of the way. It is
    // still in `taken`, so nothing else spawns on top of it.
    const parkGrunts = active.filter(p =>
      p.kind === 'grunt' && p.source !== 'window' && p.source !== 'poi');
    // Every live grunt, whatever put it there, so nothing spawns on top of one
    // and they all keep their distance from each other.
    const gruntSpots = active
      .filter(p => p.kind === 'grunt' && p.source !== 'window')
      .map(p => ({ lat: p.lat, lng: p.lng }));
    // Only park grunts count against the park ceiling. A Training Dojo grunt
    // standing on a shop is uncapped by design, so counting it here would let
    // the event starve the parks it is supposed to leave alone.
    let liveParkGrunts = parkGrunts.length;

    const created = [];
    const counts = { creature: 0, discs: 0, items: 0, raid: 0, exraid: 0, grunt: 0 };
    const skipped = { occupied: 0, tooClose: 0, nothing: 0, gruntTooClose: 0, gruntRoll: 0, gruntCap: 0 };

    // ---- shops and amenities ----
    for (const poi of places) {
      if (occupiedPOIs.has(poi.id)) { skipped.occupied++; continue; }
      if (tooClose(poi, taken, RULES.MIN_SPAWN_SEPARATION_M)) { skipped.tooClose++; continue; }

      const kind = forceKind || rollPOIOutcome(nowDate);
      if (kind === 'nothing') { skipped.nothing++; continue; }

      let point = null;
      if (kind === 'creature') point = makeCreaturePoint(poi, now);
      else if (kind === 'discs') point = makeDiscPoint(poi, now);
      else if (kind === 'items') point = makeItemPoint(poi, now);
      else if (kind === 'raid') point = makeRaidPoint(poi, now);
      // An Exclusive Raid is still a raid point — it just carries the
      // exclusive flag, so every raid code path keeps working unchanged.
      else if (kind === 'exraid') point = makeRaidPoint(poi, now, true);
      // Only Training Dojo Hour puts a grunt on a shop or amenity. Unlike a
      // park, the POI's own position is usable, so it stands right there.
      else if (kind === 'grunt') {
        // The event lifts the *count* limit, not the spacing rule: grunts still
        // keep their wider distance from each other, so a run of neighbouring
        // shops cannot produce a wall of them.
        if (tooClose(poi, gruntSpots, RULES.MIN_GRUNT_SEPARATION_M)) {
          skipped.gruntTooClose++;
          continue;
        }
        // Tagged so the park ceiling below can tell the two kinds apart.
        point = { ...makeGruntPoint(poi, now, store.level), source: 'poi' };
      }
      if (!point) continue;

      created.push(point);
      counts[kind]++;
      occupiedPOIs.add(poi.id);
      taken.push({ lat: poi.lat, lng: poi.lng });
      // A dojo grunt is a real grunt: parks must keep their distance from it.
      if (kind === 'grunt') gruntSpots.push({ lat: poi.lat, lng: poi.lng });
    }

    // ---- green space: battle grunts ----
    // Parks, gardens and grass. A park is one POI no matter how big it is, so a
    // single roll would make the middle of a huge park as quiet as a pocket
    // garden. Each one gets several rolls and holds that many grunts, topped up
    // on every scan, scattered across the whole scan radius like any other spawn.
    const rollsPerPark = rule('GRUNT_ROLLS_PER_PARK', 3);
    // Parks keep their ceiling at all times, Training Dojo Hour included. The
    // event is about ordinary POIs taking grunts over; park grunts scatter
    // across the whole scan radius rather than standing on a point, so lifting
    // this would fill the map with grunts standing in the middle of nowhere.
    const maxGrunts = rule('MAX_ACTIVE_GRUNTS', 11);
    // How many live grunts each park is already responsible for.
    const gruntsPerPOI = new Map();
    for (const p of parkGrunts) {
      gruntsPerPOI.set(p.poiId, (gruntsPerPOI.get(p.poiId) || 0) + 1);
    }

    for (const park of parks) {
      const slots = rollsPerPark - (gruntsPerPOI.get(park.id) || 0);
      if (slots <= 0) { skipped.occupied++; continue; }

      // A leisure=garden or a landuse=grass verge is a quieter spot than a
      // full leisure=park, so both roll lower.
      const gruntChance = park.isGarden ? RULES.GARDEN_GRUNT_CHANCE
        : park.isGrass ? RULES.GRASS_GRUNT_CHANCE
        : RULES.GRUNT_CHANCE;

      for (let roll = 0; roll < slots; roll++) {
        if (liveParkGrunts >= maxGrunts) { skipped.gruntCap++; break; }
        if (!alwaysGrunt && !chance(gruntChance)) { skipped.gruntRoll++; continue; }

        const spawnPt = findGruntSpot(pos, taken, gruntSpots);
        if (!spawnPt) { skipped.gruntTooClose++; continue; }

        // Override the POI lat/lng: the park's own centre is not usable.
        const point = {
          ...makeGruntPoint({ ...park, lat: spawnPt.lat, lng: spawnPt.lng }, now, store.level),
          source: 'park'
        };
        created.push(point);
        counts.grunt++;
        liveParkGrunts++;
        taken.push(spawnPt);
        gruntSpots.push(spawnPt);
      }
    }

    store.s.lastScanAt = now;
    store.s.stats.scans++;
    if (created.length) store.addPoints(created);
    else store.touch('scan', { immediate: true });

    // How built-up it is around here, which is the only such measure the game
    // has. Two abilities read it — one rewards a busy street, one a quiet lane.
    store.setPointsScanned(pois.length);

    return { created, pois: pois.length, places: places.length, parks: parks.length, counts, skipped };
  } finally {
    scanning = false;
  }
}

/* ---------------------------------------------------------------
   Incense
   --------------------------------------------------------------- */

/**
 * Incense drops a short-lived creature at the player's feet every two minutes.
 * It deliberately ignores the 25 m spacing rule.
 */
export function tickIncense(pos, now = Date.now()) {
  const fx = store.effect('incense', now);
  if (!fx || !pos) return null;
  if (fx.lastSpawnAt && now - fx.lastSpawnAt < RULES.INCENSE_EVERY_MS) return null;

  // A Rare Incense rolls the same pools against much rarer-leaning weights.
  // A Shiny Incense uses the plain pool — its difference is the shiny roll,
  // which happens at capture time.
  // An incense is a spawn like any other, so the spotlight substitution applies
  // to it too — against the Rare weights when a Rare Incense is burning.
  //
  // A Mysterious Incense skips the roll entirely: the player already chose. If
  // the pinned creature has somehow gone from the data, it falls back to a
  // normal roll rather than spawning nothing for the rest of the burn.
  const pinned = fx.speciesId ? species(fx.speciesId) : null;
  const sp = pinned
    || rollWildSpecies(fx.rare ? RARE_INCENSE_WEIGHTS : RARITY_WEIGHTS, new Date(now));
  const itemId = fx.itemId || 'incense';
  const point = {
    id: newId('incense'),
    kind: 'creature',
    source: 'incense',
    poiId: 'incense/' + now,
    lat: pos.lat,
    lng: pos.lng,
    poiName: itemName(itemId),
    poiKind: 'incense',
    poiKindValue: itemId,
    speciesId: sp.id,
    createdAt: now,
    expiresAt: now + lifetimeFor('incense'),
    collected: false
  };
  fx.lastSpawnAt = now;
  store.addPoints([point]);
  return point;
}

/* ---------------------------------------------------------------
   Spawns that come to you
   --------------------------------------------------------------- */

/**
 * The Creature Spotlight's guaranteed spawn: the featured creature appears on
 * the player's own position at each scheduled minute of the spotlight hour and
 * lives for SPOTLIGHT_SPAWN_MS.
 *
 * Unlike a wild spawn this is never a roll — it is always the featured
 * creature — and like the window grunt it ignores spacing rules entirely.
 *
 * @returns the new point, or null when this slot has already been handed out.
 */
export function spawnSpotlightCreature(pos, now = Date.now()) {
  if (!pos) return null;
  const when = new Date(now);
  if (!isCreatureSpotlight(when)) return null;
  if (!store.canSpawnSpotlight(when)) return null;

  const sp = spotlightSpecies(when);
  if (!sp) return null;
  // A featured creature still has to be in season. Being the spotlight does not
  // override a spawn restriction — the guaranteed visit is simply skipped.
  if (!canSpawnNow(sp, when)) return null;
  const slot = dueSpotlightSpawn(when);

  const point = {
    id: newId('spotlight'),
    kind: 'creature',
    // Tagged so the capture path can pay the spotlight candy bonus and the map
    // can give it its own glow.
    source: 'spotlight',
    poiId: 'spotlight/' + spotlightSlotKey(when, slot),
    lat: pos.lat,
    lng: pos.lng,
    poiName: `${SPOTLIGHT_LABEL}: ${sp.name}`,
    poiKind: 'spotlight',
    poiKindValue: sp.id,
    speciesId: sp.id,
    createdAt: now,
    // A flat five minutes rather than the randomised creature lifetime.
    expiresAt: now + SPOTLIGHT_SPAWN_MS,
    collected: false
  };

  store.addPoints([point]);
  store.markSpotlightSpawned(when, slot);
  return point;
}

/**
 * An annual event's hourly creature: it appears on the player's own position at
 * the top of each clock hour and waits EVENT_SPAWN_MS.
 *
 * Like the spotlight visit this is never a roll against the map — it is a gift —
 * so it ignores the spacing rules and does not use up a point slot. Unlike the
 * spotlight, *which* creature it is does get rolled, on the event's own flattened
 * rarity odds.
 *
 * @returns the new point, or null when no event is running, this hour has already
 *   had its creature, or the event has nothing to give yet.
 */
export function spawnEventCreature(pos, now = Date.now()) {
  if (!pos) return null;
  const when = new Date(now);
  const event = hourlySpawnEvent(when);
  if (!event) return null;
  if (!store.canSpawnEventCreature(event.id, when)) return null;

  const sp = rollEventSpawnSpecies(event, when);
  // A missing cast file or a type with nothing unlocked in it. Deliberately not
  // marked as spawned, so it will try again next hour rather than burning the
  // slot on nothing.
  if (!sp) return null;

  const point = {
    id: newId('event'),
    kind: 'creature',
    // Tagged so the capture path can pay the event's bonus candy and the map can
    // give it its own look.
    source: 'event',
    eventId: event.id,
    poiId: 'event/' + eventSpawnKey(event.id, when),
    lat: pos.lat,
    lng: pos.lng,
    poiName: `${event.label}: a creature has come to you`,
    poiKind: 'event',
    poiKindValue: event.id,
    speciesId: sp.id,
    createdAt: now,
    expiresAt: now + EVENT_SPAWN_MS,
    collected: false
  };

  store.addPoints([point]);
  store.markEventSpawned(event.id, when);
  return point;
}

/**
 * Essence Harvesting: a creature you have already registered turns up somewhere
 * in the scan radius once per two-hour block, and sits there for 30 minutes.
 *
 * Unlike every other spawn this is not rolled from a rarity table — it is a
 * uniform pick from your own registry, so it is always something you have met.
 *
 * @returns the new point, or null when this block already had one.
 */
export function spawnEssence(pos, now = Date.now()) {
  if (!pos) return null;
  const when = new Date(now);
  if (!store.canSpawnEssence(when)) return null;

  const pool = store.essenceCandidates();
  if (!pool.length) return null;
  const sp = pool[Math.floor(Math.random() * pool.length)];

  // Anywhere in the scan radius, but not right on top of something else.
  const active = store.activePoints(now);
  const taken = active.map(p => ({ lat: p.lat, lng: p.lng }));
  let spot = null;
  for (let i = 0; i < rule('GRUNT_PLACEMENT_TRIES', 24); i++) {
    const pt = scatterNear(pos, 10, rule('SCAN_RADIUS_M', 250));
    if (tooClose(pt, taken, rule('MIN_SPAWN_SEPARATION_M', 15))) continue;
    spot = pt;
    break;
  }
  if (!spot) return null;

  const point = makeEssencePoint(sp, spot, now, 'essence/' + essenceWindowKey(when));

  store.addPoints([point]);
  store.markEssenceSpawned(when);
  return point;
}

/** The essence point itself, shared by the real spawn and the debug button. */
function makeEssencePoint(sp, spot, now, poiId) {
  return {
    id: newId('essence'),
    kind: 'essence',
    source: 'essence',
    poiId,
    lat: spot.lat,
    lng: spot.lng,
    poiName: `${sp.name}'s essence`,
    poiKind: 'essence',
    poiKindValue: sp.id,
    speciesId: sp.id,
    createdAt: now,
    expiresAt: now + ESSENCE_SPAWN_MS,
    collected: false
  };
}

/**
 * One grunt trainer turns up standing on the player's own position per 8-hour
 * window (00:00–08:00, 08:00–16:00, 16:00–24:00 local), the first time the
 * game is open during that window. It lives for WINDOW_GRUNT_MS.
 *
 * Unlike a park grunt this ignores GRUNT_SPAWN_MIN_M (the whole point is that
 * it is right on top of you) and is not counted against MAX_ACTIVE_GRUNTS.
 *
 * @returns the new point, or null when this window already had one.
 */
export function spawnWindowGrunt(pos, now = Date.now()) {
  if (!pos) return null;
  const when = new Date(now);
  if (!store.canSpawnWindowGrunt(when)) return null;

  const key = gruntWindowKey(when);
  const point = {
    ...makeGruntPoint({
      id: 'window-grunt/' + key,
      lat: pos.lat,
      lng: pos.lng,
      name: 'A trainer found you',
      kind: 'window',
      kindValue: 'window_grunt'
    }, now, store.level),
    source: 'window',
    // A flat half hour rather than the randomised park-grunt lifetime.
    expiresAt: now + RULES.WINDOW_GRUNT_MS
  };

  store.addPoints([point]);
  store.markWindowGruntSpawned(when);
  return point;
}

/* ---------------------------------------------------------------
   Debug helpers
   --------------------------------------------------------------- */

export function debugPointAt(pos, kind = 'creature', speciesId = null) {
  const now = Date.now();
  const poi = {
    id: 'debug/' + now,
    lat: pos.lat,
    lng: pos.lng,
    name: 'Debug ' + kind,
    kind: 'debug',
    kindValue: 'debug'
  };
  let point;
  if (kind === 'discs') point = makeDiscPoint(poi, now);
  else if (kind === 'items') point = makeItemPoint(poi, now);
  else if (kind === 'raid') point = makeRaidPoint(poi, now);
  else if (kind === 'exraid') point = makeRaidPoint(poi, now, true);
  else if (kind === 'grunt') point = makeGruntPoint(poi, now, store.level);
  else {
    point = makeCreaturePoint(poi, now);
    if (speciesId && species(speciesId)) point.speciesId = speciesId;
  }
  store.addPoints([point]);
  return point;
}

/**
 * A creature of this rarity to harvest. Registered ones come first so the pick
 * matches what the real spawn would have done, but a fresh save has an empty
 * registry, so it falls back to the whole database — otherwise the debug button
 * would do nothing until you had caught something. Either way it honours the
 * rarity ceiling, so the debug button cannot conjure a mythical essence the
 * real spawn would never produce.
 *
 * @param {number|null} rarity 1 to ESSENCE_MAX_RARITY, or null for any.
 */
function pickEssenceSpecies(rarity = null) {
  if (rarity && rarity > ESSENCE_MAX_RARITY) return null;
  const matching = list => list.filter(sp =>
    essenceEligible(sp) && (!rarity || (sp.rarity || familyRarity(sp.id)) === rarity));
  const pick = list => (list.length ? list[Math.floor(Math.random() * list.length)] : null);
  return pick(matching(store.essenceCandidates())) || pick(matching(DB.species));
}

/**
 * Debug: an essence point at your feet for a rarity you choose, so the rings,
 * the drift speed and the candy tiers can all be tried at will.
 *
 * Deliberately skips every gate the real spawn respects — the level check, the
 * registry and the once-per-two-hour-block stamp — so it can be fired as often
 * as you like without using up the block's genuine harvest.
 *
 * @returns the new point, or null when no creature has that rarity.
 */
export function debugEssenceAt(pos, rarity = null) {
  if (!pos) return null;
  const sp = pickEssenceSpecies(Number(rarity) || null);
  if (!sp) return null;
  const now = Date.now();
  const point = makeEssencePoint(sp, pos, now, 'debug-essence/' + now);
  store.addPoints([point]);
  return point;
}

/* ---------------------------------------------------------------
   Timing
   --------------------------------------------------------------- */

export function msUntilNextScan(now = Date.now()) {
  const last = store.s.lastScanAt || 0;
  return Math.max(0, last + RULES.SCAN_INTERVAL_MS - now);
}

export function formatCountdown(ms) {
  if (ms <= 0) return '0:00';
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
