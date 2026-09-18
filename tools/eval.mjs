// CDP evaluator (no deps). Loads a URL in headless Chrome and prints the JSON
// result of an expression evaluated in the page (awaited if it returns a promise).
// Usage: node tools/eval.mjs <url> '<expression>' [--w=1600] [--h=1000] [--dpr=1]
//        [--mobile] [--wait=1500] [--reduced]
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(
  args
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v === undefined ? true : v];
    })
);
const [url, expression] = positional;
if (!url || !expression) {
  console.error("usage: node tools/eval.mjs <url> '<expression>' [flags]");
  process.exit(1);
}
const mobile = Boolean(flags.mobile);
const W = Number(flags.w ?? (mobile ? 390 : 1600));
const H = Number(flags.h ?? (mobile ? 844 : 1000));
const DPR = Number(flags.dpr ?? (mobile ? 2 : 1));
const WAIT = Number(flags.wait ?? 1500);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const chromeArgs = [
  '--headless=new',
  `--window-size=${W},${H}`,
  '--remote-debugging-port=0',
  '--use-gl=angle',
  '--use-angle=metal',
  '--no-first-run',
  '--user-data-dir=/tmp/claude-eval-profile-' + process.pid,
  'about:blank',
];
if (flags.reduced) chromeArgs.unshift('--force-prefers-reduced-motion');
const chrome = spawn(CHROME, chromeArgs);

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
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let msgId = 0;
const pending = new Map();
const events = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else if (m.method) events.push(m.method);
};
const send = (method, params = {}) => {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
};
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile });
await send('Page.navigate', { url });
for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await new Promise((r) => setTimeout(r, 250));
await new Promise((r) => setTimeout(r, WAIT));
const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
if (res.result?.exceptionDetails) console.error(JSON.stringify(res.result.exceptionDetails, null, 1));
else console.log(JSON.stringify(res.result?.result?.value, null, 1));
ws.close();
chrome.kill();
process.exit(0);
