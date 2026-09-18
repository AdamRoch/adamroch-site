/* ————— 1D value noise for the lens's idle drift: integer hash, no trig ————— */

// mulberry-style integer hash → [0, 1)
function hash(i: number, seed: number): number {
  let x = (Math.imul(i, 374761393) + Math.imul(seed, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// one octave, smoothstep-interpolated, centred on 0: [-0.5, 0.5]
export function vnoise1(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const a = hash(i, seed);
  return a + (hash(i + 1, seed) - a) * u - 0.5;
}

// 3-octave fBm (amplitude halves, frequency ~doubles), normalised to about [-1, 1]
export function fbm1(t: number, seed: number, octaves = 3): number {
  let v = 0;
  let a = 0.5;
  let f = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    v += a * vnoise1(t * f + o * 17.3, seed + o * 31);
    norm += a;
    a *= 0.5;
    f *= 2.03;
  }
  return (v / norm) * 2;
}
