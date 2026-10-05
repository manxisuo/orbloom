<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, computed } from 'vue';
import type { Game, SelectionInfo } from '../../game/Game';
import { useGameStore } from '../stores/gameStore';
import type { ToolMode, EventId } from '../../shared/types';
import { createSaveRepository } from '../../persistence';
import type { SaveMeta } from '../../persistence/types';
import { personalityLabel as personalityName, wishLabel } from '../../simulation/WorldSimulation';
import { isNarrowViewport, isWebGLAvailable, watchDevice } from '../../shared/device';
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
import WishCard from './WishCard.vue';

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
const fatalError = ref('');
const loadError = ref('');
const confirmNewPlanet = ref(false);
const engineReady = ref(false);

onMounted(async () => {
  loadAudioPrefs();
  const canvas = canvasRef.value;
  if (!canvas) return;

  if (!isWebGLAvailable()) {
    fatalError.value = '当前浏览器/环境无法创建 WebGL 上下文。';
    return;
  }

  let loadedWorld: import('../../shared/types').GameWorldState | null = null;
  try {
    const inspected = await repo.inspectLatest();
    if (inspected.status === 'ok') {
      hasExistingSave.value = true;
      existingMeta.value = inspected.save.meta;
      loadedWorld = inspected.save.world;
    } else if (inspected.status === 'corrupt') {
      loadError.value = inspected.error;
      hasExistingSave.value = false;
      loadedWorld = null;
    }
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : '存档数据损坏';
    hasExistingSave.value = false;
    loadedWorld = null;
  }

  try {
    const { Game } = await import('../../game/Game');
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
      chronicle: world.log,
      hoverLight,
      hoverWater,
      hoverLabel,
      pendingEvent: world.pendingEvent,
      personality: world.personality,
      selection: buildSelectionPanel(selection),
      rainCooldown: world.rainCooldown,
      wish: world.wish
        ? {
            ...wishLabel(world.wish.id),
            progress: world.wish.progress,
            daysLeft: Math.max(
              0,
              (world.wish.deadline - world.time.gameTime) / world.time.dayLength,
            ),
          }
        : null,
    });
    tickTutorial({
      rotY: world.planet.rotationY,
      plantCount: world.stats.plantCount,
      rabbitEating: world.animals.some((a) => a.species === 'rabbit' && a.state === 'eat'),
      grassGrowth: world.plants
        .filter((p) => p.species === 'grass')
        .reduce((sum, p) => sum + p.growth, 0),
    });
  }, {
    seed: Math.floor(Math.random() * 1e9),
    boot: loadedWorld
      ? { kind: 'loaded', world: loadedWorld }
      : { kind: 'new', seed: Math.floor(Math.random() * 1e9) },
    saveRepository: repo,
    onNotify: (msg) => store.flash(msg),
  });
  } catch (err) {
    fatalError.value = err instanceof Error ? err.message : '无法初始化 3D 渲染。';
    return;
  }
  engineReady.value = true;

  game.setTool(store.tool);
  const savedQ = localStorage.getItem('orbloom:quality') as 'low' | 'medium' | 'high' | null;
  if (savedQ === 'low' || savedQ === 'medium' || savedQ === 'high') {
    quality.value = savedQ;
    game.renderer.setQuality(savedQ);
  } else {
    quality.value = game.renderer.getQuality();
  }

  if (hasExistingSave.value || loadError.value) {
    game.setSpeed(0);
    bootReady.value = true;
  } else {
    game.start();
    bootReady.value = false;
    store.setWorldReady(true);
    initTutorial(false, game.world.stats.plantCount);
  }

  // Auto-fit the eco/log panel to the viewport until the player toggles it.
  stopDeviceWatch = watchDevice(({ narrow }) => {
    if (!statsUserToggled) showStats.value = !narrow;
  });

  window.addEventListener('keydown', onKeydown);
});

function clearSelection() {
  game?.clearSelection();
  store.flash('已取消选中');
}

const { start: startReplay, stop: stopReplay, dispose: disposeReplay } = useReplay();

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  stopDeviceWatch?.();
  disposeReplay();
  game?.dispose();
  game = null;
});

const KEY_TOOLS: Record<string, ToolMode> = {
  Digit1: 'inspect',
  Digit2: 'plant-tree',
  Digit3: 'plant-grass',
  Digit4: 'plant-flower',
  Digit5: 'plant-mushroom',
  Digit6: 'spawn-rabbit',
  Digit7: 'spawn-fox',
};

function onKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    return;
  }
  if (fatalError.value || !store.worldReady) return;
  if (store.replayOpen) return;

  if (e.code === 'Space') {
    e.preventDefault();
    setSpeed(store.speed === 0 ? 1 : 0);
    return;
  }
  if (e.code === 'KeyR') {
    e.preventDefault();
    castRain();
    return;
  }
  const tool = KEY_TOOLS[e.code];
  if (tool) {
    e.preventDefault();
    pickTool(tool);
    return;
  }
  if (e.code === 'ArrowLeft') {
    e.preventDefault();
    game?.rotatePlanet(-10, 0);
    return;
  }
  if (e.code === 'ArrowRight') {
    e.preventDefault();
    game?.rotatePlanet(10, 0);
    return;
  }
  if (e.code === 'ArrowUp') {
    e.preventDefault();
    game?.rotatePlanet(0, -8);
    return;
  }
  if (e.code === 'ArrowDown') {
    e.preventDefault();
    game?.rotatePlanet(0, 8);
  }
}

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
  const result = game?.doRain();
  if (!result) return;
  if (result.ok) store.flash('降下一场小雨');
  else if (result.reason === 'cooldown') store.flash('湖泊还未平复，请稍候');
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
  loadError.value = '';
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
    loadError.value = '';
    game?.newGame();
    game?.setSpeed(1);
    store.setSpeed(1);
    game?.start();
    bootReady.value = false;
    store.setWorldReady(true);
    initTutorial(false, game?.world.stats.plantCount ?? 0);
    store.flash('新的星球苏醒了');
  };
  if (hasExistingSave.value && !confirmNewPlanet.value) {
    confirmNewPlanet.value = true;
    return;
  }
  confirmNewPlanet.value = false;
  go();
}

