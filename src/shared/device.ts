/**
 * Best-effort device / viewport detection.
 *
 * There is no reliable "is this a phone" API, so we combine two independent
 * signals instead of sniffing the user agent:
 *   - pointer capability (`pointer: coarse`, `maxTouchPoints`) → touch-first device
 *   - viewport size (narrow width OR short height)           → needs mobile layout
 *
 * Keep the breakpoints in sync with the `@media` rule in GameCanvas.vue.
 */
export const NARROW_MAX_WIDTH = 720;
export const NARROW_MAX_HEIGHT = 500;
export const NARROW_QUERY = `(max-width: ${NARROW_MAX_WIDTH}px), (max-height: ${NARROW_MAX_HEIGHT}px)`;
export const COARSE_QUERY = '(pointer: coarse)';

function matches(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}

/** Touch-first input: phones and tablets, even a large one. */
export function isCoarsePointer(): boolean {
  if (matches(COARSE_QUERY)) return true;
  const touchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints ?? 0 : 0;
  return touchPoints > 0;
}

/** Viewport is small enough to need the mobile layout. */
export function isNarrowViewport(): boolean {
  return matches(NARROW_QUERY);
}

/** Best-effort "the user is on a mobile/touch experience". */
export function isMobileExperience(): boolean {
  return isCoarsePointer() || isNarrowViewport();
}

export interface DeviceState {
  narrow: boolean;
  coarse: boolean;
}

/** Subscribe to viewport / pointer changes. Returns an unsubscribe function. */
export function watchDevice(onChange: (state: DeviceState) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const narrow = window.matchMedia(NARROW_QUERY);
  const coarse = window.matchMedia(COARSE_QUERY);
  const emit = () => onChange({ narrow: narrow.matches, coarse: coarse.matches });
  narrow.addEventListener('change', emit);
  coarse.addEventListener('change', emit);
  return () => {
    narrow.removeEventListener('change', emit);
    coarse.removeEventListener('change', emit);
  };
}
