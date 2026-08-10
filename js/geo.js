/* ============================================================
   geo.js — location tracking, distance maths, debug override
   ============================================================ */

const R_EARTH = 6371008.8; // mean Earth radius, metres

/** Great-circle distance between two {lat,lng} points, in metres. */
export function distance(a, b) {
  if (!a || !b) return Infinity;
  const φ1 = a.lat * Math.PI / 180, φ2 = b.lat * Math.PI / 180;
  const dφ = φ2 - φ1;
  const dλ = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Offset a point by metres north/east — handy for debug spawns. */
export function offsetMeters(point, northM, eastM) {
  const dLat = (northM / R_EARTH) * 180 / Math.PI;
  const dLng = (eastM / (R_EARTH * Math.cos(point.lat * Math.PI / 180))) * 180 / Math.PI;
  return { lat: point.lat + dLat, lng: point.lng + dLng };
}

export function formatDistance(m) {
  if (!isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

/** Parse "51.5079, -0.1283" or "51.5079 -0.1283" into a point. */
export function parseCoords(text) {
  if (!text) return null;
  const nums = String(text).match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return null;
  const lat = Number(nums[0]), lng = Number(nums[1]);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/* ---------------------------------------------------------------
   Location provider
   --------------------------------------------------------------- */
export const Geo = {
  position: null,        // { lat, lng, accuracy, at }
  watchId: null,
  fake: null,            // { lat, lng } when the debug override is active
  error: null,
  listeners: new Set(),

  get usingFake() { return !!this.fake; },

  /** The position the game should use right now (fake wins). */
  get current() {
    if (this.fake) return { lat: this.fake.lat, lng: this.fake.lng, accuracy: 5, at: Date.now(), fake: true };
    return this.position;
  },

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  _emit() { for (const fn of this.listeners) { try { fn(this.current, this); } catch (e) { console.error(e); } } },

  start() {
    if (!('geolocation' in navigator)) {
      this.error = 'Geolocation is not available in this browser.';
      this._emit();
      return;
    }
    if (this.watchId !== null) return;
    this.watchId = navigator.geolocation.watchPosition(
      pos => {
        this.error = null;
        this.position = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          at: pos.timestamp || Date.now()
        };
        this._emit();
      },
      err => {
        this.error = ({
          1: 'Location permission denied. Use the 🛠 debug tools to set a position.',
          2: 'Location unavailable right now.',
          3: 'Location request timed out.'
        })[err.code] || err.message;
        this._emit();
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
  },

  stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  },

  setFake(point) {
    this.fake = point ? { lat: point.lat, lng: point.lng } : null;
    this._emit();
  },

  /** One-shot read, resolving as soon as any position is known. */
  async waitForFix(timeoutMs = 12000) {
    if (this.current) return this.current;
    return new Promise(resolve => {
      const t = setTimeout(() => { off(); resolve(this.current); }, timeoutMs);
      const off = this.onChange(p => { if (p) { clearTimeout(t); off(); resolve(p); } });
      this.start();
    });
  }
};
