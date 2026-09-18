// Homepage and 404 boot. Order: clock, modals, reveals, motion toggle, copy-email, then the
// lens (dynamic import after fonts + idle). The page is complete before the lens arrives
// and stays complete if it never does (html.nogl).

import { initClock } from './clock';
import { initModals, type ModalHooks } from './modal';
import { initMotionToggle } from './motion-toggle';
import { initReveals, fontsReady, gsap, ScrollTrigger } from './reveal';
import type { LensHandle } from './light/gl';
import { createPath, type LensPath, type PathSample } from './light/path';
import { initSeam, releaseSeam, type Seam } from './light/seam';

const html = document.documentElement;
const reduced = html.classList.contains('reduced');
const touch = html.classList.contains('touch');
const page = document.body.dataset.page ?? 'home';
const PHONE = '(max-width: 700px)';

// the lens arrives late; the modal hooks and the success pulse reach it through these
let lensRef: LensHandle | null = null;
let lensTeardown: (() => void) | null = null;
let openDialog: HTMLDialogElement | null = null;
let pulse = 1;
let pulseTimer = 0;

initClock();
initModals(modalHooks());
void initReveals();
initMotionToggle();
initCopyEmail();
initTopLinks();
if (page === 'home') initBarCollapse();
void bootLens();

/* ————— chrome ————— */

function initCopyEmail(): void {
  const el = document.querySelector<HTMLAnchorElement>('[data-copy]');
  if (!el) return;
  const addr = el.querySelector<HTMLElement>('.email-addr');
  let timer = 0;
  // the href stays for no-JS and middle-click; with a clipboard this is a button that copies
  if (navigator.clipboard && el.dataset.copy) {
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `Copy email address ${el.dataset.copy}`);
  }
  // Space activates it like a button; Enter already follows the anchor
  el.addEventListener('keydown', (e) => {
    if (e.key === ' ') {
      e.preventDefault();
      el.click();
    }
  });
  el.addEventListener('click', (e) => {
    const text = el.dataset.copy;
    if (!text || !navigator.clipboard || !addr) return; // the mailto: proceeds
    e.preventDefault();
    navigator.clipboard.writeText(text).then(
      () => {
        clearTimeout(timer);
        addr.textContent = 'COPIED';
        el.classList.add('is-copied');
        timer = window.setTimeout(() => {
          addr.textContent = text;
          el.classList.remove('is-copied');
        }, 1200);
      },
      () => {
        location.href = el.href;
      }
    );
  });
}

function initTopLinks(): void {
  const top = document.getElementById('top');
  document.querySelectorAll<HTMLAnchorElement>('a[href="#top"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      if (reduced) {
        window.scrollTo(0, 0);
        top?.focus({ preventScroll: true });
        return;
      }
      gsap.to(window, {
        scrollTo: 0,
        duration: 0.9,
        ease: 'expo.inOut',
        onComplete: () => top?.focus({ preventScroll: true }),
      });
    });
  });
}

// after the hero leaves, the clock fades and comes back at the top; the pills never hide.
// The scroll cue and the HUD have done their job 120 px in and fade so the band can pass.
function initBarCollapse(): void {
  const bar = document.querySelector<HTMLElement>('.bar');
  const hero = document.getElementById('hero');
  if (!bar || !hero) return;
  ScrollTrigger.create({
    trigger: hero,
    start: '120px top',
    end: 'max',
    onToggle: (self) => {
      bar.classList.toggle('is-scrolled', self.isActive);
      hero.classList.toggle('is-away', self.isActive);
    },
  });
}

/* ————— modals: the sheet is lit from beside; success pulses the ring once ————— */

function retargetModal(): void {
  if (!lensRef || !openDialog) return;
  const phone = matchMedia(PHONE).matches;
  lensRef.setSecondary(
    'modal',
    phone
      ? { x: 0.5, y: (window.innerHeight - openDialog.offsetHeight - 24) / window.innerHeight, thetaE: 0.12 }
      : { x: (window.innerWidth - openDialog.offsetWidth - 24) / window.innerWidth, y: 0.22, thetaE: 0.12 }
  );
}

function modalHooks(): ModalHooks {
  return {
    onOpen(_id, dialog) {
      openDialog = dialog;
      retargetModal();
    },
    onClose() {
      openDialog = null;
      lensRef?.setSecondary('modal', null);
    },
    onSuccess() {
      pulse = 1.1;
      clearTimeout(pulseTimer);
      pulseTimer = window.setTimeout(() => {
        pulse = 1;
      }, 250);
    },
  };
}

/* ————— the lens ————— */

function idle(timeout: number): Promise<void> {
  return new Promise((resolve) => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(() => resolve(), { timeout });
    else setTimeout(resolve, Math.min(timeout, 50));
  });
}

