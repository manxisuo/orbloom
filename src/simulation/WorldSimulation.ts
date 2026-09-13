import type {
  AnimalState,
  EcoStats,
  GameWorldState,
  LogEntry,
  PlantSpecies,
  PlantState,
  Vec3Like,
} from '../shared/types';
import {
  cloneV3,
  copyV3,
  localToWorldNormal,
  mulberry32,
  nextId,
  normalize,
  randomOnSphere,
  resetIdCounter,
  v3,
} from '../shared/math';
import { SUN_DIRECTION, lightAmount } from './climate/light';
import { evaporateLakes, rainLakes, waterAt } from './ecology/water';
import { updatePlant } from './ecology/growth';
import { RABBIT_DECISION_INTERVAL, updateRabbit } from './behaviors/rabbit';
import { updateBee } from './behaviors/bee';
import { updateFox } from './behaviors/fox';
import { treeShadeAt } from './ecology/shade';
import { terrainHeightAt } from '../shared/terrain';
import { findEventDef, pickEvent, toPending } from './events/eventCards';

const tmpWorld = v3();

export function createWorld(seed = 42): GameWorldState {
  resetIdCounter(1);
  const rng = mulberry32(seed);

  const lakes = [
    { normal: normalize(v3(), v3(0.35, 0.2, 0.9)), radius: 0.38, water: 0.85 },
    { normal: normalize(v3(), v3(-0.7, -0.15, 0.55)), radius: 0.28, water: 0.7 },
  ];

  const plants: PlantState[] = [];
  // Starter grass patches near the main lake
  for (let i = 0; i < 18; i++) {
    const n = randomNear(rng, lakes[0].normal, 0.55);
    plants.push(makePlant('grass', n, 0.4 + rng() * 0.4));
  }
  // A couple of young trees + a few flowers so bees have a reason to appear
  for (let i = 0; i < 3; i++) {
    const n = randomNear(rng, lakes[0].normal, 0.7);
    plants.push(makePlant('tree', n, 0.25 + rng() * 0.2));
  }
  for (let i = 0; i < 4; i++) {
    const n = randomNear(rng, lakes[0].normal, 0.5);
    plants.push(makePlant('flower', n, 0.3 + rng() * 0.3));
  }

  const animals: AnimalState[] = [];
  for (let i = 0; i < 2; i++) {
    animals.push(makeRabbit(rng));
  }

  return {
    planet: {
      radius: 1,
      rotationY: 0.4,
      rotationX: 0.15,
      spinVelY: 0,
      spinVelX: 0,
      lakes,
    },
    plants,
    animals,
    resources: { stardust: 30 },
    time: { gameTime: 0, speed: 1, dayLength: 45 },
    stats: computeStats(plants, animals, lakes, 0),
    log: [
      {
        id: 'log_start',
        gameTime: 0,
        day: 1,
        text: '星球苏醒了。土壤、一池水，和两颗生命。',
      },
    ],
    seed,
    modifiers: { droughtDays: 0, coldDays: 0 },
    pendingEvent: null,
    nextEventIn: 40,
  };
}

export interface SimBudget {
  /** Accumulated clocks (seconds) that systems pull from. */
  animalDecision: number;
  plantTick: number;
  ecoTick: number;
}

export function createBudget(): SimBudget {
  return { animalDecision: 0, plantTick: 0, ecoTick: 0 };
}

export const SPIN_MAX_Y = 0.95;
export const SPIN_MAX_X = 0.45;
const SPIN_DAMP_Y = 1.6;
const SPIN_DAMP_X = 2.0;

