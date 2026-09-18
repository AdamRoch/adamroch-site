/* ————— the scroll path: where the lens rests, and how it gets there ————— */
// Anchors are the four serif accents ([data-anchor]) and the five row doors. Each resolves
// to a document-space point beside its word: 0.5 em past the line end if there is room,
// else in the margin beside the block (nudged up or down a little if that clears), else
// above the block. "Room" means the ring, plus a fifth of its radius, touches no text.
// Knot i is in place at scroll s_i = docY_i - vh * f_i; between knots the primary rides a
// centripetal Catmull-Rom through (x, y, r) so it never overshoots a word.
//
// The band horizon is solved per knot too: it wants a preferred height (0.42 hero, 0.36
// index head, 0.22 doors, 0.12 manifesto, 0.30 footer) and takes the nearest strip where no
// text would sit on it. How far the band must stay from a run of text follows from that
// text's own luminance (mute mono needs ~110 px at full gain; ink needs ~30), so the band
// is also dimmed through the index, where the rows leave no room for it at full strength.
//
// The horizon sits still in the viewport while the page scrolls, so every run of text crosses
// it between one rest and the next. The gain is therefore an envelope, not a per-knot number:
// solveEnvelope walks the whole scroll range and keeps, at each step, the brightest gain that
// still clears every run there. The band blooms at the rests and fades while the page travels.
// The mass recedes on the same principle: thetaE dips mid-segment, and the further it has to
// travel the deeper the dip, so its limb never parks on a word it is passing.
//
// Layout is read only in refresh() (resize, fonts, reveal splits, ScrollTrigger refresh),
// never in the frame loop; sample() is arithmetic on the cached knots.

import type { LensMass } from './gl';
import { agx } from './agx';

export interface Knot {
  id: string;
  s: number; // scrollY at which the anchor is in place
  x: number; // document px
  y: number; // document px
  te: number; // thetaE, units of min(vw, vh)
  hz: number; // band horizon, viewport UV y
  gain: number; // band gain multiplier 0..1
  bx: number; // detour, document px, applied as a sin(pi u) bump over the segment that starts here
  by: number;
}

export interface PathSample {
  x: number; // viewport UV
  y: number;
  thetaE: number;
  horizon: number;
  gain: number;
}

export interface LensPath {
  readonly knots: Knot[];
  refresh(): void; // re-measure on the next frame
  sample(scrollY: number, out: PathSample): void;
  rules(scrollY: number): { ys: number[]; x: [number, number] };
  doorMass(row: HTMLElement, scrollY: number, thetaE: number): LensMass;
  destroy(): void;
}

export interface PathOptions {
  onMeasure?: () => void; // after every re-measure (not the first, synchronous one)
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  el: Element | null;
  lum: number; // relative luminance of the text colour
  large: boolean; // WCAG large text (>= 24px, or >= 18.66px bold): 3:1, not 4.5:1
  fades: boolean; // hero cue / HUD: gone once the page has scrolled
}

const PHONE = '(max-width: 700px)';
const SKIP = 'dialog, .bar, .skip, .nogl-ring, script, style, [hidden]';
const FADES = '.cue, .hud';
const TE = { hero: 0.11, lab: 0.1, door: 0.06, site: 0.1, contact: 0.19, contactPhone: 0.16 };
// Desktop rest of the footer ring, as a fraction of the viewport width. Right of centre so
// the statement reads beside the ring rather than inside it: a centred ring with display
// type inside it is Event Horizon's own hero, and the front door should not repeat the
// flagship (ADR 0002 addendum).
const CONTACT_X = 0.7;
const HZ = { hero: 0.42, lab: 0.36, door: 0.22, site: 0.12, contact: 0.3 };
// The index is the one band of the page where mute mono text repeats every ~160 px, so the
// band's ceiling there is set by legibility, not by taste: --mute has ~5.8:1 of headroom on
// bare ground and a lensed filament arc eats most of it. Keep door gain low enough that the
// contrast gate passes at 2560 too, where the arcs are widest.
const GAIN = { hero: 1, lab: 0.85, door: 0.12, site: 0.85, contact: 1 };
const F = { lab: 0.42, door: 0.5, site: 0.42 };
const PAD = 0.2; // collision radius = r * (1 + PAD)
// How far thetaE recedes mid-transit. Deeper on the short hops between doors, where the
// label sits inside the ring at rest and the limb would otherwise cross the next one on the
// way down; a long crossing keeps more of its presence because it lasts.
const DIP_SHORT = 0.75;
const DIP_LONG = 0.45;
const SCAN = 30; // px of scroll between band-gain samples
const LADDER = [1, 0.85, 0.7, 0.55, 0.42, 0.32, 0.24, 0.17, 0.11, 0.06, 0]; // gain envelope steps
const EDGE = 0.02; // the ring must stay this far (of vw) inside the viewport sides
const BAND_W = 0.035; // the shader's envelope width, short-side units
// the brightest filament, linear, at gain 1: the shader's band colour × BAND_GAIN at the
// filament term's ceiling (smoothstep(0.42, 0.9, fbm) and `along` both reach 1, and the
// lensed counter-image keeps that surface brightness wherever it lands)
const BAND_LIN = [2.2 * 0.45, 0.9 * 0.45, 0.35 * 0.45];
const FLOOR_LIN = [0.00725, 0.00688, 0.00644]; // the solved ambient floor (#0b0a09)

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const softClamp = (v: number, lo: number, hi: number, k = 0.04): number => {
  if (v < lo) return lo - k * (1 - Math.exp(-(lo - v) / k));
  if (v > hi) return hi + k * (1 - Math.exp(-(v - hi) / k));
  return v;
};

