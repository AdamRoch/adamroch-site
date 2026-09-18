/* ————— the cinematic pipeline —————
   Linear HDR render (MSAA), restrained half-res bloom on the HDR values, tone map,
   then one fullscreen pass on the display-referred image: luminance-weighted animated
   grain sized in device pixels, an interleaved-gradient dither to kill banding, and
   a soft vignette. Nothing else touches the frame after this. */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export interface Post {
  render(t: number): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  setBloom(on: boolean): void;
  // compiles the scene's programs against the HDR target, so the first real frame
  // finds them ready — a compile against the canvas would key a different program
  compile(scene: THREE.Scene, camera: THREE.Camera): Promise<void>;
}

const FinishShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uGrain: { value: 0.045 },
    uVignette: { value: 0.26 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    varying vec2 vUv;

    // interleaved gradient noise (Jimenez 2014) — one value per device pixel
    float ign(vec2 p) {
      return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
    }

    // cheap white hash, reseeded each frame so the grain crawls like stock
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 px = gl_FragCoord.xy;

      // grain rides the mids and lifts off the highlights, so the sun stays clean
      float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      float g = hash(px + fract(uTime * 0.731) * 1024.0) - 0.5;
      c.rgb += g * uGrain * (1.0 - lum * 0.7);

      // soft vignette: pow 0.5 falloff from the centre, never a hard ring
      vec2 q = vUv - 0.5;
      float d = length(q) * 1.4142;
      float v = pow(clamp(1.0 - d * d, 0.0, 1.0), 0.5);
      c.rgb *= mix(1.0, v, uVignette);

      // ±0.5/255 dither on the way to 8 bits
      c.rgb += (ign(px) - 0.5) / 255.0;
      gl_FragColor = c;
    }`,
};

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Post {
  const size = renderer.getSize(new THREE.Vector2());
  const pixelRatio = renderer.getPixelRatio();

  // the HDR target carries MSAA — the canvas itself is never drawn into directly
  const target = new THREE.WebGLRenderTarget(size.x * pixelRatio, size.y * pixelRatio, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  target.texture.name = 'wt.hdr';

  const composer = new EffectComposer(renderer, target);
  // radius here weights the coarsest mip, so it stays low: a tight halo, not a haze
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x * pixelRatio, size.y * pixelRatio), 0.32, 0.3, 1.0);
  // the stock bright pass lets anything over the threshold through at its full HDR value,
  // so the sea's mirror specular under the sun (a GGX peak in the hundreds) bloomed into a
  // whiteout that swallowed the moon. this one blooms only the excess over the threshold,
  // soft-kneed and capped: a hot highlight earns a halo, never the frame
  bloom.materialHighPassFilter.fragmentShader = /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float luminosityThreshold;
    varying vec2 vUv;
    const float KNEE = 0.4;
    const float CAP = 1.2;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float v = max(luminance(c), 1e-4);
      float soft = clamp(v - luminosityThreshold + KNEE, 0.0, 2.0 * KNEE);
      soft = soft * soft / (4.0 * KNEE);
      float excess = min(max(soft, v - luminosityThreshold), CAP);
      gl_FragColor = vec4(c * (excess / v), 1.0);
    }`;
  bloom.materialHighPassFilter.needsUpdate = true;
  const finish = new ShaderPass(FinishShader);

  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(finish);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(size.x, size.y);

  return {
    render(t) {
      finish.uniforms.uTime.value = t;
      composer.render();
    },
    setSize(width, height, ratio) {
      composer.setPixelRatio(ratio);
      composer.setSize(width, height);
    },
    setBloom(on) {
      bloom.enabled = on;
    },
    async compile(s, c) {
      renderer.setRenderTarget(composer.renderTarget1);
      try {
        await renderer.compileAsync(s, c);
      } finally {
        renderer.setRenderTarget(null);
      }
    },
  };
}
