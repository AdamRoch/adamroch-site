import * as THREE from 'three';

export interface ParticleHandle {
  setMorph: (progress: number) => void;
}

const POINT_COUNT = 70_000;
const TAU = Math.PI * 2;

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uMorph;
  uniform float uSize;
  uniform float uPixelRatio;

  attribute vec3 aTarget;
  attribute float aRandom;

  varying float vDepth;

  void main() {
    vec3 point = mix(position, aTarget, uMorph);
    float phase = aRandom * 31.4159;
    vec3 drift = vec3(
      sin(uTime * 0.72 + phase),
      cos(uTime * 0.61 + phase * 1.37),
      sin(uTime * 0.53 + phase * 1.91)
    ) * 0.03;

    vec4 viewPosition = modelViewMatrix * vec4(point + drift, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = uSize * uPixelRatio * (3.0 / max(0.1, -viewPosition.z));
    vDepth = clamp((-viewPosition.z - 2.0) / 2.4, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  varying float vDepth;

  void main() {
    float distanceFromCenter = length(gl_PointCoord - 0.5) * 2.0;
    float alpha = smoothstep(1.0, 0.08, distanceFromCenter) * 0.72;
    if (alpha < 0.01) discard;

    vec3 color = mix(vec3(0.48), vec3(1.0), 1.0 - vDepth);
    gl_FragColor = vec4(color, alpha);
  }
`;

function createRandom(seed = 0x5f3759df): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function fillTorusKnot(
  positions: Float32Array,
  randomValues: Float32Array,
  random: () => number
): void {
  const majorRadius = 0.68;
  const knotRadius = 0.26;
  const tubeRadius = 0.12;
  const p = 2;
  const q = 3;
  const tilt = 0.58;
  const turn = -0.2;
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  const cosTurn = Math.cos(turn);
  const sinTurn = Math.sin(turn);

  for (let i = 0; i < POINT_COUNT; i += 1) {
    const t = random() * TAU;
    const tubeAngle = random() * TAU;
    const cosQt = Math.cos(q * t);
    const sinQt = Math.sin(q * t);
    const cosPt = Math.cos(p * t);
    const sinPt = Math.sin(p * t);
    const ring = majorRadius + knotRadius * cosQt;

    const centerX = ring * cosPt;
    const centerY = ring * sinPt;
    const centerZ = knotRadius * sinQt;

    let tangentX = -knotRadius * q * sinQt * cosPt - ring * p * sinPt;
    let tangentY = -knotRadius * q * sinQt * sinPt + ring * p * cosPt;
    let tangentZ = knotRadius * q * cosQt;
    const tangentLength = Math.hypot(tangentX, tangentY, tangentZ);
    tangentX /= tangentLength;
    tangentY /= tangentLength;
    tangentZ /= tangentLength;

    let normalX: number;
    let normalY: number;
    let normalZ: number;
    if (Math.abs(tangentZ) < 0.9) {
      normalX = tangentY;
      normalY = -tangentX;
      normalZ = 0;
    } else {
      normalX = -tangentZ;
      normalY = 0;
      normalZ = tangentX;
    }
    const normalLength = Math.hypot(normalX, normalY, normalZ);
    normalX /= normalLength;
    normalY /= normalLength;
    normalZ /= normalLength;

    const binormalX = tangentY * normalZ - tangentZ * normalY;
    const binormalY = tangentZ * normalX - tangentX * normalZ;
    const binormalZ = tangentX * normalY - tangentY * normalX;
    const radius = tubeRadius * (0.45 + Math.sqrt(random()) * 0.55) + (random() - 0.5) * 0.018;
    const ringCos = Math.cos(tubeAngle) * radius;
    const ringSin = Math.sin(tubeAngle) * radius;

    const x = centerX + normalX * ringCos + binormalX * ringSin;
    const y = centerY + normalY * ringCos + binormalY * ringSin;
    const z = centerZ + normalZ * ringCos + binormalZ * ringSin;
    const tiltedY = y * cosTilt - z * sinTilt;
    const tiltedZ = y * sinTilt + z * cosTilt;

    const offset = i * 3;
    positions[offset] = x * cosTurn - tiltedY * sinTurn;
    positions[offset + 1] = x * sinTurn + tiltedY * cosTurn;
    positions[offset + 2] = tiltedZ;
    randomValues[i] = random();
  }
}

function fillSphereCloud(targets: Float32Array, random: () => number): void {
  for (let i = 0; i < POINT_COUNT; i += 1) {
    const theta = random() * TAU;
    const z = 1 - 2 * random();
    const radial = Math.sqrt(Math.max(0, 1 - z * z));
    const wave = Math.sin(theta * 4 + z * 7) * 0.055;
    const scatter = (random() - 0.5) * 0.2 + Math.pow(random(), 9) * 0.42;
    const radius = 0.76 + wave + scatter;
    const jitter = 0.025;
    const offset = i * 3;

    targets[offset] = radial * Math.cos(theta) * radius + (random() - 0.5) * jitter;
    targets[offset + 1] = z * radius + (random() - 0.5) * jitter;
    targets[offset + 2] = radial * Math.sin(theta) * radius + (random() - 0.5) * jitter;
  }
}

export function initParticles(canvas: HTMLCanvasElement, reduced: boolean): ParticleHandle {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20);
  camera.position.set(0, 0, 3.2);
  camera.lookAt(0, 0, 0);

  const positions = new Float32Array(POINT_COUNT * 3);
  const targets = new Float32Array(POINT_COUNT * 3);
  const randomValues = new Float32Array(POINT_COUNT);
  const random = createRandom();
  fillTorusKnot(positions, randomValues, random);
  fillSphereCloud(targets, random);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aTarget', new THREE.BufferAttribute(targets, 3));
  geometry.setAttribute('aRandom', new THREE.BufferAttribute(randomValues, 1));
  geometry.computeBoundingSphere();

  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  const uniforms = {
    uTime: { value: reduced ? 12 : 0 },
    uMorph: { value: reduced ? 0.35 : 0 },
    uSize: { value: 1.6 },
    uPixelRatio: { value: pixelRatio },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const points = new THREE.Points(geometry, material);
  scene.add(points);

  const container = canvas.parentElement ?? canvas;
  const cameraTarget = new THREE.Vector2();
  let frameId = 0;
  let running = false;
  let lastFrame = performance.now();

  const render = (): void => {
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  };

  const resize = (): void => {
    const bounds = container.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) return;
    const nextPixelRatio = Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(nextPixelRatio);
    renderer.setSize(bounds.width, bounds.height, false);
    camera.aspect = bounds.width / bounds.height;
    camera.updateProjectionMatrix();
    uniforms.uPixelRatio.value = nextPixelRatio;
    render();
  };

  const frame = (now: number): void => {
    if (!running) return;
    const delta = Math.min((now - lastFrame) / 1_000, 0.1);
    lastFrame = now;
    uniforms.uTime.value += delta;
    camera.position.x += (cameraTarget.x - camera.position.x) * 0.045;
    camera.position.y += (cameraTarget.y - camera.position.y) * 0.045;
    render();
    frameId = requestAnimationFrame(frame);
  };

  const start = (): void => {
    if (running || reduced) return;
    running = true;
    lastFrame = performance.now();
    frameId = requestAnimationFrame(frame);
  };

  const stop = (): void => {
    if (!running) return;
    running = false;
    cancelAnimationFrame(frameId);
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  if (!reduced) {
    window.addEventListener('pointermove', (event) => {
      cameraTarget.set(
        (event.clientX / window.innerWidth - 0.5) * 0.28,
        -(event.clientY / window.innerHeight - 0.5) * 0.22
      );
    });

    const visibilityObserver = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) start();
      else stop();
    });
    visibilityObserver.observe(canvas);
  }

  return {
    setMorph(progress: number): void {
      if (reduced) return;
      uniforms.uMorph.value = THREE.MathUtils.clamp(progress, 0, 1);
    },
  };
}
