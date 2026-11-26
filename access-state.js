'use strict';

// Shared by the login document and its service worker.
globalThis.accessState = (() => {
  const SESSION_KEY = 'owner';
  const lifetime = 12 * 60 * 60 * 1000;
  let database;

  function connect() {
    if (!database) {
      database = new Promise((resolve, reject) => {
        const request = indexedDB.open('forgeview-portal-access', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('session');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Access storage is busy.'));
      }).catch(error => {
        database = undefined;
        throw error;
      });
    }
    return database;
  }

  async function run(mode, action) {
    const db = await connect();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('session', mode);
      const request = action(tx.objectStore('session'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error('Access storage was interrupted.'));
    });
  }

  return {
    async read(release) {
      const record = await run('readonly', store => store.get(SESSION_KEY));
      return record?.release === release && record.expires > Date.now() ? record.key : null;
    },
    save(key, release) {
      return run('readwrite', store => store.put({ key, release, expires: Date.now() + lifetime }, SESSION_KEY));
    },
    clear() {
      return run('readwrite', store => store.delete(SESSION_KEY));
    },
  };
})();
