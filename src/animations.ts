import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

type ThemeName = 'dark' | 'light';

interface AnimOptions {
  reduced: boolean;
  onScroll: (progress: number) => void;
  onTheme: (theme: ThemeName) => void;
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

// theme toggle: data-theme is set pre-paint by the inline script in index.html;
// this wires the buttons, persistence, and the particle backdrop switch
function initTheme(onTheme: (theme: ThemeName) => void): void {
  const root = document.documentElement;
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-theme-option]'));
  const metaTheme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

  const apply = (theme: ThemeName, persist: boolean): void => {
    root.dataset.theme = theme;
    if (persist) {
      try {
        localStorage.setItem('adam-theme', theme);
      } catch {
        /* private mode — theme just won't persist */
      }
    }
    if (metaTheme) metaTheme.content = theme === 'light' ? '#bfe9f2' : '#0b0b0d';
    buttons.forEach((btn) => {
      const active = btn.dataset.themeOption === theme;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    onTheme(theme);
  };

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const next: ThemeName = btn.dataset.themeOption === 'light' ? 'light' : 'dark';
      if (next !== root.dataset.theme) apply(next, true);
    });
  });

  apply(root.dataset.theme === 'light' ? 'light' : 'dark', false);
}

// the footer turns to glass as you scroll into it (light theme styling)
function initFooterGlass(): void {
  const footer = document.getElementById('contact');
  if (!footer) return;
  const update = (): void => {
    const rect = footer.getBoundingClientRect();
    const t = Math.min(
      1,
      Math.max(0, (window.innerHeight - rect.top) / (window.innerHeight * 0.65))
    );
    document.documentElement.style.setProperty('--falpha', (0.88 - t * 0.46).toFixed(3));
  };
  update();
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
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

export function initAnimations({ reduced, onScroll, onTheme }: AnimOptions): void {
  initTheme(onTheme);
  initFooterGlass();
  initClock();
  initSegmentedNav();

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

  // the particle backdrop follows whole-page scroll
  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (self) => onScroll(self.progress),
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
