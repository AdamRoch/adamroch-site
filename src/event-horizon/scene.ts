/* ————— Lab 01 · Event Horizon: the three.js side, loaded behind the preloader curtain ————— */
// main.ts mounts the chrome and the curtain, then imports this module so the curtain is
// on screen before three is fetched. boot() resolves once the first real frame is up.

import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { vertexShader, fragmentShader, gradeFragmentShader } from './shaders';
import { watchQuality, startLoop, setupRendererDebug } from '../lab-quality';
import type { LabChrome, Preloader } from '../lab-chrome';

export interface BootOptions {
  chrome: LabChrome;
  loader: Preloader;
}

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ————— tone: the grade pass can run the original in-march curve, AgX or ACES ————— */

// Evaluated by screenshot: AgX and ACES (with a real sRGB encode) both lift the void
// and the shadow interior to grey, because the scene's values were authored against
// this curve written straight to the canvas. The house curve keeps the shadow black.
const TONE = { house: 0, agx: 1, aces: 2 } as const;
let tone: number = TONE.house;
let exposure = 1.0;
let bloomWanted = true;
let marchScale = 1; // march resolution relative to the drawing buffer; the grade pass upscales if < 1
let maxSteps = 64;
let lockTier = false; // hold the quality tier so a probe measures the real cost
if (import.meta.env.DEV) {
  // ?tone=house|agx|aces&exp=1.2&bloom=0&scale=0.85&steps=44&lock=1 for side-by-side
  // screenshots and perf probes; tree-shaken in prod
  const q = new URLSearchParams(location.search);
  lockTier = q.get('lock') === '1';
  const st = Number(q.get('steps'));
  if (st > 0) maxSteps = st;
  const t = q.get('tone');
  if (t && t in TONE) tone = TONE[t as keyof typeof TONE];
  const e = Number(q.get('exp'));
  if (e > 0) exposure = e;
  if (q.get('bloom') === '0') bloomWanted = false;
  const sc = Number(q.get('scale'));
  if (sc > 0 && sc <= 1) marchScale = sc;
}

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
  const ROWS = 64; // divides 1024 exactly, tiles seamlessly in v
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

