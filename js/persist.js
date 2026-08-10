/* ============================================================
   persist.js — durable save layer

   Three cooperating layers, strongest first:
     1. A real file on the device, via the File System Access API.
        Survives "clear browsing data" because it lives outside the
        browser's storage bucket. Supported on Chrome/Android.
     2. IndexedDB (+ navigator.storage.persist()) as the always-on
        working copy. Fast, but wiped if the user clears site data.
     3. Manual download / import of a .json backup — works everywhere.
   ============================================================ */

const DB_NAME = 'search-and-go';
const DB_VERSION = 1;
const KV_STORE = 'kv';
const KEY_SAVE = 'save';
const KEY_HANDLE = 'saveFileHandle';

export const SAVE_FILENAME = 'search-and-go-save.json';

let idb = null;

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
  fileHandle: null,
  filePermission: 'unavailable', // 'granted' | 'prompt' | 'denied' | 'unavailable'
  persisted: false,
  lastError: null,
  onStatusChange: null,

  /* ---------- lifecycle ---------- */

  async init() {
    // Ask the browser to make our storage bucket persistent (best effort).
    try {
      if (navigator.storage?.persist) {
        this.persisted = await navigator.storage.persisted?.() || false;
        if (!this.persisted) this.persisted = await navigator.storage.persist();
      }
    } catch { /* non-fatal */ }

    // Re-attach a previously linked device file, if we still have the handle.
    if (this.supportsFS) {
      try {
        const h = await idbGet(KEY_HANDLE);
        if (h) {
          this.fileHandle = h;
          this.filePermission = await this._queryPerm(h);
        } else {
          this.filePermission = 'prompt';
        }
      } catch (e) {
        this.lastError = e;
        this.filePermission = 'prompt';
      }
    }
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

  status() {
    return {
      supportsFS: this.supportsFS,
      linked: !!this.fileHandle,
      fileName: this.fileHandle?.name || null,
      filePermission: this.filePermission,
      persisted: this.persisted,
      autoFileSave: !!this.fileHandle && this.filePermission === 'granted'
    };
  },

  /* ---------- loading ---------- */

  /**
   * Reads the newest available save. Prefers whichever of the local file
   * or the IndexedDB copy has the later `savedAt` stamp.
   */
  async load() {
    let fromIDB = null, fromFile = null;

    try { fromIDB = await idbGet(KEY_SAVE) || null; }
    catch (e) { this.lastError = e; }

    if (this.fileHandle && this.filePermission === 'granted') {
      try { fromFile = await this._readFile(this.fileHandle); }
      catch (e) { this.lastError = e; }
    }

    if (fromFile && fromIDB) {
      const pick = (fromFile.savedAt || 0) > (fromIDB.savedAt || 0) ? fromFile : fromIDB;
      return { data: pick, source: pick === fromFile ? 'file' : 'idb' };
    }
    if (fromFile) return { data: fromFile, source: 'file' };
    if (fromIDB) return { data: fromIDB, source: 'idb' };
    return { data: null, source: 'none' };
  },

  async _readFile(handle) {
    const file = await handle.getFile();
    const text = await file.text();
    if (!text.trim()) return null;
    return JSON.parse(text);
  },

  /* ---------- saving ---------- */

  /** Immediate write to every available layer. */
  async writeNow(data) {
    const payload = { ...data, savedAt: Date.now() };
    try { await idbSet(KEY_SAVE, payload); }
    catch (e) { this.lastError = e; }

    if (this.fileHandle && this.filePermission === 'granted') {
      try {
        const w = await this.fileHandle.createWritable();
        await w.write(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
        await w.close();
      } catch (e) {
        this.lastError = e;
        // Permission may have lapsed (e.g. file moved / access revoked).
        this.filePermission = await this._queryPerm(this.fileHandle);
        this._emit();
      }
    }
    return payload.savedAt;
  },

  /* ---------- device file linking ---------- */

  /** Ask the user where to keep the save file, then write it. */
  async linkFile(data) {
    if (!this.supportsFS) throw new Error('This browser cannot write directly to device files. Use "Download backup" instead.');
    const handle = await window.showSaveFilePicker({
      suggestedName: SAVE_FILENAME,
      types: [{ description: 'Search and Go save', accept: { 'application/json': ['.json'] } }]
    });
    const perm = await handle.requestPermission?.({ mode: 'readwrite' }) ?? 'granted';
    if (perm !== 'granted') throw new Error('Write permission was not granted.');
    this.fileHandle = handle;
    this.filePermission = 'granted';
    await idbSet(KEY_HANDLE, handle);
    await this.writeNow(data);
    this._emit();
    return this.status();
  },

  /** Pick an existing save file, adopt it as the live file, and return its data. */
  async openFile() {
    if (!this.supportsFS) throw new Error('This browser cannot open device files directly. Use "Import backup" instead.');
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: 'Search and Go save', accept: { 'application/json': ['.json'] } }]
    });
    const perm = await handle.requestPermission?.({ mode: 'readwrite' }) ?? 'granted';
    this.fileHandle = handle;
    this.filePermission = perm === 'granted' ? 'granted' : 'prompt';
    await idbSet(KEY_HANDLE, handle);
    const data = await this._readFile(handle);
    this._emit();
    return data;
  },

  /** Re-request permission for an already-linked file (needs a user gesture). */
  async regrant() {
    if (!this.fileHandle) return 'unavailable';
    const p = await this.fileHandle.requestPermission?.({ mode: 'readwrite' }) ?? 'granted';
    this.filePermission = p;
    this._emit();
    return p;
  },

  async unlink() {
    this.fileHandle = null;
    this.filePermission = this.supportsFS ? 'prompt' : 'unavailable';
    await idbDel(KEY_HANDLE);
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

  async importFile(file) {
    const text = await file.text();
    return JSON.parse(text);
  },

  async wipe() {
    try { await idbDel(KEY_SAVE); } catch { /* ignore */ }
  }
};
