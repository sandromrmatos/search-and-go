/* ============================================================
   weather.js — the current temperature where the player is standing

   Read from Open-Meteo, which is free and needs no key or account:
   https://open-meteo.com  (CC BY 4.0)

   Two things this module is careful about:

     • It sends coordinates to a third party, so they are rounded to
       COORD_DECIMALS first. Roughly a kilometre of precision is far more than
       a temperature needs, and it means the player's exact position never
       leaves the device for this feature.
     • Open-Meteo only recomputes every 15 minutes, so asking more often than
       that would be pure waste. A reading is also reused while the player
       stays within REFETCH_DISTANCE_M of where it was taken.
   ============================================================ */

import { distance } from './geo.js';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

/** Matches Open-Meteo's own 15-minute update interval. */
const REFRESH_MS = 15 * 60_000;
/** How far the player must move before the reading is worth taking again. */
const REFETCH_DISTANCE_M = 2000;
/** ~1 km of precision: plenty for a temperature, and less to hand over. */
const COORD_DECIMALS = 2;
const REQUEST_TIMEOUT_MS = 8000;
/** After a failure, wait this long before trying again rather than every tick. */
const RETRY_AFTER_FAIL_MS = 60_000;

/** { celsius, at, centre } for the last successful read, or null. */
let reading = null;
let inFlight = null;
let failedAt = 0;
let lastError = null;

const listeners = new Set();
const emit = () => { for (const fn of listeners) { try { fn(Weather.celsius); } catch {} } };

function isFresh(pos, now) {
  if (!reading) return false;
  if (now - reading.at >= REFRESH_MS) return false;
  return distance(pos, reading.centre) <= REFETCH_DISTANCE_M;
}

async function fetchTemperature(lat, lng) {
  const url = `${ENDPOINT}?latitude=${lat}&longitude=${lng}`
    + '&current=temperature_2m&temperature_unit=celsius';

  // AbortSignal.timeout is not everywhere yet, so drive the controller by hand.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const c = json?.current?.temperature_2m;
    if (typeof c !== 'number' || !Number.isFinite(c)) {
      throw new Error('No temperature in the response');
    }
    return c;
  } finally {
    clearTimeout(timer);
  }
}

export const Weather = {
  /** Last known temperature in whole degrees Celsius, or null if unknown. */
  get celsius() { return reading ? Math.round(reading.celsius) : null; },

  /** Unrounded, for anything that wants the raw figure. */
  get celsiusExact() { return reading ? reading.celsius : null; },

  /** True once a reading has ever landed. */
  get known() { return reading != null; },

  get error() { return lastError; },

  /** Called with the new temperature whenever a reading lands. */
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /**
   * Reads the temperature for `pos` if the cached one is stale, too far away,
   * or missing. Safe to call as often as you like — on a tick, on every
   * location update — and it never throws.
   *
   * @returns {Promise<number|null>} the temperature, or null if not known yet
   */
  async refresh(pos, { force = false } = {}) {
    if (!pos || typeof pos.lat !== 'number' || typeof pos.lng !== 'number') {
      return this.celsius;
    }
    const now = Date.now();
    if (!force && isFresh(pos, now)) return this.celsius;
    if (!force && failedAt && now - failedAt < RETRY_AFTER_FAIL_MS) return this.celsius;
    // Coalesce: a tick and a location update arriving together must not both fetch.
    if (inFlight) return inFlight;

    const lat = Number(pos.lat.toFixed(COORD_DECIMALS));
    const lng = Number(pos.lng.toFixed(COORD_DECIMALS));

    inFlight = (async () => {
      try {
        const celsius = await fetchTemperature(lat, lng);
        reading = { celsius, at: Date.now(), centre: { lat: pos.lat, lng: pos.lng } };
        failedAt = 0;
        lastError = null;
        emit();
      } catch (e) {
        failedAt = Date.now();
        lastError = e?.name === 'AbortError' ? 'Weather request timed out' : (e?.message || 'Weather unavailable');
        // The old reading is deliberately kept: a stale temperature beats none.
      } finally {
        inFlight = null;
      }
      return this.celsius;
    })();

    return inFlight;
  },

  /** Test/debug hook: drop everything so the next refresh really fetches. */
  reset() {
    reading = null;
    inFlight = null;
    failedAt = 0;
    lastError = null;
  }
};

/** "18°C", or a placeholder while the first reading is still on its way. */
export function temperatureLabel() {
  const c = Weather.celsius;
  return c == null ? '—' : `${c}°C`;
}
