import { ref } from 'vue';
import { useGameStore } from '../stores/gameStore';

const TUTORIAL_KEY = 'orbloom:tutorialDone';

/** Newbie tutorial state machine, driven by the game's UI-sync callback. */
export function useTutorial() {
  const store = useGameStore();

  const done = ref(true);
  const step = ref(0);

  let basePlantCount = 0;
  let rotTravel = 0;
  let lastRotY = 0;
  let sawDaylight = false;
  let stepStartedAt = 0;
  let peakGrassGrowth = 0;

  function init(isContinue: boolean, starterPlantCount = 0) {
    if (isContinue || localStorage.getItem(TUTORIAL_KEY)) {
      done.value = true;
      return;
    }
    done.value = false;
    step.value = 0;
    // Use the live world count — store.stats is still 0 before the first UI sync.
    basePlantCount = starterPlantCount;
    peakGrassGrowth = 0;
    rotTravel = 0;
    lastRotY = 0;
    sawDaylight = false;
    stepStartedAt = performance.now();
  }

  function skip() {
    done.value = true;
    localStorage.setItem(TUTORIAL_KEY, '1');
  }

  function advance(from: number) {
    if (done.value || step.value !== from) return;
    step.value = from + 1;
    // Reset per-step trackers so the next step cannot complete on leftover state
    rotTravel = 0;
    sawDaylight = false;
    stepStartedAt = performance.now();
    if (step.value >= 4) {
      window.setTimeout(() => skip(), 2800);
    }
  }

  function tick(info: {
    rotY: number;
    plantCount: number;
    rabbitEating?: boolean;
    grassGrowth?: number;
  }) {
    if (done.value) return;

    const dRot = Math.abs(info.rotY - lastRotY);
    if (dRot < Math.PI) rotTravel += dRot;
    lastRotY = info.rotY;
    if (info.grassGrowth != null && info.grassGrowth > peakGrassGrowth) {
      peakGrassGrowth = info.grassGrowth;
    }

    const s = step.value;
    if (s === 0) {
      if (rotTravel > 0.45) advance(0);
      return;
    }
    if (s === 1) {
      if (info.plantCount > basePlantCount) advance(1);
      return;
    }
    if (s === 2) {
      if (store.hoverLight > 0.45) sawDaylight = true;
      // Need a bit of rotation AFTER entering this step, plus seeing daylight
      if (sawDaylight && rotTravel > 0.25) advance(2);
      return;
    }
    if (s === 3) {
      // Grazing lowers growth; it does not delete the plant.
      const grazed =
        !!info.rabbitEating ||
        (info.grassGrowth != null && peakGrassGrowth > 0 && info.grassGrowth < peakGrassGrowth - 0.04);
      const elapsed = (performance.now() - stepStartedAt) / 1000;
      if (grazed || elapsed > 28 || store.stats.day > 1) advance(3);
    }
  }

  return { done, step, init, skip, tick };
}
