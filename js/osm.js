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

/*
 * Why this file is built the way it is (October 2026)
 * ---------------------------------------------------
 * The public Overpass servers got much less forgiving during 2026. The main
 * instance (overpass-api.de) is overloaded and now enforces its usage policy:
 * requests must identify the app (a browser's Referer does that), must not run
 * in parallel, and after a 429/406 the client is expected to pause ~30 s. For an
 * app it also asks for a small daily total *summed over every player*. The other
 * mirrors are frequently down (500/502/504) or hang.
 *
 * The old approach — a fresh 150 m query every 90 s scan, reused only within
 * 30 m, cached in memory only — sent far more requests than that, so the game
 * kept hitting rate limits and failed on all mirrors at once. Now:
 *
 *   1. One lookup covers a wide circle (MIN_FETCH_RADIUS_M) and every scan
 *      inside it is served locally, so walking about makes a request roughly
 *      every couple of hundred metres instead of every 90 s.
 *   2. POIs do not move, so a lookup stays good for hours, and the cache is kept
 *      in localStorage so a page reload does not throw it away.
 *   3. Only one request is ever in flight, and a mirror that refuses is left
 *      alone for a while (longer after a 429/406) instead of being retried.
 */

/**
 * NextGIS's keyed instance. It states no request limits for signed-up users,
 * and in October 2026 it kept answering in about a second while every free
 * server below was returning 500/502/504. The key travels in the URL, so it is
 * visible to anyone who opens the page; it is tied to this game's NextGIS
 * account, and can be rotated there if it is ever abused.
 */
const NEXTGIS_KEY = 'my-ojxCS96ehXlOMHv7XctvcB8k1d6WBs9Y';

/**
 * The keyed server first, then the free public instances (per the OSM wiki) as
 * a fallback for when it is down.
 *
 * overpass.kumi.systems used to be listed separately, but it is the old name of
 * private.coffee — the same servers — so trying it straight after private.coffee
 * failed only spent more of the budget on a machine that had just said no.
 */
