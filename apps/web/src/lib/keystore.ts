// Keeps the user's chat private key in this browser (IndexedDB), never on the server in readable form.
const DB = "glimpse-keys", STORE = "keys";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const savePrivateKey = (userId: string, key: Uint8Array) => tx("readwrite", (s) => s.put(key, userId));
export const loadPrivateKey = (userId: string) => tx<Uint8Array | undefined>("readonly", (s) => s.get(userId));
export const clearKeys = () => tx("readwrite", (s) => s.clear());
