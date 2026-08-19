/* ============================================================
   eggs.js — the egg tab, incubation and the hatch sequence

   Eggs drop from disc and item points, go into an incubator, and hatch once
   you have walked their distance. Everything egg-shaped lives here so it
   stays out of views.js.

   This module deliberately does not import views.js. The bits of the rest of
   the app it needs are handed in through initEggs(), which keeps the imports
   one-directional and avoids a cycle.
   ============================================================ */

import {
  MAX_EGGS, MAX_EXCLUSIVE_EGGS, INCUBATOR_ITEMS, REUSABLE_INCUBATOR,
  eggDef, eggImage, eggLabel, isExclusiveEgg, incubatorDiscount, RULES
} from './data.js';
import { store } from './state.js';
import { ITEMS, itemImage } from './items.js';
import { $, el, toast, openSheet, closeSheet, num, sleep } from './ui.js';

const CANDY_ICON = '🍬';
const DUST_ICON = '✨';

const km = m => (m / 1000).toFixed(2);

/* Handed in by main.js so this module never has to import views/anim. */
let hooks = {
  refresh: null,        // repaint the rest of the UI
  reveal: null,         // play the capture-style reveal animation
  canPrompt: null,      // is it a good moment to interrupt with a hatch prompt
  onHatched: null       // after a hatch completes (level-up popups etc.)
};

export function initEggs(fns = {}) {
  hooks = { ...hooks, ...fns };
  $('#hatch-later').addEventListener('click', () => closeSheet('hatch'));
  $('#hatch-go').addEventListener('click', () => {
    const id = promptedEggId;
    closeSheet('hatch');
    if (id) hatchNow(id);
  });
}

/* ---------------------------------------------------------------
   The Eggs tab
   --------------------------------------------------------------- */

/** Badges the Eggs tab with how many are ready, otherwise how many you hold. */
export function renderEggTabBadge() {
  const tab = $('.tabs .tab[data-tab="eggs"]');
  if (!tab) return;
  const ready = store.readyEggs().length;
  tab.innerHTML = 'Eggs';
  if (ready) tab.append(el('span', { class: 'tab-badge ready', text: String(ready) }));
  else if (store.eggs.length) tab.append(el('span', { class: 'tab-badge', text: String(store.eggs.length) }));
}

/** One tile per egg, showing its incubator and how far it has walked. */
export function renderEggs() {
  const grid = $('#eggs-grid');
  if (!grid) return;

  const eggs = [...store.eggs].sort((a, b) => {
    // Ready first, then the ones already walking, then the idle ones.
    const rank = e => store.isEggReady(e) ? 0 : e.incubator ? 1 : 2;
    return rank(a) - rank(b) || a.collectedAt - b.collectedAt;
  });

  const free = store.freeIncubators();
  const freeTotal = Object.values(free).reduce((a, b) => a + b, 0);
  const exCount = store.exclusiveEggs.length;
  $('#eggs-hint').innerHTML =
    `Holding <b>${store.normalEggs.length}</b> of <b>${MAX_EGGS}</b> eggs` +
    // The three exclusive slots are separate, so they are counted separately.
    ` and <b>${exCount}</b> of <b>${MAX_EXCLUSIVE_EGGS}</b> exclusive 15 km eggs. ` +
    (freeTotal
      ? `<b>${freeTotal}</b> incubator${freeTotal === 1 ? '' : 's'} free — tap an egg to start it walking.`
      : 'No incubators free. A reusable Incubator stays busy until its egg hatches.');
  $('#eggs-empty').classList.toggle('hidden', eggs.length > 0);

  grid.innerHTML = '';
  for (const egg of eggs) {
    const p = store.eggProgress(egg);
    const ready = store.isEggReady(egg);

    grid.append(el('button', {
      class: 'cell egg-cell' + (ready ? ' egg-ready' : '') + (egg.incubator ? ' egg-walking' : '')
        + (isExclusiveEgg(egg.type) ? ' egg-exclusive' : ''),
      onclick: () => {
        if (ready) { promptHatch(egg.id, { force: true }); return; }
        if (egg.incubator) { toast(`${km(p.left)} km still to walk`, '', 2600); return; }
        openIncubatorPicker(egg.id);
      }
    },
      // which incubator it is sitting in, top-left of the tile
      egg.incubator
        ? el('img', { class: 'egg-incu', src: itemImage(egg.incubator), alt: ITEMS[egg.incubator].name })
        : null,
      ready ? el('span', { class: 'egg-ready-tag', text: 'READY' }) : null,
      el('img', { class: 'egg-img', src: eggImage(egg.type), alt: eggLabel(egg.type), loading: 'lazy' }),
      el('span', { class: 'nm', text: `${eggDef(egg.type).km} km` }),
      egg.incubator
        ? el('span', { class: 'egg-bar-wrap' },
            el('span', { class: 'egg-bar' }, el('i', { style: { width: p.pct + '%' } })))
        : null,
      el('span', {
        class: 'sub', text: ready
          ? 'Tap to hatch'
          : egg.incubator ? `${km(p.done)} / ${km(p.need)} km` : 'Tap to incubate'
      })
    ));
  }
}

