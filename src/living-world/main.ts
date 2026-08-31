import * as THREE from 'three';
import gsap from 'gsap';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { watchQuality } from '../lab-quality';
import './style.css';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ————— static camera views for screenshots (?view=close|crest) ————— */

const VIEWS: Record<string, { pos: [number, number, number]; look: [number, number, number] }> = {
  close: { pos: [-3.2, 1.1, -1.2], look: [-4.4, 1.2, -3.5] },
  crest: { pos: [0, 2.65, -16], look: [0, 1.4, -5] },
};
const viewParam = new URLSearchParams(window.location.search).get('view');
const viewOverride = viewParam && VIEWS[viewParam] ? VIEWS[viewParam] : null;

/* ————— seeded procedural moss texture ————— */

function makeMossCanvas(seed: number, size = 2048): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  let s = seed;
  const rand = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };

  // detail scales with resolution so the look stays identical at any size
  const k = size / 512;

  ctx.fillStyle = '#2f4a22';
  ctx.fillRect(0, 0, size, size);
  // palette nudged a few percent toward emerald for the fresh-morning grade
  const accents = ['#3a5c28', '#487030', '#548238', '#2a4218', '#5e8a3c', '#6a9a46', '#84b25a'];
  for (let i = 0; i < 3200 * k * k; i++) {
    ctx.globalAlpha = 0.22 + rand() * 0.5;
    ctx.fillStyle = accents[Math.floor(rand() * accents.length)];
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, (0.8 + rand() * 6.5) * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.75;
  for (let i = 0; i < 320 * k * k; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#8aba60' : '#aad27e';
    ctx.fillRect(rand() * size, rand() * size, 1.5 * k, 1.5 * k);
  }
  ctx.globalAlpha = 1;
  return canvas;
}

/* ————— moss detail maps: normal + roughness derived from the moss color canvas ————— */

// luminance becomes a height field; central differences give tangent-space
// normals, inverted luminance gives roughness (bright clumps sit smoother)
function makeMossDetailMaps(
  src: HTMLCanvasElement,
  size = 1024
): { normal: HTMLCanvasElement; rough: HTMLCanvasElement } {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = normalCanvas.height = size;
  const nctx = normalCanvas.getContext('2d');
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = roughCanvas.height = size;
  const rctx = roughCanvas.getContext('2d');
  if (!ctx || !nctx || !rctx) return { normal: normalCanvas, rough: roughCanvas };

  ctx.drawImage(src, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const lum = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    lum[i] =
      (data[i * 4] * 0.2126 + data[i * 4 + 1] * 0.7152 + data[i * 4 + 2] * 0.0722) / 255;
  }

  const nImg = nctx.createImageData(size, size);
  const rImg = rctx.createImageData(size, size);
  const L = (x: number, y: number): number => lum[((y + size) % size) * size + ((x + size) % size)];
  const STR = 2.2; // height→normal strength
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = (L(x + 1, y) - L(x - 1, y)) * STR;
      const dy = (L(x, y + 1) - L(x, y - 1)) * STR;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const j = i * 4;
      nImg.data[j] = (-dx * inv * 0.5 + 0.5) * 255;
      nImg.data[j + 1] = (dy * inv * 0.5 + 0.5) * 255;
      nImg.data[j + 2] = (inv * 0.5 + 0.5) * 255;
      nImg.data[j + 3] = 255;
      // inverted luminance → roughness, clamped to a believable moss band
      const rough = Math.min(1, Math.max(0.55, 1 - lum[i] * 0.8));
      rImg.data[j] = rImg.data[j + 1] = rImg.data[j + 2] = rough * 255;
      rImg.data[j + 3] = 255;
    }
  }
  nctx.putImageData(nImg, 0, 0);
  rctx.putImageData(rImg, 0, 0);
  return { normal: normalCanvas, rough: roughCanvas };
}

/* ————— grass tuft cards: painted blades at 1024², gradient blades, 3 variants ————— */

