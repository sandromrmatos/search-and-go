/* ============================================================
   main.js — boot, wiring, game loop
   ============================================================ */

import {
  loadDatabase, DB, RULES, SETS, RARITY_NAMES, species, familyName
} from './data.js';
import { Persist } from './persist.js';
import { store } from './state.js';
import { Geo, distance, parseCoords, formatDistance, offsetMeters } from './geo.js';
import { fetchPOIs, clearPOICache } from './osm.js';
import { runScan, debugSpawnAt, msUntilNextScan, formatCountdown, isScanning } from './spawns.js';
import { GameMap } from './map.js';
import { playCapture } from './anim.js';
import {
  renderHUD, renderStorage, renderCollection, renderProfile, renderSaveStatus,
  initCollectionFilters, refreshAll, renderView
} from './views.js';
import { $, $$, el, toast, wireSheetClosers, openSheet, closeSheet, num } from './ui.js';

const CANDY_ICON = '🍬';
const DUST_ICON = '✨';

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

    msg('Setting up…');
    initUI();
    try {
      GameMap.init('map');
      GameMap.onSpawnClick = tryCapture;
    } catch (mapErr) {
      // Storage and Collection still work without a map, so don't kill the app.
      console.error(mapErr);
      dlog('Map unavailable: ' + mapErr.message);
      $('#map').innerHTML = `<p class="empty">Map unavailable: ${escapeHtml(mapErr.message)}</p>`;
    }

    // Restore a debug location before we ask for GPS.
    const dbg = store.s.debug;
    if (dbg.enabled && dbg.lat != null && dbg.lng != null) {
      Geo.setFake({ lat: dbg.lat, lng: dbg.lng });
      dlog(`Debug location restored: ${dbg.lat}, ${dbg.lng}`);
    }

    Geo.onChange(onLocation);
    Geo.start();

    refreshAll();
    syncMap();
    startLoop();

    $('#boot').classList.add('hidden');
    $('#app').classList.remove('hidden');
    GameMap.invalidate();

    onLocation(Geo.current);

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
function onLocation(pos) {
  const badge = $('#geo-status');
  if (!pos) {
    badge.className = 'geo-status err';
    badge.textContent = Geo.error || 'Waiting for location…';
    return;
  }
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
  await doScan({ reason: 'session start' });
}

/* ===============================================================
   Scanning
   =============================================================== */
async function doScan({ chance = RULES.SPAWN_CHANCE, force = false, reason = 'auto' } = {}) {
  const pos = Geo.current;
  if (!pos) { toast('No location yet — set one in 🛠 debug', 'bad'); return; }
  if (isScanning()) return;

  const btn = $('#btn-rescan');
  btn.classList.add('spin');
  $('#geo-status').textContent = 'Scanning for spawns…';

  try {
    const r = await runScan(pos, { chance, force });
    lastPOIs = r.pois;
    dlog(`Scan (${reason}): ${r.candidates} POIs · ${r.created.length} new spawns · skipped ${r.skipped.occupied} occupied, ${r.skipped.tooClose} too close, ${r.skipped.roll} failed roll`);

    if (store.s.debug.showPois) GameMap.showPOIs(lastPOIs);

    if (!r.candidates) toast('No shops or amenities mapped within 100 m', 'bad', 3200);
    else if (r.created.length) toast(`${r.created.length} new spawn${r.created.length > 1 ? 's' : ''} appeared`, 'good');
    else toast('No spawns this time — next check in 10 min');

    scanCooldownUntil = 0;
    syncMap();
  } catch (e) {
    scanCooldownUntil = Date.now() + 60_000; // don't hammer Overpass
    dlog('Scan failed: ' + (e.message || e));
    toast('POI lookup failed: ' + (e.message || 'network error'), 'bad', 4000);
  } finally {
    btn.classList.remove('spin');
    onLocation(Geo.current);
  }
}

/* ===============================================================
   Capture
   =============================================================== */
