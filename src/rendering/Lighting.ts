import * as THREE from 'three';
import { SUN_DIRECTION } from '../simulation/climate/light';

/**
 * Scene lighting: sun/fill/ambient lights, the sun disc, and the slow
 * day→dusk→night→dawn color cycle driven by the current day fraction.
 */
export class Lighting {
  readonly sunLight: THREE.DirectionalLight;
  readonly ambientLight: THREE.AmbientLight;
  readonly fillLight: THREE.DirectionalLight;
  private sunVisual: THREE.Mesh;
  private dayFraction = 0;

  constructor(scene: THREE.Scene) {
    // Lights — colors are rewritten every frame by update()
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

    // Sun disc
    this.sunVisual = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffe6a8 }),
    );
    this.sunVisual.position.copy(SUN_DIRECTION).multiplyScalar(8);
    scene.add(this.sunVisual);

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

  setDayFraction(fraction: number): void {
    this.dayFraction = fraction;
  }

  /**
   * Slow mood cycle on the whole scene: warm noon → amber dusk → cool night → soft dawn.
   * Day length is ~45s of game time, so this breathes with play sessions.
   */
  update(dt: number): void {
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
}
