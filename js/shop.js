/* ============================================================
   shop.js — the Shop view: earn coins from rewarded video, spend them
             on consumables with a daily cap on each row
   ============================================================ */

import { COINS_PER_AD, COIN_ICON } from './data.js';
import { store } from './state.js';
import { itemImage, itemName } from './items.js';
import { Ads, AD_FAILURES } from './ads.js';
import { $, el, toast, num } from './ui.js';

let refresh = null;   // supplied by main.js so the HUD and Items tab keep up

export function initShop({ onChange } = {}) {
  refresh = onChange;
  // Warm the first ad so the button is not dead on the first tap.
  Ads.preload();
}

/** "4h 12m" until the next local midnight. */
function untilMidnightLabel() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  const mins = Math.max(0, Math.ceil((midnight - now) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function renderShop() {
  const host = $('#shop-body');
  if (!host) return;
  host.innerHTML = '';

  const coins = store.coins;
  $('#shop-coins').textContent = `${COIN_ICON} ${num(coins)}`;

  const rows = store.shopRows();
  const allCapped = rows.every(r => r.soldOut);

  host.append(
    earnCard(),
    el('h4', { class: 'sheet-h4', text: 'Spend your coins' }),
    el('div', { class: 'shop-list' }, ...rows.map(shopRow)),
    el('p', { class: 'hint', html: allCapped
      ? `You have bought everything the shop offers today. The limits reset at <b>midnight</b>, in <b>${untilMidnightLabel()}</b>.`
      : `Every row has its own <b>daily limit</b>, shown on the right. They all reset at <b>midnight</b>, in <b>${untilMidnightLabel()}</b>. Coins are <b>yours to keep</b> — they never expire, so an unspent one is still there tomorrow.` }),
    Ads.isReal ? null : el('p', { class: 'hint bad', text: 'Ads are switched off with ?ads=sim, so "Watch an ad" plays a labelled placeholder instead.' })
  );
}

/* ---------------------------------------------------------------
   Earning

   The button is deliberately the only way to start an ad: AdMob's rewarded
   policy requires the player to opt in, having been told what the reward is,
   so nothing here may auto-play.
   --------------------------------------------------------------- */
function earnCard() {
  const btn = el('button', {
    class: 'btn primary wide',
    disabled: Ads.playing,
    onclick: watchForCoin
  }, Ads.playing ? 'Ad open…' : '🎁  Watch an ad');

  return el('div', { class: 'card shop-earn' },
    el('h3', { text: 'Earn coins' }),
    el('p', { class: 'muted small', html: `Open one advert and you get <b>${COINS_PER_AD} ${COIN_ICON} coin</b>. As many as you like — there is no daily limit on <i>earning</i>, only on what each item can be bought for in a day.` }),
    btn,
    el('p', { class: 'hint', text: 'The advert opens in a new tab and the coin is yours as soon as you open it. Your game stays exactly where it is, so you can come straight back.' })
  );
}

async function watchForCoin() {
  if (Ads.playing) return;
  renderShop();                      // repaint so the button shows it is busy

  const res = await Ads.showRewarded();

  if (!res.ok) {
    // 'busy' is the player double-tapping, which needs no scolding.
    if (res.reason !== 'busy') {
      toast(AD_FAILURES[res.reason] || AD_FAILURES.error, 'bad', 3200);
    }
    renderShop();
    return;
  }

  const total = store.addCoins(COINS_PER_AD);
  toast(`${COIN_ICON} +${COINS_PER_AD} coin · ${num(total)} total`, 'good');
  renderShop();
  refresh?.();
}

/* ---------------------------------------------------------------
   Spending
   --------------------------------------------------------------- */
function shopRow(r) {
  const { def, item } = r;
  const label = `${def.qty > 1 ? def.qty + ' ' : ''}${itemName(def.item, def.qty)}`;

  const state = r.soldOut
    ? el('span', { class: 'shop-limit done', text: `Bought ${r.bought} / ${def.limit} today` })
    : el('span', { class: 'shop-limit', text: `${r.left} of ${def.limit} left today` });

  return el('div', { class: 'shop-row' + (r.soldOut ? ' capped' : '') },
    el('div', { class: 'shop-art' },
      el('img', { src: itemImage(def.item), alt: '' }),
      r.held ? el('span', { class: 'qty', text: num(r.held) }) : null
    ),
    el('div', { class: 'shop-main' },
      el('b', { text: label }),
      el('div', { class: 'shop-meta' },
        el('span', { class: 'shop-price', text: `${COIN_ICON} ${def.coins} coin${def.coins === 1 ? '' : 's'}` }),
        state
      )
    ),
    el('div', { class: 'shop-act' },
      el('button', {
        class: 'btn' + (r.canBuy ? ' primary' : ''),
        disabled: !r.canBuy,
        onclick: () => buy(def.id)
      }, r.soldOut ? 'Maxed' : 'Buy')
    )
  );
}

function buy(id) {
  const res = store.buyShopItem(id);
  if (!res.ok) {
    if (res.reason === 'coins') {
      toast(`You need ${COIN_ICON} ${res.need} — watch an ad to top up`, 'bad');
    } else if (res.reason === 'limit') {
      toast(`That is all you can buy of this today (${res.limit})`, 'bad');
    } else {
      toast('That is not for sale', 'bad');
    }
    renderShop();
    return;
  }

  toast(`Bought ${res.qty > 1 ? res.qty + ' ' : ''}${itemName(res.item, res.qty)}`, 'good');
  renderShop();
  refresh?.();
}
