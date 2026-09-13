import type { GameWorldState } from '../shared/types';

/** Current on-disk schema. Bump when SaveGame shape changes. */
export const SCHEMA_VERSION = 2;

export interface SaveMeta {
  id: string;
  label: string;
  savedAt: number;
  day: number;
  plantCount: number;
  animalCount: number;
  stardust: number;
  seed: number;
  schemaVersion: number;
}

export interface SaveGame {
  schemaVersion: number;
  savedAt: number;
  seed: number;
  /** Next entity id counter to avoid collisions after load. */
  entityIdCounter: number;
  meta: SaveMeta;
  world: GameWorldState;
}

export type StorageKind = 'indexeddb' | 'localstorage' | 'memory' | 'auto';

/**
 * Pluggable key-value storage. Game code only talks to this interface,
 * so IndexedDB / LocalStorage / future backends stay swappable.
 */
export interface StorageAdapter {
  readonly name: string;
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
  /** Optional bulk clear for tests / reset. */
  clear?(): Promise<void>;
}
