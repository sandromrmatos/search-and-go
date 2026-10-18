/* ============================================================
   route.js — planning the Daily Route

   Once a day, the first time the game is open with a location fix, five real
   places are picked and strung into a walk:
     • stop 1 is within DAILY_ROUTE_START_M of where the player opened the game
     • every stop is within DAILY_ROUTE_RADIUS_M of that same spot
     • each leg — stop to next stop — is DAILY_ROUTE_LEG_MIN_M to
       DAILY_ROUTE_LEG_MAX_M long; when the area cannot manage that for every
       leg, the route that comes closest is used
     • no two stops are closer than DAILY_ROUTE_MIN_APART_M, so the walk never
       doubles back to a corner it has already been to

   The places come from the same OpenStreetMap lookup as everything else. Parks
   are left out: a park's position is the middle of a polygon, which may not be
   anywhere you can stand.
   ============================================================ */

import {
  DAILY_ROUTE_STOPS, DAILY_ROUTE_START_M, DAILY_ROUTE_RADIUS_M, DAILY_ROUTE_MIN_APART_M,
  DAILY_ROUTE_LEG_MIN_M, DAILY_ROUTE_LEG_MAX_M
} from './data.js';
import { distance } from './geo.js';
import { fetchPOIs, splitPOIs } from './osm.js';
import { store, dayKey, ROUTE_PLAN_VERSION } from './state.js';

/** How many random walks are tried; the one whose legs fit the band best wins. */
const ROUTE_ATTEMPTS = 250;
/** After a failed or too-sparse attempt, wait this long before trying again. */
const RETRY_MS = 10 * 60_000;

let planning = false;
let lastAttemptAt = 0;

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

  const starts = pool.filter(p => p.fromAnchor <= DAILY_ROUTE_START_M);
  if (!starts.length) return null;

  /* How far a leg is from the wanted DAILY_ROUTE_LEG_MIN_M–MAX_M band: 0 inside
     it, otherwise the metres short or over. A whole route scores the sum of its
     legs, so when the area cannot give a perfect route the one that comes
     closest is kept. */
  const legMiss = d => d < DAILY_ROUTE_LEG_MIN_M ? DAILY_ROUTE_LEG_MIN_M - d
    : d > DAILY_ROUTE_LEG_MAX_M ? d - DAILY_ROUTE_LEG_MAX_M : 0;
  // Stops that are not neighbours on the route still keep `minApart` from each
  // other, so the walk never doubles back to the same corner.
  const farEnough = (p, chosen) => chosen.every(c => distance(c, p) >= minApart);

  let best = null, bestScore = Infinity;
  for (let attempt = 0; attempt < ROUTE_ATTEMPTS && bestScore > 0; attempt++) {
    const chosen = [starts[Math.floor(Math.random() * starts.length)]];
    let score = 0;
    while (chosen.length < DAILY_ROUTE_STOPS) {
      const last = chosen[chosen.length - 1];
      const options = pool
        .filter(p => !chosen.some(c => c.id === p.id) && farEnough(p, chosen))
        .map(p => ({ p, miss: legMiss(distance(last, p)) }));
      if (!options.length) break;
      // Anything inside the band, at random; otherwise the closest to it, with
      // a little randomness so repeated attempts explore different walks.
      const lowest = Math.min(...options.map(o => o.miss));
      const near = options.filter(o => o.miss <= lowest + (lowest === 0 ? 0 : 5));
      const pick = near[Math.floor(Math.random() * near.length)];
      chosen.push(pick.p);
      score += pick.miss;
    }
    if (chosen.length === DAILY_ROUTE_STOPS && score < bestScore) {
      best = chosen;
      bestScore = score;
    }
  }
  if (best) return best.map(p => ({ poiId: p.id, lat: p.lat, lng: p.lng, name: p.name }));
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
      v: ROUTE_PLAN_VERSION,
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
