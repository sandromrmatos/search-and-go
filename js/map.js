/* ============================================================
   map.js — Leaflet map, player marker, spawn markers with timers
   ============================================================ */

import { RULES } from './data.js';
import { distance } from './geo.js';
import { timeLeftLabel } from './ui.js';

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

  init(containerId = 'map') {
    if (typeof L === 'undefined') throw new Error('Leaflet failed to load (vendor/leaflet/leaflet.js)');
    this.map = L.map(containerId, {
      zoomControl: false,
      attributionControl: true,
      tap: true,
      worldCopyJump: true
    }).setView([51.5079, -0.1283], 17);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(this.map);

    L.control.zoom({ position: 'topright' }).addTo(this.map);

    this.poiLayer = L.layerGroup().addTo(this.map);
    this.breedingLayer = L.layerGroup().addTo(this.map);
    this.spawnLayer = L.layerGroup().addTo(this.map);

    // Any manual pan turns off auto-follow so the map stops fighting the user.
    this.map.on('dragstart', () => { this.followMe = false; });

    return this;
  },

  invalidate() { setTimeout(() => this.map?.invalidateSize(), 60); },

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
    this.map.fitBounds(this.scanCircle.getBounds(), { padding: [24, 24], animate: false });
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

  /** Refresh countdowns and in-range styling. Called about once a second. */
  tick(now, playerPos) {
    for (const rec of this.markers.values()) {
      const left = rec.point.expiresAt - now;
      rec.timerEl.textContent = timeLeftLabel(left);
      rec.timerEl.classList.toggle('urgent', left <= 60_000);
      rec.el.classList.toggle('collected', !!rec.point.collected);

      if (playerPos) {
        const d = distance(playerPos, rec.point);
        const inRange = d <= RULES.CAPTURE_RANGE_M && !rec.point.collected;
        rec.el.classList.toggle('in-range', inRange);
        rec.el.classList.toggle('out-range', !inRange);
      }
    }
    if (this.breedingMarker && playerPos) {
      const d = distance(playerPos, this.breedingMarker.getLatLng
        ? { lat: this.breedingMarker.getLatLng().lat, lng: this.breedingMarker.getLatLng().lng }
        : playerPos);
      const el = this.breedingMarker.getElement?.()?.querySelector('.breed-flag');
      if (el) el.classList.toggle('in-range', d <= RULES.CAPTURE_RANGE_M);
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
        html: '<div class="breed-flag"><span>⚑</span></div>',
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
