<script setup lang="ts">
import type { SaveMeta } from '../../persistence/types';

defineProps<{ meta: SaveMeta | null; storageLabel: string }>();
const emit = defineEmits<{ continue: []; 'new-game': [] }>();

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}
</script>

<template>
  <div class="boot-overlay">
    <div class="boot-card">
      <div class="boot-orb" />
      <h1>星球值日生</h1>
      <p class="boot-sub">Orbloom · 转动昼夜，照料你的微小世界</p>
      <div v-if="meta" class="boot-save">
        <div class="boot-save-title">发现存档</div>
        <div class="boot-save-line">{{ meta.label }}</div>
        <div class="boot-save-meta">
          星尘 {{ Math.floor(meta.stardust) }} ·
          {{ meta.animalCount }} 动物 ·
          {{ formatTime(meta.savedAt) }}
        </div>
      </div>
      <div class="boot-actions">
        <button v-if="meta" class="boot-btn primary" @click="emit('continue')">继续值日</button>
        <button class="boot-btn" @click="emit('new-game')">
          {{ meta ? '新星球' : '开始值日' }}
        </button>
      </div>
      <p class="boot-hint">存档介质：{{ storageLabel }}</p>
    </div>
  </div>
</template>

<style scoped>
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

@media (max-width: 720px), (max-height: 500px) {
  .boot-card {
    padding: 22px 18px 16px;
  }
}
</style>
