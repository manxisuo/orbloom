import { describe, expect, it } from 'vitest';
import type { LakeCenter, PlantState, Vec3Like } from '../../shared/types';
import { normalize, v3 } from '../../shared/math';
import { updatePlant } from './growth';
import { evaporateLakes, rainLakes, waterAt } from './water';
import { treeShadeAt } from './shade';

let uid = 0;

function plant(species: PlantState['species'], normal: Vec3Like, over: Partial<PlantState> = {}): PlantState {
  return {
    id: `p_${species}_${uid++}`,
    species,
    position: { normal: normalize(v3(), normal), altitude: 0 },
    age: 0,
    health: 1,
    water: 0.4,
    growth: 0.2,
    ...over,
  };
}

const grass = (n: Vec3Like, over?: Partial<PlantState>) => plant('grass', n, over);

describe('updatePlant', () => {
  it('grass grows and stays healthy in daylight with water', () => {
    const p = grass(v3(0, 1, 0));
    updatePlant(p, { light: 0.9, soilWater: 0.5, dtDays: 1 });
    expect(p.growth).toBeGreaterThan(0.2);
    expect(p.health).toBeGreaterThan(0.9);
  });

  it('strong sun + near-zero water harms health and slows growth', () => {
    const dry = grass(v3(0, 1, 0), { growth: 0.3 });
    const wet = grass(v3(0, 1, 0), { growth: 0.3 });
    updatePlant(dry, { light: 0.9, soilWater: 0.02, dtDays: 1 });
    updatePlant(wet, { light: 0.9, soilWater: 0.5, dtDays: 1 });
    expect(dry.health).toBeLessThan(1);
    expect(dry.health).toBeLessThan(wet.health);
    expect(dry.growth).toBeLessThan(wet.growth);
  });

  it('mushroom grows at night and withers in full sun', () => {
    const night = plant('mushroom', v3(0, 1, 0));
    updatePlant(night, { light: 0.0, soilWater: 0.6, dtDays: 1, shade: 0.2 });
    expect(night.growth).toBeGreaterThan(0.2);

    const day = plant('mushroom', v3(0, 1, 0), { growth: 0.6, health: 1 });
    updatePlant(day, { light: 0.9, soilWater: 0.6, dtDays: 1 });
    expect(day.growth).toBeLessThan(0.6);
    expect(day.health).toBeLessThan(1);
  });

  it('pollination boosts growth more for flowers than grass', () => {
    const flower = plant('flower', v3(0, 1, 0));
    const g = grass(v3(0, 1, 0));
    const deps = { light: 0.9, soilWater: 0.5, dtDays: 1, pollination: 1 };
    updatePlant(flower, { ...deps });
    updatePlant(g, { ...deps });
    expect(flower.growth).toBeGreaterThan(g.growth);
  });
});

describe('waterAt', () => {
  const lakes: LakeCenter[] = [{ normal: v3(0, 1, 0), radius: 0.3, water: 0.8 }];

  it('is wetter at the lake center than far away', () => {
    const center = waterAt(v3(0, 1, 0), lakes);
    const far = waterAt(v3(0, -1, 0), lakes);
    expect(center).toBeGreaterThan(far);
    expect(far).toBeLessThan(0.2);
  });

  it('falls back to a baseline with no lakes', () => {
    expect(waterAt(v3(0, 1, 0), [])).toBe(0.15);
  });
});

describe('evaporateLakes', () => {
  it('always evaporates, and canopy shade slows it', () => {
    const bare: LakeCenter[] = [{ normal: v3(0, 1, 0), radius: 0.3, water: 0.8 }];
    const shaded: LakeCenter[] = [{ normal: v3(0, 1, 0), radius: 0.3, water: 0.8 }];
    const tree = plant('tree', v3(0, 1, 0), { growth: 1, health: 1 });

    evaporateLakes(bare, () => 1, 1);
    evaporateLakes(shaded, () => 1, 1, [tree]);

    expect(bare[0].water).toBeLessThan(0.8);
    expect(shaded[0].water).toBeGreaterThan(bare[0].water);
  });

  it('rainLakes refills but clamps at 1', () => {
    const lakes: LakeCenter[] = [{ normal: v3(0, 1, 0), radius: 0.3, water: 0.95 }];
    rainLakes(lakes, 0.5);
    expect(lakes[0].water).toBe(1);
  });
});

describe('treeShadeAt', () => {
  it('mature trees cast shade nearby but not far, immature ones never', () => {
    const target = v3(0, 1, 0);
    const mature = plant('tree', v3(0, 1, 0), { growth: 1, health: 1 });
    const sapling = plant('tree', v3(0, 1, 0), { growth: 0.1, health: 1 });
    const farTree = plant('tree', v3(0, -1, 0), { growth: 1, health: 1 });

    expect(treeShadeAt([mature], target)).toBeGreaterThan(0);
    expect(treeShadeAt([sapling], target)).toBe(0);
    expect(treeShadeAt([farTree], target)).toBe(0);
  });
});
