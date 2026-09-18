/* ————— Lab 02 · Sonic Terrain: the scene ————— */
// Loaded by main.ts after the chrome and preloader are up. Everything three lives here.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { getState, getAnalyser, setState, pluckAt, type SoundState } from './audio';
import { watchQuality, startLoop, setupRendererDebug } from '../lab-quality';
import type { LabChrome, Preloader } from '../lab-chrome';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

let ui: LabChrome | null = null;
let live = false; // first real frame rendered; before that the curtain is up and nothing should draw

/* ————— renderer / scene ————— */

const canvas = document.getElementById('st-gl') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false, // MSAA lives on the HDR render target instead
  alpha: false,
  powerPreference: 'high-performance',
});
setupRendererDebug(renderer);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75)); // capped on purpose: crisp 1px lines
renderer.toneMapping = THREE.NoToneMapping; // the final pass tone maps the HDR buffer itself
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
// lines fade to nothing with distance; the page black is added back after tone mapping, where it
// cannot be crushed, and the alpha the far grid leaves behind still masks the horizon glow
scene.fog = new THREE.Fog(0x000000, 5.0, 12.0);

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

// the vertex colours stay in their tuned 0..1 range; this gain lifts them into HDR so that the
// ridges and the overlaps have something for the bloom threshold to bite on
const LINE_HDR = 1.6;

