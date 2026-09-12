import type { LakeCenter, PlantState, Vec3Like } from '../../shared/types';
import { angularDistance } from '../../shared/math';

/** 0..1 soil moisture near a surface normal, given lakes. */
export function waterAt(localNormal: Vec3Like, lakes: LakeCenter[]): number {
  if (lakes.length === 0) return 0.15;
  let best = 0;
  for (const lake of lakes) {
    const ang = angularDistance(localNormal, lake.normal);
    const reach = lake.radius * 3.2;
    if (ang > reach) continue;
    const proximity = 1 - ang / reach;
    const fromLake = proximity * proximity * lake.water;
    best = Math.max(best, fromLake);
  }
  // Ambient humidity floor
  return Math.min(1, Math.max(0.08, best));
}

export function evaporateLakes(lakes: LakeCenter[], light: (n: Vec3Like) => number, dtDays: number): void {
  for (const lake of lakes) {
    const sun = light(lake.normal);
    // Trees nearby shade the lake — approximate with a small base rate.
    const rate = 0.012 + sun * 0.08;
    lake.water = Math.max(0, lake.water - rate * dtDays);
  }
}

export function rainLakes(lakes: LakeCenter[], amount = 0.12): void {
  for (const lake of lakes) {
    lake.water = Math.min(1, lake.water + amount);
  }
}

export function plantWaterFactor(plant: PlantState, soilWater: number): number {
  // Trees like moderate moisture; grass more forgiving.
  if (plant.species === 'grass') return soilWater;
  if (plant.species === 'flower') return Math.min(1, soilWater * 1.1);
  return Math.min(1, soilWater * 0.9 + 0.05);
}
