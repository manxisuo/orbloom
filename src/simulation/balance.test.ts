import { describe, expect, it } from 'vitest';
import type { EventId, GameWorldState } from '../shared/types';
import { mulberry32, normalize, randomOnSphere, v3 } from '../shared/math';
import {
  createBudget,
  createWorld,
  plantTreeAt,
  rain,
  resolvePendingEvent,
  tickWorld,
} from './WorldSimulation';
import { EVENT_DEFS, findEventDef } from './events/eventCards';

/**
 * Deterministic balance harness (not a pass/fail spec).
 *
 * Runs a fixed-seed "caretaker" playthrough of N game-days and prints a daily
 * report, then asserts only cheap invariants. Useful for checking pacing,
 * event frequency, wish loop and stardust flow after tuning changes.
 *
 * It also prints a per-event consequence report covering every event kind, so
 * event tradeoffs can be reviewed without relying on a 15-day draw to surface
 * each one.
 *
 * Run just this file:
 *   npx vitest run src/simulation/balance.test.ts --disableConsoleIntercept
 */

const SEED = 2026;
const DAYS = 15;
const DT = 1 / 30;

function speciesCounts(world: GameWorldState) {
  const c = { tree: 0, grass: 0, flower: 0, mushroom: 0, rabbit: 0, bee: 0, fox: 0 };
  for (const p of world.plants) c[p.species]++;
  for (const a of world.animals) c[a.species]++;
  return c;
}

function averageLake(world: GameWorldState): number {
  const lakes = world.planet.lakes;
  return lakes.length ? lakes.reduce((s, l) => s + l.water, 0) / lakes.length : 0;
}

function sumHealthOf(plants: { health: number }[]): number {
  return plants.reduce((s, p) => s + p.health, 0);
}

function sumGrowthOf(plants: { growth: number }[]): number {
  return plants.reduce((s, p) => s + p.growth, 0);
}

function sumHealth(world: GameWorldState): number {
  return sumHealthOf(world.plants);
}

function sumGrowth(world: GameWorldState): number {
  return sumGrowthOf(world.plants);
}

function machineScore(world: GameWorldState): number {
  return world.modifiers.machineScore ?? 0;
}

/** A sensible planting spot: jittered toward a lake so the plant can find water. */
function plantSpot(world: GameWorldState, rng: () => number) {
  const lakes = world.planet.lakes;
  const c = lakes.length ? lakes[Math.floor(rng() * lakes.length)].normal : { x: 0, y: 1, z: 0 };
  const n = randomOnSphere(v3(), rng);
  const t = 0.7;
  return normalize(
    v3(),
    v3(n.x + (c.x - n.x) * t, n.y + (c.y - n.y) * t, n.z + (c.z - n.z) * t),
  );
}

/** A simple, deterministic "reasonable player" policy. */
function caretaker(world: GameWorldState, rng: () => number): void {
  if (averageLake(world) < 0.35) {
    rain(world);
    return;
  }
  const c = speciesCounts(world);
  if (c.tree < 8 && world.resources.stardust >= 5) {
    plantTreeAt(world, plantSpot(world, rng));
    return;
  }
  if (c.grass < 30 && world.resources.stardust >= 2) {
    plantTreeAt(world, plantSpot(world, rng), 'grass');
  }
}

/**
 * A weighing player: accept an event only when its benefit beats its cost for
 * the current planet, otherwise decline. Mirrors the tradeoffs written into the
 * event definitions, so the report reflects real decisions instead of "accept
 * everything".
 */
function decideEvent(world: GameWorldState, id: EventId): boolean {
  const c = speciesCounts(world);
  const st = world.resources.stardust;
  const lake = averageLake(world);
  switch (id) {
    case 'drought':
      // Pay to postpone only when we can afford it.
      return !(st >= 8);
    case 'coldNight':
      return !(st >= 6);
    case 'meteor':
      // Worth the minerals only on barren ground; a lush planet would scorch.
      return c.tree + c.grass + c.flower + c.mushroom < 20;
    case 'strangeSeed':
      // Only worth the crowding when we still need plants.
      return c.grass < 30 && world.plants.length < 300 && st >= 2;
    case 'migratingBirds':
      // Welcome the gift unless the grass is already overgrazed.
      return sumGrowth(world) > 8 || st >= 6;
    case 'mechanicalVisitor':
      // Machinery trades grass for repair and commits to a mechanical planet.
      return machineScore(world) >= 2 || (c.grass > 25 && c.flower >= 2);
    case 'planetWhisper':
      return st >= 4 && c.tree < 12;
    case 'gentleRain':
      // Take the water only when dry; skip the lingering chill otherwise.
      return world.modifiers.droughtDays > 0 || lake < 0.45;
    case 'wildHarvest':
      // Protect ecosystem health when it is fragile.
      return world.stats.averageHealth >= 0.7;
  }
}

