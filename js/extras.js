/* ============================================================
   extras.js — Missions, the Breeding Centre and the How-to-play sheet
   ============================================================ */

import {
  species, familyName, familyRarity, RARITY_NAMES, RULES,
  BREEDING_UNLOCK_LEVEL, BREEDING_CANDY_CAP, BREEDING_SLOTS_BY_LEVEL,
  MAX_CREATURE_LEVEL, CREATURE_LEVEL_COST, POI_OUTCOMES, SHINY_ODDS,
  BONANZA_HOUR, STAT_LABELS
} from './data.js';
import { store, maxHpOf, hpOf, isFainted } from './state.js';
import { itemImage, ITEMS, itemsInOrder } from './items.js';
import { $, $$, el, toast, openSheet, closeSheet, num, timeLeftLabel } from './ui.js';

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
}

/* ===============================================================
   MISSIONS
   =============================================================== */

const MISSION_ICON = { registered: '📖', captures: '🎯', capturesToday: '📅' };

let missionTab = 'lifetime';

export function renderMissions() {
  const host = $('#missions-list');
  const all = store.allMissions();

  // Wire tabs
  $$('#mission-tabs .tab').forEach(b => {
    b.classList.toggle('active', b.dataset.mtab === missionTab);
    b.onclick = () => { missionTab = b.dataset.mtab; renderMissions(); };
  });

  const showing = all.filter(m => missionTab === 'daily' ? m.daily : !m.daily);

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

  // Daily timer
  const timer = $('#daily-timer');
  if (missionTab === 'daily') {
    timer.classList.remove('hidden');
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const ms = tomorrow - now;
    const h = Math.floor(ms / 3_600_000);
    const min = Math.floor((ms % 3_600_000) / 60_000);
    timer.innerHTML = `Daily missions reset in <b>${h}h ${min}m</b>`;
  } else {
    timer.classList.add('hidden');
  }

  renderMissionBadge();
}

