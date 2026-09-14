import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EntityLayer } from './EntityLayer';
import { createWorld } from '../simulation/WorldSimulation';
import { makePlant } from '../simulation/actions';
import { normalize, v3 } from '../shared/math';
import type { Vec3Like } from '../shared/types';

function castAt(ray: THREE.Raycaster, normal: Vec3Like): THREE.Raycaster {
  const dir = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
  ray.set(dir.clone().multiplyScalar(5), dir.clone().negate());
  return ray;
}

describe('EntityLayer instanced picking', () => {
  it('picks a grass added after the first raycast (bounds refresh)', () => {
    const a = normalize(v3(), v3(0, 1, 0));
    const b = normalize(v3(), v3(1, 0.2, 0.3));

    const world = createWorld(1);
    world.plants = [makePlant('grass', a, 0.6)];
    world.animals = [];

    const layer = new EntityLayer(new THREE.Group());
    layer.sync(world);

    // First pick populates the InstancedMesh bounding-sphere cache.
    const ray = new THREE.Raycaster();
    const first = layer.pick(castAt(ray, a));
    expect(first?.type).toBe('plant');

    // A grass planted far from the first one must still be pickable.
    world.plants.push(makePlant('grass', b, 0.6));
    layer.sync(world);

    const second = layer.pick(castAt(ray, b));
    expect(second?.type).toBe('plant');
    expect((second as { plant: { id: string } }).plant.id).toBe(world.plants[1]!.id);
  });
});
