<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, computed } from 'vue';
import { Game, type SelectionInfo } from '../../game/Game';
import { useGameStore } from '../stores/gameStore';
import type { ToolMode, EventId } from '../../shared/types';
import { createSaveRepository } from '../../persistence';
import type { SaveMeta } from '../../persistence/types';
import { personalityLabel as personalityName } from '../../simulation/WorldSimulation';
import { isNarrowViewport, watchDevice } from '../../shared/device';
import { useTutorial } from '../composables/useTutorial';
import { useReplay } from '../composables/useReplay';
import { useAudioPrefs } from '../composables/useAudioPrefs';
import EventCard from './EventCard.vue';
import ReplayOverlay from './ReplayOverlay.vue';
import TutorialCard from './TutorialCard.vue';
import TopBar from './TopBar.vue';
import ToolPanel from './ToolPanel.vue';
import EcoPanel from './EcoPanel.vue';
import SettingsPanel from './SettingsPanel.vue';
import BootOverlay from './BootOverlay.vue';

import type { SelectionPanel } from '../stores/gameStore';

const store = useGameStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);
let game: Game | null = null;

const personalityLabel = computed(() =>
  store.worldReady ? personalityName(store.personality) : '-',
);

const showSettings = ref(false);
// Desktop opens the eco/log panel by default; narrow screens start collapsed.
const showStats = ref(!isNarrowViewport());
let statsUserToggled = false;
let stopDeviceWatch: (() => void) | null = null;

function toggleStats() {
  statsUserToggled = true;
  showStats.value = !showStats.value;
}
function closeStats() {
  statsUserToggled = true;
  showStats.value = false;
}

const quality = ref<'low' | 'medium' | 'high'>('high');

// --- Newbie tutorial ---
const {
  done: tutorialDone,
  step: tutorialStep,
  init: initTutorial,
  skip: skipTutorial,
  tick: tickTutorial,
} = useTutorial();

const { loadAudioPrefs } = useAudioPrefs();

const repo = createSaveRepository('auto');

const bootReady = ref(false);
const hasExistingSave = ref(false);
const existingMeta = ref<SaveMeta | null>(null);
const storageLabel = ref(repo.backendName);
const saving = ref(false);
const lastSavedLabel = ref('');

onMounted(async () => {
  loadAudioPrefs();
  const canvas = canvasRef.value;
  if (!canvas) return;

  let loadedWorld: import('../../shared/types').GameWorldState | null = null;
  try {
    const latest = await repo.loadLatest();
    if (latest) {
      hasExistingSave.value = true;
      existingMeta.value = latest.meta;
      loadedWorld = latest.world;
    }
  } catch {
    // Storage may be unavailable — still allow new game.
  }

  game = new Game(canvas, (world, hover, selection) => {
    let hoverLight = 0;
    let hoverWater = 0;
    let hoverLabel = '—';

    if (hover.kind === 'surface') {
      hoverLight = hover.light;
      hoverWater = hover.water;
      const band = hover.light > 0.25 ? '日照' : hover.light > 0.02 ? '黄昏' : '黑夜';
      hoverLabel = `${band} · 光照 ${(hover.light * 100).toFixed(0)}%`;
    } else if (hover.kind === 'plant') {
      hoverLabel = `${speciesName(hover.plant.species)} · 健康 ${(hover.plant.health * 100).toFixed(0)}%`;
      hoverWater = hover.plant.water;
      hoverLight = 0.5;
    } else if (hover.kind === 'animal') {
      const name =
        hover.animal.species === 'bee' ? '蜜蜂' : hover.animal.species === 'fox' ? '狐狸' : '兔子';
      hoverLabel = `${name} · ${stateName(hover.animal.state)}`;
      hoverWater = hover.animal.hunger;
    }

    store.sync({
      stardust: world.resources.stardust,
      speed: world.time.speed,
      stats: world.stats,
      log: world.log.slice(-60).reverse(),
      hoverLight,
      hoverWater,
      hoverLabel,
      pendingEvent: world.pendingEvent,
      personality: world.personality,
      selection: buildSelectionPanel(selection),
    });
    tickTutorial(world.planet.rotationY, world.stats.plantCount);
  }, {
    seed: 42,
    boot: loadedWorld ? { kind: 'loaded', world: loadedWorld } : { kind: 'new', seed: 42 },
    saveRepository: repo,
    onNotify: (msg) => store.flash(msg),
  });

  game.setTool(store.tool);
  const savedQ = localStorage.getItem('orbloom:quality') as 'low' | 'medium' | 'high' | null;
  if (savedQ === 'low' || savedQ === 'medium' || savedQ === 'high') {
    quality.value = savedQ;
    game.renderer.setQuality(savedQ);
  } else {
    quality.value = game.renderer.getQuality();
  }

  if (hasExistingSave.value) {
    game.setSpeed(0);
    bootReady.value = true;
  } else {
    game.start();
    bootReady.value = false;
    store.setWorldReady(true);
    initTutorial(false);
  }

  // Auto-fit the eco/log panel to the viewport until the player toggles it.
  stopDeviceWatch = watchDevice(({ narrow }) => {
    if (!statsUserToggled) showStats.value = !narrow;
  });
});

