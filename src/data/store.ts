/** Tiny IndexedDB key-value store for the downloaded WHO files and the license-acceptance flag. */

const DB_NAME = "cid-ponte-app";
const STORE = "files";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function get<T>(key: string): Promise<T | undefined> {
  const db = await open();
  try {
    const tx = db.transaction(STORE, "readonly");
    return (await request(tx.objectStore(STORE).get(key))) as T | undefined;
  } finally {
    db.close();
  }
}

export async function put(key: string, value: unknown): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction(STORE, "readwrite");
    await request(tx.objectStore(STORE).put(value, key));
  } finally {
    db.close();
  }
}

export async function remove(key: string): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction(STORE, "readwrite");
    await request(tx.objectStore(STORE).delete(key));
  } finally {
    db.close();
  }
}

export async function clearAll(): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction(STORE, "readwrite");
    await request(tx.objectStore(STORE).clear());
  } finally {
    db.close();
  }
}