/* ————— geometry ————— */

// computed colours come back in their own space (oklch, color-mix); a 2D canvas resolves
// any of them to sRGB. Cached per string: the page has a handful of text colours.
const lumCache = new Map<string, number>();
let resolver: CanvasRenderingContext2D | null | undefined;
function luminance(css: string): number {
  let l = lumCache.get(css);
  if (l !== undefined) return l;
  if (resolver === undefined) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    resolver = c.getContext('2d', { willReadFrequently: true });
  }
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  l = 0.5;
  if (resolver) {
    resolver.clearRect(0, 0, 1, 1);
    resolver.fillStyle = css;
    resolver.fillRect(0, 0, 1, 1);
    const d = resolver.getImageData(0, 0, 1, 1).data;
    const a = d[3] / 255;
    l = a * (0.2126 * lin(d[0] / 255) + 0.7152 * lin(d[1] / 255) + 0.0722 * lin(d[2] / 255));
  }
  lumCache.set(css, l);
  return l;
}

function collectText(sy: number): Rect[] {
  const out: Rect[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.nodeValue && n.nodeValue.trim() && !n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    range.selectNodeContents(n);
    let lum = -1;
    let large = false;
    for (const r of range.getClientRects()) {
      if (r.width <= 0 || r.height <= 0) continue;
      if (lum < 0) {
        const cs = el ? getComputedStyle(el) : null;
        lum = cs ? luminance(cs.color) : 0.5;
        const size = cs ? parseFloat(cs.fontSize) || 16 : 16;
        const bold = cs ? Number(cs.fontWeight) >= 700 : false;
        large = size >= 24 || (bold && size >= 18.66);
      }
      out.push({ x0: r.left, y0: r.top + sy, x1: r.right, y1: r.bottom + sy, el, lum, large, fades: !!el?.closest(FADES) });
    }
  }
  return out;
}

function docRect(el: Element, sy: number): Rect {
  const r = el.getBoundingClientRect();
  return { x0: r.left, y0: r.top + sy, x1: r.right, y1: r.bottom + sy, el, lum: 0, large: false, fades: false };
}

// how far a circle pushes into a rect (0 when clear)
function penetration(cx: number, cy: number, R: number, r: Rect): number {
  const dx = Math.max(r.x0 - cx, 0, cx - r.x1);
  const dy = Math.max(r.y0 - cy, 0, cy - r.y1);
  const d = Math.hypot(dx, dy);
  return d < R ? R - d : 0;
}

function score(cx: number, cy: number, R: number, texts: Rect[], vw: number): number {
  let s = 0;
  for (const t of texts) s += penetration(cx, cy, R, t);
  const left = cx - R - EDGE * vw;
  const right = vw - EDGE * vw - (cx + R);
  if (left < 0) s -= left;
  if (right < 0) s -= right;
  return s;
}

// The bright part of a mass is its photon ring, not its interior: a door label at the centre
// sits in the dark, and the same label a radius away is on the limb. This is what the detour
// search minimises — how much text the limb passes through, weighted so 100 px display ink
// costs a third of 11 px mono.
function limbScore(cx: number, cy: number, r: number, texts: Rect[], vw: number): number {
  const half = Math.max(18, 0.3 * r); // core plus wings plus their glow, css px
  const lo = r - half;
  const hi = r + half;
  let s = 0;
  for (const t of texts) {
    const dx = Math.max(t.x0 - cx, 0, cx - t.x1);
    const dy = Math.max(t.y0 - cy, 0, cy - t.y1);
    const near = Math.hypot(dx, dy);
    if (near > hi) continue;
    const far = Math.hypot(Math.max(Math.abs(cx - t.x0), Math.abs(cx - t.x1)), Math.max(Math.abs(cy - t.y0), Math.abs(cy - t.y1)));
    const overlap = Math.min(far, hi) - Math.max(near, lo);
    if (overlap > 0) s += overlap * (t.large ? 0.3 : 1);
  }
  const left = cx - r - EDGE * vw;
  const right = vw - EDGE * vw - (cx + r);
  if (left < 0) s -= left;
  if (right < 0) s -= right;
  return s;
}

