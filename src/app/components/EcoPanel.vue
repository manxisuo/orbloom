<script setup lang="ts">
import { useGameStore } from '../stores/gameStore';

defineProps<{ open: boolean }>();
const emit = defineEmits<{ replay: []; close: [] }>();

const store = useGameStore();

const logFilters = [
  { id: 'all' as const, label: '全部' },
  { id: 'plant' as const, label: '种植' },
  { id: 'animal' as const, label: '生命' },
  { id: 'event' as const, label: '事件' },
  { id: 'weather' as const, label: '天候' },
  { id: 'personality' as const, label: '性情' },
  { id: 'wish' as const, label: '愿望' },
];
</script>

<template>
  <aside class="hud stats-panel" :class="{ 'stats-open': open }">
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
    <div class="log-filters">
      <button
        v-for="f in logFilters"
        :key="f.id"
        class="log-chip"
        :class="{ active: store.logFilter === f.id }"
        @click="store.logFilter = f.id"
      >
        {{ f.label }}
      </button>
    </div>
    <ul class="log">
      <li v-for="e in store.filteredLog" :key="e.id" :data-kind="e.kind">{{ e.text }}</li>
    </ul>
    <button class="tool-btn replay-btn" @click="emit('replay')">繁荣回放</button>
    <button class="tool-btn stats-close" @click="emit('close')">收起</button>
  </aside>
</template>

<style scoped>
.hud {
  position: absolute;
  z-index: 2;
  background: rgba(10, 16, 32, 0.72);
  border: 1px solid rgba(140, 170, 220, 0.18);
  backdrop-filter: blur(10px);
  border-radius: 14px;
}
.stats-panel {
  top: 78px;
  right: 14px;
  width: 220px;
  padding: 12px 14px;
  display: none;
}
.stats-panel.stats-open {
  display: block;
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
.stats-close {
  display: none;
  margin-top: 8px;
  justify-content: center;
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
.log-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}
.log-chip {
  border: 1px solid rgba(160, 190, 230, 0.18);
  background: rgba(255, 255, 255, 0.04);
  color: #c9d6f0;
  font-size: 10px;
  padding: 3px 7px;
  border-radius: 99px;
  cursor: pointer;
}
.log-chip.active {
  background: rgba(140, 200, 255, 0.2);
  color: #fff;
}
.replay-btn {
  margin-top: 6px;
  justify-content: center;
}
.log li[data-kind='event'] {
  border-left-color: #f0d78c;
}
.log li[data-kind='personality'] {
  border-left-color: #c4b8ff;
}
.log li[data-kind='animal'] {
  border-left-color: #9be38a;
}
.log li[data-kind='wish'] {
  border-left-color: #8b7cf0;
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

@media (max-width: 720px), (max-height: 500px) {
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
}
</style>
