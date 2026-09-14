<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ visible: boolean; step: number }>();
const emit = defineEmits<{ skip: [] }>();

const TEXTS = [
  '按住画面拖动，转动星球（惯性会带着它继续转）',
  '在左侧选择「种草」，点击星球表面种下一丛',
  '继续转动，让草地进入阳光下',
  '稍等片刻，看兔子是否跑来吃草',
  '很好！你已经会照料这颗星球了',
];

const text = computed(() => TEXTS[Math.min(props.step, TEXTS.length - 1)]);
const shownStep = computed(() => Math.min(props.step + 1, 4));
</script>

<template>
  <transition name="fade">
    <div v-if="visible" class="tutorial-card">
      <div class="tutorial-step">引导 {{ shownStep }}/4</div>
      <p>{{ text }}</p>
      <button class="tutorial-skip" @click="emit('skip')">跳过</button>
    </div>
  </transition>
</template>

<style scoped>
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

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 720px), (max-height: 500px) {
  .tutorial-card {
    bottom: 88px;
  }
}
</style>
