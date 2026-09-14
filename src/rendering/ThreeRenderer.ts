import * as THREE from 'three';
import type { AnimalState, EventId, GameWorldState, PlantState, Vec3Like } from '../shared/types';
import { lightAmount, SUN_DIRECTION } from '../simulation/climate/light';
import { waterAt } from '../simulation/ecology/water';
import { terrainHeightAt } from '../shared/terrain';
import { isMobileExperience } from '../shared/device';
import { EventVfx } from './EventVfx';
import { Ambience } from './Ambience';
import { EntityLayer } from './EntityLayer';
import { PointerControls } from './PointerControls';
import { PlanetBody } from './PlanetBody';
import { Lighting } from './Lighting';
import type { PickResult, RendererCallbacks } from './renderTypes';

export type { PickResult, RendererCallbacks } from './renderTypes';

export class ThreeRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private planet!: PlanetBody;
  private lighting!: Lighting;
  private marker: THREE.Mesh;
  private selectRing: THREE.Mesh;
  private selectionTarget: { kind: 'plant' | 'animal'; id: string } | null = null;
  private lastPersonality = 'wild';
  private lastMushroomGlow = 0;
  private eventVfx: EventVfx | null = null;
  private ambience!: Ambience;
  private entities!: EntityLayer;
  private controls!: PointerControls;

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
    this.camera.position.set(0, 0.4, 6.5); // start fully zoomed-out (smallest planet)
    this.camera.lookAt(0, 0, 0);

    this.lighting = new Lighting(this.scene);

    this.planet = new PlanetBody(this.renderer);
    this.scene.add(this.planet.group);
    this.eventVfx = new EventVfx(this.planet.group);
    this.ambience = new Ambience(this.scene, this.planet.group);
    this.entities = new EntityLayer(this.planet.group);

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
    this.planet.group.add(this.selectRing);

    this.applyQuality(this.defaultQuality(), true);

    this.controls = new PointerControls(this.canvas, this.cbs, () => this.pick());
    this.controls.bind();
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
    this.lighting.setShadowQuality(level);
    if (!init) this.resize();
  }

  private countMushroomGlow(plants: PlantState[]): number {
    let n = 0;
    for (const p of plants) {
      if (p.species === 'mushroom' && p.growth > 0.25) n += p.growth;
    }
    return Math.min(1, n / 8);
  }

  zoom(delta: number): void {
    this.controls.zoom(delta);
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
    this.controls.raycaster.setFromCamera(this.controls.pointer, this.camera);
    return this.entities.pick(this.controls.raycaster) ?? this.pickSurface();
  }

  /** Raycast only the planet body — used when planting so entity hits don't swallow the click. */
  pickSurface(): Extract<PickResult, { type: 'surface' }> | null {
    this.controls.raycaster.setFromCamera(this.controls.pointer, this.camera);
    const hits = this.controls.raycaster.intersectObject(this.planet.planetMesh, false);
    if (!hits.length || !hits[0].face) return null;
    const point = hits[0].point.clone();
    const local = this.planet.group.worldToLocal(point.clone()).normalize();
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
  syncWorld(world: GameWorldState): void {
    const { planet, plants, animals } = world;
    this.lastLakes = planet.lakes;
    this.planet.sync(world);
    this.planet.applyPersonality(world.personality ?? 'wild');
    this.lastPersonality = world.personality ?? 'wild';
    this.lastMushroomGlow = this.countMushroomGlow(plants);
    this.lighting.setDayFraction(world.stats.dayFraction ?? 0);

    this.entities.sync(world);
    this.updateSelectionRing(plants, animals);
  }

  playEventVfx(id: EventId, localNormal?: Vec3Like | null): void {
    this.eventVfx?.play(id, localNormal ?? null, 1);
    // Migrating birds: temporary extra flock burst is already ambient; nudge a close pass
    if (id === 'migratingBirds') {
      this.ambience.nudgeFlocks(-0.4);
    }
  }

  render(dt: number): void {
    this.camera.position.normalize().multiplyScalar(this.controls.camDist);
    this.camera.lookAt(0, 0, 0);

    if (this.marker.visible) {
      this.marker.lookAt(this.camera.position);
    }
    if (this.selectRing.visible) {
      // Ring already oriented along normal; slight pulse
      const pulse = 1 + Math.sin(performance.now() * 0.004) * 0.06;
      this.selectRing.scale.setScalar(pulse);
    }

    this.lighting.update(dt);

    this.planet.oceanMesh.rotation.y += 0.00005;
    this.ambience.update(dt, {
      personality: this.lastPersonality,
      mushroomGlow: this.lastMushroomGlow,
      mechanical: this.lastPersonality === 'mechanical',
    });
    this.eventVfx?.update(dt);

    // Keep light/hover fresh while the planet coasts under a still finger/cursor
    if (this.controls.tickHover(dt)) {
      this.cbs.onHover(this.pick());
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
    this.controls.dispose();
    this.renderer.dispose();
  }
}