// each card: tapered curved blades, dark at the root and lighter at the tip
function makeBladeTexture(variant: number): THREE.CanvasTexture {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    let s = 7 + variant * 7919;
    const rand = (): number => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    const blades = 6 + variant;
    const spreads = [0.8, 0.72, 0.88][variant];
    for (let b = 0; b < blades; b++) {
      const bx = size * (0.1 + 0.8 * (b / (blades - 1))) + (rand() - 0.5) * size * 0.05;
      const lean = (rand() - 0.5) * size * 0.22 * spreads;
      const top = size * (0.04 + rand() * 0.3);
      const w = size * (0.018 + rand() * 0.012);
      const grad = ctx.createLinearGradient(0, size, 0, top);
      grad.addColorStop(0, '#33582a');
      grad.addColorStop(0.55, ['#5a8434', '#54802e', '#649038'][b % 3]);
      grad.addColorStop(1, ['#9ccc68', '#8fc25e', '#a8d478'][b % 3]);
      ctx.fillStyle = grad;
      // slight S-curve: the control point pulls the blade over as it rises
      const midY = size - (size - top) * 0.55;
      ctx.beginPath();
      ctx.moveTo(bx - w / 2, size);
      ctx.quadraticCurveTo(bx - w / 4 + lean * 0.25, midY, bx + lean, top);
      ctx.quadraticCurveTo(bx + w / 4 + lean * 0.35, midY, bx + w / 2, size);
      ctx.closePath();
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGlowSprite(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(canvas);
}

/* ————— scene ————— */

const BG = 0x525e44; // lighter, greener morning haze
const canvas = document.getElementById('lw-gl') as HTMLCanvasElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.fog = new THREE.FogExp2(BG, 0.033);

const camera = new THREE.PerspectiveCamera(
  42,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 1.5, 9.5);

const hemi = new THREE.HemisphereLight(0xc0cdb0, 0x171c12, 1.4);
scene.add(hemi);

// the sun is the key light; the moon is a dim cool fill — both cast real shadows
const sunLight = new THREE.DirectionalLight(0xe9f0d2, 1.5);
sunLight.position.set(5, 9, 7);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(4096, 4096);
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
moonLight.shadow.mapSize.set(2048, 2048);
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

const mossCanvas = makeMossCanvas(1234);
const mossDetail = makeMossDetailMaps(mossCanvas);

const mossTex = new THREE.CanvasTexture(mossCanvas);
mossTex.wrapS = mossTex.wrapT = THREE.RepeatWrapping;
mossTex.repeat.set(4, 3);
mossTex.colorSpace = THREE.SRGBColorSpace;
mossTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

// relief maps share the color map's tiling (linear color space by default)
const mossNormalTex = new THREE.CanvasTexture(mossDetail.normal);
mossNormalTex.wrapS = mossNormalTex.wrapT = THREE.RepeatWrapping;
mossNormalTex.repeat.set(4, 3);
const mossRoughTex = new THREE.CanvasTexture(mossDetail.rough);
mossRoughTex.wrapS = mossRoughTex.wrapT = THREE.RepeatWrapping;
mossRoughTex.repeat.set(4, 3);

const groundTex = mossTex.clone();
groundTex.repeat.set(14, 14);
groundTex.needsUpdate = true;
const groundNormalTex = mossNormalTex.clone();
groundNormalTex.repeat.set(14, 14);
groundNormalTex.needsUpdate = true;
const groundRoughTex = mossRoughTex.clone();
groundRoughTex.repeat.set(14, 14);
groundRoughTex.needsUpdate = true;
const groundMat = new THREE.MeshStandardMaterial({
  color: 0x3f4830,
  map: groundTex,
  normalMap: groundNormalTex,
  normalScale: new THREE.Vector2(0.6, 0.6),
  roughnessMap: groundRoughTex,
  roughness: 1,
});
const ground = new THREE.Mesh(new THREE.CircleGeometry(45, 48), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
ground.receiveShadow = true;
scene.add(ground);

// fresh morning sky: green-blue zenith over a bright, clean horizon
function makeSkyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#6f8272');
    grad.addColorStop(0.4, '#93a582');
    grad.addColorStop(0.58, '#aeb98d');
    grad.addColorStop(0.72, '#5e6650');
    grad.addColorStop(1, '#333a2b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// sky dome: inverted sphere so no plane edge can ever show mid-ride
const skyMat = new THREE.MeshBasicMaterial({
  map: makeSkyTexture(),
  fog: false,
  side: THREE.BackSide,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(65, 32, 16), skyMat);
sky.position.set(0, 0, -8);
scene.add(sky);

/* ————— horizon mist: a soft band that melts the ground/sky seam ————— */

// alpha-only gradient; the material color carries the tint so the day-night
// cycle can darken it like the sky
function makeMistTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.34, 'rgba(255,255,255,0)');
    grad.addColorStop(0.52, 'rgba(255,255,255,0.5)');
    grad.addColorStop(0.66, 'rgba(255,255,255,0.3)');
    grad.addColorStop(0.8, 'rgba(255,255,255,0.1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 256);
  }
  return new THREE.CanvasTexture(c);
}

const MIST_BASE = new THREE.Color(0x66745a); // fog family, a touch lighter toward the sky
const mistMat = new THREE.MeshBasicMaterial({
  map: makeMistTexture(),
  color: MIST_BASE,
  transparent: true,
  fog: false,
  depthWrite: false,
  side: THREE.BackSide,
});
// open ring around the arch cluster: behind the arches, in front of the sky dome
const mist = new THREE.Mesh(new THREE.CylinderGeometry(36, 36, 16, 64, 1, true), mistMat);
mist.position.set(0, 1.2, -8); // band peak lands just above the horizon line
scene.add(mist);

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
  const geo = new THREE.TorusGeometry(def.radius, def.tube, 40, 180, Math.PI);
  jitter(geo, 0.1, i * 7.13 + 1.7);
  const mat = new THREE.MeshStandardMaterial({
    map: mossTex,
    normalMap: mossNormalTex,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughnessMap: mossRoughTex,
    roughness: 1,
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
    const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.1, 0.55, 12), archMats[k]);
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

/* ————— grass: wind sway + sun backlight, patched into the standard material ————— */

const grassUniforms = {
  uTime: { value: 0 },
  uSunView: { value: new THREE.Vector3(0, 0, 1) },
  uGlow: { value: new THREE.Color(0x8fb45e).multiplyScalar(0.3) },
};

// tip-weighted sway in the vertex stage, sun-through-blades lift in the fragment
function injectGrassShader(mat: THREE.MeshStandardMaterial): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = grassUniforms.uTime;
    shader.uniforms.uSunView = grassUniforms.uSunView;
    shader.uniforms.uGlow = grassUniforms.uGlow;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vTipT;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            float ph = instanceMatrix[3][0] * 1.7 + instanceMatrix[3][2] * 2.3;
          #else
            float ph = 0.0;
          #endif
          float tipT = clamp(transformed.y, 0.0, 1.0);
          vTipT = tipT;
          transformed.x += sin(uTime * 0.9 + ph) * 0.03 * tipT;
          transformed.z += cos(uTime * 0.7 + ph * 1.3) * 0.02 * tipT;
        }`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uSunView;\nuniform vec3 uGlow;\nvarying float vTipT;'
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 toFrag = -normalize(vViewPosition);
          float back = pow(clamp(dot(toFrag, uSunView), 0.0, 1.0), 3.0);
          totalEmissiveRadiance += uGlow * (back * vTipT);
        }`
      );
  };
}

