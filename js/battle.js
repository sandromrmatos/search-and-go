/* ============================================================
   battle.js — the turn-based battle engine

   Rules implemented here:
     • each turn both sides choose a move; the higher current Speed goes
       first, ties are broken at random
     • if the first attack knocks the target out, the target does not attack
     • damage = round(power x attack / defence), x1.4 when super effective and
       x0.7 when not very effective, never less than 1
     • buff moves raise the user's own stat immediately and compound if used
       again, and the raised value is what the opponent's damage is measured against
     • when a creature faints the next one in the chosen order comes in
     • the side that runs out of creatures loses
   ============================================================ */

import {
  damageOf, effectivenessOf, statsFor, raidBossStats, species, heldStatBonus,
  evaluateAbility, faintDamage, clauseEffectText, clauseConditionText, buffStatsLabel,
  moveEffectText, moveSummaryText,
  STAT_KEYS, STAT_LABELS, BATTLE_TEAM_SIZE, moveLevelFor, heldItem
} from './data.js';
import { store, creatureStats, maxHpOf, hpOf } from './state.js';

/* ---------------------------------------------------------------
   Battler
   --------------------------------------------------------------- */

let seq = 0;

export class Battler {
  constructor({ key, uid, speciesId, level, shiny, stats, hp, moves, label, held = null }) {
    this.key = key ?? `b${++seq}`;
    this.uid = uid ?? null;              // set for the player's own creatures
    this.speciesId = speciesId;
    this.level = level;
    this.shiny = !!shiny;
    this.label = label || species(speciesId)?.name || '?';

    this.baseStats = { ...stats };        // stats at the start of the battle
    this.stats = { ...stats };            // current, including buffs
    this.maxHp = stats.hp;
    this.hp = Math.max(0, Math.min(stats.hp, hp ?? stats.hp));
    this.moves = moves;
    this.buffs = {};                      // stat -> cumulative multiplier
    /**
     * What it walked in carrying. The stat items are already baked into
     * `stats`; this is here for the ones that do something during the fight,
     * and so the log can announce it.
     */
    this.held = held || null;
  }

  get species() { return species(this.speciesId); }
  /** The held item definition, or null. */
  get heldDef() { return this.held ? heldItem(this.held) : null; }
  get type() { return this.species?.type || 'Neutral'; }
  get fainted() { return this.hp <= 0; }
  get spritePath() { return this.species?.spritePath(this.shiny) || ''; }
  get hpPct() { return Math.max(0, Math.round((this.hp / this.maxHp) * 100)); }

  /** Applies a buff move to itself. Multiplies, so repeats stack. */
  applyBuff(stat, pct) {
    const before = this.stats[stat];
    this.stats[stat] = Math.max(1, Math.round(this.stats[stat] * (1 + pct)));
    this.buffs[stat] = (this.buffs[stat] || 1) * (1 + pct);
    return { stat, before, after: this.stats[stat], stacks: this.buffs[stat] };
  }

  /**
   * Lowers one of its stats. The mirror of applyBuff, so the two share the same
   * `buffs` ledger and a debuff can cancel an earlier buff out.
   *
   * Floored at 1: a stat can be ground down but never to nothing, so a stack of
   * debuffs cannot make a creature deal literally zero damage.
   */
  applyDebuff(stat, pct) {
    const before = this.stats[stat];
    this.stats[stat] = Math.max(1, Math.round(this.stats[stat] * (1 - pct)));
    this.buffs[stat] = (this.buffs[stat] || 1) * (1 - pct);
    return { stat, before, after: this.stats[stat], stacks: this.buffs[stat] };
  }

  /** Buff multiplier as a readable percentage, negative once debuffed. */
  buffPercent(stat) {
    const m = this.buffs[stat];
    return m ? Math.round((m - 1) * 100) : null;
  }

