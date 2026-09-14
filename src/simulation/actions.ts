import type { GameWorldState, PlantSpecies, PlantState, Vec3Like } from '../shared/types';
import { cloneV3, copyV3, mulberry32, nextId, normalize, v3 } from '../shared/math';
import { terrainHeightAt } from '../shared/terrain';
import { ang, randomTangentSafe } from './helpers';
import { makeFox, makeRabbit } from './systems/lifecycle';
import { pushLog } from './log';
import { refreshStats } from './stats';
import { rainLakes } from './ecology/water';

export type PlantFailReason = 'stardust' | 'cap' | 'dense' | 'water';

/** Rain is a limited player action: it costs stardust and has a cooldown. */
export const RAIN_COST = 6;
/** Game-seconds the rain action is unavailable after a successful use. */
export const RAIN_COOLDOWN = 12;

export type RainFailReason = 'stardust' | 'cooldown';
export type RainResult = { ok: true } | { ok: false; reason: RainFailReason };

export function makePlant(species: PlantSpecies, normal: Vec3Like, growth: number): PlantState {
  const n = normalize(v3(), normal);
  return {
    id: nextId('plant'),
    species,
    position: { normal: n, altitude: terrainHeightAt(n.x, n.y, n.z) },
    age: 0,
    health: 1,
    water: 0.4,
    growth,
  };
}

export function makePlantForEvent(species: PlantSpecies, normal: Vec3Like, growth = 0.2): PlantState {
  return makePlant(species, normal, growth);
}

export function plantTreeAt(
  world: GameWorldState,
  localNormal: Vec3Like,
  species: PlantSpecies = 'tree',
): { ok: true } | { ok: false; reason: PlantFailReason } {
  const cost = species === 'tree' ? 5 : species === 'grass' ? 2 : species === 'mushroom' ? 4 : 3;
  if (world.resources.stardust < cost) return { ok: false, reason: 'stardust' };
  if (world.plants.length > 400) return { ok: false, reason: 'cap' };

  // Trees need more space; grass can pack tighter
  const minAng = species === 'tree' ? 0.1 : species === 'mushroom' ? 0.07 : 0.05;
  for (const p of world.plants) {
    if (ang(p.position.normal, localNormal) < minAng) return { ok: false, reason: 'dense' };
  }

  world.resources.stardust -= cost;
  const plant = makePlant(species, cloneV3(localNormal), 0.05);
  world.plants.push(plant);
  pushLog(
    world,
    `种下了${species === 'tree' ? '一棵树' : species === 'grass' ? '一丛草' : species === 'mushroom' ? '一朵发光蘑菇' : '一朵花'}。`,
    'plant',
  );
  refreshStats(world);
  return { ok: true };
}

export function spawnRabbitAt(world: GameWorldState, localNormal: Vec3Like): boolean {
  const cost = 8;
  if (world.resources.stardust < cost) return false;
  if (world.animals.length > 40) return false;
  world.resources.stardust -= cost;
  const rabbit = makeRabbit(mulberry32(Math.floor(world.time.gameTime * 1000) + world.animals.length));
  copyV3(rabbit.position.normal, normalize(v3(), localNormal));
  randomTangentSafe(rabbit.facing, rabbit.position.normal);
  world.animals.push(rabbit);
  pushLog(world, '一只兔子来到了星球。', 'animal');
  refreshStats(world);
  return true;
}

export function spawnFoxAt(world: GameWorldState, localNormal: Vec3Like): boolean {
  const cost = 10;
  if (world.resources.stardust < cost) return false;
  if (world.animals.filter((a) => a.species === 'fox').length >= 4) return false;
  world.resources.stardust -= cost;
  const fox = makeFox(mulberry32(Math.floor(world.time.gameTime * 1000) + 17));
  copyV3(fox.position.normal, normalize(v3(), localNormal));
  randomTangentSafe(fox.facing, fox.position.normal);
  world.animals.push(fox);
  pushLog(world, '一只狐狸来到了星球。', 'animal');
  refreshStats(world);
  return true;
}

export function rain(world: GameWorldState): RainResult {
  if (world.rainCooldown > 0) return { ok: false, reason: 'cooldown' };
  if (world.resources.stardust < RAIN_COST) return { ok: false, reason: 'stardust' };
  world.resources.stardust -= RAIN_COST;
  rainLakes(world.planet.lakes, 0.18);
  world.rainCooldown = RAIN_COOLDOWN;
  pushLog(world, '一场小雨落下，湖泊丰盈了一些。', 'weather');
  refreshStats(world);
  return { ok: true };
}
