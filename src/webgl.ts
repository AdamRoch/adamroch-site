import * as THREE from 'three';
import { vertexShader, fragmentShader } from './shaders';

export interface WebGLHandle {
  setScroll: (progress: number) => void;
}

export function initWebGL(canvas: HTMLCanvasElement, reduced: boolean): WebGLHandle {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = {
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uMouse: { value: new THREE.Vector2(0.5, 0.5) },
    uScroll: { value: 0 },
  };

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms })
  );
  scene.add(mesh);

  const bufferSize = new THREE.Vector2();
  function resize(): void {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.getDrawingBufferSize(bufferSize);
    uniforms.uRes.value.copy(bufferSize);
  }
  resize();
  window.addEventListener('resize', resize);

  const mouseTarget = new THREE.Vector2(0.5, 0.5);
  window.addEventListener('pointermove', (e) => {
    mouseTarget.set(e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight);
  });

  const timer = new THREE.Timer();

  function frame(): void {
    timer.update();
    const delta = Math.min(timer.getDelta(), 0.1);
    uniforms.uTime.value += delta;
    uniforms.uMouse.value.lerp(mouseTarget, 0.045);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  if (reduced) {
    // one considered frame, no perpetual motion
    uniforms.uTime.value = 12.0;
    renderer.render(scene, camera);
    window.addEventListener('resize', () => renderer.render(scene, camera));
  } else {
    frame();
  }

  return {
    setScroll(progress: number) {
      uniforms.uScroll.value = progress;
      if (reduced) renderer.render(scene, camera);
    },
  };
}
