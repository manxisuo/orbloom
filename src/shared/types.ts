export type Vec3Like = { x: number; y: number; z: number };

export interface SurfacePosition {
  /** Unit vector from planet center toward the surface point. */
  normal: Vec3Like;
  altitude: number;
}

export type PlantSpecies = 'tree' | 'grass' | 'flower';
export type AnimalSpecies = 'rabbit' | 'bee';

export type AnimalBrainState =
  | 'wander'
  | 'seekFood'
  | 'eat'
  | 'sleep'
  | 'seekFlower'
  | 'pollinate';

export interface PlantState {
  id: string;
  species: PlantSpecies;
  position: SurfacePosition;
  age: number;
  health: number;
  water: number;
  /** 0..1 visual growth */
  growth: number;
};

export interface AnimalState {
  id: string;
  species: AnimalSpecies;
  position: SurfacePosition;
  /** Tangent-facing direction on the sphere */
  facing: Vec3Like;
  health: number;
  /** 0..1, 1 = full */
  hunger: number;
  state: AnimalBrainState;
  stateTimer: number;
  targetPlantId: string | null;
  hopPhase: number;
  /** Game-days lived */
  age: number;
  /** Game-days until this animal can breed again */
  breedCooldown: number;
};

export interface LakeCenter {
  normal: Vec3Like;
  /** Angular radius in radians */
  radius: number;
  water: number;
};

export interface PlanetState {
  radius: number;
  /** Radians around Y; player drag adjusts this. */
  rotationY: number;
  rotationX: number;
  lakes: LakeCenter[];
};

export interface ResourceState {
  stardust: number;
};

export interface TimeState {
  /** Accumulated real simulation seconds. */
  gameTime: number;
  /** 0 = paused; 1/2/4 supported */
  speed: number;
  /** Real seconds for one full solar day. */
  dayLength: number;
};

export interface EcoStats {
  averageLight: number;
  averageWater: number;
  averageHealth: number;
  plantCount: number;
  animalCount: number;
  /** 0..1 rough stability score */
  stability: number;
  dayFraction: number;
  day: number;
};

export interface LogEntry {
  id: string;
  gameTime: number;
  day: number;
  text: string;
};

export type EventId =
  | 'meteor'
  | 'coldNight'
  | 'drought'
  | 'strangeSeed'
  | 'migratingBirds';

export interface PendingEvent {
  id: EventId;
  title: string;
  body: string;
  acceptLabel: string;
  declineLabel: string;
};

export interface WorldModifiers {
  /** Remaining game-days of faster lake evaporation */
  droughtDays: number;
  /** Remaining game-days of extra plant stress */
  coldDays: number;
};

export type ToolMode = 'inspect' | 'plant-tree' | 'plant-grass' | 'plant-flower' | 'spawn-rabbit' | 'rain';

export interface GameWorldState {
  planet: PlanetState;
  plants: PlantState[];
  animals: AnimalState[];
  resources: ResourceState;
  time: TimeState;
  stats: EcoStats;
  log: LogEntry[];
  seed: number;
  modifiers: WorldModifiers;
  pendingEvent: PendingEvent | null;
  /** Game seconds until next event offer */
  nextEventIn: number;
};
