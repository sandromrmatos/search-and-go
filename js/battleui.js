/* ============================================================
   battleui.js — the battle screen: preview, team pick, fight, result

   Shared by raids (1 boss) and battle grunts (3 creatures).
   ============================================================ */

import {
  species, RARITY_NAMES, STAT_LABELS, BATTLE_TEAM_SIZE, familyName,
  statsFor, raidBossStats, RAID_CAPTURE_LEVEL, raidModifiers, EXCLUSIVE_RAID_REWARD,
  eggLabel, buffMoveText, moveEffectText, moveSummaryText,
  abilityOutlook, abilityOutlookLabel, heldItemImage
} from './data.js';

/** "+50%" style label straight from the raid modifier table. */
const bossPct = (key, exclusive = false) =>
  `+${Math.round((raidModifiers(exclusive)[key] - 1) * 100)}%`;
import { store, creatureStats, maxHpOf, hpOf, isFainted } from './state.js';
import { sortedForPicker, setAbilityRanker } from './views.js';
import {
  Battle, buildRaidBattle, buildGruntBattle, battlerFromEnemySpec, battleEnv
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
  $('#bt-again').addEventListener('click', () => openBattle(ctx.point));
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
  ctx = null;
  // The ability sort goes back to its plain "has one at all" meaning, since
  // there is no longer a battle to judge relevance against.
  outlookCache = new Map();
  setAbilityRanker(null);
  onFinished?.();
}

function step(name) {
  for (const id of ['preview', 'pick', 'arena', 'result']) {
    $('#bt-' + id).classList.toggle('hidden', id !== name);
  }
}

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

  const ready = store.battleReady().length;
  const btn = $('#bt-start');
  btn.disabled = ready < BATTLE_TEAM_SIZE;
  btn.textContent = ready < BATTLE_TEAM_SIZE
    ? `Need ${BATTLE_TEAM_SIZE} healthy creatures (you have ${ready})`
    : 'Choose your team';
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
    outlookCache.set(sp.id, abilityOutlook(sp.ability, {
      opponents, now: env.now, weather: env.weather
    }));
  }
}

const outlookFor = c => outlookCache.get(c?.speciesId) || null;

/** Sort key: fires here, then has one that will not fire, then has none. */
function outlookRank(c) {
  const look = outlookFor(c);
  if (!look?.has) return 0;
  return look.applies ? 2 : 1;
}

/** The ✦ badge for a picker cell, or null when the creature has no ability. */
function abilityBadge(c) {
  const look = outlookFor(c);
  if (!look?.has) return null;
  return el('span', {
    class: 'ab-badge' + (look.applies ? ' on' : ' off'),
    title: abilityOutlookLabel(look),
    text: look.applies ? '✦' : '✧'
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
  const all = sortedForPicker(store.battleReady());
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
  empty.textContent = 'No creatures are fit to battle. Heal or revive them below, or catch some more.';

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
  const live = withAbility.filter(c => outlookFor(c).applies).length;
  host.classList.remove('hidden');
  host.innerHTML =
    `<span class="ab-badge on">✦</span> applies in this battle (<b>${live}</b>) · ` +
    `<span class="ab-badge off">✧</span> has an ability that will not (<b>${withAbility.length - live}</b>). ` +
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

  ctx.battle = ctx.kind === 'raid'
    ? buildRaidBattle(team, ctx.raid)
    : buildGruntBattle(team, ctx.grunt.team);

  $('#bt-arena-title').textContent = ctx.kind === 'raid'
    ? `${ctx.raid.exclusive ? 'Exclusive Raid' : 'Raid'} · ${species(ctx.raid.speciesId).name}`
    : `${ctx.grunt.characterLabel || 'Grunt'} battle`;

  $('#bt-log').innerHTML = '';
  logLine(ctx.kind === 'raid'
    ? `A rarity ${ctx.raid.rarity}${ctx.raid.exclusive ? ' exclusive' : ''} ${species(ctx.raid.speciesId).name} towers over you.`
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
    if (pct) host.append(el('span', { class: 'bt-buff', text: `${STAT_LABELS[stat]} +${pct}%` }));
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
      logLine(`<span class="buff">${parts.join(', ')} (+${e.pct}%).</span>`);
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
  if (won) {
    rewards = ctx.kind === 'raid'
      ? store.rewardRaidWin(ctx.raid)
      : store.rewardGruntWin();
    // A defeated point stays on the map, ticked, until its timer runs out.
    if (ctx.kind === 'raid') ctx.raid.defeated = true;
    else ctx.grunt.defeated = true;
    store.markCollected(ctx.point.id);
  }
  ctx.result = { won, rewards };

  await sleep(400);
  renderResult();
  step('result');
}

function renderResult() {
  const { won, rewards } = ctx.result;
  const body = $('#bt-result-body');
  body.innerHTML = '';

  const sp = ctx.kind === 'raid' ? species(ctx.raid.speciesId) : null;

  body.append(
    el('div', { class: `bt-outcome ${won ? 'win' : 'lose'}` },
      el('div', { class: 'big', text: won ? 'VICTORY' : 'DEFEATED' }),
      sp ? el('img', { src: sp.spritePath(ctx.raid.shiny), alt: sp.name }) : null,
      el('p', { class: 'muted', text: won
        ? (ctx.kind === 'raid' ? `${sp.name} was beaten!` : 'You cleared their whole team.')
        : 'Your team was wiped out. Heal up and try again before the timer runs out.' })
    )
  );

  if (won && rewards) {
    const chips = [
      rewards.xp ? { icon: '⭐', label: `+${rewards.xp} XP` } : null,
      { icon: DUST_ICON, label: `+${num(rewards.dust)} stardust${rewards.sunday ? ' (Sunday ×2)' : ''}` },
      rewards.bonus ? { icon: '🎁', label: `Bonus ${itemName(rewards.bonus)}` } : null,
      // Guaranteed drops: raid revives + incubator, grunt potions/revives
      ...Object.entries(rewards.items || {}).map(([id, n]) => ({ img: itemImage(id), label: `+${n} ${itemName(id, n)}` })),
      rewards.egg ? { icon: '🥚', label: `A ${eggLabel(rewards.egg.type)}` } : null,
      // A held item is rare enough to deserve its own artwork in the list.
      rewards.heldDrop
        ? { img: heldItemImage(rewards.heldDrop.id), label: `◈ ${rewards.heldDrop.name}` }
        : null
    ].filter(Boolean);
    body.append(el('div', { class: 'rewards' }, ...chips.map(r =>
      el('span', { class: 'reward' },
        r.img
          ? el('img', { src: r.img, alt: '', style: { width: '18px', height: '18px', objectFit: 'contain' } })
          : el('span', { text: r.icon }),
        el('span', { text: r.label })))));
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
    ctx = null;
    $('#battle').classList.add('hidden');
    onFinished?.();
  }
}

export const isBattleOpen = () => !$('#battle').classList.contains('hidden');
