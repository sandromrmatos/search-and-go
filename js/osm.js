/* ============================================================
   osm.js — OpenStreetMap POI lookup through the Overpass API

   A node/way/relation inside the scan radius becomes a candidate spawn point
   when it carries any of: shop=*, amenity=*, tourism=*, leisure=*, crossing=*,
   highway=crossing, highway=bus_stop, support=pole, power=pole,
   building=industrial, building=service, or landuse=grass.
   (natural=tree is handled too but switched off — see TREES_ENABLED below.)

   Green space produces grunts — leisure=park, leisure=garden and landuse=grass.
   Every other leisure value, and everything else in the list, produces loot.
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
  // Green space becomes battle grunts; everything else becomes creature, item,
  // disc and raid points. `leisure` is fetched wholesale and split in classify,
  // because park and garden are the grunt half of the same key.
  //
  // Trees and poles are `node` rather than `nwr`: they are only ever tagged on
  // nodes, and in a dense area asking for ways and relations as well is a
  // meaningful amount of work for Overpass to do and then find nothing.
  return `[out:json][timeout:25];
(
  nwr["shop"](around:${radius},${la},${ln});
  nwr["amenity"](around:${radius},${la},${ln});
  nwr["tourism"](around:${radius},${la},${ln});
  nwr["leisure"](around:${radius},${la},${ln});
  nwr["crossing"](around:${radius},${la},${ln});
  nwr["highway"="crossing"](around:${radius},${la},${ln});
  nwr["highway"="bus_stop"](around:${radius},${la},${ln});
  ${TREES_ENABLED ? `node["natural"="tree"](around:${radius},${la},${ln});` : ''}
  node["support"="pole"](around:${radius},${la},${ln});
  node["power"="pole"](around:${radius},${la},${ln});
  nwr["building"="industrial"](around:${radius},${la},${ln});
  nwr["building"="service"](around:${radius},${la},${ln});
  nwr["landuse"="grass"](around:${radius},${la},${ln});
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
    (tags.landuse === 'grass' ? 'Grass' : null) ||
    (tags.natural === 'tree' ? 'Tree' : null) ||
    (tags.support === 'pole' ? 'Pole' : null) ||
    (tags.power === 'pole' ? 'Power Pole' : null) ||
    // "Marked Crossing", "Traffic Signals Crossing", or just "Crossing" when
    // the value is a bare yes.
    (tags.crossing
      ? (/^(yes|true)$/i.test(tags.crossing) ? 'Crossing' : prettify(tags.crossing) + ' Crossing')
      : null) ||
    (tags.highway === 'crossing' ? 'Crossing' : null) ||
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
 * Green space that grunts hang around in. Parks are the busy ones; gardens and
 * grass verges are much quieter — spawns.js rolls them at different rates.
 */
const PARK_LEISURE = new Set(['park', 'garden']);

/** Only these building values count — most buildings are just houses. */
const BUILDING_KINDS = new Set(['industrial', 'service']);

/**
 * Trees are switched off.
 *
 * `natural=tree` is by far the densest tag we ever asked for, and in a built-up
 * area the sheer number of extra points made the map itself sluggish. The
 * handling is deliberately left in place rather than deleted, because out in the
 * countryside trees were the difference between a few points and none: flip this
 * back to `true` and they return to both the query and the classifier.
 */
const TREES_ENABLED = false;

/**
 * What sort of point this element is, or null when it is not one we use.
 *
 * Order matters:
 *   - Shops and amenities win, so existing behaviour is untouched (a kiosk
 *     inside a park stays a shop, a bench stays an amenity).
 *   - The green-space checks come before the catch-all `leisure` one, because
 *     `isPark` routes a POI into the grunt roll instead of the loot roll and
 *     park/garden are the grunt half of the same key.
 *   - The rest are loot, in rough order of how specific the tag is.
 * Anything that falls through is dropped.
 */
function classify(tags) {
  if (tags.shop) return { kind: 'shop', kindValue: tags.shop };
  if (tags.amenity) return { kind: 'amenity', kindValue: tags.amenity };

  // ---- green space: grunts ----
  if (PARK_LEISURE.has(tags.leisure)) {
    return { kind: 'park', kindValue: tags.leisure, isPark: true, isGarden: tags.leisure === 'garden' };
  }
  if (tags.landuse === 'grass') {
    return { kind: 'grass', kindValue: 'grass', isPark: true, isGrass: true };
  }

  // ---- everything else: loot ----
  if (tags.tourism) return { kind: 'tourism', kindValue: tags.tourism };
  if (tags.highway === 'bus_stop') return { kind: 'transport', kindValue: 'bus_stop' };
  if (BUILDING_KINDS.has(tags.building)) return { kind: 'building', kindValue: tags.building };
  // Any leisure that is not park or garden: a pitch, a playground, a sports
  // centre, a nature reserve. Those two were handled above.
  if (tags.leisure) return { kind: 'leisure', kindValue: tags.leisure };
  // Dormant unless TREES_ENABLED is turned back on. The gate is here as well as
  // in the query so a tree arriving from the stale POI cache, saved back when
  // they were on, is dropped rather than quietly still spawning.
  if (TREES_ENABLED && tags.natural === 'tree') return { kind: 'nature', kindValue: 'tree' };
  // Street furniture. `support=pole` is the sign/light variety, `power=pole`
  // the electricity one; they behave identically here.
  if (tags.support === 'pole' || tags.power === 'pole') {
    return { kind: 'pole', kindValue: tags.support === 'pole' ? 'pole' : 'power_pole' };
  }
  // Both tagging styles: plenty of crossing nodes carry only highway=crossing
  // with no `crossing` value at all, so matching one key would miss most of them.
  if (tags.crossing || tags.highway === 'crossing') {
    return { kind: 'crossing', kindValue: tags.crossing || 'crossing' };
  }
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
      // And so is a grass verge, on its own rate again.
      isGrass: !!info.isGrass,
      distance: d
    });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out;
}

/** Splits a POI list into the loot-bearing points and the green space. */
export function splitPOIs(pois) {
  return {
    places: pois.filter(p => !p.isPark),
    parks: pois.filter(p => p.isPark)
  };
}

export function clearPOICache() { cache.clear(); }
