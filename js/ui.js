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

export function wireSheetClosers() {
  document.addEventListener('click', e => {
    const target = e.target.closest('[data-close]');
    if (target) closeSheet(target.dataset.close);
  });
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