// smooth trig-noise field in [0,1]: thresholding it makes drifts, not confetti
function clumpField(x: number, z: number): number {
  const n =
    Math.sin(x * 0.42 + 1.3) * Math.cos(z * 0.37 - 0.8) +
    0.5 * Math.sin(x * 0.83 - 2.1) * Math.cos(z * 0.71 + 0.4) +
    0.25 * Math.sin((x + z) * 1.3 + 1.1);
  return n / 1.75 + 0.5;
}

/* ————— grass tufts: instanced crossed planes, three painted blade cards ————— */

// two quads crossed at 90°, pivot at the ground
function makeTuftGeometry(): THREE.BufferGeometry {
  const p1 = new THREE.PlaneGeometry(1, 1).toNonIndexed();
  p1.translate(0, 0.5, 0);
  const p2 = p1.clone();
  p2.rotateY(Math.PI / 2);
  const geo = new THREE.BufferGeometry();
  const concat = (name: string, size: number): void => {
    const a = p1.getAttribute(name) as THREE.BufferAttribute;
    const b = p2.getAttribute(name) as THREE.BufferAttribute;
    const arr = new Float32Array((a.count + b.count) * size);
    arr.set(a.array as Float32Array, 0);
    arr.set(b.array as Float32Array, a.count * size);
    geo.setAttribute(name, new THREE.BufferAttribute(arr, size));
  };
  concat('position', 3);
  concat('normal', 3);
  concat('uv', 2);
  return geo;
}

const GRASS = 700;
const grassMats = [0, 1, 2].map((v) => {
  const mat = new THREE.MeshStandardMaterial({
    map: makeBladeTexture(v),
    alphaToCoverage: true, // soft edges via the composer's MSAA target
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
  });
  injectGrassShader(mat);
  return mat;
});
const grassMeshes = grassMats.map(
  (mat) => new THREE.InstancedMesh(makeTuftGeometry(), mat, Math.ceil(GRASS / grassMats.length))
);
{
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  const placed = grassMeshes.map(() => 0);
  let total = 0;
  let guard = 0;
  while (total < GRASS && guard++ < 60000) {
    const ang = Math.random() * Math.PI * 2;
    // sqrt falloff packs tufts toward the arch cluster at (0, -6)
    const rad = Math.sqrt(Math.random()) * 13.5;
    const x = Math.cos(ang) * rad;
    const z = -6 + Math.sin(ang) * rad;
    // keep the ride corridor through the middle mostly clear
    if (Math.abs(x) < 1.1 && z > -12 && z < 6 && Math.random() < 0.85) continue;
    // clumped distribution: tufts grow in drifts where the field passes the threshold
    if (clumpField(x, z) < 0.52) continue;
    const s = 0.25 + Math.random() * 0.27;
    dummy.position.set(x, -0.02, z);
    dummy.rotation.set(0, Math.random() * Math.PI, 0);
    dummy.scale.set(s, s * (0.85 + Math.random() * 0.35), s);
    dummy.updateMatrix();
    const variant = total % grassMeshes.length;
    grassMeshes[variant].setMatrixAt(placed[variant], dummy.matrix);
    // slight per-instance color variation, fresh greens
    tint.setHSL(0.24 + Math.random() * 0.07, 0.45 + Math.random() * 0.2, 0.56 + Math.random() * 0.24);
    grassMeshes[variant].setColorAt(placed[variant], tint);
    placed[variant]++;
    total++;
  }
  grassMeshes.forEach((mesh, i) => {
    mesh.count = placed[i];
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
  });
}

