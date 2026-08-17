import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

interface AnimOptions {
  reduced: boolean;
  onScroll: (progress: number) => void;
}

const $ = <T extends Element>(sel: string): T | null => document.querySelector<T>(sel);

function splitChars(el: HTMLElement): HTMLSpanElement[] {
  const text = el.textContent ?? '';
  el.textContent = '';
  const spans: HTMLSpanElement[] = [];
  for (const ch of text) {
    if (ch === ' ') {
      el.appendChild(document.createTextNode(' '));
      continue;
    }
    const s = document.createElement('span');
    s.className = 'ch';
    s.textContent = ch;
    el.appendChild(s);
    spans.push(s);
  }
  return spans;
}

function splitWords(el: HTMLElement): HTMLSpanElement[] {
  const words = (el.textContent ?? '').trim().split(/\s+/);
  el.textContent = '';
  return words.map((word, i) => {
    const s = document.createElement('span');
    s.className = 'w';
    s.textContent = word;
    el.appendChild(s);
    if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
    return s;
  });
}

export function initAnimations({ reduced, onScroll }: AnimOptions): void {
  // the shader dims as the page descends — always wired, even with reduced motion
  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (self) => onScroll(self.progress),
  });

  const splitTargets = document.querySelectorAll<HTMLElement>('[data-split]');
  const chars = Array.from(splitTargets).flatMap((el) => splitChars(el));

  if (reduced) {
    gsap.set(chars, { yPercent: 0 });
    gsap.set(['.site-nav', '.hero-side', '.scroll-cue'], { opacity: 1, y: 0 });
    return;
  }

  // intro
  gsap.set(chars, { yPercent: 115 });
  gsap.set('.site-nav', { opacity: 0, y: -16 });
  gsap.set('.hero-side', { opacity: 0, y: 24 });
  gsap.set('.scroll-cue', { opacity: 0 });

  const intro = gsap.timeline({ defaults: { ease: 'power4.out' } });
  intro
    .to(chars, { yPercent: 0, duration: 1.4, stagger: 0.04 }, 0.15)
    .to('.site-nav', { opacity: 1, y: 0, duration: 0.9 }, 0.55)
    .to('.hero-side', { opacity: 1, y: 0, duration: 1.0 }, 0.85)
    .to('.scroll-cue', { opacity: 1, duration: 0.8 }, 1.3);

  // hero drifts away as you leave it
  gsap.to('.hero-inner', {
    yPercent: -12,
    opacity: 0,
    ease: 'none',
    scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: true },
  });

  // manifesto: title pins while the words surface one by one
  const manifestoText = $<HTMLElement>('.manifesto-text');
  if (manifestoText) {
    const words = splitWords(manifestoText);
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
    ScrollTrigger.create({
      trigger: '.manifesto-pin',
      start: 'top 24%',
      endTrigger: manifestoText,
      end: 'bottom 62%',
      pin: true,
      pinSpacing: false,
    });
  }

  // cinema image: grows into view, dims and recedes on the way out
  gsap.fromTo(
    '.cinema',
    { scale: 0.85, opacity: 0.4 },
    {
      scale: 1,
      opacity: 1,
      ease: 'none',
      scrollTrigger: { trigger: '.cinema', start: 'top 92%', end: 'top 32%', scrub: true },
    }
  );
  gsap.to('.cinema', {
    opacity: 0.15,
    scale: 0.96,
    ease: 'none',
    scrollTrigger: { trigger: '.cinema', start: 'bottom 45%', end: 'bottom top', scrub: true },
  });

  // section heads and footer rise in
  gsap.utils.toArray<HTMLElement>('.section-head, .footer-cta, .footer-links').forEach((el) => {
    gsap.fromTo(
      el,
      { opacity: 0, y: 40 },
      {
        opacity: 1,
        y: 0,
        duration: 1.1,
        ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 88%', once: true },
      }
    );
  });
}