function cancelNewPlanet() {
  confirmNewPlanet.value = false;
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

    <div v-if="!engineReady && !fatalError" class="fatal-overlay" aria-live="polite">
      <div class="fatal-card">
        <div class="boot-orb loading-orb" />
        <h1>正在唤醒星球</h1>
        <p>加载三维引擎与星空……</p>
      </div>
    </div>

    <div v-if="fatalError" class="fatal-overlay">
      <div class="fatal-card">
        <h1>无法启动 3D 渲染</h1>
        <p>{{ fatalError }}</p>
        <p class="fatal-hint">请更新浏览器，或启用硬件加速 / WebGL 后重试。</p>
      </div>
    </div>

    <BootOverlay
      v-if="bootReady && !confirmNewPlanet"
      :meta="existingMeta"
      :storage-label="storageLabel"
      :load-error="loadError || null"
      @continue="continueGame"
      @new-game="startNewGame"
    />

    <div v-if="confirmNewPlanet" class="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-new-title">
      <div class="confirm-card">
        <h2 id="confirm-new-title">开始新星球？</h2>
        <p>已有存档。新星球会覆盖自动存档，确定吗？</p>
        <div class="confirm-actions">
          <button class="tool-btn" @click="cancelNewPlanet">再想想</button>
          <button class="tool-btn confirm-ok" @click="startNewGame">确定覆盖</button>
        </div>
      </div>
    </div>

    <TopBar
      :personality-label="personalityLabel"
      :saving="saving"
      :last-saved-label="lastSavedLabel"
      @save="manualSave"
      @toggle-stats="toggleStats"
      @toggle-settings="showSettings = !showSettings"
      @set-speed="setSpeed"
    />

    <WishCard />

    <SettingsPanel
      :open="showSettings"
      :quality="quality"
      @set-quality="setQuality"
      @trigger-event="triggerEvent"
    />

    <ToolPanel @pick="pickTool" @rain="castRain" />

    <EcoPanel :open="showStats" @replay="startReplay" @close="closeStats" />

    <transition name="fade">
      <div v-if="store.selection.kind !== 'none'" class="selection-panel">
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

.fatal-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  background: rgba(5, 8, 20, 0.9);
  padding: 24px;
}
.fatal-card {
  width: min(420px, 100%);
  padding: 28px 24px;
  border-radius: 18px;
  background: rgba(12, 18, 36, 0.95);
  border: 1px solid rgba(230, 150, 150, 0.35);
  text-align: center;
}
.fatal-card h1 {
  margin: 0 0 12px;
  font-size: 20px;
}
.fatal-card p {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.6;
  opacity: 0.85;
}
.fatal-hint {
  opacity: 0.55 !important;
  font-size: 12px !important;
}
.loading-orb {
  width: 56px;
  height: 56px;
  margin: 0 auto 12px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #b8f0c8, #3d8fd1 55%, #1a3a5c);
  box-shadow: 0 0 24px rgba(100, 180, 255, 0.4);
  animation: orb-pulse 1.6s ease-in-out infinite;
}
@keyframes orb-pulse {
  0%,
  100% {
    transform: scale(1);
    filter: brightness(1);
  }
  50% {
    transform: scale(1.06);
    filter: brightness(1.15);
  }
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
  position: absolute;
  bottom: 16px;
  left: 160px;
  width: 180px;
  padding: 10px 12px;
  z-index: 5;
  background: rgba(10, 16, 32, 0.72);
  border: 1px solid rgba(140, 170, 220, 0.18);
  backdrop-filter: blur(10px);
  border-radius: 14px;
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

.confirm-overlay {
  position: absolute;
  inset: 0;
  z-index: 16;
  display: grid;
  place-items: center;
  background: rgba(5, 8, 20, 0.72);
  backdrop-filter: blur(8px);
  padding: 24px;
}
.confirm-card {
  width: min(360px, 100%);
  padding: 22px 20px 16px;
  border-radius: 16px;
  background: rgba(12, 18, 36, 0.95);
  border: 1px solid rgba(150, 180, 230, 0.22);
  text-align: center;
}
.confirm-card h2 {
  margin: 0 0 8px;
  font-size: 18px;
}
.confirm-card p {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.55;
  opacity: 0.8;
}
.confirm-actions {
  display: flex;
  gap: 8px;
}
.confirm-actions .tool-btn {
  flex: 1;
  justify-content: center;
}
.confirm-ok {
  background: linear-gradient(135deg, #3d8fd1, #4caf82);
  border-color: transparent;
  font-weight: 600;
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
