import { describe, expect, it } from 'vitest';
import { v3 } from '../../shared/math';
import { SUN_DIRECTION, orientedLight, solarPhase } from './light';

describe('solarPhase', () => {
  it('wraps Y spin into 0..1', () => {
    expect(solarPhase(0)).toBe(0);
    expect(solarPhase(Math.PI * 2)).toBe(0);
    expect(solarPhase(Math.PI)).toBeCloseTo(0.5, 10);
    expect(solarPhase(-Math.PI)).toBeCloseTo(0.5, 10);
  });
});

describe('orientedLight', () => {
  it('matches lightAmount for identity rotation', () => {
    expect(orientedLight(SUN_DIRECTION, 0, 0)).toBeCloseTo(1, 5);
    expect(orientedLight(v3(-SUN_DIRECTION.x, -SUN_DIRECTION.y, -SUN_DIRECTION.z), 0, 0)).toBe(0);
  });

  it('changes as the planet y-spins', () => {
    const local = v3(0, 0, 1);
    const a = orientedLight(local, 0, 0);
    const b = orientedLight(local, 0, Math.PI);
    expect(a).not.toBeCloseTo(b, 2);
  });
});
