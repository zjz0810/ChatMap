import type { Turn } from "../../shared/types";

const DB_NAME = "turnmap";
const DB_VERSION = 1;
const TURN_STORE = "turns";

type StoredTurns = {
  conversationId: string;
  conversationTitle: string;
  turns: Turn[];
  updatedAt: number;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TURN_STORE)) {
        db.createObjectStore(TURN_STORE, { keyPath: "conversationId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
  });
}

export async function saveTurnsToIndexedDb(
  conversationId: string,
  conversationTitle: string,
  turns: Turn[]
): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(TURN_STORE, "readwrite");
    const store = transaction.objectStore(TURN_STORE);
    store.put({
      conversationId,
      conversationTitle,
      turns,
      updatedAt: Date.now()
    } satisfies StoredTurns);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB save failed."));
  });
  db.close();
}

export async function loadTurnsFromIndexedDb(conversationId: string): Promise<StoredTurns | null> {
  const db = await openDatabase();
  const value = await new Promise<StoredTurns | null>((resolve, reject) => {
    const transaction = db.transaction(TURN_STORE, "readonly");
    const store = transaction.objectStore(TURN_STORE);
    const request = store.get(conversationId);
    request.onsuccess = () => resolve((request.result as StoredTurns | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB load failed."));
  });
  db.close();
  return value;
}

/** Removes only ChatMap's cached turns for one conversation, never page content. */
export async function deleteTurnsFromIndexedDb(conversationId: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(TURN_STORE, "readwrite");
    const store = transaction.objectStore(TURN_STORE);
    store.delete(conversationId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB delete failed."));
  });
  db.close();
}
