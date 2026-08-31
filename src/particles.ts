import * as THREE from 'three';

export type ThemeName = 'dark' | 'light';

export interface ParticleHandle {
  setTheme: (theme: ThemeName) => void;
  setScroll: (progress: number) => void;
}

// Fullscreen particle backdrop for the homepage, two systems cross-faded by
// theme: "Nebula" (dark) — starfield + three volumetric clouds, camera pans on
// scroll; "River" (light) — caustic shallow-water band + dark-blue particle
// current that swells (denser, bigger) on scroll.

const DPR = Math.min(window.devicePixelRatio, 2);

const SOFT_DOT_FRAG = /* glsl */ `
  precision highp float;
  uniform float uAlpha;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    a *= a * uAlpha * vFade;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

// ————— nebula (dark theme) —————

const STARS_VERT = /* glsl */ `
  attribute float aRand;
  attribute float aT;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = 0.85 * uPixelRatio * (0.4 + aRand) * (3.0 / -mv.z);
    float tw = 0.55 + 0.45 * sin(uTime * (1.0 + aRand * 2.5) + aRand * 40.0);
    vec3 tint = aT < 0.6 ? vec3(1.0) : (aT < 0.85 ? vec3(0.72, 0.84, 1.0) : vec3(1.0, 0.88, 0.72));
    vColor = tint;
    vFade = tw * smoothstep(10.0, 2.5, -mv.z);
  }
`;

const NEBULA_VERT = /* glsl */ `
  attribute float aRand;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vec3 p = position;
    // slow differential swirl — inner points orbit faster, like a galaxy
    float ang = uTime * 0.035 * (0.4 + aRand) / (0.35 + 0.4 * length(p.xz));
    float c = cos(ang), s = sin(ang);
    p.xz = mat2(c, -s, s, c) * p.xz;
    p += 0.05 * vec3(
      sin(uTime * 0.5 + aRand * 6.2831),
      cos(uTime * 0.4 + aRand * 12.566),
      sin(uTime * 0.3 + aRand * 3.0)
    );
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (0.5 + aRand * 1.7) * (3.0 / -mv.z);
    vColor = aColor;
    vFade = smoothstep(8.0, 2.0, -mv.z);
  }
`;

interface CloudSpec {
  center: [number, number, number];
  spread: [number, number, number];
  colA: number;
  colB: number;
}

// teal / violet / ember — pulled from the lagoon and earth-limb photos
const CLOUDS: CloudSpec[] = [
  { center: [-1.1, 0.45, -1.2], spread: [1.5, 0.8, 0.9], colA: 0x2fd8c0, colB: 0x14586e },
  { center: [1.0, -0.35, -0.8], spread: [1.3, 0.9, 0.8], colA: 0x9a6bff, colB: 0x3a2370 },
  { center: [0.15, 0.95, -1.6], spread: [1.1, 0.6, 0.7], colA: 0xffb054, colB: 0x8a3d1a },
];

// ————— river (light theme) —————

const QUAD_VERT = /* glsl */ `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

