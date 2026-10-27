/* ============================================================
   music.js — background music

   The three songs in /music play one after another, round and round, starting
   from a random one. Browsers will not play sound until the player has touched
   the page, so the first tap anywhere is what starts it. It pauses while the
   game is in the background and picks up again when it comes back.

   On / off and the volume live in store.s.ui, set from the Profile.
   ============================================================ */

import { store } from './state.js';

const TRACKS = ['music/song01.mp3', 'music/song02.mp3', 'music/song03.mp3'];

let audio = null;
let index = Math.floor(Math.random() * TRACKS.length);
/** True once a tap has allowed sound. */
let unlocked = false;
/** Why the last attempt to play failed, if it did. */
let lastError = null;

const settings = () => ({
  on: store.s?.ui?.musicOn !== false,
  volume: Math.max(0, Math.min(1, Number(store.s?.ui?.musicVolume ?? 0.5)))
});

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'auto';
  audio.src = TRACKS[index];
  // Next song when one ends; skip one that will not load rather than going silent.
  audio.addEventListener('ended', next);
  audio.addEventListener('error', () => { if (unlocked && settings().on) setTimeout(next, 1000); });
  return audio;
}

function next() {
  index = (index + 1) % TRACKS.length;
  const a = ensureAudio();
  a.src = TRACKS[index];
  play();
}

function play() {
  const { on, volume } = settings();
  const a = ensureAudio();
  a.volume = volume;
  if (!on || !unlocked || document.hidden || volume === 0) { a.pause(); return; }
  a.play().then(() => { lastError = null; }).catch(e => {
    // Not allowed yet, or the file would not load: the next tap tries again.
    lastError = e?.name || String(e);
  });
}

/** What is playing, for the debug panel and tests. */
export const musicState = () => ({
  playing: !!audio && !audio.paused,
  track: audio ? TRACKS[index] : null,
  volume: audio ? audio.volume : settings().volume,
  unlocked,
  error: lastError || (audio?.error ? `media error ${audio.error.code}` : null)
});

/** Re-reads the settings: call after changing them. */
export function applyMusicSettings() {
  if (!audio && !settings().on) return;
  play();
}

/* ---------------------------------------------------------------
   Sound effects

   Made on the spot with the Web Audio API rather than read from a file, so there
   is nothing to load. Same rules as the music: nothing until the first tap, and
   their own on / off and volume (store.s.ui.soundOn / soundVolume).
   --------------------------------------------------------------- */
let ctx = null;

const soundSettings = () => ({
  on: store.s?.ui?.soundOn !== false,
  volume: Math.max(0, Math.min(1, Number(store.s?.ui?.soundVolume ?? 0.5)))
});

function audioCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** A short two-note chime: an incense creature is waiting at your feet. */
export function playSpawnChime() {
  const { on, volume } = soundSettings();
  if (!on || !volume || !unlocked || document.hidden) return false;
  const ac = audioCtx();
  if (!ac || ac.state !== 'running') return false;
  const t0 = ac.currentTime;
  [[1318.5, 0], [1760, 0.13]].forEach(([freq, at]) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + at);
    gain.gain.exponentialRampToValueAtTime(0.25 * volume, t0 + at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.28);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + 0.3);
  });
  lastChimeAt = Date.now();
  return true;
}
/** When the chime last sounded, for tests. */
let lastChimeAt = 0;
export const soundState = () => ({ unlocked, ctx: ctx?.state || null, lastChimeAt });

export function initMusic() {
  const unlock = () => {
    unlocked = true;
    audioCtx();
    play();
    if (audio && !audio.paused) {
      for (const t of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(t, unlock, true);
    }
  };
  for (const t of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(t, unlock, true);
  document.addEventListener('visibilitychange', () => {
    if (!audio) return;
    if (document.hidden) audio.pause(); else play();
  });
}
