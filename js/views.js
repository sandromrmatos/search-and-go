/* ============================================================
   views.js — Storage, Collection, Profile and the detail sheet
   ============================================================ */

import {
  DB, SETS, RARITY_NAMES, MAX_CREATURE_LEVEL, MAX_PLAYER_LEVEL, STAT_KEYS, STAT_LABELS,
  species, familyRoot, familyName, familyRarity, levelUpCost, moveLevelFor, statsFor,
  fullLearnset, finalEvolutionOf,
  breedingSlotsFor, BREEDING_UNLOCK_LEVEL, bonanzaState,
  isRelaxHour, relaxHourEndsIn, RELAX_HOUR_LABEL, RULES, BUDDY_KM_PER_CANDY,
  isStardustSunday, STARDUST_SUNDAY_LABEL, STARDUST_SUNDAY_MULTIPLIER,
  MAX_EGGS, INCUBATOR_ITEMS
} from './data.js';
import { renderEggs, renderEggTabBadge, openEggPickerFor } from './eggs.js';
import { store, creatureStats, maxHpOf, hpOf, isFainted, isHurt } from './state.js';
import { Persist } from './persist.js';
import { playEvolution } from './anim.js';
import { ITEMS, itemImage, itemName, itemsInOrder } from './items.js';
import {
  $, $$, el, toast, openSheet, closeSheet, num, timeLeftLabel,
  clampPage, pageSlice, pagerBar, pageOfIndex, wireSwipe, bumpEl
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
  $('#hud-xp-text').textContent = p.max
    ? `${num(store.s.xp)} XP · MAX`
    : `${num(p.into)} / ${num(p.need)} XP → Lv ${p.level + 1}`;
  $('#hud-xp-fill').style.width = p.pct + '%';
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
  shiny:  (a, b) => (Number(!!b.shiny) - Number(!!a.shiny)) || order(a) - order(b),
  favourite: (a, b) => (Number(!!b.favourite) - Number(!!a.favourite)) || order(a) - order(b),
  recent: (a, b) => a.capturedAt - b.capturedAt
};
const sp = c => species(c.speciesId);
const order = c => sp(c)?.order ?? 0;
const rar = c => sp(c)?.rarity ?? familyRarity(c.speciesId) ?? 0;

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

  $('#storage-count').textContent = tab === 'items'
    ? `${total} item${total === 1 ? '' : 's'}`
    : tab === 'eggs'
      ? `${store.eggs.length} of ${MAX_EGGS} eggs`
      : `${store.s.storage.length} stored`;
}

/* The sorted creature list, cached so prev/next arrows can walk it. */
let sortedStorage = [];
let multiSelectMode = false;
let multiSelected = new Set();

