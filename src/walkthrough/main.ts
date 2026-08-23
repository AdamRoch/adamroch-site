import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { watchQuality } from '../lab-quality';
import {
  setEnabled as setAudioEnabled,
  setHeadCloseness,
  boom,
  chargeTone,
  chime,
  duck,
  horn,
  setRumble,
  stopRumble,
} from './audio';
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
const beachFog = new THREE.Fog(FOG_COLOR, 16, 175);
scene.fog = beachFog;

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

const skyMat = new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false });
scene.add(new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), skyMat));

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

/* ————— resonance markers: standing stones that answer stillness ————— */

const MARKER_RADIUS = 1.6;
const CHARGE_TIME = 2.5;
const DRAIN_TIME = 1.1;

interface Marker {
  seamMat: THREE.MeshStandardMaterial;
  x: number;
  z: number;
  charge: number;
  locked: boolean;
}
const markers: Marker[] = [];

function buildMarker(x: number, z: number, spin: number): void {
  const stone = new THREE.Group();

  // a rough pentagon slab, slim as a standing stone gets
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.19, 2.2, 5),
    new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.95, flatShading: true })
  );
  body.castShadow = true;
  body.receiveShadow = true;
  body.rotation.y = spin;
  stone.add(body);

  // the seam rides one pentagon face — dark until the stillness fills it
  const seamMat = new THREE.MeshStandardMaterial({
    color: 0x0a0908,
    emissive: 0xe8b77a,
    emissiveIntensity: 0.35,
    roughness: 0.6,
  });
  const faceAngle = spin + Math.PI / 5; // a face centre of the pentagon
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.5, 0.09), seamMat);
  seam.position.set(Math.sin(faceAngle) * 0.13, 0.12, Math.cos(faceAngle) * 0.13);
  seam.rotation.y = faceAngle;
  stone.add(seam);

  stone.position.set(x, groundHeight(x, z) + 1.04, z); // settles a thumb into the sand
  stone.rotation.z = 0.02;
  scene.add(stone);

  collidables.push({ x, z, r: 0.38 });
  markers.push({ seamMat, x, z, charge: 0, locked: false });
}

buildMarker(-7, 6.5, 0.4); // up by the dune crest
buildMarker(-15, -2.5, 2.1); // mid-beach
buildMarker(-23.5, -17, 4.4); // past the head, near the waterline

const dbgWt = window as unknown as { __wtDebug?: { markers?: Marker[]; cam?: THREE.Camera } };
dbgWt.__wtDebug = dbgWt.__wtDebug ?? {};
dbgWt.__wtDebug.markers = markers;
dbgWt.__wtDebug.cam = camera;

/* ————— the rite: when all three have answered ————— */

const SKY_BASE = new THREE.Color(FOG_COLOR);
const SKY_WARM = new THREE.Color(0xf4c493);
const SUN_BASE_SCALE = 150;
const SUN_BASE_INTENSITY = sun.intensity;
const HEMI_BASE = hemi.intensity;
const FILL_BASE = fill.intensity;
const RITE_DUR = 7;
const rite = { active: false, t: 0 };
let riteDone = false;

function beginCompletion(): void {
  rite.active = true;
  rite.t = 0;
  horn();
  hideHint();
}

function updateRite(dt: number): void {
  if (!rite.active) return;
  rite.t += dt;
  const p = Math.min(rite.t / RITE_DUR, 1);
  const env = Math.sin(p * Math.PI); // swells, then settles
  const warm = SKY_BASE.clone().lerp(SKY_WARM, env * 0.5);
  (scene.background as THREE.Color).copy(warm);
  beachFog.color.copy(warm);
  sunGlow.scale.set(SUN_BASE_SCALE * (1 + env * 1.1), SUN_BASE_SCALE * (1 + env * 1.1), 1);
  sun.intensity = SUN_BASE_INTENSITY + env * 1.4;
  hemi.intensity = HEMI_BASE + env * 0.3;
  if (p >= 1) {
    rite.active = false;
    (scene.background as THREE.Color).copy(SKY_BASE);
    beachFog.color.copy(SKY_BASE);
    sunGlow.scale.set(SUN_BASE_SCALE, SUN_BASE_SCALE, 1);
    sun.intensity = SUN_BASE_INTENSITY;
    hemi.intensity = HEMI_BASE;
  }
}

