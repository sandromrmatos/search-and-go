/* ============================================================
   map.js — Leaflet map, player marker, spawn markers with timers
   ============================================================ */

import { RULES } from './data.js';
import { distance } from './geo.js';
import { timeLeftLabel } from './ui.js';

/** How far you must twist before rotation engages, so pinching stays pinching. */
const ROTATE_DEADZONE_DEG = 8;
/** Let go within this of north and it snaps flat. */
const ROTATE_SNAP_DEG = 5;

const norm360 = d => ((d % 360) + 360) % 360;
/** Signed difference in (-180, 180], so twisting past 0 does not jump 359°. */
const shortestAngle = d => { const x = norm360(d); return x > 180 ? x - 360 : x; };

/* Each kind of map point gets its own unmistakable icon. */
const ICON_HTML = {
  creature: `
    <div class="glow"></div>
    <div class="stars">
      <span class="s s1">✦</span>
      <span class="s s2">✧</span>
      <span class="s s3">★</span>
      <span class="s s4">✩</span>
      <span class="s s5">✫</span>
    </div>`,
  discs: `
    <div class="glow glow-disc"></div>
    <div class="icon-wrap"><span class="ico-disc">◉</span></div>`,
  items: `
    <div class="glow glow-item"></div>
    <div class="icon-wrap"><span class="ico-bang">!</span></div>`,
  raid: `
    <div class="glow glow-raid"></div>
    <div class="icon-wrap"><span class="ico-flame">🔥</span></div>`,
  exraid: `
    <div class="glow glow-exraid"></div>
    <div class="icon-wrap"><span class="ico-flame-blue">🔥</span></div>`,
  grunt: `
    <div class="glow glow-grunt"></div>
    <div class="icon-wrap"><span class="ico-grunt">🧍</span></div>`
};

const GRUNT_GLYPH = {
  young_man: '🧑', young_woman: '👩', adult_man: '👨', adult_woman: '👩‍🦰'
};

function iconFor(point) {
  if (point.kind === 'grunt') {
    const glyph = GRUNT_GLYPH[point.grunt?.character] || '🧍';
    return `<div class="glow glow-grunt"></div>
            <div class="icon-wrap"><span class="ico-grunt">${glyph}</span></div>`;
  }
  // Exclusive raids are raid points with a flag, and get the blue flame.
  if (point.kind === 'raid' && point.raid?.exclusive) return ICON_HTML.exraid;
  return ICON_HTML[point.kind] || ICON_HTML.creature;
}

