/* ————— Lab 05 · Tender: where each coin wants to be, as a function of the scroll ————— */
// Pure maths, no three.js objects kept between calls. World units: the camera sees W x H at
// z = 0. A coin's geometry has radius 1 and its heads face on +Y; a pose's `s` scales it.
//
// Formations, one per section:
//   mint    the hero: one coin, the rest hidden inside it at scale 0
//   unfurl  a stack bent along a curve, a wave running down it as the section scrolls
//   loop    a necklace of coins around the headline, turned by the scroll and a flywheel
//   flip    a grid that flips heads to tails in a diagonal wave, then scrolls away with its page
//   stack   dropped one at a time into a tower
// A section's entry (0 when its top is at the viewport bottom, 1 at the top) blends the previous
// formation into its own, coin by coin, so the cast moves as a cascade rather than a block.

import { Quaternion, Vector3 } from 'three';

export const N = 18;
export const THICK = 0.11; // the coin's full thickness, in radii (matches the lathe profile)

export const HERO = 0;
export const UNFURL = 1;
export const LOOP = 2;
export const FLIP = 3;
export const END = 5;

export interface Pose {
  p: Vector3;
  q: Quaternion;
  s: number;
}

export interface Frame {
  W: number; // world units across the viewport at z = 0
  H: number;
  wpp: number; // world units per css px
  phone: boolean;
  t: number; // seconds
  idle: number; // 0..1, how much the coins drift on their own (0 under reduced motion)
  enter: number[];
  pin: number[];
  after: number[];
  spin: number; // the loop's flywheel angle, radians
}

export const pose = (): Pose => ({ p: new Vector3(), q: new Quaternion(), s: 0 });

const Y = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _n = new Vector3();
const _q = new Quaternion();
const _r = new Quaternion();

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number): number => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
export const hash = (i: number, k: number): number => {
  const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// orient the coin's heads (+Y) along n
function face(out: Quaternion, n: Vector3): Quaternion {
  return out.setFromUnitVectors(Y, _n.copy(n).normalize());
}

// how far into a section's entry this coin has travelled: coins leave in index order
export function weight(e: number, i: number): number {
  const start = 0.06 + 0.024 * i;
  return smooth(start, start + 0.4, e);
}

/* ————— mint ————— */

export function mint(i: number, out: Pose, f: Frame): void {
  const bob = Math.sin(f.t * 0.9) * 0.03 * f.H * f.idle;
  out.p.set(0, (f.phone ? 0.2 : 0.19) * f.H + bob, 0);
  _a.set(0.2 + 0.07 * Math.sin(f.t * 0.6) * f.idle, 0.62 + 0.05 * Math.sin(f.t * 0.7 + 1) * f.idle, 0.76);
  // as the hero scrolls away the coin turns toward its edge, ready to come apart
  _r.setFromAxisAngle(Y, -0.75 * smooth(0, 1, f.enter[UNFURL]));
  _a.applyQuaternion(_r);
  face(out.q, _a);
  out.s = i === 0 ? (f.phone ? 0.2 * f.W : 0.118 * f.H) : 0;
}

/* ————— unfurl: a stack bent along a curve ————— */

export function unfurl(i: number, out: Pose, f: Frame): void {
  const q = f.pin[UNFURL];
  const u = i / (N - 1);
  const W = f.W;
  const H = f.H;
  // the curve runs from where the hero coin was (u = 0) down and out to the lower right,
  // ending above the chapter pill
  const ex = f.phone ? 0 : -0.02 * W;
  const ey = (f.phone ? 0.2 : 0.19) * H;
  const sx = f.phone ? 0.06 * W : 0.27 * W;
  const sy = (f.phone ? -0.14 : -0.3) * H; // a phone's paragraph sits under the curve's end
  const bx = f.phone ? -0.22 * W : -0.1 * W;
  const bz = f.phone ? 0.8 : 1.3;
  const sway = (q - 0.5) * 0.5; // the whole curve yaws a little as the section scrolls
  const b = Math.sin(Math.PI * u);
  out.p.set(ex + (sx - ex) * u + bx * b, ey + (sy - ey) * u - 0.02 * H * b, -0.6 + 2.4 * u + bz * b);
  // tangent: coins stack face to face along the curve
  _a.set(sx - ex + bx * Math.PI * Math.cos(Math.PI * u), sy - ey - 0.02 * H * Math.PI * Math.cos(Math.PI * u), 2.4 + bz * Math.PI * Math.cos(Math.PI * u));
  _a.normalize();
  // a wave runs down the stack as the section scrolls: each coin nods about the binormal
  const wave = 0.42 * Math.sin(Math.PI * 2 * (1.1 * u - 1.2 * q) + 0.35 * f.t * f.idle);
  _b.set(0, 0, 1).cross(_a).normalize();
  _r.setFromAxisAngle(_b, wave);
  _a.applyQuaternion(_r);
  face(out.q, _a);
  // the sway, about a vertical axis through the curve's middle
  _r.setFromAxisAngle(Y, sway);
  _c.set((ex + sx) / 2, (ey + sy) / 2, 0.6);
  out.p.sub(_c).applyQuaternion(_r).add(_c);
  out.q.premultiply(_r);
  out.p.y += Math.sin(f.t * 1.1 + i * 0.7) * 0.008 * H * f.idle;
  out.s = f.phone ? 0.17 * W : 0.085 * H;
}

/* ————— loop: a necklace around the headline ————— */

// the ring lies nearly flat, like a planet's, tipped toward the camera and rolled a little
const TILT = new Quaternion().setFromAxisAngle(X, 0.42).premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.12));

