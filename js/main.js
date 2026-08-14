/* ============================================================
   main.js — boot, wiring, game loop
   ============================================================ */

import {
  loadDatabase, DB, RULES, SETS, RARITY_NAMES, species, familyName,
  BREEDING_UNLOCK_LEVEL, isRelaxHour
} from './data.js';
import { Persist, progressOf } from './persist.js';
import { store } from './state.js';
import { Geo, distance, parseCoords, formatDistance, offsetMeters } from './geo.js';
import { fetchPOIs, clearPOICache } from './osm.js';
import { describeDrop, itemImage, itemName } from './items.js';
import {
  runScan, debugPointAt, tickIncense, spawnWindowGrunt, msUntilNextScan, formatCountdown, isScanning
} from './spawns.js';
import { GameMap } from './map.js';
import { playCapture } from './anim.js';
import { initBattleUI, openBattle, isBattleOpen } from './battleui.js';
import {
  renderHUD, renderStorage, renderCollection, renderProfile, renderSaveStatus,
  initCollectionFilters, refreshAll, renderView, renderStorageTabs,
  renderEffectChips, openNicknamePrompt, setViewHooks, enterMultiSelect
} from './views.js';
import {
  initExtras, renderMissions, renderMissionBadge, openBreeding
} from './extras.js';
import { setMissionsRenderer } from './views.js';
import { initEggs, maybePromptHatch, showEggDropPopup } from './eggs.js';
import { $, $$, el, toast, wireSheetClosers, openSheet, closeSheet, num } from './ui.js';

const CANDY_ICON = '🍬';
const DUST_ICON = '✨';

/**
 * The debug tools are only available to one trainer name. Everything routed
 * through debugAllowed(): the panel, the restored fake location and the
 * range override, so an old save cannot keep cheating after a rename.
 */
const DEBUG_TRAINER = 'Test123';
const debugAllowed = () => store.nickname === DEBUG_TRAINER;

/** Shows or hides the 🛠 button to match the current trainer name. */
function syncDebugButton() {
  $('#btn-debug')?.classList.toggle('hidden', !debugAllowed());
}

let capturing = false;
let lastPOIs = [];
let scanCooldownUntil = 0; // backs off automatic retries after a failed lookup

/* ===============================================================
   Debug log
   =============================================================== */
const logLines = [];
function dlog(...parts) {
  const line = `${new Date().toLocaleTimeString()} · ${parts.join(' ')}`;
  logLines.push(line);
  if (logLines.length > 120) logLines.shift();
  const pre = $('#dbg-log');
  if (pre) { pre.textContent = logLines.join('\n'); pre.scrollTop = pre.scrollHeight; }
  console.log('[SAG]', ...parts);
}

/* ===============================================================
   Save guard reporting
   =============================================================== */
let warnedBlockedAt = 0;

/**
 * A refused write means the game is holding a blank account while the device
 * still has real progress. That is recoverable, but only if the player stops
 * and does something about it, so say so loudly rather than in a toast.
 */
function warnSaveBlocked() {
  const g = store.saveBlocked;
  if (!g) return;
  if (Date.now() - warnedBlockedAt < 60_000) return;   // don't spam every autosave
  warnedBlockedAt = Date.now();

  dlog(`Save refused: would have blanked a save with ${g.existing.creatures} creatures`);
  toast('Saving is paused to protect your existing progress — open Profile', 'bad', 6000);

  const el = $('#save-guard-banner');
  if (el) {
    el.classList.remove('hidden');
    el.innerHTML =
      `<b>Saving is paused.</b> This device still holds a save with ` +
      `<b>${g.existing.creatures} creatures</b> and ` +
      `<b>${Number(g.existing.xp).toLocaleString()} XP</b> ` +
      `(saved ${g.existingSavedAt ? new Date(g.existingSavedAt).toLocaleString() : 'earlier'}), ` +
      `but the game is running an empty account. Nothing has been overwritten. ` +
      `Reload the game to try loading it again, or use Reset all progress if you really want to start over.`;
  }
}

/* ===============================================================
   Recovery gate

   Shown instead of the game when a save should exist but could not be loaded.
   Nothing here starts the game loop, so no autosave can run and overwrite
   whatever is still on the device.
   =============================================================== */