/* ————— foreground LOD: real tapered blades in the near strip (z > 2) ————— */

// 7 verts, 5 triangles, slight backward bend; vertex colors run dark→light
function makeBladeGeometry(): THREE.BufferGeometry {
  const w = 0.05;
  const bend = 0.06;
  const pos = new Float32Array([
    -w, 0, 0, w, 0, 0,
    -0.7 * w, 0.33, bend * 0.4, 0.7 * w, 0.33, bend * 0.4,
    -0.38 * w, 0.66, bend, 0.38 * w, 0.66, bend,
    0, 1, bend * 1.7,
  ]);
  const idx = [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6];
  const uvs = new Float32Array([0, 0, 1, 0, 0, 0.33, 1, 0.33, 0, 0.66, 1, 0.66, 0.5, 1]);
  const dark = new THREE.Color(0x33582a);
  const light = new THREE.Color(0x9ccc68);
  const col = new Float32Array(7 * 3);
  const heights = [0, 0, 0.33, 0.33, 0.66, 0.66, 1];
  const tmp = new THREE.Color();
  for (let i = 0; i < 7; i++) {
    tmp.copy(dark).lerp(light, heights[i]);
    col[i * 3] = tmp.r;
    col[i * 3 + 1] = tmp.g;
    col[i * 3 + 2] = tmp.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(idx);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

const BLADES = 380;
const bladeMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  side: THREE.DoubleSide,
  roughness: 1,
  metalness: 0,
});
injectGrassShader(bladeMat);
const bladeMesh = new THREE.InstancedMesh(makeBladeGeometry(), bladeMat, BLADES);
{
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  let placed = 0;
  let guard = 0;
  while (placed < BLADES && guard++ < 40000) {
    const x = (Math.random() - 0.5) * 19;
    const z = 2.2 + Math.random() * 6.8;
    // the ride starts down this strip — keep the center clear
    if (Math.abs(x) < 1.3) continue;
    if (clumpField(x, z) < 0.45) continue;
    const s = 0.35 + Math.random() * 0.3;
    dummy.position.set(x, -0.02, z);
    dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    dummy.scale.set(s, s * (0.85 + Math.random() * 0.35), s);
    dummy.updateMatrix();
    bladeMesh.setMatrixAt(placed, dummy.matrix);
    tint.setHSL(0.24 + Math.random() * 0.07, 0.45 + Math.random() * 0.2, 0.56 + Math.random() * 0.24);
    bladeMesh.setColorAt(placed, tint);
    placed++;
  }
  bladeMesh.count = placed;
  bladeMesh.receiveShadow = true;
  bladeMesh.instanceMatrix.needsUpdate = true;
  if (bladeMesh.instanceColor) bladeMesh.instanceColor.needsUpdate = true;
  scene.add(bladeMesh);
}

/* ————— mushroom clusters at the arch bases ————— */

const capMat = new THREE.MeshStandardMaterial({
  color: 0x9c6f3d,
  roughness: 0.65,
  emissive: 0x2a1408,
  emissiveIntensity: 0.35,
});
const stemMat = new THREE.MeshStandardMaterial({ color: 0xd8cdb0, roughness: 0.9 });
const capGeo = new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const stemGeo = new THREE.CylinderGeometry(0.34, 0.5, 1, 8);

// one foot of each of five arches, alternating sides
const clusterSpots: THREE.Vector3[] = [];
[0, 1, 2, 4, 5].forEach((ai, k) => {
  const def = ARCHES[ai];
  const lx = def.radius * (k % 2 === 0 ? 1 : -1);
  clusterSpots.push(
    new THREE.Vector3(def.x + Math.cos(def.rotY) * lx, 0, def.z - Math.sin(def.rotY) * lx)
  );
});

