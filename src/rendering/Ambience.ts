import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { terrainHeightAt } from '../shared/terrain';

/**
 * Ambient/backdrop layer: starfield, clouds, fireflies, bird flocks and
 * mechanical beacons. Self-contained — owns its groups and animation state,
 * and only needs a scene + parent (planet) to attach to.
 */
export class Ambience {
  private scene: THREE.Object3D;
  private parent: THREE.Object3D;
  private starGroup = new THREE.Group();
  private cloudGroup = new THREE.Group();
  private flockGroup = new THREE.Group();
  private flockPhase = 0;
  private fireflyPoints: THREE.Points | null = null;
  private fireflyPhase = 0;
  private machineGroup = new THREE.Group();
  private machineSpin = 0;

  constructor(scene: THREE.Object3D, parent: THREE.Object3D) {
    this.scene = scene;
    this.parent = parent;
    this.buildStars();
    this.buildClouds();
    this.buildFlocks();
    this.buildFireflies();
    this.buildMachines();
  }

  /** Nudge the bird flocks to a closer fly-by (migrating-birds event). */
  nudgeFlocks(phase: number): void {
    this.flockPhase = phase;
  }

  update(dt: number, opts: { personality: string; mushroomGlow: number; mechanical: boolean }): void {
    this.starGroup.rotation.y += 0.00012;
    this.cloudGroup.rotation.y += 0.0004;
    this.updateFlocks(dt);
    this.updateFireflies(dt, opts.personality, opts.mushroomGlow);
    this.updateMachines(dt, opts.mechanical);
  }

