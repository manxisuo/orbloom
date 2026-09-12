import type { StorageAdapter } from '../types';

/** In-memory adapter for tests and environments without persistent storage. */
export class MemoryStorageAdapter implements StorageAdapter {
  readonly name = 'memory';
  private map = new Map<string, unknown>();

  async get<T = unknown>(key: string): Promise<T | null> {
    if (!this.map.has(key)) return null;
    return this.map.get(key) as T;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async keys(prefix = ''): Promise<string[]> {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix));
  }

  async clear(): Promise<void> {
    this.map.clear();
  }
}
