import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { watchQuality } from '../lab-quality';
import './style.css';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(pointer: fine)').matches;

/* ————— terrain & collision seams ————— */

const WATER_Y = -0.5;
const SHORE_X = -26; // the waterline runs north–south; the sea sits to the west
const HEAD_X = 2.4;
const HEAD_Z = -8.8;

// dunes rolling down toward the water on the west side
function groundHeight(x: number, z: number): number {
  const inland = x - SHORE_X; // metres from the waterline, positive on dry sand
  let h = WATER_Y + inland * 0.045; // the beach falls toward the water
  h = Math.min(h, 2.1); // a dune crest caps the climb inland

  // two octaves of settled dunes, damped flat near the shore
  const damp = THREE.MathUtils.smoothstep(inland, 2, 18);
  h += damp * (
    Math.sin(x * 0.041 + 1.7) * Math.cos(z * 0.052 + 0.4) * 0.6 +
    Math.sin(x * 0.11 - 0.6) * Math.sin(z * 0.13 + 2.1) * 0.18
  );

  // the head has pressed a shallow bowl into the sand around itself
  const hx = x - HEAD_X;
  const hz = z - HEAD_Z;
  h -= Math.exp(-(hx * hx + hz * hz) / 96) * 0.34;

  return h;
}

// cylinder colliders in the ground plane; the collision pass walks this list
interface Collider {
  x: number;
  z: number;
  r: number;
}
const collidables: Collider[] = [];

const WALKER_RADIUS = 0.45;

// radial push-out — step the walker out along the shortest path when overlapping
function resolveCollisions(pos: THREE.Vector3): void {
  for (const c of collidables) {
    const dx = pos.x - c.x;
    const dz = pos.z - c.z;
    const d = Math.hypot(dx, dz);
    const min = c.r + WALKER_RADIUS;
    if (d < min) {
      if (d < 1e-4) {
        pos.x = c.x + min; // dead centre — pick a side
      } else {
        const s = min / d;
        pos.x = c.x + dx * s;
        pos.z = c.z + dz * s;
      }
    }
  }
}

/* ————— seeded ground texture — faint mineral speckle ————— */