function showRecoveryGate() {
  const boot = $('#boot');
  const snap = store.loadRecoverable;
  const readFailed = store.loadReadFailed;

  const snapLine = snap
    ? `<p class="small" style="color:#b9ffd0;margin:0 0 4px">
         Newest snapshot: <b>${new Date(snap.savedAt).toLocaleString()}</b> —
         ${snap.progress.creatures} creatures, ${Number(snap.progress.xp).toLocaleString()} XP.
       </p>`
    : `<p class="small" style="color:#ffd9a8;margin:0 0 4px">No snapshot was found on this device.</p>`;

  boot.innerHTML = `
    <div style="max-width:38ch;text-align:center;padding:20px">
      <h1 style="margin:0 0 8px;font-size:20px">Your save did not load</h1>
      <p style="color:#ffd9a8;margin:0 0 12px">
        ${readFailed
          ? 'The save could not be read. It may still be on this device.'
          : 'No save was found, but this device has a snapshot, so one should exist.'}
      </p>
      <p class="small" style="color:#98a1c8;margin:0 0 14px">
        The game has <b>not</b> started, so nothing has been overwritten.
        Do not skip past this unless you are happy to start over.
      </p>
      ${snapLine}
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:16px">
        <button id="rg-retry" class="btn primary">Try loading again</button>
        ${snap ? '<button id="rg-snap" class="btn">Restore that snapshot</button>' : ''}
        <button id="rg-import" class="btn">Restore from a backup file…</button>
        <button id="rg-fresh" class="btn ghost">Start a new account anyway</button>
      </div>
      <input id="rg-file" type="file" accept="application/json,.json" hidden />
      <p id="rg-msg" class="small" style="color:#ff9b9b;margin:12px 0 0"></p>
    </div>`;

  const say = m => { const n = $('#rg-msg'); if (n) n.textContent = m; };

  $('#rg-retry').addEventListener('click', () => location.reload());

  $('#rg-snap')?.addEventListener('click', async () => {
    try {
      await store.replace(snap.data);          // force-writes, so the guard allows it
      toast('Snapshot restored', 'good', 3600);
      location.reload();
    } catch (e) { say(e.message || 'Could not restore that snapshot'); }
  });

  $('#rg-import').addEventListener('click', () => $('#rg-file').click());
  $('#rg-file').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = await Persist.importFile(file);
      if (progressOf(data).empty && !confirm('That backup looks empty. Restore it anyway?')) return;
      await store.replace(data);
      location.reload();
    } catch { say('That file could not be read as a save.'); }
  });

  $('#rg-fresh').addEventListener('click', async () => {
    if (!confirm('Start a brand-new account? Anything still on this device will be replaced.')) return;
    await store.reset();                       // explicit, so it force-writes
    location.reload();
  });
}

/* ===============================================================
   Boot
   =============================================================== */
async function boot() {
  const msg = m => { const n = $('#boot-msg'); if (n) n.textContent = m; };

  try {
    msg('Loading creature data…');
    await loadDatabase();
    dlog(`Loaded ${DB.species.length} creatures · ${DB.spawnable.length} catchable`);

    msg('Opening your save…');
    await Persist.init();
    Persist.onStatusChange = () => renderSaveStatus();
    const src = await store.load();
    dlog(`Save loaded from: ${src}`);

    // A brand-new player and a save we simply could not read look identical
    // from here. Treating the second as the first is what destroys a save, so
    // stop and ask rather than starting a fresh account that would autosave
    // over it. Returning here means the game loop never starts, so nothing
    // writes while the player decides.
    if (src === 'none' && (store.loadReadFailed || store.loadRecoverable)) {
      dlog(`Save missing (readFailed=${store.loadReadFailed}) — holding at the recovery gate`);
      showRecoveryGate();
      return;
    }

    msg('Setting up…');
    setMissionsRenderer(renderMissions);
    initUI();
    try {
      GameMap.init('map');
      GameMap.onSpawnClick = onPointTap;
    } catch (mapErr) {
      // Storage and Collection still work without a map, so don't kill the app.
      console.error(mapErr);
      dlog('Map unavailable: ' + mapErr.message);
      $('#map').innerHTML = `<p class="empty">Map unavailable: ${escapeHtml(mapErr.message)}</p>`;
    }

    // Restore a debug location before we ask for GPS.
    const dbg = store.s.debug;
    if (debugAllowed() && dbg.enabled && dbg.lat != null && dbg.lng != null) {
      Geo.setFake({ lat: dbg.lat, lng: dbg.lng });
      dlog(`Debug location restored: ${dbg.lat}, ${dbg.lng}`);
    }

    Geo.onChange(onLocation);
    Geo.start();

    refreshAll();
    renderMissionBadge();
    syncMap();
    startLoop();

    $('#boot').classList.add('hidden');
    $('#app').classList.remove('hidden');
    GameMap.invalidate();

    onLocation(Geo.current);

    // Say it once per session if progress is only in the browser. This is the
    // failure that goes unnoticed for days, so it should not need a visit to
    // Profile to discover.
    if (!Persist.status().autoFileSave && store.s.storage.length > 0) {
      toast('Your progress is only saved in this browser — link a save file in Profile', 'bad', 6500);
      dlog('Warning: no device file is being auto-saved');
    }

    // Ask for a nickname the very first time someone plays.
    if (!store.nickname) openNicknamePrompt({ firstRun: true });

    // First scan of the session, as soon as we know where we are.
    scanWhenReady();

  } catch (e) {
    console.error(e);
    msg('');
    $('#boot').innerHTML = `
      <h1 style="margin:0 0 10px">Could not start</h1>
      <p style="color:#ff9b9b;max-width:34ch;text-align:center">${escapeHtml(e.message || String(e))}</p>
      <p class="small" style="color:#98a1c8;max-width:40ch;text-align:center">
        This game must be served over http(s) — opening the file directly will not work.
        Run a local server in the game folder, for example:<br>
        <code>python -m http.server 8080</code><br>
        then open <code>http://localhost:8080</code>.
      </p>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ===============================================================
   Location
   =============================================================== */
/** Last position used for the step counter (kept separate from the map's). */
let stepAnchor = null;

/**
 * Turns GPS movement into a step count. Small wobbles and huge teleports are
 * both discarded, so standing still does not rack up steps and a lost-then-
 * regained fix does not add a kilometre in one go.
 */
function trackSteps(pos) {
  if (Geo.usingFake) { stepAnchor = null; return; }
  if (!stepAnchor) { stepAnchor = pos; return; }

  const d = distance(stepAnchor, pos);
  // Below one stride it is almost certainly GPS jitter; above the cap it is a jump.
  if (d < RULES.METRES_PER_STEP) return;
  stepAnchor = pos;
  if (d > RULES.MAX_WALK_JUMP_M) return;

  const walk = store.addWalk(d);
  if (!walk.changed) return;

  store.touch('steps');
  if (document.querySelector('.view.active')?.id === 'view-profile') renderProfile();

  // A walk mission can finish mid-stride, so light the badge immediately.
  if (walk.walkMissionDone) {
    renderMissionBadge();
    renderMissions();
    toast('You finished a walking mission — go and claim it', 'good', 3600);
  }

  // Buddy candy: one toast per candy earned, naming the creature.
  if (walk.buddyCandy > 0 && walk.buddy) {
    const name = species(walk.buddy.speciesId).name;
    for (let i = 0; i < walk.buddyCandy; i++) {
      toast(`Your buddy ${name} generated an extra candy!`, 'good', 3600);
    }
    dlog(`Buddy ${name} earned ${walk.buddyCandy} candy from walking`);
    refreshAll();
  }
}

function onLocation(pos) {
  const badge = $('#geo-status');
  if (!pos) {
    badge.className = 'geo-status err';
    badge.textContent = Geo.error || 'Waiting for location…';
    return;
  }
  trackSteps(pos);
  GameMap.setPlayer(pos);
  if (Geo.usingFake) {
    badge.className = 'geo-status fake';
    badge.textContent = `🛠 Fake location · ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
  } else {
    badge.className = 'geo-status';
    badge.textContent = `📍 ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)} · ±${Math.round(pos.accuracy)} m`;
  }
}

