import { describe, expect, it } from 'vitest';
import { v3 } from '../../shared/math';
import { createWorld } from '../WorldSimulation';
import { makePlant } from '../actions';
import { WISH_DEFS, WISH_GAP, tickWishes, wishProgress } from './wishes';

function addTrees(world: ReturnType<typeof createWorld>, n: number) {
  for (let i = 0; i < n; i++) world.plants.push(makePlant('tree', v3(0, 1, 0), 0.5));
}

describe('wishProgress', () => {
  it('tracks species count toward the target and clamps at 1', () => {
    const world = createWorld(1);
    world.plants = [];
    const cond = { kind: 'plantSpeciesCount', species: 'tree', min: 4 } as const;
    expect(wishProgress(world, cond)).toBe(0);
    addTrees(world, 2);
    expect(wishProgress(world, cond)).toBeCloseTo(0.5);
    addTrees(world, 2);
    expect(wishProgress(world, cond)).toBe(1);
    addTrees(world, 2);
    expect(wishProgress(world, cond)).toBe(1);
  });

  it('measures average lake water against the target', () => {
    const world = createWorld(1);
    world.planet.lakes.forEach((l) => (l.water = 0.3));
    expect(wishProgress(world, { kind: 'averageLakeWater', min: 0.6 })).toBeCloseTo(0.5);
  });
});

describe('tickWishes', () => {
  it('offers the first wish once the gap elapses', () => {
    const world = createWorld(1);
    world.wish = null;
    world.nextWishIn = 0;
    tickWishes(world, 0.1);
    expect(world.wish).not.toBeNull();
    expect(world.wish!.id).toBe(WISH_DEFS[0].id);
    expect(world.wish!.deadline).toBeGreaterThan(world.time.gameTime);
  });

  it('completes a satisfied wish, grants the reward and schedules the next', () => {
    const world = createWorld(1);
    world.plants = [];
    addTrees(world, 8);
    world.resources.stardust = 0;
    world.wish = { id: 'forestWish', startedAt: 0, deadline: 1e9, progress: 0 };

    tickWishes(world, 1);
    expect(world.wishesCompleted).toBe(1);
    expect(world.wish).toBeNull();
    expect(world.resources.stardust).toBe(20);
    expect(world.nextWishIn).toBe(WISH_GAP);
  });

  it('fails an unmet wish at its deadline without side effects', () => {
    const world = createWorld(1);
    world.plants = [];
    world.resources.stardust = 50;
    world.wish = { id: 'forestWish', startedAt: 0, deadline: 0, progress: 0 };
    world.time.gameTime = 5;

    tickWishes(world, 1);
    expect(world.wishesFailed).toBe(1);
    expect(world.wish).toBeNull();
    expect(world.resources.stardust).toBe(50);
  });

  it('waits out the gap before offering the next wish', () => {
    const world = createWorld(1);
    world.plants = [];
    addTrees(world, 8);
    world.wish = { id: 'forestWish', startedAt: 0, deadline: 1e9, progress: 0 };
    tickWishes(world, 1);
    expect(world.wish).toBeNull();
    tickWishes(world, WISH_GAP - 1);
    expect(world.wish).toBeNull();
    tickWishes(world, 2);
    expect(world.wish).not.toBeNull();
  });
});
