<script setup lang="ts">
import { useGameStore } from '../stores/gameStore';
import type { ToolMode } from '../../shared/types';
import { RAIN_COST } from '../../simulation/actions';

const store = useGameStore();
const emit = defineEmits<{ pick: [tool: ToolMode]; rain: [] }>();

const tools: { id: ToolMode; label: string; hint: string; cost?: number }[] = [
  { id: 'plant-tree', label: '种树', hint: '点击球面种下一棵树', cost: 5 },
  { id: 'plant-grass', label: '种草', hint: '为兔子提供食物', cost: 2 },
  { id: 'plant-flower', label: '种花', hint: '吸引蜜蜂授粉', cost: 3 },
  { id: 'plant-mushroom', label: '种菇', hint: '夜间生长并发光', cost: 4 },
  { id: 'spawn-rabbit', label: '引兔', hint: '让一只兔子来到这里', cost: 8 },
  { id: 'spawn-fox', label: '引狐', hint: '狐狸会捕食兔子', cost: 10 },
];
</script>

<template>
  <aside class="hud tool-panel">
    <div class="panel-title tool-title">值日工具</div>
    <div class="tool-scroll">
      <button
        class="tool-btn inspect-btn"
        :class="{ active: store.tool === 'inspect' }"
        title="只查看，不建造"
        @click="emit('pick', 'inspect')"
      >
        <span class="tool-label">观察</span>
      </button>
      <div class="tool-divider" />
      <button
        v-for="t in tools"
        :key="t.id"
        class="tool-btn"
        :class="{ active: store.tool === t.id }"
        :title="t.hint"
        @click="emit('pick', t.id)"
      >
        <span class="tool-label">{{ t.label }}</span>
        <span v-if="t.cost" class="tool-cost">{{ t.cost }}</span>
      </button>
      <button
        class="tool-btn rain-btn"
        :disabled="store.rainCooldown > 0"
        :title="`滋润湖泊，消耗 ${RAIN_COST} 星尘`"
        @click="emit('rain')"
      >
        <span>{{ store.rainCooldown > 0 ? `冷却 ${Math.ceil(store.rainCooldown)}s` : '降雨' }}</span>
        <span class="tool-cost rain-cost"><span class="cost-dot" />{{ RAIN_COST }}</span>
      </button>
    </div>
    <p class="hint desktop-hint">
      拖动甩动星球（带惯性）<br />滚轮缩放<br />点击表面执行工具<br />每 45 秒自动存档
    </p>
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
.tool-divider {
  height: 1px;
  background: rgba(160, 190, 230, 0.18);
  margin: 4px 0;
}
.rain-btn {
  margin-top: 4px;
  justify-content: center;
  gap: 8px;
}
.rain-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.rain-cost {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.cost-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f0d78c;
  box-shadow: 0 0 6px #f0d78c;
}
.hint {
  margin-top: 10px;
  font-size: 11px;
  line-height: 1.5;
  opacity: 0.5;
}

@media (max-width: 720px), (max-height: 500px) {
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
  .tool-divider {
    width: 1px;
    height: 28px;
    margin: 0 2px;
    align-self: center;
    flex: 0 0 auto;
  }
  .desktop-hint {
    display: none;
  }
}
</style>
