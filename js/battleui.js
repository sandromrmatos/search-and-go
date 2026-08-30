/* ============================================================
   battleui.js — the battle screen: preview, team pick, fight, result

   Shared by raids (1 boss) and battle grunts (3 creatures).
   ============================================================ */

import {
  species, RARITY_NAMES, STAT_LABELS, BATTLE_TEAM_SIZE, familyName,
  statsFor, raidBossStats, RAID_CAPTURE_LEVEL, raidModifiers, EXCLUSIVE_RAID_REWARD,
  eggLabel, buffMoveText, moveEffectText, moveSummaryText,
  abilityOutlook, abilityOutlookLabel, heldItemImage, abilityText,
  rollShiny, heldItem, heldStatBonus, totalBoosts,
  FRONTIER_GRAND_LABEL, FRONTIER_LEVELS, frontierTeam, frontierTrainerImage,
  frontierLevelRewards, frontierMode, frontierModeAllows, frontierChallenge
} from './data.js';

/** "+50%" style label straight from the raid modifier table. */
const bossPct = (key, exclusive = false) =>
  `+${Math.round((raidModifiers(exclusive)[key] - 1) * 100)}%`;
import { store, creatureStats, maxHpOf, hpOf, isFainted } from './state.js';
import { sortedForPicker, setAbilityRanker } from './views.js';
import {
  Battle, buildRaidBattle, buildGruntBattle, buildFrontierBattle,
  battlerFromEnemySpec, battleEnv
} from './battle.js';
import { itemImage, itemName } from './items.js';
import { playCapture } from './anim.js';
import {
  $, $$, el, toast, num, sleep,
  clampPage, pageSlice, pagerBar, wireSwipe, bumpEl
} from './ui.js';

const CANDY_ICON = '🍬';
const DUST_ICON = '✨';

const GRUNT_FACE = {
  young_man: '🧑', young_woman: '👩', adult_man: '👨', adult_woman: '👩‍🦰'
};

/* Current session state for the open battle. */
let ctx = null;
let onFinished = null;
let busy = false;

/* ---------------------------------------------------------------
   Open / close
   --------------------------------------------------------------- */

export function initBattleUI({ onDone } = {}) {
  onFinished = onDone;
  $$('#battle [data-bt-close]').forEach(b => b.addEventListener('click', closeBattle));
  $('#bt-start').addEventListener('click', showPicker);
  $('#bt-fight').addEventListener('click', startFight);
  $('#bt-fight-top').addEventListener('click', startFight);
  $('#bt-clear').addEventListener('click', () => { ctx.picked = []; renderPicker(); });
  $('#bt-done').addEventListener('click', closeBattle);
  // "Try again" has to go back to whatever kind of fight this was. A Frontier
  // level and a Grand Raid have no map point to re-open.
  $('#bt-again').addEventListener('click', () => {
    if (!ctx) return;
    if (ctx.kind === 'frontier') {
      const { challengeId, level, modeId } = ctx.frontier;
      openFrontierBattle({ challengeId, level, modeId });
    } else if (ctx.grand) {
      openFrontierGrand({ ...ctx.grand });
    } else {
      openBattle(ctx.point);
    }
  });
  $('#bt-catch').addEventListener('click', throwUltraDisc);
  // Sorting is shared with Storage, so changing it here changes it there too.
  // A new order makes the old page number meaningless, so go back to page 1.
  $('#bt-sort').addEventListener('change', e => {
    store.setUI({ storageSort: e.target.value });
    pickPage = 0;
    renderPicker();
  });
  $('#bt-dir').addEventListener('click', () => {
    store.setUI({ storageDir: store.s.ui.storageDir > 0 ? -1 : 1 });
    pickPage = 0;
    renderPicker();
  });
}

/** Entry point: show the preview for a raid or grunt point. */
export function openBattle(point) {
  ctx = {
    point,
    kind: point.kind,
    raid: point.raid || null,
    grunt: point.grunt || null,
    picked: [],
    battle: null,
    result: null
  };
  step('preview');
  renderPreview();
  $('#battle').classList.remove('hidden');
}

/**
 * A Battle Frontier trainer battle. No map point is involved — the fight comes
 * out of the building rather than the world — so `ctx.point` stays null and
 * everything that used to assume a point is guarded.
 *
 * `restrict` is the mode id, and it is what narrows the team picker.
 */
export function openFrontierBattle({ challengeId, level, modeId, onClose = null }) {
  const state = store.frontierChallengeState(challengeId, modeId);
  const team = frontierTeam(challengeId, level);
  if (!state || !team) { toast('That challenge level is not available', 'bad'); return; }

  ctx = {
    point: null,
    kind: 'frontier',
    raid: null,
    grunt: null,
    frontier: { challengeId, level, modeId, team },
    restrict: modeId,
    onClose,
    picked: [],
    battle: null,
    result: null
  };
  step('preview');
  renderPreview();
  $('#battle').classList.remove('hidden');
}

/**
 * The Grand Raid Challenge at the top of a cleared ladder. Deliberately opened
 * as `kind: 'raid'`: the boss modifiers, the shiny roll, the reward table and the
 * Ultra Disc catch are all the exclusive raid ones, and reusing that path means
 * none of it needed a second implementation. The only additions are the mode
 * restriction on the team and the win being recorded against the challenge.
 */
export function openFrontierGrand({ challengeId, modeId, onClose = null }) {
  const raid = store.frontierGrandFor(challengeId, modeId);
  if (!raid) { toast('That Grand Raid Challenge is not open', 'bad'); return; }

  ctx = {
    point: null,
    onClose,
    kind: 'raid',
    raid: {
      ...raid,
      // Rolled here rather than on a map point, on the ordinary raid odds, so a
      // shiny boss is visible before the fight exactly as it is in a raid.
      shiny: store.s.debug.shinyBoost ? Math.random() < 0.5 : rollShiny('raid', new Date(), store.shinyOpts()),
      defeated: false
    },
    grunt: null,
    grand: { challengeId, modeId },
    restrict: modeId,
    picked: [],
    battle: null,
    result: null
  };
  step('preview');
  renderPreview();
  $('#battle').classList.remove('hidden');
}

/**
 * Leaving mid-fight used to throw the damage away, so creatures came back to
 * storage untouched. Now it confirms, then writes the current HP out.
 */
export function closeBattle() {
  endPeek();
  if (busy) return;

  const b = ctx?.battle;
  const midFight = b && !b.over;
  if (midFight) {
    const hurt = b.playerResults().filter(r => {
      const c = store.creature(r.uid);
      return c && r.hp < maxHpOf(c);
    }).length;
    const warning = hurt
      ? `Leave the battle?\n\n${hurt} of your creatures will keep the damage they have taken. Fainted ones stay fainted until you use a Revive.`
      : 'Leave the battle?\n\nAny damage your creatures have taken will be kept.';
    if (!confirm(warning)) return;
    store.applyBattleDamage(b.playerResults());
  }

  $('#battle').classList.add('hidden');
  // A Frontier fight was opened from inside a sheet rather than from the map, so
  // it hands back to whatever opened it — otherwise closing the battle would
  // drop the player on the map instead of back in the building.
  const after = ctx?.onClose || null;
  ctx = null;
  // The ability sort goes back to its plain "has one at all" meaning, since
  // there is no longer a battle to judge relevance against.
  outlookCache = new Map();
  setAbilityRanker(null);
  onFinished?.();
  after?.();
}