/* ————— the ring resolver ————— */

interface Ctx {
  sy: number;
  vw: number;
  vh: number;
  S: number;
  texts: Rect[];
}

function resolveAccent(accent: HTMLElement, block: HTMLElement, r: number, c: Ctx, aboveFirst = false): { x: number; y: number } {
  const A = docRect(accent, c.sy);
  const em = parseFloat(getComputedStyle(accent).fontSize) || 16;
  const inBlock = c.texts.filter((t) => t.el && block.contains(t.el));
  const cy = (A.y0 + A.y1) / 2;
  const line = inBlock.filter((t) => (t.y0 + t.y1) / 2 >= A.y0 && (t.y0 + t.y1) / 2 <= A.y1);
  const lineEnd = line.reduce((m, t) => Math.max(m, t.x1), A.x1);
  const blockRight = inBlock.reduce((m, t) => Math.max(m, t.x1), A.x1);
  const blockLeft = inBlock.reduce((m, t) => Math.min(m, t.x0), A.x0);
  const blockTop = inBlock.reduce((m, t) => Math.min(m, t.y0), A.y0);
  const R = r * (1 + PAD);

  const candidates: { x: number; y: number }[] = [];
  // 1. past the line end
  candidates.push({ x: lineEnd + 0.5 * em + r, y: cy });
  // 2. the margin beside the block, nudged a little if that clears
  const mx = blockRight + 0.5 * em + r;
  for (const k of [0, -0.25, -0.5, 0.25, 0.5]) candidates.push({ x: mx, y: cy + k * r });
  // 3. above the block, flush with its right edge, midway to whatever text sits above
  const ax = Math.max(blockLeft + r, blockRight - 1.25 * r);
  let ceiling = -Infinity;
  for (const t of c.texts) {
    if (t.y1 <= blockTop && t.x1 > ax - R && t.x0 < ax + R) ceiling = Math.max(ceiling, t.y1);
  }
  if (ceiling === -Infinity) ceiling = blockTop - 3 * r;
  const above = { x: ax, y: Math.min((ceiling + blockTop) / 2, blockTop - 1.3 * r) };
  // the hero's ring belongs in the negative space above the headline (the reference frame),
  // so there the order is above, then past the line, then the margin
  if (aboveFirst) candidates.unshift(above);
  else candidates.push(above);

  let best = candidates[0];
  let bestScore = Infinity;
  for (const cand of candidates) {
    const s = score(cand.x, cand.y, R, c.texts, c.vw);
    if (s === 0) return cand;
    if (s < bestScore) {
      bestScore = s;
      best = cand;
    }
  }
  return best;
}

// One column for all five doors: the x nearest the door labels whose disc holds no text and
// whose limb crosses none, at every row. Resting ON the label reads beautifully at the knot
// but forces the limb across it on the way to the next row (the label starts inside the ring
// and ends outside it, so the limb has to pass through it), which measures 1.2:1 at every
// desktop width. One shared column also means the ring glides straight down the index instead
// of hopping sideways. Phones have no label: 0.5 em past the title's line end, as before.
function solveDoorColumn(rows: HTMLElement[], r: number, c: Ctx): number | null {
  const ys: number[] = [];
  let prefer = 0;
  for (const row of rows) {
    const door = row.querySelector<HTMLElement>('.row-door');
    const D = door ? docRect(door, c.sy) : null;
    if (!D || D.x1 <= D.x0) return null;
    ys.push((D.y0 + D.y1) / 2);
    prefer += (D.x0 + D.x1) / 2;
  }
  if (!ys.length) return null;
  prefer /= ys.length;
  // The ring's Moffat wings carry real light well past its limb, and the index is the one
  // place on the page where 11 px mute mono sits at the ring's own height for five rows
  // running. Score the door column against the glow, not just the disc, or the column lands
  // close enough to wash the OPEN labels (measured 1.9:1 at 2560 with the disc radius alone).
  const R = r * (1 + PAD) * 1.8;
  const cost = (x: number): number => {
    let s = 0;
    for (const y of ys) s += score(x, y, R, c.texts, c.vw) + limbScore(x, y, r, c.texts, c.vw);
    return s;
  };
  let best = prefer;
  let bestCost = cost(prefer);
  if (bestCost <= 0) return best;
  for (let x = (0.06 + EDGE) * c.vw; x <= (0.94 - EDGE) * c.vw; x += 8) {
    const sc = cost(x);
    if (sc < bestCost - 0.5 || (sc <= 0.5 && bestCost <= 0.5 && Math.abs(x - prefer) < Math.abs(best - prefer))) {
      bestCost = sc;
      best = x;
    }
  }
  return best;
}

