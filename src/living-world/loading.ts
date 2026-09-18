/* ————— living world · loading handle shared by boot.ts (owner) and main.ts (reporter) ————— */
// Dependency-free so main.ts can report progress without a static import cycle.

import type { Preloader } from '../lab-chrome';

let preloader: Preloader | null = null;

export function setPreloader(p: Preloader): void {
  preloader = p;
}

export function report(progress: number, label?: string): void {
  preloader?.set(progress, label);
}

// resolves once the curtain is gone (immediately under reduced motion)
export function loaded(): Promise<void> {
  return preloader ? preloader.done() : Promise.resolve();
}

// yields until after the next painted frame so the curtain's rule can move
// between build steps; a hidden tab has no frames, so fall through on a task
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const go = (): void => {
      setTimeout(resolve, 0);
    };
    if (document.hidden) go();
    else requestAnimationFrame(go);
  });
}
