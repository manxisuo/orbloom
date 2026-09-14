<script setup lang="ts">
import { useGameStore } from '../stores/gameStore';

const store = useGameStore();
</script>

<template>
  <transition name="fade">
    <div v-if="store.wish" class="wish-card">
      <div class="wish-kicker">星球愿望</div>
      <div class="wish-title">{{ store.wish.title }}</div>
      <div class="wish-hint">{{ store.wish.hint }}</div>
      <div class="wish-bar"><i :style="{ width: `${Math.round(store.wish.progress * 100)}%` }" /></div>
      <div class="wish-time">剩余 {{ store.wish.daysLeft.toFixed(1) }} 天</div>
    </div>
  </transition>
</template>

<style scoped>
.wish-card {
  position: absolute;
  top: 72px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 4;
  width: min(280px, calc(100% - 28px));
  padding: 8px 12px 10px;
  border-radius: 12px;
  background: rgba(12, 20, 40, 0.78);
  border: 1px solid rgba(180, 200, 240, 0.25);
  backdrop-filter: blur(8px);
  text-align: center;
  pointer-events: none;
}
.wish-kicker {
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  opacity: 0.55;
}
.wish-title {
  font-size: 13px;
  font-weight: 600;
  margin-top: 2px;
}
.wish-hint {
  font-size: 11px;
  opacity: 0.7;
  margin-top: 2px;
}
.wish-bar {
  height: 6px;
  margin-top: 7px;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}
.wish-bar i {
  display: block;
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, #8b7cf0, #c4b8ff);
  transition: width 0.2s ease;
}
.wish-time {
  font-size: 10px;
  opacity: 0.6;
  margin-top: 4px;
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
  .wish-card {
    top: 58px;
  }
}
</style>
