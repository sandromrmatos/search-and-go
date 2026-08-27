/* ============================================================
   extras.js — Missions, the Breeding Centre and the How-to-play sheet
   ============================================================ */

import {
  species, familyName, familyRarity, RARITY_NAMES, RULES,
  BREEDING_UNLOCK_LEVEL, BREEDING_CANDY_CAP, BREEDING_SLOTS_BY_LEVEL,
  SET_NAME, GALACTIC_SET_NAME, MYTHICAL_RARITY, MYTHICAL_EGG_TYPE, SET_MISSIONS,
  scanIntervalLabel,
  SHOP_ITEMS, COIN_ICON, shopFullSweepCoins,
  SPOTLIGHT_LABEL, SPOTLIGHT_DAY, SPOTLIGHT_START, SPOTLIGHT_END,
  SPOTLIGHT_SUBSTITUTE_CHANCE, SPOTLIGHT_BONUS_CANDY, SPOTLIGHT_SPAWN_MS,
  spotlightOffsetsFor,
  ESSENCE_MIN_LEVEL, ESSENCE_WINDOW_HOURS, ESSENCE_SPAWN_MS,
  ESSENCE_RING_CANDY, ESSENCE_PIN_BANDS, ESSENCE_SEEKER_CHANCE,
  ESSENCE_MAX_RARITY, essenceDifficulty,
  ABILITY_MULTIPLIER_MIN, ABILITY_MULTIPLIER_MAX,
  heldItemName, heldItemsInOrder, heldItemRequirement, heldItemRaidChance,
  HELD_ITEM_RAID_CHANCE, HELD_ITEM_CONSUMABLE_CHANCE, consumableHeldItems,
  STAT_BOOSTER_ITEM, MAX_STAT_BOOSTS, statBoosterCost, STAT_BOOSTER_CANDY_COST,
  ITEM_EXCHANGES,
  SUPER_INCUBATOR, incubatorDiscount, ITEM_DROP_FULL_HEAL_CHANCE, WIN_FULL_HEAL_CHANCE,
  MAX_CREATURE_LEVEL, CREATURE_LEVEL_COST, POI_OUTCOMES, POI_OUTCOMES_WEEKEND, SHINY_ODDS,
  POI_OUTCOMES_RAID_INVASION, POI_OUTCOMES_TRAINING_DOJO,
  RAID_INVASION_LABEL, RAID_INVASION_DAY, RAID_INVASION_START, RAID_INVASION_END,
  RAID_INVASION_DISC_BONUS, RAID_INVASION_DOUBLE_CHANCE,
  TRAINING_DOJO_LABEL, TRAINING_DOJO_DAY, TRAINING_DOJO_START, TRAINING_DOJO_END,
  GALACTIC_TAKEOVER_LABEL, GALACTIC_TAKEOVER_DAY, GALACTIC_TAKEOVER_START, GALACTIC_TAKEOVER_END,
  SWEET_TOOTHSDAY_LABEL, SWEET_TOOTHSDAY_MULTIPLIER, SWEET_TOOTHSDAY_DAY,
  MYSTERIOUS_INCENSE_DURATION_MS, mysteriousIncenseDurationMs, mysteriousIncenseSpawns,
  MYSTERIOUS_INCENSE_GRUNT_CHANCE, MYSTERIOUS_INCENSE_RAID_CHANCE,
  levelUpTiers, playerLevelStep, PLAYER_LEVEL_XP,
  SHINY_INCENSE_ODDS, EXCLUSIVE_SET_NAME, EXCLUSIVE_RAID_BOSS_MODIFIERS,
  EXCLUSIVE_RAID_REWARD, EXCLUSIVE_RAID_WEIGHTS, MAX_EXCLUSIVE_EGGS, DB,
  BONANZA_HOUR_START, BONANZA_HOUR_END, STAT_LABELS,
  RELAX_HOUR_START, RELAX_HOUR_END, RELAX_HOUR_LABEL, dustBonusFor,
  BUDDY_KM_PER_CANDY, STARDUST_SUNDAY_LABEL, STARDUST_SUNDAY_MULTIPLIER,
  RAID_REWARD, RARE_INCENSE_WEIGHTS, RARITY_WEIGHTS, GRUNT_ITEM_DROPS,
  RAID_BOSS_MODIFIERS, EGG_TYPES, EGG_DROP_CHANCE, MAX_EGGS, EGG_HATCH_LEVEL, eggLabel,
  STAT_GROWTH_PER_LEVEL, HIGH_GROWTH_FROM_LEVEL, HIGH_STAT_GROWTH_PER_LEVEL, statGrowthFor,
  RAID_TIERS, GRUNT_REWARD, RAID_CAPTURE_LEVEL,
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

let refresh = null;     // supplied by main.js so we can repaint after changes
let mapChanged = null;  // redraws the map pins — picking a building up moves one

export function initExtras({ onChange, onMapChange } = {}) {
  refresh = onChange;
  mapChanged = onMapChange;
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
  exclusiveRaidsWon: '💠', exclusiveRaidRarity: '💠',
  registeredInSet: '🌌',
  essenceHarvests: '🔮', essenceToday: '🔮', essenceWeek: '🔮',
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
  } else if (missionTab === 'set') {
    // Not a countdown: this tab explains what the ladder is for and how far up
    // it the player is, which is the only context these missions need.
    timer.classList.remove('hidden');
    const got = store.galacticUnlocked;
    timer.innerHTML = got.length
      ? `<b>${GALACTIC_SET_NAME}</b> unlocked: ${
        got.map(r => `${RARITY_NAMES[r]}`).join(', ')}${
        got.length < 5 ? ' — keep going for the rest.' : '. The whole set is in play.'}`
      : `Fill in <b>${SET_NAME}</b> to unlock <b>${GALACTIC_SET_NAME}</b>, one rarity at a time.`;
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
        // A second condition the bar cannot show: a player level (the Research
        // Lab mission) or total XP (the Set ladder). Only one is ever set.
        m.xpNeeded && !m.xpMet
          ? el('span', { class: 'r bad', text: `needs ${num(m.xpNeeded)} XP · ${num(m.xpShort)} to go` })
          : m.levelNeeded && !m.levelMet
            ? el('span', { class: 'r bad', text: `needs Lv ${m.levelNeeded}` })
            : null,
        el('span', { class: 'r', text: `⭐ ${m.def.xp} XP` }),
        el('span', { class: 'r', text: `${DUST_ICON} ${num(dust)}` }),
        m.def.discs ? el('span', { class: 'r', text: `◉ ${m.def.discs} disc${m.def.discs > 1 ? 's' : ''}` }) : null,
        ...itemChips,
        // The real prize on a Set mission is the unlock, not the stardust.
        m.def.unlockGalacticRarity
          ? el('span', {
              class: 'r reward-unlock',
              text: `🌌 Unlocks ${GALACTIC_SET_NAME} rarity ${m.def.unlockGalacticRarity} (${RARITY_NAMES[m.def.unlockGalacticRarity]})`
            })
          : null,
        m.def.unlockExclusiveSet
          ? el('span', {
              class: 'r reward-unlock',
              text: `🔥 Unlocks ${DB.exclusive2.length} new ${EXCLUSIVE_SET_NAME} creatures`
            })
          : null,
        m.def.heldItem
          ? el('span', {
              class: 'r reward-unlock',
              text: m.def.heldItem === 'random'
                ? '◈ A random held item'
                : `◈ ${heldItemName(m.def.heldItem)}`
            })
          : null,
        m.def.grantEgg
          ? el('span', { class: 'r reward-unlock', text: `🥚 ${eggLabel(m.def.grantEgg)}` })
          : null
      )
    ),
    el('div', { class: 'mission-act' },
      m.claimed
        ? el('span', { class: 'mission-tick', text: '✓' })
        : m.claimable
          ? el('button', { class: 'btn primary', onclick: () => claim(m.def.id) }, 'Claim')
          // Once the bar is full but the other gate is not, say which one is
          // holding it rather than showing a misleading "100%".
          : el('span', { class: 'muted', text: m.progress < m.target
              ? `${pct}%`
              : m.xpNeeded && !m.xpMet ? `${num(m.xpNeeded)} XP`
              : m.levelNeeded && !m.levelMet ? `Lv ${m.levelNeeded}`
              : `${pct}%` })
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
  // The unlock deserves its own shout: it changes what the whole map can spawn.
  if (r.unlockedRarity) {
    toast(`${RARITY_NAMES[r.unlockedRarity]} ${GALACTIC_SET_NAME} creatures can now appear!`,
      'good', 5000);
  }
  if (r.egg) toast(`A ${eggLabel(r.egg.type)} was added to your Eggs`, 'good', 4200);
  if (r.heldReward) {
    toast(`◈ ${r.heldReward.name} — it is in your Held items`, 'good', 4200);
  }
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

/* ===============================================================
   RESEARCH LAB

   One recipe for now, so the first screen is a list of one. It is still a list
   rather than jumping straight to the exchange, because more recipes are the
   whole point of the building.
   =============================================================== */

/** Opened by tapping the lab on the map. */
export function openResearchLab({ inRange = true } = {}) {
  renderResearchLab(inRange);
  openSheet('research-lab');
}

function renderResearchLab(inRange) {
  const hint = $('#lab-hint');
  const body = $('#lab-body');
  body.innerHTML = '';

  if (!store.s.researchLab) {
    hint.textContent = 'You have not placed a Research Lab yet.';
    return;
  }
  hint.textContent = inRange
    ? 'Turn spare candy into items, or trade items you are sitting on for ones you need. Anything you get goes to your Items storage.'
    : `You need to be within ${RULES.CAPTURE_RANGE_M} m of the lab to use it.`;

  const options = store.statBoosterOptions();
  const held = store.itemCount(STAT_BOOSTER_ITEM);

  body.append(
    el('h4', { class: 'sheet-h4', text: 'Create items' }),
    el('button', {
      class: 'cell item-cell tappable lab-recipe',
      disabled: !inRange,
      onclick: () => openStatBoosterCraft()
    },
      held ? el('span', { class: 'qty', text: String(held) }) : null,
      el('img', { src: itemImage(STAT_BOOSTER_ITEM), alt: '' }),
      el('span', { class: 'nm', text: ITEMS[STAT_BOOSTER_ITEM].name }),
      el('span', {
        class: 'use-hint',
        text: options.length
          ? `${options.length} famil${options.length === 1 ? 'y' : 'ies'} ready`
          : 'Not enough candy yet'
      })
    ),
    el('p', { class: 'hint', html: `A <b>Stat Booster</b> adds a permanent <b>+1</b> to one stat of one creature, up to <b>${MAX_STAT_BOOSTS}</b> per creature. The candy price depends on the rarity of the family you spend from: ${
      [1, 2, 3, 4].map(r => `<b>${RARITY_NAMES[r]}</b> ${statBoosterCost(r)}`).join(' · ')
    } (rarity 5 also ${statBoosterCost(5)}).` }),

    el('h4', { class: 'sheet-h4', text: 'Exchange corner' }),
    el('button', {
      class: 'cell item-cell tappable lab-recipe',
      disabled: !inRange,
      onclick: () => openExchangeCorner()
    },
      el('span', { class: 'lab-swap', text: '⇄' }),
      el('span', { class: 'nm', text: 'Exchange corner' }),
      el('span', {
        class: 'use-hint',
        text: (() => {
          const ready = store.exchangeOptions().filter(o => o.max > 0).length;
          return ready
            ? `${ready} trade${ready === 1 ? '' : 's'} available`
            : 'Nothing to trade in yet';
        })()
      })
    ),
    el('p', { class: 'hint', html: `Hand over a pile of one everyday item and take a few of another: ${
      ITEM_EXCHANGES.map(d => `<b>${d.cost} ${itemName(d.from)}${d.cost === 1 ? '' : 's'}</b>`).join(' · ')
    }. The rate is always in the lab's favour, so it is a way to clear out what you never use rather than a way to print discs.` }),
    el('p', { class: 'hint', text: 'More recipes will appear here in future updates.' }),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn ghost', disabled: !inRange, onclick: moveLab }, '🔬 Move lab')
    ),
    el('p', { class: 'hint', text: 'Moving puts the lab back in your Items so you can pin it somewhere else. It holds nothing, so there is never anything to collect first.' })
  );
}

