import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { localToWorldNormal, v3, normalize } from '../shared/math';

describe('localToWorldNormal vs Three.js planetGroup', () => {
  it('matches Object3D rotation.set(x, y, 0) default XYZ order', () => {
    const local = normalize(v3(), v3(0.2, 0.5, 0.84));
    const rotX = 0.35;
    const rotY = 1.2;

    const ours = localToWorldNormal(v3(), local, rotX, rotY);

    const group = new THREE.Group();
    group.rotation.set(rotX, rotY, 0);
    group.updateMatrixWorld(true);
    const theirs = new THREE.Vector3(local.x, local.y, local.z)
      .applyEuler(group.rotation)
      .normalize();

    const err = Math.hypot(ours.x - theirs.x, ours.y - theirs.y, ours.z - theirs.z);
    console.log('ours', ours, 'theirs', theirs, 'err', err);
    expect(err).toBeLessThan(1e-6);
  });
});
