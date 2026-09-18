import * as THREE from 'three';
import gsap from 'gsap';
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

// grass tuft card: 6 tapered blades with soft variation, alpha-tested
function makeBladeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    const greens = ['#3f6428', '#4e7a30', '#5f8f3a', '#6fa044', '#87b457'];
    let s = 7;
    const rand = (): number => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (let b = 0; b < 6; b++) {
      const bx = 16 + b * 19 + rand() * 8;
      const lean = (rand() - 0.5) * 26;
      const top = 8 + rand() * 34;
      const w = 7 + rand() * 5;
      ctx.fillStyle = greens[b % greens.length];
      ctx.beginPath();
      ctx.moveTo(bx - w / 2, 128);
      ctx.quadraticCurveTo(bx - w / 4 + lean * 0.3, 128 - (128 - top) * 0.6, bx + lean, top);
      ctx.quadraticCurveTo(bx + w / 4 + lean * 0.3, 128 - (128 - top) * 0.6, bx + w / 2, 128);
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

const mossTex = new THREE.CanvasTexture(makeMossCanvas(1234));
mossTex.wrapS = mossTex.wrapT = THREE.RepeatWrapping;
mossTex.repeat.set(4, 3);
mossTex.colorSpace = THREE.SRGBColorSpace;
mossTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

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

/* ————— grass tufts: instanced crossed planes with a painted blade card ————— */

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
const grassMat = new THREE.MeshStandardMaterial({
  map: makeBladeTexture(),
  alphaTest: 0.45,
  side: THREE.DoubleSide,
  roughness: 1,
  metalness: 0,
});
const grass = new THREE.InstancedMesh(makeTuftGeometry(), grassMat, GRASS);
grass.receiveShadow = true;
{
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  let placed = 0;
  let guard = 0;
  while (placed < GRASS && guard++ < 40000) {
    const ang = Math.random() * Math.PI * 2;
    // sqrt falloff packs tufts toward the arch cluster at (0, -6)
    const rad = Math.sqrt(Math.random()) * 13.5;
    const x = Math.cos(ang) * rad;
    const z = -6 + Math.sin(ang) * rad;
    // keep the ride corridor through the middle mostly clear
    if (Math.abs(x) < 1.1 && z > -12 && z < 6 && Math.random() < 0.85) continue;
    const s = 0.25 + Math.random() * 0.27;
    dummy.position.set(x, -0.02, z);
    dummy.rotation.set(0, Math.random() * Math.PI, 0);
    dummy.scale.set(s, s * (0.85 + Math.random() * 0.35), s);
    dummy.updateMatrix();
    grass.setMatrixAt(placed, dummy.matrix);
    // slight per-instance color variation, fresh greens
    tint.setHSL(0.24 + Math.random() * 0.07, 0.45 + Math.random() * 0.2, 0.56 + Math.random() * 0.24);
    grass.setColorAt(placed, tint);
    placed++;
  }
  grass.count = placed;
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
}
scene.add(grass);

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
    new THREE.Vector3(
      def.x + Math.cos(def.rotY) * lx,
      0,
      def.z - Math.sin(def.rotY) * lx
    )
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
    // spread along the upper span with jitter
    const u = 0.45 + ((i + 0.5) / count) * (Math.PI - 0.9) + (Math.random() - 0.5) * 0.14;
    const len = (0.5 + Math.random() * 0.6) * (def.radius / 3.4);
    const group = new THREE.Group();
    group.position.set(
      Math.cos(u) * def.radius,
      Math.sin(u) * def.radius,
      (Math.random() - 0.5) * def.tube * 1.2
    );
    const strand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.014, len, 6),
      vineMat
    );
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    return;
  }
  // a smaller shadow fbo only takes effect once the old map is disposed
  for (const light of [sunLight, moonLight]) {
    light.shadow.map?.dispose();
    light.shadow.map = null;
    light.shadow.mapSize.multiplyScalar(0.5);
  }
}

/* ————— dynamic bits shared by the loop and the static render ————— */

function tick(time: number): void {
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
  tick(3.1); // settle the motion mid-cycle for the still
  if (viewOverride) {
    camera.position.set(...viewOverride.pos);
    camera.lookAt(...viewOverride.look);
  } else {
    camera.lookAt(0, 1.3, -2);
  }
  renderer.render(scene, camera);
} else {
  frame();
  watchQuality(stepQualityDown);
}