export function loop(i: number, out: Pose, f: Frame): void {
  const q = f.pin[LOOP];
  const R = f.phone ? 0.42 * f.W : 0.34 * Math.min(f.W, 1.6 * f.H);
  const a = (Math.PI * 2 * i) / N + q * Math.PI * 1.3 + f.spin + 0.1 * f.t * f.idle;
  const breathe = 1 + 0.015 * Math.sin(f.t * 0.8 + i) * f.idle;
  out.p.set(R * breathe * Math.cos(a), 0, R * breathe * Math.sin(a)).applyQuaternion(TILT);
  out.p.y -= (f.phone ? 0.25 : 0.02) * f.H;
  // faces point along the ring, with a slow roll so the glints travel
  _a.set(-Math.sin(a), 0, Math.cos(a));
  _b.set(Math.cos(a), 0, Math.sin(a));
  _r.setFromAxisAngle(_b, 0.3 * Math.sin(2 * a + q * 5));
  _a.applyQuaternion(_r).applyQuaternion(TILT);
  face(out.q, _a);
  out.s = f.phone ? 0.12 * f.W : 0.085 * f.H;
}

/* ————— flip: a grid laid back like a table, flipped in a diagonal wave ————— */

const GRID_TILT = new Quaternion().setFromAxisAngle(X, -0.62).premultiply(new Quaternion().setFromAxisAngle(Y, 0.18));
const HEADS_UP = new Quaternion().setFromAxisAngle(X, Math.PI / 2); // heads toward the camera

export function flip(i: number, out: Pose, f: Frame): void {
  const q = f.pin[FLIP];
  const cols = f.phone ? 3 : 6;
  const rows = N / cols;
  const c = i % cols;
  const r = Math.floor(i / cols);
  const cell = f.phone ? Math.min(0.26 * f.W, 0.08 * f.H) : Math.min(0.105 * f.W, 0.17 * f.H);
  const cy = f.phone ? -0.14 * f.H : -0.17 * f.H;
  const order = (c + r * 0.7) / (cols - 1 + (rows - 1) * 0.7);
  const fp = smooth(order * 0.72, order * 0.72 + 0.22, q);
  const hop = Math.sin(Math.PI * fp);
  // grid-local, so the hop leaves along the table's normal, then laid back
  out.p.set((c - (cols - 1) / 2) * cell, ((rows - 1) / 2 - r) * cell, 1.3 * cell * hop);
  out.p.applyQuaternion(GRID_TILT);
  out.p.x += f.phone ? 0 : 0.07 * f.W;
  out.p.y += cy + Math.sin(f.t * 1.2 + i * 0.9) * 0.006 * f.H * f.idle;
  // scrolled away with its page once the section lets go
  out.p.y += f.after[FLIP] * f.wpp;
  _r.setFromAxisAngle(X, Math.PI * fp);
  out.q.copy(GRID_TILT).multiply(HEADS_UP).multiply(_r);
  out.s = cell * 0.4;
}

/* ————— stack: dropped one at a time ————— */

const STACK_TILT = new Quaternion().setFromAxisAngle(X, 0.48);

