import type {
  AnimalState,
  EventId,
  GameWorldState,
  PendingEvent,
  PlantState,
  ToolMode,
  Vec3Like,
} from '../shared/types';
import { createBudget, createWorld, tickWorld, type SimBudget } from '../simulation/WorldSimulation';
import {
  plantTreeAt,
  pushLog,
  rain,
  resolvePendingEvent,
  spawnFoxAt,
  spawnRabbitAt,
  type RainResult,
} from '../simulation/WorldSimulation';
import { findEventDef, toPending } from '../simulation/events/eventCards';
import { ThreeRenderer } from '../rendering/ThreeRenderer';
import type { SaveRepository } from '../persistence/SaveRepository';
import type { SaveMeta } from '../persistence/types';
import { audioBus } from './audio';

export type HoverInfo =
  | { kind: 'surface'; light: number; water: number; localNormal: Vec3Like }
  | { kind: 'plant'; plant: PlantState }
  | { kind: 'animal'; animal: AnimalState }
  | { kind: 'none' };

export type SelectionInfo =
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
  tool: ToolMode = 'inspect';
  hover: HoverInfo = { kind: 'none' };
  selected: { kind: 'plant' | 'animal'; id: string } | null = null;
  lastSaveAt: number | null = null;
  saveError: string | null = null;

  private raf = 0;
  private lastT = 0;
  private disposed = false;
  private onUiSync: (world: GameWorldState, hover: HoverInfo, selection: SelectionInfo) => void;
  private onNotify: ((msg: string) => void) | null;
  private uiSyncAcc = 0;
  private autosaveAcc = 0;
  private saveRepo: SaveRepository | null = null;
  private saving = false;
  private lastDayFraction = 0;
  private hadPendingEvent = false;
  private onBeforeUnload = () => {
    // Best-effort only: IndexedDB writes are async and may not finish on unload.
    // visibilitychange (below) is the reliable path; this is a last-ditch attempt.
    void this.saveNow('autosave');
  };
  private onVisibility = () => {
    if (document.visibilityState === 'hidden') void this.saveNow('autosave');
  };

  constructor(
    canvas: HTMLCanvasElement,
    onUiSync: (world: GameWorldState, hover: HoverInfo, selection: SelectionInfo) => void,
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
        this.onUiSync(this.world, this.hover, this.getSelectionInfo());
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
    this.applySelection(null);
    this.renderer.syncWorld(this.world);
    void this.saveNow('autosave');
  }

  /** Swap in a loaded world (already hydrated by SaveRepository). */
  applyWorld(world: GameWorldState): void {
    this.world = world;
    this.budget = createBudget();
    this.hover = { kind: 'none' };
    this.applySelection(null);
    this.renderer.syncWorld(this.world);
  }

  setSpeed(speed: number): void {
    this.world.time.speed = speed;
  }

  setTool(tool: ToolMode): void {
    this.tool = tool;
  }

  doRain(): RainResult {
    const result = rain(this.world);
    if (result.ok) audioBus.rain();
    return result;
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

  /** Testing/debug: force an event card to appear immediately. */
  triggerEvent(id: EventId): void {
    const def = findEventDef(id);
    this.world.pendingEvent = toPending(def);
    pushLog(this.world, `事件：${def.title}`, 'event');
    this.notify(`已触发：${def.title}`);
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

  getSelectionInfo(): SelectionInfo {
    if (!this.selected) return { kind: 'none' };
    if (this.selected.kind === 'plant') {
      const plant = this.world.plants.find((p) => p.id === this.selected!.id);
      if (!plant) {
        this.clearSelection();
        return { kind: 'none' };
      }
      return { kind: 'plant', plant };
    }
    const animal = this.world.animals.find((a) => a.id === this.selected!.id);
    if (!animal) {
      this.clearSelection();
      return { kind: 'none' };
    }
    return { kind: 'animal', animal };
  }

  clearSelection(): void {
    this.selected = null;
    this.renderer.setSelectionTarget(null, null);
    this.renderer.setSelectionMarker(null);
  }

  private applySelection(sel: { kind: 'plant' | 'animal'; id: string } | null): void {
    this.selected = sel;
    this.renderer.setSelectionTarget(sel?.kind ?? null, sel?.id ?? null);
    const info = this.getSelectionInfo();
    if (info.kind === 'plant') {
      this.renderer.setSelectionMarker(info.plant.position.normal, info.plant.position.altitude);
    } else if (info.kind === 'animal') {
      this.renderer.setSelectionMarker(info.animal.position.normal, 0.02);
    } else {
      this.renderer.setSelectionMarker(null);
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

    // Planting uses surface raycast so clicking existing grass doesn't swallow the action
    if (
      this.tool === 'plant-tree' ||
      this.tool === 'plant-grass' ||
      this.tool === 'plant-flower' ||
      this.tool === 'plant-mushroom'
    ) {
      const surface = this.renderer.pickSurface();
      if (!surface) {
        this.notify('请点击星球表面');
        return;
      }
      const species =
        this.tool === 'plant-tree'
          ? 'tree'
          : this.tool === 'plant-flower'
            ? 'flower'
            : this.tool === 'plant-mushroom'
              ? 'mushroom'
              : 'grass';
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
      this.applySelection({ kind: 'plant', id: hit.plant.id });
      return;
    }
    if (hit.type === 'animal') {
      this.applySelection({ kind: 'animal', id: hit.animal.id });
      return;
    }
    if (hit.type === 'surface') {
      this.applySelection(null);
    }
  }

  private plantFailText(reason: string, species: 'tree' | 'grass' | 'flower' | 'mushroom'): string {
    if (reason === 'stardust') {
      if (species === 'tree') return '星尘不足（种树需 5）';
      if (species === 'flower') return '星尘不足（种花需 3）';
      if (species === 'mushroom') return '星尘不足（种蘑菇需 4）';
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