// shallow tropical water: pale sandbar mid-channel → teal banks, caustic
// light webs advected downstream, sun glints, foam at the shoreline
const RIVER_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uRes;
  uniform float uFade;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec2(11.3, 7.9);
      a *= 0.5;
    }
    return v;
  }

  // rippling light webs, like sun through shallow clear water
  float caustics(vec2 uv, float time) {
    vec2 p = mod(uv * 6.2831, 6.2831) - 250.0;
    vec2 i = p;
    float c = 1.0;
    float inten = 0.005;
    for (int n = 0; n < 4; n++) {
      float t = time * (1.0 - (3.5 / float(n + 1)));
      i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
      c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
    }
    c /= 4.0;
    c = 1.17 - pow(c, 1.4);
    return pow(abs(c), 7.0);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / uRes.xy;
    // world units on the z=0 plane, so the particles share the same river
    float worldH = 3.17; // visible height at camera z = 3.4, fov 50
    float worldX = (uv.x - 0.5) * (uRes.x / uRes.y) * worldH;
    float worldY = (uv.y - 0.5) * worldH;
    float t = uTime * 0.4;

    // the river: a meandering band through the sky (static banks, moving water)
    float center = -0.25 + 0.28 * sin(worldX * 0.8) + 0.14 * sin(worldX * 1.7);
    float halfW = 0.55 + 0.10 * sin(worldX * 1.3 + 1.3);
    float bank = abs(worldY - center);

    float inside = 1.0 - smoothstep(halfW - 0.10, halfW, bank);
    float depth = smoothstep(0.0, halfW, bank);

    vec3 cSand = vec3(0.851, 0.957, 0.937);
    vec3 cAqua = vec3(0.659, 0.902, 0.867);
    vec3 cTurq = vec3(0.373, 0.792, 0.733);
    vec3 cDeep = vec3(0.114, 0.498, 0.514);

    // large soft patches of sunlight and sand through clear water
    float patch = fbm(vec2(worldX * 0.9 - t * 0.3, worldY * 1.6));
    vec3 col = mix(cSand, cAqua, smoothstep(0.25, 0.75, patch));
    col = mix(col, cTurq, depth * 0.55);
    col = mix(col, cDeep, depth * depth * 0.6);

    // caustic light networks rippling downstream
    vec2 cuv = vec2(worldX * 0.55 - t * 0.28, worldY * 1.1);
    float ca = caustics(cuv, t * 0.5);
    col += vec3(0.95, 1.0, 0.98) * ca * 0.6;

    // sun glints on the ripple crests
    float glint = pow(noise(vec2(worldX * 9.0 - t * 1.6, worldY * 14.0)), 18.0);
    col += vec3(1.0) * glint * 0.5;

    // faint white water hugging the banks
    float foamBand = smoothstep(halfW * 0.55, halfW * 0.95, bank);
    float foamN = fbm(vec2(worldX * 3.0 - t * 0.9, worldY * 6.0));
    col = mix(col, vec3(0.96, 1.0, 0.99), foamBand * foamN * 0.45);

    gl_FragColor = vec4(col, inside * 0.97 * uFade);
  }
`;

const WATER_VERT = /* glsl */ `
  attribute float aRand;
  attribute float aT;
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uDensity;
  varying vec3 vColor;
  varying float vFade;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uFoam;
  void main() {
    // scroll-driven density: a fixed per-point subset sits offscreen until
    // uDensity rises past its threshold — more water streams in as you scroll
    if (aRand > uDensity) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vColor = vec3(0.0);
      vFade = 0.0;
      return;
    }
    vec3 p = position;
    // the current: advect left → right, wrap around, faster near the surface
    float flow = uTime * (0.35 + aRand * 0.3 + p.y * 0.08);
    p.x = mod(p.x + flow + 2.6, 5.2) - 2.6;
    // undulation — two crossing wave trains
    float wave = sin(p.x * 2.2 + uTime * 0.9 + aRand * 6.2831)
               + 0.5 * sin(p.x * 4.1 - uTime * 1.3 + aRand * 3.0);
    p.y += 0.14 * wave;
    p.z += 0.08 * cos(p.x * 1.7 + uTime * 0.7);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (0.5 + aRand) * (3.0 / -mv.z);
    float crest = clamp(wave * 0.5 + 0.5, 0.0, 1.0);
    vec3 base = mix(uDeep, uShallow, aT);
    vColor = mix(base, uFoam, crest * crest * 0.85);
    vFade = smoothstep(2.6, 2.1, abs(p.x)) * smoothstep(6.5, 2.5, -mv.z);
  }
