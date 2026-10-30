import type { Film } from '../types';

const DB_NAME = 'my-movie-stats';
const STORE_NAME = 'library';
const LIBRARY_KEY = 'active-library';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Could not open local storage.'));
  });
}

export async function saveLibrary(films: Film[]): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(films, LIBRARY_KEY);

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error('Could not save your library.'));
    };
  });
}

export async function loadLibrary(): Promise<Film[]> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(LIBRARY_KEY);

    request.onsuccess = () => {
      db.close();
      resolve(Array.isArray(request.result) ? request.result as Film[] : []);
    };

    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error('Could not load your library.'));
    };
  });
}