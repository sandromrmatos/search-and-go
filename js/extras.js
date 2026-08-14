/* ============================================================
   extras.js — Missions, the Breeding Centre and the How-to-play sheet
   ============================================================ */

import {
  species, familyName, familyRarity, RARITY_NAMES, RULES,
  BREEDING_UNLOCK_LEVEL, BREEDING_CANDY_CAP, BREEDING_SLOTS_BY_LEVEL,
  MAX_CREATURE_LEVEL, CREATURE_LEVEL_COST, POI_OUTCOMES, SHINY_ODDS,
  BONANZA_HOUR_START, BONANZA_HOUR_END, STAT_LABELS,
  RELAX_HOUR_START, RELAX_HOUR_END, RELAX_HOUR_LABEL, dustBonusFor,
  BUDDY_KM_PER_CANDY, STARDUST_SUNDAY_LABEL, STARDUST_SUNDAY_MULTIPLIER,
  RAID_REWARD, RARE_INCENSE_WEIGHTS, RARITY_WEIGHTS, GRUNT_ITEM_DROPS,
  RAID_BOSS_MODIFIERS, EGG_TYPES, EGG_DROP_CHANCE, MAX_EGGS, EGG_HATCH_LEVEL,
  STAT_GROWTH_PER_LEVEL, RAID_TIERS, GRUNT_REWARD, RAID_CAPTURE_LEVEL,
  RAID_BONUS_RARITIES, raidRareIncenseChance, LEVEL_UP_REWARDS,
  levelUpRewardFromLevel, DUST_BONUS_PER_PLAYER_LEVEL, MAX_PLAYER_LEVEL,
  SUPER_EFFECTIVE_MULTIPLIER, NOT_VERY_EFFECTIVE_MULTIPLIER, TYPE_RESISTANCE
} from './data.js';
import { store, maxHpOf, hpOf, isFainted } from './state.js';
import { itemImage, itemName, ITEMS, itemsInOrder } from './items.js';
import { sortedForPicker } from './views.js';
const DEBUG_TRAINER_NAME = 'Test123';
import {
  $, $$, el, toast, openSheet, closeSheet, num,
  PAGE_SIZE, clampPage, pageSlice, pagerBar, wireSwipe, bumpEl
} from './ui.js';

const DUST_ICON = '✨';
const CANDY_ICON = '🍬';

let refresh = null;   // supplied by main.js so we can repaint after changes

export function initExtras({ onChange } = {}) {
  refresh = onChange;
  $('#btn-info').addEventListener('click', () => { renderInfo('basics'); openSheet('info'); });
  $$('#info-tabs .tab').forEach(b => b.addEventListener('click', () => {
    $$('#info-tabs .tab').forEach(x => x.classList.toggle('active', x === b));
    renderInfo(b.dataset.info);
  }));

  // ---- breeding pair picker ----
  // Sorting is shared with Storage, so changing it here changes it there too,
  // which is what "sorted the same way as your Storage" has to mean.
  $('#breed-sort').addEventListener('change', e => {
    store.setUI({ storageSort: e.target.value });
    breedPage = 0;
    renderBreedPicker();
  });
  $('#breed-dir').addEventListener('click', () => {
    store.setUI({ storageDir: store.s.ui.storageDir > 0 ? -1 : 1 });
    breedPage = 0;
    renderBreedPicker();
  });
  $('#breed-clear').addEventListener('click', () => {
    breedPicked = [];
    renderBreedPicker();
  });
  $('#breed-confirm').addEventListener('click', confirmBreedPair);
}

/* ===============================================================
   MISSIONS
   =============================================================== */

const MISSION_ICON = {
  registered: '📖', captures: '🎯', capturesToday: '📅',
  raidsWon: '🔥', raidRarity: '💎', gruntsBeaten: '🧍',
  capturesWeek: '🗓', daysCaughtThisWeek: '✅', eggsHatched: '🥚',
  metresToday: '👣', metresWeek: '👣', creaturesAtLevel: '⬆'
};

/**
 * "3.24 / 5 km" for a distance mission, "12 / 50" for a counting one.
 * Walk missions are stored in metres, which would read as a meaningless
 * "3,240 / 5,000" without this.
 */
function missionProgressLabel(m) {
  const done = Math.min(m.progress, m.target);
  if (m.def.unit === 'km') {
    return `${(done / 1000).toFixed(2)} / ${num(m.target / 1000)} km`;
  }
  return `${num(done)} / ${num(m.target)}`;
}

let missionTab = 'lifetime';

export function renderMissions() {
  const host = $('#missions-list');
  const all = store.allMissions();

  // How many are waiting in each tab, so the tabs themselves can say where to
  // look instead of leaving the player to open all three.
  const readyByScope = {};
  for (const m of all) {
    if (m.claimable) readyByScope[m.scope] = (readyByScope[m.scope] || 0) + 1;
  }

  // Wire tabs
  $$('#mission-tabs .tab').forEach(b => {
    const scope = b.dataset.mtab;
    const ready = readyByScope[scope] || 0;

    // The label lives in the HTML, so stash it before we start rebuilding the
    // button to hang a count off it.
    b.dataset.label = b.dataset.label || b.textContent.trim();

    b.classList.toggle('active', scope === missionTab);
    b.classList.toggle('has-ready', ready > 0);
    b.textContent = b.dataset.label;
    if (ready > 0) {
      b.append(el('span', { class: 'tab-badge ready', text: String(ready) }));
      b.title = `${ready} mission${ready === 1 ? '' : 's'} ready to claim`;
    } else {
      b.removeAttribute('title');
    }

    b.onclick = () => { missionTab = scope; renderMissions(); };
  });

  const showing = all.filter(m => m.scope === missionTab);

  // Claimable first, then in progress, then claimed at the bottom.
  const rank = m => (m.claimable ? 0 : m.claimed ? 2 : 1);
  const sorted = [...showing].sort((a, b) =>
    rank(a) - rank(b) ||
    (b.progress / b.target) - (a.progress / a.target) ||
    a.target - b.target
  );

  const claimable = all.filter(m => m.claimable).length;
  $('#missions-count').textContent = claimable
    ? `${claimable} ready to claim`
    : `${all.filter(m => m.claimed).length} of ${all.length} claimed`;

  // Claimable-first ordering wins over grouping, so each row carries its own
  // Daily / Lifetime tag rather than sitting under a heading.
  host.innerHTML = '';
  for (const m of sorted) host.append(missionRow(m));

  // Reset countdown for the timed tabs
  const timer = $('#daily-timer');
  const now = new Date();
  if (missionTab === 'daily') {
    timer.classList.remove('hidden');
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    timer.innerHTML = `Daily missions reset in <b>${countdownLabel(tomorrow - now)}</b>`;
  } else if (missionTab === 'weekly') {
    timer.classList.remove('hidden');
    // Next Monday 00:00 local
    const nextMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    nextMonday.setDate(nextMonday.getDate() + ((8 - (now.getDay() || 7)) % 7 || 7));
    timer.innerHTML = `Weekly missions reset Monday, in <b>${countdownLabel(nextMonday - now)}</b>`;
  } else {
    timer.classList.add('hidden');
  }

  renderMissionBadge();
}

