/* ============================================================
   fossils.js — the fossil parts, the assistant and the revival

   Three screens and one reveal:

     • "Oh, it looks like you found something on the ground" — the dialogue that
       fires when a part turns up. The part is already in the bag by then; this is
       only the reveal, so missing it costs nothing.
     • The assistant at a pharmacy or hospital, who asks whether you have four
       parts and how many sets you want to hand over.
     • Coming back a day later to collect, which plays the ordinary capture
       animation once per creature revived.

   Kept in its own module rather than bolted onto views.js because it is a
   self-contained loop with its own artwork and its own sheets.
   ============================================================ */

import {
  FOSSIL_PARTS, FOSSIL_REVIVE_MS, FOSSIL_REVIVE_LEVEL, FOSSIL_REVIVE_BONUS_CANDY,
  FOSSIL_SHINY_ODDS, FOSSIL_FIND_CHANCE, FOSSIL_FINDS, IMAGE_DIR,
  familyName, species, RULES
} from './data.js';
import { store } from './state.js';
import { itemImage, itemName, ITEMS } from './items.js';
import { playCapture } from './anim.js';
import {
  $, el, appendAll, toast, openSheet, closeSheet, num, hoursMinutesLabel
} from './ui.js';

const CANDY_ICON = '🍬';
const DUST_ICON = '✨';

/** The assistant's portrait. */
export const ASSISTANT_ART = `${IMAGE_DIR}/assistant.png`;

let refresh = null;
let mapChanged = null;

export function initFossils({ onChange, onMapChange } = {}) {
  refresh = onChange;
  mapChanged = onMapChange;
}

/* ===============================================================
   "You found something on the ground"
   =============================================================== */

/** True while a reveal is on screen, so the loop does not stack them. */
let revealing = false;
export const isRevealingFossil = () => revealing;

/**
 * Shows the next queued find, if there is one.
 *
 * Two steps on purpose: the first says only that you found *something*, the
 * second turns it over. That beat is the whole appeal of the mechanic, and it
 * costs nothing because the item is already yours.
 */
export function showFossilReveal() {
  if (revealing) return false;
  const next = store.takeFossilReveal();
  if (!next) return false;
  revealing = true;

  const def = ITEMS[next.part];
  const source = FOSSIL_FINDS.find(f => f.id === next.from);
  const body = $('#fossil-find-body');
  body.innerHTML = '';

  const reveal = () => {
    body.innerHTML = '';
    const tally = store.fossilTally();
    appendAll(body,
      el('div', { class: 'fossil-reveal' },
        el('img', { src: itemImage(next.part), alt: def?.name || 'A fossil part' }),
        el('h3', { text: def?.name || 'A fossil part' }),
        el('p', { class: 'muted', text: `You now have ${num(store.itemCount(next.part))}.` })
      ),
      // Where it came from, so the mechanic teaches itself.
      source
        ? el('p', { class: 'hint', text: `Fossil parts turn up ${source.label}, `
          + `about ${Math.round(FOSSIL_FIND_CHANCE * 100)}% of the time.` })
        : null,
      partTallyRow(tally),
      el('p', { class: 'hint', text: tally.sets > 0
        ? `That is a complete set. Take it to a pharmacy or hospital — look for the ✚ on your map.`
        : 'Collect all four parts, then take them to a pharmacy or hospital.' }),
      el('button', {
        class: 'btn primary wide',
        onclick: () => { closeSheet('fossil-find'); finish(); }
      }, 'Take it')
    );
  };

  const finish = () => {
    revealing = false;
    refresh?.();
  };

  appendAll(body,
    el('div', { class: 'fossil-reveal mystery' },
      el('div', { class: 'fossil-mystery', text: '?' }),
      el('h3', { text: 'Oh, it looks like you found something on the ground' })
    ),
    el('button', { class: 'btn primary wide', onclick: reveal }, 'Pick it up')
  );
  // Backing out without tapping still releases the flag, or a dismissed dialogue
  // would wedge the queue for the rest of the session.
  const sheet = $('#fossil-find');
  const observer = new MutationObserver(() => {
    if (sheet.classList.contains('hidden')) { observer.disconnect(); finish(); }
  });
  observer.observe(sheet, { attributes: true, attributeFilter: ['class'] });

  openSheet('fossil-find');
  return true;
}

