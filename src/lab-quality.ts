/* ————— adaptive quality: sample sustained fps, step weak hardware down ————— */

import type { WebGLRenderer } from 'three';

export interface QualityWatchOptions {
  warmupMs?: number; // discarded ramp-up after load
  windowMs?: number; // measurement window per check
  threshold?: number; // sustained fps below this counts as struggling
  maxDrops?: number; // tier steps available to the page
}

// watches requestAnimationFrame pacing and calls stepDown() each time a check
// finds sustained fps under threshold — once after warmup, once more on the
// re-check, then stops. never steps anything back up.
export function watchQuality(
  stepDown: () => void,
  opts: QualityWatchOptions = {}
): void {
  const warmupMs = opts.warmupMs ?? 3000;
  const windowMs = opts.windowMs ?? 2000;
  const threshold = opts.threshold ?? 50;
  const maxDrops = opts.maxDrops ?? 2;

  let warming = true;
  let marked = performance.now();
  let frames = 0;
  let drops = 0;

  function tick(now: number): void {
    frames++;

    // a hidden tab stalls rAF — never hold that against the gpu
    if (document.hidden) {
      marked = now;
      frames = 0;
      requestAnimationFrame(tick);
      return;
    }

    const elapsed = now - marked;
    if (elapsed >= (warming ? warmupMs : windowMs)) {
      if (warming) {
        warming = false;
      } else if ((frames * 1000) / elapsed >= threshold) {
        return; // healthy — stop watching
      } else {
        drops++;
        stepDown();
        if (drops >= maxDrops) return;
      }
      marked = now;
      frames = 0;
    }
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

/* ————— frame loop: the one rAF every lab should drive its render from ————— */

export interface FrameLoop {
  start(): void; // resume with a fresh timestamp (no catch-up dt)
  stop(): void;
}

// dt is seconds, clamped to 0.1 so a stall never becomes a physics jump; it is 0 on
// the first frame after start() or after the tab comes back. t is accumulated visible
// running time in seconds, so shader clocks stay continuous across a hidden tab.
export function startLoop(render: (dt: number, t: number) => void): FrameLoop {
  let raf = 0;
  let running = false;
  let last = -1; // -1: the next frame has no previous timestamp
  let t = 0;

  function frame(now: number): void {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden) {
      last = -1;
      return;
    }
    const dt = last < 0 ? 0 : Math.min(0.1, (now - last) / 1000);
    last = now;
    t += dt;
    render(dt, t);
  }

  function onVisibility(): void {
    cancelAnimationFrame(raf);
    last = -1;
    if (running && !document.hidden) raf = requestAnimationFrame(frame);
  }

  function start(): void {
    if (running) return;
    running = true;
    last = -1;
    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) raf = requestAnimationFrame(frame);
  }

  function stop(): void {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', onVisibility);
  }

  start();
  return { start, stop };
}

/* ————— renderer debug: loud shaders in dev, no sync compile checks in prod ————— */

// dev: a shader that fails to link throws with the info logs and the offending
// source lines, so a broken shader cannot ship silently. prod: skip the
// getShaderParameter round-trips entirely.
export function setupRendererDebug(renderer: WebGLRenderer): void {
  renderer.debug.checkShaderErrors = !import.meta.env.PROD;
  if (import.meta.env.PROD) return;

  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const programLog = (gl.getProgramInfoLog(program) ?? '').trim();
    const report = (shader: WebGLShader, kind: string): string => {
      const log = (gl.getShaderInfoLog(shader) ?? '').trim();
      if (!log) return '';
      const src = (gl.getShaderSource(shader) ?? '').split('\n');
      const excerpt = [...log.matchAll(/ERROR: 0:(\d+)/g)]
        .slice(0, 3)
        .map(([, n]) => {
          const line = Number(n);
          const from = Math.max(0, line - 4);
          return src
            .slice(from, line + 3)
            .map((s, i) => `${from + i + 1 === line ? '>' : ' '} ${String(from + i + 1).padStart(4)}  ${s}`)
            .join('\n');
        })
        .join('\n…\n');
      return `\n${kind} shader:\n${log}${excerpt ? `\n${excerpt}` : ''}`;
    };
    throw new Error(
      `[lab] shader failed to link.\nprogram: ${programLog || '(no program log)'}${report(vs, 'vertex')}${report(fs, 'fragment')}`
    );
  };
}
