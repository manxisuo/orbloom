import { describe, expect, it } from 'vitest';
import { isCoarsePointer, isMobileExperience, isNarrowViewport, watchDevice } from './device';

describe('device detection (no DOM)', () => {
  it('reports non-mobile and is safe to call without a window', () => {
    expect(isNarrowViewport()).toBe(false);
    expect(isCoarsePointer()).toBe(false);
    expect(isMobileExperience()).toBe(false);
  });

  it('watchDevice returns a no-op unsubscribe', () => {
    const stop = watchDevice(() => {
      throw new Error('should not fire without matchMedia');
    });
    expect(typeof stop).toBe('function');
    expect(() => stop()).not.toThrow();
  });
});
