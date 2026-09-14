<script setup lang="ts">
import { useGameStore } from '../stores/gameStore';

const store = useGameStore();
const emit = defineEmits<{ stop: [] }>();
</script>

<template>
  <transition name="fade">
    <div v-if="store.replayOpen" class="replay-overlay" @click.self="emit('stop')">
      <div class="replay-card">
        <div class="replay-kicker">繁荣回放</div>
        <p class="replay-text">
          {{ store.replayMilestones[store.replayIndex]?.text }}
        </p>
        <div class="replay-dots">
          <span
            v-for="(m, i) in store.replayMilestones"
            :key="m.id"
            :class="{ on: i === store.replayIndex }"
          />
        </div>
        <button class="tool-btn" @click="emit('stop')">结束回放</button>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.replay-overlay {
  position: absolute;
  inset: 0;
  z-index: 12;
  display: grid;
  place-items: center;
  background: rgba(4, 8, 18, 0.72);
  backdrop-filter: blur(6px);
}
.replay-card {
  width: min(400px, calc(100% - 36px));
  padding: 28px 24px 20px;
  border-radius: 18px;
  background: rgba(12, 20, 40, 0.94);
  border: 1px solid rgba(180, 200, 240, 0.28);
  text-align: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.replay-kicker {
  font-size: 11px;
  letter-spacing: 0.16em;
  opacity: 0.55;
  margin-bottom: 12px;
}
.replay-text {
  margin: 0 0 18px;
  font-size: 16px;
  line-height: 1.6;
  min-height: 3.2em;
}
.replay-dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-bottom: 14px;
}
.replay-dots span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
}
.replay-dots span.on {
  background: #9be38a;
  box-shadow: 0 0 8px #9be38a;
}

/* Local copy of the shared `.tool-btn` look (scoped styles don't leak in). */
.tool-btn {
  display: flex;
  justify-content: center;
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

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
