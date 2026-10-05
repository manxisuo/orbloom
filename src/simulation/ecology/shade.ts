import type { PlantState, Vec3Like } from '../../shared/types';
import { angularDistance } from '../../shared/math';

/**
 * 0..1 canopy shade at a surface point.
 * Mature trees (growth > 0.35) cast a soft shadow disk.
 *
 * Queries go through a coarse lon/lat grid so a plant tick is not O(plants × trees).
 */

const CELL = 0.4;
const LON_CELLS = Math.ceil((Math.PI * 2) / CELL);

export interface ShadeIndex {
  cells: Map<string, PlantState[]>;
}

function cellCoord(n: Vec3Like): { i: number; j: number } {
  const lon = Math.atan2(n.z, n.x);
  const lat = Math.asin(Math.max(-1, Math.min(1, n.y)));
  return {
    i: Math.floor((lon + Math.PI) / CELL),
    j: Math.floor((lat + Math.PI / 2) / CELL),
  };
}

function cellKey(i: number, j: number): string {
  return `${i},${j}`;
}

export function buildTreeShadeIndex(plants: PlantState[]): ShadeIndex {
  const cells = new Map<string, PlantState[]>();
  for (const p of plants) {
    if (p.species !== 'tree') continue;
    if (p.growth < 0.35 || p.health < 0.25) continue;
    const { i, j } = cellCoord(p.position.normal);
    const key = cellKey(i, j);
    const bucket = cells.get(key);
    if (bucket) bucket.push(p);
    else cells.set(key, [p]);
  }
  return { cells };
}

let cachedPlants: PlantState[] | null = null;
let cachedLen = -1;
let cachedIndex: ShadeIndex | null = null;

function indexFor(plants: PlantState[]): ShadeIndex {
  if (cachedIndex && cachedPlants === plants && cachedLen === plants.length) return cachedIndex;
  cachedPlants = plants;
  cachedLen = plants.length;
  cachedIndex = buildTreeShadeIndex(plants);
  return cachedIndex;
}

export function treeShadeAt(
  plants: PlantState[] | ShadeIndex,
  target: Vec3Like,
  radius = 0.42,
): number {
  const index = Array.isArray(plants) ? indexFor(plants) : plants;
  const { i: ci, j: cj } = cellCoord(target);
  const reach = Math.ceil(radius / CELL) + 1;
  let shade = 0;
  for (let di = -reach; di <= reach; di++) {
    for (let dj = -reach; dj <= reach; dj++) {
      const ii = ((ci + di) % LON_CELLS + LON_CELLS) % LON_CELLS;
      const bucket = index.cells.get(cellKey(ii, cj + dj));
      if (!bucket) continue;
      for (const p of bucket) {
        const ang = angularDistance(p.position.normal, target);
        if (ang > radius) continue;
        const t = 1 - ang / radius;
        shade = Math.max(shade, t * t * (0.45 + p.growth * 0.55));
      }
    }
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