clusterSpots.forEach((spot) => {
  const cluster = new THREE.Group();
  const count = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const shroom = new THREE.Group();
    const s = 0.09 + Math.random() * 0.15;
    const stemH = 0.09 + Math.random() * 0.08;
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.scale.set(s * 0.5, stemH, s * 0.5);
    stem.position.y = stemH / 2;
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.scale.set(s, s * 0.62, s);
    cap.position.y = stemH;
    cap.castShadow = true;
    stem.castShadow = true;
    shroom.add(stem, cap);
    shroom.position.set((Math.random() - 0.5) * 0.55, 0, (Math.random() - 0.5) * 0.55);
    shroom.rotation.y = Math.random() * Math.PI * 2;
    shroom.rotation.z = (Math.random() - 0.5) * 0.18;
    cluster.add(shroom);
  }
  cluster.position.set(spot.x, -0.02, spot.z);
  scene.add(cluster);

  // a few faint spore motes hovering above each cluster
  const SPORES = 6;
  const sporePos = new Float32Array(SPORES * 3);
  for (let i = 0; i < SPORES; i++) {
    sporePos[i * 3] = spot.x + (Math.random() - 0.5) * 0.6;
    sporePos[i * 3 + 1] = 0.25 + Math.random() * 0.55;
    sporePos[i * 3 + 2] = spot.z + (Math.random() - 0.5) * 0.6;
  }
  const sporeGeo = new THREE.BufferGeometry();
  sporeGeo.setAttribute('position', new THREE.BufferAttribute(sporePos, 3));
  scene.add(
    new THREE.Points(
      sporeGeo,
      new THREE.PointsMaterial({
        size: 0.045,
        map: glowSprite,
        transparent: true,
        opacity: 0.45,
        color: 0xffe6b8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )
  );
});

/* ————— vines hanging from the two big foreground spans ————— */

interface Vine {
  group: THREE.Group;
  phase: number;
}
const vines: Vine[] = [];
const vineMat = new THREE.MeshStandardMaterial({ color: 0x3c5a26, roughness: 0.95 });
const leafMat = new THREE.MeshStandardMaterial({
  color: 0x558033,
  roughness: 0.85,
  side: THREE.DoubleSide,
});
const leafGeo = new THREE.PlaneGeometry(0.1, 0.14);

[0, 1].forEach((k) => {
  const def = ARCHES[k];
  const count = k === 0 ? 5 : 4;
  for (let i = 0; i < count; i++) {
    // ride-safety: the camera threads each opening at y≈1.4, so vines stay
    // outside the central ~60% of the opening (|cos u| ≥ 0.62 → |x_local| ≥
    // 2.1 on arch 0 vs 2.04 excluded, ≥ 1.6 on arch 1 vs 1.56 excluded) and
    // never reach the ground (len ≤ attach height − 0.25)
    const side = i % 2 === 0 ? 1 : -1;
    const u =
      side > 0
        ? 0.3 + ((i / 2 + 0.5) / Math.ceil(count / 2)) * 0.55 + (Math.random() - 0.5) * 0.08
        : Math.PI - (0.3 + ((Math.floor(i / 2) + 0.5) / Math.ceil(count / 2)) * 0.55) +
          (Math.random() - 0.5) * 0.08;
    const attachH = Math.sin(u) * def.radius;
    const len = Math.min(0.5 + Math.random() * 0.6, attachH - 0.25) * (def.radius / 3.4);
    if (len < 0.25) continue;
    const group = new THREE.Group();
    group.position.set(
      Math.cos(u) * def.radius,
      attachH,
      (Math.random() - 0.5) * def.tube * 1.2
    );
    const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, len, 6), vineMat);
    strand.geometry = strand.geometry.clone();
    strand.geometry.translate(0, -len / 2, 0); // hang from the attachment point
    strand.castShadow = true;
    group.add(strand);
    // a few small leaf planes down the strand
    const leaves = 2 + Math.floor(Math.random() * 3);
    for (let l = 0; l < leaves; l++) {
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      const f = 0.25 + (l / leaves) * 0.7 + Math.random() * 0.08;
      leaf.position.set((Math.random() - 0.5) * 0.05, -len * f, (Math.random() - 0.5) * 0.05);
      leaf.rotation.set(
        (Math.random() - 0.5) * 1.2,
        Math.random() * Math.PI,
        (Math.random() - 0.5) * 0.8
      );
      group.add(leaf);
    }
    archGroups[k].add(group); // rides the arch's breathing scale
    vines.push({ group, phase: Math.random() * Math.PI * 2 });
  }
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

/* ————— fireflies drifting near the arches ————— */

const FIREFLIES = 50;
const ffBase = new Float32Array(FIREFLIES * 3);
const ffPhase = new Float32Array(FIREFLIES);
for (let i = 0; i < FIREFLIES; i++) {
  ffBase[i * 3] = (Math.random() - 0.5) * 18;
  ffBase[i * 3 + 1] = 0.3 + Math.random() * 2.9;
  ffBase[i * 3 + 2] = -12 + Math.random() * 11;
  ffPhase[i] = Math.random() * Math.PI * 2;
}
const ffGeo = new THREE.BufferGeometry();
const ffPositions = new Float32Array(ffBase); // copy; tick() writes into it
ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPositions, 3));
scene.add(
  new THREE.Points(
    ffGeo,
    new THREE.PointsMaterial({
      size: 0.09,
      map: glowSprite,
      transparent: true,
      opacity: 0.5,
      color: 0xe8ffb0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  )
);

/* ————— butterflies ————— */

interface Fly {
  group: THREE.Group;
  wingL: THREE.Mesh;
  wingR: THREE.Mesh;
  phase: number;
  speed: number;
  tilt: number;
  cx: number;
  cy: number;
  cz: number;
  rx: number;
  ry: number;
  rz: number;
}

function makeButterfly(
  color: number,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  phase: number,
  speed: number,
  scale = 1,
  opacity = 0.9,
  tilt = 0
): Fly {
  const group = new THREE.Group();
  const wingMat = new THREE.MeshBasicMaterial({
    color,
    side: THREE.DoubleSide,
    transparent: true,
    opacity,
  });
  const wingGeoL = new THREE.PlaneGeometry(0.12, 0.09);
  wingGeoL.translate(-0.06, 0, 0);
  const wingGeoR = new THREE.PlaneGeometry(0.12, 0.09);
  wingGeoR.translate(0.06, 0, 0);
  const wingL = new THREE.Mesh(wingGeoL, wingMat);
  const wingR = new THREE.Mesh(wingGeoR, wingMat);
  group.add(wingL, wingR);
  group.scale.setScalar(scale);
  scene.add(group);
  return { group, wingL, wingR, phase, speed, tilt, cx, cy, cz, rx, ry, rz };
}

const flies: Fly[] = [
  // the original yellow one, front and center
  makeButterfly(0xd8e26a, 0, 1.5, -2.5, 3.6, 0.5, 2.6, 0, 1),
  // pale blue by the right arch, amber out back, white high on the left arch
  makeButterfly(0x9ecfff, 4.3, 1.7, -4.5, 1.7, 0.45, 1.3, 2.1, 1.15, 0.8, 0.78, 0.55),
  makeButterfly(0xffc46a, 3.2, 1.8, -10, 1.8, 0.55, 1.4, 1.2, 0.9, 0.8, 0.78, -0.6),
  makeButterfly(0xf2f2e8, -4.4, 2.2, -3.5, 1.4, 0.5, 1.1, 5.6, 1.3, 0.8, 0.78, 0.5),
];

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
    mistMat.color.copy(MIST_BASE);
    hemi.intensity = 1.4;
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
  // atmosphere
  skyMat.color
    .copy(WHITE)
    .lerp(WARM_SKY, warm * 0.4 * dayness)
    .lerp(NIGHT_SKY, cycleState.nightMix);
  mistMat.color.copy(MIST_BASE).lerp(NIGHT_FOG, cycleState.nightMix);
  const fogCol = new THREE.Color()
    .copy(BASE_FOG)
    .lerp(WARM_FOG, warm * 0.3 * dayness)
    .lerp(NIGHT_FOG, cycleState.nightMix);
  (scene.fog as THREE.FogExp2).color.copy(fogCol);
  (scene.background as THREE.Color).copy(fogCol);
  hemi.intensity = 1.4 * (1 - cycleState.nightMix * 0.72);
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

/* ————— wireframe scan: periodic pulse ————— */

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

/* ————— explore ride: a camera flight through the archways and home ————— */

// The path is anchored to the arch openings: approach/anchor/exit points
// are derived from each threaded arch's own transform, so the pass stays
// perpendicular to the opening. Between the two passes the camera rides a
// circular arc around the back field whose tangents match both arch
// corridors exactly — no kinks, no heading reversals.

function openingNormal(def: ArchDef): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(def.rotY), 0, Math.cos(def.rotY));
}