function clearSelection() {
  game?.clearSelection();
  store.flash('已取消选中');
}

const { start: startReplay, stop: stopReplay, dispose: disposeReplay } = useReplay();

onBeforeUnmount(() => {
  stopDeviceWatch?.();
  disposeReplay();
  game?.dispose();
  game = null;
});

function speciesName(s: string) {
  return s === 'tree' ? '树木' : s === 'grass' ? '草地' : s === 'mushroom' ? '发光蘑菇' : '花朵';
}

function animalName(s: string) {
  return s === 'bee' ? '蜜蜂' : s === 'fox' ? '狐狸' : '兔子';
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function buildSelectionPanel(sel: SelectionInfo): SelectionPanel {
  if (sel.kind === 'plant') {
    const p = sel.plant;
    return {
      kind: 'plant',
      title: speciesName(p.species),
      rows: [
        { label: '健康', value: pct(p.health) },
        { label: '生长', value: pct(p.growth) },
        { label: '水分', value: pct(p.water) },
        { label: '天龄', value: p.age.toFixed(1) },
      ],
    };
  }
  if (sel.kind === 'animal') {
    const a = sel.animal;
    return {
      kind: 'animal',
      title: animalName(a.species),
      rows: [
        { label: '状态', value: stateName(a.state) },
        { label: '饱食', value: pct(1 - a.hunger) },
        { label: '健康', value: pct(a.health) },
        { label: '年龄', value: a.age.toFixed(1) },
      ],
    };
  }
  return { kind: 'none', title: '', rows: [] };
}

function stateName(s: string) {
  const map: Record<string, string> = {
    wander: '游荡',
    seekFood: '觅食',
    eat: '进食',
    sleep: '睡眠',
    seekFlower: '寻花',
    pollinate: '授粉',
    flee: '逃跑',
    hunt: '狩猎',
  };
  return map[s] ?? s;
}

function pickTool(t: ToolMode) {
  store.setTool(t);
  game?.setTool(t);
}

function castRain() {
  if (game?.doRain()) store.flash('降下一场小雨');
  else store.flash('星尘不足（降雨需 6）');
}

function triggerEvent(id: EventId) {
  game?.triggerEvent(id);
}

function resolveEvent(accept: boolean) {
  game?.resolveEvent(accept);
}

function setSpeed(v: number) {
  store.setSpeed(v);
  game?.setSpeed(v);
}

function continueGame() {
  if (!game) return;
  game.setSpeed(1);
  store.setSpeed(1);
  game.start();
  bootReady.value = false;
  store.setWorldReady(true);
  initTutorial(true);
  store.flash('继续值日');
}

function startNewGame() {
  if (!game) return;
  const go = () => {
    game?.newGame();
    game?.setSpeed(1);
    store.setSpeed(1);
    game?.start();
    bootReady.value = false;
    store.setWorldReady(true);
    initTutorial(false);
    store.flash('新的星球苏醒了');
  };
  if (hasExistingSave.value) {
    if (!window.confirm('已有存档。开始新星球将覆盖自动存档，确定吗？')) return;
  }
  go();
}

function setQuality(level: 'low' | 'medium' | 'high') {
  quality.value = level;
  game?.renderer.setQuality(level);
  localStorage.setItem('orbloom:quality', level);
  store.flash(`画质：${level === 'low' ? '低' : level === 'medium' ? '中' : '高'}`);
}

async function manualSave() {
  if (!game || saving.value) return;
  saving.value = true;
  const meta = await game.saveNow('autosave');
  saving.value = false;
  if (meta) {
    lastSavedLabel.value = new Date(meta.savedAt).toLocaleTimeString();
    store.flash(`已存档 · ${meta.label}`);
  } else if (game.saveError) {
    store.flash(`存档失败：${game.saveError}`);
  }
}
</script>

<template>
  <div class="game-shell">
    <canvas ref="canvasRef" class="game-canvas" />

    <BootOverlay
      v-if="bootReady"
      :meta="existingMeta"
      :storage-label="storageLabel"
      @continue="continueGame"
      @new-game="startNewGame"
    />

    <TopBar
      :personality-label="personalityLabel"
      :saving="saving"
      :last-saved-label="lastSavedLabel"
      @save="manualSave"
      @toggle-stats="toggleStats"
      @toggle-settings="showSettings = !showSettings"
      @set-speed="setSpeed"
    />

    <SettingsPanel
      :open="showSettings"
      :quality="quality"
      @set-quality="setQuality"
      @trigger-event="triggerEvent"
    />

    <ToolPanel @pick="pickTool" @rain="castRain" />

    <EcoPanel :open="showStats" @replay="startReplay" @close="closeStats" />

    <transition name="fade">
      <div v-if="store.selection.kind !== 'none'" class="hud selection-panel">
        <div class="panel-title">选中</div>
        <div class="sel-title">{{ store.selection.title }}</div>
        <div v-for="row in store.selection.rows" :key="row.label" class="sel-row">
          <span>{{ row.label }}</span>
          <b>{{ row.value }}</b>
        </div>
        <button class="tool-btn" @click="clearSelection">关闭</button>
      </div>
    </transition>

    <ReplayOverlay @stop="stopReplay" />

    <EventCard @resolve="resolveEvent" />

    <TutorialCard
      :visible="!tutorialDone && !bootReady"
      :step="tutorialStep"
      @skip="skipTutorial"
    />

    <transition name="fade">
      <div v-if="store.notice" class="notice">{{ store.notice }}</div>
    </transition>
  </div>
</template>

<style scoped>
.game-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 100dvh;
  overflow: hidden;
  background: #050814;
  color: #e8eefc;
  font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  user-select: none;
}