function step(name) {
  for (const id of ['preview', 'pick', 'arena', 'result']) {
    $('#bt-' + id).classList.toggle('hidden', id !== name);
  }
}

/** The challenge definition behind a Frontier fight, whichever way it was opened. */
const frontierChallengeOf = c => {
  const id = c?.frontier?.challengeId || c?.grand?.challengeId;
  return id ? frontierChallenge(id) : null;
};

/* ---------------------------------------------------------------
   Step 1: preview
   --------------------------------------------------------------- */

function renderPreview() {
  const body = $('#bt-preview-body');
  body.innerHTML = '';

  if (ctx.kind === 'raid') {
    const raid = ctx.raid;
    const sp = species(raid.speciesId);
    const exclusive = !!raid.exclusive;
    const stats = raidBossStats(sp, raid.level, exclusive);
    const mods = raidModifiers(exclusive);
    $('#bt-title').textContent = exclusive
      ? `Rarity ${raid.rarity} Exclusive Raid`
      : `Rarity ${raid.rarity} Raid`;

    body.append(
      el('div', { class: `bt-boss${exclusive ? ' exclusive' : ''}` },
        el('img', { src: sp.spritePath(raid.shiny), alt: sp.name }),
        raid.shiny ? el('div', { class: 'new-banner', text: '★ SHINY' }) : null,
        el('h3', { text: sp.name }),
        el('div', { class: 'reveal-tags' },
          exclusive ? el('span', { class: 'tag tag-exclusive', text: '💠 Exclusive' }) : null,
          el('span', { class: `tag t-${sp.type}`, text: sp.type }),
          el('span', { class: 'tag', text: `Level ${raid.level}` }),
          el('span', { class: `tag r-${raid.rarity}`, text: `${raid.rarity} · ${RARITY_NAMES[raid.rarity]}` })
        ),
        !store.isRegistered(sp.id)
          ? el('div', { class: 'not-registered-badge', text: 'Not registered yet' })
          : null
      ),
      exclusive
        ? el('p', { class: 'hint', text: 'An Exclusive Raid. This creature cannot be found any other way, and the boss hits harder than a normal raid of the same rarity.' })
        : null,
      el('div', { class: 'det-rows' },
        statLine('HP', stats.hp, `×${mods.hp} for a raid`),
        statLine('Attack', stats.attack, bossPct('attack', exclusive)),
        statLine('Defence', stats.defence, bossPct('defence', exclusive)),
        statLine('Speed', stats.speed, bossPct('speed', exclusive))
      ),
      el('h4', { class: 'sheet-h4', text: 'If you win' }),
      el('div', { class: 'rewards' },
        el('span', { class: 'reward' }, el('span', { text: '⭐' }), el('span', { text: `+${raid.xp} XP` })),
        el('span', { class: 'reward' }, el('span', { text: DUST_ICON }),
          el('span', { text: `+${raid.dustRange[0]}–${raid.dustRange[1]} stardust` })),
        exclusive
          ? el('span', { class: 'reward' }, el('span', { text: '✨' }),
            el('span', { text: `${Math.round(EXCLUSIVE_RAID_REWARD.shinyIncenseChance * 100)}% a Shiny Incense` }))
          : null,
        exclusive
          ? el('span', { class: 'reward' }, el('span', { text: '🥚' }),
            el('span', { text: `${Math.round(EXCLUSIVE_RAID_REWARD.eggChance * 100)}% a 15 km egg` }))
          : null
      ),
      ultraDiscNotice()
    );
    // A Grand Raid says which ladder it came out of and that it is the only way
    // to meet this creature, since neither is obvious from a raid screen.
    if (ctx.grand) {
      const ch = store.frontierChallengeState(ctx.grand.challengeId, ctx.grand.modeId);
      body.insertBefore(
        el('p', { class: 'hint' },
          el('b', { text: `${FRONTIER_GRAND_LABEL}. ` }),
          `You cleared all ${FRONTIER_LEVELS} levels of the ${ch?.challenge.name} challenge `
          + `on ${ch?.mode.label}. ${species(ctx.raid.speciesId).name} cannot be found any other `
          + 'way — not from a raid, not from an egg. Beat the same challenge on a different mode '
          + 'to face it again.'),
        body.firstChild.nextSibling);
    }
  } else if (ctx.kind === 'frontier') {
    renderFrontierPreview(body);
  } else {
    const g = ctx.grunt;
    $('#bt-title').textContent = 'Battle Grunt';
    body.append(
      el('div', { class: 'bt-boss grunt' },
        el('div', { class: 'bt-grunt-face', text: GRUNT_FACE[g.character] || '🧍' }),
        el('h3', { text: g.characterLabel || 'Battle Grunt' })
      ),
      el('p', { class: 'bt-quote', text: `“${g.phrase}”` }),
      el('h4', { class: 'sheet-h4', text: 'Their team' }),
      el('div', { class: 'bt-roster' }, ...g.team.map(t => {
        const sp = species(t.speciesId);
        const st = statsFor(sp, t.level, null);
        return el('div', { class: 'cell' },
          el('span', { class: 'lvl', text: 'Lv' + t.level }),
          el('img', { src: sp.imagePath, alt: sp.name, loading: 'lazy' }),
          el('span', { class: 'nm', text: sp.name }),
          el('span', { class: `sub t-${sp.type}`, text: sp.type }),
          el('span', { class: 'sub', text: `${st.hp} HP` })
        );
      })),
      el('h4', { class: 'sheet-h4', text: 'If you win' }),
      el('div', { class: 'rewards' },
        el('span', { class: 'reward' }, el('span', { text: DUST_ICON }),
          el('span', { text: '+50–75 stardust' })),
        el('span', { class: 'reward' }, el('span', { text: '🎁' }),
          el('span', { text: 'small chance of an Incense or Magnet' }))
      )
    );
  }

  // Under a mode restriction only the creatures that mode allows count towards
  // "do you have a team at all", so the button never invites you into a picker
  // you cannot fill.
  const ready = ctx.restrict
    ? store.frontierEligible(ctx.restrict).length
    : store.battleReady().length;
  const btn = $('#bt-start');
  btn.disabled = ready < BATTLE_TEAM_SIZE;
  btn.textContent = ready < BATTLE_TEAM_SIZE
    ? (ctx.restrict
      ? `Need ${BATTLE_TEAM_SIZE} that fit this mode (you have ${ready})`
      : `Need ${BATTLE_TEAM_SIZE} healthy creatures (you have ${ready})`)
    : 'Choose your team';
}

/**
 * The trainer, their three creatures and what the level pays. The team is shown
 * in full — level, held item and boosts — because the mode restriction means
 * the player has to plan around it rather than just bring their best three.
 */
