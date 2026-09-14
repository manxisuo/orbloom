import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AnimalState, GameWorldState, PlantState } from '../shared/types';
import { terrainHeightAt } from '../shared/terrain';
import type { PickResult } from './renderTypes';

interface PlantView {
  root: THREE.Group;
  plant: PlantState;
  canopy: THREE.Mesh;
  trunk?: THREE.Mesh;
}

interface AnimalView {
  root: THREE.Group;
  animal: AnimalState;
}

/**
 * Owns all plant/animal visuals: individual views (trees, mushrooms, rabbits,
 * foxes), instanced batches (grass, flowers, bees), shared geo/material caches
 * and object pools. Everything is parented to the supplied planet group.
 */
export class EntityLayer {
  private parent: THREE.Object3D;
  private plantViews = new Map<string, PlantView>();
  private animalViews = new Map<string, AnimalView>();
  private grassMesh: THREE.InstancedMesh | null = null;
  private flowerMesh: THREE.InstancedMesh | null = null;
  private beeMesh: THREE.InstancedMesh | null = null;
  private grassList: PlantState[] = [];
  private flowerList: PlantState[] = [];
  private beeList: AnimalState[] = [];
  private readonly GRASS_MAX = 512;
  private readonly FLOWER_MAX = 256;
  private readonly BEE_MAX = 16;
  private tmpMat = new THREE.Matrix4();
  private tmpQuat = new THREE.Quaternion();
  private tmpPos = new THREE.Vector3();
  private tmpScale = new THREE.Vector3();
  private tmpColor = new THREE.Color();
  private up = new THREE.Vector3(0, 1, 0);

  // Shared geo/material + object pools (avoid alloc/churn on spawn/despawn)
  private geoCache = new Map<string, THREE.BufferGeometry>();
  private matCache = new Map<string, THREE.Material>();
  private poolTree: THREE.Group[] = [];
  private poolMushroom: THREE.Group[] = [];
  private poolRabbit: THREE.Group[] = [];
  private poolFox: THREE.Group[] = [];

  constructor(parent: THREE.Object3D) {
    this.parent = parent;
  }

  /** Create/update/remove views and instanced batches to match the world. */
  sync(world: GameWorldState): void {
    const { planet, plants, animals } = world;
    const radius = planet.radius;

    // Trees stay individual; grass/flowers batched via InstancedMesh
    this.grassList = [];
    this.flowerList = [];
    const seenPlants = new Set<string>();
    for (const plant of plants) {
      if (plant.species === 'flower') {
        this.flowerList.push(plant);
        continue;
      }
      if (plant.species === 'grass') {
        this.grassList.push(plant);
        continue;
      }
      // trees + mushrooms: individual views (mushroom needs emissive cap)
      seenPlants.add(plant.id);
      let view = this.plantViews.get(plant.id);
      if (!view) {
        view = this.createPlantView(plant);
        this.plantViews.set(plant.id, view);
        this.parent.add(view.root);
      } else {
        view.plant = plant;
      }
      this.updatePlantView(view, radius);
    }
    for (const [id, view] of this.plantViews) {
      if (!seenPlants.has(id)) {
        this.parent.remove(view.root);
        this.releasePlantView(view);
        this.plantViews.delete(id);
      }
    }
    this.syncInstancedPlants(radius);

    // Sync animals — rabbits individual, bees instanced
    this.beeList = [];
    const seenAnimals = new Set<string>();
    for (const animal of animals) {
      if (animal.species === 'bee') {
        this.beeList.push(animal);
        continue;
      }
      seenAnimals.add(animal.id);
      let view = this.animalViews.get(animal.id);
      if (!view) {
        view = this.createAnimalView(animal);
        this.animalViews.set(animal.id, view);
        this.parent.add(view.root);
      } else {
        // Rebind after load/applyWorld — ids match but object identity may not
        view.animal = animal;
      }
      this.updateAnimalView(view, radius);
    }
    for (const [id, view] of this.animalViews) {
      if (!seenAnimals.has(id)) {
        this.parent.remove(view.root);
        this.releaseAnimalView(view);
        this.animalViews.delete(id);
      }
    }
    this.syncBees(radius);
  }

