import './style.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(ScrollTrigger, SplitText);

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const FOLIO_PAGES = 9;

/* ————— folio: page counter + progress rule (informational, always live) ————— */

function initFolio(): void {
  const fill = document.getElementById('folio-fill');
  const page = document.getElementById('folio-page');
  if (!fill || !page) return;

  const sync = (progress: number): void => {
    gsap.set(fill, { scaleX: progress });
    const n = Math.min(FOLIO_PAGES, Math.floor(progress * FOLIO_PAGES) + 1);
    page.textContent = `Folio ${String(n).padStart(2, '0')} / ${FOLIO_PAGES}`;
  };

  const st = ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (self) => sync(self.progress),
  });
  sync(st.progress);
}

/* ————— masthead: weight-axis breathing, masked rise, redaction peel ————— */

function initMasthead(): void {
  if (reduced) return;

  const lines = gsap.utils.toArray<HTMLElement>('.mast-line.disp');
  const alt = document.querySelector<HTMLElement>('.mast-line.alt');

  lines.forEach((line, i) => {
    const proxy = { w: 200 };
    gsap.set(line, { yPercent: 115 });
    gsap.to(line, {
      yPercent: 0,
      duration: 1.3,
      delay: 0.15 + i * 0.14,
      ease: 'power4.out',
    });
    gsap.to(proxy, {
      w: 610,
      duration: 1.7,
      delay: 0.2 + i * 0.14,
      ease: 'power2.inOut',
      onUpdate: () => {
        line.style.fontVariationSettings = `'wght' ${proxy.w.toFixed(1)}`;
      },
    });
  });

  if (alt) {
    gsap.set(alt, { yPercent: 115 });
    gsap.to(alt, { yPercent: 0, duration: 1.3, delay: 0.43, ease: 'power4.out' });
  }

  gsap.from('.mast-meta', { opacity: 0, y: -14, duration: 0.9, delay: 0.95, ease: 'power3.out' });
  gsap.from(['.kicker', '.deck', '.mast-hint'], {
    opacity: 0,
    y: 22,
    duration: 1,
    stagger: 0.12,
    delay: 0.8,
    ease: 'power3.out',
  });

  gsap.to('.mast-inner', {
    yPercent: -6,
    opacity: 0.25,
    ease: 'none',
    scrollTrigger: { trigger: '.masthead', start: 'top top', end: 'bottom top', scrub: true },
  });

  gsap.to('.redact-bar', {
    scaleX: 0,
    stagger: 0.2,
    ease: 'none',
    scrollTrigger: { trigger: '.deck', start: 'top 40%', end: 'top 8%', scrub: true },
  });
}

/* ————— hairline rules draw themselves in ————— */

function initRules(): void {
  if (reduced) return;
  gsap.utils.toArray<HTMLElement>('.hr').forEach((el) => {
    gsap.fromTo(
      el,
      { scaleX: 0 },
      {
        scaleX: 1,
        ease: 'none',
        scrollTrigger: { trigger: el, start: 'top 94%', end: 'top 58%', scrub: true },
      }
    );
  });
}

/* ————— quiet reveals for heads and marginalia ————— */

function initReveals(): void {
  if (reduced) return;
  gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((el) => {
    gsap.fromTo(
      el,
      { opacity: 0, y: 26 },
      {
        opacity: 1,
        y: 0,
        duration: 1.05,
        ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 86%', once: true },
      }
    );
  });
}

/* ————— pull quotes: pin, then scatter with scroll velocity ————— */

function initPulls(): void {
  if (reduced) return;
  const pulls = gsap.utils.toArray<HTMLElement>('.pull');
  if (pulls.length === 0) return;

  const mm = gsap.matchMedia();

  mm.add('(min-width: 861px)', () => {
    const cleanups: Array<() => void> = [];

    pulls.forEach((pull) => {
      const text = pull.querySelector<HTMLElement>('.pull-text');
      if (!text) return;

      const split = new SplitText(text, { type: 'words,chars', wordsClass: 'pull-word', charsClass: 'pull-ch' });
      const chars = split.chars as HTMLElement[];
      const dir = chars.map(() => ({
        x: gsap.utils.random(-1, 1),
        y: gsap.utils.random(-0.8, 0.6),
        r: gsap.utils.random(-14, 14),
      }));

      gsap.from(pull, {
        opacity: 0,
        y: 60,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: pull, start: 'top 85%', once: true },
      });

      const settle = gsap.delayedCall(0.16, () => {
        chars.forEach((c) =>
          gsap.to(c, {
            x: 0,
            y: 0,
            rotation: 0,
            duration: 1.2,
            ease: 'elastic.out(1, 0.55)',
            overwrite: 'auto',
          })
        );
      }).pause();

      const st = ScrollTrigger.create({
        trigger: pull,
        start: 'top top',
        end: '+=130%',
        pin: true,
        anticipatePin: 1,
        onUpdate: (self) => {
          settle.restart(true);
          const kick = gsap.utils.clamp(-1, 1, self.getVelocity() / 1800);
          const swell = Math.sin(Math.PI * self.progress);
          const amp = kick * 96 + swell * 10;
          chars.forEach((c, i) => {
            gsap.to(c, {
              x: dir[i].x * amp,
              y: dir[i].y * amp,
              rotation: dir[i].r * kick,
              duration: 0.55,
              ease: 'power3.out',
              overwrite: 'auto',
            });
          });
        },
      });

      cleanups.push(() => {
        st.kill();
        settle.kill();
        split.revert();
        gsap.set([pull, text], { clearProps: 'all' });
      });
    });

    return () => cleanups.forEach((fn) => fn());
  });
}

