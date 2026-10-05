import * as THREE from 'three';
import { SUN_DIRECTION } from '../simulation/climate/light';

/**
 * Scene lighting: a fixed world-space sun matching SUN_DIRECTION.
 * Day and night come from the planet rotating under this sun — the same
 * orientation the simulation uses for plant/animal light — not a global
 * clock that grades the whole scene to night.
 */
export class Lighting {
  readonly sunLight: THREE.DirectionalLight;
  readonly ambientLight: THREE.AmbientLight;
  readonly fillLight: THREE.DirectionalLight;

  constructor(scene: THREE.Scene) {
    this.ambientLight = new THREE.AmbientLight(0x6a7aaa, 0.22);
    scene.add(this.ambientLight);

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
    scene.add(this.sunLight);

    this.fillLight = new THREE.DirectionalLight(0x88a0ff, 0.15);
    this.fillLight.position.set(-4, 1, -3);
    scene.add(this.fillLight);

    const sunVisual = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffe6a8 }),
    );
    sunVisual.position.copy(SUN_DIRECTION).multiplyScalar(8);
    scene.add(sunVisual);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 16, 16),
      new THREE.MeshBasicMaterial({
        color: 0xffc978,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    );
    glow.position.copy(sunVisual.position);
    scene.add(glow);
  }

  setShadowQuality(level: 'low' | 'medium' | 'high'): void {
    const shadowSize = level === 'low' ? 512 : level === 'medium' ? 1024 : 2048;
    this.sunLight.shadow.mapSize.set(shadowSize, shadowSize);
    this.sunLight.castShadow = level !== 'low';
    if (this.sunLight.shadow.map) {
      this.sunLight.shadow.map.dispose();
      this.sunLight.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
  }

  /** Sun stays put; the terminator is the planet's orientation. */
  update(_dt: number): void {}
}