function hasWebGL2(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function setNoGl(): void {
  html.classList.remove('gl-ready', 'gl-rules');
  html.classList.add('nogl');
  lensTeardown?.();
  lensTeardown = null;
  releaseSeam();
}

function bindHud(): ((thetaE: number) => void) | undefined {
  const el = document.querySelector<HTMLElement>('[data-hud]');
  if (!el) return undefined;
  let last = '';
  return (thetaE) => {
    const text = `θE ${thetaE.toFixed(3)}`;
    if (text !== last) {
      last = text;
      el.textContent = text;
    }
  };
}

async function bootLens(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#lens');
  if (!canvas) return releaseSeam();
  if (!hasWebGL2()) return setNoGl();
  // a page pre-painted on the lab's colour must never stay that way if the lens is slow
  if (html.classList.contains('seam')) window.setTimeout(releaseSeam, 2500);

  await fontsReady(300);
  await idle(200);

  let mod: typeof import('./light/gl');
  try {
    mod = await import('./light/gl');
  } catch {
    return setNoGl();
  }

  let lens: LensHandle;
  try {
    lens = mod.initLens(canvas, { reduced, touch, band: page !== '404', hud: bindHud() });
  } catch {
    return setNoGl();
  }
  lens.lost.then(
    () => {
      setNoGl();
      lens.destroy();
    },
    () => setNoGl()
  );

  const seam = wireLens(lens);

  try {
    await lens.ready;
  } catch {
    return setNoGl();
  }
  lensRef = lens;
  retargetModal();
  html.classList.remove('nogl'); // the 3.5 s boot watchdog may have fired just before this
  html.classList.add('gl-ready');
  if (page === 'home') html.classList.add('gl-rules');
  if (!seam || !(await seam.boot())) lens.arrive();
}

// Everything the page tells the lens: the scroll path, the doors, the hairlines, the
// pointer tide, the scroll streak, the seam. Layout is read in path.ts's refresh() only.
function wireLens(lens: LensHandle): Seam | null {
  lens.setTier(touch ? 1 : 0);

  if (page === '404') {
    lens.setPrimary({ x: 0.5, y: 0.5, thetaE: 0.3 });
    // the page's one joke: click empty space and the lens collapses, then reforms
    document.addEventListener('click', (e) => {
      const t = e.target as Element | null;
      if (t?.closest('a, button, input, textarea, label, dialog, select')) return;
      lens.collapse();
    });
    return null;
  }

  const target: PathSample = { x: 0.74, y: 0.4, thetaE: 0.11, horizon: 0.42, gain: 1 };
  let lastY = window.scrollY;
  let velocity = 0;

  const feed = (dtMs: number): void => {
    const s = window.scrollY;
    path.sample(s, target);
    if (seam.navigating && seam.row) {
      // the door being left through is the ring that swallows the viewport
      const d = path.doorMass(seam.row, s, target.thetaE);
      target.x = d.x;
      target.y = d.y;
    }
    lens.setPrimary({ x: target.x, y: target.y, thetaE: target.thetaE * pulse });
    lens.setHorizon(target.horizon);
    lens.setBandGain(target.gain);
    const r = path.rules(s);
    lens.setRules(r.ys, r.x);
    // scroll velocity, half-life 180 ms, ±1.5 px/ms → ±1
    if (dtMs > 0) {
      const raw = (s - lastY) / dtMs;
      velocity += (raw - velocity) * (1 - Math.pow(0.5, dtMs / 180));
    }
    lastY = s;
    lens.setVelocity(Math.max(-1, Math.min(1, velocity / 1.5)));
  };

  const seam = initSeam(lens, { reduced, onLeave: (row) => lens.setSecondary(row.dataset.lab ?? 'row', null) });
  const path: LensPath = createPath({ onMeasure: () => reduced && feed(0) });

  const feedTick = (_t: number, dt: number): void => feed(dt);
  let queued = 0;
  const onScroll = (): void => {
    if (queued) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      feed(0);
    });
  };
  if (reduced) {
    // one frame per change: the ring moves with the page, nothing else moves
    feed(0);
    window.addEventListener('scroll', onScroll, { passive: true });
  } else {
    feed(0);
    gsap.ticker.add(feedTick);
  }

  // when the lens gives up, so does everything that was feeding it
  lensTeardown = (): void => {
    gsap.ticker.remove(feedTick);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', retargetModal);
    cancelAnimationFrame(queued);
    path.destroy();
    seam.destroy();
  };

  // doors: hover, focus and touch-press all pull a second mass onto the door
  document.querySelectorAll<HTMLElement>('.row').forEach((row) => {
    const id = row.dataset.lab ?? 'row';
    const on = (): void => {
      if (seam.navigating) return;
      lens.setSecondary(id, path.doorMass(row, window.scrollY, 0.09));
    };
    const off = (): void => lens.setSecondary(id, null);
    row.addEventListener('pointerenter', on);
    row.addEventListener('pointerleave', off);
    row.addEventListener('focusin', on);
    row.addEventListener('focusout', off);
  });

  // pointer tide (mouse only): the primary leans 3 % toward the pointer and the band tilts
  if (!touch && !reduced) {
    window.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType === 'touch') return;
        lens.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
      },
      { passive: true }
    );
    html.addEventListener('pointerleave', () => lens.setPointer(0, 0));
    window.addEventListener('blur', () => lens.setPointer(0, 0));
  }

  window.addEventListener('resize', retargetModal);

  if (import.meta.env.DEV) {
    (window as unknown as { __lens: unknown }).__lens = { lens, path, seam, target };
  }
  return seam;
}
