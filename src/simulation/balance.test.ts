import { describe, expect, it } from 'vitest';
import type { GameWorldState } from '../shared/types';
import { mulberry32, normalize, randomOnSphere, v3 } from '../shared/math';
import {
  createBudget,
  createWorld,
  plantTreeAt,
  rain,
  resolvePendingEvent,
  tickWorld,
} from './WorldSimulation';

/**
 * Deterministic balance harness (not a pass/fail spec).
 *
 * Runs a fixed-seed "caretaker" playthrough of N game-days and prints a daily
 * report, then asserts only cheap invariants. Useful for checking pacing,
 * event frequency, wish loop and stardust flow after tuning changes.
 *
 * Run just this file:
 *   npx vitest run src/simulation/balance.test.ts
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

function playthrough() {
  const world = createWorld(SEED);
  const budget = createBudget();
  const playerRng = mulberry32(SEED ^ 0x9e3779b9);
  const dayLength = world.time.dayLength;
  const totalSeconds = DAYS * dayLength;
  // Model the core loop: keep the planet turning one revolution per day so every
  // location cycles through day/dusk/night instead of being constantly sunlit.
  const spinPerSecond = (Math.PI * 2) / dayLength;

  const rows: string[] = [];
  const events = { accept: 0, decline: 0 };
  const eventKinds = new Map<string, number>();

  let actionAcc = 0;
  let dayMark = 0;

  for (let t = 0; t < totalSeconds; t += DT) {
    world.planet.spinVelY = spinPerSecond;
    world.planet.spinVelX = 0;
    tickWorld(world, budget, DT);

    if (world.pendingEvent) {
      const id = world.pendingEvent.id;
      eventKinds.set(id, (eventKinds.get(id) ?? 0) + 1);
      // Decline harmful events when we can pay for it; otherwise accept.
      const st = world.resources.stardust;
      const canDecline = (id === 'drought' && st >= 8) || (id === 'coldNight' && st >= 6);
      resolvePendingEvent(world, !canDecline);
      if (canDecline) events.decline++;
      else events.accept++;
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

  return { world, rows, events, eventKinds };
}

describe('balance harness', () => {
  it('runs a deterministic 15-day caretaker playthrough and reports metrics', () => {
    const { world, rows, events, eventKinds } = playthrough();
    const c = speciesCounts(world);
    const kinds = [...eventKinds.entries()].map(([k, n]) => `${k}×${n}`).join(', ') || 'none';

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
        `events accepted ${events.accept} / declined ${events.decline}`,
      ].join(' | '),
    );
    console.log(`event kinds: ${kinds}\n`);

    // Cheap invariants: the world stays numerically sane over 15 days.
    expect(Number.isFinite(world.time.gameTime)).toBe(true);
    expect(world.time.gameTime).toBeGreaterThanOrEqual(DAYS * world.time.dayLength);
    expect(Number.isFinite(world.resources.stardust)).toBe(true);
    expect(world.resources.stardust).toBeGreaterThanOrEqual(0);
    expect(world.plants.length).toBeGreaterThanOrEqual(0);
    expect(world.animals.length).toBeGreaterThanOrEqual(0);
    rows.forEach((r) => expect(r.length).toBeGreaterThan(0));
  });
});
