import { useGameStore } from '../stores/gameStore';

/** "Prosperity replay" slideshow controls (advances through log milestones). */
export function useReplay() {
  const store = useGameStore();
  let timer = 0;

  function start() {
    if (!store.replayMilestones.length) {
      store.flash('还没有足够的故事可回放');
      return;
    }
    store.replayOpen = true;
    store.replayIndex = 0;
    window.clearInterval(timer);
    timer = window.setInterval(() => {
      if (!store.replayOpen) {
        window.clearInterval(timer);
        return;
      }
      if (store.replayIndex < store.replayMilestones.length - 1) {
        store.replayIndex += 1;
      } else {
        window.clearInterval(timer);
      }
    }, 2800);
  }

  function stop() {
    store.replayOpen = false;
    window.clearInterval(timer);
  }

  function dispose() {
    window.clearInterval(timer);
  }

  return { start, stop, dispose };
}
