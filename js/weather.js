/* ============================================================
   weather.js — the current conditions where the player is standing

   Read from Open-Meteo, which is free and needs no key or account:
   https://open-meteo.com  (CC BY 4.0)

   Two things this module is careful about:

     • It sends coordinates to a third party, so they are rounded to
       COORD_DECIMALS first. Roughly a kilometre of precision is far more than
       the weather needs, and it means the player's exact position never
       leaves the device for this feature.
     • Open-Meteo only recomputes every 15 minutes, so asking more often than
       that would be pure waste. A reading is also reused while the player
       stays within REFETCH_DISTANCE_M of where it was taken.

   Only the temperature is on screen permanently; everything else is here for
   the detail panel behind the HUD chip. The ability system reads the
   temperature and nothing else, so adding fields here cannot affect battles.
   ============================================================ */

import { distance } from './geo.js';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

/**
 * The fields worth asking for. All are "current" values. Kept to the ones a
 * player would recognise — no pressure or dew point, which mean little without
 * a forecast to compare against.
 */
const CURRENT_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'precipitation',
  'rain',
  'cloud_cover',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'weather_code',
  'is_day'
];

/** Matches Open-Meteo's own 15-minute update interval. */
const REFRESH_MS = 15 * 60_000;
/** How far the player must move before the reading is worth taking again. */
const REFETCH_DISTANCE_M = 2000;
/** ~1 km of precision: plenty for the weather, and less to hand over. */
const COORD_DECIMALS = 2;
const REQUEST_TIMEOUT_MS = 8000;
/** After a failure, wait this long before trying again rather than every tick. */
const RETRY_AFTER_FAIL_MS = 60_000;

/**
 * WMO weather interpretation codes, which is what `weather_code` returns.
 * https://open-meteo.com/en/docs — the table under "WMO Weather interpretation
 * codes". Grouped rather than exhaustive: 1/2/3 all mean some amount of cloud,
 * and the drizzle and rain families only differ by intensity.
 */
const WEATHER_CODES = {
  0:  { label: 'Clear sky', icon: '☀️' },
  1:  { label: 'Mainly clear', icon: '🌤️' },
  2:  { label: 'Partly cloudy', icon: '⛅' },
  3:  { label: 'Overcast', icon: '☁️' },
  45: { label: 'Fog', icon: '🌫️' },
  48: { label: 'Freezing fog', icon: '🌫️' },
  51: { label: 'Light drizzle', icon: '🌦️' },
  53: { label: 'Drizzle', icon: '🌦️' },
  55: { label: 'Heavy drizzle', icon: '🌦️' },
  56: { label: 'Freezing drizzle', icon: '🌧️' },
  57: { label: 'Freezing drizzle', icon: '🌧️' },
  61: { label: 'Light rain', icon: '🌦️' },
  63: { label: 'Rain', icon: '🌧️' },
  65: { label: 'Heavy rain', icon: '🌧️' },
  66: { label: 'Freezing rain', icon: '🌧️' },
  67: { label: 'Freezing rain', icon: '🌧️' },
  71: { label: 'Light snow', icon: '🌨️' },
  73: { label: 'Snow', icon: '🌨️' },
  75: { label: 'Heavy snow', icon: '❄️' },
  77: { label: 'Snow grains', icon: '🌨️' },
  80: { label: 'Light showers', icon: '🌦️' },
  81: { label: 'Showers', icon: '🌧️' },
  82: { label: 'Violent showers', icon: '⛈️' },
  85: { label: 'Snow showers', icon: '🌨️' },
  86: { label: 'Heavy snow showers', icon: '❄️' },
  95: { label: 'Thunderstorm', icon: '⛈️' },
  96: { label: 'Thunderstorm with hail', icon: '⛈️' },
  99: { label: 'Thunderstorm with hail', icon: '⛈️' }
};

/** The whole reading for the last successful fetch, or null. */
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

/** A finite number from the payload, or null. Zero is a real value, not absent. */
const numOrNull = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

async function fetchCurrent(lat, lng) {
  const url = `${ENDPOINT}?latitude=${lat}&longitude=${lng}`
    + `&current=${CURRENT_FIELDS.join(',')}`
    + '&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm';

  // AbortSignal.timeout is not everywhere yet, so drive the controller by hand.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const cur = json?.current;
    const celsius = numOrNull(cur?.temperature_2m);
    // The temperature is the one field the game actually depends on, so a
    // response without it counts as a failure even if the rest arrived.
    if (celsius == null) throw new Error('No temperature in the response');

    return {
      celsius,
      /**
       * Metres above sea level, which Open-Meteo returns alongside the weather
       * for the grid square it answered with. Free — no extra request and no
       * extra permission — and accurate enough for an ability that asks whether
       * you are up a hill. It is the square's elevation rather than the exact
       * spot's, which is the same rounding the rest of this reading already has.
       */
      elevation: numOrNull(json?.elevation),
      feelsLike: numOrNull(cur.apparent_temperature),
      humidity: numOrNull(cur.relative_humidity_2m),
      precipitation: numOrNull(cur.precipitation),
      rain: numOrNull(cur.rain),
      cloudCover: numOrNull(cur.cloud_cover),
      windSpeed: numOrNull(cur.wind_speed_10m),
      windDirection: numOrNull(cur.wind_direction_10m),
      windGusts: numOrNull(cur.wind_gusts_10m),
      code: numOrNull(cur.weather_code),
      isDay: cur.is_day == null ? null : !!cur.is_day,
      observedAt: cur.time || null
    };
  } finally {
    clearTimeout(timer);
  }
}