function moveLab() {
  if (!store.s.researchLab) return;
  if (!confirm('Pick your Research Lab up? It goes back to your Items and you can pin it somewhere else.')) return;

  const r = store.moveResearchLab();
  if (!r.ok) { toast('Could not move it', 'bad'); return; }
  closeSheet('research-lab');
  toast('Research Lab packed up — place it wherever you like', 'good', 3600);
  mapChanged?.();
  refresh?.();
}

/* ---- the candy exchange ---- */

let craftSpeciesId = null;
let craftQty = 1;

function openStatBoosterCraft() {
  craftSpeciesId = null;
  craftQty = 1;
  renderStatBoosterCraft();
  openSheet('lab-craft');
}

function renderStatBoosterCraft() {
  const body = $('#lab-craft-body');
  const hint = $('#lab-craft-hint');
  body.innerHTML = '';

  const options = store.statBoosterOptions();
  $('#lab-craft-title').textContent = `${ITEMS[STAT_BOOSTER_ITEM].name} · ${store.itemCount(STAT_BOOSTER_ITEM)} held`;

  if (!options.length) {
    hint.textContent = 'No family has enough candy for a Stat Booster yet.';
    body.append(el('p', { class: 'empty', html: `You need at least ${statBoosterCost(4)} candy from a rarity 4 or 5 family, or ${statBoosterCost(1)} from a common one. Keep catching and releasing to build candy up.` }));
    return;
  }

  // Step 1: which family's candy to spend.
  const chosen = craftSpeciesId ? options.find(o => o.speciesId === craftSpeciesId) : null;
  if (!chosen) {
    hint.textContent = 'Whose candy would you like to spend? Only families with enough for at least one are shown.';
    const grid = el('div', { class: 'grid' });
    for (const o of options) {
      grid.append(el('button', {
        class: 'cell tappable',
        onclick: () => { craftSpeciesId = o.speciesId; craftQty = 1; renderStatBoosterCraft(); }
      },
        el('span', { class: `rar r-${o.species.rarity || familyRarity(o.species.id) || 1}`,
                     text: String(o.species.rarity || familyRarity(o.species.id) || 1) }),
        el('img', { src: o.species.imagePath, alt: o.species.name, loading: 'lazy' }),
        el('span', { class: 'nm', text: familyName(o.species.id) }),
        el('span', { class: 'sub', text: `${CANDY_ICON} ${num(o.candy)}` }),
        el('span', { class: 'use-hint', text: `${o.cost} each · up to ${o.max}` })
      ));
    }
    body.append(grid);
    return;
  }

  // Step 2: how many.
  craftQty = Math.max(1, Math.min(chosen.max, craftQty));
  const spend = chosen.cost * craftQty;

  hint.textContent = `Spending ${familyName(chosen.species.id)} candy at ${chosen.cost} per booster.`;
  body.append(
    el('div', { class: 'det-head' },
      el('img', { src: chosen.species.imagePath, alt: chosen.species.name }),
      el('div', { class: 'det-title' },
        el('h3', { text: familyName(chosen.species.id) }),
        el('div', { class: 'det-tags' },
          el('span', { class: 'tag', text: `${CANDY_ICON} ${num(chosen.candy)} candy` }),
          el('span', { class: 'tag', text: `${chosen.cost} per booster` }),
          el('span', { class: 'tag', text: `max ${chosen.max}` })
        )
      )
    ),
    el('div', { class: 'qty-picker' },
      el('button', {
        class: 'btn ghost', disabled: craftQty <= 1,
        'aria-label': 'One fewer',
        onclick: () => { craftQty--; renderStatBoosterCraft(); }
      }, '−'),
      el('div', { class: 'qty-read' },
        el('b', { text: String(craftQty) }),
        el('span', { class: 'muted small', text: craftQty === 1 ? 'Stat Booster' : 'Stat Boosters' })
      ),
      el('button', {
        class: 'btn ghost', disabled: craftQty >= chosen.max,
        'aria-label': 'One more',
        onclick: () => { craftQty++; renderStatBoosterCraft(); }
      }, '+')
    ),
    el('div', { class: 'det-rows' },
      el('div', { class: 'det-row' },
        el('span', { text: CANDY_ICON }),
        el('span', { text: 'Candy spent' }),
        el('b', { text: num(spend) })
      ),
      el('div', { class: 'det-row' },
        el('span', { text: CANDY_ICON }),
        el('span', { text: 'Candy left after' }),
        el('b', { text: num(chosen.candy - spend) })
      )
    ),
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn ghost',
        onclick: () => { craftSpeciesId = null; renderStatBoosterCraft(); }
      }, 'Pick another'),
      el('button', {
        class: 'btn primary',
        onclick: () => {
          const r = store.craftStatBoosters(chosen.speciesId, craftQty);
          if (!r.ok) {
            toast(r.reason === 'noLab' ? 'Place your Research Lab first' : 'Not enough candy', 'bad');
            return;
          }
          toast(`Made ${r.made} Stat Booster${r.made === 1 ? '' : 's'} for ${r.spent} ${familyName(r.species.id)} candy`, 'good', 3600);
          // Straight back to the family list, which re-reads the new balances.
          craftSpeciesId = null;
          craftQty = 1;
          renderStatBoosterCraft();
          renderResearchLab(true);
          refresh?.();
        }
      }, `Exchange ${spend} candy`)
    ),
    el('p', { class: 'hint', text: 'Boosters work on any creature, whatever candy you used to make them.' })
  );
}

/* ---- the exchange corner ----

   Two screens, the same shape as the candy exchange above: pick what you are
   handing over, then pick what you want back and how many times to do it. */

let swapFrom = null;
let swapTo = null;
let swapQty = 1;

function openExchangeCorner() {
  swapFrom = null;
  swapTo = null;
  swapQty = 1;
  renderExchangeCorner();
  openSheet('lab-exchange');
}

function renderExchangeCorner() {
  const body = $('#lab-exchange-body');
  const hint = $('#lab-exchange-hint');
  const title = $('#lab-exchange-title');
  body.innerHTML = '';

  const deals = store.exchangeOptions();
  const deal = swapFrom ? deals.find(d => d.from === swapFrom) : null;

  // Step 1: what are you handing over?
  if (!deal) {
    title.textContent = 'Exchange corner';
    hint.textContent = 'What would you like to trade in? The number on each is how many you are holding.';

    const grid = el('div', { class: 'grid' });
    for (const d of deals) {
      grid.append(el('button', {
        class: 'cell item-cell tappable',
        disabled: d.max < 1,
        onclick: () => { swapFrom = d.from; swapTo = null; swapQty = 1; renderExchangeCorner(); }
      },
        d.have ? el('span', { class: 'qty', text: String(d.have) }) : null,
        el('img', { src: itemImage(d.from), alt: '' }),
        el('span', { class: 'nm', text: itemName(d.from) }),
        el('span', {
          class: 'use-hint',
          text: d.max >= 1
            ? `${d.cost} per trade · up to ${d.max}`
            : `Need ${d.cost}, you have ${d.have}`
        })
      ));
    }
    body.append(
      grid,
      el('p', { class: 'hint', text: 'Every trade is a loss on paper. It exists so a drawer full of Potions can become something you will actually use.' })
    );
    return;
  }

  // Step 2: what do you want back, and how many times?
  const want = swapTo ? deal.to.find(t => t.item === swapTo) : null;
  const max = Math.max(1, deal.max);
  swapQty = Math.max(1, Math.min(max, swapQty));

  title.textContent = `Trading in ${itemName(deal.from)}`;
  hint.textContent = want
    ? `${deal.cost} ${itemName(deal.from)} buys ${want.qty} ${itemName(want.item)}. Choose how many times.`
    : `You have ${deal.have}, enough for ${deal.max} trade${deal.max === 1 ? '' : 's'}. What would you like back?`;

  const choices = el('div', { class: 'grid' });
  for (const t of deal.to) {
    choices.append(el('button', {
      class: 'cell item-cell tappable' + (swapTo === t.item ? ' picked' : ''),
      onclick: () => { swapTo = t.item; swapQty = 1; renderExchangeCorner(); }
    },
      el('img', { src: itemImage(t.item), alt: '' }),
      el('span', { class: 'nm', text: itemName(t.item) }),
      el('span', { class: 'use-hint', text: `${deal.cost} → ${t.qty}` })
    ));
  }

  body.append(
    el('div', { class: 'det-head' },
      el('img', { src: itemImage(deal.from), alt: itemName(deal.from) }),
      el('div', { class: 'det-title' },
        el('h3', { text: itemName(deal.from) }),
        el('div', { class: 'det-tags' },
          el('span', { class: 'tag', text: `${deal.have} held` }),
          el('span', { class: 'tag', text: `${deal.cost} per trade` }),
          el('span', { class: 'tag', text: `max ${deal.max}` })
        )
      )
    ),
    choices
  );

  if (!want) {
    body.append(
      el('div', { class: 'btn-row' },
        el('button', {
          class: 'btn ghost',
          onclick: () => { swapFrom = null; swapTo = null; renderExchangeCorner(); }
        }, 'Trade something else')
      )
    );
    return;
  }

  const spend = deal.cost * swapQty;
  const gain = want.qty * swapQty;

  body.append(
    el('div', { class: 'qty-picker' },
      el('button', {
        class: 'btn ghost', disabled: swapQty <= 1,
        'aria-label': 'One fewer trade',
        onclick: () => { swapQty--; renderExchangeCorner(); }
      }, '−'),
      el('div', { class: 'qty-read' },
        el('b', { text: String(swapQty) }),
        el('span', { class: 'muted small', text: swapQty === 1 ? 'trade' : 'trades' })
      ),
      el('button', {
        class: 'btn ghost', disabled: swapQty >= deal.max,
        'aria-label': 'One more trade',
        onclick: () => { swapQty++; renderExchangeCorner(); }
      }, '+')
    ),
    el('div', { class: 'det-rows' },
      el('div', { class: 'det-row' },
        el('span', { text: '➖' }),
        el('span', { text: `${itemName(deal.from)} handed over` }),
        el('b', { text: num(spend) })
      ),
      el('div', { class: 'det-row' },
        el('span', { text: '➕' }),
        el('span', { text: `${itemName(want.item)} received` }),
        el('b', { text: num(gain) })
      ),
      el('div', { class: 'det-row' },
        el('span', { text: '📦' }),
        el('span', { text: `${itemName(deal.from)} left after` }),
        el('b', { text: num(deal.have - spend) })
      )
    ),
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn ghost',
        onclick: () => { swapTo = null; swapQty = 1; renderExchangeCorner(); }
      }, 'Pick another'),
      el('button', {
        class: 'btn primary',
        onclick: () => {
          const r = store.exchangeItems(deal.from, want.item, swapQty);
          if (!r.ok) {
            toast(r.reason === 'noLab' ? 'Place your Research Lab first'
              : r.reason === 'items' ? `You need ${r.need} ${itemName(deal.from)}`
              : 'That trade is not available', 'bad');
            return;
          }
          toast(`Traded ${r.spent} ${itemName(r.from)} for ${r.gained} ${itemName(r.to)}`, 'good', 3600);
          // Back to the item list, which re-reads what is left.
          swapTo = null;
          swapQty = 1;
          if (store.exchangeMax(deal.from) < 1) swapFrom = null;
          renderExchangeCorner();
          renderResearchLab(true);
          refresh?.();
        }
      }, `Trade ${spend} for ${gain}`)
    ),
    el('p', { class: 'hint', text: 'Everything you get goes straight to your Items storage.' })
  );
}