function resolveDoor(row: HTMLElement, r: number, c: Ctx): { x: number; y: number } {
  const door = row.querySelector<HTMLElement>('.row-door');
  const D = door ? docRect(door, c.sy) : null;
  if (D && D.x1 > D.x0) return { x: (D.x0 + D.x1) / 2, y: (D.y0 + D.y1) / 2 };
  const title = row.querySelector<HTMLElement>('.row-title') ?? row;
  const T = docRect(title, c.sy);
  const em = parseFloat(getComputedStyle(title).fontSize) || 16;
  const lineEnd = c.texts.filter((t) => t.el && title.contains(t.el)).reduce((m, t) => Math.max(m, t.x1), T.x0);
  return { x: lineEnd + 0.5 * em + r, y: (T.y0 + T.y1) / 2 };
}

/* ————— the band solver ————— */

// luminance the band's brightest filament shows at `env` (0..1 of its envelope) and `gain`,
// through the same AgX + sRGB the shader applies (the tone curve flattens the top, so the
// visible band is far wider than the linear envelope suggests)
function bandLum(env: number, gain: number): number {
  const c = agx([
    FLOOR_LIN[0] + BAND_LIN[0] * gain * env,
    FLOOR_LIN[1] + BAND_LIN[1] * gain * env,
    FLOOR_LIN[2] + BAND_LIN[2] * gain * env,
  ]);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

// distance the horizon must keep from text of luminance `lum` (0..1) for its WCAG ratio
// (4.5:1, or 3:1 for large text) to hold against the band at `gain`, in units of the envelope
// width; bisected, cached per triple
const clearCache = new Map<string, number>();
function clearance(lum: number, gain: number, w: number, large = false): number {
  const key = `${lum.toFixed(3)}|${gain.toFixed(3)}|${large ? 1 : 0}`;
  let units = clearCache.get(key);
  if (units === undefined) {
    const bgMax = (lum + 0.05) / (large ? 3 : 4.5) - 0.05;
    if (bandLum(0, gain) > bgMax) units = Infinity;
    else if (bandLum(1, gain) <= bgMax) units = 0;
    else {
      let lo = 0;
      let hi = 14;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (bandLum(Math.exp(-mid), gain) > bgMax) lo = mid;
        else hi = mid;
      }
      units = hi;
    }
    clearCache.set(key, units);
  }
  // the filaments have a bright tail past the envelope: a margin over the model, measured
  // back from the contrast probe rather than derived
  return units * w * 1.45;
}

interface Mass {
  x: number; // viewport px
  y: number;
  r: number; // Einstein radius, px
}

// Can the band sit at viewport y `yh` with no text on it? Two tests per run of text: the
// flat band far from the mass, and the band's lensed image near it. A source line at signed
// offset b from the mass images to an arc that reaches (b + sqrt(b² + 4r²)) / 2 from the
// centre on the band's own side (its outer arc), and (sqrt(b² + 4r²) - b) / 2 on the other
// side (the counter-image, bright only when |b| < r). Text within 2.5 r of the mass
// horizontally must clear those arcs too; their tails are the band's tail compressed by
// the lens (dθ/dβ on each side).
interface Run {
  y0: number; // viewport px at the knot's scroll
  y1: number;
  lum: number; // the text's own luminance (the clearance depends on it and on the gain)
  large: boolean;
  d: number; // clearance the band must keep from this run
  near: boolean; // within the ring's horizontal reach
  label: string;
}

// the text runs that matter for one knot at one gain, in that knot's viewport space. `pad`
// widens each run so one sample also answers for the scroll positions either side of it.
function runsFor(s: number, gain: number, m: Mass, c: Ctx, pad = 0): Run[] {
  const w = BAND_W * c.S;
  const fadesGone = s > 120;
  const out: Run[] = [];
  for (const t of c.texts) {
    if (t.fades && fadesGone) continue;
    const y0 = t.y0 - s - pad;
    const y1 = t.y1 - s + pad;
    if (y1 < -c.vh || y0 > 2 * c.vh) continue;
    const d = clearance(t.lum, gain, w, t.large);
    if (d === Infinity) continue; // hopeless against the bare floor, whatever the band does
    const dx = Math.max(t.x0 - m.x, 0, m.x - t.x1);
    out.push({ y0, y1, lum: t.lum, large: t.large, d, near: dx < 2.5 * m.r, label: import.meta.env.DEV ? `${t.el?.tagName}.${t.el?.className} "${t.el?.textContent?.trim().slice(0, 24)}"` : '' });
  }
  return out;
}

