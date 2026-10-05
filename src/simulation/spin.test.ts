import { describe, expect, it } from 'vitest';
import type { PlantState } from '../shared/types';
import { SUN_DIRECTION } from './climate/light';
import { computeStats } from './stats';
import { DAY_LENGTH, planetSelfSpinRate } from './tuning';
import { createBudget, createWorld, tickWorld } from './WorldSimulation';

describe('planet self-spin', () => {
  it('self-spin rate is one revolution per dayLength', () => {
    expect(planetSelfSpinRate(DAY_LENGTH) * DAY_LENGTH).toBeCloseTo(Math.PI * 2, 10);
    expect(planetSelfSpinRate(0)).toBeCloseTo(Math.PI * 2, 10);
  });

  it('rotates about one turn per game day when the player does nothing', () => {
    const world = createWorld(1);
    const start = world.planet.rotationY;
    const budget = createBudget();
    const dt = 1 / 30;
    const steps = Math.round(world.time.dayLength / dt);
    for (let i = 0; i < steps; i++) tickWorld(world, budget, dt);
    expect(world.planet.rotationY - start).toBeCloseTo(Math.PI * 2, 2);
    expect(world.time.gameTime).toBeCloseTo(world.time.dayLength, 2);
  });

  it('does not self-spin while paused', () => {
    const world = createWorld(1);
    world.time.speed = 0;
    const start = world.planet.rotationY;
    const budget = createBudget();
    for (let i = 0; i < 60; i++) tickWorld(world, budget, 1 / 30);
    expect(world.planet.rotationY).toBe(start);
    expect(world.time.gameTime).toBe(0);
  });

  it('still applies player drag while paused', () => {
    const world = createWorld(1);
    world.time.speed = 0;
    world.planet.spinVelY = 0.4;
    const start = world.planet.rotationY;
    tickWorld(world, createBudget(), 0.25);
    expect(world.planet.rotationY).toBeGreaterThan(start);
    expect(world.time.gameTime).toBe(0);
  });

  it('scales self-spin with game speed', () => {
    const world = createWorld(1);
    world.time.speed = 2;
    const start = world.planet.rotationY;
    tickWorld(world, createBudget(), 1);
    expect(world.planet.rotationY - start).toBeCloseTo(planetSelfSpinRate(world.time.dayLength) * 2, 5);
  });
});

describe('computeStats orientation', () => {
  it('uses spin phase for dayFraction and clock for calendar day', () => {
    const stats = computeStats([], [], [], 90, 60, { rotationX: 0, rotationY: Math.PI });
    expect(stats.day).toBe(2);
    expect(stats.dayFraction).toBeCloseTo(0.5, 10);
    expect(stats.sunlight).toBe(0.5);
  });

  it('sunlight follows the same orientation plants use for growth', () => {
    const plant: PlantState = {
      id: 'p',
      species: 'grass',
      position: { normal: { ...SUN_DIRECTION }, altitude: 0 },
      age: 0,
      health: 1,
      water: 0.4,
      growth: 0.2,
    };
    const day = computeStats([plant], [], [], 0, 60, { rotationX: 0, rotationY: 0 });
    const night = computeStats([plant], [], [], 0, 60, { rotationX: 0, rotationY: Math.PI });
    expect(day.sunlight).toBeGreaterThan(0.8);
    expect(night.sunlight).toBeLessThan(day.sunlight);
  });
});
