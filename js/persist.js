/* ============================================================
   persist.js — durable save layer

   Cooperating layers, strongest first:
     1. Real files on the device, via the File System Access API. Up to two of
        them, written in turn: a phone that dies mid-write can only ever damage
        the one being written, and the other is at most a few seconds older.
        Survives "clear browsing data" because they live outside the browser.
     2. IndexedDB (+ navigator.storage.persist()) as the always-on working
        copy, plus rolling snapshots under their own key.
     3. A compressed copy in localStorage, in two alternating slots. A separate
        store from IndexedDB, so the browser throwing away a damaged database
        does not take this with it.
     4. A small "a save exists" marker in localStorage, so a save that vanished
        is noticed instead of being mistaken for a brand-new player.
     5. Manual download / import of a .json backup — works everywhere.
   ============================================================ */

import { packText, unpackText, isBlankText } from './codec.js';

const DB_NAME = 'search-and-go';
const DB_VERSION = 1;
const KV_STORE = 'kv';
const KEY_SAVE = 'save';
const KEY_HANDLE = 'saveFileHandle';
const KEY_HANDLE_B = 'saveFileHandleB';

const KEY_SNAPSHOTS = 'snapshots';

const LS_MARKER = 'sg.saveMarker';
const LS_BACKUP_KEYS = ['sg.backup.a', 'sg.backup.b'];

export const SAVE_FILENAME = 'search-and-go-save.json';
export const SAVE_FILENAME_B = 'search-and-go-save-B.json';

/* How many rolling snapshots to keep, and how far apart they have to be.
   These are a last line of defence: they live under their own key, so a bad
   write to `save` cannot touch them. */
export const SNAPSHOT_KEEP = 6;
export const SNAPSHOT_GAP_MS = 3 * 3_600_000;   // 3 hours

/* The device files are big and the game saves every second or so while you
   play. Writing a multi-megabyte file that often is what made a flat battery so
   likely to land mid-write, so the files are written at most this often — and
   always when the app is put away. The browser database still saves every time. */
export const FILE_WRITE_GAP_MS = 20_000;
/** The localStorage copy: compressed, so cheap, but still no need for more. */
export const LOCAL_BACKUP_GAP_MS = 60_000;

/* Wording for the import and restore paths, shared so every entry point says
   the same thing about the same problem. */
export const MSG_EMPTY_FILE =
  'That file is empty — there is no save data in it. This happens when a save is cut off, '
  + 'for example by the phone switching off. Try an older backup.';
export const MSG_DAMAGED_FILE =
  'That file is damaged and could not be read as a save. Try an older backup.';
export const MSG_NOT_A_SAVE = 'That file is not a Search and Go save.';

let idb = null;

/**
 * How much progress a save represents, and whether it is effectively blank.
 * Used to refuse writes that would replace real progress with a fresh account.
 */
export function progressOf(save) {
  if (!save || typeof save !== 'object') {
    return { creatures: 0, xp: 0, captures: 0, registered: 0, empty: true };
  }
  const creatures = Array.isArray(save.storage) ? save.storage.length : 0;
  const xp = Number(save.xp) || 0;
  const captures = Number(save.stats?.captures) || 0;
  const registered = save.registered && typeof save.registered === 'object'
    ? Object.keys(save.registered).length : 0;
  return {
    creatures, xp, captures, registered,
    empty: creatures === 0 && xp === 0 && captures === 0 && registered === 0
  };
}

/** Whether a parsed object has the shape of a save at all. */
export const looksLikeSave = o =>
  !!o && typeof o === 'object' && !Array.isArray(o)
  && (Array.isArray(o.storage) || 'xp' in o || 'registered' in o);

/** An Error whose message is written for the player, not for a developer. */
function friendly(message) {
  const e = new Error(message);
  e.friendly = true;
  return e;
}

/**
 * Text -> save object, with an error a player can act on for each way it can
 * go wrong. Accepts plain JSON and the packed form from codec.js.
 */
