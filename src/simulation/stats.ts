import type { AnimalState, EcoStats, GameWorldState, PlantState } from '../shared/types';
import { orientedLight, solarPhase } from './climate/light';
import { DAY_LENGTH } from './tuning';

export function computeStats(
  plants: PlantState[],
  animals: AnimalState[],
  lakes: { water: number }[],
  gameTime: number,
  dayLength = DAY_LENGTH,
  orientation?: { rotationX: number; rotationY: number },
): EcoStats {
  let waterSum = 0;
  let healthSum = 0;
  // Average "local water" proxy from plant water values + lakes
  for (const p of plants) {
    waterSum += p.water;
    healthSum += p.health;
  }
  const plantCount = plants.length;
  const animalCount = animals.length;
  const avgWater = plantCount ? waterSum / plantCount : lakes.reduce((s, l) => s + l.water, 0) / Math.max(1, lakes.length);
  const avgHealth = plantCount ? healthSum / plantCount : 0.5;
  const avgLake = lakes.reduce((s, l) => s + l.water, 0) / Math.max(1, lakes.length);

  // Calendar day still follows game time; dayFraction is the Y-spin phase
  // so UI / chimes can share the same orientation plants use for sun.
  const dayFraction = orientation
    ? solarPhase(orientation.rotationY)
    : (gameTime % dayLength) / dayLength;
  const day = Math.floor(gameTime / dayLength) + 1;
  let lightSum = 0;
  if (orientation) {
    for (const p of plants) {
      lightSum += orientedLight(p.position.normal, orientation.rotationX, orientation.rotationY);
    }
  }
  const sunlight = plantCount && orientation ? lightSum / plantCount : 0.5;
  // Heuristic stability: balanced life, not empty, not overcrowded, decent water
  const plantScore = Math.min(1, plantCount / 40);
  const animalScore = animalCount === 0 ? 0.4 : animalCount <= 12 ? 0.7 + animalCount * 0.02 : 0.5;
  const stability = Math.max(
    0,
    Math.min(1, plantScore * 0.35 + avgHealth * 0.25 + avgWater * 0.2 + avgLake * 0.2 + animalScore * 0.05),
  );

  return {
    averageWater: avgWater,
    averageHealth: avgHealth,
    plantCount,
    animalCount,
    stability,
    dayFraction,
    day,
    sunlight,
  };
}

export function refreshStats(world: GameWorldState): void {
  world.stats = computeStats(
    world.plants,
    world.animals,
    world.planet.lakes,
    world.time.gameTime,
    world.time.dayLength,
    { rotationX: world.planet.rotationX, rotationY: world.planet.rotationY },
  );
}
