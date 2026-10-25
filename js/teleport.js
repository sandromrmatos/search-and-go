/* ============================================================
   teleport.js — Teleport mode's street map, movement and screens

   The street map is a graph of every walkable way inside TELEPORT_RADIUS_M of
   the city's start point. You are always on it: either standing on a node or
   part way along an edge. The arrows offer each way out of where you are, and
   a move follows the street, carrying straight on through bends (nodes with
   only two ways) and stopping at junctions so you can choose again.

   Nothing here touches the save except through the store; main.js owns going
   in and coming out.
   ============================================================ */

import {
  TELEPORT_CITIES, teleportCity, teleportSetOptions, TELEPORT_COST, TELEPORT_MAX_POINTS,
  TELEPORT_METRES_PER_POINT, TELEPORT_MIN_LEVEL, TELEPORT_SESSION_MS, TELEPORT_RADIUS_M,
  TELEPORT_STEP_M, TELEPORT_HOLD_SPEED_MS, cityClockLabel, SETS
} from './data.js';
import { distance } from './geo.js';
import { fetchStreets } from './osm.js';
import { store } from './state.js';
import { weatherAt, conditionOf } from './weather.js';
import { $, el, toast, openSheet, closeSheet } from './ui.js';

/* ---------------------------------------------------------------
   The street graph
   --------------------------------------------------------------- */

/** Metres east (x) and north (y) of `o`. Flat is fine at this scale. */
const toXY = (o, p) => ({
  x: (p.lng - o.lng) * 111_320 * Math.cos(o.lat * Math.PI / 180),
  y: (p.lat - o.lat) * 110_540
});
const bearingOf = (a, b) => {
  const v = toXY(a, b);
  return (Math.atan2(v.x, v.y) * 180 / Math.PI + 360) % 360;
};

