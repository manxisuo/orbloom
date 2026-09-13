import type {
  AnimalState,
  GameWorldState,
  PendingEvent,
  PlantState,
  ToolMode,
  Vec3Like,
} from '../shared/types';
import { createBudget, createWorld, tickWorld, type SimBudget } from '../simulation/WorldSimulation';
import { plantTreeAt, rain, resolvePendingEvent, spawnFoxAt, spawnRabbitAt } from '../simulation/WorldSimulation';
import { ThreeRenderer } from '../rendering/ThreeRenderer';
import type { SaveRepository } from '../persistence/SaveRepository';
import type { SaveMeta } from '../persistence/types';
import { audioBus } from './audio';

export type HoverInfo =
  | { kind: 'surface'; light: number; water: number; localNormal: Vec3Like }
  | { kind: 'plant'; plant: PlantState }
  | { kind: 'animal'; animal: AnimalState }
  | { kind: 'none' };

export type GameBootMode =
  | { kind: 'new'; seed?: number }
  | { kind: 'loaded'; world: GameWorldState };

const AUTOSAVE_SECONDS = 45;

export class Game {
  world: GameWorldState;
  renderer: ThreeRenderer;
  budget: SimBudget;
  tool: ToolMode = 'plant-tree';
  hover: HoverInfo = { kind: 'none' };
  selectedPlantId: string | null = null;
  lastSaveAt: number | null = null;
  saveError: string | null = null;

  private raf = 0;
  private lastT = 0;
  private disposed = false;
  private onUiSync: (world: GameWorldState, hover: HoverInfo) => void;
  private onNotify: ((msg: string) => void) | null;
  private uiSyncAcc = 0;
  private autosaveAcc = 0;
  private saveRepo: SaveRepository | null = null;
  private saving = false;
  private lastDayFraction = 0;
  private hadPendingEvent = false;
  private onBeforeUnload = () => {
    void this.saveNow('autosave');
  };
  private onVisibility = () => {
    if (document.visibilityState === 'hidden') void this.saveNow('autosave');
  };

