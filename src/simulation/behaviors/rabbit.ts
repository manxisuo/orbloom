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
import { forageAt } from '../ecology/growth';

const WALK_SPEED = 0.35;
const DECISION_INTERVAL = 0.2;
const tmpA = v3();
const tmpB = v3();
const tmpC = v3();

export function updateRabbit(
  rabbit: AnimalState,
  plants: PlantState[],
  light: number,
  dt: number,
  decisionClock: number,
): void {
  rabbit.hopPhase += dt * 8;
  rabbit.hunger = Math.min(1, rabbit.hunger + dt * 0.04);

  const band = lightBand(light);

  // Never hard-freeze. Night = slow idle; day = normal activity.
  // (Sleep state kept for UI/compat but does not stop movement.)
  if (band === 'night' && rabbit.hunger < 0.75) {
    if (rabbit.state !== 'eat') rabbit.state = 'sleep';
  } else if (rabbit.state === 'sleep') {
    rabbit.state = 'wander';
    rabbit.targetPlantId = null;
  }

  if (decisionClock <= 0 && rabbit.state !== 'eat') {
    decide(rabbit, plants, band);
  }

  // Movement always runs — including "sleep" (slow shuffle)
  const nightMul = band === 'night' ? 0.25 : band === 'dusk' ? 0.7 : 1;

  switch (rabbit.state) {
    case 'sleep':
    case 'wander':
      wanderMove(rabbit, dt * nightMul);
      break;
    case 'seekFood': {
      const target = findPlant(plants, rabbit.targetPlantId);
      if (!target) {
        rabbit.state = 'wander';
        rabbit.targetPlantId = null;
      } else {
        moveToward(rabbit, target.position.normal, dt * nightMul, WALK_SPEED * 1.15);
        if (angDist(rabbit.position.normal, target.position.normal) < 0.06) {
          rabbit.state = 'eat';
          rabbit.stateTimer = 1.2;
        }
      }
      break;
    }
    case 'eat': {
      const target = findPlant(plants, rabbit.targetPlantId);
      if (target && target.growth > 0.05) {
        const bite = Math.min(target.growth, dt * 0.25);
        target.growth = Math.max(0, target.growth - bite);
        rabbit.hunger = Math.max(0, rabbit.hunger - dt * 0.35);
      }
      rabbit.stateTimer -= dt;
      if (rabbit.stateTimer <= 0 || rabbit.hunger < 0.25) {
        rabbit.state = 'wander';
        rabbit.targetPlantId = null;
      }
      break;
    }
  }
}

function decide(rabbit: AnimalState, plants: PlantState[], band: 'day' | 'dusk' | 'night'): void {
  if (rabbit.state === 'eat') return;

  if (rabbit.hunger > 0.4) {
    const food = forageAt(plants, rabbit.position.normal, 1.4);
    if (food) {
      rabbit.state = 'seekFood';
      rabbit.targetPlantId = food.id;
      return;
    }
  }

  if (rabbit.state !== 'wander' && rabbit.state !== 'sleep') {
    rabbit.state = 'wander';
    rabbit.targetPlantId = null;
  }
}

function wanderMove(rabbit: AnimalState, dt: number): void {
  if (dt <= 0) return;
  if (Math.random() < dt * 1.2) {
    randomTangent(rabbit.facing, rabbit.position.normal);
  }
  moveAlongFacing(rabbit, dt, WALK_SPEED * 0.55);
}

function moveToward(rabbit: AnimalState, target: Vec3Like, dt: number, speed: number): void {
  // Desired direction = target projected on tangent plane
  copyV3(tmpA, target);
  projectOnPlane(tmpA, tmpA, rabbit.position.normal);
  if (Math.hypot(tmpA.x, tmpA.y, tmpA.z) < 1e-5) {
    moveAlongFacing(rabbit, dt, speed);
    return;
  }
  normalize(tmpA, tmpA);
  // Smoothly steer facing
  rabbit.facing.x += (tmpA.x - rabbit.facing.x) * Math.min(1, dt * 6);
  rabbit.facing.y += (tmpA.y - rabbit.facing.y) * Math.min(1, dt * 6);
  rabbit.facing.z += (tmpA.z - rabbit.facing.z) * Math.min(1, dt * 6);
  normalize(rabbit.facing, rabbit.facing);
  moveAlongFacing(rabbit, dt, speed);
}

function moveAlongFacing(rabbit: AnimalState, dt: number, speed: number): void {
  const n = rabbit.position.normal;
  if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.z) || Math.hypot(n.x, n.y, n.z) < 1e-6) {
    randomTangent(rabbit.facing, v3(0, 1, 0));
    normalize(n, v3(0.3, 0.7, 0.2));
  }
  if (!Number.isFinite(rabbit.facing.x) || !Number.isFinite(rabbit.facing.y) || !Number.isFinite(rabbit.facing.z)) {
    randomTangent(rabbit.facing, n);
  }
  const dir = projectOnPlane(tmpB, rabbit.facing, n);
  if (Math.hypot(dir.x, dir.y, dir.z) < 1e-5) {
    randomTangent(rabbit.facing, n);
    projectOnPlane(dir, rabbit.facing, n);
  }
  normalize(dir, dir);
  copyV3(rabbit.facing, dir);

  // Step on sphere then renormalize
  addScaled(tmpC, n, dir, speed * dt);
  normalize(rabbit.position.normal, tmpC);
  // Re-project facing onto new tangent
  projectOnPlane(rabbit.facing, rabbit.facing, rabbit.position.normal);
  if (Math.hypot(rabbit.facing.x, rabbit.facing.y, rabbit.facing.z) < 1e-5) {
    randomTangent(rabbit.facing, rabbit.position.normal);
  } else {
    normalize(rabbit.facing, rabbit.facing);
  }
}

function randomTangent(out: Vec3Like, normal: Vec3Like): void {
  // Any unit vector perpendicular-ish, then project
  const ref = Math.abs(normal.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
  cross(out, normal, ref);
  projectOnPlane(out, out, normal);
  if (Math.hypot(out.x, out.y, out.z) < 1e-5) {
    cross(out, normal, v3(0, 0, 1));
    projectOnPlane(out, out, normal);
  }
  normalize(out, out);
  // Random flip
  if (Math.random() < 0.5) {
    out.x *= -1;
    out.y *= -1;
    out.z *= -1;
  }
}

function findPlant(plants: PlantState[], id: string | null): PlantState | null {
  if (!id) return null;
  return plants.find((p) => p.id === id) ?? null;
}

function angDist(a: Vec3Like, b: Vec3Like): number {
  const d = Math.min(1, Math.max(-1, dot(a, b)));
  return Math.acos(d);
}

export const RABBIT_DECISION_INTERVAL = DECISION_INTERVAL;