export const Streets = {
  cityId: null,
  /** id -> { id, lat, lng, adj: Set<id> } */
  nodes: new Map(),
  /** Where you are: { from, to, d } with d metres along from→to, or { from, to: null } on a node. */
  at: null,
  loading: null,

  get ready() { return !!this.at && this.nodes.size > 0; },

  clear() { this.cityId = null; this.nodes = new Map(); this.at = null; this.loading = null; },

  /** Loads the city's streets and stands you on the node nearest `pos`. Throws on failure. */
  async load(cityId, pos = null) {
    const city = teleportCity(cityId);
    if (!city) throw new Error('Unknown city');
    if (this.cityId === cityId && this.nodes.size) { this.snap(pos || city); return; }
    const ways = await fetchStreets(city.lat, city.lng, TELEPORT_RADIUS_M);
    const nodes = new Map();
    const centre = { lat: city.lat, lng: city.lng };
    const inside = p => distance(centre, p) <= TELEPORT_RADIUS_M;
    for (const w of ways) {
      for (let i = 0; i < w.nodes.length; i++) {
        const id = w.nodes[i], g = w.geometry[i];
        if (!inside(g)) continue;
        if (!nodes.has(id)) nodes.set(id, { id, lat: g.lat, lng: g.lng, adj: new Set() });
      }
      for (let i = 1; i < w.nodes.length; i++) {
        const a = nodes.get(w.nodes[i - 1]), b = nodes.get(w.nodes[i]);
        if (!a || !b || a === b) continue;
        a.adj.add(b.id); b.adj.add(a.id);
      }
    }
    // Keep only the biggest connected piece, so you can never be dropped on an
    // island of pavement with nowhere to go.
    const seen = new Set();
    let best = [];
    for (const n of nodes.values()) {
      if (seen.has(n.id) || !n.adj.size) continue;
      const comp = [];
      const stack = [n.id];
      seen.add(n.id);
      while (stack.length) {
        const id = stack.pop();
        comp.push(id);
        for (const m of nodes.get(id).adj) if (!seen.has(m)) { seen.add(m); stack.push(m); }
      }
      if (comp.length > best.length) best = comp;
    }
    if (best.length < 2) throw new Error('No connected streets');
    const keep = new Set(best);
    this.nodes = new Map(best.map(id => [id, nodes.get(id)]));
    for (const n of this.nodes.values()) for (const m of [...n.adj]) if (!keep.has(m)) n.adj.delete(m);
    this.cityId = cityId;
    this.snap(pos || city);
  },

  snap(pos) {
    let best = null, bestD = Infinity;
    for (const n of this.nodes.values()) {
      const d = distance(pos, n);
      if (d < bestD) { bestD = d; best = n; }
    }
    this.at = best ? { from: best.id, to: null, d: 0 } : null;
  },

  edgeLength(a, b) { return distance(this.nodes.get(a), this.nodes.get(b)); },

  position() {
    if (!this.at) return null;
    const a = this.nodes.get(this.at.from);
    if (!this.at.to) return { lat: a.lat, lng: a.lng };
    const b = this.nodes.get(this.at.to);
    const L = this.edgeLength(a.id, b.id) || 1;
    const t = Math.min(1, this.at.d / L);
    return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  },

  /**
   * Every way you can go from here: { from, to, bearing }. On a node, one per
   * street leaving it; part way along a street, the two ways along it.
   */
  directions() {
    if (!this.at) return [];
    const here = this.position();
    if (!this.at.to) {
      const n = this.nodes.get(this.at.from);
      return [...n.adj].map(m => ({ from: n.id, to: m, bearing: bearingOf(here, this.nodes.get(m)) }));
    }
    const { from, to } = this.at;
    return [
      { from, to, bearing: bearingOf(this.nodes.get(from), this.nodes.get(to)) },
      { from: to, to: from, bearing: bearingOf(this.nodes.get(to), this.nodes.get(from)) }
    ];
  },

  /**
   * Walks `metres` in direction `dir`. Carries on through bends; stops on
   * arriving at a junction or a dead end. Returns false if `dir` is not a way
   * out of where you are.
   */
  move(dir, metres) {
    if (!this.at || !dir) return false;
    const at = this.at;
    if (!at.to) {
      if (at.from !== dir.from || !this.nodes.get(at.from).adj.has(dir.to)) return false;
      this.at = { from: dir.from, to: dir.to, d: 0 };
    } else if (dir.from === at.to && dir.to === at.from) {
      this.at = { from: at.to, to: at.from, d: this.edgeLength(at.from, at.to) - at.d };
    } else if (!(dir.from === at.from && dir.to === at.to)) {
      return false;
    }
    let left = metres;
    for (let guard = 0; guard < 500; guard++) {
      const { from, to } = this.at;
      const L = this.edgeLength(from, to);
      if (this.at.d + left < L) { this.at.d += left; return true; }
      left -= L - this.at.d;
      const node = this.nodes.get(to);
      // A bend: one street in, one out. Keep walking.
      const onward = [...node.adj].filter(m => m !== from);
      if (node.adj.size === 2 && onward.length === 1 && left > 0) {
        this.at = { from: to, to: onward[0], d: 0 };
        continue;
      }
      this.at = { from: to, to: null, d: 0 };
      return true;
    }
    return true;
  },

  /** True while the last move left you standing at a junction or dead end. */
  get atNode() { return !!this.at && !this.at.to; }
};

/* ---------------------------------------------------------------
   Pressing an arrow

   A press walks TELEPORT_STEP_M at once. Keep holding and it carries on along
   the same street at TELEPORT_HOLD_SPEED_MS metres a second, until you let go
   or reach a junction.
   --------------------------------------------------------------- */
let holdDelay = null;
let holdTimer = null;
const HOLD_TICK_MS = 100;

export function stopHold() {
  clearTimeout(holdDelay); holdDelay = null;
  clearInterval(holdTimer); holdTimer = null;
}

export function pressArrow(dir, onMoved) {
  stopHold();
  if (!Streets.move(dir, TELEPORT_STEP_M)) return;
  onMoved();
  if (Streets.atNode) return;
  holdDelay = setTimeout(() => {
    holdTimer = setInterval(() => {
      const a = Streets.at;
      if (!a || !a.to || !store.isTeleporting) { stopHold(); return; }
      Streets.move({ from: a.from, to: a.to }, TELEPORT_HOLD_SPEED_MS * HOLD_TICK_MS / 1000);
      onMoved();
      if (Streets.atNode) stopHold();
    }, HOLD_TICK_MS);
  }, 350);
}