/* ————— the moonfall: a face of our own, painted and aimed ————— */

const MOON_TEX_S = 1024;
const MOON_ANCHOR_DIST = 230;
const MOON_START_SCALE = 76; // about two suns wide at anchor distance
const MOON_END_SCALE = 110;
const MOON_END_GAP = 122; // stays clear of the shell — the view fills first
const EYE_PX = [424, 600];
const EYE_PY = 452;
const MOON_DIR = sunGlow.position
  .clone()
  .normalize()
  .add(new THREE.Vector3(0, 0.38, 0))
  .normalize();

// SphereGeometry carries exact equirect uvs, so meshes can be seated precisely
// where the paint lands: u = px/S, v = py/S, theta = v·π, phi = u·2π
function faceDirection(px: number, py: number): THREE.Vector3 {
  const theta = (py / MOON_TEX_S) * Math.PI;
  const phi = (px / MOON_TEX_S) * Math.PI * 2;
  return new THREE.Vector3(
    -Math.cos(phi) * Math.sin(theta),
    Math.cos(theta),
    Math.sin(phi) * Math.sin(theta)
  );
}

// seeded crater field — the same moon every load, never a reroll
interface Crater {
  axis: THREE.Vector3;
  size: number;
  depth: number;
}

const moonCraters: Crater[] = (() => {
  let s = 8675;
  const rnd = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const list: Crater[] = [];
  for (let i = 0; i < 24; i++) {
    const az = rnd() * Math.PI * 2;
    const el = Math.asin(rnd() * 2 - 1);
    list.push({
      axis: new THREE.Vector3(
        Math.cos(el) * Math.cos(az),
        Math.sin(el),
        Math.cos(el) * Math.sin(az)
      ),
      size: 0.18 + rnd() * 0.55,
      depth: 0.02 + rnd() * 0.05,
    });
  }
  return list;
})();

// coarse value-noise lattice, trilinearly blended — deterministic by hash
function moonNoise(x: number, y: number, z: number): number {
  const h = (ix: number, iy: number, iz: number): number => {
    const n = Math.sin(ix * 127.1 + iy * 311.7 + iz * 74.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const ux = xf * xf * (3 - 2 * xf);
  const uy = yf * yf * (3 - 2 * yf);
  const uz = zf * zf * (3 - 2 * zf);
  return mix(
    mix(
      mix(h(xi, yi, zi), h(xi + 1, yi, zi), ux),
      mix(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), ux),
      uy
    ),
    mix(
      mix(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), ux),
      mix(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), ux),
      uy
    ),
    uz
  );
}

// radial offset at a surface direction — noise rolls it, craters dent it
function moonDisplace(dir: THREE.Vector3): number {
  let d = (moonNoise(dir.x * 2.3 + 5, dir.y * 2.3 + 5, dir.z * 2.3 + 5) - 0.5) * 0.05;
  for (const c of moonCraters) {
    const ang = Math.acos(THREE.MathUtils.clamp(dir.dot(c.axis), -1, 1));
    if (ang >= c.size) continue;
    const t = ang / c.size;
    d += ((Math.cos(t * Math.PI) * 0.5 + 0.5) * -1 + Math.exp(-((t - 0.85) ** 2) / 0.006) * 0.4) * c.depth;
  }
  return d;
}

