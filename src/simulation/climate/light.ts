import type { Vec3Like } from '../../shared/types';
import { localToWorldNormal, normalize, v3 } from '../../shared/math';

/** Fixed sun direction in world space (unit). */
export const SUN_DIRECTION: Vec3Like = normalize(v3(), v3(1, 0.25, 0.55));

export type LightBand = 'day' | 'dusk' | 'night';

/**
 * How much sunlight a surface normal receives.
 * 1 = facing sun, 0 = terminator or night.
 */
export function lightAmount(worldNormal: Vec3Like, sunDir: Vec3Like = SUN_DIRECTION): number {
  const d =
    worldNormal.x * sunDir.x + worldNormal.y * sunDir.y + worldNormal.z * sunDir.z;
  return Math.max(0, d);
}

/** 0..1 wrap of Y spin — one full turn is one solar day of self-rotation. */
export function solarPhase(rotationY: number): number {
  const t = rotationY / (Math.PI * 2);
  return t - Math.floor(t);
}

/**
 * Sunlight a local-space surface normal receives after the planet's orientation
 * is applied. Same transform the simulation and the renderer use.
 */
export function orientedLight(
  localNormal: Vec3Like,
  rotationX: number,
  rotationY: number,
  sunDir: Vec3Like = SUN_DIRECTION,
): number {
  return lightAmount(localToWorldNormal(v3(), localNormal, rotationX, rotationY), sunDir);
}

export function lightBand(amount: number): LightBand {
  // Wider dusk so the terminator is clearly "not night" and animals wake
  if (amount > 0.18) return 'day';
  if (amount > 0.04) return 'dusk';
  return 'night';
}

/**
 * How long this surface point has been in extreme light/dark, roughly.
 * Used for drought / freeze pressure. We approximate with a signed score:
 * positive = currently lit, negative = currently dark, integrated over time by caller.
 */
export function exposureTarget(amount: number): number {
  // Day contributes +, night contributes mild -
  if (amount > 0.25) return (amount - 0.25) * 2;
  if (amount < 0.02) return -0.6;
  return 0;
}
