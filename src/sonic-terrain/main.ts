import * as THREE from 'three';
import { getState, getAnalyser, setState, pluckAt, type SoundState } from './audio';
import { watchQuality } from '../lab-quality';
import './style.css';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ————— renderer / scene ————— */

const canvas = document.getElementById('st-gl') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b0b0d, 5.0, 12.0);

const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 30);
const BASE_CAM = new THREE.Vector3(0, 0.78, 3.6);
const LOOK_AT = new THREE.Vector3(0, 0.5, -1.8);

function frameCamera(): void {
  const aspect = innerWidth / innerHeight;
  const fit = Math.min(1, aspect * 1.25); // portrait pulls back
  camera.aspect = aspect;
  camera.position.set(BASE_CAM.x, BASE_CAM.y / Math.sqrt(fit), BASE_CAM.z / fit);
  camera.lookAt(LOOK_AT);
  camera.updateProjectionMatrix();
}

/* ————— terrain: a rolling history of spectrum frames as a line mesh ————— */

const COLS = 96; // frequency bins across
let ROWS = 160; // frames of history receding to the horizon
const X_HALF = 2.7;
const Z_NEAR = 2.3;
const Z_FAR = -7.0;

function buildGrid(): void {
  const vertCount = ROWS * COLS;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      positions[i * 3 + 0] = (c / (COLS - 1)) * 2 * X_HALF - X_HALF;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = Z_NEAR + (r / (ROWS - 1)) * (Z_FAR - Z_NEAR);
    }
  }

  const index: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      const i = r * COLS + c;
      index.push(i, i + 1);
    }
  }
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      index.push(i, i + COLS);
    }
  }

  geometry.setIndex(index);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

const geometry = new THREE.BufferGeometry();
buildGrid();

const material = new THREE.LineBasicMaterial({
  vertexColors: true,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

const terrain = new THREE.LineSegments(geometry, material);
terrain.position.x = 1.1; // the bass band lives on the left — pull it into frame
scene.add(terrain);

// invisible plane for pluck raycasting
const hitPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(X_HALF * 2, Math.abs(Z_FAR - Z_NEAR)),
  new THREE.MeshBasicMaterial({ visible: false })
);
hitPlane.rotation.x = -Math.PI / 2;
hitPlane.position.z = (Z_NEAR + Z_FAR) / 2;
hitPlane.position.x = terrain.position.x;
scene.add(hitPlane);

/* ————— spectrum data: analyser bytes, or a synthetic swell while muted ————— */

let history = new Float32Array(ROWS * COLS); // ring rows, 0 = nearest
const smooth = new Float32Array(COLS);
const pulse = new Float32Array(COLS); // pluck flashes
const fftBytes = new Uint8Array(1024);

function pushHistoryRow(values: Float32Array): void {
  // history recedes: shift everything one row back, write new frame at row 0
  history.copyWithin(COLS, 0, history.length - COLS);
  history.set(values, 0);
}

const idleRow = new Float32Array(COLS);
function synthIdleRow(t: number): Float32Array {
  for (let c = 0; c < COLS; c++) {
    const cf = c / (COLS - 1);
    const wobble = 0.03 * Math.sin(t * 0.23);
    const bass = Math.exp(-Math.pow((cf - 0.07 - wobble) / 0.09, 2)) * 0.85;
    const mid = Math.exp(-Math.pow((cf - 0.3) / 0.1, 2)) * 0.4;
    const texture =
      0.5 + 0.5 * Math.sin(c * 1.7 + t * 1.1) * Math.sin(c * 0.31 - t * 0.53);
    const beat = 0.6 + 0.4 * Math.sin(t * 0.7 + Math.sin(t * 0.31) * 2.0);
    idleRow[c] = (bass + mid) * beat * (0.55 + 0.45 * texture) + texture * 0.06;
  }
  return idleRow;
}

const liveRow = new Float32Array(COLS);
function readAnalyserRow(): Float32Array {
  const analyser = getAnalyser();
  if (!analyser) return synthIdleRow(perfNow() * 0.001);
  analyser.getByteFrequencyData(fftBytes);
  for (let c = 0; c < COLS; c++) {
    // log-ish mapping keeps the bass band wide, like the ear hears it
    const idx = 2 + Math.floor(Math.pow(c / (COLS - 1), 1.6) * 520);
    liveRow[c] = fftBytes[idx] / 255;
  }
  return liveRow;
}

function perfNow(): number {
  return performance.now();
}

/* ————— per-frame terrain update ————— */

const EMBER = { r: 1.0, g: 0.3, b: 0.0 };
const HOT = { r: 1.0, g: 0.9, b: 0.78 };

function updateTerrain(row: Float32Array): void {
  // attack fast, release slow — the ridge should feel alive, not twitchy
  for (let c = 0; c < COLS; c++) {
    const target = row[c];
    smooth[c] += (target - smooth[c]) * (target > smooth[c] ? 0.5 : 0.12);
    pulse[c] *= 0.93;
  }
  pushHistoryRow(smooth);

  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const col = geometry.getAttribute('color') as THREE.BufferAttribute;

  for (let r = 0; r < ROWS; r++) {
    const near = 1 - r / (ROWS - 1);
    const nearW = near * near;
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      const amp = Math.min(1.5, history[i] + pulse[c] * 0.5 * nearW);
      const lift = amp * 2.0 * (0.35 + 0.65 * nearW) + pulse[c] * 0.25 * nearW;
      pos.setY(i, lift);

      const heat = Math.min(1, amp * 1.15);
      const glowW = (0.07 + heat * 0.85) * (0.12 + 0.88 * nearW);
      const hotMix = Math.max(0, (heat - 0.55) / 0.45);
      col.setXYZ(
        i,
        (EMBER.r + (HOT.r - EMBER.r) * hotMix) * glowW,
        (EMBER.g + (HOT.g - EMBER.g) * hotMix) * glowW,
        (EMBER.b + (HOT.b - EMBER.b) * hotMix) * glowW
      );
    }
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
}

/* ————— HUD wiring ————— */

const pill = document.getElementById('st-pill') as HTMLButtonElement;
const pillState = document.getElementById('st-pill-state') as HTMLElement;
const statusEl = document.getElementById('st-status') as HTMLElement;
const hintEl = document.getElementById('st-hint') as HTMLElement;

const ORDER: SoundState[] = ['off', 'drone', 'mic'];

function refreshChrome(): void {
  const s = getState();
  pillState.textContent = s === 'off' ? 'OFF' : s === 'drone' ? 'ON · DRONE' : 'ON · MIC';
}

pill.addEventListener('click', () => {
  const next = ORDER[(ORDER.indexOf(getState()) + 1) % ORDER.length];
  setState(next)
    .catch(() => {
      statusEl.textContent = 'MIC DENIED — STAYING ON DRONE';
      window.setTimeout(refreshChrome, 2200);
    })
    .finally(refreshChrome);
});

/* ————— design note toggle ————— */

const noteBtn = document.getElementById('st-note-btn') as HTMLButtonElement | null;
const notePanel = document.getElementById('st-note-panel') as HTMLElement | null;

function setNoteOpen(open: boolean): void {
  if (!noteBtn || !notePanel) return;
  noteBtn.setAttribute('aria-expanded', String(open));
  notePanel.hidden = !open;
}

noteBtn?.addEventListener('click', () => {
  if (!noteBtn || !notePanel) return;
  setNoteOpen(noteBtn.getAttribute('aria-expanded') !== 'true');
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && notePanel && !notePanel.hidden) {
    setNoteOpen(false);
    noteBtn?.focus();
  }
});