  /** Restores HP, never past the maximum it started the fight with. */
  heal(n) {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + Math.max(0, Math.round(n || 0)));
    return { before, after: this.hp, healed: this.hp - before, maxHp: this.maxHp };
  }

  takeDamage(n) {
    this.hp = Math.max(0, this.hp - n);
    return this.hp;
  }
}

/* ---------------------------------------------------------------
   Builders
   --------------------------------------------------------------- */

/** Turns one of the player's stored creatures into a battler. */
export function battlerFromCreature(c) {
  const sp = species(c.speciesId);
  return new Battler({
    uid: c.uid,
    speciesId: c.speciesId,
    level: c.level,
    shiny: c.shiny,
    stats: creatureStats(c),
    hp: hpOf(c),
    moves: sp.movesAt(c.level, c.moveUnlock),
    held: c.held || null
  });
}

/** Raid boss: levelled stats with tripled HP and 10% more of everything else. */
export function battlerFromRaid(raid) {
  const sp = species(raid.speciesId);
  return new Battler({
    speciesId: raid.speciesId,
    level: raid.level,
    shiny: !!raid.shiny,
    stats: raidBossStats(sp, raid.level, !!raid.exclusive),
    moves: sp.movesAt(raid.level, null),
    label: sp.name
  });
}

/** A grunt's creature: ordinary stats for its level. */
export function battlerFromEnemySpec({ speciesId, level, shiny = false }) {
  const sp = species(speciesId);
  return new Battler({
    speciesId,
    level,
    shiny,
    stats: statsFor(sp, level, null),
    moves: sp.movesAt(level, null),
    label: sp.name
  });
}

/**
 * A Battle Frontier trainer's creature. Unlike a grunt's, this one is allowed
 * everything the player is: a held item and up to twenty Stat Booster points,
 * both fed through exactly the same maths as `creatureStats` so a level 10
 * trainer is as strong as a fully kitted-out team and no stronger.
 *
 * No stat modifier, though: the ±10% roll is luck of the draw on a capture, and
 * a fixed ladder handing itself the good end of it every time would be quietly
 * unfair. The boosts in the sheet are the difficulty knob instead.
 */
export function battlerFromFrontierSpec({ speciesId, level, held = null, boosts = null }) {
  const sp = species(speciesId);
  const extra = heldStatBonus({ speciesId, level, held }, sp);
  return new Battler({
    speciesId,
    level,
    stats: statsFor(sp, level, null, boosts, extra),
    moves: sp.movesAt(level, null),
    label: sp.name,
    held
  });
}

/* ---------------------------------------------------------------
   AI
   --------------------------------------------------------------- */

/**
 * Picks the boss/grunt move.
 *   1 move                     → that move
 *   2 damaging                 → 80% stronger, 20% weaker
 *   1 damaging + 1 buff        → 80% damaging, 20% buff
 *   3 or 4 moves               → 60% best power, 20% second best, 20% a buff
 * Categories with nothing in them have their weight shared out.
 */
export function chooseAIMove(battler, rng = Math.random) {
  const moves = battler.moves;
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0];

  const damaging = moves.filter(m => m.power > 0).sort((a, b) => b.power - a.power);
  // Every non-damaging move, not just self-buffs: a pure heal or a pure debuff
  // belongs in the same bucket, since the choice being made is "hit, or set up".
  const buffs = moves.filter(m => m.isStatus);

  const candidates = [];
  if (moves.length === 2) {
    if (damaging.length === 2) {
      candidates.push({ move: damaging[0], weight: 80 }, { move: damaging[1], weight: 20 });
    } else if (damaging.length === 1 && buffs.length === 1) {
      candidates.push({ move: damaging[0], weight: 80 }, { move: buffs[0], weight: 20 });
    } else {
      // two buff moves — just split them
      candidates.push({ move: buffs[0], weight: 50 }, { move: buffs[1], weight: 50 });
    }
  } else {
    if (damaging[0]) candidates.push({ move: damaging[0], weight: 60 });
    if (damaging[1]) candidates.push({ move: damaging[1], weight: 20 });
    if (buffs.length) {
      candidates.push({ move: buffs[Math.floor(rng() * buffs.length)], weight: 20 });
    }
  }

  if (!candidates.length) return moves[Math.floor(rng() * moves.length)];

  const total = candidates.reduce((a, c) => a + c.weight, 0);
  let r = rng() * total;
  for (const c of candidates) {
    r -= c.weight;
    if (r < 0) return c.move;
  }
  return candidates[candidates.length - 1].move;
}

