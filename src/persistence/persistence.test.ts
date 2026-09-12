import { describe, expect, it } from 'vitest';
import { MemoryStorageAdapter } from './adapters/MemoryAdapter';
import { LocalStorageAdapter } from './adapters/LocalStorageAdapter';
import { SaveRepository } from './SaveRepository';
import { createWorld } from '../simulation/WorldSimulation';
import { migrateSave } from './migrations';
import { worldToSave } from './serialize';
import { SCHEMA_VERSION } from './types';

function memoryRepo() {
  return new SaveRepository(new MemoryStorageAdapter());
}

describe('SaveRepository (memory adapter)', () => {
  it('saves and loads a world round-trip', async () => {
    const repo = memoryRepo();
    const world = createWorld(7);
    world.resources.stardust = 12;
    world.time.gameTime = 99;

    const meta = await repo.saveWorld(world, 'autosave');
    expect(meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(meta.stardust).toBe(12);

    const loaded = await repo.loadSave('autosave');
    expect(loaded).not.toBeNull();
    expect(loaded!.world.resources.stardust).toBe(12);
    expect(loaded!.world.time.gameTime).toBe(99);
    expect(loaded!.world.plants.length).toBe(world.plants.length);
    expect(loaded!.world.animals.length).toBe(world.animals.length);
    expect(loaded!.world.seed).toBe(7);
  });

  it('lists saves by recency and deletes', async () => {
    const repo = memoryRepo();
    const a = createWorld(1);
    const b = createWorld(2);
    await repo.saveWorld(a, 'slot-a');
    await new Promise((r) => setTimeout(r, 5));
    await repo.saveWorld(b, 'slot-b');

    const metas = await repo.listSaves();
    expect(metas.map((m) => m.id)).toEqual(['slot-b', 'slot-a']);

    const latest = await repo.loadLatest();
    expect(latest!.meta.id).toBe('slot-b');

    await repo.deleteSave('slot-b');
    expect(await repo.hasSave('slot-b')).toBe(false);
    const after = await repo.listSaves();
    expect(after.map((m) => m.id)).toEqual(['slot-a']);
  });

  it('rejects newer schema versions', async () => {
    const repo = memoryRepo();
    const world = createWorld(3);
    const save = worldToSave(world);
    const future = { ...save, schemaVersion: SCHEMA_VERSION + 10 };
    // bypass saveWorld and write raw
    await (repo as unknown as { storage: MemoryStorageAdapter }).storage.set(
      'orbloom:save:future',
      future,
    );
    await expect(repo.loadSave('future')).rejects.toThrow(/newer/i);
  });
});

describe('LocalStorageAdapter', () => {
  it('round-trips JSON values', async () => {
    const mem = new Map<string, string>();
    const fakeStorage = {
      get length() {
        return mem.size;
      },
      key: (i: number) => [...mem.keys()][i] ?? null,
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
      clear: () => mem.clear(),
    } as unknown as Storage;

    const adapter = new LocalStorageAdapter(fakeStorage);
    const repo = new SaveRepository(adapter, 'orbloom:save:');
    const world = createWorld(11);
    await repo.saveWorld(world, 'autosave');
    const loaded = await repo.loadSave('autosave');
    expect(loaded!.world.seed).toBe(11);
  });
});

describe('migrateSave', () => {
  it('throws on non-object', () => {
    expect(() => migrateSave(null)).toThrow();
    expect(() => migrateSave('nope')).toThrow();
  });
});