export function tickWorld(world: GameWorldState, budget: SimBudget, dtReal: number): void {
  const speed = world.time.speed;
  if (speed <= 0) {
    return;
  }
  const dt = dtReal * speed;
  world.time.gameTime += dt;

  // Integrate spin with damping — drag sets velocity, release coasts
  const planet = world.planet;
  planet.spinVelY = Math.max(-SPIN_MAX_Y, Math.min(SPIN_MAX_Y, planet.spinVelY || 0));
  planet.spinVelX = Math.max(-SPIN_MAX_X, Math.min(SPIN_MAX_X, planet.spinVelX || 0));
  planet.rotationY += planet.spinVelY * dt;
  planet.rotationX += planet.spinVelX * dt;
  planet.rotationX = Math.max(-0.9, Math.min(0.9, planet.rotationX));
  planet.spinVelY *= Math.exp(-SPIN_DAMP_Y * dt);
  planet.spinVelX *= Math.exp(-SPIN_DAMP_X * dt);
  if (Math.abs(planet.spinVelY) < 0.002) planet.spinVelY = 0;
  if (Math.abs(planet.spinVelX) < 0.002) planet.spinVelX = 0;

  budget.animalDecision += dt;
  budget.plantTick += dt;
  budget.ecoTick += dt;

  const { plants, animals } = world;

  // Plants: ~2 Hz logic is enough; accumulate then step with scaled dt
  if (budget.plantTick >= 0.5) {
    const step = budget.plantTick;
    budget.plantTick = 0;
    const dtPlantDays = step / world.time.dayLength;

    // Pollination pulse from bees near flowers (rebuilt cheaply each plant tick)
    const pollination = new Map<string, number>();
    for (const a of animals) {
      if (a.species !== 'bee' || a.state !== 'pollinate' || !a.targetPlantId) continue;
      const cur = pollination.get(a.targetPlantId) ?? 0;
      pollination.set(a.targetPlantId, cur + 1);
      // Nearby plants also get a mild boost
      for (const p of plants) {
        if (p.id === a.targetPlantId) continue;
        if (ang(p.position.normal, a.position.normal) > 0.35) continue;
        const n = pollination.get(p.id) ?? 0;
        pollination.set(p.id, n + 0.25);
      }
    }

    for (const plant of plants) {
      localToWorldNormal(tmpWorld, plant.position.normal, planet.rotationX, planet.rotationY);
      const light = lightAmount(tmpWorld, SUN_DIRECTION);
      const soil = waterAt(plant.position.normal, planet.lakes);
      const shade = treeShadeAt(plants, plant.position.normal);
      updatePlant(plant, {
        light,
        soilWater: soil,
        dtDays: dtPlantDays * (world.modifiers.coldDays > 0 ? 0.45 : 1),
        shade,
        pollination: pollination.get(plant.id) ?? 0,
      });
      if (world.modifiers.coldDays > 0 && plant.species !== 'tree') {
        plant.health = Math.max(0, plant.health - 0.04 * dtPlantDays);
      }
    }
  }

  // Animals: decision at ~3Hz, movement every tick for smoothness
  let doDecision = false;
  if (budget.animalDecision >= RABBIT_DECISION_INTERVAL) {
    budget.animalDecision = 0;
    doDecision = true;
  }

  const foxes = animals.filter((a) => a.species === 'fox');
  for (const animal of animals) {
    localToWorldNormal(tmpWorld, animal.position.normal, planet.rotationX, planet.rotationY);
    const light = lightAmount(tmpWorld, SUN_DIRECTION);
    if (animal.species === 'bee') {
      updateBee(animal, plants, light, dt, doDecision);
    } else if (animal.species === 'fox') {
      const { caught } = updateFox(animal, animals.filter((r) => r.species === 'rabbit'), dt, doDecision);
      if (caught) {
        const idx = animals.findIndex((r) => r.id === caught);
        if (idx >= 0) {
          animals.splice(idx, 1);
          pushLog(world, '一只狐狸捕获了猎物。');
        }
      }
    } else {
      updateRabbit(animal, plants, light, dt, doDecision ? 0 : 1, foxes);
    }
  }

  // Lakes evaporate based on sun + tree shade + drought
  if (budget.ecoTick >= 1.0) {
    const step = budget.ecoTick;
    budget.ecoTick = 0;
    const dtLakeDays = step / world.time.dayLength;

    if (world.modifiers.droughtDays > 0) {
      world.modifiers.droughtDays = Math.max(0, world.modifiers.droughtDays - dtLakeDays);
    }
    if (world.modifiers.coldDays > 0) {
      world.modifiers.coldDays = Math.max(0, world.modifiers.coldDays - dtLakeDays);
    }

    const droughtMul = 1 + (world.modifiers.droughtDays > 0 ? 1.6 : 0);
    evaporateLakes(
      planet.lakes,
      (localN) => {
        localToWorldNormal(tmpWorld, localN, planet.rotationX, planet.rotationY);
        return lightAmount(tmpWorld, SUN_DIRECTION);
      },
      dtLakeDays * droughtMul,
      plants,
    );

    // Bees appear when enough mature flowers exist
    maybeSpawnBees(world);
    maybeRabbitLife(world, dtLakeDays);
    maybeSpawnFoxes(world);

    // Event cards
    if (!world.pendingEvent) {
      world.nextEventIn -= step;
      if (world.nextEventIn <= 0) {
        const def = pickEvent(mulberry32(Math.floor(world.time.gameTime) + world.seed));
        world.pendingEvent = toPending(def);
        world.nextEventIn = 55 + Math.random() * 40;
        pushLog(world, `事件：${def.title}`);
      }
    }

    // Natural stardust trickle from healthy eco
    const s = computeStats(plants, animals, planet.lakes, world.time.gameTime);
    world.stats = s;
    world.resources.stardust += s.stability * dtLakeDays * 18;

    // Cull withered grass/flowers
    for (let i = plants.length - 1; i >= 0; i--) {
      const p = plants[i];
      if (p.species !== 'tree' && p.health <= 0.02 && p.growth <= 0.02) {
        plants.splice(i, 1);
      }
    }
  }
}