function renderFrontierPreview(body) {
  const { challengeId, level, modeId, team } = ctx.frontier;
  const state = store.frontierChallengeState(challengeId, modeId);
  const ch = state.challenge;
  $('#bt-title').textContent = `${ch.name} challenge · Level ${level}`;

  const { items, heldItem: paysHeld } = frontierLevelRewards(level);

  body.append(
    el('div', { class: 'bt-boss frontier' },
      el('img', { src: frontierTrainerImage(challengeId), alt: ch.trainerName }),
      el('h3', { text: ch.trainerName }),
      el('div', { class: 'reveal-tags' },
        el('span', { class: `tag t-${ch.type}`, text: `${ch.name} only` }),
        el('span', { class: 'tag', text: `Level ${level} of ${FRONTIER_LEVELS}` }),
        el('span', { class: 'tag', text: state.mode.label })
      )
    ),
    el('p', { class: 'bt-quote', text: `"${ch.phrase}"` }),
    el('p', { class: 'hint' }, el('b', { text: 'Your restriction. ' }), state.mode.blurb),
    el('h4', { class: 'sheet-h4', text: 'Their team' }),
    el('div', { class: 'bt-roster' }, ...team.map(t => {
      const sp = species(t.speciesId);
      const st = statsFor(sp, t.level, null, t.boosts,
        heldStatBonus({ speciesId: t.speciesId, level: t.level, held: t.held }, sp));
      const boosted = totalBoosts(t.boosts);
      const held = t.held ? heldItem(t.held) : null;
      return el('div', { class: 'cell' },
        el('span', { class: 'lvl', text: 'Lv' + t.level }),
        el('img', { src: sp.imagePath, alt: sp.name, loading: 'lazy' }),
        el('span', { class: 'nm', text: sp.name }),
        el('span', { class: `sub t-${sp.type}`, text: sp.type }),
        el('span', { class: 'sub', text: `${st.hp} HP · ${st.attack}A ${st.defence}D ${st.speed}S` }),
        held
          ? el('span', { class: 'sub frontier-held' },
            el('img', { src: heldItemImage(held.id), alt: '' }),
            el('span', { text: held.name }))
          : null,
        boosted ? el('span', { class: 'sub', text: `+${boosted} boosted` }) : null
      );
    })),
    el('h4', { class: 'sheet-h4', text: state.levels[level - 1]?.cleared ? 'Already beaten on this mode' : 'If you win' }),
    state.levels[level - 1]?.cleared
      ? el('p', { class: 'hint', text: 'You have already beaten this level on this mode, so there is '
          + 'nothing left to win here. Try it on a mode you have not used yet.' })
      : el('div', { class: 'rewards' },
        ...Object.entries(items).map(([id, n]) => el('span', { class: 'reward' },
          el('img', { src: itemImage(id), alt: '', style: { width: '18px', height: '18px', objectFit: 'contain' } }),
          el('span', { text: `+${n} ${itemName(id, n)}` }))),
        paysHeld
          ? el('span', { class: 'reward' }, el('span', { text: '◈' }),
            el('span', { text: 'a random held item' }))
          : null
      ),
    // The prize at the top of the ladder, and how close it is.
    state.boss
      ? el('p', { class: 'hint', text: state.grandWon
        ? `You have already won the ${FRONTIER_GRAND_LABEL} on ${state.mode.label}.`
        : `Clear all ${FRONTIER_LEVELS} levels on ${state.mode.label} to unlock the `
          + `${FRONTIER_GRAND_LABEL} — ${state.cleared} down, ${FRONTIER_LEVELS - state.cleared} to go.` })
      : null
  );
}

function statLine(label, value, note) {
  return el('div', { class: 'det-row' },
    el('span', { text: label }),
    el('span', { class: 'muted small', text: note }),
    el('b', { text: num(value) })
  );
}

/** Explains up front whether the boss can actually be caught. */
function ultraDiscNotice() {
  const have = store.itemCount('ultra_disc');
  if (have > 0) {
    return el('p', { class: 'hint' },
      el('b', { text: `You have ${have} Ultra Capture Disc${have === 1 ? '' : 's'}. ` }),
      'Beat the boss and you can try to catch it.');
  }
  return el('p', { class: 'hint', style: { color: '#ffd9a8' } },
    'You have no Ultra Capture Discs. You can still battle and earn the XP and stardust, ' +
    'but you will not be able to capture the boss at the end.');
}

/* ---------------------------------------------------------------
   Step 2: team picker
   --------------------------------------------------------------- */

/* ---------------------------------------------------------------
   Move preview

   Hold a creature in the team picker to see the moves it will actually bring
   into this battle; let go and you are back to choosing, with nothing selected.
   --------------------------------------------------------------- */

const PEEK_DELAY_MS = 320;
let peekTimer = null;
let peekEl = null;
/** Set while a preview is open so the release click does not also select. */
let peekConsumed = false;

function startPeek(c) {
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => showPeek(c), PEEK_DELAY_MS);
}

function endPeek() {
  clearTimeout(peekTimer);
  peekTimer = null;
  if (peekEl) {
    peekEl.remove();
    peekEl = null;
    peekConsumed = true;   // swallow the click that ends this press
  }
}

/** True once, if the press that just ended had opened a preview. */
function consumePeek() {
  const was = peekConsumed;
  peekConsumed = false;
  return was;
}

/**
 * The ability block inside a hold preview, or null when the creature has none.
 *
 * Reads the outlook cache the picker already built, so it can say whether the
 * ability will apply in *this* battle rather than describing it in the abstract.
 */
function abilityPeek(s) {
  const ability = s?.ability;
  if (!ability) return null;
  const look = outlookCache.get(s.id) || null;
  const state = look ? outlookState(look) : 'off';
  const verdict = state === 'on' ? 'applies in this battle'
    : state === 'maybe' ? 'depends on how the fight goes'
    : 'will not apply here';

  return el('div', { class: 'move-peek-ability' },
    el('div', { class: 'move-top' },
      el('b', { text: `✦ ${ability.name}` }),
      el('span', { class: `ab-badge ${state}`, text: state === 'on' ? '✦' : state === 'maybe' ? '✧?' : '✧' })
    ),
    el('div', { class: 'move-meta' },
      el('span', { class: 'bf', text: abilityText(ability) })
    ),
    el('div', { class: 'muted small', text: verdict })
  );
}