/**
 * "11:59" / "00:07" from a millisecond gap — hours and minutes, zero padded.
 * Breeding waits run 12 to 36 hours, which `timeLeftLabel` would render as a
 * useless "719:59" because it counts in minutes and seconds.
 */
function hoursMinutesLabel(ms) {
  const mins = Math.max(0, Math.ceil(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "2d 5h" / "5h 12m" / "12m" from a millisecond gap. */
function countdownLabel(ms) {
  const total = Math.max(0, ms);
  const d = Math.floor(total / 86_400_000);
  const h = Math.floor((total % 86_400_000) / 3_600_000);
  const min = Math.floor((total % 3_600_000) / 60_000);
  if (d) return `${d}d ${h}h`;
  return h ? `${h}h ${min}m` : `${min}m`;
}

function missionRow(m) {
  const pct = Math.min(100, Math.round((m.progress / m.target) * 100));
  const dust = m.def.dust + dustBonusFor(store.level);

  // Extra named items, shown with their real inventory artwork
  const itemChips = Object.entries(m.def.items || {})
    .filter(([id, n]) => ITEMS[id] && n > 0)
    .map(([id, n]) => el('span', { class: 'r reward-item' },
      el('img', { class: 'reward-item-img', src: itemImage(id), alt: '' }),
      el('span', { text: `${n > 1 ? n + ' ' : ''}${ITEMS[id].name}` })
    ));

  return el('div', {
    class: 'mission' + (m.claimable ? ' claimable' : m.claimed ? ' claimed' : '')
  },
    el('span', { class: 'mission-ico', text: MISSION_ICON[m.def.kind] || '🎯' }),
    el('div', { class: 'mission-main' },
      el('b', { text: m.def.label }),
      el('div', { class: 'mission-bar' }, el('i', { style: { width: pct + '%' } })),
      el('div', { class: 'mission-meta' },
        el('span', { text: missionProgressLabel(m) }),
        el('span', { class: 'r', text: `⭐ ${m.def.xp} XP` }),
        el('span', { class: 'r', text: `${DUST_ICON} ${num(dust)}` }),
        m.def.discs ? el('span', { class: 'r', text: `◉ ${m.def.discs} disc${m.def.discs > 1 ? 's' : ''}` }) : null,
        ...itemChips
      )
    ),
    el('div', { class: 'mission-act' },
      m.claimed
        ? el('span', { class: 'mission-tick', text: '✓' })
        : m.claimable
          ? el('button', { class: 'btn primary', onclick: () => claim(m.def.id) }, 'Claim')
          : el('span', { class: 'muted', text: `${pct}%` })
    )
  );
}

function claim(id) {
  const r = store.claimMission(id);
  if (!r.ok) { toast('That mission cannot be claimed yet', 'bad'); return; }
  let msg = `${r.label} · +${r.xp} XP, +${num(r.dust)} stardust`;
  if (r.discs) msg += `, +${r.discs} Capturing Disc${r.discs > 1 ? 's' : ''}`;
  for (const [id, n] of Object.entries(r.items || {})) msg += `, +${n} ${itemName(id, n)}`;
  toast(msg, 'good', 3400);
  if (r.levelUp.levelledUp) toast(`Player level ${r.levelUp.to}!`, 'good', 3200);
  renderMissions();
  refresh?.();
}

/** Glow + count on the Missions tab when anything can be claimed. */
export function renderMissionBadge() {
  const btn = $('#nav-missions');
  if (!btn) return;
  const n = store.claimableMissionCount;
  btn.classList.toggle('glow', n > 0);
  btn.querySelector('.claim-dot')?.remove();
  if (n > 0) btn.append(el('span', { class: 'claim-dot', text: String(n) }));
}

/* ===============================================================
   BREEDING CENTRE
   =============================================================== */

/** Opened by tapping the flag on the map. */
export function openBreeding({ inRange = true } = {}) {
  renderBreeding(inRange);
  openSheet('breeding');
}

function renderBreeding(inRange) {
  const centre = store.s.breeding;
  const host = $('#breeding-slots');
  const hint = $('#breeding-hint');
  host.innerHTML = '';

  if (!centre) {
    hint.textContent = 'You have not placed a breeding centre yet.';
    return;
  }

  const slots = store.breedingSlots;
  const nextAt = Object.entries(BREEDING_SLOTS_BY_LEVEL)
    .map(([lvl, n]) => ({ lvl: Number(lvl), n }))
    .find(x => x.lvl > store.level);

  hint.textContent = inRange
    ? `Leave two creatures of the same species inside and they generate that family's candy. ` +
      `They stop at ${BREEDING_CANDY_CAP} candy, so come back and collect.` +
      (nextAt ? ` Player level ${nextAt.lvl} unlocks slot ${nextAt.n}.` : '')
    : `You need to be within ${RULES.CAPTURE_RANGE_M} m of the centre to use it.`;

  for (let i = 0; i < slots; i++) {
    const slot = centre.slots[i];
    host.append(slot ? filledSlot(slot, i, inRange) : emptySlot(i, inRange));
  }
  if (!slots) {
    host.append(el('p', { class: 'empty', text: `Slots unlock at player level ${BREEDING_UNLOCK_LEVEL}.` }));
  }
}

function filledSlot(slot, index, inRange) {
  const sp = species(slot.speciesId);
  const p = store.breedingProgress(slot);
  const full = p.earned >= p.cap;

  return el('div', { class: 'breed-slot' },
    el('div', { class: 'breed-slot-top' },
      el('div', { class: 'breed-pair' },
        el('img', { src: sp.imagePath, alt: sp.name }),
        el('img', { src: sp.imagePath, alt: '' })
      ),
      el('b', { text: sp.name }),
      el('span', { class: 'breed-candy', text: `${CANDY_ICON} ${p.earned}/${p.cap}` })
    ),
    el('div', { class: 'breed-next', text: full
      ? 'Full — collect them to bank the candy.'
      : `Next candy in ${hoursMinutesLabel(p.nextAt - Date.now())} · one every ${p.every / 3_600_000} h (rarity ${p.rarity})` }),
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn primary', disabled: !inRange,
        onclick: () => collect(index)
      }, `Collect pair${p.earned ? ` · +${p.earned} candy` : ''}`)
    )
  );
}

