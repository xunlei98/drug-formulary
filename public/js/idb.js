function open(name, stores) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      for (const [s, opts] of Object.entries(stores)) req.result.createObjectStore(s, opts);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
const result = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

export function createDb(name, stores) {
  let dbp = null;
  const db = () => (dbp ||= open(name, stores));
  return {
    async all(store) {
      return result((await db()).transaction(store).objectStore(store).getAll());
    },
    async get(store, key) {
      return result((await db()).transaction(store).objectStore(store).get(key));
    },
    async put(store, value, key) {
      const tx = (await db()).transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      return done(tx);
    },
    async del(store, key) {
      const tx = (await db()).transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      return done(tx);
    },
    async replaceAll(map) {
      const names = Object.keys(map);
      const tx = (await db()).transaction(names, 'readwrite');
      for (const [store, rows] of Object.entries(map)) {
        const os = tx.objectStore(store);
        os.clear();
        for (const r of rows) os.put(r);
      }
      return done(tx);
    },
    async destroy() {
      if (dbp) (await dbp).close();
      dbp = null;
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });
    },
  };
}

export const mainDb = createDb('fm-main', {
  drugs: { keyPath: 'no_kod' }, mahal: { keyPath: 'no_kod' }, locations: { keyPath: 'id' }, balances: { keyPath: 'key' },
  movements: { keyPath: 'id' }, outbox: { keyPath: 'n', autoIncrement: true }, rejected: { keyPath: 'id' }, meta: {},
});

export const patientDb = createDb('fm-patients', { patients: { keyPath: 'id' } });