function showPeek(c) {
  const s = species(c.speciesId);
  if (!s) return;
  const st = creatureStats(c);
  const max = maxHpOf(c), hp = hpOf(c);
  // Exactly the move list battlerFromCreature will hand to the battle.
  const moves = s.movesAt(c.level, c.moveUnlock);

  peekEl?.remove();
  peekEl = el('div', { class: 'move-peek' },
    el('div', { class: 'move-peek-card' },
      el('div', { class: 'move-peek-top' },
        el('img', { src: s.spritePath(c.shiny), alt: s.name }),
        el('div', {},
          el('b', { text: s.name + (c.shiny ? ' ★' : '') }),
          el('div', { class: 'muted small', text: `Lv ${c.level} · ${s.type} · ${hp}/${max} HP` }),
          el('div', { class: 'small', text: `${st.attack} Atk · ${st.defence} Def · ${st.speed} Spd` })
        )
      ),
      moves.length
        ? el('div', { class: 'move-list' }, ...moves.map(m =>
            el('div', { class: 'move' },
              el('div', { class: 'move-top' },
                el('b', { text: m.name }),
                el('span', { class: 'lv', text: m.isStatus ? 'Status' : `${m.power} pw` })
              ),
              el('div', { class: 'move-meta' },
                m.isStatus
                  ? el('span', { class: 'bf', text: moveEffectText(m) })
                  : el('span', { class: 'pw', text: moveSummaryText(m) })
              )
            )))
        : el('p', { class: 'hint', text: 'No moves yet.' }),
      /* The ability, when it has one. Worth the space here rather than only on
         the badge: the badge says whether it applies, this says what it does, and
         both are things you want while deciding who to bring. The outlook is
         already cached for this battle, so it can also say how it stands. */
      abilityPeek(s),
      el('p', { class: 'hint', text: 'Let go to go back to choosing.' })
    )
  );
  document.body.append(peekEl);
}

// A press that ends anywhere must still close the preview.
window.addEventListener('pointerup', endPeek);
window.addEventListener('pointercancel', endPeek);

function showPicker() {
  ctx.picked = [];
  pickPage = 0;
  step('pick');
  renderPicker();
}

/* Paging for the roster, same 30-per-page rule as Storage. */
let pickPage = 0;

/* ---------------------------------------------------------------
   Which abilities matter in this battle

   The opposing side is already known while the player is choosing, and so are
   the clock and the weather, so every ability can be judged before a single
   move is made. Worked out once per render and cached by species, because a
   page of thirty creatures is often the same handful of species.
   --------------------------------------------------------------- */

let outlookCache = new Map();

/** Every species the player's team could end up facing in this battle. */
function battleOpponents() {
  if (!ctx) return [];
  if (ctx.kind === 'raid') {
    const sp = ctx.raid ? species(ctx.raid.speciesId) : null;
    return sp ? [sp] : [];
  }
  return (ctx.grunt?.team || []).map(t => species(t.speciesId)).filter(Boolean);
}

/** Rebuilds the cache for the current world. Called at the top of each render. */
function refreshOutlooks() {
  const env = battleEnv();
  const opponents = battleOpponents();
  outlookCache = new Map();
  for (const c of store.battleReady()) {
    const sp = species(c.speciesId);
    if (!sp || outlookCache.has(sp.id)) continue;
    // The whole assembled world, so an ability that reads the weather, today's
    // walk or the elevation is judged on the same figures the battle will use.
    outlookCache.set(sp.id, abilityOutlook(sp.ability, { ...env, opponents }));
  }
}

const outlookFor = c => outlookCache.get(c?.speciesId) || null;

/**
 * Sort key: fires here, then might once the fight is under way, then has one
 * that will not, then has none.
 */
/**
 * Which of the three badge states a creature is in.
 *
 * A parting shot is checked before `applies`, even though its condition reads as
 * permanently true: it only ever pays out if the creature is knocked out, so
 * calling it "applies" would promise a damage bonus that never arrives.
 */
function outlookState(look) {
  if (!look?.has) return 'none';
  if (look.onFaint || (!look.applies && look.mayApply)) return 'maybe';
  return look.applies ? 'on' : 'off';
}

/** Sort key: fires here, then might, then has one that will not, then has none. */
function outlookRank(c) {
  return { on: 3, maybe: 2, off: 1, none: 0 }[outlookState(outlookFor(c))];
}

/** The ✦ badge for a picker cell, or null when the creature has no ability. */
function abilityBadge(c) {
  const look = outlookFor(c);
  if (!look?.has) return null;
  // Three states rather than two: some abilities turn on things that have not
  // happened yet, and answering those with a confident ✧ would be a lie.
  const state = outlookState(look);
  return el('span', {
    class: 'ab-badge ' + state,
    title: abilityOutlookLabel(look),
    text: state === 'on' ? '✦' : state === 'maybe' ? '✧?' : '✧'
  });
}

function goToPickPage(page, grid = null) {
  const total = store.battleReady().length;
  const next = clampPage(page, total);
  if (next === pickPage) { if (grid) bumpEl(grid, page < 0 ? 'right' : 'left'); return; }
  pickPage = next;
  renderPicker();
}

function renderPicker() {
  const grid = $('#bt-pick-grid');
  // Work out what every ability would do in this battle before sorting, so the
  // "Ability in this battle" order and the badges agree with each other.
  refreshOutlooks();
  setAbilityRanker(outlookRank);
  // Sort the whole roster, then page it, so page 1 is the real top of the order.
  // Shares Storage's sorter and its saved choice, so the options, the order and
  // the direction toggle all behave the way they do in Storage.
  // A Frontier mode narrows the roster to what it allows. Everything below —
  // sorting, paging, the ability legend, the heal/revive bar — then works on the
  // narrowed list, so the counts on screen are the counts that matter.
  const all = sortedForPicker(ctx.restrict
    ? store.frontierEligible(ctx.restrict)
    : store.battleReady());
  pickPage = clampPage(pickPage, all.length);
  const list = pageSlice(all, pickPage);

  $('#bt-sort').value = store.s.ui.storageSort;
  $('#bt-dir').textContent = store.s.ui.storageDir > 0 ? '↑' : '↓';

  const ready = ctx.picked.length === BATTLE_TEAM_SIZE;
  $('#bt-pick-count').textContent = `${ctx.picked.length} of ${BATTLE_TEAM_SIZE} chosen`;
  $('#bt-fight').disabled = !ready;
  // The floating bar means you never have to scroll to start.
  $('#bt-ready').classList.toggle('hidden', !ready);

  const empty = $('#bt-pick-empty');
  empty.classList.toggle('hidden', all.length > 0);
  empty.textContent = ctx.restrict
    ? 'Nothing you own fits this mode right now. Try another mode, or heal and revive below.'
    : 'No creatures are fit to battle. Heal or revive them below, or catch some more.';

  renderRestrictionNote(all.length);
  renderAbilityLegend(all);
  renderPickCare();

  grid.innerHTML = '';
  for (const c of list) {
    const sp = species(c.speciesId);
    const st = creatureStats(c);
    const idx = ctx.picked.indexOf(c.uid);
    const max = maxHpOf(c), hp = hpOf(c);
    const pct = Math.round((hp / max) * 100);

    grid.append(el('button', {
      class: 'cell' + (idx >= 0 ? ' picked' : ''),
      onclick: e => {
        // A long press opened the move preview, so this click is the release of
        // that press, not a choice.
        if (consumePeek()) { e.preventDefault(); return; }
        togglePick(c.uid);
      },
      onpointerdown: () => startPeek(c),
      onpointerup: endPeek,
      onpointercancel: endPeek,
      onpointerleave: endPeek,
      // Stop the mobile long-press menu fighting the preview.
      oncontextmenu: e => e.preventDefault()
    },
      idx >= 0 ? el('span', { class: 'pick-order', text: String(idx + 1) }) : null,
      el('span', { class: 'lvl', text: 'Lv' + c.level }),
      c.shiny ? el('span', { class: 'shiny-star', text: '★' }) : null,
      c.favourite ? el('span', { class: 'fav-star', text: '♥' }) : null,
      abilityBadge(c),
      el('img', { src: sp.spritePath(c.shiny), alt: sp.name, loading: 'lazy' }),
      el('span', { class: 'nm', text: sp.name }),
      el('span', { class: `sub t-${sp.type}`, text: sp.type }),
      el('span', { class: 'hp-wrap' },
        el('span', { class: `hp-bar${pct <= 25 ? ' critical' : pct <= 60 ? ' low' : ''}` },
          el('i', { style: { width: pct + '%' } }))),
      el('span', { class: 'sub', text: `${hp} / ${max} HP` }),
      el('span', { class: 'sub', text: `${st.attack}A ${st.defence}D ${st.speed}S` })
    ));
  }

  // ---- paging ----
  let pager = $('#bt-pick-pager');
  const bar = pagerBar(pickPage, all.length, goToPickPage);
  if (!bar) {
    pager?.remove();
  } else {
    if (!pager) {
      pager = el('div', { id: 'bt-pick-pager' });
      grid.parentElement.insertBefore(pager, grid.nextSibling);
    }
    pager.innerHTML = '';
    pager.append(bar);
  }
  wireSwipe(grid, {
    onLeft: () => goToPickPage(pickPage + 1, grid),
    onRight: () => goToPickPage(pickPage - 1, grid)
  }, { key: 'pickPage' });
}