const ENDPOINTS = [
  `https://overpass.nextgis.com/${NEXTGIS_KEY}/api/interpreter`,
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

/** The mirror that answered most recently, tried first on the next lookup. */
let preferredEndpoint = null;

/** Mirrors sometimes accept a connection and then never answer, so cap each try. */
const PER_REQUEST_TIMEOUT_MS = 15_000;
/**
 * Total time we are willing to spend for one lookup, including waiting out a
 * mirror's cool-down. Mirrors fail in short bursts, so it is worth waiting a
 * little for one to come back rather than giving up after a single pass.
 */
const TOTAL_TIMEOUT_MS = 45_000;

/**
 * How long a mirror is left alone after it fails.
 *
 * Rate-limit answers (429/406) get the 30 s the main instance's policy asks for,
 * doubling to a minute if they keep coming. An outage (5xx, timeout, or the
 * "CORS" error a browser reports when a 500/502 page arrives without CORS
 * headers) gets a short flat wait: those failures come back in well under a
 * second, cost the server almost nothing, and the mirrors tend to recover in
 * seconds. Doubling these to minutes is what once kept the map empty for five
 * minutes after the servers were already answering again.
 */
const COOLDOWN_RATE_LIMITED_MS = 30_000;
const COOLDOWN_RATE_LIMITED_MAX_MS = 60_000;
const COOLDOWN_FAILED_MS = 8_000;
const COOLDOWN_FAILED_MAX_MS = 20_000;
const cooling = new Map(); // url -> { until, strikes }

/**
 * Every lookup asks for at least this radius, even when the caller wants less.
 * A 150 m scan is then served from it locally until the player has walked
 * MIN_FETCH_RADIUS_M - 150 = 250 m from where it was fetched. The extra area
 * costs the server little; the extra requests it saves are what keep us inside
 * the rate limits.
 */
const MIN_FETCH_RADIUS_M = 400;

/**
 * How long a lookup is used without asking again. Shops and bus stops do not
 * move; the 90 s scan re-rolls spawns, it does not need fresh map data.
 */
const CACHE_TTL_MS = 12 * 60 * 60_000;
/**
 * A forced scan (tapping the timer, debug) still reuses a lookup this young.
 * Tapping retry over and over used to send a request per tap.
 */
const FORCE_REFETCH_AGE_MS = 10 * 60_000;
/**
 * Last-resort reuse, only when every mirror has failed: how far the scan circle
 * may be shifted towards a cached area. It ignores the TTL — spawning from POIs
 * fetched a few streets back beats an empty map and a "scan failed" toast.
 */
const STALE_FALLBACK_M = 600;
/** Cached areas older than this are not even used as a last resort. */
const STALE_MAX_AGE_MS = 14 * 24 * 60 * 60_000;
const MAX_CACHE_ENTRIES = 40;
/** How many areas survive a reload. Each one is a few dozen KB in a city. */
const MAX_PERSISTED_ENTRIES = 8;
const STORAGE_KEY = 'sng.poiCache.v2';

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

/**
 * Freshest cached area that wholly contains the circle (lat, lng, radius) and
 * is younger than maxAgeMs. Contained means: every point the caller could be
 * given was inside the area that was fetched.
 */
function findCovering(lat, lng, radius, maxAgeMs) {
  const now = Date.now();
  let best = null;
  for (const entry of cache.values()) {
    if (now - entry.at >= maxAgeMs) continue;
    const d = distance({ lat, lng }, entry.centre);
    if (d + radius > entry.radius) continue;
    if (!best || entry.at > best.at) best = entry;
  }
  return best;
}

/**
 * Cached area of any age (up to STALE_MAX_AGE_MS) the scan circle can be slid
 * into with the smallest shift, for the every-mirror-failed path.
 */
function findStale(lat, lng, radius) {
  const now = Date.now();
  let best = null, bestShift = Infinity;
  for (const entry of cache.values()) {
    if (entry.radius < radius || !entry.pois?.length) continue;
    if (now - entry.at >= STALE_MAX_AGE_MS) continue;
    const shift = Math.max(0, distance({ lat, lng }, entry.centre) - (entry.radius - radius));
    if (shift <= STALE_FALLBACK_M && shift < bestShift) { best = entry; bestShift = shift; }
  }
  return best;
}

function remember(lat, lng, radius, pois) {
  const entry = { at: Date.now(), pois, centre: { lat, lng }, radius };
  const key = cacheKey(lat, lng, radius);
  cache.delete(key); // re-insert so it counts as newest
  cache.set(key, entry);
  // Drop the oldest entries if the map grows too far (Map preserves insertion order).
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  persistCache();
  return entry;
}

/* ---- surviving a reload ----
   Only the newest few areas are written. If the browser refuses for space, try
   again with fewer: losing the oldest area is fine, losing them all is not. */
function persistCache() {
  try {
    const entries = [...cache.values()].slice(-MAX_PERSISTED_ENTRIES);
    for (let n = entries.length; n > 0; n--) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-n)));
        return;
      } catch { /* over quota: drop the oldest and retry */ }
    }
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* no localStorage (private mode etc.): memory-only, as before */ }
}

function loadPersistedCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const now = Date.now();
    for (const e of JSON.parse(raw)) {
      if (!e || !Array.isArray(e.pois) || !e.centre || !(e.radius > 0)) continue;
      if (!(now - e.at < STALE_MAX_AGE_MS)) continue;
      // Stored before TREES_ENABLED was switched off? Drop the trees on the way in.
      const pois = TREES_ENABLED ? e.pois : e.pois.filter(p => p.kind !== 'nature');
      cache.set(cacheKey(e.centre.lat, e.centre.lng, e.radius), { ...e, pois });
    }
  } catch { /* corrupt or unavailable: start empty */ }
}

/**
 * The POIs of a cached area that fall in the circle (lat, lng, radius), nearest
 * first, each with its distance from the caller. Points use their centre; green
 * space uses its bounding box, so a big park the player is standing in still
 * counts even though its middle is far away — the same thing Overpass's own
 * `around` match did when every scan was its own query.
 */
