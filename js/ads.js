/* ============================================================
   ads.js — the "watch an ad" reward, behind one small interface

   The product here is an Adsterra **smartlink**: a single URL that Adsterra
   resolves to whatever offer suits the visitor. It is a link, not a video
   player, so the flow is:

     the player taps "Watch an ad" in the Shop
       -> a panel explains the deal and shows one hyperlink
       -> tapping the link opens the offer in a new tab
       -> that click is the reward, and the coin is paid

   Why the reward lands on the click: a smartlink hands the visitor off to a
   third-party page we cannot see into. There is no completion callback, no
   view event, nothing to poll — the click is the only thing our page can
   honestly observe. So that is what pays.

   This replaced Google's Ad Placement API, which needed an approved AdSense
   account. Everything the Shop needs still comes through `Ads.showRewarded()`,
   so the Shop did not have to change.

     'smartlink'  the real thing. Works anywhere, including GitHub Pages.
     'native'     a native shell injected a bridge on `window.SearchAndGoAds`.
                  Only used if the game is ever wrapped for an app store.
     'sim'        forced with `?ads=sim`, for exercising the "no reward" path.

   Nothing else in the codebase knows what an ad is.
   ============================================================ */

import { el, $ } from './ui.js';

/**
 * The Adsterra smartlink. One URL, and Adsterra decides what the visitor sees.
 */
export const SMARTLINK_URL =
  'https://www.profitableratecpmnetwork.com/w4724usqvx?key=1fad09fcebbf1318b834a0022bf3370d';

/** How long the stand-in pretends to run, in ms. */
const SIM_MS = 5000;

/** Resolved reasons the Shop shows a message for. */
export const AD_FAILURES = {
  dismissed: 'No coin this time — the link was not opened.',
  nofill: 'No ad available right now. Try again in a minute.',
  error: 'The ad could not be opened. Try again in a minute.',
  timeout: 'The ad did not load. Check you are online and try again.',
  busy: 'An ad is already open.'
};

let playing = false;

const bridge = () => (typeof window !== 'undefined' ? window.SearchAndGoAds : null) || null;

/** `?ads=sim` forces the stand-in so the no-reward path stays testable. */
function override() {
  try {
    const v = new URLSearchParams(location.search).get('ads');
    return v === 'sim' || v === 'real' ? v : null;
  } catch { return null; }
}

export const Ads = {
  /** 'native' | 'smartlink' | 'sim'. */
  get provider() {
    if (override() === 'sim') return 'sim';
    if (bridge()) return 'native';
    return 'smartlink';
  },

  /** True when a real ad network is behind this, so the UI can drop the notice. */
  get isReal() { return this.provider !== 'sim'; },

  /** The panel is on screen right now. */
  get playing() { return playing; },

  /**
   * A smartlink is a plain URL, so there is nothing to have ready or not — it
   * is always available. A native bridge can still say its cache is empty.
   */
  get ready() {
    const b = bridge();
    if (!b) return true;
    try { return b.isReady ? !!b.isReady() : true; } catch { return true; }
  },

  /** Nothing to warm up for a link. Kept so the Shop's call site is unchanged. */
  preload() {
    const b = bridge();
    if (b?.preload) {
      try { b.preload(); } catch { /* ignore */ }
    }
  },

  /**
   * Offers one ad. Resolves `{ ok: true }` only when the player actually opened
   * the link, so closing the panel never pays out.
   */
  async showRewarded() {
    if (playing) return { ok: false, reason: 'busy' };
    playing = true;
    try {
      const p = this.provider;
      const res = p === 'native' ? await bridge().showRewarded()
        : p === 'sim' ? await simulatedAd()
        : await smartlinkAd();
      // Trust nothing: a malformed answer counts as no reward.
      if (res && res.ok === true) return { ok: true };
      return { ok: false, reason: (res && res.reason) || 'dismissed' };
    } catch (err) {
      console.warn('[ads] rewarded ad failed:', err);
      return { ok: false, reason: 'error' };
    } finally {
      playing = false;
    }
  }
};

/* ---------------------------------------------------------------
   The smartlink panel

   A real `<a href target="_blank">` rather than a scripted `window.open`, for
   two reasons: a genuine user click on an anchor is never caught by a popup
   blocker, and `rel="noopener"` means the offer page gets no handle on this
   one. The reward is granted on that click.
   --------------------------------------------------------------- */
function smartlinkAd() {
  return new Promise(resolve => {
    let done = false;

    const finish = out => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', onKey);
      wrap.remove();
      resolve(out);
    };

    const onKey = e => { if (e.key === 'Escape') finish({ ok: false, reason: 'dismissed' }); };

    const link = el('a', {
      class: 'btn primary wide ad-link',
      href: SMARTLINK_URL,
      target: '_blank',
      rel: 'noopener noreferrer',
      // The click is the reward. Left as the anchor's own navigation rather
      // than being cancelled, so the offer really does open.
      onclick: () => {
        // Let the new tab open first, then pay and close the panel.
        setTimeout(() => finish({ ok: true }), 120);
      }
    }, '👉  Click here for the reward');

    const wrap = el('div', { class: 'ad-sim ad-offer' },
      el('div', { class: 'ad-sim-inner' },
        el('div', { class: 'ad-sim-ico', text: '🎁' }),
        el('h3', { text: 'Watch an ad for a coin' }),
        el('p', { class: 'muted small', text: 'The link below opens an advert in a new tab. Opening it earns your coin — you can come straight back here afterwards.' }),
        link,
        el('p', { class: 'hint', text: 'The advert is served by Adsterra and opens in a separate tab, so your game stays exactly where it is.' }),
        el('button', {
          class: 'btn ghost',
          onclick: () => finish({ ok: false, reason: 'dismissed' })
        }, 'No thanks')
      )
    );

    ($('#app') || document.body).append(wrap);
    window.addEventListener('keydown', onKey);
  });
}

/* ---------------------------------------------------------------
   The stand-in

   Deliberately obvious: it says what it is, and it can be cancelled so the
   "dismissed, no reward" path is exercisable without opening a real offer.
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
        el('p', { class: 'muted small', text: 'A stand-in for the real advert, used when ads are forced off. Let it finish to earn the coin.' }),
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
