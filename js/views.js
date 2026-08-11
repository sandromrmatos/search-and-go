/* ============================================================
   views.js — Storage, Collection, Profile and the detail sheet
   ============================================================ */

import {
  DB, SETS, RARITY_NAMES, MAX_CREATURE_LEVEL, MAX_PLAYER_LEVEL, STAT_KEYS, STAT_LABELS,
  species, familyRoot, familyName, familyRarity, levelUpCost, moveLevelFor, statsFor,
  breedingSlotsFor, BREEDING_UNLOCK_LEVEL, bonanzaState
} from './data.js';
import { store, creatureStats, maxHpOf, hpOf, isFainted, isHurt } from './state.js';
import { Persist } from './persist.js';
import { playEvolution } from './anim.js';
import { ITEMS, itemImage, itemName, itemsInOrder } from './items.js';
import { $, $$, el, toast, openSheet, closeSheet, num, timeLeftLabel } from './ui.js';

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
  recent: (a, b) => a.capturedAt - b.capturedAt
};
const sp = c => species(c.speciesId);
const order = c => sp(c)?.order ?? 0;
const rar = c => sp(c)?.rarity ?? familyRarity(c.speciesId) ?? 0;

/* ---------------------------------------------------------------
   Tabs
   --------------------------------------------------------------- */
export function renderStorageTabs() {
  const tab = store.s.ui.storageTab === 'items' ? 'items' : 'creatures';
  $$('.tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tab-creatures').classList.toggle('hidden', tab !== 'creatures');
  $('#tab-items').classList.toggle('hidden', tab !== 'items');

  const itemTab = $('.tabs .tab[data-tab="items"]');
  const total = store.ownedItems().reduce((a, x) => a + x.qty, 0);
  itemTab.innerHTML = 'Items';
  if (total) itemTab.append(el('span', { class: 'tab-badge', text: String(total) }));

  $('#storage-count').textContent = tab === 'items'
    ? `${total} item${total === 1 ? '' : 's'}`
    : `${store.s.storage.length} stored`;
}

/* The sorted creature list, cached so prev/next arrows can walk it. */
let sortedStorage = [];
let multiSelectMode = false;
let multiSelected = new Set();

export function renderStorage() {
  renderStorageTabs();
  if (store.s.ui.storageTab === 'items') return renderItems();

  const grid = $('#storage-grid');
  const { storageSort, storageDir } = store.s.ui;
  sortedStorage = [...store.s.storage].sort(SORTERS[storageSort] || SORTERS.id);
  if (storageDir < 0) sortedStorage.reverse();
  const list = sortedStorage;

  $('#storage-empty').classList.toggle('hidden', list.length > 0);
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
    const selectable = multiSelectMode && !c.favourite && c.breeding == null;

    frag.append(el('button', {
      class: 'cell' + (c.shiny ? ' shiny' : '') + (selected ? ' picked' : ''),
      onclick: () => {
        if (multiSelectMode) {
          if (c.favourite || c.breeding != null || c.shiny) { toast('Cannot select favourites, shinies or breeding creatures', 'bad'); return; }
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
      isFainted(c) ? el('span', { class: 'fainted-badge', text: 'FAINTED' }) : null
    ));
  }
  grid.append(frag);

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
      el('span', { class: 'use-hint', text: tappable ? 'Tap to use' : 'Used automatically' })
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
    const kind = itemId === 'incense' ? 'incense' : 'magnet';
    const active = store.effect(kind);
    actions.push(el('button', {
      class: 'btn primary',
      disabled: qty < 1 || !!active,
      onclick: () => useTimedItem(kind, def)
    }, active
      ? `Already running · ${timeLeftLabel(active.endsAt - Date.now())}`
      : `Use one now`));
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
  const r = store.startEffect(kind);
  if (!r.ok) {
    toast(r.reason === 'active' ? `A ${label} is already running` : `No ${label} left`, 'bad');
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
  const eligible = store.s.storage.filter(c => {
    if (c.breeding != null) return false;
    return isPotion ? (!isFainted(c) && isHurt(c)) : isFainted(c);
  });

  $('#picker-title').textContent = isPotion ? 'Heal which creature?' : 'Revive which creature?';
  $('#picker-hint').textContent = isPotion
    ? 'Potions restore 50 HP. Fainted creatures need a Revive instead.'
    : 'Revives bring a fainted creature back to full HP.';
  $('#picker-empty').textContent = isPotion
    ? 'None of your creatures are hurt.'
    : 'None of your creatures have fainted.';
  $('#picker-empty').classList.toggle('hidden', eligible.length > 0);

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
      el('button', { class: 'arrow-btn', disabled: !prevUid, onclick: () => { sheetUid = prevUid; renderCreatureSheet(); } }, '‹'),
      el('span', { class: 'muted small', text: `${idx + 1} of ${sortedStorage.length}` }),
      el('button', { class: 'arrow-btn', disabled: !nextUid, onclick: () => { sheetUid = nextUid; renderCreatureSheet(); } }, '›')
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

    // ---- release ----
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn danger',
        disabled: !!c.favourite,
        onclick: () => doRelease(c.uid)
      }, c.favourite
        ? 'Unfavourite to release'
        : `Release · +${CANDY_ICON} 1 ${familyName(s.id)} candy`)
    )
  );
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
  const evolvesLater = !!s.evolvesToId;

  for (const m of s.moves) {
    const at = moveLevelFor(m, c.moveUnlock);
    const early = at < m.level;
    const known = at <= c.level;
    host.append(el('div', { class: 'move' + (known ? '' : ' locked') },
      el('div', { class: 'move-top' },
        el('b', { text: m.name }),
        el('span', { class: 'lv' + (early ? ' early' : ''), text: known ? 'Known' : `Lv ${at}` })
      ),
      el('div', { class: 'move-meta' },
        m.isBuff
          ? el('span', { class: 'bf', text: `Raises ${STAT_LABELS[m.buffStat]} by ${Math.round(m.buffPct * 100)}%` })
          : el('span', { class: 'pw', text: `${m.power} power` }),
        early ? el('span', { text: ` · unlocked Lv ${at} instead of Lv ${m.level}` }) : null
      )
    ));
  }

  // Moves this creature can only get after evolving
  if (evolvesLater) {
    const next = species(s.evolvesToId);
    const extra = next.moves.filter(m => !s.moves.some(x => x.name === m.name));
    for (const m of extra) {
      const at = moveLevelFor(m, c.moveUnlock);
      const early = at < m.level;
      host.append(el('div', { class: 'move locked' },
        el('div', { class: 'move-top' },
          el('b', { text: m.name }),
          el('span', { class: 'lv' + (early ? ' early' : ''), text: `Lv ${at}` })
        ),
        el('div', { class: 'move-meta' },
          m.isBuff
            ? el('span', { class: 'bf', text: `Raises ${STAT_LABELS[m.buffStat]} by ${Math.round(m.buffPct * 100)}%` })
            : el('span', { class: 'pw', text: `${m.power} power` }),
          el('span', {
            text: early
              ? ` · unlocked Lv ${at} instead of Lv ${m.level}, requires evolution`
              : ' · requires evolution'
          })
        )
      ));
    }
  }

  const nextMove = nextMoveFor(c, s);
  if (nextMove) {
    host.append(el('p', {
      class: 'hint',
      text: `Next move: ${nextMove.name} at level ${nextMove.at}` +
            (nextMove.needsEvolution ? ' (after evolving)' : '')
    }));
  }
  return host;
}