function emptySlot(index, inRange) {
  const pairs = eligiblePairs();
  const ready = pairs.length > 0;
  return el('div', { class: 'breed-slot' },
    el('div', { class: 'breed-slot-top' },
      el('span', { class: 'mission-ico', text: '➕' }),
      el('b', { text: `Slot ${index + 1} · empty` })
    ),
    el('div', { class: 'breed-next', text: ready
      ? 'Tap the slot to browse your storage and choose two of the same creature.'
      : 'You need two of the same creature that are not already breeding.' }),
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn primary', disabled: !inRange || !ready,
        onclick: () => openBreedPicker(index)
      }, ready ? 'Choose creatures' : 'No pairs available')
    )
  );
}

/* ---------------------------------------------------------------
   Pair picker

   Browsing works like Storage: the same sort options, the same paging, the
   same tiles. Every creature is tappable, so picking two different ones is
   possible — that gets explained rather than prevented, which is what the old
   species-locked list did by never offering the choice.
   --------------------------------------------------------------- */

let breedSlotIndex = 0;   // the slot the picker was opened from
let breedPicked = [];     // uids, in tap order
let breedPage = 0;

function openBreedPicker(index) {
  breedSlotIndex = index;
  breedPicked = [];
  breedPage = 0;
  renderBreedPicker();
  openSheet('breed-picker');
}

/**
 * Everything allowed into the breeding centre right now, in the player's
 * chosen Storage order. A buddy is excluded: breeding would block the
 * levelling and battling a buddy is meant to keep doing.
 */
function breedCandidates() {
  return sortedForPicker(store.s.storage.filter(c =>
    c.breeding == null && !store.isBuddy(c.uid)));
}

/** The two chosen creatures, or null while fewer than two are selected. */
function breedPickedPair() {
  if (breedPicked.length !== 2) return null;
  const a = store.creature(breedPicked[0]);
  const b = store.creature(breedPicked[1]);
  return a && b ? { a, b } : null;
}

function renderBreedPicker() {
  const all = breedCandidates();
  breedPage = clampPage(breedPage, all.length);
  const list = pageSlice(all, breedPage);

  const pair = breedPickedPair();
  const mismatch = !!pair && pair.a.speciesId !== pair.b.speciesId;

  $('#breed-picker-title').textContent = `Slot ${breedSlotIndex + 1} · choose 2 of the same creature`;
  $('#breed-picker-hint').textContent =
    `Two of the same creature generate that family's candy. ` +
    `${all.length} available, sorted the same way as your Storage.`;
  $('#breed-pick-count').textContent = `${breedPicked.length} of 2 selected`;
  $('#breed-picker-empty').classList.toggle('hidden', all.length > 0);
  $('#breed-sort').value = store.s.ui.storageSort;
  $('#breed-dir').textContent = store.s.ui.storageDir > 0 ? '↑' : '↓';

  const warn = $('#breed-picker-warn');
  warn.classList.toggle('hidden', !mismatch);
  if (mismatch) {
    warn.textContent =
      `${species(pair.a.speciesId).name} and ${species(pair.b.speciesId).name} are not the same creature — ` +
      'you need to select 2 of the same creature.';
  }
  $('#breed-confirm').disabled = !pair || mismatch;

  const grid = $('#breed-picker-grid');
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const c of list) {
    const s = species(c.speciesId);
    if (!s) continue;
    const rarity = s.rarity || familyRarity(s.id);
    const max = maxHpOf(c), hp = hpOf(c);
    const pct = Math.round((hp / max) * 100);
    const idx = breedPicked.indexOf(c.uid);

    frag.append(el('button', {
      class: 'cell' + (c.shiny ? ' shiny' : '') + (idx >= 0 ? ' picked' : ''),
      onclick: () => toggleBreedPick(c.uid)
    },
      idx >= 0 ? el('span', { class: 'pick-order', text: String(idx + 1) }) : null,
      el('span', { class: 'lvl', text: 'Lv' + c.level }),
      rarity ? el('span', { class: `rar r-${rarity}`, text: rarity }) : null,
      c.shiny ? el('span', { class: 'shiny-star', text: '★' }) : null,
      c.favourite ? el('span', { class: 'fav-star', text: '♥' }) : null,
      el('img', { src: s.spritePath(c.shiny), alt: s.name, loading: 'lazy' }),
      el('span', { class: 'nm', text: s.name }),
      el('span', { class: 'hp-wrap' },
        el('span', { class: `hp-bar${pct <= 25 ? ' critical' : pct <= 60 ? ' low' : ''}` },
          el('i', { style: { width: pct + '%' } }))),
      el('span', { class: `sub t-${s.type}`, text: s.type }),
      el('span', { class: 'stg', text: 'S' + s.stage }),
      isFainted(c) ? el('span', { class: 'fainted-badge', text: 'FAINTED' }) : null
    ));
  }
  grid.append(frag);

  // ---- paging ----
  let pager = $('#breed-picker-pager');
  const bar = pagerBar(breedPage, all.length, goToBreedPage);
  if (!bar) {
    pager?.remove();
  } else {
    if (!pager) {
      pager = el('div', { id: 'breed-picker-pager' });
      grid.parentElement.insertBefore(pager, grid.nextSibling);
    }
    pager.innerHTML = '';
    pager.append(bar);
  }
  wireSwipe(grid, {
    onLeft: () => goToBreedPage(breedPage + 1, grid),
    onRight: () => goToBreedPage(breedPage - 1, grid)
  }, { key: 'breedPage' });
}

