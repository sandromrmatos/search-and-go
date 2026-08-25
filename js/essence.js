/* ============================================================
   essence.js — Essence Harvesting, the tap-the-rings mini-game

   A creature you have registered drifts around the board inside three
   concentric rings. Each tap spends one pin and pays candy by how close to the
   centre it landed: 3 for the bullseye, 2 for the middle ring, 1 for the outer
   one, nothing for a miss.

   How many pins you get is decided when the game opens, from how far away the
   essence is — so you can always play from the sofa, you just get one shot.
   Rarer creatures drift faster and have tighter rings.
   ============================================================ */

import {
  species, familyName, RARITY_NAMES, familyRarity,
  essenceDifficulty, essenceRingHit, essencePinsFor,
  ESSENCE_RING_CANDY, ESSENCE_MAX_PINS, ESSENCE_SEEKER_CHANCE, ESSENCE_PIN_BANDS
} from './data.js';
import { store } from './state.js';
import { itemImage, itemName } from './items.js';
import { $, el, toast, openSheet, closeSheet, num } from './ui.js';

const CANDY_ICON = '🍬';

let refresh = null;      // repaint the rest of the UI once candy has landed
let onCollected = null;  // tell main.js to tick the point off the map

export function initEssence({ onChange, onDone } = {}) {
  refresh = onChange;
  onCollected = onDone;
}

/* ---------------------------------------------------------------
   One game
   --------------------------------------------------------------- */

/** Everything about the game currently on screen. Null when nothing is open. */
let game = null;

/**
 * Opens the harvest for one map point.
 * @param {object} point   the essence point that was tapped
 * @param {number} metres  how far away the player is, which sets the pins
 */
export function openEssence(point, metres) {
  const sp = species(point.speciesId);
  if (!sp) { toast('That essence has faded', 'bad'); return; }

  // Opening a second essence without closing the first would leave the old
  // animation loop running against a board that is no longer on screen, and it
  // would keep shoving the new game around from a detached, zero-sized rect.
  stopDrift();

  const rarity = sp.rarity || familyRarity(sp.id) || 1;
  const diff = essenceDifficulty(rarity);

  game = {
    pointId: point.id,
    sp,
    rarity,
    diff,
    pins: essencePinsFor(metres),
    pinsUsed: 0,
    candy: 0,
    hits: [],
    metres,
    // Position and heading in board coordinates, filled in on the first frame.
    x: 0, y: 0,
    angle: Math.random() * Math.PI * 2,
    raf: 0,
    last: 0,
    over: false
  };

  renderBoard();
  openSheet('essence');
  startDrift();
}

/** Tears the game down. Safe to call twice. */
function stopDrift() {
  if (game?.raf) cancelAnimationFrame(game.raf);
  if (game) game.raf = 0;
}

function startDrift() {
  const board = $('#essence-board');
  const target = $('#essence-target');
  if (!board || !target || !game) return;

  // Start in the middle, then bounce around the board edges.
  const rect = board.getBoundingClientRect();
  game.x = rect.width / 2;
  game.y = rect.height / 2;
  game.last = performance.now();
  place();

  const step = ts => {
    if (!game || game.over) return;
    const dt = Math.min(0.05, (ts - game.last) / 1000);   // clamp a tab-switch
    game.last = ts;

    const r = board.getBoundingClientRect();
    const pad = game.diff.rings.outer;
    game.x += Math.cos(game.angle) * game.diff.speed * dt;
    game.y += Math.sin(game.angle) * game.diff.speed * dt;

    // Bounce off the walls, with a small random kick so the path never settles
    // into a boring diagonal loop.
    if (game.x < pad) { game.x = pad; game.angle = Math.PI - game.angle + jitter(); }
    if (game.x > r.width - pad) { game.x = r.width - pad; game.angle = Math.PI - game.angle + jitter(); }
    if (game.y < pad) { game.y = pad; game.angle = -game.angle + jitter(); }
    if (game.y > r.height - pad) { game.y = r.height - pad; game.angle = -game.angle + jitter(); }

    place();
    game.raf = requestAnimationFrame(step);
  };
  game.raf = requestAnimationFrame(step);
}