/** The soonest move this creature has not learned yet. */
function nextMoveFor(c, s) {
  const own = s.moves
    .map(m => ({ name: m.name, at: moveLevelFor(m, c.moveUnlock), needsEvolution: false }))
    .filter(m => m.at > c.level);
  let pool = own;
  if (s.evolvesToId) {
    const next = species(s.evolvesToId);
    const extra = next.moves
      .filter(m => !s.moves.some(x => x.name === m.name))
      .map(m => ({ name: m.name, at: moveLevelFor(m, c.moveUnlock), needsEvolution: true }));
    pool = own.concat(extra);
  }
  pool.sort((a, b) => a.at - b.at);
  return pool[0] || null;
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
  closeSheet('sheet');
  if (r.ok) toast(`Released ${s.name} · +1 ${familyName(s.id)} candy`, 'good');
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

    // ---- everything it can learn ----
    el('h4', { class: 'sheet-h4', text: `Moves (${s.moves.length})` }),
    el('div', { class: 'move-list' }, ...s.moves.map(m =>
      el('div', { class: 'move' },
        el('div', { class: 'move-top' },
          el('b', { text: m.name }),
          el('span', { class: 'lv', text: `Lv ${m.level}` })
        ),
        el('div', { class: 'move-meta' },
          m.isBuff
            ? el('span', { class: 'bf', text: `Raises ${STAT_LABELS[m.buffStat]} by ${Math.round(m.buffPct * 100)}%` })
            : el('span', { class: 'pw', text: `${m.power} power` })
        )
      ))),

    chain.length > 1 ? el('p', { class: 'hint', text: 'Family: ' + chain.map(x => x.name).join(' → ') }) : null,
    s.stage === 1
      ? el('p', { class: 'hint', text: 'Found in the wild at shops and amenities.' })
      : el('p', { class: 'hint', text: 'Only obtainable by evolving with candy.' })
  );
  openSheet('sheet');
}

/* ===============================================================
   PROFILE
   =============================================================== */
export function renderProfile() {
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
    host.append(el('div', { class: `fx-chip ${b.kind}` },
      el('img', { src: itemImage(b.id), alt: '' }),
      el('span', { text: b.label }),
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
