import type { AnimalState, Vec3Like } from '../../shared/types';
import {
  addScaled,
  copyV3,
  cross,
  dot,
  normalize,
  projectOnPlane,
  v3,
} from '../../shared/math';

const HUNT_SPEED = 0.55;
const tmpA = v3();
const tmpB = v3();
const tmpC = v3();

export interface FoxHuntResult {
  caught: string | null;
}

/**
 * Fox AI: wander → hunt nearest rabbit → catch when close.
 * Hunger drains over time; eating a rabbit refills it.
 */
export function updateFox(
  fox: AnimalState,
  rabbits: AnimalState[],
  dt: number,
  doDecision: boolean,
): FoxHuntResult {
  fox.hopPhase += dt * 7;
  fox.hunger = Math.min(1, fox.hunger + dt * 0.03);

  let caught: string | null = null;

  if (doDecision) {
    if (fox.state !== 'hunt' || !findRabbit(rabbits, fox.targetPlantId)) {
      if (fox.hunger > 0.35) {
        const prey = nearestRabbit(fox, rabbits, 2.2);
        if (prey) {
          fox.state = 'hunt';
          fox.targetPlantId = prey.id;
        } else if (fox.state === 'hunt') {
          fox.state = 'wander';
          fox.targetPlantId = null;
        }
      } else if (fox.state === 'hunt') {
        fox.state = 'wander';
        fox.targetPlantId = null;
      }
    }
  }

  switch (fox.state) {
    case 'hunt': {
      const prey = findRabbit(rabbits, fox.targetPlantId);
      if (!prey) {
        fox.state = 'wander';
        fox.targetPlantId = null;
        break;
      }
      moveToward(fox, prey.position.normal, dt, HUNT_SPEED);
      if (angDist(fox.position.normal, prey.position.normal) < 0.05) {
        caught = prey.id;
        fox.hunger = Math.max(0, fox.hunger - 0.55);
        fox.state = 'wander';
        fox.targetPlantId = null;
      }
      break;
    }
    default:
      if (Math.random() < dt * 0.9) randomTangent(fox.facing, fox.position.normal);
      moveAlongFacing(fox, dt, HUNT_SPEED * 0.35);
      break;
  }

  return { caught };
}

/** Rabbit flees from nearby fox. Returns true if fleeing this frame. */
export function rabbitFleeFromFox(
  rabbit: AnimalState,
  foxes: AnimalState[],
  dt: number,
): boolean {
  const threat = nearestFox(rabbit, foxes, 0.55);
  if (!threat) return false;
  // Run away along surface, opposite the fox
  copyV3(tmpA, rabbit.position.normal);
  // direction away = project (rabbit - fox) on tangent
  tmpA.x = rabbit.position.normal.x - threat.position.normal.x;
  tmpA.y = rabbit.position.normal.y - threat.position.normal.y;
  tmpA.z = rabbit.position.normal.z - threat.position.normal.z;
  projectOnPlane(tmpA, tmpA, rabbit.position.normal);
  if (Math.hypot(tmpA.x, tmpA.y, tmpA.z) > 1e-5) {
    normalize(tmpA, tmpA);
    copyV3(rabbit.facing, tmpA);
    moveAlongFacing(rabbit, dt, 0.48);
  } else {
    moveAlongFacing(rabbit, dt, 0.48);
  }
  rabbit.state = 'flee';
  return true;
}

function nearestRabbit(fox: AnimalState, rabbits: AnimalState[], maxAng: number): AnimalState | null {
  let best: AnimalState | null = null;
  let bestD = maxAng;
  for (const r of rabbits) {
    if (r.health <= 0.05) continue;
    const d = angDist(fox.position.normal, r.position.normal);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

function nearestFox(rabbit: AnimalState, foxes: AnimalState[], maxAng: number): AnimalState | null {
  let best: AnimalState | null = null;
  let bestD = maxAng;
  for (const f of foxes) {
    const d = angDist(rabbit.position.normal, f.position.normal);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

function findRabbit(rabbits: AnimalState[], id: string | null): AnimalState | null {
  if (!id) return null;
  return rabbits.find((r) => r.id === id) ?? null;
}

function moveToward(animal: AnimalState, target: Vec3Like, dt: number, speed: number): void {
  copyV3(tmpA, target);
  projectOnPlane(tmpA, tmpA, animal.position.normal);
  if (Math.hypot(tmpA.x, tmpA.y, tmpA.z) < 1e-5) {
    moveAlongFacing(animal, dt, speed);
    return;
  }
  normalize(tmpA, tmpA);
  animal.facing.x += (tmpA.x - animal.facing.x) * Math.min(1, dt * 7);
  animal.facing.y += (tmpA.y - animal.facing.y) * Math.min(1, dt * 7);
  animal.facing.z += (tmpA.z - animal.facing.z) * Math.min(1, dt * 7);
  normalize(animal.facing, animal.facing);
  moveAlongFacing(animal, dt, speed);
}

function moveAlongFacing(animal: AnimalState, dt: number, speed: number): void {
  const n = animal.position.normal;
  if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.z) || Math.hypot(n.x, n.y, n.z) < 1e-6) {
    normalize(n, v3(0.2, 0.5, 0.84));
  }
  if (!Number.isFinite(animal.facing.x) || !Number.isFinite(animal.facing.y) || !Number.isFinite(animal.facing.z)) {
    randomTangent(animal.facing, n);
  }
  const dir = projectOnPlane(tmpB, animal.facing, n);
  if (Math.hypot(dir.x, dir.y, dir.z) < 1e-5) {
    randomTangent(animal.facing, n);
    projectOnPlane(dir, animal.facing, n);
  }
  normalize(dir, dir);
  copyV3(animal.facing, dir);
  addScaled(tmpC, n, dir, speed * dt);
  normalize(animal.position.normal, tmpC);
  projectOnPlane(animal.facing, animal.facing, animal.position.normal);
  if (Math.hypot(animal.facing.x, animal.facing.y, animal.facing.z) < 1e-5) {
    randomTangent(animal.facing, animal.position.normal);
  } else {
    normalize(animal.facing, animal.facing);
  }
}

function randomTangent(out: Vec3Like, normal: Vec3Like): void {
  const ref = Math.abs(normal.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
  cross(out, normal, ref);
  projectOnPlane(out, out, normal);
  if (Math.hypot(out.x, out.y, out.z) < 1e-5) {
    cross(out, normal, v3(0, 0, 1));
    projectOnPlane(out, out, normal);
  }
  normalize(out, out);
  if (Math.random() < 0.5) {
    out.x *= -1;
    out.y *= -1;
    out.z *= -1;
  }
}

function angDist(a: Vec3Like, b: Vec3Like): number {
  const d = Math.min(1, Math.max(-1, dot(a, b)));
  return Math.acos(d);
}