export const Weather = {
  /** Last known temperature in whole degrees Celsius, or null if unknown. */
  get celsius() { return reading ? Math.round(reading.celsius) : null; },

  /** Unrounded, for anything that wants the raw figure. */
  get celsiusExact() { return reading ? reading.celsius : null; },

  /** The whole reading, or null. Treat as read-only. */
  get current() { return reading; },

  /** How old the reading is, in milliseconds, or null. */
  get ageMs() { return reading ? Date.now() - reading.at : null; },

  /** True once a reading has ever landed. */
  get known() { return reading != null; },

  get error() { return lastError; },

  /** Called with the new temperature whenever a reading lands. */
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /**
   * Reads the weather for `pos` if the cached reading is stale, too far away,
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
        const current = await fetchCurrent(lat, lng);
        reading = { ...current, at: Date.now(), centre: { lat: pos.lat, lng: pos.lng } };
        failedAt = 0;
        lastError = null;
        emit();
      } catch (e) {
        failedAt = Date.now();
        lastError = e?.name === 'AbortError' ? 'Weather request timed out' : (e?.message || 'Weather unavailable');
        // The old reading is deliberately kept: a stale reading beats none.
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

/**
 * The reading in the shape the condition evaluator in data.js expects, which is
 * not quite the shape Open-Meteo returns: `windSpeed` becomes `wind`, and the
 * temperature is the rounded figure the HUD shows so a clause and the chip can
 * never disagree.
 *
 * Every field is null when unknown, which is what switches a condition off
 * rather than letting it guess. Shared by battles, which judge abilities, and by
 * the spawn pools, which judge which creatures are in season — those two must
 * never read the weather differently.
 */
export function weatherContext(r = Weather.current) {
  return {
    temperature: r ? Math.round(r.celsius) : null,
    cloudCover: r ? r.cloudCover : null,
    humidity: r ? r.humidity : null,
    wind: r ? r.windSpeed : null,
    precipitation: r ? r.precipitation : null,
    // Whether the sun is up, for the daylight condition. null when unknown.
    isDay: r ? r.isDay : null
  };
}

/** Metres above sea level where the player is, or null before a reading lands. */
export const elevationNow = () => Weather.current?.elevation ?? null;

/** "18°C", or a placeholder while the first reading is still on its way. */
export function temperatureLabel() {
  const c = Weather.celsius;
  return c == null ? '—' : `${c}°C`;
}

/** The WMO code as a label and an icon, falling back to the time of day. */
export function conditionOf(r = Weather.current) {
  if (!r) return { label: 'Unknown', icon: '❓' };
  const hit = WEATHER_CODES[r.code];
  if (hit) return hit;
  return { label: 'Unknown', icon: r.isDay === false ? '🌙' : '☀️' };
}

/** 296 -> "WNW". Wind direction is where the wind blows *from*. */
export function compassOf(degrees) {
  if (degrees == null) return null;
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round(((degrees % 360) / 22.5)) % 16];
}

/**
 * The reading as label/value rows, ready to list. Anything the API did not
 * return is left out rather than shown as a blank.
 */
export function weatherRows(r = Weather.current) {
  if (!r) return [];
  const rows = [];
  const add = (icon, label, value) => { if (value != null) rows.push({ icon, label, value }); };

  add('🌡', 'Temperature', `${Math.round(r.celsius)}°C`);
  // Only worth showing when it disagrees with the real temperature.
  if (r.feelsLike != null && Math.round(r.feelsLike) !== Math.round(r.celsius)) {
    add('🤔', 'Feels like', `${Math.round(r.feelsLike)}°C`);
  }
  add(conditionOf(r).icon, 'Conditions', conditionOf(r).label);
  add('☁️', 'Cloud cover', r.cloudCover == null ? null : `${Math.round(r.cloudCover)}%`);
  add('💧', 'Humidity', r.humidity == null ? null : `${Math.round(r.humidity)}%`);
  add('🌧', 'Precipitation', r.precipitation == null
    ? null
    : r.precipitation > 0 ? `${r.precipitation.toFixed(1)} mm` : 'None');
  add('💨', 'Wind', r.windSpeed == null
    ? null
    : `${Math.round(r.windSpeed)} km/h${compassOf(r.windDirection) ? ' ' + compassOf(r.windDirection) : ''}`);
  // Gusts only tell you something when they are meaningfully above the average.
  if (r.windGusts != null && r.windSpeed != null && r.windGusts >= r.windSpeed + 5) {
    add('🌬', 'Gusting to', `${Math.round(r.windGusts)} km/h`);
  }
  add(r.isDay === false ? '🌙' : '🌞', 'Daylight', r.isDay == null
    ? null
    : r.isDay ? 'Daytime' : 'Night');

  return rows;
}
