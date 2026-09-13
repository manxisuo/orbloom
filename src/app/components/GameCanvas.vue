<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { Game } from '../../game/Game';
import { useGameStore } from '../stores/gameStore';
import type { ToolMode } from '../../shared/types';
import { createSaveRepository } from '../../persistence';
import type { SaveMeta } from '../../persistence/types';

const store = useGameStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);
let game: Game | null = null;

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
  { id: 'spawn-rabbit', label: '引兔', hint: '让一只兔子来到这里', cost: 8 },
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

  game = new Game(canvas, (world, hover) => {
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
      const name = hover.animal.species === 'bee' ? '蜜蜂' : '兔子';
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
    });
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
  }
});

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function speciesName(s: string) {
  return s === 'tree' ? '树木' : s === 'grass' ? '草地' : '花朵';
}

function stateName(s: string) {
  const map: Record<string, string> = {
    wander: '游荡',
    seekFood: '觅食',
    eat: '进食',
    sleep: '睡眠',
    seekFlower: '寻花',
    pollinate: '授粉',
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

async function continueGame() {
  if (!game) return;
  try {
    const loaded = await repo.loadLatest();
    if (loaded) {
      game.applyWorld(loaded.world);
      store.flash(`已读取：${loaded.meta.label}`);
    }
  } catch (err) {
    store.flash(err instanceof Error ? err.message : '读档失败');
  }
  game.setSpeed(1);
  store.setSpeed(1);
  game.start();
  bootReady.value = false;
}

function startNewGame() {
  if (!game) return;
  const go = () => {
    game?.newGame();
    game?.setSpeed(1);
    store.setSpeed(1);
    game?.start();
    bootReady.value = false;
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
            Orbloom · 第 {{ store.dayLabel }} 天
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

    <!-- Left tools -->
    <aside class="hud tool-panel">
      <div class="panel-title">值日工具</div>
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
      <button class="tool-btn rain-btn" @click="castRain">立即降雨</button>
      <p class="hint">拖动旋转星球<br />滚轮缩放<br />点击表面执行工具<br />每 45 秒自动存档</p>
    </aside>

    <!-- Right stats -->
    <aside class="hud stats-panel">
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
    </aside>

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
      <div v-if="store.notice" class="notice">{{ store.notice }}</div>
    </transition>
  </div>
</template>

<style scoped>
.game-shell {
  position: relative;
  width: 100%;
  height: 100%;
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
</style>
