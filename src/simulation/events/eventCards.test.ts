import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../shared/math';
import { createWorld } from '../WorldSimulation';
import { EVENT_DEFS, findEventDef, pickEvent, toPending } from './eventCards';

describe('pickEvent', () => {
  it('maps rng extremes to the first and last weighted defs', () => {
    expect(pickEvent(() => 0).id).toBe(EVENT_DEFS[0].id);
    expect(pickEvent(() => 0.999).id).toBe(EVENT_DEFS[EVENT_DEFS.length - 1].id);
  });

  it('findEventDef falls back to the first def for unknown ids', () => {
    expect(findEventDef('meteor').id).toBe('meteor');
    expect(findEventDef('nope' as never).id).toBe(EVENT_DEFS[0].id);
  });
});

describe('event apply effects', () => {
  it('meteor grants stardust', () => {
    const world = createWorld(1);
    world.resources.stardust = 0;
    findEventDef('meteor').apply(world, mulberry32(1));
    expect(world.resources.stardust).toBe(12);
  });

  it('coldNight and drought set modifiers', () => {
    const cold = createWorld(1);
    findEventDef('coldNight').apply(cold, mulberry32(1));
    expect(cold.modifiers.coldDays).toBeGreaterThanOrEqual(2.5);

    const dry = createWorld(1);
    dry.resources.stardust = 0;
    findEventDef('drought').apply(dry, mulberry32(1));
    expect(dry.modifiers.droughtDays).toBeGreaterThanOrEqual(3);
    expect(dry.resources.stardust).toBe(12);
  });

  it('strangeSeed adds three plants', () => {
    const world = createWorld(1);
    const before = world.plants.length;
    findEventDef('strangeSeed').apply(world, mulberry32(1));
    expect(world.plants.length).toBe(before + 3);
  });

  it('migratingBirds grants stardust and schedules a delayed gift', () => {
    const world = createWorld(1);
    world.resources.stardust = 0;
    findEventDef('migratingBirds').apply(world, mulberry32(1));
    expect(world.resources.stardust).toBe(6);
    expect(world.delayedEvents).toEqual([{ kind: 'birdGift', fireAt: world.time.dayLength * 2.5 }]);
  });

  it('mechanicalVisitor scores the machine personality', () => {
    const world = createWorld(1);
    world.resources.stardust = 0;
    findEventDef('mechanicalVisitor').apply(world, mulberry32(1));
    expect(world.resources.stardust).toBe(9);
    expect(world.modifiers.machineScore).toBe(1);
  });

  it('planetWhisper plants trees, pays stardust and schedules a whisper gift', () => {
    const world = createWorld(1);
    world.resources.stardust = 0;
    const before = world.plants.filter((p) => p.species === 'tree').length;
    findEventDef('planetWhisper').apply(world, mulberry32(1));
    expect(world.plants.filter((p) => p.species === 'tree').length).toBe(before + 3);
    expect(world.resources.stardust).toBe(5);
    expect(world.delayedEvents[0].kind).toBe('whisperGift');
  });

  it('gentleRain raises lake water', () => {
    const world = createWorld(1);
    const before = world.planet.lakes[0].water;
    findEventDef('gentleRain').apply(world, mulberry32(1));
    expect(world.planet.lakes[0].water).toBeGreaterThan(before);
  });

  it('wildHarvest grants at least a base amount of stardust', () => {
    const world = createWorld(1);
    world.resources.stardust = 0;
    const result = findEventDef('wildHarvest').apply(world, mulberry32(1));
    expect(world.resources.stardust).toBeGreaterThanOrEqual(6);
    expect(result.message).toMatch(/星尘/);
  });

  it('declining drought costs stardust and schedules a weaker return', () => {
    const world = createWorld(1);
    world.resources.stardust = 20;
    const result = findEventDef('drought').decline!(world, mulberry32(1));
    const message = typeof result === 'string' ? result : result.message;
    expect(message).toMatch(/推迟/);
    expect(world.resources.stardust).toBe(12);
    expect(world.modifiers.droughtDays).toBe(0);
    expect(world.delayedEvents).toEqual([
      { kind: 'droughtReturn', fireAt: world.time.dayLength * 1.5 },
    ]);
  });

  it('cannot decline a bad event without enough stardust, so it still lands', () => {
    const world = createWorld(1);
    world.resources.stardust = 5;
    const result = findEventDef('drought').decline!(world, mulberry32(1));
    const message = typeof result === 'string' ? result : result.message;
    expect(message).toMatch(/不足/);
    expect(world.resources.stardust).toBe(5);
    expect(world.modifiers.droughtDays).toBeGreaterThanOrEqual(3);
  });

  it('declining coldNight spends stardust and avoids the cold', () => {
    const world = createWorld(1);
    world.resources.stardust = 20;
    findEventDef('coldNight').decline!(world, mulberry32(1));
    expect(world.resources.stardust).toBe(14);
    expect(world.modifiers.coldDays).toBe(0);
  });

  it('accepting migratingBirds grazes grass while its decline is free', () => {
    const world = createWorld(1);
    const grassBefore = world.plants
      .filter((p) => p.species === 'grass')
      .reduce((s, p) => s + p.growth, 0);
    findEventDef('migratingBirds').apply(world, mulberry32(1));
    const grassAfter = world.plants
      .filter((p) => p.species === 'grass')
      .reduce((s, p) => s + p.growth, 0);
    expect(grassAfter).toBeLessThan(grassBefore);

    const declined = findEventDef('migratingBirds').decline!(world, mulberry32(1));
    expect(typeof declined === 'string' ? declined : declined.message).toContain('草地');
  });

  it('toPending copies the presentation fields', () => {
    const def = findEventDef('drought');
    const pending = toPending(def);
    expect(pending).toMatchObject({ id: 'drought', title: def.title, body: def.body });
  });
});