function formatDay(world: GameWorldState, day: number): string {
  const c = speciesCounts(world);
  const s = world.stats;
  const pct = (n: number) => `${Math.round(n * 100)}%`.padStart(4);
  return [
    `D${String(day).padStart(2)}`,
    `dust ${String(Math.floor(world.resources.stardust)).padStart(4)}`,
    `tree ${String(c.tree).padStart(2)} grass ${String(c.grass).padStart(2)} flower ${String(c.flower).padStart(2)} mush ${c.mushroom}`,
    `rab ${String(c.rabbit).padStart(2)} bee ${c.bee} fox ${c.fox}`,
    `lake ${pct(averageLake(world))}`,
    `health ${pct(s.averageHealth)}`,
    `stab ${pct(s.stability)}`,
    world.personality.padEnd(9),
    `wish ${world.wish ? world.wish.id : '-'} (ok ${world.wishesCompleted} / miss ${world.wishesFailed})`,
  ].join(' | ');
}

interface EventStat {
  count: number;
  accepted: number;
  declined: number;
}

function playthrough() {
  const world = createWorld(SEED);
  const budget = createBudget();
  const playerRng = mulberry32(SEED ^ 0x9e3779b9);
  const dayLength = world.time.dayLength;
  const totalSeconds = DAYS * dayLength;
  // Self-spin already turns one revolution per game day; do not add extra drag.

  const rows: string[] = [];
  const eventStats = new Map<EventId, EventStat>();

  let actionAcc = 0;
  let dayMark = 0;

  for (let t = 0; t < totalSeconds; t += DT) {
    tickWorld(world, budget, DT);

    if (world.pendingEvent) {
      const id = world.pendingEvent.id;
      const stat = eventStats.get(id) ?? { count: 0, accepted: 0, declined: 0 };
      stat.count++;
      const accept = decideEvent(world, id);
      resolvePendingEvent(world, accept);
      if (accept) stat.accepted++;
      else stat.declined++;
      eventStats.set(id, stat);
    }

    actionAcc += DT;
    if (actionAcc >= 1) {
      actionAcc = 0;
      caretaker(world, playerRng);
    }

    if (world.time.gameTime - dayMark >= dayLength) {
      dayMark += dayLength;
      rows.push(formatDay(world, rows.length + 1));
    }
  }

  return { world, rows, eventStats };
}

interface Snapshot {
  stardust: number;
  plants: number;
  health: number;
  growth: number;
  lake: number;
  coldDays: number;
  droughtDays: number;
  machineScore: number;
  delayed: number;
}

function snapshot(world: GameWorldState): Snapshot {
  return {
    stardust: world.resources.stardust,
    plants: world.plants.length,
    health: sumHealth(world),
    growth: sumGrowth(world),
    lake: averageLake(world),
    coldDays: world.modifiers.coldDays,
    droughtDays: world.modifiers.droughtDays,
    machineScore: machineScore(world),
    delayed: world.delayedEvents.length,
  };
}

function diff(a: Snapshot, b: Snapshot): Snapshot {
  return {
    stardust: b.stardust - a.stardust,
    plants: b.plants - a.plants,
    health: b.health - a.health,
    growth: b.growth - a.growth,
    lake: b.lake - a.lake,
    coldDays: b.coldDays - a.coldDays,
    droughtDays: b.droughtDays - a.droughtDays,
    machineScore: b.machineScore - a.machineScore,
    delayed: b.delayed - a.delayed,
  };
}

/**
 * Apply one side of an event to a fresh, comparable world and report the delta.
 * `droughtDays` is pre-seeded so state-dependent decline branches are exercised.
 */