  constructor(
    canvas: HTMLCanvasElement,
    onUiSync: (world: GameWorldState, hover: HoverInfo) => void,
    options: {
      seed?: number;
      boot?: GameBootMode;
      saveRepository?: SaveRepository | null;
      onNotify?: (msg: string) => void;
    } = {},
  ) {
    if (options.boot?.kind === 'loaded') {
      this.world = options.boot.world;
    } else {
      this.world = createWorld(options.seed ?? options.boot?.seed ?? 42);
    }
    this.budget = createBudget();
    this.onUiSync = onUiSync;
    this.onNotify = options.onNotify ?? null;
    this.saveRepo = options.saveRepository ?? null;
    this.renderer = new ThreeRenderer(canvas, {
      onPointerDown: () => {
        audioBus.unlock();
      },
      onRotate: (dx, dy) => this.rotatePlanet(dx, dy),
      onZoom: (delta) => this.zoom(delta),
      onHover: (hit) => this.handleHover(hit),
      onClick: (hit) => this.handleClick(hit),
    });
    this.renderer.syncWorld(this.world);
    window.addEventListener('beforeunload', this.onBeforeUnload);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  setSaveRepository(repo: SaveRepository | null): void {
    this.saveRepo = repo;
  }

  start(): void {
    this.lastT = performance.now();
    const loop = (t: number) => {
      if (this.disposed) return;
      const dt = Math.min(0.05, (t - this.lastT) / 1000);
      this.lastT = t;
      tickWorld(this.world, this.budget, dt);
      this.renderer.syncWorld(this.world);
      this.renderer.render(dt);
      this.checkDayNightChime();
      const pending = !!this.world.pendingEvent;
      if (pending && !this.hadPendingEvent) audioBus.eventOpen();
      this.hadPendingEvent = pending;

      this.autosaveAcc += dt;
      if (this.autosaveAcc >= AUTOSAVE_SECONDS) {
        this.autosaveAcc = 0;
        void this.saveNow('autosave');
      }

      this.uiSyncAcc += dt;
      if (this.uiSyncAcc >= 0.12) {
        this.uiSyncAcc = 0;
        this.onUiSync(this.world, this.hover);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    audioBus.stopAmbient();
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.renderer.dispose();
  }

  async saveNow(id = 'autosave'): Promise<SaveMeta | null> {
    if (!this.saveRepo || this.saving) return null;
    this.saving = true;
    try {
      const meta = await this.saveRepo.saveWorld(this.world, id);
      this.lastSaveAt = meta.savedAt;
      this.saveError = null;
      return meta;
    } catch (err) {
      this.saveError = err instanceof Error ? err.message : String(err);
      return null;
    } finally {
      this.saving = false;
    }
  }

  /** Replace current world with a freshly generated planet. */
  newGame(seed = Math.floor(Math.random() * 1e9)): void {
    this.world = createWorld(seed);
    this.budget = createBudget();
    this.hover = { kind: 'none' };
    this.selectedPlantId = null;
    this.renderer.syncWorld(this.world);
    void this.saveNow('autosave');
  }

  /** Swap in a loaded world (already hydrated by SaveRepository). */
  applyWorld(world: GameWorldState): void {
    this.world = world;
    this.budget = createBudget();
    this.hover = { kind: 'none' };
    this.selectedPlantId = null;
    this.renderer.syncWorld(this.world);
  }

  setSpeed(speed: number): void {
    this.world.time.speed = speed;
  }

  setTool(tool: ToolMode): void {
    this.tool = tool;
  }

  doRain(): void {
    if (rain(this.world)) audioBus.rain();
  }

  private checkDayNightChime(): void {
    const f = this.world.stats.dayFraction;
    // Crossing into day (~0) or night (~0.5)
    if (this.lastDayFraction < 0.5 && f >= 0.5) audioBus.nightChime();
    if (this.lastDayFraction > 0.5 && f <= 0.5) audioBus.dayChime();
    this.lastDayFraction = f;
  }

  get pendingEvent(): PendingEvent | null {
    return this.world.pendingEvent;
  }

  resolveEvent(accept: boolean): void {
    const result = resolvePendingEvent(this.world, accept);
    if (!result) return;
    this.notify(result.message);
    if (accept) {
      this.renderer.playEventVfx(result.eventId, result.impact ?? null);
      audioBus.eventAccept();
      if (result.eventId === 'meteor') audioBus.meteor();
      if (result.eventId === 'migratingBirds') audioBus.birds();
      if (result.eventId === 'gentleRain') audioBus.rain();
    } else {
      audioBus.eventDecline();
    }
  }

  /** Drag sets angular velocity (capped); planet coasts after release. */
  rotatePlanet(dx: number, dy: number): void {
    const p = this.world.planet;
    // px/frame-ish → rad/s, clamped in tickWorld as well
    p.spinVelY = Math.max(-0.95, Math.min(0.95, dx * 0.045));
    p.spinVelX = Math.max(-0.45, Math.min(0.45, dy * 0.028));
  }

  zoom(delta: number): void {
    this.renderer.zoom(delta);
  }

  private handleHover(hit: ReturnType<ThreeRenderer['pick']>): void {
    if (!hit) {
      this.hover = { kind: 'none' };
      this.renderer.setHoverMarker(null);
      return;
    }
    if (hit.type === 'plant') {
      this.hover = { kind: 'plant', plant: hit.plant };
      this.renderer.setHoverMarker(null);
      return;
    }
    if (hit.type === 'animal') {
      this.hover = { kind: 'animal', animal: hit.animal };
      this.renderer.setHoverMarker(null);
      return;
    }
    if (hit.type === 'surface') {
      this.hover = {
        kind: 'surface',
        light: hit.light,
        water: hit.water,
        localNormal: { x: hit.localNormal.x, y: hit.localNormal.y, z: hit.localNormal.z },
      };
      this.renderer.setHoverMarker(hit.point);
      return;
    }
    this.hover = { kind: 'none' };
    this.renderer.setHoverMarker(null);
  }

  private handleClick(hit: ReturnType<ThreeRenderer['pick']>): void {
    if (!hit) return;

    if (this.tool === 'rain') {
      if (rain(this.world)) {
        audioBus.rain();
        this.notify('降下一场小雨');
      }
      return;
    }

    // Planting uses surface raycast so clicking existing grass doesn't swallow the action
    if (this.tool === 'plant-tree' || this.tool === 'plant-grass' || this.tool === 'plant-flower') {
      const surface = this.renderer.pickSurface();
      if (!surface) {
        this.notify('请点击星球表面');
        return;
      }
      const species = this.tool === 'plant-tree' ? 'tree' : this.tool === 'plant-flower' ? 'flower' : 'grass';
      const result = plantTreeAt(this.world, surface.localNormal, species);
      if (!result.ok) {
        this.notify(this.plantFailText(result.reason, species));
      } else {
        audioBus.plant();
      }
      return;
    }

    if (this.tool === 'spawn-rabbit' || this.tool === 'spawn-fox') {
      const surface = hit.type === 'surface' ? hit : this.renderer.pickSurface();
      if (!surface) {
        this.notify('请点击星球表面');
        return;
      }
      if (this.tool === 'spawn-fox') {
        const ok = spawnFoxAt(this.world, surface.localNormal);
        if (!ok) {
          this.notify(this.world.resources.stardust < 10 ? '星尘不足（引狐需 10）' : '狐狸已经够多了');
        }
        return;
      }
      const result = spawnRabbitAt(this.world, surface.localNormal);
      if (!result) this.notify(this.world.resources.stardust < 8 ? '星尘不足（需 8）' : '兔子已经够多了');
      return;
    }

    if (hit.type === 'plant') {
      this.selectedPlantId = hit.plant.id;
      return;
    }
    if (hit.type === 'animal') {
      return;
    }
    if (hit.type === 'surface') {
      this.selectedPlantId = null;
    }
  }

  private plantFailText(reason: string, species: 'tree' | 'grass' | 'flower'): string {
    if (reason === 'stardust') {
      if (species === 'tree') return '星尘不足（种树需 5）';
      if (species === 'flower') return '星尘不足（种花需 3）';
      return '星尘不足（种草需 2）';
    }
    if (reason === 'cap') return '星球上植物太多了';
    if (reason === 'dense') return '这里太挤了，换一块空地';
    return '无法种植';
  }

  private notify(msg: string): void {
    this.onNotify?.(msg);
  }
}