  /** Raycast entity views/batches. Returns null when the ray misses them. */
  pick(raycaster: THREE.Raycaster): PickResult | null {
    const targets: THREE.Object3D[] = [];
    for (const v of this.animalViews.values()) targets.push(v.root);
    for (const v of this.plantViews.values()) targets.push(v.root);
    if (this.grassMesh) targets.push(this.grassMesh);
    if (this.flowerMesh) targets.push(this.flowerMesh);
    if (this.beeMesh) targets.push(this.beeMesh);

    const hitsEntities = raycaster.intersectObjects(targets, true);
    if (hitsEntities.length) {
      const hit = hitsEntities[0];
      const obj = hit.object;

      if (this.beeMesh && (obj === this.beeMesh || obj.parent === this.beeMesh)) {
        const animal = hit.instanceId != null ? this.beeList[hit.instanceId] : undefined;
        if (animal) return { type: 'animal', animal };
      }

      if (this.grassMesh && (obj === this.grassMesh || obj.parent === this.grassMesh)) {
        const plant = hit.instanceId != null ? this.grassList[hit.instanceId] : undefined;
        if (plant) return { type: 'plant', plant };
      }
      if (this.flowerMesh && (obj === this.flowerMesh || obj.parent === this.flowerMesh)) {
        const plant = hit.instanceId != null ? this.flowerList[hit.instanceId] : undefined;
        if (plant) return { type: 'plant', plant };
      }

      let cur: THREE.Object3D | null = obj;
      while (cur) {
        const animal = this.animalViews.get(cur.name);
        if (animal) return { type: 'animal', animal: animal.animal };
        const plantView = this.plantViews.get(cur.name);
        if (plantView) return { type: 'plant', plant: plantView.plant };
        cur = cur.parent;
      }
    }

    return null;
  }

  dispose(): void {
    for (const view of this.plantViews.values()) disposeObject(view.root);
    for (const view of this.animalViews.values()) disposeObject(view.root);
    if (this.grassMesh) {
      this.parent.remove(this.grassMesh);
      disposeObject(this.grassMesh);
      this.grassMesh = null;
    }
    if (this.flowerMesh) {
      this.parent.remove(this.flowerMesh);
      disposeObject(this.flowerMesh);
      this.flowerMesh = null;
    }
    if (this.beeMesh) {
      this.parent.remove(this.beeMesh);
      disposeObject(this.beeMesh);
      this.beeMesh = null;
    }
  }

