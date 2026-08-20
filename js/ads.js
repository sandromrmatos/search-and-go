/* ============================================================
   ads.js — rewarded video, behind one small interface

   The game is a web app, so the ad product is Google's Ad Placement API
   (AdSense for HTML5 games), driven through `window.adBreak` / `window.adConfig`
   which index.html defines. See https://developers.google.com/ad-placement/apis

   Everything the Shop needs is funnelled through `Ads.showRewarded()`, and the
   ad is served by whichever provider is available at runtime:

     'adsense'  the Ad Placement API is on the page. This is production.
     'native'   a native shell injected a bridge on `window.SearchAndGoAds`.
                Only used if the game is ever wrapped for an app store.
     'sim'      neither — a clearly labelled stand-in so the Shop is playable
                on localhost, where the real API can never fill.

   Two things worth knowing about the Ad Placement API, because they shape the
   code below:

     1. It uses "inversion of control": `adBreak()` declares a *place* an ad
        could show, and Google decides whether one actually does. When there is
        no ad, none of the callbacks fire except `adBreakDone`. So no-fill is
        detected there, not by asking "is an ad ready".
     2. The reward is only earned when `adViewed` fires. `adDismissed` means the
        player bailed out early and must not be paid.

   Nothing else in the codebase knows what an ad is.
   ============================================================ */

import { el, $ } from './ui.js';

/** How long the stand-in pretends to play, in ms. */
const SIM_MS = 5000;

/**
 * Give up on the Ad Placement API after this long. Without it a blocked or
 * never-loading script would leave the Shop button spinning forever, because
 * queued `adsbygoogle` pushes simply never run.
 */
const ADSENSE_TIMEOUT_MS = 20_000;

/** Resolved reasons the Shop shows a message for. */
export const AD_FAILURES = {
  dismissed: 'Ad closed early — no coin this time.',
  nofill: 'No ad available right now. Try again in a minute.',
  error: 'The ad could not be loaded. Try again in a minute.',
  timeout: 'The ad did not load. Check you are online and try again.',
  busy: 'An ad is already playing.'
};

let playing = false;
let configured = false;

const bridge = () => (typeof window !== 'undefined' ? window.SearchAndGoAds : null) || null;
const hasAdSense = () => typeof window !== 'undefined' && typeof window.adBreak === 'function';

/**
 * `?ads=sim` forces the stand-in, `?ads=real` forces the real thing. Handy for
 * checking the production path from a phone, or the fallback from a live build.
 */
function override() {
  try {
    const v = new URLSearchParams(location.search).get('ads');
    return v === 'sim' || v === 'real' ? v : null;
  } catch { return null; }
}

/**
 * The Ad Placement API only ever fills on an approved, publicly reachable site.
 * On localhost it would no-fill every single time, which makes the Shop
 * impossible to test, so the stand-in wins there instead.
 */
function isLocal() {
  try {
    const h = location.hostname;
    return !h || h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || location.protocol === 'file:';
  } catch { return false; }
}

export const Ads = {
  /** 'native' | 'adsense' | 'sim'. */
  get provider() {
    const forced = override();
    if (forced === 'sim') return 'sim';
    if (bridge()) return 'native';
    if (hasAdSense() && (forced === 'real' || !isLocal())) return 'adsense';
    return 'sim';
  },

  /** True when a real ad network is behind this, so the UI can drop the notice. */
  get isReal() { return this.provider !== 'sim'; },

  /** An ad is on screen right now. */
  get playing() { return playing; },

  /**
   * Whether the next request is likely to fill. The Ad Placement API refuses to
   * answer that by design — it decides per placement — so this is only ever
   * false when a native bridge says its cache is empty.
   */
  get ready() {
    const b = bridge();
    if (!b) return true;
    try { return b.isReady ? !!b.isReady() : true; } catch { return true; }
  },

  /**
   * Tells the ad provider to keep one warm. Safe to call repeatedly and never
   * throws — a failed preload is not worth surfacing to the player.
   */
  preload() {
    const b = bridge();
    if (b?.preload) {
      try { b.preload(); } catch { /* ignore */ }
      return;
    }
    if (!hasAdSense() || configured) return;
    configured = true;
    try {
      // `sound: 'off'` because the game has no music of its own to duck, and
      // preloading keeps the Shop button from waiting on a cold fetch.
      window.adConfig({ preloadAdBreaks: 'on', sound: 'off' });
    } catch (err) {
      configured = false;
      console.warn('[ads] adConfig failed:', err);
    }
  },

  /**
   * Plays one rewarded ad. Resolves `{ ok: true }` only when the reward was
   * actually earned, so a dismissed or unfilled ad never pays out.
   */
  async showRewarded() {
    if (playing) return { ok: false, reason: 'busy' };
    playing = true;
    try {
      const p = this.provider;
      const res = p === 'native' ? await bridge().showRewarded()
        : p === 'adsense' ? await adSenseRewarded()
        : await simulatedAd();
      // Trust nothing: a malformed answer counts as no reward.
      if (res && res.ok === true) return { ok: true };
      return { ok: false, reason: (res && res.reason) || 'dismissed' };
    } catch (err) {
      console.warn('[ads] rewarded ad failed:', err);
      return { ok: false, reason: 'error' };
    } finally {
      playing = false;
      this.preload();
    }
  }
};