async function scanWhenReady() {
  const pos = Geo.current || await Geo.waitForFix(15000);
  if (!pos) { dlog('No location fix yet — scan postponed'); return; }

  // Only scan if the timer has already expired. If the player refreshed
  // mid-countdown, the existing spawns are still in storage and the game
  // loop will fire the next scan when the interval naturally elapses.
  if (msUntilNextScan() <= 0) {
    await doScan({ reason: 'session start' });
  } else {
    dlog(`Resuming timer — next scan in ${Math.ceil(msUntilNextScan() / 1000)} s`);
    syncMap();
  }
}

/* ===============================================================
   Scanning
   =============================================================== */
async function doScan({ force = false, reason = 'auto', forceKind = null, alwaysGrunt = false } = {}) {
  const pos = Geo.current;
  if (!pos) { toast('No location yet — set one in 🛠 debug', 'bad'); return; }
  if (isScanning()) return;

  updateResetChip();

  try {
    const r = await runScan(pos, { force, forceKind, alwaysGrunt });
    const c = r.counts;
    dlog(`Scan (${reason}): ${r.places} places + ${r.parks} parks · ` +
         `${c.creature} creatures, ${c.discs} discs, ${c.items} items, ${c.raid} raids, ${c.grunt} grunts · ` +
         `skipped ${r.skipped.occupied} occupied, ${r.skipped.tooClose} too close, ${r.skipped.nothing} empty · ` +
         `grunts: ${r.skipped.gruntRoll} lost the roll, ${r.skipped.gruntTooClose} no room, ${r.skipped.gruntCap} over cap`);

    if (store.s.debug.showPois) {
      lastPOIs = await fetchPOIs(pos.lat, pos.lng, RULES.SCAN_RADIUS_M).catch(() => []);
      GameMap.showPOIs(lastPOIs);
    }

    const mins = RULES.SCAN_INTERVAL_MS / 60_000;
    if (!r.pois) toast(`Nothing mapped within ${RULES.SCAN_RADIUS_M} m`, 'bad', 3200);
    else if (r.created.length) toast(`${r.created.length} new point${r.created.length > 1 ? 's' : ''} appeared`, 'good');
    else toast(`Nothing appeared — next reset in ${mins} min`);

    scanCooldownUntil = 0;
    syncMap();
  } catch (e) {
    scanCooldownUntil = Date.now() + 60_000; // don't hammer Overpass
    dlog('Scan failed: ' + (e.message || e));
    toast('POI lookup failed: ' + (e.message || 'network error'), 'bad', 4000);
  } finally {
    onLocation(Geo.current);
    updateResetChip();
  }
}

/* ===============================================================
   Capture
   =============================================================== */