function openingPoint(def: ArchDef, along: number, height: number): THREE.Vector3 {
  const n = openingNormal(def);
  return new THREE.Vector3(def.x + n.x * along, height, def.z + n.z * along);
}

const wayOut = ARCHES[0]; // big left arch — exit through it
const wayHome = ARCHES[1]; // right arch — return through it

// back-field arc: circle centered (-0.14, -9.47) r 6.6, tangent-matched to
// the wayOut exit heading and the wayHome approach corridor; sampled every
// 30° of heading. The dip to y 1.2 at the rightmost point ducks under the
// small back-right arch's span (clearance-checked in .tmp/verify-ride.mjs)
const rideCurve = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(0, 1.5, 9.5), // idle framing
    new THREE.Vector3(-1.3, 1.45, 4.6), // lead-in
    openingPoint(wayOut, 3.2, 1.42), // approach
    openingPoint(wayOut, 0, 1.45), // through the opening
    openingPoint(wayOut, -3.2, 1.62), // exit, heading matched to the arc
    new THREE.Vector3(-6.2, 1.95, -10.2),
    new THREE.Vector3(-5.85, 2.15, -12.77),
    new THREE.Vector3(-3.44, 2.5, -15.19),
    new THREE.Vector3(-0.14, 2.65, -16.07), // crest, whole cluster in view
    new THREE.Vector3(3.16, 2.5, -15.19),
    new THREE.Vector3(5.58, 1.9, -12.77),
    new THREE.Vector3(6.7, 0.95, -9.5), // duck under the back-right arch
    new THREE.Vector3(5.58, 1.35, -6.17),
    openingPoint(wayHome, -0.95, 1.3), // tangent into the home corridor
    openingPoint(wayHome, 0, 1.3), // through the opening
    openingPoint(wayHome, 2.5, 1.38), // exit
    new THREE.Vector3(1.2, 1.45, 3.4), // lead home
    new THREE.Vector3(0, 1.5, 9.5), // idle framing
  ],
  false,
  'centripetal'
);

