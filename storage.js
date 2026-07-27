(() => {
  'use strict';

  const DB_NAME = 'family-hub';
  const DB_VERSION = 1;
  const STORE_NAME = 'app-data';
  const STATE_KEY = 'state';
  const LAST_BACKUP_KEY = 'last-backup';
  const MIGRATION_KEY = 'local-storage-migration';
  const LEGACY_STATE_KEY = 'family-hub-lenovo-v1';
  const LEGACY_BACKUP_KEY = 'family-hub-last-backup';

  let databasePromise = null;
  let mode = 'IndexedDB';

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open IndexedDB'));
      request.onblocked = () => reject(new Error('IndexedDB upgrade was blocked'));
    });
    return databasePromise;
  }

  async function read(key) {
    try {
      const database = await openDatabase();
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readonly');
        const request = transaction.objectStore(STORE_NAME).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      mode = 'Local storage fallback';
      return readFallback(key);
    }
  }

  async function write(key, value) {
    try {
      const database = await openDatabase();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put(value, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
      });
    } catch (error) {
      mode = 'Local storage fallback';
      writeFallback(key, value);
    }
  }

  function readFallback(key) {
    try {
      if (key === STATE_KEY) return JSON.parse(localStorage.getItem(LEGACY_STATE_KEY));
      if (key === LAST_BACKUP_KEY) return localStorage.getItem(LEGACY_BACKUP_KEY);
      return JSON.parse(localStorage.getItem(`family-hub-${key}`));
    } catch {
      return null;
    }
  }

  function writeFallback(key, value) {
    if (key === STATE_KEY) {
      localStorage.setItem(LEGACY_STATE_KEY, JSON.stringify(value));
      return;
    }
    if (key === LAST_BACKUP_KEY) {
      localStorage.setItem(LEGACY_BACKUP_KEY, value || '');
      return;
    }
    localStorage.setItem(`family-hub-${key}`, JSON.stringify(value));
  }

  function readLegacyState() {
    try {
      return JSON.parse(localStorage.getItem(LEGACY_STATE_KEY));
    } catch {
      return null;
    }
  }

  async function initialise(defaultState) {
    let storedState = await read(STATE_KEY);
    let migrated = false;

    if (!storedState) {
      const legacyState = readLegacyState();
      storedState = legacyState || defaultState;
      await write(STATE_KEY, storedState);
      await write(MIGRATION_KEY, {
        completedAt: new Date().toISOString(),
        source: legacyState ? 'localStorage' : 'new installation'
      });
      migrated = Boolean(legacyState);

      const legacyBackupDate = localStorage.getItem(LEGACY_BACKUP_KEY);
      if (legacyBackupDate) await write(LAST_BACKUP_KEY, legacyBackupDate);
    }

    return {
      state: storedState,
      lastBackup: await read(LAST_BACKUP_KEY),
      migrated,
      mode
    };
  }

  window.FamilyHubStorage = Object.freeze({
    initialise,
    getState: () => read(STATE_KEY),
    setState: value => write(STATE_KEY, value),
    getLastBackup: () => read(LAST_BACKUP_KEY),
    setLastBackup: value => write(LAST_BACKUP_KEY, value),
    getMode: () => mode
  });
})();
