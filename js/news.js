/* ============================================================
   news.js — the News tab

   Entries live in news.json at the project root so updates can be written
   without touching any code. Each entry is:

     {
       "at":    "2026-08-14 21:45",      // or any date string Date can parse
       "title": "Short headline",
       "body":  "One paragraph"           // or an array of paragraphs
     }

   Order in the file does not matter — newest is always shown first. A very
   light markup is supported in the body: **bold**.
   ============================================================ */

import { store } from './state.js';
import { calendarDays } from './data.js';
import { $, el, openSheet } from './ui.js';

const NEWS_URL = './news.json';

/** Parsed entries, newest first. Loaded once per session. */
let entries = null;
let loadError = null;

/**
 * `at` is written by hand, so accept both "2026-08-14 21:45" and full ISO.
 * Safari refuses the space form, hence the swap to a T.
 */
function parseWhen(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim();
  const t = Date.parse(s.includes('T') ? s : s.replace(' ', 'T'));
  return Number.isFinite(t) ? t : Date.parse(s) || 0;
}

/** Minimal inline markup, escaped first so entries can never inject HTML. */
function richText(s) {
  const safe = String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return safe.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

function normalise(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(e => e && (e.title || e.body))
    .map((e, i) => ({
      id: String(e.id || e.at || `entry-${i}`),
      at: parseWhen(e.at),
      atLabel: String(e.at || '').trim(),
      title: String(e.title || 'Update'),
      body: Array.isArray(e.body) ? e.body.map(String) : (e.body ? [String(e.body)] : [])
    }))
    .sort((a, b) => b.at - a.at);   // newest first, whatever order the file is in
}

/** Loads news.json. Cached for the session; never throws. */
export async function loadNews({ force = false } = {}) {
  if (entries && !force) return entries;
  try {
    const res = await fetch(`${NEWS_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    entries = normalise(await res.json());
    loadError = null;
  } catch (e) {
    entries = entries || [];
    loadError = e;
  }
  return entries;
}

/** Entries already loaded, without triggering a fetch. */
export const loadedNews = () => entries || [];

/**
 * The yellow dot on the News tab. Safe to call before the file has loaded —
 * it simply shows nothing until there is something to count.
 */
export function renderNewsBadge() {
  const btn = $('#nav-news');
  if (!btn) return;
  const n = store.unreadNewsCount(loadedNews());
  btn.querySelector('.claim-dot')?.remove();
  btn.classList.toggle('glow', n > 0);
  if (n > 0) btn.append(el('span', { class: 'claim-dot', text: String(n) }));
}

/**
 * Renders the list and marks everything as seen.
 *
 * The dots are drawn from the mark as it was *before* this visit, so entries
 * you are reading right now still stand out, while the tab badge clears.
 */
export async function renderNews() {
  const host = $('#news-list');
  if (!host) return;

  host.innerHTML = '';
  host.append(el('p', { class: 'muted small', text: 'Loading…' }));

  const list = await loadNews();
  const seenBefore = store.markNewsSeen();
  const unread = list.filter(e => e.at > seenBefore).length;

  $('#news-count').textContent = list.length
    ? (unread ? `${unread} new` : `${list.length} update${list.length === 1 ? '' : 's'}`)
    : '';

  host.innerHTML = '';

  if (!list.length) {
    host.append(el('p', { class: 'empty', text: loadError
      ? 'Could not load the news right now.'
      : 'No news yet. Check back after the next update.' }));
    renderNewsBadge();
    return;
  }

  for (const e of list) {
    const isNew = e.at > seenBefore;
    host.append(el('div', { class: 'news-item' + (isNew ? ' unread' : '') },
      el('div', { class: 'news-when', text: whenLabel(e) }),
      el('h3', {},
        el('span', { text: e.title }),
        isNew ? el('span', { class: 'news-new-tag', text: 'NEW' }) : null
      ),
      ...e.body.map(p => el('p', { html: richText(p) }))
    ));
  }

  renderNewsBadge();
}

/* ---------------------------------------------------------------
   Event calendar

   Lives in the News tab because it answers the same question — "what is
   happening?" — just forwards instead of backwards.
   --------------------------------------------------------------- */

/** 17.5 -> "17:30". Matches how the event windows are defined. */
const clockLabel = h => {
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return `${String(whole).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

/** "Today", "Tomorrow", then the weekday and date. */
function dayHeading(day) {
  const weekday = day.date.toLocaleDateString(undefined, { weekday: 'long' });
  const date = day.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (day.offset === 0) return `Today · ${weekday} ${date}`;
  if (day.offset === 1) return `Tomorrow · ${weekday} ${date}`;
  return `${weekday} ${date}`;
}

export function openCalendar() {
  renderCalendar();
  openSheet('calendar');
}

function renderCalendar() {
  const body = $('#calendar-body');
  const hint = $('#calendar-hint');
  if (!body) return;
  body.innerHTML = '';

  const days = calendarDays(7);
  const total = days.reduce((n, d) => n + d.events.length, 0);
  hint.textContent = total
    ? 'Every recurring event coming up, in your own local time.'
    : 'Nothing scheduled in the next week.';

  for (const day of days) {
    body.append(el('div', { class: 'cal-day' + (day.isToday ? ' today' : '') },
      el('div', { class: 'cal-date' }, el('b', { text: dayHeading(day) })),
      day.events.length
        ? el('div', { class: 'cal-events' }, ...day.events.map(e =>
          el('div', { class: 'cal-event' + (e.allDay ? ' all-day' : '') },
            el('span', { class: 'cal-ico', text: e.icon }),
            el('div', { class: 'cal-main' },
              el('b', { text: e.label }),
              el('div', { class: 'muted small', text: e.blurb })
            ),
            el('span', {
              class: 'cal-when',
              text: e.allDay ? 'All day' : `${clockLabel(e.start)}–${clockLabel(e.end)}`
            })
          )))
        : el('p', { class: 'muted small cal-none', text: 'Nothing special today.' })
    ));
  }
}

/** "14 Aug 2026 · 21:45", falling back to whatever the file said. */
function whenLabel(e) {
  if (!e.at) return e.atLabel || '';
  const d = new Date(e.at);
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}
