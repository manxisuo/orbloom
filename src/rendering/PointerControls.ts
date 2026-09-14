import * as THREE from 'three';
import type { PickResult, RendererCallbacks } from './renderTypes';

/**
 * Pointer + wheel input: orbit-drag, two-finger pinch zoom and wheel zoom.
 * Owns the NDC pointer + raycaster; entity/surface picking is delegated back
 * to the renderer through `pickFn` so this stays free of scene knowledge.
 */
export class PointerControls {
  camDist = 6.5;
  hasPointer = false;
  readonly raycaster = new THREE.Raycaster();
  readonly pointer = new THREE.Vector2();

  private canvas: HTMLCanvasElement;
  private cbs: RendererCallbacks;
  private pickFn: () => PickResult;
  private dragging = false;
  private dragMoved = false;
  private lastX = 0;
  private lastY = 0;
  private downX = 0;
  private downY = 0;
  private hoverAcc = 0;
  private teardown: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement, cbs: RendererCallbacks, pickFn: () => PickResult) {
    this.canvas = canvas;
    this.cbs = cbs;
    this.pickFn = pickFn;
  }

  bind(): void {
    const el = this.canvas;
    el.style.touchAction = 'none';

    const activePointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;

    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.toNdc(e.clientX, e.clientY);
      this.cbs.onHover(this.pickFn());
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
    };

    const onMove = (e: PointerEvent) => {
      this.toNdc(e.clientX, e.clientY);

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
      this.cbs.onHover(this.pickFn());
    };

    const end = (e: PointerEvent) => {
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) pinchDist = 0;
      // Touch taps may never fire pointermove — pick must use the lift position
      this.toNdc(e.clientX, e.clientY);
      this.cbs.onHover(this.pickFn());
      if (this.dragging && !this.dragMoved) {
        this.cbs.onClick(this.pickFn());
      }
      if (activePointers.size === 0) this.dragging = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.cbs.onZoom(e.deltaY);
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', onWheel, { passive: false });

    this.teardown.push(
      () => el.removeEventListener('pointerdown', onDown),
      () => el.removeEventListener('pointermove', onMove),
      () => el.removeEventListener('pointerup', end),
      () => el.removeEventListener('pointercancel', end),
      () => el.removeEventListener('wheel', onWheel),
    );
  }

  zoom(delta: number): void {
    this.camDist = THREE.MathUtils.clamp(this.camDist + delta * 0.0025, 2.0, 6.5);
  }

  /** Advance the hover-refresh clock. True when the caller should re-pick. */
  tickHover(dt: number): boolean {
    if (!this.hasPointer) return false;
    this.hoverAcc += dt;
    if (this.hoverAcc >= 0.1) {
      this.hoverAcc = 0;
      return true;
    }
    return false;
  }

  dispose(): void {
    for (const fn of this.teardown) fn();
    this.teardown = [];
  }

  private toNdc(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.hasPointer = true;
  }
}
