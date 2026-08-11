/* ============================================================
   anim.js — the 5 second capture and evolution sequences
   ============================================================ */

import { $, el, sleep, confettiBurst, clearCanvas } from './ui.js';
import { RULES, RARITY_NAMES, species, familyRarity } from './data.js';

const STAR_GLYPHS = ['✦', '✧', '★', '✩', '✫', '✬', '❋'];
const BURST_COLOURS = ['#ffd166', '#fff6c9', '#ff8ec7', '#7b8cff', '#56d2f0', '#4ade80'];

let stopConfetti = null;

function buildSparkles(host, count = 9) {
  host.innerHTML = '';
  host.className = 'sparkle-cluster';
  host.style.animation = '';
  const radii = [0, 34, 52, 68];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
    const r = i === 0 ? 0 : radii[1 + (i % 3)] * (0.75 + Math.random() * 0.5);
    const size = i === 0 ? 40 : 16 + Math.random() * 20;
    host.append(el('span', {
      class: 'cs',
      text: STAR_GLYPHS[i % STAR_GLYPHS.length],
      style: {
        fontSize: size + 'px',
        transform: `translate(${Math.cos(angle) * r}px, ${Math.sin(angle) * r}px)`,
        animationDelay: (Math.random() * 1.1).toFixed(2) + 's'
      }
    }));
  }
}

function buildBurst(host, count = 34) {
  host.innerHTML = '';
  host.className = 'burst';
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 90 + Math.random() * 130;
    const size = 6 + Math.random() * 9;
    host.append(el('i', {
      class: 'p',
      style: {
        '--dx': `${Math.cos(angle) * dist}px`,
        '--dy': `${Math.sin(angle) * dist}px`,
        width: size + 'px',
        height: size + 'px',
        margin: `${-size / 2}px`,
        background: BURST_COLOURS[i % BURST_COLOURS.length],
        boxShadow: `0 0 10px ${BURST_COLOURS[i % BURST_COLOURS.length]}`,
        animationDelay: (Math.random() * 0.12).toFixed(2) + 's'
      }
    }));
  }
  // restart the animation
  void host.offsetWidth;
  host.classList.add('go');
}

/**
 * Decode an image before we show it. Without this the <img> keeps painting the
 * previous creature for a frame or two after `src` changes, which looked like a
 * flash of whatever you caught last.
 */
function preload(src) {
  return new Promise(resolve => {
    const img = new Image();
    const done = () => resolve(src);
    img.onload = () => (img.decode ? img.decode().then(done, done) : done());
    img.onerror = done;
    img.src = src;
  });
}

function resetStage() {
  const stage = $('#stage');
  stage.classList.remove('hidden');
  $('#reveal').classList.add('hidden');
  $('#reveal-new').classList.add('hidden');
  $('#stage-anim').classList.remove('hidden');

  // Drop the old bitmap so a stale image can never be shown.
  const rev = $('#reveal-img');
  rev.removeAttribute('src');

  const img = $('#anim-img');
  img.classList.add('hidden');
  img.classList.remove('shake', 'pop');
  img.removeAttribute('src');
  img.style.animation = '';
  $('#burst').classList.remove('go');
  $('#burst').innerHTML = '';
  stopConfetti?.();
  stopConfetti = null;
  clearCanvas($('#confetti'));
}

function hideStage() {
  $('#stage').classList.add('hidden');
  stopConfetti?.();
  stopConfetti = null;
  clearCanvas($('#confetti'));
}

/* ---------------------------------------------------------------
   Reveal card
   --------------------------------------------------------------- */
function showReveal({ sp, isNew, rewards, title, imageSrc, shiny }) {
  $('#stage-anim').classList.add('hidden');
  const reveal = $('#reveal');
  reveal.classList.remove('hidden');

  const banner = $('#reveal-new');
  if (shiny) {
    banner.textContent = '★ SHINY ★';
    banner.className = 'new-banner shiny-banner';
    banner.classList.remove('hidden');
  } else {
    banner.textContent = title || 'NEW!';
    banner.className = 'new-banner';
    banner.classList.toggle('hidden', !isNew);
  }

  $('#reveal-img').src = imageSrc || sp.imagePath;
  $('#reveal-img').alt = sp.name;
  $('#reveal-name').textContent = sp.name;

  const typeEl = $('#reveal-type');
  typeEl.textContent = sp.type;
  typeEl.className = `tag t-${sp.type}`;

  $('#reveal-stage').textContent = sp.stageLabel;

  const rarEl = $('#reveal-rarity');
  const rarity = sp.rarity || familyRarity(sp.id);
  if (rarity) {
    rarEl.textContent = `${rarity} · ${RARITY_NAMES[rarity]}`;
    rarEl.className = `tag r-${rarity}`;
    rarEl.classList.remove('hidden');
  } else {
    rarEl.classList.add('hidden');
  }

  const host = $('#reveal-rewards');
  host.innerHTML = '';
  for (const r of rewards || []) {
    host.append(el('span', { class: 'reward' },
      el('span', { text: r.icon }),
      el('span', { text: r.label })
    ));
  }

  if (shiny) {
    stopConfetti = shinyFireworks($('#confetti'));
  } else if (isNew) {
    stopConfetti = confettiBurst($('#confetti'), { count: 170, duration: 3000 });
  }
}