/** Shows a celebratory popup when the player levels up, listing rewards. */
function showLevelUpPopup(levelUp) {
  if (!levelUp.levelledUp) return;
  const body = $('#sheet-body');
  body.innerHTML = '';
  body.append(
    el('div', { style: { textAlign: 'center', padding: '16px 0' } },
      el('div', { class: 'lvl-badge big', text: String(levelUp.to), style: { margin: '0 auto 12px' } }),
      el('h3', { text: `Level ${levelUp.to}!`, style: { margin: '0 0 6px' } }),
      el('p', { class: 'muted', text: 'Congratulations! You received:' }),
      el('div', { class: 'rewards', style: { marginTop: '12px', justifyContent: 'center' } },
        ...levelUp.rewards.map(r =>
          el('span', { class: 'reward' },
            el('img', { src: itemImage(r.id), alt: '', style: { width: '20px', height: '20px', objectFit: 'contain' } }),
            el('span', { text: `${r.n}× ${itemName(r.id, r.n)}` })
          )
        )
      ),
      el('button', { class: 'btn primary wide', style: { marginTop: '18px' }, onclick: () => closeSheet('sheet') }, 'Awesome!')
    )
  );
  openSheet('sheet');
}

/* ===============================================================
   Breeding centre placement
   =============================================================== */
function placeBreedingCentre() {
  const pos = Geo.current;
  if (!pos) { toast('Waiting for your location…', 'bad'); return; }
  if (store.s.breeding) { toast('Your breeding centre is already on the map', 'bad'); return; }
  if (!store.breedingUnlocked) {
    toast(`Breeding centres unlock at player level ${BREEDING_UNLOCK_LEVEL}`, 'bad', 3600);
    return;
  }
  if (!confirm('Pin your breeding centre here? It stays at these coordinates permanently.')) return;

  const r = store.placeBreedingCentre(pos.lat, pos.lng);
  if (!r.ok) {
    toast(r.reason === 'noItem' ? 'You have no Breeding Centre' : 'Could not place it', 'bad');
    return;
  }
  closeSheet('sheet');
  syncMap();
  GameMap.recenter();
  dlog(`Breeding centre placed at ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`);
  toast('Breeding centre placed', 'good', 3200);
  refreshAll();
}

/**
 * How close you have to be to interact with something right now.
 * Normally CAPTURE_RANGE_M; the nightly "Relax and Good Night" window widens
 * it to RELAX_RANGE_M, and the debug toggle removes the limit entirely.
 */
function interactRange(now = new Date()) {
  if (debugAllowed() && store.s.debug.ignoreRange) return Infinity;
  return isRelaxHour(now) ? RULES.RELAX_RANGE_M : RULES.CAPTURE_RANGE_M;
}

/** Common gate: the point must still be live, uncollected and within range. */
function checkInteractable(point) {
  const live = store.point(point.id);
  if (!live) { toast('That point is gone', 'bad'); syncMap(); return null; }
  if (live.expiresAt <= Date.now()) {
    store.pruneExpired();
    syncMap();
    toast('It vanished just in time…', 'bad');
    return null;
  }
  if (live.collected) { toast('You have already collected this one', 'bad'); return null; }

  const pos = Geo.current;
  if (!pos) { toast('Waiting for your location…', 'bad'); return null; }

  const d = distance(pos, live);
  const range = interactRange();
  if (d > range) {
    toast(`Too far away — ${formatDistance(d)}. Get within ${range} m.`, 'bad');
    return null;
  }
  return live;
}

/** Routes a tap on the map to whatever that point actually is. */
async function onPointTap(point) {
  if (capturing) return;
  const live = checkInteractable(point);
  if (!live) return;

  if (live.kind === 'creature') return captureCreature(live);
  if (live.kind === 'discs' || live.kind === 'items') return collectItems(live);
  if (live.kind === 'raid' || live.kind === 'grunt') return openBattle(live);
}

/** Picking up a disc or item point — show what you got. */
async function collectItems(live) {
  const gained = store.addItems(live.drop || {});
  store.markCollected(live.id);
  syncMap();
  if (!gained) return;

  const label = describeDrop(live.drop);
  dlog(`Collected ${label} at "${live.poiName}"`);

  // Points can also hand over an egg. Rolled here so it shows up after the
  // normal item popup rather than competing with it.
  const egg = store.rollEggDrop();
  if (egg) dlog(`Found a ${egg.type} egg (${store.eggs.length}/6 held)`);

  // Show a popup with what the player just got
  const entries = Object.entries(live.drop || {});
  const body = $('#sheet-body');
  body.innerHTML = '';
  body.append(
    el('div', { style: { textAlign: 'center', padding: '12px 0' } },
      ...entries.map(([id, qty]) =>
        el('div', { style: { marginBottom: '12px' } },
          el('img', { src: itemImage(id), alt: '', style: { width: '72px', height: '72px', objectFit: 'contain' } }),
          el('p', { style: { margin: '6px 0 0', fontWeight: '700', fontSize: '15px' },
                    text: `${qty > 1 ? qty + '× ' : ''}${itemName(id, qty)}` })
        )
      ),
      el('button', {
        class: 'btn primary wide',
        // If an egg came too, its popup replaces this one on the way out.
        onclick: () => { closeSheet('sheet'); if (egg) showEggDropPopup(egg); }
      }, egg ? 'And…?' : 'Nice!')
    )
  );
  openSheet('sheet');
  refreshAll();
}