function missionRow(m) {
  const pct = Math.min(100, Math.round((m.progress / m.target) * 100));
  const dust = m.def.dust + Math.max(0, store.level - 1);

  return el('div', {
    class: 'mission' + (m.claimable ? ' claimable' : m.claimed ? ' claimed' : '')
  },
    el('span', { class: 'mission-ico', text: MISSION_ICON[m.def.kind] || '🎯' }),
    el('div', { class: 'mission-main' },
      el('b', { text: m.def.label }),
      el('div', { class: 'mission-bar' }, el('i', { style: { width: pct + '%' } })),
      el('div', { class: 'mission-meta' },
        el('span', { text: `${num(Math.min(m.progress, m.target))} / ${num(m.target)}` }),
        el('span', { class: 'r', text: `⭐ ${m.def.xp} XP` }),
        el('span', { class: 'r', text: `${DUST_ICON} ${num(dust)}` })
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
  toast(`${r.label} · +${r.xp} XP, +${num(r.dust)} stardust`, 'good', 3400);
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
      : `Next candy in ${timeLeftLabel(p.nextAt - Date.now())} · one every ${p.every / 3_600_000} h (rarity ${p.rarity})` }),
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
  return el('div', { class: 'breed-slot' },
    el('div', { class: 'breed-slot-top' },
      el('span', { class: 'mission-ico', text: '➕' }),
      el('b', { text: `Slot ${index + 1} · empty` })
    ),
    el('div', { class: 'breed-next', text: pairs.length
      ? 'Pick a species you own at least two of.'
      : 'You need two of the same species (not fainted, not already inside).' }),
    pairs.length
      ? el('div', { class: 'btn-row wrap' }, ...pairs.slice(0, 8).map(pr =>
          el('button', {
            class: 'btn ghost', disabled: !inRange,
            onclick: () => addPair(pr.uids[0], pr.uids[1])
          }, `${species(pr.speciesId).name} ×${pr.count}`)))
      : null
  );
}

/** Species the player owns two or more free copies of. */
function eligiblePairs() {
  const bySpecies = new Map();
  for (const c of store.s.storage) {
    if (c.breeding != null) continue;
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
      el('p', { html: `Real shops, cafes and other amenities around you become points on the map. Everything within <b>${RULES.SCAN_RADIUS_M} m</b> is checked, and the whole map re-rolls every <b>${RULES.SCAN_INTERVAL_MS / 60000} minutes</b>.` }),
      el('p', { html: `You must be within <b>${RULES.CAPTURE_RANGE_M} m</b> of a point to interact with it — creatures, items, raids, grunts and the breeding centre all use the same rule.` }),
      el('h4', { text: 'What each icon means' }),
      keyline('✦', 'Flickering stars — a wild creature. You only see which one after you catch it.'),
      keyline('◉', 'Spinning disc — Capturing Discs, and occasionally an Ultra Capture Disc.'),
      keyline('!', 'Rotating exclamation — a Potion or a Revive.'),
      keyline('🔥', 'Bright flame — a raid boss. Battle it with three creatures.'),
      keyline('🧍', 'A person in a park — a battle grunt who wants a 3 v 3.'),
      keyline('⚑', 'Your breeding centre, once you place it.'),
      keyline('✓', 'A green tick means you have already used that point. It stays until its timer ends.'),
      el('h4', { text: 'Odds per point' }),
      el('ul', {},
        el('li', { html: `<b>${o.creature}%</b> a creature · <b>${o.discs}%</b> discs · <b>${o.items}%</b> a potion or revive · <b>${o.raid}%</b> a raid · <b>${o.nothing}%</b> nothing` }),
        el('li', { html: `Parks roll separately: <b>${pct(RULES.GRUNT_CHANCE)}</b> chance of a grunt.` }),
        el('li', { html: `Nothing appears within <b>${RULES.MIN_SPAWN_SEPARATION_M} m</b> of another point, and grunts stay <b>${RULES.MIN_GRUNT_SEPARATION_M} m</b> apart.` })
      ),
      el('h4', { text: 'Shiny creatures' }),
      el('p', { html: `Roughly <b>${pct(SHINY_ODDS.normal.spawn)}</b> of wild catches and <b>${pct(SHINY_ODDS.normal.raid)}</b> of raid catches are shiny — a colour variant, marked with a ★ in storage. Odds double during <b>Shiny Bonanza Hour</b> (${BONANZA_HOUR}:00–${BONANZA_HOUR + 1}:00 every day) and all of <b>Shiny Bonanza Day</b>, the last Saturday of the month.` })
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
        el('li', { html: 'Only one Incense and one Stardust Magnet can run at a time.' })
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
      el('h4', { text: 'Type advantage (+20% damage)' }),
      el('ul', {},
        el('li', { html: '<b>Mystic</b> beats Wind' }),
        el('li', { html: '<b>Wind</b> beats Celestial' }),
        el('li', { html: '<b>Celestial</b> beats Mystic' }),
        el('li', { html: '<b>Mechanic</b> beats Neutral' }),
        el('li', { html: '<b>Neutral</b> has no advantage' })
      ),
      el('h4', { text: 'After the battle' }),
      el('ul', {},
        el('li', { html: 'Damage is kept. A hurt creature needs a <b>Potion</b>, a fainted one needs a <b>Revive</b>.' }),
        el('li', { html: 'Beat a raid boss and you can catch it with an <b>Ultra Capture Disc</b> — it arrives at level 3 with two bonus candy.' }),
        el('li', { html: 'Lose and you can retry as many times as you like until the timer runs out.' }),
        el('li', { html: 'Start a battle before the point expires and you can finish it even if the timer runs out mid-fight.' })
      )
    );
  }

  if (tab === 'growing') {
    out.push(
      el('h4', { text: 'Stats' }),
      el('p', { html: `Every creature has HP, Attack, Defence and Speed. Each level adds <b>5% of the base stat</b>. Every creature you catch also gets a <b>stat modifier</b>: one stat is 10% higher (▲) and another 10% lower (▼).` }),
      el('h4', { text: 'Levelling up' }),
      el('p', { html: `Costs stardust <i>and</i> candy of that creature's family — from ${CANDY_ICON} ${CREATURE_LEVEL_COST[2].candy} + ${DUST_ICON} ${num(CREATURE_LEVEL_COST[2].stardust)} for level 2 up to ${CANDY_ICON} ${CREATURE_LEVEL_COST[MAX_CREATURE_LEVEL].candy} + ${DUST_ICON} ${num(CREATURE_LEVEL_COST[MAX_CREATURE_LEVEL].stardust)} for level ${MAX_CREATURE_LEVEL}.` }),
      el('h4', { text: 'Moves' }),
      el('p', { html: `Creatures learn up to four moves as they level. When you catch one there is a chance it learns its third or fourth move <b>one or two levels early</b> — your storage spells out exactly when. Some moves only arrive after evolving.` }),
      el('h4', { text: 'Candy and evolving' }),
      el('p', { html: `Candy belongs to a <b>family</b>, not a single creature, so catching the Stage 1 form feeds every evolution. Releasing a creature returns 1 candy to its family. Evolving keeps the level, the shiny status and the early-move luck.` }),
      el('h4', { text: 'Stardust' }),
      el('p', { html: `Shared across everything. Every player level you gain adds <b>+1</b> to every stardust reward, and a Stardust Magnet adds <b>+${RULES.MAGNET_BONUS_DUST}</b> per catch while it runs.` }),
      el('h4', { text: 'Breeding centre' }),
      el('p', { html: `From player level <b>${BREEDING_UNLOCK_LEVEL}</b> you can pin a breeding centre anywhere — it stays there for good. Leave two creatures of the same species in a slot and they generate that family's candy (every 12 h for common and uncommon, up to 36 h for legendary), stopping at <b>${BREEDING_CANDY_CAP}</b>. They cannot battle until you collect them back from the centre itself.` })
    );
  }

  body.append(...out.filter(Boolean));
}
