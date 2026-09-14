import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { AnimalState, EventId, GameWorldState, PlantState, Vec3Like } from '../shared/types';
import { lightAmount, SUN_DIRECTION } from '../simulation/climate/light';
import { waterAt } from '../simulation/ecology/water';
import { terrainHeightAt } from '../shared/terrain';
import { isMobileExperience } from '../shared/device';
import { EventVfx } from './EventVfx';
import { Ambience } from './Ambience';
import { EntityLayer } from './EntityLayer';
import type { PickResult, RendererCallbacks } from './renderTypes';

export type { PickResult, RendererCallbacks } from './renderTypes';

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
  private entities!: EntityLayer;

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
    this.entities = new EntityLayer(this.planetGroup);

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
    return this.entities.pick(this.raycaster) ?? this.pickSurface();
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

    this.entities.sync(world);
    this.updateSelectionRing(plants, animals);
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
    this.entities.dispose();
    this.renderer.dispose();
  }
}
