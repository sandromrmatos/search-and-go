/* ============================================================
   achievements.js — the Achievements screen, the family sheet,
   the profile title and the badge on the Profile tab

   One tile per creature family, filed under its Stage 1 and grouped by set
   like the Collection. Its border shows the tier reached: bronze, silver,
   gold. Opened from the Profile screen rather than the bottom nav, which is
   already full.
   ============================================================ */

import {
  SETS, speciesForSet, species, familyRoot, familyRarity, DB, RARITY_NAMES,
  ACHIEVEMENT_TIERS, achievementCandy, achievementTitle
} from './data.js';
import { store } from './state.js';
import { $, $$, el, toast, openSheet, num, wireSwipe, bumpEl } from './ui.js';

const CANDY_ICON = '🍬';

/** Sets with creatures in them — "Coming soon" has nothing to show here. */
const achSets = () => SETS.filter(s => s.available);

/** Family roots of one set, in dex order. */
const rootsForSet = set => speciesForSet(set).filter(s => familyRoot(s.id) === s.id);

let onChange = () => {};

export function initAchievements({ onChange: changed } = {}) {
  if (changed) onChange = changed;

  $('#btn-achievements')?.addEventListener('click', openAchievements);
  // Back is the Profile tab itself, so the nav highlight and render stay in one place.
  $('#ach-back')?.addEventListener('click', () => $('#nav-profile')?.click());

  const step = dir => {
    const sets = achSets();
    const ui = store.s.ui;
    ui.achSetIndex = Math.max(0, Math.min(sets.length - 1, (ui.achSetIndex || 0) + dir));
    store.touch('ui');
    renderAchievements();
  };
  $('#ach-set-prev')?.addEventListener('click', () => step(-1));
  $('#ach-set-next')?.addEventListener('click', () => step(1));

  $('#p-title-select')?.addEventListener('change', e => {
    const v = e.target.value;
    store.setTitle(v || null);
    renderProfileTitle();
  });

  // The legend reads its numbers off the tiers, so it cannot drift from the rules.
  const legend = $('.ach-legend');
  if (legend) {
    legend.innerHTML = '';
    ACHIEVEMENT_TIERS.forEach((t, i) => {
      if (i) legend.append(' · ');
      legend.append(
        el('span', { class: `ach-chip ach-${t.id}`, text: t.label }),
        ` ${t.missions} missions`
      );
    });
  }
}

/** Shows the Achievements view, keeping the Profile tab lit underneath it. */
export function openAchievements() {
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.id === 'nav-profile'));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-achievements'));
  renderAchievements();
}

export function renderAchievements() {
  const sets = achSets();
  const ui = store.s.ui;
  const index = Math.max(0, Math.min(sets.length - 1, ui.achSetIndex || 0));
  const set = sets[index];

  $('#ach-set-title').textContent = set.title;
  $('#ach-set-prev').disabled = index === 0;
  $('#ach-set-next').disabled = index === sets.length - 1;

  const live = store.liveFamilyLevels();
  const roots = rootsForSet(set);
  const tally = { bronze: 0, silver: 0, gold: 0 };

  const grid = $('#ach-grid');
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const root of roots) {
    const st = store.achievementState(root.id, live);
    if (st.tier) tally[st.tier]++;
    const known = store.familyRegistered(root.id);

    frag.append(el('button', {
      class: 'cell ach-cell'
        + (known ? '' : ' shadow')
        + (st.tier ? ` ach-${st.tier}` : '')
        + (st.claimable ? ' ach-claimable' : ''),
      onclick: () => {
        if (!known) { toast('Register a creature from this family first', 'bad'); return; }
        openFamilySheet(root.id);
      }
    },
      root.rarity ? el('span', { class: `rar r-${root.rarity}`, text: root.rarity }) : null,
      st.claimable ? el('span', { class: 'ach-dot', text: String(st.claimable) }) : null,
      el('img', { src: root.imagePath, alt: known ? root.name : 'Unknown creature', loading: 'lazy' }),
      el('span', { class: 'nm', text: known ? root.name : '???' }),
      el('span', { class: 'sub', text: `${st.done} / ${st.total}` })
    ));
  }
  grid.append(frag);
  if (!roots.length) grid.append(el('p', { class: 'empty', text: 'No families in this set yet.' }));

  $('#ach-count').textContent =
    `🥇 ${tally.gold} · 🥈 ${tally.silver} · 🥉 ${tally.bronze} / ${roots.length}`;
}

/** Text for a mission's progress, in km for the walking one. */
function progressLabel(m) {
  if (m.def.kind === 'buddyMetres') {
    return `${(m.progress / 1000).toFixed(2)} / ${num(m.target / 1000)} km`;
  }
  if (m.def.kind === 'level') return `Level ${m.progress} / ${m.target}`;
  return `${num(m.progress)} / ${num(m.target)}`;
}

function rewardLabel(rootId, tierId) {
  return tierId === 'gold'
    ? `Title: ${achievementTitle(rootId)}`
    : `${CANDY_ICON} ${achievementCandy(familyRarity(rootId), tierId)} candy`;
}

export function openFamilySheet(rootId) {
  renderFamilySheet(rootId);
  openSheet('sheet');
}

