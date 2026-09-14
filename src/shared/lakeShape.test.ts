import { describe, expect, it } from 'vitest';
import type { LakeCenter } from './types';
import { normalize, v3 } from './math';
import { lakeAzimuth, lakeShoreFactorByAngle, lakeShoreRadius } from './lakeShape';

const lake: LakeCenter = {
  normal: normalize(v3(), v3(0.35, 0.2, 0.9)),
  radius: 0.38,
  water: 0.8,
};

describe('lakeShape', () => {
  it('is deterministic and bounded', () => {
    for (let i = 0; i < 32; i++) {
      const theta = (i / 32) * Math.PI * 2;
      const f = lakeShoreFactorByAngle(lake, theta);
      expect(f).toBeGreaterThan(0.7);
      expect(f).toBeLessThan(1.3);
      expect(lakeShoreFactorByAngle(lake, theta)).toBe(f);
    }
  });

  it('is non-circular (varies with azimuth)', () => {
    const f0 = lakeShoreFactorByAngle(lake, 0);
    const f1 = lakeShoreFactorByAngle(lake, Math.PI / 2);
    expect(Math.abs(f0 - f1)).toBeGreaterThan(0.02);
  });

  it('exposes a consistent shoreline radius for a direction', () => {
    const dir = normalize(v3(), v3(0.5, 0.3, 0.8));
    const r = lakeShoreRadius(lake, dir);
    expect(r).toBeCloseTo(lake.radius * lakeShoreFactorByAngle(lake, lakeAzimuth(lake, dir)));
    expect(r).toBeGreaterThan(0);
  });
});