async function tryCapture(spawn) {
  if (capturing) return;
  const live = store.spawn(spawn.id);
  if (!live) { toast('That spawn is gone', 'bad'); syncMap(); return; }
  if (live.expiresAt <= Date.now()) {
    store.removeSpawn(live.id);
    syncMap();
    toast('It despawned just in time…', 'bad');
    return;
  }

  const pos = Geo.current;
  if (!pos) { toast('Waiting for your location…', 'bad'); return; }

  const d = distance(pos, live);
  if (d > RULES.CAPTURE_RANGE_M && !store.s.debug.ignoreRange) {
    toast(`Too far away — ${formatDistance(d)}. Get within ${RULES.CAPTURE_RANGE_M} m.`, 'bad');
    return;
  }

  capturing = true;
  try {
    // Remove first so a double tap cannot capture twice.
    store.removeSpawn(live.id);
    syncMap();

    const res = store.capture(live, {
      poiId: live.poiId, poiName: live.poiName,
      lat: live.lat, lng: live.lng
    });

    dlog(`Captured ${res.sp.name} (R${res.rarity}) at "${live.poiName}" · +${res.candy} candy, +${res.dust} dust, +${res.xp} XP${res.isNew ? ' · NEW' : ''}`);

    await playCapture({
      sp: res.sp,
      isNew: res.isNew,
      rewards: [
        { icon: CANDY_ICON, label: `+${res.candy} ${familyName(res.sp.id)} candy` },
        { icon: DUST_ICON, label: `+${num(res.dust)} stardust` },
        { icon: '⭐', label: `+${res.xp} XP` }
      ]
    });

    if (res.levelUp.levelledUp) toast(`Player level ${res.levelUp.to}!`, 'good', 3200);
    refreshAll();
  } finally {
    capturing = false;
  }
}

/* ===============================================================
   Map sync + game loop
   =============================================================== */
function syncMap() {
  const active = store.activeSpawns();
  GameMap.syncSpawns(active);
  const n = active.length;
  $('#spawn-count').textContent = n === 1 ? '1 spawn active' : `${n} spawns active`;
}

function startLoop() {
  setInterval(() => {
    const now = Date.now();

    const gone = store.pruneExpired(now);
    if (gone.length) {
      dlog(`${gone.length} spawn(s) despawned`);
      syncMap();
    }

    GameMap.tick(now, Geo.current);

    const until = msUntilNextScan(now);
    $('#next-scan').textContent = store.s.lastScanAt
      ? `Next scan: ${formatCountdown(until)}`
      : 'Next scan: pending';

    if (until <= 0 && !isScanning() && Geo.current && !capturing && now >= scanCooldownUntil) {
      doScan({ reason: '10 min timer' });
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
  $('#btn-rescan').addEventListener('click', () => doScan({ force: true, reason: 'manual' }));

  // ---- storage sorting ----
  $('#storage-sort').addEventListener('change', e => {
    store.setUI({ storageSort: e.target.value });
    renderStorage();
  });
  $('#storage-dir').addEventListener('click', () => {
    store.setUI({ storageDir: store.s.ui.storageDir > 0 ? -1 : 1 });
    renderStorage();
  });

  // ---- collection filters + set nav ----
  $('#filter-type').addEventListener('change', e => { store.setUI({ filterType: e.target.value }); renderCollection(); });
  $('#filter-stage').addEventListener('change', e => { store.setUI({ filterStage: e.target.value }); renderCollection(); });
  $('#filter-rarity').addEventListener('change', e => { store.setUI({ filterRarity: e.target.value }); renderCollection(); });
  $('#filter-reset').addEventListener('click', () => {
    store.setUI({ filterType: '', filterStage: '', filterRarity: '' });
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

  // repaint the HUD whenever the save changes
  store.subscribe(() => renderHUD());
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
    $('#dbg-enable').checked = !!store.s.debug.enabled;
    $('#dbg-ignore-range').checked = !!store.s.debug.ignoreRange;
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
    toast(e.target.checked ? '5 m range check disabled' : '5 m range check enabled');
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
  $('#dbg-force').addEventListener('click', () => { closeSheet('debug'); doScan({ chance: 1, force: true, reason: 'debug 100%' }); });
  $('#dbg-clear-spawns').addEventListener('click', () => {
    store.clearSpawns();
    syncMap();
    toast('All spawns cleared');
  });
  $('#dbg-spawn-here').addEventListener('click', () => {
    const pos = Geo.current;
    if (!pos) { toast('No location yet', 'bad'); return; }
    const s = debugSpawnAt(offsetMeters(pos, 2, 1));
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
window.SAG = { store, Geo, GameMap, DB, doScan, tryCapture, syncMap, Persist, dlog };
