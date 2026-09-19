// CDP screenshot driver (no deps). Captures a page at one or more scroll depths.
// Usage:
//   node shot.mjs <url> <outPrefix> [--w=1600] [--h=1000] [--dpr=1] [--mobile]
//        [--theme=dark|light] [--scrolls=0,1200,2400 | --frac=0,25,50,75,100] [--wait=4500]
//        [--reduced] [--settle=900] [--full] [--nogl] [--hover=<selector>] [--click=<selector>]
//        [--pointer=x,y]
// --nogl makes HTMLCanvasElement.getContext return null for webgl/webgl2 before any page
// script runs, so the page's no-WebGL fallback can be photographed.
// --frac scrolls to percentages of the page's scroll range instead of pixel depths.
// --hover / --click move the mouse to (and press) the centre of the first element matching the
// selector after each scroll, before the settle; --pointer parks the mouse at viewport px.
// Writes <outPrefix>-<scrollY>.png (or -p<frac>.png with --frac, -full.png with --full).
import { spawnChrome } from './chrome-process.mjs';
import { writeFileSync } from 'node:fs';

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
const [url, outPrefix] = positional;
if (!url || !outPrefix) {
  console.error('usage: node shot.mjs <url> <outPrefix> [flags]');
  process.exit(1);
}
const mobile = Boolean(flags.mobile);
const W = Number(flags.w ?? (mobile ? 390 : 1600));
const H = Number(flags.h ?? (mobile ? 844 : 1000));
const DPR = Number(flags.dpr ?? (mobile ? 2 : 1));
const WAIT = Number(flags.wait ?? 4500);
const SETTLE = Number(flags.settle ?? 900);
const scrolls = String(flags.scrolls ?? '0').split(',').map(Number);
const fracs = flags.frac ? String(flags.frac).split(',').map(Number) : null;
const theme = flags.theme ? String(flags.theme) : null;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const chromeArgs = [
  '--headless=new',
  `--window-size=${W},${H}`,
  '--hide-scrollbars',
  '--remote-debugging-port=0',
  '--use-gl=angle',
  '--use-angle=metal',
  '--enable-unsafe-swiftshader',
  '--no-first-run',
  '--user-data-dir=/tmp/claude-shot-profile-' + process.pid,
  'about:blank',
];
if (flags.reduced) chromeArgs.unshift('--force-prefers-reduced-motion');
const chrome = spawnChrome(CHROME, chromeArgs);

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
        consoleLines.push(JSON.stringify(m.params).slice(0, 400));
      }
    }
  };
  function send(method, params = {}) {
    const id = ++msgId;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => pending.set(id, resolve));
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: W,
    height: H,
    deviceScaleFactor: DPR,
    mobile,
  });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  if (theme) {
    // seed the theme before the page's inline script reads it
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try{localStorage.setItem('adam-theme','${theme}')}catch{}`,
    });
  }
  if (flags.nogl) {
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => { const g = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (t, ...a) {
          if (t === 'webgl' || t === 'webgl2' || t === 'experimental-webgl') return null;
          return g.call(this, t, ...a); }; })();`,
    });
  }
  await send('Page.navigate', { url });
  for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) {
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, WAIT));

  if (flags.full) {
    const { result } = await send('Runtime.evaluate', {
      expression: 'document.documentElement.scrollHeight',
      returnByValue: true,
    });
    const fullH = Math.min(result.result.value, 20000);
    await send('Emulation.setDeviceMetricsOverride', {
      width: W,
      height: fullH,
      deviceScaleFactor: DPR,
      mobile,
    });
    await new Promise((r) => setTimeout(r, SETTLE));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const out = `${outPrefix}-full.png`;
    writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
    console.log('wrote', out, `(${W}x${fullH})`);
  } else {
    const centre = async (sel) => {
      const { result } = await send('Runtime.evaluate', {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null;
          const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`,
        returnByValue: true,
      });
      return result.result.value;
    };
    const mouse = (type, x, y, extra = {}) =>
      send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1, ...extra });
    const steps = fracs ? fracs.map((f) => ({ label: `p${f}`, frac: f })) : scrolls.map((y) => ({ label: String(y), y }));
    for (const step of steps) {
      const expr = step.frac !== undefined
        ? `window.scrollTo({top: Math.round((document.documentElement.scrollHeight - innerHeight) * ${step.frac} / 100), behavior: 'instant'})`
        : `window.scrollTo({top: ${step.y}, behavior: 'instant'})`;
      await send('Runtime.evaluate', { expression: expr });
      // let the scroll commit before hit-testing a synthetic pointer against it
      if (flags.pointer || flags.hover || flags.click) await new Promise((r) => setTimeout(r, 200));
      if (flags.pointer) {
        const [px, py] = String(flags.pointer).split(',').map(Number);
        await mouse('mouseMoved', px, py);
      }
      if (flags.hover) {
        const c = await centre(String(flags.hover));
        if (c) await mouse('mouseMoved', c[0], c[1]);
        else console.log('hover: no element for', flags.hover);
      }
      if (flags.click) {
        const c = await centre(String(flags.click));
        if (c) {
          await mouse('mouseMoved', c[0], c[1]);
          await mouse('mousePressed', c[0], c[1]);
          await mouse('mouseReleased', c[0], c[1]);
        } else console.log('click: no element for', flags.click);
      }
      await new Promise((r) => setTimeout(r, SETTLE));
      if (flags.hover) {
        const { result } = await send('Runtime.evaluate', {
          expression: `Array.from(document.querySelectorAll(':hover')).map((e) => e.tagName.toLowerCase() + (e.dataset.lab ? '[' + e.dataset.lab + ']' : '')).slice(-4).join(' > ') + ' @' + scrollY`,
          returnByValue: true,
        });
        console.log('hover chain:', result.result.value);
      }
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const out = `${outPrefix}-${step.label}.png`;
      writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
      console.log('wrote', out);
    }
  }
  if (consoleLines.length) {
    console.log('--- console ---');
    for (const l of consoleLines) console.log(l);
  }

  ws.close();
} finally {
  await chrome.close();
}
process.exit(0);