/** The four parts and how many of each you hold, as one row of icons. */
function partTallyRow(tally = store.fossilTally()) {
  return el('div', { class: 'fossil-parts' }, ...FOSSIL_PARTS.map(id => {
    const n = tally.parts[id] || 0;
    return el('div', { class: 'fossil-part' + (n > 0 ? '' : ' missing'), title: ITEMS[id]?.name },
      el('img', { src: itemImage(id), alt: ITEMS[id]?.name || id }),
      el('b', { text: String(n) })
    );
  }));
}

/* ===============================================================
   The assistant
   =============================================================== */

let handInSpot = null;
let handInQty = 1;

/**
 * Opened by tapping a pharmacy or hospital cross.
 * `inRange` is false when you can see it but are not standing at it yet.
 */
export function openFossilAssistant(spot, { inRange = true } = {}) {
  handInSpot = spot || null;
  handInQty = 1;
  renderAssistant(inRange);
  openSheet('fossil-assistant');
}

function renderAssistant(inRange) {
  const body = $('#fossil-assistant-body');
  const hint = $('#fossil-assistant-hint');
  body.innerHTML = '';

  const tally = store.fossilTally();
  const sets = tally.sets;
  const waiting = store.fossilDrops().filter(d => d.poiId && d.poiId === handInSpot?.id);

  $('#fossil-assistant-title').textContent = handInSpot?.name || 'Assistant';
  hint.textContent = inRange
    ? 'They can put a fossil back together, given all four parts and a day.'
    : `You need to be within ${RULES.CAPTURE_RANGE_M} m to talk to them.`;

  // What they say depends on what you are carrying, which is the whole dialogue.
  const line = !inRange
    ? 'Come a little closer and I will take a look.'
    : sets > 0
      ? `Ah — do you have four parts of a fossil? I can see ${sets === 1 ? 'a set' : `${sets} sets`} there. `
        + 'Leave them with me and come back tomorrow.'
      : 'Do you have four parts of a fossil? A head, a spine, a tail and a hand. '
        + 'Bring me all four and I will see what I can do.';

  appendAll(body,
    el('div', { class: 'fossil-assistant' },
      el('img', { src: ASSISTANT_ART, alt: 'Assistant' }),
      el('p', { class: 'bt-quote', text: `"${line}"` })
    ),
    partTallyRow(tally)
  );

  // Anything of yours already in the back room.
  if (waiting.length) {
    body.append(el('h4', { class: 'sheet-h4', text: 'Already with them' }));
    for (const d of waiting) {
      const ready = d.readyAt <= Date.now();
      body.append(el('div', { class: 'det-rows' },
        el('div', { class: 'det-row' },
          el('img', { src: itemImage('fossil_head'), alt: '' }),
          el('span', { text: `${d.count} fossil${d.count === 1 ? '' : 's'}` }),
          // hh:mm, not mm:ss: this is a 24 hour wait.
          el('b', { text: ready ? 'Ready' : hoursMinutesLabel(d.readyAt - Date.now()) })
        )
      ));
    }
  }

  if (!inRange) return;

  if (sets < 1) {
    const missing = FOSSIL_PARTS.filter(id => !tally.parts[id]).map(id => ITEMS[id].name);
    body.append(el('p', { class: 'hint', text: missing.length
      ? `Still missing: ${missing.join(', ')}.`
      : 'You need one of each of the four parts.' }));
    return;
  }

  // ---- how many sets ----
  handInQty = Math.max(1, Math.min(handInQty, sets));
  appendAll(body,
    el('h4', { class: 'sheet-h4', text: 'How many?' }),
    el('p', { class: 'hint', text: `Each fossil needs one of every part, so ${sets} `
      + `${sets === 1 ? 'is' : 'are'} the most you can leave. They all come back together, `
      + `${Math.round(FOSSIL_REVIVE_MS / 3_600_000)} hours from now.` }),
    el('div', { class: 'qty-row' },
      el('button', {
        class: 'mini-btn', disabled: handInQty <= 1,
        onclick: () => { handInQty--; renderAssistant(true); }
      }, '−'),
      el('span', { class: 'qty-value', text: String(handInQty) }),
      el('button', {
        class: 'mini-btn', disabled: handInQty >= sets,
        onclick: () => { handInQty++; renderAssistant(true); }
      }, '+')
    ),
    el('div', { class: 'det-rows' }, ...FOSSIL_PARTS.map(id => el('div', { class: 'det-row' },
      el('img', { src: itemImage(id), alt: '' }),
      el('span', { text: ITEMS[id].name }),
      el('b', { text: `−${handInQty}` })
    ))),
    el('button', { class: 'btn primary wide', onclick: () => giveFossils() },
      `Give ${handInQty === 1 ? 'a fossil' : `${handInQty} fossils`}`),
    el('p', { class: 'hint', text: 'You will get a notification when they are ready, and an arrow '
      + 'back to this spot. There is no rush after that — they will keep.' })
  );
}

