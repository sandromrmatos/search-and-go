/* ============================================================
   cloud.js — a once-a-day backup of the save to Firestore

   Deliberately small. The local save is still the real one: IndexedDB and the
   optional save file are what the game reads and writes constantly. This copies
   the whole thing to the cloud at most once per local day, so a lost phone
   costs a day rather than everything.

   Why one write a day: Firestore charges per write, and a game that saves every
   few seconds would burn a free quota in an afternoon. The stamp lives in the
   save itself, so it survives a reload and follows an imported backup.

   Sign-in is anonymous. The player never sees a login, and their document is
   keyed on the anonymous uid, which is what the security rules match on.
   ============================================================ */

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

/* ---------------------------------------------------------------
   State
   --------------------------------------------------------------- */

let sdk = null;         // the three modules, once loaded
let app = null;
let db = null;
let uid = null;
let ready = null;       // the in-flight connect promise, so it only runs once
let lastError = null;
let lastBackupAt = 0;

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
    // An anonymous account is created on the first run and then reused from
    // local storage, so the same browser keeps writing to the same document.
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
 * Writes the save if today's copy has not been made yet.
 *
 * @param {object} state    the save object, as it is held in memory
 * @param {object} opts
 * @param {boolean} [opts.force]  ignore the once-a-day stamp
 * @returns {Promise<{ok:boolean, reason?:string, uid?:string, day?:string}>}
 *   never throws: a backup failing must not interrupt play.
 */
export async function backupOncePerDay(state, { force = false } = {}) {
  if (!state) return { ok: false, reason: 'nostate' };

  const today = cloudDayKey();
  if (!force && state.cloudBackupDay === today) {
    return { ok: false, reason: 'already-today', day: today };
  }
  if (!navigator.onLine) return { ok: false, reason: 'offline' };

  try {
    await connect();
    const { doc, setDoc, serverTimestamp } = sdk.firestore;

    // The whole save goes in one field as text. Firestore would otherwise try to
    // map every nested object and array, which it cannot do for arrays of
    // objects more than one level deep — and a string is a single cheap write.
    const json = JSON.stringify(state);

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
      bytes: json.length,
      version: Number(state.version) || 0,
      save: json
    });

    // Stamped on the caller's object: the store writes it out with the next
    // ordinary local save, so a reload knows today is done.
    state.cloudBackupDay = today;
    lastBackupAt = Date.now();
    lastError = null;
    return { ok: true, uid, day: today, bytes: json.length };
  } catch (err) {
    lastError = err;
    return { ok: false, reason: 'failed', error: err?.message || String(err) };
  }
}

/** Reads back whatever is in the cloud for this browser's account. */
export async function fetchCloudSave() {
  try {
    await connect();
    const { doc, getDoc } = sdk.firestore;
    const snap = await getDoc(doc(db, COLLECTION, uid));
    if (!snap.exists()) return { ok: false, reason: 'none' };
    const data = snap.data();
    const parsed = typeof data.save === 'string' ? JSON.parse(data.save) : null;
    if (!parsed) return { ok: false, reason: 'empty' };
    return { ok: true, state: parsed, day: data.day || null, meta: data };
  } catch (err) {
    lastError = err;
    return { ok: false, reason: 'failed', error: err?.message || String(err) };
  }
}

/** For the Profile card: what the last attempt did, without leaking the SDK. */
export function cloudStatus(state = null) {
  return {
    connected: !!uid,
    uid,
    lastBackupAt,
    backedUpToday: !!state && state.cloudBackupDay === cloudDayKey(),
    lastDay: state?.cloudBackupDay || null,
    error: lastError ? (lastError.message || String(lastError)) : null
  };
}
