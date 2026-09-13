<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, computed } from 'vue';
import { Game, type SelectionInfo } from '../../game/Game';
import { useGameStore } from '../stores/gameStore';
import type { ToolMode } from '../../shared/types';
import { createSaveRepository } from '../../persistence';
import type { SaveMeta } from '../../persistence/types';
import { personalityLabel as personalityName } from '../../simulation/WorldSimulation';
import { audioBus } from '../../game/audio';

import type { SelectionPanel } from '../stores/gameStore';

const store = useGameStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);
let game: Game | null = null;

const personalityLabel = computed(() => personalityName(store.personality));

const showSettings = ref(false);
const showStats = ref(false);
const masterVol = ref(0.85);
const musicVol = ref(0.55);
const muted = ref(false);

// --- Newbie tutorial ---
const TUTORIAL_KEY = 'orbloom:tutorialDone';
const tutorialDone = ref(true);
const tutorialStep = ref(0);
let basePlantCount = 0;
let rotTravel = 0;
let lastRotY = 0;
let sawDaylight = false;

const tutorialTexts = [
  '按住画面拖动，转动星球（惯性会带着它继续转）',
  '在左侧选择「种草」，点击星球表面种下一丛',
  '继续转动，让草地进入阳光下',
  '稍等片刻，看兔子是否跑来吃草',
  '很好！你已经会照料这颗星球了',
];

function initTutorial(isContinue: boolean) {
  if (isContinue || localStorage.getItem(TUTORIAL_KEY)) {
    tutorialDone.value = true;
    return;
  }
  tutorialDone.value = false;
  tutorialStep.value = 0;
  basePlantCount = store.stats.plantCount;
  peakPlantCount = basePlantCount;
  rotTravel = 0;
  lastRotY = 0;
  sawDaylight = false;
  stepStartedAt = performance.now();
}

function skipTutorial() {
  tutorialDone.value = true;
  localStorage.setItem(TUTORIAL_KEY, '1');
}

function advanceTutorial(from: number) {
  if (tutorialDone.value || tutorialStep.value !== from) return;
  tutorialStep.value = from + 1;
  // Reset per-step trackers so the next step cannot complete on leftover state
  rotTravel = 0;
  sawDaylight = false;
  stepStartedAt = performance.now();
  if (tutorialStep.value >= 4) {
    window.setTimeout(() => skipTutorial(), 2800);
  }
}

let stepStartedAt = 0;
let peakPlantCount = 0;

function tickTutorial(worldRotY: number, plantCount: number) {
  if (tutorialDone.value) return;

  const dRot = Math.abs(worldRotY - lastRotY);
  if (dRot < Math.PI) rotTravel += dRot;
  lastRotY = worldRotY;
  if (plantCount > peakPlantCount) peakPlantCount = plantCount;

  const step = tutorialStep.value;
  if (step === 0) {
    if (rotTravel > 0.45) advanceTutorial(0);
    return;
  }
  if (step === 1) {
    if (plantCount > basePlantCount) advanceTutorial(1);
    return;
  }
  if (step === 2) {
    if (store.hoverLight > 0.45) sawDaylight = true;
    // Need a bit of rotation AFTER entering this step, plus seeing daylight
    if (sawDaylight && rotTravel > 0.25) advanceTutorial(2);
    return;
  }
  if (step === 3) {
    const grazed = plantCount < peakPlantCount;
    const elapsed = (performance.now() - stepStartedAt) / 1000;
    if (grazed || elapsed > 28 || store.stats.day > 1) advanceTutorial(3);
  }
}

function loadAudioPrefs() {
  try {
    const raw = localStorage.getItem('orbloom:audio');
    if (!raw) return;
    const p = JSON.parse(raw) as { master?: number; music?: number; muted?: boolean };
    if (typeof p.master === 'number') masterVol.value = p.master;
    if (typeof p.music === 'number') musicVol.value = p.music;
    if (typeof p.muted === 'boolean') muted.value = p.muted;
  } catch {
    /* ignore */
  }
  applyAudioPrefs();
}

function applyAudioPrefs() {
  audioBus.setMasterVolume(masterVol.value);
  audioBus.setMusicVolume(musicVol.value);
  audioBus.muted = muted.value;
  localStorage.setItem(
    'orbloom:audio',
    JSON.stringify({ master: masterVol.value, music: musicVol.value, muted: muted.value }),
  );
}

function onMasterVol() {
  applyAudioPrefs();
}
function onMusicVol() {
  applyAudioPrefs();
}
function toggleMute() {
  muted.value = !muted.value;
  applyAudioPrefs();
}

