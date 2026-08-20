/* ============================================================
   views.js — Storage, Collection, Profile and the detail sheet
   ============================================================ */

import {
  DB, SETS, speciesForSet, RARITY_NAMES, MAX_CREATURE_LEVEL, MAX_PLAYER_LEVEL, STAT_KEYS, STAT_LABELS,
  STAT_GROWTH_PER_LEVEL,
  species, familyRoot, familyName, familyRarity, levelUpCost, moveLevelFor, statsFor,
  fullLearnset, finalEvolutionOf,
  breedingSlotsFor, BREEDING_UNLOCK_LEVEL, bonanzaState,
  isRelaxHour, relaxHourEndsIn, RELAX_HOUR_LABEL, RULES, BUDDY_KM_PER_CANDY,
  isStardustSunday, STARDUST_SUNDAY_LABEL, STARDUST_SUNDAY_MULTIPLIER,
  MAX_EGGS, MAX_EXCLUSIVE_EGGS, INCUBATOR_ITEMS, poiEventState,
  MAX_STAT_BOOSTS, STAT_BOOSTER_CANDY_COST, statBoosterCost,
  abilityText, clauseConditionText, clauseEffectText, buffMoveText,
  GALACTIC_SET_NAME, MYTHICAL_RARITY, unlockedGalacticRarities
} from './data.js';
import { renderEggs, renderEggTabBadge, openEggPickerFor } from './eggs.js';
import { store, creatureStats, maxHpOf, hpOf, isFainted, isHurt } from './state.js';

import { Persist } from './persist.js';
import { playEvolution } from './anim.js';
import { ITEMS, itemImage, itemName, itemsInOrder, INCENSE_ITEMS } from './items.js';
import { Weather, temperatureLabel, weatherRows, conditionOf } from './weather.js';
import {
  $, $$, el, toast, openSheet, closeSheet, num, timeLeftLabel,
  clampPage, pageSlice, pagerBar, pageOfIndex, wireSwipe, bumpEl, openImageViewer
} from './ui.js';

const CANDY_ICON = '🍬';
const DUST_ICON = '✨';

/* The highest base stat in the game, used to scale the little stat bars. */
const STAT_BAR_MAX = 160;

/* ===============================================================
   HUD
   =============================================================== */
export function renderHUD() {
  const p = store.progress;
  $('#hud-level').textContent = p.level;
  $('#hud-stardust').textContent = num(store.s.stardust);
  renderWeatherChip();
  $('#hud-xp-text').textContent = p.max
    ? `${num(store.s.xp)} XP · MAX`
    : `${num(p.into)} / ${num(p.need)} XP → Lv ${p.level + 1}`;
  $('#hud-xp-fill').style.width = p.pct + '%';
}

/**
 * The temperature chip. Dimmed until the first reading lands, and it keeps
 * showing the last known figure if a later request fails — a slightly old
 * temperature is more use than an empty chip.
 */
export function renderWeatherChip() {
  const chip = $('#hud-weather');
  const value = $('#hud-temp');
  if (!chip || !value) return;
  value.textContent = temperatureLabel();
  chip.classList.toggle('pending', !Weather.known);
  chip.title = Weather.known
    ? 'Tap for the full conditions · Open-Meteo'
    : (Weather.error || 'Waiting for the temperature…');

  // Wired once. The chip is rebuilt in place rather than replaced, so a flag on
  // the element is enough to stop the listener stacking up on every repaint.
  if (!chip._wired) {
    chip._wired = true;
    chip.addEventListener('click', openWeatherPanel);
  }
}

/**
 * The rest of the reading, behind the temperature chip. Only the temperature is
 * worth permanent space in the HUD; everything else lives here.
 */
export function openWeatherPanel() {
  document.getElementById('weather-panel')?.remove();

  const close = () => {
    panel.remove();
    window.removeEventListener('keydown', onKey);
  };
  const onKey = e => { if (e.key === 'Escape') close(); };

  const r = Weather.current;
  const cond = conditionOf(r);
  const rows = weatherRows(r);
  const age = Weather.ageMs;

  const card = el('div', {
    class: 'weather-card',
    // Tapping the card itself must not dismiss it.
    onclick: e => e.stopPropagation()
  },
    el('button', { class: 'weather-close', 'aria-label': 'Close', onclick: close }, '✕'),
    r
      ? el('div', { class: 'weather-head' },
        el('div', { class: 'weather-icon', text: cond.icon }),
        el('div', {},
          el('div', { class: 'weather-temp', text: `${Math.round(r.celsius)}°C` }),
          el('div', { class: 'muted small', text: cond.label })
        )
      )
      : el('div', { class: 'weather-head' },
        el('div', { class: 'weather-icon', text: '❓' }),
        el('div', {},
          el('div', { class: 'weather-temp', text: '—' }),
          el('div', { class: 'muted small', text: Weather.error || 'No reading yet' })
        )
      ),
    rows.length
      ? el('div', { class: 'det-rows' }, ...rows.map(row =>
        el('div', { class: 'det-row' },
          el('span', { text: row.icon }),
          el('span', { text: row.label }),
          el('b', { text: row.value })
        )))
      : el('p', { class: 'hint', text: 'The weather could not be read. It retries on its own as you move.' }),
    el('p', { class: 'hint weather-foot', text: r
      ? `Open-Meteo · updated ${ageLabel(age)}. Your position is rounded to about a kilometre before being sent.`
      : 'Open-Meteo · nothing sent until a location is known.' })
  );

  const panel = el('div', {
    class: 'weather-wrap',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Current weather',
    onclick: close
  }, card);

  document.body.append(panel);
  window.addEventListener('keydown', onKey);
  return panel;
}

