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
// The march is a fixed pixel budget, not a fixed fraction of the drawing buffer:
// cost scales with march pixels, and undersampling shows as stipple wherever the
// disk's detail falls below one sample. 4.6M works out to 0.85x at 1600x1000
// DPR 2 — side-by-side crops there show the photon ring survives it — 1.0x on a
// phone, and it stops a 5K display marching 15M pixels.
const MARCH_BUDGET = 4.6e6;
let scaleOverride = 0; // dev ?scale=, wins over the budget
let tierCap = 1; // the quality ladder's ceiling on the march scale
let maxSteps = 112;
let lockTier = false; // hold the quality tier so a probe measures the real cost
let startTilt = -1; // degrees; < 0 means use the page's own opening angle
if (import.meta.env.DEV) {
  // ?tone=house|agx|aces&exp=1.2&bloom=0&scale=0.85&steps=44&tilt=62&lock=1 for
  // side-by-side screenshots and perf probes; tree-shaken in prod
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
  if (sc > 0 && sc <= 1) scaleOverride = sc;
  const ti = Number(q.get('tilt'));
  if (q.get('tilt') !== null && ti >= 0) startTilt = ti;
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
  // the ladder lowers this cap; the pixel ratio itself is re-read on every resize,
  // so dragging the window to a 1x display does not leave a 2x drawing buffer up
  let dprCap = 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
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
    uMaxSteps: { value: maxSteps },
    uJitter: { value: 1 },
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

  // threshold sits above the disk's new ceiling for everything but the beamed arm
  // and the ring, so bloom lifts the hot edge instead of re-clipping the whole band
  const bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.42, 0.6, 1.15);
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.getDrawingBufferSize(buf);
    const auto = scaleOverride > 0 ? scaleOverride : Math.min(1, Math.sqrt(MARCH_BUDGET / (buf.x * buf.y)));
    const scale = Math.min(auto, tierCap);
    const w = Math.max(1, Math.round(buf.x * scale));
    const h = Math.max(1, Math.round(buf.y * scale));
    sceneRT.setSize(w, h);
    uniforms.uRes.value.set(w, h);
    uniforms.uJitter.value = scale;
    bloom.setSize(w, h); // the pass halves this internally
  }
  resize();

  /* ————— camera rig: inclination is the instrument ————— */
  // The defining image of a black hole is what happens between face-on and
  // edge-on: tilt down and the far side of the disk climbs up over the top of the
  // shadow and closes under the bottom. Drag (or scroll, or the arrow keys) sweeps
  // that whole range with inertia, so the halo forms in the viewer's hands.

  const D = 5.6;
  const INC_MIN = 0.012; // edge-on: the disk is a razor and the halo is a full ring
  const INC_MAX = 1.28;  // 73°, face-on enough; π/2 would collapse the up vector
  const DRIFT = 0.021;   // idle azimuth drift, rad/s
  const REST_INC = 0.105; // 6°: where the page settles, on the closed halo
  const OPEN_INC = 0.42;  // 24°: a visible fall, past the angle where the disk is camouflage
  const OPEN_S = 3.4;     // seconds of the opening fall
  const SEED_T = 10;      // the disk's clock starts here: see the loop
  let az = 0;
  let inc = REST_INC;
  // the page arrives tilted and falls to rest: the halo closes on its own, which
  // is both the best three seconds of the piece and the only teaching the drag needs
  let opening = reduced ? 0 : 1;
  if (import.meta.env.DEV && startTilt >= 0) {
    inc = Math.min(INC_MAX, Math.max(INC_MIN, (startTilt * Math.PI) / 180));
    opening = 0; // the tools ask for one exact angle
  }
  let azV = 0;
  let incV = 0;
  let dragging = false;
  let idle = 0;

  const root = document.documentElement;
  // The band collapses to a razor at the exact vertical centre as the halo closes,
  // which is where the exhibit line sits. The type rides up into the shadow as the
  // viewer tilts down. Written as a custom property, and only when it actually
  // moves, so this is not a style write every frame.
  const smoothstep = (a: number, b: number, x: number): number => {
    const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  let liftShown = -99;
  function setLift(): void {
    const lift = 7 + 9 * (1 - smoothstep(INC_MIN, 0.5, inc));
    if (Math.abs(lift - liftShown) < 0.3) return;
    liftShown = lift;
    root.style.setProperty('--eh-lift', `${lift.toFixed(1)}vh`);
  }

  // the tilt is announced to assistive tech: the canvas tells people to press the
  // arrow keys, so pressing one has to say something back
  const liveEl = document.getElementById('eh-live');
  let liveAt = 0;
  let liveTimer = 0;
  function announce(): void {
    if (!liveEl) return;
    const write = (): void => {
      liveAt = performance.now();
      liveEl.textContent = `Tilt ${Math.round((inc * 180) / Math.PI)} degrees`;
    };
    const wait = 500 - (performance.now() - liveAt);
    if (wait <= 0) write();
    else if (!liveTimer) liveTimer = window.setTimeout(() => { liveTimer = 0; write(); }, wait);
  }
  // reduced motion runs no loop, so a gesture asks for one frame — coalesced to a
  // single rAF so a 120 Hz trackpad cannot turn into 120 renders a second
  let stillPending = 0;
  let afterStill: () => void = () => {};
  function requestStill(): void {
    if (!reduced || stillPending) return;
    stillPending = requestAnimationFrame(() => {
      stillPending = 0;
      renderOnce();
      afterStill(); // the readout moves with the frame, including under a held key
    });
  }
  // the design note scrolls and takes arrow keys; everything else is the instrument
  const inPanel = (e: Event): boolean =>
    e.target instanceof Element && e.target.closest('[data-lc-panel]') !== null;
  function touched(): void {
    idle = 0;
    opening = 0; // a hand on it outranks the opening move
    root.classList.add('eh-touched'); // retires the headline, once
  }
  // the hint reads "drag to tilt", so it only retires once the tilt has really
  // moved: a press that never became a drag has taught nobody anything
  function used(): void {
    root.classList.add('eh-used');
  }

  /* — pointer: drag to tilt, works for touch and pen too — */

  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  let dragDist = 0; // radians of tilt/azimuth asked for since the pointer went down
  const SENS = 2.4; // radians across the full viewport height
  const FLING = 6;  // rad/s ceiling on the release velocity

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    dragDist = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = e.timeStamp;
    azV = 0;
    incV = 0;
    touched();
    canvas.setPointerCapture(e.pointerId);
    root.classList.add('eh-dragging');
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const h = Math.max(1, window.innerHeight);
    const dx = ((e.clientX - lastX) / h) * SENS;
    const dy = ((e.clientY - lastY) / h) * SENS;
    const dt = Math.max(8, e.timeStamp - lastT) / 1000;
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = e.timeStamp;
    az -= dx;
    inc = Math.max(INC_MIN, Math.min(INC_MAX, inc + dy));
    // accumulated, not per-event: a slow, deliberate drag arrives one pixel at a
    // time and would never clear a per-event threshold
    dragDist += Math.abs(dx) + Math.abs(dy);
    if (dragDist > 0.012) used(); // ~5px of real drag at a 1000px viewport
    // clamped: at 2.4/s damping, 6 rad/s coasts about 2.5 rad. inc is caught by its
    // own clamp, but az has none, so an unbounded fling spins the camera for a while
    azV = Math.max(-FLING, Math.min(FLING, -dx / dt));
    incV = Math.max(-FLING, Math.min(FLING, dy / dt));
    idle = 0;
    requestStill();
  });

  function endDrag(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    root.classList.remove('eh-dragging');
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    // a flick that ended a while ago should not fling
    if (e.timeStamp - lastT > 120) { azV = 0; incV = 0; }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  /* — wheel: the same axis, for people who never drag — */

  window.addEventListener(
    'wheel',
    (e) => {
      if (inPanel(e)) return; // let the note scroll
      // firefox reports whole lines (deltaMode 1) for a mouse wheel, where a notch
      // is ~3 instead of ~110: without this the scroll affordance does nothing there
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
      inc = Math.max(INC_MIN, Math.min(INC_MAX, inc + px * 0.0016));
      incV = 0;
      touched();
      used();
      requestStill();
    },
    { passive: true }
  );

  /* — keyboard parity for every pointer gesture — */

  window.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (inPanel(e)) return; // let the note scroll
    switch (e.key) {
      case 'ArrowLeft': az += 0.09; break;
      case 'ArrowRight': az -= 0.09; break;
      case 'ArrowUp': inc = Math.min(INC_MAX, inc + 0.07); break;
      case 'ArrowDown': inc = Math.max(INC_MIN, inc - 0.07); break;
      default: return;
    }
    e.preventDefault();
    azV = 0;
    incV = 0;
    touched();
    used();
    announce();
    requestStill();
  });

  const pos = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const WORLD_UP = new THREE.Vector3(0, 1, 0);

  function updateCamera(dt = 0): void {
    if (opening > 0 && dt > 0) {
      opening = Math.max(0, opening - dt / OPEN_S);
      const k = 1 - Math.pow(opening, 3); // ease out cubic
      inc = OPEN_INC + (REST_INC - OPEN_INC) * k;
      idle = 0;
    }
    if (!dragging && dt > 0) {
      az += azV * dt;
      inc += incV * dt;
      const damp = Math.exp(-2.4 * dt); // a flick coasts for about a second
      azV *= damp;
      incV *= damp;
      if (inc <= INC_MIN || inc >= INC_MAX) incV = 0;
      inc = Math.max(INC_MIN, Math.min(INC_MAX, inc));
      // left alone, the orbit keeps turning: the page is never a photograph
      idle += dt;
      if (idle > 4) az += DRIFT * dt * Math.min(1, (idle - 4) / 3);
    }
    setLift();
    // seen flat the disk is wider than the frame at every distance the edge-on
    // framing wants, so the camera backs off as the viewer tilts to face-on: the
    // disk lands inside the frame with black around it and edge-on is untouched.
    const d = D + 1.4 * smoothstep(0.5, INC_MAX, inc);
    pos.set(d * Math.cos(inc) * Math.sin(az), d * Math.sin(inc), d * Math.cos(inc) * Math.cos(az));
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
    updateCamera(0); // no inertia, no drift: exactly the angle that was asked for
    draw(0);
  }

  if (import.meta.env.DEV) {
    // what the quality ladder has actually done to this page, for the tools
    (window as unknown as { __ehState: () => unknown }).__ehState = () => ({
      canvas: [canvas.width, canvas.height],
      march: [uniforms.uRes.value.x, uniforms.uRes.value.y],
      tierCap,
      bloomOn,
      tilt: +((inc * 180) / Math.PI).toFixed(1),
    });

    // __ehBench(n) → ms per frame for the whole chain, measured with a fence, so
    // it reports GPU cost instead of whatever the headless compositor feels like
    // scheduling. tree-shaken in prod.
    (window as unknown as { __ehBench: (n?: number) => number }).__ehBench = (n = 40): number => {
      const gl = renderer.getContext();
      const px = new Uint8Array(4);
      const sync = (): void => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // blocks on the GPU
      draw(0);
      sync();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        uniforms.uTime.value += 0.016;
        draw(0);
      }
      sync(); // one fence at the end: the per-frame cost is the slope over n
      return +(performance.now() - t0).toFixed(2);
    };
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
  // resolution (upscaled by the grade pass) and keeps bloom, grain and the chrome
  // at full device resolution. the step budget is never cut: φ-steps are what buy
  // the winding rays, so a shorter march loses the higher-order images and the
  // photon ring rather than rendering the same scene cheaper.

  let qualityTier = 0;
  function stepQualityDown(): void {
    qualityTier++;
    if (qualityTier === 1) {
      tierCap = 0.68;
      resize();
      return;
    }
    if (qualityTier === 2) {
      dprCap = 1.5;
      bloomOn = false;
      resize(); // setPixelRatio re-applies size: keep the buffers in step
      return;
    }
    tierCap = 0.62;
    resize();
  }

  /* ————— loop ————— */

  // a window drag fires this ~60x a second, and every run disposes and reallocates
  // the march target plus the eleven the bloom pass holds: coalesce into one frame
  let rz = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => {
      resize();
      if (reduced) renderOnce();
    });
  });

  const tilt = (): string => `tilt ${String(Math.round((inc * 180) / Math.PI)).padStart(2, '0')}°`;
  // left alone the camera keeps orbiting, so this number keeps moving: the one
  // honest "this is live" tell the status line can carry without adding a widget,
  // and it costs nothing — the azimuth was already being integrated every frame.
  const orbit = (): string =>
    `orbit ${String(Math.round((((az * 180) / Math.PI) % 360 + 360) % 360)).padStart(3, '0')}°`;

  if (reduced) {
    // one considered frame, no perpetual motion; the tilt is still the viewer's
    uniforms.uTime.value = SEED_T;
    afterStill = () => chrome.setStatus(`Still frame · ${tilt()}`);
    renderOnce();
    afterStill();
    return;
  }

  // the status line carries the instrument: the number moves as you drag. it does
  // not carry fps: that is the one number that advertises a failure state, and the
  // quality ladder exists precisely so the viewer never has to read it.
  let wide = window.innerWidth >= 720;
  let statusLast = 0;
  const loop = startLoop((dt, t) => {
    // the clock starts wound: at t=0 the fBm is unsheared and reads as blobby
    // cotton, and by ~10s the differential rotation has drawn it into filaments.
    // the opening tween should play over the good frame, not the blobs.
    uniforms.uTime.value = t + SEED_T;
    // dev probe: the render loop's own frame deltas, read back by tools/ — the
    // only honest place to measure, since a second rAF loop is paced differently
    if (import.meta.env.DEV && dt > 0) ((window as unknown as { __ehPace: number[] }).__ehPace ??= []).push(dt * 1000);
    const now = performance.now();
    if (now - statusLast > 200) {
      statusLast = now;
      wide = window.innerWidth >= 720;
      chrome.setStatus(wide ? `${tilt()} · ${orbit()} · raymarched live` : tilt());
    }
    updateCamera(dt);
    draw(dt);
  });

  // a backgrounded tab on a phone comes back with a dropped context: without this
  // three keeps issuing calls against a dead one and the canvas stays black forever
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); // without it the browser never attempts a restore
    loop.stop();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    resize();
    loop.start();
  });

  // tier 1 in 2.5s rather than 7: a visitor who is over budget should not spend
  // the whole first impression there
  if (!lockTier) watchQuality(stepQualityDown, { maxDrops: 3, warmupMs: 1500, windowMs: 1000 });
}
