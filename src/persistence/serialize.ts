import type { GameWorldState } from '../shared/types';
import { getIdCounter } from '../shared/math';
import { computeStats } from '../simulation/WorldSimulation';
import type { SaveGame, SaveMeta } from './types';
import { SCHEMA_VERSION } from './types';

/**
 * Deep-clone world into a plain JSON-safe SaveGame.
 * GameWorldState is already plain data (no Three.js objects).
 */
export function worldToSave(world: GameWorldState, id = 'autosave', label?: string): SaveGame {
  const structured = structuredClone(world);
  // Recompute stats so UI numbers match entities after load
  structured.stats = computeStats(
    structured.plants,
    structured.animals,
    structured.planet.lakes,
    structured.time.gameTime,
    structured.time.dayLength,
  );

  const meta: SaveMeta = {
    id,
    label: label ?? defaultLabel(structured),
    savedAt: Date.now(),
    day: structured.stats.day,
    plantCount: structured.plants.length,
    animalCount: structured.animals.length,
    stardust: structured.resources.stardust,
    seed: structured.seed,
    schemaVersion: SCHEMA_VERSION,
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    savedAt: meta.savedAt,
    seed: structured.seed,
    entityIdCounter: getIdCounter(),
    meta,
    world: structured,
  };
}

export function defaultLabel(world: GameWorldState): string {
  return `第 ${world.stats.day || 1} 天 · ${world.plants.length} 植物`;
}

/** Structural sanity check after migrate. */
export function assertSaveGame(save: SaveGame): void {
  if (!save.world || !save.world.planet || !Array.isArray(save.world.plants)) {
    throw new Error('Corrupted save: missing world payload');
  }
  if (typeof save.seed !== 'number') {
    throw new Error('Corrupted save: missing seed');
  }
}