/* ---------------------------------------------------------------
   Battle
   --------------------------------------------------------------- */

export class Battle {
  /**
   * @param {object} opts
   * @param {Battler[]} opts.player  the player's team, in the chosen order
   * @param {Battler[]} opts.enemy   the opposing team, in order
   * @param {string} [opts.kind]     'raid' | 'grunt'
   * @param {function} [opts.rng]
   */
  constructor({ player, enemy, kind = 'raid', rng = Math.random, env = null }) {
    this.kind = kind;
    this.rng = rng;
    this.player = player;
    this.enemy = enemy;
    this.playerIndex = 0;
    this.enemyIndex = 0;
    this.turn = 0;
    this.over = false;
    this.winner = null;      // 'player' | 'enemy'
    this.log = [];

    /**
     * The world the abilities are judged against. Captured once so a battle
     * that straddles midnight, or an incoming weather reading, cannot change
     * the rules underneath the player mid-fight. Opponent-based clauses are
     * still re-checked on every matchup, which is the point of `abilityLines`.
     */
    this.env = env || { now: new Date(), weather: {} };

    /** The pairing the last ability read was made for, so it is not repeated. */
    this._abilityPairing = null;

    /** Creatures whose held item has already been announced. */
    this._heldAnnounced = new Set();
  }

  /* ---- abilities ---- */

  /**
   * Evaluates the ability of whichever creature is on `side`, against whoever
   * is currently facing it.
   */
  abilityFor(side) {
    const self = side === 'player' ? this.playerActive : this.enemyActive;
    const foe = side === 'player' ? this.enemyActive : this.playerActive;
    if (!self?.species?.ability) return null;
    return evaluateAbility(self.species.ability, {
      opponent: foe?.species || null,
      now: this.env.now,
      weather: this.env.weather,
      daily: this.env.daily,
      world: this.env.world,
      battle: this.battleReadings(side)
    });
  }

  /**
   * The in-battle half of an ability context for whoever is on `side`: how hurt
   * each side is, how big the opponent is, what it is carrying and what it has
   * buffed, whether this creature is the last one left, and who its team mates
   * are.
   *
   * Plain numbers and names rather than the battlers themselves, because data.js
   * evaluates the conditions and knows nothing about this module.
   */
  battleReadings(side) {
    const self = side === 'player' ? this.playerActive : this.enemyActive;
    const foe = side === 'player' ? this.enemyActive : this.playerActive;
    const ownTeam = side === 'player' ? this.player : this.enemy;

    return {
      selfHpPct: self ? self.hpPct : null,
      foeHpPct: foe ? foe.hpPct : null,
      foeLevel: foe ? (Number(foe.level) || null) : null,
      foeHeld: foe?.held || null,
      // The cumulative multipliers as percentages, so +25% reads as 25 and a
      // debuff reads as a negative. Only a raised stat fires "opposing buffed".
      foeBuffs: foe
        ? Object.fromEntries(STAT_KEYS.map(k => [k, foe.buffPercent(k) ?? 0]))
        : null,
      /**
       * True when nothing else on this side can still fight. Read off the whole
       * team rather than a counter so it is right however the team got here.
       */
      lastStanding: ownTeam
        ? ownTeam.filter(b => !b.fainted).length <= 1
        : null,
      /**
       * The other creatures on this side, by species name. Fainted mates are
       * deliberately included: a team-composition ability is about who you
       * brought, not who is still up, and having it switch itself off mid-battle
       * for invisible reasons would be worse than the alternative.
       */
      teamMates: ownTeam
        ? ownTeam.filter(b => b !== self).map(b => b.species?.name).filter(Boolean)
        : null
    };
  }

