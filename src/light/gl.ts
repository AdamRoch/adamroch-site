/* ————— the homepage backdrop: a gravitational lens as one WebGL2 pass ————— */
// The page dynamic-imports this module after fonts + idle, keeps the canvas at opacity 0
// until `ready`, then fades it in while calling arrive(). Everything the page can move is
// a target here; the module follows through springs and adds its own idle drift.
//
// Coordinates: masses and the horizon come in as viewport UV (0..1, origin top-left,
// y down); thetaE in units of min(vw, vh). The shader works in short-side-centred units
// (y up); the conversion happens once per frame in sync().
//
// initLens throws synchronously when WebGL2 is unavailable (three's renderer constructor).

import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  GLSL3,
  Mesh,
  NoToneMapping,
  RawShaderMaterial,
  SRGBColorSpace,
  Scene,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three';
import { setupRendererDebug, startLoop, watchQuality, type FrameLoop } from '../lab-quality';
import { FRAG, VERT } from './shader';
import { Spring } from './spring';
import { fbm1 } from './noise';
import { solveFloor, srgbEncode } from './agx';

export interface LensMass {
  x: number;
  y: number;
  thetaE: number;
}
export interface LensTint {
  r: number;
  g: number;
  b: number;
} // linear 0..1
export interface LensOptions {
  reduced: boolean;
  touch: boolean;
  band?: boolean; // default true; false on the 404 (stars only)
  hud?: (thetaE: number) => void;
  ground?: string; // CSS --ground hex the floor is solved to; default #0b0a09
}
export interface LensHandle {
  ready: Promise<void>; // after compileAsync + the first rendered frame
  lost: Promise<void>; // resolves (never rejects) once the context is gone for good
  arrive(ms?: number): void;
  setPrimary(m: LensMass): void;
  setHorizon(y01: number): void;
  setSecondary(id: string, m: LensMass | null): void;
  setRules(ys: number[], x?: [number, number]): void; // viewport css px; optional x extent, default full width
  setPointer(nx: number, ny: number): void;
  setVelocity(v: number): void;
  setBandGain(g: number): void; // 0..1 multiplier on the band (thin and dim through the index); spring-followed
  exit(tint: LensTint, ms?: number): Promise<void>;
  enter(tint: LensTint, ms?: number): Promise<void>;
  collapse(): void;
  setTier(t: 0 | 1 | 2): void;
  setReduced(b: boolean): void;
  resize(): void;
  destroy(): void;
}

/* ————— constants ————— */

const TIER = [
  { dpr: 2, oct: 3, star: 0.907, streak: true },
  { dpr: 1.5, oct: 2, star: 0.907, streak: true },
  { dpr: 1, oct: 1, star: 0.953, streak: false },
] as const;

const BAND_GAIN = 0.45;
const TIDE = 0.03; // pointer tide, viewport UV
const TILT_DEG = 1.5;
const STREAK_PX = 6;
const DRIFT_HZ = 0.08;
const INK = new Vector3(0.949, 0.929, 0.894); // #f2ede4

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const expoOut = (p: number): number => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p));
const expoIn = (p: number): number => (p <= 0 ? 0 : Math.pow(2, 10 * (p - 1)));
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

interface Tween {
  key: string;
  t: number;
  ms: number;
  apply: (p: number) => void;
  done: () => void;
}

interface Secondary {
  x: number;
  y: number;
  te: Spring;
  live: boolean;
}

/* ————— init ————— */