export function stack(i: number, out: Pose, f: Frame): void {
  const q = f.pin[END];
  const s = f.phone ? 0.2 * f.W : 0.125 * f.H;
  const x = f.phone ? 0 : 0.25 * f.W;
  const base = f.phone ? -0.3 * f.H : -0.3 * f.H;
  const h = THICK * s * 1.04;
  // resting place: up the stack's tilted axis, a little off true like a real stack
  const jx = (hash(i, 1) - 0.5) * 0.06 * s;
  const jz = (hash(i, 2) - 0.5) * 0.06 * s;
  _a.set(jx, i * h, jz).applyQuaternion(STACK_TILT);
  _a.x += x;
  _a.y += base;
  // falling in from above the viewport, accelerating, tumbling, landing flat
  const d = clamp01((q * 1.18 - (i / N) * 0.92) / 0.16);
  const g = d * d;
  _b.set(x + (hash(i, 3) - 0.5) * 0.5 * f.W * (1 - g), 0.62 * f.H + i * 0.35, 0);
  out.p.lerpVectors(_b, _a, g);
  _c.set(hash(i, 4) - 0.5, hash(i, 5) - 0.5, hash(i, 6) - 0.5).normalize();
  _q.setFromAxisAngle(_c, (1 - g) * 4);
  _r.setFromAxisAngle(_c.set(hash(i, 7) - 0.5, 0, hash(i, 8) - 0.5).normalize(), 0.03);
  out.q.copy(STACK_TILT).multiply(_r).premultiply(_q);
  out.s = s;
}

/* ————— the surface the flip grid lies on and the stack stands on ————— */

const FLOOR = new Quaternion().setFromAxisAngle(X, -Math.PI / 2); // a plane's +Z turned to +Y
// A shadow catcher: invisible except where coins shade it. Returns its opacity (0 when no
// formation that has a surface is on screen) and writes its pose; `s` is its size.

export function surface(out: Pose, f: Frame): number {
  const end = f.enter[END];
  // the table hands over to the floor a third of the way into the last section: before that
  // the grid's bottom row can still be on screen, and its shadows should not blink out
  if (end > 0.3) {
    const s = f.phone ? 0.2 * f.W : 0.125 * f.H;
    out.p.set(0, -THICK * s * 0.55, 0).applyQuaternion(STACK_TILT);
    out.p.x += f.phone ? 0 : 0.25 * f.W;
    out.p.y += -0.3 * f.H;
    out.q.copy(STACK_TILT).multiply(FLOOR); // the plane's +Z along the stack's axis
    out.s = s * 7;
    return smooth(0.3, 1, end);
  }
  const flipIn = f.enter[FLIP];
  if (flipIn > 0) {
    const cell = f.phone ? Math.min(0.26 * f.W, 0.08 * f.H) : Math.min(0.105 * f.W, 0.17 * f.H);
    out.p.set(0, 0, -THICK * cell * 0.4 * 0.6).applyQuaternion(GRID_TILT);
    out.p.x += f.phone ? 0 : 0.07 * f.W;
    out.p.y += (f.phone ? -0.14 : -0.17) * f.H + f.after[FLIP] * f.wpp;
    out.q.copy(GRID_TILT);
    out.s = cell * 9;
    return smooth(0.4, 1, flipIn) * (1 - smooth(0.1, 0.3, end));
  }
  return 0;
}

/* ————— the whole cast: blend the formation behind a section into the one it brings ————— */

const _from = pose();
const _to = pose();

function blend(out: Pose, a: Pose, b: Pose, w: number): void {
  out.p.lerpVectors(a.p, b.p, w);
  out.q.slerpQuaternions(a.q, b.q, w);
  out.s = a.s + (b.s - a.s) * w;
}

type Former = (i: number, out: Pose, f: Frame) => void;
// newest first: the first link a coin has started is the only one that matters to it. That
// holds because every section is at least a viewport tall, so one section's entry is over
// before the next one's begins; a shorter section would need two links blended at once.
const CHAIN: [number, Former, Former, (f: Frame) => number][] = [
  [END, flip, stack, (f) => f.enter[END]],
  [FLIP, loop, flip, (f) => f.enter[FLIP]],
  [LOOP, unfurl, loop, (f) => f.enter[LOOP]],
  // the one coin comes apart while its section is pinned, under "One coin." and "Eighteen."
  [UNFURL, mint, unfurl, (f) => clamp01((f.pin[UNFURL] - 0.08) / 0.38)],
];

// the pose coin i is chasing, and how much of the stack formation it is in (for its spring)
export function target(i: number, out: Pose, f: Frame): number {
  for (const [k, from, to, drive] of CHAIN) {
    const w = weight(drive(f), i);
    if (w <= 0) continue;
    to(i, _to, f);
    if (w >= 1) {
      out.p.copy(_to.p);
      out.q.copy(_to.q);
      out.s = _to.s;
    } else {
      from(i, _from, f);
      blend(out, _from, _to, w);
    }
    return k === END ? w : 0;
  }
  mint(i, out, f);
  return 0;
}