  private geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geoCache.get(key);
    if (!g) {
      g = make();
      this.geoCache.set(key, g);
    }
    return g;
  }

  private mat(key: string, make: () => THREE.Material): THREE.Material {
    let m = this.matCache.get(key);
    if (!m) {
      m = make();
      this.matCache.set(key, m);
    }
    return m;
  }

  private releasePlantView(view: PlantView): void {
    const species = view.plant.species;
    const pool = species === 'mushroom' ? this.poolMushroom : this.poolTree;
    if (pool.length < 64) {
      view.root.scale.setScalar(1);
      view.root.visible = false;
      pool.push(view.root);
    } else {
      // Shared geo/mat — do not dispose children
      view.root.clear();
    }
  }

  private releaseAnimalView(view: AnimalView): void {
    const pool = view.animal.species === 'fox' ? this.poolFox : this.poolRabbit;
    if (pool.length < 48) {
      view.root.scale.setScalar(1);
      view.root.visible = false;
      pool.push(view.root);
    } else {
      view.root.clear();
    }
  }

  private ensureBeeMesh(): THREE.InstancedMesh {
    if (!this.beeMesh) {
      const parts: THREE.BufferGeometry[] = [];
      // Fat yellow body
      const body = new THREE.SphereGeometry(0.022, 7, 6);
      body.scale(1.15, 0.9, 1.55);
      paintGeo(body, 0xf5c542);
      parts.push(body);
      // Black stripes
      const s1 = new THREE.TorusGeometry(0.02, 0.006, 4, 8);
      s1.rotateX(Math.PI / 2);
      s1.scale(1, 1, 0.7);
      s1.translate(0, 0, 0.01);
      paintGeo(s1, 0x222222);
      parts.push(s1);
      const s2 = s1.clone();
      s2.translate(0, 0, -0.018);
      paintGeo(s2, 0x222222);
      parts.push(s2);
      // Head
      const head = new THREE.SphereGeometry(0.014, 6, 5);
      head.translate(0, 0, 0.032);
      paintGeo(head, 0x2a2a2a);
      parts.push(head);
      // Wings
      const wingMat = 0xd8ecff;
      const wL = new THREE.SphereGeometry(0.018, 5, 4);
      wL.scale(1.8, 0.15, 1);
      wL.translate(-0.022, 0.012, -0.005);
      paintGeo(wL, wingMat);
      parts.push(wL);
      const wR = wL.clone();
      wR.translate(0.044, 0, 0);
      paintGeo(wR, wingMat);
      parts.push(wR);

      const geo = mergeGeometries(parts, false);
      parts.forEach((p) => p.dispose());
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.65,
        transparent: true,
        opacity: 0.95,
      });
      this.beeMesh = new THREE.InstancedMesh(geo!, mat, this.BEE_MAX);
      this.beeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.beeMesh.frustumCulled = false;
      this.beeMesh.castShadow = true;
      this.parent.add(this.beeMesh);
    }
    return this.beeMesh;
  }

  private syncBees(radius: number): void {
    const mesh = this.ensureBeeMesh();
    const count = Math.min(this.beeList.length, this.BEE_MAX);
    const white = this.tmpColor.setHex(0xffffff);
    for (let i = 0; i < count; i++) {
      const b = this.beeList[i];
      const n = new THREE.Vector3(b.position.normal.x, b.position.normal.y, b.position.normal.z);
      const hop = Math.sin(b.hopPhase) * 0.012 + 0.02;
      this.tmpPos.copy(n).multiplyScalar(radius + terrainHeightAt(n.x, n.y, n.z) + hop + 0.05);
      const face = new THREE.Vector3(b.facing.x, b.facing.y, b.facing.z);
      if (face.lengthSq() > 1e-6) {
        const forward = face.projectOnPlane(n).normalize();
        const right = new THREE.Vector3().crossVectors(n, forward).normalize();
        const m = new THREE.Matrix4().makeBasis(right, n, forward);
        this.tmpQuat.setFromRotationMatrix(m);
      } else {
        this.tmpQuat.setFromUnitVectors(this.up, n);
      }
      const bob = 1 + Math.sin(b.hopPhase * 1.7) * 0.08;
      this.tmpScale.set(bob, bob, bob);
      this.tmpMat.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      mesh.setMatrixAt(i, this.tmpMat);
      mesh.setColorAt(i, white);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private ensureInstanced(kind: 'grass' | 'flower'): THREE.InstancedMesh {
    if (kind === 'grass') {
      if (!this.grassMesh) {
        const geo = new THREE.ConeGeometry(0.032, 0.065, 5);
        geo.translate(0, 0.032, 0);
        const mat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          flatShading: true,
          roughness: 0.9,
        });
        this.grassMesh = new THREE.InstancedMesh(geo, mat, this.GRASS_MAX);
        this.grassMesh.castShadow = true;
        this.grassMesh.receiveShadow = true;
        this.grassMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.grassMesh.frustumCulled = false;
        this.parent.add(this.grassMesh);
      }
      return this.grassMesh;
    }
    if (!this.flowerMesh) {
      // Stem (green) + petals (pink-white) + yellow center, baked as vertex colors
      const parts: THREE.BufferGeometry[] = [];
      const stem = new THREE.CylinderGeometry(0.007, 0.01, 0.07, 5);
      stem.translate(0, 0.035, 0);
      paintGeo(stem, 0x3d8f4a);
      parts.push(stem);

      const leaf = new THREE.SphereGeometry(0.016, 5, 4);
      leaf.scale(1.6, 0.35, 0.7);
      leaf.rotateZ(0.6);
      leaf.translate(0.018, 0.04, 0);
      paintGeo(leaf, 0x4caf60);
      parts.push(leaf);

      for (let i = 0; i < 6; i++) {
        const petal = new THREE.SphereGeometry(0.022, 6, 4);
        petal.scale(1.5, 0.28, 0.85);
        const a = (i / 6) * Math.PI * 2;
        petal.rotateY(a);
        petal.translate(Math.cos(a) * 0.022, 0.085, Math.sin(a) * 0.022);
        paintGeo(petal, 0xf7a8c8);
        parts.push(petal);
      }

      const center = new THREE.SphereGeometry(0.016, 6, 5);
      center.translate(0, 0.09, 0);
      paintGeo(center, 0xf0d060);
      parts.push(center);

      const geo = mergeGeometries(parts, false);
      parts.forEach((p) => p.dispose());
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.85,
      });
      this.flowerMesh = new THREE.InstancedMesh(geo!, mat, this.FLOWER_MAX);
      this.flowerMesh.castShadow = true;
      this.flowerMesh.receiveShadow = true;
      this.flowerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.flowerMesh.frustumCulled = false;
      this.parent.add(this.flowerMesh);
    }
    return this.flowerMesh;
  }

  private syncInstancedPlants(radius: number): void {
    this.writeInstances('grass', this.grassList, radius, 0x6dbf5e, 0xa8a05a);
    this.writeInstances('flower', this.flowerList, radius, 0xe88bc4, 0xa8a05a);
  }

  private writeInstances(
    kind: 'grass' | 'flower',
    list: PlantState[],
    radius: number,
    healthyHex: number,
    sickHex: number,
  ): void {
    const mesh = this.ensureInstanced(kind);
    const max = kind === 'grass' ? this.GRASS_MAX : this.FLOWER_MAX;
    const count = Math.min(list.length, max);
    // Flowers keep baked vertex colors; only slight health desaturation via instanceColor
    const healthy = this.tmpColor.setHex(kind === 'flower' ? 0xffffff : healthyHex);
    const sick = new THREE.Color(kind === 'flower' ? 0xc8c090 : sickHex);

    for (let i = 0; i < count; i++) {
      const p = list[i];
      const nx = p.position.normal.x;
      const ny = p.position.normal.y;
      const nz = p.position.normal.z;
      const ground = terrainHeightAt(nx, ny, nz);
      const alt = Math.max(p.position.altitude, ground) + 0.004;
      this.tmpPos.set(nx, ny, nz).multiplyScalar(radius + alt);
      this.tmpQuat.setFromUnitVectors(this.up, this.tmpPos.clone().normalize());
      const s = Math.max(kind === 'flower' ? 0.7 : 0.55, (0.55 + p.growth * 0.9) * (0.8 + p.health * 0.2));
      this.tmpScale.setScalar(s);
      this.tmpMat.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      mesh.setMatrixAt(i, this.tmpMat);

      const c = sick.clone().lerp(healthy, p.health);
      mesh.setColorAt(i, c);
    }

    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private createPlantView(plant: PlantState): PlantView {
    const isMushroom = plant.species === 'mushroom';
    const pool = isMushroom ? this.poolMushroom : this.poolTree;
    const reused = pool.pop();
    if (reused) {
      reused.name = plant.id;
      reused.visible = true;
      const trunk = reused.getObjectByName('trunk') as THREE.Mesh;
      const canopy = reused.getObjectByName('canopy') as THREE.Mesh;
      return { root: reused, plant, canopy, trunk };
    }

    const root = new THREE.Group();
    root.name = plant.id;

    if (isMushroom) {
      const stemMat = this.mat('mushroomStem', () => {
        const m = new THREE.MeshStandardMaterial({ color: 0xd8c8b0, flatShading: true, roughness: 0.9 });
        return m;
      }) as THREE.MeshStandardMaterial;
      // Cap needs unique emissive per instance for glow — clone material only for cap
      const capBase = this.mat('mushroomCapBase', () => {
        const m = new THREE.MeshStandardMaterial({
          color: 0x7ec8ff,
          emissive: 0x3a90c8,
          emissiveIntensity: 0.85,
          flatShading: true,
          roughness: 0.5,
        });
        return m;
      });
      const capMat = capBase.clone();
      const trunk = new THREE.Mesh(
        this.geo('mushroomStem', () => new THREE.CylinderGeometry(0.012, 0.018, 0.04, 5)),
        stemMat,
      );
      trunk.name = 'trunk';
      trunk.position.y = 0.02;
      trunk.castShadow = true;
      const canopy = new THREE.Mesh(
        this.geo('mushroomCap', () => new THREE.SphereGeometry(0.035, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.55)),
        capMat,
      );
      canopy.name = 'canopy';
      canopy.position.y = 0.045;
      canopy.scale.set(1.3, 0.85, 1.3);
      canopy.castShadow = true;
      root.add(trunk, canopy);
      return { root, plant, canopy, trunk };
    }

    const trunkMat = this.mat('treeTrunk', () => {
      return new THREE.MeshStandardMaterial({ color: 0x8b5a3c, flatShading: true, roughness: 0.9 });
    });
    const canopyMat = this.mat('treeCanopy', () => {
      return new THREE.MeshStandardMaterial({ color: 0x3f9b4f, flatShading: true, roughness: 0.85 });
    });
    const trunk = new THREE.Mesh(
      this.geo('treeTrunk', () => new THREE.CylinderGeometry(0.016, 0.026, 0.1, 5)),
      trunkMat,
    );
    trunk.name = 'trunk';
    trunk.position.y = 0.05;
    trunk.castShadow = true;
    const canopy = new THREE.Mesh(
      this.geo('treeCanopy', () => new THREE.IcosahedronGeometry(0.09, 0)),
      canopyMat,
    );
    canopy.name = 'canopy';
    canopy.position.y = 0.15;
    canopy.castShadow = true;
    root.add(trunk, canopy);
    return { root, plant, canopy, trunk };
  }

  private updatePlantView(view: PlantView, radius: number): void {
    const p = view.plant;
    const n = new THREE.Vector3(p.position.normal.x, p.position.normal.y, p.position.normal.z);
    const ground = terrainHeightAt(n.x, n.y, n.z);
    const alt = Math.max(p.position.altitude, ground) + 0.004;
    view.root.position.copy(n).multiplyScalar(radius + alt);
    view.root.quaternion.setFromUnitVectors(this.up, n);
    const s = 0.45 + p.growth * (p.species === 'tree' ? 1.4 : 0.95);
    view.root.scale.setScalar(s * (0.75 + p.health * 0.25));

    if (p.species === 'mushroom' && view.trunk) {
      const stemScale = 0.7 + p.growth * 1.1;
      view.trunk.scale.y = stemScale;
      const stemTop = 0.02 + 0.02 * stemScale;
      view.canopy.position.y = stemTop - 0.008;
      const capScale = 0.85 + p.growth * 0.55;
      view.canopy.scale.set(1.3 * capScale, 0.85 * capScale, 1.3 * capScale);
    } else if (view.trunk) {
      view.trunk.scale.y = 0.7 + p.growth * 1.3;
      view.canopy.position.y = 0.08 + p.growth * 0.12;
    }

    // Health tint — trees share one canopy material, so tint is global-ish (acceptable)
    const mat = view.canopy.material as THREE.MeshStandardMaterial;
    if (p.species === 'mushroom') {
      const glow = 0.4 + p.growth * 0.8;
      mat.emissiveIntensity = glow;
      mat.color.setHex(0x7ec8ff).lerp(new THREE.Color(0xa8e0ff), p.health);
      return;
    }
    const healthy = new THREE.Color(0x3f9b4f);
    const sick = new THREE.Color(0xa8a05a);
    mat.color.copy(sick).lerp(healthy, p.health);
  }

  private createAnimalView(animal: AnimalState): AnimalView {
    const isFox = animal.species === 'fox';
    const pool = isFox ? this.poolFox : this.poolRabbit;
    const reused = pool.pop();
    if (reused) {
      reused.name = animal.id;
      reused.visible = true;
      // Find first mesh as "canopy" stand-in — AnimalView only needs root+animal
      return { root: reused, animal };
    }

    const root = new THREE.Group();
    root.name = animal.id;

    const bodyMat = this.mat(isFox ? 'foxBody' : 'rabbitBody', () => {
      return new THREE.MeshStandardMaterial({
        color: isFox ? 0xe07a3a : 0xf0ebe3,
        flatShading: true,
        roughness: 0.85,
      });
    });
    const accentMat = this.mat(isFox ? 'foxAccent' : 'rabbitAccent', () => {
      return new THREE.MeshStandardMaterial({
        color: isFox ? 0xf5f0e8 : 0xf0b6c8,
        flatShading: true,
        roughness: 0.8,
      });
    });
    const darkMat = this.mat('animalDark', () => {
      return new THREE.MeshStandardMaterial({ color: 0x2a2a2a, flatShading: true });
    });

    const bodyKey = isFox ? 'foxBody' : 'rabbitBody';
    const body = new THREE.Mesh(
      this.geo(bodyKey, () => new THREE.SphereGeometry(isFox ? 0.05 : 0.045, 6, 5)),
      bodyMat,
    );
    body.scale.set(isFox ? 1.0 : 1.1, isFox ? 0.75 : 0.9, isFox ? 1.55 : 1.3);
    body.position.y = 0.048;
    body.castShadow = true;

    const head = new THREE.Mesh(
      this.geo(isFox ? 'foxHead' : 'rabbitHead', () => new THREE.SphereGeometry(isFox ? 0.028 : 0.032, 6, 5)),
      bodyMat,
    );
    head.position.set(0, isFox ? 0.065 : 0.07, isFox ? 0.058 : 0.05);
    head.castShadow = true;

    const snout = new THREE.Mesh(
      this.geo(isFox ? 'foxSnout' : 'rabbitSnout', () => new THREE.ConeGeometry(0.014, 0.03, 5)),
      accentMat,
    );
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, isFox ? 0.058 : 0.062, isFox ? 0.082 : 0.078);

    const earL = new THREE.Mesh(
      this.geo(isFox ? 'foxEar' : 'rabbitEar', () => new THREE.ConeGeometry(0.012, 0.028, 4)),
      bodyMat,
    );
    earL.position.set(-0.016, isFox ? 0.1 : 0.11, isFox ? 0.05 : 0.04);
    const earR = earL.clone();
    earR.position.x = 0.016;

    const eyeGeo = this.geo('animalEye', () => new THREE.SphereGeometry(0.006, 4, 4));
    const eyeL = new THREE.Mesh(eyeGeo, darkMat);
    eyeL.position.set(-0.014, isFox ? 0.072 : 0.078, isFox ? 0.072 : 0.068);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.014;

    const nose = new THREE.Mesh(this.geo('animalNose', () => new THREE.SphereGeometry(0.008, 4, 4)), darkMat);
    nose.position.set(0, isFox ? 0.058 : 0.062, isFox ? 0.095 : 0.09);

    const tail = new THREE.Mesh(
      this.geo(isFox ? 'foxTail' : 'rabbitTail', () =>
        isFox ? new THREE.ConeGeometry(0.022, 0.07, 5) : new THREE.SphereGeometry(0.015, 4, 4),
      ),
      bodyMat,
    );
    if (isFox) {
      tail.rotation.x = -0.9;
      tail.position.set(0, 0.07, -0.07);
    } else {
      tail.position.set(0, 0.05, -0.058);
    }
    tail.castShadow = true;

    root.add(body, head, snout, earL, earR, eyeL, eyeR, nose, tail);
    return { root, animal };
  }

  private updateAnimalView(view: AnimalView, radius: number): void {
    const a = view.animal;
    const n = new THREE.Vector3(a.position.normal.x, a.position.normal.y, a.position.normal.z);
    const sleeping = a.state === 'sleep';
    const hop =
      Math.max(0, Math.sin(a.hopPhase)) * 0.012 * (sleeping ? 0.35 : 1) +
      (sleeping ? 0 : 0.004);
    view.root.position.copy(n).multiplyScalar(radius + terrainHeightAt(n.x, n.y, n.z) + 0.02 + hop);
    view.root.quaternion.setFromUnitVectors(this.up, n);

    // Face along tangent
    const face = new THREE.Vector3(a.facing.x, a.facing.y, a.facing.z);
    if (face.lengthSq() > 1e-6) {
      // Build basis: up=n, forward=face
      const forward = face.clone().projectOnPlane(n).normalize();
      if (forward.lengthSq() > 1e-6) {
        const right = new THREE.Vector3().crossVectors(n, forward).normalize();
        const m = new THREE.Matrix4().makeBasis(right, n, forward);
        view.root.quaternion.setFromRotationMatrix(m);
      }
    }

    const scale = 1;
    view.root.scale.setScalar(scale);
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

/** Bake a flat vertex-color attribute onto a geometry. */
function paintGeo(geo: THREE.BufferGeometry, hex: number): void {
  const count = geo.attributes.position.count;
  const c = new THREE.Color(hex);
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}