export function initLens(canvas: HTMLCanvasElement, opts: LensOptions): LensHandle {
  const t0 = performance.now();
  const renderer = new WebGLRenderer({
    canvas,
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  renderer.toneMapping = NoToneMapping;
  renderer.outputColorSpace = SRGBColorSpace; // the shader encodes sRGB itself
  renderer.autoClear = false;
  setupRendererDebug(renderer);

  const floor = solveFloor(opts.ground ?? '#0b0a09');
  const uniforms = {
    uRes: { value: new Vector2(1, 1) },
    uDpr: { value: 1 },
    uTime: { value: 3 },
    uGrainT: { value: 3 },
    uMass: { value: [new Vector4(0, 0, 0, 1), new Vector4(0, 0, 0, 1), new Vector4(0, 0, 0, 1)] },
    uHorizon: { value: 0 },
    uBand: { value: 0 },
    uBandW: { value: 0.035 },
    uFil: { value: 48 },
    uHaze: { value: 0.03 },
    uRingGain: { value: 0.16 },
    uTilt: { value: 0 },
    uStreak: { value: 0 },
    uRules: { value: new Float32Array(8) },
    uRuleN: { value: 0 },
    uRuleX: { value: new Vector2(-10, 10) },
    uStarThr: { value: TIER[0].star as number },
    uOct: { value: TIER[0].oct as number },
    uFloor: { value: new Vector3(floor[0], floor[1], floor[2]) },
    uGrain: { value: 0.045 },
    uInk: { value: INK },
    uTint: { value: new Vector3() },
    uFill: { value: 0 },
  };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new Scene();
  scene.add(mesh);
  const camera = new Camera();

  /* ————— state ————— */

  const band = opts.band !== false;
  const touch = opts.touch;
  let reduced = opts.reduced;
  let tier: 0 | 1 | 2 = touch ? 1 : 0;
  let lockTier = false;
  if (import.meta.env.DEV) lockTier = new URLSearchParams(location.search).get('lock') === '1';

  let W = 1;
  let H = 1;
  let S = 1; // css px
  let dpr = 1;

  const px = new Spring(0.74, 20);
  const py = new Spring(0.4, 20);
  const pte = new Spring(0.11, 20);
  const hz = new Spring(0.42, 20);
  const bg = new Spring(1, 20); // band gain multiplier
  const ptx = new Spring(0, 6, 0.9);
  const pty = new Spring(0, 6, 0.9);
  const secs = new Map<string, Secondary>();
  let velocity = 0;
  let form = 0; // multiplies thetaE² (arrive / collapse)
  let bandIn = 0; // multiplies the band gain (arrive)
  let over: { e: number; te2End: number } | null = null; // exit / enter override
  let fill = 0;
  const ruleYs: number[] = [];
  let ruleX: [number, number] | null = null;
  const tweens: Tween[] = [];
  let time = 3; // the prototype's reference frame is t = 3
  let drawn = false;
  let compiled = false;
  let destroyed = false;
  let loop: FrameLoop | null = null;
  let lastHud = -1;

  /* ————— tweens driven from the frame loop (instant under reduced motion) ————— */

  function tween(key: string, ms: number, apply: (p: number) => void): Promise<void> {
    for (let i = tweens.length - 1; i >= 0; i--) {
      if (tweens[i].key === key) {
        tweens[i].done();
        tweens.splice(i, 1);
      }
    }
    return new Promise<void>((resolve) => {
      if (reduced || ms <= 0 || destroyed) {
        apply(1);
        requestRender();
        resolve();
        return;
      }
      tweens.push({ key, t: 0, ms, apply, done: resolve });
    });
  }

  function advanceTweens(dt: number): void {
    if (!tweens.length) return;
    const finished: Tween[] = [];
    for (const tw of tweens) {
      tw.t += dt * 1000;
      const p = Math.min(1, tw.t / tw.ms);
      tw.apply(p);
      if (p >= 1) finished.push(tw);
    }
    for (const tw of finished) {
      const i = tweens.indexOf(tw);
      if (i >= 0) tweens.splice(i, 1);
      tw.done();
    }
  }

  function finishTweens(): void {
    const all = tweens.splice(0);
    for (const tw of all) {
      tw.apply(1);
      tw.done();
    }
  }

  /* ————— per-frame state → uniforms ————— */

  function snapAll(): void {
    px.snap();
    py.snap();
    pte.snap();
    hz.snap();
    bg.snap();
    ptx.snap();
    pty.snap();
    for (const s of secs.values()) s.te.snap();
  }

  function setMass(i: number, x01: number, y01: number, te2: number): void {
    const m = uniforms.uMass.value[i];
    m.set(((x01 - 0.5) * W) / S, ((0.5 - y01) * H) / S, te2, 0.0225 * te2 + 1e-9); // eps = 0.15 thetaE
  }

  function sync(dt: number, t: number): void {
    if (!reduced) time = 3 + t;
    if (reduced) snapAll();
    else {
      px.step(dt);
      py.step(dt);
      pte.step(dt);
      hz.step(dt);
      bg.step(dt);
      ptx.step(dt);
      pty.step(dt);
      for (const s of secs.values()) s.te.step(dt);
    }
    advanceTweens(dt);

    let dx = 0;
    let dy = 0;
    let dte = 0;
    if (!reduced) {
      const n = time * DRIFT_HZ;
      dx = fbm1(n, 1) * 0.01;
      dy = fbm1(n, 2) * 0.01;
      dte = fbm1(n, 3) * 0.003;
    }
    const tide = touch || reduced ? 0 : TIDE;
    const x = px.x + ptx.x * tide + dx;
    const y = py.x + pty.x * tide + dy;
    const te = Math.max(0, pte.x + dte);
    let te2 = te * te * form;
    if (over) te2 += (over.te2End - te2) * over.e;
    setMass(0, x, y, te2);

    let slot = 1;
    for (const [id, s] of secs) {
      if (!s.live && s.te.x < 2e-4) {
        secs.delete(id);
        continue;
      }
      if (slot < 3) setMass(slot++, s.x, s.y, s.te.x * s.te.x * form);
    }
    for (; slot < 3; slot++) uniforms.uMass.value[slot].set(0, 0, 0, 1);

    uniforms.uHorizon.value = ((0.5 - hz.x) * H) / S;
    uniforms.uTilt.value = touch || reduced ? 0 : Math.tan((ptx.x * TILT_DEG * Math.PI) / 180);
    uniforms.uStreak.value = TIER[tier].streak && !reduced ? (velocity * STREAK_PX) / S : 0;
    uniforms.uBand.value = band ? BAND_GAIN * bandIn * clamp01(bg.x) : 0;
    uniforms.uFill.value = fill;
    uniforms.uTime.value = time;
    uniforms.uGrainT.value = time;

    if (opts.hud) {
      const q = Math.round(Math.sqrt(Math.max(0, te2)) * 1000);
      if (q !== lastHud) {
        lastHud = q;
        opts.hud(q / 1000);
      }
    }
  }

  let frames = 0;
  function draw(): void {
    renderer.render(scene, camera);
    drawn = true;
    frames++;
  }

  // on-demand frame: reduced mode, or any set*() before the loop exists. Coalesced per task.
  let queued = false;
  function requestRender(): void {
    if (destroyed || !compiled || (loop && !reduced)) return;
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (destroyed || !compiled || (loop && !reduced)) return;
      sync(0, 0);
      draw();
    });
  }

  /* ————— size, tiers ————— */

  function applyRules(): void {
    const arr = uniforms.uRules.value;
    const n = Math.min(8, ruleYs.length);
    for (let i = 0; i < 8; i++) arr[i] = i < n ? (0.5 * H - ruleYs[i]) / S : 1e6;
    uniforms.uRuleN.value = n;
    if (ruleX) uniforms.uRuleX.value.set((ruleX[0] - 0.5 * W) / S, (ruleX[1] - 0.5 * W) / S);
    else uniforms.uRuleX.value.set(-10, 10);
  }

  function resize(): void {
    if (destroyed) return;
    // the same box path.ts measures: the viewport minus any classic scrollbar gutter
    W = document.documentElement.clientWidth || window.innerWidth;
    H = document.documentElement.clientHeight || window.innerHeight;
    S = Math.min(W, H);
    const pr = Math.min(window.devicePixelRatio || 1, TIER[tier].dpr);
    renderer.setPixelRatio(pr);
    renderer.setSize(W, H, false);
    dpr = canvas.width / W;
    uniforms.uRes.value.set(canvas.width, canvas.height);
    uniforms.uDpr.value = dpr;
    applyRules();
    requestRender();
  }

  let resizeTimer = 0;
  function onWindowResize(): void {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, 150);
  }
  window.addEventListener('resize', onWindowResize);
  // a DPR change without a resize (the window dragged to another screen) still refits the buffer
  let dprQuery: MediaQueryList | null = null;
  function onDprChange(): void {
    watchDpr();
    resize();
  }
  function watchDpr(): void {
    dprQuery?.removeEventListener('change', onDprChange);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener('change', onDprChange);
  }
  watchDpr();

  function setTier(t: 0 | 1 | 2): void {
    tier = t;
    uniforms.uOct.value = TIER[t].oct;
    uniforms.uStarThr.value = TIER[t].star;
    resize();
  }

  /* ————— context loss: one restore attempt, then `lost` resolves ————— */

  let lostResolve: () => void = () => {};
  const lost = new Promise<void>((r) => {
    lostResolve = r;
  });
  let losses = 0;
  let restoreTimer = 0;
  function onContextLost(e: Event): void {
    e.preventDefault();
    losses++;
    loop?.stop();
    finishTweens(); // the loop drives the tweens; without it exit()'s promise never settles
    if (losses > 1) {
      lostResolve();
      return;
    }
    restoreTimer = window.setTimeout(lostResolve, 4000);
  }
  function onContextRestored(): void {
    clearTimeout(restoreTimer);
    if (losses > 1 || destroyed) return;
    if (!reduced) loop?.start();
    else requestRender();
  }
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  /* ————— ready: compile off the main thread's critical path, then one frame ————— */

  function startLoopIfNeeded(): void {
    if (reduced || destroyed || !compiled) return;
    if (loop) loop.start();
    else {
      loop = startLoop((dt, t) => {
        sync(dt, t);
        draw();
      });
      if (!lockTier) watchQuality(() => setTier(Math.min(2, tier + 1) as 0 | 1 | 2), { threshold: 50, maxDrops: 2 });
    }
  }

  const timing = { init: performance.now() - t0, compile: 0, firstFrame: 0 };
  const ready = (async () => {
    resize();
    const tc = performance.now();
    await renderer.compileAsync(scene, camera);
    timing.compile = performance.now() - tc;
    if (destroyed) return;
    compiled = true;
    const tf = performance.now();
    sync(0, 0);
    draw();
    timing.firstFrame = performance.now() - tf;
    startLoopIfNeeded();
  })();

  /* ————— the handle ————— */

  function tintToSRGB(t: LensTint): void {
    uniforms.uTint.value.set(srgbEncode(clamp01(t.r)), srgbEncode(clamp01(t.g)), srgbEncode(clamp01(t.b)));
  }
  // the ring must clear the corner farthest from the primary (plus its wings) before the frame is flat
  function te2End(): number {
    const mx = (px.x - 0.5) * W;
    const my = (py.x - 0.5) * H;
    let far = 0;
    for (const cx of [-0.5 * W, 0.5 * W]) for (const cy of [-0.5 * H, 0.5 * H]) far = Math.max(far, Math.hypot(cx - mx, cy - my));
    return Math.max(1.4, Math.pow((far + 80) / S, 2));
  }

  const handle: LensHandle = {
    ready,
    lost,

    arrive(ms = 1400) {
      void tween('form', ms, (p) => {
        form = expoOut(p);
        bandIn = expoOut(p);
      });
    },

    setPrimary(m) {
      px.target = m.x;
      py.target = m.y;
      pte.target = Math.max(0, m.thetaE);
      if (!drawn) {
        px.snap();
        py.snap();
        pte.snap();
      }
      requestRender();
    },

    setHorizon(y01) {
      hz.target = y01;
      if (!drawn) hz.snap();
      requestRender();
    },

    setSecondary(id, m) {
      const s = secs.get(id);
      if (!m) {
        if (s) {
          s.live = false;
          s.te.target = 0;
        }
        requestRender();
        return;
      }
      if (s) {
        s.x = m.x;
        s.y = m.y;
        s.live = true;
        s.te.target = Math.max(0, m.thetaE);
      } else {
        if (secs.size >= 2) {
          // evict a fading mass first, else the smallest
          let victim: string | null = null;
          let smallest = Infinity;
          for (const [k, v] of secs) {
            const score = v.live ? v.te.x : -1;
            if (score < smallest) {
              smallest = score;
              victim = k;
            }
          }
          if (victim) secs.delete(victim);
        }
        secs.set(id, { x: m.x, y: m.y, te: new Spring(0, 12), live: true });
        secs.get(id)!.te.target = Math.max(0, m.thetaE);
      }
      requestRender();
    },

    setRules(ys, x) {
      ruleYs.length = 0;
      for (const y of ys.slice(0, 8)) ruleYs.push(y);
      ruleX = x ?? null;
      applyRules();
      requestRender();
    },

    setPointer(nx, ny) {
      if (touch || reduced) return;
      ptx.target = Math.max(-1, Math.min(1, nx));
      pty.target = Math.max(-1, Math.min(1, ny));
    },

    setVelocity(v) {
      velocity = reduced ? 0 : Math.max(-1, Math.min(1, v));
    },

    setBandGain(g) {
      bg.target = clamp01(g);
      if (!drawn) bg.snap();
      requestRender();
    },

    exit(tint, ms = 520) {
      tintToSRGB(tint);
      const o = { e: 0, te2End: te2End() };
      over = o;
      return tween('over', ms, (p) => {
        o.e = expoIn(p);
        fill = smoothstep(0, 0.5, p);
      });
    },

    enter(tint, ms = 600) {
      tintToSRGB(tint);
      const o = { e: 1, te2End: te2End() };
      over = o;
      fill = 1;
      return tween('over', ms, (p) => {
        const q = 1 - expoOut(p);
        o.e = q;
        fill = smoothstep(0, 0.5, q);
      }).then(() => {
        if (over === o) {
          over = null;
          fill = 0;
        }
      });
    },

    // one uninterruptible tween: a second click restarts the collapse instead of racing the reform
    collapse() {
      const f0 = form;
      const total = 1700;
      void tween('form', total, (p) => {
        const t = p * total;
        form = t < 300 ? f0 * (1 - Math.pow(t / 300, 2)) : expoOut((t - 300) / 1400);
      });
    },

    setTier,

    setReduced(b) {
      if (b === reduced) return;
      reduced = b;
      if (b) {
        loop?.stop();
        velocity = 0;
        ptx.target = 0;
        pty.target = 0;
        finishTweens();
        snapAll();
        requestRender();
      } else startLoopIfNeeded();
    },

    resize,

    destroy() {
      destroyed = true;
      loop?.stop();
      finishTweens();
      clearTimeout(resizeTimer);
      clearTimeout(restoreTimer);
      window.removeEventListener('resize', onWindowResize);
      dprQuery?.removeEventListener('change', onDprChange);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      material.dispose();
      geometry.dispose();
      renderer.dispose();
    },
  };

  if (import.meta.env.DEV) {
    // harness hooks only; tree-shaken in prod
    (handle as LensHandle & { debug?: object }).debug = {
      renderer,
      uniforms,
      floor,
      get tier() {
        return tier;
      },
      get frames() {
        return frames;
      },
      loseContext: () => renderer.forceContextLoss(),
      restoreContext: () => renderer.forceContextRestore(),
      timing,
      frame: () => {
        sync(0, 0);
        draw();
      },
      // n draws in one task with no present between them: wall time to gl.finish(), and one
      // timer query around the batch when the extension exists. Stops the loop.
      timeBatch: async (n = 20): Promise<{ wallMsPerFrame: number; queryMsPerFrame: number | null }> => {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number } | null;
        loop?.stop();
        sync(0, time - 3);
        draw();
        gl.finish();
        const q = ext ? gl.createQuery() : null;
        if (ext && q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        const t0 = performance.now();
        for (let i = 0; i < n; i++) {
          sync(1 / 60, time - 3 + i / 60);
          draw();
        }
        gl.finish();
        const wall = (performance.now() - t0) / n;
        let query: number | null = null;
        if (ext && q) {
          gl.endQuery(ext.TIME_ELAPSED_EXT);
          for (let tries = 0; tries < 400; tries++) {
            if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
            await new Promise((r) => setTimeout(r, 5));
          }
          query = (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6 / n;
          gl.deleteQuery(q);
        }
        if (!reduced) loop?.start();
        return { wallMsPerFrame: wall, queryMsPerFrame: query };
      },
      // GPU time per frame via EXT_disjoint_timer_query_webgl2 (null when unavailable); stops the loop
      timeFrames: async (n = 60): Promise<number[] | null> => {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as {
          TIME_ELAPSED_EXT: number;
          GPU_DISJOINT_EXT: number;
        } | null;
        if (!ext) return null;
        loop?.stop();
        const queries: WebGLQuery[] = [];
        for (let i = 0; i < n; i++) {
          const q = gl.createQuery()!;
          gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
          sync(1 / 60, time - 3 + i / 60);
          draw();
          gl.endQuery(ext.TIME_ELAPSED_EXT);
          queries.push(q);
          await new Promise((r) => setTimeout(r, 0));
        }
        const out: number[] = [];
        for (const q of queries) {
          for (let tries = 0; tries < 200; tries++) {
            if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
            await new Promise((r) => setTimeout(r, 5));
          }
          if (gl.getParameter(ext.GPU_DISJOINT_EXT)) return null;
          out.push((gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6);
          gl.deleteQuery(q);
        }
        if (!reduced) loop?.start();
        return out;
      },
    };
  }

  return handle;
}