/** Massive fireworks burst for shiny catches — gold/white stars + sparks. */
function shinyFireworks(canvas) {
  if (!canvas) return () => {};
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const COLOURS = ['#ffd166', '#ffffff', '#ffe9a8', '#ff8ec7', '#7b8cff', '#4ade80', '#56d2f0', '#ffcc4d'];
  const STAR = '★✦✧✩✫❋⭐';
  const count = 280;
  const duration = 4200;

  const parts = Array.from({ length: count }, (_, i) => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 14;
    const isStar = i < 60;
    return {
      x: w / 2 + (Math.random() - 0.5) * w * 0.2,
      y: h * 0.42 + (Math.random() - 0.5) * 30,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (isStar ? 4 : 0),
      g: 0.12 + Math.random() * 0.1,
      size: isStar ? 10 + Math.random() * 16 : 3 + Math.random() * 7,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
      char: isStar ? STAR[Math.floor(Math.random() * STAR.length)] : null,
      delay: Math.random() * 600
    };
  });

  const start = performance.now();
  let raf = 0;

  function frame(t) {
    const elapsed = t - start;
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      const age = elapsed - p.delay;
      if (age < 0) continue;
      const fade = Math.max(0, 1 - age / duration);
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.994;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.char) {
        ctx.font = `${p.size}px sans-serif`;
        ctx.fillStyle = p.colour;
        ctx.shadowColor = p.colour;
        ctx.shadowBlur = 12;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.char, 0, 0);
      } else {
        ctx.fillStyle = p.colour;
        ctx.shadowColor = p.colour;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    if (elapsed < duration + 600) raf = requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, w, h);
  }
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); ctx.clearRect(0, 0, w, h); };
}

/** Waits for the player to dismiss the reveal card. */
function waitForDismiss() {
  return new Promise(resolve => {
    const btn = $('#reveal-ok');
    const done = () => { btn.removeEventListener('click', done); hideStage(); resolve(); };
    btn.addEventListener('click', done);
  });
}

/* ---------------------------------------------------------------
   Capture: sparkles grow → shake → explode → creature revealed
   --------------------------------------------------------------- */
export async function playCapture({ sp, isNew, rewards, imageSrc, shiny }) {
  resetStage();
  const total = RULES.CAPTURE_ANIM_MS;
  const growMs = Math.max(1200, total - 700);
  const revealAt = growMs + 350;
  const src = imageSrc || sp.imagePath;

  // We have five seconds of sparkles — plenty of time to fetch and decode.
  const ready = preload(src);

  const cluster = $('#sparkle-cluster');
  buildSparkles(cluster, 9);
  void cluster.offsetWidth;
  cluster.style.animation = `growShake ${growMs}ms cubic-bezier(.4,0,.6,1) forwards`;

  await sleep(growMs);

  cluster.style.animation = 'popOut 340ms ease-out forwards';
  buildBurst($('#burst'), 36);

  await sleep(revealAt - growMs);
  await ready;

  showReveal({ sp, isNew, rewards, imageSrc: src, shiny });
  await waitForDismiss();
}

/* ---------------------------------------------------------------
   Evolution: current form shakes → explodes → new form revealed
   --------------------------------------------------------------- */
export async function playEvolution({ from, to, isNew, rewards, fromSrc, toSrc }) {
  resetStage();
  const total = RULES.EVOLVE_ANIM_MS;
  const shakeMs = Math.max(1200, total - 700);
  const revealAt = shakeMs + 350;
  const beforeSrc = fromSrc || from.imagePath;
  const afterSrc = toSrc || to.imagePath;

  const cluster = $('#sparkle-cluster');
  cluster.innerHTML = '';
  cluster.style.animation = '';

  const img = $('#anim-img');
  await preload(beforeSrc);
  const ready = preload(afterSrc);

  img.src = beforeSrc;
  img.alt = from.name;
  img.classList.remove('hidden');
  void img.offsetWidth;
  img.style.animation = `evoShake ${shakeMs}ms cubic-bezier(.4,0,.6,1) forwards`;

  await sleep(shakeMs);

  img.style.animation = 'popOut 340ms ease-out forwards';
  buildBurst($('#burst'), 40);

  await sleep(revealAt - shakeMs);
  await ready;

  showReveal({ sp: to, isNew, rewards, title: isNew ? 'NEW!' : 'EVOLVED!', imageSrc: afterSrc });
  // Evolutions always feel celebratory, even for a repeat.
  if (!isNew) stopConfetti = confettiBurst($('#confetti'), { count: 90, duration: 2200 });
  await waitForDismiss();
}

export { hideStage };