function view(entry, lat, lng, radius, distanceFrom = { lat, lng }) {
  const origin = { lat, lng };
  const out = [];
  for (const p of entry.pois) {
    const reach = p.isPark && p.bounds ? distanceToBounds(origin, p.bounds) : distance(origin, p);
    if (reach > radius) continue;
    const { bounds, ...poi } = p;
    out.push({ ...poi, distance: distance(distanceFrom, p) });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out;
}

/**
 * Like view, but for a cached area the circle does not fit inside: the circle
 * is slid towards the area's centre until it fits, giving the nearest stretch
 * of map we know. Distances are still measured from the player.
 */
function staleView(entry, lat, lng, radius) {
  const d = distance({ lat, lng }, entry.centre);
  const room = Math.max(0, entry.radius - radius);
  if (d <= room) return view(entry, lat, lng, radius);
  const t = room / d; // fraction of the way from the centre to the player
  const sLat = entry.centre.lat + (lat - entry.centre.lat) * t;
  const sLng = entry.centre.lng + (lng - entry.centre.lng) * t;
  return view(entry, sLat, sLng, radius, { lat, lng });
}

/** Metres from a point to the nearest edge of a bounding box (0 inside it). */
function distanceToBounds(pt, b) {
  const lat = Math.min(Math.max(pt.lat, b.minlat), b.maxlat);
  const lng = Math.min(Math.max(pt.lng, b.minlon), b.maxlon);
  return distance(pt, { lat, lng });
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
out tags bb;`;
}

/*
 * `out tags bb` rather than `out tags center`: nodes still come with lat/lon,
 * and ways and relations come with their bounding box instead of its centre.
 * The centre is worked out here (Overpass's `center` is that same bbox centre),
 * and parks keep the box so a cached lookup can still tell whether the player
 * is inside or beside a park whose middle is far away.
 */
function elementPoint(el) {
  if (typeof el.lat === 'number' && typeof el.lon === 'number') return { lat: el.lat, lng: el.lon };
  if (el.bounds) {
    return { lat: (el.bounds.minlat + el.bounds.maxlat) / 2, lng: (el.bounds.minlon + el.bounds.maxlon) / 2 };
  }
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
  lastStale = null;
  const maxAge = force ? FORCE_REFETCH_AGE_MS : CACHE_TTL_MS;
  const hit = findCovering(lat, lng, radius, maxAge);
  if (hit) return view(hit, lat, lng, radius);

  // Past its freshness window but still covering this spot — typically the
  // game reopened the next day where it was last played. Spawn from it now and
  // refresh behind the scenes, rather than leaving the map empty while the
  // servers are slow. The places themselves almost never change.
  const old = findCovering(lat, lng, radius, STALE_MAX_AGE_MS);
  if (old) {
    refreshInBackground(lat, lng, radius);
    return view(old, lat, lng, radius);
  }

  return lookUp(lat, lng, radius, maxAge, signal);
}

/** One background refresh at a time; later requests while it runs are dropped. */
let refreshing = false;
function refreshInBackground(lat, lng, radius) {
  if (refreshing) return;
  refreshing = true;
  lookUp(lat, lng, radius, CACHE_TTL_MS, undefined, { fallback: false })
    .catch(() => { /* the cached copy is still there; the next scan tries again */ })
    .finally(() => { refreshing = false; });
}

/** Cache miss: queue a request, falling back to the nearest stale area. */
function lookUp(lat, lng, radius, maxAge, signal, { fallback = true } = {}) {
  return oneAtATime(async () => {
    // Another lookup may have landed while this one waited its turn — the scan
    // and the daily feather lookup both fire on start-up — and covered us.
    const landed = findCovering(lat, lng, radius, maxAge);
    if (landed) return view(landed, lat, lng, radius);

    const fetchRadius = Math.max(radius, MIN_FETCH_RADIUS_M);
    try {
      const json = await queryOverpass(buildQuery(lat, lng, fetchRadius), signal);
      const entry = remember(lat, lng, fetchRadius, normalise(json, { lat, lng }, fetchRadius));
      return view(entry, lat, lng, radius);
    } catch (err) {
      // A background refresh already has its cached copy on screen, and must
      // not touch lastStale, which belongs to whichever scan reads it next.
      if (signal?.aborted || !fallback) throw err;
      // Every mirror failed. Rather than dead-end the scan, reuse the nearest
      // POIs we have at any age, from this session or an earlier one.
      const stale = findStale(lat, lng, radius);
      if (!stale) throw err;
      lastStale = {
        ageMs: Date.now() - stale.at,
        metresAway: Math.round(Math.max(0, distance({ lat, lng }, stale.centre) - (stale.radius - radius))),
        reason: err?.message || 'Overpass unreachable'
      };
      return staleView(stale, lat, lng, radius);
    }
  });
}

/* ---- one request at a time ----
   The main instance's policy forbids parallel requests from one client, and
   the scan and the daily feather lookup used to race each other on start-up. */
let queueTail = Promise.resolve();
function oneAtATime(task) {
  const run = queueTail.then(task, task);
  queueTail = run.catch(() => {});
  return run;
}

/**
 * Sends one query, trying the mirrors best-known first and waiting out their
 * cool-downs while the budget allows.
 * @returns the parsed Overpass JSON
 */
async function queryOverpass(query, signal) {
  const body = 'data=' + encodeURIComponent(query);
  const giveUpAt = Date.now() + TOTAL_TIMEOUT_MS;
  let lastErr = null;

  while (Date.now() < giveUpAt) {
    const now = Date.now();
    const ready = endpointsByPreference().filter(u => coolingUntil(u) <= now);
    if (!ready.length) {
      // Everyone is resting. Wait for the first to come back, if it does in time.
      const next = Math.min(...ENDPOINTS.map(coolingUntil));
      if (next >= giveUpAt) break;
      await sleep(next - now, signal);
      continue;
    }

    for (const url of ready) {
      const budget = Math.min(PER_REQUEST_TIMEOUT_MS, giveUpAt - Date.now());
      if (budget < 1000) break;
      try {
        const json = await postOnce(url, body, budget, signal);
        cooling.delete(url);
        preferredEndpoint = url;
        return json;
      } catch (e) {
        if (signal?.aborted) throw abortError();
        lastErr = e;
        coolDown(url, e.status);
      }
    }
  }
  throw lastErr || new Error('Overpass lookup timed out');
}

async function postOnce(url, body, budget, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  // Let a caller-supplied signal cancel us too.
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener('abort', onOuterAbort, { once: true });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      // The default, spelt out: Overpass identifies browser apps by the Referer,
      // and a request without one is refused on the main instance.
      referrerPolicy: 'strict-origin-when-cross-origin',
      signal: controller.signal
    });
    if (!res.ok) {
      throw Object.assign(new Error(`Overpass ${res.status} at ${hostOf(url)}`), { status: res.status });
    }
    const json = await res.json();
    // An overloaded server can answer 200 with a runtime error and a partial
    // list. Caching that would hide places for hours, so treat it as a failure.
    if (typeof json?.remark === 'string' && /runtime error|timed out|out of memory/i.test(json.remark)) {
      throw Object.assign(new Error(`Overpass busy at ${hostOf(url)}`), { status: 504 });
    }
    return json;
  } catch (e) {
    if (e?.name === 'AbortError' && !signal?.aborted) {
      throw new Error(`${hostOf(url)} did not respond in ${Math.round(budget / 1000)} s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

function coolDown(url, status) {
  const strikes = (cooling.get(url)?.strikes || 0) + 1;
  const limited = status === 429 || status === 406;
  const ms = limited
    ? Math.min(COOLDOWN_RATE_LIMITED_MS * 2 ** (strikes - 1), COOLDOWN_RATE_LIMITED_MAX_MS)
    : Math.min(COOLDOWN_FAILED_MS * strikes, COOLDOWN_FAILED_MAX_MS);
  cooling.set(url, { until: Date.now() + ms, strikes });
}

function coolingUntil(url) { return cooling.get(url)?.until || 0; }

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const onAbort = () => { clearTimeout(t); reject(abortError()); };
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError() {
  return Object.assign(new Error('Scan cancelled'), { name: 'AbortError' });
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
      // Green space only: lets view() test the park's extent, not its middle.
      ...(isPark && el.bounds ? { bounds: el.bounds } : {}),
      distance: d
    });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out;
}

