/* ————— AgX (three.js port) in JS, used once at init to solve the shader's ambient floor ————— */
// Mirrors agx() in shader.ts exactly (column-major mat3 constructors → columns here), so
// srgb(agx(floor)) lands on the CSS --ground hex within 1/255 and the canvas arrival is flush.

type V3 = [number, number, number];
type M3 = [V3, V3, V3]; // columns

const SRGB_TO_REC2020: M3 = [[0.6274, 0.0691, 0.0164], [0.3293, 0.9195, 0.088], [0.0433, 0.0113, 0.8956]];
const REC2020_TO_SRGB: M3 = [[1.6605, -0.1246, -0.0182], [-0.5876, 1.1329, -0.1006], [-0.0728, -0.0083, 1.1187]];
const INSET: M3 = [
  [0.856627153315983, 0.137318972929847, 0.11189821299995],
  [0.0951212405381588, 0.761241990602591, 0.0767994186031903],
  [0.0482516061458583, 0.101439036467562, 0.811302368396859],
];
const OUTSET: M3 = [
  [1.1271005818144368, -0.1413297634984383, -0.14132976349843826],
  [-0.11060664309660323, 1.157823702216272, -0.11060664309660294],
  [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405],
];

function mul(m: M3, v: V3): V3 {
  return [
    m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
    m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
    m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
  ];
}

function contrast(x: number): number {
  const x2 = x * x;
  const x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

export function agx(c: V3): V3 {
  let v = mul(INSET, mul(SRGB_TO_REC2020, c));
  v = v.map((x) => {
    let y = Math.log2(Math.max(x, 1e-10));
    y = (y + 12.47393) / (4.026069 + 12.47393);
    return contrast(Math.min(1, Math.max(0, y)));
  }) as V3;
  v = mul(OUTSET, v);
  v = v.map((x) => Math.pow(Math.max(0, x), 2.2)) as V3;
  v = mul(REC2020_TO_SRGB, v);
  return v.map((x) => Math.min(1, Math.max(0, x))) as V3;
}

export function srgbEncode(x: number): number {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

export function srgbDecode(x: number): number {
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

export function hexToLinear(hex: string): V3 {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (ch) => ch + ch) : h, 16);
  return [srgbDecode(((n >> 16) & 255) / 255), srgbDecode(((n >> 8) & 255) / 255), srgbDecode((n & 255) / 255)];
}

function out(f: V3): V3 {
  return agx(f).map(srgbEncode) as V3;
}

// Newton in 3D with a numerical Jacobian: find linear f with srgb(agx(f)) == target (sRGB 0..1).
export function solveFloor(hex: string): V3 {
  const target = hexToLinear(hex).map(srgbEncode) as V3;
  let f: V3 = hexToLinear(hex).map((x) => x * 4) as V3;
  for (let it = 0; it < 24; it++) {
    const y = out(f);
    const r = [y[0] - target[0], y[1] - target[1], y[2] - target[2]];
    if (Math.max(Math.abs(r[0]), Math.abs(r[1]), Math.abs(r[2])) < 1 / 2048) break;
    const J: number[][] = [[], [], []];
    for (let j = 0; j < 3; j++) {
      const d = Math.max(1e-6, Math.abs(f[j]) * 1e-3);
      const fp: V3 = [...f] as V3;
      fp[j] += d;
      const yp = out(fp);
      for (let i = 0; i < 3; i++) J[i][j] = (yp[i] - y[i]) / d;
    }
    const step = solve3(J, r);
    if (!step) break;
    f = f.map((x, i) => Math.max(1e-6, x - step[i])) as V3;
  }
  return f;
}

function solve3(A: number[][], b: number[]): number[] | null {
  const m = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const k = m[r][c] / m[c][c];
      for (let j = c; j < 4; j++) m[r][j] -= k * m[c][j];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}
