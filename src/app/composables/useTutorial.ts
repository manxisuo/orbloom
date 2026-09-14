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
  let peakPlantCount = 0;

  function init(isContinue: boolean) {
    if (isContinue || localStorage.getItem(TUTORIAL_KEY)) {
      done.value = true;
      return;
    }
    done.value = false;
    step.value = 0;
    basePlantCount = store.stats.plantCount;
    peakPlantCount = basePlantCount;
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

  function tick(worldRotY: number, plantCount: number) {
    if (done.value) return;

    const dRot = Math.abs(worldRotY - lastRotY);
    if (dRot < Math.PI) rotTravel += dRot;
    lastRotY = worldRotY;
    if (plantCount > peakPlantCount) peakPlantCount = plantCount;

    const s = step.value;
    if (s === 0) {
      if (rotTravel > 0.45) advance(0);
      return;
    }
    if (s === 1) {
      if (plantCount > basePlantCount) advance(1);
      return;
    }
    if (s === 2) {
      if (store.hoverLight > 0.45) sawDaylight = true;
      // Need a bit of rotation AFTER entering this step, plus seeing daylight
      if (sawDaylight && rotTravel > 0.25) advance(2);
      return;
    }
    if (s === 3) {
      const grazed = plantCount < peakPlantCount;
      const elapsed = (performance.now() - stepStartedAt) / 1000;
      if (grazed || elapsed > 28 || store.stats.day > 1) advance(3);
    }
  }

  return { done, step, init, skip, tick };
}
