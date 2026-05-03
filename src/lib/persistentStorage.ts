// IndexedDB persistence layer for FOS Cleaner — replaces localStorage base64 hacks.
// Keeps raw ArrayBuffer without bloat and avoids the ~5MB localStorage limit.

const DB_NAME = "fos-cleaner";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("file")) db.createObjectStore("file");
      if (!db.objectStoreNames.contains("flag")) db.createObjectStore("flag");
    };
  });
}

function wrapReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function storeFile(filename: string, buffer: ArrayBuffer): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(["file"], "readwrite");
  const store = tx.objectStore("file");
  await wrapReq(store.put({ filename, buffer, storedAt: Date.now() }, "current"));
}

export async function loadFile(): Promise<{ filename: string; buffer: ArrayBuffer } | null> {
  const db = await openDB();
  const tx = db.transaction(["file"], "readonly");
  const store = tx.objectStore("file");
  const raw = await wrapReq(store.get("current"));
  if (!raw || !(raw.buffer instanceof ArrayBuffer)) return null;
  return { filename: raw.filename, buffer: raw.buffer };
}

export async function clearFile(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(["file"], "readwrite");
  await wrapReq(tx.objectStore("file").delete("current"));
}

export async function storeFlag(key: string, value: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(["flag"], "readwrite");
  await wrapReq(tx.objectStore("flag").put(value, key));
}

export async function loadFlag(key: string): Promise<string | null> {
  const db = await openDB();
  const tx = db.transaction(["flag"], "readonly");
  const raw = await wrapReq(tx.objectStore("flag").get(key));
  return typeof raw === "string" ? raw : null;
}

export async function clearFlag(key: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(["flag"], "readwrite");
  await wrapReq(tx.objectStore("flag").delete(key));
}