function measure(id: EventId, accept: boolean): Snapshot {
  const world = createWorld(SEED);
  world.resources.stardust = 20;
  world.modifiers.droughtDays = 2;
  const def = findEventDef(id);
  const rng = mulberry32(SEED);
  if ((id === 'meteor' || id === 'strangeSeed') && world.plants[0]) {
    // Aim an existing plant at the deterministic impact point so the report
    // shows the scorch/crowding cost instead of depending on where the draw lands.
    const impact = randomOnSphere(v3(), mulberry32(SEED));
    world.plants[0].position.normal = impact;
    world.plants[0].health = 1;
    world.plants[0].growth = 1;
  }
  const pre = world.plants.slice();
  const before = snapshot(world);
  const preHealthBefore = sumHealthOf(pre);
  const preGrowthBefore = sumGrowthOf(pre);
  if (accept) def.apply(world, rng);
  else def.decline?.(world, rng);
  const delta = diff(before, snapshot(world));
  // Health/growth are measured over plants that existed before the event, so a
  // tradeoff against the established ecosystem stays visible even when the
  // event also adds new plants.
  delta.health = sumHealthOf(pre) - preHealthBefore;
  delta.growth = sumGrowthOf(pre) - preGrowthBefore;
  return delta;
}

function fmt(delta: Snapshot): string {
  const parts: string[] = [];
  const push = (label: string, n: number, digits = 2) => {
    if (Math.abs(n) < 0.005) return;
    parts.push(`${label}${n > 0 ? '+' : ''}${n.toFixed(digits)}`);
  };
  push('dust', delta.stardust, 0);
  push('plants', delta.plants, 0);
  push('hp', delta.health, 1);
  push('gr', delta.growth, 1);
  push('lake', delta.lake);
  push('cold', delta.coldDays, 1);
  push('drought', delta.droughtDays, 1);
  push('machine', delta.machineScore, 0);
  push('delayed', delta.delayed, 0);
  return parts.length ? parts.join(' ') : '(no change)';
}

describe('balance harness', () => {
  it('runs a deterministic 15-day caretaker playthrough and reports metrics', () => {
    const { world, rows, eventStats } = playthrough();
    const c = speciesCounts(world);
    const accepted = [...eventStats.values()].reduce((s, e) => s + e.accepted, 0);
    const declined = [...eventStats.values()].reduce((s, e) => s + e.declined, 0);

    console.log('\n=== Orbloom balance report (seed ' + SEED + ', ' + DAYS + ' days, ' + world.time.dayLength + 's/day) ===');
    for (const r of rows) console.log(r);
    console.log(
      [
        `final: dust ${Math.floor(world.resources.stardust)}`,
        `plants ${world.plants.length} (t${c.tree}/g${c.grass}/f${c.flower}/m${c.mushroom})`,
        `animals ${world.animals.length} (r${c.rabbit}/b${c.bee}/x${c.fox})`,
        `lake ${Math.round(averageLake(world) * 100)}%`,
        `health ${Math.round(world.stats.averageHealth * 100)}%`,
        `stability ${Math.round(world.stats.stability * 100)}%`,
        `personality ${world.personality}`,
        `wishes ok ${world.wishesCompleted} / miss ${world.wishesFailed}`,
        `events accepted ${accepted} / declined ${declined}`,
      ].join(' | '),
    );
    console.log('per-event decisions:');
    for (const def of EVENT_DEFS) {
      const s = eventStats.get(def.id);
      console.log(
        `  ${def.id.padEnd(18)} offered ${s ? s.count : 0}  (accept ${s ? s.accepted : 0} / decline ${s ? s.declined : 0})`,
      );
    }
    console.log('');

    // Cheap invariants: the world stays numerically sane over 15 days.
    expect(Number.isFinite(world.time.gameTime)).toBe(true);
    expect(world.time.gameTime).toBeGreaterThanOrEqual(DAYS * world.time.dayLength);
    expect(Number.isFinite(world.resources.stardust)).toBe(true);
    expect(world.resources.stardust).toBeGreaterThanOrEqual(0);
    expect(world.plants.length).toBeGreaterThanOrEqual(0);
    expect(world.animals.length).toBeGreaterThanOrEqual(0);
    rows.forEach((r) => expect(r.length).toBeGreaterThan(0));
  });

  it('reports both sides of every event as accept/decline deltas', () => {
    const rows = EVENT_DEFS.map((def) => ({
      id: def.id,
      accept: measure(def.id, true),
      decline: measure(def.id, false),
    }));

    console.log('\n=== per-event consequence report (fresh world, dust 20, drought 2; hp/gr = pre-existing plants) ===');
    for (const r of rows) {
      console.log(`${r.id.padEnd(18)} accept ${fmt(r.accept).padEnd(46)} | decline ${fmt(r.decline)}`);
    }
    console.log('');

    // Coverage guard: every declared event must be measured here, so a new
    // event cannot be added without a visible consequence report.
    expect(new Set(rows.map((r) => r.id)).size).toBe(EVENT_DEFS.length);
    expect(rows.map((r) => r.id)).toEqual(EVENT_DEFS.map((d) => d.id));
  });
});