function paintMoonFace(): THREE.CanvasTexture {
  const S = MOON_TEX_S;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(cv);

  let s = 20260;
  const rnd = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };

  // mottled regolith base
  ctx.fillStyle = '#8f8f8b';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 46; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 60 + rnd() * 150;
    const tone = rnd() > 0.5 ? '170,168,160' : '95,93,89';
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${tone},0.14)`);
    g.addColorStop(1, `rgba(${tone},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // small craters — dark cup, pale lip catching from one side
  for (let i = 0; i < 130; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 3 + rnd() * 15;
    ctx.globalAlpha = 0.22 + rnd() * 0.28;
    ctx.fillStyle = '#5c5a56';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#cfccc4';
    ctx.lineWidth = Math.max(1, r * 0.22);
    ctx.beginPath();
    ctx.arc(x, y, r + ctx.lineWidth * 0.4, Math.PI * 0.85, Math.PI * 1.65);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // sunken sockets, tilted toward a scowl, embers already pooled inside
  const socket = (cx: number, tilt: number): void => {
    ctx.save();
    ctx.translate(cx, EYE_PY);
    ctx.rotate(tilt);
    let g = ctx.createRadialGradient(0, 0, 8, 0, 0, 74);
    g.addColorStop(0, 'rgba(12,9,7,0.97)');
    g.addColorStop(0.55, 'rgba(18,13,10,0.82)');
    g.addColorStop(1, 'rgba(18,13,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, 78, 58, 0, 0, Math.PI * 2);
    ctx.fill();
    g = ctx.createRadialGradient(0, 6, 2, 0, 6, 40);
    g.addColorStop(0, 'rgba(255,140,44,0.62)');
    g.addColorStop(1, 'rgba(255,140,44,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 6, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  socket(EYE_PX[0], 0.28);
  socket(EYE_PX[1], -0.28);

  // a heavy brow shadow drawn across both sockets
  const brow = ctx.createLinearGradient(0, 360, 0, 430);
  brow.addColorStop(0, 'rgba(20,16,13,0)');
  brow.addColorStop(1, 'rgba(20,16,13,0.4)');
  ctx.fillStyle = brow;
  ctx.fillRect(250, 360, 524, 70);

  // the nose — little more than a suggestion of a ridge
  ctx.strokeStyle = 'rgba(30,25,20,0.5)';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(500, 500);
  ctx.quadraticCurveTo(490, 548, 502, 574);
  ctx.moveTo(524, 500);
  ctx.quadraticCurveTo(534, 548, 522, 574);
  ctx.stroke();

  // the grin — a dark slab, then two rows of blocky teeth clipped inside it
  const mouth = new Path2D();
  mouth.moveTo(320, 618);
  mouth.quadraticCurveTo(512, 584, 704, 618);
  mouth.quadraticCurveTo(668, 724, 512, 730);
  mouth.quadraticCurveTo(356, 724, 320, 618);
  ctx.fillStyle = '#151009';
  ctx.fill(mouth);

  ctx.save();
  ctx.clip(mouth);
  for (const top of [true, false]) {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const w = 34 + rnd() * 8;
      const x = 338 + i * 43 + rnd() * 5;
      const arc = Math.sin((i / (n - 1)) * Math.PI) * -12; // the rows follow the grin
      const h = (top ? 38 : 32) + rnd() * 10;
      const y = top ? 600 + arc : 726 - h;
      ctx.fillStyle = '#cfc8b8';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(74,69,60,0.55)';
      ctx.fillRect(x, top ? y + h - 7 : y, w, 7);
      ctx.strokeStyle = 'rgba(30,24,17,0.7)';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    }
  }
  ctx.restore();

  // soften the poles so the wrap never shows a hard band
  const capT = ctx.createLinearGradient(0, 0, 0, 70);
  capT.addColorStop(0, 'rgba(52,50,47,0.5)');
  capT.addColorStop(1, 'rgba(52,50,47,0)');
  ctx.fillStyle = capT;
  ctx.fillRect(0, 0, S, 70);
  const capB = ctx.createLinearGradient(0, S - 70, 0, S);
  capB.addColorStop(0, 'rgba(52,50,47,0)');
  capB.addColorStop(1, 'rgba(52,50,47,0.5)');
  ctx.fillStyle = capB;
  ctx.fillRect(0, S - 70, S, 70);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

function buildMoonFace(): THREE.Group {
  // a sphere, not an icosahedron — polyhedron uvs wander with their seam
  // corrections, and the eyes must land exactly where the paint is
  const geo = new THREE.SphereGeometry(1, 28, 20);
  const pos = geo.attributes.position;
  const dir = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    dir.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    const r = 1 + moonDisplace(dir);
    pos.setXYZ(i, dir.x * r, dir.y * r, dir.z * r);
  }
  geo.computeVertexNormals();

  const faceTex = paintMoonFace();
  const body = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      map: faceTex,
      emissiveMap: faceTex, // a whisper of self-light, so night never fully swallows it
      emissive: new THREE.Color(0x2a2732),
      emissiveIntensity: 0.5,
      roughness: 0.95,
      metalness: 0,
      flatShading: true, // the low-poly grain reads best faceted
      fog: false,
    })
  );
  const group = new THREE.Group();
  group.add(body);

  // hot eyes seated into the painted sockets, haloed for reading at distance
  for (const px of EYE_PX) {
    const eyeDir = faceDirection(px, EYE_PY);
    const eye = new THREE.Group();
    eye.position.copy(eyeDir).multiplyScalar(1 + moonDisplace(eyeDir) - 0.05);
    eye.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), eyeDir);

    const rim = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xe25822, fog: false })
    );
    rim.scale.set(1, 1, 0.4);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xffb347, fog: false })
    );
    core.scale.set(1, 1, 0.42);
    core.position.z = 0.02;
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeSunGlowTexture(),
        color: 0xff8c30,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.55,
        fog: false,
      })
    );
    glow.scale.set(0.7, 0.7, 1);
    glow.position.z = 0.06;

    eye.add(rim, core, glow);
    group.add(eye);
  }
  return group;
}

