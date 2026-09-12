import type { GameWorldState } from '../shared/types';
import { resetIdCounter, syncIdCounterFromIds } from '../shared/math';
import type { SaveGame, SaveMeta, StorageAdapter } from './types';
import { migrateSave } from './migrations';
import { assertSaveGame, worldToSave } from './serialize';

const DEFAULT_PREFIX = 'orbloom:save:';

export interface LoadedSave {
  meta: SaveMeta;
  world: GameWorldState;
}

/**
 * High-level save API. Depends only on StorageAdapter — swap backends freely.
 */
export class SaveRepository {
  private readonly storage: StorageAdapter;
  private readonly prefix: string;

  constructor(storage: StorageAdapter, prefix = DEFAULT_PREFIX) {
    this.storage = storage;
    this.prefix = prefix;
  }

  get backendName(): string {
    return this.storage.name;
  }

  private key(id: string): string {
    return `${this.prefix}${id}`;
  }

  async saveWorld(world: GameWorldState, id = 'autosave', label?: string): Promise<SaveMeta> {
    const save = worldToSave(world, id, label);
    await this.storage.set(this.key(id), save);
    return save.meta;
  }

  async loadSave(id: string): Promise<LoadedSave | null> {
    const raw = await this.storage.get<unknown>(this.key(id));
    if (!raw) return null;
    const save = migrateSave(raw);
    assertSaveGame(save);
    return this.hydrate(save);
  }

  async listSaves(): Promise<SaveMeta[]> {
    const keys = await this.storage.keys(this.prefix);
    const metas: SaveMeta[] = [];
    for (const key of keys) {
      const raw = await this.storage.get<unknown>(key);
      if (!raw) continue;
      try {
        const save = migrateSave(raw);
        metas.push(save.meta);
      } catch {
        // skip unreadable entries
      }
    }
    metas.sort((a, b) => b.savedAt - a.savedAt);
    return metas;
  }

  async deleteSave(id: string): Promise<void> {
    await this.storage.delete(this.key(id));
  }

  async hasSave(id = 'autosave'): Promise<boolean> {
    const raw = await this.storage.get(this.key(id));
    return raw != null;
  }

  async loadLatest(): Promise<LoadedSave | null> {
    const metas = await this.listSaves();
    if (metas.length === 0) return null;
    return this.loadSave(metas[0].id);
  }

  /** Restore id counter and return a detached world copy ready to play. */
  private hydrate(save: SaveGame): LoadedSave {
    const world = structuredClone(save.world);
    const ids = [
      ...world.plants.map((p) => p.id),
      ...world.animals.map((a) => a.id),
      ...world.log.map((l) => l.id),
    ];
    resetIdCounter(Math.max(1, save.entityIdCounter || 1));
    syncIdCounterFromIds(ids);
    return { meta: save.meta, world };
  }
}
