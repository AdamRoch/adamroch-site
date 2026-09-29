// Door-ring check for the homepage lens (dev server: it reads window.__lens).
//   node tools/rings.mjs [url]
// Parks the pointer mid-page and wheel-scrolls through the index. Browsers fire pointerover for
// rows that slide under a still pointer; none of them may light a door, so no frame may carry
// more than the primary mass. Then a real move onto a row must light its door. Exit 1 on a miss.
import { launch } from './probe.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await launch({ W: 1440, H: 900 });
let fails = 0;
try {
  await page.goto(url, 2000);
  for (let i = 0; i < 40 && !(await page.evaluate(`document.documentElement.classList.contains('gl-ready')`)); i++) await sleep(250);
  // the most masses live on any one frame (thetaE above 0.005)
  await page.evaluate(`(() => { const u = window.__lens.lens.debug.uniforms; window.__most = 0;
    const tick = () => { window.__most = Math.max(window.__most, u.uMass.value.filter((m) => m.z > 2.5e-5).length); requestAnimationFrame(tick); };
    requestAnimationFrame(tick); })()`);
  const mouse = (type, x, y, extra = {}) => page.send('Input.dispatchMouseEvent', { type, x, y, button: 'none', ...extra });
  await mouse('mouseMoved', 1100, 450);
  for (let i = 0; i < 60; i++) {
    await mouse('mouseWheel', 1100, 450, { deltaX: 0, deltaY: 40 });
    await sleep(30);
  }
  await sleep(1500);
  const most = await page.evaluate('window.__most');
  console.log(most === 1 ? 'PASS' : 'FAIL', `scrolling under a still pointer: at most ${most} mass(es) live, want 1`);
  if (most !== 1) fails++;

  await page.evaluate(`document.querySelector('.row').scrollIntoView({ block: 'center', behavior: 'instant' })`);
  await sleep(800);
  await mouse('mouseMoved', 1103, 452);
  await sleep(1200);
  const te = await page.evaluate(`Math.sqrt(Math.max(...window.__lens.lens.debug.uniforms.uMass.value.slice(1).map((m) => m.z)))`);
  console.log(te > 0.08 ? 'PASS' : 'FAIL', `a real move onto a row lights its door: thetaE ${te.toFixed(3)}, want > 0.08`);
  if (te <= 0.08) fails++;
} finally {
  await page.close();
}
process.exitCode = fails ? 1 : 0;
