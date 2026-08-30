/* ============================================================
   battery.js — how much charge the device has left

   One ability rewards a full battery and another rewards a nearly empty one, so
   the game needs a charge level. The Battery Status API provides it, with two
   caveats that shape this whole module:

     • It does not exist on iOS Safari or on Firefox. There, the level is simply
       never known, and — following the same rule as the weather — a clause that
       depends on it never fires rather than guessing. It is not an error and
       nothing is logged at the player.

     • Where it does exist it is a promise that resolves to a live object, so the
       level is cached and kept up to date by its own event rather than being
       awaited at the moment a battle needs it.

   Nothing here ever throws or rejects: the worst case is that `percent` stays
   null forever.
   ============================================================ */

/** 0-100, or null when the device will not say. */
let percent = null;
/** The live BatteryManager, kept so its listener can be removed on reset. */
let manager = null;
let started = false;
let supported = typeof navigator !== 'undefined' && typeof navigator.getBattery === 'function';

const listeners = new Set();
const emit = () => { for (const fn of listeners) { try { fn(percent); } catch {} } };

function read(m) {
  const level = typeof m?.level === 'number' ? m.level : null;
  // The API reports 0-1. Rounded to whole percent, which is all any clause asks
  // for and stops a listener firing on changes nobody can express.
  const next = level == null || !Number.isFinite(level)
    ? null
    : Math.max(0, Math.min(100, Math.round(level * 100)));
  if (next === percent) return;
  percent = next;
  emit();
}

export const Battery = {
  /** True when this device has the API at all. False on iOS and Firefox. */
  get supported() { return supported; },

  /** Charge remaining as a whole percentage, or null if it cannot be read. */
  get percent() { return percent; },

  /** Called with the new percentage whenever it changes. */
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /**
   * Starts watching. Safe to call more than once and safe to call on a device
   * with no support, where it does nothing at all.
   */
  async start() {
    if (started || !supported) return percent;
    started = true;
    try {
      manager = await navigator.getBattery();
      read(manager);
      manager.addEventListener('levelchange', () => read(manager));
    } catch {
      // A browser that has the function but refuses the call — treat exactly
      // like one that never had it.
      supported = false;
      manager = null;
      percent = null;
    }
    return percent;
  },

  /** Test hook: forget everything so the next start really reads again. */
  reset() {
    percent = null;
    manager = null;
    started = false;
  }
};