// one moon, three nested groups: aim, roll, face — each worry gets its own axis
const moon = new THREE.Group();
const moonRoll = new THREE.Group();
const moonFace = buildMoonFace();
moonFace.rotation.y = -Math.PI / 2; // the paint faces +X on a sphere; turn it into the aim
moonRoll.add(moonFace);
moon.add(moonRoll);
moon.visible = false;
scene.add(moon);

/* ————— stars: seed-fixed, and only out for the night ————— */

function buildStars(): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const N = 800;
  const positions = new Float32Array(N * 3);
  let s = 809;
  const rnd = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < N; i++) {
    const az = rnd() * Math.PI * 2;
    const el = 0.06 + rnd() * 1.45; // clear of the horizon murk, short of dead overhead
    const r = 402 + rnd() * 38;
    positions[i * 3] = Math.cos(el) * Math.cos(az) * r;
    positions[i * 3 + 1] = Math.sin(el) * r;
    positions[i * 3 + 2] = Math.cos(el) * Math.sin(az) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: 0xdde4f5,
      size: 1.9,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    })
  );
}

const stars = buildStars();
scene.add(stars);

function updateMarkers(dt: number): void {
  let charging: number | null = null;

  markers.forEach((m, i) => {
    const d = Math.hypot(camera.position.x - m.x, camera.position.z - m.z);
    if (!m.locked) {
      if (d < MARKER_RADIUS) {
        const prev = m.charge;
        m.charge = Math.min(1, m.charge + dt / CHARGE_TIME);
        charging = m.charge;
        if (prev === 0) showHint();
        if (m.charge >= 1) {
          m.locked = true;
          chime(i);
          if (markers.every((q) => q.locked) && !riteDone) {
            riteDone = true;
            beginCompletion();
          }
        }
      } else {
        m.charge = Math.max(0, m.charge - dt / DRAIN_TIME);
      }
    }
    m.seamMat.emissiveIntensity = m.locked ? 3.4 : 0.35 + m.charge * 2.9;
  });

  chargeTone(charging);
}

/* ————— the sun's regard: hold its gaze from the shallows, and the sky answers ————— */

const whiteEl = document.getElementById('wt-white');
const whiteLine = document.getElementById('wt-white-line');
const camDir = new THREE.Vector3();
const toSun = new THREE.Vector3();
const BASE_EXPOSURE = 1.08;
const NIGHT_SKY = new THREE.Color(0x141021);
const WARM_HORIZON = new THREE.Color(0x8a4a2c);