export async function boot({ chrome, loader }: BootOptions): Promise<void> {
  /* ————— renderer ————— */

  const canvas = document.getElementById('eh-gl') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  setupRendererDebug(renderer);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.autoClear = false; // every pass covers its whole target
  renderer.toneMapping = THREE.NoToneMapping; // the grade pass owns tone

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.PlaneGeometry(2, 2);

  /* ————— march: linear HDR into a half-float buffer ————— */

  const uniforms = {
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uCamPos: { value: new THREE.Vector3() },
    uCamRight: { value: new THREE.Vector3(1, 0, 0) },
    uCamUp: { value: new THREE.Vector3(0, 1, 0) },
    uCamFwd: { value: new THREE.Vector3(0, 0, -1) },
    uCodeTex: { value: makeCodeTexture() },
    uMaxSteps: { value: maxSteps },
  };
  loader.set(0.42, 'compiling gravity');

  const marchScene = new THREE.Scene();
  marchScene.add(new THREE.Mesh(quad, new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms })));

  const sceneRT = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  sceneRT.texture.name = 'eh.scene';

  /* ————— bloom: half-res mip chain, threshold on HDR values ————— */

  const bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.45, 0.6, 1.0);
  let bloomOn = bloomWanted;

  /* ————— grade: vignette, tone, sRGB, grain, dither, straight to the canvas ————— */

  const gradeUniforms = {
    tScene: { value: sceneRT.texture },
    uTime: { value: 0 },
    uGrain: { value: 0.04 },
    uTone: { value: tone },
    toneMappingExposure: { value: exposure },
  };
  const gradeScene = new THREE.Scene();
  gradeScene.add(
    new THREE.Mesh(quad, new THREE.ShaderMaterial({ vertexShader, fragmentShader: gradeFragmentShader, uniforms: gradeUniforms }))
  );

  /* ————— sizing ————— */

  const buf = new THREE.Vector2();
  function resize(): void {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.getDrawingBufferSize(buf);
    const w = Math.max(1, Math.round(buf.x * marchScale));
    const h = Math.max(1, Math.round(buf.y * marchScale));
    sceneRT.setSize(w, h);
    uniforms.uRes.value.set(w, h);
    bloom.setSize(w, h); // the pass halves this internally
  }
  resize();

  /* ————— camera rig: the cursor (or the arrow keys) warps the orbit slightly ————— */

  const D = 5.3;
  const BASE_EL = 0.17;
  const AZ_MAX = 0.175;
  const EL_MAX = 0.09;
  let azT = 0;
  let elT = 0;
  let az = 0;
  let el = 0;

  window.addEventListener('pointermove', (e) => {
    azT = (e.clientX / window.innerWidth - 0.5) * 0.35;
    elT = (0.5 - e.clientY / window.innerHeight) * 0.18;
  });

  const clamp = (v: number, m: number): number => Math.max(-m, Math.min(m, v));
  window.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target as HTMLElement | null;
    if (t && t.closest('[data-lc-panel]')) return; // let the note scroll
    switch (e.key) {
      case 'ArrowLeft': azT = clamp(azT - 0.05, AZ_MAX); break;
      case 'ArrowRight': azT = clamp(azT + 0.05, AZ_MAX); break;
      case 'ArrowUp': elT = clamp(elT + 0.03, EL_MAX); break;
      case 'ArrowDown': elT = clamp(elT - 0.03, EL_MAX); break;
      default: return;
    }
    e.preventDefault();
    if (reduced) renderOnce();
  });

  const pos = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const WORLD_UP = new THREE.Vector3(0, 1, 0);

  function updateCamera(snap = false): void {
    const k = snap ? 1 : 0.04;
    az += (azT - az) * k;
    el += (elT - el) * k;
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

  /* ————— one frame through the chain ————— */

  let lit = false;
  function draw(dt: number): void {
    renderer.setRenderTarget(sceneRT);
    renderer.render(marchScene, camera);
    if (bloomOn) bloom.render(renderer, sceneRT, sceneRT, dt, false); // adds bloom into sceneRT
    renderer.setRenderTarget(null);
    gradeUniforms.uTime.value = uniforms.uTime.value;
    renderer.render(gradeScene, camera);
    if (!lit) {
      lit = true;
      document.documentElement.classList.add('eh-ready');
      void loader.done();
    }
  }

  function renderOnce(): void {
    updateCamera(true);
    draw(0);
  }

  /* ————— warm every program in parallel before the first frame ————— */
  // program keys include the bound target's colour space, so each material is
  // compiled where it will actually run: the march and bloom against sceneRT,
  // the grade against the canvas.

  const bloomWarm = new THREE.Scene();
  for (const m of [bloom.materialHighPassFilter, ...bloom.separableBlurMaterials, bloom.compositeMaterial, bloom.blendMaterial]) {
    bloomWarm.add(new THREE.Mesh(quad, m));
  }
  renderer.setRenderTarget(sceneRT);
  const compiling = [renderer.compileAsync(marchScene, camera), renderer.compileAsync(bloomWarm, camera)];
  renderer.setRenderTarget(null);
  compiling.push(renderer.compileAsync(gradeScene, camera));
  await Promise.all(compiling);
  loader.set(0.92, 'first light');

  /* ————— adaptive quality: march resolution, then DPR + bloom, then march resolution again ————— */
  // the march is nearly the whole frame cost, so the first step lowers only its
  // resolution (0.85x, upscaled by the grade pass) and keeps bloom, grain and the
  // chrome at full device resolution. the step count is never cut: a ray needs
  // ~40 steps just to reach the horizon from the camera, so a shorter march shrinks
  // the shadow and the photon ring instead of the same scene rendered cheaper.

  let qualityTier = 0;
  function stepQualityDown(): void {
    qualityTier++;
    if (qualityTier === 1) {
      marchScale = Math.min(marchScale, 0.85);
      resize();
      return;
    }
    if (qualityTier === 2) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      bloomOn = false;
      resize(); // setPixelRatio re-applies size: keep the buffers in step
      return;
    }
    marchScale = Math.min(marchScale, 0.7);
    resize();
  }

  /* ————— loop ————— */

  window.addEventListener('resize', () => {
    resize();
    if (reduced) renderOnce();
  });

  if (reduced) {
    // one considered frame, no perpetual motion
    uniforms.uTime.value = 8.0;
    renderOnce();
    chrome.setStatus('Still frame · raymarched live');
    return;
  }

  let fpsEma = 60;
  let fpsLast = 0;
  startLoop((dt, t) => {
    uniforms.uTime.value = t;
    if (dt > 0) fpsEma += (1 / dt - fpsEma) * 0.05;
    const now = performance.now();
    if (now - fpsLast > 500) {
      fpsLast = now;
      chrome.setStatus(`FPS ${String(Math.round(fpsEma)).padStart(2, '0')} · raymarched live`);
    }
    updateCamera();
    draw(dt);
  });
  if (!lockTier) watchQuality(stepQualityDown, { maxDrops: 3 });
}
