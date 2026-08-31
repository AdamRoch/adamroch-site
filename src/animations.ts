import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

interface AnimOptions {
  reduced: boolean;
  onMorph: (progress: number) => void;
}

const $ = <T extends Element>(selector: string): T | null => document.querySelector<T>(selector);

function splitChars(element: HTMLElement): HTMLSpanElement[] {
  const text = element.textContent ?? '';
  element.textContent = '';
  const spans: HTMLSpanElement[] = [];

  for (const part of text.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      element.appendChild(document.createTextNode(part));
      continue;
    }

    const word = document.createElement('span');
    word.className = 'word';
    for (const character of part) {
      const span = document.createElement('span');
      span.className = 'ch';
      span.textContent = character;
      word.appendChild(span);
      spans.push(span);
    }
    element.appendChild(word);
  }

  return spans;
}

function splitWords(element: HTMLElement): HTMLSpanElement[] {
  const words = (element.textContent ?? '').trim().split(/\s+/);
  element.textContent = '';

  return words.map((word, index) => {
    const span = document.createElement('span');
    span.className = 'w';
    span.textContent = word;
    element.appendChild(span);
    if (index < words.length - 1) element.appendChild(document.createTextNode(' '));
    return span;
  });
}

function initClock(): void {
  const clock = $<HTMLElement>('[data-clock]');
  if (!clock) return;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const update = (): void => {
    clock.textContent = `${formatter.format(new Date())} GMT-6`;
  };

  update();
  window.setInterval(update, 30_000);
}

function initSegmentedNav(): void {
  const nav = $<HTMLElement>('.seg-nav');
  const hero = $<HTMLElement>('#hero');
  if (!nav || !hero) return;

  const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>('[data-section]'));
  const setActive = (sectionId: string): void => {
    links.forEach((link) => {
      const active = link.dataset.section === sectionId;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  };

  const sectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) setActive(entry.target.id);
      });
    },
    { rootMargin: '-45% 0px -45% 0px' }
  );
  ['experiments', 'manifesto', 'contact'].forEach((id) => {
    const section = document.getElementById(id);
    if (section) sectionObserver.observe(section);
  });

  const heroObserver = new IntersectionObserver(([entry]) => {
    nav.classList.toggle('is-hidden', entry?.isIntersecting ?? false);
  });
  heroObserver.observe(hero);
}

function initWorkPreview(reduced: boolean): void {
  if (reduced || !window.matchMedia('(pointer: fine)').matches) return;

  const rows = Array.from(document.querySelectorAll<HTMLElement>('.work-row'));
  if (rows.length === 0) return;

  const preview = document.createElement('div');
  preview.className = 'work-preview';
  preview.setAttribute('aria-hidden', 'true');
  document.body.appendChild(preview);

  const xTo = gsap.quickTo(preview, 'x', { duration: 0.42, ease: 'power3.out' });
  const yTo = gsap.quickTo(preview, 'y', { duration: 0.42, ease: 'power3.out' });
  let activeRow: HTMLElement | null = null;

  const positionPreview = (clientX: number, clientY: number, immediate = false): void => {
    const width = preview.offsetWidth;
    const height = preview.offsetHeight;
    const x = gsap.utils.clamp(12, Math.max(12, window.innerWidth - width - 12), clientX + 24);
    const y = gsap.utils.clamp(12, Math.max(12, window.innerHeight - height - 12), clientY + 24);
    if (immediate) gsap.set(preview, { x, y });
    else {
      xTo(x);
      yTo(y);
    }
  };

  const show = (row: HTMLElement, clientX?: number, clientY?: number): void => {
    const source = row.dataset.thumb;
    if (!source) return;
    activeRow = row;
    preview.style.backgroundImage = `url("${source}")`;

    if (clientX === undefined || clientY === undefined) {
      const bounds = row.getBoundingClientRect();
      positionPreview(bounds.left + bounds.width * 0.62, bounds.top + bounds.height * 0.2, true);
    } else {
      positionPreview(clientX, clientY, true);
    }

    gsap.fromTo(
      preview,
      { autoAlpha: 0, scale: 0.9 },
      { autoAlpha: 1, scale: 1, duration: 0.35, ease: 'power3.out', overwrite: true }
    );
  };

  const hide = (row: HTMLElement): void => {
    if (activeRow !== row) return;
    activeRow = null;
    gsap.to(preview, {
      autoAlpha: 0,
      scale: 0.96,
      duration: 0.2,
      ease: 'power2.out',
      overwrite: true,
    });
  };

  rows.forEach((row) => {
    row.addEventListener('pointerenter', (event) => show(row, event.clientX, event.clientY));
    row.addEventListener('pointerleave', () => hide(row));
    row.addEventListener('focus', () => show(row));
    row.addEventListener('blur', () => hide(row));
  });

  window.addEventListener('pointermove', (event) => {
    if (activeRow) positionPreview(event.clientX, event.clientY);
  });
}

export function initAnimations({ reduced, onMorph }: AnimOptions): void {
  initClock();
  initSegmentedNav();
  initWorkPreview(reduced);

  const splitTargets = document.querySelectorAll<HTMLElement>('[data-split]');
  const chars = Array.from(splitTargets).flatMap((element) => splitChars(element));
  const manifestoText = $<HTMLElement>('.manifesto-text');
  const words = manifestoText ? splitWords(manifestoText) : [];
  const revealTargets = gsap.utils.toArray<HTMLElement>(
    '.work-row, .media-card, .section-head, .footer-cta, .footer-actions, .footer-links'
  );

  if (reduced) {
    gsap.set(chars, { yPercent: 0 });
    gsap.set(words, { opacity: 1 });
    gsap.set(['.top-bar', '.hero-role', '.scroll-cue', ...revealTargets], { opacity: 1, y: 0 });
    return;
  }

  gsap.set(chars, { yPercent: 115 });
  gsap.set('.top-bar', { opacity: 0, y: -16 });
  gsap.set(['.hero-role', '.scroll-cue'], { opacity: 0, y: 24 });

  gsap
    .timeline({ defaults: { ease: 'power4.out' } })
    .to(chars, { yPercent: 0, duration: 1.4, stagger: 0.03 }, 0.15)
    .to('.top-bar', { opacity: 1, y: 0, duration: 0.9 }, 0.55)
    .to(['.hero-role', '.scroll-cue'], { opacity: 1, y: 0, duration: 1 }, 0.85);

  ScrollTrigger.create({
    trigger: '#manifesto',
    start: 'top bottom',
    end: 'bottom top',
    scrub: true,
    onUpdate: (self) => onMorph(self.progress),
  });

  if (manifestoText && words.length > 0) {
    gsap.set(words, { opacity: 0.12 });
    gsap.to(words, {
      opacity: 1,
      ease: 'none',
      stagger: 0.05,
      scrollTrigger: {
        trigger: manifestoText,
        start: 'top 78%',
        end: 'bottom 45%',
        scrub: true,
      },
    });

    const media = gsap.matchMedia();
    media.add('(min-width: 861px)', () => {
      ScrollTrigger.create({
        trigger: '.manifesto-pin',
        start: 'top 24%',
        endTrigger: manifestoText,
        end: 'bottom 62%',
        pin: true,
        pinSpacing: false,
      });
    });
  }

  revealTargets.forEach((element) => {
    gsap.fromTo(
      element,
      { opacity: 0, y: 40 },
      {
        opacity: 1,
        y: 0,
        duration: 1.1,
        ease: 'power3.out',
        scrollTrigger: { trigger: element, start: 'top 88%', once: true },
      }
    );
  });

  void document.fonts.ready.then(() => ScrollTrigger.refresh());
}
