/* ============================================================
   osm.js — OpenStreetMap POI lookup through the Overpass API

   A node/way/relation inside the scan radius becomes a candidate spawn point
   when it carries any of: shop=*, amenity=*, tourism=*, highway=bus_stop,
   building=industrial, building=service, leisure=park or leisure=garden.
   The two leisure values produce grunts; everything else produces loot.
   Map data © OpenStreetMap contributors (ODbL).
   ============================================================ */

import { distance } from './geo.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

/** The mirror that answered most recently, tried first on the next scan. */
let preferredEndpoint = null;

/**
 * Mirrors sometimes accept a connection and then never answer, so cap each try.
 * Kept low enough that all four mirrors fit inside TOTAL_TIMEOUT_MS — at 12 s
 * the budget ran out after three, so the last mirror was never reached.
 */
const PER_REQUEST_TIMEOUT_MS = 9_000;
/** Total time we are willing to spend across all mirrors for one scan. */
const TOTAL_TIMEOUT_MS = 40_000;

/** Cache POI results so repeated scans from the same spot are cheap. */
const CACHE_TTL_MS = 30 * 60_000;
/**
 * Reuse a cached result if the player has drifted less than this from the point
 * it was fetched at. Keeps the 5-minute rescans from hammering Overpass while
 * standing still or wandering a few paces.
 */
const CACHE_REUSE_M = 30;
/**
 * Last-resort reuse distance, used only when every mirror has failed. Far more
 * generous than CACHE_REUSE_M and it ignores the TTL: shops and bus stops do
 * not move, so spawning from POIs fetched a few streets back is much better
 * than telling the player the scan failed and leaving the map empty.
 */
const STALE_FALLBACK_M = 600;
const MAX_CACHE_ENTRIES = 40;
const cache = new Map(); // key -> { at, pois, centre, radius }

/**
 * Whether the POIs handed back by the last fetchPOIs call came from the stale
 * fallback above, and how old they were. Read by the scan so it can say so.
 */
let lastStale = null;
export const lastPOIsWereStale = () => lastStale;

function cacheKey(lat, lng, radius) {
  return `${lat.toFixed(4)},${lng.toFixed(4)},${radius}`;
}

/** Newest still-valid cache entry taken close enough to `lat,lng` to reuse. */
function findReusable(lat, lng, radius) {
  const now = Date.now();
  let best = null, bestDist = Infinity;
  for (const entry of cache.values()) {
    if (entry.radius !== radius) continue;
    if (now - entry.at >= CACHE_TTL_MS) continue;
    const d = distance({ lat, lng }, entry.centre);
    if (d <= CACHE_REUSE_M && d < bestDist) { best = entry; bestDist = d; }
  }
  return best;
}

/**
 * Nearest cached result of any age, for the every-mirror-failed path. Ordered
 * by distance so the player gets the most relevant list available.
 */
function findStale(lat, lng, radius) {
  let best = null, bestDist = Infinity;
  for (const entry of cache.values()) {
    if (entry.radius !== radius) continue;
    if (!entry.pois?.length) continue;
    const d = distance({ lat, lng }, entry.centre);
    if (d <= STALE_FALLBACK_M && d < bestDist) { best = entry; bestDist = d; }
  }
  return best;
}

function remember(key, lat, lng, radius, pois) {
  cache.set(key, { at: Date.now(), pois, centre: { lat, lng }, radius });
  // Drop the oldest entries if the map grows too far (Map preserves insertion order).
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
}

function buildQuery(lat, lng, radius) {
  const la = lat.toFixed(7), ln = lng.toFixed(7);
  // Everything except parks becomes creature, item, disc and raid points;
  // parks and gardens are where battle grunts hang around.
  return `[out:json][timeout:25];
(
  nwr["shop"](around:${radius},${la},${ln});
  nwr["amenity"](around:${radius},${la},${ln});
  nwr["tourism"](around:${radius},${la},${ln});
  nwr["highway"="bus_stop"](around:${radius},${la},${ln});
  nwr["building"="industrial"](around:${radius},${la},${ln});
  nwr["building"="service"](around:${radius},${la},${ln});
  nwr["leisure"="park"](around:${radius},${la},${ln});
  nwr["leisure"="garden"](around:${radius},${la},${ln});
);
out tags center;`;
}

function elementPoint(el) {
  if (typeof el.lat === 'number' && typeof el.lon === 'number') return { lat: el.lat, lng: el.lon };
  if (el.center) return { lat: el.center.lat, lng: el.center.lon };
  return null;
}

function labelFor(tags) {
  return tags.name || tags['name:en'] || tags.brand || tags.operator ||
    (tags.shop ? prettify(tags.shop) : null) ||
    (tags.amenity ? prettify(tags.amenity) : null) ||
    (tags.tourism ? prettify(tags.tourism) : null) ||
    (tags.leisure ? prettify(tags.leisure) : null) ||
    (tags.highway === 'bus_stop' ? 'Bus Stop' : null) ||
    (tags.building ? prettify(tags.building) + ' Building' : null) ||
    'Point of interest';
}

