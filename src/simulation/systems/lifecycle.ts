import type { AnimalState, GameWorldState } from '../../shared/types';
import { copyV3, mulberry32, nextId, randomOnSphere, v3 } from '../../shared/math';
import { pushLog } from '../log';
import { ang, jitterNormal, mixNormals, randomTangentSafe } from '../helpers';

export function makeBee(rng: () => number): AnimalState {
  const normal = randomOnSphere(v3(), rng);
  const facing = v3();
  randomTangentSafe(facing, normal);
  return {
    id: nextId('animal'),
    species: 'bee',
    position: { normal, altitude: 0.05 },
    facing,
    health: 1,
    hunger: 0.5,
    state: 'wander',
    stateTimer: 0,
    targetPlantId: null,
    hopPhase: rng() * Math.PI * 2,
    age: 0,
    breedCooldown: 999,
  };
}

export function makeRabbit(rng: () => number, age = 0.8 + rng() * 1.2): AnimalState {
  const normal = randomOnSphere(v3(), rng);
  const facing = v3();
  randomTangentSafe(facing, normal);
  return {
    id: nextId('animal'),
    species: 'rabbit',
    position: { normal, altitude: 0 },
    facing,
    health: 1,
    hunger: 0.4,
    state: 'wander',
    stateTimer: 0,
    targetPlantId: null,
    hopPhase: rng() * Math.PI * 2,
    age,
    breedCooldown: rng() * 2,
  };
}

export function makeFox(rng: () => number): AnimalState {
  const normal = randomOnSphere(v3(), rng);
  const facing = v3();
  randomTangentSafe(facing, normal);
  return {
    id: nextId('animal'),
    species: 'fox',
    position: { normal, altitude: 0 },
    facing,
    health: 1,
    hunger: 0.5,
    state: 'wander',
    stateTimer: 0,
    targetPlantId: null,
    hopPhase: rng() * Math.PI * 2,
    age: 1.5,
    breedCooldown: 999,
  };
}

export function maybeSpawnBees(world: GameWorldState, rng: () => number): void {
  const bees = world.animals.filter((a) => a.species === 'bee');
  if (bees.length >= 6) return;
  const flowers = world.plants.filter((p) => p.species === 'flower' && p.growth >= 0.4 && p.health >= 0.4);
  if (flowers.length < 2) return;
  // Roughly one bee per 3 mature flowers, spawn slowly
  const want = Math.min(6, Math.floor(flowers.length / 3) + 1);
  if (bees.length >= want) return;
  if (rng() > 0.35) return;

  const flower = flowers[Math.floor(rng() * flowers.length)];
  const bee = makeBee(mulberry32(Math.floor(world.time.gameTime * 100) + bees.length));
  copyV3(bee.position.normal, flower.position.normal);
  world.animals.push(bee);
  if (bees.length === 0) pushLog(world, '蜜蜂被花海吸引来了。', 'animal');
}

/** Foxes arrive when rabbits overcrowd; leave if prey is scarce. */
export function maybeSpawnFoxes(world: GameWorldState, rng: () => number): void {
  const foxes = world.animals.filter((a) => a.species === 'fox');
  const rabbits = world.animals.filter((a) => a.species === 'rabbit');

  // Starve out foxes when few rabbits
  if (foxes.length && rabbits.length < 3) {
    for (let i = world.animals.length - 1; i >= 0; i--) {
      const a = world.animals[i];
      if (a.species === 'fox') {
        a.health = Math.max(0, a.health - 0.4);
        if (a.health <= 0.05) {
          world.animals.splice(i, 1);
          pushLog(world, '狐狸离开了这颗星球。', 'animal');
        }
      }
    }
    return;
  }

  if (foxes.length >= 3) return;
  if (rabbits.length < 8) return;
  if (rng() > 0.2) return;

  // Spawn near a random rabbit so the hunt is visible
  const prey = rabbits[Math.floor(rng() * rabbits.length)];
  const fox = makeFox(mulberry32(Math.floor(world.time.gameTime * 91) + foxes.length));
  jitterNormal(fox.position.normal, prey.position.normal, 0.45, rng);
  world.animals.push(fox);
  if (foxes.length === 0) pushLog(world, '一只狐狸循着兔群来到了星球。', 'animal');
}

/** Rabbits breed when well-fed adults meet; elders pass on. */
export function maybeRabbitLife(world: GameWorldState, dtDays: number, rng: () => number): void {
  const MAX_RABBITS = 24;
  const rabbits = world.animals.filter((a) => a.species === 'rabbit');

  for (const r of rabbits) {
    r.age += dtDays;
    r.breedCooldown = Math.max(0, r.breedCooldown - dtDays);
    // Old age
    if (r.age > 12 && rng() < dtDays * 0.35) {
      r.health = Math.max(0, r.health - dtDays * 2);
    }
  }

  // Remove dead
  for (let i = world.animals.length - 1; i >= 0; i--) {
    const a = world.animals[i];
    if (a.species === 'rabbit' && a.health <= 0.02) {
      world.animals.splice(i, 1);
      if (a.age > 8) pushLog(world, '一只上了年纪的兔子安静地离开了。', 'animal');
    }
  }

  const alive = world.animals.filter((a) => a.species === 'rabbit');
  if (alive.length < 2 || alive.length >= MAX_RABBITS) return;

  for (let i = 0; i < alive.length; i++) {
    const a = alive[i];
    if (a.age < 2 || a.breedCooldown > 0 || a.hunger > 0.55 || a.health < 0.55) continue;
    for (let j = i + 1; j < alive.length; j++) {
      const b = alive[j];
      if (b.age < 2 || b.breedCooldown > 0 || b.hunger > 0.55 || b.health < 0.55) continue;
      if (ang(a.position.normal, b.position.normal) > 0.2) continue;
      // Litter
      const kits = 1 + (rng() < 0.35 ? 1 : 0);
      const mid = mixNormals(a.position.normal, b.position.normal);
      for (let k = 0; k < kits && world.animals.filter((x) => x.species === 'rabbit').length < MAX_RABBITS; k++) {
        const baby = makeRabbit(mulberry32(Math.floor(world.time.gameTime * 997) + k + i), 0);
        baby.hunger = 0.3;
        baby.breedCooldown = 3;
        jitterNormal(baby.position.normal, mid, 0.08, rng);
        world.animals.push(baby);
      }
      a.breedCooldown = 4;
      b.breedCooldown = 4;
      a.hunger = Math.min(1, a.hunger + 0.25);
      b.hunger = Math.min(1, b.hunger + 0.25);
      pushLog(world, kits > 1 ? '一对兔子迎来了两只小生命。' : '一对兔子迎来了一个小生命。', 'animal');
      return;
    }
  }
}
