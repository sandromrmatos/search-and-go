/* ============================================================
   spawns.js — deciding where and when creatures appear

   Rules implemented here:
     • every POI (shop=* / amenity=*) inside 100 m is a candidate
     • each candidate rolls a 30% chance to produce a spawn
     • a POI holds at most one spawn at a time
     • no spawn may sit within 5 m of another spawn
     • a spawn lives 10–20 minutes, then vanishes instantly
     • the scan repeats every 10 minutes and on game open
     • spawns persist, so leaving the area (or the game) keeps them alive
   ============================================================ */

import { RULES, randInt, rollSpawnSpecies, species } from './data.js';
import { distance } from './geo.js';
import { fetchPOIs } from './osm.js';
import { store } from './state.js';

let scanning = false;
export const isScanning = () => scanning;

function spawnId(poiId) {
  return `${poiId}@${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Runs one spawn scan around a position.
 *
 * @param {{lat:number,lng:number}} pos
 * @param {object} [opts]
 * @param {number} [opts.chance]  override the 30% roll (debug)
 * @param {boolean} [opts.force]  bypass the POI cache
 * @returns {Promise<{created:Array, pois:Array, candidates:number, skipped:object}>}
 */
export async function runScan(pos, { chance = RULES.SPAWN_CHANCE, force = false } = {}) {
  if (!pos) throw new Error('No location yet');
  if (scanning) return { created: [], pois: [], candidates: 0, skipped: {}, busy: true };
  scanning = true;
  try {
    const pois = await fetchPOIs(pos.lat, pos.lng, RULES.SCAN_RADIUS_M, { force });

    const now = Date.now();
    const active = store.activeSpawns(now);
    const occupiedPOIs = new Set(active.map(s => s.poiId));
    // Spawn points we must stay 5 m away from — existing ones plus any we add now.
    const takenPoints = active.map(s => ({ lat: s.lat, lng: s.lng }));

    const created = [];
    const skipped = { occupied: 0, tooClose: 0, roll: 0 };

    for (const poi of pois) {
      if (occupiedPOIs.has(poi.id)) { skipped.occupied++; continue; }

      const tooClose = takenPoints.some(p => distance(p, poi) < RULES.MIN_SPAWN_SEPARATION_M);
      if (tooClose) { skipped.tooClose++; continue; }

      if (Math.random() >= chance) { skipped.roll++; continue; }

      const sp = rollSpawnSpecies();
      if (!sp) continue;

      const life = randInt(RULES.SPAWN_MIN_MS, RULES.SPAWN_MAX_MS);
      const spawn = {
        id: spawnId(poi.id),
        poiId: poi.id,
        lat: poi.lat,
        lng: poi.lng,
        poiName: poi.name,
        poiKind: poi.kind,
        poiKindValue: poi.kindValue,
        speciesId: sp.id,
        createdAt: now,
        expiresAt: now + life
      };
      created.push(spawn);
      occupiedPOIs.add(poi.id);
      takenPoints.push({ lat: poi.lat, lng: poi.lng });
    }

    store.s.lastScanAt = now;
    store.s.stats.scans++;
    if (created.length) store.addSpawns(created);
    else store.touch('scan', { immediate: true });

    return { created, pois, candidates: pois.length, skipped };
  } finally {
    scanning = false;
  }
}

/** Debug helper: drop a spawn right where the player stands. */
export function debugSpawnAt(pos, speciesId = null) {
  const sp = speciesId ? species(speciesId) : rollSpawnSpecies();
  const now = Date.now();
  const spawn = {
    id: spawnId('debug/' + now),
    poiId: 'debug/' + now,
    lat: pos.lat,
    lng: pos.lng,
    poiName: 'Debug spawn',
    poiKind: 'debug',
    poiKindValue: 'debug',
    speciesId: sp.id,
    createdAt: now,
    expiresAt: now + randInt(RULES.SPAWN_MIN_MS, RULES.SPAWN_MAX_MS)
  };
  store.addSpawns([spawn]);
  return spawn;
}

/** Milliseconds until the next automatic scan is due. */
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
