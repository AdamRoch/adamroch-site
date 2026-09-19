/* ————— Lab 02 · Sonic Terrain: the scene ————— */
// Loaded by main.ts after the chrome and preloader are up. Everything three lives here.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { getState, getAnalyser, setState, pluckAt, type SoundState } from './audio';
import { watchQuality, startLoop, setupRendererDebug } from '../lab-quality';
import type { LabChrome, Preloader } from '../lab-chrome';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

let ui: LabChrome | null = null;
let live = false; // first real frame rendered; before that the curtain is up and nothing should draw

/* ————— renderer / scene ————— */

const canvas = document.getElementById('st-gl') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false, // MSAA lives on the HDR render target instead
  alpha: false,
  powerPreference: 'high-performance',
});
setupRendererDebug(renderer);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75)); // capped on purpose: crisp 1px lines
renderer.toneMapping = THREE.NoToneMapping; // the final pass tone maps the HDR buffer itself
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
// lines fade to nothing with distance; the page black is added back after tone mapping, where it
// cannot be crushed, and the alpha the far grid leaves behind still masks the horizon glow
scene.fog = new THREE.Fog(0x000000, 5.0, 12.0);

const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 30);
// raised and pulled back from the old (0, 0.78, 3.6): the surface now has a reflection under it,
// so the frame has to hold twice the vertical extent and the mirror line wants to sit near centre
const BASE_CAM = new THREE.Vector3(0, 0.94, 3.98);
const LOOK_AT = new THREE.Vector3(0, 0.22, -1.8);

function frameCamera(): void {
  const aspect = innerWidth / innerHeight;
  const fit = Math.min(1, aspect * 1.25); // portrait pulls back
  camera.aspect = aspect;
  // ^0.82 rather than the full 1/fit: a phone is tall enough to hold the terrain and its
  // reflection without retreating the whole way, and the retreat was leaving the frame empty
  camera.position.set(BASE_CAM.x, BASE_CAM.y / Math.sqrt(fit), BASE_CAM.z / Math.pow(fit, 0.82));
  camera.lookAt(LOOK_AT);
  camera.updateProjectionMatrix();
  // a portrait viewport has already retreated far enough that most of the sheet ends inside the
  // frame, so it needs less of the margin dissolve — but measured at 390 px it still runs off the
  // bottom-left corner, so it does not need none of it either
  FinalShader.uniforms.uEdge.value = Math.min(1, Math.max(0.55, (aspect - 0.55) / 0.75));
}

/* ————— terrain: a rolling history of spectrum frames as a line mesh ————— */

const COLS = 96; // frequency bins across
let ROWS = 160; // frames of history receding to the horizon
// 2.7 before. At that width the near row only spanned about bins 5%..54% of the spectrum, so the
// whole top half of the frequency axis — the newest and most legible colour information on the
// page — existed only as compressed far rows piling up at the horizon, while the bass end ran off
// the left edge. Narrowing the sheet puts the full ramp in the near field and gives the ridge a
// silhouette against black again instead of bleeding off three sides.
const X_HALF = 1.8;
const Z_NEAR = 2.3;
const Z_FAR = -7.0;

function buildGrid(): void {
  const vertCount = ROWS * COLS;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      positions[i * 3 + 0] = (c / (COLS - 1)) * 2 * X_HALF - X_HALF;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = Z_NEAR + (r / (ROWS - 1)) * (Z_FAR - Z_NEAR);
    }
  }

  const index: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      const i = r * COLS + c;
      index.push(i, i + 1);
    }
  }
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      index.push(i, i + COLS);
    }
  }

  geometry.setIndex(index);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

const geometry = new THREE.BufferGeometry();
buildGrid();

// the vertex colours stay in their tuned 0..1 range; this gain lifts them into HDR so that the
// ridges and the overlaps have something for the bloom threshold to bite on
const LINE_HDR = 1.6;