/* ---------------------------------------------------------------
   Water, for the Daily Route

   The route is drawn as straight lines between stops, so a leg that crosses a
   canal or a river is a leg nobody can walk. Planning asks for the water around
   it once and refuses any leg that crosses it. Lakes, ponds and wide rivers come
   as areas (their outline is what a leg must not cross); rivers, canals and
   streams also come as centre lines. Anything in a culvert or tunnel is left
   out, because you walk over it.

   Asked for once a day at most, so it is cached in memory only.
   --------------------------------------------------------------- */
const WATER_TTL_MS = 6 * 60 * 60_000;
const waterCache = new Map(); // key -> { at, centre, radius, lines }

function buildWaterQuery(lat, lng, radius) {
  const la = lat.toFixed(7), ln = lng.toFixed(7);
  // Clip returned geometry to the circle's bounding box, so a river relation
  // hundreds of kilometres long comes back as just the stretch that matters.
  const dLat = radius / 110_540;
  const dLng = radius / (111_320 * Math.cos(lat * Math.PI / 180));
  const bbox = [lat - dLat, lng - dLng, lat + dLat, lng + dLng].map(v => v.toFixed(6)).join(',');
  return `[out:json][timeout:25];
(
  way["natural"="water"](around:${radius},${la},${ln});
  relation["natural"="water"](around:${radius},${la},${ln});
  way["waterway"~"^(river|canal|stream|riverbank|dock)$"](around:${radius},${la},${ln});
  relation["waterway"~"^(river|canal|riverbank)$"](around:${radius},${la},${ln});
  way["landuse"~"^(reservoir|basin)$"](around:${radius},${la},${ln});
);
out tags geom(${bbox});`;
}

