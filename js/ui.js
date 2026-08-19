/* ============================================================
   ui.js — small shared UI helpers
   ============================================================ */

export const $ = sel => document.querySelector(sel);
export const $$ = sel => Array.from(document.querySelectorAll(sel));

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

/* ---------------------------------------------------------------
   Toasts
   --------------------------------------------------------------- */
export function toast(msg, kind = '', ms = 2600) {
  const host = $('#toasts');
  if (!host) return;
  const t = el('div', { class: `toast ${kind}`, text: msg });
  host.append(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 320);
  }, ms);
}

/* ---------------------------------------------------------------
   Bottom sheets
   --------------------------------------------------------------- */
export function openSheet(id) { $('#' + id)?.classList.remove('hidden'); }
export function closeSheet(id) { $('#' + id)?.classList.add('hidden'); }

/* ---------------------------------------------------------------
   Image viewer
   --------------------------------------------------------------- */

/**
 * Full-screen look at one image. Built on demand rather than living in
 * index.html, because it holds no state worth keeping between openings.
 * Tapping the backdrop, the ✕ or pressing Escape closes it.
 */
export function openImageViewer(src, alt = '') {
  document.getElementById('img-viewer')?.remove();

  const close = () => {
    view.remove();
    window.removeEventListener('keydown', onKey);
  };
  const onKey = e => { if (e.key === 'Escape') close(); };

  const view = el('div', {
    id: 'img-viewer',
    class: 'img-viewer',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': alt ? `${alt}, enlarged` : 'Enlarged image',
    onclick: close
  },
    // Stop a tap on the picture itself from closing, so it can be studied.
    el('img', { src, alt, onclick: e => e.stopPropagation() }),
    alt ? el('div', { class: 'img-viewer-cap', text: alt }) : null,
    el('button', { class: 'img-viewer-close', 'aria-label': 'Close', onclick: close }, '✕')
  );

  document.body.append(view);
  window.addEventListener('keydown', onKey);
  return view;
}

export function wireSheetClosers() {
  document.addEventListener('click', e => {
    const target = e.target.closest('[data-close]');
    if (target) closeSheet(target.dataset.close);
  });
}

/* ---------------------------------------------------------------
   Paging
   Long creature lists are cut into pages so the grid stays scrollable on a
   phone. Sorting always happens across the whole list first, then the result
   is sliced, so page 1 really does hold the first PAGE_SIZE in that order.
   --------------------------------------------------------------- */
export const PAGE_SIZE = 90;

export const pageCount = (total, size = PAGE_SIZE) => Math.max(1, Math.ceil(total / size));

export const clampPage = (page, total, size = PAGE_SIZE) =>
  Math.min(Math.max(0, Number(page) || 0), pageCount(total, size) - 1);

export function pageSlice(list, page, size = PAGE_SIZE) {
  const p = clampPage(page, list.length, size);
  return list.slice(p * size, p * size + size);
}

/** Which page a given index falls on. */
export const pageOfIndex = (index, size = PAGE_SIZE) => Math.floor(Math.max(0, index) / size);

/**
 * "«  ‹  Page 2 of 4  ›  »" with the item range underneath. The outer buttons
 * jump straight to the first and last page, which matters once a big
 * collection runs to many pages. Returns null for a single page so short
 * lists stay uncluttered.
 */
export function pagerBar(page, total, onGo, size = PAGE_SIZE) {
  const pages = pageCount(total, size);
  if (pages <= 1) return null;
  const p = clampPage(page, total, size);
  const from = p * size + 1;
  const to = Math.min(total, (p + 1) * size);
  return el('div', { class: 'pager' },
    el('button', {
      class: 'arrow-btn', disabled: p === 0, title: 'First page',
      'aria-label': 'First page', onclick: () => onGo(0)
    }, '«'),
    el('button', {
      class: 'arrow-btn', disabled: p === 0, title: 'Previous page',
      'aria-label': 'Previous page', onclick: () => onGo(p - 1)
    }, '‹'),
    el('div', { class: 'pager-mid' },
      el('span', { class: 'pager-page', text: `Page ${p + 1} of ${pages}` }),
      el('span', { class: 'pager-range muted small', text: `${from}–${to} of ${total}` })
    ),
    el('button', {
      class: 'arrow-btn', disabled: p >= pages - 1, title: 'Next page',
      'aria-label': 'Next page', onclick: () => onGo(p + 1)
    }, '›'),
    el('button', {
      class: 'arrow-btn', disabled: p >= pages - 1, title: 'Last page',
      'aria-label': 'Last page', onclick: () => onGo(pages - 1)
    }, '»')
  );
}

