import type { AnimalState, PlantState, Vec3Like } from '../../shared/types';
import {
  addScaled,
  copyV3,
  cross,
  dot,
  normalize,
  projectOnPlane,
  v3,
} from '../../shared/math';
import { lightBand } from '../climate/light';
import { forageFlowerAt } from '../ecology/shade';

const FLY_SPEED = 0.55;
const tmpA = v3();
const tmpB = v3();
const tmpC = v3();

export function updateBee(
  bee: AnimalState,
  plants: PlantState[],
  light: number,
  dt: number,
  doDecision: boolean,
  rng: () => number = Math.random,
): { pollinated: PlantState | null } {
  bee.hopPhase += dt * 14;
  // Bees don't really "eat" plants; hunger is energy
  bee.hunger = Math.min(1, bee.hunger + dt * 0.02);

  const band = lightBand(light);

  if (doDecision) {
    if (band === 'night' && light < 0.02) {
      bee.state = 'sleep';
      bee.targetPlantId = null;
    } else if (bee.state === 'sleep' && band !== 'night') {
      bee.state = 'wander';
    } else if (bee.state !== 'pollinate' && bee.state !== 'seekFlower') {
      const flower = forageFlowerAt(plants, bee.position.normal, 1.8);
      if (flower) {
        bee.state = 'seekFlower';
        bee.targetPlantId = flower.id;
      } else if (bee.state !== 'wander') {
        bee.state = 'wander';
        bee.targetPlantId = null;
      }
    }
  }

  let pollinated: PlantState | null = null;

  switch (bee.state) {
    case 'wander':
      if (rng() < dt * 1.2) randomTangent(bee.facing, bee.position.normal, rng);
      moveAlongFacing(bee, dt, FLY_SPEED * 0.4, rng);
      break;
    case 'seekFlower': {
      const target = findPlant(plants, bee.targetPlantId);
      if (!target || target.species !== 'flower' || target.growth < 0.15) {
        bee.state = 'wander';
        bee.targetPlantId = null;
      } else {
        moveToward(bee, target.position.normal, dt, FLY_SPEED, rng);
        if (angDist(bee.position.normal, target.position.normal) < 0.08) {
          bee.state = 'pollinate';
          bee.stateTimer = 1.4;
        }
      }
      break;
    }
    case 'pollinate': {
      const target = findPlant(plants, bee.targetPlantId);
      if (target && target.species === 'flower') {
        pollinated = target;
        bee.hunger = Math.max(0, bee.hunger - dt * 0.15);
      }
      bee.stateTimer -= dt;
      if (bee.stateTimer <= 0) {
        bee.state = 'wander';
        bee.targetPlantId = null;
      }
      break;
    }
    case 'sleep':
      break;
    default:
      bee.state = 'wander';
  }

  return { pollinated };
}

function findPlant(plants: PlantState[], id: string | null): PlantState | null {
  if (!id) return null;
  return plants.find((p) => p.id === id) ?? null;
}

function moveToward(bee: AnimalState, target: Vec3Like, dt: number, speed: number, rng: () => number): void {
  copyV3(tmpA, target);
  projectOnPlane(tmpA, tmpA, bee.position.normal);
  if (Math.hypot(tmpA.x, tmpA.y, tmpA.z) < 1e-5) {
    moveAlongFacing(bee, dt, speed, rng);
    return;
  }
  normalize(tmpA, tmpA);
  bee.facing.x += (tmpA.x - bee.facing.x) * Math.min(1, dt * 8);
  bee.facing.y += (tmpA.y - bee.facing.y) * Math.min(1, dt * 8);
  bee.facing.z += (tmpA.z - bee.facing.z) * Math.min(1, dt * 8);
  normalize(bee.facing, bee.facing);
  moveAlongFacing(bee, dt, speed, rng);
}

function moveAlongFacing(bee: AnimalState, dt: number, speed: number, rng: () => number): void {
  const n = bee.position.normal;
  const dir = projectOnPlane(tmpB, bee.facing, n);
  if (Math.hypot(dir.x, dir.y, dir.z) < 1e-5) {
    randomTangent(bee.facing, n, rng);
    projectOnPlane(dir, bee.facing, n);
  }
  normalize(dir, dir);
  copyV3(bee.facing, dir);
  addScaled(tmpC, n, dir, speed * dt);
  normalize(bee.position.normal, tmpC);
  projectOnPlane(bee.facing, bee.facing, bee.position.normal);
  if (Math.hypot(bee.facing.x, bee.facing.y, bee.facing.z) < 1e-5) {
    randomTangent(bee.facing, bee.position.normal, rng);
  } else {
    normalize(bee.facing, bee.facing);
  }
}

function randomTangent(out: Vec3Like, normal: Vec3Like, rng: () => number = Math.random): void {
  const ref = Math.abs(normal.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
  cross(out, normal, ref);
  projectOnPlane(out, out, normal);
  if (Math.hypot(out.x, out.y, out.z) < 1e-5) {
    cross(out, normal, v3(0, 0, 1));
    projectOnPlane(out, out, normal);
  }
  normalize(out, out);
  if (rng() < 0.5) {
    out.x *= -1;
    out.y *= -1;
    out.z *= -1;
  }
}

function angDist(a: Vec3Like, b: Vec3Like): number {
  const d = Math.min(1, Math.max(-1, dot(a, b)));
  return Math.acos(d);
}
