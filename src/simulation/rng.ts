import type { GameWorldState } from '../shared/types';
import { randomStep } from '../shared/math';

/** Deterministic RNG bound to the world's persisted state. */
export function worldRng(world: GameWorldState): () => number {
  return () => {
    const step = randomStep(world.rngState);
    world.rngState = step.state;
    return step.value;
  };
}
