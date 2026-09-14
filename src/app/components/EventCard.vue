<script setup lang="ts">
import { useGameStore } from '../stores/gameStore';

const store = useGameStore();
const emit = defineEmits<{ resolve: [accept: boolean] }>();
</script>

<template>
  <transition name="fade">
    <div v-if="store.pendingEvent" class="event-overlay">
      <div class="event-card">
        <div class="event-kicker">星球事件</div>
        <h2>{{ store.pendingEvent.title }}</h2>
        <p>{{ store.pendingEvent.body }}</p>
        <div class="event-actions">
          <button class="event-btn primary" @click="emit('resolve', true)">
            {{ store.pendingEvent.acceptLabel }}
          </button>
          <button class="event-btn" @click="emit('resolve', false)">
            {{ store.pendingEvent.declineLabel }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
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

@media (max-width: 720px), (max-height: 500px) {
  .event-card {
    padding: 16px 14px 12px;
  }
}
</style>
