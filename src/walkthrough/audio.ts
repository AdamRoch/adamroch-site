/* ————— Walkthrough audio engine —————
   Pure WebAudio: surf on a filtered noise bed, one low note for the head,
   marker charge tones, chimes, and a single deep horn. No assets. */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let bed: GainNode | null = null; // surf + drone ride here; the whiteout ducks it
let built = false;
let on = false;

let surfGain: GainNode | null = null;
let surfLfos: OscillatorNode[] = [];
let noiseSrc: AudioBufferSourceNode | null = null;
let droneGain: GainNode | null = null;

let toneOsc: OscillatorNode | null = null;
let toneGain: GainNode | null = null;
let toneActive = false;

function ensureContext(): AudioContext {
  if (ctx) return ctx;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  return ctx;
}

/* ————— the bed: surf wash + the head's drone, built once ————— */

function buildBed(): void {
  const ac = ensureContext();
  if (built) return;
  built = true;

  bed = ac.createGain();
  bed.gain.value = 1;
  bed.connect(master!);

  // surf: looping noise through a soft lowpass, two slow LFOs breathing on the gain
  const len = ac.sampleRate * 4;
  const buffer = ac.createBuffer(1, len, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseSrc = ac.createBufferSource();
  noiseSrc.buffer = buffer;
  noiseSrc.loop = true;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  lp.Q.value = 0.4;
  surfGain = ac.createGain();
  surfGain.gain.value = 0.045;
  noiseSrc.connect(lp);
  lp.connect(surfGain);
  surfGain.connect(bed);
  for (const [freq, depth] of [
    [0.045, 0.026],
    [0.083, 0.015],
  ] as const) {
    const lfo = ac.createOscillator();
    lfo.frequency.value = freq;
    const g = ac.createGain();
    g.gain.value = depth;
    lfo.connect(g);
    g.connect(surfGain.gain);
    lfo.start();
    surfLfos.push(lfo);
  }
  noiseSrc.start();

  // the head hums one low note; its level is walked in from the main loop
  const drone = ac.createOscillator();
  drone.type = 'sine';
  drone.frequency.value = 41.2; // E1
  droneGain = ac.createGain();
  droneGain.gain.value = 0;
  drone.connect(droneGain);
  droneGain.connect(bed);
  drone.start();
}

/* ————— public API ————— */

export function setEnabled(next: boolean): void {
  on = next;
  const ac = ensureContext();
  if (ac.state === 'suspended') void ac.resume();
  master!.gain.cancelScheduledValues(ac.currentTime);
  master!.gain.setTargetAtTime(next ? 0.7 : 0, ac.currentTime, next ? 0.9 : 0.35);
  if (next) buildBed();
}

export function duck(level: number, seconds: number): void {
  if (!ctx || !bed || !on) return;
  bed.gain.cancelScheduledValues(ctx.currentTime);
  bed.gain.setTargetAtTime(level, ctx.currentTime, seconds / 3);
}

// c in [0,1] — closeness to the head, already smoothed by the caller
export function setHeadCloseness(c: number): void {
  if (!droneGain) return;
  droneGain.gain.value = c * c * 0.16;
}

// progress in [0,1] while standing in a marker's radius, null when not
export function chargeTone(progress: number | null): void {
  if (!ctx || !master || !on) return;
  if (!toneOsc) {
    toneOsc = ctx.createOscillator();
    toneOsc.type = 'sine';
    toneGain = ctx.createGain();
    toneGain.gain.value = 0;
    toneOsc.connect(toneGain);
    toneGain.connect(master);
    toneOsc.start();
  }
  const now = ctx.currentTime;
  if (progress === null) {
    if (toneActive) {
      toneActive = false;
      toneGain!.gain.setTargetAtTime(0, now, 0.12);
    }
    return;
  }
  toneOsc.frequency.value = 165 + progress * 255; // rises as the seam fills
  if (!toneActive) {
    toneActive = true;
    toneGain!.gain.setTargetAtTime(0.05, now, 0.08);
  }
}

const CHIMES = [523.25, 659.25, 783.99]; // C5 · E5 · G5, one step per marker

export function chime(i: number): void {
  if (!ctx || !master || !on) return;
  const f = CHIMES[i % CHIMES.length];
  const now = ctx.currentTime;
  for (const [mult, level, decay] of [
    [1, 0.14, 1.2],
    [2, 0.045, 0.8],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f * mult;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(level, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    osc.connect(g);
    g.connect(master);
    osc.start(now);
    osc.stop(now + decay + 0.05);
  }
}

export function horn(): void {
  if (!ctx || !master || !on) return;
  const now = ctx.currentTime;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 150;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(0.22, now + 1.2); // a slow swell from far off
  g.gain.setValueAtTime(0.22, now + 2.6);
  g.gain.linearRampToValueAtTime(0.0001, now + 5.2);
  for (const f of [49.0, 49.35]) {
    // a beat apart — the distance does the detuning
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    osc.connect(lp);
    osc.start(now);
    osc.stop(now + 5.4);
  }
  lp.connect(g);
  g.connect(master);
}
