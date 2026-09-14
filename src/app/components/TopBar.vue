<script setup lang="ts">
import { useGameStore } from '../stores/gameStore';

defineProps<{ personalityLabel: string; saving: boolean; lastSavedLabel: string }>();
const emit = defineEmits<{
  save: [];
  'toggle-stats': [];
  'toggle-settings': [];
  'set-speed': [v: number];
}>();

const store = useGameStore();

const speeds = [
  { v: 0, label: '⏸' },
  { v: 1, label: '1×' },
  { v: 2, label: '2×' },
  { v: 4, label: '4×' },
];
</script>

<template>
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
      <span class="res-val">{{ store.stardustLabel }}</span>
      <span class="res-label">星尘</span>
    </div>

    <button class="save-btn" :disabled="saving" @click="emit('save')">
      {{ saving ? '存档中…' : '存档' }}
    </button>
    <button class="save-btn" @click="emit('toggle-stats')">生态</button>
    <button class="save-btn" @click="emit('toggle-settings')">设置</button>

    <div class="speed-group">
      <button
        v-for="s in speeds"
        :key="s.v"
        class="speed-btn"
        :class="{ active: store.speed === s.v }"
        @click="emit('set-speed', s.v)"
      >
        {{ s.label }}
      </button>
    </div>
  </header>
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
}
</style>
