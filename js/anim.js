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

function resetStage() {
  const stage = $('#stage');
  stage.classList.remove('hidden');
  $('#reveal').classList.add('hidden');
  $('#reveal-new').classList.add('hidden');
  $('#stage-anim').classList.remove('hidden');
  const img = $('#anim-img');
  img.classList.add('hidden');
  img.classList.remove('shake', 'pop');
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
function showReveal({ sp, isNew, rewards, title }) {
  $('#stage-anim').classList.add('hidden');
  const reveal = $('#reveal');
  reveal.classList.remove('hidden');

  const banner = $('#reveal-new');
  banner.textContent = title || 'NEW!';
  banner.classList.toggle('hidden', !isNew);

  $('#reveal-img').src = sp.imagePath;
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

  if (isNew) stopConfetti = confettiBurst($('#confetti'), { count: 170, duration: 3000 });
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
export async function playCapture({ sp, isNew, rewards }) {
  resetStage();
  const total = RULES.CAPTURE_ANIM_MS;
  const growMs = Math.max(1200, total - 700);
  const revealAt = growMs + 350;

  const cluster = $('#sparkle-cluster');
  buildSparkles(cluster, 9);
  void cluster.offsetWidth;
  cluster.style.animation = `growShake ${growMs}ms cubic-bezier(.4,0,.6,1) forwards`;

  await sleep(growMs);

  cluster.style.animation = 'popOut 340ms ease-out forwards';
  buildBurst($('#burst'), 36);

  await sleep(revealAt - growMs);

  showReveal({ sp, isNew, rewards });
  await waitForDismiss();
}

/* ---------------------------------------------------------------
   Evolution: current form shakes → explodes → new form revealed
   --------------------------------------------------------------- */
export async function playEvolution({ from, to, isNew, rewards }) {
  resetStage();
  const total = RULES.EVOLVE_ANIM_MS;
  const shakeMs = Math.max(1200, total - 700);
  const revealAt = shakeMs + 350;

  const cluster = $('#sparkle-cluster');
  cluster.innerHTML = '';
  cluster.style.animation = '';

  const img = $('#anim-img');
  img.src = from.imagePath;
  img.alt = from.name;
  img.classList.remove('hidden');
  void img.offsetWidth;
  img.style.animation = `evoShake ${shakeMs}ms cubic-bezier(.4,0,.6,1) forwards`;

  await sleep(shakeMs);

  img.style.animation = 'popOut 340ms ease-out forwards';
  buildBurst($('#burst'), 40);

  await sleep(revealAt - shakeMs);

  showReveal({ sp: to, isNew, rewards, title: isNew ? 'NEW!' : 'EVOLVED!' });
  // Evolutions always feel celebratory, even for a repeat.
  if (!isNew) stopConfetti = confettiBurst($('#confetti'), { count: 90, duration: 2200 });
  await waitForDismiss();
}

export { hideStage };
