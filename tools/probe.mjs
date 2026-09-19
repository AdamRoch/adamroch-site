// Pixel probes for the homepage backdrop (no deps; headless Chrome over CDP).
//
//   node tools/probe.mjs --ground [url] [--x=0.5] [--y=0.96] [--patch=32] [--expect=#0b0a09]
//       Loads the lens (default: the harness in 404 mode, band off, text off), screenshots it,
//       takes the per-channel median of a patch (css px; x/y ≤ 1 are viewport fractions) and
//       asserts it equals the CSS --ground hex within 1/255. --expect defaults to the page's
//       own --ground (resolved through a 2D canvas, so oklch() works), else #0b0a09.
//       Prints the measured hex; exit 1 on a miss. Use it to set --ground on the page.
//
//   node tools/probe.mjs --contrast <url> [--sel='[data-lit]'] [--min=4.5] [--scrolls=0,900|anchors]
//       [--w=1600 --h=1000 --dpr=1 | --mobile] [--wait=3500] [--settle=900] [--reduced] [--large]
//       For every element matching --sel that has its own text (default: every element on
//       the page with a direct text node), reads its colour and client rects, then makes all
//       text transparent and screenshots the composited page (canvas, chips, everything),
//       and computes WCAG contrast of the text colour against (a) the mean background
//       luminance under the box and (b) the worst 5th percentile of per-pixel contrast.
//       Fails (exit 1) when any box's p5 contrast is under --min. --large applies the WCAG
//       large-text threshold of 3:1 to text ≥ 24px or ≥ 18.66px bold. --scrolls=anchors reads
//       the lens path's knot positions from the dev page (window.__lens, DEV builds only).
//
// Both modes take --w --h --dpr --mobile --reduced --wait like tools/shot.mjs.
// Exports decodePNG(), launch() and screenshot() for ad-hoc scripts.