/**
 * Says out loud why the roster is shorter than usual. Without this a mode looks
 * like a bug: half your storage simply is not there.
 */
function renderRestrictionNote(eligible) {
  const host = $('#bt-restrict');
  if (!host) return;
  if (!ctx.restrict) {
    host.classList.add('hidden');
    host.innerHTML = '';
    return;
  }
  const mode = frontierMode(ctx.restrict);
  const total = store.battleReady().length;
  host.classList.remove('hidden');
  host.innerHTML = `<b>${mode?.label || 'Restricted'}.</b> ${mode?.blurb || ''} `
    + `<b>${eligible}</b> of your ${total} battle-ready creature${total === 1 ? '' : 's'} `
    + `qualif${eligible === 1 ? 'ies' : 'y'}.`;
}

/**
 * Says what the two badges mean, and only when there is a badge on screen to
 * explain. Counts across the whole roster rather than the visible page, so the
 * numbers match what sorting by ability would bring to the front.
 */
function renderAbilityLegend(all) {
  const host = $('#bt-ability-legend');
  if (!host) return;
  const withAbility = all.filter(c => outlookFor(c)?.has);
  if (!withAbility.length) {
    host.classList.add('hidden');
    host.innerHTML = '';
    return;
  }
  const count = state => withAbility.filter(c => outlookState(outlookFor(c)) === state).length;
  const live = count('on');
  const maybe = count('maybe');
  host.classList.remove('hidden');
  host.innerHTML =
    `<span class="ab-badge on">✦</span> applies in this battle (<b>${live}</b>) · ` +
    (maybe
      ? `<span class="ab-badge maybe">✧?</span> depends on how the fight goes (<b>${maybe}</b>) · `
      : '') +
    `<span class="ab-badge off">✧</span> has an ability that will not (<b>${count('off')}</b>). ` +
    `Sort by <b>Ability in this battle</b> to bring them to the front.`;
}

/**
 * Heal / revive straight from the team picker, so a wiped team can be patched
 * up without leaving the battle. Newly revived creatures appear in the roster
 * immediately because renderPicker re-reads store.battleReady().
 */
function renderPickCare() {
  const host = $('#bt-pick-care');
  if (!host) return;
  host.innerHTML = '';

  const hurt = store.healable().length;
  const fainted = store.revivable().length;
  const potions = store.itemCount('potion');
  const revives = store.itemCount('revive');
  const fullHeals = store.itemCount('full_heal');
  if (!hurt && !fainted) return;

  const row = el('div', { class: 'btn-row' });

  if (fainted) {
    const use = Math.min(revives, fainted);
    row.append(el('button', {
      class: 'btn',
      disabled: use < 1,
      onclick: () => {
        const r = store.reviveAll();
        if (!r.ok) { toast('No revives left', 'bad'); return; }
        toast(`Revived ${r.revived} creature${r.revived === 1 ? '' : 's'}`, 'good');
        renderPicker();
      }
    }, revives ? `Revive all · ${use}` : `${fainted} fainted, no revives`));
  }

  if (hurt) {
    const need = store.potionsNeededForAll();
    const use = Math.min(potions, need);
    row.append(el('button', {
      class: 'btn',
      disabled: use < 1,
      onclick: () => {
        const r = store.healAll();
        if (!r.ok) { toast('No potions left', 'bad'); return; }
        toast(`Healed ${r.healed} creature${r.healed === 1 ? '' : 's'} with ${r.used} potion${r.used === 1 ? '' : 's'}`, 'good');
        renderPicker();
      }
    }, potions ? `Heal all · ${use} potion${use === 1 ? '' : 's'}` : `${hurt} hurt, no potions`));

    // The player picks which to spend: potions go further, Full Heals are one
    // creature each but finish the job however badly hurt it is.
    if (fullHeals) {
      const useFull = Math.min(fullHeals, hurt);
      row.append(el('button', {
        class: 'btn',
        onclick: () => {
          const r = store.fullHealAll();
          if (!r.ok) { toast('No Full Heals left', 'bad'); return; }
          toast(`Fully healed ${r.healed} creature${r.healed === 1 ? '' : 's'}`, 'good');
          renderPicker();
        }
      }, `Full Heal · ${useFull}`));
    }
  }

  host.append(
    el('p', { class: 'hint', text: `${fainted} fainted · ${hurt} hurt · you hold ${potions} potion${potions === 1 ? '' : 's'}, ${fullHeals} full heal${fullHeals === 1 ? '' : 's'} and ${revives} revive${revives === 1 ? '' : 's'}` }),
    row,
    hurt && (potions || fullHeals)
      ? el('p', { class: 'hint', text: 'Potions top up 50 HP at a time and stretch further. A Full Heal takes one creature straight to full, worst hurt first.' })
      : null
  );
}

function togglePick(uid) {
  const i = ctx.picked.indexOf(uid);
  if (i >= 0) ctx.picked.splice(i, 1);
  else if (ctx.picked.length < BATTLE_TEAM_SIZE) ctx.picked.push(uid);
  else { toast(`You can only take ${BATTLE_TEAM_SIZE}`, 'bad'); return; }
  renderPicker();
}

/* ---------------------------------------------------------------
   Step 3: the fight
   --------------------------------------------------------------- */

