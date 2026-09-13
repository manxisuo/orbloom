/**
 * Tiny procedural SFX via Web Audio — no asset files, no Howler.
 * Call unlock() on first user gesture (browser autoplay policy).
 */
export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private unlocked = false;
  private ambientStarted = false;
  private ambientTimer: number | null = null;
  private chordIndex = 0;
  private _muted = false;
  private _masterVol = 0.85;
  private _musicVol = 0.55;
  private _sfxVol = 1;

  get muted(): boolean {
    return this._muted;
  }

  set muted(v: boolean) {
    this._muted = v;
    this.applyGains();
  }

  get masterVolume(): number {
    return this._masterVol;
  }

  setMasterVolume(v: number): void {
    this._masterVol = Math.min(1, Math.max(0, v));
    this.applyGains();
  }

  get musicVolume(): number {
    return this._musicVol;
  }

  setMusicVolume(v: number): void {
    this._musicVol = Math.min(1, Math.max(0, v));
    this.applyGains();
  }

  setSfxVolume(v: number): void {
    this._sfxVol = Math.min(1.5, Math.max(0, v));
  }

  private applyGains(): void {
    if (this.master) this.master.gain.value = this._muted ? 0 : this._masterVol;
    if (this.musicGain) this.musicGain.gain.value = 0.35 + this._musicVol * 0.65;
  }

  unlock(): void {
    if (this.unlocked) return;
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.connect(this.master);
      this.applyGains();
      this.unlocked = true;
      this.startAmbient();
    } catch {
      this.ctx = null;
    }
  }

  /** Soft generative pad — slow chords, sparse bell notes. */
  private startAmbient(): void {
    if (!this.ctx || !this.musicGain || this.ambientStarted) return;
    this.ambientStarted = true;

    const drone = this.ctx.createOscillator();
    const droneFilter = this.ctx.createBiquadFilter();
    const droneGain = this.ctx.createGain();
    drone.type = 'sine';
    drone.frequency.value = 55;
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 220;
    droneGain.gain.value = 0.07;
    drone.connect(droneFilter);
    droneFilter.connect(droneGain);
    droneGain.connect(this.musicGain);
    drone.start();

    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.05;
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain);
    lfoGain.connect(droneGain.gain);
    lfo.start();

    const scheduleChord = () => {
      if (!this.ctx || !this.musicGain) {
        this.ambientTimer = window.setTimeout(scheduleChord, 4000);
        return;
      }
      const chords = [
        [220.0, 277.18, 329.63],
        [196.0, 246.94, 293.66],
        [174.61, 220.0, 261.63],
        [164.81, 207.65, 246.94],
      ];
      const notes = chords[this.chordIndex % chords.length];
      this.chordIndex++;
      const t0 = this.ctx.currentTime;
      const hold = 7.5;

      for (let i = 0; i < notes.length; i++) {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        osc.type = i === 0 ? 'triangle' : 'sine';
        osc.frequency.value = notes[i] * (1 + (Math.random() - 0.5) * 0.002);
        filter.type = 'lowpass';
        filter.frequency.value = 1100;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.09 - i * 0.015, t0 + 1.6);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + hold);
        osc.connect(filter);
        filter.connect(g);
        g.connect(this.musicGain);
        osc.start(t0);
        osc.stop(t0 + hold + 0.1);
      }

      if (Math.random() < 0.55) {
        const delay = 1.2 + Math.random() * 3;
        window.setTimeout(() => {
          if (!this.ctx || !this.musicGain) return;
          const t = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          osc.type = 'sine';
          const base = notes[2] * 2;
          osc.frequency.value = base * (Math.random() < 0.5 ? 1 : 1.5);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.055, t + 0.05);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
          osc.connect(g);
          g.connect(this.musicGain);
          osc.start(t);
          osc.stop(t + 2.3);
        }, delay * 1000);
      }

      this.ambientTimer = window.setTimeout(scheduleChord, hold * 1000 * 0.95);
    };

    scheduleChord();
  }

  stopAmbient(): void {
    if (this.ambientTimer != null) {
      window.clearTimeout(this.ambientTimer);
      this.ambientTimer = null;
    }
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType = 'sine',
    gain = 0.2,
    slideTo?: number,
  ): void {
    if (!this.ctx || !this.master || this._muted) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(dur: number, gain = 0.08, filterHz = 1200): void {
    if (!this.ctx || !this.master || this._muted) return;
    const t0 = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterHz;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0);
  }

  plant(): void {
    this.tone(420, 0.12, 'triangle', 0.12, 620);
    this.noise(0.08, 0.04, 900);
  }

  rain(): void {
    this.noise(0.55, 0.07, 2400);
    this.tone(180, 0.4, 'sine', 0.04, 120);
  }

  eventOpen(): void {
    this.tone(520, 0.1, 'sine', 0.1, 780);
    this.tone(780, 0.14, 'sine', 0.08);
  }

  eventAccept(): void {
    this.tone(392, 0.12, 'triangle', 0.1);
    this.tone(523, 0.14, 'triangle', 0.1);
    this.tone(659, 0.2, 'triangle', 0.1);
  }

  eventDecline(): void {
    this.tone(330, 0.16, 'sine', 0.08, 260);
  }

  meteor(): void {
    this.tone(900, 0.35, 'sawtooth', 0.06, 80);
    this.noise(0.4, 0.1, 800);
  }

  birds(): void {
    for (let i = 0; i < 3; i++) {
      window.setTimeout(() => this.tone(1800 + i * 120, 0.08, 'sine', 0.05, 2200), i * 90);
    }
  }

  dayChime(): void {
    this.tone(880, 0.2, 'sine', 0.05, 1100);
  }

  nightChime(): void {
    this.tone(220, 0.35, 'sine', 0.05, 180);
  }
}

export const audioBus = new AudioBus();
