/* ============================================================
   route.js — planning the Daily Route

   Once a day, the first time the game is open with a location fix, five real
   places are picked and strung into a walk:
     • stop 1 is within DAILY_ROUTE_START_M of where the player opened the game
     • every stop is within DAILY_ROUTE_RADIUS_M of that same spot
     • no two stops are closer than DAILY_ROUTE_MIN_APART_M
     • each next stop is one of the closest few to the last, so the order reads
       as a walk round the block rather than a zig-zag across it

   The places come from the same OpenStreetMap lookup as everything else. Parks
   are left out: a park's position is the middle of a polygon, which may not be
   anywhere you can stand.
   ============================================================ */

import {
  DAILY_ROUTE_STOPS, DAILY_ROUTE_START_M, DAILY_ROUTE_RADIUS_M, DAILY_ROUTE_MIN_APART_M
} from './data.js';
import { distance } from './geo.js';
import { fetchPOIs, splitPOIs } from './osm.js';
import { store, dayKey } from './state.js';

/** How many of the nearest candidates the next stop is drawn from. */
const NEXT_STOP_CHOICES = 4;
/** After a failed or too-sparse attempt, wait this long before trying again. */
const RETRY_MS = 10 * 60_000;

let planning = false;
let lastAttemptAt = 0;

const shuffle = list => {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * Picks the five stops from a list of POIs, or returns null when the area does
 * not have five suitable places. Pure, so it can be tested on its own.
 *
 * @param {{lat:number,lng:number}} anchor  where the player opened the game
 * @param {Array<{id,lat,lng,name}>} pois
 * @param {number} [minApart]
 */
export function pickRouteStops(anchor, pois, minApart = DAILY_ROUTE_MIN_APART_M) {
  // One entry per place, inside the circle.
  const seen = new Set();
  const pool = [];
  for (const p of pois) {
    if (!p || !isFinite(p.lat) || !isFinite(p.lng) || seen.has(p.id)) continue;
    const d = distance(anchor, p);
    if (d > DAILY_ROUTE_RADIUS_M) continue;
    seen.add(p.id);
    pool.push({ ...p, fromAnchor: d });
  }

  const farEnough = (p, chosen) => chosen.every(c => distance(c, p) >= minApart);

  // A few different starts are tried, because one unlucky first stop can leave
  // too few places far enough from it to finish.
  const starts = shuffle(pool.filter(p => p.fromAnchor <= DAILY_ROUTE_START_M));
  for (const start of starts.slice(0, 8)) {
    const chosen = [start];
    while (chosen.length < DAILY_ROUTE_STOPS) {
      const last = chosen[chosen.length - 1];
      const options = pool
        .filter(p => !chosen.some(c => c.id === p.id) && farEnough(p, chosen))
        .sort((a, b) => distance(last, a) - distance(last, b))
        .slice(0, NEXT_STOP_CHOICES);
      if (!options.length) break;
      chosen.push(options[Math.floor(Math.random() * options.length)]);
    }
    if (chosen.length === DAILY_ROUTE_STOPS) {
      return chosen.map(p => ({ poiId: p.id, lat: p.lat, lng: p.lng, name: p.name }));
    }
  }
  return null;
}

/**
 * Plans today's route if it has not been planned yet. Safe to call every
 * second: it only does anything once a day, and never twice at once.
 *
 * @returns {Promise<object|null>} the new route, or null
 */
export async function planDailyRoute(pos, now = Date.now()) {
  if (!pos || planning) return null;
  if (!store.canPlanRoute(new Date(now))) return null;
  if (now - lastAttemptAt < RETRY_MS) return null;
  planning = true;
  lastAttemptAt = now;
  try {
    let pois = [];
    try {
      pois = await fetchPOIs(pos.lat, pos.lng, DAILY_ROUTE_RADIUS_M);
    } catch {
      return null;   // not stamped, so the next attempt tries again
    }
    // Checked again on the far side of the await: a save restored, or a day
    // rolled over, while the request was out.
    if (!store.canPlanRoute(new Date(now))) return null;

    const { places } = splitPOIs(pois);
    // Strict spacing first, then a looser one for a street of small shops.
    const stops = pickRouteStops(pos, places)
      || pickRouteStops(pos, places, Math.round(DAILY_ROUTE_MIN_APART_M / 2));
    if (!stops) return null;

    return store.setDailyRoute({
      day: dayKey(new Date(now)),
      anchor: { lat: pos.lat, lng: pos.lng },
      stops,
      reached: 0,
      completedAt: 0,
      claimedAt: 0,
      createdAt: now
    });
  } finally {
    planning = false;
  }
}

/** For the debug panel: forget today's route so the next tick plans a new one. */
export function resetRouteRetry() { lastAttemptAt = 0; }