function makeGroundTexture(): THREE.CanvasTexture {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(cv);

  let s = 97;
  const rnd = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };

  ctx.fillStyle = '#504b43';
  ctx.fillRect(0, 0, S, S);

  // broad soft mottling first, fine speckle on top
  for (let i = 0; i < 70; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 30 + rnd() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = rnd() > 0.5 ? '92,86,74' : '66,61,54';
    g.addColorStop(0, `rgba(${tone},0.09)`);
    g.addColorStop(1, `rgba(${tone},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tones = ['#585349', '#47433c', '#5d574b', '#443f38'];
  for (let i = 0; i < 2600; i++) {
    ctx.globalAlpha = 0.12 + rnd() * 0.2;
    ctx.fillStyle = tones[Math.floor(rnd() * tones.length)];
    ctx.beginPath();
    ctx.arc(rnd() * S, rnd() * S, 0.6 + rnd() * 2.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ————— renderer, scene, camera ————— */

const FOG_COLOR = 0xd4aa80;
const canvas = document.getElementById('wt-gl') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
scene.background = new THREE.Color(FOG_COLOR);
scene.fog = new THREE.Fog(FOG_COLOR, 16, 175);

const EYE_HEIGHT = 1.7;
const camera = new THREE.PerspectiveCamera(
  72,
  window.innerWidth / window.innerHeight,
  0.1,
  900
);
camera.rotation.order = 'YXZ';
camera.position.set(0, groundHeight(0, 9) + EYE_HEIGHT, 9);

/* ————— sky: one dusk gradient, wrapped on a back-side dome ————— */

function makeSkyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#39415a');
    grad.addColorStop(0.3, '#6d6a7c');
    grad.addColorStop(0.52, '#a8907e');
    grad.addColorStop(0.63, '#d4aa80'); // exact fog tone — horizon dissolves
    grad.addColorStop(0.78, '#c69b72');
    grad.addColorStop(1, '#97785a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

scene.add(
  new THREE.Mesh(
    new THREE.SphereGeometry(450, 32, 16),
    new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false })
  )
);

// the low sun itself — a soft hazy disc out over the water.
// drawn opaque on black so additive blending reads pure rgb falloff:
// canvas alpha + additive leaves a visible quad veil otherwise
function makeSunGlowTexture(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S, S);
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,226,178,0.95)');
    g.addColorStop(0.18, 'rgba(255,190,130,0.5)');
    g.addColorStop(0.45, 'rgba(120,70,40,0.12)');
    g.addColorStop(0.75, 'rgba(20,10,5,0)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const sunGlow = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: makeSunGlowTexture(),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    transparent: true,
  })
);
sunGlow.position.set(-160, 22, -400);
sunGlow.scale.set(150, 150, 1);
scene.add(sunGlow);

/* ————— lights — warm low key over the water, cool slate fill ————— */

const hemi = new THREE.HemisphereLight(0x93a2ba, 0x4a4034, 1.45);
scene.add(hemi);

// a faint slate fill from the camera quarter keeps the shadow side marble, not void
const fill = new THREE.DirectionalLight(0xaebfd8, 0.85);
fill.position.set(40, 30, 60);
scene.add(fill);
scene.add(fill.target);

const sun = new THREE.DirectionalLight(0xffb377, 2.8);
sun.position.set(-27, 14, -86); // low, from the same quarter as the visible sun
sun.target.position.set(HEAD_X, 1, HEAD_Z);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
sun.shadow.camera.near = 20;
sun.shadow.camera.far = 180;
sun.shadow.bias = -0.002;
sun.shadow.normalBias = 0.06;
scene.add(sun);
scene.add(sun.target);

/* ————— ground: displaced dunes, wet band at the waterline ————— */

const groundTex = makeGroundTexture();
groundTex.repeat.set(48, 48);
groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

const groundMat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 });
// where the sand meets the sea it turns darker and glossier
groundMat.onBeforeCompile = (shader) => {
  shader.uniforms.wtShoreX = { value: SHORE_X };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', 'varying vec3 vWtWorld;\n#include <common>')
    .replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvWtWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;'
    );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', 'varying vec3 vWtWorld;\nuniform float wtShoreX;\n#include <common>')
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
  float wtWet = 1.0 - smoothstep(wtShoreX - 2.0, wtShoreX + 9.0, vWtWorld.x);
  wtWet *= 0.82 + 0.18 * sin(vWtWorld.z * 0.35 + vWtWorld.y * 2.0);
  diffuseColor.rgb *= mix(1.0, 0.52, wtWet);
  roughnessFactor = mix(roughnessFactor, 0.32, wtWet);`
    );
};

const groundGeo = new THREE.PlaneGeometry(420, 420, 190, 190);
groundGeo.rotateX(-Math.PI / 2); // bake the flip so y is up — displacement reads straight off x/z
const gPos = groundGeo.attributes.position;
for (let i = 0; i < gPos.count; i++) {
  gPos.setY(i, groundHeight(gPos.getX(i), gPos.getZ(i)));
}
groundGeo.computeVertexNormals();

const ground = new THREE.Mesh(groundGeo, groundMat);
ground.receiveShadow = true;
scene.add(ground);

/* ————— the sea: a calm plane, swell carried on scrolling normals ————— */

function makeWaterNormalTexture(): THREE.DataTexture {
  const S = 256;
  const data = new Uint8Array(S * S * 4);

  let s = 411;
  const rnd = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };

  // layered sine swell — gentle; this sea is asleep
  const waves: { fx: number; fy: number; ph: number; amp: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const dir = rnd() * Math.PI * 2;
    const freq = 1.5 + rnd() * 5.5;
    waves.push({
      fx: Math.cos(dir) * freq,
      fy: Math.sin(dir) * freq,
      ph: rnd() * Math.PI * 2,
      amp: 1 / freq,
    });
  }
  const wrap = (v: number): number => ((v % S) + S) % S;
  const heightAt = (x: number, y: number): number => {
    let h = 0;
    for (const w of waves) {
      h += w.amp * Math.sin(((wrap(x) * w.fx + wrap(y) * w.fy) / S) * Math.PI * 2 + w.ph);
    }
    return h;
  };

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * 1.6;
      const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * 1.6;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const o = (y * S + x) * 4;
      data[o] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const waterNormal = makeWaterNormalTexture();