  /**
   * Ability log lines for the current pairing, one per creature that has an
   * ability. Returns [] when the pairing has not changed since the last call,
   * so the log does not repeat itself every turn.
   *
   * Because both sides' opponent-based clauses depend on who is opposite them,
   * a change on either side re-reads both.
   */
  abilityLines({ force = false } = {}) {
    const pairing = `${this.playerActive?.key || '-'}|${this.enemyActive?.key || '-'}`;
    if (!force && pairing === this._abilityPairing) return [];
    this._abilityPairing = pairing;

    const events = [];
    for (const side of ['player', 'enemy']) {
      const self = side === 'player' ? this.playerActive : this.enemyActive;
      const read = this.abilityFor(side);
      if (!self || !read) continue;
      events.push({
        type: 'ability',
        side,
        actor: self.key,
        actorLabel: self.label,
        ability: read.ability.name,
        active: read.anyActive,
        // Only the clauses that fired are worth reading out; when none did, the
        // reasons explain why, which is the "not triggered" case.
        parts: read.clauses.map(c => ({
          active: c.active,
          reason: c.reason,
          effect: clauseEffectText(c.clause),
          condition: clauseConditionText(c.clause)
        })),
        dealMultiplier: read.dealMultiplier,
        takeMultiplier: read.takeMultiplier
      });
    }
    return events;
  }

  /**
   * "X is holding a Y" for whoever has just taken the field. Each creature is
   * announced once per battle rather than every turn, so a long fight does not
   * repeat itself, and it fires for both sides — a raid boss never holds
   * anything today, but nothing here assumes that.
   */
  heldLines() {
    const events = [];
    for (const side of ['player', 'enemy']) {
      const self = side === 'player' ? this.playerActive : this.enemyActive;
      if (!self?.heldDef) continue;
      if (this._heldAnnounced.has(self.key)) continue;
      this._heldAnnounced.add(self.key);
      events.push({
        type: 'held',
        side,
        actor: self.key,
        actorLabel: self.label,
        item: self.heldDef.name,
        detail: self.heldDef.blurb
      });
    }
    return events;
  }

  get playerActive() { return this.player[this.playerIndex] || null; }
  get enemyActive() { return this.enemy[this.enemyIndex] || null; }

  get playerRemaining() { return this.player.filter(b => !b.fainted).length; }
  get enemyRemaining() { return this.enemy.filter(b => !b.fainted).length; }

  /** Moves the player's active creature can use this turn. */
  get availableMoves() { return this.playerActive?.moves || []; }

  /* ---- one turn ---- */

