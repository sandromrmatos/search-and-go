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
  movesForCreature, ABILITY_MULTIPLIER_MIN, ABILITY_MULTIPLIER_MAX,
  evaluateAbility, faintDamage, clauseEffectText, clauseConditionText, buffStatsLabel,
  moveEffectText, moveSummaryText,
  STAT_KEYS, STAT_LABELS, BATTLE_TEAM_SIZE, moveLevelFor, heldItem,
  STATUS_CONDITIONS, moveBuffsSelf, moveDebuffsOpponent,
  ELITE_STAMINA_START, ELITE_STAMINA_PER_TURN, ELITE_STAMINA_KO_BONUS, ELITE_SWITCH_COST,
  eliteMoveCost
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
    /**
     * Status conditions, by name. Most are just `true`; Iced and Loop carry
     * their own countdown. Cleared only by fainting, or by running out.
     */
    this.status = {};
    /** The move it used most recently, which is what Loop holds it to. */
    this.lastMove = null;
  }

  has(status) { return !!this.status[status]; }

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
    // movesForCreature, not sp.movesAt: a Precious Diamond raises one move's
    // power for this creature alone, and this is the one place that has to know.
    moves: movesForCreature(c, sp),
    held: c.held || null
  });
}

/** Raid boss: levelled stats with tripled HP and 10% more of everything else. */
export function battlerFromRaid(raid) {
  // A teleport raid is fought against the last form of the line.
  const sp = species(raid.bossId || raid.speciesId);
  return new Battler({
    speciesId: sp.id,
    level: raid.level,
    shiny: !!raid.shiny,
    stats: raidBossStats(sp, raid.level, !!raid.exclusive, !!raid.teleport),
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
  constructor({ player, enemy, kind = 'raid', rng = Math.random, env = null, elite = false }) {
    this.kind = kind;
    /**
     * Elite rules for the player's side: moves cost stamina and creatures can be
     * switched. `stamina` belongs to whichever creature is on the field; a
     * creature coming in (switched or sent after a faint) always starts full.
     */
    this.elite = !!elite;
    this.stamina = ELITE_STAMINA_START;
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

    /**
     * What each creature's ability was last seen doing, keyed "side:key".
     *
     * The damage step has always read abilities live — `applyMove` re-evaluates
     * both sides on every hit — so an ability that turns on at 60% HP has always
     * *worked* from the moment the bar crossed the line. What it did not do was
     * say so: the announcement only spoke when a creature took the field. This
     * remembers the last state so a mid-battle change can be reported once, when
     * it happens, rather than every turn or not at all.
     */
    this._abilityState = new Map();

    /** Creatures whose held item has already been announced. */
    this._heldAnnounced = new Set();

    /* ---- the fossil effects ----
       These belong to the *battle*, not to a battler, which is the whole point
       of them: the creature that set one up can faint and it stays in force.
       Held per side, so "our attacks" and "their attacks" stay straight even as
       creatures are swapped in and out.

       `incomingDown` and `outgoingUp` are cumulative multipliers, so a second
       use of the same move is worth something. They are clamped where they are
       read rather than here, so the ledger stays honest. */
    this.sideFx = {
      player: { incomingDown: 1, outgoingUp: 1 },
      enemy: { incomingDown: 1, outgoingUp: 1 }
    };

    /** Once true, the slower creature moves first for the rest of the fight. */
    this.speedInverted = false;

    /** Damage each side has taken so far *this turn*, for Reflect damage. */
    this.turnDamage = { player: 0, enemy: 0 };

    /**
     * Achievements ledger: HP each of the player's creatures actually took off
     * the opposition, by the opponent's type — uid -> { type -> amount }.
     * Overkill is not counted, so a 300-damage hit on a creature with 12 HP
     * left is worth 12.
     */
    this.damageByUid = {};
  }

  /** Credits a hit to the player's creature that landed it, if it was one. */
  creditDamage(attacker, target, hpBefore) {
    if (!attacker?.uid || !target || target.uid) return;
    const amount = Math.max(0, hpBefore - target.hp);
    if (!amount) return;
    const row = this.damageByUid[attacker.uid] || (this.damageByUid[attacker.uid] = {});
    row[target.type] = (row[target.type] || 0) + amount;
  }

  /**
   * The damage multiplier the lasting side effects contribute to one attack.
   * The attacker's own "we hit harder" and the defender's "we take less" both
   * apply, exactly like the two halves of an ability read.
   *
   * Clamped to the same band abilities use, so no stack of these can trivialise
   * a fight in either direction.
   */
  sideMultiplier(attackSide) {
    const defendSide = attackSide === 'player' ? 'enemy' : 'player';
    const raw = this.sideFx[attackSide].outgoingUp * this.sideFx[defendSide].incomingDown;
    return Math.min(ABILITY_MULTIPLIER_MAX, Math.max(ABILITY_MULTIPLIER_MIN, raw));
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
      // The announcement is also what seeds the change tracker, so a creature
      // just introduced is never immediately reported as having changed.
      this._rememberAbility(side, self, read);
      events.push(this._abilityEvent(side, self, read));
    }
    return events;
  }

  /** The shape the UI renders for one ability read. */
  _abilityEvent(side, self, read, extra = {}) {
    return {
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
      takeMultiplier: read.takeMultiplier,
      ...extra
    };
  }

  /**
   * Which clauses were firing, as a string. Compared rather than just `anyActive`
   * so an ability that swaps *which* of its clauses is doing the work is reported
   * too — that changes what it is doing, even though it stayed on throughout.
   */
  _abilitySignature(read) {
    return read.clauses.map(c => (c.active ? '1' : '0')).join('');
  }

  _rememberAbility(side, self, read) {
    this._abilityState.set(`${side}:${self.key}`, {
      active: read.anyActive,
      signature: this._abilitySignature(read)
    });
  }

  /**
   * Abilities whose state has just changed, as log events.
   *
   * Called after every move and after any switch, because that is when the things
   * abilities read mid-battle actually move: how hurt a creature is, whether it is
   * the last one standing, and what the opponent has raised. An ability that has
   * not changed says nothing, so a long fight does not fill the log with the same
   * line every turn.
   *
   * A creature with no remembered state is skipped rather than reported: it is
   * about to be introduced by `abilityLines`, which would say the same thing.
   */
  abilityChanges() {
    const events = [];
    for (const side of ['player', 'enemy']) {
      const self = side === 'player' ? this.playerActive : this.enemyActive;
      const read = this.abilityFor(side);
      if (!self || !read) continue;

      const prev = this._abilityState.get(`${side}:${self.key}`);
      const signature = this._abilitySignature(read);
      if (prev && prev.signature === signature) continue;
      this._rememberAbility(side, self, read);
      if (!prev) continue;

      events.push(this._abilityEvent(side, self, read, {
        changed: true,
        wasActive: prev.active
      }));
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

  /* ---- status conditions ---- */

  /** Current Speed, or 1 while Iced. */
  speedOf(b) {
    const iced = b?.status.Iced;
    if (iced && this.turn >= iced.from && this.turn <= iced.to) return 1;
    return b?.stats.speed ?? 0;
  }

  /**
   * Why the creature on `side` cannot use `move` right now, or null. Covers the
   * statuses that forbid a kind of move and the opponent's ability that limits
   * which slots may be used. Loop is not here: it forces a move rather than
   * forbidding one, and is resolved when the creature acts.
   */
  moveBlockedReason(side, move) {
    const self = side === 'player' ? this.playerActive : this.enemyActive;
    if (!self || !move) return null;
    if (self.has('Lock') && moveBuffsSelf(move)) return 'Lock';
    if (self.has('Rust') && moveDebuffsOpponent(move)) return 'Rust';
    if (self.has('Disorient') && move.slot === 4) return 'Disorient';
    const foeRead = this.abilityFor(side === 'player' ? 'enemy' : 'player');
    if (foeRead?.restrictSlots && !foeRead.restrictSlots.includes(move.slot)) {
      return { ability: foeRead.ability.name };
    }
    return null;
  }

  /** The moves the creature on `side` is allowed to pick this turn. */
  usableMoves(side) {
    const self = side === 'player' ? this.playerActive : this.enemyActive;
    if (!self) return [];
    const loop = self.status.Loop;
    // Locked into a move: that one, if nothing else forbids it.
    if (loop?.move) {
      const forced = self.moves.find(m => m === loop.move) || loop.move;
      return this.moveBlockedReason(side, forced) ? [] : [forced];
    }
    return self.moves.filter(m => !this.moveBlockedReason(side, m));
  }

  /**
   * Gives `target` a status condition. Refused if it is already carrying that
   * one, if it is knocked out, or if its ability makes it immune.
   * @returns the event to log, or null when nothing happened worth saying.
   */
  giveStatus(target, targetSide, status, source) {
    if (!target || target.fainted || !STATUS_CONDITIONS[status]) return null;
    const base = {
      type: 'status', targetSide, target: target.key, targetLabel: target.label,
      status, icon: STATUS_CONDITIONS[status].icon, source
    };
    const read = this.abilityFor(targetSide);
    if (read?.statusImmune) return { ...base, resisted: read.ability.name };
    if (target.has(status)) return { ...base, already: true };
    if (status === 'Iced') {
      target.status.Iced = { from: this.turn + 1, to: this.turn + STATUS_CONDITIONS.Iced.turns };
    } else if (status === 'Loop') {
      // Held to whatever it used last. If it has not moved yet, the next move it
      // makes becomes the one it is stuck with, and that counts as turn one.
      target.status.Loop = { move: target.lastMove || null, left: STATUS_CONDITIONS.Loop.turns };
    } else {
      target.status[status] = true;
    }
    return base;
  }

  /**
   * One creature's go: Loop decides the move, the statuses decide whether it
   * gets to use it, and then it is applied like any other.
   */
  act(step) {
    const { side, actor } = step;
    const events = [];
    let move = step.move;
    // Its target knocked itself out first (Hallucination), so there is nothing to hit.
    if (step.target?.fainted) return events;

    const loop = actor.status.Loop;
    if (loop) {
      if (!loop.move) loop.move = move;
      else if (move !== loop.move) {
        events.push({ type: 'statusForced', side, actor: actor.key, actorLabel: actor.label,
          status: 'Loop', move: loop.move.name, wanted: move?.name || null });
        move = loop.move;
      }
    }

    const finishLoop = () => {
      if (!loop) return;
      loop.left -= 1;
      if (loop.left <= 0) {
        delete actor.status.Loop;
        events.push({ type: 'statusEnd', targetSide: side, targetLabel: actor.label, status: 'Loop' });
      }
    };

    if (!move) {
      events.push({ type: 'statusBlocked', side, actor: actor.key, actorLabel: actor.label, reason: 'none' });
      finishLoop();
      return events;
    }
    const blocked = this.moveBlockedReason(side, move);
    if (blocked) {
      events.push({ type: 'statusBlocked', side, actor: actor.key, actorLabel: actor.label,
        move: move.name, reason: typeof blocked === 'string' ? blocked : 'ability',
        ability: blocked.ability || null });
      finishLoop();
      return events;
    }
    if (actor.has('Flux') && this.rng() < STATUS_CONDITIONS.Flux.chance) {
      events.push({ type: 'statusBlocked', side, actor: actor.key, actorLabel: actor.label,
        move: move.name, reason: 'Flux' });
      finishLoop();
      return events;
    }

    events.push(...this.applyMove({ ...step, move }));
    actor.lastMove = move;
    finishLoop();
    return events;
  }

  /** After both sides have moved: per-turn abilities, and Iced wearing off. */
  endOfTurn() {
    const events = [];
    for (const side of ['player', 'enemy']) {
      const self = side === 'player' ? this.playerActive : this.enemyActive;
      if (!self || self.fainted) continue;
      const read = this.abilityFor(side);
      if (read?.turnBuff) {
        const applied = read.turnBuff.stats.map(stat => {
          const r = self.applyBuff(stat, read.turnBuff.pct);
          return { stat, statLabel: STAT_LABELS[stat], before: r.before, after: r.after,
            totalPct: self.buffPercent(stat) };
        });
        events.push({
          type: 'buff', side, targetSide: side, onSelf: true,
          actor: self.key, actorLabel: self.label,
          pct: Math.round(read.turnBuff.pct * 100), stats: applied,
          stat: applied[0]?.stat, statLabel: applied[0]?.statLabel,
          before: applied[0]?.before, after: applied[0]?.after, totalPct: applied[0]?.totalPct,
          fromAbility: read.ability.name
        });
      }
      const iced = self.status.Iced;
      if (iced && this.turn >= iced.to) {
        delete self.status.Iced;
        events.push({ type: 'statusEnd', targetSide: side, targetLabel: self.label, status: 'Iced' });
      }
    }
    return events;
  }

  /* ---- Elite rules ---- */

  /** Stamina a move costs the player in an Elite battle; 0 everywhere else. */
  moveCost(move) { return this.elite ? eliteMoveCost(move) : 0; }

  /** Moves the player can pick right now: allowed by statuses and affordable. */
  affordableMoves() {
    return this.usableMoves('player').filter(m => this.moveCost(m) <= this.stamina);
  }

  /** Bench creatures the player could switch to, by team index. */
  switchTargets() {
    if (!this.elite) return [];
    return this.player
      .map((b, i) => ({ b, i }))
      .filter(({ b, i }) => i !== this.playerIndex && !b.fainted)
      .map(({ i }) => i);
  }

  canSwitch() {
    return this.elite && this.stamina >= ELITE_SWITCH_COST && this.switchTargets().length > 0;
  }

  /**
   * Stamina up by `n`. No ceiling: a free move on turn one banks the +3, so a
   * creature can walk into turn two with 13.
   */
  _gainStamina(n) {
    this.stamina += n;
    return n;
  }

  /**
   * A creature leaving the field forgets everything the fight did to it apart
   * from its HP: buffs, debuffs and status conditions all go.
   */
  _resetOnSwitchOut(b) {
    b.stats = { ...b.baseStats };
    b.buffs = {};
    b.status = {};
    b.lastMove = null;
  }

  /* ---- one turn ---- */

  /**
   * Resolves a whole turn and returns the events that happened, so the UI can
   * play them back one at a time.
   *
   * `switchTo` (Elite only) is a team index: instead of a move, the player swaps
   * creatures, and the opponent's move that turn lands on the one coming in.
   */
  takeTurn(playerMoveIndex, { switchTo = null } = {}) {
    if (this.over) return [{ type: 'already-over' }];
    let mine = this.playerActive;
    const theirs = this.enemyActive;
    if (!mine || !theirs) return [{ type: 'already-over' }];

    const switching = switchTo != null;
    let myMove = null;
    if (switching) {
      if (!this.canSwitch() || !this.switchTargets().includes(switchTo)) return [{ type: 'invalid-move' }];
    } else {
      /* Status conditions and abilities can take moves away, and in an Elite
         battle stamina can too. The player chooses from what is left; an index of
         -1 means "pass", which is only accepted when there is genuinely nothing
         to choose. */
      const myUsable = this.elite ? this.affordableMoves() : this.usableMoves('player');
      myMove = playerMoveIndex === -1 ? null : this.availableMoves[playerMoveIndex];
      if (myMove ? !myUsable.includes(myMove) : myUsable.length) return [{ type: 'invalid-move' }];
    }
    const theirUsable = this.usableMoves('enemy');
    const theirMove = theirUsable.length ? chooseAIMove({ moves: theirUsable }, this.rng) : null;

    this.turn++;
    const events = [{ type: 'turn', turn: this.turn }];

    if (switching) {
      // Out first, cleaned, so the incoming creature takes whatever is coming.
      const out = mine;
      this.stamina -= ELITE_SWITCH_COST;
      this._resetOnSwitchOut(out);
      this.playerIndex = switchTo;
      mine = this.playerActive;
      this.stamina = ELITE_STAMINA_START;
      events.push({ type: 'switch', side: 'player', manual: true,
        actor: mine.key, label: mine.label, outLabel: out.label });
    } else if (myMove) {
      const cost = this.moveCost(myMove);
      if (cost) {
        this.stamina -= cost;
        events.push({ type: 'stamina', change: -cost, stamina: this.stamina, reason: 'move', move: myMove.name });
      }
    }

    // On the first turn, and after any switch, say what is being carried and
    // what the abilities are doing before anything swings. Both return nothing
    // when there is no news.
    events.push(...this.heldLines());
    events.push(...this.abilityLines());

    // Nothing has been hit yet this turn, which is what Reflect damage reads.
    this.turnDamage = { player: 0, enemy: 0 };

    // Speed decides who swings first; equal speed is a coin flip. An Iced
    // creature's Speed counts as 1.
    const mySpeed = this.speedOf(mine);
    const theirSpeed = this.speedOf(theirs);
    let first = 'player';
    if (theirSpeed > mySpeed) first = 'enemy';
    else if (theirSpeed === mySpeed) first = this.rng() < 0.5 ? 'player' : 'enemy';
    /* Speed inversion flips the answer for the rest of the battle. Applied after
       the normal decision rather than by reversing the comparison, so a tie stays
       a coin flip instead of quietly becoming deterministic. */
    if (this.speedInverted && theirSpeed !== mySpeed) {
      first = first === 'player' ? 'enemy' : 'player';
    }

    const enemyStep = { side: 'enemy', actor: theirs, target: mine, move: theirMove };
    const playerStep = { side: 'player', actor: mine, target: theirs, move: myMove };
    // A switch is the player's whole turn, so only the opponent swings.
    const order = switching ? [enemyStep]
      : first === 'player' ? [playerStep, enemyStep] : [enemyStep, playerStep];

    events.push({ type: 'order', first: switching ? 'enemy' : first });

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
      const foeWasUp = step.side === 'player' && !step.target.fainted;
      events.push(...this.act(step));
      // Elite: knocking one of theirs out is worth a little stamina back.
      if (this.elite && foeWasUp && step.target.fainted && !step.actor.fainted) {
        const got = this._gainStamina(ELITE_STAMINA_KO_BONUS);
        if (got) events.push({ type: 'stamina', change: got, stamina: this.stamina, reason: 'ko' });
      }
      /* A hit is what moves the readings abilities watch — how hurt each side is,
         what the opponent has raised, whether anyone is now alone — so any ability
         that has just switched on or off says so here, next to the blow that did
         it, rather than at the top of some later turn. */
      events.push(...this.abilityChanges());
    }

    // Abilities that act every turn, and statuses that run out.
    events.push(...this.endOfTurn());

    /* Elite: the creature that chose a move (or waited) gets its breath back. A
       creature that has just been switched in is already full, so no top-up. */
    if (this.elite && !switching && !this.playerActive?.fainted) {
      const got = this._gainStamina(ELITE_STAMINA_PER_TURN);
      if (got) events.push({ type: 'stamina', change: got, stamina: this.stamina, reason: 'turn' });
    }

    // Bring in replacements
    const playerBefore = this.playerIndex;
    events.push(...this.handleFaints());
    // A creature sent in after a faint walks in with full stamina too.
    if (this.elite && this.playerIndex !== playerBefore) this.stamina = ELITE_STAMINA_START;
    /* And again after a switch: coming in as the last one standing, or against a
       different opponent, can flip an ability that the move loop could not see. */
    events.push(...this.abilityChanges());

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

    /* ---- the Crystal Canopy effects ---- */

    // Two effects in one move, applied in the order the sheet wrote them.
    if (fx.kind === 'combo') {
      return fx.parts.flatMap(part =>
        this.applyMoveEffect({ side, actor, target, move: { ...move, effect: part } }));
    }
    if (fx.kind === 'status') {
      if (target.fainted) return [];
      if (fx.chance < 1 && this.rng() >= fx.chance) return [];
      const e = this.giveStatus(target, otherSide, fx.status, { move: move.name, actorLabel: actor.label });
      return e ? [e] : [];
    }
    // Swaps two of the opponent's stats outright — base, current and any buff,
    // so a later buff or copy still adds up.
    if (fx.kind === 'statSwap') {
      if (target.fainted) return [];
      const [a, b] = fx.stats;
      const before = { [a]: target.stats[a], [b]: target.stats[b] };
      [target.stats[a], target.stats[b]] = [target.stats[b], target.stats[a]];
      [target.baseStats[a], target.baseStats[b]] = [target.baseStats[b], target.baseStats[a]];
      const ba = target.buffs[a], bb = target.buffs[b];
      if (bb == null) delete target.buffs[a]; else target.buffs[a] = bb;
      if (ba == null) delete target.buffs[b]; else target.buffs[b] = ba;
      return [{
        type: 'statSwap', side, targetSide: otherSide,
        actor: target.key, actorLabel: target.label,
        stats: [a, b].map(s => ({ stat: s, statLabel: STAT_LABELS[s], before: before[s], after: target.stats[s] }))
      }];
    }
    // A share of what the user has left. Never the last point: it is a price,
    // not a way to knock yourself out.
    if (fx.kind === 'loseHp') {
      const amount = Math.min(actor.hp - 1, Math.floor(actor.hp * fx.pct));
      if (amount <= 0) return [];
      const hpBefore = actor.hp;
      actor.takeDamage(amount);
      return [{
        type: 'hpCost', side, targetSide: side,
        actor: actor.key, actorLabel: actor.label,
        amount, pct: Math.round(fx.pct * 100),
        hpBefore, hpAfter: actor.hp, maxHp: actor.maxHp
      }];
    }
    if (fx.kind === 'healFull') {
      const r = actor.heal(actor.maxHp);
      return [{
        type: 'heal', side, targetSide: side,
        actor: actor.key, actorLabel: actor.label,
        amount: r.healed, asked: actor.maxHp,
        hpBefore: r.before, hpAfter: r.after, maxHp: r.maxHp
      }];
    }

    /* ---- the five fossil effects ----
       Handled before the buff/debuff machinery below because none of them is a
       stat change on one creature. */

    // Everything the other side does lands softer, for good.
    if (fx.kind === 'teamIncomingDown') {
      this.sideFx[side].incomingDown *= (1 - fx.pct);
      return [{
        type: 'sideFx', kind: fx.kind, side, targetSide: side,
        actor: actor.key, actorLabel: actor.label,
        pct: Math.round(fx.pct * 100),
        total: Math.round((1 - this.sideFx[side].incomingDown) * 100)
      }];
    }
    // Everything our side does lands harder, for good.
    if (fx.kind === 'teamOutgoingUp') {
      this.sideFx[side].outgoingUp *= (1 + fx.pct);
      return [{
        type: 'sideFx', kind: fx.kind, side, targetSide: side,
        actor: actor.key, actorLabel: actor.label,
        pct: Math.round(fx.pct * 100),
        total: Math.round((this.sideFx[side].outgoingUp - 1) * 100)
      }];
    }
    // The slower creature moves first from now on. Using it twice does not turn
    // it back — it is a state, not a toggle.
    if (fx.kind === 'speedInversion') {
      const already = this.speedInverted;
      this.speedInverted = true;
      return [{
        type: 'sideFx', kind: fx.kind, side, targetSide: side,
        actor: actor.key, actorLabel: actor.label,
        already
      }];
    }
    // Hands back a share of what the user took this turn. Nothing if it moved
    // first, or if the opponent did not attack — both read as zero damage taken.
    if (fx.kind === 'reflectDamage') {
      const taken = this.turnDamage[side] || 0;
      const dealt = Math.floor(taken * fx.pct);
      if (taken <= 0 || dealt <= 0 || target.fainted) {
        return [{
          type: 'reflect', side, targetSide: otherSide,
          actor: actor.key, actorLabel: actor.label,
          pct: Math.round(fx.pct * 100),
          taken, amount: 0, fizzled: true
        }];
      }
      const hpBefore = target.hp;
      target.takeDamage(dealt);
      this.creditDamage(actor, target, hpBefore);
      // Reflected damage counts as damage taken for the other side's own reflect.
      this.turnDamage[otherSide] = (this.turnDamage[otherSide] || 0) + dealt;
      const events = [{
        type: 'reflect', side, targetSide: otherSide,
        actor: actor.key, actorLabel: actor.label,
        target: target.key, targetLabel: target.label,
        pct: Math.round(fx.pct * 100),
        taken, amount: dealt, fizzled: false,
        hpBefore, hpAfter: target.hp, maxHp: target.maxHp
      }];
      if (target.fainted) {
        events.push({
          type: 'faint', side: otherSide, actor: target.key, label: target.label
        });
        events.push(...this.partingShot(target, actor, otherSide));
      }
      return events;
    }
    // Takes the opponent's stat changes wholesale, replacing whatever it had.
    if (fx.kind === 'copyStats') {
      const copied = { ...target.buffs };
      actor.buffs = copied;
      // Re-derive the stats from base, so replacing really replaces rather than
      // layering the copy on top of what was already there.
      for (const k of STAT_KEYS) {
        if (k === 'hp') continue;
        const mult = copied[k] || 1;
        actor.stats[k] = Math.max(1, Math.round(actor.baseStats[k] * mult));
      }
      const stats = STAT_KEYS
        .filter(k => k !== 'hp' && (copied[k] || 1) !== 1)
        .map(k => ({ stat: k, statLabel: STAT_LABELS[k], totalPct: actor.buffPercent(k) }));
      return [{
        type: 'copyStats', side, targetSide: side,
        actor: actor.key, actorLabel: actor.label,
        from: target.key, fromLabel: target.label,
        stats,
        // Nothing to copy is a real outcome worth reporting rather than silence.
        nothing: stats.length === 0
      }];
    }

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

    /* Hallucination: one hit in four turns on its owner. The blow is worked out
       exactly as it would have landed, and the whole move — its rider effect
       included — is spent on the attacker instead. */
    if (actor.has('Hallucination') && this.rng() < STATUS_CONDITIONS.Hallucination.chance) {
      const selfDmg = damageOf(
        move, actor.type, actor.stats.attack, target.type, target.stats.defence,
        { dealMultiplier: (attackerRead?.dealMultiplier ?? 1) * this.sideMultiplier(side),
          takeMultiplier: defenderRead?.takeMultiplier ?? 1 }
      );
      const hpBefore = actor.hp;
      actor.takeDamage(selfDmg);
      events.push({
        type: 'damage', side, actor: actor.key, target: actor.key, targetLabel: actor.label,
        amount: selfDmg, selfHit: 'Hallucination',
        hpBefore, hpAfter: actor.hp, maxHp: actor.maxHp
      });
      if (actor.fainted) {
        events.push({ type: 'faint', side, actor: actor.key, label: actor.label });
        events.push(...this.partingShot(actor, target, side));
      }
      return events;
    }
    const dealMultiplier = attackerRead?.dealMultiplier ?? 1;
    const takeMultiplier = defenderRead?.takeMultiplier ?? 1;

    /* The lasting side effects ride on top of the ability multipliers. Folded
       into `dealMultiplier` because damageOf already multiplies the two together
       and there is nothing to be gained from a third parameter. */
    const sideMult = this.sideMultiplier(side);

    const dmg = damageOf(
      move, actor.type, actor.stats.attack, target.type, target.stats.defence,
      { dealMultiplier: dealMultiplier * sideMult, takeMultiplier }
    );
    const hpBefore = target.hp;

    /**
     * A Miracle Coin turns one lethal blow into a survivable one, but only from
     * full health. A creature already carrying damage dies like anything else,
     * which is what stops it being a free extra life every turn.
     */
    let dealt = dmg;
    let saved = null;
    // An ability that shrugs off everything but a single point while at full HP.
    // Checked first: it is the stronger of the two, and 1 damage never kills.
    let sturdy = null;
    if (defenderRead?.sturdy && target.hp === target.maxHp && dmg > 1) {
      dealt = 1;
      sturdy = defenderRead.ability.name;
    } else if (target.heldDef?.effect === 'survive'
      && target.hp === target.maxHp
      && dmg >= target.hp) {
      dealt = target.hp - 1;
      saved = target.heldDef.name;
    }

    target.takeDamage(dealt);
    this.creditDamage(actor, target, hpBefore);
    /* Banked for Reflect damage, which pays back a share of what its user took
       *this turn*. Keyed by the side that was hit. */
    const hitSide = side === 'player' ? 'enemy' : 'player';
    this.turnDamage[hitSide] = (this.turnDamage[hitSide] || 0) + dealt;

    events.push({
      type: 'damage', side, actor: actor.key, target: target.key,
      targetLabel: target.label,
      amount: dealt,
      // Named so the log can explain a number the stats alone do not account for.
      sideFx: sideMult !== 1 ? Math.round((sideMult - 1) * 100) : null,
      // The blow it would have been, so the log can say what was survived.
      wouldHaveBeen: saved || sturdy ? dmg : null,
      savedBy: saved,
      sturdyBy: sturdy,
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

    /* Abilities that answer being hit: a status thrown back at the attacker, or
       a heal. Read off the defender as it stood when the blow landed. */
    for (const { status, chance } of defenderRead?.onHitStatus || []) {
      if (chance < 1 && this.rng() >= chance) continue;
      const e = this.giveStatus(actor, side, status, { ability: defenderRead.ability.name, actorLabel: target.label });
      if (e) events.push(e);
    }
    if (defenderRead?.healOnHit && !target.fainted) {
      const r = target.heal(defenderRead.healOnHit);
      events.push({
        type: 'heal', side: hitSide, targetSide: hitSide,
        actor: target.key, actorLabel: target.label,
        amount: r.healed, asked: defenderRead.healOnHit,
        hpBefore: r.before, hpAfter: r.after, maxHp: r.maxHp,
        fromAbility: defenderRead.ability.name
      });
    }

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

    const events = [];
    const attackerSide = fallenSide === 'player' ? 'enemy' : 'player';
    // A debuff on the way down, rather than (or as well as) a last hit.
    if (read.faintDebuff) {
      const applied = read.faintDebuff.stats.map(stat => {
        const r = attacker.applyDebuff(stat, read.faintDebuff.pct);
        return { stat, statLabel: STAT_LABELS[stat], before: r.before, after: r.after,
          totalPct: attacker.buffPercent(stat) };
      });
      events.push({
        type: 'debuff', side: fallenSide, targetSide: attackerSide, onSelf: false,
        actor: attacker.key, actorLabel: attacker.label,
        pct: Math.round(read.faintDebuff.pct * 100), stats: applied,
        stat: applied[0]?.stat, statLabel: applied[0]?.statLabel,
        before: applied[0]?.before, after: applied[0]?.after, totalPct: applied[0]?.totalPct,
        fromAbility: read.ability.name, fromLabel: fallen.label
      });
    }
    if (!read.faintPercent) return events;

    const dealt = faintDamage(read.faintPercent, attacker.hp);
    if (dealt <= 0) return events;

    const hpBefore = attacker.hp;
    attacker.takeDamage(dealt);
    // A player's creature going down can still land this last hit.
    this.creditDamage(fallen, attacker, hpBefore);

    events.push({
      type: 'partingShot',
      side: fallenSide,
      targetSide: fallenSide === 'player' ? 'enemy' : 'player',
      actor: fallen.key, actorLabel: fallen.label,
      target: attacker.key, targetLabel: attacker.label,
      ability: read.ability.name,
      percent: read.faintPercent,
      amount: dealt,
      hpBefore, hpAfter: attacker.hp, maxHp: attacker.maxHp
    });

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
      /* The next one standing after this one, wrapping round to the start. In an
         Elite battle you can switch to your third creature with the first two
         still fit; looking only further down the team found nobody when that
         third one fainted, and the battle froze with two creatures left. */
      const n = this.player.length;
      let next = -1;
      for (let k = 1; k < n && next === -1; k++) {
        const i = (this.playerIndex + k) % n;
        if (!this.player[i].fainted) next = i;
      }
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
    env: battleEnv(),
    // Teleport raids are fought under Elite rules.
    elite: !!raid.teleport
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

/**
 * An Elite Battle: a Frontier-style team on the other side, and the stamina and
 * switching rules on the player's.
 */
export function buildEliteBattle(creatures, team, rng = Math.random) {
  return new Battle({
    player: creatures.map(battlerFromCreature),
    enemy: team.map(battlerFromFrontierSpec),
    kind: 'grunt',
    rng,
    env: battleEnv(),
    elite: true
  });
}

export { BATTLE_TEAM_SIZE };
