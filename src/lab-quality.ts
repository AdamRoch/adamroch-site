/* ————— adaptive quality: sample sustained fps, step weak hardware down ————— */

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