/** Capturing a wild creature — first confirm the disc, then animate. */
async function captureCreature(live) {
  if (!store.hasItem('capture_disc')) {
    toast("You have no Capturing Discs, so you can't capture this creature", 'bad', 4200);
    return;
  }

  // Show a confirmation step with the disc count
  const discCount = store.itemCount('capture_disc');
  const body = $('#sheet-body');
  body.innerHTML = '';
  body.append(
    el('div', { style: { textAlign: 'center', padding: '12px 0' } },
      el('img', { src: itemImage('capture_disc'), alt: '',
                  style: { width: '80px', height: '80px', objectFit: 'contain' } }),
      el('p', { style: { margin: '8px 0 4px', fontWeight: '700', fontSize: '16px' },
                text: 'Capturing Disc' }),
      el('p', { class: 'muted', text: `You have ${discCount}` }),
      el('div', { class: 'btn-row', style: { justifyContent: 'center', marginTop: '14px' } },
        el('button', { class: 'btn ghost', onclick: () => closeSheet('sheet') }, 'Cancel'),
        el('button', { class: 'btn primary', onclick: () => { closeSheet('sheet'); doCapture(live); } }, 'Use one')
      )
    )
  );
  openSheet('sheet');
}

/** The actual capture sequence after the disc is confirmed. */
async function doCapture(live) {
  capturing = true;
  try {
    store.markCollected(live.id);
    store.spendItem('capture_disc');
    syncMap();

    const res = store.capture(live, { origin: live.source === 'incense' ? 'incense' : 'wild' });
    const sprite = res.sp.spritePath(res.shiny);

    dlog(`Captured ${res.sp.name} (R${res.rarity})${res.shiny ? ' SHINY' : ''} at "${live.poiName}" · ` +
         `+${res.candy} candy, +${res.dust} dust, +${res.xp} XP${res.isNew ? ' · NEW' : ''}`);

    const rewards = [
      { icon: CANDY_ICON, label: `+${res.candy} ${familyName(res.sp.id)} candy` },
      { icon: DUST_ICON, label: `+${num(res.dust)} stardust${res.magnet ? ' (magnet)' : ''}` },
      { icon: '⭐', label: `+${res.xp} XP` }
    ];
    if (res.shiny) rewards.unshift({ icon: '✨', label: 'Shiny!' });

    await playCapture({ sp: res.sp, isNew: res.isNew, rewards, imageSrc: sprite, shiny: res.shiny });

    if (res.levelUp.levelledUp) showLevelUpPopup(res.levelUp);
    refreshAll();
  } finally {
    capturing = false;
  }
}

/* ===============================================================
   Map sync + game loop
   =============================================================== */

/** Keeps the "Spawns reset in m:ss" chip on the map view current. */
function updateResetChip(now = Date.now()) {
  const chip = $('#reset-chip');
  const value = $('#next-scan');
  if (!chip || !value) return;

  if (isScanning()) {
    chip.className = 'reset-chip scanning';
    chip.querySelector('.reset-label').textContent = 'Finding spawns';
    value.textContent = 'now';
    return;
  }

  chip.querySelector('.reset-label').textContent = 'Spawns reset in';

  if (!store.s.lastScanAt) {
    chip.className = 'reset-chip due';
    value.textContent = '--:--';
    return;
  }

  const until = msUntilNextScan(now);
  value.textContent = formatCountdown(until);
  // "ending", not "soon": `.soon` is the full-page Coming Soon placeholder
  // (display:grid, min-height:60vh), and stamping it on the chip stretched it
  // to 60% of the viewport for the last minute.
  chip.className = 'reset-chip' + (until <= 60_000 ? ' ending' : '');
}

function syncMap() {
  const active = store.activePoints();
  // Used-up points can be hidden from the map. They stay in `active`, so they
  // still hold their spot against new spawns — the map is just not told to
  // draw them, and syncPoints removes any marker it no longer hears about.
  const shown = store.s.ui.hideCollectedPoints ? active.filter(p => !p.collected) : active;
  GameMap.syncPoints(shown);
  GameMap.syncBreeding(store.s.breeding);
  const open = active.filter(p => !p.collected).length;
  $('#spawn-count').textContent = open === 1 ? '1 point active' : `${open} points active`;
}