/** "just now" / "6 min ago", for the reading's age. */
function ageLabel(ms) {
  if (ms == null) return 'never';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`;
}

/* ===============================================================
   STORAGE
   =============================================================== */
const SORTERS = {
  id:     (a, b) => order(a) - order(b) || a.capturedAt - b.capturedAt,
  name:   (a, b) => sp(a).name.localeCompare(sp(b).name) || order(a) - order(b),
  type:   (a, b) => sp(a).type.localeCompare(sp(b).type) || order(a) - order(b),
  rarity: (a, b) => (rar(a) - rar(b)) || order(a) - order(b),
  level:  (a, b) => (a.level - b.level) || order(a) - order(b),
  total:  (a, b) => (statTotal(a) - statTotal(b)) || order(a) - order(b),
  shiny:  (a, b) => (Number(!!b.shiny) - Number(!!a.shiny)) || order(a) - order(b),
  favourite: (a, b) => (Number(!!b.favourite) - Number(!!a.favourite)) || order(a) - order(b),
  recent: (a, b) => a.capturedAt - b.capturedAt
};
const sp = c => species(c.speciesId);
const order = c => sp(c)?.order ?? 0;
const rar = c => sp(c)?.rarity ?? familyRarity(c.speciesId) ?? 0;

/**
 * HP + Attack + Defence + Speed for a stored creature — the same figure the
 * creature sheet shows as "Total".
 *
 * Memoised because a sort calls its comparator O(n log n) times and each call
 * would otherwise recompute stats for two creatures. Keyed on level and species
 * so levelling up and evolving both invalidate it; the stat modifier is rolled
 * once at capture and never changes.
 */
const statTotalCache = new Map();
export function statTotal(c) {
  const hit = statTotalCache.get(c.uid);
  if (hit && hit.level === c.level && hit.speciesId === c.speciesId) return hit.total;
  const stats = creatureStats(c);
  const total = STAT_KEYS.reduce((sum, k) => sum + stats[k], 0);
  statTotalCache.set(c.uid, { level: c.level, speciesId: c.speciesId, total });
  return total;
}

/* ---------------------------------------------------------------
   Tabs
   --------------------------------------------------------------- */
export function renderStorageTabs() {
  const want = store.s.ui.storageTab;
  const tab = (want === 'items' || want === 'eggs') ? want : 'creatures';
  $$('.tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tab-creatures').classList.toggle('hidden', tab !== 'creatures');
  $('#tab-items').classList.toggle('hidden', tab !== 'items');
  $('#tab-eggs').classList.toggle('hidden', tab !== 'eggs');
  renderEggTabBadge();

  const itemTab = $('.tabs .tab[data-tab="items"]');
  const total = store.ownedItems().reduce((a, x) => a + x.qty, 0);
  itemTab.innerHTML = 'Items';
  if (total) itemTab.append(el('span', { class: 'tab-badge', text: String(total) }));

  const family = store.s.ui.storageFamily;
  const shown = family
    ? store.s.storage.filter(c => familyRoot(c.speciesId) === family).length
    : store.s.storage.length;
  $('#storage-count').textContent = tab === 'items'
    ? `${total} item${total === 1 ? '' : 's'}`
    : tab === 'eggs'
      ? `${store.normalEggs.length}/${MAX_EGGS} + ${store.exclusiveEggs.length}/${MAX_EXCLUSIVE_EGGS} eggs`
      : family
        ? `${shown} of ${store.s.storage.length} shown`
        : `${store.s.storage.length} stored`;
}

/* The sorted creature list, cached so prev/next arrows can walk it. */
let sortedStorage = [];
/* The same idea for the Collection: the filtered, sorted species list on screen. */
let sortedCollection = [];
let multiSelectMode = false;
let multiSelected = new Set();

export function renderStorage() {
  renderStorageTabs();
  if (store.s.ui.storageTab === 'items') return renderItems();
  if (store.s.ui.storageTab === 'eggs') return renderEggs();

  const grid = $('#storage-grid');
  const { storageSort, storageDir, storageFamily } = store.s.ui;

  // An active family filter narrows the list before sorting, so paging, the
  // pager and the sheet's prev/next arrows all stay inside the filter.
  const source = storageFamily
    ? store.s.storage.filter(c => familyRoot(c.speciesId) === storageFamily)
    : store.s.storage;
  renderStorageFilterBar(storageFamily, source.length);

  // Sort the whole collection first, then cut it into pages.
  sortedStorage = [...source].sort(SORTERS[storageSort] || SORTERS.id);
  if (storageDir < 0) sortedStorage.reverse();

  const page = clampPage(store.s.ui.storagePage, sortedStorage.length);
  if (page !== store.s.ui.storagePage) store.s.ui.storagePage = page;
  const list = pageSlice(sortedStorage, page);

  const empty = $('#storage-empty');
  empty.classList.toggle('hidden', sortedStorage.length > 0);
  empty.textContent = storageFamily
    ? `No ${familyName(storageFamily)} in your storage.`
    : 'Nothing here yet. Go catch something!';
  $('#storage-sort').value = storageSort;
  $('#storage-dir').textContent = storageDir > 0 ? '↑' : '↓';

  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const c of list) {
    const s = sp(c);
    if (!s) continue;
    const rarity = s.rarity || familyRarity(s.id);
    const max = maxHpOf(c);
    const hp = hpOf(c);
    const pct = Math.round((hp / max) * 100);
    const selected = multiSelected.has(c.uid);
    const isBuddy = store.isBuddy(c.uid);

    frag.append(el('button', {
      class: 'cell' + (c.shiny ? ' shiny' : '') + (selected ? ' picked' : ''),
      onclick: e => {
        // A long press just started multi-select, so this click is the release
        // of that press rather than a tap.
        if (consumeHold()) { e.preventDefault(); return; }
        if (multiSelectMode) {
          if (!canMultiSelect(c)) {
            toast('Cannot select favourites, shinies, buddies or breeding creatures', 'bad');
            return;
          }
          if (selected) multiSelected.delete(c.uid); else multiSelected.add(c.uid);
          renderStorage();
          return;
        }
        openCreatureSheet(c.uid);
      },
      // Hold to start multi-select with this creature already ticked.
      onpointerdown: e => startHold(c, e),
      onpointermove: trackHold,
      onpointerup: endHold,
      onpointercancel: endHold,
      onpointerleave: endHold,
      // Stop the mobile long-press menu fighting the gesture.
      oncontextmenu: e => e.preventDefault()
    },
      selected ? el('span', { class: 'pick-order', text: '✓' }) : null,
      el('span', { class: 'lvl', text: 'Lv' + c.level }),
      rarity ? el('span', { class: `rar r-${rarity}`, text: rarity }) : null,
      c.shiny ? el('span', { class: 'shiny-star', text: '★' }) : null,
      c.favourite ? el('span', { class: 'fav-star', text: '♥' }) : null,
      el('img', { src: s.spritePath(c.shiny), alt: s.name, loading: 'lazy' }),
      el('span', { class: 'nm', text: s.name }),
      el('span', { class: 'hp-wrap' },
        el('span', { class: `hp-bar${pct <= 25 ? ' critical' : pct <= 60 ? ' low' : ''}` },
          el('i', { style: { width: pct + '%' } }))
      ),
      el('span', { class: `sub t-${s.type}`, text: s.type }),
      el('span', { class: 'stg', text: 'S' + s.stage }),
      c.breeding != null ? el('span', { class: 'breed-badge', text: '⚑' }) : null,
      isBuddy ? el('span', { class: 'buddy-badge', text: '🐾' }) : null,
      isFainted(c) ? el('span', { class: 'fainted-badge', text: 'FAINTED' }) : null
    ));
  }
  grid.append(frag);
  renderStoragePager(grid, page, sortedStorage.length);

  // multi-select toolbar
  let bar = document.getElementById('multi-bar');
  if (multiSelectMode) {
    if (!bar) {
      bar = el('div', { id: 'multi-bar', class: 'multi-bar' });
      grid.parentElement.insertBefore(bar, grid);
    }
    bar.innerHTML = '';
    bar.append(
      el('span', { class: 'muted', text: `${multiSelected.size} selected` }),
      el('button', { class: 'btn danger', disabled: !multiSelected.size, onclick: doMassRelease },
        `Release ${multiSelected.size}`),
      el('button', { class: 'btn ghost', onclick: exitMultiSelect }, 'Cancel')
    );
  } else if (bar) {
    bar.remove();
  }
}

/**
 * The "showing only this family" chip. Always visible while a filter is on, so
 * a persisted filter can never leave someone staring at an empty grid with no
 * way out.
 */
function renderStorageFilterBar(familyRootId, count) {
  const bar = $('#storage-filter-bar');
  if (!bar) return;
  bar.classList.toggle('hidden', !familyRootId);
  bar.innerHTML = '';
  if (!familyRootId) return;

  bar.append(
    el('span', { class: 'filter-chip' },
      el('span', { text: `🎒 ${familyName(familyRootId)} line · ${count}` }),
      el('button', {
        class: 'chip-x',
        title: 'Show everything again',
        onclick: () => {
          store.setUI({ storageFamily: '', storagePage: 0 });
          renderStorage();
        }
      }, '✕')
    ),
    el('button', {
      class: 'mini-btn',
      onclick: () => {
        store.setUI({ storageFamily: '', storagePage: 0 });
        renderStorage();
      }
    }, 'Show all')
  );
}

/** Page controls under the storage grid, plus swipe on the grid itself. */
function renderStoragePager(grid, page, total) {
  const host = grid.parentElement;
  let pager = document.getElementById('storage-pager');
  const bar = pagerBar(page, total, goToStoragePage);

  if (!bar) { pager?.remove(); return; }
  if (!pager) {
    pager = el('div', { id: 'storage-pager' });
    host.insertBefore(pager, grid.nextSibling);
  }
  pager.innerHTML = '';
  pager.append(bar);

  wireSwipe(grid, {
    onLeft: () => goToStoragePage(store.s.ui.storagePage + 1, grid),
    onRight: () => goToStoragePage(store.s.ui.storagePage - 1, grid)
  }, { key: 'storagePage' });
}

function goToStoragePage(page, grid = null) {
  const next = clampPage(page, sortedStorage.length);
  if (next === store.s.ui.storagePage) {
    if (grid) bumpEl(grid, page < 0 ? 'right' : 'left');
    return;
  }
  store.setUI({ storagePage: next });
  renderStorage();
  $('#storage-grid')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/**
 * Creatures you are not allowed to mass release, so they are also not allowed
 * to be multi-selected.
 */
function canMultiSelect(c) {
  return !c.favourite && c.breeding == null && !c.shiny && !store.isBuddy(c.uid);
}

/* ---------------- hold a tile to start multi-select ----------------
   Same gesture and timing as holding a creature in the battle team picker, so
   there is only one "press and wait" feel to learn. A plain tap still opens
   the creature, which is why this cannot simply be a click.
   ------------------------------------------------------------------ */

const HOLD_MS = 320;
/** Past this much finger travel it is a scroll, not a press. */
const HOLD_SLOP_PX = 10;
let holdTimer = null;
let holdFrom = null;
/** Set while a hold has just opened a selection, to swallow its release click. */
let holdConsumed = false;

function startHold(c, e) {
  clearTimeout(holdTimer);
  // Cleared on every new press, so a hold whose release click never arrived
  // (the grid is rebuilt under the finger) cannot swallow a later tap.
  holdConsumed = false;
  holdFrom = e ? { x: e.clientX, y: e.clientY } : null;

  holdTimer = setTimeout(() => {
    holdTimer = null;
    if (multiSelectMode) return;
    if (!canMultiSelect(c)) {
      toast('Favourites, shinies, buddies and breeding creatures cannot be released', 'bad');
      return;
    }
    holdConsumed = true;
    enterMultiSelect(c.uid);
    toast('Multi-select on — tap more to add, or Cancel to stop', 'good', 2800);
  }, HOLD_MS);
}

/** A press that turns into a scroll must not fire the hold. */
function trackHold(e) {
  if (!holdTimer || !holdFrom) return;
  if (Math.abs(e.clientX - holdFrom.x) > HOLD_SLOP_PX ||
      Math.abs(e.clientY - holdFrom.y) > HOLD_SLOP_PX) {
    endHold();
  }
}

function endHold() {
  clearTimeout(holdTimer);
  holdTimer = null;
  holdFrom = null;
}

/** True once, if the press that just ended had started a selection. */
function consumeHold() {
  const was = holdConsumed;
  holdConsumed = false;
  return was;
}

// A press that ends anywhere at all must still cancel a pending hold.
window.addEventListener('pointerup', endHold);
window.addEventListener('pointercancel', endHold);

/** `uid` pre-ticks that creature, which is how the hold gesture starts it. */
export function enterMultiSelect(uid = null) {
  multiSelectMode = true;
  multiSelected.clear();
  if (uid) multiSelected.add(uid);
  renderStorage();
}

function exitMultiSelect() {
  multiSelectMode = false;
  multiSelected.clear();
  renderStorage();
}

function doMassRelease() {
  if (!multiSelected.size) return;
  const n = multiSelected.size;
  if (!confirm(`Release ${n} creature${n > 1 ? 's' : ''}? You will earn ${n} candy total (1 per creature).`)) return;
  const r = store.massRelease([...multiSelected]);
  exitMultiSelect();
  toast(`Released ${r.released} creature${r.released > 1 ? 's' : ''} · +${r.candy} candy`, 'good', 3400);
  refreshAll();
}

/* ===============================================================
   ITEMS TAB
   =============================================================== */
export function renderItems() {
  const grid = $('#items-grid');
  const owned = store.ownedItems();
  $('#items-empty').classList.toggle('hidden', owned.length > 0);

  grid.innerHTML = '';
  for (const { def, qty } of owned) {
    const tappable = def.use !== 'none';
    grid.append(el('button', {
      class: `cell item-cell ${tappable ? 'tappable' : 'passive'}`,
      onclick: () => openItemSheet(def.id)
    },
      el('span', { class: 'qty', text: String(qty) }),
      el('img', { src: itemImage(def.id), alt: def.name, loading: 'lazy' }),
      el('span', { class: 'nm', text: def.name }),
      el('span', { class: 'use-hint', text: def.soon ? 'Coming soon' : tappable ? 'Tap to use' : 'Used automatically' })
    ));
  }
}

/** Item detail: explains it, and offers the right way to use it. */
export function openItemSheet(itemId) {
  const def = ITEMS[itemId];
  if (!def) return;
  const qty = store.itemCount(itemId);
  const body = $('#sheet-body');

  const actions = [];
  if (def.use === 'creature') {
    const label = {
      potion: 'Use on a creature',
      full_heal: 'Fully heal a creature',
      revive: 'Revive a creature',
      stat_booster: 'Boost a creature'
    }[itemId] || 'Use on a creature';
    actions.push(el('button', {
      class: 'btn primary',
      disabled: qty < 1,
      onclick: () => { closeSheet('sheet'); openCreaturePicker(itemId); }
    }, label));
  }
  if (def.use === 'timed') {
    // Every incense type shares the one incense slot.
    const kind = INCENSE_ITEMS.includes(itemId) ? 'incense' : 'magnet';
    const active = store.effect(kind);
    actions.push(el('button', {
      class: 'btn primary',
      disabled: qty < 1 || !!active,
      onclick: () => useTimedItem(kind, def)
    }, active
      ? `Already running · ${timeLeftLabel(active.endsAt - Date.now())}`
      : `Use one now`));
  }
  if (INCUBATOR_ITEMS.includes(itemId)) {
    const free = store.freeIncubators()[itemId] || 0;
    const idle = store.eggs.filter(e => !e.incubator).length;
    actions.push(el('button', {
      class: 'btn primary',
      disabled: free < 1 || idle < 1,
      onclick: () => { closeSheet('sheet'); openEggPickerFor(itemId); }
    }, free < 1 ? 'Busy with an egg' : idle < 1 ? 'No egg waiting' : 'Incubate an egg'));
  }
  if (def.use === 'place') {
    // Two placeable buildings now, and only the breeding centre has a level gate.
    const isLab = itemId === 'research_lab';
    const placed = isLab ? !!store.s.researchLab : !!store.s.breeding;
    const unlocked = isLab || store.breedingUnlocked;
    actions.push(el('button', {
      class: 'btn primary',
      disabled: qty < 1 || placed || !unlocked,
      onclick: () => (isLab ? onPlaceResearchLab?.() : onPlaceBreeding?.())
    }, placed ? 'Already placed on the map'
       : !unlocked ? `Unlocks at player level ${BREEDING_UNLOCK_LEVEL}`
       : 'Place at my location'));
  }

  body.innerHTML = '';
  body.append(
    el('div', { class: 'det-head' },
      el('img', { src: itemImage(itemId), alt: def.name }),
      el('div', { class: 'det-title' },
        el('h3', { text: def.name }),
        el('div', { class: 'det-tags' },
          el('span', { class: 'tag', text: `You have ${num(qty)}` })
        )
      )
    ),
    el('p', { class: 'hint', text: def.blurb }),
    actions.length ? el('div', { class: 'btn-row' }, ...actions) : null
  );
  openSheet('sheet');
}

function useTimedItem(kind, def) {
  const label = def.name;
  const mins = Math.round(def.durationMs / 60000);
  if (!confirm(`Use one ${label}? It runs for ${mins} minutes and cannot be stopped early.`)) return;
  const r = store.startEffect(kind, Date.now(), def.id);
  if (!r.ok) {
    toast(r.reason === 'active'
      ? (kind === 'incense' ? 'An incense is already running' : `A ${label} is already running`)
      : `No ${label} left`, 'bad');
    return;
  }
  closeSheet('sheet');
  toast(`${label} active for ${mins} minutes`, 'good', 3200);
  refreshAll();
  onEffectsChanged?.();
}

/** main.js supplies these so views does not need to know about the map. */
export let onPlaceBreeding = null;
export let onPlaceResearchLab = null;
export let onEffectsChanged = null;
export function setViewHooks({ placeBreeding, placeResearchLab, effectsChanged }) {
  onPlaceBreeding = placeBreeding;
  onPlaceResearchLab = placeResearchLab;
  onEffectsChanged = effectsChanged;
}

/* ===============================================================
   CREATURE PICKER (potions, revives, breeding pairs)
   =============================================================== */
/**
 * One picker for every item you point at a creature. Each entry says who is
 * eligible, what the grid should say about them, and what happens on tap.
 */
const CREATURE_ITEM_PICKERS = {
  potion: {
    title: 'Heal which creature?',
    hint: 'Potions restore 50 HP. Fainted creatures need a Revive instead.',
    empty: 'None of your creatures are hurt.',
    eligible: c => !isFainted(c) && isHurt(c)
  },
  full_heal: {
    title: 'Fully heal which creature?',
    hint: 'A Full Heal takes one creature straight back to full HP, however hurt it is. It cannot revive a fainted creature.',
    empty: 'None of your creatures are hurt.',
    eligible: c => !isFainted(c) && isHurt(c)
  },
  revive: {
    title: 'Revive which creature?',
    hint: 'Revives bring a fainted creature back to full HP.',
    empty: 'None of your creatures have fainted.',
    eligible: c => isFainted(c)
  },
  stat_booster: {
    title: 'Boost which creature?',
    hint: `Adds a permanent +1 to one stat. Each creature can take ${MAX_STAT_BOOSTS} boosts in total across all four stats.`,
    empty: 'Every creature you own is already fully boosted.',
    // Fainted creatures are fine to boost; only the cap and breeding block it.
    eligible: c => store.boostsLeftOn(c) > 0
  }
};

export function openCreaturePicker(itemId) {
  const conf = CREATURE_ITEM_PICKERS[itemId] || CREATURE_ITEM_PICKERS.potion;
  const eligible = sortedForPicker(store.s.storage.filter(c => {
    if (c.breeding != null) return false;
    return conf.eligible(c);
  }));

  $('#picker-title').textContent = conf.title;
  $('#picker-hint').textContent = conf.hint;
  $('#picker-empty').textContent = conf.empty;
  $('#picker-empty').classList.toggle('hidden', eligible.length > 0);

  // ---- do-everything button: only the two bulk-healing items have one ----
  renderPickerBulkBar(itemId, eligible.length, () => openCreaturePicker(itemId));

  const grid = $('#picker-grid');
  grid.innerHTML = '';
  for (const c of eligible) {
    const s = sp(c);
    const max = maxHpOf(c), hp = hpOf(c);
    const pct = Math.round((hp / max) * 100);
    const used = store.boostsUsed(c);

    grid.append(el('button', {
      class: 'cell',
      onclick: () => useItemOnCreature(itemId, c, s)
    },
      el('span', { class: 'lvl', text: 'Lv' + c.level }),
      c.shiny ? el('span', { class: 'shiny-star', text: '★' }) : null,
      c.favourite ? el('span', { class: 'fav-star', text: '♥' }) : null,
      el('img', { src: s.spritePath(c.shiny), alt: s.name, loading: 'lazy' }),
      el('span', { class: 'nm', text: s.name }),
      // Boosting cares about how many boosts are spent, not about HP.
      itemId === 'stat_booster'
        ? el('span', { class: 'sub', text: `${used} / ${MAX_STAT_BOOSTS} boosted` })
        : el('span', { class: 'sub', text: `${hp} / ${max} HP` }),
      itemId === 'stat_booster'
        ? null
        : el('span', { class: 'hp-wrap' },
          el('span', { class: `hp-bar${pct <= 25 ? ' critical' : pct <= 60 ? ' low' : ''}` },
            el('i', { style: { width: pct + '%' } })))
    ));
  }
  openSheet('picker');
}

/** Applies the picked item, or opens a second step when one is needed. */
function useItemOnCreature(itemId, c, s) {
  if (itemId === 'stat_booster') {
    // Which stat is a separate decision, so it gets its own screen.
    openStatBoostPicker(c.uid);
    return;
  }

  const r = itemId === 'full_heal' ? store.useFullHeal(c.uid)
    : itemId === 'revive' ? store.useRevive(c.uid)
    : store.usePotion(c.uid);

  if (!r.ok) { toast('Could not use that item', 'bad'); return; }
  toast(itemId === 'revive'
    ? `${s.name} revived to ${r.max} HP`
    : `${s.name} healed ${r.gained} HP (${r.after}/${r.max})`, 'good');
  closeSheet('picker');
  refreshAll();
}

/**
 * Second step of a Stat Booster: which of the four stats gets the +1. Shows the
 * current figure and what it becomes, so the choice is never blind.
 */
export function openStatBoostPicker(uid) {
  const c = store.creature(uid);
  if (!c) return;
  const s = sp(c);
  const stats = creatureStats(c);
  const boosts = store.boostsOf(c);
  const left = store.boostsLeftOn(c);

  const body = $('#sheet-body');
  body.innerHTML = '';
  body.append(
    el('div', { class: 'det-head' },
      el('img', { src: s.spritePath(c.shiny), alt: s.name }),
      el('div', { class: 'det-title' },
        el('h3', { text: c.nickname || s.name }),
        el('div', { class: 'det-tags' },
          el('span', { class: 'tag', text: `Lv ${c.level}` }),
          el('span', { class: 'tag', text: `${store.boostsUsed(c)} / ${MAX_STAT_BOOSTS} boosted` }),
          el('span', { class: 'tag', text: `${store.itemCount('stat_booster')} in the bag` })
        )
      )
    ),
    el('p', { class: 'hint', text: `Pick the stat to raise by 1. ${left} boost${left === 1 ? '' : 's'} left on this creature.` }),
    el('div', { class: 'det-rows' }, ...STAT_KEYS.map(k =>
      el('button', {
        class: 'det-row boost-row',
        onclick: () => {
          const r = store.useStatBooster(uid, k);
          if (!r.ok) {
            toast(r.reason === 'maxed'
              ? `That creature already has all ${MAX_STAT_BOOSTS} boosts`
              : r.reason === 'noItem' ? 'No Stat Boosters left'
              : 'Could not boost that creature', 'bad');
            return;
          }
          toast(`${c.nickname || s.name} ${STAT_LABELS[k]} ${r.before} → ${r.after}`, 'good', 3200);
          refreshAll();
          // Straight back in if there are more to spend, otherwise close.
          if (store.hasItem('stat_booster') && store.boostsLeftOn(c) > 0) openStatBoostPicker(uid);
          else closeSheet('sheet');
        }
      },
        el('span', { text: '⬆' }),
        el('span', { text: STAT_LABELS[k] }),
        el('b', { text: `${stats[k]} → ${stats[k] + 1}` }),
        boosts[k] ? el('span', { class: 'tag', text: `+${boosts[k]} so far` }) : null
      )
    )),
    el('p', { class: 'hint', text: 'A boost is permanent. It is added after levelling and the stat modifier, so it stays exactly +1 however strong the creature gets.' })
  );
  closeSheet('picker');
  openSheet('sheet');
}

/**
 * Applies the Storage sort settings to any creature list, so every picker in
 * the game orders things the same way the player last chose in Storage.
 * Exported for the breeding centre picker in extras.js.
 */
export function sortedForPicker(list) {
  const { storageSort, storageDir } = store.s.ui;
  const out = [...list].sort(SORTERS[storageSort] || SORTERS.id);
  if (storageDir < 0) out.reverse();
  return out;
}

/**
 * "Heal all" / "Revive all" above the picker grid. Shows how many items it
 * would spend so the choice is never a surprise.
 */
function renderPickerBulkBar(itemId, eligibleCount, rerender) {
  const host = $('#picker-bulk');
  if (!host) return;
  host.innerHTML = '';
  if (!eligibleCount) return;
  // Only potions and revives have a sensible "do the lot" action. A Full Heal is
  // one creature by design, and a Stat Booster needs a stat chosen each time.
  if (itemId !== 'potion' && itemId !== 'revive') return;
  const isPotion = itemId === 'potion';

  const have = store.itemCount(isPotion ? 'potion' : 'revive');
  const need = isPotion ? store.potionsNeededForAll() : store.revivable().length;
  const willUse = Math.min(have, need);

  host.append(
    el('button', {
      class: 'btn primary wide',
      disabled: willUse < 1,
      onclick: () => {
        const r = isPotion ? store.healAll() : store.reviveAll();
        if (!r.ok) { toast(isPotion ? 'No potions left' : 'No revives left', 'bad'); return; }
        toast(isPotion
          ? `Healed ${r.healed} creature${r.healed === 1 ? '' : 's'} with ${r.used} potion${r.used === 1 ? '' : 's'}`
          : `Revived ${r.revived} creature${r.revived === 1 ? '' : 's'}`, 'good', 3400);
        refreshAll();
        rerender();
      }
    }, isPotion ? `Heal all · ${willUse} potion${willUse === 1 ? '' : 's'}` : `Revive all · ${willUse} revive${willUse === 1 ? '' : 's'}`),
    need > have
      ? el('p', { class: 'hint', text: isPotion
          ? `${need} potions would top everyone up, you have ${have}. The rest stay part-healed.`
          : `${need} creatures have fainted, you have ${have} revive${have === 1 ? '' : 's'}.` })
      : null
  );
}

/* ===============================================================
   CREATURE DETAIL SHEET (level up / evolve / release)
   =============================================================== */
let sheetUid = null;

export function openCreatureSheet(uid) {
  sheetUid = uid;
  renderCreatureSheet();
  openSheet('sheet');
}

function renderCreatureSheet() {
  const c = store.creature(sheetUid);
  const body = $('#sheet-body');
  if (!c) { closeSheet('sheet'); return; }

  const s = species(c.speciesId);
  const rarity = s.rarity || familyRarity(s.id);
  const rootId = familyRoot(s.id);
  const candy = store.candyFor(s.id);
  const cost = levelUpCost(c.level);
  const lvlCheck = store.canLevelUp(c.uid);
  const evoCheck = store.canEvolve(c.uid);
  const target = s.evolvesToId ? species(s.evolvesToId) : null;

  // Prev / next navigation via the current sort order
  const idx = sortedStorage.findIndex(x => x.uid === c.uid);
  const prevUid = idx > 0 ? sortedStorage[idx - 1].uid : null;
  const nextUid = idx < sortedStorage.length - 1 ? sortedStorage[idx + 1].uid : null;

  body.innerHTML = '';
  body.append(
    // ---- navigation arrows ----
    el('div', { class: 'sheet-nav' },
      el('button', { class: 'arrow-btn', disabled: !prevUid, onclick: () => goToCreature(prevUid, body, 'right') }, '‹'),
      el('span', { class: 'muted small', text: `${idx + 1} of ${sortedStorage.length}` }),
      el('button', { class: 'arrow-btn', disabled: !nextUid, onclick: () => goToCreature(nextUid, body, 'left') }, '›')
    ),

    // ---- favourite toggle ----
    el('div', { class: 'btn-row', style: { justifyContent: 'flex-end', marginBottom: '6px' } },
      el('button', {
        class: 'btn ghost' + (c.favourite ? ' fav-active' : ''),
        onclick: () => { store.toggleFavourite(c.uid); renderCreatureSheet(); refreshAll(); }
      }, c.favourite ? '♥ Favourited' : '♡ Favourite')
    ),

    el('div', { class: 'det-head' },
      el('img', {
        src: s.spritePath(c.shiny), alt: s.name, class: 'zoomable',
        title: 'Tap for a closer look',
        onclick: () => openImageViewer(s.spritePath(c.shiny), c.nickname || s.name)
      }),
      el('div', { class: 'det-title' },
        el('h3', { text: s.name }),
        el('div', { class: 'id', text: s.id }),
        el('div', { class: 'det-tags' },
          el('span', { class: `tag t-${s.type}`, text: s.type }),
          el('span', { class: 'tag', text: s.stageLabel }),
          rarity ? el('span', { class: `tag r-${rarity}`, text: `${rarity} · ${RARITY_NAMES[rarity]}` }) : null,
          el('span', { class: 'tag', text: 'Level ' + c.level })
        )
      )
    ),

    // ---- HP ----
    (() => {
      const max = maxHpOf(c), hp = hpOf(c);
      const pct = Math.round((hp / max) * 100);
      return el('div', { class: 'det-row' },
        el('span', { text: '❤' }),
        el('span', { class: `hp-bar${pct <= 25 ? ' critical' : pct <= 60 ? ' low' : ''}` },
          el('i', { style: { width: pct + '%' } })),
        el('b', { text: `${hp} / ${max}` })
      );
    })(),

    // ---- stats with the +10% / -10% arrows ----
    abilityButton(s),

    el('h4', { class: 'sheet-h4', text: 'Stats' }),
    el('div', { class: 'det-rows' }, ...statRows(c)),
    el('p', { class: 'hint', text: `Stat modifier: ${STAT_LABELS[c.statMod.up]} up 10%, ${STAT_LABELS[c.statMod.down]} down 10%. Each level adds ${Math.round(STAT_GROWTH_PER_LEVEL * 100)}% of the base stat.` }),
    store.boostsUsed(c)
      ? el('p', { class: 'hint', text: `Stat Boosters: ${store.boostsUsed(c)} of ${MAX_STAT_BOOSTS} used (${STAT_KEYS.filter(k => store.boostsOf(c)[k]).map(k => `${STAT_LABELS[k]} +${store.boostsOf(c)[k]}`).join(', ')}). ${store.boostsLeftOn(c)} left.` })
      : null,

    // ---- moves ----
    el('h4', { class: 'sheet-h4', text: 'Moves' }),
    movesBlock(c, s),

    el('div', { class: 'det-rows' },
      el('div', { class: 'det-row' },
        el('span', { text: CANDY_ICON }),
        el('span', { text: `${familyName(s.id)} candy` }),
        el('b', { text: num(candy) })
      ),
      el('div', { class: 'det-row' },
        el('span', { text: DUST_ICON }),
        el('span', { text: 'Stardust (shared)' }),
        el('b', { text: num(store.s.stardust) })
      ),
      el('div', { class: 'det-row' },
        el('span', { text: '📅' }),
        el('span', { text: 'Caught' }),
        el('b', { text: new Date(c.capturedAt).toLocaleDateString() })
      ),
      el('div', { class: 'det-row' },
        el('span', { text: '🔢' }),
        el('span', { text: 'You own' }),
        el('b', { text: `${store.countOfSpecies(s.id)} of this` })
      ),
      c.breeding != null ? el('div', { class: 'det-row' },
        el('span', { text: '⚑' }),
        el('span', { text: 'In the breeding centre' }),
        el('b', { text: 'Collect it there' })
      ) : null
    ),

    // ---- level up (costs stardust AND family candy) ----
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn primary',
        disabled: !lvlCheck.ok,
        onclick: () => doLevelUp(c.uid)
      }, c.level >= MAX_CREATURE_LEVEL
        ? 'Max level'
        : cost ? `Level up → Lv ${c.level + 1} · ${DUST_ICON} ${num(cost.stardust)} · ${CANDY_ICON} ${num(cost.candy)}` : 'Max level')
    ),
    (!lvlCheck.ok && lvlCheck.reason !== 'max' && lvlCheck.reason !== 'missing' && lvlCheck.shortDust != null)
      ? el('p', { class: 'hint', text: [
          lvlCheck.shortDust ? `${num(lvlCheck.shortDust)} more stardust` : null,
          lvlCheck.shortCandy ? `${num(lvlCheck.shortCandy)} more ${familyName(s.id)} candy` : null
        ].filter(Boolean).join(' and ') + ' needed.' })
      : null,

    // ---- evolve ----
    target
      ? el('div', { class: 'btn-row' },
          el('button', {
            class: 'btn',
            disabled: !evoCheck.ok,
            onclick: () => doEvolve(c.uid)
          }, `Evolve → ${target.name} · ${CANDY_ICON} ${num(s.evolutionCandy)}`)
        )
      : el('p', { class: 'hint', text: 'This creature does not evolve any further.' }),
    target && !evoCheck.ok && evoCheck.reason === 'candy'
      ? el('p', { class: 'hint', text: `Need ${num(evoCheck.short)} more ${familyName(s.id)} candy.` })
      : null,
    target ? el('p', { class: 'hint', text: 'Level carries over to the evolved form.' }) : null,

    // ---- buddy ----
    el('div', { class: 'btn-row' },
      store.isBuddy(c.uid)
        ? el('button', { class: 'btn ghost', onclick: () => { store.clearBuddy(); renderCreatureSheet(); refreshAll(); toast('Buddy removed'); } },
            '🐾 Stop walking together')
        : el('button', {
            class: 'btn',
            disabled: c.breeding != null,
            onclick: () => {
              const r = store.setBuddy(c.uid);
              if (!r.ok) { toast('That creature cannot be your buddy right now', 'bad'); return; }
              renderCreatureSheet();
              refreshAll();
              toast(`${nameOf(c)} is your buddy now`, 'good');
            }
          }, '🐾 Make this my buddy')
    ),

    // ---- release ----
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn danger',
        disabled: !!c.favourite || store.isBuddy(c.uid),
        onclick: () => doRelease(c.uid)
      }, store.isBuddy(c.uid)
        ? 'Buddies cannot be released'
        : c.favourite
          ? 'Unfavourite to release'
          : `Release · +${CANDY_ICON} 1 ${familyName(s.id)} candy`)
    )
  );

  // Swiping the sheet walks the same full sorted list as the arrows.
  wireSwipe(body, {
    onLeft: () => goToCreature(nextUid, body, 'left'),
    onRight: () => goToCreature(prevUid, body, 'right')
  }, { key: 'sheetNav' });
}

const nameOf = c => species(c.speciesId).name;

/**
 * Moves the sheet to another creature. The storage page follows along, so
 * closing the sheet leaves you looking at the page you ended up on.
 */
function goToCreature(uid, host, dir) {
  if (!uid) { bumpEl(host, dir); return; }
  sheetUid = uid;
  const idx = sortedStorage.findIndex(x => x.uid === uid);
  if (idx >= 0) {
    const page = pageOfIndex(idx);
    if (page !== store.s.ui.storagePage) store.s.ui.storagePage = page;
  }
  renderCreatureSheet();
}

/**
 * The ✦ Ability button, or nothing when the species has none. Shared by the
 * storage sheet and the collection sheet, so both describe an ability the same
 * way. Returns null so it can be dropped straight into an el() child list.
 */
export function abilityButton(sp) {
  const ability = sp?.ability;
  if (!ability) return null;
  return el('div', { class: 'btn-row' },
    el('button', {
      class: 'btn ghost ability-btn',
      onclick: () => openAbilitySheet(sp.id)
    }, `✦ ${ability.name}`)
  );
}

/** What the ability does, in words, plus a clause-by-clause breakdown. */
export function openAbilitySheet(speciesId) {
  const sp = species(speciesId);
  const ability = sp?.ability;
  if (!ability) return;

  const body = $('#sheet-body');
  body.innerHTML = '';
  body.append(
    el('div', { class: 'det-head' },
      el('img', { src: sp.imagePath, alt: sp.name }),
      el('div', { class: 'det-title' },
        el('h3', { text: ability.name }),
        el('div', { class: 'det-tags' },
          el('span', { class: 'tag tag-ability', text: '✦ Ability' }),
          el('span', { class: 'tag', text: sp.name })
        )
      )
    ),
    el('p', { text: abilityText(ability) }),
    // One row per clause, so a multi-condition ability is readable at a glance.
    ability.clauses.length > 1
      ? el('div', { class: 'det-rows' }, ...ability.clauses.map(cl =>
        el('div', { class: 'det-row ability-clause' },
          el('span', { text: '✦' }),
          el('span', { text: clauseConditionText(cl).replace(/^./, ch => ch.toUpperCase()) }),
          el('b', { text: clauseEffectText(cl) })
        )))
      : null,
    el('p', { class: 'hint', text: 'An ability is checked when the creature takes the field and again whenever a new opponent steps up. The battle log says whether it triggered.' })
  );
  openSheet('sheet');
}

/**
 * One row per stat, with a bar and the modifier arrow, then a total row.
 * The total is the plain sum of the four displayed figures, so it always
 * matches what is on screen above it.
 */
function statRows(c) {
  const stats = creatureStats(c);
  const boosts = store.boostsOf(c);
  const rows = STAT_KEYS.map(k => {
    const arrow = c.statMod.up === k ? 'up' : c.statMod.down === k ? 'down' : '';
    return el('div', { class: 'stat-row' },
      el('span', { class: 'lbl', text: STAT_LABELS[k] }),
      el('span', { class: 'bar' },
        el('i', { style: { width: Math.min(100, (stats[k] / STAT_BAR_MAX) * 100) + '%' } })),
      el('span', { class: 'val', text: num(stats[k]) }),
      // How much of this figure came from Stat Boosters, if any.
      boosts[k] ? el('span', { class: 'boost-tag', text: `+${boosts[k]}` }) : null,
      el('span', { class: `arrow ${arrow}`, text: arrow === 'up' ? '▲' : arrow === 'down' ? '▼' : '' })
    );
  });

  const total = STAT_KEYS.reduce((sum, k) => sum + stats[k], 0);
  rows.push(el('div', { class: 'stat-row total' },
    el('span', { class: 'lbl', text: 'Total' }),
    el('span', { class: 'bar' }),
    el('span', { class: 'val', text: num(total) }),
    el('span', { class: 'arrow' })
  ));
  return rows;
}

/**
 * Move list for a stored creature: what it knows now, and when the rest arrive.
 * Also spells out the early-unlock luck it was caught with.
 */
function movesBlock(c, s) {
  const host = el('div', { class: 'move-list' });
  // The whole family's learnset, not just this form's. An early form often
  // only carries the first two or three slots, with the rest waiting on the
  // final evolution — but all four belong in this list, early-unlock luck
  // included, so the player can see what the creature is working towards.
  const learnset = fullLearnset(s.id);
  const finalSp = finalEvolutionOf(s.id);

  for (const m of learnset) {
    const at = moveLevelFor(m, c.moveUnlock);
    const early = at < m.level;
    // Does the form it is in right now actually have this move slot?
    const hasSlot = s.moves.some(x => x.slot === m.slot);
    const known = hasSlot && at <= c.level;

    const notes = [];
    if (early) notes.push(`unlocked Lv ${at} instead of Lv ${m.level}`);
    if (!hasSlot) notes.push(`needs ${m.fromName}`);

    host.append(el('div', { class: 'move' + (known ? '' : ' locked') },
      el('div', { class: 'move-top' },
        el('b', { text: m.name }),
        el('span', { class: 'lv' + (early ? ' early' : ''), text: known ? 'Known' : `Lv ${at}` })
      ),
      el('div', { class: 'move-meta' },
        m.isBuff
          ? el('span', { class: 'bf', text: buffMoveText(m) })
          : el('span', { class: 'pw', text: `${m.power} power` }),
        notes.length ? el('span', { text: ' · ' + notes.join(' · ') }) : null
      )
    ));
  }

  const nextMove = nextMoveFor(c, s);
  if (nextMove) {
    host.append(el('p', { class: 'hint', text: nextMoveLabel(nextMove, c) }));
  }
  if (finalSp && finalSp.id !== s.id) {
    host.append(el('p', { class: 'hint', text: `Full move list for the line, up to ${finalSp.name}.` }));
  }
  return host;
}

function nextMoveLabel(next, c) {
  if (!next.needsEvolution) return `Next move: ${next.name} at level ${next.at}`;
  return next.at <= c.level
    ? `Next move: ${next.name}, as soon as it evolves into ${next.fromName}`
    : `Next move: ${next.name} at level ${next.at}, once it is a ${next.fromName}`;
}

/**
 * The soonest move this creature cannot use yet — either because its level is
 * too low, or because the move belongs to a later form.
 */
function nextMoveFor(c, s) {
  return fullLearnset(s.id)
    .map(m => ({
      name: m.name,
      at: moveLevelFor(m, c.moveUnlock),
      fromName: m.fromName,
      needsEvolution: !s.moves.some(x => x.slot === m.slot)
    }))
    .filter(m => m.needsEvolution || m.at > c.level)
    .sort((a, b) => a.at - b.at)[0] || null;
}

function doLevelUp(uid) {
  const r = store.levelUp(uid);
  if (!r.ok) {
    toast(({
      max: 'Already at max level',
      dust: 'Not enough stardust',
      candy: 'Not enough candy',
      both: 'Not enough stardust or candy'
    })[r.reason] || 'Cannot level up', 'bad');
    return;
  }
  toast(`Levelled up to Lv ${r.level} (−${num(r.cost.stardust)} stardust, −${num(r.cost.candy)} candy)`, 'good');
  refreshAll();
  renderCreatureSheet();
}

async function doEvolve(uid) {
  const check = store.canEvolve(uid);
  if (!check.ok) {
    toast(check.reason === 'candy' ? `Need ${check.short} more candy` : 'Cannot evolve', 'bad');
    return;
  }
  const from = species(store.creature(uid).speciesId);
  closeSheet('sheet');

  const result = store.evolve(uid);
  if (!result.ok) { toast('Cannot evolve', 'bad'); return; }

  await playEvolution({
    from,
    to: result.to,
    isNew: result.isNew,
    fromSrc: from.spritePath(result.shiny),
    toSrc: result.to.spritePath(result.shiny),
    rewards: [
      { icon: CANDY_ICON, label: `−${num(result.cost)} candy` },
      { icon: '⭐', label: `+${result.xp} XP` },
      { icon: '📈', label: `Level ${result.level} kept` }
    ]
  });

  if (result.levelUp.levelledUp) toast(`Player level ${result.levelUp.to}!`, 'good');
  refreshAll();
  openCreatureSheet(uid);
}

function doRelease(uid) {
  const c = store.creature(uid);
  if (!c) return;
  const s = species(c.speciesId);
  const ok = confirm(`Release ${s.name} (Lv ${c.level})?\n\nYou get 1 ${familyName(s.id)} candy. This cannot be undone.`);
  if (!ok) return;
  const r = store.remove(uid);
  if (!r.ok) {
    toast(({
      buddy: 'Your buddy cannot be released — pick a different buddy first',
      favourite: 'Unfavourite it before releasing',
      breeding: 'It is in the breeding centre'
    })[r.reason] || 'Could not release that creature', 'bad', 3600);
    return;
  }
  closeSheet('sheet');
  toast(`Released ${s.name} · +1 ${familyName(s.id)} candy`, 'good');
  refreshAll();
}

/* ===============================================================
   COLLECTION
   =============================================================== */
export function initCollectionFilters() {
  const sel = $('#filter-type');
  sel.innerHTML = '<option value="">All</option>';
  for (const t of DB.types) sel.append(el('option', { value: t, text: t }));
}

export function renderCollection() {
  const ui = store.s.ui;
  const setIndex = Math.max(0, Math.min(SETS.length - 1, ui.setIndex || 0));
  const set = SETS[setIndex];

  $('#set-title').textContent = set.title;
  $('#set-prev').disabled = setIndex === 0;
  $('#set-next').disabled = setIndex === SETS.length - 1;
  $('#collection-body').classList.toggle('hidden', !set.available);
  $('#collection-soon').classList.toggle('hidden', set.available);
  if (!set.available) return;

  $('#filter-type').value = ui.filterType || '';
  $('#filter-stage').value = ui.filterStage || '';
  $('#filter-rarity').value = ui.filterRarity || '';

  // Shiny mode is a completion view: the same species list, but showing the
  // shiny artwork for the ones you have caught shiny and a silhouette for the
  // rest, so you can see what is still missing.
  const shinyMode = !!ui.collectionShiny;
  const shinyBtn = $('#collection-shiny');
  if (shinyBtn) {
    shinyBtn.textContent = shinyMode ? '★ Shiny' : '☆ Shiny';
    shinyBtn.classList.toggle('fav-active', shinyMode);
    shinyBtn.title = shinyMode ? 'Showing your shiny collection' : 'Show your shiny collection';
  }

  // Each tab has its own species list: the Exclusive tab shows only the
  // raid-exclusive creatures, and the main set leaves them out.
  const setSpecies = speciesForSet(set);

  let list = setSpecies.filter(s => {
    if (ui.filterType && s.type !== ui.filterType) return false;
    if (ui.filterStage && String(s.stage) !== String(ui.filterStage)) return false;
    if (ui.filterRarity && String(s.rarity ?? '') !== String(ui.filterRarity)) return false;
    return true;
  });

  // Sort collection. "Times caught" means the lifetime total — the same figure
  // the species sheet shows as "Total caught". It used to read how many you are
  // holding right now, so releasing a creature quietly changed the order.
  const collSort = $('#collection-sort')?.value || 'id';
  if (collSort === 'caught') {
    list = [...list].sort((a, b) =>
      store.totalCaughtOf(b.id) - store.totalCaughtOf(a.id) || a.order - b.order);
  }

  // Cached so the species sheet's arrows and swipe can walk this exact order,
  // filters and all, the way the storage sheet walks sortedStorage.
  sortedCollection = list;

  // Galactic Adventures arrives in stages, so say which rarities are in play.
  // The Mythical tab gets a line of its own explaining it is not a pool.
  const note = $('#collection-note');
  if (note) {
    let text = '';
    if (set.id === 'galactic-adventures') {
      const got = unlockedGalacticRarities();
      text = got.length === 5
        ? `Every rarity is unlocked — the whole set is in circulation.`
        : got.length
          ? `Unlocked so far: <b>${got.map(r => RARITY_NAMES[r]).join(', ')}</b>. `
            + `The rest arrive through the <b>Set</b> missions.`
          : `None unlocked yet. Fill in <b>${SETS[0].title}</b> and the <b>Set</b> missions open these up one rarity at a time.`;
    } else if (set.id === 'mythical') {
      text = shinyMode
        ? `Mythicals have <b>no shiny form</b> — the eggs they come from never roll one, so there is nothing to complete here.`
        : `Rarity ${MYTHICAL_RARITY}. These never spawn, never appear in a raid and never hatch from an ordinary egg — `
          + `each one has its own single way of being found.`;
    }
    note.classList.toggle('hidden', !text);
    note.innerHTML = text;
  }

  const have = s => (shinyMode ? store.hasShinyCaught(s.id) : store.isRegistered(s.id));
  const haveHere = list.filter(have).length;
  const word = shinyMode ? 'shiny' : 'registered';
  // The "total" figure is per set, so the Exclusive tab reads out of 19 rather
  // than out of the whole dex.
  const setHave = setSpecies.filter(have).length;
  $('#collection-count').textContent =
    `${haveHere} / ${list.length} ${word}` +
    (list.length !== setSpecies.length ? ` (filtered · ${setHave} / ${setSpecies.length} total)` : '');

  const grid = $('#collection-grid');
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const s of list) {
    const known = store.isRegistered(s.id);
    const got = have(s);

    // In shiny mode the art is always the shiny one; not-yet-caught shinies are
    // blacked out to a silhouette. A handful of species have no shiny file, so
    // fall back to the normal art — the silhouette filter hides the difference.
    const img = el('img', {
      src: shinyMode ? s.shinyPath : s.imagePath,
      alt: s.name,
      loading: 'lazy'
    });
    if (shinyMode) {
      img.addEventListener('error', () => { img.src = s.imagePath; }, { once: true });
    }

    frag.append(el('button', {
      class: 'cell'
        + (shinyMode ? (got ? ' shiny' : ' shadow') : (known ? '' : ' locked')),
      onclick: () => openSpeciesSheet(s.id)
    },
      s.rarity ? el('span', { class: `rar r-${s.rarity}`, text: s.rarity }) : null,
      shinyMode && got ? el('span', { class: 'shiny-star', text: '★' }) : null,
      img,
      el('span', { class: 'nm', text: s.name }),
      el('span', {
        class: `sub ${got && known ? 't-' + s.type : ''}`,
        text: shinyMode ? (got ? s.type : 'Not caught') : (known ? s.type : '???')
      }),
      el('span', { class: 'stg', text: 'S' + s.stage })
    ));
  }
  grid.append(frag);
  if (!list.length) grid.append(el('p', { class: 'empty', text: 'No creatures match those filters.' }));
}

export function openSpeciesSheet(speciesId) {
  renderSpeciesSheet(speciesId);
  openSheet('sheet');
}

/**
 * Moves the species sheet along the collection, mirroring how the storage sheet
 * walks sortedStorage. The Collection renders every match on one page, so
 * unlike storage there is no page to keep in step.
 */
function goToSpecies(speciesId, host, dir) {
  if (!speciesId) { bumpEl(host, dir); return; }
  renderSpeciesSheet(speciesId);
}

function renderSpeciesSheet(speciesId) {
  const s = species(speciesId);
  if (!s) return;
  const known = store.isRegistered(s.id);
  const owned = store.countOfSpecies(s.id);
  const target = s.evolvesToId ? species(s.evolvesToId) : null;
  const from = DB.evolvesFrom.get(s.id) ? species(DB.evolvesFrom.get(s.id)) : null;
  const rarity = s.rarity;
  const chain = (DB.familyMembers.get(familyRoot(s.id)) || []).map(id => species(id));
  // All four moves for the line, even the ones held back until the final form.
  const lineMoves = fullLearnset(s.id);

  const hasShiny = store.hasShinyCaught(s.id);
  let showingShiny = false;

  // Zoomable, and it opens whichever art is on screen — normal or shiny.
  const img = el('img', {
    src: s.imagePath,
    alt: s.name,
    class: 'zoomable' + (known ? '' : ' locked'),
    title: 'Tap for a closer look',
    onclick: () => openImageViewer(img.src, known ? s.name : '???')
  });
  const shinyBtn = hasShiny
    ? el('button', {
        class: 'btn ghost shiny-toggle',
        onclick: () => {
          showingShiny = !showingShiny;
          img.src = showingShiny ? s.shinyPath : s.imagePath;
          shinyBtn.textContent = showingShiny ? '★ Showing shiny' : '☆ Show shiny';
          shinyBtn.classList.toggle('fav-active', showingShiny);
        }
      }, '☆ Show shiny')
    : null;

  // Prev / next along whatever the Collection is currently showing. Falls back
  // to no navigation if the sheet was opened from somewhere else entirely.
  const navIdx = sortedCollection.findIndex(x => x.id === s.id);
  const prevId = navIdx > 0 ? sortedCollection[navIdx - 1].id : null;
  const nextId = navIdx >= 0 && navIdx < sortedCollection.length - 1
    ? sortedCollection[navIdx + 1].id
    : null;

  const body = $('#sheet-body');
  body.innerHTML = '';
  body.append(
    navIdx >= 0
      ? el('div', { class: 'sheet-nav' },
        el('button', {
          class: 'arrow-btn', disabled: !prevId, 'aria-label': 'Previous creature',
          onclick: () => goToSpecies(prevId, body, 'right')
        }, '‹'),
        el('span', { class: 'muted small', text: `${navIdx + 1} of ${sortedCollection.length}` }),
        el('button', {
          class: 'arrow-btn', disabled: !nextId, 'aria-label': 'Next creature',
          onclick: () => goToSpecies(nextId, body, 'left')
        }, '›')
      )
      : null,
    el('div', { class: 'det-head' },
      img,
      el('div', { class: 'det-title' },
        el('h3', { text: known ? s.name : '???' }),
        el('div', { class: 'id', text: s.id }),
        el('div', { class: 'det-tags' },
          el('span', { class: 'tag', text: s.stageLabel }),
          el('span', { class: `tag t-${s.type}`, text: s.type }),
          rarity ? el('span', { class: `tag r-${rarity}`, text: `${rarity} · ${RARITY_NAMES[rarity]}` }) : null,
          el('span', { class: 'tag', text: known ? 'Registered' : 'Not registered' }),
          hasShiny ? el('span', { class: 'tag r-5', text: '★ Shiny caught' }) : null
        ),
        shinyBtn
      )
    ),

    el('div', { class: 'det-rows' },
      el('div', { class: 'det-row' },
        el('span', { text: '🌱' }),
        el('span', { text: 'Stage' }),
        el('b', { text: s.stageLabel })
      ),
      el('div', { class: 'det-row' },
        el('span', { text: '💎' }),
        el('span', { text: 'Rarity' }),
        el('b', { text: rarity ? `${rarity} · ${RARITY_NAMES[rarity]}` : 'Evolution only' })
      ),
      el('div', { class: 'det-row' },
        el('span', { text: '🧬' }),
        el('span', { text: 'Evolution' }),
        el('b', { text: target ? `→ ${target.name} · ${num(s.evolutionCandy)} candy` : 'Does not evolve' })
      ),
      from ? el('div', { class: 'det-row' },
        el('span', { text: '⬅' }),
        el('span', { text: 'Evolves from' }),
        el('b', { text: from.name })
      ) : null,
      el('div', { class: 'det-row' },
        el('span', { text: '🎒' }),
        el('span', { text: 'In storage' }),
        el('b', { text: num(owned) })
      ),
      el('div', { class: 'det-row' },
        el('span', { text: '🏆' }),
        el('span', { text: 'Total caught' }),
        el('b', { text: num(store.totalCaughtOf(s.id)) })
      ),
      el('div', { class: 'det-row' },
        el('span', { text: CANDY_ICON }),
        el('span', { text: `${familyName(s.id)} candy` }),
        el('b', { text: num(store.candyFor(s.id)) })
      )
    ),

    abilityButton(s),

    // ---- base stats at level 1 ----
    el('h4', { class: 'sheet-h4', text: 'Base stats (level 1)' }),
    el('div', { class: 'det-rows' },
      ...STAT_KEYS.map(k =>
        el('div', { class: 'stat-row' },
          el('span', { class: 'lbl', text: STAT_LABELS[k] }),
          el('span', { class: 'bar' },
            el('i', { style: { width: Math.min(100, (s.baseStats[k] / STAT_BAR_MAX) * 100) + '%' } })),
          el('span', { class: 'val', text: num(s.baseStats[k]) }),
          el('span', { class: 'arrow', text: '' })
        )),
      el('div', { class: 'stat-row total' },
        el('span', { class: 'lbl', text: 'Total' }),
        el('span', { class: 'bar' }),
        el('span', { class: 'val', text: num(STAT_KEYS.reduce((sum, k) => sum + s.baseStats[k], 0)) }),
        el('span', { class: 'arrow' })
      )
    ),
    el('p', { class: 'hint', text: `Each level adds ${Math.round(STAT_GROWTH_PER_LEVEL * 100)}% of the base stat. Every creature you catch also gets one stat 10% higher and another 10% lower.` }),

    // ---- everything the line can learn, across the whole family ----
    el('h4', { class: 'sheet-h4', text: `Moves (${lineMoves.length})` }),
    el('div', { class: 'move-list' }, ...lineMoves.map(m => {
      const hasSlot = s.moves.some(x => x.slot === m.slot);
      return el('div', { class: 'move' + (hasSlot ? '' : ' locked') },
        el('div', { class: 'move-top' },
          el('b', { text: m.name }),
          el('span', { class: 'lv', text: `Lv ${m.level}` })
        ),
        el('div', { class: 'move-meta' },
          m.isBuff
            ? el('span', { class: 'bf', text: buffMoveText(m) })
            : el('span', { class: 'pw', text: `${m.power} power` }),
          hasSlot ? null : el('span', { text: ` · needs ${m.fromName}` })
        )
      );
    })),

    chain.length > 1 ? el('p', { class: 'hint', text: 'Family: ' + chain.map(x => x.name).join(' → ') }) : null,
    s.stage === 1
      ? el('p', { class: 'hint', text: 'Found in the wild at shops, amenities, tourist spots, bus stops and industrial buildings.' })
      : el('p', { class: 'hint', text: 'Only obtainable by evolving with candy.' }),

    // Jump to everything you own from this line, whichever stage it is in.
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn primary',
        onclick: () => showFamilyInStorage(s.id)
      }, '🎒 Show in your storage')
    ),
    el('p', { class: 'hint', text: `Filters Storage to your ${familyName(s.id)} line — every stage, ${chain.length > 1 ? 'pre-evolutions and evolutions included' : 'this creature only'}.` })
  );

  // Swiping walks the same list as the arrows, exactly as in storage. Both
  // sheets share #sheet-body and the same handler key, so whichever one drew
  // last owns the gesture.
  wireSwipe(body, {
    onLeft: () => goToSpecies(nextId, body, 'left'),
    onRight: () => goToSpecies(prevId, body, 'right')
  }, { key: 'sheetNav' });
}

/**
 * Filters Storage to one family and shows it. The whole line is included, so it
 * does not matter which stage you opened this from.
 */
export function showFamilyInStorage(speciesId) {
  const root = familyRoot(speciesId);
  const owned = store.s.storage.filter(c => familyRoot(c.speciesId) === root).length;

  closeSheet('sheet');
  store.setUI({ storageFamily: root, storageTab: 'creatures', storagePage: 0 });

  // Drive the real nav button so the active view, the highlight and the render
  // all stay in step — view switching lives in that handler.
  document.querySelector('.nav-btn[data-view="storage"]')?.click();
  renderStorage();

  if (!owned) toast(`You have no ${familyName(speciesId)} in storage yet`, '', 3200);
}

/* ===============================================================
   BUDDY
   =============================================================== */
const km = m => (m / 1000).toFixed(2);

/** The Buddy card on the Profile: who is walking with you and their progress. */
export function renderBuddy() {
  const host = $('#buddy-body');
  if (!host) return;
  host.innerHTML = '';

  const prog = store.buddyProgress();
  if (!prog) {
    host.append(
      el('p', { class: 'muted small', text: 'Pick a creature to walk with you. It earns candy for its family the further you walk, and it can still battle, level up and evolve.' }),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn primary', onclick: openBuddyPicker }, '🐾 Add buddy'))
    );
    return;
  }

  const c = prog.creature;
  const s = species(c.speciesId);
  const rarity = familyRarity(s.id);

  host.append(
    el('div', { class: 'buddy-top' },
      el('img', { class: 'buddy-img', src: s.spritePath(c.shiny), alt: s.name }),
      el('div', { class: 'buddy-meta' },
        el('b', { text: s.name + (c.shiny ? ' ★' : '') }),
        el('div', { class: 'muted small', text: `Level ${c.level} · ${RARITY_NAMES[rarity]}` }),
        el('div', { class: 'small buddy-candy', text: `${CANDY_ICON} ${num(store.candyFor(s.id))} ${familyName(s.id)} candy` })
      )
    ),
    el('div', { class: 'buddy-bar-wrap' },
      el('div', { class: 'buddy-bar' }, el('i', { style: { width: prog.pct + '%' } })),
      el('div', { class: 'buddy-bar-labels' },
        el('span', { class: 'muted small', text: `${km(prog.metresDone)} / ${km(prog.metresNeeded)} km` }),
        el('span', { class: 'small', text: `${km(prog.metresLeft)} km to next candy` })
      )
    ),
    el('p', { class: 'hint', text: `A ${RARITY_NAMES[rarity]} buddy earns one candy every ${BUDDY_KM_PER_CANDY[rarity]} km walked. Earned so far: ${num(prog.candyEarned)}.` }),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn ghost', onclick: openBuddyPicker }, 'Swap buddy'),
      el('button', {
        class: 'btn ghost',
        onclick: () => {
          if (!confirm('Stop walking with your buddy? Progress towards the next candy is lost.')) return;
          store.clearBuddy();
          renderProfile();
          toast('Buddy removed');
        }
      }, 'Remove')
    )
  );
}

/** Tap-to-choose list of everything eligible to be a buddy. */
function openBuddyPicker() {
  const eligible = sortedForPicker(
    store.s.storage.filter(c => c.breeding == null && !store.isBuddy(c.uid)));

  $('#picker-title').textContent = 'Walk with which creature?';
  $('#picker-hint').textContent = 'Your buddy earns candy for its family as you walk. It can still battle, level up and evolve, but it cannot be released. Sorted the same way as your Storage.';
  $('#picker-empty').textContent = 'Nothing available — creatures in the breeding centre cannot be your buddy.';
  $('#picker-empty').classList.toggle('hidden', eligible.length > 0);
  $('#picker-bulk').innerHTML = '';

  const grid = $('#picker-grid');
  grid.innerHTML = '';
  for (const c of eligible) {
    const s = species(c.speciesId);
    const rarity = familyRarity(s.id);
    const max = maxHpOf(c), hp = hpOf(c);
    const pct = Math.round((hp / max) * 100);
    grid.append(el('button', {
      class: 'cell' + (c.shiny ? ' shiny' : ''),
      onclick: () => {
        const r = store.setBuddy(c.uid);
        if (!r.ok) { toast('Could not pick that creature', 'bad'); return; }
        closeSheet('picker');
        renderProfile();
        toast(`${s.name} is your buddy now`, 'good');
      }
    },
      el('span', { class: 'lvl', text: 'Lv' + c.level }),
      rarity ? el('span', { class: `rar r-${rarity}`, text: rarity }) : null,
      c.shiny ? el('span', { class: 'shiny-star', text: '★' }) : null,
      c.favourite ? el('span', { class: 'fav-star', text: '♥' }) : null,
      el('img', { src: s.spritePath(c.shiny), alt: s.name, loading: 'lazy' }),
      el('span', { class: 'nm', text: s.name }),
      el('span', { class: 'hp-wrap' },
        el('span', { class: `hp-bar${pct <= 25 ? ' critical' : pct <= 60 ? ' low' : ''}` },
          el('i', { style: { width: pct + '%' } }))),
      el('span', { class: 'sub', text: `${BUDDY_KM_PER_CANDY[rarity]} km per candy` }),
      isFainted(c) ? el('span', { class: 'fainted-badge', text: 'FAINTED' }) : null
    ));
  }
  openSheet('picker');
}

/* ===============================================================
   PROFILE
   =============================================================== */
export function renderProfile() {
  renderBuddy();
  const p = store.progress;
  $('#p-nickname').textContent = store.nickname || 'Nameless hunter';
  $('#p-level').textContent = p.level;
  $('#p-xp').textContent = num(store.s.xp);
  $('#p-xp-fill').style.width = p.pct + '%';
  $('#p-next').textContent = p.max
    ? `Max level ${MAX_PLAYER_LEVEL} reached`
    : `${num(p.nextAt - store.s.xp)} XP to level ${p.level + 1}`;

  $('#p-stardust').textContent = num(store.s.stardust);
  $('#p-stored').textContent = num(store.s.storage.length);
  $('#p-registered').textContent = `${store.registeredCount} / ${DB.species.length}`;
  $('#p-captures').textContent = num(store.s.stats.captures);
  $('#p-evolutions').textContent = num(store.s.stats.evolutions);

  const steps = Math.floor(store.s.stats.steps || 0);
  const metres = Math.round(store.s.stats.metresWalked || 0);
  const stepsEl = $('#p-steps');
  if (stepsEl) {
    stepsEl.textContent = num(steps);
    stepsEl.title = metres >= 1000
      ? `${(metres / 1000).toFixed(2)} km walked`
      : `${num(metres)} m walked`;
  }
  const distEl = $('#p-distance');
  if (distEl) {
    distEl.textContent = metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${num(metres)} m`;
  }

  const hideUsed = $('#opt-hide-collected');
  if (hideUsed) hideUsed.checked = !!store.s.ui.hideCollectedPoints;

  // candy per family, highest first
  const host = $('#candy-list');
  host.innerHTML = '';
  const rows = Object.entries(store.s.candy)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || familyName(a[0]).localeCompare(familyName(b[0])));
  if (!rows.length) {
    host.append(el('p', { class: 'muted small', text: 'No candy yet. Catch creatures to earn candy for their family.' }));
  } else {
    for (const [rootId, n] of rows) {
      const root = species(rootId);
      host.append(el('div', { class: 'candy-row' },
        root ? el('img', { src: root.imagePath, alt: '', loading: 'lazy' }) : null,
        el('span', { text: root ? root.name : rootId }),
        el('b', { text: `${CANDY_ICON} ${num(n)}` })
      ));
    }
  }

  renderSaveStatus();
}

