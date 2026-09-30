/* ————— Lab 05 · Tender: the three.js side, loaded behind the preloader curtain ————— */
// main.ts mounts the chrome, the curtain and the scroll model, then imports this module.
// boot() resolves once the first real frame is up.
//
// The canvas is transparent and sits between the sections' CSS backgrounds and their text,
// so the colours are exact CSS and the words stay DOM-sharp; only the coins are drawn here.

import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { watchQuality, startLoop, setupRendererDebug, type FrameLoop } from '../lab-quality';
import type { LabChrome, Preloader } from '../lab-chrome';
import type { ScrollModel } from './scroll';
import { N, THICK, LOOP, FLIP, END, pose, target, surface, hash, type Frame } from './formations';

export interface BootOptions {
  chrome: LabChrome;
  loader: Preloader;
  scroll: ScrollModel;
}

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const PHONE = '(max-width: 700px)';

// the springs every coin chases its target with: slightly under-damped, so a hard scroll
// overshoots and settles instead of arriving on rails
const K_POS = 90;
const K_ROT = 80;
const K_SCALE = 130;
const ZETA = 0.72;
const ZETA_LAND = 0.42; // the stack: a coin that lands should bounce
const ZETA_SCALE = 0.55;

/* ————— the coin: a revolved profile, face, rounded rim, face ————— */

function coinGeometry(): THREE.LatheGeometry {
  const h = THICK / 2;
  const b = 0.045; // rim radius
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, -h)];
  // bottom face out to the rim, around the rim, back in across the top face; outward normals
  // need this order (LatheGeometry derives them from the profile's direction)
  const arc = (cx: number, cy: number, a0: number, a1: number): void => {
    for (let k = 0; k <= 10; k++) {
      const a = a0 + ((a1 - a0) * k) / 10;
      pts.push(new THREE.Vector2(cx + b * Math.cos(a), cy + b * Math.sin(a)));
    }
  };
  arc(1 - b, -h + b, -Math.PI / 2, 0);
  arc(1 - b, h - b, 0, Math.PI / 2);
  pts.push(new THREE.Vector2(0, h));
  return new THREE.LatheGeometry(pts, 96);
}

/* ————— the studio the coins reflect: a dim dome and five softboxes ————— */

function studio(): THREE.Scene {
  const s = new THREE.Scene();
  const dome = new THREE.SphereGeometry(20, 48, 24);
  // the dome is dim on purpose: a big bright dome is mostly diffuse light and flattens every
  // face, while small bright softboxes give highlights and little else
  const top = new THREE.Color(1.0, 0.9, 0.86).multiplyScalar(0.42);
  const horizon = new THREE.Color(0.95, 0.56, 0.5).multiplyScalar(0.32);
  const bottom = new THREE.Color(0.5, 0.16, 0.24).multiplyScalar(0.14);
  const colors: number[] = [];
  const pos = dome.getAttribute('position');
  const c = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    const y = pos.getY(k) / 20;
    if (y >= 0) c.lerpColors(horizon, top, Math.pow(y, 0.7));
    else c.lerpColors(horizon, bottom, Math.pow(-y, 0.6));
    colors.push(c.r, c.g, c.b);
  }
  dome.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  s.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const box = (w: number, h: number, x: number, y: number, z: number, color: THREE.Color): void => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  box(10, 7, -7, 9, 10, new THREE.Color(1, 0.97, 0.95).multiplyScalar(7)); // key, high front left
  box(18, 2, 6, 3, -12, new THREE.Color(1, 0.88, 0.82).multiplyScalar(8)); // rim strip behind
  box(7, 7, 11, -4, 6, new THREE.Color(1, 0.66, 0.52).multiplyScalar(2.4)); // warm fill, low right
  box(16, 3, 0, -10, 9, new THREE.Color(1, 0.8, 0.72).multiplyScalar(3)); // a card under the lens: lower rims catch it
  box(5, 3, 3, 16, 2, new THREE.Color(1, 0.95, 0.92).multiplyScalar(6)); // top light: a glossy patch on faces turned up
  return s;
}

/* ————— boot ————— */