export function resolvePendingEvent(world: GameWorldState, accept: boolean): string {
  if (!world.pendingEvent) return '';
  const def = findEventDef(world.pendingEvent.id);
  const rng = mulberry32(Math.floor(world.time.gameTime * 1000) + world.plants.length);
  const msg = accept ? def.apply(world, rng) : (def.decline?.(world) ?? '事件过去了。');
  world.pendingEvent = null;
  pushLog(world, msg);
  refreshStats(world);
  return msg;
}

export function makePlantForEvent(species: PlantSpecies, normal: Vec3Like, growth = 0.2): PlantState {
  return makePlant(species, normal, growth);
}

function maybeSpawnBees(world: GameWorldState): void {
  const bees = world.animals.filter((a) => a.species === 'bee');
  if (bees.length >= 6) return;
  const flowers = world.plants.filter((p) => p.species === 'flower' && p.growth >= 0.4 && p.health >= 0.4);
  if (flowers.length < 2) return;
  // Roughly one bee per 3 mature flowers, spawn slowly
  const want = Math.min(6, Math.floor(flowers.length / 3) + 1);
  if (bees.length >= want) return;
  if (Math.random() > 0.35) return;

  const flower = flowers[Math.floor(Math.random() * flowers.length)];
  const bee = makeBee(mulberry32(Math.floor(world.time.gameTime * 100) + bees.length));
  copyV3(bee.position.normal, flower.position.normal);
  world.animals.push(bee);
  if (bees.length === 0) pushLog(world, '蜜蜂被花海吸引来了。');
}

function makeBee(rng: () => number): AnimalState {
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

function makeRabbit(rng: () => number, age = 0.8 + rng() * 1.2): AnimalState {
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

function makeFox(rng: () => number): AnimalState {
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

/** Foxes arrive when rabbits overcrowd; leave if prey is scarce. */
function maybeSpawnFoxes(world: GameWorldState): void {
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
          pushLog(world, '狐狸离开了这颗星球。');
        }
      }
    }
    return;
  }

  if (foxes.length >= 3) return;
  if (rabbits.length < 8) return;
  if (Math.random() > 0.2) return;

  // Spawn near a random rabbit so the hunt is visible
  const prey = rabbits[Math.floor(Math.random() * rabbits.length)];
  const fox = makeFox(mulberry32(Math.floor(world.time.gameTime * 91) + foxes.length));
  jitterNormal(fox.position.normal, prey.position.normal, 0.45);
  world.animals.push(fox);
  if (foxes.length === 0) pushLog(world, '一只狐狸循着兔群来到了星球。');
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
  pushLog(world, '一只狐狸来到了星球。');
  refreshStats(world);
  return true;
}

/** Rabbits breed when well-fed adults meet; elders pass on. */
function maybeRabbitLife(world: GameWorldState, dtDays: number): void {
  const MAX_RABBITS = 24;
  const rabbits = world.animals.filter((a) => a.species === 'rabbit');

  for (const r of rabbits) {
    r.age += dtDays;
    r.breedCooldown = Math.max(0, r.breedCooldown - dtDays);
    // Old age
    if (r.age > 12 && Math.random() < dtDays * 0.35) {
      r.health = Math.max(0, r.health - dtDays * 2);
    }
  }

  // Remove dead
  for (let i = world.animals.length - 1; i >= 0; i--) {
    const a = world.animals[i];
    if (a.species === 'rabbit' && a.health <= 0.02) {
      world.animals.splice(i, 1);
      if (a.age > 8) pushLog(world, '一只上了年纪的兔子安静地离开了。');
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
      const kits = 1 + (Math.random() < 0.35 ? 1 : 0);
      const mid = mixNormals(a.position.normal, b.position.normal);
      for (let k = 0; k < kits && world.animals.filter((x) => x.species === 'rabbit').length < MAX_RABBITS; k++) {
        const baby = makeRabbit(mulberry32(Math.floor(world.time.gameTime * 997) + k + i), 0);
        baby.hunger = 0.3;
        baby.breedCooldown = 3;
        jitterNormal(baby.position.normal, mid, 0.08);
        world.animals.push(baby);
      }
      a.breedCooldown = 4;
      b.breedCooldown = 4;
      a.hunger = Math.min(1, a.hunger + 0.25);
      b.hunger = Math.min(1, b.hunger + 0.25);
      pushLog(world, kits > 1 ? '一对兔子迎来了两只小生命。' : '一对兔子迎来了一个小生命。');
      return;
    }
  }
}

function mixNormals(a: Vec3Like, b: Vec3Like): Vec3Like {
  return normalize(v3(), v3(a.x + b.x, a.y + b.y, a.z + b.z));
}