const material = new THREE.LineBasicMaterial({
  vertexColors: true,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
material.color.setScalar(LINE_HDR);

const terrain = new THREE.LineSegments(geometry, material);
terrain.position.x = 1.1; // the bass band lives on the left; pull it into frame
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

/* ————— post: linear HDR → half-res bloom → one final pass ————— */

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    toneMappingExposure: { value: 1.0 },
    uFrame: { value: 0 },
    uGrain: { value: 0.035 },
  },
  vertexShader: /* glsl */ `
    precision highp float;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    attribute vec3 position;
    attribute vec2 uv;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
  fragmentShader: /* glsl */ `
    precision highp float;

    uniform sampler2D tDiffuse;
    uniform float uFrame;
    uniform float uGrain;
    varying vec2 vUv;

    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>

    // page colours in sRGB: they are composited after tone mapping so they read exactly as the CSS did
    const vec3 BASE = vec3( 11.0, 11.0, 13.0 ) / 255.0;
    const vec3 EMBER = vec3( 255.0, 77.0, 0.0 ) / 255.0;

    // interleaved gradient noise (Jimenez 2014), in device pixels
    float ign( vec2 p ) {
      return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
    }

    float hash12( vec2 p ) {
      vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
      p3 += dot( p3, p3.yzx + 33.33 );
      return fract( ( p3.x + p3.y ) * p3.z );
    }

    void main() {
      vec4 hdr = texture2D( tDiffuse, vUv );

      // 1. the lines: tone map the HDR sum, encode to sRGB
      vec3 lines = sRGBTransferOETF( vec4( ACESFilmicToneMapping( hdr.rgb ), 1.0 ) ).rgb;

      // 2. the horizon glow: the old CSS radial-gradient, same geometry and stops
      //    ellipse 90% 45% at 50% 44%; ember .13 at 0, .04 at 45%, clear at 70%
      vec2 e = ( vUv - vec2( 0.5, 0.56 ) ) / vec2( 0.9, 0.45 );
      float d = length( e );
      float a = d < 0.45
        ? mix( 0.13, 0.04, d / 0.45 )
        : mix( 0.04, 0.0, clamp( ( d - 0.45 ) / 0.25, 0.0, 1.0 ) );
      vec3 glow = mix( BASE, EMBER, a );

      // the grid was opaque over the glow on the old transparent canvas; keep that, from line coverage
      float cover = clamp( hdr.a, 0.0, 1.0 );
      vec3 col = mix( glow, BASE, cover ) + lines;

      // 3. soft vignette
      vec2 v = vUv * 2.0 - 1.0;
      float r = clamp( dot( v, v ) * 0.5, 0.0, 1.0 );
      col *= mix( 0.7, 1.0, pow( 1.0 - r, 0.5 ) );

      // 4. luminance-weighted animated grain, then IGN dither against banding; both in device pixels
      vec2 px = gl_FragCoord.xy;
      float lum = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
      float g = hash12( px + vec2( uFrame * 7.0, uFrame * 13.0 ) ) - 0.5;
      col += g * uGrain * mix( 1.0, 0.3, lum );
      col += ( ign( px + uFrame * 5.588238 ) - 0.5 ) / 255.0;

      gl_FragColor = vec4( col, 1.0 );
    }`,
};

// ACES over AgX, decided on screenshots: AgX flattens the ember-to-gold ramp into peach and loses
// the hot white core on the ridge; ACES keeps the saturated ember and the core still reads as heat
const finalMaterial = new THREE.RawShaderMaterial({
  name: 'SonicTerrainFinal',
  defines: { ACES_FILMIC_TONE_MAPPING: '', SRGB_TRANSFER: '' },
  uniforms: FinalShader.uniforms,
  vertexShader: FinalShader.vertexShader,
  fragmentShader: FinalShader.fragmentShader,
});

const hdrTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, hdrTarget);
const renderPass = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.4, 0.9);
const finalPass = new ShaderPass(finalMaterial);

// bloom adds onto the HDR buffer; it must leave alpha alone because the final pass reads it as coverage
bloomPass.blendMaterial.blending = THREE.CustomBlending;
bloomPass.blendMaterial.blendEquation = THREE.AddEquation;
bloomPass.blendMaterial.blendSrc = THREE.OneFactor;
bloomPass.blendMaterial.blendDst = THREE.OneFactor;
bloomPass.blendMaterial.blendSrcAlpha = THREE.ZeroFactor;
bloomPass.blendMaterial.blendDstAlpha = THREE.OneFactor;

composer.addPass(renderPass);
composer.addPass(bloomPass);
composer.addPass(finalPass);

function resize(): void {
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  frameCamera();
  if (reduced && live) composer.render();
}

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
function readAnalyserRow(t: number): Float32Array {
  const analyser = getAnalyser();
  if (!analyser) return synthIdleRow(t);
  analyser.getByteFrequencyData(fftBytes);
  for (let c = 0; c < COLS; c++) {
    // log-ish mapping keeps the bass band wide, like the ear hears it
    const idx = 2 + Math.floor(Math.pow(c / (COLS - 1), 1.6) * 700);
    liveRow[c] = fftBytes[idx] / 255;
  }
  return liveRow;
}

/* ————— per-frame terrain update ————— */

const EMBER = { r: 1.0, g: 0.3, b: 0.0 };
const HOT = { r: 1.0, g: 0.9, b: 0.78 };

// attack fast, release slow: the ridge should feel alive, not twitchy
function advance(row: Float32Array): void {
  for (let c = 0; c < COLS; c++) {
    const target = row[c];
    smooth[c] += (target - smooth[c]) * (target > smooth[c] ? 0.5 : 0.12);
    pulse[c] *= 0.93;
  }
  pushHistoryRow(smooth);
}

function writeGeometry(): void {
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
const hintEl = document.getElementById('st-hint') as HTMLElement;

const ORDER: SoundState[] = ['off', 'drone', 'mic'];

let fpsEma = 60;
let notice = '';
let noticeUntil = 0;

function refreshPill(): void {
  const s = getState();
  pillState.textContent = s === 'off' ? 'OFF' : s === 'drone' ? 'ON · DRONE' : 'ON · MIC';
  pill.setAttribute('aria-pressed', String(s !== 'off'));
}

function statusLine(): string {
  if (performance.now() < noticeUntil) return notice;
  const s = getState();
  const src = s === 'off' ? 'IDLE SWEEP' : s === 'drone' ? 'SRC DRONE' : 'SRC MIC';
  const fps = String(Math.round(fpsEma)).padStart(2, '0');
  // the chrome's status slot is 60vw on phones: keep the line short enough to never ellipsise
  return innerWidth < 640 ? `FPS ${fps} · ${src}` : `ANALYSER 2048-FFT · FPS ${fps} · ${src}`;
}

function showNotice(text: string, ms: number): void {
  notice = text;
  noticeUntil = performance.now() + ms;
  ui?.setStatus(text);
}

pill.addEventListener('click', () => {
  const next = ORDER[(ORDER.indexOf(getState()) + 1) % ORDER.length];
  setState(next)
    .catch(() => showNotice('MIC DENIED · STAYING ON DRONE', 2200))
    .finally(refreshPill);
});

/* ————— plucking the terrain ————— */

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let dragging = false;
let lastPluck = 0;

// t in [0,1] across the terrain's width
function pluck(t: number): void {
  const col = Math.min(COLS - 1, Math.floor(t * COLS));
  pulse[col] = 1.2;

  // first touch wakes the machine: sound off → drone on, then play
  if (getState() === 'off') {
    void setState('drone').then(refreshPill);
  }
  const now = performance.now();
  if (now - lastPluck > 110) {
    lastPluck = now;
    pluckAt(t);
  }
  hintEl.classList.add('gone');
}

function pluckFromPointer(e: PointerEvent): void {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(hitPlane)[0];
  if (!hit) return;
  const t = (hit.point.x - terrain.position.x + X_HALF) / (X_HALF * 2);
  if (t < 0 || t > 1) return;
  pluck(t);
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

// keyboard equivalent: the number row plucks across the surface, 1 at the bass end, 0 at the top
canvas.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const n = '1234567890'.indexOf(e.key);
  if (n < 0) return;
  e.preventDefault();
  pluck((n + 0.5) / 10);
});

/* ————— adaptive quality: bloom first, then pixel ratio, then history depth ————— */

let qualityTier = 0;

function capPixelRatio(cap: number): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap));
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
}

function stepQualityDown(): void {
  qualityTier++;
  if (qualityTier === 1) {
    bloomPass.enabled = false;
    return;
  }
  if (qualityTier === 2) {
    capPixelRatio(1.25);
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

let hudLast = 0;
let frameNo = 0;

function render(dt: number, t: number): void {
  const row = getState() === 'off' ? synthIdleRow(t) : readAnalyserRow(t);
  advance(row);
  writeGeometry();

  // gentle camera sway so the scene breathes even before input
  camera.position.x = Math.sin(t * 0.1) * 0.12;
  camera.lookAt(LOOK_AT);

  if (dt > 0) fpsEma += (1 / dt - fpsEma) * 0.05;
  const now = performance.now();
  if (now - hudLast > 500) {
    hudLast = now;
    ui?.setStatus(statusLine());
  }

  frameNo = (frameNo + 1) % 1024;
  finalPass.uniforms.uFrame.value = frameNo;
  composer.render();
}

/* ————— boot: real work behind the curtain, then the first frame drops it ————— */

// run the idle sweep through the ring buffer so the first frame is a formed landscape rather than
// a flat plane filling in over the next 160 frames; chunked so the progress rule can move
async function prerollHistory(pre: Preloader): Promise<void> {
  const total = ROWS;
  const chunk = 40;
  for (let i = 0; i < total; i += chunk) {
    const end = Math.min(total, i + chunk);
    for (let k = i; k < end; k++) advance(synthIdleRow((k - total) / 60));
    pre.set(0.3 + 0.3 * (end / total), 'building terrain');
    await nextFrame();
  }
  writeGeometry();
}

// the post passes draw through their own fullscreen triangle, outside the scene, so compileAsync
// on the scene alone would leave their nine programs to link synchronously on the first frame.
// stand-in meshes with the same geometry and the very same material instances hit the same
// program cache keys, as long as each is compiled against the kind of target it renders into.
async function compilePrograms(): Promise<void> {
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const standIns = (materials: THREE.Material[]): THREE.Scene => {
    const s = new THREE.Scene();
    for (const m of materials) s.add(new THREE.Mesh(tri, m));
    return s;
  };

  // the terrain and the bloom chain render into HDR targets (linear output)
  renderer.setRenderTarget(composer.renderTarget1);
  await renderer.compileAsync(scene, camera);
  await renderer.compileAsync(
    standIns([
      bloomPass.materialHighPassFilter,
      ...bloomPass.separableBlurMaterials,
      bloomPass.compositeMaterial,
      bloomPass.blendMaterial,
    ]),
    camera
  );
  // the final pass renders to the screen (sRGB output)
  renderer.setRenderTarget(null);
  await renderer.compileAsync(standIns([finalMaterial]), camera);
  tri.dispose();
}

export async function boot(chrome: LabChrome, pre: Preloader): Promise<void> {
  ui = chrome;
  resize();
  window.addEventListener('resize', resize);
  refreshPill();

  await prerollHistory(pre);

  pre.set(0.65, 'compiling');
  await compilePrograms();
  pre.set(0.85, 'compiling');
  await nextFrame();

  if (reduced) {
    // one considered frame, no perpetual motion, and no audio offers
    pill.hidden = true;
    hintEl.hidden = true;
    composer.render();
    live = true;
    chrome.setStatus('STILL FRAME · REDUCED MOTION');
    await pre.done();
    return;
  }

  // the first real frame also links the post passes; the loop takes over from here
  composer.render();
  live = true;
  startLoop(render);
  watchQuality(stepQualityDown, { maxDrops: 3 });
  await pre.done();
}