const jitter = () => (Math.random() - 0.5) * 0.6;

function place() {
  const target = $('#essence-target');
  if (!target || !game) return;
  target.style.transform = `translate(${game.x}px, ${game.y}px) translate(-50%, -50%)`;
}

/* ---------------------------------------------------------------
   Rendering
   --------------------------------------------------------------- */

function renderBoard() {
  const host = $('#essence-body');
  if (!host || !game) return;
  const { sp, diff, rarity } = game;
  host.innerHTML = '';

  $('#essence-title').textContent = `${sp.name}'s essence`;

  const board = el('div', { class: 'essence-board', id: 'essence-board', onclick: onTap },
    el('div', { class: 'essence-target', id: 'essence-target' },
      el('span', { class: 'ring outer', style: sizeOf(diff.rings.outer) }),
      el('span', { class: 'ring mid', style: sizeOf(diff.rings.mid) }),
      el('span', { class: 'ring inner', style: sizeOf(diff.rings.inner) }),
      el('img', {
        src: sp.imagePath, alt: sp.name, class: 'essence-art',
        style: { width: `${diff.artPx}px`, height: `${diff.artPx}px` }
      })
    )
  );

  host.append(
    el('p', { class: 'muted small', html: `Tap the rings to draw out its essence. Closer to the middle pays more: `
      + `<b>${ESSENCE_RING_CANDY.inner}</b> in the bullseye, <b>${ESSENCE_RING_CANDY.mid}</b> in the middle ring, `
      + `<b>${ESSENCE_RING_CANDY.outer}</b> in the outer one. A miss costs a pin and pays nothing.` }),
    el('div', { class: 'essence-meta' },
      el('span', { class: `rar r-${rarity}`, text: String(rarity) }),
      el('span', { text: RARITY_NAMES[rarity] || `Rarity ${rarity}` }),
      el('span', { class: 'muted', text: `· ${Math.round(game.metres)} m away` })
    ),
    pinRow(),
    board,
    el('p', { class: 'hint', id: 'essence-tally', text: `${CANDY_ICON} 0 candy so far` })
  );
}

const sizeOf = r => ({ width: `${r * 2}px`, height: `${r * 2}px` });

function pinRow() {
  const left = game.pins - game.pinsUsed;
  return el('div', { class: 'essence-pins', id: 'essence-pins' },
    ...Array.from({ length: game.pins }, (_, i) =>
      el('span', { class: 'pin' + (i < left ? '' : ' spent'), text: '📍' })),
    el('span', { class: 'muted small', text: `${left} of ${game.pins} pin${game.pins === 1 ? '' : 's'} left` })
  );
}

function repaintPins() {
  const row = $('#essence-pins');
  if (row) row.replaceWith(pinRow());
  const tally = $('#essence-tally');
  if (tally) tally.textContent = `${CANDY_ICON} ${game.candy} candy so far`;
}

/* ---------------------------------------------------------------
   Tapping
   --------------------------------------------------------------- */

function onTap(e) {
  if (!game || game.over) return;
  const board = $('#essence-board');
  if (!board) return;

  const r = board.getBoundingClientRect();
  const px = e.clientX - r.left;
  const py = e.clientY - r.top;
  const dist = Math.hypot(px - game.x, py - game.y);

  const ring = essenceRingHit(dist, game.diff.rings);
  const gained = ring ? ESSENCE_RING_CANDY[ring] : 0;

  game.pinsUsed++;
  game.candy += gained;
  game.hits.push(ring || 'miss');

  splash(board, px, py, ring, gained);
  repaintPins();

  if (game.pinsUsed >= game.pins) finish();
}

/** A short "+3" or "miss" where the player tapped. */
function splash(board, px, py, ring, gained) {
  const mark = el('span', {
    class: `essence-splash${ring ? ' hit-' + ring : ' miss'}`,
    style: { left: px + 'px', top: py + 'px' },
    text: gained ? `+${gained}` : 'miss'
  });
  board.append(mark);
  setTimeout(() => mark.remove(), 700);
}