function prettify(v) {
  return String(v).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Fetch shop/amenity POIs around a point.
 * @returns {Promise<Array<{id,lat,lng,name,kind,kindValue}>>}
 */
export async function fetchPOIs(lat, lng, radius = 250, { force = false, signal } = {}) {
  const key = cacheKey(lat, lng, radius);
  lastStale = null;
  const hit = force ? null : findReusable(lat, lng, radius);
  if (hit) return hit.pois;

  const body = 'data=' + encodeURIComponent(buildQuery(lat, lng, radius));
  const giveUpAt = Date.now() + TOTAL_TIMEOUT_MS;
  let lastErr = null;

  // Whichever mirror answered last time goes first: they fail in streaks, and
  // a working one is far more likely to work again than a fixed running order.
  for (const url of endpointsByPreference()) {
    if (Date.now() >= giveUpAt) {
      lastErr = lastErr || new Error('Overpass lookup timed out');
      break;
    }

    const controller = new AbortController();
    const budget = Math.min(PER_REQUEST_TIMEOUT_MS, giveUpAt - Date.now());
    const timer = setTimeout(() => controller.abort(), budget);
    // Let a caller-supplied signal cancel us too.
    const onOuterAbort = () => controller.abort();
    signal?.addEventListener('abort', onOuterAbort, { once: true });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal
      });
      if (!res.ok) { lastErr = new Error(`Overpass ${res.status} at ${hostOf(url)}`); continue; }
      const json = await res.json();
      const pois = normalise(json, { lat, lng }, radius);
      remember(key, lat, lng, radius, pois);
      preferredEndpoint = url;
      return pois;
    } catch (e) {
      // An outer cancellation is fatal; our own timeout just means "try the next mirror".
      if (signal?.aborted) throw Object.assign(new Error('Scan cancelled'), { name: 'AbortError' });
      lastErr = e?.name === 'AbortError'
        ? new Error(`${hostOf(url)} did not respond in ${Math.round(budget / 1000)} s`)
        : e;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }
  }

  // Every mirror failed. Rather than dead-end the scan, reuse the nearest POIs
  // we have at any age — this used to require an exact cache-key match, which
  // while walking almost never hit, so a mirror outage meant no spawns at all.
  const stale = cache.get(key) || findStale(lat, lng, radius);
  if (stale) {
    lastStale = {
      ageMs: Date.now() - stale.at,
      metresAway: Math.round(distance({ lat, lng }, stale.centre)),
      reason: lastErr?.message || 'Overpass unreachable'
    };
    return stale.pois;
  }
  throw lastErr || new Error('Could not reach any Overpass server');
}

/** Mirrors, best-known first. */
function endpointsByPreference() {
  if (!preferredEndpoint) return ENDPOINTS;
  return [preferredEndpoint, ...ENDPOINTS.filter(u => u !== preferredEndpoint)];
}

function hostOf(u) { try { return new URL(u).host; } catch { return u; } }

/**
 * Green space that grunts hang around in. Parks are the busy ones, gardens
 * are much quieter — spawns.js rolls them at different rates.
 */
const PARK_LEISURE = new Set(['park', 'garden']);

/** Only these building values count — most buildings are just houses. */
const BUILDING_KINDS = new Set(['industrial', 'service']);

/**
 * What sort of point this element is, or null when it is not one we use.
 *
 * Order matters. Shops and amenities win so existing behaviour is untouched
 * (a kiosk inside a park stays a shop), and parks are checked before the newer
 * sources because `isPark` routes a POI into the grunt roll instead of the loot
 * roll. Anything that falls through is dropped.
 */
function classify(tags) {
  if (tags.shop) return { kind: 'shop', kindValue: tags.shop };
  if (tags.amenity) return { kind: 'amenity', kindValue: tags.amenity };
  if (PARK_LEISURE.has(tags.leisure)) {
    return { kind: 'park', kindValue: tags.leisure, isPark: true, isGarden: tags.leisure === 'garden' };
  }
  if (tags.tourism) return { kind: 'tourism', kindValue: tags.tourism };
  if (tags.highway === 'bus_stop') return { kind: 'transport', kindValue: 'bus_stop' };
  if (BUILDING_KINDS.has(tags.building)) return { kind: 'building', kindValue: tags.building };
  return null;
}

function normalise(json, origin, radius) {
  const out = [];
  const seen = new Set();
  for (const el of json.elements || []) {
    const tags = el.tags || {};
    // This gate is separate from the query: without it, anything Overpass
    // returns that we do not classify would be parsed and thrown away.
    const info = classify(tags);
    if (!info) continue;
    const isPark = !!info.isPark;
    const pt = elementPoint(el);
    if (!pt) continue;
    // Overpass's `around` filter already guarantees the element's geometry
    // intersects the scan circle. For shops/amenities (points or small
    // buildings) the centre is a fine proxy. But parks are often huge
    // polygons whose centre can be far from the player even when the player
    // is inside the park. So for parks we trust the Overpass match and skip
    // the distance check — the player is inside or within range of the park.
    const d = distance(origin, pt);
    if (!isPark && d > radius) continue;
    const id = `${el.type}/${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      lat: pt.lat,
      lng: pt.lng,
      name: labelFor(tags),
      kind: info.kind,
      kindValue: info.kindValue,
      isPark,
      // Gardens are green space too, but they roll a much lower grunt chance.
      isGarden: !!info.isGarden,
      distance: d
    });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out;
}

/** Splits a POI list into the loot-bearing points and the parks. */
export function splitPOIs(pois) {
  return {
    places: pois.filter(p => !p.isPark),
    parks: pois.filter(p => p.isPark)
  };
}

export function clearPOICache() { cache.clear(); }
