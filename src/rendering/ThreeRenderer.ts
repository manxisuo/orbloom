import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { AnimalState, EventId, GameWorldState, PlantState, Vec3Like } from '../shared/types';
import { lightAmount, SUN_DIRECTION } from '../simulation/climate/light';
import { waterAt } from '../simulation/ecology/water';
import { terrainHeightAt } from '../shared/terrain';
import { isMobileExperience } from '../shared/device';
import { EventVfx } from './EventVfx';
import { Ambience } from './Ambience';

export type PickResult =
  | { type: 'surface'; point: THREE.Vector3; localNormal: THREE.Vector3; light: number; water: number }
  | { type: 'plant'; plant: PlantState }
  | { type: 'animal'; animal: AnimalState }
  | null;

export interface RendererCallbacks {
  onPointerDown: (e: PointerEvent) => void;
  onRotate: (dx: number, dy: number) => void;
  onZoom: (delta: number) => void;
  onHover: (hit: PickResult) => void;
  onClick: (hit: PickResult) => void;
}

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

export class ThreeRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private planetGroup = new THREE.Group();
  private planetMesh!: THREE.Mesh;
  private oceanMesh!: THREE.Mesh;
  private atmosphere!: THREE.Mesh;
  private sunLight: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;
  private fillLight: THREE.DirectionalLight;
  private sunVisual: THREE.Mesh;
  private plantViews = new Map<string, PlantView>();
  private animalViews = new Map<string, AnimalView>();
  private marker: THREE.Mesh;
  private selectRing: THREE.Mesh;
  private selectionTarget: { kind: 'plant' | 'animal'; id: string } | null = null;
  private personalityTint = new THREE.Color(0x7eb6ff);
  private lastPersonality = 'wild';
  private lastMushroomGlow = 0;
  private dayFraction = 0;
  private waterEnvMap: THREE.Texture | null = null;
  private eventVfx: EventVfx | null = null;
  private ambience!: Ambience;

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

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragging = false;
  private dragMoved = false;
  private lastX = 0;
  private lastY = 0;
  private downX = 0;
  private downY = 0;
  private camDist = 6.5; // start fully zoomed-out (smallest planet on screen)
  private hasPointer = false;
  private hoverRefreshAcc = 0;
  private cbs: RendererCallbacks;
  private canvas: HTMLCanvasElement;
  private up = new THREE.Vector3(0, 1, 0);

  // Shared geo/material + object pools (avoid alloc/churn on spawn/despawn)
  private geoCache = new Map<string, THREE.BufferGeometry>();
  private matCache = new Map<string, THREE.Material>();
  private poolTree: THREE.Group[] = [];
  private poolMushroom: THREE.Group[] = [];
  private poolRabbit: THREE.Group[] = [];
  private poolFox: THREE.Group[] = [];
  private quality: 'low' | 'medium' | 'high' = 'high';

  constructor(canvas: HTMLCanvasElement, cbs: RendererCallbacks) {
    this.canvas = canvas;
    this.cbs = cbs;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x070b18, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x070b18, 0.04);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 0.4, this.camDist);
    this.camera.lookAt(0, 0, 0);

    // Env map only for water materials — NOT scene.environment (that washes out day/night)
    this.waterEnvMap = null;
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.waterEnvMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    } catch {
      this.waterEnvMap = null;
    }

    // Lights — colors are rewritten every frame by applyTimeOfDay
    this.ambientLight = new THREE.AmbientLight(0x6a7aaa, 0.22);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xfff2d5, 1.35);
    this.sunLight.position.copy(SUN_DIRECTION).multiplyScalar(12);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 20;
    this.sunLight.shadow.camera.left = -1.6;
    this.sunLight.shadow.camera.right = 1.6;
    this.sunLight.shadow.camera.top = 1.6;
    this.sunLight.shadow.camera.bottom = -1.6;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.02;
    this.sunLight.shadow.radius = 4;
    this.scene.add(this.sunLight);

    this.fillLight = new THREE.DirectionalLight(0x88a0ff, 0.15);
    this.fillLight.position.set(-4, 1, -3);
    this.scene.add(this.fillLight);

    // Sun disc
    this.sunVisual = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffe6a8 }),
    );
    this.sunVisual.position.copy(SUN_DIRECTION).multiplyScalar(8);
    this.scene.add(this.sunVisual);

    // Soft sun glow sprite-ish plane
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 16, 16),
      new THREE.MeshBasicMaterial({
        color: 0xffc978,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    );
    glow.position.copy(this.sunVisual.position);
    this.scene.add(glow);

    this.buildPlanet();
    this.ambience = new Ambience(this.scene, this.planetGroup);

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.04, 0.06, 24),
      new THREE.MeshBasicMaterial({
        color: 0xa8f0c8,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    this.marker.visible = false;
    this.marker.renderOrder = 10;
    this.scene.add(this.marker);

    this.selectRing = new THREE.Mesh(
      new THREE.RingGeometry(0.055, 0.075, 28),
      new THREE.MeshBasicMaterial({
        color: 0xf0d78c,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    this.selectRing.visible = false;
    this.selectRing.renderOrder = 11;
    this.planetGroup.add(this.selectRing);

    this.applyQuality(this.defaultQuality(), true);

    this.bindInput();
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  private defaultQuality(): 'low' | 'medium' | 'high' {
    return isMobileExperience() ? 'medium' : 'high';
  }

  setQuality(level: 'low' | 'medium' | 'high'): void {
    this.applyQuality(level, false);
  }

  getQuality(): 'low' | 'medium' | 'high' {
    return this.quality;
  }

  private applyQuality(level: 'low' | 'medium' | 'high', init: boolean): void {
    this.quality = level;
    const dpr = window.devicePixelRatio || 1;
    const ratio =
      level === 'low' ? 1 : level === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
    this.renderer.setPixelRatio(ratio);
    const shadowSize = level === 'low' ? 512 : level === 'medium' ? 1024 : 2048;
    this.sunLight.shadow.mapSize.set(shadowSize, shadowSize);
    this.sunLight.castShadow = level !== 'low';
    if (this.sunLight.shadow.map) {
      this.sunLight.shadow.map.dispose();
      this.sunLight.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    if (!init) this.resize();
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

  private buildPlanet(): void {
    const radius = 1;
    const detail = 4;
    const geo = new THREE.IcosahedronGeometry(radius, detail);

    // Displace vertices for soft hills; keep flat-shaded low-poly look
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const color = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = v.clone().normalize();
      const h = terrainHeightAt(n.x, n.y, n.z);
      const r = radius + h;
      v.copy(n).multiplyScalar(r);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    // Vertex colors by height
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const h = v.length() - radius;
      // Sand / grass / rock
      let c: THREE.Color;
      if (h < 0.01) c = new THREE.Color(0xc4b07a);
      else if (h < 0.055) c = new THREE.Color(0x6faf6a).lerp(new THREE.Color(0x8bc97a), h * 12);
      else c = new THREE.Color(0x8a8f7a).lerp(new THREE.Color(0xb0b4a8), (h - 0.055) * 10);
      // Slight variation
      const jitter = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      c.offsetHSL(0, 0, (jitter - 0.5) * 0.04);
      color[i * 3] = c.r;
      color[i * 3 + 1] = c.g;
      color[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(color, 3));

    // Store base normals + heights for dynamic recolor (lakes / sea)
    const count = pos.count;
    const baseHeights = new Float32Array(count);
    const baseNormals = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, i);
      const len = v.length();
      baseHeights[i] = len - radius;
      baseNormals[i * 3] = v.x / len;
      baseNormals[i * 3 + 1] = v.y / len;
      baseNormals[i * 3 + 2] = v.z / len;
    }
    this.baseHeights = baseHeights;
    this.baseNormals = baseNormals;

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.92,
      metalness: 0.02,
    });
    this.planetMesh = new THREE.Mesh(geo, mat);
    this.planetMesh.castShadow = true;
    this.planetMesh.receiveShadow = true;
    this.planetMesh.name = 'planet';
    this.planetGroup.add(this.planetMesh);
    this.paintTerrainColors(null);
    // Thin glossy sea shell only covering low terrain visually via vertex colors;
    // kept as a very subtle rimless overlay for slight sheen.
    const oceanGeo = new THREE.IcosahedronGeometry(radius + 0.004, 4);
    const oceanMat = new THREE.MeshStandardMaterial({
      color: 0x2f7eb8,
      transparent: true,
      opacity: 0.14,
      roughness: 0.12,
      metalness: 0.4,
      envMap: this.waterEnvMap,
      envMapIntensity: 0.55,
      flatShading: true,
      depthWrite: false,
    });
    this.oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
    this.oceanMesh.name = 'ocean';
    this.planetGroup.add(this.oceanMesh);

    // Atmosphere rim
    const atmoGeo = new THREE.IcosahedronGeometry(radius + 0.09, 3);
    const atmoMat = new THREE.MeshBasicMaterial({
      color: 0x7eb6ff,
      transparent: true,
      opacity: 0.09,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.atmosphere = new THREE.Mesh(atmoGeo, atmoMat);
    this.planetGroup.add(this.atmosphere);

    this.scene.add(this.planetGroup);
    this.eventVfx = new EventVfx(this.planetGroup);
  }

  private countMushroomGlow(plants: PlantState[]): number {
    let n = 0;
    for (const p of plants) {
      if (p.species === 'mushroom' && p.growth > 0.25) n += p.growth;
    }
    return Math.min(1, n / 8);
  }

  private updatePointerFromClient(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.hasPointer = true;
  }

  private bindInput(): void {
    const el = this.canvas;
    el.style.touchAction = 'none';

    const activePointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.updatePointerFromClient(e.clientX, e.clientY);
      this.cbs.onHover(this.pick());
      if (activePointers.size === 1) {
        this.dragging = true;
        this.dragMoved = false;
        this.lastX = this.downX = e.clientX;
        this.lastY = this.downY = e.clientY;
        this.cbs.onPointerDown(e);
      } else if (activePointers.size === 2) {
        this.dragging = false;
        const pts = [...activePointers.values()];
        pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      }
    });

    el.addEventListener('pointermove', (e) => {
      this.updatePointerFromClient(e.clientX, e.clientY);

      if (activePointers.has(e.pointerId)) {
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      // Two-finger pinch zoom
      if (activePointers.size === 2) {
        const pts = [...activePointers.values()];
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinchDist > 0) {
          const delta = (pinchDist - d) * 2.2;
          this.cbs.onZoom(delta);
        }
        pinchDist = d;
        return;
      }

      if (this.dragging) {
        const dx = e.clientX - this.lastX;
        const dy = e.clientY - this.lastY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        // Slightly higher threshold for finger taps
        if (Math.abs(e.clientX - this.downX) + Math.abs(e.clientY - this.downY) > 8) {
          this.dragMoved = true;
        }
        this.cbs.onRotate(dx, dy);
      }

      // Mouse and touch: keep surface light/hover in sync with the finger/cursor
      this.cbs.onHover(this.pick());
    });

    const end = (e: PointerEvent) => {
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) pinchDist = 0;
      // Touch taps may never fire pointermove — pick must use the lift position
      this.updatePointerFromClient(e.clientX, e.clientY);
      this.cbs.onHover(this.pick());
      if (this.dragging && !this.dragMoved) {
        this.cbs.onClick(this.pick());
      }
      if (activePointers.size === 0) this.dragging = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.cbs.onZoom(e.deltaY);
      },
      { passive: false },
    );
  }

  zoom(delta: number): void {
    this.camDist = THREE.MathUtils.clamp(this.camDist + delta * 0.0025, 2.0, 6.5);
  }

  resize = (): void => {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth || window.innerWidth;
    const h = parent?.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  };

  pick(): PickResult {
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const targets: THREE.Object3D[] = [];
    for (const v of this.animalViews.values()) targets.push(v.root);
    for (const v of this.plantViews.values()) targets.push(v.root);
    if (this.grassMesh) targets.push(this.grassMesh);
    if (this.flowerMesh) targets.push(this.flowerMesh);
    if (this.beeMesh) targets.push(this.beeMesh);

    const hitsEntities = this.raycaster.intersectObjects(targets, true);
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

    return this.pickSurface();
  }

  /** Raycast only the planet body — used when planting so entity hits don't swallow the click. */
  pickSurface(): Extract<PickResult, { type: 'surface' }> | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.planetMesh, false);
    if (!hits.length || !hits[0].face) return null;
    const point = hits[0].point.clone();
    const local = this.planetGroup.worldToLocal(point.clone()).normalize();
    const worldN = point.clone().normalize();
    const light = lightAmount(worldN, SUN_DIRECTION);
    const water = waterAt(
      { x: local.x, y: local.y, z: local.z },
      this.lastLakes,
    );
    return {
      type: 'surface',
      point,
      localNormal: local,
      light,
      water,
    };
  }

  private lastLakes: GameWorldState['planet']['lakes'] = [];
  private baseHeights = new Float32Array(0);
  private baseNormals = new Float32Array(0);
  private lastPaintKey = '';

  /** Paint land/sea/lake vertex colors from base heights + current lakes. */
  private paintTerrainColors(lakes: GameWorldState['planet']['lakes'] | null): void {
    const geo = this.planetMesh?.geometry as THREE.BufferGeometry | undefined;
    if (!geo) return;
    const colorAttr = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!colorAttr || this.baseHeights.length === 0) return;

    const key = lakes
      ? lakes.map((l) => `${l.water.toFixed(2)}`).join(',')
      : 'init';
    // Skip if nothing meaningful changed
    if (lakes && key === this.lastPaintKey) return;
    this.lastPaintKey = key;

    const c = new THREE.Color();
    const seaLevel = 0.012;
    for (let i = 0; i < this.baseHeights.length; i++) {
      const h = this.baseHeights[i];
      if (h < seaLevel) {
        // Shallow → deep water
        const t = Math.min(1, (seaLevel - h) / 0.05);
        c.setRGB(0.18, 0.42 + 0.12 * (1 - t), 0.68 - 0.1 * t);
      } else if (h < 0.055) {
        c.set(0x6faf6a).lerp(new THREE.Color(0x8bc97a), (h - seaLevel) * 12);
      } else {
        c.set(0x8a8f7a).lerp(new THREE.Color(0xb0b4a8), (h - 0.055) * 10);
      }

      const jitter = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      c.offsetHSL(0, 0, (jitter - 0.5) * 0.04);

      // Lakes tint nearby land
      if (lakes && h >= seaLevel) {
        const nx = this.baseNormals[i * 3];
        const ny = this.baseNormals[i * 3 + 1];
        const nz = this.baseNormals[i * 3 + 2];
        for (const lake of lakes) {
          if (lake.water < 0.05) continue;
          const d = Math.min(1, Math.max(-1, nx * lake.normal.x + ny * lake.normal.y + nz * lake.normal.z));
          const ang = Math.acos(d);
          if (ang < lake.radius) {
            const t = 1 - ang / lake.radius;
            c.lerp(new THREE.Color(0x4aa3e0), t * lake.water * 0.85);
          }
        }
      }

      colorAttr.setXYZ(i, c.r, c.g, c.b);
    }
    colorAttr.needsUpdate = true;
  }

  syncWorld(world: GameWorldState): void {
    const { planet, plants, animals } = world;
    this.lastLakes = planet.lakes;
    this.planetGroup.rotation.set(planet.rotationX, planet.rotationY, 0);
    this.applyPersonality(world.personality ?? 'wild');
    this.lastPersonality = world.personality ?? 'wild';
    this.lastMushroomGlow = this.countMushroomGlow(plants);
    this.dayFraction = world.stats.dayFraction ?? 0;

    this.paintTerrainColors(planet.lakes);
    this.updateLakes(planet.lakes);

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
        this.planetGroup.add(view.root);
      } else {
        view.plant = plant;
      }
      this.updatePlantView(view, planet.radius);
    }
    for (const [id, view] of this.plantViews) {
      if (!seenPlants.has(id)) {
        this.planetGroup.remove(view.root);
        this.releasePlantView(view);
        this.plantViews.delete(id);
      }
    }
    this.syncInstancedPlants(planet.radius);

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
        this.planetGroup.add(view.root);
      } else {
        // Rebind after load/applyWorld — ids match but object identity may not
        view.animal = animal;
      }
      this.updateAnimalView(view, planet.radius);
    }
    for (const [id, view] of this.animalViews) {
      if (!seenAnimals.has(id)) {
        this.planetGroup.remove(view.root);
        this.releaseAnimalView(view);
        this.animalViews.delete(id);
      }
    }
    this.syncBees(planet.radius);
    this.updateSelectionRing(plants, animals);
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
      this.planetGroup.add(this.beeMesh);
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

  private lakeMeshes: THREE.Mesh[] = [];

  private updateLakes(lakes: GameWorldState['planet']['lakes']): void {
    while (this.lakeMeshes.length < lakes.length) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x4aa3e0,
        transparent: true,
        opacity: 0.55,
        roughness: 0.18,
        metalness: 0.25,
        envMap: this.waterEnvMap,
        envMapIntensity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 40), mat);
      this.planetGroup.add(mesh);
      this.lakeMeshes.push(mesh);
    }
    lakes.forEach((lake, i) => {
      const mesh = this.lakeMeshes[i];
      const n = new THREE.Vector3(lake.normal.x, lake.normal.y, lake.normal.z).normalize();
      const r = Math.sin(lake.radius * (0.65 + lake.water * 0.35)) * 0.95;
      mesh.scale.setScalar(Math.max(0.001, r));
      mesh.position.copy(n).multiplyScalar(1.02 + lake.water * 0.01);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = 0.3 + lake.water * 0.45;
      mesh.visible = lake.water > 0.02;
    });
  }

  private ensureInstanced(
    kind: 'grass' | 'flower',
  ): THREE.InstancedMesh {
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
        this.planetGroup.add(this.grassMesh);
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
      this.planetGroup.add(this.flowerMesh);
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

  playEventVfx(id: EventId, localNormal?: Vec3Like | null): void {
    this.eventVfx?.play(id, localNormal ?? null, 1);
    // Migrating birds: temporary extra flock burst is already ambient; nudge a close pass
    if (id === 'migratingBirds') {
      this.ambience.nudgeFlocks(-0.4);
    }
  }

  applyPersonality(personality: string): void {
    const atmo = this.atmosphere.material as THREE.MeshBasicMaterial;
    const ocean = this.oceanMesh.material as THREE.MeshStandardMaterial;
    switch (personality) {
      case 'garden':
        this.personalityTint.setHex(0x8fd8b0);
        atmo.color.setHex(0x9fe0c0);
        atmo.opacity = 0.11;
        ocean.color.setHex(0x3d9fd1);
        break;
      case 'forest':
        this.personalityTint.setHex(0x6aaa70);
        atmo.color.setHex(0x7ab890);
        atmo.opacity = 0.13;
        ocean.color.setHex(0x2f7eb8);
        break;
      case 'desert':
        this.personalityTint.setHex(0xd2b07a);
        atmo.color.setHex(0xe0c090);
        atmo.opacity = 0.08;
        ocean.color.setHex(0x4a90b0);
        break;
      case 'nightGlow':
        this.personalityTint.setHex(0x8a9aff);
        atmo.color.setHex(0x9aa8ff);
        atmo.opacity = 0.14;
        ocean.color.setHex(0x2a5a9a);
        break;
      case 'mechanical':
        this.personalityTint.setHex(0x9ab8c8);
        atmo.color.setHex(0xa8c8d8);
        atmo.opacity = 0.1;
        ocean.color.setHex(0x3a6a88);
        break;
      case 'chaos':
        this.personalityTint.setHex(0xc07070);
        atmo.color.setHex(0xd08080);
        atmo.opacity = 0.1;
        ocean.color.setHex(0x5a7080);
        break;
      default:
        this.personalityTint.setHex(0x7eb6ff);
        atmo.color.setHex(0x7eb6ff);
        atmo.opacity = 0.09;
        ocean.color.setHex(0x2f7eb8);
    }
  }

  /**
   * Slow mood cycle on the whole scene: warm noon → amber dusk → cool night → soft dawn.
   * Day length is ~45s of game time, so this breathes with play sessions.
   */
  private applyTimeOfDay(dt: number): void {
    const f = this.dayFraction;
    // Piecewise key colors (sun rgb / sun intensity / ambient rgb / ambient intensity / fill)
    // 0 day, 0.4 dusk, 0.55 night, 0.85 dawn
    let sunCol: THREE.Color;
    let sunInt: number;
    let ambCol: THREE.Color;
    let ambInt: number;
    let fillCol: THREE.Color;
    let fillInt: number;

    if (f < 0.35) {
      const t = f / 0.35;
      sunCol = new THREE.Color(0xfff2d5).lerp(new THREE.Color(0xffc48a), t * 0.55);
      sunInt = 1.35;
      ambCol = new THREE.Color(0x6a7aaa).lerp(new THREE.Color(0x8a8090), t * 0.4);
      ambInt = 0.22;
      fillCol = new THREE.Color(0x88a0ff);
      fillInt = 0.15;
    } else if (f < 0.5) {
      const t = (f - 0.35) / 0.15;
      sunCol = new THREE.Color(0xffc48a).lerp(new THREE.Color(0xff8a50), t);
      sunInt = 1.35 - t * 0.45;
      ambCol = new THREE.Color(0x8a8090).lerp(new THREE.Color(0x5a5070), t);
      ambInt = 0.22 + t * 0.04;
      fillCol = new THREE.Color(0x88a0ff).lerp(new THREE.Color(0x6a70c0), t);
      fillInt = 0.15 + t * 0.08;
    } else if (f < 0.85) {
      const t = (f - 0.5) / 0.35;
      // Night: cool moonlight
      sunCol = new THREE.Color(0x9ab0e8);
      sunInt = 0.55 + Math.sin(t * Math.PI) * 0.08;
      ambCol = new THREE.Color(0x4a5578);
      ambInt = 0.18;
      fillCol = new THREE.Color(0x6a88c8);
      fillInt = 0.22;
    } else {
      const t = (f - 0.85) / 0.15;
      sunCol = new THREE.Color(0x9ab0e8).lerp(new THREE.Color(0xffd0a0), t);
      sunInt = 0.55 + t * 0.8;
      ambCol = new THREE.Color(0x4a5578).lerp(new THREE.Color(0x7a88b0), t);
      ambInt = 0.18 + t * 0.04;
      fillCol = new THREE.Color(0x6a88c8).lerp(new THREE.Color(0x88a0ff), t);
      fillInt = 0.22 - t * 0.07;
    }

    const k = 1 - Math.exp(-3 * dt);
    this.sunLight.color.lerp(sunCol, k);
    this.sunLight.intensity += (sunInt - this.sunLight.intensity) * k;
    this.ambientLight.color.lerp(ambCol, k);
    this.ambientLight.intensity += (ambInt - this.ambientLight.intensity) * k;
    this.fillLight.color.lerp(fillCol, k);
    this.fillLight.intensity += (fillInt - this.fillLight.intensity) * k;

    // Sun disc follows the same temperature
    const sunMat = this.sunVisual.material as THREE.MeshBasicMaterial;
    sunMat.color.lerp(sunCol, k);
    sunMat.opacity = 0.85;
    sunMat.transparent = true;
  }

  render(dt: number): void {
    this.camera.position.normalize().multiplyScalar(this.camDist);
    this.camera.lookAt(0, 0, 0);

    if (this.marker.visible) {
      this.marker.lookAt(this.camera.position);
    }
    if (this.selectRing.visible) {
      // Ring already oriented along normal; slight pulse
      const pulse = 1 + Math.sin(performance.now() * 0.004) * 0.06;
      this.selectRing.scale.setScalar(pulse);
    }

    this.applyTimeOfDay(dt);

    this.oceanMesh.rotation.y += 0.00005;
    this.ambience.update(dt, {
      personality: this.lastPersonality,
      mushroomGlow: this.lastMushroomGlow,
      mechanical: this.lastPersonality === 'mechanical',
    });
    this.eventVfx?.update(dt);

    // Keep light/hover fresh while the planet coasts under a still finger/cursor
    if (this.hasPointer) {
      this.hoverRefreshAcc += dt;
      if (this.hoverRefreshAcc >= 0.1) {
        this.hoverRefreshAcc = 0;
        this.cbs.onHover(this.pick());
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  /** Track which entity the gold ring follows (updated every syncWorld). */
  setSelectionTarget(kind: 'plant' | 'animal' | null, id: string | null): void {
    if (!kind || !id) {
      this.selectionTarget = null;
      this.selectRing.visible = false;
      return;
    }
    this.selectionTarget = { kind, id };
  }

  private updateSelectionRing(plants: PlantState[], animals: AnimalState[]): void {
    const t = this.selectionTarget;
    if (!t) {
      this.selectRing.visible = false;
      return;
    }
    let normal: Vec3Like | null = null;
    let altitude = 0;
    if (t.kind === 'plant') {
      const p = plants.find((x) => x.id === t.id);
      if (p) {
        normal = p.position.normal;
        altitude = p.position.altitude;
      }
    } else {
      const a = animals.find((x) => x.id === t.id);
      if (a) {
        normal = a.position.normal;
        altitude = 0.02;
      }
    }
    if (!normal) {
      this.selectionTarget = null;
      this.selectRing.visible = false;
      return;
    }
    this.setSelectionMarker(normal, altitude);
  }

  /** Gold ring under the selected plant/animal (local planet space). */
  setSelectionMarker(localNormal: Vec3Like | null, altitude = 0): void {
    if (!localNormal) {
      this.selectRing.visible = false;
      return;
    }
    const n = new THREE.Vector3(localNormal.x, localNormal.y, localNormal.z).normalize();
    const ground = terrainHeightAt(n.x, n.y, n.z);
    this.selectRing.visible = true;
    this.selectRing.position.copy(n).multiplyScalar(1 + Math.max(altitude, ground) + 0.012);
    this.selectRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  }

  /** Called by Game after hover to place marker. */
  setHoverMarker(worldPoint: THREE.Vector3 | null): void {
    if (!worldPoint) {
      this.marker.visible = false;
      return;
    }
    this.marker.visible = true;
    this.marker.position.copy(worldPoint).multiplyScalar(1.02);
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.eventVfx?.dispose();
    this.eventVfx = null;
    this.ambience.dispose();
    for (const view of this.plantViews.values()) disposeObject(view.root);
    for (const view of this.animalViews.values()) disposeObject(view.root);
    if (this.grassMesh) {
      this.planetGroup.remove(this.grassMesh);
      disposeObject(this.grassMesh);
      this.grassMesh = null;
    }
    if (this.flowerMesh) {
      this.planetGroup.remove(this.flowerMesh);
      disposeObject(this.flowerMesh);
      this.flowerMesh = null;
    }
    if (this.beeMesh) {
      this.planetGroup.remove(this.beeMesh);
      disposeObject(this.beeMesh);
      this.beeMesh = null;
    }
    this.renderer.dispose();
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
