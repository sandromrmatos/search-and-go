/* ============================================================
   cloud.js — a regular backup of the save to Firestore

   The local save is still the real one: IndexedDB and the optional save files
   are what the game reads and writes constantly. This copies the save to the
   cloud every half hour of play and when the app is put away, so a lost or
   dead phone costs minutes rather than days.

   Size: a Firestore document holds at most 1 MiB, and a long-played save is
   several times that as raw JSON. Map points are left out (they are transient)
   and the rest is gzipped, which is about a tenth of the size. The old version
   sent the raw JSON and failed silently every day once the save outgrew the
   limit — so a failure is now reported, never swallowed.

   Cost: two writes an hour of play is nowhere near Firestore's free quota.

   Sign-in is anonymous. The player never sees a login, and their document is
   keyed on the anonymous uid, which is what the security rules match on.
   ============================================================ */

import { packText, unpackText } from './codec.js';

const FIREBASE_VERSION = '10.12.2';
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

const firebaseConfig = {
  apiKey: 'AIzaSyBIk-QwDeTZgAZ5r8ch01XLWWkVzoSTxTQ',
  authDomain: 'search-and-go-51e64.firebaseapp.com',
  projectId: 'search-and-go-51e64',
  storageBucket: 'search-and-go-51e64.firebasestorage.app',
  messagingSenderId: '289008103052',
  appId: '1:289008103052:web:80fb21c94462664ce615a9'
};

/** Where a player's save lives: one document each, named after their uid. */
const COLLECTION = 'saves';

/** How often a backup is made while playing. */
export const CLOUD_BACKUP_EVERY_MS = 30 * 60_000;
/** The shortest gap allowed, for the "app put away" backup. */
export const CLOUD_MIN_GAP_MS = 10 * 60_000;
/** After a failure, wait this long before trying again. */
const RETRY_AFTER_FAIL_MS = 10 * 60_000;

/* Firestore's document limit is 1,048,576 bytes including field names and the
   other fields. Saves this small are stored as readable JSON, so they can be
   copied straight out of the console; bigger ones are packed. */
const PLAIN_LIMIT = 600_000;
const PACKED_LIMIT = 1_000_000;

/* ---------------------------------------------------------------
   State
   --------------------------------------------------------------- */

let sdk = null;         // the three modules, once loaded
let app = null;
let db = null;
let uid = null;
let ready = null;       // the in-flight connect promise, so it only runs once
let lastError = null;
let lastFailReason = null;
let lastBackupAt = 0;
let lastFailAt = 0;
let lastBytes = 0;
let inFlight = null;

