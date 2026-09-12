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
  // A couple of young trees
  for (let i = 0; i < 3; i++) {
    const n = randomNear(rng, lakes[0].normal, 0.7);
    plants.push(makePlant('tree', n, 0.25 + rng() * 0.2));
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

export function tickWorld(world: GameWorldState, budget: SimBudget, dtReal: number): void {
  const speed = world.time.speed;
  if (speed <= 0) {
    // Still allow UI clocks to idle
    return;
  }
  const dt = dtReal * speed;
  world.time.gameTime += dt;

  budget.animalDecision += dt;
  budget.plantTick += dt;
  budget.ecoTick += dt;

  const { planet, plants, animals } = world;

  // Plants: ~2 Hz logic is enough; accumulate then step with scaled dt
  if (budget.plantTick >= 0.5) {
    const step = budget.plantTick;
    budget.plantTick = 0;
    const dtPlantDays = step / world.time.dayLength;

    for (const plant of plants) {
      localToWorldNormal(tmpWorld, plant.position.normal, planet.rotationX, planet.rotationY);
      const light = lightAmount(tmpWorld, SUN_DIRECTION);
      const soil = waterAt(plant.position.normal, planet.lakes);
      updatePlant(plant, { light, soilWater: soil, dtDays: dtPlantDays });
    }

    // Remove dead grass occasionally handled by cull below
  }

  // Animals: decision at ~3Hz, movement every tick for smoothness
  let doDecision = false;
  if (budget.animalDecision >= RABBIT_DECISION_INTERVAL) {
    budget.animalDecision = 0;
    doDecision = true;
  }

  for (const rabbit of animals) {
    localToWorldNormal(tmpWorld, rabbit.position.normal, planet.rotationX, planet.rotationY);
    const light = lightAmount(tmpWorld, SUN_DIRECTION);
    updateRabbit(rabbit, plants, light, dt, doDecision ? 0 : 1);
  }

  // Lakes evaporate based on sun
  if (budget.ecoTick >= 1.0) {
    const step = budget.ecoTick;
    budget.ecoTick = 0;
    const dtLakeDays = step / world.time.dayLength;
    evaporateLakes(
      planet.lakes,
      (localN) => {
        localToWorldNormal(tmpWorld, localN, planet.rotationX, planet.rotationY);
        return lightAmount(tmpWorld, SUN_DIRECTION);
      },
      dtLakeDays,
    );

    // Natural stardust trickle from healthy eco
    const s = computeStats(plants, animals, planet.lakes, world.time.gameTime);
    world.stats = s;
    world.resources.stardust += s.stability * dtLakeDays * 18;

    // Cull withered grass
    for (let i = plants.length - 1; i >= 0; i--) {
      const p = plants[i];
      if (p.species !== 'tree' && p.health <= 0.02 && p.growth <= 0.02) {
        plants.splice(i, 1);
      }
    }
  }
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

export function plantTreeAt(world: GameWorldState, localNormal: Vec3Like, species: PlantSpecies = 'tree'): boolean {
  const cost = species === 'tree' ? 5 : species === 'grass' ? 2 : 3;
  if (world.resources.stardust < cost) return false;
  if (world.plants.length > 400) return false;

  // Simple density check
  for (const p of world.plants) {
    if (ang(p.position.normal, localNormal) < 0.08) return false;
  }

  world.resources.stardust -= cost;
  const plant = makePlant(species, cloneV3(localNormal), 0.05);
  world.plants.push(plant);
  pushLog(world, `种下了${species === 'tree' ? '一棵树' : species === 'grass' ? '一丛草' : '一朵花'}。`);
  refreshStats(world);
  return true;
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
  return {
    id: nextId('plant'),
    species,
    position: { normal: normalize(v3(), normal), altitude: 0 },
    age: 0,
    health: 1,
    water: 0.4,
    growth,
  };
}

function makeRabbit(rng: () => number): AnimalState {
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