`;

export function initParticles(canvas: HTMLCanvasElement, reduced: boolean): ParticleHandle {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(DPR);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 30);
  camera.position.z = 3.4;

  // ——— nebula system (dark theme) ———
  const nebulaGroup = new THREE.Group();
  nebulaGroup.position.x = 0.25;
  scene.add(nebulaGroup);
  const nebulaMats: { mat: THREE.ShaderMaterial; baseAlpha: number }[] = [];

  {
    // layer 1: distant starfield
    const count = 12000;
    const pos = new Float32Array(count * 3);
    const aRand = new Float32Array(count);
    const aT = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * 7;
      pos[i * 3 + 1] = (Math.random() * 2 - 1) * 4.5;
      pos[i * 3 + 2] = -6 + Math.random() * 8;
      aRand[i] = Math.random();
      aT[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(aRand, 1));
    geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: STARS_VERT,
      fragmentShader: SOFT_DOT_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: DPR },
        uAlpha: { value: 0.9 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    nebulaGroup.add(new THREE.Points(geo, mat));
    nebulaMats.push({ mat, baseAlpha: 0.9 });
  }

  {
    // layer 2: volumetric clouds
    const PER_CLOUD = 22000;
    for (const spec of CLOUDS) {
      const pos = new Float32Array(PER_CLOUD * 3);
      const col = new Float32Array(PER_CLOUD * 3);
      const aRand = new Float32Array(PER_CLOUD);
      const colA = new THREE.Color(spec.colA);
      const colB = new THREE.Color(spec.colB);
      const tmp = new THREE.Color();
      for (let i = 0; i < PER_CLOUD; i++) {
        let x = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
        let y = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
        let z = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
        const clump = 0.55 + 0.45 * Math.sin(x * 7.0) * Math.sin(y * 5.0 + z * 3.0);
        x *= clump;
        y *= clump;
        z *= clump;
        pos[i * 3] = spec.center[0] + x * spec.spread[0];
        pos[i * 3 + 1] = spec.center[1] + y * spec.spread[1];
        pos[i * 3 + 2] = spec.center[2] + z * spec.spread[2];
        tmp.copy(colA).lerp(colB, Math.random());
        col[i * 3] = tmp.r;
        col[i * 3 + 1] = tmp.g;
        col[i * 3 + 2] = tmp.b;
        aRand[i] = Math.random();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aRand', new THREE.BufferAttribute(aRand, 1));
      const mat = new THREE.ShaderMaterial({
        vertexShader: NEBULA_VERT,
        fragmentShader: SOFT_DOT_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uSize: { value: 2.3 },
          uPixelRatio: { value: DPR },
          uAlpha: { value: 0.5 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      nebulaGroup.add(new THREE.Points(geo, mat));
      nebulaMats.push({ mat, baseAlpha: 0.5 });
    }
  }

  // ——— river system (light theme) ———
  const riverGroup = new THREE.Group();
  riverGroup.position.y = 0.05;
  scene.add(riverGroup);

  const waterMat = new THREE.ShaderMaterial({
    vertexShader: WATER_VERT,
    fragmentShader: SOFT_DOT_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: 1.55 },
      uPixelRatio: { value: DPR },
      uDensity: { value: 0.35 },
      uAlpha: { value: 0.7 },
      uDeep: { value: new THREE.Color(0x123f6e) },
      uShallow: { value: new THREE.Color(0x2f6fb4) },
      uFoam: { value: new THREE.Color(0xbfe0f7) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  {
    const count = 80000;
    const pos = new Float32Array(count * 3);
    const aRand = new Float32Array(count);
    const aT = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() * 2 - 1) * 2.6;
      // same meander as the caustic shader — particles ride inside the banks
      const centerY = -0.25 + 0.28 * Math.sin(x * 0.8) + 0.14 * Math.sin(x * 1.7);
      const halfW = 0.55 + 0.10 * Math.sin(x * 1.3 + 1.3);
      pos[i * 3] = x;
      pos[i * 3 + 1] = centerY + (Math.random() - 0.5) * halfW * 0.9;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
      aRand[i] = Math.random();
      aT[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(aRand, 1));
    geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
    riverGroup.add(new THREE.Points(geo, waterMat));
  }

  // caustic water pass, painted behind the particles (light theme only)
  const bgScene = new THREE.Scene();
  const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const bgUniforms = {
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uFade: { value: 0 },
  };
  bgScene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: RIVER_FRAG,
        uniforms: bgUniforms,
        depthWrite: false,
        transparent: true,
      })
    )
  );

  // ——— theme + scroll state ———
  let theme: ThemeName = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  let nebulaFade = theme === 'dark' ? 1 : 0;
  let riverFade = 1 - nebulaFade;
  let nebulaTarget = nebulaFade;
  let riverTarget = riverFade;
  let scrollTarget = 0;
  let scrollSmooth = 0;

  const mouse = new THREE.Vector2(0, 0);

  function applyFades(): void {
    for (const { mat, baseAlpha } of nebulaMats) {
      mat.uniforms.uAlpha.value = baseAlpha * nebulaFade;
    }
    waterMat.uniforms.uAlpha.value = 0.7 * riverFade;
    bgUniforms.uFade.value = riverFade;
    nebulaGroup.visible = nebulaFade > 0.004;
    riverGroup.visible = riverFade > 0.004;
  }

  function renderScene(): void {
    if (riverGroup.visible) {
      renderer.autoClear = true;
      renderer.render(bgScene, bgCam);
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = true;
    } else {
      renderer.render(scene, camera);
    }
  }

  const bufferSize = new THREE.Vector2();
  function resize(): void {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.getDrawingBufferSize(bufferSize);
    bgUniforms.uRes.value.copy(bufferSize);
  }
  resize();

  if (reduced) {
    // one considered frame per state change, no perpetual motion
    const still = theme === 'dark' ? 8 : 6;
    const renderStill = (): void => {
      for (const { mat } of nebulaMats) mat.uniforms.uTime.value = still;
      waterMat.uniforms.uTime.value = still;
      waterMat.uniforms.uDensity.value = 0.58;
      waterMat.uniforms.uSize.value = 2.0;
      bgUniforms.uTime.value = still;
      applyFades();
      renderScene();
    };
    renderStill();
    window.addEventListener('resize', () => {
      resize();
      renderStill();
    });
    return {
      setTheme(next: ThemeName): void {
        theme = next;
        nebulaFade = nebulaTarget = next === 'dark' ? 1 : 0;
        riverFade = riverTarget = 1 - nebulaFade;
        renderStill();
      },
      setScroll(): void {
        /* static frame — scroll does not move it */
      },
    };
  }

  window.addEventListener('pointermove', (event) => {
    mouse.set(
      event.clientX / window.innerWidth - 0.5,
      event.clientY / window.innerHeight - 0.5
    );
  });

  let frameId = 0;
  let running = true;
  let last = performance.now();
  let time = 0;

  function frame(now: number): void {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    time += dt;

    nebulaFade += (nebulaTarget - nebulaFade) * 0.09;
    riverFade += (riverTarget - riverFade) * 0.09;
    scrollSmooth += (scrollTarget - scrollSmooth) * 0.08;
    applyFades();

    for (const { mat } of nebulaMats) mat.uniforms.uTime.value = time;
    waterMat.uniforms.uTime.value = time;
    bgUniforms.uTime.value = time;

    const s = scrollSmooth;
    // the river swells as you descend: more points, bigger points
    waterMat.uniforms.uDensity.value = 0.35 + s * 0.65;
    waterMat.uniforms.uSize.value = 1.55 * (1 + s * 1.6);

    if (theme === 'dark') {
      camera.position.x += (mouse.x * 0.4 - camera.position.x) * 0.045;
      camera.position.y += (-mouse.y * 0.3 - s * 0.9 - camera.position.y) * 0.06;
      camera.lookAt(nebulaGroup.position.x, nebulaGroup.position.y - s * 0.4, 0);
      nebulaGroup.rotation.y = s * 1.1;
    } else {
      camera.position.x += (mouse.x * 0.25 - camera.position.x) * 0.045;
      camera.position.y += (-mouse.y * 0.2 - camera.position.y) * 0.05;
      camera.lookAt(0, 0.05, 0);
    }

    renderScene();
    frameId = requestAnimationFrame(frame);
  }
  frameId = requestAnimationFrame(frame);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(frameId);
    } else if (!running) {
      running = true;
      last = performance.now();
      frameId = requestAnimationFrame(frame);
    }
  });

  window.addEventListener('resize', resize);

  return {
    setTheme(next: ThemeName): void {
      theme = next;
      nebulaTarget = next === 'dark' ? 1 : 0;
      riverTarget = 1 - nebulaTarget;
    },
    setScroll(progress: number): void {
      scrollTarget = Math.min(1, Math.max(0, progress));
    },
  };
}
