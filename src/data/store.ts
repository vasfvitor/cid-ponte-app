/** Tiny IndexedDB key-value store for the downloaded WHO files and the license-acceptance flag. */

const DB_NAME = "cid-ponte-app";
const STORE = "files";

let dbPromise: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = undefined;
      reject(req.error);
    };
  });
  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  const r = run(db.transaction(STORE, mode).objectStore(STORE));
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const get = <T>(key: string): Promise<T | undefined> =>
  withStore("readonly", (s) => s.get(key)) as Promise<T | undefined>;

export const has = async (key: string): Promise<boolean> =>
  (await withStore("readonly", (s) => s.count(key))) > 0;

export const put = (key: string, value: unknown): Promise<IDBValidKey> =>
  withStore("readwrite", (s) => s.put(value, key));

export const remove = (key: string): Promise<undefined> =>
  withStore("readwrite", (s) => s.delete(key));

export const clearAll = (): Promise<undefined> => withStore("readwrite", (s) => s.clear());