function jitterNormal(out: Vec3Like, base: Vec3Like, amt: number): void {
  const j = randomOnSphere(v3(), mulberry32(Math.floor(Math.random() * 1e9)));
  out.x = base.x + j.x * amt;
  out.y = base.y + j.y * amt;
  out.z = base.z + j.z * amt;
  normalize(out, out);
}

export function refreshStats(world: GameWorldState): void {
  world.stats = computeStats(
    world.plants,
    world.animals,
    world.planet.lakes,
    world.time.gameTime,
    world.time.dayLength,
  );
}

export type PlantFailReason = 'stardust' | 'cap' | 'dense' | 'water';

export function plantTreeAt(
  world: GameWorldState,
  localNormal: Vec3Like,
  species: PlantSpecies = 'tree',
): { ok: true } | { ok: false; reason: PlantFailReason } {
  const cost = species === 'tree' ? 5 : species === 'grass' ? 2 : 3;
  if (world.resources.stardust < cost) return { ok: false, reason: 'stardust' };
  if (world.plants.length > 400) return { ok: false, reason: 'cap' };

  // Trees need more space; grass can pack tighter
  const minAng = species === 'tree' ? 0.1 : 0.05;
  for (const p of world.plants) {
    if (ang(p.position.normal, localNormal) < minAng) return { ok: false, reason: 'dense' };
  }

  world.resources.stardust -= cost;
  const plant = makePlant(species, cloneV3(localNormal), 0.05);
  world.plants.push(plant);
  pushLog(world, `种下了${species === 'tree' ? '一棵树' : species === 'grass' ? '一丛草' : '一朵花'}。`);
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
  pushLog(world, '一只兔子来到了星球。');
  refreshStats(world);
  return true;
}

export function rain(world: GameWorldState): boolean {
  const cost = 6;
  if (world.resources.stardust < cost) return false;
  world.resources.stardust -= cost;
  rainLakes(world.planet.lakes, 0.18);
  pushLog(world, '一场小雨落下，湖泊丰盈了一些。');
  refreshStats(world);
  return true;
}

export function pushLog(world: GameWorldState, text: string): void {
  const day = Math.floor(world.time.gameTime / world.time.dayLength) + 1;
  const entry: LogEntry = {
    id: nextId('log'),
    gameTime: world.time.gameTime,
    day,
    text: `第 ${day} 天，${text}`,
  };
  world.log.push(entry);
  if (world.log.length > 80) world.log.splice(0, world.log.length - 80);
}

function makePlant(species: PlantSpecies, normal: Vec3Like, growth: number): PlantState {
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

function randomNear(rng: () => number, center: Vec3Like, maxAng: number): Vec3Like {
  // Sample a few candidates, keep closest-ish
  let best = randomOnSphere(v3(), rng);
  let bestAng = ang(best, center);
  for (let i = 0; i < 8; i++) {
    const c = randomOnSphere(v3(), rng);
    const a = ang(c, center);
    if (a < bestAng) {
      bestAng = a;
      best = c;
    }
  }
  if (bestAng > maxAng) {
    // Slerp toward center a bit
    const t = 0.5;
    normalize(
      best,
      v3(best.x + (center.x - best.x) * t, best.y + (center.y - best.y) * t, best.z + (center.z - best.z) * t),
    );
  }
  return best;
}

function randomTangentSafe(out: Vec3Like, normal: Vec3Like): void {
  const ref = Math.abs(normal.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
  const cx = normal.y * ref.z - normal.z * ref.y;
  const cy = normal.z * ref.x - normal.x * ref.z;
  const cz = normal.x * ref.y - normal.y * ref.x;
  out.x = cx;
  out.y = cy;
  out.z = cz;
  normalize(out, out);
}

function ang(a: Vec3Like, b: Vec3Like): number {
  const d = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
  return Math.acos(d);
}

export function computeStats(
  plants: PlantState[],
  animals: AnimalState[],
  lakes: { water: number }[],
  gameTime: number,
  dayLength = 45,
): EcoStats {
  let lightSum = 0;
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

  const dayFraction = (gameTime % dayLength) / dayLength;
  const day = Math.floor(gameTime / dayLength) + 1;
  // Heuristic stability: balanced life, not empty, not overcrowded, decent water
  const plantScore = Math.min(1, plantCount / 40);
  const animalScore = animalCount === 0 ? 0.4 : animalCount <= 12 ? 0.7 + animalCount * 0.02 : 0.5;
  const stability = Math.max(
    0,
    Math.min(1, plantScore * 0.35 + avgHealth * 0.25 + avgWater * 0.2 + avgLake * 0.2 + animalScore * 0.05),
  );

  return {
    averageLight: lightSum,
    averageWater: avgWater,
    averageHealth: avgHealth,
    plantCount,
    animalCount,
    stability,
    dayFraction,
    day,
  };
}