export const GameMap = {
  map: null,
  meMarker: null,
  meAccuracy: null,
  scanCircle: null,
  spawnLayer: null,
  poiLayer: null,
  breedingLayer: null,
  breedingMarker: null,
  markers: new Map(),   // pointId -> { marker, el, timerEl, point }
  poiMarkers: new Map(),
  onSpawnClick: null,
  onBreedingClick: null,
  followMe: true,
  _lastPos: null,
  _paintedRange: null,  // interaction radius the green ring is currently drawn at

  init(containerId = 'map') {
    if (typeof L === 'undefined') throw new Error('Leaflet failed to load (vendor/leaflet/leaflet.js)');
    this.el = document.getElementById(containerId);
    this.map = L.map(containerId, {
      zoomControl: false,
      // Both the attribution and the zoom buttons live in the overlay instead
      // of inside the map, so rotation never tips them over or pushes them
      // outside the visible area.
      attributionControl: false,
      tap: true,
      worldCopyJump: true,
      touchZoom: true
    }).setView([51.5079, -0.1283], 17);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(this.map);

    this.poiLayer = L.layerGroup().addTo(this.map);
    this.breedingLayer = L.layerGroup().addTo(this.map);
    this.spawnLayer = L.layerGroup().addTo(this.map);

    // Any manual pan turns off auto-follow so the map stops fighting the user.
    this.map.on('dragstart', () => { this.followMe = false; });

    this._patchPointerMaths();
    this._initRotation();

    return this;
  },

  invalidate() { setTimeout(() => this.map?.invalidateSize(), 60); },

  /* ===============================================================
     Rotation

     The container is rotated with a CSS transform, which gives real
     two-finger rotation over raster tiles. Three things have to be handled
     for that to behave:

       1. A rotated rectangle does not cover the screen, so while rotated the
          container grows to a square as wide as the viewport diagonal. The
          parent clips it, so the corners are always full of map.
       2. Leaflet works in unrotated container coordinates. Every pointer
          position it reads is put back through the inverse rotation, so taps,
          pinch-zoom and the wheel all land where you expect.
       3. Leaflet's own drag moves the map by raw screen deltas, which would
          send the map off at an angle. While rotated we pan by hand instead.

     Markers counter-rotate in CSS about their anchor point, so pins and
     timers stay upright and pinned to the same spot.
     =============================================================== */

  bearing: 0,

  /** Leaflet reads pointer positions through this, so one patch covers it all. */
  _patchPointerMaths() {
    const map = this.map;
    const original = map.mouseEventToContainerPoint.bind(map);
    map.mouseEventToContainerPoint = e => {
      if (!this.bearing) return original(e);
      return this.screenToContainerPoint(e) || original(e);
    };
  },

  /** Screen coordinates -> unrotated container coordinates. */
  screenToContainerPoint(e) {
    const x = e?.clientX, y = e?.clientY;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    const el = this.el;
    // For a rotated element this is the axis-aligned bounding box, but its
    // centre is still the rotation centre, which is all we need.
    const r = el.getBoundingClientRect();
    const dx = x - (r.left + r.width / 2);
    const dy = y - (r.top + r.height / 2);
    const a = -this.bearing * Math.PI / 180;
    return L.point(
      el.offsetWidth / 2 + dx * Math.cos(a) - dy * Math.sin(a),
      el.offsetHeight / 2 + dx * Math.sin(a) + dy * Math.cos(a)
    );
  },

  /** Rotates a screen-space delta into map-space. */
  _unrotateDelta(dx, dy) {
    const a = -this.bearing * Math.PI / 180;
    return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
  },

  setBearing(deg) {
    const next = norm360(deg);
    if (next === this.bearing) return;
    const wasRotated = this.bearing !== 0;
    this.bearing = next;
    if ((next !== 0) !== wasRotated) this._setRotatedMode(next !== 0);
    // One custom property drives the container and every counter-rotation.
    document.documentElement.style.setProperty('--map-bearing', next + 'deg');
    this.onBearingChange?.(next);
  },

  resetNorth() { this.setBearing(0); },

  _setRotatedMode(on) {
    const el = this.el;
    if (on) {
      const w = el.clientWidth, h = el.clientHeight;   // read before resizing
      el.style.setProperty('--map-size', Math.ceil(Math.sqrt(w * w + h * h)) + 'px');
      el.classList.add('rotated');
      this.map.dragging.disable();
    } else {
      el.classList.remove('rotated');
      el.style.removeProperty('--map-size');
      this.map.dragging.enable();
    }
    // pan:false keeps the geographic centre exactly where it is.
    this.map.invalidateSize({ animate: false, pan: false });
  },

  _initRotation() {
    const el = this.el;
    let startAngle = null, startBearing = 0, rotating = false;
    let dragFrom = null;

    const twoFingerAngle = (a, b) =>
      Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180 / Math.PI;

    const panByScreen = (dx, dy) => {
      const [rx, ry] = this._unrotateDelta(dx, dy);
      this.followMe = false;
      this.map.panBy([-rx, -ry], { animate: false });
    };

    el.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        startAngle = twoFingerAngle(e.touches[0], e.touches[1]);
        startBearing = this.bearing;
        rotating = false;
        dragFrom = null;
      } else if (e.touches.length === 1 && this.bearing) {
        dragFrom = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    }, { passive: true });

    el.addEventListener('touchmove', e => {
      if (e.touches.length === 2 && startAngle !== null) {
        const delta = shortestAngle(twoFingerAngle(e.touches[0], e.touches[1]) - startAngle);
        // A deadzone means an ordinary pinch-zoom never rotates by accident.
        if (!rotating && Math.abs(delta) < ROTATE_DEADZONE_DEG) return;
        rotating = true;
        this.setBearing(startBearing + delta);
        return;
      }
      if (e.touches.length === 1 && dragFrom && this.bearing) {
        const t = e.touches[0];
        panByScreen(t.clientX - dragFrom.x, t.clientY - dragFrom.y);
        dragFrom = { x: t.clientX, y: t.clientY };
        e.preventDefault();
      }
    }, { passive: false });

    el.addEventListener('touchend', e => {
      if (e.touches.length < 2) { startAngle = null; rotating = false; }
      if (e.touches.length === 0) {
        dragFrom = null;
        // Ease back to true north once you are nearly there.
        const off = Math.min(this.bearing, 360 - this.bearing);
        if (off > 0 && off <= ROTATE_SNAP_DEG) this.setBearing(0);
      }
    }, { passive: true });

    // Desktop: Leaflet's drag is off while rotated, so pan with the mouse here.
    let mouseFrom = null;
    el.addEventListener('mousedown', e => {
      if (!this.bearing || e.button !== 0) return;
      mouseFrom = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mousemove', e => {
      if (!mouseFrom || !this.bearing) return;
      panByScreen(e.clientX - mouseFrom.x, e.clientY - mouseFrom.y);
      mouseFrom = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mouseup', () => { mouseFrom = null; });
  },

  /* ---------------- player ---------------- */

  setPlayer(pos) {
    if (!pos || !this.map) return;
    const ll = [pos.lat, pos.lng];
    this._lastPos = pos;

    if (!this.meMarker) {
      this.meMarker = L.marker(ll, {
        icon: L.divIcon({
          className: '',
          html: '<div class="me-dot"><b></b><i></i></div>',
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        }),
        interactive: false,
        zIndexOffset: 900
      }).addTo(this.map);

      this.scanCircle = L.circle(ll, {
        radius: RULES.SCAN_RADIUS_M,
        color: '#7b8cff', weight: 1, opacity: .5,
        fillColor: '#7b8cff', fillOpacity: .06,
        interactive: false
      }).addTo(this.map);

      this.meAccuracy = L.circle(ll, {
        radius: RULES.CAPTURE_RANGE_M,
        color: '#4ade80', weight: 1, opacity: .7,
        fillColor: '#4ade80', fillOpacity: .12,
        interactive: false
      }).addTo(this.map);

      // Open on a zoom that shows the whole spawn radius, whatever it is set to.
      this.fitScanArea();
    } else {
      this.meMarker.setLatLng(ll);
      this.scanCircle.setLatLng(ll);
      this.meAccuracy.setLatLng(ll);
      if (this.followMe) this.map.panTo(ll, { animate: true, duration: .5 });
    }
  },

  /** Frames the whole scannable area around the player. */
  fitScanArea() {
    if (!this.map || !this.scanCircle) return;
    let padding = [24, 24];
    if (this.bearing) {
      // While rotated the container is larger than the screen, so fitting to
      // it would push the circle past the visible edges. Pad by the hidden
      // margin to keep the fit inside what you can actually see.
      const view = this.el.parentElement;
      const size = this.el.offsetWidth;
      padding = [
        24 + Math.max(0, (size - view.clientWidth) / 2),
        24 + Math.max(0, (size - view.clientHeight) / 2)
      ];
    }
    this.map.fitBounds(this.scanCircle.getBounds(), { padding, animate: false });
  },

  recenter() {
    this.followMe = true;
    if (this._lastPos && this.map) this.fitScanArea();
  },

  /* ---------------- spawns ---------------- */

  /** Adds/removes markers so the map matches the given point list. */
  syncPoints(points) {
    if (!this.map) return;
    const wanted = new Set(points.map(p => p.id));

    for (const [id, rec] of this.markers) {
      if (!wanted.has(id)) {
        this.spawnLayer.removeLayer(rec.marker);
        this.markers.delete(id);
      }
    }

    for (const point of points) {
      const existing = this.markers.get(point.id);
      if (existing) {
        existing.point = point;
        existing.el.classList.toggle('collected', !!point.collected);
        continue;
      }

      const root = document.createElement('div');
      root.className = `spawn-marker kind-${point.kind}${point.collected ? ' collected' : ''}`;
      root.innerHTML =
        `<div class="spawn-timer">--:--</div>${iconFor(point)}<div class="tick">✓</div>`;

      const marker = L.marker([point.lat, point.lng], {
        icon: L.divIcon({ className: '', html: root, iconSize: [54, 66], iconAnchor: [27, 60] }),
        zIndexOffset: point.kind === 'raid' ? 700 : 500,
        riseOnHover: true
      }).addTo(this.spawnLayer);

      marker.on('click', () => this.onSpawnClick?.(this.markers.get(point.id)?.point || point));

      this.markers.set(point.id, {
        marker,
        el: root,
        timerEl: root.querySelector('.spawn-timer'),
        point
      });
    }
  },

  /**
   * Refresh countdowns and in-range styling. Called about once a second.
   * `range` is how far the player can reach right now: normally
   * RULES.CAPTURE_RANGE_M, wider during Relax and Good Night, and Infinity
   * when the debug override is on.
   */
  tick(now, playerPos, { range = RULES.CAPTURE_RANGE_M } = {}) {
    const unlimited = !isFinite(range);
    // Keep the green ring showing the real reach. Only touch Leaflet when the
    // number actually changes — this runs every second.
    if (this.meAccuracy && this._paintedRange !== range) {
      this._paintedRange = range;
      if (unlimited) {
        this.meAccuracy.setStyle({ opacity: 0, fillOpacity: 0 });
      } else {
        this.meAccuracy.setRadius(range);
        this.meAccuracy.setStyle({ opacity: .7, fillOpacity: .12 });
      }
    }

    for (const rec of this.markers.values()) {
      const left = rec.point.expiresAt - now;
      rec.timerEl.textContent = timeLeftLabel(left);
      rec.timerEl.classList.toggle('urgent', left <= 60_000);
      rec.el.classList.toggle('collected', !!rec.point.collected);

      if (playerPos || unlimited) {
        const near = unlimited || distance(playerPos, rec.point) <= range;
        const inRange = near && !rec.point.collected;
        rec.el.classList.toggle('in-range', inRange);
        rec.el.classList.toggle('out-range', !inRange);
      }
    }
    if (this.breedingMarker && (playerPos || unlimited)) {
      const ll = this.breedingMarker.getLatLng();
      const near = unlimited || distance(playerPos, { lat: ll.lat, lng: ll.lng }) <= range;
      const el = this.breedingMarker.getElement?.()?.querySelector('.breed-flag');
      if (el) el.classList.toggle('in-range', near);
    }
  },

  /** The breeding centre is a permanent pin, so it lives on its own layer. */
  syncBreeding(centre) {
    if (!this.map || !this.breedingLayer) return;
    if (!centre) {
      this.breedingLayer.clearLayers();
      this.breedingMarker = null;
      return;
    }
    if (this.breedingMarker) {
      this.breedingMarker.setLatLng([centre.lat, centre.lng]);
      return;
    }
    this.breedingMarker = L.marker([centre.lat, centre.lng], {
      icon: L.divIcon({
        className: '',
        // The wrapper takes the counter-rotation; the flag itself keeps its
        // in-range bobbing animation, which also uses transform.
        html: '<div class="breed-rot"><div class="breed-flag"><span>⚑</span></div></div>',
        iconSize: [40, 46],
        iconAnchor: [20, 42]
      }),
      zIndexOffset: 400
    }).addTo(this.breedingLayer);
    this.breedingMarker.on('click', () => this.onBreedingClick?.(centre));
  },

  /* ---------------- debug POI overlay ---------------- */

  showPOIs(pois) {
    if (!this.poiLayer) return;
    this.poiLayer.clearLayers();
    this.poiMarkers.clear();
    if (!pois) return;
    for (const p of pois) {
      const m = L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: '', html: '<div class="poi-dot"></div>', iconSize: [8, 8], iconAnchor: [4, 4] }),
        zIndexOffset: 100
      }).bindTooltip(`${p.name} · ${p.kind}=${p.kindValue}`, { direction: 'top', offset: [0, -6] })
        .addTo(this.poiLayer);
      this.poiMarkers.set(p.id, m);
    }
  },

  clearPOIs() { this.poiLayer?.clearLayers(); this.poiMarkers.clear(); }
};
