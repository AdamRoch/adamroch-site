export const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Lab 01: a black hole rendered by integrating real null geodesics.
// Each pixel solves the Schwarzschild orbit equation d²u/dφ² = -u + 3M u² for
// u = 1/r, marching in the angle φ around the hole rather than in distance. That
// costs about what a straight-line march costs, and it buys the things a
// Newtonian 1/r² pull cannot: the correct 2.6M shadow, an unstable photon sphere
// at 3M, and rays that wind far enough to fold the disk into second- and
// third-order images — the photon ring is emergent light, not a drawn circle.
// Along the way the march tests the equatorial accretion disk (emission +
// absorption, so the near rim occludes the far one).
// Output is linear HDR light; the grade pass below owns vignette, tone and grain.
export const fragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform float uTime;
  uniform vec2 uRes;
  uniform vec3 uCamPos;
  uniform vec3 uCamRight;
  uniform vec3 uCamUp;
  uniform vec3 uCamFwd;
  uniform float uMaxSteps;
  uniform float uJitter;

  #define MASS 0.5          // horizon r = 2M = 1, photon sphere 3M = 1.5, shadow b = 3√3 M = 2.598
  #define R_IN 1.82         // disk inner edge: just outside the photon sphere
  #define R_OUT 4.2
  #define FOCAL 1.42
  #define MAX_STEPS 112
  #define DPHI 0.085        // 112 * 0.085 = 9.5 rad: one and a half turns, enough for the 2nd image
  #define U_SKY 0.0769      // escape at r = 13
  #define BEAM_P 1.35       // relativistic beaming exponent on the frequency shift
  #define EMIS_CEIL 0.30    // 1/EMIS_CEIL is the highest linear value one crossing can emit

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
      mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  // Jimenez 2014: a spatially uniform low-discrepancy dither, much better than
  // white noise for scattering a sub-pixel feature into something that still
  // reads as a line rather than as clumps.
  float ign(vec2 p) {
    return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
  }

  // 4 octaves, normalised to 0..1
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p = p * 2.13 + vec2(17.3, 9.1);
      a *= 0.5;
    }
    return v * 1.0667;
  }

  // ————— sky: two star layers on an equal-angle grid, sampled along the bent exit —————
  // Deliberately only stars. A nebula was tried here and cut: at every strength it
  // read as haze rather than as lensing, and it lifted the void the whole page
  // depends on. The lensing is already legible in the disk's own second image;
  // the sky's job is to stay black.
  //
  // The old field lattice'd the direction vector itself (floor(d * 54.0)), so a
  // cell's visible patch was whatever slice the unit sphere cut out of a cube — at
  // grazing incidence a long thin sliver. That is why every star rendered as the
  // same short dash leaning the same way, and why they piled into a speckle ring
  // where the lens compresses the sky. Here the direction lands on its dominant
  // cube face, warped to equal angle, so every cell is the same patch of sky and a
  // star is a round dot. Its radius is never allowed below the pixel's own
  // footprint either: below that it grows and dims at constant flux rather than
  // scintillating between frames.

  // (4/π)·atan undoes the cube's 5:1 centre-to-corner solid-angle stretch, so star
  // density per steradian is even. z carries the face id so opposite faces differ.
  vec3 cubeFace(vec3 d) {
    vec3 a = abs(d);
    vec2 q;
    float face;
    if (a.x >= a.y && a.x >= a.z) { q = d.zy / d.x; face = d.x > 0.0 ? 0.0 : 1.0; }
    else if (a.y >= a.z) { q = d.xz / d.y; face = d.y > 0.0 ? 2.0 : 3.0; }
    else { q = d.xy / d.z; face = d.z > 0.0 ? 4.0 : 5.0; }
    return vec3(atan(q) * 1.27323954, face);
  }

  // n: cells across a face. thresh: 1 - density. foot: the floor under a star's
  // radius, in radians — one march pixel, so none of them can land sub-pixel.
  vec3 starLayer(vec3 fq, float n, float thresh, float foot, float gain) {
    vec2 g = fq.xy * n;
    vec2 cell = floor(g);
    vec3 h = hash33(vec3(cell, fq.z * 13.0 + n));
    if (h.x < thresh) return vec3(0.0);
    vec3 h2 = hash33(vec3(cell.yx, fq.z * 7.0 - n));

    float mag = h2.x * h2.x;              // a few bright, most faint
    float r0 = 0.016 + 0.030 * mag;       // the star's own radius, in cell units
    float fp = foot * n * 0.63662;        // radians -> cell units (a cell is π/2n)
    float want = max(r0, fp);             // never smaller than the pixel it lands on
    float rad = min(want, 0.5);           // and never wider than its own cell
    float dim = (r0 * r0) / (want * want);// spread at constant flux

    float r = length(g - cell - 0.5 - (h.yz - 0.5) * 0.52);
    float s = 1.0 - smoothstep(0.0, rad, r);
    s *= s;
    float tw = 0.72 + 0.28 * sin(uTime * 1.1 + h2.y * 90.0);
    vec3 tint = mix(vec3(0.70, 0.80, 1.0), vec3(1.0, 0.84, 0.64), h2.z);
    return tint * (s * dim * tw * gain * (0.34 + 1.9 * mag));
  }

  vec3 skyColor(vec3 d, float foot) {
    vec3 fq = cubeFace(d);
    return starLayer(fq, 30.0, 0.80, foot, 1.55)
         + starLayer(fq, 68.0, 0.915, foot, 0.62);
  }

  // ————— accretion disk: emission and absorption at one plane crossing —————
  // rgb is emitted light, a is how much of what lies behind this crossing it hides.
  // dir is the ray's local direction, so the slab's path length, the doppler shift
  // and the beaming are all measured in the geometry the ray actually has here —
  // which is why the lensed far side beams correctly too.
  // wound is how far around the hole the ray has already travelled to get here: a
  // 2nd or 3rd image is a compressed copy of a huge patch of disk, so it has to be
  // read as an average rather than as a point sample, or the halo and the photon
  // ring are built out of aliased hairlines. Inside, it is combined with the disk's
  // own age — differential rotation eventually shears the pattern past the sampling
  // rate too — and whichever is larger decides how much detail this sample resolves.
  // pix is how wide this one march pixel is in world units where it crosses the
  // disk. A grazing crossing smears that across many times its own width along the
  // plane, which is exactly the near-edge-on case, and at DPR 1 — where the march
  // is 1:1 with the canvas and nothing upscales it — the filaments were finer than
  // the sample that had to carry them: the bright inner rim printed a crosshatch
  // stipple. So the detail the sample asks for is capped by the detail it can
  // actually resolve, and the cap moves with the march resolution: at DPR 2 it is
  // barely engaged.
  vec4 diskSample(float rd, vec3 q, vec3 dir, float wound, float pix) {
    float t = clamp((rd - R_IN) / (R_OUT - R_IN), 0.0, 1.0);
    float foot = pix / max(abs(dir.y), 0.06); // the crossing's in-plane footprint
    float lodFine = smoothstep(0.022, 0.085, foot);  // 1/9.5 world units per filament
    float lodCoarse = smoothstep(0.16, 0.60, foot);  // 1/2.25 per cloud

    // keplerian differential rotation: inner material orbits faster
    float omega = 1.45 * pow(rd, -1.5);
    float ca = cos(uTime * omega);
    float sa = sin(uTime * omega);
    vec2 rp = mat2(ca, -sa, sa, ca) * q.xz;

    // the shear rate goes as r^-2.5 and the arc it drags as r, so the inner disk
    // phase-mixes first. its filaments dissolve into bands rather than into stipple,
    // which is what differential rotation actually does to frozen structure.
    float soft = max(max(smoothstep(10.2, 31.9, uTime * omega), wound), lodFine); // omega already carries r^-1.5

    // a wound ray is imaging a huge patch of disk through a hairline, so it reads
    // the clouds as an average too — otherwise the halo and the ring are built out
    // of point samples of a high-frequency field, which is what beads them
    float d = mix(fbm(rp * 2.25), 0.52, 0.55 * max(wound, lodCoarse));
    d *= 0.58 + 0.84 * mix(vnoise(rp * 9.5 + 4.1), 0.5, soft); // fine filaments
    d = smoothstep(0.30 - 0.04 * soft, 0.92 + 0.12 * soft, d);

    float prof = smoothstep(R_IN, R_IN + 0.24, rd) * (1.0 - smoothstep(2.6, 4.05, rd));

    // a slab, not a plane: a grazing ray crosses more material than a steep one
    float slant = clamp(1.0 / max(abs(dir.y), 0.30), 1.0, 3.2);
    float dens = d * prof * slant;

    // ————— relativity —————
    // orbital velocity, gravitational redshift, and the doppler factor measured
    // against the photon's own outgoing direction (-dir, emitter → observer)
    vec3 tang = normalize(vec3(q.z, 0.0, -q.x));
    float beta = min(sqrt(MASS / rd), 0.72);
    float gamma = inversesqrt(max(1.0 - beta * beta, 1e-3));
    float mu = dot(tang, dir); // + when the material is coming at us
    float dop = 1.0 / (gamma * max(1.0 - beta * mu, 0.08));
    float grav = sqrt(max(1.0 - 2.0 * MASS / rd, 0.02));
    float shift = clamp(grav * dop, 0.12, 2.4); // observed / emitted frequency

    vec3 col = mix(vec3(1.0, 0.97, 0.90), vec3(1.0, 0.55, 0.18), smoothstep(0.0, 0.30, t));
    col = mix(col, vec3(1.0, 0.30, 0.0), smoothstep(0.28, 0.70, t));
    col = mix(col, vec3(0.40, 0.06, 0.01), smoothstep(0.70, 1.0, t));

    // the frequency shift is a colour, not just a brightness
    col = mix(col, vec3(0.46, 0.68, 1.0), clamp((shift - 0.92) * 2.2, 0.0, 1.0));
    col = mix(col, vec3(1.0, 0.13, 0.02), clamp((0.90 - shift) * 1.45, 0.0, 1.0));

    // The beaming used to drive the approaching arm to 6-10 linear, and the page's
    // tone curve is 0.99 by 3.2: the arm clipped to paper white and the blue never
    // reached the screen. A soft ceiling keeps the beaming contrast (it is a ratio
    // in the midtones, where the curve still has slope) and drops the clipping.
    float emis = dens * (0.46 + 4.0 * pow(1.0 - t, 3.0)) * pow(shift, BEAM_P) * 0.36;
    emis /= 1.0 + emis * EMIS_CEIL;
    float alpha = 1.0 - exp(-dens * 1.55);
    return vec4(col * emis, alpha);
  }

  void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    float aspect = uRes.x / uRes.y;
    uv.x *= aspect;

    // A sub-pixel jitter, one pixel wide and not more: the higher-order images are
    // genuinely thinner than a pixel, so without it they alias into a dotted
    // hairline, and with it they dissolve into the grain the grade pass is already
    // laying down. It is scaled by the march's own resolution, because where the
    // march is upscaled the bilinear fetch is already blurring.
    // It used to offset by (ign(fc), ign(fc.yx)) — the same plane-wave function
    // read twice, so every offset lived on the line (t, t), a one-dimensional
    // family. At DPR 1, where the march runs 1:1 with the canvas and nothing
    // upscales it, that printed a crosshatch weave across the bright inner rim.
    // IGN now sets only the angle, which is where its low-discrepancy spread earns
    // its keep, and a white-noise radius fills the disc: neighbouring pixels no
    // longer share a direction. (The stipple under it was the disk out-running the
    // sample rate; that is handled by the footprint term in diskSample.)
    vec2 fc = gl_FragCoord.xy;
    float ja = ign(fc) * 6.28318531;
    float jr = 0.5 * sqrt(hash12(fc + 11.37));
    uv += vec2(cos(ja), sin(ja)) * jr * (2.0 * uJitter / uRes.y);

    // fit the scene by width on portrait screens: a shorter focal is a wider lens
    float focal = FOCAL * min(1.0, aspect * 1.05);
    // the angle one march pixel subtends: the yardstick for every footprint below
    float pixAng = 2.0 / (uRes.y * focal);

    vec3 rd0 = normalize(uCamFwd * focal + uCamRight * uv.x + uCamUp * uv.y);

    // ————— the ray's orbital plane: a null geodesic never leaves span(e1, e2) —————
    float r0 = length(uCamPos);
    vec3 e1 = uCamPos / r0;              // radial at the camera
    float vr = dot(rd0, e1);
    vec3 tv = rd0 - e1 * vr;
    float tl = max(length(tv), 1e-5);
    vec3 e2 = tv / tl;                   // transverse, in the direction of travel

    // u = 1/r as a function of the angle φ swept around the hole
    float u = 1.0 / r0;
    float du = -vr / (tl * r0);
    float acc = -u + 3.0 * MASS * u * u;

    // φ advances by a fixed step, so the rotation is one 2x2 multiply per step
    float c = 1.0;
    float s = 0.0;
    float cd = cos(DPHI);
    float sd = sin(DPHI);

    // per step we only need one scalar: height above the disk. the 3d point is
    // rebuilt only where the disk is actually crossed.
    float y1 = e1.y;
    float y2 = e2.y;
    float pr = r0;
    float pc = 1.0;
    float ps = 0.0;
    float py = uCamPos.y;

    vec3 col = vec3(0.0);
    float trans = 1.0; // how much of what lies further along the ray still reaches us
    bool captured = false;
    float swept = 0.0; // total angle wound around the hole: the sky's magnification

    for (int i = 0; i < MAX_STEPS; i++) {
      if (float(i) >= uMaxSteps) break;

      // velocity verlet on d²u/dφ² = -u + 3M u²
      u += du * DPHI + 0.5 * acc * DPHI * DPHI;
      if (u > 1.0 / (2.0 * MASS)) { captured = true; break; } // past the horizon
      if (u < U_SKY && du < 0.0) break;                       // out to the sky
      float a2 = -u + 3.0 * MASS * u * u;
      du += 0.5 * (acc + a2) * DPHI;
      acc = a2;

      float nc = c * cd - s * sd;
      s = s * cd + c * sd;
      c = nc;
      swept += DPHI;

      float r = 1.0 / u;
      float ny = r * (c * y1 + s * y2);

      if (py * ny < 0.0) {
        vec3 pa = pr * (pc * e1 + ps * e2);
        vec3 pb = r * (c * e1 + s * e2);
        vec3 dir = normalize(pb - pa);

        vec3 q = mix(pa, pb, py / (py - ny));
        float rd = length(q.xz);
        if (rd > R_IN && rd < R_OUT) {
          // φ swept so far: past about 150° the ray is imaging the disk through
          // a lens that compresses a huge patch into a hairline
          vec4 e = diskSample(rd, q, dir, smoothstep(1.6, 3.6, swept), pixAng * length(q - uCamPos));
          col += e.rgb * trans;
          trans *= 1.0 - e.a;
        }

        if (trans < 0.03) break; // everything behind this is hidden anyway
      }

      pr = r;
      pc = c;
      ps = s;
      py = ny;
    }

    // ————— the sky the ray finally points at, after everything bent it —————
    if (!captured && trans > 0.012) {
      float rr = 1.0 / u;
      float drdphi = -du * rr * rr;
      vec3 sd = normalize((drdphi * c - rr * s) * e1 + (drdphi * s + rr * c) * e2);

      // How far the lens has smeared this bit of sky. For a spherically symmetric
      // lens the tangential stretch is exactly sin(screen angle) / sin(sky angle)
      // about the axis through the hole, and with the camera only 5.6M out it is
      // above 1 across the whole frame — which is the honest reason the sky used to
      // be full of scratches leaning the same way. A star smeared a few times its
      // own width is still a star; smeared twenty times it is a scratch on the lens,
      // and near the ring, where the whole sky folds into a hairline, it is grit.
      // So the field fades out as the smear grows and the sky goes back to black.
      float sinT = length(uv) * inversesqrt(focal * focal + dot(uv, uv));
      float sinB = length(cross(sd, uCamFwd));
      float smear = sinT / max(sinB, 1e-4);
      float calm = 1.0 - smoothstep(4.0, 9.0, smear);
      // the floor under a star's own size: one march pixel, plus the most the lens
      // can squeeze one radially (a factor of two), so none of them lands sub-pixel
      col += skyColor(sd, pixAng * 1.6) * (trans * calm);
    }

    // lift pure black a touch so the void stays filmic
    col += vec3(0.006, 0.005, 0.006);

    gl_FragColor = vec4(col, 1.0);
  }
