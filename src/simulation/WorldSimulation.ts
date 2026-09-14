import type { AnimalState, GameWorldState, PlantState } from '../shared/types';
import { localToWorldNormal, mulberry32, normalize, resetIdCounter, v3 } from '../shared/math';
import { SUN_DIRECTION, lightAmount } from './climate/light';
import { evaporateLakes, waterAt } from './ecology/water';
import { updatePlant } from './ecology/growth';
import { RABBIT_DECISION_INTERVAL, updateRabbit } from './behaviors/rabbit';
import { updateBee } from './behaviors/bee';
import { updateFox } from './behaviors/fox';
import { treeShadeAt } from './ecology/shade';
import { computeStats } from './stats';
import { pushLog } from './log';
import { worldRng } from './rng';
import { ang, randomNear } from './helpers';
import { makePlant } from './actions';
import { makeRabbit, maybeRabbitLife, maybeSpawnBees, maybeSpawnFoxes } from './systems/lifecycle';
import { maybeOfferEvent, tickDelayedEvents } from './systems/events';
import { updatePersonality } from './systems/personality';

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
        kind: 'life' as const,
      },
    ],
    seed,
    rngState: seed >>> 0,
    modifiers: { droughtDays: 0, coldDays: 0, machineScore: 0 },
    pendingEvent: null,
    nextEventIn: 40,
    delayedEvents: [],
    personality: 'wild',
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
  const rng = worldRng(world);

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
      updateBee(animal, plants, light, dt, doDecision, rng);
    } else if (animal.species === 'fox') {
      const { caught } = updateFox(animal, animals.filter((r) => r.species === 'rabbit'), dt, doDecision, rng);
      if (caught) {
        const idx = animals.findIndex((r) => r.id === caught);
        if (idx >= 0) {
          animals.splice(idx, 1);
          pushLog(world, '一只狐狸捕获了猎物。', 'animal');
        }
      }
    } else {
      updateRabbit(animal, plants, light, dt, doDecision ? 0 : 1, foxes, rng);
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
    maybeSpawnBees(world, rng);
    maybeRabbitLife(world, dtLakeDays, rng);
    maybeSpawnFoxes(world, rng);
    tickDelayedEvents(world);
    updatePersonality(world);

    // Event cards
    maybeOfferEvent(world, step, rng);

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

// --- Re-exports: keep the split systems behind the old façade API ---
export { computeStats, refreshStats } from './stats';
export { pushLog } from './log';
export { makePlantForEvent, plantTreeAt, spawnFoxAt, spawnRabbitAt, rain } from './actions';
export type { PlantFailReason } from './actions';
export { resolvePendingEvent, tickDelayedEvents } from './systems/events';
export { personalityLabel, updatePersonality } from './systems/personality';
