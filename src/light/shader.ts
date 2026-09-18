/* ————— Closest Approach: one-pass gravitational lens over a procedural source sky ————— */
// GLSL ES 3.00 strings for a RawShaderMaterial (three prepends only "#version 300 es").
// Ported from .tmp/lens-proto.html; same maths and defaults. Additions: up to three point
// masses (superposed thin-lens deflections), source-space hairline rules, band tilt and a
// scroll streak, an aperture fill for the exit, and a solved ambient floor under everything.

export const VERT = /* glsl */ `
precision highp float;
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const FRAG = /* glsl */ `
precision highp float;
precision highp int;
out vec4 o;

uniform vec2 uRes;        // drawing buffer, device px
uniform float uDpr;       // device px per css px
uniform float uTime;      // seconds, frozen under reduced motion
uniform float uGrainT;    // grain seed, frozen under reduced motion
uniform vec4 uMass[3];    // x, y (short-side-centred, y up), thetaE^2, eps^2
uniform float uHorizon;   // band centre, short-side-centred y
uniform float uBand;      // band gain (0.45 at rest; ramps from 0 on arrive)
uniform float uBandW;     // band envelope width
uniform float uFil;       // filament frequency across the band
uniform float uHaze;      // warm haze under the band
uniform float uRingGain;  // photon-ring gain
uniform float uTilt;      // tan(band tilt) from the pointer tide
uniform float uStreak;    // scroll streak, short-side units (0 at rest)
uniform float uRules[8];  // source-space y of the index hairlines
uniform int uRuleN;
uniform vec2 uRuleX;      // hairline x extent, short-side-centred
uniform float uStarThr;   // hash threshold for a star cell; > 1 disables stars
uniform float uOct;       // fBm octaves (3, 2, 1 by tier)
uniform vec3 uFloor;      // linear ambient floor, solved so it tone-maps to --ground
uniform float uGrain;     // grain amplitude in sRGB
uniform vec3 uInk;        // sRGB ink for the rules
uniform vec3 uTint;       // sRGB tint that fills the primary's interior during exit/enter
uniform float uFill;      // 0..1 aperture fill

float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 3; i++) {
    if (float(i) >= uOct) break;
    v += a * vnoise(p);
    n += a;
    p = p * 2.03 + vec2(11.3, 7.9);
    a *= 0.5;
  }
  return v / n;
}

