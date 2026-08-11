/* ============================================================
   battleui.js — the battle screen: preview, team pick, fight, result

   Shared by raids (1 boss) and battle grunts (3 creatures).
   ============================================================ */

import {
  species, RARITY_NAMES, STAT_LABELS, BATTLE_TEAM_SIZE, familyName,
  familyRarity, statsFor, raidBossStats, RAID_CAPTURE_LEVEL
} from './data.js';
import { store, creatureStats, maxHpOf, hpOf, isFainted } from './state.js';
import { Battle, buildRaidBattle, buildGruntBattle, battlerFromEnemySpec } from './battle.js';
import { itemImage } from './items.js';
import { playCapture } from './anim.js';
import { $, $$, el, toast, num, sleep } from './ui.js';

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
  $('#bt-done').addEventListener('click', closeBattle);
  $('#bt-again').addEventListener('click', () => openBattle(ctx.point));
  $('#bt-catch').addEventListener('click', throwUltraDisc);
  $('#bt-sort').addEventListener('change', renderPicker);
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

export function closeBattle() {
  if (busy) return;
  $('#battle').classList.add('hidden');
  ctx = null;
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
    const stats = raidBossStats(sp, raid.level);
    $('#bt-title').textContent = `Rarity ${raid.rarity} Raid`;

    body.append(
      el('div', { class: 'bt-boss' },
        el('img', { src: sp.spritePath(raid.shiny), alt: sp.name }),
        raid.shiny ? el('div', { class: 'new-banner', text: '★ SHINY' }) : null,
        el('h3', { text: sp.name }),
        el('div', { class: 'reveal-tags' },
          el('span', { class: `tag t-${sp.type}`, text: sp.type }),
          el('span', { class: 'tag', text: `Level ${raid.level}` }),
          el('span', { class: `tag r-${raid.rarity}`, text: `${raid.rarity} · ${RARITY_NAMES[raid.rarity]}` })
        ),
        !store.isRegistered(sp.id)
          ? el('div', { class: 'not-registered-badge', text: 'Not registered yet' })
          : null
      ),
      el('div', { class: 'det-rows' },
        statLine('HP', stats.hp, 'tripled for a raid'),
        statLine('Attack', stats.attack, '+10%'),
        statLine('Defence', stats.defence, '+10%'),
        statLine('Speed', stats.speed, '+10%')
      ),
      el('h4', { class: 'sheet-h4', text: 'If you win' }),
      el('div', { class: 'rewards' },
        el('span', { class: 'reward' }, el('span', { text: '⭐' }), el('span', { text: `+${raid.xp} XP` })),
        el('span', { class: 'reward' }, el('span', { text: DUST_ICON }),
          el('span', { text: `+${raid.dustRange[0]}–${raid.dustRange[1]} stardust` }))
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

const PICK_SORTS = {
  level: (a, b) => b.level - a.level,
  name: (a, b) => species(a.speciesId).name.localeCompare(species(b.speciesId).name),
  rarity: (a, b) => (familyRarity(b.speciesId) - familyRarity(a.speciesId)),
  type: (a, b) => species(a.speciesId).type.localeCompare(species(b.speciesId).type)
};

function showPicker() {
  ctx.picked = [];
  step('pick');
  renderPicker();
}

function renderPicker() {
  const grid = $('#bt-pick-grid');
  const sort = $('#bt-sort').value || 'level';
  const list = [...store.battleReady()].sort(PICK_SORTS[sort] || PICK_SORTS.level);

  $('#bt-pick-count').textContent = `${ctx.picked.length} of ${BATTLE_TEAM_SIZE} chosen`;
  $('#bt-fight').disabled = ctx.picked.length !== BATTLE_TEAM_SIZE;

  const empty = $('#bt-pick-empty');
  empty.classList.toggle('hidden', list.length > 0);
  empty.textContent = 'No creatures are fit to battle. Revive or heal them first.';

  grid.innerHTML = '';
  for (const c of list) {
    const sp = species(c.speciesId);
    const st = creatureStats(c);
    const idx = ctx.picked.indexOf(c.uid);
    const max = maxHpOf(c), hp = hpOf(c);
    const pct = Math.round((hp / max) * 100);

    grid.append(el('button', {
      class: 'cell' + (idx >= 0 ? ' picked' : ''),
      onclick: () => togglePick(c.uid)
    },
      idx >= 0 ? el('span', { class: 'pick-order', text: String(idx + 1) }) : null,
      el('span', { class: 'lvl', text: 'Lv' + c.level }),
      c.shiny ? el('span', { class: 'shiny-star', text: '★' }) : null,
      el('img', { src: sp.spritePath(c.shiny), alt: sp.name, loading: 'lazy' }),
      el('span', { class: 'nm', text: sp.name }),
      el('span', { class: `sub t-${sp.type}`, text: sp.type }),
      el('span', { class: 'hp-wrap' },
        el('span', { class: `hp-bar${pct <= 25 ? ' critical' : pct <= 60 ? ' low' : ''}` },
          el('i', { style: { width: pct + '%' } }))),
      el('span', { class: 'sub', text: `${st.attack}A ${st.defence}D ${st.speed}S` })
    ));
  }
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
    ? `Raid · ${species(ctx.raid.speciesId).name}`
    : `${ctx.grunt.characterLabel || 'Grunt'} battle`;

  $('#bt-log').innerHTML = '';
  logLine(ctx.kind === 'raid'
    ? `A rarity ${ctx.raid.rarity} ${species(ctx.raid.speciesId).name} towers over you.`
    : `“${ctx.grunt.phrase}”`);

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
      class: 'bt-move' + (m.isBuff ? ' buffmove' : ''),
      disabled: busy || ctx.battle.over,
      onclick: () => playTurn(i)
    },
      el('b', { text: m.name }),
      el('span', { text: Battle.describeMove(m) })
    ));
  });
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
      logLine(e.superEffective
        ? `<span class="crit">Super effective!</span> ${who} <b>${e.targetLabel}</b> took <b>${e.amount}</b> damage.`
        : `${who} <b>${e.targetLabel}</b> took <b>${e.amount}</b> damage.`);
      refreshHpOnly();
      await sleep(420);
    } else if (e.type === 'buff') {
      const imgSel = e.side === 'player' ? '#bt-mine-img' : '#bt-enemy-img';
      const img = $(imgSel);
      img.classList.remove('buffed'); void img.offsetWidth; img.classList.add('buffed');
      logLine(`<span class="buff">${e.statLabel} rose to ${e.after} (+${e.pct}%).</span>`);
      renderArena();
      await sleep(380);
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
      { icon: DUST_ICON, label: `+${num(rewards.dust)} stardust` },
      rewards.bonus ? { icon: '🎁', label: `Bonus ${rewards.bonus === 'incense' ? 'Incense' : 'Stardust Magnet'}` } : null
    ].filter(Boolean);
    body.append(el('div', { class: 'rewards' }, ...chips.map(r =>
      el('span', { class: 'reward' }, el('span', { text: r.icon }), el('span', { text: r.label })))));
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
      { icon: CANDY_ICON, label: `+${res.candy} ${familyName(res.sp.id)} candy (incl. +2 raid bonus)` },
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