type EggPhase = 'idle' | 'rise' | 'fall' | 'impact' | 'hold' | 'set';

const EGG_DUR: Record<Exclude<EggPhase, 'idle'>, number> = {
  rise: 2.5,
  fall: 5.5,
  impact: 1,
  hold: 4.2,
  set: 2,
};

const egg: { phase: EggPhase; t: number; gaze: number; cool: number } = {
  phase: 'idle',
  t: 0,
  gaze: 0,
  cool: 0,
};
let eggFrozen = false; // the test hook owns the timeline when this is set
let shakeAmp = 0; // additive camera jitter — never folded back into yaw/pitch

// sky, fog and the dome tint sink toward night; warmth lifts the horizon late
function setNight(night: number, warm: number): void {
  const col = SKY_BASE.clone().lerp(NIGHT_SKY, night);
  if (warm > 0) col.lerp(WARM_HORIZON, warm * 0.45);
  (scene.background as THREE.Color).copy(col);
  beachFog.color.copy(col);
  skyMat.color.setRGB(col.r / SKY_BASE.r, col.g / SKY_BASE.g, col.b / SKY_BASE.b);
  stars.material.opacity = night * 0.9;
}

// the moon holds a fixed bearing off the walker — the sun's quarter, lifted —
// so the approach reads as toward you wherever you have drifted
function positionMoon(dist: number): void {
  moon.position.copy(camera.position).addScaledVector(MOON_DIR, dist);
}

function aimMoon(roll: number): void {
  moon.lookAt(camera.position);
  moonRoll.rotation.z = roll;
}

function applyRise(p: number): void {
  const night = THREE.MathUtils.smoothstep(p, 0.05, 1);
  setNight(night, 0);
  sunGlow.material.opacity = 1 - night * 0.45;
  const s = SUN_BASE_SCALE * (1 - night * 0.4);
  sunGlow.scale.set(s, s, 1);
  sun.intensity = SUN_BASE_INTENSITY * (1 - night * 0.72);
  hemi.intensity = HEMI_BASE * (1 - night * 0.55);
  fill.intensity = FILL_BASE * (1 - night * 0.5);
  renderer.toneMappingExposure = BASE_EXPOSURE - night * 0.22;

  moon.visible = p > 0.04;
  const grow = THREE.MathUtils.smoothstep(p, 0.04, 0.45);
  moon.scale.setScalar(MOON_START_SCALE * grow);
  positionMoon(MOON_ANCHOR_DIST);
  aimMoon(0);
  setRumble(night * 0.22);
}

function applyFall(p: number): void {
  // exponential acceleration — a long lean in, then the sky gives way
  const k = 2.6;
  const accel = (Math.exp(k * p) - 1) / (Math.exp(k) - 1);
  moon.visible = true;
  moon.scale.setScalar(MOON_START_SCALE + (MOON_END_SCALE - MOON_START_SCALE) * accel);
  positionMoon(MOON_ANCHOR_DIST + (MOON_END_GAP - MOON_ANCHOR_DIST) * Math.min(accel * 1.15, 1));
  aimMoon(p * 0.5); // a slow roll, like it is enjoying this
  setNight(1, THREE.MathUtils.smoothstep(p, 0.6, 1));
  setRumble(0.22 + p * 0.78);
  shakeAmp = 0.0016 + p * p * 0.011;
}

function applyImpact(p: number): void {
  if (whiteEl) whiteEl.style.opacity = '1'; // the cut has already landed; hold it
  renderer.toneMappingExposure = BASE_EXPOSURE - 0.22 + Math.exp(-p * 4) * 0.4;
  shakeAmp = 0.02 * Math.exp(-p * 4.2);
}

