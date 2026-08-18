import * as THREE from 'three';
import gsap from 'gsap';
import './style.css';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ————— seeded procedural moss texture ————— */

function makeMossCanvas(seed: number, size = 512): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  let s = seed;
  const rand = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };

  ctx.fillStyle = '#31461f';
  ctx.fillRect(0, 0, size, size);
  const accents = ['#3c5426', '#49622d', '#587338', '#273a18', '#6b8a44', '#82a052'];
  for (let i = 0; i < 3200; i++) {
    ctx.globalAlpha = 0.22 + rand() * 0.5;
    ctx.fillStyle = accents[Math.floor(rand() * accents.length)];
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, 0.8 + rand() * 6.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.75;
  for (let i = 0; i < 320; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#93b165' : '#b3c984';
    ctx.fillRect(rand() * size, rand() * size, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;
  return canvas;
}

function makeGlowSprite(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

/* ————— scene ————— */

const BG = 0x4a5140;
const canvas = document.getElementById('lw-gl') as HTMLCanvasElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.fog = new THREE.FogExp2(BG, 0.035);

const camera = new THREE.PerspectiveCamera(
  42,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 1.5, 9.5);

const hemi = new THREE.HemisphereLight(0xb9c4a4, 0x151a10, 1.25);
scene.add(hemi);

// the sun is the key light; the moon is a dim cool fill — both cast real shadows
const sunLight = new THREE.DirectionalLight(0xe9f0d2, 1.5);
sunLight.position.set(5, 9, 7);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -16;
sunLight.shadow.camera.right = 16;
sunLight.shadow.camera.top = 16;
sunLight.shadow.camera.bottom = -16;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 45;
sunLight.shadow.bias = -0.0025;
scene.add(sunLight);
scene.add(sunLight.target);

const moonLight = new THREE.DirectionalLight(0xa8c0e8, 0);
moonLight.position.set(0, 10, -4);
moonLight.castShadow = true;
moonLight.shadow.mapSize.set(1024, 1024);
moonLight.shadow.camera.left = -16;
moonLight.shadow.camera.right = 16;
moonLight.shadow.camera.top = 16;
moonLight.shadow.camera.bottom = -16;
moonLight.shadow.camera.near = 1;
moonLight.shadow.camera.far = 45;
moonLight.shadow.bias = -0.0025;
scene.add(moonLight);
scene.add(moonLight.target);

const fill = new THREE.PointLight(0x88a057, 40, 18);
fill.position.set(-4, 3, 2);
scene.add(fill);

const mossTex = new THREE.CanvasTexture(makeMossCanvas(1234));
mossTex.wrapS = mossTex.wrapT = THREE.RepeatWrapping;
mossTex.repeat.set(4, 3);
mossTex.colorSpace = THREE.SRGBColorSpace;

const groundTex = mossTex.clone();
groundTex.repeat.set(14, 14);
groundTex.needsUpdate = true;
const groundMat = new THREE.MeshStandardMaterial({
  color: 0x3f4830,
  map: groundTex,
  bumpMap: groundTex,
  bumpScale: 0.4,
  roughness: 1,
});
const ground = new THREE.Mesh(new THREE.CircleGeometry(45, 48), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
ground.receiveShadow = true;
scene.add(ground);

// misty gradient sky backdrop (unfogged, always behind everything)
function makeSkyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#4a5140');
    grad.addColorStop(0.45, '#828a6d');
    grad.addColorStop(0.62, '#98a084');
    grad.addColorStop(0.75, '#565d47');
    grad.addColorStop(1, '#2f3527');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const skyMat = new THREE.MeshBasicMaterial({ map: makeSkyTexture(), fog: false });
const sky = new THREE.Mesh(new THREE.PlaneGeometry(120, 60), skyMat);
sky.position.set(0, 12, -40);
scene.add(sky);

/* ————— moss arches ————— */

function jitter(geo: THREE.BufferGeometry, amt: number, seed: number): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n =
      Math.sin(x * 3.1 + seed) * Math.cos(y * 2.7 + seed * 1.3) * Math.sin(z * 3.7 + seed * 0.7);
    const k = 1 + n * amt;
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  geo.computeVertexNormals();
}

interface ArchDef {
  radius: number;
  tube: number;
  x: number;
  z: number;
  rotY: number;
  rotZ: number;
}

const ARCHES: ArchDef[] = [
  { radius: 3.4, tube: 0.42, x: -4.4, z: -3.5, rotY: 0.5, rotZ: 0.07 },
  { radius: 2.6, tube: 0.34, x: 4.3, z: -4.5, rotY: -0.7, rotZ: -0.05 },
  { radius: 1.7, tube: 0.26, x: 0.6, z: -7.5, rotY: 0.2, rotZ: 0 },
  { radius: 1.2, tube: 0.2, x: -2.2, z: -9.5, rotY: 1.1, rotZ: -0.06 },
  { radius: 2.1, tube: 0.3, x: 6.5, z: -9, rotY: 0.9, rotZ: 0 },
  { radius: 1.4, tube: 0.22, x: -7.2, z: -7, rotY: -0.4, rotZ: 0 },
  { radius: 0.9, tube: 0.16, x: 2.6, z: -11.5, rotY: 0.4, rotZ: 0 },
];

const archGroups: THREE.Group[] = [];
const archMats: THREE.MeshStandardMaterial[] = [];

ARCHES.forEach((def, i) => {
  const geo = new THREE.TorusGeometry(def.radius, def.tube, 20, 72, Math.PI);
  jitter(geo, 0.1, i * 7.13 + 1.7);
  const mat = new THREE.MeshStandardMaterial({
    map: mossTex,
    bumpMap: mossTex,
    bumpScale: 0.7,
    roughness: 0.96,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  group.position.set(def.x, 0, def.z);
  group.rotation.y = def.rotY;
  group.rotation.z = def.rotZ;
  group.userData.base = reduced ? 1 : 0.0001;
  group.scale.setScalar(group.userData.base as number);
  scene.add(group);
  archGroups.push(group);
  archMats.push(mat);
});

// branch stubs breaking up the silhouette of the two foreground arches
ARCHES.slice(0, 2).forEach((def, k) => {
  const group = archGroups[k];
  for (let i = 0; i < 3; i++) {
    const u = 0.5 + Math.random() * (Math.PI - 1);
    const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.1, 0.55, 6), archMats[k]);
    stub.castShadow = true;
    const radial = def.radius + def.tube * 0.8;
    stub.position.set(Math.cos(u) * radial, Math.sin(u) * radial, (Math.random() - 0.5) * 0.2);
    stub.rotation.z = u - Math.PI / 2 + (Math.random() - 0.5) * 0.9;
    stub.rotation.x = (Math.random() - 0.5) * 0.6;
    group.add(stub);
  }
});

// surface fuzz on the two foreground arches
const glowSprite = makeGlowSprite();
ARCHES.slice(0, 2).forEach((def) => {
  const N = 900;
  const positions = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * Math.PI;
    const v = Math.random() * Math.PI * 2;
    const r = def.radius + (Math.random() - 0.5) * 0.1;
    const t = def.tube + 0.02 + Math.random() * 0.1;
    positions[i * 3] = (r + t * Math.cos(v)) * Math.cos(u);
    positions[i * 3 + 1] = (r + t * Math.cos(v)) * Math.sin(u);
    positions[i * 3 + 2] = t * Math.sin(v);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const pts = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 0.055,
      map: glowSprite,
      transparent: true,
      opacity: 0.55,
      color: 0x9cba6a,
      depthWrite: false,
    })
  );
  pts.position.set(def.x, 0, def.z);
  pts.rotation.y = def.rotY;
  scene.add(pts);
});

