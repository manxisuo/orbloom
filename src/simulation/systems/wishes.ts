import type {
  GameWorldState,
  PlanetWish,
  WishCondition,
  WishId,
} from '../../shared/types';
import { pushLog } from '../log';
import { refreshStats } from '../stats';
import { WISH_GAP_DAYS } from '../tuning';

export interface WishReward {
  /** Stardust granted on completion */
  stardust?: number;
  /** Health added to every tree (growth gets half) */
  healTrees?: number;
  /** Water added to every lake */
  refillLakes?: number;
}

export interface WishDef {
  id: WishId;
  /** Deadline = startedAt + durationDays * dayLength */
  durationDays: number;
  condition: WishCondition;
  reward: WishReward;
}

/**
 * Wish catalog. Numeric values are deliberately simple constants so they are
 * easy to locate, test, and retune without a config framework.
 */
export const WISH_DEFS: WishDef[] = [
  {
    id: 'forestWish',
    durationDays: 3,
    condition: { kind: 'plantSpeciesCount', species: 'tree', min: 8 },
    reward: { stardust: 12, healTrees: 0.2 },
  },
  {
    id: 'lakeWish',
    durationDays: 2,
    condition: { kind: 'averageLakeWater', min: 0.6 },
    reward: { stardust: 8, refillLakes: 0.1 },
  },
  {
    id: 'rabbitWish',
    durationDays: 3,
    condition: { kind: 'animalSpeciesCount', species: 'rabbit', min: 6 },
    reward: { stardust: 10 },
  },
  {
    id: 'stabilityWish',
    durationDays: 2,
    condition: { kind: 'stability', min: 0.6 },
    reward: { stardust: 12 },
  },
];

const WISH_LABELS: Record<WishId, { title: string; hint: string }> = {
  forestWish: { title: '一片树林', hint: '在期限内让星球拥有 8 棵树' },
  lakeWish: { title: '丰盈的水', hint: '把湖泊平均水位提升到 60% 以上' },
  rabbitWish: { title: '热闹的兔群', hint: '让兔子数量达到 6 只' },
  stabilityWish: { title: '安稳的生态', hint: '把生态稳定度提升到 60%' },
};

export function wishLabel(id: WishId): { title: string; hint: string } {
  return WISH_LABELS[id];
}

export function findWishDef(id: WishId): WishDef {
  return WISH_DEFS.find((d) => d.id === id) ?? WISH_DEFS[0];
}

/** Current measured value and target for a condition. */
function conditionValue(world: GameWorldState, c: WishCondition): { value: number; target: number } {
  switch (c.kind) {
    case 'plantSpeciesCount':
      return { value: world.plants.filter((p) => p.species === c.species).length, target: c.min };
    case 'animalSpeciesCount':
      return { value: world.animals.filter((a) => a.species === c.species).length, target: c.min };
    case 'averageLakeWater': {
      const lakes = world.planet.lakes;
      const avg = lakes.length ? lakes.reduce((s, l) => s + l.water, 0) / lakes.length : 0;
      return { value: avg, target: c.min };
    }
    case 'stability':
      return { value: world.stats.stability, target: c.min };
  }
}

/** 0..1 progress toward a condition (>= 1 means satisfied). */
export function wishProgress(world: GameWorldState, c: WishCondition): number {
  const { value, target } = conditionValue(world, c);
  if (target <= 0) return 1;
  return Math.min(1, Math.max(0, value / target));
}

function applyReward(world: GameWorldState, reward: WishReward): void {
  if (reward.stardust) world.resources.stardust += reward.stardust;
  if (reward.healTrees) {
    for (const p of world.plants) {
      if (p.species !== 'tree') continue;
      p.health = Math.min(1, p.health + reward.healTrees);
      p.growth = Math.min(1, p.growth + reward.healTrees * 0.5);
    }
  }
  if (reward.refillLakes) {
    for (const lake of world.planet.lakes) {
      lake.water = Math.min(1, lake.water + reward.refillLakes);
    }
  }
}

function offerWish(world: GameWorldState): void {
  const index = (world.wishesCompleted + world.wishesFailed) % WISH_DEFS.length;
  const def = WISH_DEFS[index];
  world.wish = {
    id: def.id,
    startedAt: world.time.gameTime,
    deadline: world.time.gameTime + def.durationDays * world.time.dayLength,
    progress: 0,
  };
  pushLog(world, `星球低语：${wishLabel(def.id).title}。`, 'wish');
}

function completeWish(world: GameWorldState, def: WishDef): void {
  applyReward(world, def.reward);
  world.wishesCompleted += 1;
  world.wish = null;
  world.nextWishIn = WISH_GAP_DAYS * world.time.dayLength;
  pushLog(world, `愿望达成：${wishLabel(def.id).title}。`, 'wish');
  refreshStats(world);
}

function failWish(world: GameWorldState, def: WishDef): void {
  world.wishesFailed += 1;
  world.wish = null;
  world.nextWishIn = WISH_GAP_DAYS * world.time.dayLength;
  pushLog(world, `愿望错失：${wishLabel(def.id).title}。`, 'wish');
}

/**
 * Advance the wish loop by `dt` game-seconds. Called from the eco tick.
 * Offer a wish when idle, otherwise track progress and resolve it.
 */
export function tickWishes(world: GameWorldState, dt: number): void {
  if (!world.wish) {
    world.nextWishIn -= dt;
    if (world.nextWishIn <= 0) offerWish(world);
    return;
  }
  const def = findWishDef(world.wish.id);
  world.wish.progress = wishProgress(world, def.condition);
  if (world.wish.progress >= 1) {
    completeWish(world, def);
  } else if (world.time.gameTime >= world.wish.deadline) {
    failWish(world, def);
  }
}

export type { PlanetWish };