/* ---------------------------------------------------------------
   The result
   --------------------------------------------------------------- */

/**
 * Banks the harvest and spends the point. Split out from the result screen so
 * backing out mid-game still pays for the pins already thrown.
 */
function bank() {
  game.over = true;
  stopDrift();
  const res = store.finishEssenceHarvest(game.sp.id, game.candy);
  // The point is spent whether or not any candy came out of it.
  onCollected?.(game.pointId);
  return res;
}

function finish() {
  if (!game || game.over) return;
  const res = bank();

  const host = $('#essence-body');
  const { sp } = game;
  const best = game.hits.filter(h => h === 'inner').length;

  host.innerHTML = '';
  host.append(
    el('div', { class: 'essence-result' },
      el('img', { src: sp.imagePath, alt: sp.name, class: 'essence-result-art' }),
      el('h4', { text: game.candy
        ? `${CANDY_ICON} +${game.candy} ${familyName(sp.id)} candy`
        : 'No essence drawn this time' }),
      el('p', { class: 'muted small', text: game.candy
        ? `You now hold ${num(res.candyTotal)} ${familyName(sp.id)} candy.`
        : 'Every pin missed the rings. The essence fades either way — try the next one.' }),
      el('div', { class: 'essence-breakdown' },
        ...['inner', 'mid', 'outer', 'miss'].map(k => {
          const n = game.hits.filter(h => h === k).length;
          if (!n) return null;
          const label = k === 'miss' ? 'missed' : `${k === 'inner' ? 'bullseye' : k + ' ring'}`;
          return el('span', { class: 'essence-tag' + (k === 'miss' ? ' miss' : ''), text: `${n}× ${label}` });
        })
      ),
      best === game.pins && game.pins > 1
        ? el('p', { class: 'hint', text: 'Every pin in the bullseye. Nicely done.' })
        : null,
      res.seeker
        ? el('div', { class: 'essence-bonus' },
            el('img', { src: itemImage('molten_seeker'), alt: '' }),
            el('span', { html: `A <b>${itemName('molten_seeker')}</b> came out with it!` })
          )
        : null,
      el('button', { class: 'btn primary wide', onclick: close }, 'Done')
    )
  );

  if (game.candy) toast(`${CANDY_ICON} +${game.candy} ${familyName(sp.id)} candy`, 'good');
  if (res.seeker) toast(`You found a ${itemName('molten_seeker')}!`, 'good', 3600);
  refresh?.();
}

function close() {
  stopDrift();
  game = null;
  closeSheet('essence');
  refresh?.();
}

/**
 * Backing out of the sheet mid-game. The essence is still spent — otherwise it
 * could be reopened until the rings happened to line up — but whatever was
 * already won is banked, and the sheet closes rather than showing a result
 * screen the player just asked to leave.
 */
export function abandonEssence() {
  if (!game) return;
  if (game.over) { game = null; return; }

  const { sp, candy } = game;
  const res = bank();
  game = null;
  closeSheet('essence');

  if (candy) {
    toast(`${CANDY_ICON} +${candy} ${familyName(sp.id)} candy banked`, 'good');
    if (res.seeker) toast(`You found a ${itemName('molten_seeker')}!`, 'good', 3600);
  } else {
    toast('The essence faded away', '');
  }
  refresh?.();
}

/**
 * Exposed for the info menu so the pin bands never have to be retyped. Sample
 * distances are derived from the bands themselves — they used to be a hardcoded
 * list, which silently stopped lining up the moment the bands were retuned.
 */
export const essencePinsPreview = () =>
  ESSENCE_PIN_BANDS.map(b => {
    const metres = b.over < 0 ? 10 : b.over + 15;
    return { metres, pins: essencePinsFor(metres) };
  });

export { ESSENCE_MAX_PINS, ESSENCE_SEEKER_CHANCE };
