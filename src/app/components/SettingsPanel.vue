<script setup lang="ts">
import { EVENT_DEFS } from '../../simulation/events/eventCards';
import { useAudioPrefs } from '../composables/useAudioPrefs';

defineProps<{ open: boolean; quality: 'low' | 'medium' | 'high' }>();
const emit = defineEmits<{ 'set-quality': [level: 'low' | 'medium' | 'high']; 'trigger-event': [id: (typeof EVENT_DEFS)[number]['id']] }>();

const { masterVol, musicVol, muted, onMasterVol, onMusicVol, toggleMute } = useAudioPrefs();

const qualityOptions = [
  { id: 'low' as const, label: '低' },
  { id: 'medium' as const, label: '中' },
  { id: 'high' as const, label: '高' },
];

const eventDefs = EVENT_DEFS;
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="hud settings-panel">
      <div class="panel-title">画质</div>
      <div class="tool-scroll quality-row">
        <button
          v-for="q in qualityOptions"
          :key="q.id"
          class="tool-btn"
          :class="{ active: quality === q.id }"
          @click="emit('set-quality', q.id)"
        >
          {{ q.label }}
        </button>
      </div>

      <div class="panel-title">声音</div>
      <label class="vol-row">
        <span>总音量</span>
        <input v-model.number="masterVol" type="range" min="0" max="1" step="0.05" @input="onMasterVol" />
        <b>{{ Math.round(masterVol * 100) }}</b>
      </label>
      <label class="vol-row">
        <span>音乐</span>
        <input v-model.number="musicVol" type="range" min="0" max="1" step="0.05" @input="onMusicVol" />
        <b>{{ Math.round(musicVol * 100) }}</b>
      </label>
      <button class="tool-btn" @click="toggleMute">{{ muted ? '取消静音' : '静音' }}</button>
      <p class="hint">首次点击画面后才会出声</p>

      <div class="panel-title">触发事件（测试）</div>
      <div class="event-grid">
        <button
          v-for="ev in eventDefs"
          :key="ev.id"
          class="tool-btn event-chip"
          @click="emit('trigger-event', ev.id)"
        >
          {{ ev.title }}
        </button>
      </div>
    </div>
  </transition>
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
.quality-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.quality-row .tool-btn {
  min-width: 48px;
  justify-content: center;
}
.event-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.event-chip {
  justify-content: center;
  padding: 6px 8px;
  font-size: 12px;
}
.hint {
  margin-top: 10px;
  font-size: 11px;
  line-height: 1.5;
  opacity: 0.5;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 720px), (max-height: 500px) {
  .settings-panel {
    top: 52px;
    right: 8px;
    left: auto;
    width: min(220px, calc(100% - 16px));
  }
}
</style>
