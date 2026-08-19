/* ————— Exhibit 002 audio engine —————
   Pure WebAudio: a generative dark-ambient drone, an optional microphone
   source, one shared analyser, and position-mapped plucks. No assets. */

export type SoundState = 'off' | 'drone' | 'mic';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let droneNodes: OscillatorNode[] = [];
let droneFilter: BiquadFilterNode | null = null;
let droneLfo: OscillatorNode | null = null;
let noiseSource: AudioBufferSourceNode | null = null;
let micStream: MediaStream | null = null;
let micSource: MediaStreamAudioSourceNode | null = null;
let state: SoundState = 'off';

function ensureContext(): AudioContext {
  if (ctx) return ctx;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = 0;
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.82;
  master.connect(analyser);
  analyser.connect(ctx.destination);
  return ctx;
}

/* ————— the drone: detuned sines through a slow-wobbling lowpass + noise wash ————— */

function startDrone(): void {
  const ac = ensureContext();
  stopDrone();

  droneFilter = ac.createBiquadFilter();
  droneFilter.type = 'lowpass';
  droneFilter.frequency.value = 320;
  droneFilter.Q.value = 2.2;
  droneFilter.connect(master!);

  // slow filter wobble — the terrain's weather system
  droneLfo = ac.createOscillator();
  droneLfo.frequency.value = 0.07;
  const lfoGain = ac.createGain();
  lfoGain.gain.value = 190;
  droneLfo.connect(lfoGain);
  lfoGain.connect(droneFilter.frequency);
  droneLfo.start();

  // two detuned pairs a fifth apart, dark register
  const voices: Array<[number, number]> = [
    [55.0, 0.16],   // A1
    [55.3, 0.14],   // detune shadow
    [82.4, 0.11],   // E2
    [82.9, 0.09],
    [110.0, 0.05],  // A2 shimmer
  ];
  droneNodes = voices.map(([freq, level]) => {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ac.createGain();
    g.gain.value = level;
    osc.connect(g);
    g.connect(droneFilter!);
    osc.start();
    return osc;
  });

  // noise wash through a gentle bandpass
  const len = ac.sampleRate * 2;
  const buffer = ac.createBuffer(1, len, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseSource = ac.createBufferSource();
  noiseSource.buffer = buffer;
  noiseSource.loop = true;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 480;
  bp.Q.value = 0.6;
  const ng = ac.createGain();
  ng.gain.value = 0.035;
  noiseSource.connect(bp);
  bp.connect(ng);
  ng.connect(droneFilter);
  noiseSource.start();
}

function stopDrone(): void {
  droneNodes.forEach((o) => {
    try { o.stop(); } catch { /* already stopped */ }
    o.disconnect();
  });
  droneNodes = [];
  if (droneLfo) {
    try { droneLfo.stop(); } catch { /* already stopped */ }
    droneLfo.disconnect();
    droneLfo = null;
  }
  if (noiseSource) {
    try { noiseSource.stop(); } catch { /* already stopped */ }
    noiseSource.disconnect();
    noiseSource = null;
  }
  if (droneFilter) {
    droneFilter.disconnect();
    droneFilter = null;
  }
}

/* ————— microphone ————— */

async function startMic(): Promise<void> {
  const ac = ensureContext();
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  micSource = ac.createMediaStreamSource(micStream);
  // analysis only — never routed to master, or the speakers feed back
  micSource.connect(analyser!);
}

function stopMic(): void {
  if (micSource) {
    micSource.disconnect();
    micSource = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
}

/* ————— public API ————— */

export function getState(): SoundState {
  return state;
}

export function getAnalyser(): AnalyserNode | null {
  return analyser;
}

function fadeMaster(target: number, seconds: number): void {
  if (!ctx || !master) return;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setTargetAtTime(target, ctx.currentTime, seconds / 3);
}

export async function setState(next: SoundState): Promise<void> {
  if (next === state) return;
  const ac = ensureContext();
  if (ac.state === 'suspended') await ac.resume();

  if (next === 'drone') {
    stopMic();
    startDrone();
    fadeMaster(0.9, 1.2);
  } else if (next === 'mic') {
    try {
      await startMic();
    } catch (err) {
      // permission denied or no device — stay on the drone
      if (state === 'off') {
        startDrone();
        fadeMaster(0.9, 1.2);
        state = 'drone';
      }
      throw err;
    }
    stopDrone();
    fadeMaster(0.0, 0.4); // mic is visual-only; drone is gone, plucks still audible
    fadeMaster(0.55, 1.0);
  } else {
    stopDrone();
    stopMic();
    fadeMaster(0.0, 0.6);
  }
  state = next;
}

/* ————— plucks: the terrain is playable ————— */

const PENTA = [0, 3, 5, 7, 10]; // minor pentatonic
const BASE = 110; // A2

export function pluckAt(t: number): void {
  // t in [0,1] across the terrain's width → pentatonic note over ~2.5 octaves
  if (state === 'off' || !ctx || !master) return;
  const steps = Math.floor(t * 15);
  const semis = 12 * Math.floor(steps / PENTA.length) + PENTA[steps % PENTA.length];
  const freq = BASE * Math.pow(2, semis / 12);

  const ac = ctx;
  const osc = ac.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  const g = ac.createGain();
  const now = ac.currentTime;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.35, now + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
  osc.connect(g);
  g.connect(master);
  osc.start(now);
  osc.stop(now + 1.2);
}