waterNormal.repeat.set(7, 14);
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(214, 424),
  new THREE.MeshStandardMaterial({
    color: 0x2e3c46,
    roughness: 0.15,
    metalness: 0.06,
    normalMap: waterNormal,
    normalScale: new THREE.Vector2(0.5, 0.5),
  })
);
water.rotation.x = -Math.PI / 2;
water.position.set(SHORE_X - 107, WATER_Y, 0);
water.receiveShadow = true;
scene.add(water);

/* ————— the colossus: Poly Haven's marble bust, scaled to the monumental ————— */

const COLOSSUS_URL = '/models/colossus/marble_bust_01_2k.gltf';
const COLOSSUS_HEIGHT = 10.4; // metres, crown to plinth along its length

new GLTFLoader()
  .loadAsync(COLOSSUS_URL)
  .then((gltf) => {
    const bust = gltf.scene;

    // normalise to the monumental scale first…
    const raw = new THREE.Box3().setFromObject(bust);
    const rawSize = raw.getSize(new THREE.Vector3());
    bust.scale.setScalar(COLOSSUS_HEIGHT / rawSize.y);

    // …tip it onto its cheek — the model faces −X natively, so rolling about
    // that axis keeps the gaze level while the plinth end digs a little deeper
    bust.rotation.x = Math.PI / 2 - 0.12;

    // the resting group carries the compositional aim
    const colossus = new THREE.Group();
    colossus.add(bust);
    colossus.rotation.y = 0.78;

    // seat it: the lower third of the tipped body rests below the sand line
    const tipped = new THREE.Box3().setFromObject(colossus);
    const tippedSize = tipped.getSize(new THREE.Vector3());
    colossus.position.set(
      HEAD_X,
      groundHeight(HEAD_X, HEAD_Z) - tippedSize.y / 3 - tipped.min.y,
      HEAD_Z
    );

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    bust.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        for (const t of [std.map, std.normalMap, std.roughnessMap, std.aoMap]) {
          if (t) t.anisotropy = maxAniso;
        }
      }
    });

    scene.add(colossus);

    // one cylinder stands in for the bulk — you will not walk through this
    collidables.push({ x: HEAD_X, z: HEAD_Z, r: 2.7 });

    const dbg = window as unknown as { __wtDebug?: { bust?: THREE.Object3D } };
    if (dbg.__wtDebug) dbg.__wtDebug.bust = colossus;

    if (reduced) renderer.render(scene, camera); // the still frame waits for the head
  })
  .catch(() => console.warn('[walkthrough] colossus failed to load'));

/* ————— first-person controls: pointer lock, wasd, sprint, damped velocity ————— */

const WALK_SPEED = 5.0;
const SPRINT_SPEED = 9.0;
const MOUSE_SENS = 0.0022;

const keys = { forward: false, back: false, left: false, right: false, sprint: false };
const velocity = new THREE.Vector3();
let yaw = 0;
let pitch = 0;
let locked = false;

function canEngage(): boolean {
  return finePointer && !reduced;
}

function clearKeys(): void {
  keys.forward = keys.back = keys.left = keys.right = keys.sprint = false;
}

const overlay = document.getElementById('wt-overlay') as HTMLElement | null;
const enterBtn = document.getElementById('wt-enter') as HTMLButtonElement | null;
const helpLine = document.getElementById('wt-overlay-help');

if (!canEngage()) {
  if (helpLine) {
    helpLine.textContent = reduced
      ? 'Reduced motion is on, so the scene holds as a single still frame.'
      : 'Best walked on a desktop — this one wants a keyboard and a mouse.';
  }
  if (enterBtn) enterBtn.textContent = 'View the scene';
}

