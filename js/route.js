/* ============================================================
   route.js — planning the Daily Route

   Once a day, the first time the game is open with a location fix, 8 to 10 real
   places are picked and strung into a walk (how many is fixed by the date):
     • stop 1 is within DAILY_ROUTE_START_M of where the player opened the game
     • every stop is within DAILY_ROUTE_RADIUS_M of that same spot
     • each leg — stop to next stop — is DAILY_ROUTE_LEG_MIN_M to
       DAILY_ROUTE_LEG_MAX_M long; when the area cannot manage that for every
       leg, the route that comes closest is used
     • no leg crosses water: a straight line over a canal is not a walk
     • the walk heads one way: every leg moves forward along the day's heading
       by at least DAILY_ROUTE_MIN_FORWARD_M, zigzagging left and right of it
       as it goes. A walk that only ever moves forward along one axis cannot
       cross itself, and the explicit crossing check below makes sure of it.
     • no two stops are closer than DAILY_ROUTE_MIN_APART_M

   The places come from the same OpenStreetMap lookup as everything else. Parks
   are left out: a park's position is the middle of a polygon, which may not be
   anywhere you can stand.
   ============================================================ */

import {
  DAILY_ROUTE_STOPS_MIN, DAILY_ROUTE_START_M, DAILY_ROUTE_RADIUS_M, DAILY_ROUTE_MIN_APART_M,
  DAILY_ROUTE_LEG_MIN_M, DAILY_ROUTE_LEG_MAX_M, DAILY_ROUTE_MIN_FORWARD_M, dailyRouteStopCount
} from './data.js';
import { distance } from './geo.js';
import { fetchPOIs, splitPOIs, fetchWater } from './osm.js';
import { store, dayKey, ROUTE_PLAN_VERSION } from './state.js';

/** How many random walks are tried; the one whose legs fit best wins. */
const ROUTE_ATTEMPTS = 400;
/** After a failed or too-sparse attempt, wait this long before trying again. */
const RETRY_MS = 10 * 60_000;
/** A leg longer than this is never considered, however sparse the area. */
const LEG_HARD_MAX_M = DAILY_ROUTE_LEG_MAX_M * 2;
/** Score added for a leg that goes the same side of the heading as the last. */
const ZIGZAG_PENALTY = 25;
/** Share of each leg that has to be forward along the heading (cos 60°). */
const MIN_FORWARD_SHARE = 0.5;
/** A leg that barely moves sideways is not much of a zig either. */
const ZIGZAG_MIN_SIDE_M = 8;

let planning = false;
let lastAttemptAt = 0;

/* ---- flat maths ----
   Over a few hundred metres the Earth is flat enough: everything is projected to
   metres east (x) and north (y) of the anchor and handled as plane geometry. */
function projector(anchor) {
  const kx = 111_320 * Math.cos(anchor.lat * Math.PI / 180);
  const ky = 110_540;
  return p => ({ x: (p.lng - anchor.lng) * kx, y: (p.lat - anchor.lat) * ky });
}

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const onSeg = (p, q, r) => Math.min(p.x, r.x) - 1e-9 <= q.x && q.x <= Math.max(p.x, r.x) + 1e-9
  && Math.min(p.y, r.y) - 1e-9 <= q.y && q.y <= Math.max(p.y, r.y) + 1e-9;

/** Whether segment ab touches or crosses segment cd. */
export function segmentsIntersect(a, b, c, d) {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSeg(c, a, d)) return true;
  if (d2 === 0 && onSeg(c, b, d)) return true;
  if (d3 === 0 && onSeg(a, c, b)) return true;
  if (d4 === 0 && onSeg(a, d, b)) return true;
  return false;
}

/**
 * Water as a grid of segments, so a leg is only tested against the water near
 * it. Returns `crosses(a, b)` for projected points.
 */
function waterIndex(lines, project) {
  const CELL = 40;
  const grid = new Map();
  const segs = [];
  for (const line of lines || []) {
    const pts = line.map(project);
    for (let i = 1; i < pts.length; i++) {
      const s = [pts[i - 1], pts[i]];
      const idx = segs.push(s) - 1;
      const x0 = Math.floor(Math.min(s[0].x, s[1].x) / CELL), x1 = Math.floor(Math.max(s[0].x, s[1].x) / CELL);
      const y0 = Math.floor(Math.min(s[0].y, s[1].y) / CELL), y1 = Math.floor(Math.max(s[0].y, s[1].y) / CELL);
      // Very long straight edges (a reservoir's side) are rare; fine to list in every cell.
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
        const k = gx + ',' + gy;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(idx);
      }
    }
  }
  return (a, b) => {
    if (!segs.length) return false;
    const x0 = Math.floor(Math.min(a.x, b.x) / CELL), x1 = Math.floor(Math.max(a.x, b.x) / CELL);
    const y0 = Math.floor(Math.min(a.y, b.y) / CELL), y1 = Math.floor(Math.max(a.y, b.y) / CELL);
    const seen = new Set();
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
      for (const idx of grid.get(gx + ',' + gy) || []) {
        if (seen.has(idx)) continue;
        seen.add(idx);
        const [c, d] = segs[idx];
        if (segmentsIntersect(a, b, c, d)) return true;
      }
    }
    return false;
  };
}

/**
 * Picks `count` stops from a list of POIs, or returns null when the area does
 * not allow a route that size. Pure, so it can be tested on its own.
 *
 * @param {{lat:number,lng:number}} anchor  where the player opened the game
 * @param {Array<{id,lat,lng,name}>} pois
 * @param {object} [opts]
 * @param {number} [opts.count]      how many stops
 * @param {number} [opts.minApart]
 * @param {Array<Array<{lat,lng}>>} [opts.water]  polylines no leg may cross
 */
