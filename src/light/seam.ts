/* ————— the seam: leaving for a lab through its door, and coming back out of it ————— */
// Click or Enter on a row with GL and motion: the door's ring swallows the viewport with
// the lab's first-frame colour inside (exit), the DOM text fades under it, then the browser
// navigates; the cross-document view transition carries the flat colour into the lab's
// preloader curtain. bfcache return reverses it. A fresh load straight from that lab boots
// at full aperture and contracts (the inline head script pre-paints the same colour and
// adds html.seam so nothing flashes).

import type { LensHandle, LensTint } from './gl';
import { hexToLinear, labBySlug } from '../labs';

const KEY = 'seam';
const EXIT_MS = 520;
const ENTER_MS = 600;

export interface SeamRecord {
  from: 'home';
  lab: string;
  first: string;
  t: number;
}

export interface Seam {
  navigating: boolean;
  row: HTMLElement | null; // the door being left through, while navigating
  boot(): Promise<boolean>; // true when the page came in through a door (enter ran)
  destroy(): void;
}

// drop the pre-painted lab colour and let the text in; safe to call any number of times
export function releaseSeam(): void {
  const html = document.documentElement;
  if (!html.classList.contains('seam')) return;
  html.classList.add('seam-in');
  html.classList.remove('seam');
  html.style.background = '';
  window.setTimeout(() => html.classList.remove('seam-in'), 600);
}

export function readSeam(): SeamRecord | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as SeamRecord | null;
    return s && s.from === 'home' && typeof s.lab === 'string' && typeof s.first === 'string' ? s : null;
  } catch {
    return null;
  }
}

function clearSeam(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

export function initSeam(lens: LensHandle, opts: { reduced: boolean; onLeave?: (row: HTMLElement) => void }): Seam {
  const html = document.documentElement;
  let lastTint: LensTint | null = null;
  const seam: Seam = { navigating: false, row: null, boot, destroy };

  async function boot(): Promise<boolean> {
    const rec = readSeam();
    if (!html.classList.contains('seam') || !rec || opts.reduced) {
      releaseSeam();
      clearSeam();
      return false;
    }
    clearSeam();
    lastTint = hexToLinear(rec.first);
    // the ring is already open on the lab's colour; the band and ring form while it contracts
    lens.arrive(ENTER_MS);
    const done = lens.enter(lastTint, ENTER_MS);
    window.setTimeout(releaseSeam, 120);
    await done;
    return true;
  }

  async function leave(row: HTMLElement, href: string): Promise<void> {
    if (seam.navigating) return;
    seam.navigating = true;
    seam.row = row;
    const slug = row.dataset.lab ?? '';
    const lab = labBySlug(slug);
    const first = lab?.first ?? row.dataset.tint ?? '#0b0a09';
    lastTint = hexToLinear(first);
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ from: 'home', lab: slug, first, t: Date.now() } satisfies SeamRecord));
    } catch {
      /* the lab still gets its normal boot */
    }
    opts.onLeave?.(row);
    html.classList.add('seam-out');
    // a lost context or a hidden tab stops the frame loop mid-exit; the link still works
    await Promise.race([lens.exit(lastTint, EXIT_MS), new Promise((r) => setTimeout(r, EXIT_MS + 150))]);
    location.href = href;
  }

  function onClick(e: MouseEvent): void {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (opts.reduced || !html.classList.contains('gl-ready')) return;
    const row = (e.target as Element | null)?.closest<HTMLAnchorElement>('a.row[href]');
    if (!row) return;
    e.preventDefault();
    void leave(row, row.href);
  }

  function onPageShow(e: PageTransitionEvent): void {
    if (!e.persisted) return;
    // back out of the door: the page is exactly as it was left, ring wide open
    seam.navigating = false;
    seam.row = null;
    html.classList.remove('seam-out');
    if (lastTint) void lens.enter(lastTint, ENTER_MS);
  }

  document.addEventListener('click', onClick);
  window.addEventListener('pageshow', onPageShow);

  function destroy(): void {
    document.removeEventListener('click', onClick);
    window.removeEventListener('pageshow', onPageShow);
  }

  return seam;
}