/** Overpass `out geom` JSON → a list of polylines, each [{lat,lng}, ...]. */
function waterLines(json) {
  const lines = [];
  const take = geom => {
    if (!Array.isArray(geom)) return;
    const pts = geom.filter(g => g && isFinite(g.lat) && isFinite(g.lon)).map(g => ({ lat: g.lat, lng: g.lon }));
    if (pts.length >= 2) lines.push(pts);
  };
  for (const el of json.elements || []) {
    const tags = el.tags || {};
    // Underground: a culverted stream or a canal tunnel is walked over.
    if (tags.tunnel && tags.tunnel !== 'no') continue;
    if (tags.location === 'underground') continue;
    if (el.type === 'way') take(el.geometry);
    else if (el.type === 'relation') {
      for (const m of el.members || []) if (m.type === 'way') take(m.geometry);
    }
  }
  return lines;
}

/**
 * The water around a point, as polylines. Throws when every mirror fails, so the
 * caller can wait and try again rather than plan a route across a canal.
 */
export function fetchWater(lat, lng, radius = 400) {
  const now = Date.now();
  for (const e of waterCache.values()) {
    if (now - e.at < WATER_TTL_MS && distance({ lat, lng }, e.centre) + radius <= e.radius) return Promise.resolve(e.lines);
  }
  return oneAtATime(async () => {
    const json = await queryOverpass(buildWaterQuery(lat, lng, radius));
    const lines = waterLines(json);
    waterCache.set(cacheKey(lat, lng, radius), { at: Date.now(), centre: { lat, lng }, radius, lines });
    while (waterCache.size > 4) waterCache.delete(waterCache.keys().next().value);
    return lines;
  });
}

/* ---------------------------------------------------------------
   Streets, for Teleport mode

   Every way you can walk along inside the circle: streets, footways and
   pedestrian areas. Motorways and trunk roads are left out, and so is anything
   marked private. Comes back as ways with their node ids (to join them up) and
   their geometry (to draw and walk them). Cached in memory per spot.
   --------------------------------------------------------------- */
const streetCache = new Map();
const WALKABLE = 'residential|living_street|pedestrian|footway|path|steps|primary|primary_link|secondary|'
  + 'secondary_link|tertiary|tertiary_link|unclassified|service|cycleway|track|corridor';

export function fetchStreets(lat, lng, radius = 1000) {
  const key = cacheKey(lat, lng, radius);
  if (streetCache.has(key)) return Promise.resolve(streetCache.get(key));
  const la = lat.toFixed(7), ln = lng.toFixed(7);
  const q = `[out:json][timeout:40];
way["highway"~"^(${WALKABLE})$"]["access"!~"^(private|no)$"]["foot"!~"^(no|private)$"]["service"!~"^(parking_aisle|driveway)$"](around:${radius},${la},${ln});
out skel geom;`;
  return oneAtATime(async () => {
    const json = await queryOverpass(q);
    const ways = [];
    for (const el of json.elements || []) {
      if (el.type !== 'way' || !Array.isArray(el.nodes) || !Array.isArray(el.geometry)) continue;
      if (el.nodes.length !== el.geometry.length || el.nodes.length < 2) continue;
      ways.push({ nodes: el.nodes, geometry: el.geometry.map(g => ({ lat: g.lat, lng: g.lon })) });
    }
    if (!ways.length) throw new Error('No streets came back');
    streetCache.set(key, ways);
    return ways;
  });
}

/** Splits a POI list into the loot-bearing points and the green space. */
export function splitPOIs(pois) {
  return {
    places: pois.filter(p => !p.isPark),
    parks: pois.filter(p => p.isPark)
  };
}

export function clearPOICache() {
  cache.clear();
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* unavailable */ }
}

// Last, so TREES_ENABLED and the rest are initialised before it runs.
loadPersistedCache();
