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
let pulseTimer: ReturnType<typeof setTimeout> | null = null;
let clickBuffer: AudioBuffer | null = null;
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
  // The analyser is a TAP, not a link in the output chain. It used to sit between master and the
  // speakers, and AnalyserNode is a pass-through node, so startMic()'s micSource.connect(analyser)
  // was routing the microphone straight back out: mic -> analyser -> destination. Verified with an
  // OfflineAudioContext A/B (osc -> analyser -> destination renders peak 1.0; the same graph with
  // the analyser left unconnected renders 0.0). echoCancellation hid it on a laptop; it was never a
  // guarantee. Now master goes to the speakers directly and everything that is only being measured
  // ends at a zero gain, which also keeps the analyser reachable from the destination so the graph
  // is guaranteed to pull it.
  master.connect(ctx.destination);
  master.connect(analyser);
  const silent = ctx.createGain();
  silent.gain.value = 0;
  analyser.connect(silent);
  silent.connect(ctx.destination);
  return ctx;
}

/* ————— the heartbeat ————— */
// The drone was a smooth wash with nothing in it for an onset detector to find, so the terrain
// undulated and never punched. This is the smallest thing that gives it events without turning
// dark ambient into a rhythm section: a slow lub-dub, one sub thump and one quiet broadband
// click, every 2.6 seconds. The click matters visually — it lights the whole frequency axis at
// once, so the beat crosses the terrain rather than only lifting the bass end.

const BEAT_SECONDS = 2.6;

function thump(ac: AudioContext, at: number, level: number): void {
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(68, at);
  osc.frequency.exponentialRampToValueAtTime(36, at + 0.5);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(level, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.85);
  osc.connect(g);
  g.connect(master!);
  osc.start(at);
  osc.stop(at + 0.95);
}

function click(ac: AudioContext, at: number, level: number): void {
  if (!clickBuffer) {
    clickBuffer = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.12), ac.sampleRate);
    const d = clickBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  }
  const src = ac.createBufferSource();
  src.buffer = clickBuffer;
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1800;
  const g = ac.createGain();
  g.gain.setValueAtTime(level, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.11);
  src.connect(hp);
  hp.connect(g);
  g.connect(master!);
  src.start(at);
}

// Look-ahead on the audio clock, not the wall clock. The beat used to play at whatever
// ctx.currentTime happened to be when a 2.6 s setTimeout fired, which drifts under main-thread
// jank (this page uploads a third of a megabyte of geometry every frame on that thread) and
// collapses in a background tab, where Chrome clamps timers to a second and then to a minute.
// A 200 ms poll that schedules every beat due in the next half second keeps the spacing exact no
// matter how late the timer is; the resync line stops a tab that was hidden for five minutes from
// firing every missed beat at once on return.
let nextBeat = 0;

function tickPulse(): void {
  if (!ctx || !master) return;
  const ac = ctx;
  if (nextBeat < ac.currentTime) nextBeat = ac.currentTime + 0.05;
  while (nextBeat < ac.currentTime + 0.5) {
    thump(ac, nextBeat, 0.26);
    click(ac, nextBeat + 0.004, 0.05);
    thump(ac, nextBeat + 0.33, 0.13); // the dub
    nextBeat += BEAT_SECONDS;
  }
  pulseTimer = setTimeout(tickPulse, 200);
}

function schedulePulse(): void {
  if (!ctx) return;
  nextBeat = ctx.currentTime + 0.05;
  tickPulse();
}

function stopPulse(): void {
  if (pulseTimer !== null) {
    clearTimeout(pulseTimer);
    pulseTimer = null;
  }
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

  schedulePulse();
}

function stopDrone(): void {
  stopPulse();
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
  // analysis only: the analyser's own output ends at a zero gain (see ensureContext), so this is
  // genuinely a measurement tap and nothing the microphone hears can reach the speakers
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