/* ————— plate I: hairline field bending around the pointer ————— */

function initPlate(): void {
  const canvas = document.getElementById('plate-canvas') as HTMLCanvasElement | null;
  const plate = canvas?.parentElement;
  const ctx = canvas?.getContext('2d');
  if (!canvas || !plate || !ctx) return;

  const INK = 'rgba(22, 19, 14, 0.34)';
  const SPOT = 'rgba(255, 77, 0, 0.8)';
  const GROUND = '#f0ece2';

  let w = 1;
  let h = 1;
  let tx = 0;
  let ty = 0;
  let cx = 0;
  let cy = 0;
  let hasPointer = false;
  let running = false;
  let raf = 0;

  const draw = (): void => {
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, w, h);

    const gap = Math.max(20, Math.round(w / 54));
    const cols = Math.ceil(w / gap) + 1;
    const steps = 26;
    const radius = Math.max(w, h) * 0.17;
    const r2 = radius * radius;
    const push = radius * 0.3;

    ctx.lineWidth = 1;
    for (let i = 0; i < cols; i++) {
      const x0 = i * gap + gap / 2;
      ctx.strokeStyle = i % 6 === 2 ? SPOT : INK;
      ctx.beginPath();
      for (let j = 0; j <= steps; j++) {
        const y = (j / steps) * h;
        const dx = x0 - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;
        const g = Math.exp(-d2 / r2);
        const dist = Math.sqrt(d2) || 1;
        const px = x0 + (dx / dist) * g * push;
        if (j === 0) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      ctx.stroke();
    }
  };

  const resize = (): void => {
    const rect = plate.getBoundingClientRect();
    w = Math.max(1, Math.round(rect.width));
    h = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!hasPointer) {
      cx = w * 0.62;
      cy = h * 0.42;
      tx = cx;
      ty = cy;
    }
    draw();
  };

  const tick = (now: number): void => {
    if (!hasPointer) {
      tx = w * (0.5 + Math.sin(now * 0.00023) * 0.33);
      ty = h * (0.45 + Math.cos(now * 0.00031) * 0.18);
    }
    cx += (tx - cx) * 0.07;
    cy += (ty - cy) * 0.07;
    draw();
    raf = requestAnimationFrame(tick);
  };

  const play = (): void => {
    if (running || reduced) return;
    running = true;
    raf = requestAnimationFrame(tick);
  };

  const halt = (): void => {
    running = false;
    cancelAnimationFrame(raf);
  };

  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => (e.isIntersecting ? play() : halt())),
    { rootMargin: '80px' }
  );
  io.observe(plate);

  if (!reduced) {
    plate.addEventListener('pointermove', (e) => {
      const r = plate.getBoundingClientRect();
      hasPointer = true;
      tx = e.clientX - r.left;
      ty = e.clientY - r.top;
    });
    plate.addEventListener('pointerleave', () => {
      hasPointer = false;
    });
  }

  window.addEventListener('resize', resize);
  resize();
}

/* ————— design note toggle ————— */

function initNotePanel(): void {
  const btn = document.getElementById('bs-note-btn');
  const panel = document.getElementById('bs-note-panel');
  if (!btn || !panel) return;

  const setOpen = (open: boolean): void => {
    btn.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
  };

  btn.addEventListener('click', () => {
    setOpen(btn.getAttribute('aria-expanded') !== 'true');
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      setOpen(false);
      btn.focus();
    }
  });
}

/* ————— go ————— */

initFolio();
initMasthead();
initRules();
initReveals();
initPulls();
initPlate();
initNotePanel();

if (document.fonts) {
  document.fonts.ready.then(() => ScrollTrigger.refresh());
}
window.addEventListener('load', () => ScrollTrigger.refresh());
