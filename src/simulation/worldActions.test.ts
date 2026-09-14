import { describe, expect, it } from 'vitest';
import type { PlantState, Vec3Like } from '../shared/types';
import { normalize, v3 } from '../shared/math';
import {
  createBudget,
  createWorld,
  plantTreeAt,
  rain,
  resolvePendingEvent,
  spawnFoxAt,
  spawnRabbitAt,
  tickDelayedEvents,
  tickWorld,
  updatePersonality,
} from './WorldSimulation';
import { findEventDef, toPending } from './events/eventCards';

let uid = 0;

function makePlant(
  species: PlantState['species'],
  normal: Vec3Like = v3(0, 1, 0),
  over: Partial<PlantState> = {},
): PlantState {
  return {
    id: `t_${uid++}`,
    species,
    position: { normal: normalize(v3(), normal), altitude: 0 },
    age: 0,
    health: 1,
    water: 0.4,
    growth: 0.5,
    ...over,
  };
}

describe('resource spending actions', () => {
  it('plantTreeAt deducts stardust and adds a plant', () => {
    const world = createWorld(1);
    world.resources.stardust = 20;
    const before = world.plants.length;
    const res = plantTreeAt(world, v3(0, 1, 0));
    expect(res).toEqual({ ok: true });
    expect(world.resources.stardust).toBe(15);
    expect(world.plants.length).toBe(before + 1);
  });

  it('plantTreeAt refuses when stardust is short', () => {
    const world = createWorld(1);
    world.resources.stardust = 2;
    expect(plantTreeAt(world, v3(0, 1, 0))).toEqual({ ok: false, reason: 'stardust' });
  });

  it('plantTreeAt refuses to stack two trees on the same spot', () => {
    const world = createWorld(1);
    world.resources.stardust = 100;
    expect(plantTreeAt(world, v3(0, 1, 0)).ok).toBe(true);
    expect(plantTreeAt(world, v3(0, 1, 0))).toEqual({ ok: false, reason: 'dense' });
  });

  it('rain deducts a fixed cost and refills lakes', () => {
    const world = createWorld(1);
    const before = world.planet.lakes[0].water;
    world.resources.stardust = 10;
    expect(rain(world)).toEqual({ ok: true });
    expect(world.resources.stardust).toBe(4);
    expect(world.planet.lakes[0].water).toBeGreaterThan(before);
    expect(world.rainCooldown).toBeGreaterThan(0);
  });

  it('rain fails when stardust is short', () => {
    const world = createWorld(1);
    world.resources.stardust = 5;
    expect(rain(world)).toEqual({ ok: false, reason: 'stardust' });
    expect(world.resources.stardust).toBe(5);
  });

  it('rain is blocked by its cooldown without side effects', () => {
    const world = createWorld(1);
    world.resources.stardust = 100;
    expect(rain(world).ok).toBe(true);
    const stardust = world.resources.stardust;
    const water = world.planet.lakes[0].water;
    expect(rain(world)).toEqual({ ok: false, reason: 'cooldown' });
    expect(world.resources.stardust).toBe(stardust);
    expect(world.planet.lakes[0].water).toBe(water);
  });

  it('rain cooldown advances with game time and then clears', () => {
    const world = createWorld(1);
    world.resources.stardust = 100;
    expect(rain(world).ok).toBe(true);
    const budget = createBudget();
    // 0.5s of game time: still cooling
    for (let i = 0; i < 30; i++) tickWorld(world, budget, 1 / 60);
    expect(rain(world)).toEqual({ ok: false, reason: 'cooldown' });
    // 20s: cooldown has elapsed
    for (let i = 0; i < 60 * 20; i++) tickWorld(world, budget, 1 / 60);
    expect(world.rainCooldown).toBe(0);
    expect(rain(world).ok).toBe(true);
  });

  it('spawning animals deducts their cost', () => {
    const world = createWorld(1);
    world.resources.stardust = 100;
    expect(spawnRabbitAt(world, v3(0.5, 0.5, 0.7))).toBe(true);
    expect(world.resources.stardust).toBe(92);
    expect(spawnFoxAt(world, v3(-0.5, 0.5, 0.7))).toBe(true);
    expect(world.resources.stardust).toBe(82);
  });
});

