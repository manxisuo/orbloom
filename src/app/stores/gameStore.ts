import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { EcoStats, LogEntry, PendingEvent, ToolMode } from '../../shared/types';

export const useGameStore = defineStore('game', () => {
  const stardust = ref(30);
  const speed = ref(1);
  const tool = ref<ToolMode>('plant-tree');
  const stats = ref<EcoStats>({
    averageLight: 0,
    averageWater: 0,
    averageHealth: 0,
    plantCount: 0,
    animalCount: 0,
    stability: 0,
    dayFraction: 0,
    day: 1,
  });
  const log = ref<LogEntry[]>([]);
  const hoverLight = ref(0);
  const hoverWater = ref(0);
  const hoverLabel = ref('');
  const notice = ref('');
  const pendingEvent = ref<PendingEvent | null>(null);
  let noticeTimer = 0;

  const dayLabel = computed(() => stats.value.day || 1);

  function sync(payload: {
    stardust: number;
    speed: number;
    stats: EcoStats;
    log: LogEntry[];
    hoverLight: number;
    hoverWater: number;
    hoverLabel: string;
    pendingEvent?: PendingEvent | null;
  }) {
    stardust.value = payload.stardust;
    speed.value = payload.speed;
    stats.value = payload.stats;
    log.value = payload.log;
    hoverLight.value = payload.hoverLight;
    hoverWater.value = payload.hoverWater;
    hoverLabel.value = payload.hoverLabel;
    if (payload.pendingEvent !== undefined) pendingEvent.value = payload.pendingEvent;
  }

  function setTool(t: ToolMode) {
    tool.value = t;
  }

  function setSpeed(s: number) {
    speed.value = s;
  }

  function flash(msg: string) {
    notice.value = msg;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
      notice.value = '';
    }, 2200);
  }

  return {
    stardust,
    speed,
    tool,
    stats,
    log,
    hoverLight,
    hoverWater,
    hoverLabel,
    notice,
    pendingEvent,
    dayLabel,
    sync,
    setTool,
    setSpeed,
    flash,
  };
});