const LOOK_HOME = new THREE.Vector3(0, 1.3, -2);
const ARCH_FOCUS = new THREE.Vector3(0, 1.8, -6.8);
const rideLook = new THREE.Vector3();
const rideState = { u: 0 };
let riding = false;

const exploreBtn = document.getElementById('lw-explore') as HTMLButtonElement | null;
if (reduced) {
  if (exploreBtn) exploreBtn.style.display = 'none';
} else {
  exploreBtn?.addEventListener('click', () => {
    if (riding) return;
    riding = true;
    exploreBtn.disabled = true;
    lastScan = t; // no wireframe pulse mid-flight
    rideState.u = 0;
    gsap
      .timeline({
        onComplete: () => {
          riding = false;
          exploreBtn.disabled = false;
          lastScan = t;
          // hand control back to the parallax loop without a pop
          camX = camera.position.x;
          camY = camera.position.y;
          camera.fov = 42;
          camera.updateProjectionMatrix();
        },
      })
      .to(rideState, { u: 1, duration: 18, ease: 'power1.inOut' }, 0)
      .to(
        camera,
        {
          fov: 38,
          duration: 12,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: 1,
          onUpdate: () => camera.updateProjectionMatrix(),
        },
        0
      );
  });
}

let lastScan = 0;

/* ————— design note toggle ————— */

const noteBtn = document.getElementById('lw-note-btn') as HTMLButtonElement | null;
const notePanel = document.getElementById('lw-note-panel') as HTMLElement | null;

function setNoteOpen(open: boolean): void {
  if (!noteBtn || !notePanel) return;
  noteBtn.setAttribute('aria-expanded', String(open));
  notePanel.hidden = !open;
}

noteBtn?.addEventListener('click', () => {
  if (!noteBtn || !notePanel) return;
  setNoteOpen(noteBtn.getAttribute('aria-expanded') !== 'true');
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && notePanel && !notePanel.hidden) {
    setNoteOpen(false);
    noteBtn?.focus();
  }
});

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

/* ————— adaptive quality ————— */

let qualityTier = 0;
function stepQualityDown(): void {
  qualityTier++;
  if (qualityTier === 1) {
    const pr = Math.min(window.devicePixelRatio, 1.5);
    renderer.setPixelRatio(pr);
    composer.setPixelRatio(pr);
    return;
  }
  // a smaller shadow fbo only takes effect once the old map is disposed
  for (const light of [sunLight, moonLight]) {
    light.shadow.map?.dispose();
    light.shadow.map = null;
    light.shadow.mapSize.multiplyScalar(0.5);
  }
}

/* ————— bloom composer (after quality helpers so sizes stay in sync) ————— */

const composer = new EffectComposer(renderer);
composer.renderTarget1.samples = 4; // MSAA so alphaToCoverage grass gets soft edges
composer.renderTarget2.samples = 4;
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.35, // strength
  0.5, // radius
  0.85 // threshold — only dew, fireflies, spores and the sun/moon glow
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

/* ————— dynamic bits shared by the loop and the static render ————— */

