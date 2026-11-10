/** Cheerful synthesized sounds. Nothing is fetched; playback starts on the first tap. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private oscA: OscillatorNode | null = null;
  private oscB: OscillatorNode | null = null;
  private noise: AudioBuffer | null = null;

  unlock(): void {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    try {
      if (!this.ctx) {
        const ctx = new AudioCtx();
        this.ctx = ctx;
        const master = ctx.createGain();
        master.gain.value = 0.7;
        master.connect(ctx.destination);
        this.master = master;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 180;
        filter.Q.value = 0.7;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        filter.connect(gain);
        gain.connect(master);
        this.engineFilter = filter;
        this.engineGain = gain;

        const oscA = ctx.createOscillator();
        oscA.type = 'sawtooth';
        oscA.frequency.value = 48;
        const oscB = ctx.createOscillator();
        oscB.type = 'triangle';
        oscB.frequency.value = 72;
        oscA.connect(filter);
        oscB.connect(filter);
        oscA.start();
        oscB.start();
        this.oscA = oscA;
        this.oscB = oscB;

        const samples = ctx.sampleRate;
        const buffer = ctx.createBuffer(1, samples, samples);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1;
        this.noise = buffer;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    } catch (err) {
      console.info('Audio skipped', err);
      this.ctx = null;
      this.master = null;
      this.engineGain = null;
      this.engineFilter = null;
      this.oscA = null;
      this.oscB = null;
    }
  }

  setEngine(speed: number, throttle: number): void {
    if (!this.ctx || !this.engineGain || !this.engineFilter || !this.oscA || !this.oscB) return;
    const now = this.ctx.currentTime;
    const hum = throttle > 0.2 || speed > 1;
    const freq = 42 + Math.min(speed, 32) * 3.1 + throttle * 28;
    this.oscA.frequency.setTargetAtTime(freq, now, 0.08);
    this.oscB.frequency.setTargetAtTime(freq * 1.5, now, 0.08);
    this.engineFilter.frequency.setTargetAtTime(160 + throttle * 420 + speed * 8, now, 0.08);
    this.engineGain.gain.setTargetAtTime(hum ? 0.03 + throttle * 0.045 + Math.min(speed, 20) * 0.001 : 0, now, 0.06);
  }

  crunch(amount: number): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 280 + amount * 400;
    filter.Q.value = 0.6;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    const now = ctx.currentTime;
    const level = 0.16 + amount * 0.28;
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    src.start(now);
    src.stop(now + 0.24);

    const tone = ctx.createOscillator();
    tone.type = 'sine';
    const toneGain = ctx.createGain();
    tone.frequency.setValueAtTime(180 + amount * 40, now);
    tone.frequency.exponentialRampToValueAtTime(55, now + 0.18);
    toneGain.gain.setValueAtTime(0.08 + amount * 0.05, now);
    toneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    tone.connect(toneGain);
    toneGain.connect(this.master);
    tone.start(now);
    tone.stop(now + 0.22);
  }

  boing(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.08);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.22);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.28);
  }

  chime(): void {
    if (!this.ctx || !this.master) return;
    const notes = [523, 659, 784];
    const now = this.ctx.currentTime;
    notes.forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      osc.type = 'triangle';
      const gain = this.ctx!.createGain();
      const t = now + i * 0.06;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(gain);
      gain.connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.22);
    });
  }

  whoosh(): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(240, now);
    filter.frequency.exponentialRampToValueAtTime(1400, now + 0.28);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(now);
    src.stop(now + 0.44);
  }

  jingle(): void {
    if (!this.ctx || !this.master) return;
    const notes = [523, 659, 784, 1046];
    const now = this.ctx.currentTime;
    notes.forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      osc.type = 'triangle';
      const gain = this.ctx!.createGain();
      const t = now + i * 0.09;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
      osc.connect(gain);
      gain.connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  }

  pop(): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(now);
    src.stop(now + 0.09);
  }
}
