export const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Exhibit 001 — a black hole rendered by bending rays through a simple
// gravitational potential. One march handles capture (event horizon),
// the accretion disk (plane y=0), and a code sheet (plane x=XS) that gets
// lensed into the hole. No meshes, no assets — everything is this shader.
export const fragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform float uTime;
  uniform vec2 uRes;
  uniform vec3 uCamPos;
  uniform vec3 uCamRight;
  uniform vec3 uCamUp;
  uniform vec3 uCamFwd;
  uniform sampler2D uCodeTex;
  uniform float uMaxSteps;

  #define R_HOLE 1.0
  #define R_IN 1.25
  #define R_OUT 4.4
  #define FOCAL 1.42
  #define MAX_STEPS 64
  #define SHEET_Z 2.0

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
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

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p);
      p = p * 2.13 + vec2(17.3, 9.1);
      a *= 0.5;
    }
    return v;
  }

  // accretion disk shading at a crossing point (xz, radius rd)
  vec3 diskColor(float rd, vec2 xz, float beam) {
    float t = clamp((rd - R_IN) / (R_OUT - R_IN), 0.0, 1.0);

    // keplerian differential rotation: inner material orbits faster
    float omega = 2.2 * pow(rd, -1.5);
    float ca = cos(uTime * omega);
    float sa = sin(uTime * omega);
    vec2 rp = mat2(ca, sa, -sa, ca) * xz;
    float d = fbm(rp * 2.1) * 0.62 + fbm(rp * 4.9 + 3.7) * 0.38;
    d = smoothstep(0.42, 0.95, d);

    float prof = smoothstep(R_IN, R_IN + 0.2, rd) * (1.0 - smoothstep(2.6, 4.2, rd));

    vec3 col = mix(vec3(1.0, 0.97, 0.90), vec3(1.0, 0.55, 0.18), smoothstep(0.0, 0.30, t));
    col = mix(col, vec3(1.0, 0.30, 0.0), smoothstep(0.28, 0.70, t));
    col = mix(col, vec3(0.40, 0.06, 0.01), smoothstep(0.70, 1.0, t));

    // doppler beaming: the side rotating toward the viewer burns brighter
    float bright = d * prof * (0.6 + 7.0 * pow(1.0 - t, 3.0)) * (1.0 + 0.9 * beam);
    return col * bright;
  }

  void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    float aspect = uRes.x / uRes.y;
    uv.x *= aspect;

    // fit the scene by width on portrait screens
    float focal = FOCAL / min(1.0, aspect * 1.2);

    vec3 v = normalize(uCamFwd * focal + uCamRight * uv.x + uCamUp * uv.y);
    vec3 p = uCamPos;

    vec3 col = vec3(0.0);
    float minR = 100.0; // true closest approach along the path
    bool captured = false;

    float prevY = p.y;
    float prevZ = p.z - SHEET_Z;

    for (int i = 0; i < MAX_STEPS; i++) {
      if (float(i) >= uMaxSteps) break;
      float r2 = dot(p, p);
      float r = sqrt(r2);
      if (r < R_HOLE) { captured = true; break; }
      if (r > 10.0) break;

      float dt = 0.05 + 0.17 * smoothstep(1.1, 5.5, r);
      vec3 acc = -1.55 * p / (r2 * r);
      v = normalize(v + acc * dt);

      // closest point of this segment to the origin
      float seg = clamp(-dot(p, v), 0.0, dt);
      minR = min(minR, length(p + v * seg));

      vec3 np = p + v * dt;

      // — accretion disk: crossing of plane y=0 —
      if (prevY * np.y < 0.0) {
        float t = p.y / (p.y - np.y);
        vec3 q = mix(p, np, t);
        float rd = length(q.xz);
        if (rd > R_IN && rd < R_OUT) {
          vec3 tang = normalize(vec3(q.z, 0.0, -q.x));
          float beam = dot(tang, normalize(uCamPos - q));
          col += diskColor(rd, q.xz, beam) * 0.85;
        }
      }

      // — code sheet: crossing of plane z=SHEET_Z, a curtain facing the camera —
      // gated on approach: rays that already grazed the hole carry ghost images
      float cz = np.z - SHEET_Z;
      if (prevZ * cz < 0.0 && minR > 1.35) {
        float t = prevZ / (prevZ - cz);
        vec3 q = mix(p, np, t);
        float eu = (q.x - 1.3) / 3.6;
        float ev = (q.y + 2.2) / 4.4;
        vec2 cuv = vec2(eu, ev + uTime * 0.008);
        vec3 tex = texture2D(uCodeTex, cuv).rgb;
        float edge = smoothstep(0.0, 0.14, eu) * smoothstep(1.0, 0.94, eu)
                   * smoothstep(0.0, 0.06, ev) * smoothstep(1.0, 0.94, ev);
        float fade = smoothstep(1.3, 2.2, length(q)) * (1.0 - smoothstep(3.4, 5.4, length(q)));
        col += tex * edge * fade * 0.55;
      }

      p = np;
      prevY = p.y;
      prevZ = cz;
    }

    // — photon ring + inner glow, from closest approach —
    // gated on survival: captured paths must leave the shadow black
    if (!captured) {
      float ring = exp(-pow((minR - 1.01) / 0.012, 2.0));
      col += vec3(1.0, 0.98, 0.94) * ring * 1.6;
      col += vec3(1.0, 0.45, 0.15) * 0.09 * exp(-max(minR - 1.0, 0.0) * 4.5);

      // — starfield along the surviving ray direction —
      vec3 sp = v * 46.0;
      vec3 id = floor(sp);
      vec3 f = fract(sp) - 0.5;
      float h = hash13(id);
      float star = step(0.988, h) * smoothstep(0.45, 0.05, length(f));
      float tw = 0.7 + 0.3 * sin(uTime * 2.2 + h * 90.0);
      col += vec3(0.85, 0.90, 1.0) * star * tw * 0.8;
    }

    // lift pure black a touch so the void stays filmic
    col += vec3(0.006, 0.005, 0.006);

    // vignette
    vec2 vg = vUv - 0.5;
    col *= 1.0 - dot(vg, vg) * 1.15;

    // soft filmic tonemap
    col = 1.0 - exp(-col * 1.45);
    col = pow(col, vec3(0.9));

    gl_FragColor = vec4(col, 1.0);
  }
`;