function startLoop() {
  setInterval(() => {
    const now = Date.now();

    const gone = store.pruneExpired(now);
    if (gone.length) {
      dlog(`${gone.length} spawn(s) despawned`);
      syncMap();
    }

    GameMap.tick(now, Geo.current, { range: interactRange() });

    // One trainer walks up to you per 8-hour window. Checked on the loop
    // rather than only at boot, so a window that rolls over while the game is
    // open still gets its grunt.
    if (Geo.current) {
      const trainer = spawnWindowGrunt(Geo.current, now);
      if (trainer) {
        dlog(`A trainer found you (${Math.round(RULES.WINDOW_GRUNT_MS / 60_000)} min)`);
        syncMap();
        toast('A trainer has walked up to you and wants to battle!', '', 4200);
      }
    }

    // Incense drops a creature at the player's feet every two minutes.
    if (store.clearExpiredEffects(now)) refreshAll();
    if (store.isIncenseActive(now) && Geo.current) {
      const p = tickIncense(Geo.current, now);
      if (p) {
        dlog(`Incense spawned a creature (${Math.round(RULES.LIFETIME_MS.incense[0] / 1000)} s)`);
        syncMap();
      }
    }

    updateResetChip(now);
    renderEffectChips(now);
    maybePromptHatch();

    const until = msUntilNextScan(now);
    if (until <= 0 && !isScanning() && Geo.current && !capturing && now >= scanCooldownUntil) {
      doScan({ reason: `${RULES.SCAN_INTERVAL_MS / 60_000} min timer` });
    }
  }, 1000);

  // Keep the save current when the app goes to the background.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) store.flush();
  });
  window.addEventListener('pagehide', () => store.flush());
}

/* ===============================================================
   UI wiring
   =============================================================== */
function initUI() {
  wireSheetClosers();
  initCollectionFilters();

  // ---- bottom nav ----
  $$('.nav-btn').forEach(btn => btn.addEventListener('click', () => {
    const name = btn.dataset.view;
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b === btn));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    renderView(name);
    if (name === 'map') GameMap.invalidate();
  }));

  // ---- map controls ----
  $('#btn-recenter').addEventListener('click', () => {
    GameMap.recenter();
    if (!Geo.current) toast('No location yet', 'bad');
  });
  $('#btn-zoom-in').addEventListener('click', () => GameMap.map?.zoomIn());
  $('#btn-zoom-out').addEventListener('click', () => GameMap.map?.zoomOut());

  // The compass only appears once the map is off north, and puts it back.
  const compass = $('#btn-compass');
  compass.addEventListener('click', () => {
    GameMap.resetNorth();
    toast('Facing north again');
  });
  GameMap.onBearingChange = deg => {
    compass.classList.toggle('hidden', deg === 0);
    compass.title = deg === 0 ? 'Face north' : `Rotated ${Math.round(deg)}° · tap to face north`;
  };
  $('#btn-hide-chip').addEventListener('click', () => {
    const wrap = $('#reset-chip-wrap');
    const hidden = wrap.classList.toggle('chip-hidden');
    $('#btn-hide-chip').textContent = hidden ? '⟳' : '✕';
  });
  // There is deliberately no manual refresh — spawns only re-roll on the timer.

  $('#opt-hide-collected').addEventListener('change', e => {
    store.setUI({ hideCollectedPoints: e.target.checked });
    syncMap();
    toast(e.target.checked
      ? 'Used points hidden — they still hold their spot'
      : 'Used points shown again');
  });

  initBattleUI({ onDone: () => { syncMap(); refreshAll(); } });
  initExtras({ onChange: () => { refreshAll(); renderMissionBadge(); } });

  initEggs({
    refresh: () => { refreshAll(); renderMissionBadge(); },
    reveal: opts => playCapture(opts),
    // Only interrupt on the map, with nothing else on screen.
    canPrompt: () => (
      document.querySelector('.view.active')?.id === 'view-map' &&
      !isBattleOpen() &&
      !document.querySelector('.sheet-wrap:not(.hidden)') &&
      !document.querySelector('.modal-wrap:not(.hidden)') &&
      !capturing
    ),
    onHatched: res => { if (res.levelUp?.levelledUp) showLevelUpPopup(res.levelUp); }
  });

  // Tapping the flag on the map opens the breeding centre, if you are close enough.
  GameMap.onBreedingClick = centre => {
    const pos = Geo.current;
    const range = interactRange();
    const near = !isFinite(range) || (pos && distance(pos, centre) <= range);
    openBreeding({ inRange: !!near });
    if (!near) {
      toast(`Get within ${range} m of your breeding centre to use it`, 'bad', 3400);
    }
  };

  // views needs a couple of map-aware actions
  setViewHooks({
    placeBreeding: placeBreedingCentre,
    effectsChanged: () => { syncMap(); renderEffectChips(); }
  });

  // ---- storage tabs ----
  $$('.tabs .tab').forEach(btn => btn.addEventListener('click', () => {
    store.setUI({ storageTab: btn.dataset.tab });
    renderStorage();
  }));

  // ---- nickname ----
  $('#btn-edit-nick').addEventListener('click', () => openNicknamePrompt({ firstRun: false }));

  // ---- storage sorting ----
  $('#storage-sort').addEventListener('change', e => {
    // A new order means the old page number is meaningless — go back to page 1.
    store.setUI({ storageSort: e.target.value, storagePage: 0 });
    renderStorage();
  });
  $('#storage-dir').addEventListener('click', () => {
    store.setUI({ storageDir: store.s.ui.storageDir > 0 ? -1 : 1, storagePage: 0 });
    renderStorage();
  });
  $('#btn-multi-select').addEventListener('click', () => enterMultiSelect());

  // ---- collection filters + set nav ----
  $('#filter-type').addEventListener('change', e => { store.setUI({ filterType: e.target.value }); renderCollection(); });
  $('#filter-stage').addEventListener('change', e => { store.setUI({ filterStage: e.target.value }); renderCollection(); });
  $('#filter-rarity').addEventListener('change', e => { store.setUI({ filterRarity: e.target.value }); renderCollection(); });
  $('#collection-sort').addEventListener('change', () => renderCollection());
  $('#filter-reset').addEventListener('click', () => {
    store.setUI({ filterType: '', filterStage: '', filterRarity: '' });
    if ($('#collection-sort')) $('#collection-sort').value = 'id';
    renderCollection();
  });
  $('#set-prev').addEventListener('click', () => {
    store.setUI({ setIndex: Math.max(0, (store.s.ui.setIndex || 0) - 1) });
    renderCollection();
  });
  $('#set-next').addEventListener('click', () => {
    store.setUI({ setIndex: Math.min(SETS.length - 1, (store.s.ui.setIndex || 0) + 1) });
    renderCollection();
  });

  // ---- save data ----
  $('#btn-link-file').addEventListener('click', async () => {
    try {
      // If a file is already linked but the permission lapsed, just re-ask.
      const st = Persist.status();
      if (st.linked && st.filePermission !== 'granted') {
        const p = await Persist.regrant();
        if (p === 'granted') {
          await store.flush();
          toast('Save file re-connected', 'good');
          renderSaveStatus();
          return;
        }
      }
      await Persist.linkFile(store.s);
      toast('Save file linked — progress now written to your device', 'good', 3600);
      dlog('Linked save file: ' + Persist.status().fileName);
    } catch (e) {
      if (e?.name !== 'AbortError') toast(e.message || 'Could not link file', 'bad', 4000);
    }
    renderSaveStatus();
  });

  $('#btn-load-file').addEventListener('click', async () => {
    try {
      const data = await Persist.openFile();
      if (!data) { toast('That file has no save data', 'bad'); return; }
      if (!confirm('Replace your current progress with the contents of that file?')) return;
      await store.replace(data);
      toast('Progress restored', 'good');
      refreshAll(); syncMap();
      dlog('Restored save from device file');
    } catch (e) {
      if (e?.name !== 'AbortError') toast(e.message || 'Could not open file', 'bad', 4000);
    }
    renderSaveStatus();
  });

  $('#btn-export').addEventListener('click', () => {
    Persist.download(store.s);
    toast('Backup downloaded', 'good');
  });

  $('#input-import').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = await Persist.importFile(file);
      if (!confirm('Replace your current progress with this backup?')) return;
      await store.replace(data);
      toast('Backup imported', 'good');
      refreshAll(); syncMap();
    } catch (err) {
      toast('That file could not be read as a save', 'bad', 4000);
    }
  });

  $('#btn-wipe').addEventListener('click', async () => {
    if (!confirm('Erase all progress: creatures, candy, stardust, XP and spawns?')) return;
    if (!confirm('Really erase everything? This cannot be undone.')) return;
    await store.reset();
    clearPOICache();
    refreshAll(); syncMap();
    toast('Progress reset');
  });

  // ---- reveal card dismiss is handled inside anim.js ----

  initDebugPanel();

  // repaint the HUD and the missions badge whenever the save changes
  store.subscribe((_s, reason) => {
    renderHUD();
    renderMissionBadge();
    syncDebugButton();
    if (reason === 'save-blocked') warnSaveBlocked();
  });
  syncDebugButton();
}