function giveFossils() {
  const spot = handInSpot;
  if (!spot) return;
  const n = handInQty;
  if (!confirm(`Leave ${n === 1 ? 'one fossil' : `${n} fossils`} with them?\n\n`
    + `That spends ${n} of each of the four parts. They will be ready in `
    + `${Math.round(FOSSIL_REVIVE_MS / 3_600_000)} hours, back here at ${spot.name || 'this spot'}.`)) return;

  const r = store.startFossilRevive(n, spot);
  if (!r.ok) {
    toast(r.reason === 'parts' ? 'You do not have that many complete sets'
      : r.reason === 'noSpecies' ? 'No fossil creatures are loaded'
      : 'Could not leave them', 'bad');
    return;
  }
  closeSheet('fossil-assistant');
  toast(`Left with the assistant — back in ${Math.round(FOSSIL_REVIVE_MS / 3_600_000)} hours`,
    'good', 4600);
  mapChanged?.();
  refresh?.();
}

/* ===============================================================
   Coming back for them
   =============================================================== */

/** Opened by tapping your own fossils on the map. */
export function openFossilDrop(drop, { inRange = true } = {}) {
  const live = store.fossilDrop(drop?.id);
  if (!live) return;
  const ready = live.readyAt <= Date.now();

  const body = $('#fossil-drop-body');
  body.innerHTML = '';
  $('#fossil-drop-title').textContent = ready ? 'Your fossils are ready' : 'Still working';
  $('#fossil-drop-hint').textContent = live.poiName;

  appendAll(body,
    el('div', { class: 'fossil-assistant' },
      el('img', { src: ready ? ASSISTANT_ART : itemImage('fossil_head'), alt: '' }),
      el('p', { class: 'bt-quote', text: ready
        ? `"All done — ${live.count === 1 ? 'here it is' : 'here they are'}."`
        : '"Not yet. Give me a little longer."' })
    ),
    el('div', { class: 'det-rows' },
      el('div', { class: 'det-row' },
        el('span', { text: '🦴' }),
        el('span', { text: 'Fossils left here' }),
        el('b', { text: String(live.count) })
      ),
      el('div', { class: 'det-row' },
        el('span', { text: '⏳' }),
        el('span', { text: ready ? 'Ready since' : 'Ready in' }),
        el('b', { text: ready
          ? new Date(live.readyAt).toLocaleString()
          : hoursMinutesLabel(live.readyAt - Date.now()) })
      )
    ),
    !ready
      ? el('p', { class: 'hint', text: 'Come back when the timer is up. Nothing is lost by waiting '
        + 'longer than that.' })
      : !inRange
        ? el('p', { class: 'hint', style: { color: '#ffd9a8' },
          text: `Get within ${RULES.CAPTURE_RANGE_M} m to collect them.` })
        : el('button', { class: 'btn primary wide', onclick: () => collectFossils(live.id) },
          live.count === 1 ? 'Collect it' : `Collect all ${live.count}`)
  );
  openSheet('fossil-drop');
}

/**
 * Hands the revived creatures over, one capture animation each — the same one an
 * ordinary catch plays, because as far as the player is concerned this is one.
 */
async function collectFossils(id) {
  const r = store.collectFossilRevive(id);
  if (!r.ok) {
    toast(r.reason === 'notReady' ? 'They are not ready yet'
      : r.reason === 'noSpecies' ? 'No fossil creatures are loaded'
      : 'Could not collect them', 'bad');
    return;
  }
  closeSheet('fossil-drop');
  mapChanged?.();

  for (const res of r.results) {
    const rewards = [
      { icon: CANDY_ICON,
        label: `+${res.candy} ${familyName(res.sp.id)} candy (incl. +${FOSSIL_REVIVE_BONUS_CANDY} fossil bonus)`
          + (res.sweet ? ', Tuesday ×2' : '') },
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
    if (res.levelUp?.levelledUp) toast(`Player level ${res.levelUp.to}!`, 'good', 3200);
  }
  refresh?.();
}

/**
 * Whether any fossil is ready right now, for the notification. The stamp is kept
 * per drop id so each set announces itself exactly once.
 */
const announced = new Set();
export function announceReadyFossils(now = Date.now()) {
  const ready = store.fossilDropsReady(now);
  const fresh = ready.filter(d => !announced.has(d.id));
  for (const d of fresh) announced.add(d.id);
  return fresh;
}