function tick(time: number): void {
  // grass wind + backlight uniforms
  grassUniforms.uTime.value = time;
  grassUniforms.uSunView.value
    .copy(sunLight.position)
    .normalize()
    .transformDirection(camera.matrixWorldInverse);

  // erratic flutter: speed-modulated multi-sine paths, one per butterfly
  flies.forEach((f) => {
    const bt = time * f.speed * (1 + 0.4 * Math.sin(time * 0.21 + f.phase)) + f.phase;
    const flap = Math.sin(time * 16 * f.speed + f.phase) * 0.85;
    f.wingL.rotation.y = flap;
    f.wingR.rotation.y = -flap;
    f.group.position.set(
      f.cx + Math.sin(bt * 0.9) * f.rx + Math.sin(bt * 2.3) * f.rx * 0.25,
      f.cy + Math.sin(bt * 1.7) * f.ry + Math.sin(bt * 3.1) * 0.16,
      f.cz + Math.cos(bt * 0.6) * f.rz
    );
    f.group.quaternion.copy(camera.quaternion);
    if (f.tilt !== 0) {
      // banking keeps distant butterflies reading as insects, not paper scraps
      f.group.rotateZ(f.tilt + Math.sin(time * 0.7 + f.phase) * 0.15);
    }
  });

  // fireflies: slow drift + gentle per-point bobbing
  const ffPos = ffGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < FIREFLIES; i++) {
    const p = ffPhase[i];
    ffPos.setXYZ(
      i,
      ffBase[i * 3] + Math.sin(time * 0.22 + p) * 0.5,
      ffBase[i * 3 + 1] + Math.sin(time * 0.6 + p * 1.3) * 0.28,
      ffBase[i * 3 + 2] + Math.cos(time * 0.18 + p * 0.7) * 0.4
    );
  }
  ffPos.needsUpdate = true;

  // vines: slow subtle sway
  vines.forEach((v) => {
    v.group.rotation.z = Math.sin(time * 0.55 + v.phase) * 0.07;
    v.group.rotation.x = Math.cos(time * 0.42 + v.phase * 1.3) * 0.05;
  });
}

/* ————— loop ————— */

const timer = new THREE.Timer();
let t = 0;

function frame(): void {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  t += dt;

  tick(t);

  if (!cycling && !riding && t - lastScan > 15) {
    lastScan = t;
    runScan();
  }

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

  if (riding) {
    const u = rideState.u;
    camera.position.copy(rideCurve.getPointAt(u));
    // lead the camera by a long lookahead so heading changes stay gradual
    rideLook.copy(rideCurve.getPointAt(Math.min(u + 0.06, 1)));
    // mid-flight, pull the gaze toward the arch cluster so the subject stays
    // framed instead of staring down the tangent into empty back field;
    // hold the pull until the final lead home so the arches recede in frame
    const focusWindow =
      THREE.MathUtils.smoothstep(u, 0.1, 0.3) * (1 - THREE.MathUtils.smoothstep(u, 0.8, 0.97));
    rideLook.lerp(ARCH_FOCUS, focusWindow * 0.72);
    // ease the gaze from/to the idle framing at both ends of the flight
    const homeBlend = Math.max(
      1 - THREE.MathUtils.smoothstep(u, 0, 0.08),
      THREE.MathUtils.smoothstep(u, 0.82, 0.97)
    );
    camera.lookAt(rideLook.lerp(LOOK_HOME, homeBlend));
  } else if (viewOverride) {
    camera.position.set(...viewOverride.pos);
    camera.lookAt(...viewOverride.look);
  } else {
    const driftX = drift ? Math.sin(t * 0.11) * 0.8 : 0;
    const driftY = drift ? Math.sin(t * 0.07) * 0.3 : 0;
    camX += (mouseX * 1.4 + driftX - camX) * 0.04;
    camY += (1.5 + mouseY * 0.45 + driftY - camY) * 0.04;
    camera.position.set(camX, camY, 9.5);
    camera.lookAt(0, 1.3, -2);
  }

  if (ring && !ring.hidden) {
    ringX += (ringTX - ringX) * 0.18;
    ringY += (ringTY - ringY) * 0.18;
    ring.style.transform = `translate(${ringX}px, ${ringY}px)`;
  }

  composer.render();
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  if (reduced) composer.render();
});

if (reduced) {
  tick(3.1); // settle the motion mid-cycle for the still
  if (viewOverride) {
    camera.position.set(...viewOverride.pos);
    camera.lookAt(...viewOverride.look);
  } else {
    camera.lookAt(0, 1.3, -2);
  }
  composer.render();
} else {
  frame();
  watchQuality(stepQualityDown);
}