const repo = createSaveRepository('auto');

const bootReady = ref(false);
const hasExistingSave = ref(false);
const existingMeta = ref<SaveMeta | null>(null);
const storageLabel = ref(repo.backendName);
const saving = ref(false);
const lastSavedLabel = ref('');

const tools: { id: ToolMode; label: string; hint: string; cost?: number }[] = [
  { id: 'plant-tree', label: '种树', hint: '点击球面种下一棵树', cost: 5 },
  { id: 'plant-grass', label: '种草', hint: '为兔子提供食物', cost: 2 },
  { id: 'plant-flower', label: '种花', hint: '吸引蜜蜂授粉', cost: 3 },
  { id: 'plant-mushroom', label: '种菇', hint: '夜间生长并发光', cost: 4 },
  { id: 'spawn-rabbit', label: '引兔', hint: '让一只兔子来到这里', cost: 8 },
  { id: 'spawn-fox', label: '引狐', hint: '狐狸会捕食兔子', cost: 10 },
  { id: 'rain', label: '降雨', hint: '滋润湖泊（点星球任意处）', cost: 6 },
  { id: 'inspect', label: '观察', hint: '只查看，不建造' },
];

const speeds = [
  { v: 0, label: '⏸' },
  { v: 1, label: '1×' },
  { v: 2, label: '2×' },
  { v: 4, label: '4×' },
];

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
      log: world.log.slice(-14).reverse(),
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

  if (hasExistingSave.value) {
    game.setSpeed(0);
    bootReady.value = true;
  } else {
    game.start();
    bootReady.value = false;
    initTutorial(false);
  }
});

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function clearSelection() {
  game?.clearSelection();
  store.flash('已取消选中');
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
  game?.doRain();
  store.flash('降下一场小雨');
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
    initTutorial(false);
    store.flash('新的星球苏醒了');
  };
  if (hasExistingSave.value) {
    if (!window.confirm('已有存档。开始新星球将覆盖自动存档，确定吗？')) return;
  }
  go();
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

onBeforeUnmount(() => {
  game?.dispose();
  game = null;
});
</script>