  /**
   * Resolves a whole turn and returns the events that happened, so the UI can
   * play them back one at a time.
   */
  takeTurn(playerMoveIndex) {
    if (this.over) return [{ type: 'already-over' }];
    const mine = this.playerActive;
    const theirs = this.enemyActive;
    if (!mine || !theirs) return [{ type: 'already-over' }];

    const myMove = this.availableMoves[playerMoveIndex];
    if (!myMove) return [{ type: 'invalid-move' }];
    const theirMove = chooseAIMove(theirs, this.rng);

    this.turn++;
    const events = [{ type: 'turn', turn: this.turn }];

    // On the first turn, and after any switch, say what is being carried and
    // what the abilities are doing before anything swings. Both return nothing
    // when there is no news.
    events.push(...this.heldLines());
    events.push(...this.abilityLines());

    // Speed decides who swings first; equal speed is a coin flip.
    let first = 'player';
    if (theirs.stats.speed > mine.stats.speed) first = 'enemy';
    else if (theirs.stats.speed === mine.stats.speed) first = this.rng() < 0.5 ? 'player' : 'enemy';

    const order = first === 'player'
      ? [{ side: 'player', actor: mine, target: theirs, move: myMove },
         { side: 'enemy', actor: theirs, target: mine, move: theirMove }]
      : [{ side: 'enemy', actor: theirs, target: mine, move: theirMove },
         { side: 'player', actor: mine, target: theirs, move: myMove }];

    events.push({ type: 'order', first });

    for (const step of order) {
      // A creature knocked out by the first attack never gets to act, even
      // though a move was already chosen for it.
      if (step.actor.fainted) {
        events.push({
          type: 'skipped', side: step.side,
          actor: step.actor.key, actorLabel: step.actor.label,
          move: step.move?.name || null
        });
        continue;
      }
      events.push(...this.applyMove(step));
    }

    // Bring in replacements
    events.push(...this.handleFaints());

    // Win / lose
    if (this.enemyRemaining === 0) {
      this.over = true;
      this.winner = 'player';
      events.push({ type: 'end', winner: 'player' });
    } else if (this.playerRemaining === 0) {
      this.over = true;
      this.winner = 'enemy';
      events.push({ type: 'end', winner: 'enemy' });
    }

    this.log.push(...events);
    return events;
  }

  /**
   * Resolves a move's effect: a heal, a self-buff, a self-debuff, or a debuff on
   * the opponent. Separate from the damage step so a move can carry both.
   *
   * Every event names a `targetSide` — which side the affected battler is on —
   * because "who used the move" and "who it landed on" are no longer the same
   * thing, and the UI animates the sprite that changed.
   */
  applyMoveEffect({ side, actor, target, move }) {
    const fx = move.effect;
    if (!fx) return [];
    const otherSide = side === 'player' ? 'enemy' : 'player';

    if (fx.kind === 'healSelf') {
      const r = actor.heal(fx.amount);
      return [{
        type: 'heal', side, targetSide: side,
        actor: actor.key, actorLabel: actor.label,
        // What it actually restored, and what it tried to: a creature near full
        // health gets less than the number on the move.
        amount: r.healed, asked: fx.amount,
        hpBefore: r.before, hpAfter: r.after, maxHp: r.maxHp
      }];
    }

    const onSelf = fx.kind === 'buffSelf' || fx.kind === 'debuffSelf';
    const who = onSelf ? actor : target;
    // Nothing worth changing on something already knocked out — it is about to
    // be replaced by a fresh creature anyway. True of a drawback that would
    // strengthen the opponent as much as of a debuff that weakens it.
    if (!onSelf && who.fainted) return [];

    // Whether the stats go up or down, which is independent of who they land on:
    // a move can raise the *opponent's* stats as the price of its own power.
    const up = fx.kind === 'buffSelf' || fx.kind === 'buffOpponent';
    // A mythical's buff raises several stats at once, so this is always a list.
    const applied = fx.stats.map(stat => {
      const r = up ? who.applyBuff(stat, fx.pct) : who.applyDebuff(stat, fx.pct);
      return {
        stat, statLabel: STAT_LABELS[stat],
        before: r.before, after: r.after,
        totalPct: who.buffPercent(stat)
      };
    });

    return [{
      type: up ? 'buff' : 'debuff',
      side,
      targetSide: onSelf ? side : otherSide,
      onSelf,
      actor: who.key, actorLabel: who.label,
      pct: Math.round(fx.pct * 100),
      stats: applied,
      // The first stat is repeated at the top level so older readers of this
      // event still see something sensible.
      stat: applied[0]?.stat ?? null,
      statLabel: applied[0]?.statLabel ?? '',
      before: applied[0]?.before ?? null,
      after: applied[0]?.after ?? null,
      totalPct: applied[0]?.totalPct ?? null
    }];
  }

