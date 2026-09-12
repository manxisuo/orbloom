import { IndexedDbStorageAdapter } from './adapters/IndexedDbAdapter';
import { LocalStorageAdapter } from './adapters/LocalStorageAdapter';
import { MemoryStorageAdapter } from './adapters/MemoryAdapter';
import { SaveRepository } from './SaveRepository';
import type { StorageAdapter, StorageKind } from './types';

export * from './types';
export { SaveRepository } from './SaveRepository';
export { worldToSave, defaultLabel, assertSaveGame } from './serialize';
export { migrateSave } from './migrations';
export { IndexedDbStorageAdapter } from './adapters/IndexedDbAdapter';
export { LocalStorageAdapter } from './adapters/LocalStorageAdapter';
export { MemoryStorageAdapter } from './adapters/MemoryAdapter';

export type { StorageKind };

/** Pick a backend. `auto` prefers IndexedDB, then LocalStorage, then memory. */
export function createStorageAdapter(kind: StorageKind = 'auto'): StorageAdapter {
  switch (kind) {
    case 'indexeddb':
      return new IndexedDbStorageAdapter();
    case 'localstorage':
      return new LocalStorageAdapter();
    case 'memory':
      return new MemoryStorageAdapter();
    case 'auto':
    default:
      if (typeof indexedDB !== 'undefined') return new IndexedDbStorageAdapter();
      if (typeof localStorage !== 'undefined') return new LocalStorageAdapter();
      return new MemoryStorageAdapter();
  }
}

export function createSaveRepository(kind: StorageKind = 'auto'): SaveRepository {
  return new SaveRepository(createStorageAdapter(kind));
}