/* ===============================================================
   Debug panel
   =============================================================== */
const PRESETS = [
  { name: 'London · Oxford Circus', lat: 51.51520, lng: -0.14190 },
  { name: 'New York · Times Sq', lat: 40.75800, lng: -73.98550 },
  { name: 'Paris · Châtelet', lat: 48.85860, lng: 2.34770 },
  { name: 'Berlin · Alexanderplatz', lat: 52.52130, lng: 13.41340 },
  { name: 'Tokyo · Shibuya', lat: 35.65950, lng: 139.70050 },
  { name: 'Madrid · Sol', lat: 40.41690, lng: -3.70350 },
  { name: 'Lisbon · Baixa', lat: 38.71080, lng: -9.13930 },
  { name: 'Sydney · CBD', lat: -33.86880, lng: 151.20930 }
];

function initDebugPanel() {
  const dbg = store.s.debug;

  $('#btn-debug').addEventListener('click', () => {
    if (!debugAllowed()) {
      toast(`The debug tools only work for the trainer "${DEBUG_TRAINER}"`, 'bad', 3600);
      return;
    }
    $('#dbg-enable').checked = !!store.s.debug.enabled;
    $('#dbg-ignore-range').checked = !!store.s.debug.ignoreRange;
    $('#dbg-shiny-boost').checked = !!store.s.debug.shinyBoost;
    $('#dbg-show-pois').checked = !!store.s.debug.showPois;
    const cur = Geo.current;
    $('#dbg-lat').value = store.s.debug.lat ?? (cur ? cur.lat.toFixed(6) : '');
    $('#dbg-lng').value = store.s.debug.lng ?? (cur ? cur.lng.toFixed(6) : '');
    openSheet('debug');
  });

  // presets
  const host = $('#dbg-presets');
  for (const p of PRESETS) {
    host.append(el('button', {
      class: 'btn ghost',
      onclick: () => {
        $('#dbg-lat').value = p.lat;
        $('#dbg-lng').value = p.lng;
        $('#dbg-enable').checked = true;
        applyDebugLocation();
      }
    }, p.name));
  }

  $('#dbg-enable').addEventListener('change', e => {
    if (e.target.checked) applyDebugLocation();
    else {
      store.setDebug({ enabled: false });
      Geo.setFake(null);
      toast('Back to real GPS');
      dlog('Debug location off');
    }
  });

  $('#dbg-apply').addEventListener('click', applyDebugLocation);

  $('#dbg-paste').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      const pt = parseCoords(text);
      if (!pt) { toast('Clipboard has no "lat, lng" pair', 'bad'); return; }
      $('#dbg-lat').value = pt.lat;
      $('#dbg-lng').value = pt.lng;
      $('#dbg-enable').checked = true;
      applyDebugLocation();
    } catch {
      toast('Clipboard not available — type the values instead', 'bad');
    }
  });

  $('#dbg-ignore-range').addEventListener('change', e => {
    store.setDebug({ ignoreRange: e.target.checked });
    toast(e.target.checked
      ? `${RULES.CAPTURE_RANGE_M} m range check disabled`
      : `${RULES.CAPTURE_RANGE_M} m range check enabled`);
  });

  $('#dbg-shiny-boost').addEventListener('change', e => {
    store.setDebug({ shinyBoost: e.target.checked });
    toast(e.target.checked ? 'Shiny rate set to 50%' : 'Shiny rate back to normal');
  });

  $('#dbg-show-pois').addEventListener('change', async e => {
    store.setDebug({ showPois: e.target.checked });
    if (!e.target.checked) { GameMap.clearPOIs(); return; }
    const pos = Geo.current;
    if (!pos) { toast('No location yet', 'bad'); return; }
    try {
      lastPOIs = await fetchPOIs(pos.lat, pos.lng, RULES.SCAN_RADIUS_M);
      GameMap.showPOIs(lastPOIs);
      toast(`${lastPOIs.length} POIs shown`);
    } catch (err) { toast('POI lookup failed', 'bad'); }
  });

  $('#dbg-scan').addEventListener('click', () => { closeSheet('debug'); doScan({ force: true, reason: 'debug' }); });
  $('#dbg-clear-spawns').addEventListener('click', () => {
    store.clearPoints();
    syncMap();
    toast('All map points cleared');
  });
  $$('#debug [data-spawn]').forEach(btn => btn.addEventListener('click', () => {
    const pos = Geo.current;
    if (!pos) { toast('No location yet', 'bad'); return; }
    const kind = btn.dataset.spawn;
    debugPointAt(offsetMeters(pos, 2, 1), kind);
    syncMap();
    closeSheet('debug');
    toast(`Debug ${kind} point created`, 'good');
  }));
  $('#dbg-spawn-here').addEventListener('click', () => {
    const pos = Geo.current;
    if (!pos) { toast('No location yet', 'bad'); return; }
    const s = debugPointAt(offsetMeters(pos, 2, 1), 'creature');
    syncMap();
    closeSheet('debug');
    toast(`Debug spawn created (${species(s.speciesId).name} hidden until captured)`, 'good');
  });

  $$('#debug [data-give]').forEach(btn => btn.addEventListener('click', () => {
    const what = btn.dataset.give;
    if (what === 'stardust') { store.addStardust(1000); toast('+1000 stardust', 'good'); }
    if (what === 'xp') {
      const r = store.addXP(500);
      toast('+500 XP', 'good');
      if (r.levelledUp) toast(`Player level ${r.to}!`, 'good');
    }
    if (what === 'candy') {
      for (const rootId of DB.familyMembers.keys()) store.addCandy(rootId, 50);
      toast('+50 candy for every family', 'good');
    }
    if (what === 'discs') { store.addItem('capture_disc', 10); toast('+10 Capturing Discs', 'good'); }
    if (what === 'items') {
      for (const id of ['capture_disc', 'ultra_disc', 'potion', 'revive',
                        'incense', 'stardust_magnet', 'breeding_center']) store.addItem(id, 5);
      toast('+5 of every item', 'good');
    }
    store.touch('debug-give', { immediate: true });
    refreshAll();
  }));
}

function applyDebugLocation() {
  const pt = parseCoords(`${$('#dbg-lat').value}, ${$('#dbg-lng').value}`);
  if (!pt) { toast('Enter a valid latitude and longitude', 'bad'); return; }
  store.setDebug({ enabled: true, lat: pt.lat, lng: pt.lng });
  Geo.setFake(pt);
  GameMap.recenter();
  closeSheet('debug');
  toast(`Location set to ${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}`, 'good');
  dlog(`Debug location: ${pt.lat}, ${pt.lng}`);
  doScan({ force: true, reason: 'debug location change' });
}

/* ===============================================================
   Go
   =============================================================== */
boot();

// handy for poking around from devtools
window.SAG = { store, Geo, GameMap, DB, doScan, onPointTap, syncMap, Persist, dlog };