export function renderSaveStatus() {
  const st = Persist.status();
  const bits = [];
  if (st.autoFileSave) bits.push(`Auto-saving to "${st.fileName}" on your device.`);
  else if (st.linked && st.filePermission !== 'granted') bits.push(`Save file "${st.fileName}" needs permission again — tap "Link save file" to re-grant.`);
  else if (st.supportsFS) bits.push('No device file linked yet. Progress is stored in the browser database only.');
  else bits.push('This browser cannot write device files directly — use "Download backup" to keep a copy.');
  bits.push(st.persisted ? 'Browser storage is marked persistent.' : 'Browser storage is not persistent (may be evicted under pressure).');
  if (store.lastSavedAt) bits.push(`Last saved ${new Date(store.lastSavedAt).toLocaleTimeString()}.`);
  $('#save-status').textContent = bits.join(' ');

  // Keep the red guard banner in step with the live state.
  const guard = $('#save-guard-banner');
  if (guard && !store.saveBlocked) guard.classList.add('hidden');

  // A silent unlink is what cost a save before: the game kept running and kept
  // saving to the browser only, and said nothing. Call it out whenever there is
  // real progress at stake.
  const warn = $('#save-warn');
  if (warn) {
    const atStake = store.s.storage.length;
    const unprotected = !st.autoFileSave && atStake > 0;
    warn.classList.toggle('hidden', !unprotected);
    if (unprotected) {
      warn.innerHTML = st.linked
        ? `<b>Not auto-saving to your file.</b> "${st.fileName}" lost permission, so your
           ${atStake} creatures only exist in this browser. Tap
           <b>Re-link / change save file</b> below, and take a backup now.`
        : `<b>No save file linked.</b> Your ${atStake} creatures only exist in this browser,
           which can be cleared without warning. Tap <b>Link save file on device</b> below,
           and take a backup now.`;
    }
  }
  $('#btn-link-file').textContent = st.linked ? 'Re-link / change save file' : 'Link save file on device';
  $('#btn-link-file').disabled = !st.supportsFS;
  $('#btn-load-file').disabled = !st.supportsFS;
}

