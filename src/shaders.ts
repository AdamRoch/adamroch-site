export const vertexShader = /* glsl */ `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

export const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec2 uRes;
  uniform vec2 uMouse;
  uniform float uScroll;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = rot * p * 2.0;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / uRes.xy;
    vec2 p = uv;
    p.x *= uRes.x / uRes.y;

    float t = uTime * 0.06;
    vec2 m = (uMouse - 0.5) * 0.35;
    float warp = 1.0 + uScroll * 1.2;

    vec2 q = vec2(
      fbm(p * 1.3 + t),
      fbm(p * 1.3 + vec2(5.2, 1.3) - t)
    );
    vec2 r = vec2(
      fbm(p * 1.3 + warp * 2.4 * q + vec2(1.7, 9.2) + m + t * 0.7),
      fbm(p * 1.3 + warp * 2.4 * q + vec2(8.3, 2.8) - m - t * 0.5)
    );
    float f = fbm(p * 1.3 + warp * 2.2 * r);

    vec3 base = vec3(0.045, 0.045, 0.060);
    vec3 indigo = vec3(0.120, 0.160, 0.380);
    vec3 ember = vec3(0.980, 0.310, 0.060);

    vec3 col = mix(base, indigo, smoothstep(0.10, 0.70, f));
    float emberMask = smoothstep(0.35, 0.80, dot(q, r) * 0.95 + uScroll * 0.1);
    col = mix(col, ember, emberMask * 0.9);

    // editorial split: keep the left dark for the name, let the right burn
    float focus = smoothstep(0.10, 0.95, uv.x);
    col *= mix(0.55, 1.35, focus);

    // the page dims as you descend into it
    col *= 1.0 - uScroll * 0.55;

    float vig = 1.0 - smoothstep(0.30, 1.15, length((uv - vec2(0.62, 0.50)) * vec2(1.1, 1.0)));
    col *= mix(0.40, 1.0, vig);

    gl_FragColor = vec4(col, 1.0);
  }
`;