/* ————— dust motes — falling spores ————— */

const MOTES = 320;
const motePositions = new Float32Array(MOTES * 3);
for (let i = 0; i < MOTES; i++) {
  motePositions[i * 3] = (Math.random() - 0.5) * 24;
  motePositions[i * 3 + 1] = Math.random() * 7;
  motePositions[i * 3 + 2] = (Math.random() - 0.5) * 20 - 3;
}
const moteGeo = new THREE.BufferGeometry();
moteGeo.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
scene.add(
  new THREE.Points(
    moteGeo,
    new THREE.PointsMaterial({
      size: 0.06,
      map: glowSprite,
      transparent: true,
      opacity: 0.5,
      color: 0xdde8bf,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  )
);

/* ————— butterfly ————— */

const butterfly = new THREE.Group();
const wingMat = new THREE.MeshBasicMaterial({
  color: 0xd8e26a,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.9,
});
const wingGeoL = new THREE.PlaneGeometry(0.12, 0.09);
wingGeoL.translate(-0.06, 0, 0);
const wingGeoR = new THREE.PlaneGeometry(0.12, 0.09);
wingGeoR.translate(0.06, 0, 0);
const wingL = new THREE.Mesh(wingGeoL, wingMat);
const wingR = new THREE.Mesh(wingGeoR, wingMat);
butterfly.add(wingL, wingR);
scene.add(butterfly);

/* ————— sun & moon sprites ————— */

const sunMat = new THREE.SpriteMaterial({
  map: glowSprite,
  color: 0xfff6d8,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const sun = new THREE.Sprite(sunMat);
sun.scale.set(5, 5, 1);
scene.add(sun);

const moonMat = new THREE.SpriteMaterial({
  map: glowSprite,
  color: 0xdfe8f5,
  transparent: true,
  opacity: 0,
  depthWrite: false,
});
const moon = new THREE.Sprite(moonMat);
moon.scale.set(2.4, 2.4, 1);
scene.add(moon);

/* ————— day-night cycle ————— */

const BASE_FOG = new THREE.Color(BG);
const WARM_FOG = new THREE.Color(0x6b5f45);
const NIGHT_FOG = new THREE.Color(0x10161c);
const WHITE = new THREE.Color(0xffffff);
const WARM_SKY = new THREE.Color(0xffd9a0);
const NIGHT_SKY = new THREE.Color(0x232c3e);
const SUN_CORE = new THREE.Color(0xfff6d8);
const SUN_SET = new THREE.Color(0xff9a3c);
const SUN_LIGHT = new THREE.Color(0xfff2d0);
const SUNSET_LIGHT = new THREE.Color(0xff8a3d);
const BASE_LIGHT_COLOR = new THREE.Color(0xe9f0d2);
const BASE_LIGHT_POS = new THREE.Vector3(5, 9, 7);
const MOON_END_POS = new THREE.Vector3(14, 1.2, -6);

const cycleState = { sunT: 0, moonT: 0, nightMix: 0, restoreT: 0, idle: true };
let cycling = false;

function applyCycleState(): void {
  if (cycleState.idle) {
    sunLight.position.copy(BASE_LIGHT_POS);
    sunLight.intensity = 1.5;
    sunLight.color.copy(BASE_LIGHT_COLOR);
    moonLight.intensity = 0;
    sunMat.opacity = 0;
    moonMat.opacity = 0;
    skyMat.color.copy(WHITE);
    (scene.fog as THREE.FogExp2).color.copy(BASE_FOG);
    (scene.background as THREE.Color).copy(BASE_FOG);
    hemi.intensity = 1.25;
    return;
  }

  const azS = Math.PI * (1 - cycleState.sunT);
  sun.position.set(Math.cos(azS) * 26, Math.sin(azS) * 14, -20);
  const day = Math.sin(Math.PI * cycleState.sunT);
  const warm = 1 - day;
  const dayness = 1 - cycleState.nightMix;

  const azM = Math.PI * (1 - cycleState.moonT);
  moon.position.set(Math.cos(azM) * 26, Math.sin(azM) * 14, -20);
  const moonUp = Math.sin(Math.PI * cycleState.moonT);

  sunMat.opacity = Math.min(1, day * 3) * dayness;
  sunMat.color.copy(SUN_CORE).lerp(SUN_SET, warm * 0.8);
  moonMat.opacity = cycleState.nightMix * Math.min(1, moonUp * 3);

  // key light: chases the sun, parks during night, eases home on restore
  if (cycleState.restoreT > 0) {
    sunLight.position.lerpVectors(MOON_END_POS, BASE_LIGHT_POS, cycleState.restoreT);
    sunLight.intensity = 0.3 + cycleState.restoreT * 1.2;
    sunLight.color.copy(SUNSET_LIGHT).lerp(BASE_LIGHT_COLOR, cycleState.restoreT);
  } else if (cycleState.moonT > 0 || cycleState.nightMix > 0.5) {
    sunLight.position.set(0, -6, 2);
    sunLight.intensity = 0;
  } else {
    sunLight.position.set(Math.cos(azS) * 14, Math.max(Math.sin(azS) * 10, 1.2), -6);
    sunLight.intensity = (0.5 + day * 1.6) * dayness;
    sunLight.color.copy(SUN_LIGHT).lerp(SUNSET_LIGHT, warm * 0.85);
  }

  moonLight.position.set(Math.cos(azM) * 14, Math.max(Math.sin(azM) * 10, 1.2), -6);
  moonLight.intensity =
    0.45 * cycleState.nightMix * (0.35 + 0.65 * moonUp) * (1 - cycleState.restoreT);

  // atmosphere
  skyMat.color
    .copy(WHITE)
    .lerp(WARM_SKY, warm * 0.4 * dayness)
    .lerp(NIGHT_SKY, cycleState.nightMix);
  const fogCol = new THREE.Color()
    .copy(BASE_FOG)
    .lerp(WARM_FOG, warm * 0.3 * dayness)
    .lerp(NIGHT_FOG, cycleState.nightMix);
  (scene.fog as THREE.FogExp2).color.copy(fogCol);
  (scene.background as THREE.Color).copy(fogCol);
  hemi.intensity = 1.25 * (1 - cycleState.nightMix * 0.72);
}

const cycleTimeline = gsap.timeline({
  paused: true,
  onUpdate: applyCycleState,
  onComplete: () => {
    cycleState.idle = true;
    cycling = false;
    applyCycleState();
    const btn = document.getElementById('lw-cycle') as HTMLButtonElement | null;
    if (btn) btn.disabled = false;
  },
});
cycleTimeline
  .to(cycleState, { sunT: 1, duration: 9, ease: 'none' }, 0)
  .to(cycleState, { nightMix: 1, duration: 2.2, ease: 'power1.inOut' }, 8.2)
  .to(cycleState, { moonT: 1, duration: 7.5, ease: 'none' }, 10.2)
  .to(cycleState, { restoreT: 1, nightMix: 0, duration: 3.5, ease: 'power1.inOut' }, 17.7);

const cycleBtn = document.getElementById('lw-cycle') as HTMLButtonElement | null;
if (reduced) {
  if (cycleBtn) cycleBtn.style.display = 'none';
} else {
  cycleBtn?.addEventListener('click', () => {
    if (cycling) return;
    cycling = true;
    cycleBtn.disabled = true;
    lastScan = t; // hold off the periodic wireframe pulse during the cycle
    cycleState.idle = false;
    cycleState.sunT = 0;
    cycleState.moonT = 0;
    cycleState.nightMix = 0;
    cycleState.restoreT = 0;
    cycleTimeline.restart();
  });
}

/* ————— wireframe scan: periodic pulse + manual trigger ————— */

function runScan(): void {
  archMats.forEach((mat, i) => {
    gsap.delayedCall(i * 0.07, () => {
      mat.wireframe = true;
      gsap.delayedCall(0.5, () => {
        mat.wireframe = false;
      });
    });
  });
  groundMat.wireframe = true;
  gsap.delayedCall(0.55, () => {
    groundMat.wireframe = false;
  });
}

document.getElementById('lw-explore')?.addEventListener('click', runScan);
let lastScan = 0;

/* ————— interaction state ————— */

let drift = !reduced;
let mouseX = 0;
let mouseY = 0;
let camX = 0;
let camY = 1.5;
let ringX = -100;
let ringY = -100;
let ringTX = -100;
let ringTY = -100;

const ring = document.getElementById('lw-cursor');
const finePointer = window.matchMedia('(pointer: fine)').matches;
if (ring && finePointer && !reduced) ring.hidden = false;

window.addEventListener('pointermove', (e) => {
  mouseX = (e.clientX / window.innerWidth) * 2 - 1;
  mouseY = 1 - (e.clientY / window.innerHeight) * 2;
  ringTX = e.clientX;
  ringTY = e.clientY;
});

/* ————— intro ————— */

if (!reduced) {
  archGroups.forEach((group, i) => {
    gsap.to(group.userData, {
      base: 1,
      duration: 1.7,
      delay: 0.3 + i * 0.12,
      ease: 'elastic.out(1, 0.65)',
    });
  });
  gsap.from('.lw-nav', {
    opacity: 0,
    y: -36,
    duration: 1.0,
    ease: 'power3.out',
    delay: 0.35,
    clearProps: 'opacity,transform',
  });
  gsap.from('[data-lw-ui]:not(.lw-nav)', {
    opacity: 0,
    y: 26,
    duration: 1.1,
    stagger: 0.09,
    ease: 'power3.out',
    delay: 0.55,
    clearProps: 'opacity,transform',
  });
}

/* ————— loop ————— */

const timer = new THREE.Timer();
let t = 0;

function frame(): void {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  t += dt;

  if (!cycling && t - lastScan > 15) {
    lastScan = t;
    runScan();
  }

  // erratic flutter: speed-modulated multi-sine path
  const bt = t * (1 + 0.4 * Math.sin(t * 0.21));
  const flap = Math.sin(t * 16) * 0.85;
  wingL.rotation.y = flap;
  wingR.rotation.y = -flap;
  butterfly.position.set(
    Math.sin(bt * 0.9) * 3.6 + Math.sin(bt * 2.3) * 0.9,
    1.5 + Math.sin(bt * 1.7) * 0.5 + Math.sin(bt * 3.1) * 0.18,
    -2.5 + Math.cos(bt * 0.6) * 2.6
  );
  butterfly.quaternion.copy(camera.quaternion);

  const motePos = moteGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < MOTES; i++) {
    let y = motePos.getY(i) - dt * 0.14;
    if (y < 0) y = 7.5;
    motePos.setY(i, y);
  }
  motePos.needsUpdate = true;

  archGroups.forEach((group, i) => {
    const base = group.userData.base as number;
    group.scale.setScalar(base * (1 + Math.sin(t * 0.45 + i * 1.3) * 0.008));
  });

  const driftX = drift ? Math.sin(t * 0.11) * 0.8 : 0;
  const driftY = drift ? Math.sin(t * 0.07) * 0.3 : 0;
  camX += (mouseX * 1.4 + driftX - camX) * 0.04;
  camY += (1.5 + mouseY * 0.45 + driftY - camY) * 0.04;
  camera.position.set(camX, camY, 9.5);
  camera.lookAt(0, 1.3, -2);

  if (ring && !ring.hidden) {
    ringX += (ringTX - ringX) * 0.18;
    ringY += (ringTY - ringY) * 0.18;
    ring.style.transform = `translate(${ringX}px, ${ringY}px)`;
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
  camera.lookAt(0, 1.3, -2);
  renderer.render(scene, camera);
} else {
  frame();
}