import { spawnChrome } from './chrome-process.mjs';
import { inflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HARNESS = 'http://localhost:5173/.tmp/lens-harness.html';

/* ————— PNG decode: 8-bit RGB/RGBA, non-interlaced (what Chrome's captureScreenshot emits) ————— */

export function decodePNG(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG (depth ${depth}, colour type ${colorType}, interlace ${interlace})`);
  }
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[p++];
    for (let i = 0; i < stride; i++) {
      const x = raw[p + i];
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = x;
      if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
    p += stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = cur[x * ch];
      out[o + 1] = cur[x * ch + 1];
      out[o + 2] = cur[x * ch + 2];
      out[o + 3] = ch === 4 ? cur[x * ch + 3] : 255;
    }
    [prev, cur] = [cur, prev];
  }
  return { width, height, data: out };
}

/* ————— CDP ————— */

export async function launch({ W = 1600, H = 1000, DPR = 1, mobile = false, reduced = false } = {}) {
  const args = [
    '--headless=new',
    `--window-size=${W},${H}`,
    '--hide-scrollbars',
    '--remote-debugging-port=0',
    '--use-gl=angle',
    '--use-angle=metal',
    '--enable-unsafe-swiftshader',
    '--no-first-run',
    '--user-data-dir=/tmp/claude-probe-profile-' + process.pid,
    'about:blank',
  ];
  if (reduced) args.unshift('--force-prefers-reduced-motion');
  const chrome = spawnChrome(CHROME, args);
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let buf = '';
      chrome.stderr.on('data', (d) => {
        buf += d;
        const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) resolve(m[1]);
      });
      setTimeout(() => reject(new Error('no devtools ws')), 15000);
    });
    const httpBase = wsUrl.replace('ws://', 'http://').replace(/\/devtools\/.*$/, '');
    let target = null;
    for (let i = 0; i < 30 && !target; i++) {
      const list = await (await fetch(`${httpBase}/json`)).json();
      target = list.find((t) => t.type === 'page');
      if (!target) await new Promise((r) => setTimeout(r, 250));
    }
    if (!target) throw new Error('no page target');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let msgId = 0;
    const pending = new Map();
    const events = [];
    const consoleLines = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      } else if (m.method) {
        events.push(m.method);
        if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Runtime.exceptionThrown') {
          consoleLines.push(JSON.stringify(m.params).slice(0, 300));
        }
      }
    };
    const send = (method, params = {}) => {
      const id = ++msgId;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve) => pending.set(id, resolve));
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile });
    if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true });
    const evaluate = async (expression) => {
      const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 500));
      return res.result?.result?.value;
    };
    const goto = async (url, wait) => {
      await send('Page.navigate', { url });
      for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await new Promise((r) => setTimeout(r, 250));
      await new Promise((r) => setTimeout(r, wait));
    };
    const close = () => {
      ws.close();
      return chrome.close();
    };
    return { send, evaluate, goto, close, consoleLines, W, H, DPR };
  } catch (error) {
    await chrome.close();
    throw error;
  }
}

export async function screenshot(page) {
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  return decodePNG(Buffer.from(shot.result.data, 'base64'));
}

/* ————— colour maths ————— */

const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lum = (r, g, b) => 0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);
const contrast = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

// resolve any CSS colour (oklch, color-mix, var()) to [r, g, b, a] inside the page
const RESOLVE = `((css) => { const c = document.createElement('canvas'); c.width = c.height = 1;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data); })`;

/* ————— args ————— */

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(
  args
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.length ? v.join('=') : true];
    })
);
const mobile = Boolean(flags.mobile);
const view = {
  W: Number(flags.w ?? (mobile ? 390 : 1600)),
  H: Number(flags.h ?? (mobile ? 844 : 1000)),
  DPR: Number(flags.dpr ?? (mobile ? 2 : 1)),
  mobile,
  reduced: Boolean(flags.reduced),
};

/* ————— --ground ————— */

async function ground() {
  const url = positional[0] ?? `${HARNESS}?band=0&lock=1&text=0&arrive=0`;
  const page = await launch(view);
  try {
    await page.goto(url, Number(flags.wait ?? 2500));
    let expect = flags.expect;
    if (!expect) {
      const rgba = await page.evaluate(
        `(() => { const v = getComputedStyle(document.documentElement).getPropertyValue('--ground').trim(); return v ? ${RESOLVE}(v) : null; })()`
      );
      expect = rgba ? hex(rgba[0], rgba[1], rgba[2]) : '#0b0a09';
    }
    const fx = Number(flags.x ?? 0.5);
    const fy = Number(flags.y ?? 0.96);
    const cx = fx <= 1 ? fx * page.W : fx;
    const cy = fy <= 1 ? fy * page.H : fy;
    const patch = Number(flags.patch ?? 32);
    const img = await screenshot(page);
    await page.close();
    const chans = [[], [], []];
    const x0 = Math.max(0, Math.round((cx - patch / 2) * page.DPR));
    const y0 = Math.max(0, Math.round((cy - patch / 2) * page.DPR));
    const x1 = Math.min(img.width, Math.round((cx + patch / 2) * page.DPR));
    const y1 = Math.min(img.height, Math.round((cy + patch / 2) * page.DPR));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const o = (y * img.width + x) * 4;
        chans[0].push(img.data[o]);
        chans[1].push(img.data[o + 1]);
        chans[2].push(img.data[o + 2]);
      }
    const median = (a) => a.sort((p, q) => p - q)[a.length >> 1];
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const med = chans.map(median);
    const avg = chans.map(mean);
    const want = expect.replace('#', '').match(/../g).map((h) => parseInt(h, 16));
    const diff = med.map((v, i) => Math.abs(v - want[i]));
    const ok = Math.max(...diff) <= 1;
    console.log(
      `ground: measured ${hex(...med)} (median of ${x1 - x0}x${y1 - y0} device px at css ${Math.round(cx)},${Math.round(cy)}; mean ${hex(...avg)}) expected ${expect} → ${ok ? 'PASS' : 'FAIL'} (max channel diff ${Math.max(...diff)})`
    );
    if (page.consoleLines.length) console.log('console:', page.consoleLines.join('\n'));
    return ok ? 0 : 1;
  } finally {
    await page.close();
  }
}

/* ————— --contrast ————— */

const COLLECT = `((sel) => {
  const resolve = ${RESOLVE};
  const out = [];
  // text that has scrolled under the fixed bar is covered by its opaque pills, not lit by the canvas
  const bar = document.querySelector('.bar');
  const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
  for (const el of document.querySelectorAll(sel)) {
    const underBar = bar && !bar.contains(el);
    if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
    let hidden = false;
    for (let a = el.parentElement; a; a = a.parentElement) { const s = getComputedStyle(a); if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') { hidden = true; break; } }
    if (hidden) continue;
    // line boxes of the element's own text nodes: no padding, no rounded corners, no child text
    const rects = [];
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
    }
    // a line still parked in its pre-reveal from-state is clipped away by the split's mask:
    // its box is real but nothing is painted there, so it is not a contrast measurement
    let clip = null;
    for (let a = el.parentElement; a && !clip; a = a.parentElement) {
      if (getComputedStyle(a).overflow !== 'visible') clip = a.getBoundingClientRect();
    }
    const inView = rects.filter((r) => r.w > 0 && r.h > 0 && r.y < innerHeight && r.y + r.h > 0 && r.x < innerWidth && r.x + r.w > 0 && !(underBar && r.y < barBottom) && !(clip && (r.y + r.h <= clip.top + 1 || r.y >= clip.bottom - 1 || r.x + r.w <= clip.left + 1 || r.x >= clip.right - 1)));
    rects.length = 0;
    rects.push(...inView);
    if (!rects.length) continue;
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    out.push({
      label: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls,
      text: el.textContent.trim().replace(/\\s+/g, ' ').slice(0, 36),
      color: resolve(cs.color),
      size: parseFloat(cs.fontSize),
      bold: parseInt(cs.fontWeight, 10) >= 700,
      rects,
    });
  }
  return out;
})`;

// The glyphs go invisible through -webkit-text-fill-color, never through `color`: the page's
// band solver reads getComputedStyle(el).color to decide how bright the band may be, so
// blanking `color` would release every constraint it has and the screenshot would show a band
// no visitor ever sees. (It did: a re-measure landing inside this window reported 1.01:1
// against a full-gain band at a scroll where the real page measures 5.58:1.)
const HIDE_TEXT = `document.head.insertAdjacentHTML('beforeend', '<style id="__probe">*,*::before,*::after{-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;text-decoration-color:transparent!important}</style>'); true`;
const SHOW_TEXT = `document.getElementById('__probe')?.remove(); true`;

async function contrastMode() {
  const url = positional[0];
  if (!url) {
    console.error('usage: node tools/probe.mjs --contrast <url> [--sel=...] [--min=4.5]');
    process.exit(1);
  }
  const sel = String(flags.sel ?? '*');
  const min = Number(flags.min ?? 4.5);
  const settle = Number(flags.settle ?? 900);
  const page = await launch(view);
  try {
    await page.goto(url, Number(flags.wait ?? 3500));
    let scrolls;
    if (flags.scrolls === 'anchors') {
      scrolls = await page.evaluate('(window.__lens ? window.__lens.path.knots.map((k) => Math.round(k.s)) : null)');
      if (!scrolls) {
        console.error('--scrolls=anchors needs window.__lens (dev build of the homepage)');
        await page.close();
        return 1;
      }
      console.log('anchors:', scrolls.join(', '));
    } else scrolls = String(flags.scrolls ?? '0').split(',').map(Number);
    const rows = [];
    for (const sy of scrolls) {
      await page.evaluate(`window.scrollTo({ top: ${sy}, behavior: 'instant' }); true`);
      await new Promise((r) => setTimeout(r, settle));
      const boxes = await page.evaluate(`${COLLECT}(${JSON.stringify(sel)})`);
      await page.evaluate(HIDE_TEXT);
      await new Promise((r) => setTimeout(r, 120));
      const img = await screenshot(page);
      await page.evaluate(SHOW_TEXT);
      for (const b of boxes) {
        const [tr, tg, tb, ta] = b.color;
        const alpha = ta / 255;
        const samples = [];
        let sumL = 0;
        for (const r of b.rects) {
          const x0 = Math.max(0, Math.floor(r.x * page.DPR));
          const y0 = Math.max(0, Math.floor(r.y * page.DPR));
          const x1 = Math.min(img.width, Math.ceil((r.x + r.w) * page.DPR));
          const y1 = Math.min(img.height, Math.ceil((r.y + r.h) * page.DPR));
          const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 40000)));
          for (let y = y0; y < y1; y += step)
            for (let x = x0; x < x1; x += step) {
              const o = (y * img.width + x) * 4;
              samples.push([img.data[o], img.data[o + 1], img.data[o + 2]]);
            }
        }
        if (!samples.length) continue;
        const mean = [0, 0, 0];
        for (const s of samples) {
          mean[0] += s[0];
          mean[1] += s[1];
          mean[2] += s[2];
        }
        mean.forEach((v, i) => (mean[i] = v / samples.length));
        // text with alpha is composited over the mean background before its luminance is taken
        const text = alpha < 1 ? [tr, tg, tb].map((c, i) => c * alpha + mean[i] * (1 - alpha)) : [tr, tg, tb];
        const tl = lum(...text);
        const per = samples.map((s) => contrast(tl, lum(...s))).sort((p, q) => p - q);
        for (const s of samples) sumL += lum(...s);
        const avg = contrast(tl, sumL / samples.length);
        const p5 = per[Math.floor(per.length * 0.05)];
        const large = b.size >= 24 || (b.size >= 18.66 && b.bold);
        const threshold = flags.large && large ? 3 : min;
        rows.push({ scroll: sy, label: b.label, text: b.text, color: hex(tr, tg, tb), bg: hex(...mean), avg, p5, threshold, pass: p5 >= threshold });
      }
    }
    await page.close();
    rows.sort((a, b) => a.p5 - b.p5);
    for (const r of rows) {
      console.log(
        `${r.pass ? 'ok  ' : 'FAIL'} ${r.p5.toFixed(2).padStart(6)}:1 p5  ${r.avg.toFixed(2).padStart(6)}:1 avg  ${r.color} on ~${r.bg}  y=${r.scroll}  ${r.label}  "${r.text}"`
      );
    }
    const fails = rows.filter((r) => !r.pass).length;
    console.log(`contrast: ${rows.length} text boxes, ${fails} under ${min}:1${flags.large ? ' (3:1 for large text)' : ''} → ${fails ? 'FAIL' : 'PASS'}`);
    if (page.consoleLines.length) console.log('console:', page.consoleLines.join('\n'));
    return fails ? 1 : 0;
  } finally {
    await page.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (flags.ground) process.exit(await ground());
  else if (flags.contrast) process.exit(await contrastMode());
  else {
    console.error('usage: node tools/probe.mjs --ground [url] | --contrast <url> [flags]  (see header)');
    process.exit(1);
  }
}