/** The centre whose sheet is open, so a repaint knows which one to draw. */
let openCentreId = null;

/** Opened by tapping one of the flags on the map. */
export function openBreeding(centre = null, { inRange = true } = {}) {
  openCentreId = centre?.id || store.breedingCentres[0]?.id || null;
  renderBreeding(inRange);
  openSheet('breeding');
}

function renderBreeding(inRange) {
  const centre = store.breedingCentre(openCentreId) || store.breedingCentres[0] || null;
  openCentreId = centre?.id || null;
  const host = $('#breeding-slots');
  const hint = $('#breeding-hint');
  host.innerHTML = '';

  if (!centre) {
    hint.textContent = 'You have not placed a breeding centre yet.';
    return;
  }

  // Slots are per centre: this one has the full set however many others you own.
  const cap = store.breedingSlots;
  const here = centre.slots.length;
  const total = store.breedingCentres.length;
  const nextAt = Object.entries(BREEDING_SLOTS_BY_LEVEL)
    .map(([lvl, n]) => ({ lvl: Number(lvl), n }))
    .find(x => x.lvl > store.level);

  hint.textContent = inRange
    ? `Leave two creatures of the same species inside and they generate that family's candy. `
      + `They stop at ${BREEDING_CANDY_CAP} candy, so come back and collect.`
      + (nextAt ? ` Player level ${nextAt.lvl} unlocks slot ${nextAt.n}.` : '')
      + (total > 1 ? ` Each of your ${total} centres has its own ${cap} slot${cap === 1 ? '' : 's'}.` : '')
    : `You need to be within ${RULES.CAPTURE_RANGE_M} m of the centre to use it.`;

  // This centre's own slots: the pairs inside, then its remaining room.
  for (const slot of centre.slots) host.append(filledSlot(slot, inRange));
  for (let i = here; i < cap; i++) host.append(emptySlot(inRange));

  if (!cap) {
    host.append(el('p', { class: 'empty', text: `Slots unlock at player level ${BREEDING_UNLOCK_LEVEL}.` }));
  }

  // ---- move it somewhere else ----
  host.append(
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn ghost',
        disabled: !inRange,
        onclick: () => moveCentre(centre.id)
      }, '⚑ Move centre')
    ),
    el('p', { class: 'hint', text: here
      ? `Moving puts the centre back in your Items. The ${here} pair${here === 1 ? '' : 's'} inside `
        + 'would come home, but any candy they have earned and not been collected for is lost.'
      : 'Moving puts the centre back in your Items so you can pin it somewhere else. Nothing is lost.' })
  );
}

/**
 * Picking a centre up. Always allowed — being unable to was the whole problem,
 * since a centre pinned somewhere you never revisit used to end breeding for
 * good — but the cost is spelled out first when there is one.
 */
function moveCentre(id) {
  const centre = store.breedingCentre(id);
  if (!centre) return;
  const inside = centre.slots.length;
  const atRisk = centre.slots.reduce((n, sl) => n + store.breedingProgress(sl).earned, 0);

  const warning = inside
    ? `Pick this breeding centre up?\n\nThe ${inside} pair${inside === 1 ? '' : 's'} inside `
      + `will come back to your storage, but ${atRisk
        ? `the ${atRisk} candy they have earned so far will be lost`
        : 'any candy they earn towards their next one will be lost'}.\n\n`
      + 'Collect them first if you want to keep it.'
    : 'Pick this breeding centre up? It goes back to your Items and you can pin it somewhere else.';
  if (!confirm(warning)) return;

  const r = store.moveBreedingCentre(id);
  if (!r.ok) { toast('Could not move it', 'bad', 3600); return; }

  closeSheet('breeding');
  toast(r.pairs
    ? `Centre packed up — ${r.pairs} pair${r.pairs === 1 ? '' : 's'} came home`
      + (r.candyLost ? `, ${r.candyLost} candy lost` : '')
    : 'Breeding centre packed up — place it wherever you like', r.candyLost ? '' : 'good', 4200);
  mapChanged?.();
  refresh?.();
}

function filledSlot(slot, inRange) {
  const sp = species(slot.speciesId);
  const p = store.breedingProgress(slot);
  const full = p.earned >= p.cap;

  return el('div', { class: 'breed-slot' + (full ? ' full' : '') },
    el('div', { class: 'breed-slot-top' },
      el('div', { class: 'breed-pair' },
        el('img', { src: sp.imagePath, alt: sp.name }),
        el('img', { src: sp.imagePath, alt: '' })
      ),
      el('b', { text: sp.name }),
      full ? el('span', { class: 'breed-full-tag', text: 'FULL' }) : null,
      el('span', { class: `breed-candy${full ? ' done' : ''}`, text: `${CANDY_ICON} ${p.earned}/${p.cap}` })
    ),
    el('div', { class: 'breed-next', text: full
      ? 'Full — collect them to bank the candy.'
      : `Next candy in ${hoursMinutesLabel(p.nextAt - Date.now())} · one every ${p.every / 3_600_000} h (rarity ${p.rarity})` }),
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn primary', disabled: !inRange,
        onclick: () => collect(slot.id)
      }, `Collect pair${p.earned ? ` · +${p.earned} candy` : ''}`)
    )
  );
}