export function pickRouteStops(anchor, pois, {
  count = DAILY_ROUTE_STOPS_MIN, minApart = DAILY_ROUTE_MIN_APART_M, water = []
} = {}) {
  const project = projector(anchor);
  // One entry per place, inside the circle.
  const seen = new Set();
  const pool = [];
  for (const p of pois) {
    if (!p || !isFinite(p.lat) || !isFinite(p.lng) || seen.has(p.id)) continue;
    const d = distance(anchor, p);
    if (d > DAILY_ROUTE_RADIUS_M) continue;
    seen.add(p.id);
    pool.push({ ...p, fromAnchor: d, xy: project(p) });
  }

  const starts = pool.filter(p => p.fromAnchor <= DAILY_ROUTE_START_M);
  if (!starts.length || pool.length < count) return null;

  const crossesWater = waterIndex(water, project);
  // Each pair is tested against the water at most once, however many attempts use it.
  const wetMemo = new Map();
  const wet = (a, b) => {
    const k = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;
    let v = wetMemo.get(k);
    if (v === undefined) { v = crossesWater(a.xy, b.xy); wetMemo.set(k, v); }
    return v;
  };

  /* How far a leg is from the wanted DAILY_ROUTE_LEG_MIN_M–MAX_M band: 0 inside
     it, otherwise the metres short or over. */
  const legMiss = d => d < DAILY_ROUTE_LEG_MIN_M ? DAILY_ROUTE_LEG_MIN_M - d
    : d > DAILY_ROUTE_LEG_MAX_M ? d - DAILY_ROUTE_LEG_MAX_M : 0;
  const farEnough = (p, chosen) => chosen.every(c => distance(c, p) >= minApart);
  /** The new leg last→p would touch an earlier leg other than the one it joins. */
  const crossesRoute = (chosen, p) => {
    const a = chosen[chosen.length - 1].xy;
    for (let i = 1; i < chosen.length - 1; i++) {
      if (segmentsIntersect(a, p.xy, chosen[i - 1].xy, chosen[i].xy)) return true;
    }
    return false;
  };

  let best = null, bestScore = Infinity;
  for (let attempt = 0; attempt < ROUTE_ATTEMPTS && bestScore > 0; attempt++) {
    // The day's direction for this attempt, and the side the first zig goes.
    const th = Math.random() * Math.PI * 2;
    const u = { x: Math.cos(th), y: Math.sin(th) };   // forward
    const v = { x: -u.y, y: u.x };                     // left
    let side = Math.random() < 0.5 ? 1 : -1;

    const chosen = [starts[Math.floor(Math.random() * starts.length)]];
    let score = 0;
    while (chosen.length < count) {
      const last = chosen[chosen.length - 1];
      const options = [];
      for (const p of pool) {
        if (chosen.includes(p)) continue;
        const dx = p.xy.x - last.xy.x, dy = p.xy.y - last.xy.y;
        const d = Math.hypot(dx, dy);
        if (d > LEG_HARD_MAX_M) continue;
        const fwd = dx * u.x + dy * u.y;
        /* Forward by at least DAILY_ROUTE_MIN_FORWARD_M *and* at least half the
           leg, i.e. within 60° of the heading. Without the second rule a zigzag
           of long sideways legs was the same back-and-forth it replaced. */
        if (fwd < DAILY_ROUTE_MIN_FORWARD_M || fwd < d * MIN_FORWARD_SHARE) continue;
        if (!farEnough(p, chosen)) continue;
        if (crossesRoute(chosen, p)) continue;
        if (wet(last, p)) continue;
        const lat = dx * v.x + dy * v.y;
        const zig = lat * side >= ZIGZAG_MIN_SIDE_M ? 0 : ZIGZAG_PENALTY;
        options.push({ p, miss: legMiss(d) + zig });
      }
      if (!options.length) break;
      // The best few, at random, so repeated attempts explore different walks.
      const lowest = Math.min(...options.map(o => o.miss));
      const near = options.filter(o => o.miss <= lowest + (lowest === 0 ? 0 : 5));
      const pick = near[Math.floor(Math.random() * near.length)];
      chosen.push(pick.p);
      score += pick.miss;
      side = -side;
    }
    if (chosen.length === count && score < bestScore) {
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
    let pois = [], water = [];
    try {
      pois = await fetchPOIs(pos.lat, pos.lng, DAILY_ROUTE_RADIUS_M);
      // No water lookup, no route: better to try again in a few minutes than
      // to send someone across a canal.
      water = await fetchWater(pos.lat, pos.lng, DAILY_ROUTE_RADIUS_M);
    } catch {
      return null;   // not stamped, so the next attempt tries again
    }
    // Checked again on the far side of the await: a save restored, or a day
    // rolled over, while the request was out.
    if (!store.canPlanRoute(new Date(now))) return null;

    const day = dayKey(new Date(now));
    const count = dailyRouteStopCount(day);
    const { places } = splitPOIs(pois);
    // Strict spacing first, then a looser one for a street of small shops.
    const stops = pickRouteStops(pos, places, { count, water })
      || pickRouteStops(pos, places, { count, water, minApart: Math.round(DAILY_ROUTE_MIN_APART_M / 2) });
    if (!stops) return null;

    return store.setDailyRoute({
      v: ROUTE_PLAN_VERSION,
      day,
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
