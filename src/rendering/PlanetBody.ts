import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameWorldState, LakeCenter } from '../shared/types';
import { terrainHeightAt } from '../shared/terrain';
import { lakeBoundaryDirection, lakeShoreFactorByAngle, lakeShoreRadius } from '../shared/lakeShape';

/**
 * The planet body itself: terrain mesh + vertex-color painting, glossy ocean
 * shell, atmosphere rim, lake discs and personality-driven water/atmosphere
 * tinting. Owns its `group`, which callers parent entity/ambience layers to.
 */
export class PlanetBody {
  readonly group = new THREE.Group();
  readonly planetMesh: THREE.Mesh;
  readonly oceanMesh: THREE.Mesh;
  readonly atmosphere: THREE.Mesh;

  private waterEnvMap: THREE.Texture | null = null;
  private baseHeights = new Float32Array(0);
  private baseNormals = new Float32Array(0);
  private lastPaintKey = '';
  private lakeMeshes: THREE.Mesh[] = [];

  constructor(renderer: THREE.WebGLRenderer) {
    const radius = 1;
    // Env map only for water materials — NOT scene.environment (that washes out day/night)
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      this.waterEnvMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    } catch {
      this.waterEnvMap = null;
    }

    const geo = new THREE.IcosahedronGeometry(radius, 4);

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
    this.group.add(this.planetMesh);
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
    this.group.add(this.oceanMesh);

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
    this.group.add(this.atmosphere);
  }

  /** Apply rotation, terrain recolor and lake visuals for the current world. */
  sync(world: GameWorldState): void {
    const planet = world.planet;
    this.group.rotation.set(planet.rotationX, planet.rotationY, 0);
    this.paintTerrainColors(planet.lakes);
    this.updateLakes(planet.lakes);
  }

  /** Recolor water/atmosphere to match the planet's evolving personality. */
  applyPersonality(personality: string): void {
    const atmo = this.atmosphere.material as THREE.MeshBasicMaterial;
    const ocean = this.oceanMesh.material as THREE.MeshStandardMaterial;
    switch (personality) {
      case 'garden':
        atmo.color.setHex(0x9fe0c0);
        atmo.opacity = 0.11;
        ocean.color.setHex(0x3d9fd1);
        break;
      case 'forest':
        atmo.color.setHex(0x7ab890);
        atmo.opacity = 0.13;
        ocean.color.setHex(0x2f7eb8);
        break;
      case 'desert':
        atmo.color.setHex(0xe0c090);
        atmo.opacity = 0.08;
        ocean.color.setHex(0x4a90b0);
        break;
      case 'nightGlow':
        atmo.color.setHex(0x9aa8ff);
        atmo.opacity = 0.14;
        ocean.color.setHex(0x2a5a9a);
        break;
      case 'mechanical':
        atmo.color.setHex(0xa8c8d8);
        atmo.opacity = 0.1;
        ocean.color.setHex(0x3a6a88);
        break;
      case 'chaos':
        atmo.color.setHex(0xd08080);
        atmo.opacity = 0.1;
        ocean.color.setHex(0x5a7080);
        break;
      default:
        atmo.color.setHex(0x7eb6ff);
        atmo.opacity = 0.09;
        ocean.color.setHex(0x2f7eb8);
    }
  }

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
          const r = lakeShoreRadius(lake, { x: nx, y: ny, z: nz });
          if (ang < r) {
            const t = 1 - ang / r;
            c.lerp(new THREE.Color(0x4aa3e0), t * lake.water * 0.85);
          }
        }
      }

      colorAttr.setXYZ(i, c.r, c.g, c.b);
    }
    colorAttr.needsUpdate = true;
  }

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
      const mesh = new THREE.Mesh(this.makeLakeGeometry(), mat);
      this.writeLakeGeometry(mesh, lakes[this.lakeMeshes.length]);
      this.group.add(mesh);
      this.lakeMeshes.push(mesh);
    }
    lakes.forEach((lake, i) => {
      const mesh = this.lakeMeshes[i];
      this.writeLakeGeometry(mesh, lake);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = 0.3 + lake.water * 0.45;
      mesh.visible = lake.water > 0.02;
    });
  }

  /** Fan geometry: vertex 0 is the center, 1..N form the shoreline ring. */
  private makeLakeGeometry(): THREE.BufferGeometry {
    const segments = 48;
    const positions = new Float32Array((segments + 1) * 3);
    const indices: number[] = [];
    for (let i = 0; i < segments; i++) {
      indices.push(0, 1 + i, 1 + ((i + 1) % segments));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    return geo;
  }

  /**
   * Lay the water surface onto the terrain as a thin draped layer, so there is
   * no gap over low ground and surface plants sit above the waterline.
   * Shoreline follows the shared (non-circular) lake shape.
   */
  private writeLakeGeometry(mesh: THREE.Mesh, lake: LakeCenter): void {
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const segments = pos.count - 1;
    const areaScale = (0.65 + lake.water * 0.35) * 0.95;
    const depth = 0.004 + lake.water * 0.008;

    const n = lake.normal;
    let r = 1 + terrainHeightAt(n.x, n.y, n.z) + depth;
    pos.setXYZ(0, n.x * r, n.y * r, n.z * r);

    for (let i = 0; i < segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const a = lake.radius * lakeShoreFactorByAngle(lake, theta) * areaScale;
      const d = lakeBoundaryDirection(lake, theta, a, this.tmpLakeDir);
      r = 1 + terrainHeightAt(d.x, d.y, d.z) + depth;
      pos.setXYZ(i + 1, d.x * r, d.y * r, d.z * r);
    }

    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
  }

  private tmpLakeDir = new THREE.Vector3();
}