.game-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
}
.game-canvas:active {
  cursor: grabbing;
}

.hud {
  position: absolute;
  z-index: 2;
  background: rgba(10, 16, 32, 0.72);
  border: 1px solid rgba(140, 170, 220, 0.18);
  backdrop-filter: blur(10px);
  border-radius: 14px;
}

.panel-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  opacity: 0.55;
  margin-bottom: 4px;
}

.tool-btn {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid rgba(160, 190, 230, 0.15);
  background: rgba(255, 255, 255, 0.04);
  color: #dce6fa;
  border-radius: 10px;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 13px;
}
.tool-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.selection-panel {
  bottom: 16px;
  left: 160px;
  width: 180px;
  padding: 10px 12px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sel-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
}
.sel-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  opacity: 0.9;
}
.sel-row b {
  font-variant-numeric: tabular-nums;
}

.notice {
  position: absolute;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3;
  background: rgba(20, 30, 50, 0.88);
  border: 1px solid rgba(160, 200, 255, 0.3);
  padding: 10px 18px;
  border-radius: 999px;
  font-size: 13px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ---- Mobile / narrow ---- */
@media (max-width: 720px), (max-height: 500px) {
  .selection-panel {
    left: 8px;
    right: 8px;
    width: auto;
    bottom: 72px;
  }

  .notice {
    bottom: 96px;
    font-size: 12px;
    max-width: calc(100% - 24px);
  }
}
</style>
