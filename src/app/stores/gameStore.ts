import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { EcoStats, LogEntry, LogKind, PendingEvent, ToolMode } from '../../shared/types';

export type SelectionPanel =
  | {
      kind: 'plant';
      title: string;
      rows: { label: string; value: string }[];
    }
  | {
      kind: 'animal';
      title: string;
      rows: { label: string; value: string }[];
    }
  | { kind: 'none'; title: string; rows: never[] };

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
  const logFilter = ref<'all' | LogKind>('all');
  const replayOpen = ref(false);
  const replayIndex = ref(0);
  const hoverLight = ref(0);
  const hoverWater = ref(0);
  const hoverLabel = ref('');
  const notice = ref('');
  const pendingEvent = ref<PendingEvent | null>(null);
  const personality = ref('wild');
  const selection = ref<SelectionPanel>({ kind: 'none', title: '', rows: [] });
  /** False until the first playable world is live — UI shows "-" placeholders. */
  const worldReady = ref(false);
  let noticeTimer = 0;

  const dayLabel = computed(() => (worldReady.value ? stats.value.day || 1 : '-'));
  const stardustLabel = computed(() =>
    worldReady.value ? String(Math.floor(stardust.value)) : '-',
  );
  const personalityDisplay = computed(() => (worldReady.value ? personality.value : '-'));

  const filteredLog = computed(() => {
    if (logFilter.value === 'all') return log.value;
    return log.value.filter((e) => e.kind === logFilter.value);
  });

  /** Milestones for prosperity replay: firsts + personality + rare life. */
  const replayMilestones = computed(() => {
    const out: LogEntry[] = [];
    const seen = new Set<string>();
    const push = (e: LogEntry | undefined) => {
      if (!e || seen.has(e.id)) return;
      seen.add(e.id);
      out.push(e);
    };
    const first = (pred: (e: LogEntry) => boolean) => push(log.value.find(pred));
    first((e) => e.kind === 'plant' && e.text.includes('种下'));
    first((e) => e.text.includes('兔子来到了'));
    first((e) => e.text.includes('小生命'));
    first((e) => e.text.includes('蜜蜂'));
    first((e) => e.kind === 'personality');
    first((e) => e.kind === 'event' && e.text.includes('流星'));
    first((e) => e.kind === 'event' && e.text.includes('机械'));
    first((e) => e.text.includes('候鸟如约'));
    // Keep chronological
    out.sort((a, b) => a.gameTime - b.gameTime);
    return out;
  });

  function sync(payload: {
    stardust: number;
    speed: number;
    stats: EcoStats;
    log: LogEntry[];
    hoverLight: number;
    hoverWater: number;
    hoverLabel: string;
    pendingEvent?: PendingEvent | null;
    personality?: string;
    selection?: SelectionPanel;
  }) {
    stardust.value = payload.stardust;
    speed.value = payload.speed;
    stats.value = payload.stats;
    log.value = payload.log;
    hoverLight.value = payload.hoverLight;
    hoverWater.value = payload.hoverWater;
    hoverLabel.value = payload.hoverLabel;
    if (payload.pendingEvent !== undefined) pendingEvent.value = payload.pendingEvent;
    if (payload.personality) personality.value = payload.personality;
    if (payload.selection) selection.value = payload.selection;
  }

  function setTool(t: ToolMode) {
    tool.value = t;
  }

  function setSpeed(s: number) {
    speed.value = s;
  }

  function setWorldReady(v: boolean) {
    worldReady.value = v;
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
    personality,
    selection,
    worldReady,
    dayLabel,
    stardustLabel,
    personalityDisplay,
    logFilter,
    filteredLog,
    replayOpen,
    replayIndex,
    replayMilestones,
    sync,
    setTool,
    setSpeed,
    setWorldReady,
    flash,
  };
});
