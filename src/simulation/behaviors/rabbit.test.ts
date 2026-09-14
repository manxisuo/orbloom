import { describe, expect, it } from 'vitest';
import { updateRabbit } from './rabbit';
import type { AnimalState, PlantState } from '../../shared/types';
import { mulberry32, normalize, v3 } from '../../shared/math';

function makeRabbit(): AnimalState {
  const n = normalize(v3(), v3(0.3, 0.2, 0.9));
  return {
    id: 'a1',
    species: 'rabbit',
    position: { normal: { ...n }, altitude: 0 },
    facing: normalize(v3(), v3(0.9, 0, -0.3)),
    health: 1,
    hunger: 0.2,
    state: 'wander',
    stateTimer: 0,
    targetPlantId: null,
    hopPhase: 0,
    age: 1,
    breedCooldown: 0,
  };
}

function dist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

describe('updateRabbit movement', () => {
  it('moves under full daylight', () => {
    const r = makeRabbit();
    const rng = mulberry32(1);
    const start = { ...r.position.normal };
    for (let i = 0; i < 60; i++) {
      updateRabbit(r, [] as PlantState[], 0.9, 1 / 60, i % 3 === 0 ? 0 : 1, [], rng);
    }
    const moved = dist(start, r.position.normal);
    console.log('day moved', moved, 'state', r.state, 'n', r.position.normal);
    expect(moved).toBeGreaterThan(0.01);
  });

  it('still shuffles at night (sleep does not freeze)', () => {
    const r = makeRabbit();
    r.hunger = 0.1;
    const rng = mulberry32(2);
    const start = { ...r.position.normal };
    for (let i = 0; i < 120; i++) {
      updateRabbit(r, [] as PlantState[], 0.0, 1 / 60, i % 3 === 0 ? 0 : 1, [], rng);
    }
    const moved = dist(start, r.position.normal);
    console.log('night moved', moved, 'state', r.state);
    expect(moved).toBeGreaterThan(0.001);
  });

  it('wakes from sleep when light returns', () => {
    const r = makeRabbit();
    r.state = 'sleep';
    r.hunger = 0.1;
    updateRabbit(r, [], 0.9, 1 / 60, 1, [], mulberry32(3));
    expect(r.state).not.toBe('sleep');
  });
});
