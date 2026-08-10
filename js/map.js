/* ============================================================
   map.js — Leaflet map, player marker, spawn markers with timers
   ============================================================ */

import { RULES } from './data.js';
import { distance } from './geo.js';
import { timeLeftLabel } from './ui.js';

const STAR_HTML = `
  <div class="glow"></div>
  <div class="stars">
    <span class="s s1">✦</span>
    <span class="s s2">✧</span>
    <span class="s s3">★</span>
    <span class="s s4">✩</span>
    <span class="s s5">✫</span>
  </div>`;

export const GameMap = {
  map: null,
  meMarker: null,
  meAccuracy: null,
  scanCircle: null,
  spawnLayer: null,
  poiLayer: null,
  markers: new Map(),   // spawnId -> { marker, el, timerEl, spawn }
  poiMarkers: new Map(),
  onSpawnClick: null,
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

      this.map.setView(ll, 18);
    } else {
      this.meMarker.setLatLng(ll);
      this.scanCircle.setLatLng(ll);
      this.meAccuracy.setLatLng(ll);
      if (this.followMe) this.map.panTo(ll, { animate: true, duration: .5 });
    }
  },

  recenter() {
    this.followMe = true;
    if (this._lastPos && this.map) this.map.setView([this._lastPos.lat, this._lastPos.lng], Math.max(this.map.getZoom(), 18));
  },

  /* ---------------- spawns ---------------- */

  /** Adds/removes markers so the map matches the given spawn list. */
  syncSpawns(spawns) {
    if (!this.map) return;
    const wanted = new Set(spawns.map(s => s.id));

    for (const [id, rec] of this.markers) {
      if (!wanted.has(id)) {
        this.spawnLayer.removeLayer(rec.marker);
        this.markers.delete(id);
      }
    }

    for (const spawn of spawns) {
      const existing = this.markers.get(spawn.id);
      if (existing) { existing.spawn = spawn; continue; }

      const root = document.createElement('div');
      root.className = 'spawn-marker';
      root.innerHTML = `<div class="spawn-timer">--:--</div>${STAR_HTML}`;

      const marker = L.marker([spawn.lat, spawn.lng], {
        icon: L.divIcon({ className: '', html: root, iconSize: [54, 66], iconAnchor: [27, 60] }),
        zIndexOffset: 500,
        riseOnHover: true
      }).addTo(this.spawnLayer);

      marker.on('click', () => this.onSpawnClick?.(spawn));

      this.markers.set(spawn.id, {
        marker,
        el: root,
        timerEl: root.querySelector('.spawn-timer'),
        spawn
      });
    }
  },

  /** Refresh countdowns and in-range styling. Called about once a second. */
  tick(now, playerPos) {
    for (const rec of this.markers.values()) {
      const left = rec.spawn.expiresAt - now;
      rec.timerEl.textContent = timeLeftLabel(left);
      rec.timerEl.classList.toggle('urgent', left <= 60_000);

      if (playerPos) {
        const d = distance(playerPos, rec.spawn);
        const inRange = d <= RULES.CAPTURE_RANGE_M;
        rec.el.classList.toggle('in-range', inRange);
        rec.el.classList.toggle('out-range', !inRange);
      }
    }
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
