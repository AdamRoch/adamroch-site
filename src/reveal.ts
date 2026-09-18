// The four masked line reveals (hero H1, index H2, manifesto H2, footer H2) and the
// heavy-word drop. Lines only, never chars or words; each plays once and never reverses.
// CSS owns the hidden state (html.js .reveal is clipped) until the split takes over.

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import type { SplitText as SplitTextClass } from 'gsap/SplitText';

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

// SplitText is ~20 KB gz and is not needed until after fonts.ready, so it stays out of the
// entry graph and off the first frame's script time.
let Split: typeof SplitTextClass | null = null;
gsap.defaults({ ease: 'expo.out' });

export { gsap, ScrollTrigger };

const PHONE = '(max-width: 700px)';
const LINE_MS = 1;
const STAGGER = 0.07;
const DROP_MS = 0.9;
const DROP_DELAY = 0.12;

// document.fonts.ready with a cap: past it the reveal runs on the metric-matched fallback
// and SplitText's autoSplit re-splits when the real face lands.
export function fontsReady(capMs = 300): Promise<void> {
  return Promise.race([
    document.fonts.ready.then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, capMs)),
  ]);
}

// SplitText treats every <br> as a hard break, display:none or not, so the inactive
// breakpoint's set (.d on phones, .m on desktop) is removed before splitting.
function pruneHiddenBreaks(el: HTMLElement): void {
  el.querySelectorAll('br').forEach((br) => {
    if (getComputedStyle(br).display === 'none') br.remove();
  });
}

interface RevealOptions {
  start?: string; // ScrollTrigger start; absent = play now
  overshoot?: boolean; // the hero's heavy word lands with back.out(1.1)
}

function reveal(el: HTMLElement, opts: RevealOptions): void {
  const original = el.innerHTML;
  let current: SplitTextClass | null = null;
  let lastTl: gsap.core.Timeline | null = null;

  const build = (): SplitTextClass => {
    return Split!.create(el, {
      type: 'lines',
      mask: 'lines',
      linesClass: 'line',
      autoSplit: true,
      onSplit(self) {
        const lines = self.lines as HTMLElement[];
        const tl = gsap.timeline(
          opts.start ? { scrollTrigger: { trigger: el, start: opts.start, once: true } } : {}
        );
        tl.from(lines, { yPercent: 110, duration: LINE_MS, stagger: STAGGER }, 0);
        const accent = el.querySelector<HTMLElement>('.accent');
        if (accent) {
          const idx = Math.max(0, lines.findIndex((l) => l.contains(accent)));
          tl.from(
            accent,
            { yPercent: 110, duration: DROP_MS, ease: opts.overshoot ? 'back.out(1.1)' : 'expo.out' },
            idx * STAGGER + DROP_DELAY
          );
        }
        el.classList.add('is-split');
        // a rebuild after the reveal has played must not replay it
        if (lastTl && lastTl.progress() >= 1) tl.progress(1);
        lastTl = tl;
        // the lens path caches word positions; a split or a landed line is a reason to re-read them
        tl.eventCallback('onComplete', () => document.dispatchEvent(new Event('lens:refresh')));
        document.dispatchEvent(new Event('lens:refresh'));
        return tl;
      },
    });
  };

  const rebuild = (): void => {
    current?.revert();
    el.innerHTML = original;
    pruneHiddenBreaks(el);
    current = build();
  };

  pruneHiddenBreaks(el);
  current = build();
  matchMedia(PHONE).addEventListener('change', rebuild);
}

export async function initReveals(): Promise<void> {
  const html = document.documentElement;
  const targets = Array.from(document.querySelectorAll<HTMLElement>('.reveal'));
  if (targets.length === 0) return;
  if (html.classList.contains('reduced')) {
    // everything is visible at first paint; only the breakpoint-specific <br> matter, and CSS handles those
    return;
  }
  const [mod] = await Promise.all([import('gsap/SplitText'), fontsReady(300)]);
  Split = mod.SplitText;
  gsap.registerPlugin(Split);
  for (const el of targets) {
    const start = el.dataset.start;
    reveal(el, { start, overshoot: !start && el.matches('h1') });
  }
}