/* ---------------------------------------------------------------
   Incubating
   --------------------------------------------------------------- */

/** From an egg: choose which incubator to put it in. */
export function openIncubatorPicker(eggId) {
  const egg = store.egg(eggId);
  if (!egg) return;
  const free = store.freeIncubators();

  $('#picker-title').textContent = `Incubate your ${eggLabel(egg.type)}`;
  $('#picker-hint').textContent = 'A Single Use Incubator is used up as soon as you start. The reusable Incubator is tied up until its egg hatches.';
  $('#picker-empty').textContent = 'No incubators free. You get an Incubator at player level 5, and Single Use Incubators from raids and missions.';
  $('#picker-empty').classList.toggle('hidden', Object.values(free).some(n => n > 0));
  $('#picker-bulk').innerHTML = '';

  const grid = $('#picker-grid');
  grid.innerHTML = '';
  for (const id of INCUBATOR_ITEMS) {
    const n = free[id] || 0;
    if (n < 1) continue;
    grid.append(el('button', {
      class: 'cell item-cell tappable',
      onclick: () => startIncubating(eggId, id)
    },
      el('span', { class: 'qty', text: String(n) }),
      el('img', { src: itemImage(id), alt: ITEMS[id].name, loading: 'lazy' }),
      el('span', { class: 'nm', text: ITEMS[id].name }),
      el('span', { class: 'use-hint', text: id === REUSABLE_INCUBATOR
        ? 'Reusable'
        : incubatorDiscount(id)
          ? `−${Math.round(incubatorDiscount(id) * 100)}% distance`
          : 'Used up' })
    ));
  }
  openSheet('picker');
}

/** From an incubator: choose which idle egg goes in it. */
export function openEggPickerFor(itemId) {
  const idle = store.eggs.filter(e => !e.incubator);

  $('#picker-title').textContent = `Which egg goes in the ${ITEMS[itemId].name}?`;
  $('#picker-hint').textContent = 'Once it is in, walk the distance shown to hatch it.';
  $('#picker-empty').textContent = store.eggs.length
    ? 'All your eggs are already incubating.'
    : 'You have no eggs yet. They turn up when you collect discs, potions and revives.';
  $('#picker-empty').classList.toggle('hidden', idle.length > 0);
  $('#picker-bulk').innerHTML = '';

  const grid = $('#picker-grid');
  grid.innerHTML = '';
  for (const egg of idle) {
    grid.append(el('button', {
      class: 'cell egg-cell',
      onclick: () => startIncubating(egg.id, itemId)
    },
      el('img', { class: 'egg-img', src: eggImage(egg.type), alt: eggLabel(egg.type), loading: 'lazy' }),
      el('span', { class: 'nm', text: `${eggDef(egg.type).km} km` }),
      el('span', { class: 'sub', text: 'Tap to incubate' })
    ));
  }
  openSheet('picker');
}

function startIncubating(eggId, itemId) {
  const egg = store.egg(eggId);
  const r = store.incubateEgg(eggId, itemId);
  if (!r.ok) {
    toast(r.reason === 'noneFree' ? 'That incubator is busy' : 'Could not incubate that egg', 'bad');
    return;
  }
  closeSheet('picker');
  toast(`${eggLabel(egg.type)} is incubating — get walking`, 'good', 3400);
  renderEggs();
  renderEggTabBadge();
  hooks.refresh?.();
}

/* ---------------------------------------------------------------
   Collecting
   --------------------------------------------------------------- */

