// Renders the two head images the page references but cannot ship as source:
//   public/og.png      1200x630 share card, the hero composition with its own lockup
//   public/icon-180.png  apple-touch-icon, favicon.svg rasterised
//
//   node tools/og.mjs [url] [--out=public] [--wait=6000]
//
// `url` defaults to the dev server (http://localhost:5173/). Point it at a
// `vite preview` of dist/ to render exactly what ships. The page is loaded, the
// lens is given time to arrive, then the DOM chrome is replaced with a share-card
// lockup so the card is not a screenshot of a scrollbar-less browser: the canvas
// is the site's own frame, the words are set in the site's own faces.
//
// The images are committed. Re-run after any change to the hero composition, the
// lens palette or the wordmark, or the card will quietly drift from the page.

import { writeFileSync } from 'node:fs';
import { launch } from './probe.mjs';

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const i = a.indexOf('=');
      return i === -1 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
    })
);
const url = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5173/';
const outDir = String(flags.out ?? 'public');
const wait = Number(flags.wait ?? 6000);

const png = async (page) => {
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  return Buffer.from(shot.result.data, 'base64');
};

/* ————— the share card ————— */

// The lens keeps drawing; everything else is replaced by a card lockup sized for
// 1200x630 (the hero's own clamp() sizes are tuned for a full viewport, not for a
// 1.9:1 crop). Fonts are the page's, already loaded by the time this runs.
const CARD = `(() => {
  document.querySelectorAll('body > *:not(#lens)').forEach((el) => el.remove());
  document.documentElement.classList.remove('seam');
  const card = document.createElement('div');
  card.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;justify-content:flex-end;' +
    'padding:64px 72px;font-family:var(--font-sans);color:var(--ink);z-index:5';
  card.innerHTML =
    '<p style="margin:0 0 auto;font-family:var(--font-mono);font-size:13px;font-weight:500;' +
      'letter-spacing:.08em;text-transform:uppercase;color:var(--mute)">Adam Roch &middot; Creative engineer &middot; Austin, TX</p>' +
    '<h1 style="margin:0;font-size:86px;font-weight:500;line-height:.98;letter-spacing:-.035em;max-width:15ch">' +
      'I make things for the web. Every page here has its own ' +
      '<em style="font-family:var(--font-serif);font-style:italic;font-weight:400;font-size:1.06em;' +
      'letter-spacing:0;position:relative;top:.03em">gravity</em>.</h1>';
  document.body.appendChild(card);
  return true;
})()`;

const page = await launch({ W: 1200, H: 630, DPR: 1 });
await page.goto(url, wait);
// the lens fades in on gl-ready; without it the card would be flat ground
const ready = await page.evaluate(
  `new Promise((r) => { const d = document.documentElement;
     if (d.classList.contains('gl-ready') || d.classList.contains('nogl')) return r(d.className);
     const o = new MutationObserver(() => { if (d.classList.contains('gl-ready') || d.classList.contains('nogl')) { o.disconnect(); r(d.className); } });
     o.observe(d, { attributes: true, attributeFilter: ['class'] });
     setTimeout(() => { o.disconnect(); r(d.className + ' (timeout)'); }, 8000); })`
);
await page.evaluate(CARD);
await new Promise((r) => setTimeout(r, 1200));
writeFileSync(`${outDir}/og.png`, await png(page));
console.log(`wrote ${outDir}/og.png  1200x630  (${ready.trim()})`);
page.close();

/* ————— the apple touch icon ————— */

const icon = await launch({ W: 180, H: 180, DPR: 1 });
await icon.goto(new URL('/favicon.svg', url).href, 600);
// favicon.svg is drawn on the page ground; the icon needs that ground opaque
await icon.evaluate(`document.documentElement.style.background = '#0b0a09';
  const s = document.querySelector('svg');
  if (s) { s.setAttribute('width', '180'); s.setAttribute('height', '180'); }
  document.body && (document.body.style.margin = '0'); true`);
await new Promise((r) => setTimeout(r, 300));
writeFileSync(`${outDir}/icon-180.png`, await png(icon));
console.log(`wrote ${outDir}/icon-180.png  180x180`);
icon.close();
process.exit(0);