export async function parseSaveText(text) {
  if (isBlankText(text)) throw friendly(MSG_EMPTY_FILE);
  let json;
  try { json = await unpackText(text); }
  catch { throw friendly(MSG_DAMAGED_FILE); }
  let data;
  try { data = JSON.parse(json); }
  catch { throw friendly(MSG_DAMAGED_FILE); }
  if (!looksLikeSave(data)) throw friendly(MSG_NOT_A_SAVE);
  return data;
}

/* ---------------------------------------------------------------
   localStorage helpers — every call guarded, because private modes and full
   quotas throw rather than fail quietly
   --------------------------------------------------------------- */
function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key, value) {
  localStorage.setItem(key, value);   // let the caller see quota errors
}
function lsDel(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/** The "a save with progress exists" marker, or null. */
export function readMarker() {
  try {
    const m = JSON.parse(lsGet(LS_MARKER) || 'null');
    return m && typeof m === 'object' ? m : null;
  } catch { return null; }
}

/* ---------------------------------------------------------------
   IndexedDB primitives
   --------------------------------------------------------------- */
function openIDB() {
  if (idb) return Promise.resolve(idb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
    };
    req.onsuccess = () => { idb = req.result; resolve(idb); };
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV_STORE, 'readonly');
    const r = tx.objectStore(KV_STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function idbSet(key, value) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV_STORE, 'readwrite');
    tx.objectStore(KV_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDel(key) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV_STORE, 'readwrite');
    tx.objectStore(KV_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------------------------------------------------------------
   Persist controller
   --------------------------------------------------------------- */
export const Persist = {
  supportsFS: typeof window !== 'undefined' && 'showSaveFilePicker' in window,
  /** The main save file, and the optional second one written in turn with it. */
  fileHandle: null,
  fileHandleB: null,
  filePermission: 'unavailable', // 'granted' | 'prompt' | 'denied' | 'unavailable'
  filePermissionB: 'unavailable',
  persisted: false,
  lastError: null,
  onStatusChange: null,
  /** Set when a write was refused for trying to blank an existing save. */
  guardTripped: null,
  /** When a device file was last written successfully. */
  lastFileWriteAt: 0,
  /** The last device-file write error, cleared by the next good write. */
  lastFileError: null,
  /** When the localStorage copy was last written. */
  lastLocalBackupAt: 0,
  lastLocalBackupError: null,

  // Which file is written next (0 = main, 1 = second), and which localStorage
  // slot. Both alternate so the newest good copy is never the one overwritten.
  _nextFile: 0,
  _nextLocal: 0,
  _pendingFile: null,
  _fileTimer: null,
  _fileChain: Promise.resolve(),

  /* ---------- lifecycle ---------- */

  async init() {
    // Ask the browser to make our storage bucket persistent (best effort).
    try {
      if (navigator.storage?.persist) {
        this.persisted = await navigator.storage.persisted?.() || false;
        if (!this.persisted) this.persisted = await navigator.storage.persist();
      }
    } catch { /* non-fatal */ }

    // Re-attach previously linked device files, if we still have the handles.
    if (this.supportsFS) {
      try {
        const h = await idbGet(KEY_HANDLE);
        if (h) {
          this.fileHandle = h;
          this.filePermission = await this._queryPerm(h);
        } else {
          this.filePermission = 'prompt';
        }
        const hb = await idbGet(KEY_HANDLE_B);
        if (hb) {
          this.fileHandleB = hb;
          this.filePermissionB = await this._queryPerm(hb);
        } else {
          this.filePermissionB = 'prompt';
        }
      } catch (e) {
        this.lastError = e;
        this.filePermission = 'prompt';
      }
    }

    // Carry on writing the older localStorage slot, so the newer one survives
    // the next write whatever happens to it.
    const slots = this._localEntries();
    if (slots[0] && slots[1]) this._nextLocal = slots[0].savedAt <= slots[1].savedAt ? 0 : 1;
    else this._nextLocal = slots[0] ? 1 : 0;

    this._emit();
    return this;
  },

  async _queryPerm(handle) {
    try {
      if (!handle?.queryPermission) return 'granted';
      return await handle.queryPermission({ mode: 'readwrite' });
    } catch { return 'prompt'; }
  },

  _emit() { try { this.onStatusChange?.(this.status()); } catch { /* ignore */ } },

  /** The linked files that can be written right now, main file first. */
  _writableFiles() {
    const out = [];
    if (this.fileHandle && this.filePermission === 'granted') out.push(this.fileHandle);
    if (this.fileHandleB && this.filePermissionB === 'granted') out.push(this.fileHandleB);
    return out;
  },

  status() {
    return {
      supportsFS: this.supportsFS,
      linked: !!this.fileHandle,
      fileName: this.fileHandle?.name || null,
      filePermission: this.filePermission,
      linkedB: !!this.fileHandleB,
      fileNameB: this.fileHandleB?.name || null,
      filePermissionB: this.filePermissionB,
      persisted: this.persisted,
      autoFileSave: !!this.fileHandle && this.filePermission === 'granted',
      /** Both files are being written in turn. */
      twoFiles: !!this.fileHandle && this.filePermission === 'granted'
        && !!this.fileHandleB && this.filePermissionB === 'granted',
      lastFileWriteAt: this.lastFileWriteAt,
      lastFileError: this.lastFileError ? (this.lastFileError.message || String(this.lastFileError)) : null,
      lastLocalBackupAt: this.lastLocalBackupAt,
      lastLocalBackupError: this.lastLocalBackupError
        ? (this.lastLocalBackupError.message || String(this.lastLocalBackupError)) : null,
      guardTripped: this.guardTripped
    };
  },

  /* ---------- loading ---------- */

  /**
   * Reads the newest available save. Prefers whichever of the device files or
   * the IndexedDB copy has the later `savedAt` stamp. A blank or damaged file
   * is skipped, not trusted — the other file or the database is used instead.
   *
   * `readFailed` distinguishes "this is a brand-new player" from "we could not
   * read the save" — those look identical otherwise, and treating the second as
   * the first is what destroys a save. `missing` says the marker remembers a
   * save with progress that none of the layers could produce.
   */
  async load() {
    let fromIDB = null, fromFile = null, readFailed = false;

    try { fromIDB = await idbGet(KEY_SAVE) || null; }
    catch (e) { this.lastError = e; readFailed = true; }

    const files = [
      [this.fileHandle, this.filePermission],
      [this.fileHandleB, this.filePermissionB]
    ];
    for (const [h, perm] of files) {
      if (!h || perm !== 'granted') continue;
      try {
        const d = await this._readFile(h);
        if (d && (!fromFile || (d.savedAt || 0) > (fromFile.savedAt || 0))) fromFile = d;
      } catch (e) {
        this.lastError = e;
        readFailed = true;
      }
    }

    // Nothing loaded, but a copy with progress exists: the save is missing
    // rather than absent, so the caller must not start a fresh account.
    let recoverable = null, missing = false;
    if (!fromIDB && !fromFile) {
      const snap = await this.newestSnapshot();
      const local = await this.newestLocalBackup();
      recoverable = [snap, local].filter(Boolean)
        .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0] || null;
      const marker = readMarker();
      missing = !!marker?.progress && (marker.progress.creatures > 0 || marker.progress.xp > 0);
    }

    if (fromFile && fromIDB) {
      const pick = (fromFile.savedAt || 0) > (fromIDB.savedAt || 0) ? fromFile : fromIDB;
      return { data: pick, source: pick === fromFile ? 'file' : 'idb', readFailed, recoverable, missing };
    }
    if (fromFile) return { data: fromFile, source: 'file', readFailed, recoverable, missing };
    if (fromIDB) return { data: fromIDB, source: 'idb', readFailed, recoverable, missing };
    return { data: null, source: 'none', readFailed, recoverable, missing };
  },

  /** A linked file's save, null when the file has never been written, or throws. */
  async _readFile(handle) {
    const file = await handle.getFile();
    if (file.size === 0) return null;            // freshly linked, never written
    return parseSaveText(await file.text());     // blank / NUL-filled / damaged all throw
  },

  /* ---------- saving ---------- */

  /**
   * Write to every available layer.
   *
   * Guarded: a blank account will never be allowed to overwrite a save that
   * still holds progress. That is exactly how a save gets destroyed — the game
   * fails to read it, starts a fresh account, and the first autosave lands on
   * top. Deliberate wipes (Reset all progress, importing a backup) pass
   * `force: true`.
   *
   * `urgent` writes the device files and the localStorage copy now rather than
   * on their timers: used when the app is put away, since it may never come back.
   *
   * @returns {Promise<number|null>} the savedAt stamp, or null if refused.
   */
  async writeNow(data, { force = false, urgent = false } = {}) {
    const progress = progressOf(data);
    if (!force && progress.empty) {
      let existing = null;
      try { existing = await idbGet(KEY_SAVE) || null; } catch { /* fall through */ }
      const before = progressOf(existing);
      // The marker counts too: if the database was lost, it is the only thing
      // left that remembers there was progress to protect.
      const marker = readMarker();
      const markerHasProgress = !!marker?.progress
        && (marker.progress.creatures > 0 || marker.progress.xp > 0);
      if ((existing && !before.empty) || markerHasProgress) {
        // Refuse outright: nothing is written anywhere.
        this.guardTripped = {
          at: Date.now(),
          existing: existing && !before.empty ? before : { ...marker.progress, empty: false },
          existingSavedAt: Number(existing?.savedAt || marker?.savedAt) || 0
        };
        this._emit();
        return null;
      }
    }

    const payload = { ...data, savedAt: Date.now() };
    try { await idbSet(KEY_SAVE, payload); }
    catch (e) { this.lastError = e; }

    // The marker follows the save: set while there is progress, cleared by a
    // deliberate wipe so a reset account is not mistaken for a missing one.
    try {
      if (!progress.empty) {
        lsSet(LS_MARKER, JSON.stringify({ savedAt: payload.savedAt, progress }));
      } else if (force) {
        lsDel(LS_MARKER);
      }
    } catch { /* a full quota only costs the marker */ }

    this._queueFileWrite(payload, { now: urgent || force });
    if (urgent || force) await this._fileChain;

    if (!progress.empty
      && (urgent || force || payload.savedAt - this.lastLocalBackupAt >= LOCAL_BACKUP_GAP_MS)) {
      await this._writeLocalBackup(payload);
    }

    await this._maybeSnapshot(payload);
    return payload.savedAt;
  },

  /**
   * Remembers the newest payload for the device files and writes it either now
   * or once FILE_WRITE_GAP_MS has passed since the last file write. Writes are
   * chained, so two can never overlap on the same file.
   */
  _queueFileWrite(payload, { now = false } = {}) {
    if (!this._writableFiles().length) return;
    this._pendingFile = payload;
    const wait = now ? 0 : Math.max(0, FILE_WRITE_GAP_MS - (Date.now() - this.lastFileWriteAt));
    if (wait === 0) {
      clearTimeout(this._fileTimer);
      this._fileTimer = null;
      this._fileChain = this._fileChain.then(() => this._writeFileNow());
    } else if (!this._fileTimer) {
      this._fileTimer = setTimeout(() => {
        this._fileTimer = null;
        this._fileChain = this._fileChain.then(() => this._writeFileNow());
      }, wait);
    }
  },

  async _writeFileNow() {
    const payload = this._pendingFile;
    if (!payload) return;
    this._pendingFile = null;
    const files = this._writableFiles();
    if (!files.length) return;

    // Alternate between the files. With one file this is always the same one.
    const target = files[this._nextFile % files.length];
    const isB = target === this.fileHandleB;
    try {
      await this._writeTo(target, payload);
      this.lastFileWriteAt = Date.now();
      this.lastFileError = null;
      this._nextFile = (this._nextFile + 1) % 2;
    } catch (e) {
      this.lastError = e;
      this.lastFileError = e;
      // Permission may have lapsed (e.g. file moved / access revoked).
      if (isB) this.filePermissionB = await this._queryPerm(target);
      else this.filePermission = await this._queryPerm(target);
      // Try the other file this time, so a broken one cannot stop both.
      this._nextFile = (this._nextFile + 1) % 2;
    }
    this._emit();
  },

  async _writeTo(handle, payload) {
    const w = await handle.createWritable();
    await w.write(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    await w.close();
  },

  /** Writes any file save still waiting on its timer. For the app going away. */
  async flushFiles() {
    if (this._fileTimer) {
      clearTimeout(this._fileTimer);
      this._fileTimer = null;
      this._fileChain = this._fileChain.then(() => this._writeFileNow());
    }
    await this._fileChain;
  },

  /* ---------- the localStorage copy ---------- */

  /** Both slots' headers, without unpacking the saves inside. */
  _localEntries() {
    return LS_BACKUP_KEYS.map(key => {
      try {
        const e = JSON.parse(lsGet(key) || 'null');
        return e && typeof e.data === 'string' ? { ...e, key } : null;
      } catch { return null; }
    });
  },

  async _writeLocalBackup(payload) {
    try {
      // Map points are transient and would only take up room.
      const { points, ...keep } = payload;
      const packed = await packText(JSON.stringify(keep));
      const entry = JSON.stringify({
        savedAt: payload.savedAt, progress: progressOf(payload), data: packed
      });
      const key = LS_BACKUP_KEYS[this._nextLocal];
      try {
        lsSet(key, entry);
      } catch (e) {
        // Out of room. Drop the slot being replaced and try once more; the
        // other slot is left alone, so there is still one good copy.
        lsDel(key);
        lsSet(key, entry);
      }
      this._nextLocal = (this._nextLocal + 1) % 2;
      this.lastLocalBackupAt = payload.savedAt;
      this.lastLocalBackupError = null;
    } catch (e) {
      this.lastLocalBackupError = e;   // never let this break a real save
    }
  },

  /** The newest localStorage copy that unpacks to a save with progress, or null. */
  async newestLocalBackup() {
    const list = this._localEntries().filter(Boolean)
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    for (const e of list) {
      try {
        const data = await parseSaveText(e.data);
        if (progressOf(data).empty) continue;
        return { savedAt: e.savedAt, progress: progressOf(data), data, source: 'browser backup' };
      } catch { /* damaged slot: try the other */ }
    }
    return null;
  },

  /* ---------- rolling snapshots ---------- */

  /**
   * Keeps a short history of known-good saves under their own key, spaced out
   * in time. Map points are dropped: they are transient and would double the
   * size for no recovery value.
   */
  async _maybeSnapshot(payload) {
    if (progressOf(payload).empty) return;      // never snapshot a blank account
    try {
      const list = (await idbGet(KEY_SNAPSHOTS)) || [];
      const last = list[list.length - 1];
      if (last && (payload.savedAt - (last.savedAt || 0)) < SNAPSHOT_GAP_MS) return;

      const { points, ...keep } = payload;
      list.push({ savedAt: payload.savedAt, progress: progressOf(payload), data: keep });
      while (list.length > SNAPSHOT_KEEP) list.shift();
      await idbSet(KEY_SNAPSHOTS, list);
    } catch (e) {
      this.lastError = e;   // never let snapshotting break a real save
    }
  },

  /** Newest last. Each entry is { savedAt, progress, data }. */
  async snapshots() {
    try { return (await idbGet(KEY_SNAPSHOTS)) || []; }
    catch { return []; }
  },

  /** The most recent snapshot that actually holds progress, or null. */
  async newestSnapshot() {
    const list = await this.snapshots();
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i] && !progressOf(list[i].data).empty) return { ...list[i], source: 'snapshot' };
    }
    return null;
  },

  /* ---------- device file linking ---------- */

  async _pickSaveFile(suggestedName) {
    if (!this.supportsFS) throw new Error('This browser cannot write directly to device files. Use "Download backup" instead.');
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [{ description: 'Search and Go save', accept: { 'application/json': ['.json'] } }]
    });
    const perm = await handle.requestPermission?.({ mode: 'readwrite' }) ?? 'granted';
    if (perm !== 'granted') throw new Error('Write permission was not granted.');
    return handle;
  },

  /** Ask the user where to keep the main save file, then write it. */
  async linkFile(data) {
    const handle = await this._pickSaveFile(SAVE_FILENAME);
    if (this.fileHandleB && await handle.isSameEntry?.(this.fileHandleB)) {
      throw new Error('That is already your second save file. Pick a different file.');
    }
    this.fileHandle = handle;
    this.filePermission = 'granted';
    await idbSet(KEY_HANDLE, handle);
    this._nextFile = 0;
    await this.writeNow(data, { urgent: true });
    this._emit();
    return this.status();
  },

  /**
   * Links the second file. Saves then alternate between the two, so a write
   * that is cut off can only ever damage one of them.
   */
  async linkSecondFile(data) {
    if (!this.fileHandle) throw new Error('Link your main save file first.');
    const handle = await this._pickSaveFile(SAVE_FILENAME_B);
    if (await handle.isSameEntry?.(this.fileHandle)) {
      throw new Error('That is your main save file. Pick a different file for the second copy.');
    }
    this.fileHandleB = handle;
    this.filePermissionB = 'granted';
    await idbSet(KEY_HANDLE_B, handle);
    this._nextFile = 1;      // fill the new file straight away
    await this.writeNow(data, { urgent: true });
    this._emit();
    return this.status();
  },

  /** Pick an existing save file, adopt it as the main file, and return its data. */
  async openFile() {
    if (!this.supportsFS) throw new Error('This browser cannot open device files directly. Use "Import backup" instead.');
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: 'Search and Go save', accept: { 'application/json': ['.json'] } }]
    });
    // Read before adopting, so a damaged file is reported and not linked.
    const file = await handle.getFile();
    const data = await parseSaveText(await file.text());
    const perm = await handle.requestPermission?.({ mode: 'readwrite' }) ?? 'granted';
    if (this.fileHandleB && await handle.isSameEntry?.(this.fileHandleB)) {
      // Restoring from the second file: keep it as the second file.
      this.filePermissionB = perm === 'granted' ? 'granted' : 'prompt';
    } else {
      this.fileHandle = handle;
      this.filePermission = perm === 'granted' ? 'granted' : 'prompt';
      await idbSet(KEY_HANDLE, handle);
    }
    this._emit();
    return data;
  },

  /** Re-request permission for already-linked files (needs a user gesture). */
  async regrant() {
    if (!this.fileHandle) return 'unavailable';
    const p = await this.fileHandle.requestPermission?.({ mode: 'readwrite' }) ?? 'granted';
    this.filePermission = p;
    if (this.fileHandleB) {
      try {
        this.filePermissionB = await this.fileHandleB.requestPermission?.({ mode: 'readwrite' }) ?? 'granted';
      } catch { this.filePermissionB = 'prompt'; }
    }
    this._emit();
    return p;
  },

  async unlink() {
    this.fileHandle = null;
    this.fileHandleB = null;
    this.filePermission = this.supportsFS ? 'prompt' : 'unavailable';
    this.filePermissionB = this.filePermission;
    await idbDel(KEY_HANDLE);
    await idbDel(KEY_HANDLE_B);
    this._emit();
  },

  /* ---------- portable backups ---------- */

  download(data, filename = SAVE_FILENAME) {
    const payload = { ...data, savedAt: Date.now() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  },

  /**
   * Reads a backup file. Throws an Error with a player-facing message when the
   * file is empty, damaged or not a save at all.
   */
  async importFile(file) {
    if (!file || file.size === 0) throw friendly(MSG_EMPTY_FILE);
    return parseSaveText(await file.text());
  },

  async wipe() {
    try { await idbDel(KEY_SAVE); } catch { /* ignore */ }
  }
};
