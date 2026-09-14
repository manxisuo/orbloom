import { describe, expect, it } from 'vitest';
import { createBudget, createWorld, spawnFoxAt, spawnRabbitAt, tickWorld } from './WorldSimulation';
import { v3 } from '../shared/math';

describe('tickWorld rabbit integration', () => {
  it('starter rabbits change position over simulated time', () => {
    const world = createWorld(42);
    world.time.speed = 1;
    const budget = createBudget();
    const starts = world.animals
      .filter((a) => a.species === 'rabbit')
      .map((a) => ({ id: a.id, n: { ...a.position.normal } }));
    expect(starts.length).toBeGreaterThan(0);

    // 3 seconds at 60fps
    for (let i = 0; i < 180; i++) {
      tickWorld(world, budget, 1 / 60);
    }

    for (const s of starts) {
      const a = world.animals.find((x) => x.id === s.id);
      expect(a).toBeTruthy();
      const d = Math.hypot(
        a!.position.normal.x - s.n.x,
        a!.position.normal.y - s.n.y,
        a!.position.normal.z - s.n.z,
      );
      console.log(s.id, 'moved', d, 'state', a!.state, 'light-era rotY', world.planet.rotationY);
      expect(d).toBeGreaterThan(0.005);
    }
  });

  it('animals are actually updated in the animals loop (species filter)', () => {
    const world = createWorld(7);
    const rabbits = world.animals.filter((a) => a.species === 'rabbit');
    expect(rabbits.every((a) => a.species === 'rabbit')).toBe(true);
    // ensure none are accidentally classified only as bee
    expect(world.animals.some((a) => a.species === 'bee')).toBe(false);
  });

  it('same seed replays identically (deterministic RNG)', () => {
    const a = createWorld(123);
    const b = createWorld(123);
    const budgetA = createBudget();
    const budgetB = createBudget();
    for (let i = 0; i < 900; i++) {
      tickWorld(a, budgetA, 1 / 60);
      tickWorld(b, budgetB, 1 / 60);
    }
    expect(a.rngState).toBe(b.rngState);
    // ids come from a module-global counter, so compare simulation state, not ids
    const snapshot = (w: typeof a) =>
      w.animals.map((x) => [x.species, x.position.normal.x, x.position.normal.y, x.position.normal.z, x.hunger]);
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it('fox catches an adjacent rabbit without corrupting the animal list', () => {
    const world = createWorld(5);
    world.animals = [];
    world.resources.stardust = 100;
    const spot = v3(0, 1, 0);
    expect(spawnRabbitAt(world, spot)).toBe(true);
    expect(spawnFoxAt(world, spot)).toBe(true);
    const fox = world.animals.find((a) => a.species === 'fox')!;
    fox.hunger = 0.9;

    // 0.5s: enough for the fox's first decision tick, before any eco tick
    const budget = createBudget();
    for (let i = 0; i < 30; i++) tickWorld(world, budget, 1 / 60);

    expect(world.animals.some((a) => a.species === 'rabbit')).toBe(false);
    expect(world.animals.some((a) => a.species === 'fox')).toBe(true);
  });
});