export function renderStorage() {
  renderStorageTabs();
  if (store.s.ui.storageTab === 'items') return renderItems();
  if (store.s.ui.storageTab === 'eggs') return renderEggs();

  const grid = $('#storage-grid');
  const { storageSort, storageDir } = store.s.ui;
  // Sort the whole collection first, then cut it into pages.
  sortedStorage = [...store.s.storage].sort(SORTERS[storageSort] || SORTERS.id);
  if (storageDir < 0) sortedStorage.reverse();

  const page = clampPage(store.s.ui.storagePage, sortedStorage.length);
  if (page !== store.s.ui.storagePage) store.s.ui.storagePage = page;
  const list = pageSlice(sortedStorage, page);

  $('#storage-empty').classList.toggle('hidden', sortedStorage.length > 0);
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
      onclick: () => {
        if (multiSelectMode) {
          if (c.favourite || c.breeding != null || c.shiny || isBuddy) {
            toast('Cannot select favourites, shinies, buddies or breeding creatures', 'bad');
            return;
          }
          if (selected) multiSelected.delete(c.uid); else multiSelected.add(c.uid);
          renderStorage();
          return;
        }
        openCreatureSheet(c.uid);
      }
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

export function enterMultiSelect() {
  multiSelectMode = true;
  multiSelected.clear();
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
    actions.push(el('button', {
      class: 'btn primary',
      disabled: qty < 1,
      onclick: () => { closeSheet('sheet'); openCreaturePicker(itemId); }
    }, itemId === 'potion' ? 'Use on a creature' : 'Revive a creature'));
  }
  if (def.use === 'timed') {
    // Both incense types share the one incense slot.
    const kind = (itemId === 'incense' || itemId === 'rare_incense') ? 'incense' : 'magnet';
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
    const placed = !!store.s.breeding;
    const unlocked = store.breedingUnlocked;
    actions.push(el('button', {
      class: 'btn primary',
      disabled: qty < 1 || placed || !unlocked,
      onclick: () => onPlaceBreeding?.()
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
export let onEffectsChanged = null;
export function setViewHooks({ placeBreeding, effectsChanged }) {
  onPlaceBreeding = placeBreeding;
  onEffectsChanged = effectsChanged;
}

/* ===============================================================
   CREATURE PICKER (potions, revives, breeding pairs)
   =============================================================== */
export function openCreaturePicker(itemId) {
  const isPotion = itemId === 'potion';
  const eligible = sortedForPicker(store.s.storage.filter(c => {
    if (c.breeding != null) return false;
    return isPotion ? (!isFainted(c) && isHurt(c)) : isFainted(c);
  }));

  $('#picker-title').textContent = isPotion ? 'Heal which creature?' : 'Revive which creature?';
  $('#picker-hint').textContent = isPotion
    ? 'Potions restore 50 HP. Fainted creatures need a Revive instead.'
    : 'Revives bring a fainted creature back to full HP.';
  $('#picker-empty').textContent = isPotion
    ? 'None of your creatures are hurt.'
    : 'None of your creatures have fainted.';
  $('#picker-empty').classList.toggle('hidden', eligible.length > 0);

  // ---- do-everything button ----
  renderPickerBulkBar(isPotion, eligible.length, () => openCreaturePicker(itemId));

  const grid = $('#picker-grid');
  grid.innerHTML = '';
  for (const c of eligible) {
    const s = sp(c);
    const max = maxHpOf(c), hp = hpOf(c);
    const pct = Math.round((hp / max) * 100);
    grid.append(el('button', {
      class: 'cell',
      onclick: () => {
        const r = isPotion ? store.usePotion(c.uid) : store.useRevive(c.uid);
        if (!r.ok) { toast('Could not use that item', 'bad'); return; }
        toast(isPotion
          ? `${s.name} healed ${r.gained} HP (${r.after}/${r.max})`
          : `${s.name} revived to ${r.max} HP`, 'good');
        closeSheet('picker');
        refreshAll();
      }
    },
      el('span', { class: 'lvl', text: 'Lv' + c.level }),
      c.shiny ? el('span', { class: 'shiny-star', text: '★' }) : null,
      el('img', { src: s.spritePath(c.shiny), alt: s.name, loading: 'lazy' }),
      el('span', { class: 'nm', text: s.name }),
      el('span', { class: 'sub', text: `${hp} / ${max} HP` }),
      el('span', { class: 'hp-wrap' },
        el('span', { class: `hp-bar${pct <= 25 ? ' critical' : pct <= 60 ? ' low' : ''}` },
          el('i', { style: { width: pct + '%' } })))
    ));
  }
  openSheet('picker');
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
function renderPickerBulkBar(isPotion, eligibleCount, rerender) {
  const host = $('#picker-bulk');
  if (!host) return;
  host.innerHTML = '';
  if (!eligibleCount) return;

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
      el('img', { src: s.spritePath(c.shiny), alt: s.name }),
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
    el('h4', { class: 'sheet-h4', text: 'Stats' }),
    el('div', { class: 'det-rows' }, ...statRows(c)),
    el('p', { class: 'hint', text: `Stat modifier: ${STAT_LABELS[c.statMod.up]} up 10%, ${STAT_LABELS[c.statMod.down]} down 10%. Each level adds 5% of the base stat.` }),

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

/** One row per stat, with a bar and the modifier arrow. */
function statRows(c) {
  const stats = creatureStats(c);
  return STAT_KEYS.map(k => {
    const arrow = c.statMod.up === k ? 'up' : c.statMod.down === k ? 'down' : '';
    return el('div', { class: 'stat-row' },
      el('span', { class: 'lbl', text: STAT_LABELS[k] }),
      el('span', { class: 'bar' },
        el('i', { style: { width: Math.min(100, (stats[k] / STAT_BAR_MAX) * 100) + '%' } })),
      el('span', { class: 'val', text: num(stats[k]) }),
      el('span', { class: `arrow ${arrow}`, text: arrow === 'up' ? '▲' : arrow === 'down' ? '▼' : '' })
    );
  });
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
          ? el('span', { class: 'bf', text: `Raises ${STAT_LABELS[m.buffStat]} by ${Math.round(m.buffPct * 100)}%` })
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

  let list = DB.species.filter(s => {
    if (ui.filterType && s.type !== ui.filterType) return false;
    if (ui.filterStage && String(s.stage) !== String(ui.filterStage)) return false;
    if (ui.filterRarity && String(s.rarity ?? '') !== String(ui.filterRarity)) return false;
    return true;
  });

  // Sort collection
  const collSort = $('#collection-sort')?.value || 'id';
  if (collSort === 'caught') {
    list = [...list].sort((a, b) => store.countOfSpecies(b.id) - store.countOfSpecies(a.id) || a.order - b.order);
  }

  const registeredHere = list.filter(s => store.isRegistered(s.id)).length;
  $('#collection-count').textContent =
    `${registeredHere} / ${list.length} registered` +
    (list.length !== DB.species.length ? ` (filtered · ${store.registeredCount} / ${DB.species.length} total)` : '');

  const grid = $('#collection-grid');
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const s of list) {
    const known = store.isRegistered(s.id);
    frag.append(el('button', {
      class: 'cell' + (known ? '' : ' locked'),
      onclick: () => openSpeciesSheet(s.id)
    },
      s.rarity ? el('span', { class: `rar r-${s.rarity}`, text: s.rarity }) : null,
      el('img', { src: s.imagePath, alt: s.name, loading: 'lazy' }),
      el('span', { class: 'nm', text: s.name }),
      el('span', { class: `sub ${known ? 't-' + s.type : ''}`, text: known ? s.type : '???' }),
      el('span', { class: 'stg', text: 'S' + s.stage })
    ));
  }
  grid.append(frag);
  if (!list.length) grid.append(el('p', { class: 'empty', text: 'No creatures match those filters.' }));
}

export function openSpeciesSheet(speciesId) {
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

  const img = el('img', { src: s.imagePath, alt: s.name, class: known ? '' : 'locked' });
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

  const body = $('#sheet-body');
  body.innerHTML = '';
  body.append(
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

    // ---- base stats at level 1 ----
    el('h4', { class: 'sheet-h4', text: 'Base stats (level 1)' }),
    el('div', { class: 'det-rows' }, ...STAT_KEYS.map(k =>
      el('div', { class: 'stat-row' },
        el('span', { class: 'lbl', text: STAT_LABELS[k] }),
        el('span', { class: 'bar' },
          el('i', { style: { width: Math.min(100, (s.baseStats[k] / STAT_BAR_MAX) * 100) + '%' } })),
        el('span', { class: 'val', text: num(s.baseStats[k]) }),
        el('span', { class: 'arrow', text: '' })
      ))),
    el('p', { class: 'hint', text: 'Each level adds 5% of the base stat. Every creature you catch also gets one stat 10% higher and another 10% lower.' }),

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
            ? el('span', { class: 'bf', text: `Raises ${STAT_LABELS[m.buffStat]} by ${Math.round(m.buffPct * 100)}%` })
            : el('span', { class: 'pw', text: `${m.power} power` }),
          hasSlot ? null : el('span', { text: ` · needs ${m.fromName}` })
        )
      );
    })),

    chain.length > 1 ? el('p', { class: 'hint', text: 'Family: ' + chain.map(x => x.name).join(' → ') }) : null,
    s.stage === 1
      ? el('p', { class: 'hint', text: 'Found in the wild at shops and amenities.' })
      : el('p', { class: 'hint', text: 'Only obtainable by evolving with candy.' })
  );
  openSheet('sheet');
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
    const id = b.kind === 'incense' && fx.rare ? 'rare_incense' : b.id;
    const label = b.kind === 'incense' && fx.rare ? 'Rare Incense' : b.label;
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
}

export function refreshAll() {
  renderHUD();
  renderEffectChips();
  const active = document.querySelector('.view.active')?.id;
  if (active === 'view-storage') renderStorage();
  if (active === 'view-collection') renderCollection();
  if (active === 'view-profile') renderProfile();
  if (active === 'view-missions') missionsRenderer?.();
}

/** main.js registers the Missions renderer here to avoid a circular import. */
let missionsRenderer = null;
export function setMissionsRenderer(fn) { missionsRenderer = fn; }

export function renderView(name) {
  if (name === 'storage') renderStorage();
  else if (name === 'collection') renderCollection();
  else if (name === 'profile') renderProfile();
  else if (name === 'missions') missionsRenderer?.();
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
