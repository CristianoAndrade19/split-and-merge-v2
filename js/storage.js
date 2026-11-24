// @ts-check
/// <reference path="./types.js" />

(function (global) {
  'use strict';

  const DB_NAME = 'SplitMergeStudioDB';
  const DB_VERSION = 1;
  const STORE_SETTINGS = 'settings';
  const STORE_PROJECTS = 'projects';
  const STORE_BLOBS = 'project_blobs';
  const SETTINGS_KEY = 'app';

  /** @type {Promise<IDBDatabase> | null} */
  let dbPromise = null;
  let persistRequested = false;
  /** @type {Promise<any>} */
  let writeQueue = Promise.resolve();

  /**
   * Opens (and caches) the IndexedDB connection cleanly.
   * @returns {Promise<IDBDatabase>}
   */
  function openDB() {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB indisponível neste navegador.'));
    }
    if (!persistRequested) {
      persistRequested = true;
      try {
        if (navigator.storage && typeof navigator.storage.persist === 'function') {
          navigator.storage.persist().catch(() => {});
        }
      } catch (_) {}
    }
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (ev) => {
          const db = /** @type {IDBOpenDBRequest} */ (ev.target).result;
          if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
            db.createObjectStore(STORE_SETTINGS);
          }
          if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
            const projStore = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
            projStore.createIndex('by_updatedAt', 'updatedAt', { unique: false });
          }
          if (!db.objectStoreNames.contains(STORE_BLOBS)) {
            db.createObjectStore(STORE_BLOBS, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => {
            try {
              db.close();
            } catch (_) {}
            dbPromise = null;
          };
          resolve(db);
        };
        req.onerror = () => {
          dbPromise = null;
          reject(req.error || new Error('Falha ao abrir banco local em disco.'));
        };
      } catch (err) {
        dbPromise = null;
        reject(err);
      }
    });

    return dbPromise;
  }

  /**
   * Encodes an HTMLCanvasElement as a compressed Blob cleanly.
   * @param {HTMLCanvasElement | null | undefined} canvas
   * @param {string} [type='image/png']
   * @param {number} [quality=0.92]
   * @returns {Promise<Blob | null>}
   */
  function canvasToBlob(canvas, type = 'image/png', quality = 0.92) {
    return new Promise((resolve) => {
      if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
        resolve(null);
        return;
      }
      try {
        canvas.toBlob((blob) => resolve(blob || null), type, quality);
      } catch (_) {
        resolve(null);
      }
    });
  }

  /**
   * Creates a lightweight JPEG thumbnail Blob for project history cards so RAM stays tiny.
   * @param {HTMLCanvasElement | null | undefined} canvas
   * @param {number} [maxSide=320]
   * @returns {Promise<Blob | null>}
   */
  async function createThumbnailBlob(canvas, maxSide = 320) {
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null;
    const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
    const w = Math.max(1, Math.round(canvas.width * scale));
    const h = Math.max(1, Math.round(canvas.height * scale));
    const thumb = document.createElement('canvas');
    thumb.width = w;
    thumb.height = h;
    const ctx = thumb.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#090b10';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(canvas, 0, 0, w, h);
    const blob = await canvasToBlob(thumb, 'image/jpeg', 0.78);
    try {
      thumb.width = 0;
      thumb.height = 0;
    } catch (_) {}
    return blob;
  }

  /**
   * Converts a Blob to an iOS-safe `{ data: ArrayBuffer, type: string }` record.
   * Raw Blob instances stored in iOS Safari IndexedDB frequently become unreadable across reloads.
   * @param {Blob | null | undefined} blob
   * @returns {Promise<{ data: ArrayBuffer, type: string } | null>}
   */
  async function blobToStoredBytes(blob) {
    if (!blob || !(blob instanceof Blob) || blob.size <= 0) return null;
    try {
      if (typeof blob.arrayBuffer === 'function') {
        const buf = await blob.arrayBuffer();
        if (!buf || buf.byteLength <= 0) return null;
        return { data: buf, type: blob.type || 'image/png' };
      }
    } catch (_) {}

    return new Promise((resolve) => {
      try {
        const reader = new FileReader();
        reader.onload = () => {
          const buf = /** @type {ArrayBuffer | null} */ (reader.result);
          if (buf && buf instanceof ArrayBuffer && buf.byteLength > 0) {
            resolve({ data: buf, type: blob.type || 'image/png' });
          } else {
            resolve(null);
          }
        };
        reader.onerror = () => resolve(null);
        reader.readAsArrayBuffer(blob);
      } catch (_) {
        resolve(null);
      }
    });
  }

  /**
   * Normalizes `{ data: ArrayBuffer | Uint8Array, type }` OR a legacy `Blob` into a valid `Blob | null`.
   * @param {any} entry
   * @param {string} [fallbackType='image/png']
   * @returns {Blob | null}
   */
  function storedToBlob(entry, fallbackType = 'image/png') {
    if (!entry) return null;
    if (entry instanceof Blob) {
      return entry.size > 0 ? entry : null;
    }
    if (entry instanceof ArrayBuffer) {
      return entry.byteLength > 0 ? new Blob([entry], { type: fallbackType }) : null;
    }
    if (ArrayBuffer.isView(entry)) {
      if (entry.byteLength <= 0) return null;
      const sliced = entry.buffer.slice(entry.byteOffset, entry.byteOffset + entry.byteLength);
      return new Blob([sliced], { type: fallbackType });
    }
    if (typeof entry === 'object' && entry.data) {
      const mime = entry.type || fallbackType;
      if (entry.data instanceof ArrayBuffer) {
        return entry.data.byteLength > 0 ? new Blob([entry.data], { type: mime }) : null;
      }
      if (ArrayBuffer.isView(entry.data)) {
        if (entry.data.byteLength <= 0) return null;
        const sliced = entry.data.buffer.slice(
          entry.data.byteOffset,
          entry.data.byteOffset + entry.data.byteLength
        );
        return new Blob([sliced], { type: mime });
      }
    }
    return null;
  }

  /**
   * Encodes an HTMLCanvasElement as iOS-safe `{ data: ArrayBuffer, type }` bytes.
   * @param {HTMLCanvasElement | null | undefined} canvas
   * @param {string} [type='image/png']
   * @param {number} [quality=0.92]
   * @returns {Promise<{ data: ArrayBuffer, type: string } | null>}
   */
  async function canvasToStoredBytes(canvas, type = 'image/png', quality = 0.92) {
    const blob = await canvasToBlob(canvas, type, quality);
    return blobToStoredBytes(blob);
  }

  /**
   * Creates a compact JPEG thumbnail stored as `{ data: ArrayBuffer, type: 'image/jpeg' }`.
   * @param {HTMLCanvasElement | null | undefined} canvas
   * @param {number} [maxSide=320]
   * @returns {Promise<{ data: ArrayBuffer, type: string } | null>}
   */
  async function createThumbnailStoredBytes(canvas, maxSide = 320) {
    const blob = await createThumbnailBlob(canvas, maxSide);
    return blobToStoredBytes(blob);
  }

  /**
   * Loads persisted app settings from IndexedDB, merged cleanly with defaults.
   * @param {AppSettings} defaults
   * @returns {Promise<AppSettings>}
   */
  async function loadSettings(defaults) {
    const base = { ...defaults };
    try {
      const db = await openDB();
      const stored = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SETTINGS, 'readonly');
        const req = tx.objectStore(STORE_SETTINGS).get(SETTINGS_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      if (stored && typeof stored === 'object') {
        Object.assign(base, stored);
      }
    } catch (_) {
      // Fallback gracefully when IndexedDB is blocked in private mode
      try {
        const cachedTheme = localStorage.getItem('sm_theme');
        if (cachedTheme) base.theme = cachedTheme;
      } catch (_) {}
    }
    return base;
  }

  /**
   * Saves app settings to disk (IndexedDB) and updates fast-boot theme hint.
   * @param {AppSettings} settings
   * @returns {Promise<boolean>}
   */
  async function saveSettings(settings) {
    try {
      if (settings && settings.theme) {
        try {
          localStorage.setItem('sm_theme', settings.theme);
        } catch (_) {}
      }
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SETTINGS, 'readwrite');
        tx.objectStore(STORE_SETTINGS).put({ ...settings }, SETTINGS_KEY);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Saves project metadata and heavy image payloads atomically on disk, serialized via writeQueue.
   * @param {StoredProjectMeta} metaRecord
   * @param {any} blobsRecord
   * @returns {Promise<boolean>}
   */
  function saveProject(metaRecord, blobsRecord) {
    const run = async () => {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        try {
          const tx = db.transaction([STORE_PROJECTS, STORE_BLOBS], 'readwrite');
          tx.objectStore(STORE_PROJECTS).put(metaRecord);
          tx.objectStore(STORE_BLOBS).put(blobsRecord);
          tx.oncomplete = () => resolve(true);
          tx.onabort = () => {
            const err = tx.error;
            if (err && err.name === 'QuotaExceededError') {
              reject(new Error('Espaço em disco insuficiente. Apague projetos antigos no Histórico.'));
            } else {
              reject(err || new Error('Transação abortada ao gravar projeto no disco.'));
            }
          };
          tx.onerror = () => {
            const err = tx.error;
            if (err && err.name === 'QuotaExceededError') {
              reject(new Error('Espaço em disco insuficiente. Apague projetos antigos no Histórico.'));
            } else {
              reject(err || new Error('Erro ao gravar projeto no disco.'));
            }
          };
        } catch (err) {
          if (err && err.name === 'QuotaExceededError') {
            reject(new Error('Espaço em disco insuficiente. Apague projetos antigos no Histórico.'));
          } else {
            reject(err);
          }
        }
      });
      return true;
    };

    const next = writeQueue.then(run, run);
    writeQueue = next.catch(() => {});
    return next;
  }

  /**
   * Lists ONLY project metadata + small thumbnail blobs (never loads full images into RAM).
   * @returns {Promise<StoredProjectMeta[]>}
   */
  async function listProjects() {
    try {
      const db = await openDB();
      const items = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_PROJECTS, 'readonly');
        const req = tx.objectStore(STORE_PROJECTS).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return items;
    } catch (_) {
      return [];
    }
  }

  /**
   * Loads a single project metadata + binary blobs on demand.
   * @param {string} id
   * @returns {Promise<{ metaRecord: StoredProjectMeta, blobsRecord: any } | null>}
   */
  async function loadProject(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PROJECTS, STORE_BLOBS], 'readonly');
      let metaRecord = null;
      let blobsRecord = null;
      const r1 = tx.objectStore(STORE_PROJECTS).get(id);
      const r2 = tx.objectStore(STORE_BLOBS).get(id);
      r1.onsuccess = () => {
        metaRecord = r1.result || null;
      };
      r2.onsuccess = () => {
        blobsRecord = r2.result || null;
      };
      tx.oncomplete = () => {
        resolve(metaRecord ? { metaRecord, blobsRecord: blobsRecord || { id } } : null);
      };
      tx.onerror = () => reject(tx.error || new Error('Erro ao carregar projeto do disco.'));
    });
  }

  /**
   * Renames a saved project cleanly on disk.
   * @param {string} id
   * @param {string} newName
   * @returns {Promise<boolean>}
   */
  async function renameProject(id, newName) {
    const clean = String(newName || '').trim();
    if (!clean) return false;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      const store = tx.objectStore(STORE_PROJECTS);
      const req = store.get(id);
      req.onsuccess = () => {
        const rec = req.result;
        if (!rec) return;
        rec.name = clean;
        store.put(rec);
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Deletes a single project (metadata + blobs) from disk.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async function deleteProject(id) {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PROJECTS, STORE_BLOBS], 'readwrite');
      tx.objectStore(STORE_PROJECTS).delete(id);
      tx.objectStore(STORE_BLOBS).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
    return true;
  }

  /**
   * Deletes all projects from disk without touching app settings.
   * @returns {Promise<boolean>}
   */
  async function clearAllProjects() {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PROJECTS, STORE_BLOBS], 'readwrite');
      tx.objectStore(STORE_PROJECTS).clear();
      tx.objectStore(STORE_BLOBS).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
    return true;
  }

  /**
   * Queries browser disk storage estimate cleanly.
   * @returns {Promise<{ supported: boolean, usage: number, quota: number }>}
   */
  async function estimateStorage() {
    try {
      if (navigator.storage && typeof navigator.storage.estimate === 'function') {
        const est = await navigator.storage.estimate();
        return {
          supported: true,
          usage: Number(est.usage || 0),
          quota: Number(est.quota || 0),
        };
      }
    } catch (_) {}
    return { supported: false, usage: 0, quota: 0 };
  }

  global.SplitMergeStorage = {
    openDB,
    canvasToBlob,
    createThumbnailBlob,
    blobToStoredBytes,
    storedToBlob,
    canvasToStoredBytes,
    createThumbnailStoredBytes,
    loadSettings,
    saveSettings,
    saveProject,
    listProjects,
    loadProject,
    renameProject,
    deleteProject,
    clearAllProjects,
    estimateStorage,
  };
})(window);
