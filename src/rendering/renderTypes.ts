import type { Vector3 } from 'three';
import type { AnimalState, PlantState } from '../shared/types';

export type PickResult =
  | { type: 'surface'; point: Vector3; localNormal: Vector3; light: number; water: number }
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