// re-price one built set of runs at another gain (a handful of distinct text colours)
function regain(runs: Run[], gain: number, S: number): void {
  const w = BAND_W * S;
  const memo = new Map<number, number>();
  for (const t of runs) {
    const key = t.large ? -t.lum - 1 : t.lum;
    let d = memo.get(key);
    if (d === undefined) {
      d = clearance(t.lum, gain, w, t.large);
      memo.set(key, d);
    }
    t.d = d;
  }
}

function feasible(yh: number, m: Mass, runs: Run[], why?: string[]): boolean {
  const b = yh - m.y;
  const ab = Math.abs(b);
  const sq = Math.sqrt(ab * ab + 4 * m.r * m.r);
  const dir = b < 0 ? -1 : 1;
  const yFar = m.y + dir * ((ab + sq) / 2);
  const yNear = m.y - dir * ((sq - ab) / 2);
  const farLo = Math.min(yh, yFar);
  const farHi = Math.max(yh, yFar);
  const kFar = 0.5 * (1 + ab / sq);
  const kNear = 0.5 * (1 - ab / sq);
  const nearOn = ab < m.r;
  for (const t of runs) {
    if (t.d === Infinity) continue;
    const block = (how: string): boolean => {
      if (!why) return false;
      why.push(`${how} ${t.label} y=${Math.round(t.y0)}..${Math.round(t.y1)} d=${Math.round(t.d)}`);
      return true;
    };
    // d = 0 means the band is dim enough to pass the ratio even directly behind this run,
    // so it may cross it; anything above 0 is a distance the band has to keep
    if (t.d <= 0) continue;
    if (t.y0 - t.d < yh && yh < t.y1 + t.d && !block('flat')) return false;
    if (t.near) {
      const df = t.d * kFar;
      if (t.y0 - df < farHi && farLo < t.y1 + df && !block(`arc[${Math.round(farLo)}..${Math.round(farHi)}]`)) return false;
      const dn = t.d * kNear;
      if (nearOn && t.y0 - dn < yNear && yNear < t.y1 + dn && !block(`near[${Math.round(yNear)}]`)) return false;
    }
  }
  return !why || why.length === 0;
}

// one horizon for a group of knots (the five doors share one, so the band does not swing
// row to row): the nearest height to `want` that is feasible at every knot, stepping the
// gain down until one exists. Grid search, 2 px.
function solveBand(want: number, gain: number, group: Knot[], c: Ctx): { hz: number; gain: number } {
  const lo = 0.05 * c.vh;
  const hi = 0.95 * c.vh;
  const target = want * c.vh;
  const masses = group.map((k) => ({ s: k.s, m: { x: k.x, y: k.y - k.s, r: k.te * c.S } as Mass }));
  for (const g of [gain, Math.min(gain, 0.5), Math.min(gain, 0.2), 0.1]) {
    const sets = masses.map(({ s, m }) => ({ m, runs: runsFor(s, g, m, c) }));
    let best: number | null = null;
    for (let y = lo; y <= hi; y += 2) {
      if (best !== null && Math.abs(y - target) >= Math.abs(best - target)) continue;
      if (sets.every(({ m, runs }) => feasible(y, m, runs))) best = y;
    }
    if (best !== null) return { hz: best / c.vh, gain: g };
  }
  return { hz: want, gain: 0.05 };
}

/* ————— centripetal Catmull-Rom ————— */

type P = [number, number, number];

function crSegment(p0: P, p1: P, p2: P, p3: P, u: number, out: P): void {
  const dist = (a: P, b: P): number => Math.pow(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), 0.5);
  const t0 = 0;
  const t1 = t0 + Math.max(dist(p0, p1), 1e-3);
  const t2 = t1 + Math.max(dist(p1, p2), 1e-3);
  const t3 = t2 + Math.max(dist(p2, p3), 1e-3);
  const t = t1 + u * (t2 - t1);
  for (let i = 0; i < 3; i++) {
    const a1 = ((t1 - t) / (t1 - t0)) * p0[i] + ((t - t0) / (t1 - t0)) * p1[i];
    const a2 = ((t2 - t) / (t2 - t1)) * p1[i] + ((t - t1) / (t2 - t1)) * p2[i];
    const a3 = ((t3 - t) / (t3 - t2)) * p2[i] + ((t - t2) / (t3 - t2)) * p3[i];
    const b1 = ((t2 - t) / (t2 - t0)) * a1 + ((t - t0) / (t2 - t0)) * a2;
    const b2 = ((t3 - t) / (t3 - t1)) * a2 + ((t - t1) / (t3 - t1)) * a3;
    out[i] = ((t2 - t) / (t2 - t1)) * b1 + ((t - t1) / (t2 - t1)) * b2;
  }
}

/* ————— the path ————— */