// Let go anywhere: the button under the finger may have been redrawn mid-hold.
if (typeof window !== 'undefined') {
  for (const t of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(t, stopHold);
}

/* ---------------------------------------------------------------
   The sheets
   --------------------------------------------------------------- */

let hooks = { enter: null, leave: null };
export function initTeleport(h) { hooks = { ...hooks, ...h }; }

const mmss = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** What the 🌀 button opens: the level gate, the running visit, or the chooser. */
export function openTeleportSheet() {
  if (!store.teleportUnlocked) {
    toast(`Teleport unlocks at player level ${TELEPORT_MIN_LEVEL}`, 'bad', 3600);
    return;
  }
  if (store.isTeleporting) return openSessionSheet();
  openChooser();
}

function openSessionSheet() {
  const sess = store.teleportSession;
  const city = teleportCity(sess.cityId);
  const body = $('#sheet-body');
  body.innerHTML = '';
  body.append(el('div', { style: { padding: '6px 0' } },
    el('h3', { text: `🌀 ${city.flag} ${city.city} · ${city.place}` }),
    el('p', { class: 'muted', text: `${mmss(sess.endsAt - Date.now())} left. Sets: ${sess.sets.join(', ')}.` }),
    el('p', { class: 'hint', text: 'Use the arrows around you to walk along the streets. When the time is up you go home on your own.' }),
    el('div', { class: 'btn-row', style: { justifyContent: 'center', marginTop: '12px' } },
      el('button', { class: 'btn ghost', onclick: () => closeSheet('sheet') }, 'Keep exploring'),
      el('button', { class: 'btn primary', onclick: () => {
        if (!confirm('Go home now? This visit has been used either way.')) return;
        closeSheet('sheet');
        hooks.leave?.('early');
      } }, 'Go home now'))));
  openSheet('sheet');
}

/** Sets and city remembered between openings of the chooser. */
const choice = { sets: null, cityId: null };

function openChooser() {
  const options = teleportSetOptions();
  if (!choice.sets) choice.sets = options.slice(0, 1);
  choice.sets = choice.sets.filter(x => options.includes(x));

  const pts = store.teleportPoints;
  const toNext = pts >= TELEPORT_MAX_POINTS ? null
    : Math.ceil(TELEPORT_METRES_PER_POINT - (store.s.teleport.metres || 0));
  const body = $('#sheet-body');
  body.innerHTML = '';

  const setTitle = name => SETS.find(s => s.setName === name)?.title || name;
  const setRow = el('div', { class: 'tp-sets' }, ...options.map(name => el('label', { class: 'tp-set' },
    el('input', { type: 'checkbox', checked: choice.sets.includes(name), onchange: e => {
      choice.sets = e.target.checked ? [...new Set([...choice.sets, name])] : choice.sets.filter(x => x !== name);
      paintGo();
    } }),
    el('span', { text: setTitle(name) }))));

  const cityRows = TELEPORT_CITIES.map(city => {
    const visited = store.teleportVisitedThisWeek(city.id);
    const wx = el('span', { class: 'tp-wx muted small', text: 'Weather…' });
    weatherAt(city.lat, city.lng)
      .then(r => { const c = conditionOf(r); wx.textContent = `${c.icon} ${Math.round(r.celsius)}°C · ${c.label}`; })
      .catch(() => { wx.textContent = 'Weather unavailable'; });
    const row = el('button', {
      class: 'tp-city' + (visited ? ' visited' : '') + (choice.cityId === city.id ? ' picked' : ''),
      type: 'button',
      disabled: visited,
      onclick: () => {
        choice.cityId = city.id;
        body.querySelectorAll('.tp-city').forEach(b => b.classList.toggle('picked', b === row));
        paintGo();
      }
    },
      el('span', { class: 'tp-flag', text: city.flag }),
      el('span', { class: 'tp-city-main' },
        el('b', { text: `${city.city} · ${city.place}` }),
        el('span', { class: 'muted small', text: visited ? 'Visited this week · back on Monday'
          : `🕒 ${cityClockLabel(city.timeZone)} local time` }),
        wx));
    return row;
  });
  if (choice.cityId && store.teleportVisitedThisWeek(choice.cityId)) choice.cityId = null;

  const go = el('button', { class: 'btn primary wide', onclick: () => {
    const why = store.teleportBlocker(choice.cityId, choice.sets);
    if (why) { toast(blockerText(why), 'bad', 3600); return; }
    closeSheet('sheet');
    hooks.enter?.(choice.cityId, [...choice.sets]);
  } });
  const paintGo = () => {
    const why = store.teleportBlocker(choice.cityId, choice.sets);
    go.disabled = !!why;
    go.textContent = why ? blockerText(why) : `🌀 Teleport · ${TELEPORT_COST} points`;
  };

  body.append(el('div', { style: { padding: '4px 0' } },
    el('h3', { text: '🌀 Teleport' }),
    el('p', { class: 'tp-points' },
      el('b', { text: `${pts} / ${TELEPORT_MAX_POINTS} teleport points` }),
      el('span', { class: 'muted small', text: toNext == null
        ? ' · full, walking earns no more until you spend some'
        : ` · ${toNext} m of walking to the next one` })),
    el('p', { class: 'hint', text: `Spend ${TELEPORT_COST} points for ${Math.round(TELEPORT_SESSION_MS / 60_000)} minutes in another city. `
      + 'Walk its streets with the arrows. Only creatures from the sets you pick appear, every fight is an Elite battle, '
      + 'and points never drop items or discs. Each city once a week.' }),
    el('h4', { class: 'sheet-h4', text: 'Sets' }),
    options.length ? setRow : el('p', { class: 'muted', text: 'No sets unlocked yet.' }),
    el('h4', { class: 'sheet-h4', text: 'City' }),
    el('div', { class: 'tp-cities' }, ...cityRows),
    el('div', { style: { marginTop: '12px' } }, go)));
  paintGo();
  openSheet('sheet');
}

function blockerText(why) {
  return {
    level: `Unlocks at level ${TELEPORT_MIN_LEVEL}`,
    active: 'Already teleported',
    city: 'Pick a city',
    visited: 'Already visited this week',
    points: `Need ${TELEPORT_COST} points (you have ${store.teleportPoints})`,
    sets: 'Pick at least one set'
  }[why] || 'Not available';
}

/** The strip under the timer while you are away. */
export function renderTeleportBanner(now = Date.now()) {
  const host = $('#teleport-banner');
  if (!host) return;
  const sess = store.teleportSession;
  if (!sess) { host.classList.add('hidden'); return; }
  const city = teleportCity(sess.cityId);
  host.classList.remove('hidden');
  const text = `🌀 ${city.flag} ${city.city} · ${city.place} · ${cityClockLabel(city.timeZone, now)} · ${mmss(sess.endsAt - now)} left`;
  const label = host.querySelector('.tp-banner-text');
  if (label && label.textContent !== text) label.textContent = text;
}

/** The button by the timer: dimmed with a lock until level 6, lit while away. */
export function renderTeleportButton() {
  const btn = $('#btn-teleport');
  if (!btn) return;
  btn.classList.toggle('locked', !store.teleportUnlocked);
  btn.classList.toggle('active', store.isTeleporting);
  const pts = store.teleportPoints;
  btn.title = store.teleportUnlocked
    ? (store.isTeleporting ? 'Teleported · tap for options' : `Teleport · ${pts} points`)
    : `Teleport unlocks at level ${TELEPORT_MIN_LEVEL}`;
  const badge = btn.querySelector('.tp-badge');
  if (badge) badge.textContent = store.teleportUnlocked && !store.isTeleporting ? String(pts) : '';
}

export { TELEPORT_STEP_M, TELEPORT_HOLD_SPEED_MS };
