# Lab design notes — content drafts

Copy for the "how it's built" note on each lab page. Design and placement of the
discreet button/panel: TBD via mock-up. Voice is first person to match the site.
Edit freely — these are drafts.

---

## Living World (`/lab/living-world/`)

The scene is 100% procedural Three.js — no model files, no image assets. The
arches are torus geometry with seeded noise pushed through their vertices once at
build time. The moss is a canvas texture painted at runtime. The sun and moon are
glow sprites, and the day-night cycle is a single GSAP timeline that drives the
key light's position, color, and intensity along with the fog and sky. Even the
butterfly is two planes flapping on a sine wave.

```ts
// every arch: a half-torus, displaced once at build time
const geo = new THREE.TorusGeometry(def.radius, def.tube, 40, 180, Math.PI);
jitter(geo, 0.1, i * 7.13 + 1.7); // seeded trig noise through the vertices

// the moss: a canvas painted at runtime, reused as map + bump
const mossTex = new THREE.CanvasTexture(makeMossCanvas(1234));
```

Shadows are real (PCF soft shadow maps — 4096px sun, 2048px moon), and the
periodic "scan" effect is just the materials flipping into wireframe and back.

The EXPLORE button flies the camera along a Catmull-Rom spline threaded through
three of the arch openings — out through the big left arch and the small center
one, a wide sweep around the back field, then home through the right arch —
while the fov pushes 42 → 34 and back for the zoom. The control points are
verified clear of every arch tube, and the flight hands control back to the
mouse parallax without a pop.

---

## Event Horizon (`/lab/event-horizon/`)

No meshes, no assets — the entire image is one fragment shader. Each pixel fires
a ray that gets bent by a simple 1/r² gravitational pull over 44 integration
steps. Along the way the march checks three things: capture (the ray falls past
the event horizon), crossings of the accretion disk plane, and crossings of a
"code sheet" curtain that gets lensed into the hole.

```glsl
// bend the ray, 44 steps per pixel
vec3 acc = -1.55 * p / (r2 * r);
v = normalize(v + acc * dt);
```

The disk rotates differentially — inner material orbits faster, Kepler-style —
and the side rotating toward the viewer burns brighter (doppler beaming). The
photon ring comes from tracking each ray's closest approach; captured rays leave
the shadow pure black. The code glyphs are a monospace canvas texture, the only
"texture" in the piece.

```glsl
// keplerian differential rotation
float omega = 2.2 * pow(rd, -1.5); // inner material orbits faster
```

---

## Sonic Terrain (`/lab/sonic-terrain/`)

The terrain is a line-mesh grid: 64 frequency bins across, 110 rows of scrolling
history receding to the horizon. Each animation frame reads the AnalyserNode
(2048-point FFT), maps bins on a log-ish curve so the bass band stays wide the
way the ear hears it, applies attack-fast / release-slow smoothing, and pushes a
new row onto the ring buffer.

```ts
// history recedes: shift everything one row back, write the new frame at row 0
history.copyWithin(COLS, 0, history.length - COLS);
history.set(values, 0);
```

The sound is pure WebAudio, no samples: a generative dark-ambient drone of
detuned sine pairs a fifth apart through a lowpass filter wobbled by a slow LFO,
plus a noise wash. Mic mode is analysis-only — the input is never routed to the
speakers, so there's no feedback. Dragging across the terrain plucks it:
raycast position maps to a minor-pentatonic triangle-oscillator note, so
everything you play is in key.

```ts
// position across the terrain → pentatonic note over ~2.5 octaves
const semis = 12 * Math.floor(steps / PENTA.length) + PENTA[steps % PENTA.length];
```

---

## Work queue (not site copy)

1. **Fidelity pass — Living World done** (moss canvas 512 → 2048 with scaled
   detail, tori 20×72 → 40×180, stubs 6 → 12 sides, shadow maps sun 4096 /
   moon 2048, max texture anisotropy, ACES tone mapping, glow sprite 64 → 128).
   Fidelity-first: no adaptive quality scaling. Same treatment later for the
   other two pages (Event Horizon: STEPS / render scale; Sonic Terrain:
   COLS / ROWS density).
2. **Adaptive/mobile quality — separate ticket.** Lower-resolution fallbacks for
   weaker hardware, decided after a performance testing pass.
3. **Design-note UI.** Mock-up for the discreet per-page button + panel that will
   hold the notes above.
