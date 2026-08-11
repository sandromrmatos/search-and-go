/* ============================================================
   osm.js — OpenStreetMap POI lookup through the Overpass API

   Any node/way/relation carrying a `shop=*` or `amenity=*` tag
   inside the scan radius becomes a candidate spawn point.
   Map data © OpenStreetMap contributors (ODbL).
   ============================================================ */

import { distance } from './geo.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

/** Mirrors sometimes accept a connection and then never answer, so cap each try. */
const PER_REQUEST_TIMEOUT_MS = 12_000;
/** Total time we are willing to spend across all mirrors for one scan. */
const TOTAL_TIMEOUT_MS = 35_000;

/** Cache POI results so repeated scans from the same spot are cheap. */
const CACHE_TTL_MS = 30 * 60_000;
/**
 * Reuse a cached result if the player has drifted less than this from the point
 * it was fetched at. Keeps the 5-minute rescans from hammering Overpass while
 * standing still or wandering a few paces.
 */
const CACHE_REUSE_M = 30;
const MAX_CACHE_ENTRIES = 40;
const cache = new Map(); // key -> { at, pois, centre, radius }

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

function remember(key, lat, lng, radius, pois) {
  cache.set(key, { at: Date.now(), pois, centre: { lat, lng }, radius });
  // Drop the oldest entries if the map grows too far (Map preserves insertion order).
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
}

function buildQuery(lat, lng, radius) {
  const la = lat.toFixed(7), ln = lng.toFixed(7);
  // shops/amenities become creature, item, disc and raid points;
  // parks are where battle grunts hang around.
  return `[out:json][timeout:25];
(
  nwr["shop"](around:${radius},${la},${ln});
  nwr["amenity"](around:${radius},${la},${ln});
  nwr["leisure"="park"](around:${radius},${la},${ln});
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
    (tags.leisure ? prettify(tags.leisure) : null) ||
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
  const hit = force ? null : findReusable(lat, lng, radius);
  if (hit) return hit.pois;

  const body = 'data=' + encodeURIComponent(buildQuery(lat, lng, radius));
  const giveUpAt = Date.now() + TOTAL_TIMEOUT_MS;
  let lastErr = null;

  for (const url of ENDPOINTS) {
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

  // Every mirror failed — fall back to a stale nearby result if we have one.
  const stale = cache.get(key);
  if (stale) return stale.pois;
  throw lastErr || new Error('Could not reach any Overpass server');
}

function hostOf(u) { try { return new URL(u).host; } catch { return u; } }

const PARK_LEISURE = new Set(['park']);

function normalise(json, origin, radius) {
  const out = [];
  const seen = new Set();
  for (const el of json.elements || []) {
    const tags = el.tags || {};
    const isPark = PARK_LEISURE.has(tags.leisure);
    if (!tags.shop && !tags.amenity && !isPark) continue;
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
    // A place tagged as both a shop and a park counts as a shop.
    const kind = tags.shop ? 'shop' : tags.amenity ? 'amenity' : 'park';
    out.push({
      id,
      lat: pt.lat,
      lng: pt.lng,
      name: labelFor(tags),
      kind,
      kindValue: tags.shop || tags.amenity || tags.leisure,
      isPark: kind === 'park',
      distance: d
    });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out;
}

/** Splits a POI list into the shop/amenity points and the parks. */
export function splitPOIs(pois) {
  return {
    places: pois.filter(p => !p.isPark),
    parks: pois.filter(p => p.isPark)
  };
}

export function clearPOICache() { cache.clear(); }
