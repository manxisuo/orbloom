import type { PlantState, Vec3Like } from '../../shared/types';
import { lightBand } from '../climate/light';
import { plantWaterFactor } from './water';

export interface GrowthDeps {
  light: number;
  soilWater: number;
  dtDays: number;
  /** 0..1 canopy shade from nearby trees */
  shade?: number;
  /** Bee pollination boost this tick */
  pollination?: number;
}

/**
 * Update plant age/health/growth from local light and water.
 * Long exposure (hot day or long night) slowly stresses plants.
 */
export function updatePlant(plant: PlantState, deps: GrowthDeps): void {
  const { light, soilWater, dtDays } = deps;
  const shade = deps.shade ?? 0;
  const pollination = deps.pollination ?? 0;
  const band = lightBand(light);
  const water = plantWaterFactor(plant, soilWater);
  plant.water = water;

  plant.age += dtDays;

  const idealWater = plant.species === 'tree' ? 0.35 : 0.25;
  const waterStress = Math.abs(water - idealWater);
  // Shade softens drought stress under strong sun
  const droughtMul = 1 - shade * 0.55;
  // Effective light for growth is reduced by canopy (grass under trees grows slower)
  const effLight = light * (plant.species === 'tree' ? 1 : 1 - shade * 0.35);

  if (plant.species === 'mushroom') {
    // Fungi thrive in darkness and moisture; sun withers them
    if (band === 'night') {
      const push = (0.2 + water * 0.7 + shade * 0.25) * dtDays * 0.7;
      plant.growth = Math.min(1, plant.growth + push);
      plant.health = Math.min(1, plant.health + (water > 0.15 ? 0.12 : -0.05) * dtDays);
    } else if (band === 'dusk') {
      plant.growth = Math.min(1, plant.growth + 0.05 * water * dtDays);
    } else {
      plant.growth = Math.max(0, plant.growth - 0.12 * light * dtDays);
      plant.health = Math.max(0, plant.health - 0.18 * light * dtDays);
    }
    plant.health = Math.min(1, Math.max(0, plant.health));
    return;
  }

  if (band === 'day') {
    const growthPush = effLight * (0.35 + water * 0.65) - waterStress * 0.4 * droughtMul;
    plant.growth = Math.min(1, Math.max(0, plant.growth + growthPush * dtDays * 0.55));
    plant.health = Math.min(1, plant.health + (water > 0.2 ? 0.08 : -0.12 * droughtMul) * dtDays);
  } else if (band === 'dusk') {
    plant.growth = Math.min(1, plant.growth + 0.04 * water * dtDays);
    plant.health = Math.min(1, plant.health + 0.02 * dtDays);
  } else {
    plant.growth = Math.max(0, plant.growth - 0.01 * (1 - water) * dtDays);
    plant.health = Math.min(1, plant.health - 0.02 * (1 - water) * dtDays);
  }

  if (light > 0.55 && water < 0.12) {
    plant.health = Math.max(0, plant.health - 0.25 * droughtMul * dtDays);
    plant.growth = Math.max(0, plant.growth - 0.08 * droughtMul * dtDays);
  }

  // Bees help flowers and nearby plants thrive
  if (pollination > 0) {
    const boost = pollination * dtDays * (plant.species === 'flower' ? 0.55 : 0.18);
    plant.growth = Math.min(1, plant.growth + boost);
    plant.health = Math.min(1, plant.health + pollination * dtDays * 0.12);
  }

  plant.health = Math.min(1, Math.max(0, plant.health));
}

/** Nearby grass-like forage amount for animals. */
export function forageAt(plants: PlantState[], target: Vec3Like, radiusRad: number): PlantState | null {
  let best: PlantState | null = null;
  let bestDist = radiusRad;
  for (const p of plants) {
    if (p.species === 'tree' || p.species === 'mushroom') continue;
    if (p.growth < 0.15 || p.health < 0.2) continue;
    const d = angDist(p.position.normal, target);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

function angDist(a: Vec3Like, b: Vec3Like): number {
  const d = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
  return Math.acos(d);
}