function renderFamilySheet(rootId) {
  const root = species(rootId);
  if (!root) return;
  const st = store.achievementState(rootId);
  const body = $('#sheet-body');
  body.innerHTML = '';

  /* Swiping walks the registered families of the set on screen. It also takes
     the gesture over from whichever sheet last drew into #sheet-body, which
     would otherwise swipe to one of its own creatures. */
  const sets = achSets();
  const set = sets[Math.max(0, Math.min(sets.length - 1, store.s.ui.achSetIndex || 0))];
  const walk = rootsForSet(set).map(s => s.id).filter(id => store.familyRegistered(id));
  const at = walk.indexOf(rootId);
  const go = (id, dir) => (id ? renderFamilySheet(id) : bumpEl(body, dir));
  wireSwipe(body, {
    onLeft: () => go(at >= 0 ? walk[at + 1] : null, 'left'),
    onRight: () => go(at > 0 ? walk[at - 1] : null, 'right')
  });

  const members = (DB.familyMembers.get(rootId) || [rootId]).map(species).filter(Boolean);
  const tierLabel = ACHIEVEMENT_TIERS.find(t => t.id === st.tier)?.label;

  const claim = tierId => {
    const r = store.claimAchievementTier(rootId, tierId);
    if (!r.ok) { toast('Nothing to claim yet', 'bad'); return; }
    toast(r.title
      ? `You earned the title "${achievementTitle(rootId)}"`
      : `+${r.candy} ${root.name} candy`, 'good', 3200);
    renderFamilySheet(rootId);
    renderAchievements();
    renderAchievementBadge();
    onChange();
  };

  body.append(
    el('div', { class: 'ach-head' },
      el('div', { class: 'ach-head-art' + (st.tier ? ` ach-${st.tier}` : '') },
        el('img', { src: root.imagePath, alt: root.name })),
      el('div', { class: 'ach-head-meta' },
        el('h3', { text: `${root.name} family` }),
        el('div', { class: 'muted small',
          text: `${RARITY_NAMES[root.rarity] || ''} · ${st.done} / ${st.total} missions` }),
        tierLabel
          ? el('span', { class: `ach-chip ach-${st.tier}`, text: tierLabel })
          : el('span', { class: 'muted small', text: 'No tier yet' })
      )
    ),
    // Every stage counts, so show which ones those are.
    members.length > 1
      ? el('div', { class: 'ach-family' },
          ...members.map(sp => el('span', { class: 'ach-member' + (store.isRegistered(sp.id) ? '' : ' locked') },
            el('img', { src: sp.imagePath, alt: '', loading: 'lazy' }),
            el('span', { text: store.isRegistered(sp.id) ? sp.name : '???' }))))
      : null,
    el('p', { class: 'hint',
      text: 'Any stage of this family counts, and every one you own adds to the same total.' }),

    el('div', { class: 'ach-tiers' },
      ...st.tiers.map(t => el('div', { class: `ach-tier ach-${t.id}` + (t.reached ? ' reached' : '') },
        el('b', { text: t.label }),
        el('span', { class: 'small', text: rewardLabel(rootId, t.id) }),
        t.claimed
          ? el('span', { class: 'mission-tick', text: '✓' })
          : t.claimable
            ? el('button', { class: 'btn primary', onclick: () => claim(t.id) }, 'Claim')
            : el('span', { class: 'muted small', text: `${Math.max(0, t.missions - st.done)} more` })
      ))
    ),

    el('div', { class: 'mission-list ach-missions' },
      ...st.missions.map(m => el('div', { class: 'mission' + (m.done ? ' claimed ach-done' : '') },
        el('span', { class: 'mission-ico', text: m.def.icon }),
        el('div', { class: 'mission-main' },
          el('b', { text: m.def.label }),
          el('div', { class: 'mission-bar' },
            el('i', { style: { width: Math.round((m.progress / m.target) * 100) + '%' } })),
          el('div', { class: 'mission-meta' }, el('span', { text: progressLabel(m) }))
        ),
        el('div', { class: 'mission-act' },
          m.done ? el('span', { class: 'mission-tick', text: '✓' }) : null)
      ))
    )
  );
}

/**
 * The count on the Profile tab, and the glow on the Achievements button inside
 * it — so following the badge leads straight to what is waiting.
 */
export function renderAchievementBadge() {
  const n = store.claimableAchievementCount;
  const nav = $('#nav-profile');
  if (nav) {
    nav.classList.toggle('glow', n > 0);
    nav.querySelector('.claim-dot')?.remove();
    if (n > 0) nav.append(el('span', { class: 'claim-dot', text: String(n) }));
  }
  const entry = $('#btn-achievements');
  if (entry) {
    entry.classList.toggle('claimable', n > 0);
    entry.querySelector('.claim-dot')?.remove();
    if (n > 0) entry.append(el('span', { class: 'claim-dot', text: String(n) }));
    const sub = $('#ach-entry-sub');
    if (sub) {
      sub.textContent = n > 0
        ? `${n} reward${n === 1 ? '' : 's'} ready to claim`
        : 'Missions for every creature family';
    }
  }
}

/** The worn title beside the nickname, and the picker under it. */
export function renderProfileTitle() {
  const titles = store.s.titles || [];
  const worn = store.s.title;

  const tag = $('#p-title');
  if (tag) {
    tag.classList.toggle('hidden', !worn);
    tag.textContent = worn ? achievementTitle(worn) : '';
  }

  const sel = $('#p-title-select');
  if (!sel) return;
  sel.innerHTML = '';
  if (!titles.length) {
    sel.append(el('option', { value: '', text: 'No titles available' }));
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  sel.append(el('option', { value: '', text: 'No title' }));
  for (const id of titles) sel.append(el('option', { value: id, text: achievementTitle(id) }));
  sel.value = worn || '';
}
