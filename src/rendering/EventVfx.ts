import * as THREE from 'three';
import type { EventId, Vec3Like } from '../shared/types';
import { terrainHeightAt } from '../shared/terrain';

type Fx = {
  obj: THREE.Object3D;
  t: number;
  life: number;
  update: (fx: Fx, dt: number) => void;
};

/**
 * Lightweight one-shot event visuals. Owned by ThreeRenderer.
 */
export class EventVfx {
  private group = new THREE.Group();
  private active: Fx[] = [];
  private parent: THREE.Object3D;

  constructor(parent: THREE.Object3D) {
    this.parent = parent;
    parent.add(this.group);
  }

  play(id: EventId, localNormal: Vec3Like | null, radius: number): void {
    switch (id) {
      case 'meteor':
        this.playMeteor(localNormal, radius);
        break;
      case 'coldNight':
        this.playCold();
        break;
      case 'drought':
        this.playDrought();
        break;
      case 'strangeSeed':
        this.playSeed(localNormal, radius);
        break;
      case 'migratingBirds':
        this.playBirds(radius);
        break;
      case 'mechanicalVisitor':
        this.playMech(localNormal, radius);
        break;
      case 'planetWhisper':
        this.playSeed(localNormal, radius);
        break;
      case 'gentleRain':
        this.playRainVeil();
        break;
      case 'wildHarvest':
        this.playSeed(null, radius);
        break;
    }
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const fx = this.active[i];
      fx.t += dt;
      fx.update(fx, dt);
      if (fx.t >= fx.life) {
        this.group.remove(fx.obj);
        disposeTree(fx.obj);
        this.active.splice(i, 1);
      }
    }
  }

  private surfacePoint(n: Vec3Like | null, radius: number): THREE.Vector3 {
    const nn = n
      ? new THREE.Vector3(n.x, n.y, n.z).normalize()
      : new THREE.Vector3(0.3, 0.4, 0.86).normalize();
    return nn.multiplyScalar(radius + terrainHeightAt(nn.x, nn.y, nn.z));
  }

  private playMeteor(n: Vec3Like | null, radius: number): void {
    const impact = this.surfacePoint(n, radius);
    // Start far out along a diagonal
    const start = impact.clone().normalize().multiplyScalar(radius * 4.5);
    start.x += 1.2;
    start.y += 0.8;

    const trail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.03, 0.55, 6),
      new THREE.MeshBasicMaterial({ color: 0xffc48a, transparent: true, opacity: 0.95 }),
    );
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff2c8 }),
    );
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xff8844, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    const root = new THREE.Group();
    root.add(trail, head, glow);
    root.position.copy(start);
    root.lookAt(impact);
    trail.position.set(0, 0, -0.28);
    this.group.add(root);

    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0, depthWrite: false }),
    );
    flash.position.copy(impact);
    flash.visible = false;
    this.group.add(flash);

    const dir = impact.clone().sub(start);
    const dist = dir.length();
    dir.normalize();

    this.active.push({
      obj: root,
      t: 0,
      life: 1.6,
      update: (fx, dt) => {
        const travel = Math.min(1, fx.t / 0.85);
        root.position.copy(start).addScaledVector(dir, dist * easeIn(travel));
        const mat = trail.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.95 * (1 - travel * 0.3);
        if (travel >= 1 && !flash.visible) {
          flash.visible = true;
          root.visible = false;
        }
        if (flash.visible) {
          const ft = (fx.t - 0.85) / 0.75;
          flash.scale.setScalar(1 + ft * 3.5);
          (flash.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.85 * (1 - ft));
        }
        void dt;
      },
    });

    // flash cleanup tied to same lifetime via separate fx
    this.active.push({
      obj: flash,
      t: 0,
      life: 1.6,
      update: () => {},
    });
  }

  private playCold(): void {
    const count = 80;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 1.15 + Math.random() * 0.9;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xb8d8ff, size: 0.04, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.group.add(pts);
    this.active.push({
      obj: pts,
      t: 0,
      life: 3.2,
      update: (fx) => {
        pts.rotation.y += 0.25 * (1 / 60);
        pts.position.y = -0.15 * fx.t;
        (pts.material as THREE.PointsMaterial).opacity = Math.max(0, 0.9 * (1 - fx.t / 3.2));
      },
    });
  }

  private playDrought(): void {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.25, 0.03, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xe8a050, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    ring.rotation.x = Math.PI / 2.4;
    this.group.add(ring);
    this.active.push({
      obj: ring,
      t: 0,
      life: 2.4,
      update: (fx) => {
        ring.scale.setScalar(1 + fx.t * 0.25);
        ring.rotation.z += 0.4 * (1 / 60);
        (ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.7 * (1 - fx.t / 2.4));
      },
    });
  }

  private playSeed(n: Vec3Like | null, radius: number): void {
    const p = this.surfacePoint(n, radius);
    const sparkle = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.015, 4, 4),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0xa8f0c8 : 0xf0d78c, transparent: true, opacity: 0.95 }),
      );
      const a = (i / 12) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.05, 0.08 + Math.random() * 0.05, Math.sin(a) * 0.05);
      sparkle.add(s);
    }
    sparkle.position.copy(p);
    sparkle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.clone().normalize());
    this.group.add(sparkle);
    this.active.push({
      obj: sparkle,
      t: 0,
      life: 1.8,
      update: (fx) => {
        sparkle.scale.setScalar(1 + fx.t * 1.8);
        sparkle.children.forEach((c) => {
          const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
          m.opacity = Math.max(0, 0.95 * (1 - fx.t / 1.8));
        });
      },
    });
  }

  private playMech(n: Vec3Like | null, radius: number): void {
    const p = this.surfacePoint(n, radius);
    const normal = p.clone().normalize();
    const root = new THREE.Group();
    root.position.copy(p);
    root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);

    const accent = 0x66ffcc;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.07, 0.11),
      new THREE.MeshStandardMaterial({
        color: 0xaab6c6,
        flatShading: true,
        metalness: 0.5,
        roughness: 0.35,
        emissive: 0x14202a,
      }),
    );
    body.position.y = 0.05;
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 8, 8),
      new THREE.MeshBasicMaterial({ color: accent }),
    );
    eye.position.set(0, 0.08, 0.056);

    const beaconMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.95 });
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.2, 6), beaconMat);
    beacon.position.y = 0.17;
    const beaconTip = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), beaconMat);
    beaconTip.position.y = 0.28;

    // On-surface radar ping: expands and repeats
    const ringMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.085, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.003;

    // Vertical light beam so it reads from a distance
    const beamMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.035, 0.55, 10, 1, true), beamMat);
    beam.position.y = 0.275;

    root.add(body, eye, beacon, beaconTip, ring, beam);
    this.group.add(root);

    const eyeMat = eye.material as THREE.MeshBasicMaterial;
    this.active.push({
      obj: root,
      t: 0,
      life: 3,
      update: (fx) => {
        root.rotateY(0.9 * (1 / 60));
        eyeMat.opacity = Math.sin(fx.t * 12) > 0 ? 1 : 0.25;
        beaconTip.scale.setScalar(1 + Math.sin(fx.t * 10) * 0.35);

        const ping = (fx.t % 1) / 1;
        ring.scale.setScalar(1 + ping * 7);
        ringMat.opacity = 0.8 * (1 - ping);

        beamMat.opacity = 0.22 + 0.14 * Math.sin(fx.t * 8);
        beam.scale.x = beam.scale.z = 1 + Math.sin(fx.t * 8) * 0.15;

        if (fx.t > 2.4) {
          root.scale.setScalar(Math.max(0.01, 1 - (fx.t - 2.4) / 0.6));
        }
      },
    });
  }

  private playRainVeil(): void {
    const count = 100;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 1.1 + Math.random() * 0.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0x88c8ff,
        size: 0.03,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    );
    this.group.add(pts);
    this.active.push({
      obj: pts,
      t: 0,
      life: 2.8,
      update: (fx) => {
        pts.position.y = -0.2 * fx.t;
        (pts.material as THREE.PointsMaterial).opacity = Math.max(0, 0.75 * (1 - fx.t / 2.8));
      },
    });
  }

  private playBirds(radius: number): void {
    const flock = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x2a3040, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 7; i++) {
      const bird = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 4), mat);
      bird.rotation.z = Math.PI / 2;
      bird.position.set((Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.15);
      flock.add(bird);
    }
    flock.position.set(-radius * 2.2, radius * 0.9, radius * 0.4);
    this.group.add(flock);
    this.active.push({
      obj: flock,
      t: 0,
      life: 3.5,
      update: (fx, dt) => {
        flock.position.x += dt * radius * 1.1;
        flock.position.y += Math.sin(fx.t * 3) * dt * 0.15;
        flock.children.forEach((c, i) => {
          c.position.y += Math.sin(fx.t * 10 + i) * dt * 0.08;
        });
        const op = fx.t > 2.8 ? 1 - (fx.t - 2.8) / 0.7 : 1;
        mat.opacity = 0.85 * Math.max(0, op);
      },
    });
  }

  dispose(): void {
    for (const fx of this.active) {
      this.group.remove(fx.obj);
      disposeTree(fx.obj);
    }
    this.active.length = 0;
    this.parent.remove(this.group);
  }
}

function easeIn(t: number): number {
  return t * t;
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  });
}