/** Second popup, after the item one, when a point also drops an egg. */
export function showEggDropPopup(egg) {
  const def = eggDef(egg.type);
  const body = $('#sheet-body');
  body.innerHTML = '';
  body.append(
    el('div', { style: { textAlign: 'center', padding: '12px 0' } },
      el('p', { class: 'muted small', style: { margin: '0 0 8px' }, text: 'There was something else in there…' }),
      el('img', {
        class: 'egg-pop', src: eggImage(egg.type), alt: eggLabel(egg.type),
        style: { width: '108px', height: '108px', objectFit: 'contain' }
      }),
      el('p', { style: { margin: '8px 0 0', fontWeight: '700', fontSize: '17px' },
                text: `${def.km} km Egg!` }),
      el('p', { class: 'muted small', text: `Put it in an incubator and walk ${def.km} km to hatch it.` }),
      el('p', { class: 'muted small', text: isExclusiveEgg(egg.type)
        ? `Exclusive egg storage: ${store.exclusiveEggs.length} of ${MAX_EXCLUSIVE_EGGS}`
        : `Egg storage: ${store.normalEggs.length} of ${MAX_EGGS}` }),
      el('button', {
        class: 'btn primary wide', style: { marginTop: '14px' },
        onclick: () => closeSheet('sheet')
      }, 'Into the bag')
    )
  );
  openSheet('sheet');
}

/* ---------------------------------------------------------------
   Hatching
   --------------------------------------------------------------- */

let promptedEggId = null;
/* Eggs already offered this session, so the prompt does not nag on a loop. */
const offered = new Set();
let hatching = false;

/**
 * Offers to hatch a ready egg. Called from the game loop, so it only
 * interrupts when you are actually looking at the map — never mid-battle or
 * while you are digging around in storage.
 */
export function maybePromptHatch() {
  if (hatching || promptedEggId) return;
  const egg = store.readyEggs().find(e => !offered.has(e.id));
  if (!egg) return;
  if (!hooks.canPrompt?.()) return;
  promptHatch(egg.id);
}

export function promptHatch(eggId, { force = false } = {}) {
  const egg = store.egg(eggId);
  if (!egg || !store.isEggReady(egg) || hatching) return;
  if (!force && !hooks.canPrompt?.()) return;

  promptedEggId = eggId;
  offered.add(eggId);
  const def = eggDef(egg.type);
  $('#hatch-egg').src = eggImage(egg.type);
  $('#hatch-title').textContent = `Your ${def.km} km egg is hatching!`;
  $('#hatch-sub').textContent = `You walked ${def.km} km. Something is moving in there…`;
  openSheet('hatch');
}

/** Shake the egg, then reveal what came out. */
async function hatchNow(eggId) {
  const egg = store.egg(eggId);
  promptedEggId = null;
  if (!egg || !store.isEggReady(egg) || hatching) return;

  hatching = true;
  try {
    // A beat of shaking before the reveal, so it does not feel instant.
    await playShake(egg);

    const res = store.hatchEgg(eggId);
    if (!res.ok) { toast('That egg could not hatch', 'bad'); return; }

    offered.delete(eggId);
    const rewards = [
      { icon: CANDY_ICON, label: `+${res.candy} ${res.sp.name} candy` },
      { icon: DUST_ICON, label: `+${num(res.dust)} stardust` },
      { icon: '⭐', label: `+${res.xp} XP` }
    ];
    if (res.shiny) rewards.unshift({ icon: '✨', label: 'Shiny!' });

    await hooks.reveal?.({
      sp: res.sp,
      isNew: res.isNew,
      rewards,
      imageSrc: res.sp.spritePath(res.shiny),
      shiny: res.shiny
    });

    toast(`${res.km} km egg hatched into ${res.sp.name}!`, 'good', 3600);
    hooks.onHatched?.(res);
    renderEggs();
    renderEggTabBadge();
    hooks.refresh?.();
  } finally {
    hatching = false;
  }
}

/** The egg wobbles in its own little overlay before the reveal takes over. */
function playShake(egg) {
  return new Promise(resolve => {
    const host = $('#hatch-shake');
    if (!host) { resolve(); return; }
    host.innerHTML = '';
    host.append(el('img', { class: 'hatch-shaker', src: eggImage(egg.type), alt: '' }));
    host.classList.remove('hidden');
    setTimeout(() => {
      host.classList.add('hidden');
      host.innerHTML = '';
      resolve();
    }, RULES.EGG_SHAKE_MS);
  });
}
