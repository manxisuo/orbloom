import type { GameWorldState } from '../../shared/types';
import { pushLog } from '../log';

const PERSONALITY_LABEL: Record<string, string> = {
  wild: '荒野',
  garden: '花园',
  forest: '森林',
  desert: '荒漠',
  nightGlow: '夜光',
  mechanical: '机械',
  chaos: '混沌',
};

export function updatePersonality(world: GameWorldState): void {
  const plants = world.plants;
  const animals = world.animals;
  const trees = plants.filter((p) => p.species === 'tree').length;
  const flowers = plants.filter((p) => p.species === 'flower').length;
  const grass = plants.filter((p) => p.species === 'grass').length;
  const mushrooms = plants.filter((p) => p.species === 'mushroom' && p.growth > 0.3).length;
  const total = plants.length || 1;
  const avgHealth = plants.reduce((s, p) => s + p.health, 0) / total;
  const avgLake =
    world.planet.lakes.reduce((s, l) => s + l.water, 0) / Math.max(1, world.planet.lakes.length);
  const foxes = animals.filter((a) => a.species === 'fox').length;
  const rabbits = animals.filter((a) => a.species === 'rabbit').length;
  const stressed = plants.filter((p) => p.health < 0.35).length / total;
  const machines = world.modifiers.machineScore ?? 0;

  let next: typeof world.personality = 'wild';
  if (stressed > 0.45 || (foxes >= 2 && rabbits < 4)) next = 'chaos';
  else if (machines >= 3) next = 'mechanical';
  else if (mushrooms >= 6) next = 'nightGlow';
  else if (avgLake < 0.2 && trees < 4) next = 'desert';
  else if (trees >= 10 && avgLake > 0.35) next = 'forest';
  else if (flowers >= 8 && avgHealth > 0.55) next = 'garden';
  else if (grass + flowers > trees * 2 && animals.filter((a) => a.species === 'bee').length >= 2) {
    next = 'garden';
  } else if (trees < 3 && grass < 12) next = 'wild';

  if (next !== world.personality) {
    world.personality = next;
    pushLog(world, `星球性情渐显：${PERSONALITY_LABEL[next] ?? next}星球。`, 'personality');
  }
}

export function personalityLabel(id: string): string {
  return PERSONALITY_LABEL[id] ?? id;
}