/* ————— plucking the terrain ————— */

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let dragging = false;
let lastPluck = 0;

function pluckFromPointer(e: PointerEvent): void {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(hitPlane)[0];
  if (!hit) return;
  const t = (hit.point.x - terrain.position.x + X_HALF) / (X_HALF * 2);
  if (t < 0 || t > 1) return;

  const col = Math.min(COLS - 1, Math.floor(t * COLS));
  pulse[col] = 1.2;

  // first touch wakes the machine: sound off → drone on, then play
  if (getState() === 'off') {
    void setState('drone').then(refreshChrome);
  }
  const now = perfNow();
  if (now - lastPluck > 110) {
    lastPluck = now;
    pluckAt(t);
  }
  hintEl.classList.add('gone');
}

canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  pluckFromPointer(e);
});
window.addEventListener('pointerup', () => {
  dragging = false;
});
canvas.addEventListener('pointermove', (e) => {
  if (dragging) pluckFromPointer(e);
});

/* ————— adaptive quality ————— */

let qualityTier = 0;
function stepQualityDown(): void {
  qualityTier++;
  if (qualityTier === 1) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    return;
  }
  // dispose frees the old grid buffers before they are replaced
  geometry.dispose();
  ROWS = 110;
  const next = new Float32Array(ROWS * COLS);
  next.set(history.subarray(0, next.length)); // keep the most recent rows
  history = next;
  buildGrid();
}

/* ————— loop ————— */

const timer = new THREE.Timer();
let time = 0;
let fpsEma = 60;
let hudLast = 0;

function frame(): void {
  timer.update();
  const delta = Math.min(timer.getDelta(), 0.1);
  time += delta;

  const row = getState() === 'off' ? synthIdleRow(time) : readAnalyserRow();
  updateTerrain(row);

  // gentle camera sway so the scene breathes even before input
  camera.position.x = Math.sin(time * 0.1) * 0.12;
  camera.lookAt(LOOK_AT);

  fpsEma += (1 / Math.max(delta, 1e-4) - fpsEma) * 0.05;
  const now = perfNow();
  if (now - hudLast > 500) {
    hudLast = now;
    const src = getState() === 'off' ? 'IDLE SWEEP' : getState() === 'drone' ? 'SRC DRONE' : 'SRC MIC';
    statusEl.textContent = `ANALYSER 2048-FFT · FPS ${String(Math.round(fpsEma)).padStart(2, '0')} · ${src}`;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

frameCamera();
window.addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  frameCamera();
  if (reduced) renderer.render(scene, camera);
});
renderer.setSize(innerWidth, innerHeight, false);
refreshChrome();

if (reduced) {
  // one considered frame, no perpetual motion — and no audio offers
  pill.hidden = true;
  hintEl.hidden = true;
  updateTerrain(synthIdleRow(8.0));
  renderer.render(scene, camera);
  statusEl.textContent = 'STILL FRAME — REDUCED MOTION';
} else {
  frame();
  watchQuality(stepQualityDown);
}