  private buildStars(): void {
    // Pixel-sized, unfogged starfield (distance fog was erasing far points)
    const layers: { count: number; rMin: number; rMax: number; size: number; color: number; opacity: number }[] = [
      { count: 500, rMin: 22, rMax: 40, size: 1.2, color: 0xa8b8d8, opacity: 0.65 },
      { count: 320, rMin: 24, rMax: 45, size: 1.8, color: 0xd8e4ff, opacity: 0.85 },
      { count: 70, rMin: 22, rMax: 38, size: 2.6, color: 0xfff0d0, opacity: 0.7 },
    ];

    for (const layer of layers) {
      const positions = new Float32Array(layer.count * 3);
      const colors = new Float32Array(layer.count * 3);
      const base = new THREE.Color(layer.color);
      for (let i = 0; i < layer.count; i++) {
        const r = layer.rMin + Math.random() * (layer.rMax - layer.rMin);
        const theta = Math.random() * Math.PI * 2;
        const band = (Math.random() + Math.random() + Math.random()) / 3;
        const phi = Math.PI * 0.35 + band * Math.PI * 0.3;
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.cos(phi) * 0.55 + (Math.random() - 0.5) * 6;
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

        const tint = 0.85 + Math.random() * 0.3;
        colors[i * 3] = base.r * tint;
        colors[i * 3 + 1] = base.g * tint;
        colors[i * 3 + 2] = Math.min(1, base.b * tint * 1.05);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const pts = new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          size: layer.size,
          sizeAttenuation: false,
          vertexColors: true,
          transparent: true,
          opacity: layer.opacity,
          depthWrite: false,
          fog: false,
        }),
      );
      pts.renderOrder = -1;
      this.starGroup.add(pts);
    }

    // Soft dust band (also unfogged)
    const dustCount = 180;
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      const r = 28 + Math.random() * 12;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.PI * 0.42 + (Math.random() - 0.5) * 0.22;
      dustPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      dustPos[i * 3 + 1] = r * Math.cos(phi) * 0.5;
      dustPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        color: 0x7a8ab8,
        size: 4,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        fog: false,
      }),
    );
    dust.renderOrder = -1;
    this.starGroup.add(dust);
    this.scene.add(this.starGroup);
  }

  private buildClouds(): void {
    // Soft unlit puffs so they never read as rocks on the night side
    const cloudMat = new THREE.MeshBasicMaterial({
      color: 0xf4f7ff,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    const radius = 1;
    for (let i = 0; i < 9; i++) {
      const puff = new THREE.Group();
      const lobes = 3 + Math.floor(Math.random() * 3);
      for (let j = 0; j < lobes; j++) {
        const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.05 + Math.random() * 0.04, 8, 6), cloudMat);
        lobe.position.set((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.08);
        lobe.scale.set(1.4 + Math.random() * 0.8, 0.35 + Math.random() * 0.15, 0.9 + Math.random() * 0.4);
        puff.add(lobe);
      }
      const n = new THREE.Vector3().randomDirection();
      // Keep clouds off the poles a bit so they hug the visible band
      n.y *= 0.55;
      n.normalize();
      puff.position.copy(n.multiplyScalar(radius + 0.16 + Math.random() * 0.05));
      puff.lookAt(0, 0, 0);
      this.cloudGroup.add(puff);
    }
    this.parent.add(this.cloudGroup);
  }

  /** Low-poly beacons / robots that appear on mechanical planets. */
  private buildMachines(): void {
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x9aa8b8,
      metalness: 0.55,
      roughness: 0.35,
      flatShading: true,
    });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0x7ef0d0 });
    const spots = [
      { n: new THREE.Vector3(0.4, 0.35, 0.85).normalize(), s: 1 },
      { n: new THREE.Vector3(-0.7, 0.2, 0.55).normalize(), s: 0.85 },
      { n: new THREE.Vector3(0.1, -0.55, 0.8).normalize(), s: 0.75 },
      { n: new THREE.Vector3(0.85, -0.1, -0.4).normalize(), s: 0.9 },
    ];
    for (const spot of spots) {
      const bot = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.03, 6), bodyMat);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.04), bodyMat);
      tower.position.y = 0.045;
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), lampMat);
      lamp.position.y = 0.09;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.012), bodyMat);
      arm.position.set(0.035, 0.05, 0);
      bot.add(base, tower, lamp, arm);
      bot.scale.setScalar(spot.s);
      const ground = terrainHeightAt(spot.n.x, spot.n.y, spot.n.z);
      bot.position.copy(spot.n).multiplyScalar(1 + ground + 0.01);
      bot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), spot.n);
      this.machineGroup.add(bot);
    }
    // Visibility is driven by updateMachines() via the group, so children stay visible.
    this.machineGroup.visible = false;
    this.parent.add(this.machineGroup);
  }

  private updateMachines(dt: number, mechanical: boolean): void {
    this.machineSpin += dt;
    this.machineGroup.visible = mechanical;
    if (!mechanical) return;
    this.machineGroup.children.forEach((bot, i) => {
      bot.rotateY(dt * (0.4 + i * 0.1));
      const lamp = bot.children[2] as THREE.Mesh | undefined;
      if (lamp) lamp.visible = Math.sin(this.machineSpin * 6 + i) > 0;
    });
  }

  private buildFireflies(): void {
    const count = 80;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 1.08 + Math.random() * 0.25;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.fireflyPoints = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xc8ffb0,
        size: 2.2,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.parent.add(this.fireflyPoints);
  }

  private updateFireflies(dt: number, personality: string, mushroomGlow: number): void {
    if (!this.fireflyPoints) return;
    this.fireflyPhase += dt;
    // More fireflies when nightGlow or many glowing mushrooms
    const target = personality === 'nightGlow' ? 0.85 : Math.min(0.55, 0.08 + mushroomGlow * 0.4);
    const mat = this.fireflyPoints.material as THREE.PointsMaterial;
    mat.opacity += (target - mat.opacity) * Math.min(1, dt * 2);
    this.fireflyPoints.rotation.y += dt * 0.08;
    this.fireflyPoints.rotation.x = Math.sin(this.fireflyPhase * 0.15) * 0.05;
    const pos = this.fireflyPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setY(i, y + Math.sin(this.fireflyPhase * 1.4 + i) * dt * 0.02);
    }
    pos.needsUpdate = true;
  }

  /** Ambient bird flocks circling the planet — visible as they pass the back side. */
  private buildFlocks(): void {
    const dark = new THREE.MeshBasicMaterial({ color: 0x2c3344, transparent: true, opacity: 0.9 });
    const birdGeo = makeBirdGeometry();
    for (let f = 0; f < 2; f++) {
      const flock = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const bird = new THREE.Mesh(birdGeo, dark);
        bird.position.set((Math.random() - 0.5) * 0.22, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.1);
        flock.add(bird);
      }
      flock.userData.phase = f * Math.PI;
      flock.userData.tilt = 0.25 + f * 0.15;
      this.flockGroup.add(flock);
    }
    this.scene.add(this.flockGroup);
  }

  private updateFlocks(dt: number): void {
    this.flockPhase += dt * 0.22;
    const R = 1.55;
    this.flockGroup.children.forEach((flock, i) => {
      const phase = this.flockPhase + (flock.userData.phase as number);
      const tilt = flock.userData.tilt as number;
      flock.position.set(
        Math.cos(phase) * R,
        Math.sin(phase * 0.7 + i) * 0.35 * tilt,
        Math.sin(phase) * R,
      );
      // Face along orbit direction
      flock.rotation.y = -phase + Math.PI / 2;
      flock.rotation.x = Math.sin(phase * 1.3) * 0.2;
      flock.children.forEach((c, j) => {
        c.position.y = (j - 2) * 0.03 + Math.sin(this.flockPhase * 8 + j) * 0.04;
      });
    });
  }

  dispose(): void {
    this.scene.remove(this.starGroup);
    this.scene.remove(this.flockGroup);
    this.parent.remove(this.cloudGroup);
    this.parent.remove(this.machineGroup);
    if (this.fireflyPoints) {
      this.parent.remove(this.fireflyPoints);
      this.fireflyPoints = null;
    }
    disposeObject(this.starGroup);
    disposeObject(this.cloudGroup);
    disposeObject(this.flockGroup);
    disposeObject(this.machineGroup);
  }
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  });
}

/** Small low-poly bird: body + head + two swept wings + tail, facing -X. */
function makeBirdGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const body = new THREE.SphereGeometry(0.02, 6, 5);
  body.scale(1.9, 0.8, 0.8);
  parts.push(body);

  const head = new THREE.SphereGeometry(0.013, 5, 4);
  head.translate(-0.035, 0.006, 0);
  parts.push(head);

  const tail = new THREE.ConeGeometry(0.013, 0.04, 4);
  tail.rotateZ(-Math.PI / 2); // apex toward +X
  tail.scale(1, 0.4, 1.7); // flatten and widen the fan
  tail.translate(0.045, 0, 0);
  parts.push(tail);

  for (const side of [-1, 1]) {
    const wing = new THREE.BoxGeometry(0.024, 0.003, 0.06);
    wing.translate(0, 0, side * 0.03); // root at origin, sweeping outward
    wing.rotateX(side * 0.5); // dihedral: tips up
    wing.rotateY(side * 0.25); // sweep back
    wing.translate(0.004, 0.006, 0);
    parts.push(wing);
  }

  const geo = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  return geo;
}