function applySet(p: number): void {
  const ease = 1 - (1 - p) * (1 - p);
  const night = 1 - ease;
  setNight(night, 0);
  sunGlow.material.opacity = 1 - night * 0.45;
  const s = SUN_BASE_SCALE * (1 - night * 0.4);
  sunGlow.scale.set(s, s, 1);
  sun.intensity = SUN_BASE_INTENSITY * (1 - night * 0.72);
  hemi.intensity = HEMI_BASE * (1 - night * 0.55);
  fill.intensity = FILL_BASE * (1 - night * 0.5);
  renderer.toneMappingExposure = BASE_EXPOSURE - night * 0.22;
  if (whiteEl) whiteEl.style.opacity = String(Math.max(0, 1 - p * 2.1)); // white clears early

  moon.visible = ease < 1;
  moon.scale.setScalar(MOON_END_SCALE * (1 - ease));
  positionMoon(MOON_END_GAP);
  aimMoon(0.5);
  shakeAmp = 0;
}

function updateEgg(dt: number): void {
  if (eggFrozen) return;

  if (egg.phase === 'idle') {
    egg.cool = Math.max(0, egg.cool - dt);
    const inShallows = camera.position.x <= SHORE_X + 0.4;
    let aimed = false;
    if (locked && inShallows && egg.cool === 0) {
      camera.getWorldDirection(camDir);
      toSun.copy(sunGlow.position).sub(camera.position).normalize();
      aimed = camDir.dot(toSun) > 0.9975; // a tight four degrees
    }
    egg.gaze = aimed ? egg.gaze + dt : Math.max(0, egg.gaze - dt * 2.5);
    if (egg.gaze >= 3) {
      egg.phase = 'rise';
      egg.t = 0;
      duck(0.18, 1.0); // the world holds its breath
    }
    return;
  }

  egg.t += dt;
  switch (egg.phase) {
    case 'rise': {
      const p = Math.min(egg.t / EGG_DUR.rise, 1);
      applyRise(p);
      if (p >= 1) {
        egg.phase = 'fall';
        egg.t = 0;
      }
      break;
    }
    case 'fall': {
      const p = Math.min(egg.t / EGG_DUR.fall, 1);
      applyFall(p);
      if (p >= 1) {
        egg.phase = 'impact';
        egg.t = 0;
        stopRumble(0.25);
        boom();
        if (whiteEl) whiteEl.style.opacity = '1'; // the hard cut
      }
      break;
    }
    case 'impact': {
      const p = Math.min(egg.t / EGG_DUR.impact, 1);
      applyImpact(p);
      if (p >= 1) {
        egg.phase = 'hold';
        egg.t = 0;
        whiteLine?.classList.add('show');
      }
      break;
    }
    case 'hold':
      if (egg.t >= EGG_DUR.hold) {
        whiteLine?.classList.remove('show');
        egg.phase = 'set';
        egg.t = 0;
        duck(1, 1.8);
      }
      break;
    case 'set': {
      const p = Math.min(egg.t / EGG_DUR.set, 1);
      applySet(p);
      if (p >= 1) {
        egg.phase = 'idle';
        egg.gaze = 0;
        egg.cool = 10; // the moon does not repeat itself quickly
      }
      break;
    }
  }
}

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

overlay?.addEventListener('click', (e) => {
  if ((e.target as HTMLElement | null)?.closest('a')) return; // let the way home stay a link
  if (!overlay || !canEngage()) {
    if (overlay) overlay.hidden = true; // nothing to lock into — just step aside
    return;
  }
  const req = canvas.requestPointerLock() as unknown;
  if (req instanceof Promise) req.catch(() => {});
});