// AgX (three.js port)
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
const mat3 AgXInsetMatrix = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
const mat3 AgXOutsetMatrix = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
vec3 agxContrast(vec3 x) { vec3 x2 = x * x; vec3 x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
vec3 agx(vec3 c) {
  c = LINEAR_SRGB_TO_LINEAR_REC2020 * c;
  c = AgXInsetMatrix * c;
  c = max(c, 1e-10);
  c = log2(c);
  c = (c - (-12.47393)) / (4.026069 - (-12.47393));
  c = clamp(c, 0.0, 1.0);
  c = agxContrast(c);
  c = AgXOutsetMatrix * c;
  c = pow(max(vec3(0.0), c), vec3(2.2));
  c = LINEAR_REC2020_TO_LINEAR_SRGB * c;
  return clamp(c, 0.0, 1.0);
}
vec3 srgb(vec3 c) { return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

// one band tap: envelope × filament texture at a source-space offset from the horizon
float bandTap(float bx, float dy) {
  float env = exp(-abs(dy) / uBandW);
  float fil = fbm(vec2(bx * 2.4 + uTime * 0.03, dy * uFil + bx * 0.6));
  return env * smoothstep(0.42, 0.9, fil);
}

// source sky sampled at beta (short-side units, y up, centred)
vec3 sky(vec2 b, float S) {
  vec3 col = vec3(0.0);
  if (uBand > 0.0) {
    float dy = b.y - uHorizon - b.x * uTilt;
    float along = 0.45 + 0.55 * fbm(vec2(b.x * 0.9 - uTime * 0.012, 3.1));
    float f;
    if (uStreak != 0.0) f = (bandTap(b.x, dy - uStreak) + bandTap(b.x, dy) + bandTap(b.x, dy + uStreak)) / 3.0;
    else f = bandTap(b.x, dy);
    col += vec3(2.2, 0.9, 0.35) * f * along * uBand;
    col += vec3(0.5, 0.2, 0.08) * exp(-abs(dy) / 0.22) * uHaze * uBand;
  }
  if (uStarThr < 1.0) {
    vec2 cell = floor(b * 18.0);
    vec2 f = fract(b * 18.0);
    float h = hash21(cell);
    if (h > uStarThr) {
      vec2 sp = vec2(hash21(cell + 7.1), hash21(cell + 3.7));
      float d = length(f - sp) / 18.0;
      float sig = (0.8 + 1.4 * hash21(cell + 9.9)) * 0.35 * uDpr / S;
      float core = exp(-d * d / (2.0 * sig * sig));
      col += vec3(2.6, 2.4, 2.1) * core * (0.5 + 0.8 * hash21(cell + 1.3));
    }
  }
  return col;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float S = min(uRes.x, uRes.y);
  float px = uDpr / S; // one css px in short-side units
  vec2 theta = (frag - 0.5 * uRes) / S;

  // superposed thin-lens deflections
  vec2 beta = theta;
  for (int i = 0; i < 3; i++) {
    vec2 d = theta - uMass[i].xy;
    beta -= uMass[i].z * d / (dot(d, d) + uMass[i].w);
  }

  vec3 col = sky(beta, S);

  // analytic photon rings: two-term Moffat at each Einstein radius, brighter where the band is magnified
  float ring0 = 0.0;
  for (int i = 0; i < 3; i++) {
    float te2 = uMass[i].z;
    if (te2 < 1e-7) continue;
    float te = sqrt(te2);
    vec2 d = theta - uMass[i].xy;
    float len = max(length(d), 1e-6);
    float r = len - te;
    float core = clamp(0.02 * te, 0.7 * px, 1.6 * px);
    float wing = min(14.0 * px, 0.16 * te);
    // r is negative inside the ring, so every square is a multiply: pow(x, y) is undefined
    // for x < 0 (GLSL ES 3.00 8.2) and only works today because the driver folds the literal
    float qc = r / core;
    float qw = r / wing;
    float I = 5.5 * exp(-qc * qc) + 0.7 * pow(1.0 + qw * qw, -1.6);
    float under = 0.55 + 0.45 * (1.0 - smoothstep(-0.6, 0.3, d.y / len));
    col += vec3(2.2, 1.3, 0.7) * I * uRingGain * under;
    if (i == 0) ring0 = I;
  }

  // vignette on the light only; the floor stays flat so DOM chips on --ground disappear into it
  vec2 vuv = frag / uRes - 0.5;
  col *= 1.0 - 0.18 * smoothstep(0.5, 1.4, length(vuv) * 1.4);
  col += uFloor;

  col = srgb(agx(col));

  // hairlines in source space (they bend with the sky), ink at 10 %, 1 css px, fwidth AA
  if (uRuleN > 0) {
    float w = max(fwidth(beta.y), 1e-5);
    float hw = 0.5 * px;
    float xin = smoothstep(uRuleX.x - px, uRuleX.x, beta.x) * (1.0 - smoothstep(uRuleX.y, uRuleX.y + px, beta.x));
    float m = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= uRuleN) break;
      m = max(m, 1.0 - smoothstep(hw, hw + w, abs(beta.y - uRules[i])));
    }
    col = mix(col, uInk, 0.10 * m * xin);
  }

  // grain, luminance weighted, device px
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float g = hash21(frag + fract(uGrainT * 7.31) * 100.0) - 0.5;
  col += g * uGrain * (1.0 - lum);
  // IGN dither
  float ign = fract(52.9829189 * fract(0.06711056 * frag.x + 0.00583715 * frag.y));
  col += (ign - 0.5) / 255.0;

  // exit / enter: the primary's interior is the next page's first frame; the ring stays on top
  if (uFill > 0.0) {
    vec2 d0 = theta - uMass[0].xy;
    float te0 = sqrt(max(uMass[0].z, 0.0));
    float inside = 1.0 - smoothstep(te0 - 1.5 * px, te0 + 1.5 * px, length(d0));
    float fill = uFill * inside * (1.0 - clamp(ring0 * 0.25, 0.0, 1.0));
    col = mix(col, uTint, fill);
  }

  o = vec4(col, 1.0);
}
`;