export async function boot({ chrome, loader, scroll }: BootOptions): Promise<void> {
  const canvas = document.getElementById('tn-gl') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    premultipliedAlpha: true,
    powerPreference: 'high-performance',
  });
  setupRendererDebug(renderer);
  let dprCap = 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.8; // keeps a lit face under PBR Neutral's knee, where its gradient survives
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 60);
  camera.position.set(0, 0, 14);
  const root = new THREE.Group(); // the pointer tilts this
  scene.add(root);

  /* ————— light ————— */

  loader.set(0.4, 'building the studio');
  // an environment map is a render target: its pixels exist only on the GPU, so a lost context
  // takes them and the restore has to render the studio again
  function buildEnv(): void {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = studio();
    scene.environment = pmrem.fromScene(envScene, 0.035).texture;
    envScene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    pmrem.dispose();
  }
  buildEnv();
  scene.environmentIntensity = 0.9;

  // A flat face under a distant light is one flat colour: the falloff across each face comes
  // from the shader (vGrad, below). The area light adds a soft sheet of highlight; the
  // directional light is mostly there for the shadows coins lay on each other.
  RectAreaLightUniformsLib.init();
  const area = new THREE.RectAreaLight(0xfff1ea, 3.2, 9, 6);
  area.position.set(-5.5, 6.5, 7.5);
  area.lookAt(0, 0, 0);
  scene.add(area);
  const key = new THREE.DirectionalLight(0xfff0e8, 0.9);
  key.position.set(-5, 7, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 5;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 40;
  scene.add(key, key.target);
  // bounce from whatever section is behind the coins: rose, then red, then blush, then rose
  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.4);
  scene.add(hemi);
  const ROSE = new THREE.Color('#d24a6c');
  const RED = new THREE.Color('#e02f18');
  const BLUSH = new THREE.Color('#fbe9e3');
  const bounce = new THREE.Color();

  /* ————— the cast: eighteen coins, one instanced mesh ————— */

  loader.set(0.55, 'minting');
  const geometry = coinGeometry();
  const uniforms = {
    uHeads: { value: new THREE.Color('#f06a5a') },
    uTails: { value: new THREE.Color('#f8c3aa') },
    uGrain: { value: 0.022 },
    uTime: { value: 0 },
    uLightDir: { value: new THREE.Vector3(-0.5, 0.75, 0.45).normalize() },
  };
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.36,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.14,
    sheen: 0.45,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color('#ffd9cf'),
    specularIntensity: 0.6,
    dithering: true,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vFace;\nvarying float vGrad;\nuniform vec3 uLightDir;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvFace = objectNormal.y;')
      .replace(
        '#include <project_vertex>',
        // how far across its own coin this point sits toward the key light, -1..1: a flat face
        // under a distant light is one colour, and this is the falloff a softbox close by would give
        `#include <project_vertex>
        #ifdef USE_INSTANCING
          vec3 tnC = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec3 tnP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          float tnS = length((modelMatrix * instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
          vGrad = dot(tnP - tnC, uLightDir) / max(tnS, 1e-4);
        #else
          vGrad = 0.0;
        #endif`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vFace;
        varying float vGrad;
        uniform vec3 uHeads;
        uniform vec3 uTails;
        uniform float uGrain;
        uniform float uTime;
        float tnHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`
      )
      .replace(
        '#include <color_fragment>',
        // heads or tails: the side the face was on before the coin was placed
        `#include <color_fragment>
        diffuseColor.rgb *= mix(uTails, uHeads, smoothstep(-0.25, 0.25, vFace));
        // toward the light a face runs pale peach, away from it a deeper rose
        diffuseColor.rgb *= mix(vec3(0.78, 0.6, 0.62), vec3(1.16, 1.1, 1.02), clamp(vGrad * 0.5 + 0.5, 0.0, 1.0));`
      )
      .replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\ngl_FragColor.rgb += (tnHash(gl_FragCoord.xy + fract(uTime * 1.618) * 1024.0) - 0.5) * uGrain;'
      );
  };
  const mesh = new THREE.InstancedMesh(geometry, material, N);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // the instances roam; the geometry's own bounds say nothing
  const tint = new THREE.Color();
  for (let i = 0; i < N; i++) {
    // no two coins quite the same: a little rose, a little apricot
    tint.setRGB(1, 0.94 + 0.06 * hash(i, 11), 0.9 + 0.1 * hash(i, 12));
    mesh.setColorAt(i, tint);
  }
  root.add(mesh);

  // the table under the flip grid and the floor under the stack: only the coins' shadows show
  const catcherMat = new THREE.ShadowMaterial({ color: new THREE.Color('#6d1026'), opacity: 0, transparent: true });
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), catcherMat);
  catcher.receiveShadow = true;
  catcher.visible = false;
  root.add(catcher);
  const surfacePose = pose();

  /* ————— per-coin springs ————— */

  interface Coin {
    p: THREE.Vector3;
    v: THREE.Vector3;
    q: THREE.Quaternion;
    w: THREE.Vector3; // angular velocity, world
    s: number;
    sv: number;
    k: number; // stiffness, a little different per coin so they never move in lockstep
    flipped: boolean;
  }
  const coins: Coin[] = [];
  for (let i = 0; i < N; i++) {
    coins.push({
      p: new THREE.Vector3(),
      v: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      w: new THREE.Vector3(),
      s: 0,
      sv: 0,
      k: 0.85 + 0.3 * hash(i, 9),
      flipped: false,
    });
  }

  const goal = pose();
  const FLIPPED = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  const frame: Frame = { W: 1, H: 1, wpp: 1, phone: false, t: 0, idle: reduced ? 0 : 1, enter: [], pin: [], after: [], spin: 0 };
  const st = scroll.state();
  const _e = new THREE.Vector3();
  const _dq = new THREE.Quaternion();
  const _qe = new THREE.Quaternion();
  const _m = new THREE.Matrix4();
  const _sv = new THREE.Vector3();

  function stepCoin(c: Coin, dt: number, land: number): void {
    const kp = K_POS * c.k;
    const zeta = ZETA + (ZETA_LAND - ZETA) * land;
    const cp = 2 * zeta * Math.sqrt(kp);
    // position
    _e.subVectors(goal.p, c.p).multiplyScalar(kp).addScaledVector(c.v, -cp);
    c.v.addScaledVector(_e, dt);
    c.p.addScaledVector(c.v, dt);
    // rotation: the error as an axis * angle, the shortest way round
    _qe.copy(c.q).invert().premultiply(goal.q);
    if (_qe.w < 0) _qe.set(-_qe.x, -_qe.y, -_qe.z, -_qe.w);
    const sinHalf = Math.sqrt(_qe.x * _qe.x + _qe.y * _qe.y + _qe.z * _qe.z);
    const angle = 2 * Math.atan2(sinHalf, _qe.w);
    const kr = K_ROT * c.k;
    const cr = 2 * zeta * Math.sqrt(kr);
    if (sinHalf > 1e-6) _e.set(_qe.x, _qe.y, _qe.z).multiplyScalar((angle / sinHalf) * kr);
    else _e.set(0, 0, 0);
    _e.addScaledVector(c.w, -cr);
    c.w.addScaledVector(_e, dt);
    const wl = c.w.length();
    if (wl > 1e-6) {
      _dq.setFromAxisAngle(_e.copy(c.w).divideScalar(wl), wl * dt);
      c.q.premultiply(_dq).normalize();
    }
    // scale: its own spring, so a coin pops as it arrives
    const cs = 2 * ZETA_SCALE * Math.sqrt(K_SCALE);
    c.sv += (K_SCALE * (goal.s - c.s) - cs * c.sv) * dt;
    c.s = Math.max(0, c.s + c.sv * dt);
  }

  function snapCoin(c: Coin): void {
    c.p.copy(goal.p);
    c.q.copy(goal.q);
    c.s = goal.s;
    c.v.set(0, 0, 0);
    c.w.set(0, 0, 0);
    c.sv = 0;
  }

  /* ————— sizing ————— */

  let vw = 1;
  let vh = 1;
  let sizedW = 0;
  let sizedDpr = 0;
  function resize(): void {
    sizedW = window.innerWidth;
    sizedDpr = window.devicePixelRatio;
    // the canvas is 100lvh tall in CSS, so a phone's address bar sliding away does not reach here
    vw = canvas.clientWidth || window.innerWidth;
    vh = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
    renderer.setSize(vw, vh, false);
    camera.aspect = vw / vh;
    camera.updateProjectionMatrix();
    frame.H = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    frame.W = frame.H * camera.aspect;
    frame.phone = window.matchMedia(PHONE).matches;
    const r = Math.max(frame.W, frame.H) * 0.62 + 2;
    const sc = key.shadow.camera;
    sc.left = -r;
    sc.right = r;
    sc.top = r;
    sc.bottom = -r;
    sc.updateProjectionMatrix();
  }
  resize();

  /* ————— pointer: the cast leans toward it; a coin under it wobbles; a click flips it ————— */

  const fine = window.matchMedia('(pointer: fine)').matches;
  let px = 0;
  let py = 0;
  let tiltX = 0;
  let tiltY = 0;
  let hover = -1;
  let pointerAt: { x: number; y: number } | null = null;
  let pointerMoved = false; // a coin scrolling under a still cursor is not being pointed at
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const _o = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _hit = new THREE.Vector3();
  const _cw = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  // which coin is under a viewport point: ray against each coin's disc, nearest wins
  function pick(x: number, y: number): number {
    ndc.set((x / vw) * 2 - 1, -(y / vh) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    let best = -1;
    let bestT = Infinity;
    for (let i = 0; i < N; i++) {
      const c = coins[i];
      if (c.s < 0.05) continue;
      _cw.copy(c.p).applyMatrix4(root.matrixWorld);
      _n.copy(UP).applyQuaternion(c.q).applyQuaternion(root.quaternion);
      const dn = ray.ray.direction.dot(_n);
      if (Math.abs(dn) < 1e-4) continue;
      const t = _o.subVectors(_cw, ray.ray.origin).dot(_n) / dn;
      if (t <= 0 || t >= bestT) continue;
      _hit.copy(ray.ray.direction).multiplyScalar(t).add(ray.ray.origin);
      if (_hit.distanceTo(_cw) <= c.s) {
        best = i;
        bestT = t;
      }
    }
    return best;
  }

  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch') return;
      px = (e.clientX / window.innerWidth) * 2 - 1;
      py = (e.clientY / window.innerHeight) * 2 - 1;
      pointerAt = { x: e.clientX, y: e.clientY };
      pointerMoved = true;
    },
    { passive: true }
  );
  document.documentElement.addEventListener('pointerleave', () => {
    px = 0;
    py = 0;
    pointerAt = null;
  });

  function flipCoin(i: number): void {
    const c = coins[i];
    c.flipped = !c.flipped;
    // a kick along the flip, so it tumbles rather than rotating on rails
    _e.set(1, 0, 0).applyQuaternion(c.q);
    c.w.addScaledVector(_e, 6);
    c.v.z += 3;
    requestStill();
  }

  canvas.addEventListener('click', (e) => {
    const i = pick(e.clientX, e.clientY);
    if (i >= 0) flipCoin(i);
  });

  /* ————— the loop's flywheel: scroll velocity spins it, friction slows it ————— */

  let lastY = window.scrollY;
  let flywheel = 0; // rad/s

  /* ————— one frame ————— */

  let lit = false;
  let shadows = true; // the last quality tier turns them off
  let statusShown = '';
  let statusAt = 0;
  let heads = 0;
  let shown = 0;
  const WHITE = new THREE.Color(1, 1, 1);

  // springs, instance matrices, lights: everything but the draw
  function update(dt: number, t: number): void {
    scroll.read(window.scrollY, st);
    frame.t = t;
    frame.enter = st.enter;
    frame.pin = st.pin;
    frame.after = st.after;
    frame.wpp = frame.H / Math.max(1, vh); // the canvas's own height: it is 100lvh, not innerHeight

    // flywheel: only the loop section feeds it; a hard scroll leaves it coasting
    if (dt > 0) {
      const vel = (st.y - lastY) / dt; // px/s
      const inLoop = st.enter[LOOP] > 0.6 && st.enter[FLIP] < 0.4;
      if (inLoop && !reduced) flywheel += Math.max(-2.5, Math.min(2.5, vel * 0.0008)) * dt * 2;
      flywheel *= Math.exp(-1.1 * dt);
      frame.spin += flywheel * dt;
    }
    lastY = st.y;

    const sub = dt > 0 ? Math.min(4, Math.ceil(dt / (1 / 120))) : 0;
    const h = sub ? dt / sub : 0;
    heads = 0;
    shown = 0;
    for (let i = 0; i < N; i++) {
      const c = coins[i];
      const land = target(i, goal, frame);
      if (c.flipped) goal.q.multiply(FLIPPED);
      if (reduced || !lit) snapCoin(c);
      else for (let k = 0; k < sub; k++) stepCoin(c, h, land);
      _sv.set(c.s, c.s, c.s);
      _m.compose(c.p, c.q, _sv);
      mesh.setMatrixAt(i, _m);
      if (c.s > 0.05) {
        shown++;
        if (_n.copy(UP).applyQuaternion(c.q).z > 0) heads++;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;

    const shade = surface(surfacePose, frame);
    catcher.visible = shadows && shade > 0.001;
    if (catcher.visible) {
      catcher.position.copy(surfacePose.p);
      catcher.quaternion.copy(surfacePose.q);
      catcher.scale.setScalar(surfacePose.s);
      catcherMat.opacity = 0.2 * shade;
    }

    // the cast leans toward the pointer; with reduced motion it holds still
    if (!reduced) {
      const ease = 1 - Math.exp(-4 * dt);
      tiltY += (px * 0.12 - tiltY) * ease;
      tiltX += (py * 0.07 - tiltX) * ease;
    }
    root.rotation.set(tiltX, tiltY, 0);
    root.updateMatrixWorld();

    // a coin wobbles when the pointer moves onto it, not when the page scrolls it under one
    if (fine && pointerAt && !reduced) {
      const i = pick(pointerAt.x, pointerAt.y);
      if (i !== hover && i >= 0 && pointerMoved) {
        _e.set(1, 0, 0).applyQuaternion(coins[i].q);
        coins[i].w.addScaledVector(_e, 4.5);
      }
      hover = i;
      pointerMoved = false;
      canvas.style.cursor = i >= 0 ? 'pointer' : '';
    }

    // bounce light follows the section behind the cast
    bounce.copy(ROSE).lerp(RED, st.enter[LOOP]).lerp(BLUSH, st.enter[FLIP]).lerp(ROSE, st.enter[END]);
    hemi.color.copy(bounce).lerp(WHITE, 0.35);
    hemi.groundColor.copy(bounce);
    uniforms.uTime.value = t;
  }

  function place(dt: number, t: number): void {
    update(dt, t);
    renderer.render(scene, camera);
    const now = performance.now();
    const status = `heads ${heads} · tails ${shown - heads}`;
    // throttled while the loop runs; a reduced-motion frame may be the last one for a while
    if (status !== statusShown && (reduced || !lit || now - statusAt > 120)) {
      statusShown = status;
      statusAt = now;
      chrome.setStatus(status);
    }
    if (!lit) {
      lit = true;
      document.documentElement.classList.add('tn-gl'); // the ready signal: tools wait on it
      void loader.done();
    }
  }

  // reduced motion runs no loop: one frame per scroll, resize or flip, coalesced
  let stillPending = 0;
  function requestStill(): void {
    if (!reduced || stillPending) return;
    stillPending = requestAnimationFrame(() => {
      stillPending = 0;
      place(0, 0);
    });
  }

  /* ————— warm the programs, then the first frame ————— */

  let rz = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => {
      // phones fire resize as the address bar moves; only a real change of size or pixel ratio
      // (a window dragged to another display) re-lays out
      if (window.innerWidth === sizedW && window.devicePixelRatio === sizedDpr && Math.abs(canvas.clientHeight - vh) < 2) return;
      resize();
      requestStill();
    });
  });

  // a phone tab back from the background often comes back with a dropped context
  let loop: FrameLoop | null = null;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); // without it the browser never attempts a restore
    loop?.stop();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    buildEnv();
    resize();
    if (loop) loop.start();
    else requestStill();
  });

  loader.set(0.7, 'compiling');
  update(0, 0); // coins at their places before compiling, so the first frame is the real one
  catcher.visible = true; // compile skips hidden objects; this one would otherwise hitch mid-scroll
  await renderer.compileAsync(scene, camera);
  loader.set(0.92, 'first light');

  if (import.meta.env.DEV) {
    (window as unknown as { __tn: unknown }).__tn = { renderer, scene, camera, coins, frame, mesh, material };
  }

  if (reduced) {
    window.addEventListener('scroll', requestStill, { passive: true });
    document.addEventListener('tn:measure', requestStill);
    place(0, 0);
    return;
  }

  loop = startLoop((dt, t) => place(dt, t));
  place(0, 0);

  /* ————— adaptive quality: pixel ratio, then the shadow map, then shadows ————— */

  let tier = 0;
  function stepDown(): void {
    tier++;
    if (tier === 1) {
      dprCap = 1.5;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.map?.dispose();
      key.shadow.map = null;
    } else {
      // no shadows at all: the light stops casting (every lit material recompiles for that),
      // the map goes, and so does the catcher, which only ever draws shadows. Leaving the
      // catcher up would have it sample a map that no longer updates.
      dprCap = 1;
      key.castShadow = false;
      renderer.shadowMap.enabled = false;
      key.shadow.map?.dispose();
      key.shadow.map = null;
      shadows = false;
    }
    resize();
  }
  if (import.meta.env.DEV) (window as unknown as { __tn: Record<string, unknown> }).__tn.stepDown = stepDown;
  if (!(import.meta.env.DEV && new URLSearchParams(location.search).get('lock') === '1')) {
    watchQuality(stepDown, { maxDrops: 2, warmupMs: 1500, windowMs: 1000 });
  }
}