<template>
  <div class="game-shell">
    <canvas ref="canvasRef" class="game-canvas" />

    <!-- Boot overlay -->
    <div v-if="bootReady" class="boot-overlay">
      <div class="boot-card">
        <div class="boot-orb" />
        <h1>星球值日生</h1>
        <p class="boot-sub">Orbloom · 转动昼夜，照料你的微小世界</p>
        <div v-if="existingMeta" class="boot-save">
          <div class="boot-save-title">发现存档</div>
          <div class="boot-save-line">{{ existingMeta.label }}</div>
          <div class="boot-save-meta">
            星尘 {{ Math.floor(existingMeta.stardust) }} ·
            {{ existingMeta.animalCount }} 动物 ·
            {{ formatTime(existingMeta.savedAt) }}
          </div>
        </div>
        <div class="boot-actions">
          <button v-if="existingMeta" class="boot-btn primary" @click="continueGame">继续值日</button>
          <button class="boot-btn" @click="startNewGame">
            {{ existingMeta ? '新星球' : '开始值日' }}
          </button>
        </div>
        <p class="boot-hint">存档介质：{{ storageLabel }}</p>
      </div>
    </div>

    <!-- Top resource bar -->
    <header class="hud top-bar">
      <div class="brand">
        <span class="brand-orb" />
        <div>
          <div class="title">星球值日生</div>
          <div class="subtitle">
            Orbloom · 第 {{ store.dayLabel }} 天 · {{ personalityLabel }}
            <span v-if="lastSavedLabel" class="saved-tag">已存 {{ lastSavedLabel }}</span>
          </div>
        </div>
      </div>

      <div class="resource">
        <span class="dot stardust-dot" />
        <span class="res-val">{{ Math.floor(store.stardust) }}</span>
        <span class="res-label">星尘</span>
      </div>

      <button class="save-btn" :disabled="saving" @click="manualSave">
        {{ saving ? '存档中…' : '存档' }}
      </button>
      <button class="save-btn" @click="showStats = !showStats">生态</button>
      <button class="save-btn" @click="showSettings = !showSettings">设置</button>

      <div class="speed-group">
        <button
          v-for="s in speeds"
          :key="s.v"
          class="speed-btn"
          :class="{ active: store.speed === s.v }"
          @click="setSpeed(s.v)"
        >
          {{ s.label }}
        </button>
      </div>
    </header>

    <transition name="fade">
      <div v-if="showSettings" class="hud settings-panel">
        <div class="panel-title">声音</div>
        <label class="vol-row">
          <span>总音量</span>
          <input
            v-model.number="masterVol"
            type="range"
            min="0"
            max="1"
            step="0.05"
            @input="onMasterVol"
          />
          <b>{{ Math.round(masterVol * 100) }}</b>
        </label>
        <label class="vol-row">
          <span>音乐</span>
          <input
            v-model.number="musicVol"
            type="range"
            min="0"
            max="1"
            step="0.05"
            @input="onMusicVol"
          />
          <b>{{ Math.round(musicVol * 100) }}</b>
        </label>
        <button class="tool-btn" @click="toggleMute">{{ muted ? '取消静音' : '静音' }}</button>
        <p class="hint">首次点击画面后才会出声</p>
      </div>
    </transition>

    <!-- Left tools -->
    <aside class="hud tool-panel">
      <div class="panel-title tool-title">值日工具</div>
      <div class="tool-scroll">
        <button
          v-for="t in tools"
          :key="t.id"
          class="tool-btn"
          :class="{ active: store.tool === t.id }"
          :title="t.hint"
          @click="pickTool(t.id)"
        >
          <span class="tool-label">{{ t.label }}</span>
          <span v-if="t.cost" class="tool-cost">{{ t.cost }}</span>
        </button>
        <button class="tool-btn rain-btn" @click="castRain">降雨</button>
      </div>
      <p class="hint desktop-hint">
        拖动甩动星球（带惯性）<br />滚轮缩放<br />点击表面执行工具<br />每 45 秒自动存档
      </p>
    </aside>

    <!-- Right stats -->
    <aside class="hud stats-panel" :class="{ 'stats-open': showStats }">
      <div class="panel-title">生态状态</div>
      <div class="stat-row">
        <span>日照</span>
        <div class="bar"><i :style="{ width: `${Math.round(store.hoverLight * 100)}%` }" /></div>
      </div>
      <div class="stat-row">
        <span>水分</span>
        <div class="bar water"><i :style="{ width: `${Math.round(store.stats.averageWater * 100)}%` }" /></div>
      </div>
      <div class="stat-row">
        <span>健康</span>
        <div class="bar health"><i :style="{ width: `${Math.round(store.stats.averageHealth * 100)}%` }" /></div>
      </div>
      <div class="stat-row">
        <span>稳定</span>
        <div class="bar stable"><i :style="{ width: `${Math.round(store.stats.stability * 100)}%` }" /></div>
      </div>
      <div class="counts">
        <div><b>{{ store.stats.plantCount }}</b> 植物</div>
        <div><b>{{ store.stats.animalCount }}</b> 动物</div>
      </div>
      <div class="hover-line">{{ store.hoverLabel }}</div>
      <div class="panel-title log-title">星球日志</div>
      <ul class="log">
        <li v-for="e in store.log" :key="e.id">{{ e.text }}</li>
      </ul>
      <button class="tool-btn stats-close" @click="showStats = false">收起</button>
    </aside>

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

    <transition name="fade">
      <div v-if="store.pendingEvent" class="event-overlay">
        <div class="event-card">
          <div class="event-kicker">星球事件</div>
          <h2>{{ store.pendingEvent.title }}</h2>
          <p>{{ store.pendingEvent.body }}</p>
          <div class="event-actions">
            <button class="event-btn primary" @click="resolveEvent(true)">
              {{ store.pendingEvent.acceptLabel }}
            </button>
            <button class="event-btn" @click="resolveEvent(false)">
              {{ store.pendingEvent.declineLabel }}
            </button>
          </div>
        </div>
      </div>
    </transition>

    <transition name="fade">
      <div v-if="!tutorialDone && !bootReady" class="tutorial-card">
        <div class="tutorial-step">引导 {{ Math.min(tutorialStep + 1, 4) }}/4</div>
        <p>{{ tutorialTexts[Math.min(tutorialStep, 4)] }}</p>
        <button class="tutorial-skip" @click="skipTutorial">跳过</button>
      </div>
    </transition>

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

.boot-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  background: rgba(5, 8, 20, 0.72);
  backdrop-filter: blur(8px);
}

.boot-card {
  width: min(360px, calc(100% - 40px));
  padding: 28px 24px 22px;
  border-radius: 18px;
  background: rgba(12, 18, 36, 0.92);
  border: 1px solid rgba(150, 180, 230, 0.22);
  text-align: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
}

.boot-orb {
  width: 56px;
  height: 56px;
  margin: 0 auto 12px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #b8f0c8, #3d8fd1 55%, #1a3a5c);
  box-shadow: 0 0 24px rgba(100, 180, 255, 0.4);
}