overlay?.addEventListener('click', () => {
  if (!overlay || !canEngage()) {
    if (overlay) overlay.hidden = true; // nothing to lock into — just step aside
    return;
  }
  const req = canvas.requestPointerLock() as unknown;
  if (req instanceof Promise) req.catch(() => {});
});

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (overlay) overlay.hidden = locked;
  if (!locked) {
    clearKeys();
    velocity.set(0, 0, 0);
    if (canEngage()) enterBtn?.focus();
  }
});

document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  yaw -= e.movementX * MOUSE_SENS;
  pitch -= e.movementY * MOUSE_SENS;
  const limit = Math.PI / 2 - 0.02;
  pitch = Math.max(-limit, Math.min(limit, pitch));
});

window.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW': keys.forward = true; break;
    case 'KeyS': keys.back = true; break;
    case 'KeyA': keys.left = true; break;
    case 'KeyD': keys.right = true; break;
    case 'ShiftLeft':
    case 'ShiftRight': keys.sprint = true; break;
  }
});

window.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': keys.forward = false; break;
    case 'KeyS': keys.back = false; break;
    case 'KeyA': keys.left = false; break;
    case 'KeyD': keys.right = false; break;
    case 'ShiftLeft':
    case 'ShiftRight': keys.sprint = false; break;
  }
});

window.addEventListener('blur', clearKeys);

const forward = new THREE.Vector3();
const strafe = new THREE.Vector3();

function moveWalker(dt: number): void {
  const ix = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const iz = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
  const speed = keys.sprint ? SPRINT_SPEED : WALK_SPEED;

  // camera basis flattened onto the ground plane
  forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  strafe.set(Math.cos(yaw), 0, -Math.sin(yaw));

  const tx = (forward.x * iz + strafe.x * ix) * speed;
  const tz = (forward.z * iz + strafe.z * ix) * speed;
  const len = Math.hypot(tx, tz);
  const norm = len > 0 ? speed / len : 0; // diagonals don't outrun straights

  // exponential damping — identical feel at any framerate
  const blend = 1 - Math.exp(-8 * dt);
  velocity.x += (tx * norm - velocity.x) * blend;
  velocity.z += (tz * norm - velocity.z) * blend;

  camera.position.x += velocity.x * dt;
  camera.position.z += velocity.z * dt;
  // the shallows are where walking ends — no swimming in this one
  camera.position.x = Math.max(camera.position.x, SHORE_X - 1.2);
  camera.position.y = groundHeight(camera.position.x, camera.position.z) + EYE_HEIGHT;
  resolveCollisions(camera.position);

  camera.rotation.set(pitch, yaw, 0);
}

/* ————— adaptive quality ————— */

const tierEl = document.getElementById('wt-quality');
let qualityTier = 0;
function stepQualityDown(): void {
  qualityTier++;
  if (qualityTier === 1) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  } else {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    sun.castShadow = false; // shadows are the first luxury to go
  }
  if (tierEl) tierEl.textContent = `QUALITY ${qualityTier}`;
}

/* ————— loop ————— */

const fpsEl = document.getElementById('wt-fps');
const timer = new THREE.Timer();
let fpsEma = 60;
let fpsLast = 0;

function frame(): void {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);

  moveWalker(dt);

  // the sea breathes slowly — a long drift across the swell normals
  const t = timer.getElapsed();
  waterNormal.offset.set(t * 0.0075, t * 0.004);

  fpsEma += (1 / Math.max(dt, 1e-4) - fpsEma) * 0.05;
  const now = performance.now();
  if (fpsEl && now - fpsLast > 500) {
    fpsLast = now;
    fpsEl.textContent = `FPS ${String(Math.round(fpsEma)).padStart(2, '0')}`;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (reduced) renderer.render(scene, camera);
});

if (reduced) {
  // one considered frame, no perpetual motion
  camera.rotation.set(pitch, yaw, 0);
  renderer.render(scene, camera);
  if (fpsEl) fpsEl.textContent = 'STILL FRAME';
} else {
  frame();
  watchQuality(stepQualityDown);
}