/* ---------------------------------------------------------------
   The Ad Placement API

   The player has already opted in by tapping "Watch a video" in the Shop, and
   that button is the reward prompt the policy asks for, so `beforeReward` calls
   `showAdFn()` straight away rather than putting a second prompt on screen.
   --------------------------------------------------------------- */
function adSenseRewarded() {
  return new Promise(resolve => {
    let settled = false;
    let viewed = false;

    const finish = out => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(out);
    };

    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), ADSENSE_TIMEOUT_MS);

    try {
      window.adBreak({
        type: 'reward',
        name: 'shop_coin',

        // No sound or game loop to pause — the Shop is a static list — but the
        // callbacks are still declared so the API has the full placement.
        beforeAd: () => {},
        afterAd: () => {},

        beforeReward: showAdFn => {
          // Already opted in. If this throws, adBreakDone still resolves us.
          try { showAdFn(); } catch (err) { console.warn('[ads] showAdFn failed:', err); }
        },

        adViewed: () => { viewed = true; finish({ ok: true }); },
        adDismissed: () => finish({ ok: false, reason: 'dismissed' }),

        // Always called, even when no ad was shown, so this is what catches
        // a no-fill. If adViewed already ran, this is a no-op.
        adBreakDone: () => finish({ ok: false, reason: viewed ? 'dismissed' : 'nofill' })
      });
    } catch (err) {
      console.warn('[ads] adBreak threw:', err);
      finish({ ok: false, reason: 'error' });
    }
  });
}

/* ---------------------------------------------------------------
   The stand-in

   Deliberately obvious: it says what it is, and it can be cancelled so the
   "dismissed, no reward" path is exercisable without a real network.
   --------------------------------------------------------------- */
function simulatedAd() {
  return new Promise(resolve => {
    let done = false;
    const finish = out => {
      if (done) return;
      done = true;
      clearInterval(tick);
      window.removeEventListener('keydown', onKey);
      wrap.remove();
      resolve(out);
    };

    const started = Date.now();
    const bar = el('i');
    const secs = el('b', { text: `${Math.ceil(SIM_MS / 1000)}s` });

    const wrap = el('div', { class: 'ad-sim' },
      el('div', { class: 'ad-sim-inner' },
        el('div', { class: 'ad-sim-tag', text: 'PLACEHOLDER' }),
        el('div', { class: 'ad-sim-ico', text: '📺' }),
        el('h3', { text: 'Simulated ad' }),
        el('p', { class: 'muted small', text: 'Real ads only run on the published site, so this stands in for the video here. Watch it through to earn the coin.' }),
        el('div', { class: 'ad-sim-bar' }, bar),
        el('p', { class: 'hint' }, secs, ' remaining'),
        el('button', {
          class: 'btn ghost',
          onclick: () => finish({ ok: false, reason: 'dismissed' })
        }, 'Cancel')
      )
    );
    const onKey = e => { if (e.key === 'Escape') finish({ ok: false, reason: 'dismissed' }); };

    ($('#app') || document.body).append(wrap);
    window.addEventListener('keydown', onKey);

    const tick = setInterval(() => {
      const gone = Date.now() - started;
      const pct = Math.min(100, (gone / SIM_MS) * 100);
      bar.style.width = pct + '%';
      secs.textContent = `${Math.max(0, Math.ceil((SIM_MS - gone) / 1000))}s`;
      if (gone >= SIM_MS) finish({ ok: true });
    }, 100);
  });
}
