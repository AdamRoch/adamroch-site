/* ————— Lab 05 · Tender: chrome + curtain first, three.js behind it ————— */
// The slug is still /lab/broadsheet/ (links and the UPDATED label key on it); the page that
// lived here was an essay set like a newspaper, and this one replaced it.
// No static three import here: the curtain has to be on screen before three is fetched.
// Everything in this file works without WebGL; the coins are an addition, not the page.

import { mountLabChrome, mountPreloader } from '../lab-chrome';
import { createScroll } from './scroll';
import './style.css';

const html = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const chrome = mountLabChrome({
  index: 5,
  total: 5,
  title: 'Tender',
  next: { href: '/lab/event-horizon/', title: 'Event Horizon' },
  notePanelId: 'tn-note-panel',
  skin: 'glass',
});

const loader = mountPreloader({ title: 'Tender', index: 5, total: 5 });
loader.set(0.04, 'fetching three');

const scroll = createScroll();
const st = scroll.state();

/* ————— buttons ————— */

// the hero's "How it's built" toggles the same note as the chrome's button. The chrome closes
// the note on any pointerdown outside it, which would shut it just before this click reopened it.
const noteOpen = (): boolean => document.querySelector('.lc-note')?.getAttribute('aria-expanded') === 'true';
document.querySelectorAll<HTMLElement>('[data-open-note]').forEach((b) => {
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', () => chrome.setNoteOpen(!noteOpen()));
});

document.querySelectorAll<HTMLAnchorElement>('[data-top]').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    document.getElementById('top')?.focus({ preventScroll: true });
  })
);

/* ————— what the scroll position says about the page ————— */

const unfurl = document.getElementById('unfurl');
const navLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.tn-nav [data-nav]'));
const navPill = document.querySelector<HTMLElement>('.tn-nav-pill');
const spentEl = document.querySelector<HTMLElement>('[data-spent]');
let navBoxes: { left: number; width: number }[] = [];
let spent = 0;
let lastY = window.scrollY;
let shownBeat = '';
let shownChapter = '';
let shownTop = '';
let shownBottom = '';
let shownBg = '';
let shownSpent = '';

function measureNav(): void {
  navBoxes = navLinks.map((a) => ({ left: a.offsetLeft, width: a.offsetWidth }));
}

function sync(): void {
  const y = window.scrollY;
  scroll.read(y, st);
  spent += Math.abs(y - lastY);
  lastY = y;

  // the unfurl headline changes in three beats as its section scrolls
  const k = scroll.sections.findIndex((s) => s.el === unfurl);
  const q = k >= 0 ? st.pin[k] : 0;
  const beat = q < 0.34 ? '0' : q < 0.68 ? '1' : '2';
  if (beat !== shownBeat && unfurl) {
    shownBeat = beat;
    unfurl.dataset.beat = beat;
  }

  // the chapter under the middle of the viewport lights its tab
  const mid = scroll.sectionAt(y, st.vh * 0.5);
  const chapter = mid?.chapter ?? '';
  if (chapter !== shownChapter) {
    shownChapter = chapter;
    let on = -1;
    navLinks.forEach((a, i) => {
      const hit = a.dataset.nav === chapter;
      if (hit) {
        on = i;
        a.setAttribute('aria-current', 'true');
      } else a.removeAttribute('aria-current');
    });
    if (navPill) {
      const b = navBoxes[on];
      navPill.style.opacity = b ? '1' : '0';
      if (b) navPill.style.transform = `translateX(${b.left}px)`;
      if (b) navPill.style.width = `${b.width}px`;
    }
  }

  // the fixed chrome reads on whatever section is under it: top edge and bottom edge apart
  const top = scroll.sectionAt(y, 36)?.tone ?? 'dark';
  const under = scroll.sectionAt(y, st.vh - 36);
  const bottom = under?.tone ?? 'dark';
  if (top !== shownTop) html.dataset.toneTop = shownTop = top;
  if (bottom !== shownBottom) html.dataset.toneBottom = shownBottom = bottom;
  const bg = under?.el.dataset.bg ?? '';
  if (bg !== shownBg) html.dataset.bgBottom = shownBg = bg;

  const s = Math.round(spent).toLocaleString('en-US');
  if (s !== shownSpent && spentEl) spentEl.textContent = shownSpent = s;
}

let queued = 0;
function request(): void {
  if (queued) return;
  queued = requestAnimationFrame(() => {
    queued = 0;
    sync();
  });
}

function remeasure(): void {
  scroll.measure();
  measureNav();
  shownChapter = ''; // the pill's box may have moved
  sync();
  document.dispatchEvent(new Event('tn:measure'));
}

window.addEventListener('scroll', request, { passive: true });
// anything that moves the sections (a resize, the fonts, a reflow) re-reads them, once it settles
let rz = 0;
const later = (): void => {
  clearTimeout(rz);
  rz = window.setTimeout(remeasure, 120);
};
window.addEventListener('resize', later);
new ResizeObserver(later).observe(document.body);
document.fonts?.ready.then(remeasure);
remeasure();

/* ————— reveals: each section's type rises once, the first time it is seen ————— */

if (!reduced && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    },
    { threshold: 0.2 }
  );
  document.querySelectorAll('.tn-sec').forEach((s) => io.observe(s));
} else {
  document.querySelectorAll('.tn-sec').forEach((s) => s.classList.add('is-in'));
}

/* ————— the coins ————— */

async function start(): Promise<void> {
  try {
    const { boot } = await import('./scene');
    loader.set(0.3, 'setting up');
    await boot({ chrome, loader, scroll });
  } catch (err) {
    // no WebGL or a broken shader: lift the curtain so the page is still a page
    chrome.setStatus('WebGL unavailable');
    html.classList.add('tn-nogl');
    void loader.done();
    throw err;
  }
}

void start();