  applyMove({ side, actor, target, move }) {
    const events = [{
      type: 'move', side, actor: actor.key, actorLabel: actor.label,
      move: move.name, isBuff: !!move.isBuff, isStatus: !!move.isStatus,
      power: move.power
    }];

    /* Damage and effect are two independent steps rather than a fork, because a
       move can now do both: "Breeze Nuzzle" hits for 25 and raises its own
       Attack, "Bark Bash" hits for 20 and heals 40. A move with no power just
       skips the first step. */
    if (move.power <= 0) {
      events.push(...this.applyMoveEffect({ side, actor, target, move }));
      return events;
    }

    const eff = effectivenessOf(actor.type, target.type);

    // The attacker's "deal" side and the defender's "take" side both apply, so
    // a hard hitter swinging into something fragile compounds.
    const attackerRead = this.abilityFor(side);
    const defenderRead = this.abilityFor(side === 'player' ? 'enemy' : 'player');
    const dealMultiplier = attackerRead?.dealMultiplier ?? 1;
    const takeMultiplier = defenderRead?.takeMultiplier ?? 1;

    const dmg = damageOf(
      move, actor.type, actor.stats.attack, target.type, target.stats.defence,
      { dealMultiplier, takeMultiplier }
    );
    const hpBefore = target.hp;

    /**
     * A Miracle Coin turns one lethal blow into a survivable one, but only from
     * full health. A creature already carrying damage dies like anything else,
     * which is what stops it being a free extra life every turn.
     */
    let dealt = dmg;
    let saved = null;
    if (target.heldDef?.effect === 'survive'
      && target.hp === target.maxHp
      && dmg >= target.hp) {
      dealt = target.hp - 1;
      saved = target.heldDef.name;
    }

    target.takeDamage(dealt);

    events.push({
      type: 'damage', side, actor: actor.key, target: target.key,
      targetLabel: target.label,
      amount: dealt,
      // The blow it would have been, so the log can say what was survived.
      wouldHaveBeen: saved ? dmg : null,
      savedBy: saved,
      superEffective: eff.superEffective,
      notVeryEffective: eff.notVeryEffective,
      // Named so the UI can say why a number looked surprising.
      abilityDeal: dealMultiplier !== 1 ? attackerRead.ability.name : null,
      abilityTake: takeMultiplier !== 1 ? defenderRead.ability.name : null,
      hpBefore, hpAfter: target.hp, maxHp: target.maxHp
    });

    // The rider effect lands after the hit, so a move that heals its user still
    // does so on the turn it knocks something out.
    events.push(...this.applyMoveEffect({ side, actor, target, move }));

    if (target.fainted) {
      events.push({
        type: 'faint',
        side: side === 'player' ? 'enemy' : 'player',
        actor: target.key, label: target.label
      });
      // Whatever the creature that just went down was carrying in its ability
      // goes off now, on the way out.
      events.push(...this.partingShot(target, actor, side === 'player' ? 'enemy' : 'player'));
    }
    return events;
  }

  /**
   * A knocked-out creature's last act, for an ability that deals damage as it
   * faints. Takes a share of whatever the attacker has left, so it punishes
   * something healthy walking in and does little against something nearly down.
   *
   * Read at the moment of the faint rather than in advance, because the
   * condition and the attacker's remaining HP are both only true now.
   */
  partingShot(fallen, attacker, fallenSide) {
    const ability = fallen?.species?.ability;
    if (!ability || !attacker || attacker.fainted) return [];

    const read = evaluateAbility(ability, {
      opponent: attacker.species || null,
      now: this.env.now,
      weather: this.env.weather,
      daily: this.env.daily,
      world: this.env.world,
      battle: this.battleReadings(fallenSide)
    });
    if (!read.faintPercent) return [];

    const dealt = faintDamage(read.faintPercent, attacker.hp);
    if (dealt <= 0) return [];

    const hpBefore = attacker.hp;
    attacker.takeDamage(dealt);

    const events = [{
      type: 'partingShot',
      side: fallenSide,
      targetSide: fallenSide === 'player' ? 'enemy' : 'player',
      actor: fallen.key, actorLabel: fallen.label,
      target: attacker.key, targetLabel: attacker.label,
      ability: read.ability.name,
      percent: read.faintPercent,
      amount: dealt,
      hpBefore, hpAfter: attacker.hp, maxHp: attacker.maxHp
    }];

    // It can take the attacker with it, which is the whole point of a last hit.
    if (attacker.fainted) {
      events.push({
        type: 'faint',
        side: fallenSide === 'player' ? 'enemy' : 'player',
        actor: attacker.key, label: attacker.label
      });
    }
    return events;
  }

