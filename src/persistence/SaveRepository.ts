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

export type InspectLatestResult =
  | { status: 'none' }
  | { status: 'ok'; save: LoadedSave }
  | { status: 'corrupt'; error: string };

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
    const inspected = await this.inspectLatest();
    return inspected.status === 'ok' ? inspected.save : null;
  }

  /**
   * Distinguish "no save" from "save exists but cannot be read".
   * A corrupt autosave must not be treated as a fresh planet.
   */
  async inspectLatest(): Promise<InspectLatestResult> {
    const keys = await this.storage.keys(this.prefix);
    if (keys.length === 0) return { status: 'none' };

    const metas = await this.listSaves();
    if (metas.length > 0) {
      try {
        const save = await this.loadSave(metas[0].id);
        if (save) return { status: 'ok', save };
      } catch (err) {
        return {
          status: 'corrupt',
          error: err instanceof Error ? err.message : '存档无法读取',
        };
      }
    }

    // Keys exist but every entry failed migrate/parse in listSaves.
    return { status: 'corrupt', error: '存档数据损坏，无法继续值日' };
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

    for (const a of world.animals) {
      const n = a.position?.normal;
      if (!n || !Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.z)) {
        a.position = { normal: { x: 0.2, y: 0.5, z: 0.84 }, altitude: 0 };
      } else {
        const len = Math.hypot(n.x, n.y, n.z) || 1;
        n.x /= len;
        n.y /= len;
        n.z /= len;
      }
      const f = a.facing;
      if (!f || !Number.isFinite(f.x) || !Number.isFinite(f.y) || !Number.isFinite(f.z)) {
        a.facing = { x: 1, y: 0, z: 0 };
      }
      const okStates = new Set([
        'wander', 'seekFood', 'eat', 'sleep', 'seekFlower', 'pollinate', 'flee', 'hunt',
      ]);
      if (!okStates.has(a.state)) a.state = 'wander';
      if (!Number.isFinite(a.hunger)) a.hunger = 0.4;
      if (!Number.isFinite(a.health)) a.health = 1;
      if (!Number.isFinite(a.hopPhase)) a.hopPhase = 0;
      if (!Number.isFinite(a.age)) a.age = 1;
      if (!Number.isFinite(a.breedCooldown)) a.breedCooldown = 0;
    }

    if (!Array.isArray(world.delayedEvents)) world.delayedEvents = [];
    if (!world.personality) world.personality = 'wild';
    if (typeof world.rngState !== 'number') world.rngState = (world.seed ?? 42) >>> 0;
    if (typeof world.rainCooldown !== 'number') world.rainCooldown = 0;
    if (world.wish === undefined) world.wish = null;
    if (typeof world.nextWishIn !== 'number') world.nextWishIn = 15;
    if (typeof world.wishesCompleted !== 'number') world.wishesCompleted = 0;
    if (typeof world.wishesFailed !== 'number') world.wishesFailed = 0;
    if (!world.modifiers) world.modifiers = { droughtDays: 0, coldDays: 0, machineScore: 0 };
    if (typeof world.modifiers.machineScore !== 'number') world.modifiers.machineScore = 0;
    for (const e of world.log) {
      if (!e.kind) e.kind = 'life';
    }

    return { meta: save.meta, world };
  }
}