describe('updatePersonality', () => {
  it('detects forest, nightGlow, mechanical, desert and chaos', () => {
    const forest = createWorld(1);
    forest.plants = Array.from({ length: 10 }, () => makePlant('tree', v3(0, 1, 0)));
    forest.planet.lakes.forEach((l) => (l.water = 0.9));
    updatePersonality(forest);
    expect(forest.personality).toBe('forest');

    const glow = createWorld(1);
    glow.plants = Array.from({ length: 6 }, () => makePlant('mushroom', v3(0, 1, 0), { growth: 0.5 }));
    updatePersonality(glow);
    expect(glow.personality).toBe('nightGlow');

    const machine = createWorld(1);
    machine.modifiers.machineScore = 3;
    updatePersonality(machine);
    expect(machine.personality).toBe('mechanical');

    const desert = createWorld(1);
    desert.plants = [makePlant('grass', v3(0, 1, 0))];
    desert.planet.lakes.forEach((l) => (l.water = 0.05));
    updatePersonality(desert);
    expect(desert.personality).toBe('desert');

    const chaos = createWorld(1);
    chaos.plants = Array.from({ length: 4 }, () => makePlant('grass', v3(0, 1, 0), { health: 0.1 }));
    updatePersonality(chaos);
    expect(chaos.personality).toBe('chaos');
  });

  it('logs a personality change only once', () => {
    const world = createWorld(1);
    world.plants = Array.from({ length: 10 }, () => makePlant('tree', v3(0, 1, 0)));
    world.planet.lakes.forEach((l) => (l.water = 0.9));
    updatePersonality(world);
    const logs = world.log.filter((l) => l.kind === 'personality').length;
    updatePersonality(world);
    expect(world.log.filter((l) => l.kind === 'personality').length).toBe(logs);
  });
});

describe('tickDelayedEvents', () => {
  it('birdGift plants a small patch and clears itself', () => {
    const world = createWorld(1);
    world.time.gameTime = 1;
    world.delayedEvents = [{ kind: 'birdGift', fireAt: 0 }];
    const before = world.plants.length;
    tickDelayedEvents(world);
    expect(world.plants.length).toBe(before + 3);
    expect(world.delayedEvents).toHaveLength(0);
  });

  it('whisperGift pays stardust and heals trees', () => {
    const world = createWorld(1);
    world.time.gameTime = 1;
    world.resources.stardust = 0;
    const tree = makePlant('tree', v3(0.2, 0.5, 0.8), { health: 0.5, growth: 0.5 });
    world.plants.push(tree);
    world.delayedEvents = [{ kind: 'whisperGift', fireAt: 0 }];
    tickDelayedEvents(world);
    expect(world.resources.stardust).toBe(8);
    expect(tree.health).toBeGreaterThan(0.5);
  });

  it('holds events until their fire time', () => {
    const world = createWorld(1);
    world.time.gameTime = 0;
    world.delayedEvents = [{ kind: 'birdGift', fireAt: 100 }];
    const before = world.plants.length;
    tickDelayedEvents(world);
    expect(world.plants.length).toBe(before);
    expect(world.delayedEvents).toHaveLength(1);
  });
});

describe('resolvePendingEvent', () => {
  it('applies on accept and clears the pending card', () => {
    const world = createWorld(1);
    world.pendingEvent = toPending(findEventDef('gentleRain'));
    const before = world.planet.lakes[0].water;
    const result = resolvePendingEvent(world, true);
    expect(result?.accepted).toBe(true);
    expect(world.pendingEvent).toBeNull();
    expect(world.planet.lakes[0].water).toBeGreaterThan(before);
  });

  it('declining a free event clears the card without changing the world', () => {
    const world = createWorld(1);
    const plantsBefore = world.plants.length;
    world.pendingEvent = toPending(findEventDef('strangeSeed'));
    const result = resolvePendingEvent(world, false);
    expect(result?.accepted).toBe(false);
    expect(world.pendingEvent).toBeNull();
    expect(world.plants.length).toBe(plantsBefore);
  });

  it('applies the decline cost through the command (coldNight)', () => {
    const world = createWorld(1);
    world.resources.stardust = 30;
    world.pendingEvent = toPending(findEventDef('coldNight'));
    resolvePendingEvent(world, false);
    expect(world.resources.stardust).toBe(24);
    expect(world.modifiers.coldDays).toBe(0);
  });

  it('returns null when nothing is pending', () => {
    const world = createWorld(1);
    expect(resolvePendingEvent(world, true)).toBeNull();
  });
});