  /** Advances each side past any fainted active creature. */
  handleFaints() {
    const events = [];
    let switched = false;
    if (this.playerActive?.fainted) {
      const next = this.player.findIndex((b, i) => i > this.playerIndex && !b.fainted);
      if (next !== -1) {
        this.playerIndex = next;
        switched = true;
        events.push({ type: 'switch', side: 'player', actor: this.playerActive.key, label: this.playerActive.label });
      }
    }
    if (this.enemyActive?.fainted) {
      const next = this.enemy.findIndex((b, i) => i > this.enemyIndex && !b.fainted);
      if (next !== -1) {
        this.enemyIndex = next;
        switched = true;
        events.push({ type: 'switch', side: 'enemy', actor: this.enemyActive.key, label: this.enemyActive.label });
      }
    }
    // A new creature on either side means every opponent-based clause has to be
    // read again — for both of them, not just the one that changed — and the
    // newcomer's held item gets its introduction.
    if (switched) {
      events.push(...this.heldLines());
      events.push(...this.abilityLines());
    }
    return events;
  }

  /** HP to write back to storage for the player's creatures. */
  playerResults() {
    return this.player
      .filter(b => b.uid)
      .map(b => ({ uid: b.uid, hp: b.hp }));
  }

  /** A short readable description of a move, for the move buttons. */
  static describeMove(move) {
    if (!move) return '';
    // "40 power", "Heals 40 HP", or "20 power · Heals 40 HP" for one that does both.
    return moveSummaryText(move);
  }
}

/* ---------------------------------------------------------------
   Convenience builders
   --------------------------------------------------------------- */

/**
 * The world abilities are judged against. Read once when a battle starts: the
 * temperature comes from the same reading the HUD chip shows, and is null when
 * that is unknown, which switches temperature clauses off entirely.
 */
export function battleEnv() {
  // The same assembled world spawn restrictions are judged against, so an
  // ability and a restriction can never disagree about the temperature or how
  // far the player has walked today.
  return store.ambientContext();
}

export function buildRaidBattle(creatures, raid, rng = Math.random) {
  return new Battle({
    player: creatures.map(battlerFromCreature),
    enemy: [battlerFromRaid(raid)],
    kind: 'raid',
    rng,
    env: battleEnv()
  });
}

export function buildGruntBattle(creatures, team, rng = Math.random) {
  return new Battle({
    player: creatures.map(battlerFromCreature),
    enemy: team.map(battlerFromEnemySpec),
    kind: 'grunt',
    rng,
    env: battleEnv()
  });
}

/**
 * A Battle Frontier trainer battle. Three against three like a grunt, but the
 * opposing team carries held items and stat boosts, so it gets its own spec
 * reader. `kind` stays 'grunt' for the turn loop's purposes — nothing in the
 * fight itself behaves differently, only the reward and the restriction around
 * it do.
 */
export function buildFrontierBattle(creatures, team, rng = Math.random) {
  return new Battle({
    player: creatures.map(battlerFromCreature),
    enemy: team.map(battlerFromFrontierSpec),
    kind: 'grunt',
    rng,
    env: battleEnv()
  });
}

export { BATTLE_TEAM_SIZE };
