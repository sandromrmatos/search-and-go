/* ============================================================
   spawns.js — deciding what appears on the map, and when

   Rules implemented here (numbers live in RULES / data.js):
     • every shop or amenity within the scan radius rolls one outcome:
         15% creature · 25% discs · 15% items · 5% raid · 40% nothing
     • parks roll separately for a battle grunt (20%)
     • nothing may appear within 25 m of another map point,
       and grunts also keep 50 m from other grunts
     • one point per POI at a time
     • lifetimes: creature/discs/items 15–25 min, raid 25–35, grunt 20–25
     • a collected point stays put, ticked, until its timer runs out
     • the whole thing re-rolls every 5 minutes and on game open
     • incense drops its own 90-second creatures where the player stands
   ============================================================ */

import {
  RULES, randInt, rollSpawnSpecies, rollPOIOutcome, rollDiscDrop, rollItemDrop,
  rollRaid, rollShiny, species, gruntLevelRange, GRUNT_CHARACTERS, GRUNT_PHRASES,
  BATTLE_TEAM_SIZE, DB, chance
} from './data.js';
import { distance } from './geo.js';
import { fetchPOIs, splitPOIs } from './osm.js';
import { store } from './state.js';

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
  const sp = rollSpawnSpecies();
  // Shiny is decided at capture time for wild spawns, so it stays a surprise.
  return { ...basePoint('creature', poi, now), speciesId: sp.id };
}

function makeDiscPoint(poi, now) {
  return { ...basePoint('discs', poi, now), drop: rollDiscDrop() };
}

function makeItemPoint(poi, now) {
  return { ...basePoint('items', poi, now), drop: rollItemDrop() };
}

function makeRaidPoint(poi, now) {
  const raid = rollRaid();
  return {
    ...basePoint('raid', poi, now),
    speciesId: raid.speciesId,
    raid: {
      ...raid,
      // You can see a shiny raid boss before you fight it.
      shiny: rollShiny('raid'),
      defeated: false
    }
  };
}

/** A grunt brings three creatures scaled to the player's level. */
export function buildGruntTeam(playerLevel) {
  const [lo, hi] = gruntLevelRange(playerLevel);
  const pool = DB.species;
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
    const active = store.activePoints(now);
    const occupiedPOIs = new Set(active.map(p => p.poiId));
    const taken = active.map(p => ({ lat: p.lat, lng: p.lng }));
    const gruntSpots = active.filter(p => p.kind === 'grunt').map(p => ({ lat: p.lat, lng: p.lng }));

    const created = [];
    const counts = { creature: 0, discs: 0, items: 0, raid: 0, grunt: 0 };
    const skipped = { occupied: 0, tooClose: 0, nothing: 0, gruntTooClose: 0, gruntRoll: 0 };

    // ---- shops and amenities ----
    for (const poi of places) {
      if (occupiedPOIs.has(poi.id)) { skipped.occupied++; continue; }
      if (tooClose(poi, taken, RULES.MIN_SPAWN_SEPARATION_M)) { skipped.tooClose++; continue; }

      const kind = forceKind || rollPOIOutcome();
      if (kind === 'nothing') { skipped.nothing++; continue; }

      let point = null;
      if (kind === 'creature') point = makeCreaturePoint(poi, now);
      else if (kind === 'discs') point = makeDiscPoint(poi, now);
      else if (kind === 'items') point = makeItemPoint(poi, now);
      else if (kind === 'raid') point = makeRaidPoint(poi, now);
      if (!point) continue;

      created.push(point);
      counts[kind]++;
      occupiedPOIs.add(poi.id);
      taken.push({ lat: poi.lat, lng: poi.lng });
    }

    // ---- parks: battle grunts ----
    for (const park of parks) {
      if (occupiedPOIs.has(park.id)) { skipped.occupied++; continue; }
      if (tooClose(park, taken, RULES.MIN_SPAWN_SEPARATION_M)) { skipped.tooClose++; continue; }
      if (tooClose(park, gruntSpots, RULES.MIN_GRUNT_SEPARATION_M)) { skipped.gruntTooClose++; continue; }
      if (!alwaysGrunt && !chance(RULES.GRUNT_CHANCE)) { skipped.gruntRoll++; continue; }

      const point = makeGruntPoint(park, now, store.level);
      created.push(point);
      counts.grunt++;
      occupiedPOIs.add(park.id);
      taken.push({ lat: park.lat, lng: park.lng });
      gruntSpots.push({ lat: park.lat, lng: park.lng });
    }

    store.s.lastScanAt = now;
    store.s.stats.scans++;
    if (created.length) store.addPoints(created);
    else store.touch('scan', { immediate: true });

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

  const sp = rollSpawnSpecies();
  const point = {
    id: newId('incense'),
    kind: 'creature',
    source: 'incense',
    poiId: 'incense/' + now,
    lat: pos.lat,
    lng: pos.lng,
    poiName: 'Incense',
    poiKind: 'incense',
    poiKindValue: 'incense',
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
  else if (kind === 'grunt') point = makeGruntPoint(poi, now, store.level);
  else {
    point = makeCreaturePoint(poi, now);
    if (speciesId && species(speciesId)) point.speciesId = speciesId;
  }
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