const material = new THREE.LineBasicMaterial({
  vertexColors: true,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
material.color.setScalar(LINE_HDR);

const terrain = new THREE.LineSegments(geometry, material);
terrain.position.x = 0.55; // the bass band lives on the left; pull it into frame
scene.add(terrain);

// ————— the reflection: the terrain used to float in nothing —————
// Same geometry, same buffers, flipped through y = 0, so the mirror line becomes a real surface
// and the frame reads composed instead of cropped. The floor absorbs: the copy is dim, tinted
// back down the spectrum towards ember, and faded exponentially with height above the surface,
// which is what stops a sharp mirror from reading as a second terrain hanging upside down.
// A true mirror just hangs a second mountain below. Foreshortening it is what the eye reads as
// "a surface seen at a glancing angle", and it keeps the seam legible. 0.62 first: at that scale
// the tall near rows projected far enough down the frame to run off the bottom edge in every state.
// Then 0.5, which still tied the mirror's legibility to the swell: a tall terrain threw its
// reflection down past the screen-space far edge, so the floor read at rest and vanished at the
// crest — the one state a visitor is most likely to land in. At 0.4 the mirror stays in the band
// just under the seam whatever height the ridge reaches, which is also what a glancing reflection
// on a polished floor actually looks like.
const REFLECT_SQUASH = 0.4;
// (1.0, 0.48, 0.22) first, which is saturated enough to turn a pale gold high-end ridge back into
// orange: the floor was more chromatic than the thing it was reflecting. This absorbs without
// recolouring, so the spectral ramp survives the trip down and back.
const REFLECT_TINT = new THREE.Color(1.0, 0.6, 0.38);
// 0.85 first. A named feature of the page that a desktop visitor could not identify as a mirror is
// not a feature: at rest the floor was a faint warm smear, because the three curves above were all
// pulling at once — a 1.4 gamma crushing the quiet material and an exp(-0.95y) absorbing the
// bright ridges, which between them left nothing with any shape in it. The gamma and the
// absorption are the parts that were tuned down; the gain is only nudged, because a mirror reads
// as a mirror by having structure in it, not by being bright, and a second bright object is
// exactly what the floor must not become.
const REFLECT_GAIN = 0.95;
const reflectMaterial = new THREE.LineBasicMaterial({
  vertexColors: true,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
reflectMaterial.color.copy(REFLECT_TINT).multiplyScalar(LINE_HDR * REFLECT_GAIN);
reflectMaterial.onBeforeCompile = (shader) => {
  // Three curves in world space, and each is doing a job. The gamma is what keeps a dark floor
  // dark: a mirror that returns every line equally turns the quiet near rows into a grey floor
  // grid, so the reflection is raised to a power and only the bright ridges survive it. The
  // exponential is absorption with depth — position.y is height above the surface, which after the
  // flip is depth into it. The last term is Fresnel by hand: the floor barely reflects what is
  // directly underfoot and reflects hard at a grazing angle, so the far rows come back strongest.
  shader.vertexShader = shader.vertexShader.replace(
    '#include <color_vertex>',
    `#include <color_vertex>
      vColor.rgb = pow( max( vColor.rgb, 0.0 ), vec3( 1.22 ) )
        * exp( - position.y * 0.5 )
        * mix( 0.55, 1.0, clamp( ( ${Z_NEAR.toFixed(1)} - position.z ) / 3.2, 0.0, 1.0 ) );`
  );
  // The far edge, and it has to be measured in screen space. The reflection's tallest rows are its
  // nearest ones, so after the flip they project furthest down the frame: with only the three
  // vertex curves above, the floor ran off the bottom edge at every viewport, which is not a floor,
  // it is a second landscape. Cutting the curves hard enough to stop that deleted the floor
  // instead. So the surface simply ends: full strength under the crest, gone by the time it reaches
  // the band the sound pill and the hint live in.
  shader.vertexShader = shader.vertexShader.replace(
    '#include <fog_vertex>',
    `#include <fog_vertex>
      vColor.rgb *= smoothstep( -0.82, -0.34, gl_Position.y / max( gl_Position.w, 1e-4 ) );`
  );
};
// additive light, but it must not write coverage. The final pass reads the HDR buffer's alpha as
// line coverage and uses it to mask the horizon glow, and premultiplied AdditiveBlending adds a
// full 1.0 of alpha per fragment — so a reflection line whose RGB had already been cut to a few
// percent was punching the glow down to flat BASE exactly as hard as a bright terrain line does.
reflectMaterial.blending = THREE.CustomBlending;
reflectMaterial.blendEquation = THREE.AddEquation;
reflectMaterial.blendSrc = THREE.OneFactor;
reflectMaterial.blendDst = THREE.OneFactor;
reflectMaterial.blendSrcAlpha = THREE.ZeroFactor;
reflectMaterial.blendDstAlpha = THREE.OneFactor;
reflectMaterial.customProgramCacheKey = () => 'st-reflection';

const reflection = new THREE.LineSegments(geometry, reflectMaterial);
reflection.position.x = terrain.position.x;
reflection.scale.y = -REFLECT_SQUASH;
scene.add(reflection);

// invisible plane for pluck raycasting
const hitPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(X_HALF * 2, Math.abs(Z_FAR - Z_NEAR)),
  new THREE.MeshBasicMaterial({ visible: false })
);
hitPlane.rotation.x = -Math.PI / 2;
hitPlane.position.z = (Z_NEAR + Z_FAR) / 2;
hitPlane.position.x = terrain.position.x;
scene.add(hitPlane);

/* ————— post: linear HDR → half-res bloom → one final pass ————— */

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uExposure: { value: 1.0 }, // lifted for a moment on an onset
    uGlow: { value: 1.0 }, // the horizon answers the bass and the beat
    uFrame: { value: 0 },
    uGrain: { value: 0.035 },
    uEdge: { value: 1.0 }, // portrait needs less of it; see frameCamera
  },
  vertexShader: /* glsl */ `
    precision highp float;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    attribute vec3 position;
    attribute vec2 uv;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
  fragmentShader: /* glsl */ `
    precision highp float;

    uniform sampler2D tDiffuse;
    uniform float uExposure;
    uniform float uGlow;
    uniform float uFrame;
    uniform float uGrain;
    uniform float uEdge;
    varying vec2 vUv;

    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>

    // page colours in sRGB: they are composited after tone mapping so they read exactly as the CSS did
    const vec3 BASE = vec3( 11.0, 11.0, 13.0 ) / 255.0;
    const vec3 EMBER = vec3( 255.0, 77.0, 0.0 ) / 255.0;

    // interleaved gradient noise (Jimenez 2014), in device pixels
    float ign( vec2 p ) {
      return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
    }

    float hash12( vec2 p ) {
      vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
      p3 += dot( p3, p3.yzx + 33.33 );
      return fract( ( p3.x + p3.y ) * p3.z );
    }

    void main() {
      vec4 hdr = texture2D( tDiffuse, vUv );

      // 1. the lines: tone map the HDR sum, encode to sRGB.
      //    The margin dissolve is here and not in the column window because the two ends of the
      //    sheet are nowhere near each other in screen space: the terrain is wider than the frame
      //    on purpose, and a fade measured in frequency bins covers a quarter of the picture at
      //    the far end and a sliver at the near one, so the ridge kept crossing the right edge
      //    lit. This is the frame doing the composing — the picture goes down into its own
      //    margins rather than being cut by them — and it runs on the bloomed buffer, so the
      //    halo cannot walk out over the edge either.
      float m = min( vUv.x, 1.0 - vUv.x );
      float edge = mix( 0.08, 1.0, smoothstep( 0.0, 0.14, m ) )
        // and the top, which is the other way a loud source leaves the frame: the far rows
        // converge on the horizon near the middle of the picture, so the band above that is sky
        // until a crest climbs into it, and when one does it climbs straight through the headline.
        // Weaker than the sides, because this edge is a ceiling the terrain only occasionally
        // reaches rather than a cut the sheet makes every frame.
        * mix( 0.3, 1.0, smoothstep( 0.0, 0.16, 1.0 - vUv.y ) );
      vec3 lines = sRGBTransferOETF( vec4( ACESFilmicToneMapping( hdr.rgb * uExposure * mix( 1.0, edge, uEdge ) ), 1.0 ) ).rgb;

      // 2. the horizon glow: the old CSS radial-gradient, same geometry and stops
      //    ellipse 90% 45% at 50% 44%; ember .13 at 0, .04 at 45%, clear at 70%
      vec2 e = ( vUv - vec2( 0.5, 0.56 ) ) / vec2( 0.9, 0.45 );
      float d = length( e );
      float a = d < 0.45
        ? mix( 0.13, 0.04, d / 0.45 )
        : mix( 0.04, 0.0, clamp( ( d - 0.45 ) / 0.25, 0.0, 1.0 ) );
      // the horizon is a light source now: it swells on the bass and flares on a beat
      vec3 glow = mix( BASE, EMBER, clamp( a * uGlow, 0.0, 1.0 ) );

      // the grid was opaque over the glow on the old transparent canvas; keep that, from line coverage
      float cover = clamp( hdr.a, 0.0, 1.0 );
      vec3 col = mix( glow, BASE, cover ) + lines;

      // 3. soft vignette
      vec2 v = vUv * 2.0 - 1.0;
      float r = clamp( dot( v, v ) * 0.5, 0.0, 1.0 );
      col *= mix( 0.7, 1.0, pow( 1.0 - r, 0.5 ) );

      // 4. luminance-weighted animated grain, then IGN dither against banding; both in device pixels
      vec2 px = gl_FragCoord.xy;
      float lum = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
      float g = hash12( px + vec2( uFrame * 7.0, uFrame * 13.0 ) ) - 0.5;
      col += g * uGrain * mix( 1.0, 0.3, lum );
      col += ( ign( px + uFrame * 5.588238 ) - 0.5 ) / 255.0;

      gl_FragColor = vec4( col, 1.0 );
    }`,
};

// ACES over AgX, decided on screenshots: AgX flattens the ember-to-gold ramp into peach and loses
// the hot white core on the ridge; ACES keeps the saturated ember and the core still reads as heat
const finalMaterial = new THREE.RawShaderMaterial({
  name: 'SonicTerrainFinal',
  defines: { ACES_FILMIC_TONE_MAPPING: '', SRGB_TRANSFER: '' },
  uniforms: FinalShader.uniforms,
  vertexShader: FinalShader.vertexShader,
  fragmentShader: FinalShader.fragmentShader,
});

const hdrTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, hdrTarget);
const renderPass = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.4, 0.9);
const finalPass = new ShaderPass(finalMaterial);

// bloom adds onto the HDR buffer; it must leave alpha alone because the final pass reads it as coverage
bloomPass.blendMaterial.blending = THREE.CustomBlending;
bloomPass.blendMaterial.blendEquation = THREE.AddEquation;
bloomPass.blendMaterial.blendSrc = THREE.OneFactor;
bloomPass.blendMaterial.blendDst = THREE.OneFactor;
bloomPass.blendMaterial.blendSrcAlpha = THREE.ZeroFactor;
bloomPass.blendMaterial.blendDstAlpha = THREE.OneFactor;

composer.addPass(renderPass);
composer.addPass(bloomPass);
composer.addPass(finalPass);

function resize(): void {
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  frameCamera();
  if (reduced && live) composer.render();
}

/* ————— spectrum data: analyser bytes, or a synthetic swell while muted ————— */

let history = new Float32Array(ROWS * COLS); // ring rows, 0 = nearest
let heat = new Float32Array(ROWS * COLS); // per-bin transient energy, riding the same rows
const smooth = new Float32Array(COLS);
const prevRow = new Float32Array(COLS); // last raw frame, for the spectral flux
const heatRow = new Float32Array(COLS); // what this frame writes into the heat ring
const pulse = new Float32Array(COLS); // pluck flashes
const fftBytes = new Uint8Array(1024);

function pushRows(): void {
  // history recedes: shift everything one row back, write new frame at row 0
  history.copyWithin(COLS, 0, history.length - COLS);
  history.set(smooth, 0);
  // the heat travels with it, which is the whole point: a beat is written once and then rides the
  // rows to the horizon as a shockwave, and a pluck leaves a scar that scrolls away
  heat.copyWithin(COLS, 0, heat.length - COLS);
  heat.set(heatRow, 0);
}

// the heartbeat the drone plays, so the idle sweep punches the same way with the sound off — the
// state most visitors land in. lub, then a softer dub a third of a second later.
const BEAT = 2.6;
const PREROLL_PHASE = 6.22; // where the preroll stops; see prerollHistory
function beatEnv(t: number): number {
  const ph = (((t / BEAT) % 1) + 1) % 1;
  const lub = Math.exp(-ph * 22);
  const dub = ph > 0.127 ? 0.5 * Math.exp(-(ph - 0.127) * 26) : 0;
  return lub + dub;
}

const idleRow = new Float32Array(COLS);
function synthIdleRow(t: number): Float32Array {
  const hit = beatEnv(t);
  for (let c = 0; c < COLS; c++) {
    const cf = c / (COLS - 1);
    const wobble = 0.03 * Math.sin(t * 0.23);
    // centred on 0.07 before, which is inside the column window's own fade: the tallest part of
    // the bass hump was being dimmed to half while its shoulder stayed lit, so the left of the
    // picture ended in a flat lit shelf — many near-equal rows seen edge-on, summing additively
    // into a pale cross-hatched plate — instead of ending in a ridge. Moving the hump clear of the
    // ramp puts a peak where the terrain ends and lets the shelf below it go dark.
    const bass = Math.exp(-Math.pow((cf - 0.13 - wobble) / 0.09, 2)) * 0.78;
    const mid = Math.exp(-Math.pow((cf - 0.3) / 0.1, 2)) * 0.4;
    const texture =
      0.5 + 0.5 * Math.sin(c * 1.7 + t * 1.1) * Math.sin(c * 0.31 - t * 0.53);
    // the swell used to reach 1.0, and at its peak the bass ridge climbed out of the top-left
    // corner. This is the idle stand-in, not measured sound, so its ceiling is a framing choice —
    // and so is its floor. 0.52 ± 0.3 put a third of all landings in a trough at 0.22, which the
    // exposure floor then had to claw back on its own. Same crest, shallower trough: the page
    // still breathes, and the auto-exposure has less work to do to keep a landing shippable.
    const swell = 0.6 + 0.22 * Math.sin(t * 0.7 + Math.sin(t * 0.31) * 2.0);
    // the beat: a thump in the bass and a broadband tick, matching the drone's sub + noise click
    // weighted 0.62/0.19 first, which put three quarters of the beat's energy into the leftmost
    // fifth of the spectrum — the part of the terrain that is tallest and furthest out of frame.
    // The audio side is already balanced (sub thump against a highpassed click); this is the
    // visual stand-in, and it has to light the whole axis for the beat to read as a travelling event.
    const strike = hit * (0.34 * Math.exp(-cf * 2.2) + 0.34 * (0.75 + 0.25 * texture));
    idleRow[c] = (bass + mid) * swell * (0.55 + 0.45 * texture) + texture * 0.06 + strike;
  }
  return idleRow;
}

const liveRow = new Float32Array(COLS);
function readAnalyserRow(t: number): Float32Array {
  const analyser = getAnalyser();
  if (!analyser) return synthIdleRow(t);
  analyser.getByteFrequencyData(fftBytes);
  for (let c = 0; c < COLS; c++) {
    // log-ish mapping keeps the bass band wide, like the ear hears it
    const idx = 2 + Math.floor(Math.pow(c / (COLS - 1), 1.6) * 700);
    liveRow[c] = fftBytes[idx] / 255;
  }
  return liveRow;
}

/* ————— per-frame terrain update ————— */

// The frequency axis is the most meaningful axis in the image and it used to carry no colour at
// all. It does now: hue is pitch, brightness is loudness. Bass stays the page's deep ember, the
// mids run through it to amber and gold, the top of the spectrum arrives pale. The palette is
// baked once per column — the per-frame loop only interpolates towards the hot core and the flash.
const SPECTRUM: Array<[number, number, number, number]> = [
  [0.0, 1.0, 0.14, 0.02], // deep ember: the bass band
  [0.3, 1.0, 0.36, 0.04],
  [0.6, 1.0, 0.6, 0.13],
  [0.85, 1.0, 0.79, 0.37], // gold
  [1.0, 1.0, 0.86, 0.55], // pale gold: the top of the spectrum, but still with chroma in it
];
const PALETTE = new Float32Array(COLS * 3);
for (let c = 0; c < COLS; c++) {
  const f = c / (COLS - 1);
  let k = 0;
  while (k < SPECTRUM.length - 2 && f > SPECTRUM[k + 1][0]) k++;
  const [f0, r0, g0, b0] = SPECTRUM[k];
  const [f1, r1, g1, b1] = SPECTRUM[k + 1];
  const u = (f - f0) / (f1 - f0);
  PALETTE[c * 3 + 0] = r0 + (r1 - r0) * u;
  PALETTE[c * 3 + 1] = g0 + (g1 - g0) * u;
  PALETTE[c * 3 + 2] = b0 + (b1 - b0) * u;
}

// The white core a loud bin burns to. (1.0, 0.93, 0.84) before, which was near enough to neutral
// that the top end of the spectrum — where the columns carry the most texture, so the most lines
// overlap — washed out to a flat grey across the right of the frame: measured at rgb 186,178,164,
// a chroma of 0.12, and against a saturated ember field a neutral grey of that value reads green.
// Pulling the core warm keeps the pale end pale without letting it leave the palette, and the
// genuinely white cores are then something the additive overlap earns rather than a preset.
const HOT = { r: 1.0, g: 0.88, b: 0.71 };
// warm, not the cool blue-white it was: a third near-white competing on a page whose accent is
// #ff4d00 read as a colour error, and it was the loudest reason the hot cores lost their ember
const FLASH = { r: 1.0, g: 0.93, b: 0.79 };

// The terrain is wider than the frame, so with a loud source the outermost bins used to build a
// lit wall of lines running off the corner, which reads as a rendering glitch rather than as a
// landscape. Fading the ends to black — not flattening them, which only trades the wall for a
// visible plane — lets the terrain dissolve into the dark at both edges instead of being cut off.
const smoothstep01 = (x: number): number => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};
const WINDOW = new Float32Array(COLS);
for (let c = 0; c < COLS; c++) {
  const f = c / (COLS - 1);
  // Two jobs were being asked of one curve. Keeping the terrain off the frame edge is now the
  // final pass's margin dissolve, which measures the frame in the frame's own units; all this has
  // to do is stop the data ending in a hard cut at bin 0 and bin 95. That split matters most with
  // a real source: a 55 Hz drone puts everything it has in the first ten columns, and a ramp wide
  // enough to frame the picture was dimming the whole audible bass band to build a smooth lit
  // shelf out of it. Still asymmetric, because the top end lies away from the camera at a shallow
  // angle and needs more columns to cover the same distance on screen.
  WINDOW[c] = smoothstep01(f / 0.07) * smoothstep01((1 - f) / 0.16);
}
let WINDOW_SUM = 0;
for (let c = 0; c < COLS; c++) WINDOW_SUM += WINDOW[c];
// A soft knee on the height, not a straight multiply. The old linear 2.0 let a loud bass bin grow
// without limit and throw the ridge out of the top-left of frame; this gives the quiet material
// more of the range and lets the loud material saturate, so the composition holds at every level.
const LIFT = 1.9;
// how many of the newest rows the leading edge dissolves over; see writeGeometry
const LEAD_ROWS = 14;
const shapeAmp = (a: number): number => a / (1 + 0.42 * a);
// the sheet floats clear of the mirror plane, so there is always a dark gap between the terrain
// and its reflection: without it the two fuse at every quiet bin and the surface stops existing
const FLOAT = 0.26;

// the onset envelope: how much of an *event* the last frame was. Drives exposure, bloom and the
// horizon glow, so a beat lifts the whole image and not only the row it was written into.
let onset = 0;
let fluxAvg = 0.01;
let bassLevel = 0;
// how much light is on the surface, on a ~0.8 s time constant. The idle swell breathes over about
// nine seconds and used to take the whole image with it, so a visitor who landed in the trough got
// a near-empty frame and a visitor who landed at the crest got the page. This is the measurement
// the exposure floor is built on; see syncPost.
let sceneLevel = 0.2;
const BASS_BINS = Math.round(COLS * 0.18);
// prevRow is shared between the idle sweep and the analyser, so the frame the source changes is a
// whole-row jump, not a transient. Unguarded, turning the sound OFF fired a maximum-strength beat:
// the image flared at the exact moment the visitor asked for silence.
let lastSource: SoundState | 'preroll' = 'preroll';

// attack fast, release slow: the ridge should feel alive, not twitchy
function advance(row: Float32Array, dt: number, source: SoundState | 'preroll'): void {
  const switched = source !== lastSource;
  lastSource = source;
  let flux = 0;
  let bass = 0;
  let lit = 0;
  for (let c = 0; c < COLS; c++) {
    const target = row[c];
    const rise = Math.max(0, target - prevRow[c]);
    prevRow[c] = target;
    flux += rise;
    smooth[c] += (target - smooth[c]) * (target > smooth[c] ? 0.5 : 0.12);
    if (c < BASS_BINS) bass += smooth[c];
    // weighted by the same window the colour is: the columns that are faded to black at the edges
    // are not on screen, so they must not count towards how bright the frame is
    lit += smooth[c] * WINDOW[c];
    // this frame's heat: the transient in this bin plus any pluck flash. Written once, then it
    // belongs to the row, not to the near edge.
    heatRow[c] = Math.min(1.5, rise * 4.5 + pulse[c] * 1.1);
    pulse[c] *= 0.93;
  }
  // a 1-2-1 across the bins: unsmoothed, per-bin flux writes a picket fence of spikes instead of
  // the coherent crest a beat should be
  let prev = heatRow[0];
  for (let c = 1; c < COLS - 1; c++) {
    const here = heatRow[c];
    heatRow[c] = (prev + here * 2 + heatRow[c + 1]) * 0.25;
    prev = here;
  }
  bassLevel = bass / BASS_BINS;
  sceneLevel += (lit / WINDOW_SUM - sceneLevel) * Math.min(1, dt * 1.2);
  // flux is a per-frame delta but the envelope it drives decays per second, so on the 120 Hz panel
  // this is built for every rise would have halved while the fixed floor and the gain did not move.
  // Normalising to a 60 Hz reference makes the detector mean the same thing at any frame rate.
  const k = Math.min(4, Math.max(0.25, dt * 60));
  flux /= COLS * k;
  // Spectral flux measured against its own slow average: a beat is a frame far busier than usual,
  // which works for the drone, for the idle sweep and for whatever the microphone hears. The one
  // frame it cannot mean anything is the frame the source changes, because this row and prevRow
  // then came from different generators and the "rise" is a whole-row jump. Unguarded that fired a
  // full-strength onset, so the image flared at the moment the visitor asked for silence. The
  // average skips it too, or one bogus sample lifts the threshold over the next second of beats.
  const hit = switched ? 0 : Math.min(1, Math.max(0, (flux - fluxAvg * 2.0 - 0.003) * 8));
  if (!switched) fluxAvg += (flux - fluxAvg) * Math.min(1, 0.05 * k);
  onset = Math.max(onset * Math.exp(-dt * 5.5), hit);
  pushRows();
}

function writeGeometry(): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const col = geometry.getAttribute('color') as THREE.BufferAttribute;

  for (let r = 0; r < ROWS; r++) {
    const near = 1 - r / (ROWS - 1);
    const nearW = near * near;
    // The leading edge. Row 0 sits about 1.7 units from the lens, so the newest rows are magnified
    // hugely and the sheet's cut edge — a flat plate at the float height, cross-hatched, with two
    // long straight sides — filled the top-left of the frame and ran off the bottom. It read as
    // geometry that escaped rather than as terrain. This is the same dissolve the column ends
    // already use, turned ninety degrees: the present arrives out of the dark instead of arriving
    // as a plane. Fourteen rows is under a quarter second of history, so a pluck still lands at
    // once and the near field keeps its detail.
    const lead = smoothstep01(r / LEAD_ROWS);
    const depth = 0.12 + 0.88 * nearW;
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      const h = heat[i];
      const amp = Math.min(1.35, history[i] + pulse[c] * 0.5 * nearW);
      // the shockwave keeps a little of its height as it recedes, so it stays a travelling event
      // the heat lift is windowed like the colour is: the outermost columns are faded to black, and
      // a column with no light in it must not move, or the last visible span of every row jitters
      const lift =
        FLOAT +
        shapeAmp(amp) * LIFT * (0.45 + 0.55 * nearW) +
        h * 0.11 * (0.3 + 0.7 * nearW) * WINDOW[c];
      pos.setY(i, lift);

      const e = Math.min(1, amp * 1.15);
      const flash = Math.min(1, h);
      const glowW =
        ((0.07 + e * 0.85) * depth + flash * 0.38 * (0.25 + 0.75 * nearW)) * WINDOW[c] * lead;
      // the knee starts later and the range is wider than the value can reach, so hotMix tops out
      // near 0.76 rather than 1.0: a loud bin keeps a quarter of its own hue instead of turning
      // into flat near-white, and white is then something the additive overlap earns, not a preset
      const hotMix = Math.min(1, Math.max(0, (e - 0.62) / 0.7));
      const b = c * 3;
      const cr = PALETTE[b] + (HOT.r - PALETTE[b]) * hotMix;
      const cg = PALETTE[b + 1] + (HOT.g - PALETTE[b + 1]) * hotMix;
      const cb = PALETTE[b + 2] + (HOT.b - PALETTE[b + 2]) * hotMix;
      col.setXYZ(
        i,
        (cr + (FLASH.r - cr) * flash) * glowW,
        (cg + (FLASH.g - cg) * flash) * glowW,
        (cb + (FLASH.b - cb) * flash) * glowW
      );
    }
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
}

/* ————— HUD wiring ————— */

const pill = document.getElementById('st-pill') as HTMLButtonElement;
const pillState = document.getElementById('st-pill-state') as HTMLElement;
const hintEl = document.getElementById('st-hint') as HTMLElement;

const ORDER: SoundState[] = ['off', 'drone', 'mic'];

let notice = '';
let noticeUntil = 0;

function refreshPill(): void {
  const s = getState();
  pillState.textContent = s === 'off' ? 'OFF' : s === 'drone' ? 'ON · DRONE' : 'ON · MIC';
  pill.setAttribute('aria-pressed', String(s !== 'off'));
}

// This slot used to read a live FPS number, which is the one thing on the page that invited a
// stranger to judge it as a benchmark instead of looking at it — and on a slow machine it read
// FPS 17 under a picture that was doing fine. What replaces it has to be honest live state about
// the work. The grid is it: 96 bins across by however many rows of history the machine is
// actually holding, which is the one number the adaptive quality tier can change under a visitor
// and which they could not otherwise see. The obvious alternatives were measured and dropped: the
// peak band and the peak note both sit on the bass for about nine tenths of the idle sweep and
// then flicker, which is a twitching constant, not a reading.
function statusLine(): string {
  if (performance.now() < noticeUntil) return notice;
  const s = getState();
  const src = s === 'off' ? 'IDLE SWEEP' : s === 'drone' ? 'SRC DRONE' : 'SRC MIC';
  // the chrome's status slot is 60vw on phones: keep the line short enough to never ellipsise
  return innerWidth < 640
    ? `${COLS} × ${ROWS} · ${src}`
    : `ANALYSER 2048-FFT · ${COLS} BINS × ${ROWS} ROWS · ${src}`;
}

function showNotice(text: string, ms: number): void {
  notice = text;
  noticeUntil = performance.now() + ms;
  ui?.setStatus(text);
}

pill.addEventListener('click', () => {
  const next = ORDER[(ORDER.indexOf(getState()) + 1) % ORDER.length];
  setState(next)
    .catch(() => showNotice('MIC DENIED · STAYING ON DRONE', 2200))
    .finally(refreshPill);
});

/* ————— plucking the terrain ————— */

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let dragging = false;
let lastPluck = 0;

// t in [0,1] across the terrain's width
function pluck(t: number): void {
  const col = Math.min(COLS - 1, Math.floor(t * COLS));
  pulse[col] = 1.2;

  // first touch wakes the machine: sound off → drone on, then play
  if (getState() === 'off') {
    void setState('drone').then(refreshPill);
  }
  const now = performance.now();
  if (now - lastPluck > 110) {
    lastPluck = now;
    pluckAt(t);
  }
  hintEl.classList.add('gone');
}

function pluckFromPointer(e: PointerEvent): void {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(hitPlane)[0];
  if (!hit) return;
  const t = (hit.point.x - terrain.position.x + X_HALF) / (X_HALF * 2);
  if (t < 0 || t > 1) return;
  pluck(t);
}

canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  pluckFromPointer(e);
});
window.addEventListener('pointerup', () => {
  dragging = false;
});
canvas.addEventListener('pointermove', (e) => {
  if (dragging) pluckFromPointer(e);
});

// keyboard equivalent: the number row plucks across the surface, 1 at the bass end, 0 at the top
canvas.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const n = '1234567890'.indexOf(e.key);
  if (n < 0) return;
  e.preventDefault();
  pluck((n + 0.5) / 10);
});

/* ————— adaptive quality: bloom first, then pixel ratio, then history depth ————— */

let qualityTier = 0;

function capPixelRatio(cap: number): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap));
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
}

function stepQualityDown(): void {
  qualityTier++;
  if (qualityTier === 1) {
    bloomPass.enabled = false;
    return;
  }
  if (qualityTier === 2) {
    // the reflection is a second full draw of the same 30k segments, so it costs roughly what the
    // terrain costs; making it dim never made it cheap. It goes before the pixel ratio and well
    // before the history depth, which is the one thing the page's whole premise rests on.
    reflection.visible = false;
    return;
  }
  if (qualityTier === 3) {
    capPixelRatio(1.25);
    return;
  }
  // dispose frees the old grid buffers before they are replaced
  geometry.dispose();
  ROWS = 110;
  const nextHistory = new Float32Array(ROWS * COLS);
  nextHistory.set(history.subarray(0, nextHistory.length)); // keep the most recent rows
  history = nextHistory;
  const nextHeat = new Float32Array(ROWS * COLS);
  nextHeat.set(heat.subarray(0, nextHeat.length));
  heat = nextHeat;
  buildGrid();
}

/* ————— loop ————— */

let hudLast = 0;
let frameNo = 0;

const BLOOM_BASE = 0.35;

// The exposure floor. A visitor lands once, and the idle swell breathes over about nine seconds,
// so a third of all landings used to arrive in the trough: the same page, two thirds of the light,
// nothing to stop a scroll. This is an auto-exposure, not a brightness bump — it divides by the
// surface's own slow level, so the quiet phase is still quieter than the crest, it just never
// lands on nothing. 0.2 is the level the loud phase reaches, so the crest is left exactly as it
// was and only the trough is lifted, and the ceiling stops a silent microphone from being
// amplified into a grey field. It multiplies the lines only: the horizon glow and the page black
// are composited after tone mapping, so the floor of the image cannot be raised off black.
function exposureFloor(): number {
  const lvl = Math.max(0, sceneLevel);
  // Two gates, and the first one is the important one. A reciprocal alone would have handed a
  // silent microphone in a quiet room the maximum lift, and what is on screen then is the float
  // plane: a dead flat sheet seen edge-on, which is the one thing on this page that additive
  // blending turns into a lit plate. There is nothing to expose for, so this must not expose for
  // it. Above that, the lift covers the band the idle swell actually breathes across, measured
  // over a minute of it: 0.10 at the trough, 0.22 at the crest, so the crest is left exactly as it
  // was and only the trough comes up.
  const present = smoothstep01((lvl - 0.015) / 0.045);
  const quiet = smoothstep01((0.21 - lvl) / 0.11);
  return 1 + 0.6 * present * quiet;
}

// one event, three answers: the exposure lifts, the bloom swells, the horizon flares
function syncPost(): void {
  finalPass.uniforms.uExposure.value = (1.0 + onset * 0.3) * exposureFloor();
  finalPass.uniforms.uGlow.value = 1.0 + Math.min(1, bassLevel) * 0.6 + onset * 1.2;
  bloomPass.strength = BLOOM_BASE + onset * 0.4;
}

function render(dt: number, t: number): void {
  const source = getState();
  const row = source === 'off' ? synthIdleRow(t) : readAnalyserRow(t);
  advance(row, dt, source);
  writeGeometry();
  syncPost();

  // gentle camera sway so the scene breathes even before input
  camera.position.x = Math.sin(t * 0.1) * 0.12;
  camera.lookAt(LOOK_AT);

  const now = performance.now();
  if (now - hudLast > 500) {
    hudLast = now;
    ui?.setStatus(statusLine());
  }

  frameNo = (frameNo + 1) % 1024;
  finalPass.uniforms.uFrame.value = frameNo;
  composer.render();
}

/* ————— boot: real work behind the curtain, then the first frame drops it ————— */

// run the idle sweep through the ring buffer so the first frame is a formed landscape rather than
// a flat plane filling in over the next 160 frames; chunked so the progress rule can move
async function prerollHistory(pre: Preloader): Promise<void> {
  const total = ROWS;
  const chunk = 40;
  for (let i = 0; i < total; i += chunk) {
    const end = Math.min(total, i + chunk);
    // The opening frame is the one a reduced-motion visitor keeps and the one the homepage's
    // exit tween hands over to, so the preroll is run to a chosen phase rather than to zero:
    // here the idle swell is mid-strength (so the bass ridge is not at full height and clipping
    // the corner) and the last beat is about a third of the way back to the horizon, so the page
    // opens on a shockwave in flight instead of a flat plane.
    for (let k = i; k < end; k++)
      advance(synthIdleRow((k - total) / 60 + PREROLL_PHASE), 1 / 60, 'preroll');
    pre.set(0.3 + 0.3 * (end / total), 'building terrain');
    await nextFrame();
  }
  writeGeometry();
  syncPost();
}

// the post passes draw through their own fullscreen triangle, outside the scene, so compileAsync
// on the scene alone would leave their nine programs to link synchronously on the first frame.
// stand-in meshes with the same geometry and the very same material instances hit the same
// program cache keys, as long as each is compiled against the kind of target it renders into.
async function compilePrograms(): Promise<void> {
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const standIns = (materials: THREE.Material[]): THREE.Scene => {
    const s = new THREE.Scene();
    for (const m of materials) s.add(new THREE.Mesh(tri, m));
    return s;
  };

  // the terrain and the bloom chain render into HDR targets (linear output)
  renderer.setRenderTarget(composer.renderTarget1);
  await renderer.compileAsync(scene, camera);
  await renderer.compileAsync(
    standIns([
      bloomPass.materialHighPassFilter,
      ...bloomPass.separableBlurMaterials,
      bloomPass.compositeMaterial,
      bloomPass.blendMaterial,
    ]),
    camera
  );
  // the final pass renders to the screen (sRGB output)
  renderer.setRenderTarget(null);
  await renderer.compileAsync(standIns([finalMaterial]), camera);
  tri.dispose();
}

export async function boot(chrome: LabChrome, pre: Preloader): Promise<void> {
  ui = chrome;
  resize();
  window.addEventListener('resize', resize);
  refreshPill();

  await prerollHistory(pre);

  pre.set(0.65, 'compiling');
  await compilePrograms();
  pre.set(0.85, 'compiling');
  await nextFrame();

  if (reduced) {
    // one considered frame, no perpetual motion, and no audio offers
    pill.hidden = true;
    hintEl.hidden = true;
    composer.render();
    live = true;
    chrome.setStatus('STILL FRAME · REDUCED MOTION');
    await pre.done();
    return;
  }

  // the first real frame also links the post passes; the loop takes over from here
  composer.render();
  live = true;
  startLoop(render);
  watchQuality(stepQualityDown, { maxDrops: 4 });
  await pre.done();
}