/** Local calendar day, the same shape the daily missions use. */
export function cloudDayKey(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---------------------------------------------------------------
   Connecting
   --------------------------------------------------------------- */

/**
 * Loads the SDK from the CDN and signs in anonymously. Everything is imported
 * on demand rather than in index.html, so a player who never gets online — or
 * a blocked CDN — costs nothing but this one rejected promise.
 */
async function connect() {
  if (ready) return ready;
  ready = (async () => {
    const [{ initializeApp }, auth, firestore] = await Promise.all([
      import(`${CDN}/firebase-app.js`),
      import(`${CDN}/firebase-auth.js`),
      import(`${CDN}/firebase-firestore.js`)
    ]);
    sdk = { auth, firestore };
    app = initializeApp(firebaseConfig);
    db = firestore.getFirestore(app);

    const a = auth.getAuth(app);
    // Wait for the persisted session to be restored before deciding to sign in
    // again: checking currentUser straight away can miss it and mint a fresh
    // anonymous account, which would back up to a brand-new document.
    if (a.authStateReady) await a.authStateReady();
    const cred = a.currentUser ? { user: a.currentUser } : await auth.signInAnonymously(a);
    uid = cred.user.uid;
    return { uid };
  })().catch(err => {
    // Reset so a later attempt can retry rather than being stuck with a
    // rejected promise for the rest of the session.
    ready = null;
    lastError = err;
    throw err;
  });
  return ready;
}

/* ---------------------------------------------------------------
   Backing up
   --------------------------------------------------------------- */

/**
 * The text that goes in the document: plain JSON when it is small enough to
 * be readable, packed otherwise. Map points are left out either way.
 */
async function encodeSave(state) {
  const { points, ...keep } = state;
  const json = JSON.stringify(keep);
  if (json.length <= PLAIN_LIMIT) return { save: json, saveGz: null, raw: json.length };
  const packed = await packText(json);
  // No CompressionStream: packText hands back the JSON unchanged.
  if (packed === json) return { save: json, saveGz: null, raw: json.length };
  return { save: null, saveGz: packed, raw: json.length };
}

/**
 * Backs the save up if enough time has passed since the last one.
 *
 * @param {object} state    the save object, as it is held in memory
 * @param {object} opts
 * @param {boolean} [opts.force]   ignore the timing rules
 * @param {number}  [opts.minGapMs] how long since the last backup is required
 * @returns {Promise<{ok:boolean, reason?:string, error?:string, bytes?:number}>}
 *   never throws: a backup failing must not interrupt play. `reason` is one of
 *   'nostate', 'too-soon', 'offline', 'busy', 'too-big' or 'failed'.
 */
export async function backupToCloud(state, { force = false, minGapMs = CLOUD_BACKUP_EVERY_MS } = {}) {
  if (!state) return { ok: false, reason: 'nostate' };
  if (inFlight) return { ok: false, reason: 'busy' };

  const now = Date.now();
  const last = Math.max(Number(state.cloudBackupAt) || 0, lastBackupAt);
  if (!force && now - last < minGapMs) return { ok: false, reason: 'too-soon' };
  if (!force && lastFailAt && now - lastFailAt < RETRY_AFTER_FAIL_MS) {
    return { ok: false, reason: 'too-soon' };
  }
  if (!navigator.onLine) return { ok: false, reason: 'offline' };

  inFlight = (async () => {
    try {
      const enc = await encodeSave(state);
      const bytes = (enc.save || enc.saveGz).length;
      if (bytes > PACKED_LIMIT) {
        const err = new Error(`The save is too large for a cloud backup (${Math.round(bytes / 1024)} KB packed).`);
        lastError = err; lastFailReason = 'too-big'; lastFailAt = Date.now();
        return { ok: false, reason: 'too-big', error: err.message, bytes };
      }

      await connect();
      const { doc, setDoc, serverTimestamp } = sdk.firestore;
      const today = cloudDayKey();
      await setDoc(doc(db, COLLECTION, uid), {
        uid,
        day: today,
        savedAt: serverTimestamp(),
        // Handy for support without opening the blob.
        nickname: state.nickname || null,
        level: Number(state.level) || null,
        xp: Number(state.xp) || 0,
        creatures: Array.isArray(state.storage) ? state.storage.length : 0,
        registered: state.registered ? Object.keys(state.registered).length : 0,
        bytes,
        rawBytes: enc.raw,
        version: Number(state.version) || 0,
        // Exactly one of these holds the save. `saveGz` is "SGZ1:" + base64
        // gzip; paste it into a file and Import backup reads it as it is.
        save: enc.save,
        saveGz: enc.saveGz
      });

      // Stamped on the caller's object: the store writes it out with the next
      // ordinary local save, so a reload knows when the last one was.
      state.cloudBackupDay = today;
      state.cloudBackupAt = Date.now();
      lastBackupAt = state.cloudBackupAt;
      lastBytes = bytes;
      lastError = null;
      lastFailReason = null;
      lastFailAt = 0;
      return { ok: true, uid, day: today, bytes };
    } catch (err) {
      lastError = err;
      lastFailReason = 'failed';
      lastFailAt = Date.now();
      return { ok: false, reason: 'failed', error: err?.message || String(err) };
    }
  })();
  try { return await inFlight; }
  finally { inFlight = null; }
}

/** Reads back whatever is in the cloud for this browser's account. */
export async function fetchCloudSave() {
  try {
    await connect();
    const { doc, getDoc } = sdk.firestore;
    const snap = await getDoc(doc(db, COLLECTION, uid));
    if (!snap.exists()) return { ok: false, reason: 'none' };
    const data = snap.data();
    const text = typeof data.saveGz === 'string' && data.saveGz ? data.saveGz
      : typeof data.save === 'string' ? data.save : null;
    if (!text) return { ok: false, reason: 'empty' };
    const parsed = JSON.parse(await unpackText(text));
    return { ok: true, state: parsed, day: data.day || null, meta: data };
  } catch (err) {
    lastError = err;
    return { ok: false, reason: 'failed', error: err?.message || String(err) };
  }
}

/** For the Profile card: what the last attempt did, without leaking the SDK. */
export function cloudStatus(state = null) {
  const at = Math.max(lastBackupAt, Number(state?.cloudBackupAt) || 0);
  return {
    connected: !!uid,
    uid,
    lastBackupAt: at,
    lastBytes,
    backedUpToday: !!state && state.cloudBackupDay === cloudDayKey(),
    lastDay: state?.cloudBackupDay || null,
    failReason: lastFailReason,
    error: lastError ? (lastError.message || String(lastError)) : null
  };
}