export function createPath(opts: PathOptions = {}): LensPath {
  const html = document.documentElement;
  const knots: Knot[] = [];
  const pts: P[] = []; // (x, y, r px) per knot, for the spline metric
  let vw = 1;
  let vh = 1;
  let S = 1;
  let ruleYs: number[] = [];
  let ruleX: [number, number] = [0, 1];
  const doors = new Map<HTMLElement, { x: number; y: number }>();
  const tmp: P = [0, 0, 0];
  let lastCtx: Ctx | null = null;
  let env: Float32Array | null = null; // band gain per SCAN px of scroll, from knots[0].s

  // solve=false keeps each knot's preferred horizon and gain (right for the hero at scroll 0)
  // so the first, synchronous measure stays cheap; the band solve follows at idle.
  function measure(solve = true): void {
    // the canvas's own box (position:fixed; inset:0), which excludes any scrollbar gutter:
    // gl.ts measures the same one, so a knot's UV lands where the word is
    vw = document.documentElement.clientWidth || window.innerWidth;
    vh = document.documentElement.clientHeight || window.innerHeight;
    S = Math.min(vw, vh);
    const sy = window.scrollY;
    const maxScroll = Math.max(0, html.scrollHeight - vh);
    const phone = matchMedia(PHONE).matches;
    knots.length = 0;
    pts.length = 0;
    doors.clear();

    // transforms off while we read: the masked line reveals must not shift the words
    html.classList.add('measuring');
    try {
      const c: Ctx = { sy, vw, vh, S, texts: collectText(sy) };
      lastCtx = c;
      const accent = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-anchor="${name}"]`);
      const block = (el: HTMLElement): HTMLElement => el.closest<HTMLElement>('h1, h2, h3, p') ?? el;
      const push = (id: string, s: number, p: { x: number; y: number }, te: number, hz: number, gain: number): void => {
        knots.push({ id, s, x: p.x, y: p.y, te, hz, gain, bx: 0, by: 0 });
      };

      const hero = accent('hero');
      if (hero) push('hero', 0, resolveAccent(hero, block(hero), TE.hero * S, c, true), TE.hero, HZ.hero, GAIN.hero);
      const lab = accent('lab');
      if (lab) {
        const p = resolveAccent(lab, block(lab), TE.lab * S, c);
        push('lab', p.y - vh * F.lab, p, TE.lab, HZ.lab, GAIN.lab);
      }
      const rows = Array.from(document.querySelectorAll<HTMLElement>('.row'));
      const doorX = solveDoorColumn(rows, TE.door * S, c);
      for (const row of rows) {
        const p = resolveDoor(row, TE.door * S, c);
        if (doorX !== null) p.x = doorX;
        doors.set(row, p);
        push(row.dataset.lab ?? 'row', p.y - vh * F.door, p, TE.door, HZ.door, GAIN.door);
      }
      const site = accent('site');
      if (site) {
        const p = resolveAccent(site, block(site), TE.site * S, c);
        push('site', p.y - vh * F.site, p, TE.site, HZ.site, GAIN.site);
      }
      const cta = document.getElementById('contact-title');
      if (cta) {
        const te = phone ? TE.contactPhone : TE.contact;
        const C = docRect(cta, sy);
        // desktop: the ring sits right of the left-aligned statement; phones: above it, with
        // room for the lensed arcs that sit just outside the ring line
        const y = phone ? C.y0 - 1.75 * te * S : (C.y0 + C.y1) / 2;
        const x = phone ? vw / 2 : vw * CONTACT_X;
        push('contact', maxScroll, { x, y }, te, HZ.contact, GAIN.contact);
      }

      // knots must climb in s; the ring can only be in one place per scroll position
      for (let i = 0; i < knots.length; i++) {
        const k = knots[i];
        k.s = Math.min(Math.max(k.s, i ? knots[i - 1].s + 1 : 0), maxScroll);
        pts.push([k.x, k.y, k.te * S]);
      }
      // the band: one solve per accent knot, one shared solve for the doors, then the
      // envelope that carries the gain across the scroll between them
      env = null;
      if (solve) {
        const doorKnots = knots.filter((k) => k.te === TE.door);
        const shared = doorKnots.length ? solveBand(HZ.door, GAIN.door, doorKnots, c) : null;
        for (const k of knots) {
          const b = k.te === TE.door && shared ? shared : solveBand(k.hz, k.gain, [k], c);
          k.hz = b.hz;
          k.gain = b.gain;
        }
        solveDetours(c); // before the envelope: it solves against the path the ring will take
        solveEnvelope(c);
      }

      // hairlines: the index's top rule and each row's bottom rule, in document px
      const inner = document.querySelector<HTMLElement>('.rows-inner');
      ruleYs = [];
      if (inner) {
        const I = docRect(inner, sy);
        ruleX = [I.x0, I.x1];
        ruleYs.push(I.y0 + 0.5);
        for (const row of rows) ruleYs.push(docRect(row, sy).y1 - 0.5);
      }
    } finally {
      html.classList.remove('measuring');
    }
  }

  let queued = 0;
  function refresh(): void {
    if (queued) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      measure();
      opts.onMeasure?.();
    });
  }

  // position, radius and horizon at a scroll; the gain comes from the envelope (sample)
  function samplePos(scrollY: number, out: PathSample): void {
    const n = knots.length;
    if (n === 0) {
      out.x = 0.74;
      out.y = 0.4;
      out.thetaE = 0.11;
      out.horizon = 0.42;
      out.gain = 1;
      return;
    }
    const s = Math.min(Math.max(scrollY, knots[0].s), knots[n - 1].s);
    let i = 0;
    while (i < n - 2 && s >= knots[i + 1].s) i++;
    const a = knots[i];
    const b = knots[Math.min(i + 1, n - 1)];
    const u = b.s > a.s ? Math.min(1, Math.max(0, (s - a.s) / (b.s - a.s))) : 0;
    if (n === 1) {
      tmp[0] = a.x;
      tmp[1] = a.y;
      tmp[2] = a.te * S;
    } else {
      crSegment(pts[Math.max(0, i - 1)], pts[i], pts[Math.min(n - 1, i + 1)], pts[Math.min(n - 1, i + 2)], u, tmp);
    }
    // the mass recedes while it travels and returns at the rest
    const bump = Math.sin(Math.PI * u);
    const depth = DIP_SHORT + (DIP_LONG - DIP_SHORT) * smoothstep(0.2, 0.6, (b.s - a.s) / vh);
    const dip = 1 - depth * bump;
    out.x = softClamp((tmp[0] + a.bx * bump) / vw, 0.06, 0.94);
    out.y = softClamp((tmp[1] + a.by * bump - scrollY) / vh, 0.12, 0.88);
    out.thetaE = Math.max(0, (tmp[2] / S) * dip);
    out.horizon = a.hz + (b.hz - a.hz) * u;
    out.gain = a.gain + (b.gain - a.gain) * u;
  }

  // Between two rests the spline runs straight through whatever is in the way, and the ring's
  // limb lands on it. Each segment therefore carries a detour: the offset that keeps the ring
  // clearest along the whole crossing, applied as a sin(pi u) bump, so the ring leans into the
  // negative space on its way past and still arrives exactly where the anchor solve put it.
  const DETOUR_U = [0.08, 0.16, 0.25, 0.33, 0.42, 0.5, 0.58, 0.67, 0.75, 0.84, 0.92];
  function solveDetours(c: Ctx): void {
    const probe: PathSample = { x: 0, y: 0, thetaE: 0, horizon: 0, gain: 1 };
    for (let i = 0; i < knots.length - 1; i++) {
      const a = knots[i];
      const b = knots[i + 1];
      a.bx = 0;
      a.by = 0;
      // very short hops keep the straight line: the dip already takes the ring down to a
      // few px there, and a detour would read as a swerve
      if (b.s - a.s < 0.18 * vh) continue;
      // where the ring is, and how much of the bump it carries, at each point of the crossing
      const stops: { x: number; y: number; R: number; w: number }[] = [];
      let rMax = 0;
      for (const u of DETOUR_U) {
        const s = a.s + u * (b.s - a.s);
        samplePos(s, probe);
        const R = probe.thetaE * S;
        if (R <= 0) continue;
        rMax = Math.max(rMax, R);
        stops.push({ x: probe.x * vw, y: probe.y * vh + s, R, w: Math.sin(Math.PI * u) });
      }
      if (!stops.length) continue;
      // only the text the crossing could possibly touch
      const lo = Math.min(...stops.map((p) => p.y)) - 4 * rMax;
      const hi = Math.max(...stops.map((p) => p.y)) + 4 * rMax;
      const near = c.texts.filter((t) => t.y1 > lo && t.y0 < hi);
      const cost = (dx: number, dy: number): number => {
        let sum = 0;
        for (const p of stops) sum += limbScore(p.x + dx * p.w, p.y + dy * p.w, p.R, near, vw);
        return sum;
      };
      let bestCost = cost(0, 0);
      if (bestCost <= 0) continue;
      let best: [number, number] = [0, 0];
      let bestOff = 0;
      const step = 0.4 * rMax;
      for (let ix = -6; ix <= 6; ix++) {
        for (let iy = -4; iy <= 4; iy++) {
          if (!ix && !iy) continue;
          const dx = ix * step;
          const dy = iy * step;
          const sc = cost(dx, dy);
          const off = Math.hypot(dx, dy);
          if (sc < bestCost - 0.5 || (Math.abs(sc - bestCost) <= 0.5 && off < bestOff)) {
            bestCost = sc;
            best = [dx, dy];
            bestOff = off;
          }
        }
      }
      a.bx = best[0];
      a.by = best[1];
    }
  }

  function envAt(scrollY: number): number | null {
    if (!env || env.length === 0 || knots.length === 0) return null;
    const t = (scrollY - knots[0].s) / SCAN;
    const i = Math.floor(t);
    if (i < 0) return env[0];
    if (i >= env.length - 1) return env[env.length - 1];
    const f = t - i;
    return env[i] + (env[i + 1] - env[i]) * f;
  }

  function sample(scrollY: number, out: PathSample): void {
    samplePos(scrollY, out);
    const g = envAt(scrollY);
    if (g !== null) out.gain = g;
  }

  // The highest gain that clears every run of text, sampled every SCAN px of scroll and
  // interpolated between (the runtime spring lags it further). Feasibility falls monotonically
  // with gain, so each sample is a binary search over the ladder: four tests, not eleven.
  function solveEnvelope(c: Ctx): void {
    env = null;
    const n = knots.length;
    if (n < 2) return;
    const span = knots[n - 1].s - knots[0].s;
    const steps = Math.max(1, Math.ceil(span / SCAN));
    const out = new Float32Array(steps + 1);
    const probe: PathSample = { x: 0, y: 0, thetaE: 0, horizon: 0, gain: 1 };
    for (let i = 0; i <= steps; i++) {
      const s = knots[0].s + i * SCAN;
      samplePos(s, probe);
      const m: Mass = { x: probe.x * vw, y: probe.y * vh, r: probe.thetaE * S };
      const yh = probe.horizon * vh;
      const runs = runsFor(s, LADDER[0], m, c);
      let lo = 0; // the last rung known to clear (0 always does)
      let hi = LADDER.length - 1;
      while (LADDER[lo] > probe.gain) lo++; // never brighter than the knots asked for
      let best = LADDER.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        regain(runs, LADDER[mid], S);
        if (feasible(yh, m, runs)) {
          best = mid;
          hi = mid - 1;
        } else lo = mid + 1;
      }
      out[i] = LADDER[best];
    }
    env = out;
  }

  function rules(scrollY: number): { ys: number[]; x: [number, number] } {
    const ys: number[] = [];
    for (const y of ruleYs) {
      const v = y - scrollY;
      if (v > -80 && v < vh + 80 && ys.length < 8) ys.push(v);
    }
    return { ys, x: ruleX };
  }

  function doorMass(row: HTMLElement, scrollY: number, thetaE: number): LensMass {
    const p = doors.get(row);
    if (!p) return { x: 0.93, y: 0.5, thetaE };
    return { x: softClamp(p.x / vw, 0.06, 0.94), y: softClamp((p.y - scrollY) / vh, 0.12, 0.88), thetaE };
  }

  const ro = new ResizeObserver(refresh);
  ro.observe(document.body);
  const onEvent = (): void => refresh();
  window.addEventListener('resize', onEvent);
  document.addEventListener('lens:refresh', onEvent);
  document.fonts?.ready.then(onEvent);
  measure(false);
  if ('requestIdleCallback' in window) window.requestIdleCallback(onEvent, { timeout: 500 });
  else setTimeout(onEvent, 50);

  const api: LensPath = {
    knots,
    refresh,
    sample,
    rules,
    doorMass,
    destroy() {
      cancelAnimationFrame(queued);
      ro.disconnect();
      window.removeEventListener('resize', onEvent);
      document.removeEventListener('lens:refresh', onEvent);
    },
  };
  if (import.meta.env.DEV) {
    // tooling: which text runs stop the band from sitting at viewport y (px) for a knot
    (api as LensPath & { why?: unknown }).why = (id: string, y: number, gain: number): string[] => {
      const k = knots.find((n) => n.id === id);
      if (!k || !lastCtx) return ['no knot'];
      const out: string[] = [];
      const m: Mass = { x: k.x, y: k.y - k.s, r: k.te * S };
      feasible(y, m, runsFor(k.s, gain, m, lastCtx, 0), out);
      return out;
    };
    // the same question at an arbitrary scroll, against the path's own horizon and mass
    (api as LensPath & { whyAt?: unknown }).whyAt = (s: number, gain: number): string[] => {
      if (!lastCtx) return ['no ctx'];
      const probe: PathSample = { x: 0, y: 0, thetaE: 0, horizon: 0, gain: 1 };
      samplePos(s, probe);
      const m: Mass = { x: probe.x * vw, y: probe.y * vh, r: probe.thetaE * S };
      const out: string[] = [`hz=${Math.round(probe.horizon * vh)} mass=${Math.round(m.x)},${Math.round(m.y)} r=${Math.round(m.r)} cap=${probe.gain.toFixed(2)}`];
      feasible(probe.horizon * vh, m, runsFor(s, gain, m, lastCtx, 0), out);
      return out;
    };
  }
  return api;
}
