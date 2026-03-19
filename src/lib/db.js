import { openDB } from 'idb';

const DB_NAME = 'txt-reader-db';
const STORE_NAME = 'app';

const dbPromise = openDB(DB_NAME, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME);
    }
  },
});

export async function setItem(key, value) {
  const db = await dbPromise;
  return db.put(STORE_NAME, value, key);
}

export async function getItem(key) {
  const db = await dbPromise;
  return db.get(STORE_NAME, key);
}

export async function deleteItem(key) {
  const db = await dbPromise;
  return db.delete(STORE_NAME, key);
}