function startFight() {
  const team = ctx.picked.map(uid => store.creature(uid)).filter(Boolean);
  if (team.length !== BATTLE_TEAM_SIZE) { toast('Pick three creatures', 'bad'); return; }

  /* Checked again on the way into the fight, not just in the picker. The picker
     filters the list, but a creature can stop qualifying between choosing it and
     pressing Battle — evolving one out of a rarity, for instance — and the mode
     is the whole difficulty of a Frontier run, so it is worth being sure. */
  if (ctx.restrict) {
    const mode = frontierMode(ctx.restrict);
    const bad = team.filter(c => !frontierModeAllows(mode, c));
    if (bad.length) {
      const names = bad.map(c => species(c.speciesId)?.name || '?').join(', ');
      toast(`${names} cannot come on ${mode.label}`, 'bad', 4200);
      ctx.picked = ctx.picked.filter(uid => !bad.some(c => c.uid === uid));
      renderPicker();
      return;
    }
  }

  ctx.battle = ctx.kind === 'raid'
    ? buildRaidBattle(team, ctx.raid)
    : ctx.kind === 'frontier'
      ? buildFrontierBattle(team, ctx.frontier.team)
      : buildGruntBattle(team, ctx.grunt.team);

  const frontierTitle = () => {
    const ch = frontierChallengeOf(ctx);
    return `${ch?.name || 'Frontier'} challenge · Level ${ctx.frontier.level}`;
  };
  $('#bt-arena-title').textContent = ctx.kind === 'raid'
    ? `${ctx.grand ? FRONTIER_GRAND_LABEL : ctx.raid.exclusive ? 'Exclusive Raid' : 'Raid'} · ${species(ctx.raid.speciesId).name}`
    : ctx.kind === 'frontier'
      ? frontierTitle()
      : `${ctx.grunt.characterLabel || 'Grunt'} battle`;

  $('#bt-log').innerHTML = '';
  logLine(ctx.kind === 'raid'
    ? `A rarity ${ctx.raid.rarity}${ctx.raid.exclusive ? ' exclusive' : ''} ${species(ctx.raid.speciesId).name} towers over you.`
    : ctx.kind === 'frontier'
      ? `“${frontierChallengeOf(ctx)?.phrase || 'Let us begin.'}”`
      : `“${ctx.grunt.phrase}”`);

  // Held items and abilities announce themselves as the creatures take the
  // field, before the first move is chosen, so the player can pick knowing
  // what is in play.
  for (const e of ctx.battle.heldLines()) logHeld(e);
  for (const e of ctx.battle.abilityLines()) logAbility(e);

  step('arena');
  renderArena();
}

function renderArena() {
  const b = ctx.battle;
  const mine = b.playerActive, foe = b.enemyActive;

  renderPips('#bt-enemy-team', b.enemy, b.enemyIndex);
  renderPips('#bt-my-team', b.player, b.playerIndex);

  if (foe) {
    $('#bt-enemy-img').src = foe.spritePath;
    $('#bt-enemy-name').textContent = foe.label;
    $('#bt-enemy-lv').textContent = 'Lv ' + foe.level;
    setHp('#bt-enemy-hp', '#bt-enemy-hpnum', foe);
    renderBuffs('#bt-enemy-buffs', foe);
  }
  if (mine) {
    $('#bt-mine-img').src = mine.spritePath;
    $('#bt-mine-name').textContent = mine.label;
    $('#bt-mine-lv').textContent = 'Lv ' + mine.level;
    setHp('#bt-mine-hp', '#bt-mine-hpnum', mine);
    renderBuffs('#bt-mine-buffs', mine);
  }
  renderMoves();
}

function renderPips(sel, team, activeIndex) {
  const host = $(sel);
  host.innerHTML = '';
  team.forEach((b, i) => {
    host.append(el('span', {
      class: 'bt-pip' + (b.fainted ? ' down' : '') + (i === activeIndex && !b.fainted ? ' active' : '')
    }, el('img', { src: b.spritePath, alt: '' })));
  });
}

function setHp(barSel, numSel, battler) {
  const pct = battler.hpPct;
  const bar = $(barSel);
  bar.style.width = pct + '%';
  const wrap = bar.parentElement;
  wrap.classList.toggle('low', pct <= 60 && pct > 25);
  wrap.classList.toggle('critical', pct <= 25);
  $(numSel).textContent = `${battler.hp} / ${battler.maxHp}`;
}

function renderBuffs(sel, battler) {
  const host = $(sel);
  host.innerHTML = '';
  for (const stat of Object.keys(battler.buffs)) {
    const pct = battler.buffPercent(stat);
    if (!pct) continue;
    // `buffPercent` is already signed, so only a raise needs a plus adding —
    // a lowered stat used to come out as "Speed +-50%".
    host.append(el('span', {
      class: 'bt-buff' + (pct < 0 ? ' down' : ''),
      text: `${STAT_LABELS[stat]} ${pct > 0 ? '+' : ''}${pct}%`
    }));
  }
}

function renderMoves() {
  const host = $('#bt-moves');
  host.innerHTML = '';
  const moves = ctx.battle.availableMoves;
  moves.forEach((m, i) => {
    host.append(el('button', {
      class: 'bt-move' + (m.isStatus ? ' buffmove' : ''),
      disabled: busy || ctx.battle.over,
      onclick: () => playTurn(i)
    },
      el('b', { text: m.name }),
      el('span', { text: Battle.describeMove(m) })
    ));
  });
}

/**
 * An ability announcement, in its own colour so it stands apart from the blow
 * by blow. Says what fired and why, or why nothing did.
 */
function logAbility(e) {
  const who = e.side === 'player' ? 'Your' : 'The opposing';
  const fired = e.parts.filter(p => p.active);

  // When it fired, read out what it is doing and the condition that did it.
  // When it did not, the reasons are the interesting part.
  const detail = fired.length
    ? `${fired.map(p => p.effect).join(' and ')} — ${fired.map(p => p.reason).join(', ')}`
    : e.parts.map(p => p.reason).join(', ');

  logLine(
    `<span class="ability">✦ ${who} <b>${e.actorLabel}</b>: ${e.ability}` +
    ` — ${detail}.` +
    `<span class="ability-state">${e.active ? 'triggered' : 'not triggered'}</span></span>`
  );
}

/** "Your X walked in holding a Y." Its own colour, like an ability line. */
function logHeld(e) {
  const who = e.side === 'player' ? 'Your' : 'The opposing';
  logLine(`<span class="held-log">◈ ${who} <b>${e.actorLabel}</b> is holding a <b>${e.item}</b>.</span>`);
}

function logLine(html, cls = '') {
  const log = $('#bt-log');
  log.append(el('p', { class: cls, html }));
  log.scrollTop = log.scrollHeight;
}