function goToBreedPage(page, grid = null) {
  const next = clampPage(page, breedCandidates().length);
  if (next === breedPage) {
    if (grid) bumpEl(grid, page < 0 ? 'right' : 'left');
    return;
  }
  breedPage = next;
  renderBreedPicker();
}

function toggleBreedPick(uid) {
  const i = breedPicked.indexOf(uid);
  if (i >= 0) breedPicked.splice(i, 1);
  else if (breedPicked.length < 2) breedPicked.push(uid);
  // Already holding two: drop the first so tapping around keeps working
  // instead of silently doing nothing.
  else breedPicked = [breedPicked[1], uid];

  renderBreedPicker();

  // Say it as soon as the mismatch happens, not only on Confirm.
  const pair = breedPickedPair();
  if (pair && pair.a.speciesId !== pair.b.speciesId) {
    toast('You need to select 2 of the same creature', 'bad', 3200);
  }
}

function confirmBreedPair() {
  const pair = breedPickedPair();
  if (!pair) { toast('Select two creatures first', 'bad'); return; }
  if (pair.a.speciesId !== pair.b.speciesId) {
    toast('You need to select 2 of the same creature', 'bad', 3200);
    return;
  }
  closeSheet('breed-picker');
  addPair(pair.a.uid, pair.b.uid);
  breedPicked = [];
}

/**
 * Species the player owns two or more usable copies of. Built from the same
 * candidate list the picker shows, so the slot button can never say a pair is
 * available when the picker cannot offer one (or the other way round).
 */
function eligiblePairs() {
  const bySpecies = new Map();
  for (const c of breedCandidates()) {
    if (!bySpecies.has(c.speciesId)) bySpecies.set(c.speciesId, []);
    bySpecies.get(c.speciesId).push(c.uid);
  }
  return [...bySpecies.entries()]
    .filter(([, uids]) => uids.length >= 2)
    .map(([speciesId, uids]) => ({ speciesId, uids, count: uids.length }))
    .sort((a, b) => species(a.speciesId).order - species(b.speciesId).order);
}

function addPair(a, b) {
  const r = store.addBreedingPair(a, b);
  if (!r.ok) {
    toast(({
      full: 'Every slot is in use',
      species: 'Both creatures must be the same species',
      busy: 'One of those is already breeding',
      noCentre: 'No breeding centre placed'
    })[r.reason] || 'Could not add that pair', 'bad');
    return;
  }
  toast('Pair left in the breeding centre', 'good');
  renderBreeding(true);
  refresh?.();
}

function collect(index) {
  const r = store.collectBreedingSlot(index);
  if (!r.ok) { toast('Nothing to collect', 'bad'); return; }
  toast(r.candy
    ? `Collected your pair and ${r.candy} ${familyName(r.speciesId)} candy`
    : 'Collected your pair — no candy generated yet', r.candy ? 'good' : '');
  renderBreeding(true);
  refresh?.();
}

/* ===============================================================
   HOW TO PLAY
   =============================================================== */

const pct = n => `${Math.round(n * 100)}%`;

const weightLine = table => {
  const total = Object.values(table).reduce((a, b) => a + b, 0);
  return Object.entries(table)
    .map(([r, w]) => `<b>${RARITY_NAMES[r]}</b> ${Math.round((w / total) * 100)}%`)
    .join(' · ');
};
const rareIncenseLine = () => weightLine(RARE_INCENSE_WEIGHTS);
const wildOddsLine = () => weightLine(RARITY_WEIGHTS);

/** The player level from which every level-up includes a Rare Incense. */
const RARE_INCENSE_FROM_LEVEL = levelUpRewardFromLevel('rare_incense');

