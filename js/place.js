/* ============================================================
   place.js — what the place you are standing in is called

   Used for one thing: stamping "Manchester, United Kingdom" on a creature when
   you catch it, so your storage remembers where each one came from.

   The same care the weather takes applies here, for the same reason:

     • The position is rounded to COORD_DECIMALS before it is sent, which is
       about a kilometre. A city name does not need better than that, and the
       exact spot never leaves the device.

     • Answers are cached against that rounded position, so walking around a
       town is one lookup rather than one per capture. The cache is in memory
       only — it is a nicety, not something worth persisting.

     • Nothing here ever throws or rejects. A failed lookup means a creature is
       stamped with a date and no place, which is the same as it always was.

   Reverse geocoding is from BigDataCloud's client-side endpoint, which is meant
   to be called from a browser, needs no key and no account, and is free at this
   volume. If it is unreachable the feature simply goes quiet.
   ============================================================ */

const ENDPOINT = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

/** Matches the weather module: about a kilometre, deliberately imprecise. */
const COORD_DECIMALS = 2;

const REQUEST_TIMEOUT_MS = 8000;
/** How long a failure is respected before trying again. */
const RETRY_AFTER_FAIL_MS = 60_000;

/** roundedKey -> { city, country } */
const cache = new Map();
let failedAt = 0;
const inFlight = new Map();

const keyFor = (lat, lng) =>
  `${lat.toFixed(COORD_DECIMALS)},${lng.toFixed(COORD_DECIMALS)}`;

/** Trims a value to something worth storing, or null. */
const clean = v => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, 60) : null;
};

async function lookup(lat, lng) {
  const url = `${ENDPOINT}?latitude=${lat}&longitude=${lng}&localityLanguage=en`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    // Several fields can carry the town depending on how the area is mapped.
    // Taken in order of how specific they are, so a village wins over a region.
    const city = clean(j.city) || clean(j.locality) || clean(j.principalSubdivision);
    const country = clean(j.countryName);
    if (!city && !country) throw new Error('nothing usable in the response');
    return { city, country };
  } finally {
    clearTimeout(timer);
  }
}

export const Place = {
  /**
   * The place name for a position, or null if it is not known and cannot be
   * fetched right now. Safe to call on every capture.
   *
   * @returns {Promise<{city:string|null, country:string|null}|null>}
   */
  async at(pos) {
    if (!pos || typeof pos.lat !== 'number' || typeof pos.lng !== 'number') return null;
    const lat = Number(pos.lat.toFixed(COORD_DECIMALS));
    const lng = Number(pos.lng.toFixed(COORD_DECIMALS));
    const key = keyFor(lat, lng);

    if (cache.has(key)) return cache.get(key);
    if (failedAt && Date.now() - failedAt < RETRY_AFTER_FAIL_MS) return null;
    // Two captures in the same second must not both fetch.
    if (inFlight.has(key)) return inFlight.get(key);

    const p = (async () => {
      try {
        const found = await lookup(lat, lng);
        cache.set(key, found);
        failedAt = 0;
        return found;
      } catch {
        failedAt = Date.now();
        return null;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, p);
    return p;
  },

  /**
   * Whatever is already known for a position, without ever going to the network.
   * For the capture path, which must not wait on a lookup before showing the
   * reward screen.
   */
  cachedAt(pos) {
    if (!pos || typeof pos.lat !== 'number' || typeof pos.lng !== 'number') return null;
    return cache.get(keyFor(
      Number(pos.lat.toFixed(COORD_DECIMALS)),
      Number(pos.lng.toFixed(COORD_DECIMALS))
    )) || null;
  },

  /** Test hook. */
  reset() { cache.clear(); inFlight.clear(); failedAt = 0; }
};

/** "Manchester, United Kingdom", or just whichever half is known. */
export function placeLabel(place) {
  if (!place) return '';
  return [place.city, place.country].filter(Boolean).join(', ');
}