/**
 * Horizontal swipe on a container. Vertical drags are ignored so the element
 * can still be scrolled, and short drags are ignored so taps still work.
 *
 * Listeners are attached once per host and read the latest handlers from the
 * element itself. Re-rendering a grid calls this again, and without that guard
 * every render would stack another listener.
 */
export function wireSwipe(host, handlers, { key = 'swipe', minPx = 45 } = {}) {
  if (!host) return;
  host['_swipe_' + key] = handlers;
  const flag = key + 'Wired';
  if (host.dataset[flag]) return;
  host.dataset[flag] = '1';

  let x0 = null, y0 = null, done = false;

  host.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { x0 = null; return; }
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
    done = false;
  }, { passive: true });

  host.addEventListener('touchmove', e => {
    if (x0 == null || done || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - x0;
    const dy = e.touches[0].clientY - y0;
    if (Math.abs(dy) > Math.abs(dx)) { x0 = null; return; }   // scrolling, not swiping
    if (Math.abs(dx) < minPx) return;
    done = true;
    const h = host['_swipe_' + key] || {};
    (dx > 0 ? h.onRight : h.onLeft)?.();
  }, { passive: true });

  host.addEventListener('touchend', () => { x0 = null; }, { passive: true });
}

/** Small nudge when a swipe has nowhere to go. */
export function bumpEl(host, dir) {
  if (!host) return;
  host.classList.remove('bump-left', 'bump-right');
  void host.offsetWidth;
  host.classList.add(dir === 'left' ? 'bump-left' : 'bump-right');
  setTimeout(() => host.classList.remove('bump-left', 'bump-right'), 260);
}

/* ---------------------------------------------------------------
   Formatting
   --------------------------------------------------------------- */
export const num = n => Number(n || 0).toLocaleString();

export function timeLeftLabel(ms) {
  if (ms <= 0) return '0:00';
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function rarityTag(rarity, names) {
  return el('span', { class: `tag r-${rarity}`, text: `${rarity} · ${names[rarity]}` });
}

/* ---------------------------------------------------------------
   Confetti (canvas, used for "NEW" captures and registrations)
   --------------------------------------------------------------- */
const CONFETTI_COLOURS = ['#ffd166', '#ff8ec7', '#7b8cff', '#4ade80', '#56d2f0', '#ffffff'];

export function confettiBurst(canvas, { count = 150, duration = 2600 } = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const parts = Array.from({ length: count }, () => ({
    x: w / 2 + (Math.random() - 0.5) * w * 0.35,
    y: h * 0.45 + (Math.random() - 0.5) * 40,
    vx: (Math.random() - 0.5) * 9,
    vy: -Math.random() * 12 - 3,
    g: 0.22 + Math.random() * 0.12,
    size: 4 + Math.random() * 7,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    colour: CONFETTI_COLOURS[Math.floor(Math.random() * CONFETTI_COLOURS.length)],
    shape: Math.random() < 0.35 ? 'circle' : 'rect'
  }));

  const start = performance.now();
  let raf = 0;

  function frame(t) {
    const elapsed = t - start;
    const fade = Math.max(0, 1 - elapsed / duration);
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.995;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.colour;
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size / 1.6);
      }
      ctx.restore();
    }
    if (elapsed < duration) raf = requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, w, h);
  }
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); ctx.clearRect(0, 0, w, h); };
}

export function clearCanvas(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
