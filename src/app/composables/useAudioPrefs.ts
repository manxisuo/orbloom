import { ref } from 'vue';
import { audioBus } from '../../game/audio';

const AUDIO_KEY = 'orbloom:audio';

// Module-level singleton: the parent loads prefs at startup, the settings
// panel edits them — both see the same state.
const masterVol = ref(0.85);
const musicVol = ref(0.55);
const muted = ref(false);

function applyAudioPrefs() {
  audioBus.setMasterVolume(masterVol.value);
  audioBus.setMusicVolume(musicVol.value);
  audioBus.muted = muted.value;
  localStorage.setItem(
    AUDIO_KEY,
    JSON.stringify({ master: masterVol.value, music: musicVol.value, muted: muted.value }),
  );
}

function loadAudioPrefs() {
  try {
    const raw = localStorage.getItem(AUDIO_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as { master?: number; music?: number; muted?: boolean };
    if (typeof p.master === 'number') masterVol.value = p.master;
    if (typeof p.music === 'number') musicVol.value = p.music;
    if (typeof p.muted === 'boolean') muted.value = p.muted;
  } catch {
    /* ignore */
  }
  applyAudioPrefs();
}

function onMasterVol() {
  applyAudioPrefs();
}
function onMusicVol() {
  applyAudioPrefs();
}
function toggleMute() {
  muted.value = !muted.value;
  applyAudioPrefs();
}

export function useAudioPrefs() {
  return { masterVol, musicVol, muted, loadAudioPrefs, onMasterVol, onMusicVol, toggleMute };
}
