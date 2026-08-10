/* ============================================================
   views.js — Storage, Collection, Profile and the detail sheet
   ============================================================ */

import {
  DB, SETS, RARITY_NAMES, MAX_CREATURE_LEVEL, MAX_PLAYER_LEVEL,
  species, familyRoot, familyName, familyRarity, levelUpCost
} from './data.js';
import { store } from './state.js';
import { Persist } from './persist.js';
import { playEvolution } from './anim.js';
import { $, $$, el, toast, openSheet, closeSheet, num } from './ui.js';

const CANDY_ICON = '🍬';
const DUST_ICON = '✨';

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
  recent: (a, b) => a.capturedAt - b.capturedAt
};
const sp = c => species(c.speciesId);
const order = c => sp(c)?.order ?? 0;
const rar = c => sp(c)?.rarity ?? familyRarity(c.speciesId) ?? 0;

export function renderStorage() {
  const grid = $('#storage-grid');
  const { storageSort, storageDir } = store.s.ui;
  const list = [...store.s.storage].sort(SORTERS[storageSort] || SORTERS.id);
  if (storageDir < 0) list.reverse();

  $('#storage-count').textContent = `${list.length} stored`;
  $('#storage-empty').classList.toggle('hidden', list.length > 0);
  $('#storage-sort').value = storageSort;
  $('#storage-dir').textContent = storageDir > 0 ? '↑' : '↓';

  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const c of list) {
    const s = sp(c);
    if (!s) continue;
    const rarity = s.rarity || familyRarity(s.id);
    frag.append(el('button', {
      class: 'cell',
      onclick: () => openCreatureSheet(c.uid)
    },
      el('span', { class: 'lvl', text: 'Lv' + c.level }),
      rarity ? el('span', { class: `rar r-${rarity}`, text: rarity }) : null,
      el('img', { src: s.imagePath, alt: s.name, loading: 'lazy' }),
      el('span', { class: 'nm', text: s.name }),
      el('span', { class: `sub t-${s.type}`, text: s.type }),
      el('span', { class: 'stg', text: 'S' + s.stage })
    ));
  }
  grid.append(frag);
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

  body.innerHTML = '';
  body.append(
    el('div', { class: 'det-head' },
      el('img', { src: s.imagePath, alt: s.name }),
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
      )
    ),

    // ---- level up ----
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn primary',
        disabled: !lvlCheck.ok,
        onclick: () => doLevelUp(c.uid)
      }, c.level >= MAX_CREATURE_LEVEL
        ? 'Max level'
        : `Level up → Lv ${c.level + 1} · ${DUST_ICON} ${num(cost)}`)
    ),
    !lvlCheck.ok && lvlCheck.reason === 'dust'
      ? el('p', { class: 'hint', text: `Need ${num(lvlCheck.short)} more stardust.` })
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
      el('button', { class: 'btn danger', onclick: () => doRelease(c.uid) },
        `Release · +${CANDY_ICON} 1 ${familyName(s.id)} candy`)
    )
  );
}

function doLevelUp(uid) {
  const r = store.levelUp(uid);
  if (!r.ok) {
    toast(r.reason === 'max' ? 'Already at max level' : 'Not enough stardust', 'bad');
    return;
  }
  toast(`Levelled up to Lv ${r.level} (−${num(r.cost)} stardust)`, 'good');
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

  const list = DB.species.filter(s => {
    if (ui.filterType && s.type !== ui.filterType) return false;
    if (ui.filterStage && String(s.stage) !== String(ui.filterStage)) return false;
    if (ui.filterRarity && String(s.rarity ?? '') !== String(ui.filterRarity)) return false;
    return true;
  });

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

  const body = $('#sheet-body');
  body.innerHTML = '';
  body.append(
    el('div', { class: 'det-head' },
      el('img', { src: s.imagePath, alt: s.name, class: known ? '' : 'locked' }),
      el('div', { class: 'det-title' },
        el('h3', { text: known ? s.name : '???' }),
        el('div', { class: 'id', text: s.id }),
        el('div', { class: 'det-tags' },
          el('span', { class: 'tag', text: s.stageLabel }),
          el('span', { class: `tag t-${s.type}`, text: s.type }),
          rarity ? el('span', { class: `tag r-${rarity}`, text: `${rarity} · ${RARITY_NAMES[rarity]}` }) : null,
          el('span', { class: 'tag', text: known ? 'Registered' : 'Not registered' })
        )
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
        el('span', { text: CANDY_ICON }),
        el('span', { text: `${familyName(s.id)} candy` }),
        el('b', { text: num(store.candyFor(s.id)) })
      )
    ),

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
export function refreshAll() {
  renderHUD();
  const active = document.querySelector('.view.active')?.id;
  if (active === 'view-storage') renderStorage();
  if (active === 'view-collection') renderCollection();
  if (active === 'view-profile') renderProfile();
}

export function renderView(name) {
  if (name === 'storage') renderStorage();
  else if (name === 'collection') renderCollection();
  else if (name === 'profile') renderProfile();
}