.boot-card h1 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 650;
  letter-spacing: 0.06em;
}

.boot-sub {
  margin: 0 0 16px;
  font-size: 12px;
  opacity: 0.6;
}

.boot-save {
  text-align: left;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(150, 180, 230, 0.12);
  margin-bottom: 16px;
}

.boot-save-title {
  font-size: 11px;
  opacity: 0.55;
  letter-spacing: 0.08em;
  margin-bottom: 4px;
}

.boot-save-line {
  font-size: 14px;
  font-weight: 600;
}

.boot-save-meta {
  margin-top: 4px;
  font-size: 11px;
  opacity: 0.65;
}

.boot-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.boot-btn {
  border: 1px solid rgba(160, 190, 230, 0.2);
  background: rgba(255, 255, 255, 0.05);
  color: #e8eefc;
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 14px;
  cursor: pointer;
}
.boot-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}
.boot-btn.primary {
  background: linear-gradient(135deg, #3d8fd1, #4caf82);
  border-color: transparent;
  font-weight: 600;
}
.boot-btn.primary:hover {
  filter: brightness(1.08);
}

.boot-hint {
  margin: 14px 0 0;
  font-size: 11px;
  opacity: 0.4;
}

.hud {
  position: absolute;
  z-index: 2;
  background: rgba(10, 16, 32, 0.72);
  border: 1px solid rgba(140, 170, 220, 0.18);
  backdrop-filter: blur(10px);
  border-radius: 14px;
}

.top-bar {
  top: 14px;
  left: 14px;
  right: 14px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-right: auto;
}

.brand-orb {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #b8f0c8, #3d8fd1 55%, #1a3a5c);
  box-shadow: 0 0 12px rgba(100, 180, 255, 0.45);
}

.title {
  font-weight: 600;
  font-size: 15px;
  letter-spacing: 0.04em;
}
.subtitle {
  font-size: 11px;
  opacity: 0.65;
}
.saved-tag {
  margin-left: 6px;
  opacity: 0.75;
  color: #9be38a;
}

.resource {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.stardust-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #f0d78c;
  box-shadow: 0 0 8px #f0d78c;
  align-self: center;
}
.res-val {
  font-size: 20px;
  font-weight: 700;
  color: #f6e7b0;
  font-variant-numeric: tabular-nums;
}
.res-label {
  font-size: 12px;
  opacity: 0.7;
}

.save-btn {
  border: 1px solid rgba(160, 190, 230, 0.22);
  background: rgba(255, 255, 255, 0.06);
  color: #dce6fa;
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.save-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}
.save-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.settings-panel {
  top: 68px;
  right: 14px;
  width: 220px;
  padding: 12px 14px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.vol-row {
  display: grid;
  grid-template-columns: 44px 1fr 32px;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.vol-row input[type='range'] {
  width: 100%;
  accent-color: #7ec8a0;
}
.vol-row b {
  text-align: right;
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
}

.speed-group {
  display: flex;
  gap: 4px;
  background: rgba(255, 255, 255, 0.06);
  padding: 4px;
  border-radius: 10px;
}
.speed-btn {
  border: none;
  background: transparent;
  color: #c9d6f0;
  padding: 6px 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  min-width: 36px;
}
.speed-btn.active {
  background: rgba(140, 200, 255, 0.22);
  color: #fff;
}

.tool-panel {
  top: 78px;
  left: 14px;
  width: 132px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tool-scroll {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stats-close {
  display: none;
  margin-top: 8px;
  justify-content: center;
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
.tool-btn.active {
  border-color: rgba(150, 220, 180, 0.55);
  background: rgba(90, 180, 130, 0.18);
}
.tool-cost {
  font-size: 11px;
  color: #f0d78c;
  opacity: 0.9;
}
.rain-btn {
  margin-top: 4px;
  justify-content: center;
}
.hint {
  margin-top: 10px;
  font-size: 11px;
  line-height: 1.5;
  opacity: 0.5;
}

.stats-panel {
  top: 78px;
  right: 14px;
  width: 220px;
  padding: 12px 14px;
}

.stat-row {
  display: grid;
  grid-template-columns: 36px 1fr;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  opacity: 0.9;
}
.bar {
  height: 8px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 99px;
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #f0d78c, #ffe9a8);
  border-radius: 99px;
  transition: width 0.2s ease;
}
.bar.water i {
  background: linear-gradient(90deg, #3d8fd1, #7ec8ff);
}
.bar.health i {
  background: linear-gradient(90deg, #3f9b4f, #9be38a);
}
.bar.stable i {
  background: linear-gradient(90deg, #8b7cf0, #c4b8ff);
}

.counts {
  display: flex;
  gap: 14px;
  margin: 10px 0 6px;
  font-size: 12px;
  opacity: 0.85;
}
.counts b {
  font-size: 16px;
  margin-right: 2px;
}

.hover-line {
  font-size: 11px;
  opacity: 0.7;
  min-height: 16px;
  margin-bottom: 8px;
}

.log-title {
  margin-top: 6px;
}
.log {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 160px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.log li {
  font-size: 11px;
  line-height: 1.4;
  opacity: 0.78;
  padding-left: 8px;
  border-left: 2px solid rgba(140, 180, 220, 0.35);
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

.tutorial-card {
  position: absolute;
  bottom: 72px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 7;
  width: min(360px, calc(100% - 40px));
  padding: 12px 16px;
  border-radius: 14px;
  background: rgba(14, 24, 44, 0.92);
  border: 1px solid rgba(150, 210, 180, 0.35);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  text-align: center;
}
.tutorial-step {
  font-size: 11px;
  letter-spacing: 0.1em;
  opacity: 0.55;
  margin-bottom: 4px;
}
.tutorial-card p {
  margin: 0 0 8px;
  font-size: 13px;
  line-height: 1.5;
}
.tutorial-skip {
  border: none;
  background: transparent;
  color: rgba(200, 220, 255, 0.55);
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}

.event-overlay {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: grid;
  place-items: center;
  background: rgba(5, 8, 20, 0.45);
  pointer-events: none;
}

.event-card {
  pointer-events: auto;
  width: min(340px, calc(100% - 32px));
  padding: 20px 18px 16px;
  border-radius: 16px;
  background: rgba(14, 22, 42, 0.94);
  border: 1px solid rgba(180, 200, 240, 0.28);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
  text-align: center;
}

.event-kicker {
  font-size: 11px;
  letter-spacing: 0.14em;
  opacity: 0.55;
  margin-bottom: 6px;
}

.event-card h2 {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 650;
}

.event-card p {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.55;
  opacity: 0.8;
}

.event-actions {
  display: flex;
  gap: 8px;
}

.event-btn {
  flex: 1;
  border: 1px solid rgba(160, 190, 230, 0.22);
  background: rgba(255, 255, 255, 0.05);
  color: #e8eefc;
  border-radius: 10px;
  padding: 10px 8px;
  font-size: 13px;
  cursor: pointer;
}
.event-btn.primary {
  background: linear-gradient(135deg, #3d8fd1, #4caf82);
  border-color: transparent;
  font-weight: 600;
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
  .top-bar {
    top: 0;
    left: 0;
    right: 0;
    border-radius: 0;
    padding: max(8px, env(safe-area-inset-top)) 10px 8px;
    gap: 8px;
    flex-wrap: wrap;
  }

  .brand .subtitle {
    display: none;
  }
  .brand-orb {
    width: 22px;
    height: 22px;
  }
  .title {
    font-size: 13px;
  }

  .resource .res-label {
    display: none;
  }
  .res-val {
    font-size: 16px;
  }

  .save-btn {
    padding: 8px 10px;
    min-height: 36px;
  }

  .speed-btn {
    min-width: 32px;
    min-height: 36px;
    padding: 6px 8px;
  }

  .tool-panel {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    width: auto;
    border-radius: 16px 16px 0 0;
    padding: 8px 8px max(10px, env(safe-area-inset-bottom));
    border-bottom: none;
  }

  .tool-title {
    display: none;
  }

  .tool-scroll {
    flex-direction: row;
    overflow-x: auto;
    gap: 6px;
    padding-bottom: 2px;
    -webkit-overflow-scrolling: touch;
  }

  .tool-btn {
    flex: 0 0 auto;
    min-height: 40px;
    min-width: 64px;
    padding: 8px 12px;
  }

  .rain-btn {
    margin-top: 0;
  }

  .desktop-hint {
    display: none;
  }

  .stats-panel {
    top: 56px;
    right: 8px;
    left: 8px;
    width: auto;
    max-height: min(48vh, 360px);
    overflow: auto;
    display: none;
    z-index: 9;
  }
  .stats-panel.stats-open {
    display: block;
  }
  .stats-close {
    display: flex;
  }

  .settings-panel {
    top: 52px;
    right: 8px;
    left: auto;
    width: min(220px, calc(100% - 16px));
  }

  .tutorial-card {
    bottom: 88px;
  }

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

  .event-card {
    padding: 16px 14px 12px;
  }

  .boot-card {
    padding: 22px 18px 16px;
  }
}
</style>