/* ===============================================================
   Global refresh
   =============================================================== */
/** Chips on the map showing incense / stardust magnet countdowns. */
export function renderEffectChips(now = Date.now()) {
  const host = $('#effect-chips');
  if (!host) return;
  host.innerHTML = '';

  const bits = [
    { kind: 'incense', id: 'incense', label: 'Incense' },
    { kind: 'magnet', id: 'stardust_magnet', label: 'Magnet' }
  ];
  for (const b of bits) {
    const fx = store.effect(b.kind, now);
    if (!fx) continue;
    // The incense chip reflects whichever incense is burning.
    const id = b.kind === 'incense' ? (fx.itemId || b.id) : b.id;
    const label = b.kind === 'incense' ? (itemName(id) || b.label) : b.label;
    host.append(el('div', { class: `fx-chip ${b.kind}` },
      el('img', { src: itemImage(id), alt: '' }),
      el('span', { text: label }),
      el('b', { text: timeLeftLabel(fx.endsAt - now) })
    ));
  }

  const bonanza = bonanzaState(new Date(now));
  if (bonanza.active) {
    host.append(el('div', { class: 'fx-chip magnet' },
      el('span', { text: '✨' }),
      el('span', { text: bonanza.day ? 'Shiny Bonanza Day' : 'Shiny Bonanza Hour' })
    ));
  }

  const nowDate = new Date(now);

  // Sundays double every stardust reward
  if (isStardustSunday(nowDate)) {
    host.append(el('div', { class: 'fx-chip sunday' },
      el('span', { text: DUST_ICON }),
      el('span', { text: `${STARDUST_SUNDAY_LABEL} · ×${STARDUST_SUNDAY_MULTIPLIER} stardust` })
    ));
  }

  // 23:30–23:45 — the interaction radius widens to RULES.RELAX_RANGE_M
  if (isRelaxHour(nowDate)) {
    host.append(el('div', { class: 'fx-chip relax' },
      el('span', { text: '🌙' }),
      el('span', { text: `${RELAX_HOUR_LABEL} · ${RULES.RELAX_RANGE_M} m reach` }),
      el('b', { text: timeLeftLabel(relaxHourEndsIn(nowDate)) })
    ));
  }

  // A weekly event rewrites the POI odds, which is invisible on the map unless
  // it says so — the next reset is up to 3 minutes away.
  const event = poiEventState(nowDate);
  if (event) {
    const blurb = event.id === 'raidInvasion'
      ? 'raids everywhere · discs pay an Ultra'
      : 'grunts everywhere · no limit';
    host.append(el('div', { class: `fx-chip event-${event.id}` },
      el('span', { text: event.id === 'raidInvasion' ? '🔥' : '🥋' }),
      el('span', { text: `${event.label} · ${blurb}` }),
      el('b', { text: timeLeftLabel(event.endsIn) })
    ));
  }
}