/** Plays one turn, animating the events in sequence. */
async function playTurn(moveIndex) {
  if (busy || ctx.battle.over) return;
  busy = true;
  renderMoves();

  const events = ctx.battle.takeTurn(moveIndex);

  for (const e of events) {
    if (e.type === 'move') {
      const who = e.side === 'player' ? 'Your' : 'The opposing';
      logLine(`${who} <b>${e.actorLabel}</b> used <b>${e.move}</b>.`);
      await sleep(340);
    } else if (e.type === 'damage') {
      const imgSel = e.side === 'player' ? '#bt-enemy-img' : '#bt-mine-img';
      const img = $(imgSel);
      img.classList.remove('hit'); void img.offsetWidth; img.classList.add('hit');
      // `side` is the attacker, so the target belongs to the other side. Spell it
      // out, because both sides can be the same species.
      const who = e.side === 'player' ? 'The opposing' : 'Your';
      const hit = `${who} <b>${e.targetLabel}</b> took <b>${e.amount}</b> damage.`;
      logLine(
        e.superEffective ? `<span class="crit">Super effective!</span> ${hit}`
        : e.notVeryEffective ? `<span class="resist">Not very effective…</span> ${hit}`
        : hit);
      // A Miracle Coin turning a knockout into a survival is the most
      // surprising thing that can happen to a health bar, so it gets its say.
      if (e.savedBy) {
        logLine(`<span class="held-log">◈ <b>${e.wouldHaveBeen}</b> damage would have knocked it out — `
          + `its <b>${e.savedBy}</b> left it on <b>1 HP</b>.</span>`);
      }
      refreshHpOnly();
      await sleep(420);
    } else if (e.type === 'buff') {
      // `targetSide` is who it landed on, which for a self-buff is the user.
      const imgSel = (e.targetSide ?? e.side) === 'player' ? '#bt-mine-img' : '#bt-enemy-img';
      const img = $(imgSel);
      img.classList.remove('buffed'); void img.offsetWidth; img.classList.add('buffed');
      // A multi-stat buff reads as one line listing each stat it raised.
      const parts = (e.stats?.length ? e.stats : [e])
        .map(s => `${s.statLabel} rose to ${s.after}`);
      // Named the same way as a debuff, because a buff no longer always lands on
      // the creature that used the move — some strong moves pay for themselves
      // by strengthening the opponent, and that has to be obvious in the log.
      const whose = e.onSelf === false
        ? (e.targetSide === 'player' ? 'Your' : 'The opposing')
        : (e.targetSide === 'player' ? 'Your own' : 'Its own');
      logLine(`<span class="buff">${whose} <b>${e.actorLabel}</b>: ${parts.join(', ')} (+${e.pct}%).</span>`);
      renderArena();
      await sleep(380);
    } else if (e.type === 'debuff') {
      const imgSel = (e.targetSide ?? e.side) === 'player' ? '#bt-mine-img' : '#bt-enemy-img';
      const img = $(imgSel);
      img.classList.remove('debuffed'); void img.offsetWidth; img.classList.add('debuffed');
      const whose = e.onSelf
        ? (e.targetSide === 'player' ? 'Your own' : 'Its own')
        : (e.targetSide === 'player' ? 'Your' : 'The opposing');
      const parts = (e.stats?.length ? e.stats : [e])
        .map(s => `${s.statLabel} fell to ${s.after}`);
      logLine(`<span class="debuff">${whose} <b>${e.actorLabel}</b>: ${parts.join(', ')} (−${e.pct}%).</span>`);
      renderArena();
      await sleep(380);
    } else if (e.type === 'heal') {
      const imgSel = (e.targetSide ?? e.side) === 'player' ? '#bt-mine-img' : '#bt-enemy-img';
      const img = $(imgSel);
      img.classList.remove('healed'); void img.offsetWidth; img.classList.add('healed');
      const who = (e.targetSide ?? e.side) === 'player' ? 'Your' : 'The opposing';
      logLine(e.amount > 0
        ? `<span class="heal">${who} <b>${e.actorLabel}</b> recovered <b>${e.amount}</b> HP (${e.hpAfter}/${e.maxHp}).</span>`
        : `<span class="heal">${who} <b>${e.actorLabel}</b> was already at full health.</span>`);
      refreshHpOnly();
      await sleep(400);
    } else if (e.type === 'skipped') {
      const who = e.side === 'player' ? 'Your' : 'The opposing';
      logLine(`${who} <b>${e.actorLabel}</b> was knocked out before it could move.`);
      await sleep(260);
    } else if (e.type === 'faint') {
      // here `side` is already the side that fainted
      const imgSel = e.side === 'player' ? '#bt-mine-img' : '#bt-enemy-img';
      $(imgSel).classList.add('down');
      const who = e.side === 'player' ? 'Your' : 'The opposing';
      logLine(`<span class="ko">${who} ${e.label} fainted!</span>`);
      await sleep(560);
      $(imgSel).classList.remove('down');
    } else if (e.type === 'partingShot') {
      // The creature that just went down hits back on its way out. Shown as a
      // hit on the *other* sprite, since that is who lost the HP.
      const imgSel = e.targetSide === 'player' ? '#bt-mine-img' : '#bt-enemy-img';
      const img = $(imgSel);
      img.classList.remove('hit'); void img.offsetWidth; img.classList.add('hit');
      const mine = e.side === 'player';
      logLine(`<span class="ability">✦ ${mine ? 'Your' : 'The opposing'} `
        + `<b>${e.actorLabel}</b>: ${e.ability} — it takes <b>${e.amount}</b> HP `
        + `(${e.percent}% of what was left) off <b>${e.targetLabel}</b> on its way down `
        + `(${e.hpAfter}/${e.maxHp}).<span class="ability-state">triggered</span></span>`);
      refreshHpOnly();
      await sleep(560);
    } else if (e.type === 'switch') {
      logLine(`${e.side === 'player' ? 'Go' : 'They send out'} <b>${e.label}</b>!`);
      renderArena();
      await sleep(360);
    } else if (e.type === 'ability') {
      logAbility(e);
      await sleep(520);
    } else if (e.type === 'held') {
      logHeld(e);
      await sleep(420);
    }
  }

  renderArena();
  busy = false;

  if (ctx.battle.over) await finishBattle();
  else renderMoves();
}

function refreshHpOnly() {
  const b = ctx.battle;
  if (b.enemyActive) setHp('#bt-enemy-hp', '#bt-enemy-hpnum', b.enemyActive);
  if (b.playerActive) setHp('#bt-mine-hp', '#bt-mine-hpnum', b.playerActive);
}

/* ---------------------------------------------------------------
   Step 4: result
   --------------------------------------------------------------- */

async function finishBattle() {
  const b = ctx.battle;
  const won = b.winner === 'player';

  // Damage always carries out of the battle.
  store.applyBattleDamage(b.playerResults());

  let rewards = null;
  /** Set when a Frontier level was won that had already been won on this mode. */
  let repeat = false;

  if (won) {
    if (ctx.kind === 'frontier') {
      const { challengeId, level, modeId } = ctx.frontier;
      // Refuses a level already beaten on this mode, so re-fighting one for the
      // practice cannot also re-pay for it.
      const res = store.rewardFrontierWin(challengeId, level, modeId);
      if (res.ok) rewards = res; else repeat = res.reason === 'claimed';
    } else if (ctx.kind === 'raid') {
      rewards = store.rewardRaidWin(ctx.raid);
      ctx.raid.defeated = true;
      // A Grand Raid is scored against the ladder as well as paying the raid
      // table, and only on a win — losing leaves it open to try again.
      if (ctx.grand) store.recordFrontierGrandWin(ctx.grand.challengeId, ctx.grand.modeId);
    } else {
      rewards = store.rewardGruntWin();
      ctx.grunt.defeated = true;
    }
    // A defeated point stays on the map, ticked, until its timer runs out. A
    // Frontier fight and a Grand Raid have no point behind them at all.
    if (ctx.point) store.markCollected(ctx.point.id);
  }
  ctx.result = { won, rewards, repeat };

  await sleep(400);
  renderResult();
  step('result');
}