function emptySlot(inRange) {
  const pairs = eligiblePairs();
  const ready = pairs.length > 0;
  return el('div', { class: 'breed-slot' },
    el('div', { class: 'breed-slot-top' },
      el('span', { class: 'mission-ico', text: '➕' }),
      el('b', { text: 'Free pair slot' })
    ),
    el('div', { class: 'breed-next', text: ready
      ? 'Tap to browse your storage and choose two of the same creature.'
      : 'You need two of the same creature that are not already breeding.' }),
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn primary', disabled: !inRange || !ready,
        onclick: () => openBreedPicker()
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

let breedPicked = [];     // uids, in tap order
let breedPage = 0;

function openBreedPicker() {
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

  $('#breed-picker-title').textContent = 'Choose 2 of the same creature';
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
  const r = store.addBreedingPair(a, b, openCentreId);
  if (!r.ok) {
    toast(({
      full: 'Every slot in this centre is in use',
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

function collect(slotId) {
  const r = store.collectBreedingSlot(slotId);
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

/** Plain-English name for each POI outcome, for the odds lines below. */
const OUTCOME_WORDS = {
  creature: 'a creature',
  discs: 'discs',
  items: 'a potion or revive',
  raid: 'a regular raid',
  exraid: 'an Exclusive Raid',
  grunt: 'a grunt',
  nothing: 'nothing'
};

/**
 * "22% a creature · 28% discs · …" read straight off a POI odds table, so the
 * four tables can never drift out of step with what the info menu claims.
 */
const poiOddsLine = table => table
  .map(x => `<b>${x.weight}%</b> ${OUTCOME_WORDS[x.kind] || x.kind}`)
  .join(' · ');

/** "6:00 PM to 7:00 PM every Wednesday" for a weekly event window. */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weeklyWindowLabel = (day, start, end) =>
  `${clockLabel(start)} to ${clockLabel(end)} every ${DAY_NAMES[day]}`;

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

  // Both the Basics and Battles tabs quote the per-point odds, so they are read
  // once here rather than in each block.
  const o = Object.fromEntries(POI_OUTCOMES.map(x => [x.kind, x.weight]));
  const ow = Object.fromEntries(POI_OUTCOMES_WEEKEND.map(x => [x.kind, x.weight]));

  if (tab === 'basics') {
    out.push(
      el('h4', { text: 'Creatures' }),
      el('p', { html: `There are <b>5 types</b> of creatures: <b>Mystic</b>, <b>Wind</b>, <b>Neutral</b>, <b>Celestial</b> and <b>Mechanic</b>.` }),
      el('p', { html: `Creatures come in <b>5 rarities</b>: <b>Common</b> or rarity 1, <b>Uncommon</b> or rarity 2, <b>Rare</b> or rarity 3, <b>Epic</b> or rarity 4, and <b>Legendary</b> or rarity 5. Above all of those sits <b>${RARITY_NAMES[MYTHICAL_RARITY]}</b>, rarity ${MYTHICAL_RARITY} — see Mythicals below.` }),
      el('p', { html: `Each species has <b>3 possible stages</b>: <b>Stage 1</b>, <b>Stage 2</b>, and <b>Stage 3</b>. You can only catch <b>Stage 1 creatures</b> in the wild — you need to <b>evolve</b> them to get their Stage 2 and Stage 3 forms.` }),
      el('h4', { text: 'Sets' }),
      el('p', { html: `Every creature belongs to a <b>set</b>, and your Collection has a tab for each one.` }),
      el('ul', {},
        el('li', { html: `<b>${SET_NAME}</b> — the ${DB.species.filter(s => s.set === SET_NAME).length} creatures you start the game with. These are what spawn on the map from the very first scan.` }),
        el('li', { html: `<b>${GALACTIC_SET_NAME}</b> — ${DB.galactic.length} more creatures, <b>locked to begin with</b>. You open them one rarity at a time through the <b>Set</b> missions, and each rarity you open joins the ordinary pools for good: wild spawns, incense, eggs, raids and grunt teams alike. See Set missions below.` }),
        el('li', { html: `<b>${EXCLUSIVE_SET_NAME}</b> — <b>${DB.exclusiveInPlay.length} creatures</b> that never appear in the wild, from an incense, or from a normal egg. <b>Exclusive Raids</b> and the <b>15 km eggs</b> they drop are the only way to get them, and they only come in rarities <b>3, 4 and 5</b>.${
          store.exclusive2Unlocked || !DB.exclusive2.length ? ''
            : ` A <b>second wave</b> is waiting behind a <b>Set</b> mission — register all ${DB.exclusiveInPlay.length} of these and it opens.`
        }` }),
        el('li', { html: `<b>${RARITY_NAMES[MYTHICAL_RARITY]}</b> — ${DB.mythical.length === 1 ? 'one creature' : `${DB.mythical.length} creatures`} so far, rarity ${MYTHICAL_RARITY}, each with its own single way of being found. See Mythicals below.` })
      ),
      el('h4', { text: 'Set missions' }),
      el('p', { html: `The <b>Set</b> tab in Missions is a ladder that opens <b>${GALACTIC_SET_NAME}</b>. Each rung asks you to <b>register</b> a number of <b>${SET_NAME}</b> creatures — registering means having caught, hatched or evolved it at least once, so releasing it later does not undo it — and to have earned an amount of <b>total XP</b>. They never reset.` }),
      el('ul', {},
        ...SET_MISSIONS.map(m => el('li', {
          html: `<b>${m.label}</b>${m.requireXp ? ` (${num(m.requireXp)} total XP)` : ''} — ${
            m.unlockGalacticRarity
              ? `opens <b>rarity ${m.unlockGalacticRarity}</b> ${GALACTIC_SET_NAME} creatures`
              : m.unlockExclusiveSet
                ? `opens <b>${DB.exclusive2.length} more ${EXCLUSIVE_SET_NAME}</b> creatures`
                : 'pays XP and stardust'
          }${m.id === 'ga5' ? ', plus a <b>Breeding Centre</b> and a <b>50 km egg</b>' : ''}.`
        })),
        el('li', { html: 'The bar fills as you register creatures, but the <b>Claim</b> button waits for the XP as well — the row tells you how much you still need.' }),
        el('li', { html: 'Nothing appears until you actually <b>claim</b> the mission. Completing it is not enough.' }),
        el('li', { html: `Opening a rarity does not change the <b>odds</b> of anything. A wild spawn is still ${pct(RARITY_WEIGHTS[1] / 100)} likely to be a rarity 1 creature — there are simply more rarity 1 creatures it can pick from, ${SET_NAME} and ${GALACTIC_SET_NAME} together.` }),
        el('li', { html: 'Grunts build their teams from the same pool, so once you are a few rungs in you will meet <b>mixed teams</b> from both sets.' })
      ),
      el('h4', { text: 'Mythicals' }),
      el('p', { html: `<b>${RARITY_NAMES[MYTHICAL_RARITY]}</b> creatures are rarity ${MYTHICAL_RARITY} and sit outside all the usual pools — they never spawn, never appear in a raid, and never hatch from an ordinary egg. Each one has a single specific way of being obtained. <b>Astralyon</b> is the first, and it comes from the <b>50 km egg</b> paid out by the last Set mission.` }),
      el('p', { html: `Their <b>buff move</b> is what sets them apart: instead of raising one stat it raises <b>several at once</b>, and the battle log names each one. Astralyon's raises <b>Attack, Defence and Speed</b> together.` }),
      el('h4', { text: 'The map' }),
      el('p', { html: `Real places around you become points on the map: <b>shops</b>, <b>cafes and other amenities</b>, <b>tourist spots</b>, <b>bus stops</b>, <b>industrial and service buildings</b>, <b>leisure spots</b> like pitches, playgrounds and sports centres, and even <b>street furniture</b> — <b>trees</b>, <b>poles</b> and <b>pedestrian crossings</b>. Everything within <b>${RULES.SCAN_RADIUS_M} m</b> is checked, and the whole map re-rolls every <b>${scanIntervalLabel()}</b>. <b>Green space</b> is the exception — <b>parks</b>, <b>gardens</b> and <b>grass</b> produce battle grunts instead of loot.` }),
      el('p', { html: `Out on a quiet street the smaller sources matter: a lamp post or a crossing is a point like any other, so a rural lane is no longer an empty map. They cannot crowd each other out either, because nothing appears within <b>${RULES.MIN_SPAWN_SEPARATION_M} m</b> of another point — a road lined with poles produces only what fits.` }),
      el('p', { html: `You must be within <b>${RULES.CAPTURE_RANGE_M} m</b> of a point to interact with it — creatures, items, raids, grunts and the breeding centre all use the same rule. The green circle around you shows that reach. It widens to <b>${RULES.RELAX_RANGE_M} m</b> during <b>${RELAX_HOUR_LABEL}</b>, see Daily events below.` }),
      el('p', { html: 'Your position is <b>never shown as numbers</b> anywhere in the game, so a screenshot gives nothing away. The blue dot and the green circle are all you get. If a point looks close but will not open, your GPS fix is probably just loose — walking a few steps into the open usually fixes it.' }),
      el('h4', { text: 'Temperature' }),
      el('p', { html: 'The 🌡 chip in the top bar shows the real temperature in <b>°C</b> where you are, from <b>Open-Meteo</b>. It refreshes every 15 minutes, which is as often as they recalculate, and again if you travel more than a couple of kilometres. Your position is rounded to about a kilometre before being sent, so the exact spot never leaves your device. Offline it keeps the last reading it had, and shows <b>—</b> if it never got one.' }),
      el('p', { html: '<b>Tap the chip</b> for the rest of the reading: conditions, cloud cover, humidity, precipitation, wind speed and direction, and whether it is currently day or night. Only the temperature gets permanent space in the HUD.' }),
      el('h4', { text: 'What each icon means' }),
      keyline('✦', 'Flickering stars — a wild creature. You only see which one after you catch it.'),
      keyline('◉', `Spinning disc — Capturing Discs, and occasionally an Ultra Capture Disc. During a <b>${RAID_INVASION_LABEL}</b> every one of these also carries an Ultra Capture Disc.`),
      keyline('!', 'Rotating exclamation — a Potion or a Revive.'),
      keyline('🔥', 'Bright orange flame — a raid boss. Battle it with three creatures.'),
      keyline('🔥', 'Blue flame — an <b>Exclusive Raid</b>. Same idea, tougher boss, and the only place some creatures ever appear. See the Battles tab.'),
      keyline('🧍', `A person on grass, in a park or in a garden — a battle grunt who wants a 3 v 3. During <b>${TRAINING_DOJO_LABEL}</b> they turn up on ordinary map points too.`),
      keyline('⚑', 'Your breeding centre, once you place it.'),
      keyline('↑', 'Put two fingers on the map and twist to rotate it. Pins and timers stay upright; street names are printed into the map tiles so those turn with the roads. The compass button appears once you are off north — tap it to straighten up, or let go within a few degrees and it snaps back on its own.'),
      keyline('✓', 'A green tick means you have already used that point. It stays until its timer ends. If the ticked-off pins clutter things up, <b>Profile → Map display</b> can hide them — they still hold their spot, so nothing new appears there until the timer runs out either way.'),
      el('h4', { text: 'Odds per point' }),
      el('ul', {},
        el('li', { html: `<b>Monday to Friday:</b> ${poiOddsLine(POI_OUTCOMES)}` }),
        el('li', { html: `<b>Saturday and Sunday:</b> ${poiOddsLine(POI_OUTCOMES_WEEKEND)}. The extra Exclusive Raid chance comes out of the "nothing" slice, so everything else keeps its weekday odds.` }),
        el('li', { html: `Two <b>weekly events</b> replace those odds entirely for their window — see Weekly events below.` }),
        el('li', { html: `Green space rolls separately: <b>${pct(RULES.GRUNT_CHANCE)}</b> chance of a grunt in a <b>park</b>, and <b>${pct(RULES.GARDEN_GRUNT_CHANCE)}</b> in a quieter <b>garden</b> or patch of <b>grass</b>.` }),
        el('li', { html: `Each patch of green space rolls <b>${RULES.GRUNT_ROLLS_PER_PARK}</b> times, so a big park can hold several grunts. They do not stand at its middle — they appear <b>${RULES.GRUNT_SPAWN_MIN_M}–${RULES.GRUNT_SPAWN_MAX_M} m</b> from you in any direction, up to <b>${RULES.MAX_ACTIVE_GRUNTS}</b> at a time across all of it.` }),
        el('li', { html: `On top of those, one trainer walks <b>right up to you</b> once in each 8-hour stretch of the day — <b>midnight–8am</b>, <b>8am–4pm</b> and <b>4pm–midnight</b>. It appears on your own position the first time you have the game open during that stretch, waits <b>${Math.round(RULES.WINDOW_GRUNT_MS / 60_000)} minutes</b>, and does not use up one of the ${RULES.MAX_ACTIVE_GRUNTS} green-space slots. One per stretch, so three a day at most.` }),
        el('li', { html: `Nothing appears within <b>${RULES.MIN_SPAWN_SEPARATION_M} m</b> of another point, and grunts stay <b>${RULES.MIN_GRUNT_SEPARATION_M} m</b> apart.` })
      ),
      el('h4', { text: 'Shiny creatures' }),
      el('p', { html: `Roughly <b>${pct(SHINY_ODDS.normal.spawn)}</b> of wild catches and <b>${pct(SHINY_ODDS.normal.raid)}</b> of raid catches are shiny — a colour variant, marked with a ★ in storage. Odds double during <b>Shiny Bonanza Hour</b> (${clockLabel(BONANZA_HOUR_START)}–${clockLabel(BONANZA_HOUR_END)} every day) and all of <b>Shiny Bonanza Day</b>, the last Saturday of the month.` }),
      el('p', { html: `A <b>Shiny Incense</b> pins the rate to a flat <b>${pct(SHINY_INCENSE_ODDS)}</b> for everything you catch or hatch while it burns. It <b>replaces</b> the usual odds instead of multiplying them, so it does not stack with a Bonanza — during a Bonanza Hour the doubled raid rate of ${pct(SHINY_ODDS.bonanza.raid)} is close enough that it is worth saving the incense for a quieter moment.` }),
      el('h4', { text: 'Weekly events' }),
      el('p', { html: 'Three events take over the map for a short window each week, and a chip on the map counts down the time left on whichever is running. The first two <b>replace</b> the odds table rather than adding to it; the third leaves the odds alone and changes which creatures are behind them. Remember the map only re-rolls every few minutes, so points that appeared before an event started keep whatever they were.' }),
      el('ul', {},
        el('li', { html: `<b>${RAID_INVASION_LABEL}</b> — ${weeklyWindowLabel(RAID_INVASION_DAY, RAID_INVASION_START, RAID_INVASION_END)}. Every <b>disc point</b> hands over <b>${itemListLine(RAID_INVASION_DISC_BONUS)}</b> on top of its usual drop, and <b>${pct(RAID_INVASION_DOUBLE_CHANCE)}</b> of the time it gives <b>two</b> instead. The odds become: ${poiOddsLine(POI_OUTCOMES_RAID_INVASION)}. There is <b>no "nothing"</b> slice, so every point in range turns into something, and <b>${POI_OUTCOMES_RAID_INVASION.filter(x => x.kind === 'raid' || x.kind === 'exraid').reduce((a, b) => a + b.weight, 0)}%</b> of them are raids.` }),
        el('li', { html: `<b>${TRAINING_DOJO_LABEL}</b> — ${weeklyWindowLabel(TRAINING_DOJO_DAY, TRAINING_DOJO_START, TRAINING_DOJO_END)}. Grunts take over the ordinary map points: this is the only time a shop or amenity becomes a grunt instead of loot, and they stand right at the point rather than being scattered like park grunts. The odds become: ${poiOddsLine(POI_OUTCOMES_TRAINING_DOJO)}. There is <b>no limit</b> on these for the 30 minutes, so every point in range can be one — but they still have to <b>come from a point</b>, and still keep <b>${RULES.MIN_GRUNT_SEPARATION_M} m</b> from each other. <b>Green space is not part of the event</b>: parks, gardens and grass roll as they always do, scattered across the scan radius and capped at <b>${RULES.MAX_ACTIVE_GRUNTS}</b> between them.` }),
        el('li', { html: `<b>${GALACTIC_TAKEOVER_LABEL}</b> — ${weeklyWindowLabel(GALACTIC_TAKEOVER_DAY, GALACTIC_TAKEOVER_START, GALACTIC_TAKEOVER_END)}, and only once you have opened at least one rarity of <b>${GALACTIC_SET_NAME}</b>. For the hour every <b>wild spawn</b>, every <b>incense spawn</b>, every <b>ordinary raid boss</b> and every <b>5 and 10 km egg</b> that hatches comes from your unlocked ${GALACTIC_SET_NAME} creatures — the <b>${SET_NAME}</b> pool is out of play completely. The <b>odds do not move</b>: a rarity 1 roll is still ${pct(RARITY_WEIGHTS[1] / 100)} likely, it just picks from a different list. <b>Exclusive Raids</b> and the <b>15 km</b> and <b>50 km</b> eggs are untouched, since they are the only route to those creatures. If a rarity you have not unlocked comes up, you get one of the Galactic creatures you <i>have</i> unlocked instead.` })
      ),
      el('h4', { text: SPOTLIGHT_LABEL }),
      el('p', { html: `Every <b>${weeklyWindowLabel(SPOTLIGHT_DAY, SPOTLIGHT_START, SPOTLIGHT_END)}</b> one creature takes over the map. Which one rotates weekly — the <b>📅 Calendar</b> button in the News tab always shows the next few and who is featured.` }),
      el('ul', {},
        el('li', { html: `While it runs, a wild spawn or an incense spawn that draws the <b>featured creature's rarity</b> has a <b>${pct(SPOTLIGHT_SUBSTITUTE_CHANCE)}</b> chance of being that creature instead of a normal pick from the tier. Draw any other rarity and nothing changes.` }),
        el('li', { html: `The <b>rarity odds themselves never move</b> — a rarity 1 spawn is still ${pct(RARITY_WEIGHTS[1] / 100)} likely. Only <i>which</i> rarity-N creature you meet changes, and only half the time.` }),
        el('li', { html: `On top of that, the featured creature <b>walks up to you</b> on a fixed schedule, guaranteed, and stands there for <b>${Math.round(SPOTLIGHT_SPAWN_MS / 60_000)} minutes</b>. How often depends on its rarity: ${
          [1, 2, 3, 5].map(r => `<b>${RARITY_NAMES[r]}</b> ${spotlightOffsetsFor(r).length}×`).join(' · ')
        } (rarity 4 matches rarity 3).` }),
        el('li', { html: `Those visits land at <b>${spotlightOffsetsFor(1).map(m => clockLabel(SPOTLIGHT_START + m / 60)).join(', ')}</b> for a Common, thinning out to <b>${spotlightOffsetsFor(5).map(m => clockLabel(SPOTLIGHT_START + m / 60)).join(' and ')}</b> for a Legendary.` }),
        el('li', { html: `Catching the <b>featured creature</b> during the hour pays <b>+${SPOTLIGHT_BONUS_CANDY} candy</b>. Anything else you catch is unaffected.` }),
        el('li', { html: 'Eggs and raids are left alone — the spotlight is about what you meet on the map.' })
      ),
      el('h4', { text: 'Essence Harvesting' }),
      el('p', { html: `From player level <b>${ESSENCE_MIN_LEVEL}</b>, once you have registered anything, a creature you already know leaves an <b>essence</b> somewhere within your <b>${RULES.SCAN_RADIUS_M} m</b> scan radius. It shows on the map as that creature's own picture and lasts <b>${Math.round(ESSENCE_SPAWN_MS / 60_000)} minutes</b>.` }),
      el('ul', {},
        el('li', { html: `One appears per <b>${ESSENCE_WINDOW_HOURS}-hour block</b> — midnight to 2am, 2 to 4, and so on — the first time you open the game during it. Twelve chances a day if you keep dipping in.` }),
        el('li', { html: 'You will not lose it. A <b>flickering rainbow arrow</b> appears on the map pointing straight at it, and it stays visible however far you zoom in or pan away — when the essence is off screen the arrow pins itself to the edge of the view, aimed the right way, with the distance you would have to walk. <b>Tap the arrow</b> to open the harvest from wherever you are. It only goes when you have played the mini game, or when the essence expires.' }),
        el('li', { html: `It is drawn <b>evenly from everything you have registered</b> up to <b>${RARITY_NAMES[ESSENCE_MAX_RARITY]}</b>, so a Legendary is exactly as likely to turn up as your first Common. <b>Mythicals never leave an essence</b>, registered or not.` }),
        el('li', { html: `Tap it and the creature drifts around inside <b>three rings</b>. Tap the rings to draw its essence out: <b>${ESSENCE_RING_CANDY.inner} candy</b> for the bullseye, <b>${ESSENCE_RING_CANDY.mid}</b> for the middle ring, <b>${ESSENCE_RING_CANDY.outer}</b> for the outer one. Miss entirely and you get nothing.` }),
        el('li', { html: 'You can play it from <b>any distance</b> — no walking, no disc, and you are not catching it. What distance changes is how many <b>pins</b> you get, meaning how many taps you have:' }),
        el('li', { html: ESSENCE_PIN_BANDS.map(b => b.over < 0
          ? `<b>within ${ESSENCE_PIN_BANDS[ESSENCE_PIN_BANDS.length - 2].over} m</b> ${b.pins} pins`
          : `<b>over ${b.over} m</b> ${b.pins} pin${b.pins === 1 ? '' : 's'}`).join(' · ') }),
        el('li', { html: 'Every pin is one tap, hit or miss, so walking closer is worth it. Six taps on a Common within 25 m is 18 candy.' }),
        el('li', { html: `<b>Rarer essences are much harder</b>. The drift speed is a straight multiple of a Common's — ${
          [2, 3, 4, 5].map(r => `<b>${RARITY_NAMES[r]} ${essenceDifficulty(r).multiple}×</b>`).join(' · ')
        } — and the rings tighten at the same time, until a <b>${RARITY_NAMES[ESSENCE_MAX_RARITY]}</b> target is <b>half the size</b> of a Common's. A bullseye on one is a genuinely hard shot.` }),
        el('li', { html: `Come away with at least <b>1 candy</b> and there is a <b>${pct(ESSENCE_SEEKER_CHANCE)}</b> chance of a <b>${itemName('molten_seeker')}</b> as well.` }),
        el('li', { html: 'Backing out part-way still banks whatever you have won, but the essence is spent either way — it cannot be reopened for a better run.' }),
        el('li', { html: 'There are <b>lifetime, daily and weekly missions</b> for it. Only a harvest that actually paid candy counts, so a run of pure misses does not tick them along.' })
      ),
      el('h4', { text: 'Daily events' }),
      el('ul', {},
        el('li', { html: `<b>${STARDUST_SUNDAY_LABEL}</b> — all day every Sunday. Every bit of stardust you earn is <b>×${STARDUST_SUNDAY_MULTIPLIER}</b>: captures, raids, grunts, missions and range rewards alike. The doubling is applied <b>last</b>, after the player-level bonus and any Stardust Magnet, so it doubles the final figure.` }),
        el('li', { html: `<b>${SWEET_TOOTHSDAY_LABEL}</b> — all day every ${DAY_NAMES[SWEET_TOOTHSDAY_DAY]}. Candy from <b>catching</b> a creature, <b>catching a raid boss</b> and <b>hatching an egg</b> is <b>×${SWEET_TOOTHSDAY_MULTIPLIER}</b>. Bonuses are doubled too, so a raid catch's <b>+2</b> and an egg's bonus candy both count, and the reward screen says <b>${DAY_NAMES[SWEET_TOOTHSDAY_DAY]} ×2</b> so you can see it landed. Candy from your <b>buddy</b>, the <b>breeding centre</b>, <b>Essence Harvesting</b> and <b>releasing</b> is not affected — those pay out by distance or by the clock, and doubling them would reward a walk you started yesterday.` }),
        el('li', { html: `<b>Shiny Bonanza Hour</b> — ${clockLabel(BONANZA_HOUR_START)} to ${clockLabel(BONANZA_HOUR_END)}. Shiny odds double.` }),
        el('li', { html: `<b>${RELAX_HOUR_LABEL}</b> — ${clockLabel(RELAX_HOUR_START)} to ${clockLabel(RELAX_HOUR_END)}. Your reach grows from <b>${RULES.CAPTURE_RANGE_M} m</b> to <b>${RULES.RELAX_RANGE_M} m</b>, so you can tap creatures, discs, items, raids, grunts and your breeding centre from the sofa instead of walking to them. The green circle on the map grows to match, and a moonlit chip shows how long is left.` })
      ),
      el('h4', { text: 'Sorting and bulk healing' }),
      el('ul', {},
        el('li', { html: 'Storage sorts by ID, name, type, rarity, level, <b>total stats</b>, shiny, <b>favourite</b> or most recent. Every picker — battle team, breeding, buddy — offers the same list and follows whatever you last chose.' }),
        el('li', { html: '<b>Total stats</b> adds up HP, Attack, Defence and Speed, the same figure shown as "Total" on a creature. Tap <b>↓</b> to put your strongest first when picking a battle team.' }),
        el('li', { html: 'Tapping a <b>Potion</b> offers <b>Heal all</b>, which spends as many potions as each creature needs to reach full HP. A <b>Revive</b> offers <b>Revive all</b>. Both tell you how many they will use first.' }),
        el('li', { html: '<b>Hold</b> a creature in your Storage to start <b>multi-select</b> with that one already ticked, then tap the rest and <b>Release</b> them together. A plain tap still opens the creature. Favourites, shinies, buddies and creatures in the breeding centre cannot be selected. Holding a creature in the <b>battle team picker</b> is a different gesture — that one previews its moves.' }),
        el('li', { html: 'Open any creature from your <b>Storage</b> or your <b>Collection</b> and you can <b>swipe left and right</b>, or use the <b>‹ ›</b> arrows, to move through the list without going back. It follows the sort and filters you have set, so swiping through a filtered Collection only visits the creatures that match.' }),
        el('li', { html: 'Sorting the Collection by <b>Times caught</b> uses the <b>lifetime</b> total for each creature — the "Total caught" figure on its page. Releasing one does not change it.' })
      ),
      el('h4', { text: 'Steps' }),
      el('p', { html: `Your walking is tracked while the game is open and shown in your Profile. One step is counted per <b>${RULES.METRES_PER_STEP} m</b> of real movement; jumps over <b>${RULES.MAX_WALK_JUMP_M} m</b> are ignored as GPS noise, and a fake debug location never counts. The same distance feeds your <b>eggs</b>, your <b>buddy</b> and the <b>walking missions</b> together — you never have to choose.` }),
      el('h4', { text: 'Missions' }),
      el('p', { html: 'Missions sit in four tabs. <b>Lifetime</b> never resets. <b>Weekly</b> resets every <b>Monday</b> at midnight local time. <b>Daily</b> resets at midnight. <b>Set</b> never resets either, and is the ladder that opens new creature sets — see Set missions above. Each timed tab shows its countdown at the bottom.' }),
      el('ul', {},
        el('li', { html: 'Some missions are for <b>walking</b> rather than catching: 1, 5 and 10 km each day, and 25 and 50 km across the week. They read the same step counter as your Profile, so the same walk feeds your eggs, your buddy and these all at once.' }),
        el('li', { html: 'A walking mission can finish mid-stride — you get a nudge as soon as it does, and the Missions tab lights up.' }),
        el('li', { html: 'Lifetime missions also track <b>how many creatures you have raised</b> to level 5, level 7 and level 10. They count everything at or above that level, so taking one creature to 10 credits the level 5 and level 7 missions too.' }),
        el('li', { html: 'Those level missions are counted from your storage as it stands, so <b>releasing</b> a levelled creature takes it back off the total.' }),
        el('li', { html: 'Whichever tab has something waiting turns <b>green and carries a count</b>, so you can see where to look without opening them all.' })
      ),
      el('h4', { text: 'Pages' }),
      el('p', { html: `Once you hold more than <b>${PAGE_SIZE}</b> creatures, Storage, the battle team picker and the breeding picker all split into pages of ${PAGE_SIZE}. Swipe the grid left or right, or use the arrows: <b>‹</b> and <b>›</b> step one page, <b>«</b> and <b>»</b> jump straight to the first and last page. Sorting always reorders your <b>whole</b> collection first and then re-cuts the pages, so page 1 is always the true top of the order.` }),
      el('h4', { text: 'Eggs' }),
      el('p', { html: `Collecting a disc or item point has a <b>${pct(EGG_DROP_CHANCE)}</b> chance of also giving you an egg — <b>80%</b> a 5 km egg, <b>20%</b> a 10 km egg. They live in the <b>Eggs</b> tab of your Storage.` }),
      el('ul', {},
        el('li', { html: `You can hold <b>${MAX_EGGS}</b> ordinary eggs at once. While you are full no more will drop, so hatch some to make room.` }),
        el('li', { html: `<b>15 km eggs are separate.</b> They have their own <b>${MAX_EXCLUSIVE_EGGS} slots</b>, so a full set of ${MAX_EGGS} ordinary eggs never blocks one, and ${MAX_EXCLUSIVE_EGGS} exclusive eggs never block an ordinary one.` }),
        el('li', { html: `<b>50 km eggs have no limit at all.</b> They are one-off mission rewards, so they land in your Eggs tab even if every ordinary and 15 km slot is full. Nothing is ever lost.` }),
        el('li', { html: 'An egg does nothing until it is in an <b>incubator</b>. Tap the egg to pick one, or tap an incubator in your Items and pick an egg.' }),
        el('li', { html: 'A <b>Single Use Incubator</b> is used up the moment you start. The plain <b>Incubator</b> is reusable, but it is tied up until its egg hatches.' }),
        el('li', { html: 'Then walk. The tile shows the kilometres done and the incubator it is in, top-left.' }),
        el('li', { html: 'When one is ready you get a prompt <b>on the map</b> — it will not interrupt a battle or your storage. Tap Hatch and see what turns up.' }),
        el('li', { html: `A <b>5 km</b> egg pays <b>${EGG_TYPES['5km'].dust} stardust</b>, <b>${EGG_TYPES['5km'].xp} XP</b> and <b>+${EGG_TYPES['5km'].bonusCandy} candy</b> on top of the usual catch candy: ${weightLine(EGG_TYPES['5km'].weights)}.` }),
        el('li', { html: `A <b>10 km</b> egg pays <b>${EGG_TYPES['10km'].dust} stardust</b>, <b>${EGG_TYPES['10km'].xp} XP</b> and <b>+${EGG_TYPES['10km'].bonusCandy} candy</b> on top of the usual catch candy: ${weightLine(EGG_TYPES['10km'].weights)}.` }),
        el('li', { html: `A <b>15 km</b> egg only ever comes from an <b>Exclusive Raid</b> (a <b>${pct(EXCLUSIVE_RAID_REWARD.eggChance)}</b> chance per win) and only hatches <b>${EXCLUSIVE_SET_NAME}</b> creatures: ${weightLine(EGG_TYPES['15km'].weights)}. It pays <b>${EGG_TYPES['15km'].dust} stardust</b>, <b>${EGG_TYPES['15km'].xp} XP</b> and <b>+${EGG_TYPES['15km'].bonusCandy} candy</b> — that is <b>${EGG_TYPES['15km'].dust - EGG_TYPES['10km'].dust} more stardust</b> and <b>${EGG_TYPES['15km'].bonusCandy - EGG_TYPES['10km'].bonusCandy} more candy</b> than a 10 km egg.` }),
        el('li', { html: `A <b>50 km</b> egg is the rarest thing in the game. The only one so far comes from the last <b>Set</b> mission, and it holds <b>Astralyon</b> — the first <b>${RARITY_NAMES[MYTHICAL_RARITY]}</b>, rarity ${MYTHICAL_RARITY}. It is <b>guaranteed</b>: no roll, no weights, nothing else can come out of it, not even when more mythicals arrive. It pays <b>${EGG_TYPES[MYTHICAL_EGG_TYPE].dust} stardust</b>, <b>${EGG_TYPES[MYTHICAL_EGG_TYPE].xp} XP</b> and <b>+${EGG_TYPES[MYTHICAL_EGG_TYPE].bonusCandy} candy</b>. It <b>cannot</b> hatch a shiny.` }),
        el('li', { html: `Hatchlings arrive at <b>level ${EGG_HATCH_LEVEL}</b>, not level 1, so they are worth battling with straight away.` }),
        el('li', { html: `Stardust from an egg grows with your player level like every other reward, and shinies hatch at the <b>raid</b> rate of ${pct(SHINY_ODDS.normal.raid)} — doubled during a Bonanza. The <b>50 km</b> egg is the exception: it never rolls a shiny.` }),
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
    out.push(
      el('h4', { text: 'The Shop' }),
      el('p', { html: `The <b>Shop</b> tab trades <b>${COIN_ICON} coins</b> for consumables. Tap <b>Watch an ad</b> and the advert opens in a new tab — that earns you a coin, and there is no limit on how many you do. Your game stays put while the other tab is open. Coins never expire, so an unspent one is still there tomorrow.` }),
      el('ul', {},
        ...SHOP_ITEMS.map(s => el('li', {
          html: `<b>${s.qty > 1 ? s.qty + ' ' : ''}${itemName(s.item, s.qty)}</b> — ${COIN_ICON} ${s.coins} coin${s.coins === 1 ? '' : 's'}, up to <b>${s.limit}</b> a day.`
        })),
        el('li', { html: `The limits are <b>per item, per day</b>, and they all reset at <b>midnight</b> local time along with the daily missions. Buying every row to its limit costs <b>${COIN_ICON} ${shopFullSweepCoins()}</b>, so that is the most a single day's watching can be worth.` }),
        el('li', { html: 'Nothing in the game is locked behind the Shop — everything it sells also drops from points, raids, grunts and missions. It is a shortcut, not a gate.' })
      )
    );
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
        el('li', { html: `A <b>Full Heal</b> takes one creature straight to full HP however hurt it is, so it beats spending five potions on the same creature. It cannot revive a fainted one. Every <b>raid</b> and <b>grunt</b> win carries one <b>${pct(WIN_FULL_HEAL_CHANCE)}</b> of the time, and a potion or revive point <b>${pct(ITEM_DROP_FULL_HEAL_CHANCE)}</b> of the time. In the battle team picker you get both buttons — <b>Heal all</b> spends potions, <b>Full Heal</b> spends these, worst hurt first — so you choose which to burn.` }),
        el('li', { html: `A <b>Super Incubator</b> works like a Single Use Incubator but cuts the distance the egg needs by <b>${Math.round(incubatorDiscount(SUPER_INCUBATOR) * 100)}%</b>: a 10 km egg hatches after 7.5 km, a 5 km after 3.75 km, a 15 km after 11.25 km. The discount is fixed when you put the egg in. They come from <b>grunt</b> wins (<b>30%</b>) and a couple of daily missions.` }),
        el('li', { html: `A <b>${itemName('molten_seeker')}</b> widens how far you can reach from <b>${RULES.CAPTURE_RANGE_M} m</b> to <b>${RULES.SEEKER_RANGE_M} m</b> for <b>${Math.round(RULES.SEEKER_DURATION_MS / 60_000)} minutes</b> — creatures, discs, raids, grunts and your buildings all become tappable from twice as far. It has its <b>own effect slot</b>, so it runs happily alongside an incense and a Stardust Magnet, and if it overlaps <b>${RELAX_HOUR_LABEL}</b> the wider of the two wins. It comes from <b>Essence Harvesting</b> (a <b>${pct(ESSENCE_SEEKER_CHANCE)}</b> chance whenever you win candy) and a few missions.` }),
        el('li', { html: `A <b>Stat Booster</b> adds a permanent <b>+1</b> to one stat of one creature. Tap one in your Items, pick the creature, then pick the stat — you see the current figure and what it becomes before confirming. It is applied <b>after everything else</b>, so +1 stays exactly +1 no matter how much the creature levels or evolves. One creature can hold <b>${MAX_STAT_BOOSTS}</b> boosts in total across all four stats. Make them at the <b>Research Lab</b>, or pick them up from <b>grunt</b> wins (<b>10%</b>).` }),
        el('li', { html: `A <b>${itemName('mysterious_incense')}</b> is the one incense you aim. Tap it, pick any <b>Stage 1</b> creature you have <b>registered</b>, and every spawn for the whole burn is that creature — one every <b>2 minutes</b>, each lasting <b>1 min 30 s</b>, exactly like a plain Incense. What you trade is time, because the burn is set by the rarity you choose: ${
          Object.keys(MYSTERIOUS_INCENSE_DURATION_MS).map(r => `<b>${RARITY_NAMES[r]}</b> ${Math.round(mysteriousIncenseDurationMs(r) / 60_000)} min (${mysteriousIncenseSpawns(r)} spawns)`).join(' · ')
        }. <b>Exclusive</b> and <b>${RARITY_NAMES[MYTHICAL_RARITY]}</b> creatures are never on the list — each of those has exactly one way in by design. Once lit it cannot be changed or stopped. It comes from <b>grunt</b> wins (<b>${pct(MYSTERIOUS_INCENSE_GRUNT_CHANCE)}</b>) and <b>raid</b> wins, on odds that climb with the boss: ${
          [1, 2, 3, 4, 5].map(r => `<b>${RARITY_NAMES[r]}</b> ${pct(MYSTERIOUS_INCENSE_RAID_CHANCE[r])}`).join(' · ')
        }.` }),
        el('li', { html: `A <b>${itemName('strength_reroll')}</b> draws one creature's <b>stat modifier</b> again — the stat that is 10% up and the stat that is 10% down. The new pair is <b>guaranteed to differ</b> from the old one on both counts: whatever was going up will not be going up, and whatever was going down will not be going down. You do not get to pick what it becomes, so it is a way out of a bad roll rather than a way to build a perfect creature. It is applied to the base stats, so every figure moves at once, and a creature on <b>full HP stays on full</b> even if its maximum changes. Handed out from <b>level ${levelUpTiers().at(-1)?.from ?? MAX_PLAYER_LEVEL} onwards</b> on every level-up.` }),
        el('li', { html: `Only one incense and one Stardust Magnet can run at a time. <b>Rare</b>, <b>Shiny</b> and <b>${itemName('mysterious_incense')}</b> all share the single incense slot, so no two incenses can ever stack.` }),
        el('li', { html: `<b>Rare Incense</b> spawns on the same 2-minute rhythm but with far better odds: ${rareIncenseLine()}. Compare that to a wild spawn at ${wildOddsLine()}.` }),
        el('li', { html: `<b>Incubators</b> let you hatch eggs by walking. The plain <b>Incubator</b> is reusable — it ties up until the egg hatches, then you can use it again. A <b>Single Use Incubator</b> is consumed the moment you start it. You get a plain incubator at player level 5, and single use incubators from raid wins (${pct(RAID_REWARD.incubatorChance)}, or <b>guaranteed</b> from a rarity ${RAID_BONUS_RARITIES.join(' or ')} boss) and several missions.` }),
        el('li', { html: `The <b>Research Lab</b> is a building rather than a consumable. Pin it to the map, like a Breeding Centre, then visit it to trade spare candy for <b>Stat Boosters</b> or use the <b>Exchange corner</b> to swap items you are sitting on for ones you need. <b>Move lab</b> picks it back up if you want it elsewhere. You earn it from the lifetime mission <b>Reach level 7 and register 70 creatures</b>.` }),
        el('li', { html: `<b>Rare Incense</b> is the hardest one to come by: a <b>${pct(raidRareIncenseChance(RAID_BONUS_RARITIES[0]))}</b> drop from rarity ${RAID_BONUS_RARITIES.join(' and ')} raids, a handful of missions, and one <b>every level from player level ${RARE_INCENSE_FROM_LEVEL}</b> onwards.` }),
        el('li', { html: `<b>Shiny Incense</b> spawns creatures on the same rhythm and at the same wild odds as a plain Incense, but pins the shiny rate to a flat <b>${pct(SHINY_INCENSE_ODDS)}</b> for everything you catch or hatch while it runs. Because it <b>replaces</b> the normal odds it does not stack with a <b>Shiny Bonanza</b>. It comes from <b>Exclusive Raids</b> (a <b>${pct(EXCLUSIVE_RAID_REWARD.shinyIncenseChance)}</b> chance per win) and a few missions.` })
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
        el('li', { html: `Buff moves raise one of your own stats immediately, and stack if you use them again. A <b>${RARITY_NAMES[MYTHICAL_RARITY]}</b>'s buff move raises <b>several stats at once</b> — the log names each one and the total it is now up by.` }),
        el('li', { html: `Some moves do <b>more than damage</b>. A move can <b>heal the creature using it</b> by a set number of HP, <b>raise its own</b> Attack, Defence or Speed, <b>lower the opponent's</b>, or even <b>lower its own</b> as the price of a heavy hit. These ride <b>on top of the damage</b> where the move has any, so a move can hit for 20 and heal 40 in the same turn — the log gives each part its own line.` }),
        el('li', { html: 'A stat can be pushed down as well as up, and the two cancel out: a lowered stat lasts for the rest of the fight unless something raises it again. Nothing can be ground below <b>1</b>, so a pile of debuffs never leaves a creature doing literally nothing.' }),
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
      el('h4', { text: 'Held items' }),
      el('p', { html: `A creature can carry <b>one held item</b>. They live in their own <b>Held items</b> tab in your Storage, and most only suit part of your roster — the tab and the creature's own slot both say why something is greyed out.` }),
      el('ul', {},
        el('li', { html: `<b>Gems, Shields and Cogs</b> — one per type, and only that type can hold one. <b>+10 Attack</b>, <b>+10 Defence</b> and <b>+10 Speed</b> respectively. Every stat figure here is added <b>after level growth</b>, so it is worth the same at level 1 as at level ${MAX_CREATURE_LEVEL}.` }),
        el('li', { html: 'A <b>Miracle Coin</b> turns a knockout into a survival at <b>1 HP</b>, but only from <b>full health</b>. Already hurt and it dies like anything else.' }),
        el('li', { html: 'A <b>Growth Crystal</b> is <b>+20 HP</b> for a <b>Stage 2</b> creature, and returns itself to your storage if that creature evolves. A <b>Strength Sigil</b> is <b>+20 Attack</b> from <b>level 8</b>.' }),
        el('li', { html: `<b>Consumables</b> cannot be taken back off. A <b>Breeding Amulet</b> on <b>both</b> halves of a breeding pair halves the wait per candy, and both are spent once that pair has made its ${BREEDING_CANDY_CAP}. A <b>Candy Pouch</b> halves your <b>buddy's</b> walk and is spent on the next candy it earns.` }),
        el('li', { html: `Beating a <b>raid</b> can drop one: ${HELD_ITEM_RAID_CHANCE.map((b, i) => {
          const from = i === 0 ? 3 : HELD_ITEM_RAID_CHANCE[i - 1].maxLevel + 1;
          return `<b>${pct(b.chance)}</b> at boss level ${from}–${b.maxLevel}`;
        }).join(' · ')}. When one drops it is a <b>${pct(HELD_ITEM_CONSUMABLE_CHANCE)}</b> chance of a consumable and otherwise one of the rest.` }),
        el('li', { html: 'The weekly <b>Log in to the game this week</b> mission pays a <b>random</b> one, so there is always at least one a week.' }),
        el('li', { html: 'A creature carrying something <b>announces it</b> as it takes the field in a battle, and releasing a creature hands its item back rather than destroying it.' })
      ),
      el('h4', { text: 'Abilities' }),
      el('p', { html: `Some creatures carry an <b>ability</b>: a permanent trait that makes them hit harder, or hold up better, whenever a particular condition is true — and does nothing at all when it is not. <b>${DB.abilities.size}</b> creatures have one so far. Filter your <b>Collection</b> by <b>Ability</b> to see which, and tap the <b>✦</b> button on a creature to read it.` }),
      el('ul', {},
        el('li', { html: 'A condition can be about your <b>opponent</b> — its type, stage, rarity or set — or about the <b>world</b>: temperature, cloud cover, humidity, wind, the time of day, the day of the week, the month, or whether it is <b>day or night</b> where you are.' }),
        el('li', { html: 'One ability can hold <b>several conditions</b>, sometimes opposite ones: dealing more damage in the cold and less in the heat, for instance.' }),
        el('li', { html: 'Choosing a team, each tile shows a <b>✦</b> when that creature\'s ability <b>will</b> apply in this battle and a <b>✧</b> when it has one that <b>will not</b>. Nothing means no ability. Sorting by <b>Ability in this battle</b> brings the useful ones to the front — the picker already knows the opposing side, the weather and the clock.' }),
        el('li', { html: 'Abilities are read out as a creature <b>takes the field</b> and again whenever a <b>new opponent</b> steps up, so an opponent-based one can switch on part-way through a grunt battle. The log says whether it triggered, and why.' }),
        el('li', { html: `Several conditions firing at once <b>multiply</b>, and the total is capped between <b>${ABILITY_MULTIPLIER_MIN}×</b> and <b>${ABILITY_MULTIPLIER_MAX}×</b>.` }),
        el('li', { html: 'The weather-based ones need a <b>weather reading</b>. Without one they do not fire — the game never guesses the conditions.' })
      ),
      el('h4', { text: 'After the battle' }),
      el('ul', {},
        el('li', { html: 'Damage is kept, including if you <b>leave part-way through</b> — you will be asked to confirm first. A hurt creature needs a <b>Potion</b>, a fainted one needs a <b>Revive</b>. You can heal and revive from the team picker without leaving the battle.' }),
        el('li', { html: `Every raid win always gives ${itemListLine(RAID_REWARD.always)}. Every grunt always gives healing supplies: ${GRUNT_ITEM_DROPS.map(d => `<b>${d.weight}%</b> ${Object.entries(d.items).map(([id, n]) => `${n} ${itemName(id, n)}`).join(' + ')}`).join(' · ')}.` }),
        el('li', { html: `Both a <b>raid</b> win and a <b>grunt</b> win then flip a coin for a <b>${itemName('full_heal')}</b> — <b>${pct(WIN_FULL_HEAL_CHANCE)}</b> each time, rolled separately for each win.` }),
        el('li', { html: `A grunt win also rolls separately for each of these: ${GRUNT_REWARD.extras.map(x => `<b>${pct(x.chance)}</b> a ${itemName(x.item)}`).join(' · ')}. The rolls are independent, so one win can pay both, either or neither.` }),
        el('li', { html: `Beat a raid boss and you can catch it with an <b>Ultra Capture Disc</b> — it arrives at level ${RAID_CAPTURE_LEVEL} with two bonus candy.` }),
        el('li', { html: `A raid boss is no ordinary creature: <b>×${RAID_BOSS_MODIFIERS.hp} HP</b>, and <b>+${Math.round((RAID_BOSS_MODIFIERS.attack - 1) * 100)}%</b> Attack, Defence and Speed.` }),
        el('li', { html: `A rarity ${[1, 2, 3].join(', ')} raid win has a <b>${pct(RAID_REWARD.incubatorChance)}</b> chance of dropping a <b>Single Use Incubator</b>.` }),
        el('li', { html: `Beat a <b>${RAID_BONUS_RARITIES.map(r => RARITY_NAMES[r]).join('</b> or <b>')}</b> raid (rarity ${RAID_BONUS_RARITIES.join(' and ')}) and that <b>Single Use Incubator is guaranteed</b> — no roll. Those two tiers also carry a <b>${pct(raidRareIncenseChance(RAID_BONUS_RARITIES[0]))}</b> chance of a <b>Rare Incense</b> on top, which no other raid drops.` }),
        el('li', { html: `Stardust from a raid scales hard with the boss rarity: ${Object.entries(RAID_TIERS).map(([r, t]) => `<b>${RARITY_NAMES[r]}</b> ${num(t.dust[0])}–${num(t.dust[1])}`).join(' · ')}. Your player level is added on top, and it doubles on ${STARDUST_SUNDAY_LABEL}.` }),
        el('li', { html: `A grunt pays <b>${num(GRUNT_REWARD.dust[0])}–${num(GRUNT_REWARD.dust[1])}</b> stardust, again plus your player level.` }),
        el('li', { html: 'Lose and you can retry as many times as you like until the timer runs out.' }),
        el('li', { html: 'Start a battle before the point expires and you can finish it even if the timer runs out mid-fight.' })
      ),
      el('h4', { text: 'Exclusive Raids' }),
      el('p', { html: `A point with a <b>blue flame</b> instead of the orange one is an <b>Exclusive Raid</b>. It holds a creature from the <b>${EXCLUSIVE_SET_NAME}</b> collection — ${DB.exclusiveInPlay.length} creatures that cannot be caught in the wild, from an incense, or from a 5 or 10 km egg. They turn up at <b>${o.exraid}%</b> per point on weekdays and <b>${ow.exraid}%</b> at weekends.` }),
      el('ul', {},
        el('li', { html: `Only rarities <b>3, 4 and 5</b> exist here: <b>${EXCLUSIVE_RAID_WEIGHTS[3]}%</b> rarity 3, <b>${EXCLUSIVE_RAID_WEIGHTS[4]}%</b> rarity 4 and <b>${EXCLUSIVE_RAID_WEIGHTS[5]}%</b> rarity 5.` }),
        el('li', { html: `The boss is tougher than a normal raid of the same rarity: <b>×${EXCLUSIVE_RAID_BOSS_MODIFIERS.hp} HP</b> instead of ×${RAID_BOSS_MODIFIERS.hp}, and <b>+${Math.round((EXCLUSIVE_RAID_BOSS_MODIFIERS.attack - 1) * 100)}%</b> Attack, Defence and Speed instead of +${Math.round((RAID_BOSS_MODIFIERS.attack - 1) * 100)}%.` }),
        el('li', { html: 'Catching works exactly the same — you still need an <b>Ultra Capture Disc</b>.' }),
        el('li', { html: `XP and stardust match the equivalent normal raid tier, and every normal raid drop still applies. On top of that there is a <b>${pct(EXCLUSIVE_RAID_REWARD.shinyIncenseChance)}</b> chance of a <b>Shiny Incense</b> and a separate <b>${pct(EXCLUSIVE_RAID_REWARD.eggChance)}</b> chance of a <b>15 km egg</b>. The two rolls are independent, so one win can pay both.` }),
        el('li', { html: 'An exclusive win counts towards the ordinary raid missions <i>and</i> its own set of Exclusive Raid missions, so they progress together.' })
      )
    );
  }

  if (tab === 'growing') {
    out.push(
      el('h4', { text: 'Stats' }),
      el('p', { html: `Every creature has HP, Attack, Defence and Speed. Each level adds <b>${Math.round(STAT_GROWTH_PER_LEVEL * 100)}% of the base stat</b>, counted from the base rather than compounding. Every creature you catch also gets a <b>stat modifier</b>: one stat is 10% higher (▲) and another 10% lower (▼).` }),
      el('p', { html: `The <b>last two levels are worth more</b>. At levels <b>${HIGH_GROWTH_FROM_LEVEL}</b> and <b>${MAX_CREATURE_LEVEL}</b> each level adds <b>${Math.round(HIGH_STAT_GROWTH_PER_LEVEL * 100)}%</b> of the base stat instead of ${Math.round(STAT_GROWTH_PER_LEVEL * 100)}%, across <b>all four stats</b>. It is still measured against the <b>base</b> stat, so a level ${MAX_CREATURE_LEVEL} creature sits at <b>×${statGrowthFor(MAX_CREATURE_LEVEL).toFixed(1)}</b> its base figures rather than ×${(1 + STAT_GROWTH_PER_LEVEL * (MAX_CREATURE_LEVEL - 1)).toFixed(1)} — the extra is not compounded on top of level ${HIGH_GROWTH_FROM_LEVEL}.` }),
      el('h4', { text: 'The Research Lab and Stat Boosters' }),
      el('p', { html: `Spare candy from creatures you will never level up has somewhere to go. The <b>Research Lab</b> — earned from the lifetime mission <b>Reach level 7 and register 70 creatures</b> — is pinned to the map, like a Breeding Centre, and turns candy into <b>Stat Boosters</b>.` }),
      el('ul', {},
        el('li', { html: `The price depends on the <b>rarity of the family whose candy you spend</b>, because commons are far easier to come by: ${
          Object.keys(STAT_BOOSTER_CANDY_COST)
            .map(Number).sort((a, b) => a - b)
            .map(r => `<b>${RARITY_NAMES[r]}</b> ${statBoosterCost(r)}`).join(' · ')
        } candy per booster.` }),
        el('li', { html: 'Tap the lab, choose <b>Stat Booster</b>, and you get every family you have enough candy for. Pick one, set how many with <b>−</b> and <b>+</b>, and confirm. The candy goes, the boosters land in your Items.' }),
        el('li', { html: 'A booster is <b>not tied to the candy that made it</b>. Spend Common candy and use the booster on your Legendary if you like.' }),
        el('li', { html: `Using one: tap it in Items, pick a creature, then pick <b>HP</b>, <b>Attack</b>, <b>Defence</b> or <b>Speed</b>. You see the stat now and what it becomes before you commit.` }),
        el('li', { html: `The <b>+1 is permanent and flat</b>. It is added after the stat modifier and after level growth, so it never gets multiplied — +1 today is still +1 at level 10, and it survives evolving.` }),
        el('li', { html: `One creature can take <b>${MAX_STAT_BOOSTS}</b> boosts in total across all four stats. Eight into Attack and twelve into Defence and that creature is finished; the sheet shows how many are left.` }),
        el('li', { html: 'Grunt battles also drop them occasionally, so you can get started before the lab.' }),
        el('li', { html: 'Pinned it somewhere you have stopped visiting? <b>Move lab</b> puts it back in your Items so you can place it again anywhere. The lab holds nothing, so there is never anything to collect first.' })
      ),
      el('h4', { text: 'The Exchange corner' }),
      el('p', { html: 'The lab\'s second counter trades <b>items</b> rather than candy, for when you are drowning in Potions and out of discs. Tap the lab, then <b>Exchange corner</b>, pick what you are handing over, pick what you want back, and set how many trades with <b>−</b> and <b>+</b>.' }),
      el('ul', {},
        ...ITEM_EXCHANGES.map(d => el('li', {
          html: `<b>${d.cost} ${itemName(d.from, d.cost)}</b> → ${
            d.to.map(t => `${t.qty} ${itemName(t.item, t.qty)}`).join(' or ')}`
        })),
        el('li', { html: 'The rate is <b>always in the lab\'s favour</b> — six or three in, one or two out. That is the point: it clears a shelf you are never going to use, it does not manufacture discs.' }),
        el('li', { html: 'Trades are <b>all or nothing</b>. If you cannot cover the full amount the button will not let you, so you never hand items over for a part payment.' })
      ),
      el('h4', { text: 'Levelling up' }),
      el('p', { html: `Costs stardust <i>and</i> candy of that creature's family — from ${CANDY_ICON} ${CREATURE_LEVEL_COST[2].candy} + ${DUST_ICON} ${num(CREATURE_LEVEL_COST[2].stardust)} for level 2 up to ${CANDY_ICON} ${CREATURE_LEVEL_COST[MAX_CREATURE_LEVEL].candy} + ${DUST_ICON} ${num(CREATURE_LEVEL_COST[MAX_CREATURE_LEVEL].stardust)} for level ${MAX_CREATURE_LEVEL}.` }),
      el('h4', { text: 'Moves' }),
      el('p', { html: `Creatures learn up to four moves as they level. When you catch one there is a chance it learns its third or fourth move <b>one or two levels early</b> — your storage spells out exactly when. Some moves only arrive after evolving.` }),
      el('p', { html: `Most <b>buff</b> moves raise a single stat. A <b>${RARITY_NAMES[MYTHICAL_RARITY]}</b>'s raises <b>more than one at the same time</b>, for the same percentage each — Astralyon's <b>Extreme Growth</b> lifts Attack, Defence and Speed together. The move list on a creature spells out which stats a buff touches.` }),
      el('h4', { text: 'Candy and evolving' }),
      el('p', { html: `Candy belongs to a <b>family</b>, not a single creature, so catching the Stage 1 form feeds every evolution. Releasing a creature returns 1 candy to its family. Evolving keeps the level, the shiny status and the early-move luck.` }),
      el('h4', { text: 'Stardust' }),
      el('p', { html: `Shared across everything. Every player level you gain adds <b>+${DUST_BONUS_PER_PLAYER_LEVEL}</b> to every stardust reward, and a Stardust Magnet adds <b>+${RULES.MAGNET_BONUS_MULTIPLIER} per player level</b> on every catch while it runs.` }),
      el('h4', { text: 'Your own level' }),
      el('p', { html: `XP comes from catching, hatching, evolving, raids, grunts and missions, up to player level <b>${MAX_PLAYER_LEVEL}</b>. Every level pays out, and the rewards grow as you climb.` }),
      el('ul', {},
        el('li', { html: `<b>Every level:</b> ${itemListLine(LEVEL_UP_REWARDS.every)}.` }),
        // Read straight off the reward tiers, so a new one appears here on its own.
        ...levelUpTiers().map(t => el('li', {
          html: `<b>From level ${t.from} onwards:</b> ${itemListLine(t.table)} as well, on top of the usual haul — every level, not just the once.`
        })),
        ...Object.entries(LEVEL_UP_REWARDS.special)
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([lvl, table]) => el('li', { html: `<b>Level ${lvl}:</b> ${itemListLine(table)}.` })),
        el('li', { html: 'Jump two levels at once and you are paid for both.' }),
        el('li', { html: `Reaching <b>${MAX_PLAYER_LEVEL}</b> takes <b>${num(PLAYER_LEVEL_XP[MAX_PLAYER_LEVEL])} XP</b> in total. The steps get steeper as you go: level ${MAX_PLAYER_LEVEL} alone asks for <b>${num(playerLevelStep(MAX_PLAYER_LEVEL - 1))}</b> more than level ${MAX_PLAYER_LEVEL - 1} did.` })
      ),
      el('h4', { text: 'Breeding centre' }),
      el('p', { html: `From player level <b>${BREEDING_UNLOCK_LEVEL}</b> you can pin a breeding centre anywhere, and pick it back up later if you want it somewhere else. You can place <b>as many as you own</b>, and each one has its <b>own full set of slots</b>. Leave two creatures of the same species in a slot and they generate that family's candy (every 12 h for common and uncommon, up to 36 h for legendary), stopping at <b>${BREEDING_CANDY_CAP}</b>. They cannot battle until you collect them back from the centre itself.` }),
      el('ul', {},
        el('li', { html: 'Tap an empty slot and your whole storage opens, with the <b>same sorting and pages</b> you use in Storage. Pick any two creatures, then <b>Confirm pair</b>.' }),
        el('li', { html: 'They have to be <b>two of the same creature</b>. Pick a mismatched pair and it tells you so and holds the Confirm button until you fix it.' }),
        el('li', { html: 'Your <b>buddy</b> is left out of the list, because breeding would stop it doing the walking, levelling and battling a buddy is for.' }),
        el('li', { html: `A pair stops at <b>${BREEDING_CANDY_CAP} candy</b> and then sits there earning nothing, so the map pin grows a <b>gold pip</b> the moment any slot is full — with a number on it if more than one is. The slot is highlighted and marked <b>FULL</b> inside the sheet too.` }),
        el('li', { html: 'Placed it badly? <b>Move centre</b> returns it to your Items so you can pin it somewhere else — or fetch it from <b>Buildings</b> in your Items without walking back to it. Pairs inside come home either way, but <b>any candy they have earned is lost</b>, so collect them first if you can. You are told how much is at stake before you confirm.' }),
        el('li', { html: `Every centre you place has the <b>same number of slots</b>, so a second one doubles how many pairs you can have going. The slot count itself still comes from your player level: ${
          Object.entries(BREEDING_SLOTS_BY_LEVEL).map(([lvl, n]) => `<b>${n}</b> at level ${lvl}`).join(' · ')
        }.` })
      )
    );
  }

  if (tab === 'soon') {
    out.push(
      el('p', { html: 'A lot of exciting new features are coming soon to the game!' }),
      el('h4', { text: 'More mythicals' }),
      el('p', { html: `<b>Astralyon</b> is the first <b>Mythical</b>, rarity ${MYTHICAL_RARITY}, and more will follow. Each will have its own way of being found, and like Astralyon their buff moves raise several stats at once.` }),
      el('h4', { text: 'More exclusive creatures' }),
      el('p', { html: `The <b>${EXCLUSIVE_SET_NAME}</b> roster is growing. New creatures are on the way that can only be met through <b>Exclusive Raids</b> and the <b>15 km eggs</b> they drop, so the blue flame stays worth chasing.` }),
      el('h4', { text: 'Fossils' }),
      el('p', { html: '<b>Fossils are coming.</b> Collect their <b>fragments</b> and take them to a specialist to have the creature inside <b>revived</b>.' }),
      el('h4', { text: 'Battle Frontier' }),
      el('p', { html: 'A new building called the <b>Battle Frontier</b> will open up new ways to battle, beyond the raids and grunts you meet on the map. More on how it works closer to the time.' }),
      el('h4', { text: 'More abilities' }),
      el('p', { html: 'Abilities are only getting started. More are coming to <b>creatures that do not have one yet</b>, and to <b>creatures that already do</b> — so it is worth checking the Ability filter in your Collection after an update.' }),
      el('h4', { text: 'The next set' }),
      el('p', { html: `With <b>${SET_NAME}</b> and <b>${GALACTIC_SET_NAME}</b> both in play, work has started on what comes after. Filling in a set is what opens the next one, so a full Collection is never wasted effort.` }),
      el('p', { html: 'Their <b>moves will do more than raw damage or a buff to their own stats</b>. Expect moves that <b>heal the creature using them</b>, and moves that <b>weaken the opponent</b> rather than strengthening yourself.' }),
      el('p', { html: 'Some of them will not simply turn up on the map either: a few will only be found under <b>specific conditions</b> — on <b>certain days of the week</b>, or in <b>certain weather</b>. The 🌡 chip in the top bar is going to start earning its keep.' })
    );
  }

  body.append(...out.filter(Boolean));
}

