import type { StorageAdapter } from '../types';

/**
 * Fallback / secondary adapter. Proves the storage seam and works
 * where IndexedDB is blocked. Values are JSON-encoded.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly name = 'localstorage';
  private readonly storage: Storage;

  constructor(storage: Storage = localStorage) {
    this.storage = storage;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const raw = this.storage.getItem(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    this.storage.setItem(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    this.storage.removeItem(key);
  }

  async keys(prefix = ''): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const k = this.storage.key(i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
    return out;
  }

  async clear(): Promise<void> {
    this.storage.clear();
  }
}
