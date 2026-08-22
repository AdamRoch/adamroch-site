import * as THREE from 'three';
import { vertexShader, fragmentShader } from './shaders';
import { watchQuality } from '../lab-quality';
import './style.css';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ————— code sheet texture: columns of monospace glyphs baked on canvas ————— */

function makeCodeTexture(): THREE.CanvasTexture {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(cv);

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);

  let s = 7;
  const rnd = (): number => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const GLYPHS = '10{}[]()<>/*=+;:#$&%01';

  const COLS = 40;
  const ROWS = 64; // divides 1024 exactly — tiles seamlessly in v
  const cw = S / COLS;
  const rh = S / ROWS;
  ctx.font = '14px "SF Mono", ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (rnd() < 0.12) continue; // gaps keep it airy
      const ch = GLYPHS[Math.floor(rnd() * GLYPHS.length)];
      const hot = rnd();
      if (hot > 0.955) ctx.fillStyle = `rgba(255,77,0,${0.6 + rnd() * 0.4})`;
      else if (hot > 0.92) ctx.fillStyle = `rgba(235,240,246,${0.55 + rnd() * 0.4})`;
      else ctx.fillStyle = `rgba(170,180,192,${0.22 + rnd() * 0.35})`;
      ctx.fillText(ch, (c + 0.5) * cw, (r + 0.5) * rh);
    }
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/* ————— renderer ————— */

const canvas = document.getElementById('eh-gl') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const uniforms = {
  uTime: { value: 0 },
  uRes: { value: new THREE.Vector2(1, 1) },
  uCamPos: { value: new THREE.Vector3() },
  uCamRight: { value: new THREE.Vector3(1, 0, 0) },
  uCamUp: { value: new THREE.Vector3(0, 1, 0) },
  uCamFwd: { value: new THREE.Vector3(0, 0, -1) },
  uCodeTex: { value: makeCodeTexture() },
  uMaxSteps: { value: 64 },
};

scene.add(
  new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms })
  )
);

const bufferSize = new THREE.Vector2();
function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.getDrawingBufferSize(bufferSize);
  uniforms.uRes.value.copy(bufferSize);
}
resize();
window.addEventListener('resize', () => {
  resize();
  if (reduced) renderer.render(scene, camera);
});

/* ————— camera rig: the cursor warps the orbit slightly ————— */

const D = 5.3;
const BASE_EL = 0.17;
let azT = 0;
let elT = 0;
let az = 0;
let el = 0;

window.addEventListener('pointermove', (e) => {
  azT = (e.clientX / window.innerWidth - 0.5) * 0.35;
  elT = (0.5 - e.clientY / window.innerHeight) * 0.18;
});

const pos = new THREE.Vector3();
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function updateCamera(): void {
  az += (azT - az) * 0.04;
  el += (elT - el) * 0.04;
  const elevation = BASE_EL + el;
  pos.set(
    D * Math.cos(elevation) * Math.sin(az),
    D * Math.sin(elevation),
    D * Math.cos(elevation) * Math.cos(az)
  );
  fwd.copy(pos).multiplyScalar(-1).normalize();
  right.crossVectors(fwd, WORLD_UP).normalize();
  up.crossVectors(right, fwd);
  uniforms.uCamPos.value.copy(pos);
  uniforms.uCamFwd.value.copy(fwd);
  uniforms.uCamRight.value.copy(right);
  uniforms.uCamUp.value.copy(up);
}

/* ————— adaptive quality ————— */

let qualityTier = 0;
function stepQualityDown(): void {
  qualityTier++;
  if (qualityTier === 1) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    resize(); // setPixelRatio re-applies size — keep uRes in step
    return;
  }
  uniforms.uMaxSteps.value = 44; // shorter march, same scene
}

/* ————— design note toggle ————— */

const noteBtn = document.getElementById('eh-note-btn') as HTMLButtonElement | null;
const notePanel = document.getElementById('eh-note-panel') as HTMLElement | null;

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

/* ————— loop ————— */

const fpsEl = document.getElementById('eh-fps');
const timer = new THREE.Timer();
let fpsEma = 60;
let fpsLast = 0;

function frame(): void {
  timer.update();
  const delta = Math.min(timer.getDelta(), 0.1);
  uniforms.uTime.value += delta;

  fpsEma += (1 / Math.max(delta, 1e-4) - fpsEma) * 0.05;
  const now = performance.now();
  if (fpsEl && now - fpsLast > 500) {
    fpsLast = now;
    fpsEl.textContent = `FPS ${String(Math.round(fpsEma)).padStart(2, '0')}`;
  }

  updateCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

if (reduced) {
  // one considered frame, no perpetual motion
  uniforms.uTime.value = 8.0;
  updateCamera();
  renderer.render(scene, camera);
  if (fpsEl) fpsEl.textContent = 'STILL FRAME';
} else {
  frame();
  watchQuality(stepQualityDown);
}
