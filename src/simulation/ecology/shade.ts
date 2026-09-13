import type { PlantState, Vec3Like } from '../../shared/types';
import { angularDistance } from '../../shared/math';

/**
 * 0..1 canopy shade at a surface point.
 * Mature trees (growth > 0.35) cast a soft shadow disk.
 */
export function treeShadeAt(plants: PlantState[], target: Vec3Like, radius = 0.42): number {
  let shade = 0;
  for (const p of plants) {
    if (p.species !== 'tree') continue;
    if (p.growth < 0.35 || p.health < 0.25) continue;
    const ang = angularDistance(p.position.normal, target);
    if (ang > radius) continue;
    const t = 1 - ang / radius;
    // Fuller canopies shade more
    shade = Math.max(shade, t * t * (0.45 + p.growth * 0.55));
  }
  return Math.min(1, shade);
}

/** Nearby flowers that are worth pollinating. */
export function forageFlowerAt(plants: PlantState[], target: Vec3Like, radiusRad: number): PlantState | null {
  let best: PlantState | null = null;
  let bestDist = radiusRad;
  for (const p of plants) {
    if (p.species !== 'flower') continue;
    if (p.growth < 0.25 || p.health < 0.3) continue;
    const d = angularDistance(p.position.normal, target);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}