function renderResult() {
  const { won, rewards, repeat } = ctx.result;
  const body = $('#bt-result-body');
  body.innerHTML = '';

  const sp = ctx.kind === 'raid' ? species(ctx.raid.speciesId) : null;
  const frontier = ctx.kind === 'frontier';
  const trainer = frontier ? frontierChallengeOf(ctx) : null;

  body.append(
    el('div', { class: `bt-outcome ${won ? 'win' : 'lose'}` },
      el('div', { class: 'big', text: won ? 'VICTORY' : 'DEFEATED' }),
      sp ? el('img', { src: sp.spritePath(ctx.raid.shiny), alt: sp.name }) : null,
      trainer ? el('img', { src: frontierTrainerImage(trainer.id), alt: trainer.trainerName }) : null,
      el('p', { class: 'muted', text: won
        ? (ctx.kind === 'raid' ? `${sp.name} was beaten!`
          : frontier ? `${trainer?.trainerName} is out of creatures.`
          : 'You cleared their whole team.')
        : frontier
          ? 'Your team was wiped out. Heal up, or bring a different three, and try again.'
          : 'Your team was wiped out. Heal up and try again before the timer runs out.' })
    )
  );

  // Won a level that was already cleared on this mode: no reward, and the screen
  // says why rather than showing an empty list.
  if (won && repeat) {
    body.append(el('p', { class: 'hint', style: { color: '#ffd9a8' } },
      'You had already beaten this level on this mode, so there was nothing left to win. '
      + 'Take the same level on a mode you have not cleared it with yet.'));
  }

  if (won && rewards) {
    const chips = [
      rewards.xp ? { icon: '⭐', label: `+${rewards.xp} XP` } : null,
      // A Frontier level pays items only, so there is no stardust line to show.
      rewards.dust
        ? { icon: DUST_ICON, label: `+${num(rewards.dust)} stardust${rewards.sunday ? ' (Sunday ×2)' : ''}` }
        : null,
      rewards.bonus ? { icon: '🎁', label: `Bonus ${itemName(rewards.bonus)}` } : null,
      // Guaranteed drops: raid revives + incubator, grunt potions/revives
      ...Object.entries(rewards.items || {}).map(([id, n]) => ({ img: itemImage(id), label: `+${n} ${itemName(id, n)}` })),
      rewards.egg ? { icon: '🥚', label: `A ${eggLabel(rewards.egg.type)}` } : null,
      // A held item is rare enough to deserve its own artwork in the list.
      // `heldDrop` is the raid and grunt name for it, `heldReward` the Frontier's.
      ...[rewards.heldDrop, rewards.heldReward].filter(Boolean).map(h => ({
        img: heldItemImage(h.id), label: `◈ ${h.name}`
      }))
    ].filter(Boolean);
    body.append(el('div', { class: 'rewards' }, ...chips.map(r =>
      el('span', { class: 'reward' },
        r.img
          ? el('img', { src: r.img, alt: '', style: { width: '18px', height: '18px', objectFit: 'contain' } })
          : el('span', { text: r.icon }),
        el('span', { text: r.label })))));
  }

  // Where the ladder stands now, and the Grand Raid the moment it opens.
  if (won && frontier && rewards) {
    const state = store.frontierChallengeState(
      ctx.frontier.challengeId, ctx.frontier.modeId);
    if (rewards.unlockedGrand) {
      body.append(el('p', { class: 'hint', style: { color: '#c8f7c5' } },
        el('b', { text: `${FRONTIER_GRAND_LABEL} unlocked. ` }),
        `All ${FRONTIER_LEVELS} levels of the ${trainer.name} challenge are beaten on `
        + `${state.mode.label}. Its boss is waiting at the Battle Frontier, and it cannot be `
        + 'found any other way.'));
    } else {
      body.append(el('p', { class: 'hint', text:
        `${state.cleared} of ${FRONTIER_LEVELS} levels beaten on ${state.mode.label}.` }));
    }
  }

  // An exclusive egg is lost if all three exclusive slots are taken, so say so
  // rather than silently dropping it.
  if (won && rewards?.eggBlocked) {
    body.append(el('p', { class: 'hint', style: { color: '#ffd9a8' } },
      'A 15 km egg dropped, but your three exclusive egg slots are full. Hatch one to make room for the next.'));
  }

  // Buttons
  const canCatch = won && ctx.kind === 'raid' && store.hasItem('ultra_disc');
  $('#bt-catch').classList.toggle('hidden', !canCatch);
  $('#bt-again').classList.toggle('hidden', won);
  $('#bt-done').textContent = canCatch ? 'Leave it' : 'Done';

  if (won && ctx.kind === 'raid' && !store.hasItem('ultra_disc')) {
    body.append(el('p', { class: 'hint', style: { color: '#ffd9a8' } },
      'Without an Ultra Capture Disc it slips away. The XP and stardust are still yours.'));
  }
  if (canCatch) {
    body.append(el('div', { class: 'det-rows' },
      el('div', { class: 'det-row' },
        el('img', { src: itemImage('ultra_disc'), alt: '' }),
        el('span', { text: 'Ultra Capture Discs' }),
        el('b', { text: num(store.itemCount('ultra_disc')) })),
      el('div', { class: 'det-row' },
        el('span', { text: '📈' }),
        el('span', { text: 'Caught at' }),
        el('b', { text: `Level ${RAID_CAPTURE_LEVEL} · +2 candy` }))
    ));
  }
}

/** The catch attempt after a raid win. */
async function throwUltraDisc() {
  if (busy) return;
  busy = true;
  $('#bt-catch').disabled = true;
  try {
    const res = store.captureRaidBoss(ctx.raid);
    if (!res.ok) { toast('You have no Ultra Capture Discs', 'bad'); return; }

    $('#battle').classList.add('hidden');

    const rewards = [
      { icon: CANDY_ICON, label: `+${res.candy} ${familyName(res.sp.id)} candy (incl. +2 raid bonus)${res.sweet ? ', Tuesday ×2' : ''}` },
      { icon: DUST_ICON, label: `+${num(res.dust)} stardust` },
      { icon: '⭐', label: `+${res.xp} XP` },
      { icon: '📈', label: `Level ${res.creature.level}` }
    ];
    if (res.shiny) rewards.unshift({ icon: '✨', label: 'Shiny!' });

    await playCapture({
      sp: res.sp,
      isNew: res.isNew,
      rewards,
      imageSrc: res.sp.spritePath(res.shiny),
      shiny: res.shiny
    });

    if (res.levelUp.levelledUp) toast(`Player level ${res.levelUp.to}!`, 'good', 3200);
  } finally {
    busy = false;
    $('#bt-catch').disabled = false;
    // Same hand-back as closeBattle: a Grand Raid catch returns to the building.
    const after = ctx?.onClose || null;
    ctx = null;
    $('#battle').classList.add('hidden');
    onFinished?.();
    after?.();
  }
}

export const isBattleOpen = () => !$('#battle').classList.contains('hidden');