const crosshair = document.getElementById('wt-crosshair');
let entered = false;

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  entered = entered || locked;
  if (overlay) overlay.hidden = locked;
  crosshair?.classList.toggle('show', locked);
  if (locked && !reduced) applySound(); // entry is the user gesture audio needs
  if (!locked) {
    clearKeys();
    velocity.set(0, 0, 0);
    if (canEngage()) {
      if (entered && enterBtn) enterBtn.textContent = 'Step back in';
      enterBtn?.focus();
    }
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

/* ————— test hook: ?eggtest=<phase|auto>[&t=<0..1>] —————
   Forces the egg into a moment without pointer lock and freezes it there so
   headless screenshots work (reduced motion included); auto plays it through. */

const eggQuery = new URLSearchParams(window.location.search);
const eggTest = eggQuery.get('eggtest');

if (eggTest) {
  overlay?.setAttribute('hidden', '');

  // stand in the shallows, eyes already on the sun
  camera.position.set(SHORE_X + 0.2, 0, 6);
  camera.position.y = groundHeight(camera.position.x, camera.position.z) + EYE_HEIGHT;
  const aimDir = sunGlow.position.clone().sub(camera.position).normalize();
  yaw = Math.atan2(-aimDir.x, -aimDir.z);
  pitch = Math.asin(THREE.MathUtils.clamp(aimDir.y, -1, 1));
  camera.rotation.set(pitch, yaw, 0);

  if (eggTest === 'auto') {
    if (reduced) {
      // reduced renders a single frame — spend it on the fall, near impact
      applyFall(0.93);
      shakeAmp = 0;
      eggFrozen = true;
    } else {
      egg.phase = 'rise'; // no lock needed; the loop carries it from here
      egg.t = 0;
      duck(0.18, 1.0);
    }
  } else if (Object.hasOwn(EGG_DUR, eggTest)) {
    const phase = eggTest as Exclude<EggPhase, 'idle'>;
    const rawT = eggQuery.get('t');
    const defaults: Record<Exclude<EggPhase, 'idle'>, number> = {
      rise: 0.98,
      fall: 0.92,
      impact: 0.5,
      hold: 1,
      set: 0.45,
    };
    const p = rawT === null ? defaults[phase] : THREE.MathUtils.clamp(Number(rawT) || 0, 0, 1);
    egg.phase = phase;
    egg.t = p * EGG_DUR[phase];
    if (phase === 'rise') applyRise(p);
    else if (phase === 'fall') applyFall(p);
    else if (phase === 'impact') applyImpact(p);
    else if (phase === 'hold') {
      if (whiteEl) whiteEl.style.opacity = '1';
      whiteLine?.classList.add('show');
    } else {
      applySet(p);
    }
    shakeAmp = 0; // a held frame does not tremble
    eggFrozen = true;
  }
}

/* ————— sound & the quiet hint ————— */

const soundBtn = document.getElementById('wt-sound');
const soundState = document.getElementById('wt-sound-state');
const hintEl = document.getElementById('wt-hint');
let soundWanted = true;
let hintShown = false;

function applySound(): void {
  if (reduced) return; // reduced motion hears nothing, by design
  setAudioEnabled(soundWanted);
  if (soundState) soundState.textContent = soundWanted ? 'ON' : 'OFF';
}

soundBtn?.addEventListener('click', () => {
  soundWanted = !soundWanted;
  applySound();
});

function showHint(): void {
  if (hintShown || !hintEl) return;
  hintShown = true;
  hintEl.classList.add('show');
}

function hideHint(): void {
  hintEl?.classList.remove('show');
}

/* ————— design note toggle ————— */

const noteBtn = document.getElementById('wt-note-btn') as HTMLButtonElement | null;
const notePanel = document.getElementById('wt-note-panel') as HTMLElement | null;

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

  // the head's low note swells as you approach it
  const dh = Math.hypot(camera.position.x - HEAD_X, camera.position.z - HEAD_Z);
  setHeadCloseness(1 - THREE.MathUtils.smoothstep(dh, 5, 44));

  if (locked) updateMarkers(dt);
  updateRite(dt);
  updateEgg(dt);

  // the fall shakes the eye — additive offsets only, the look angles stay clean
  if (shakeAmp > 0.0002) {
    const st = timer.getElapsed();
    camera.rotation.x += Math.sin(st * 39.7) * shakeAmp;
    camera.rotation.y += Math.sin(st * 31.3 + 1.7) * shakeAmp * 0.8;
    camera.rotation.z += Math.sin(st * 43.1 + 3.9) * shakeAmp * 0.5;
  }

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