export function refreshAll() {
  renderHUD();
  renderEffectChips();
  const active = document.querySelector('.view.active')?.id;
  if (active === 'view-storage') renderStorage();
  if (active === 'view-collection') renderCollection();
  if (active === 'view-profile') renderProfile();
  if (active === 'view-missions') missionsRenderer?.();
  if (active === 'view-shop') shopRenderer?.();
}

/** main.js registers these here to avoid a circular import. */
let missionsRenderer = null;
export function setMissionsRenderer(fn) { missionsRenderer = fn; }
let shopRenderer = null;
export function setShopRenderer(fn) { shopRenderer = fn; }

export function renderView(name) {
  if (name === 'storage') renderStorage();
  else if (name === 'collection') renderCollection();
  else if (name === 'profile') renderProfile();
  else if (name === 'missions') missionsRenderer?.();
  else if (name === 'shop') shopRenderer?.();
}

/* ===============================================================
   NICKNAME
   =============================================================== */
export function openNicknamePrompt({ firstRun = false, onDone = null } = {}) {
  const wrap = $('#nickname');
  const input = $('#nick-input');
  const err = $('#nick-error');

  $('#nick-title').textContent = firstRun ? 'What should we call you?' : 'Change your nickname';
  $('#nick-save').textContent = firstRun ? "Let's go" : 'Save';
  $('#nick-cancel').classList.toggle('hidden', firstRun);
  err.classList.add('hidden');
  input.value = store.nickname || '';
  wrap.classList.remove('hidden');
  setTimeout(() => input.focus(), 80);

  const save = () => {
    const value = input.value.trim();
    if (value.length < 2) { err.classList.remove('hidden'); return; }
    store.setNickname(value);
    cleanup();
    toast(`Nice to meet you, ${store.nickname}`, 'good');
    refreshAll();
    onDone?.();
  };
  const cancel = () => { cleanup(); onDone?.(); };
  const onKey = e => { if (e.key === 'Enter') save(); if (e.key === 'Escape' && !firstRun) cancel(); };

  function cleanup() {
    wrap.classList.add('hidden');
    $('#nick-save').removeEventListener('click', save);
    $('#nick-cancel').removeEventListener('click', cancel);
    input.removeEventListener('keydown', onKey);
  }

  $('#nick-save').addEventListener('click', save);
  $('#nick-cancel').addEventListener('click', cancel);
  input.addEventListener('keydown', onKey);
}