`;

// Grade pass: runs once over the bloomed HDR buffer, straight to the canvas.
// vignette in linear, tone curve, display encoding, then luminance-weighted
// film grain sized to the device pixel and an interleaved-gradient-noise
// dither so the void never bands.
export const gradeFragmentShader = /* glsl */ `
  precision highp float;

  #include <tonemapping_pars_fragment>

  varying vec2 vUv;

  uniform sampler2D tScene;
  uniform float uTime;
  uniform float uGrain;
  uniform int uTone; // 0 house curve (the original in-march curve), 1 AgX, 2 ACES

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // Jimenez 2014
  float ign(vec2 p) {
    return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
  }

  void main() {
    vec3 col = texture2D(tScene, vUv).rgb;

    // vignette on the linear signal, the same falloff the march used to apply
    vec2 vg = vUv - 0.5;
    col *= 1.0 - dot(vg, vg) * 1.15;

    if (uTone == 1) {
      col = sRGBTransferOETF(vec4(AgXToneMapping(col), 1.0)).rgb;
    } else if (uTone == 2) {
      col = sRGBTransferOETF(vec4(ACESFilmicToneMapping(col), 1.0)).rgb;
    } else {
      col *= toneMappingExposure;
      col = 1.0 - exp(-col * 1.45);
      col = pow(col, vec3(0.9));
    }

    // film grain: one speck per device pixel, quieter in the highlights
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    vec2 seed = gl_FragCoord.xy + vec2(fract(uTime * 1.618), fract(uTime * 2.236)) * 1024.0;
    col += (hash12(seed) - 0.5) * uGrain * (1.0 - 0.75 * luma);

    // dither +-0.5/255
    col += (ign(gl_FragCoord.xy) - 0.5) / 255.0;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;
