import type { EventId, GameWorldState, PlantSpecies, Vec3Like } from '../../shared/types';
import { mulberry32, normalize, randomOnSphere, v3 } from '../../shared/math';
import { findEventDef, pickEvent, toPending } from '../events/eventCards';
import { makePlantForEvent } from '../actions';
import { pushLog } from '../log';
import { worldRng } from '../rng';
import { refreshStats } from '../stats';

/** Offer a new event card once the timer elapses. */
export function maybeOfferEvent(world: GameWorldState, step: number, rng: () => number): void {
  if (world.pendingEvent) return;
  world.nextEventIn -= step;
  if (world.nextEventIn > 0) return;
  const def = pickEvent(mulberry32(Math.floor(world.time.gameTime) + world.seed));
  world.pendingEvent = toPending(def);
  world.nextEventIn = 55 + rng() * 40;
  pushLog(world, `事件：${def.title}`, 'event');
}

export function resolvePendingEvent(
  world: GameWorldState,
  accept: boolean,
): { message: string; eventId: EventId; impact?: Vec3Like; accepted: boolean } | null {
  if (!world.pendingEvent) return null;
  const eventId = world.pendingEvent.id;
  const def = findEventDef(eventId);
  const rng = worldRng(world);
  const result = accept
    ? def.apply(world, rng)
    : { message: def.decline?.(world) ?? '事件过去了。' as string };
  const message = typeof result === 'string' ? result : result.message;
  const impact = typeof result === 'string' ? undefined : result.impact;
  world.pendingEvent = null;
  pushLog(world, message, 'event');
  refreshStats(world);
  return { message, eventId, impact, accepted: accept };
}

export function tickDelayedEvents(world: GameWorldState): void {
  if (!world.delayedEvents?.length) return;
  const rng = mulberry32(Math.floor(world.time.gameTime * 17) + world.seed);
  for (let i = world.delayedEvents.length - 1; i >= 0; i--) {
    const ev = world.delayedEvents[i];
    if (world.time.gameTime < ev.fireAt) continue;
    world.delayedEvents.splice(i, 1);
    if (ev.kind === 'birdGift') {
      const n = randomOnSphere(v3(), rng);
      const species: PlantSpecies = rng() < 0.5 ? 'flower' : 'grass';
      for (let k = 0; k < 3; k++) {
        const jitter = randomOnSphere(v3(), rng);
        const mixed = normalize(
          v3(),
          v3(
            n.x + (jitter.x - n.x) * 0.2,
            n.y + (jitter.y - n.y) * 0.2,
            n.z + (jitter.z - n.z) * 0.2,
          ),
        );
        world.plants.push(makePlantForEvent(species, mixed, 0.25 + rng() * 0.2));
      }
      pushLog(world, '候鸟如约归来，留下了远方的种子。', 'event');
    } else if (ev.kind === 'whisperGift') {
      world.resources.stardust += 8;
      let healed = 0;
      for (const p of world.plants) {
        if (p.species === 'tree') {
          p.health = Math.min(1, p.health + 0.2);
          p.growth = Math.min(1, p.growth + 0.12);
          healed++;
        }
      }
      pushLog(
        world,
        healed ? '星球的回响：树木更加葱茏，星尘轻轻洒落。' : '星球的回响：星尘轻轻洒落。',
        'event',
      );
    }
  }
}
