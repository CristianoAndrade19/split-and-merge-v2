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
   * Saves project metadata and heavy image blobs atomically on disk.
   * @param {StoredProjectMeta} metaRecord
   * @param {{ id: string, img1Blob?: Blob | null, img2Blob?: Blob | null, imgRefinedBlob?: Blob | null, finalBlob?: Blob | null }} blobsRecord
   * @returns {Promise<boolean>}
   */
  async function saveProject(metaRecord, blobsRecord) {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PROJECTS, STORE_BLOBS], 'readwrite');
      tx.objectStore(STORE_PROJECTS).put(metaRecord);
      tx.objectStore(STORE_BLOBS).put(blobsRecord);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('Erro ao gravar projeto no disco.'));
    });
    return true;
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
