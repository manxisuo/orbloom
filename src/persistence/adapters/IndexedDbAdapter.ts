import type { StorageAdapter } from '../types';

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Primary production adapter. One object store, keys as strings, values as structured clones.
 */
export class IndexedDbStorageAdapter implements StorageAdapter {
  readonly name = 'indexeddb';
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly version: number;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(dbName = 'orbloom', storeName = 'kv', version = 1) {
    this.dbName = dbName;
    this.storeName = storeName;
    this.version = version;
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available in this environment'));
        return;
      }
      const req = indexedDB.open(this.dbName, this.version);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked by another connection'));
    });
    return this.dbPromise;
  }

  private async tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.open();
    return db.transaction(this.storeName, mode).objectStore(this.storeName);
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const store = await this.tx('readonly');
    const value = await requestToPromise(store.get(key));
    return (value as T | undefined) ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    const store = await this.tx('readwrite');
    await requestToPromise(store.put(value, key));
  }

  async delete(key: string): Promise<void> {
    const store = await this.tx('readwrite');
    await requestToPromise(store.delete(key));
  }

  async keys(prefix = ''): Promise<string[]> {
    const store = await this.tx('readonly');
    const all = await requestToPromise(store.getAllKeys());
    return (all as IDBValidKey[]).map(String).filter((k) => k.startsWith(prefix));
  }

  async clear(): Promise<void> {
    const store = await this.tx('readwrite');
    await requestToPromise(store.clear());
  }
}
