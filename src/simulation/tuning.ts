/**
 * Central tuning constants.
 *
 * Time is expressed in two units:
 * - `DAY_LENGTH`: real seconds for one full solar day on a NEW planet.
 * - `*_DAYS`: durations in game-days, multiplied by a save's `time.dayLength`
 *   at use time so they scale together with the day length.
 *
 * Only new planets use `DAY_LENGTH`; existing saves keep their stored value.
 */

/** Real seconds for one full solar day on a new planet. */
export const DAY_LENGTH = 60;

/** Rain action cooldown, in game-days. */
export const RAIN_COOLDOWN_DAYS = 0.25;

/** Passive stardust generated per game-day per point of stability. */
export const STARDUST_PER_DAY_PER_STABILITY = 6;

/**
 * Natural lake recharge, per game-day, proportional to how far the lake is
 * below full. Balances evaporation so lakes settle at an equilibrium instead
 * of draining to empty: equilibrium water ≈ 1 - evaporation / recharge.
 */
export const LAKE_RECHARGE_PER_DAY = 0.13;

/** Event cadence, in game-days. */
export const EVENT_FIRST_DAYS = 0.9;
export const EVENT_GAP_MIN_DAYS = 1.2;
export const EVENT_GAP_MAX_DAYS = 2.1;

/** Planet wish cadence, in game-days. */
export const WISH_FIRST_DAYS = 0.33;
export const WISH_GAP_DAYS = 1.2;