/** "5 Capturing Discs, 1 Incense and 1 Stardust Magnet" from an item table. */
function itemListLine(table) {
  const parts = Object.entries(table || {})
    .filter(([id, n]) => ITEMS[id] && n > 0)
    .map(([id, n]) => `<b>${n} ${itemName(id, n)}</b>`);
  if (parts.length < 2) return parts[0] || '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "Common 2 km · Uncommon 4 km · …" straight from the buddy table. */
function buddyRarityLine() {
  return Object.entries(BUDDY_KM_PER_CANDY)
    .map(([r, kms]) => `<b>${RARITY_NAMES[r]}</b> ${kms} km`)
    .join(' · ');
}

/** 17.5 -> "5:30 PM", 23.75 -> "11:45 PM". */
function clockLabel(hoursFloat) {
  const h24 = Math.floor(hoursFloat);
  const mins = Math.round((hoursFloat - h24) * 60);
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mins).padStart(2, '0')} ${suffix}`;
}

function keyline(k, text) {
  return el('div', { class: 'keyline' }, el('span', { class: 'k', text: k }), el('span', { html: text }));
}

function renderInfo(tab = 'basics') {
  const body = $('#info-body');
  body.innerHTML = '';
  const out = [];

  if (tab === 'basics') {
    const o = Object.fromEntries(POI_OUTCOMES.map(x => [x.kind, x.weight]));
    out.push(
      el('h4', { text: 'Creatures' }),
      el('p', { html: `There are <b>5 types</b> of creatures: <b>Mystic</b>, <b>Wind</b>, <b>Neutral</b>, <b>Celestial</b> and <b>Mechanic</b>.` }),
      el('p', { html: `Creatures come in <b>5 rarities</b>: <b>Common</b> or rarity 1, <b>Uncommon</b> or rarity 2, <b>Rare</b> or rarity 3, <b>Epic</b> or rarity 4, and <b>Legendary</b> or rarity 5.` }),
      el('p', { html: `Each species has <b>3 possible stages</b>: <b>Stage 1</b>, <b>Stage 2</b>, and <b>Stage 3</b>. You can only catch <b>Stage 1 creatures</b> in the wild — you need to <b>evolve</b> them to get their Stage 2 and Stage 3 forms.` }),
      el('h4', { text: 'The map' }),
      el('p', { html: `Real shops, cafes and other amenities around you become points on the map. Everything within <b>${RULES.SCAN_RADIUS_M} m</b> is checked, and the whole map re-rolls every <b>${RULES.SCAN_INTERVAL_MS / 60000} minutes</b>.` }),
      el('p', { html: `You must be within <b>${RULES.CAPTURE_RANGE_M} m</b> of a point to interact with it — creatures, items, raids, grunts and the breeding centre all use the same rule. The green circle around you shows that reach. It widens to <b>${RULES.RELAX_RANGE_M} m</b> during <b>${RELAX_HOUR_LABEL}</b>, see Daily events below.` }),
      el('h4', { text: 'What each icon means' }),
      keyline('✦', 'Flickering stars — a wild creature. You only see which one after you catch it.'),
      keyline('◉', 'Spinning disc — Capturing Discs, and occasionally an Ultra Capture Disc.'),
      keyline('!', 'Rotating exclamation — a Potion or a Revive.'),
      keyline('🔥', 'Bright flame — a raid boss. Battle it with three creatures.'),
      keyline('🧍', 'A person in a park or garden — a battle grunt who wants a 3 v 3.'),
      keyline('⚑', 'Your breeding centre, once you place it.'),
      keyline('↑', 'Put two fingers on the map and twist to rotate it. Pins and timers stay upright; street names are printed into the map tiles so those turn with the roads. The compass button appears once you are off north — tap it to straighten up, or let go within a few degrees and it snaps back on its own.'),
      keyline('✓', 'A green tick means you have already used that point. It stays until its timer ends. If the ticked-off pins clutter things up, <b>Profile → Map display</b> can hide them — they still hold their spot, so nothing new appears there until the timer runs out either way.'),
      el('h4', { text: 'Odds per point' }),
      el('ul', {},
        el('li', { html: `<b>${o.creature}%</b> a creature · <b>${o.discs}%</b> discs · <b>${o.items}%</b> a potion or revive · <b>${o.raid}%</b> a raid · <b>${o.nothing}%</b> nothing` }),
        el('li', { html: `Parks roll separately: <b>${pct(RULES.GRUNT_CHANCE)}</b> chance of a grunt in a <b>leisure=park</b>, and <b>${pct(RULES.GARDEN_GRUNT_CHANCE)}</b> in a quieter <b>leisure=garden</b>.` }),
        el('li', { html: `Each park rolls <b>${RULES.GRUNT_ROLLS_PER_PARK}</b> times, so a big park can hold several grunts. They do not stand at the middle of the park — they appear <b>${RULES.GRUNT_SPAWN_MIN_M}–${RULES.GRUNT_SPAWN_MAX_M} m</b> from you in any direction, up to <b>${RULES.MAX_ACTIVE_GRUNTS}</b> at a time.` }),
        el('li', { html: `On top of those, one trainer walks <b>right up to you</b> once in each 8-hour stretch of the day — <b>midnight–8am</b>, <b>8am–4pm</b> and <b>4pm–midnight</b>. It appears on your own position the first time you have the game open during that stretch, waits <b>${Math.round(RULES.WINDOW_GRUNT_MS / 60_000)} minutes</b>, and does not use up one of the ${RULES.MAX_ACTIVE_GRUNTS} park slots. One per stretch, so three a day at most.` }),
        el('li', { html: `Nothing appears within <b>${RULES.MIN_SPAWN_SEPARATION_M} m</b> of another point, and grunts stay <b>${RULES.MIN_GRUNT_SEPARATION_M} m</b> apart.` })
      ),
      el('h4', { text: 'Shiny creatures' }),
      el('p', { html: `Roughly <b>${pct(SHINY_ODDS.normal.spawn)}</b> of wild catches and <b>${pct(SHINY_ODDS.normal.raid)}</b> of raid catches are shiny — a colour variant, marked with a ★ in storage. Odds double during <b>Shiny Bonanza Hour</b> (${clockLabel(BONANZA_HOUR_START)}–${clockLabel(BONANZA_HOUR_END)} every day) and all of <b>Shiny Bonanza Day</b>, the last Saturday of the month.` }),
      el('h4', { text: 'Daily events' }),
      el('ul', {},
        el('li', { html: `<b>${STARDUST_SUNDAY_LABEL}</b> — all day every Sunday. Every bit of stardust you earn is <b>×${STARDUST_SUNDAY_MULTIPLIER}</b>: captures, raids, grunts, missions and range rewards alike. The doubling is applied <b>last</b>, after the player-level bonus and any Stardust Magnet, so it doubles the final figure.` }),
        el('li', { html: `<b>Shiny Bonanza Hour</b> — ${clockLabel(BONANZA_HOUR_START)} to ${clockLabel(BONANZA_HOUR_END)}. Shiny odds double.` }),
        el('li', { html: `<b>${RELAX_HOUR_LABEL}</b> — ${clockLabel(RELAX_HOUR_START)} to ${clockLabel(RELAX_HOUR_END)}. Your reach grows from <b>${RULES.CAPTURE_RANGE_M} m</b> to <b>${RULES.RELAX_RANGE_M} m</b>, so you can tap creatures, discs, items, raids, grunts and your breeding centre from the sofa instead of walking to them. The green circle on the map grows to match, and a moonlit chip shows how long is left.` })
      ),
      el('h4', { text: 'Sorting and bulk healing' }),
      el('ul', {},
        el('li', { html: 'Storage sorts by ID, name, type, rarity, level, <b>total stats</b>, shiny, <b>favourite</b> or most recent. Every picker — battle team, breeding, buddy — offers the same list and follows whatever you last chose.' }),
        el('li', { html: '<b>Total stats</b> adds up HP, Attack, Defence and Speed, the same figure shown as "Total" on a creature. Tap <b>↓</b> to put your strongest first when picking a battle team.' }),
        el('li', { html: 'Tapping a <b>Potion</b> offers <b>Heal all</b>, which spends as many potions as each creature needs to reach full HP. A <b>Revive</b> offers <b>Revive all</b>. Both tell you how many they will use first.' })
      ),
      el('h4', { text: 'Steps' }),
      el('p', { html: `Your walking is tracked while the game is open and shown in your Profile. One step is counted per <b>${RULES.METRES_PER_STEP} m</b> of real movement; jumps over <b>${RULES.MAX_WALK_JUMP_M} m</b> are ignored as GPS noise, and a fake debug location never counts. The same distance feeds your <b>eggs</b>, your <b>buddy</b> and the <b>walking missions</b> together — you never have to choose.` }),
      el('h4', { text: 'Missions' }),
      el('p', { html: 'Missions sit in three tabs. <b>Lifetime</b> never resets. <b>Weekly</b> resets every <b>Monday</b> at midnight local time. <b>Daily</b> resets at midnight. Each timed tab shows its countdown at the bottom.' }),
      el('ul', {},
        el('li', { html: 'Some missions are for <b>walking</b> rather than catching: 1, 5 and 10 km each day, and 25 and 50 km across the week. They read the same step counter as your Profile, so the same walk feeds your eggs, your buddy and these all at once.' }),
        el('li', { html: 'A walking mission can finish mid-stride — you get a nudge as soon as it does, and the Missions tab lights up.' }),
        el('li', { html: 'Lifetime missions also track <b>how many creatures you have raised</b> to level 5, level 7 and level 10. They count everything at or above that level, so taking one creature to 10 credits the level 5 and level 7 missions too.' }),
        el('li', { html: 'Those level missions are counted from your storage as it stands, so <b>releasing</b> a levelled creature takes it back off the total.' }),
        el('li', { html: 'Whichever tab has something waiting turns <b>green and carries a count</b>, so you can see where to look without opening all three.' })
      ),
      el('h4', { text: 'Pages' }),
      el('p', { html: `Once you hold more than <b>${PAGE_SIZE}</b> creatures, Storage, the battle team picker and the breeding picker all split into pages of ${PAGE_SIZE}. Swipe the grid left or right, or use the arrows: <b>‹</b> and <b>›</b> step one page, <b>«</b> and <b>»</b> jump straight to the first and last page. Sorting always reorders your <b>whole</b> collection first and then re-cuts the pages, so page 1 is always the true top of the order.` }),
      el('h4', { text: 'Eggs' }),
      el('p', { html: `Collecting a disc or item point has a <b>${pct(EGG_DROP_CHANCE)}</b> chance of also giving you an egg — <b>80%</b> a 5 km egg, <b>20%</b> a 10 km egg. They live in the <b>Eggs</b> tab of your Storage.` }),
      el('ul', {},
        el('li', { html: `You can hold <b>${MAX_EGGS}</b> eggs at once. While you are full no more will drop, so hatch some to make room.` }),
        el('li', { html: 'An egg does nothing until it is in an <b>incubator</b>. Tap the egg to pick one, or tap an incubator in your Items and pick an egg.' }),
        el('li', { html: 'A <b>Single Use Incubator</b> is used up the moment you start. The plain <b>Incubator</b> is reusable, but it is tied up until its egg hatches.' }),
        el('li', { html: 'Then walk. The tile shows the kilometres done and the incubator it is in, top-left.' }),
        el('li', { html: 'When one is ready you get a prompt <b>on the map</b> — it will not interrupt a battle or your storage. Tap Hatch and see what turns up.' }),
        el('li', { html: `A <b>5 km</b> egg pays <b>${EGG_TYPES['5km'].dust} stardust</b>, <b>${EGG_TYPES['5km'].xp} XP</b> and <b>+${EGG_TYPES['5km'].bonusCandy} candy</b> on top of the usual catch candy: ${weightLine(EGG_TYPES['5km'].weights)}.` }),
        el('li', { html: `A <b>10 km</b> egg pays <b>${EGG_TYPES['10km'].dust} stardust</b>, <b>${EGG_TYPES['10km'].xp} XP</b> and <b>+${EGG_TYPES['10km'].bonusCandy} candy</b> on top of the usual catch candy: ${weightLine(EGG_TYPES['10km'].weights)}.` }),
        el('li', { html: `Hatchlings arrive at <b>level ${EGG_HATCH_LEVEL}</b>, not level 1, so they are worth battling with straight away.` }),
        el('li', { html: `Stardust from an egg grows with your player level like every other reward, and shinies hatch at the <b>raid</b> rate of ${pct(SHINY_ODDS.normal.raid)} — doubled during a Bonanza.` }),
        el('li', { html: 'Hatching is not catching, so it does not count towards the "catch" missions. There are separate <b>Hatch</b> missions for that.' })
      ),
      el('h4', { text: 'Buddy' }),
      el('p', { html: 'Pick a <b>Buddy</b> from your Profile and one creature walks with you, earning candy for its family as you go. Tap <b>Add buddy</b> and choose anything in your storage.' }),
      el('ul', {},
        el('li', { html: 'The Profile card shows its picture, level, how much candy you hold for that family, and a bar counting down the kilometres to the next candy.' }),
        el('li', { html: 'The candy is added automatically the moment you cross the distance, and the bar starts again. There is no daily limit.' }),
        el('li', { html: 'How far you walk per candy depends on the family rarity:' }),
        el('li', { html: buddyRarityLine() }),
        el('li', { html: 'A buddy can still battle, level up and evolve. It <b>cannot be released</b>, on its own or through multi-select, and creatures in the breeding centre cannot be buddies.' }),
        el('li', { html: 'Swapping or removing a buddy loses the part-walked progress towards the current candy.' })
      )
    );
  }

  if (tab === 'items') {
    out.push(el('p', { text: 'Items live in the Items tab of your Storage. Tap one to use it.' }));
    for (const def of itemsInOrder()) {
      out.push(el('div', { class: 'keyline' },
        el('img', { src: itemImage(def.id), alt: '', style: { width: '26px', height: '26px', objectFit: 'contain' } }),
        el('span', { html: `<b>${def.name}</b> — ${def.blurb}` })
      ));
    }
    out.push(
      el('h4', { text: 'Good to know' }),
      el('ul', {},
        el('li', { html: 'No Capturing Disc means no catching — you will be told when you tap a creature.' }),
        el('li', { html: 'Potions cannot be used during a battle, or on a creature that has fainted.' }),
        el('li', { html: 'Only one incense and one Stardust Magnet can run at a time. <b>Rare Incense</b> shares the incense slot, so it cannot stack with a plain one.' }),
        el('li', { html: `<b>Rare Incense</b> spawns on the same 2-minute rhythm but with far better odds: ${rareIncenseLine()}. Compare that to a wild spawn at ${wildOddsLine()}.` }),
        el('li', { html: `<b>Incubators</b> let you hatch eggs by walking. The plain <b>Incubator</b> is reusable — it ties up until the egg hatches, then you can use it again. A <b>Single Use Incubator</b> is consumed the moment you start it. You get a plain incubator at player level 5, and single use incubators from raid wins (${pct(RAID_REWARD.incubatorChance)}, or <b>guaranteed</b> from a rarity ${RAID_BONUS_RARITIES.join(' or ')} boss) and several missions.` }),
        el('li', { html: `<b>Rare Incense</b> is the hardest one to come by: a <b>${pct(raidRareIncenseChance(RAID_BONUS_RARITIES[0]))}</b> drop from rarity ${RAID_BONUS_RARITIES.join(' and ')} raids, a handful of missions, and one <b>every level from player level ${RARE_INCENSE_FROM_LEVEL}</b> onwards.` })
      )
    );
  }

  if (tab === 'battles') {
    out.push(
      el('p', { html: 'Raids and grunts both use a turn-based 3 v 3. You need <b>three healthy creatures</b> to take part, and they fight in the order you pick them.' }),
      el('h4', { text: 'How a turn works' }),
      el('ul', {},
        el('li', { html: 'The creature with the higher <b>Speed</b> attacks first; a tie is random.' }),
        el('li', { html: 'If the first attack knocks the target out, it does not get to strike back.' }),
        el('li', { html: 'Damage is <b>move power × Attack ÷ Defence</b>, rounded.' }),
        el('li', { html: 'Buff moves raise one of your own stats immediately, and stack if you use them again.' }),
        el('li', { html: 'When a creature faints the next one you chose comes in. Run out and you lose.' })
      ),
      el('h4', { text: `Super effective (+${Math.round((SUPER_EFFECTIVE_MULTIPLIER - 1) * 100)}% damage)` }),
      el('ul', {},
        el('li', { html: '<b>Mystic</b> beats Wind' }),
        el('li', { html: '<b>Wind</b> beats Celestial' }),
        el('li', { html: '<b>Celestial</b> beats Mystic' }),
        el('li', { html: '<b>Mechanic</b> beats Neutral' }),
        el('li', { html: '<b>Neutral</b> has no advantage' })
      ),
      el('h4', { text: `Not very effective (${Math.round(NOT_VERY_EFFECTIVE_MULTIPLIER * 100)}% of the damage)` }),
      el('p', { html: 'Some types are shrugged off. A resisted hit still lands, it just does far less.' }),
      el('ul', {},
        ...Object.entries(TYPE_RESISTANCE)
          .filter(([, against]) => against.length > 0)
          .map(([type, against]) => el('li', {
            html: `<b>${type}</b> is resisted by ${against.map(t => `<b>${t}</b>`).join(', ')}`
          })),
        el('li', { html: '<b>Neutral</b> is not resisted by anything.' })
      ),
      el('p', { html: 'The two charts are separate — being strong against something does not mean it is weak back. <b>Mechanic</b> hits Neutral hardest but is resisted by the other three, so it is the biggest gamble in the game.' }),
      el('h4', { text: 'After the battle' }),
      el('ul', {},
        el('li', { html: 'Damage is kept, including if you <b>leave part-way through</b> — you will be asked to confirm first. A hurt creature needs a <b>Potion</b>, a fainted one needs a <b>Revive</b>. You can heal and revive from the team picker without leaving the battle.' }),
        el('li', { html: `Every raid win always gives <b>${RAID_REWARD.always.revive} Revives</b>. Every grunt always gives healing supplies: ${GRUNT_ITEM_DROPS.map(d => `<b>${d.weight}%</b> ${Object.entries(d.items).map(([id, n]) => `${n} ${itemName(id, n)}`).join(' + ')}`).join(' · ')}.` }),
        el('li', { html: `Beat a raid boss and you can catch it with an <b>Ultra Capture Disc</b> — it arrives at level ${RAID_CAPTURE_LEVEL} with two bonus candy.` }),
        el('li', { html: `A raid boss is no ordinary creature: <b>×${RAID_BOSS_MODIFIERS.hp} HP</b>, and <b>+${Math.round((RAID_BOSS_MODIFIERS.attack - 1) * 100)}%</b> Attack, Defence and Speed.` }),
        el('li', { html: `Most raid wins have a <b>${pct(RAID_REWARD.incubatorChance)}</b> chance of dropping a <b>Single Use Incubator</b>.` }),
        el('li', { html: `Beat a <b>${RAID_BONUS_RARITIES.map(r => RARITY_NAMES[r]).join('</b> or <b>')}</b> raid (rarity ${RAID_BONUS_RARITIES.join(' and ')}) and that <b>Single Use Incubator is guaranteed</b> — no roll. Those two tiers also carry a <b>${pct(raidRareIncenseChance(RAID_BONUS_RARITIES[0]))}</b> chance of a <b>Rare Incense</b> on top, which no other raid drops.` }),
        el('li', { html: `Stardust from a raid scales hard with the boss rarity: ${Object.entries(RAID_TIERS).map(([r, t]) => `<b>${RARITY_NAMES[r]}</b> ${num(t.dust[0])}–${num(t.dust[1])}`).join(' · ')}. Your player level is added on top, and it doubles on ${STARDUST_SUNDAY_LABEL}.` }),
        el('li', { html: `A grunt pays <b>${num(GRUNT_REWARD.dust[0])}–${num(GRUNT_REWARD.dust[1])}</b> stardust, again plus your player level.` }),
        el('li', { html: 'Lose and you can retry as many times as you like until the timer runs out.' }),
        el('li', { html: 'Start a battle before the point expires and you can finish it even if the timer runs out mid-fight.' })
      )
    );
  }

  if (tab === 'growing') {
    out.push(
      el('h4', { text: 'Stats' }),
      el('p', { html: `Every creature has HP, Attack, Defence and Speed. Each level adds <b>${Math.round(STAT_GROWTH_PER_LEVEL * 100)}% of the base stat</b>, counted from the base rather than compounding, so a level 10 creature is nearly twice as strong as a level 1. Every creature you catch also gets a <b>stat modifier</b>: one stat is 10% higher (▲) and another 10% lower (▼).` }),
      el('h4', { text: 'Levelling up' }),
      el('p', { html: `Costs stardust <i>and</i> candy of that creature's family — from ${CANDY_ICON} ${CREATURE_LEVEL_COST[2].candy} + ${DUST_ICON} ${num(CREATURE_LEVEL_COST[2].stardust)} for level 2 up to ${CANDY_ICON} ${CREATURE_LEVEL_COST[MAX_CREATURE_LEVEL].candy} + ${DUST_ICON} ${num(CREATURE_LEVEL_COST[MAX_CREATURE_LEVEL].stardust)} for level ${MAX_CREATURE_LEVEL}.` }),
      el('h4', { text: 'Moves' }),
      el('p', { html: `Creatures learn up to four moves as they level. When you catch one there is a chance it learns its third or fourth move <b>one or two levels early</b> — your storage spells out exactly when. Some moves only arrive after evolving.` }),
      el('h4', { text: 'Candy and evolving' }),
      el('p', { html: `Candy belongs to a <b>family</b>, not a single creature, so catching the Stage 1 form feeds every evolution. Releasing a creature returns 1 candy to its family. Evolving keeps the level, the shiny status and the early-move luck.` }),
      el('h4', { text: 'Stardust' }),
      el('p', { html: `Shared across everything. Every player level you gain adds <b>+${DUST_BONUS_PER_PLAYER_LEVEL}</b> to every stardust reward, and a Stardust Magnet adds <b>+${RULES.MAGNET_BONUS_MULTIPLIER} per player level</b> on every catch while it runs.` }),
      el('h4', { text: 'Your own level' }),
      el('p', { html: `XP comes from catching, hatching, evolving, raids, grunts and missions, up to player level <b>${MAX_PLAYER_LEVEL}</b>. Every level pays out, and the rewards grow as you climb.` }),
      el('ul', {},
        el('li', { html: `<b>Every level:</b> ${itemListLine(LEVEL_UP_REWARDS.every)}.` }),
        RARE_INCENSE_FROM_LEVEL ? el('li', { html: `<b>From level ${RARE_INCENSE_FROM_LEVEL} onwards:</b> a <b>Rare Incense</b> as well, on top of the usual haul — every level, not just the once.` }) : null,
        ...Object.entries(LEVEL_UP_REWARDS.special)
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([lvl, table]) => el('li', { html: `<b>Level ${lvl}:</b> ${itemListLine(table)}.` })),
        el('li', { html: 'Jump two levels at once and you are paid for both.' })
      ),
      el('h4', { text: 'Breeding centre' }),
      el('p', { html: `From player level <b>${BREEDING_UNLOCK_LEVEL}</b> you can pin a breeding centre anywhere — it stays there for good. Leave two creatures of the same species in a slot and they generate that family's candy (every 12 h for common and uncommon, up to 36 h for legendary), stopping at <b>${BREEDING_CANDY_CAP}</b>. They cannot battle until you collect them back from the centre itself.` }),
      el('ul', {},
        el('li', { html: 'Tap an empty slot and your whole storage opens, with the <b>same sorting and pages</b> you use in Storage. Pick any two creatures, then <b>Confirm pair</b>.' }),
        el('li', { html: 'They have to be <b>two of the same creature</b>. Pick a mismatched pair and it tells you so and holds the Confirm button until you fix it.' }),
        el('li', { html: 'Your <b>buddy</b> is left out of the list, because breeding would stop it doing the walking, levelling and battling a buddy is for.' })
      )
    );
  }

  if (tab === 'soon') {
    out.push(
      el('p', { html: 'A lot of exciting new features are coming soon to the game!' }),
      el('h4', { text: 'A new creature set' }),
      el('p', { html: 'A brand-new creature set is releasing very soon. Make sure to collect as many Elemental Awakening creatures as you can — you’ll soon have <b>77 new ones</b> to discover!' }),
      el('h4', { text: 'Raid-exclusive creatures' }),
      el('p', { html: 'We’re also introducing some very special new creatures that will be <b>raid-exclusive</b>. You’ll only be able to encounter them in raids, so invest in a strong team and level up your creatures to be ready to battle them when they arrive. These raids won’t just be the way you can catch these creatures — they’ll also reward <b>unique new items</b>.' }),
      el('h4', { text: 'Shiny Incense' }),
      el('p', { html: 'One of those items is a completely new consumable: <b>Shiny Incense</b>! It works similarly to a regular incense, but increases the shiny probability of the encounters you get while it’s active.' }),
      el('h4', { text: 'Stat Boosters and the Research Lab' }),
      el('p', { html: 'Another new item coming soon is the <b>Stat Booster</b>! If you’ve been collecting candy from creatures you don’t plan to level up, and aren’t sure what to do with the extras, the new <b>Research Lab</b> building will let you convert that spare candy into Stat Boosters. More details on how these work will be revealed soon…' }),
      el('h4', { text: 'More candy' }),
      el('p', { html: 'Struggling to find enough candy to level up your strongest Epic and Legendary creatures? <b>New ways to obtain candy are on the way!</b> Hope you’ve got good precision…' }),
      el('h4', { text: 'Mythical rarity' }),
      el('p', { html: 'A new rarity, <b>rarity 6</b> or <b>mythical</b>, is planned to come in the future. You won&apos;t be able to catch more than one and they are extremely powerful.' })
    );
  }

  body.append(...out.filter(Boolean));
}

